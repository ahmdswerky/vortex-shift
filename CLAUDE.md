# Vortex Shift Development Notes

## Build / Lint / Test

- `npm run build` - compile TypeScript to `dist/`
- `npm run typecheck` - run strict type checks with no emit
- `npm run lint` - lint all TypeScript files
- `npm run test` - run test suite
- `npm run dev -- <command>` - run CLI in dev via `tsx`

## Architecture

Vortex Shift is a phased migration CLI:

1. Phase 1 (`src/phases/phase1-detect.ts`): source/destination environment checks
2. Phase 2 (`src/phases/phase2-inventory.ts`): inventory discovery + manifest write
3. Phase 3 (`src/phases/phase3-transfer.ts`): transfer orchestration + transfer results
4. Phase 4 (`src/phases/phase4-validate.ts`): restore, validation, and reporting

Core runtime modules:

- `src/core/executor.ts`: `StepRunner`, retries, checkpoint updates
- `src/core/checkpoint.ts`: checkpoint persistence and resume helpers
- `src/core/ssh.ts`: SSH wrapper (supports dry-run prints)
- `src/core/rsync.ts`: rsync wrapper (supports dry-run prints)
- `src/core/logger.ts`: terminal + file logging

## StepRunner and MigrationContext

`StepRunner` runs ordered `Step[]` with retry and checkpoint save after each successful step.

`MigrationContext` is passed through phases and includes:

- `mode`: source/destination
- `config`: merged runtime config
- `isDryRun`: when true, steps are not executed and a step summary is printed
- `ssh`: SSH client instance
- `manifest`: loaded/constructed resource manifest
- `checkpoint`: mutable run state
- `log`: logger instance

## Checkpoint Location and Shape

Default checkpoint directory: `~/.vortex-shift`

Primary files:

- `checkpoint.json`: phase, completed steps, failure state, timestamps
- `manifest.json`: discovered resources
- `transfer-results.json`: phase 3 transfer results
- `migration-report.json`: final phase 4 report

## Adding a New Phase Step

1. Add a `Step` object with stable `id` and `name` inside target phase module.
2. Implement `run(ctx)` using existing utilities (`shell`, `ssh`, `fs`, validators).
3. Insert step into the ordered phase steps list.
4. Ensure behavior is idempotent for resume safety.
5. Update `TASKS.md` and (if needed) report/checkpoint outputs.
