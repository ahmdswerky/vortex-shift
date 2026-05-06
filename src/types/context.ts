import type { CheckpointState } from './checkpoint.js'
import type { MigrationConfig } from './config.js'
import type { Manifest } from './manifest.js'
import type { SSHClient } from '../core/ssh.js'
import type { Logger } from '../core/logger.js'

export interface MigrationContext {
  mode: 'source' | 'destination'
  config: MigrationConfig
  ssh: SSHClient
  manifest: Manifest | null
  checkpoint: CheckpointState
  log: Logger
}
