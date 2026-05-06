# Vortex Shift — Tasks

> Comprehensive task and subtask list. Check off items as completed.
> Status: `[ ]` not started · `[~]` in progress · `[x]` done · `[!]` blocked

---

## Table of Contents

- [Batch 1 — Project Scaffolding](#batch-1--project-scaffolding)
- [Batch 2 — Core Infrastructure](#batch-2--core-infrastructure)
- [Batch 3 — Phase 1: Environment Detection](#batch-3--phase-1-environment-detection)
- [Batch 4 — Phase 2: Pre-Migration Inventory](#batch-4--phase-2-pre-migration-inventory)
- [Batch 5 — Phase 3: Data Transfer](#batch-5--phase-3-data-transfer)
- [Batch 6 — Phase 4: Post-Migration Validation](#batch-6--phase-4-post-migration-validation)
- [Batch 7 — CLI Entry & Commands](#batch-7--cli-entry--commands)
- [Batch 8 — Polish & Docs](#batch-8--polish--docs)
- [Batch 9 — Testing](#batch-9--testing)
- [Batch 10 — Release](#batch-10--release) _(binary packaging, install.sh, CI)_

---

## Batch 1 — Project Scaffolding

### 1.1 `package.json`
- [x] Initialize with `npm init`
- [x] Set `name: "vortex-shift"`, `version: "0.1.0"`, `bin: { "vortex-shift": "./dist/index.js" }`
- [x] Add all runtime dependencies (commander, execa, ora, chalk, cli-progress, inquirer, winston, node-ssh, fs-extra, p-retry, p-limit, zod, date-fns)
- [x] Add all dev dependencies (typescript, tsx, @types/node, vitest, eslint, @typescript-eslint/eslint-plugin, @typescript-eslint/parser, prettier, pkg)
- [x] Add npm scripts: `build`, `dev`, `start`, `test`, `test:watch`, `lint`, `format`, `typecheck`, `package`

### 1.2 `tsconfig.json`
- [x] Target `ES2022`, module `NodeNext`
- [x] Enable `strict`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`
- [x] Set `outDir: "dist"`, `rootDir: "src"`
- [x] Enable `declaration`, `declarationMap`, `sourceMap`
- [x] Exclude `node_modules`, `dist`, `**/*.test.ts`

### 1.3 `.eslintrc.json`
- [x] Extend `@typescript-eslint/recommended`
- [x] Enable `@typescript-eslint/no-floating-promises` rule
- [x] Enable `@typescript-eslint/no-explicit-any` rule
- [x] Set `no-console: error` (force all output through logger)

### 1.4 `.prettierrc`
- [x] Set `singleQuote: true`, `semi: false`, `printWidth: 100`, `trailingComma: "es5"`

### 1.5 `.gitignore`
- [x] Ignore `dist/`, `node_modules/`, `*.log`, `vortex-shift.json` (user config), `~/.vortex-shift/` reference

### 1.6 `src/types/config.ts`
- [x] Define `SSHConfig` interface (host, user, port, sshKeyPath)
- [x] Define `TransferConfig` interface (retries, concurrency, rsyncExtraArgs, excludePaths)
- [x] Define `HealthCheckConfig` interface (name, url, timeout)
- [x] Define `MigrationConfig` interface — top-level config shape
- [x] Define `CLIOptions` interface — parsed Commander options
- [x] Build Zod schema for `MigrationConfig` (used for config file validation)

### 1.7 `src/types/manifest.ts`
- [x] Define `DockerProject` interface (name, dir, composeFile, services, hasDatabase)
- [x] Define `DockerVolume` interface (name, driver, mountpoint, size, linkedProject?)
- [x] Define `PM2App` interface (name, script, cwd, pm2Id, status, ecosystemEntry)
- [x] Define `DatabaseContainer` interface (containerName, engine, image, volumes, dumpFile?)
- [x] Define `NginxSnapshot` interface (dataPath, version, proxyHostCount)
- [x] Define `Manifest` interface — assembles all above

### 1.8 `src/types/checkpoint.ts`
- [x] Define `CheckpointState` interface (version, mode, destHost, phase, completedSteps, failedStep, error, startedAt, lastUpdatedAt)
- [x] Define `StepStatus` type union: `'pending' | 'running' | 'done' | 'failed' | 'skipped'`

### 1.9 `src/types/report.ts`
- [x] Define `ServiceResult` interface (name, type, status, healthCheck, error?)
- [x] Define `TransferResult` interface (resource, bytesTransferred, duration, checksumVerified)
- [x] Define `MigrationReport` interface — full final report shape

### 1.10 `src/types/context.ts`
- [x] Define `MigrationContext` interface (mode, config, ssh, manifest, checkpoint, log)

### 1.11 `config/defaults.ts`
- [x] Export `DEFAULT_RETRIES = 3`
- [x] Export `DEFAULT_SSH_PORT = 22`
- [x] Export `DEFAULT_SSH_USER = 'root'`
- [x] Export `DEFAULT_DUMP_DIR = '/tmp/vortex-shift-dumps'`
- [x] Export `DEFAULT_CHECKPOINT_DIR = '~/.vortex-shift'`
- [x] Export `DEFAULT_LOG_FILE = './vortex-shift.log'`
- [x] Export `DEFAULT_NPM_DATA_PATH = '/opt/nginx-proxy-manager'`
- [x] Export `DEFAULT_PM2_DUMP_PATH = '~/.pm2/dump.pm2'`
- [x] Export `COMPOSE_SEARCH_PATHS = ['/opt', '/home', '/srv', '/root']`
- [x] Export `HEALTH_CHECK_TIMEOUT_MS = 60_000`
- [x] Export `HEALTH_CHECK_POLL_INTERVAL_MS = 5_000`
- [x] Export `RSYNC_BASE_ARGS` array

---

## Batch 2 — Core Infrastructure

### 2.1 `src/utils/shell.ts`
- [x] Wrap `execa` with a typed `run(cmd, args, opts)` function
- [x] Return `{ stdout, stderr, exitCode }` typed result
- [x] Implement `runStream(cmd, args, onData, opts)` for streaming output
- [x] Strip ANSI codes from captured output
- [x] Throw typed `ShellError` on non-zero exit with stdout/stderr attached

### 2.2 `src/utils/fs.ts`
- [x] `readJson<T>(path)` — typed JSON read with Zod validation parameter
- [x] `writeJson(path, data)` — atomic write (write to `.tmp` then rename)
- [x] `ensureDir(path)` — create directory if missing
- [x] `fileExists(path)` — boolean check
- [x] `expandHome(path)` — replace `~` with `os.homedir()`
- [x] `getSize(path)` — recursive directory size in bytes

### 2.3 `src/utils/format.ts`
- [x] `formatBytes(n)` — e.g. `4.2 GB`, `320 MB`
- [x] `formatDuration(ms)` — e.g. `3m 21s`, `45s`
- [x] `formatDate(iso)` — e.g. `2025-05-06 14:32:01`
- [x] `formatTable(rows, columns)` — aligned text table for terminal output
- [x] `formatList(items)` — bulleted list string

### 2.4 `src/utils/prompt.ts`
- [x] `confirm(message, defaultYes?)` — yes/no prompt via inquirer
- [x] `input(message, defaultValue?)` — text input prompt
- [x] `select(message, choices)` — selection list prompt
- [x] `pause(message)` — "press Enter to continue" prompt

### 2.5 `src/core/logger.ts`
- [x] Initialize `winston` file logger (JSON lines, all levels)
- [x] Implement `Logger` class with methods: `info`, `success`, `warn`, `error`, `debug`
- [x] Terminal output: `chalk` colored, prefixed with level icon
- [x] File output: structured JSON with timestamp, level, message, optional `data` field
- [x] `--verbose` flag enables debug level to terminal
- [x] Spinner integration: `startSpinner(label)`, `stopSpinner(success?)` via `ora`
- [x] Export singleton `log` instance created after CLI args parsed

### 2.6 `src/core/checkpoint.ts`
- [x] `loadCheckpoint(dir)` — read checkpoint file, return null if not found
- [x] `saveCheckpoint(dir, state)` — atomic write checkpoint JSON
- [x] `clearCheckpoint(dir)` — delete checkpoint file
- [x] `markStepComplete(state, stepId)` — mutate + return updated state
- [x] `markStepFailed(state, stepId, error)` — mutate + return updated state
- [x] `isStepDone(state, stepId)` — boolean check used by StepRunner
- [x] `displayCheckpointSummary(state, log)` — print resume banner to terminal

### 2.7 `src/core/executor.ts`
- [x] Define `Step` interface (id, name, run, retries?)
- [x] Implement `StepRunner` class
  - [x] Constructor takes `MigrationContext`
  - [x] `run(steps: Step[])` — executes steps sequentially
  - [x] Skip steps already in `checkpoint.completedSteps`
  - [x] Wrap each step with `p-retry` using config retries + exponential backoff
  - [x] Log attempt count on each retry
  - [x] Save checkpoint after each step completes
  - [x] Throw `MigrationError` (with step ID) on final failure after all retries
- [x] Define `MigrationError` class (extends Error, has `stepId`, `phase`, `cause`)

### 2.8 `src/core/ssh.ts`
- [x] `detectSSHKey()` — search id_ed25519, id_rsa, id_ecdsa; return path or null
- [x] `generateSSHKey()` — run `ssh-keygen -t ed25519`, return public key string
- [x] `displayPublicKey(pubKey)` — print formatted banner with copy instructions
- [x] `SSHClient` class wrapping `node-ssh`:
  - [x] `connect(config: SSHConfig)` — establish connection
  - [x] `exec(command)` — run remote command, return `{ stdout, stderr, code }`
  - [x] `execStream(command, onData)` — stream remote command output
  - [x] `putFile(localPath, remotePath)` — SFTP upload single file
  - [x] `getFile(remotePath, localPath)` — SFTP download single file
  - [x] `disconnect()` — close connection
  - [x] All methods throw typed `SSHError` on failure

### 2.9 `src/core/rsync.ts`
- [x] `RsyncTransfer` class:
  - [x] Constructor: source path, dest host+user+port+path, SSH key path
  - [x] `run(onProgress?)` — execute rsync, return transfer stats
  - [x] Parse rsync output: extract current file, bytes, speed, ETA
  - [x] Emit progress events via callback `(progress: RsyncProgress) => void`
  - [x] Build command with base flags + `--partial --progress --checksum --delete`
  - [x] Accept extra args from config (`rsyncExtraArgs`)
  - [x] Return `RsyncResult` (bytesTransferred, duration, filesTransferred, errors)
- [x] Define `RsyncProgress` interface (file, bytesDone, bytesTotal, speedMBps, etaSeconds)
- [x] Define `RsyncResult` interface

---

## Batch 3 — Phase 1: Environment Detection

### 3.1 `src/phases/phase1-detect.ts` — Step: `detect.os`
- [x] Read `/etc/os-release`
- [x] Assert `ID=rocky` or `ID_LIKE` contains `rhel`
- [x] Log Rocky Linux version
- [x] Throw with actionable message if not Rocky Linux

### 3.2 Phase 1 — Step: `detect.docker`
- [x] Run `docker --version` and parse version string
- [x] Run `docker compose version` (V2 plugin required, not `docker-compose`)
- [x] Log both versions
- [x] Fail clearly if Docker daemon is not running (check `docker info`)

### 3.3 Phase 1 — Step: `detect.pm2`
- [x] Run `pm2 --version`
- [x] Warn if not found (don't fail — no PM2 apps is valid)
- [x] Log version if found

### 3.4 Phase 1 — Step: `detect.node`
- [x] Run `node --version`
- [x] Log version
- [x] Warn if below Node 18

### 3.5 Phase 1 — Step: `detect.rsync`
- [x] Run `rsync --version`
- [x] Fail with install instructions if missing (`dnf install rsync`)

### 3.6 Phase 1 — Step: `detect.ssh-keys`
- [x] Call `detectSSHKey()` from `src/core/ssh.ts`
- [x] Store key path in context for subsequent steps
- [x] If found: log path and skip `detect.ssh-setup`
- [x] If not found: set flag to trigger `detect.ssh-setup`

### 3.7 Phase 1 — Step: `detect.ssh-setup`
- [x] Skip if key already found in `detect.ssh-keys`
- [x] Generate new ed25519 key pair
- [x] Display public key with `displayPublicKey()`
- [x] Call `pause()` — wait for user to add key to destination
- [x] Log key path

### 3.8 Phase 1 — Step: `detect.ssh-test`
- [x] Attempt `ssh.connect()` using detected/generated key
- [x] Run `echo "vortex-ok"` on remote to verify exec works
- [x] On failure: print exactly the manual SSH command to test + check firewall/sshd tips
- [x] Retry up to 3 times with 10s delay between attempts

### 3.9 Phase 1 — Step: `detect.disk-space`
- [x] Estimate transfer size: sum of all Docker volume mountpoints + project dirs + dump dir
- [x] SSH to destination: run `df -B1 <target-path>` to get available bytes
- [x] Warn if headroom < 20% after estimated transfer
- [x] Fail if headroom < 5% (will almost certainly run out)
- [x] Log both source size estimate and destination free space

### 3.10 Phase 1 — orchestration
- [x] Define step array in correct order
- [x] Export `runPhase1(ctx: MigrationContext)` function
- [x] Pass steps to `StepRunner.run()`

---

## Batch 4 — Phase 2: Pre-Migration Inventory

### 4.1 `src/inventory/docker.ts`
- [x] `discoverComposeProjects(searchPaths)` — find all `docker-compose.yml` / `compose.yaml`
  - [x] Use `find` with excluded paths (`/proc`, `/sys`, `/dev`, `/run`)
  - [x] Parse each compose file (YAML) to extract service names
  - [x] Identify which services use known DB images
  - [x] Resolve project name (from compose label or directory name)
  - [x] Return `DockerProject[]`
- [x] `getRunningContainers()` — `docker ps --format json` parsed list
- [x] `getContainerDetails(name)` — `docker inspect` parsed output

### 4.2 `src/inventory/volumes.ts`
- [x] `discoverExternalVolumes()` — `docker volume ls` + filter to named volumes
  - [x] `docker volume inspect` each volume for Mountpoint and Labels
  - [x] Determine if volume is inside or outside a project dir
  - [x] Estimate size via `du -sb <mountpoint>`
  - [x] Return `DockerVolume[]`

### 4.3 `src/inventory/pm2.ts`
- [x] `discoverPM2Apps()` — `pm2 jlist` parse JSON
  - [x] Extract name, script, cwd, pm2_env, status
  - [x] Warn if pm2 not installed (return empty array)
  - [x] Run `pm2 save` to ensure dump.pm2 is current
  - [x] Return `PM2App[]`

### 4.4 `src/inventory/databases.ts`
- [x] `identifyDatabaseContainers(containers)` — filter by known DB images
  - [x] Detect engine: postgres, mysql, mariadb, redis, mongo, elasticsearch
  - [x] Extract env vars for credentials (POSTGRES_USER, MYSQL_ROOT_PASSWORD, etc.)
  - [x] Map to linked Docker volume
  - [x] Return `DatabaseContainer[]`
- [x] `planDumps(dbContainers)` — generate dump command + output filename per DB

### 4.5 `src/inventory/nginx.ts`
- [x] `snapshotNginxProxyManager(dataPath)` — inspect NPM installation
  - [x] Check if NPM container is running (`nginx-proxy-manager` or similar image)
  - [x] Identify data directory (default: `/opt/nginx-proxy-manager/data`)
  - [x] Count proxy host configs (`ls data/nginx/proxy_host/`)
  - [x] Return `NginxSnapshot`

### 4.6 `src/phases/phase2-inventory.ts`
- [x] Step `inventory.docker-projects`: call `discoverComposeProjects()`
- [x] Step `inventory.docker-volumes`: call `discoverExternalVolumes()`
- [x] Step `inventory.pm2-apps`: call `discoverPM2Apps()`
- [x] Step `inventory.db-containers`: call `identifyDatabaseContainers()`
- [x] Step `inventory.nginx`: call `snapshotNginxProxyManager()`
- [x] Step `inventory.save-manifest`: assemble and write `manifest.json` to checkpoint dir
- [x] Step `inventory.display-summary`: print formatted table of all discovered resources
  - [x] Show: N Docker projects, N external volumes, N PM2 apps, N DB containers, NPM status
  - [x] Show total estimated transfer size
  - [x] Show any warnings (e.g. volumes without linked projects)
- [x] Prompt user to confirm before proceeding to transfer
- [x] Export `runPhase2(ctx: MigrationContext)` function

---

## Batch 5 — Phase 3: Data Transfer

### 5.1 `src/transfer/db-dumps.ts`
- [x] `dumpPostgres(container, destDir)` — `docker exec <c> pg_dumpall -U postgres > dump.sql`
- [x] `dumpMySQL(container, destDir)` — `docker exec <c> mysqldump --all-databases ...`
- [x] `dumpRedis(container, destDir)` — trigger BGSAVE, wait for completion, copy `dump.rdb`
- [x] `dumpMongo(container, destDir)` — `docker exec <c> mongodump --archive --gzip`
- [x] `dumpAll(dbContainers, destDir)` — dispatch to correct engine, run in parallel with `p-limit(2)`
- [x] Set dump file path on each `DatabaseContainer` in manifest (mutate for later restore step)

### 5.2 `src/transfer/volumes.ts`
- [x] `transferVolume(volume, ssh, config)` — rsync volume Mountpoint to destination
  - [x] Construct remote path: same Mountpoint on destination (or configurable)
  - [x] Create remote directory via SSH before rsync
  - [x] Run `RsyncTransfer` with progress callback
  - [x] Return `TransferResult`
- [x] `transferAllVolumes(volumes, ssh, config, onProgress)` — sequential transfer with progress

### 5.3 `src/transfer/pm2-apps.ts`
- [x] `transferPM2Apps(apps, ssh, config)` — rsync each app's `cwd` to destination
- [x] `transferPM2Ecosystem(dumpPath, ssh, config)` — copy `dump.pm2` file via SFTP
- [x] Ensure destination directories exist before rsync

### 5.4 `src/transfer/nginx-data.ts`
- [x] `transferNginxData(snapshot, ssh, config)` — rsync full NPM data directory
- [x] Preserve permissions (`-a` flag covers this)
- [x] Ensure destination NPM data path exists

### 5.5 `src/phases/phase3-transfer.ts`
- [x] Step `transfer.db-dumps`: dump all DBs to `DEFAULT_DUMP_DIR` on source
- [x] Step `transfer.docker-volumes`: transfer each external volume via rsync
- [x] Step `transfer.docker-projects`: rsync each compose project directory
- [x] Step `transfer.db-dump-files`: rsync dump files from source `DEFAULT_DUMP_DIR` to destination
- [x] Step `transfer.pm2-apps`: rsync PM2 app directories
- [x] Step `transfer.pm2-ecosystem`: copy PM2 dump file
- [x] Step `transfer.nginx-data`: rsync NPM data directory
- [x] Step `transfer.manifest`: copy `manifest.json` to destination checkpoint dir
- [x] Show aggregate progress bar across all transfers (total bytes)
- [x] Log transfer stats per resource after each step completes
- [x] Export `runPhase3(ctx: MigrationContext)` function

---

## Batch 6 — Phase 4: Post-Migration Validation

### 6.1 `src/validation/checksums.ts`
- [ ] `checksumFile(path)` — sha256 of a file
- [ ] `checksumDir(path)` — recursive sha256 tree (using `find | sha256sum`)
- [ ] `buildChecksumManifest(paths)` — generate checksum map on source
- [ ] `verifyChecksums(manifest, paths)` — compare against destination
- [ ] Write checksum manifest to checkpoint dir after Phase 3
- [ ] Read and compare on destination in Phase 4

### 6.2 `src/validation/health.ts`
- [ ] `waitForPort(host, port, timeoutMs)` — poll TCP open with `net.createConnection`
- [ ] `httpGet(url, timeoutMs)` — HTTP GET, return status code
- [ ] `waitForHttp(url, expectedStatus, timeoutMs, pollInterval)` — poll until success
- [ ] `waitForDockerHealthy(containerName, timeoutMs)` — poll `docker inspect` health status
- [ ] `checkContainerRunning(containerName)` — boolean check

### 6.3 `src/validation/services.ts`
- [ ] `startComposeProjects(projects)` — `docker compose up -d` in dependency order
  - [ ] Start DB-only stacks first
  - [ ] Wait for DB containers healthy before starting dependent stacks
  - [ ] Start remaining stacks
  - [ ] Return `ServiceResult[]`
- [ ] `startPM2Apps(apps)` — `pm2 resurrect` then verify each app is online
  - [ ] Fall back to `pm2 start ecosystem.config.js` if resurrect fails
  - [ ] Return `ServiceResult[]`
- [ ] `startNginxProxyManager(snapshot)` — `docker compose up -d` in NPM dir
  - [ ] Wait for NPM admin port (81) to respond
  - [ ] Return `ServiceResult`
- [ ] `restoreDatabases(dbContainers)` — restore DB dumps on destination
  - [ ] For Postgres: `psql < dump.sql` inside container
  - [ ] For MySQL: `mysql < dump.sql` inside container
  - [ ] For Redis: copy `dump.rdb` into volume and restart container
  - [ ] For Mongo: `mongorestore --archive --gzip`

### 6.4 `src/core/reporter.ts`
- [ ] `buildReport(ctx, serviceResults, transferResults)` — assemble `MigrationReport`
- [ ] `printReport(report, log)` — formatted terminal output
  - [ ] Header: source → destination, start/end time, total duration
  - [ ] Section: Transferred Resources (table with name, size, duration, checksum)
  - [ ] Section: Services (table with name, type, status ✓/✗, health check result)
  - [ ] Section: Warnings (if any)
  - [ ] Section: Next Steps (manual tasks if any services failed)
- [ ] `saveReport(report, path)` — write JSON report to file

### 6.5 `src/phases/phase4-validate.ts`
- [ ] Step `validate.checksums`: verify all transferred files via checksum comparison
- [ ] Step `validate.docker-volumes`: check all volume mountpoints exist and non-empty on dest
- [ ] Step `validate.db-restore`: restore all DB dumps inside destination containers
- [ ] Step `validate.compose-up`: start all Docker Compose projects in order
- [ ] Step `validate.compose-health`: wait for all containers to become healthy
- [ ] Step `validate.pm2-restore`: resurrect PM2 apps, verify status
- [ ] Step `validate.nginx-restore`: start NPM, wait for admin port
- [ ] Step `validate.service-health`: run configured HTTP health checks
- [ ] Step `validate.report`: generate and display final report, save to file
- [ ] Export `runPhase4(ctx: MigrationContext)` function

---

## Batch 7 — CLI Entry & Commands

### 7.1 `src/commands/source.ts`
- [ ] Define `source` command with Commander
- [ ] Required option: `--dest-host`
- [ ] Optional options: `--dest-user`, `--dest-port`, `--retries`, `--resume`, `--dry-run`, `--yes`, `--verbose`
- [ ] Load config file if `--config` path provided (Zod validate)
- [ ] Merge config file with CLI options (CLI takes precedence)
- [ ] Build `MigrationContext`
- [ ] Check for existing checkpoint — prompt to resume or reset
- [ ] Run Phase 1 → Phase 2 → Phase 3 → trigger Phase 4 on destination
- [ ] Handle `MigrationError` — print error, point to log file, suggest `--resume`

### 7.2 `src/commands/destination.ts`
- [ ] Define `destination` command with Commander
- [ ] Options: `--port` (coordination port, if using active mode)
- [ ] Run Phase 1 (environment check on destination)
- [ ] Wait for manifest from source (poll checkpoint dir or listen on port)
- [ ] Run Phase 4 when triggered

### 7.3 `src/commands/status.ts`
- [ ] Read checkpoint file
- [ ] If none found: print "No migration in progress"
- [ ] If found: print full checkpoint summary
  - [ ] Started at, last updated
  - [ ] Current phase
  - [ ] Completed steps (count + list)
  - [ ] Failed step (if any) + error message
  - [ ] Estimated completion (rough, based on steps done vs total)

### 7.4 `src/commands/reset.ts`
- [ ] Read checkpoint file — show summary of what will be cleared
- [ ] Confirm with user: "This will clear all progress. Are you sure?"
- [ ] Delete checkpoint file
- [ ] Optionally: delete dump files in `DEFAULT_DUMP_DIR`
- [ ] Print confirmation

### 7.5 `src/index.ts`
- [ ] Create Commander `program` with name, description, version
- [ ] Register global options: `--config`, `--log-file`, `--verbose`, `--yes`, `--dry-run`
- [ ] Register all subcommands: `source`, `destination`, `status`, `reset`
- [ ] Initialize logger before any command runs (use `preSubcommand` hook)
- [ ] Add top-level error handler: catch uncaught errors, log to file, print clean message
- [ ] Set `process.exitCode` appropriately on failure
- [ ] Call `program.parse(process.argv)`

---

## Batch 8 — Polish & Docs

### 8.1 Dry-run mode
- [ ] Pass `isDryRun` flag through `MigrationContext`
- [ ] In `StepRunner.run()`: if dry-run, log what would happen and skip `step.run()`
- [ ] In `rsync.ts`: print rsync command without executing
- [ ] In `ssh.ts`: print remote commands without executing
- [ ] Output dry-run summary: list all steps that would execute

### 8.2 Interrupt handling
- [ ] Catch `SIGINT` and `SIGTERM`
- [ ] On interrupt: save checkpoint, close SSH connection, print resume instructions
- [ ] Do not leave partial rsync transfers without noting them in checkpoint

### 8.3 Config file generation
- [ ] `vortex-shift init` command (or `--save-config` flag) — write `vortex-shift.json` with current options
- [ ] Useful for repeatable or scheduled migrations

### 8.4 `CLAUDE.md`
- [ ] Document build/lint/test commands
- [ ] Document architecture (phases, core abstractions)
- [ ] Document how `StepRunner` and `MigrationContext` work
- [ ] Document checkpoint file location and schema
- [ ] Document how to add a new phase step

### 8.5 `README.md`
- [ ] Installation section (npm install -g / npx / binary)
- [ ] Prerequisites section (Rocky Linux, Docker, rsync)
- [ ] Quick start section (source + destination commands)
- [ ] Configuration section (vortex-shift.json reference)
- [ ] How it works section (phases overview)
- [ ] Troubleshooting section (common errors + fixes)

### 8.6 Error message audit
- [ ] Review every thrown error — ensure message includes "what happened", "why", "what to do"
- [ ] Add SSH manual test command to all SSH errors
- [ ] Add rsync resume hint to all transfer errors
- [ ] Add `vortex-shift status` hint on any mid-migration failure

---

## Batch 9 — Testing

### 9.1 Unit tests — `src/core/checkpoint.test.ts`
- [ ] `loadCheckpoint` returns null when file missing
- [ ] `loadCheckpoint` parses valid checkpoint correctly
- [ ] `saveCheckpoint` writes atomically (check temp file renamed)
- [ ] `markStepComplete` adds step ID to completedSteps
- [ ] `markStepFailed` sets failedStep and error
- [ ] `isStepDone` returns true for completed, false for pending
- [ ] `clearCheckpoint` removes file

### 9.2 Unit tests — `src/core/executor.test.ts`
- [ ] Steps already in completedSteps are skipped
- [ ] Successful step is added to completedSteps
- [ ] Failed step is retried N times before throwing
- [ ] `MigrationError` includes correct stepId
- [ ] Checkpoint is saved after each completed step
- [ ] Context is not mutated on skipped step

### 9.3 Unit tests — `src/utils/format.test.ts`
- [ ] `formatBytes` — 0, bytes, KB, MB, GB ranges
- [ ] `formatDuration` — seconds, minutes, hours
- [ ] `formatDate` — ISO input → readable output

### 9.4 Unit tests — `src/core/ssh.test.ts`
- [ ] `detectSSHKey` returns first found key in priority order
- [ ] `detectSSHKey` returns null when none found
- [ ] `SSHClient.exec` throws `SSHError` on non-zero exit

### 9.5 Unit tests — `src/core/rsync.test.ts`
- [ ] Progress parser extracts file, bytes, speed from rsync output line
- [ ] Constructs correct rsync command string
- [ ] Throws on non-zero rsync exit

### 9.6 Unit tests — `src/inventory/docker.test.ts`
- [ ] `discoverComposeProjects` parses compose YAML correctly
- [ ] Excludes `/proc`, `/sys`, `/dev` paths
- [ ] Identifies DB services from known image names

### 9.7 Unit tests — `src/types/config.ts` (Zod validation)
- [ ] Valid config passes validation
- [ ] Missing required field fails validation
- [ ] Invalid SSH port (string) fails validation

### 9.8 Integration tests — full migration flow
- [ ] Spin up two Rocky Linux Docker containers (source + destination)
- [ ] Install Docker-in-Docker on source
- [ ] Deploy a simple Compose project (nginx + postgres) on source
- [ ] Run `vortex-shift source` against destination container
- [ ] Assert Compose project is running on destination
- [ ] Assert health check passes

### 9.9 Integration tests — resume behavior
- [ ] Run migration, kill process mid-transfer
- [ ] Verify checkpoint file exists and has correct state
- [ ] Re-run with `--resume`
- [ ] Assert only remaining steps execute (completed steps skipped)

### 9.10 Integration tests — retry behavior
- [ ] Mock rsync to fail twice then succeed
- [ ] Assert transfer eventually completes
- [ ] Assert correct number of attempts logged

---

## Batch 10 — Release

### 10.1 Binary packaging
- [ ] Configure `pkg` to bundle into standalone binaries (linux-x64, linux-arm64)
- [ ] Add `npm run package` script
- [ ] Test standalone binary on clean Rocky Linux VM (no Node.js installed)

### 10.2 CI / GitHub Actions
- [ ] Lint and typecheck on every push
- [ ] Run unit tests on every push
- [ ] Build and verify `dist/` compiles cleanly
- [ ] Release workflow: tag → build binaries → attach to GitHub Release

### 10.3 Version management
- [ ] Implement `vortex-shift --version` (from package.json)
- [ ] Add checkpoint schema `version` field — handle migration if schema changes
- [ ] Changelog file (`CHANGELOG.md`)

### 10.4 `install.sh` — one-line remote installer
- [ ] Create `install.sh` at repo root
- [ ] Detect CPU architecture (`uname -m`) — map to `linux-x64` or `linux-arm64`
- [ ] Detect OS — warn and exit if not Linux
- [ ] Resolve latest release version from GitHub API (`https://api.github.com/repos/USER/vortex-shift/releases/latest`)
- [ ] Download correct binary from GitHub Releases with `curl -fsSL`
- [ ] Place binary at `/usr/local/bin/vortex-shift` and `chmod +x`
- [ ] Verify install: run `vortex-shift --version` after placement
- [ ] Print success message with quick-start command
- [ ] Handle missing `curl` gracefully (suggest `dnf install curl`)
- [ ] Add install script URL to README under "Installation"
- [ ] Test one-liner works on clean Rocky Linux VM:
  ```bash
  curl -fsSL https://raw.githubusercontent.com/USER/vortex-shift/main/install.sh | bash
  ```

### 10.5 CI — automate install script on release
- [ ] In GitHub Actions release workflow: after binaries are attached, update `install.sh` `VERSION` default if hardcoded
- [ ] Smoke-test `install.sh` in CI on Rocky Linux container as part of release job

### 10.6 Pre-release checklist
- [ ] All unit tests pass
- [ ] Integration test passes against fresh Rocky Linux containers
- [ ] Dry-run mode tested end-to-end
- [ ] Resume behavior tested (kill mid-transfer, restart)
- [ ] Error messages reviewed for clarity
- [ ] README complete and accurate
- [ ] Binary tested on clean VM
- [ ] `install.sh` one-liner tested on clean Rocky Linux VM

---

*Last updated: 2025-05-06*
*Total tasks: ~195 items across 10 batches*
