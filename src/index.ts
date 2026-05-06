import { Command } from 'commander'
import packageMetadata from '../package.json' with { type: 'json' }
import { DEFAULT_LOG_FILE } from './config/defaults.js'
import { createDestinationCommand } from './commands/destination.js'
import { createInitCommand } from './commands/init.js'
import { createResetCommand } from './commands/reset.js'
import { createSourceCommand } from './commands/source.js'
import { createStatusCommand } from './commands/status.js'
import { createLog, type Logger } from './core/logger.js'
import { expandHome } from './utils/fs.js'

interface GlobalProgramOptions {
  config?: string
  logFile?: string
  verbose?: boolean
  yes?: boolean
  dryRun?: boolean
}

const program = new Command()
let logger: Logger | null = null

function getLogger(): Logger {
  if (!logger) {
    throw new Error('Logger is not initialized.')
  }
  return logger
}

async function ensureLoggerInitialized(globalOptions: GlobalProgramOptions): Promise<void> {
  if (logger) {
    return
  }

  logger = await createLog({
    verbose: globalOptions.verbose ?? false,
    logFile: expandHome(globalOptions.logFile ?? DEFAULT_LOG_FILE),
  })
}

function handleTopLevelFailure(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error)
  if (logger) {
    logger.error(message)
  } else {
    process.stderr.write(`Error: ${message}\n`)
  }
  process.exitCode = 1
}

process.on('uncaughtException', (error) => {
  handleTopLevelFailure(error)
})

process.on('unhandledRejection', (reason) => {
  handleTopLevelFailure(reason)
})

program
  .name('vortex-shift')
  .description('CLI for full server migration between Rocky Linux servers')
  .version(packageMetadata.version)
  .option('--config <path>', 'Path to vortex-shift config file')
  .option('--log-file <path>', 'Path to log file')
  .option('--verbose', 'Enable verbose logging')
  .option('--yes', 'Auto-confirm prompts')
  .option('--dry-run', 'Preview actions without executing')
  .hook('preSubcommand', async (thisCommand) => {
    const options = thisCommand.opts() as GlobalProgramOptions
    await ensureLoggerInitialized(options)
  })

program.addCommand(createSourceCommand(getLogger))
program.addCommand(createDestinationCommand(getLogger))
program.addCommand(createStatusCommand(getLogger))
program.addCommand(createResetCommand(getLogger))
program.addCommand(createInitCommand(getLogger))

try {
  program.parse(process.argv)
} catch (error) {
  handleTopLevelFailure(error)
}
