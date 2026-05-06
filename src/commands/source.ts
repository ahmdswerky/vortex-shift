import { Command } from 'commander'
import path from 'node:path'
import { clearCheckpoint, displayCheckpointSummary, loadCheckpoint } from '../core/checkpoint.js'
import { MigrationError } from '../core/executor.js'
import { runPhase1 } from '../phases/phase1-detect.js'
import { runPhase2 } from '../phases/phase2-inventory.js'
import { runPhase3 } from '../phases/phase3-transfer.js'
import {
  buildContext,
  createCheckpointState,
  loadManifestFromCheckpoint,
  registerInterruptHandlers,
  resolveMigrationConfig,
  type SourceCommandOptions,
} from './shared.js'
import type { Logger } from '../core/logger.js'
import { confirm } from '../utils/prompt.js'

interface SourceActionOptions extends SourceCommandOptions {
  destHost: string
  destUser?: string
  destPort?: number
  retries?: number
  resume?: boolean
}

async function triggerDestinationPhase4(
  logger: Logger,
  destination: {
    host: string
    user: string
    port: number
    sshKeyPath: string
  },
  checkpointDir: string,
  verbose: boolean
): Promise<void> {
  const { SSHClient } = await import('../core/ssh.js')
  const ssh = new SSHClient()

  try {
    await ssh.connect(destination)
    const commandParts = [
      'vortex-shift',
      'destination',
      '--run-phase4',
      '--checkpoint-dir',
      JSON.stringify(checkpointDir),
    ]
    if (verbose) {
      commandParts.push('--verbose')
    }

    const command = commandParts.join(' ')
    logger.info(`Triggering destination Phase 4: ${destination.user}@${destination.host}`)
    const result = await ssh.exec(command)
    if (result.code !== 0) {
      throw new Error(
        `Destination Phase 4 trigger failed (code=${result.code}): ${result.stderr || result.stdout}`
      )
    }
  } finally {
    ssh.disconnect()
  }
}

export function createSourceCommand(getLogger: () => Logger): Command {
  const command = new Command('source')
    .description('Run source-side migration orchestration')
    .requiredOption('--dest-host <host>', 'Destination host')
    .option('--dest-user <user>', 'Destination SSH user')
    .option('--dest-port <port>', 'Destination SSH port', (value) => Number.parseInt(value, 10))
    .option('--retries <count>', 'Step retry count', (value) => Number.parseInt(value, 10))
    .option('--resume', 'Resume from existing checkpoint')
    .option('--checkpoint-dir <dir>', 'Checkpoint directory override')
    .option('--ssh-key-path <path>', 'SSH key path override')
    .action(async (_options, cmd) => {
      const logger = getLogger()
      const options = cmd.optsWithGlobals() as SourceActionOptions

      const overrides: {
        destinationHost?: string
        destinationUser?: string
        destinationPort?: number
        retries?: number
      } = {
        destinationHost: options.destHost,
      }
      if (options.destUser !== undefined) {
        overrides.destinationUser = options.destUser
      }
      if (options.destPort !== undefined) {
        overrides.destinationPort = options.destPort
      }
      if (options.retries !== undefined) {
        overrides.retries = options.retries
      }

      const config = await resolveMigrationConfig('source', options, overrides)

      const existingCheckpoint = await loadCheckpoint(config.paths.checkpointDir)
      let checkpoint = existingCheckpoint

      if (existingCheckpoint) {
        displayCheckpointSummary(existingCheckpoint, logger)

        const shouldResume =
          options.resume === true ||
          options.yes === true ||
          (await confirm('Existing checkpoint found. Resume from checkpoint?', true))

        if (!shouldResume) {
          await clearCheckpoint(config.paths.checkpointDir)
          checkpoint = null
          logger.info('Previous checkpoint cleared. Starting a new migration run.')
        }
      }

      if (!checkpoint) {
        checkpoint = createCheckpointState('source', config.destination.host)
      }

      const manifest = await loadManifestFromCheckpoint(config.paths.checkpointDir)
      const ctx = buildContext('source', config, checkpoint, logger, manifest, options.dryRun === true)
      const unregisterInterrupts = registerInterruptHandlers(ctx)

      try {
        await runPhase1(ctx)
        await runPhase2(ctx)
        await runPhase3(ctx)

        if (ctx.isDryRun) {
          logger.info('[dry-run] Skipping destination Phase 4 trigger.')
        } else {
          await triggerDestinationPhase4(
            logger,
            config.destination,
            path.resolve(config.paths.checkpointDir),
            config.verbose
          )
        }
      } catch (error) {
        if (error instanceof MigrationError) {
          logger.error(`Migration failed at step ${error.stepId} (phase ${error.phase}).`)
          logger.error(
            `Check logs at ${config.paths.logFile}. Run "vortex-shift status", then resume with --resume.`
          )
          throw error
        }

        const message = error instanceof Error ? error.message : String(error)
        logger.error(`Source migration failed: ${message}`)
        logger.error(
          `Check logs at ${config.paths.logFile}. Run "vortex-shift status", then resume with --resume.`
        )
        throw error
      } finally {
        unregisterInterrupts()
        ctx.ssh.disconnect()
      }
    })

  return command
}
