import { Command } from 'commander'
import { DEFAULT_CHECKPOINT_DIR } from '../config/defaults.js'
import { loadCheckpoint } from '../core/checkpoint.js'
import type { Logger } from '../core/logger.js'
import { expandHome } from '../utils/fs.js'
import { formatDate, formatList } from '../utils/format.js'

interface StatusOptions {
  checkpointDir?: string
}

const TOTAL_ESTIMATED_STEPS = 35

function estimateCompletionPercent(completedSteps: number): number {
  const ratio = TOTAL_ESTIMATED_STEPS > 0 ? completedSteps / TOTAL_ESTIMATED_STEPS : 0
  return Math.min(100, Math.max(0, Math.round(ratio * 100)))
}

export function createStatusCommand(getLogger: () => Logger): Command {
  return new Command('status')
    .description('Show migration checkpoint status')
    .option('--checkpoint-dir <dir>', 'Checkpoint directory override')
    .action(async (options: StatusOptions) => {
      const logger = getLogger()
      const checkpointDir = expandHome(options.checkpointDir ?? DEFAULT_CHECKPOINT_DIR)
      const checkpoint = await loadCheckpoint(checkpointDir)

      if (!checkpoint) {
        logger.info('No migration in progress')
        return
      }

      const completion = estimateCompletionPercent(checkpoint.completedSteps.length)

      logger.info(`Checkpoint directory: ${checkpointDir}`)
      logger.info(`Started at: ${formatDate(checkpoint.startedAt)}`)
      logger.info(`Last updated: ${formatDate(checkpoint.lastUpdatedAt)}`)
      logger.info(`Current phase: ${checkpoint.phase}`)
      logger.info(`Completed steps: ${checkpoint.completedSteps.length}`)

      if (checkpoint.completedSteps.length > 0) {
        logger.info(`Completed step IDs:\n${formatList(checkpoint.completedSteps)}`)
      }

      if (checkpoint.failedStep) {
        logger.warn(`Failed step: ${checkpoint.failedStep}`)
        logger.warn(`Error: ${checkpoint.error ?? 'Unknown error'}`)
      }

      logger.info(`Estimated completion: ~${completion}%`)
    })
}
