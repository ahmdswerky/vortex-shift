# Vortex Shift — Implementation Plan

> Node.js + TypeScript CLI for full server migration between Rocky Linux servers on DigitalOcean.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Architecture Overview](#2-architecture-overview)
3. [Directory Structure](#3-directory-structure)
4. [Tech Stack & Dependencies](#4-tech-stack--dependencies)
5. [Core Abstractions](#5-core-abstractions)
6. [Phase 1 — Environment Detection](#6-phase-1--environment-detection)
7. [Phase 2 — Pre-Migration Inventory](#7-phase-2--pre-migration-inventory)
8. [Phase 3 — Data Transfer](#8-phase-3--data-transfer)
9. [Phase 4 — Post-Migration Validation](#9-phase-4--post-migration-validation)
10. [CLI Command Structure](#10-cli-command-structure)
11. [Checkpoint & Resume System](#11-checkpoint--resume-system)
12. [Logging & Progress Display](#12-logging--progress-display)
13. [SSH Management](#13-ssh-management)
14. [Error Handling Strategy](#14-error-handling-strategy)
15. [Configuration Schema](#15-configuration-schema)
16. [File-by-File Implementation Order](#16-file-by-file-implementation-order)
17. [Testing Strategy](#17-testing-strategy)

---

## 1. Project Overview

Vortex Shift is a CLI tool that orchestrates a full live-server migration between two Rocky Linux servers. The CLI runs on **both** the source and destination servers (in different modes) and coordinates transfer via SSH + rsync.

### What gets migrated

| Resource | Details |
|---|---|
| Docker Compose projects | All stacks; databases are containerized (no host-level DB) |
| Docker volumes | Volumes stored outside project directories |
| PM2 apps | Node.js apps with ecosystem configs |
| NGINX Proxy Manager | Full config and data directory |
| DB dumps | pg_dump / redis-cli BGSAVE from running containers |

### Non-goals (explicit scope limits)
- No support for non-Rocky Linux hosts
- No support for host-level PostgreSQL/MySQL/Redis (all must be containerized)
- No GUI — terminal only

---

## 2. Architecture Overview

```
[Source Server]                          [Destination Server]
  vortex-shift source                      vortex-shift destination
       │                                          │
       ├─ Phase 1: Detect environment             ├─ Phase 1: Detect environment
       ├─ Phase 2: Build inventory                │
       ├─ Phase 3: Transfer data ────────rsync──► ├─ Phase 3: Receive data
       │            SSH ──────────────────────►   │
       └─ Phase 4: (signal dest to start)         └─ Phase 4: Validate & start services
```

### Coordination model
- Source server drives the migration
- Destination server runs in passive/listen mode OR is orchestrated via SSH commands from source
- Each phase writes a **checkpoint file** so a restart resumes from the last completed step
- All steps are **idempotent** — safe to re-run

---

## 3. Directory Structure

```
vortex-shift/
├── PLAN.md                        ← this file
├── package.json
├── tsconfig.json
├── .eslintrc.json
├── .prettierrc
│
├── src/
│   ├── index.ts                   ← CLI entry point (bin)
│   │
│   ├── commands/                  ← Commander.js command definitions
│   │   ├── source.ts              ← `vortex-shift source` command
│   │   ├── destination.ts         ← `vortex-shift destination` command
│   │   ├── status.ts              ← `vortex-shift status` — show checkpoint state
│   │   └── reset.ts               ← `vortex-shift reset` — clear checkpoints
│   │
│   ├── phases/                    ← One module per migration phase
│   │   ├── phase1-detect.ts       ← Environment detection
│   │   ├── phase2-inventory.ts    ← Pre-migration inventory
│   │   ├── phase3-transfer.ts     ← Data transfer orchestration
│   │   └── phase4-validate.ts     ← Post-migration validation
│   │
│   ├── core/                      ← Shared infrastructure
│   │   ├── checkpoint.ts          ← Checkpoint read/write/resume logic
│   │   ├── executor.ts            ← Shell command executor with retry
│   │   ├── ssh.ts                 ← SSH client wrapper (key detection, exec, tunnel)
│   │   ├── rsync.ts               ← rsync wrapper with progress streaming
│   │   ├── logger.ts              ← Dual-output logger (terminal + file)
│   │   └── reporter.ts            ← Final migration report generator
│   │
│   ├── inventory/                 ← Inventory collectors (used in Phase 2)
│   │   ├── docker.ts              ← Docker Compose project discovery
│   │   ├── volumes.ts             ← External Docker volume discovery
│   │   ├── pm2.ts                 ← PM2 app discovery
│   │   ├── nginx.ts               ← NGINX Proxy Manager snapshot
│   │   └── databases.ts           ← DB container identification + dump logic
│   │
│   ├── transfer/                  ← Transfer workers (used in Phase 3)
│   │   ├── volumes.ts             ← Volume transfer via rsync
│   │   ├── pm2-apps.ts            ← PM2 app file + ecosystem config transfer
│   │   ├── db-dumps.ts            ← DB dump export + transfer
│   │   └── nginx-data.ts          ← NGINX Proxy Manager data transfer
│   │
│   ├── validation/                ← Validators (used in Phase 4)
│   │   ├── checksums.ts           ← File integrity verification
│   │   ├── services.ts            ← Service startup + health checks
│   │   └── health.ts              ← HTTP/port health check helpers
│   │
│   ├── utils/
│   │   ├── shell.ts               ← Thin execa wrapper
│   │   ├── fs.ts                  ← File system helpers
│   │   ├── format.ts              ← Human-readable sizes, durations, tables
│   │   └── prompt.ts              ← Interactive prompts (inquirer wrapper)
│   │
│   └── types/
│       ├── manifest.ts            ← Inventory manifest types
│       ├── config.ts              ← CLI config / options types
│       ├── checkpoint.ts          ← Checkpoint state types
│       └── report.ts              ← Migration report types
│
├── config/
│   └── defaults.ts                ← Default retry counts, timeouts, paths
│
└── dist/                          ← Compiled output (gitignored)
```

---

## 4. Tech Stack & Dependencies

### Runtime dependencies

| Package | Purpose |
|---|---|
| `commander` | CLI argument parsing, subcommands |
| `execa` | Shell command execution (promise-based, streaming) |
| `ora` | Terminal spinners |
| `chalk` | Terminal color output |
| `cli-progress` | Progress bars for rsync transfer |
| `inquirer` | Interactive prompts (confirmations, SSH inputs) |
| `winston` | Structured file logging |
| `node-ssh` | SSH connection, remote exec, SFTP |
| `fs-extra` | File system utilities (JSON read/write, ensureDir) |
| `p-retry` | Retry logic with exponential backoff |
| `p-limit` | Concurrency control for parallel transfers |
| `zod` | Runtime validation for config and manifest files |
| `date-fns` | Timestamp formatting in reports |

### Dev dependencies

| Package | Purpose |
|---|---|
| `typescript` | Compiler |
| `tsx` | TypeScript execution for dev |
| `@types/node` | Node.js types |
| `vitest` | Test runner |
| `eslint` + `@typescript-eslint` | Linting |
| `prettier` | Formatting |
| `pkg` | Package CLI into standalone binary (optional) |

---

## 5. Core Abstractions

### 5.1 StepRunner

Every migration action is a `Step`. The `StepRunner` executes steps sequentially, checkpointing after each one, with retry on failure.

```typescript
interface Step {
  id: string           // unique, used as checkpoint key
  name: string         // human-readable label
  run: (ctx: MigrationContext) => Promise<void>
  retries?: number     // overrides global default
}
```

### 5.2 MigrationContext

Passed through every phase and step. Holds config, SSH connection, current manifest, logger.

```typescript
interface MigrationContext {
  mode: 'source' | 'destination'
  config: MigrationConfig
  ssh: SSHClient
  manifest: Manifest | null    // populated after Phase 2
  checkpoint: CheckpointState
  log: Logger
}
```

### 5.3 Manifest

Written to disk after Phase 2. Source of truth for what will be transferred.

```typescript
interface Manifest {
  createdAt: string
  sourceHost: string
  dockerProjects: DockerProject[]
  externalVolumes: DockerVolume[]
  pm2Apps: PM2App[]
  databases: DatabaseContainer[]
  nginxProxyManager: NginxSnapshot
}
```

### 5.4 CheckpointState

```typescript
interface CheckpointState {
  phase: 1 | 2 | 3 | 4
  completedSteps: string[]     // step IDs
  failedStep: string | null
  startedAt: string
  lastUpdatedAt: string
}
```

---

## 6. Phase 1 — Environment Detection

**File:** `src/phases/phase1-detect.ts`

### Steps (in order)

| Step ID | Action | Notes |
|---|---|---|
| `detect.os` | Verify Rocky Linux via `/etc/os-release` | Fail fast if not Rocky |
| `detect.docker` | Check `docker --version`, `docker compose version` | Require Compose V2 |
| `detect.pm2` | Check `pm2 --version` | Warn if missing, don't fail |
| `detect.node` | Check `node --version` | Log version |
| `detect.rsync` | Check `rsync --version` | Required on source |
| `detect.ssh-keys` | Detect existing SSH key pair | Fall through to auto-setup |
| `detect.ssh-setup` | If no key found: generate + display pubkey + prompt to add to dest | Interactive step |
| `detect.ssh-test` | Test SSH connectivity to destination | Configurable host/port/user |
| `detect.disk-space` | Check available disk on destination vs estimated transfer size | Warn if <20% headroom |

### SSH auto-setup flow

```
1. Check ~/.ssh/id_ed25519 (or id_rsa)
2. If missing: ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519 -N ""
3. Display public key to user
4. Prompt: "Add this key to destination's ~/.ssh/authorized_keys, then press Enter"
5. Test connection — retry up to 3 times with guidance on failure
```

---

## 7. Phase 2 — Pre-Migration Inventory

**File:** `src/phases/phase2-inventory.ts`

### Steps (in order)

| Step ID | Action | Output |
|---|---|---|
| `inventory.docker-projects` | Find all `docker-compose.yml` / `compose.yaml` files via `find` | `DockerProject[]` |
| `inventory.docker-volumes` | `docker volume ls` + inspect each volume's Mountpoint | `DockerVolume[]` |
| `inventory.pm2-apps` | `pm2 jlist` parse JSON | `PM2App[]` |
| `inventory.db-containers` | Inspect running containers for known DB images (postgres, redis, mysql, mongo) | `DatabaseContainer[]` |
| `inventory.nginx` | Locate NPM data dir (default `/opt/nginx-proxy-manager`), snapshot config | `NginxSnapshot` |
| `inventory.save-manifest` | Write `manifest.json` to checkpoint dir | — |
| `inventory.display-summary` | Print table: projects, volumes, apps, DBs found | — |

### Docker project discovery logic

```
find / -name "docker-compose.yml" -o -name "compose.yaml" 2>/dev/null
  → exclude /proc, /sys, /dev
  → for each: parse services, identify DB containers, note project dir
```

### DB container identification

```
docker ps --format json
  → filter images matching: postgres, redis, mysql, mariadb, mongo, elasticsearch
  → for each: record container name, image, mapped volumes, compose project (if any)
```

---

## 8. Phase 3 — Data Transfer

**File:** `src/phases/phase3-transfer.ts`

All transfers use rsync over SSH. Each sub-step is independently checkpointed.

### Transfer steps (in order)

| Step ID | Action | Tool |
|---|---|---|
| `transfer.db-dumps` | Export DB dumps from running containers | `docker exec` + pg_dump/redis-cli/mysqldump |
| `transfer.docker-volumes` | rsync each external volume Mountpoint | rsync over SSH |
| `transfer.docker-projects` | rsync each project directory | rsync over SSH |
| `transfer.pm2-apps` | rsync PM2 app directories + `pm2 save` ecosystem file | rsync + pm2 |
| `transfer.nginx-data` | rsync NPM data directory | rsync over SSH |
| `transfer.manifest` | Copy manifest.json to destination | rsync |

### rsync flags used

```bash
rsync \
  -avz \               # archive, verbose, compress
  --partial \          # keep partial files on interrupt
  --progress \         # per-file progress
  --checksum \         # verify by checksum not timestamp
  --delete \           # mirror source exactly
  -e "ssh -p PORT"
```

### DB dump strategy per engine

| Engine | Dump command | File |
|---|---|---|
| PostgreSQL | `docker exec <c> pg_dumpall -U postgres` | `<db>.sql` |
| MySQL/MariaDB | `docker exec <c> mysqldump --all-databases -u root -p"$PASS"` | `<db>.sql` |
| Redis | `docker exec <c> redis-cli BGSAVE` then copy `/data/dump.rdb` | `<db>.rdb` |
| MongoDB | `docker exec <c> mongodump --archive` | `<db>.archive` |

All dumps are written to `/tmp/vortex-shift-dumps/` on source, then rsynced to destination.

### Retry logic

Every rsync call is wrapped with `p-retry`:
- Default: 3 attempts
- Backoff: exponential starting at 5s
- On each retry: log attempt number and error

### Progress display

Each rsync transfer streams output and pipes it through a parser that extracts:
- Current file being transferred
- Bytes transferred / total
- Transfer speed
- ETA

Displayed with `cli-progress` bar per transfer.

---

## 9. Phase 4 — Post-Migration Validation

**File:** `src/phases/phase4-validate.ts`

Runs on the **destination** server (either directly or triggered via SSH from source).

### Validation steps

| Step ID | Action | Pass condition |
|---|---|---|
| `validate.checksums` | Re-checksum transferred files vs manifest | All checksums match |
| `validate.docker-volumes` | Verify volume mount paths exist and are non-empty | — |
| `validate.compose-up` | `docker compose up -d` for each project (in dependency order) | Exit 0 |
| `validate.compose-health` | Wait for healthy status on all containers | All healthy within timeout |
| `validate.pm2-restore` | `pm2 resurrect` or start each app individually | All apps online |
| `validate.nginx-restore` | Start/restart NGINX Proxy Manager container | HTTP 200 on NPM admin port |
| `validate.db-restore` | For PostgreSQL: psql restore from dump | No errors |
| `validate.service-health` | HTTP health checks on configured service URLs | All return 2xx |
| `validate.report` | Generate and display final migration report | — |

### Compose startup order

Projects must start in order if they share networks or have dependencies:
1. Database-only stacks first
2. Backend stacks second
3. Frontend / proxy stacks last
4. NGINX Proxy Manager last of all

### Health check approach

```
For each service:
  1. Check container status: docker inspect --format '{{.State.Health.Status}}'
  2. If no HEALTHCHECK defined: check port is open (nc -z host port)
  3. If HTTP endpoint configured: GET request, expect 2xx
  4. Timeout: 60s per service, 5s between polls
```

### Final report contents

- Migration start/end time and total duration
- Source and destination host info
- List of all transferred resources with sizes
- List of all services and their health status (pass/fail)
- Any warnings or skipped steps
- Checkpoint file location (for debugging)

---

## 10. CLI Command Structure

```
vortex-shift [options] <command>

Commands:
  source        Run migration from this server (source mode)
  destination   Prepare this server to receive migration (destination mode)
  status        Show current checkpoint state and progress
  reset         Clear checkpoint file (start fresh)

Options:
  --config <path>      Path to config file (default: ./vortex-shift.json)
  --log-file <path>    Path to log file (default: ./vortex-shift.log)
  --dry-run            Plan only, no transfers or changes
  --verbose            Extra debug output
  --yes                Skip confirmation prompts

source options:
  --dest-host <host>   Destination server IP or hostname (required)
  --dest-user <user>   SSH user on destination (default: root)
  --dest-port <port>   SSH port on destination (default: 22)
  --retries <n>        Retry attempts per step (default: 3)
  --resume             Force resume from checkpoint (auto-detected by default)

destination options:
  --port <port>        Port to listen for source coordination (if using active mode)
```

---

## 11. Checkpoint & Resume System

**File:** `src/core/checkpoint.ts`

### Checkpoint file location

```
~/.vortex-shift/checkpoint.json
```

### Checkpoint file schema

```json
{
  "version": 1,
  "startedAt": "2025-01-15T10:00:00Z",
  "lastUpdatedAt": "2025-01-15T10:45:23Z",
  "mode": "source",
  "destHost": "192.168.1.100",
  "phase": 3,
  "completedSteps": [
    "detect.os",
    "detect.docker",
    "detect.pm2",
    "detect.node",
    "detect.rsync",
    "detect.ssh-keys",
    "detect.ssh-test",
    "detect.disk-space",
    "inventory.docker-projects",
    "inventory.docker-volumes",
    "inventory.pm2-apps",
    "inventory.db-containers",
    "inventory.nginx",
    "inventory.save-manifest",
    "transfer.db-dumps",
    "transfer.docker-volumes"
  ],
  "failedStep": "transfer.docker-projects",
  "error": "rsync: connection unexpectedly closed"
}
```

### Resume logic

On startup, if a checkpoint file exists:
1. Display checkpoint state to user (what completed, what failed, when)
2. Ask: "Resume from `transfer.docker-projects`? [Y/n]"
3. If yes: skip all `completedSteps`, start from `failedStep`
4. If no: prompt to reset or exit

### StepRunner implementation

```typescript
async function runStep(step: Step, ctx: MigrationContext): Promise<void> {
  if (ctx.checkpoint.completedSteps.includes(step.id)) {
    log.info(`Skipping (already done): ${step.name}`)
    return
  }

  log.info(`Starting: ${step.name}`)
  await pRetry(() => step.run(ctx), {
    retries: step.retries ?? ctx.config.retries,
    onFailedAttempt: (err) => {
      log.warn(`Attempt ${err.attemptNumber} failed: ${err.message}`)
    }
  })

  ctx.checkpoint.completedSteps.push(step.id)
  await saveCheckpoint(ctx.checkpoint)
  log.success(`Done: ${step.name}`)
}
```

---

## 12. Logging & Progress Display

**File:** `src/core/logger.ts`

### Dual output

- **Terminal:** Human-readable, colored, with spinners and progress bars. Uses `ora` + `chalk`.
- **Log file:** Structured JSON lines via `winston`. Every terminal message also written to file with timestamp.

### Log levels

| Level | Terminal | File |
|---|---|---|
| `info` | White text | ✓ |
| `success` | Green ✓ prefix | ✓ |
| `warn` | Yellow ⚠ prefix | ✓ |
| `error` | Red ✗ prefix + actionable guidance | ✓ |
| `debug` | (only with --verbose) | ✓ always |

### Progress display during transfer

```
Transferring Docker volumes...
  [████████████░░░░░░░░] 62%  /var/lib/docker/volumes/app_pgdata  4.2 GB / 6.8 GB  12.3 MB/s  ETA 3m 21s
  [████░░░░░░░░░░░░░░░░] 18%  /var/lib/docker/volumes/app_redis   0.3 GB / 1.6 GB   8.1 MB/s  ETA 2m 44s
```

---

## 13. SSH Management

**File:** `src/core/ssh.ts`

### Responsibilities
- Detect existing SSH key pair (`~/.ssh/id_ed25519`, `~/.ssh/id_rsa`)
- Generate new key if none found
- Test connectivity before proceeding
- Execute remote commands on destination
- Open SSH tunnels if needed

### Implementation using `node-ssh`

```typescript
class SSHClient {
  async connect(config: SSHConfig): Promise<void>
  async exec(command: string): Promise<ExecResult>
  async execStream(command: string, onData: (chunk: string) => void): Promise<void>
  async putFile(local: string, remote: string): Promise<void>
  async disconnect(): Promise<void>
}
```

### Key detection order

```
1. ~/.ssh/id_ed25519
2. ~/.ssh/id_rsa
3. ~/.ssh/id_ecdsa
4. Config-specified path
5. None found → trigger auto-setup
```

---

## 14. Error Handling Strategy

### Principles
- Every error surfaces an **actionable message** — not just what failed but what to do
- SSH errors include the exact command that can be run manually to test
- rsync errors include the source path that failed (for manual inspection)
- All errors are written to the log file with full stack trace

### Error categories and responses

| Category | User message pattern |
|---|---|
| SSH connection failed | "Cannot reach destination at {host}:{port}. Check: firewall rules, sshd running, correct IP. Test manually: `ssh {user}@{host} -p {port}`" |
| Disk space insufficient | "Destination has {X}GB free but migration needs ~{Y}GB. Free up space or expand volume first." |
| Docker not running | "Docker daemon not running on {host}. Run: `systemctl start docker`" |
| rsync partial failure | "Transfer interrupted at {file}. Run `vortex-shift source --resume` to continue from this point." |
| Checksum mismatch | "File integrity check failed for {path}. The file may be corrupted. Retry transfer with `--resume`." |
| Permission denied | "Permission denied accessing {path}. Run as root or add {user} to the docker group." |

---

## 15. Configuration Schema

**File:** `src/types/config.ts`

Optional config file (`vortex-shift.json`) for repeatable runs:

```json
{
  "dest": {
    "host": "192.168.1.100",
    "user": "root",
    "port": 22,
    "sshKeyPath": "~/.ssh/id_ed25519"
  },
  "transfer": {
    "retries": 3,
    "concurrency": 2,
    "rsyncExtraArgs": [],
    "excludePaths": ["/home/user/temp"]
  },
  "dockerComposeSearchPaths": ["/opt", "/home", "/srv"],
  "pm2EcosystemPath": "~/.pm2/dump.pm2",
  "nginxProxyManagerDataPath": "/opt/nginx-proxy-manager",
  "dumpDir": "/tmp/vortex-shift-dumps",
  "checkpointDir": "~/.vortex-shift",
  "logFile": "./vortex-shift.log",
  "healthChecks": [
    { "name": "My App", "url": "http://localhost:3000/health", "timeout": 30 }
  ]
}
```

Validated at startup via Zod schema.

---

## 16. File-by-File Implementation Order

Implement in this sequence to build on stable foundations:

### Batch 1 — Scaffolding
1. `package.json` + `tsconfig.json` + `.eslintrc.json`
2. `src/types/` — all type definitions (no logic)
3. `config/defaults.ts` — constants
4. `src/utils/shell.ts` — execa wrapper
5. `src/utils/fs.ts` — fs-extra helpers
6. `src/utils/format.ts` — formatting utilities

### Batch 2 — Core Infrastructure
7. `src/core/logger.ts` — dual logger
8. `src/core/checkpoint.ts` — checkpoint read/write/resume
9. `src/core/executor.ts` — StepRunner with retry
10. `src/core/ssh.ts` — SSH client wrapper
11. `src/core/rsync.ts` — rsync wrapper with progress

### Batch 3 — Phase 1
12. `src/phases/phase1-detect.ts` — all detection steps

### Batch 4 — Phase 2 (Inventory)
13. `src/inventory/docker.ts`
14. `src/inventory/volumes.ts`
15. `src/inventory/pm2.ts`
16. `src/inventory/databases.ts`
17. `src/inventory/nginx.ts`
18. `src/phases/phase2-inventory.ts` — orchestrates above

### Batch 5 — Phase 3 (Transfer)
19. `src/transfer/db-dumps.ts`
20. `src/transfer/volumes.ts`
21. `src/transfer/docker-projects.ts` (implicit in phase3 or split file)
22. `src/transfer/pm2-apps.ts`
23. `src/transfer/nginx-data.ts`
24. `src/phases/phase3-transfer.ts` — orchestrates above

### Batch 6 — Phase 4 (Validation)
25. `src/validation/checksums.ts`
26. `src/validation/health.ts`
27. `src/validation/services.ts`
28. `src/core/reporter.ts`
29. `src/phases/phase4-validate.ts`

### Batch 7 — CLI Entry
30. `src/commands/source.ts`
31. `src/commands/destination.ts`
32. `src/commands/status.ts`
33. `src/commands/reset.ts`
34. `src/index.ts` — wire all commands

### Batch 8 — Polish
35. `src/utils/prompt.ts` — interactive confirmations
36. CLAUDE.md
37. README.md

---

## 17. Testing Strategy

### Unit tests (vitest)
- `checkpoint.ts` — read/write/resume logic with mocked fs
- `executor.ts` — retry behavior, step skipping
- `format.ts` — size/duration formatting
- `ssh.ts` — key detection logic (not the actual SSH, mock node-ssh)
- `phase2-inventory.ts` — manifest shape validation with mocked shell output

### Integration tests
- Spin up two Docker containers (Rocky Linux) as source/dest
- Run full migration of a simple compose project
- Verify services start on destination

### Test commands
```bash
npm test              # run all unit tests
npm test -- --watch   # watch mode
npm test -- path/to/file.test.ts  # single file
```

---

*Last updated: 2025-05-06*
*Status: Pre-implementation — scaffold not yet started*
