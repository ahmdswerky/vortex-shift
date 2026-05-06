import { Command } from 'commander'
import path from 'node:path'
import {
  DEFAULT_CHECKPOINT_DIR,
  DEFAULT_DUMP_DIR,
  DEFAULT_LOG_FILE,
  DEFAULT_NPM_DATA_PATH,
  DEFAULT_PM2_DUMP_PATH,
  DEFAULT_RETRIES,
  DEFAULT_SSH_PORT,
  DEFAULT_SSH_USER,
} from '../config/defaults.js'
import type { MigrationConfig } from '../types/config.js'
import type { Logger } from '../core/logger.js'
import { expandHome, fileExists, writeJson } from '../utils/fs.js'
import { confirm } from '../utils/prompt.js'

interface InitOptions {
  output?: string
  destHost?: string
  destUser?: string
  destPort?: number
  retries?: number
  overwrite?: boolean
  yes?: boolean
}

export function createInitCommand(getLogger: () => Logger): Command {
  return new Command('init')
    .description('Generate a vortex-shift.json config file')
    .option('--output <path>', 'Output config path', 'vortex-shift.json')
    .option('--dest-host <host>', 'Destination host placeholder')
    .option('--dest-user <user>', 'Default destination SSH user')
    .option('--dest-port <port>', 'Default destination SSH port', (value) => Number.parseInt(value, 10))
    .option('--retries <count>', 'Default retries', (value) => Number.parseInt(value, 10))
    .option('--overwrite', 'Overwrite existing config file')
    .action(async (_options, cmd) => {
      const logger = getLogger()
      const options = cmd.optsWithGlobals() as InitOptions
      const outputPath = path.resolve(expandHome(options.output ?? 'vortex-shift.json'))

      if ((await fileExists(outputPath)) && !options.overwrite) {
        const allowed = options.yes === true || (await confirm(`Config exists at ${outputPath}. Overwrite?`, false))
        if (!allowed) {
          logger.info('Config generation cancelled.')
          return
        }
      }

      const config: MigrationConfig = {
        destination: {
          host: options.destHost ?? 'your-destination-host',
          user: options.destUser ?? DEFAULT_SSH_USER,
          port: options.destPort ?? DEFAULT_SSH_PORT,
          sshKeyPath: expandHome('~/.ssh/id_ed25519'),
        },
        transfer: {
          retries: options.retries ?? DEFAULT_RETRIES,
          concurrency: 2,
          rsyncExtraArgs: [],
          excludePaths: [],
        },
        healthChecks: [],
        paths: {
          dumpDir: DEFAULT_DUMP_DIR,
          checkpointDir: DEFAULT_CHECKPOINT_DIR,
          logFile: DEFAULT_LOG_FILE,
          nginxProxyManagerDataPath: DEFAULT_NPM_DATA_PATH,
          pm2DumpPath: DEFAULT_PM2_DUMP_PATH,
        },
        verbose: false,
      }

      await writeJson(outputPath, config)
      logger.success(`Config written to ${outputPath}`)
    })
}
