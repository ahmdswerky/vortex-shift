# Vortex Shift

CLI tool for full server migration between Rocky Linux hosts. Moves Docker Compose projects, volumes, PM2 apps, databases, and NGINX Proxy Manager from one server to another with automatic resume on failure.

---

## Table of Contents

- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Step-by-Step Migration Guide](#step-by-step-migration-guide)
  - [Step 1 — Prepare both servers](#step-1--prepare-both-servers)
  - [Step 2 — Install Vortex Shift on the source server](#step-2--install-vortex-shift-on-the-source-server)
  - [Step 3 — Generate a config file](#step-3--generate-a-config-file)
  - [Step 4 — Install Vortex Shift on the destination server](#step-4--install-vortex-shift-on-the-destination-server)
  - [Step 5 — Start the migration from the source server](#step-5--start-the-migration-from-the-source-server)
  - [Step 6 — Monitor progress](#step-6--monitor-progress)
  - [Step 7 — If something fails, resume](#step-7--if-something-fails-resume)
- [Configuration Reference](#configuration-reference)
- [All Commands](#all-commands)
- [How It Works](#how-it-works)
- [Troubleshooting](#troubleshooting)

---

## Prerequisites

Both the **source** and **destination** servers need:

| Requirement | Check command |
|---|---|
| Rocky Linux (or RHEL-compatible) | `cat /etc/os-release` |
| Docker Engine | `docker --version` |
| Docker Compose v2 | `docker compose version` |
| Node.js 18+ (if installing via npm) | `node --version` |

The **source** server also needs:

| Requirement | Install command |
|---|---|
| `rsync` | `dnf install rsync` |
| SSH key pair | auto-generated if missing |

The **destination** server needs:

| Requirement | Note |
|---|---|
| SSH access from source | port 22 open, or custom port |
| Same directory structure available | `/opt`, `/home`, `/srv`, etc. |

---

## Installation

### Option A — One-line binary install (recommended)

Run this on **each server** (source and destination):

```bash
curl -fsSL https://raw.githubusercontent.com/USER/vortex-shift/main/install.sh | bash
```

This downloads the correct binary for your architecture and places it at `/usr/local/bin/vortex-shift`.

Verify it works:

```bash
vortex-shift --version
```

### Option B — npm global install

```bash
npm install -g vortex-shift
```

### Option C — npx (no install)

```bash
npx vortex-shift <command>
```

---

## Step-by-Step Migration Guide

### Step 1 — Prepare both servers

On the **destination** server, make sure Docker is installed and running:

```bash
systemctl enable --now docker
docker info
```

On the **source** server, make sure rsync is installed:

```bash
dnf install rsync -y
rsync --version
```

---

### Step 2 — Install Vortex Shift on the source server

SSH into your **source** server and install:

```bash
curl -fsSL https://raw.githubusercontent.com/USER/vortex-shift/main/install.sh | bash
vortex-shift --version
```

---

### Step 3 — Generate a config file

On the **source** server, generate a starting config:

```bash
vortex-shift init --dest-host YOUR_DESTINATION_IP
```

This creates `vortex-shift.json` in the current directory. Open it and review the defaults:

```bash
cat vortex-shift.json
```

Key fields to check:

```json
{
  "destination": {
    "host": "YOUR_DESTINATION_IP",
    "user": "root",
    "port": 22,
    "sshKeyPath": "~/.ssh/id_ed25519"
  },
  "transfer": {
    "retries": 3
  },
  "healthChecks": [
    { "name": "My App", "url": "http://localhost:3000/health", "timeout": 60000 }
  ]
}
```

Add any HTTP health checks for services you want verified after migration. Leave the rest as defaults unless you have custom paths.

---

### Step 4 — Install Vortex Shift on the destination server

SSH into your **destination** server and install:

```bash
curl -fsSL https://raw.githubusercontent.com/USER/vortex-shift/main/install.sh | bash
vortex-shift --version
```

The destination server only needs the binary installed. Vortex Shift will manage it remotely from the source.

---

### Step 5 — Start the migration from the source server

Go back to your **source** server. Run the migration:

```bash
vortex-shift source --config ./vortex-shift.json
```

**If you have SSH hosts configured in `~/.ssh/config`**, Vortex Shift will show an interactive picker automatically — no flags needed:

```
? Select destination server:
  ❯ prod-server  →  1.2.3.4  (root)
    staging      →  5.6.7.8  (deploy):2222
    Enter host manually
```

Select a host and all connection details (`HostName`, `User`, `Port`, `IdentityFile`) are read from your SSH config automatically.

**To skip the picker and pass the host directly**, use `--dest-host`. You can pass either a real IP/hostname or an SSH config alias:

```bash
# pass an SSH config alias — resolves HostName, User, Port, IdentityFile automatically
vortex-shift source --dest-host prod-server

# or pass an IP directly
vortex-shift source --dest-host 1.2.3.4
```

CLI flags always override SSH config values:

```bash
# use SSH config alias but override the user
vortex-shift source --dest-host prod-server --dest-user deploy
```

**What happens next:**

1. Vortex Shift checks your source environment (OS, Docker, rsync, disk space).
2. If no SSH key is found, it generates one and shows you the public key to add to the destination.
3. It discovers all Docker Compose projects, volumes, PM2 apps, and databases.
4. Shows a summary and asks you to confirm before transferring.
5. Transfers everything via rsync over SSH.
6. Signals the destination server to restore services and run health checks.
7. Prints a final migration report.

**SSH key setup (if prompted):**

If you don't have an SSH key, the tool will show output like this:

```
================== SSH Public Key ==================
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIB... root@source
====================================================
Add this key to destination ~/.ssh/authorized_keys
```

On the **destination** server, run:

```bash
echo "PASTE_PUBLIC_KEY_HERE" >> ~/.ssh/authorized_keys
```

Then press Enter back on the source server to continue.

---

### Step 6 — Monitor progress

In another terminal on the source server, check the current status:

```bash
vortex-shift status
```

This shows which phase is running, which steps have completed, and any errors.

The log file has detailed output:

```bash
tail -f ./vortex-shift.log
```

---

### Step 7 — If something fails, resume

If the migration fails for any reason (network drop, disk space, SSH timeout), just re-run with `--resume`:

```bash
vortex-shift source --dest-host YOUR_DESTINATION_IP --resume
```

Vortex Shift picks up from the last successfully completed step. No data is transferred twice.

To start completely fresh instead:

```bash
vortex-shift reset
vortex-shift source --dest-host YOUR_DESTINATION_IP
```

---

## Configuration Reference

Full `vortex-shift.json` shape with all options:

```json
{
  "destination": {
    "host": "192.168.1.100",
    "user": "root",
    "port": 22,
    "sshKeyPath": "~/.ssh/id_ed25519"
  },
  "transfer": {
    "retries": 3,
    "concurrency": 2,
    "rsyncExtraArgs": [],
    "excludePaths": []
  },
  "healthChecks": [
    {
      "name": "My App",
      "url": "http://localhost:3000/health",
      "timeout": 60000
    }
  ],
  "paths": {
    "dumpDir": "/tmp/vortex-shift-dumps",
    "checkpointDir": "~/.vortex-shift",
    "logFile": "./vortex-shift.log",
    "nginxProxyManagerDataPath": "/opt/nginx-proxy-manager",
    "pm2DumpPath": "~/.pm2/dump.pm2"
  },
  "verbose": false
}
```

| Field | Description |
|---|---|
| `destination.host` | IP or hostname of the destination server |
| `destination.user` | SSH user (default: `root`) |
| `destination.port` | SSH port (default: `22`) |
| `destination.sshKeyPath` | Path to SSH private key (auto-detected if omitted) |
| `transfer.retries` | How many times to retry a failed step (default: `3`) |
| `transfer.concurrency` | Parallel DB dumps (default: `2`) |
| `transfer.rsyncExtraArgs` | Extra flags passed to rsync (e.g. `["--bwlimit=50000"]`) |
| `transfer.excludePaths` | Paths to skip during transfer |
| `healthChecks` | HTTP endpoints to verify after migration completes |
| `paths.dumpDir` | Where DB dumps are written on source (default: `/tmp/vortex-shift-dumps`) |
| `paths.checkpointDir` | Where checkpoint state is stored (default: `~/.vortex-shift`) |
| `paths.logFile` | Log file path (default: `./vortex-shift.log`) |
| `paths.nginxProxyManagerDataPath` | NPM data directory (default: `/opt/nginx-proxy-manager`) |
| `paths.pm2DumpPath` | PM2 ecosystem dump path (default: `~/.pm2/dump.pm2`) |
| `verbose` | Print debug output to terminal (default: `false`) |

---

## All Commands

### `vortex-shift source` — run the migration

```
vortex-shift source [options]

Options:
  --dest-host <host>       Destination IP, hostname, or SSH config alias.
                           If omitted, an interactive picker is shown using
                           hosts from ~/.ssh/config.
  --dest-user <user>       SSH user (overrides SSH config, default: root)
  --dest-port <port>       SSH port (overrides SSH config, default: 22)
  --ssh-key-path <path>    SSH private key (overrides SSH config IdentityFile)
  --retries <n>            Retries per step (default: 3)
  --resume                 Resume from last checkpoint
  --config <path>          Path to vortex-shift.json
  --log-file <path>        Log file path
  --dry-run                Plan only — no transfers or changes
  --verbose                Extra debug output
  --yes                    Skip all confirmation prompts
```

**SSH config resolution priority** (highest to lowest):

1. CLI flag (e.g. `--dest-user`)
2. `vortex-shift.json` value
3. SSH config entry (`~/.ssh/config`)
4. Built-in default (`root` / port `22`)

### `vortex-shift destination` — run on destination manually

```
vortex-shift destination [options]

Options:
  --run-phase4             Run validation phase (called automatically by source)
  --checkpoint-dir <dir>   Checkpoint directory
  --config <path>          Path to vortex-shift.json
  --verbose                Extra debug output
```

### `vortex-shift status` — show migration progress

```
vortex-shift status [options]

Options:
  --checkpoint-dir <dir>   Checkpoint directory (default: ~/.vortex-shift)
```

### `vortex-shift reset` — clear checkpoint and start fresh

```
vortex-shift reset [options]

Options:
  --delete-dumps           Also delete DB dump files
  --checkpoint-dir <dir>   Checkpoint directory (default: ~/.vortex-shift)
  --yes                    Skip confirmation prompt
```

### `vortex-shift init` — generate a config file

```
vortex-shift init [options]

Options:
  --output <path>          Output path (default: vortex-shift.json)
  --dest-host <host>       Pre-fill destination host
  --dest-user <user>       Pre-fill SSH user
  --dest-port <port>       Pre-fill SSH port
  --retries <n>            Pre-fill retry count
  --overwrite              Overwrite existing config without prompting
```

---

## How It Works

Vortex Shift runs in four sequential phases. Each phase is checkpointed — if the process is interrupted, it resumes from the last completed step.

```
Source Server                         Destination Server
─────────────────                     ──────────────────
Phase 1: Check environment     ──►    Phase 1: Check environment
Phase 2: Discover resources
Phase 3: Transfer via rsync    ──►    (receives data)
                               ──►    Phase 4: Restore and verify
```

**Phase 1 — Detection**
Checks OS, Docker, Docker Compose, rsync, Node.js, and PM2. Sets up SSH keys if missing. Tests connectivity. Warns if destination disk space is low.

**Phase 2 — Inventory**
Finds all Docker Compose projects, named volumes, PM2 apps, database containers, and NGINX Proxy Manager. Writes a `manifest.json` and shows a summary before transferring.

**Phase 3 — Transfer**
Dumps all databases (PostgreSQL, MySQL, Redis, MongoDB). Transfers volumes, project directories, PM2 apps, and NGINX data via rsync over SSH. Each resource is independently checkpointed.

**Phase 4 — Validation**
Runs on the destination. Restores database dumps. Starts all Docker Compose stacks in dependency order (databases first). Resurrects PM2 apps. Starts NGINX Proxy Manager. Runs all configured HTTP health checks. Writes a final `migration-report.json`.

---

## Troubleshooting

**SSH config host not showing in the picker**

Vortex Shift reads `~/.ssh/config` and shows only entries that have both a `Host` alias and a `HostName`. Wildcards (`Host *`) are ignored. Check your config:

```bash
cat ~/.ssh/config
```

A valid entry looks like:

```
Host prod-server
    HostName 1.2.3.4
    User root
    Port 22
    IdentityFile ~/.ssh/id_ed25519
```

**SSH connection refused**

```
Failed to connect to root@1.2.3.4:22
```

Check:
- Is the destination reachable? `ping 1.2.3.4`
- Is sshd running? `systemctl status sshd` on the destination
- Is port 22 open? Check your firewall rules
- Test manually: `ssh -i ~/.ssh/id_ed25519 root@1.2.3.4`

**Not enough disk space on destination**

```
Destination headroom would be below 5%
```

Free up space on the destination before retrying:
```bash
df -h          # check usage
docker system prune -a  # remove unused Docker data
```

**Docker daemon not running**

```
Cannot connect to Docker daemon
```

Start Docker on the affected server:
```bash
systemctl start docker
systemctl enable docker
```

**Migration failed mid-transfer**

Just resume — Vortex Shift picks up where it left off:
```bash
vortex-shift source --dest-host YOUR_DESTINATION_IP --resume
```

Check what was completed before resuming:
```bash
vortex-shift status
```

**rsync permission denied**

Make sure the destination paths are writable by the SSH user. If running as `root`, this should not be an issue. If using a non-root user, check directory ownership.

**A service did not start on the destination**

Check the final report for which service failed:
```bash
cat ~/.vortex-shift/migration-report.json
```

Then inspect that service manually on the destination:
```bash
docker compose -f /path/to/project/docker-compose.yml logs
pm2 logs <app-name>
```

**Want to start over completely**

```bash
vortex-shift reset --delete-dumps
vortex-shift source --dest-host YOUR_DESTINATION_IP
```
