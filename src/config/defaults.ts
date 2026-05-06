export const DEFAULT_RETRIES = 3
export const DEFAULT_SSH_PORT = 22
export const DEFAULT_SSH_USER = 'root'
export const DEFAULT_DUMP_DIR = '/tmp/vortex-shift-dumps'
export const DEFAULT_CHECKPOINT_DIR = '~/.vortex-shift'
export const DEFAULT_LOG_FILE = './vortex-shift.log'
export const DEFAULT_NPM_DATA_PATH = '/opt/nginx-proxy-manager'
export const DEFAULT_PM2_DUMP_PATH = '~/.pm2/dump.pm2'
export const COMPOSE_SEARCH_PATHS = ['/opt', '/home', '/srv', '/root']
export const HEALTH_CHECK_TIMEOUT_MS = 60_000
export const HEALTH_CHECK_POLL_INTERVAL_MS = 5_000
export const RSYNC_BASE_ARGS = [
  '-az',
  '--partial',
  '--progress',
  '--checksum',
  '--delete',
  '--numeric-ids',
]
