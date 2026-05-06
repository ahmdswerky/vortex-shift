"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveMigrationConfig = resolveMigrationConfig;
exports.createCheckpointState = createCheckpointState;
exports.loadOrCreateCheckpoint = loadOrCreateCheckpoint;
exports.loadManifestFromCheckpoint = loadManifestFromCheckpoint;
exports.buildContext = buildContext;
exports.removePathIfExists = removePathIfExists;
exports.registerInterruptHandlers = registerInterruptHandlers;
const node_path_1 = __importDefault(require("node:path"));
const node_fs_1 = require("node:fs");
const defaults_js_1 = require("../config/defaults.js");
const checkpoint_js_1 = require("../core/checkpoint.js");
const ssh_js_1 = require("../core/ssh.js");
const config_js_1 = require("../types/config.js");
const fs_js_1 = require("../utils/fs.js");
async function loadConfigFile(configPath) {
    if (!configPath) {
        return null;
    }
    const resolved = (0, fs_js_1.expandHome)(configPath);
    return (0, fs_js_1.readJson)(resolved, config_js_1.migrationConfigSchema);
}
function fallbackSshKeyPath(input) {
    const keyPath = input?.trim();
    if (keyPath) {
        return (0, fs_js_1.expandHome)(keyPath);
    }
    return (0, fs_js_1.expandHome)('~/.ssh/id_ed25519');
}
async function resolveMigrationConfig(mode, options, overrides = {}) {
    const fromFile = await loadConfigFile(options.config);
    const destinationHost = overrides.destinationHost ??
        (mode === 'source' ? options.destHost : undefined) ??
        fromFile?.destination.host ??
        (mode === 'destination' ? 'localhost' : '');
    if (mode === 'source' && destinationHost.trim().length === 0) {
        throw new Error('Missing destination host. Provide --dest-host or set destination.host in config.');
    }
    const destinationUser = overrides.destinationUser ?? fromFile?.destination.user ?? defaults_js_1.DEFAULT_SSH_USER;
    const destinationPort = overrides.destinationPort ?? fromFile?.destination.port ?? defaults_js_1.DEFAULT_SSH_PORT;
    const sshKeyPath = fallbackSshKeyPath(options.sshKeyPath ??
        options.sshKeyPath ??
        fromFile?.destination.sshKeyPath);
    const checkpointDir = (0, fs_js_1.expandHome)(options.checkpointDir ??
        options.checkpointDir ??
        fromFile?.paths.checkpointDir ??
        defaults_js_1.DEFAULT_CHECKPOINT_DIR);
    const logFile = (0, fs_js_1.expandHome)(options.logFile ?? fromFile?.paths.logFile ?? defaults_js_1.DEFAULT_LOG_FILE);
    return {
        destination: {
            host: destinationHost,
            user: destinationUser,
            port: destinationPort,
            sshKeyPath,
        },
        transfer: {
            retries: overrides.retries ?? fromFile?.transfer.retries ?? defaults_js_1.DEFAULT_RETRIES,
            concurrency: fromFile?.transfer.concurrency ?? 2,
            rsyncExtraArgs: fromFile?.transfer.rsyncExtraArgs ?? [],
            excludePaths: fromFile?.transfer.excludePaths ?? [],
        },
        healthChecks: fromFile?.healthChecks ?? [],
        paths: {
            dumpDir: (0, fs_js_1.expandHome)(fromFile?.paths.dumpDir ?? defaults_js_1.DEFAULT_DUMP_DIR),
            checkpointDir,
            logFile,
            nginxProxyManagerDataPath: fromFile?.paths.nginxProxyManagerDataPath ?? defaults_js_1.DEFAULT_NPM_DATA_PATH,
            pm2DumpPath: (0, fs_js_1.expandHome)(fromFile?.paths.pm2DumpPath ?? defaults_js_1.DEFAULT_PM2_DUMP_PATH),
        },
        verbose: options.verbose ?? fromFile?.verbose ?? false,
    };
}
function createCheckpointState(mode, destinationHost) {
    const now = new Date().toISOString();
    return {
        version: checkpoint_js_1.CHECKPOINT_SCHEMA_VERSION,
        mode,
        destHost: destinationHost,
        phase: 1,
        completedSteps: [],
        failedStep: null,
        error: null,
        startedAt: now,
        lastUpdatedAt: now,
    };
}
async function loadOrCreateCheckpoint(mode, checkpointDir, destinationHost) {
    const existing = await (0, checkpoint_js_1.loadCheckpoint)(checkpointDir);
    return existing ?? createCheckpointState(mode, destinationHost);
}
async function loadManifestFromCheckpoint(checkpointDir) {
    const manifestPath = node_path_1.default.join(checkpointDir, 'manifest.json');
    if (!(await (0, fs_js_1.fileExists)(manifestPath))) {
        return null;
    }
    return (0, fs_js_1.readJson)(manifestPath);
}
function buildContext(mode, config, checkpoint, logger, manifest, isDryRun) {
    const ssh = new ssh_js_1.SSHClient();
    ssh.setDryRun(isDryRun);
    return {
        mode,
        config,
        isDryRun,
        ssh,
        manifest,
        checkpoint,
        log: logger,
    };
}
async function removePathIfExists(targetPath) {
    if (!(await (0, fs_js_1.fileExists)(targetPath))) {
        return false;
    }
    await node_fs_1.promises.rm(targetPath, { recursive: true, force: true });
    return true;
}
function registerInterruptHandlers(ctx) {
    let handling = false;
    const handleSignal = (signal) => {
        if (handling) {
            return;
        }
        handling = true;
        void (async () => {
            try {
                ctx.log.warn(`Received ${signal}. Saving checkpoint before exit...`);
                if (!ctx.checkpoint.failedStep) {
                    ctx.checkpoint.failedStep = 'interrupted';
                }
                ctx.checkpoint.error =
                    'Migration interrupted by signal. Partial transfer may exist. Resume with --resume.';
                ctx.checkpoint.lastUpdatedAt = new Date().toISOString();
                await (0, checkpoint_js_1.saveCheckpoint)(ctx.config.paths.checkpointDir, ctx.checkpoint);
            }
            catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                ctx.log.error(`Failed to save checkpoint during interrupt: ${message}`);
            }
            finally {
                ctx.ssh.disconnect();
                ctx.log.info('Resume with: vortex-shift source --resume');
                process.exitCode = 130;
                process.exit(130);
            }
        })();
    };
    process.on('SIGINT', handleSignal);
    process.on('SIGTERM', handleSignal);
    return () => {
        process.off('SIGINT', handleSignal);
        process.off('SIGTERM', handleSignal);
    };
}
