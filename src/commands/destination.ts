import { Command } from 'commander'
import path from 'node:path'
import { loadCheckpoint } from '../core/checkpoint.js'
import { MigrationError } from '../core/executor.js'
import { runPhase1 } from '../phases/phase1-detect.js'
import { runPhase4 } from '../phases/phase4-validate.js'
import {
  buildContext,
  createCheckpointState,
  loadManifestFromCheckpoint,
  registerInterruptHandlers,
  resolveMigrationConfig,
  type DestinationCommandOptions,
} from './shared.js'
import type { Logger } from '../core/logger.js'
import { fileExists } from '../utils/fs.js'

interface DestinationActionOptions extends DestinationCommandOptions {
  port?: number
  runPhase4?: boolean
}

async function waitForManifest(checkpointDir: string, logger: Logger): Promise<void> {
  const manifestPath = path.join(checkpointDir, 'manifest.json')
  logger.info(`Waiting for source manifest at ${manifestPath}`)

  while (!(await fileExists(manifestPath))) {
    await new Promise((resolve) => {
      setTimeout(resolve, 5_000)
    })
  }
}

export function createDestinationCommand(getLogger: () => Logger): Command {
  const command = new Command('destination')
    .description('Run destination-side migration validation')
    .option('--port <port>', 'Coordination port (reserved for active mode)', (value) =>
      Number.parseInt(value, 10)
    )
    .option('--run-phase4', 'Run Phase 4 immediately (used by source trigger)')
    .option('--checkpoint-dir <dir>', 'Checkpoint directory override')
    .option('--ssh-key-path <path>', 'SSH key path override')
    .action(async (_options, cmd) => {
      const logger = getLogger()
      const options = cmd.optsWithGlobals() as DestinationActionOptions

      const config = await resolveMigrationConfig('destination', options)
      const existing = await loadCheckpoint(config.paths.checkpointDir)
      const checkpoint = existing ?? createCheckpointState('destination', config.destination.host)
      const manifest = await loadManifestFromCheckpoint(config.paths.checkpointDir)

      const ctx = buildContext(
        'destination',
        config,
        checkpoint,
        logger,
        manifest,
        options.dryRun === true
      )
      const unregisterInterrupts = registerInterruptHandlers(ctx)

      try {
        await runPhase1(ctx)

        if (options.port) {
          logger.info(`Destination coordination port configured: ${options.port}`)
        }

        if (!options.runPhase4 && !ctx.isDryRun) {
          await waitForManifest(config.paths.checkpointDir, logger)
        }

        ctx.manifest = await loadManifestFromCheckpoint(config.paths.checkpointDir)
        if (!ctx.manifest) {
          throw new Error('Manifest not found. Source transfer may not have completed.')
        }

        await runPhase4(ctx)
      } catch (error) {
        if (error instanceof MigrationError) {
          logger.error(`Destination migration failed at step ${error.stepId} (phase ${error.phase}).`)
          logger.error(
            `Check logs at ${config.paths.logFile}. Run "vortex-shift status", then resume with --resume.`
          )
          throw error
        }

        const message = error instanceof Error ? error.message : String(error)
        logger.error(`Destination command failed: ${message}`)
        throw error
      } finally {
        unregisterInterrupts()
        ctx.ssh.disconnect()
      }
    })

  return command
}
