import { Command } from 'commander'
import { DEFAULT_CHECKPOINT_DIR, DEFAULT_DUMP_DIR } from '../config/defaults.js'
import { clearCheckpoint, loadCheckpoint } from '../core/checkpoint.js'
import type { Logger } from '../core/logger.js'
import { removePathIfExists } from './shared.js'
import { expandHome } from '../utils/fs.js'
import { confirm } from '../utils/prompt.js'

interface ResetOptions {
  checkpointDir?: string
  deleteDumps?: boolean
  yes?: boolean
}

export function createResetCommand(getLogger: () => Logger): Command {
  return new Command('reset')
    .description('Clear migration checkpoint and optionally dump files')
    .option('--checkpoint-dir <dir>', 'Checkpoint directory override')
    .option('--delete-dumps', 'Also delete dump directory')
    .action(async (_options, cmd) => {
      const logger = getLogger()
      const options = cmd.optsWithGlobals() as ResetOptions
      const checkpointDir = expandHome(options.checkpointDir ?? DEFAULT_CHECKPOINT_DIR)
      const checkpoint = await loadCheckpoint(checkpointDir)

      if (!checkpoint) {
        logger.info('No checkpoint file found.')
      } else {
        logger.info(`Checkpoint found in ${checkpointDir}`)
        logger.info(`Phase: ${checkpoint.phase}`)
        logger.info(`Completed steps: ${checkpoint.completedSteps.length}`)
        if (checkpoint.failedStep) {
          logger.warn(`Last failed step: ${checkpoint.failedStep}`)
        }
      }

      const shouldReset =
        options.yes === true ||
        (await confirm('This will clear all progress. Are you sure?', false))

      if (!shouldReset) {
        logger.info('Reset cancelled.')
        return
      }

      await clearCheckpoint(checkpointDir)
      logger.success('Checkpoint cleared.')

      if (options.deleteDumps) {
        const removed = await removePathIfExists(expandHome(DEFAULT_DUMP_DIR))
        if (removed) {
          logger.success(`Dump directory removed: ${expandHome(DEFAULT_DUMP_DIR)}`)
        } else {
          logger.info(`Dump directory not found: ${expandHome(DEFAULT_DUMP_DIR)}`)
        }
      }
    })
}
