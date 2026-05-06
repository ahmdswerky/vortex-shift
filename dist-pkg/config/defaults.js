"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RSYNC_BASE_ARGS = exports.HEALTH_CHECK_POLL_INTERVAL_MS = exports.HEALTH_CHECK_TIMEOUT_MS = exports.COMPOSE_SEARCH_PATHS = exports.DEFAULT_PM2_DUMP_PATH = exports.DEFAULT_NPM_DATA_PATH = exports.DEFAULT_LOG_FILE = exports.DEFAULT_CHECKPOINT_DIR = exports.DEFAULT_DUMP_DIR = exports.DEFAULT_SSH_USER = exports.DEFAULT_SSH_PORT = exports.DEFAULT_RETRIES = void 0;
exports.DEFAULT_RETRIES = 3;
exports.DEFAULT_SSH_PORT = 22;
exports.DEFAULT_SSH_USER = 'root';
exports.DEFAULT_DUMP_DIR = '/tmp/vortex-shift-dumps';
exports.DEFAULT_CHECKPOINT_DIR = '~/.vortex-shift';
exports.DEFAULT_LOG_FILE = './vortex-shift.log';
exports.DEFAULT_NPM_DATA_PATH = '/opt/nginx-proxy-manager';
exports.DEFAULT_PM2_DUMP_PATH = '~/.pm2/dump.pm2';
exports.COMPOSE_SEARCH_PATHS = ['/opt', '/home', '/srv', '/root'];
exports.HEALTH_CHECK_TIMEOUT_MS = 60_000;
exports.HEALTH_CHECK_POLL_INTERVAL_MS = 5_000;
exports.RSYNC_BASE_ARGS = [
    '-az',
    '--partial',
    '--progress',
    '--checksum',
    '--delete',
    '--numeric-ids',
];
