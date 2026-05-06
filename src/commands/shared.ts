import path from 'node:path'
import { promises as fs } from 'node:fs'
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
import { CHECKPOINT_SCHEMA_VERSION, loadCheckpoint, saveCheckpoint } from '../core/checkpoint.js'
import { SSHClient } from '../core/ssh.js'
import type { CheckpointState } from '../types/checkpoint.js'
import {
  migrationConfigSchema,
  type MigrationConfig,
  type MigrationConfigInput,
} from '../types/config.js'
import type { MigrationContext } from '../types/context.js'
import type { Manifest } from '../types/manifest.js'
import type { Logger } from '../core/logger.js'
import { expandHome, fileExists, readJson } from '../utils/fs.js'

export interface GlobalCommandOptions {
  config?: string
  logFile?: string
  verbose?: boolean
  yes?: boolean
  dryRun?: boolean
}

export interface SourceCommandOptions extends GlobalCommandOptions {
  destHost?: string
  destUser?: string
  destPort?: number
  retries?: number
  resume?: boolean
  checkpointDir?: string
  sshKeyPath?: string
}

export interface DestinationCommandOptions extends GlobalCommandOptions {
  port?: number
  runPhase4?: boolean
  checkpointDir?: string
  sshKeyPath?: string
}

async function loadConfigFile(configPath?: string): Promise<MigrationConfigInput | null> {
  if (!configPath) {
    return null
  }

  const resolved = expandHome(configPath)
  return readJson<MigrationConfigInput>(resolved, migrationConfigSchema)
}

function fallbackSshKeyPath(input?: string): string {
  const keyPath = input?.trim()
  if (keyPath) {
    return expandHome(keyPath)
  }

  return expandHome('~/.ssh/id_ed25519')
}

export async function resolveMigrationConfig(
  mode: 'source' | 'destination',
  options: SourceCommandOptions | DestinationCommandOptions,
  overrides: {
    destinationHost?: string
    destinationUser?: string
    destinationPort?: number
    retries?: number
  } = {}
): Promise<MigrationConfig> {
  const fromFile = await loadConfigFile(options.config)

  const destinationHost =
    overrides.destinationHost ??
    (mode === 'source' ? (options as SourceCommandOptions).destHost : undefined) ??
    fromFile?.destination.host ??
    (mode === 'destination' ? 'localhost' : '')

  if (mode === 'source' && destinationHost.trim().length === 0) {
    throw new Error('Missing destination host. Provide --dest-host or set destination.host in config.')
  }

  const destinationUser = overrides.destinationUser ?? fromFile?.destination.user ?? DEFAULT_SSH_USER
  const destinationPort = overrides.destinationPort ?? fromFile?.destination.port ?? DEFAULT_SSH_PORT
  const sshKeyPath = fallbackSshKeyPath(
    (options as SourceCommandOptions).sshKeyPath ??
      (options as DestinationCommandOptions).sshKeyPath ??
      fromFile?.destination.sshKeyPath
  )

  const checkpointDir = expandHome(
    (options as SourceCommandOptions).checkpointDir ??
      (options as DestinationCommandOptions).checkpointDir ??
      fromFile?.paths.checkpointDir ??
      DEFAULT_CHECKPOINT_DIR
  )
  const logFile = expandHome(options.logFile ?? fromFile?.paths.logFile ?? DEFAULT_LOG_FILE)

  return {
    destination: {
      host: destinationHost,
      user: destinationUser,
      port: destinationPort,
      sshKeyPath,
    },
    transfer: {
      retries: overrides.retries ?? fromFile?.transfer.retries ?? DEFAULT_RETRIES,
      concurrency: fromFile?.transfer.concurrency ?? 2,
      rsyncExtraArgs: fromFile?.transfer.rsyncExtraArgs ?? [],
      excludePaths: fromFile?.transfer.excludePaths ?? [],
    },
    healthChecks: fromFile?.healthChecks ?? [],
    paths: {
      dumpDir: expandHome(fromFile?.paths.dumpDir ?? DEFAULT_DUMP_DIR),
      checkpointDir,
      logFile,
      nginxProxyManagerDataPath: fromFile?.paths.nginxProxyManagerDataPath ?? DEFAULT_NPM_DATA_PATH,
      pm2DumpPath: expandHome(fromFile?.paths.pm2DumpPath ?? DEFAULT_PM2_DUMP_PATH),
    },
    verbose: options.verbose ?? fromFile?.verbose ?? false,
  }
}

export function createCheckpointState(
  mode: 'source' | 'destination',
  destinationHost: string
): CheckpointState {
  const now = new Date().toISOString()
  return {
    version: CHECKPOINT_SCHEMA_VERSION,
    mode,
    destHost: destinationHost,
    phase: 1,
    completedSteps: [],
    failedStep: null,
    error: null,
    startedAt: now,
    lastUpdatedAt: now,
  }
}

export async function loadOrCreateCheckpoint(
  mode: 'source' | 'destination',
  checkpointDir: string,
  destinationHost: string
): Promise<CheckpointState> {
  const existing = await loadCheckpoint(checkpointDir)
  return existing ?? createCheckpointState(mode, destinationHost)
}

export async function loadManifestFromCheckpoint(checkpointDir: string): Promise<Manifest | null> {
  const manifestPath = path.join(checkpointDir, 'manifest.json')
  if (!(await fileExists(manifestPath))) {
    return null
  }

  return readJson<Manifest>(manifestPath)
}

export function buildContext(
  mode: 'source' | 'destination',
  config: MigrationConfig,
  checkpoint: CheckpointState,
  logger: Logger,
  manifest: Manifest | null,
  isDryRun: boolean
): MigrationContext {
  const ssh = new SSHClient()
  ssh.setDryRun(isDryRun)

  return {
    mode,
    config,
    isDryRun,
    ssh,
    manifest,
    checkpoint,
    log: logger,
  }
}

export async function removePathIfExists(targetPath: string): Promise<boolean> {
  if (!(await fileExists(targetPath))) {
    return false
  }

  await fs.rm(targetPath, { recursive: true, force: true })
  return true
}

export function registerInterruptHandlers(ctx: MigrationContext): () => void {
  let handling = false

  const handleSignal = (signal: NodeJS.Signals): void => {
    if (handling) {
      return
    }
    handling = true

    void (async () => {
      try {
        ctx.log.warn(`Received ${signal}. Saving checkpoint before exit...`)
        if (!ctx.checkpoint.failedStep) {
          ctx.checkpoint.failedStep = 'interrupted'
        }
        ctx.checkpoint.error =
          'Migration interrupted by signal. Partial transfer may exist. Resume with --resume.'
        ctx.checkpoint.lastUpdatedAt = new Date().toISOString()
        await saveCheckpoint(ctx.config.paths.checkpointDir, ctx.checkpoint)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        ctx.log.error(`Failed to save checkpoint during interrupt: ${message}`)
      } finally {
        ctx.ssh.disconnect()
        ctx.log.info('Resume with: vortex-shift source --resume')
        process.exitCode = 130
        process.exit(130)
      }
    })()
  }

  process.on('SIGINT', handleSignal)
  process.on('SIGTERM', handleSignal)

  return () => {
    process.off('SIGINT', handleSignal)
    process.off('SIGTERM', handleSignal)
  }
}
