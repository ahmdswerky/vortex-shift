# Vortex Shift

CLI tool for end-to-end server migration between Rocky Linux hosts.

## Installation

Install latest binary release (Linux only):

```bash
curl -fsSL https://raw.githubusercontent.com/USER/vortex-shift/main/install.sh | bash
```

Global install:

```bash
npm install -g vortex-shift
```

Run without global install:

```bash
npx vortex-shift <command>
```

Build binary (if using `pkg`):

```bash
npm run package
```

## Prerequisites

- Rocky Linux (or compatible RHEL-like distribution)
- Docker Engine + Docker Compose v2
- `rsync`
- SSH access from source to destination

## Quick Start

Generate a config file:

```bash
vortex-shift init --dest-host your-destination-host
```

Run source workflow:

```bash
vortex-shift source --dest-host your-destination-host --config ./vortex-shift.json
```

Run destination workflow (manual mode):

```bash
vortex-shift destination --config ./vortex-shift.json
```

Check progress:

```bash
vortex-shift status
```

Reset progress:

```bash
vortex-shift reset --delete-dumps
```

## Configuration (`vortex-shift.json`)

Top-level keys:

- `destination`: host/user/port/key
- `transfer`: retries/concurrency/rsync options
- `healthChecks`: HTTP checks run in phase 4
- `paths`: dump/checkpoint/log/nginx/pm2 paths
- `verbose`: terminal debug output toggle

Use `vortex-shift init` to scaffold a valid baseline config.

## How It Works

1. Phase 1: detect and validate source/destination runtime prerequisites.
2. Phase 2: discover resources and write `manifest.json`.
3. Phase 3: transfer resources and write `transfer-results.json`.
4. Phase 4: restore services, run checks, and write `migration-report.json`.

Each phase is checkpointed for resume-safe reruns.

## Troubleshooting

- Use `vortex-shift status` to inspect checkpoint state.
- Use `--resume` on source command after failures.
- Verify SSH with the manual command printed in SSH errors.
- Check transfer errors for rsync resume guidance.
- Review log file path from CLI output (default `./vortex-shift.log`).
