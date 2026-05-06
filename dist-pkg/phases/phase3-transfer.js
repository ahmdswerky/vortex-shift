"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runPhase3 = runPhase3;
const node_path_1 = __importDefault(require("node:path"));
const cliProgress = __importStar(require("cli-progress"));
const defaults_js_1 = require("../config/defaults.js");
const executor_js_1 = require("../core/executor.js");
const rsync_js_1 = require("../core/rsync.js");
const db_dumps_js_1 = require("../transfer/db-dumps.js");
const nginx_data_js_1 = require("../transfer/nginx-data.js");
const pm2_apps_js_1 = require("../transfer/pm2-apps.js");
const volumes_js_1 = require("../transfer/volumes.js");
const fs_js_1 = require("../utils/fs.js");
const format_js_1 = require("../utils/format.js");
class AggregateTransferProgress {
    total = 1;
    completed = 0;
    active = new Map();
    bar;
    constructor() {
        this.bar = new cliProgress.SingleBar({
            format: 'Transfer [{bar}] {percentage}% | {value}/{total} bytes',
            hideCursor: true,
        }, cliProgress.Presets.shades_classic);
        this.bar.start(this.total, 0);
    }
    setTotal(total) {
        this.total = Math.max(1, total);
        this.bar.setTotal(this.total);
        this.refresh();
    }
    begin(resource) {
        if (!this.active.has(resource)) {
            this.active.set(resource, 0);
            this.refresh();
        }
    }
    update(resource, bytesDone) {
        this.active.set(resource, Math.max(0, bytesDone));
        this.refresh();
    }
    finish(resource, bytesTransferred) {
        this.completed += Math.max(0, bytesTransferred);
        this.active.delete(resource);
        this.refresh();
    }
    addCompleted(bytes) {
        this.completed += Math.max(0, bytes);
        this.refresh();
    }
    stop() {
        this.bar.stop();
    }
    refresh() {
        const activeBytes = [...this.active.values()].reduce((sum, value) => sum + value, 0);
        const value = Math.min(this.total, this.completed + activeBytes);
        this.bar.update(value);
    }
}
async function safeGetSize(targetPath) {
    try {
        if (!(await (0, fs_js_1.fileExists)(targetPath))) {
            return 0;
        }
        return await (0, fs_js_1.getSize)(targetPath);
    }
    catch {
        return 0;
    }
}
async function estimateTotalTransferBytes(manifest, dumpDir, pm2DumpPath) {
    let total = manifest.externalVolumes.reduce((sum, volume) => sum + volume.size, 0);
    for (const project of manifest.dockerProjects) {
        total += await safeGetSize(project.dir);
    }
    for (const app of manifest.pm2Apps) {
        total += await safeGetSize(app.cwd);
    }
    total += await safeGetSize(manifest.nginxProxyManager.dataPath);
    total += await safeGetSize(dumpDir);
    total += await safeGetSize(pm2DumpPath);
    return total;
}
function logTransfer(logger, result) {
    logger.info(`[${result.resource}] transferred ${(0, format_js_1.formatBytes)(result.bytesTransferred)} in ${(0, format_js_1.formatDuration)(result.duration)}`);
}
async function persistTransferResults(ctx, transferResults) {
    const outputPath = node_path_1.default.join(ctx.config.paths.checkpointDir, 'transfer-results.json');
    await (0, fs_js_1.writeJson)(outputPath, transferResults);
}
async function withSSH(ctx, task) {
    await ctx.ssh.connect(ctx.config.destination);
    try {
        return await task();
    }
    finally {
        ctx.ssh.disconnect();
    }
}
async function transferDirectory(resourceName, sourceDir, destinationDir, ctx, state) {
    await withSSH(ctx, async () => {
        const mkdirResult = await ctx.ssh.exec(`mkdir -p ${JSON.stringify(node_path_1.default.dirname(destinationDir))} ${JSON.stringify(destinationDir)}`);
        if (mkdirResult.code !== 0) {
            throw new Error(`Failed to create destination path ${destinationDir}: ${mkdirResult.stderr}`);
        }
    });
    const transfer = new rsync_js_1.RsyncTransfer({
        sourcePath: `${sourceDir}/`,
        destinationHost: ctx.config.destination.host,
        destinationUser: ctx.config.destination.user,
        destinationPort: ctx.config.destination.port,
        destinationPath: `${destinationDir}/`,
        sshKeyPath: ctx.config.destination.sshKeyPath,
        rsyncExtraArgs: ctx.config.transfer.rsyncExtraArgs,
        dryRun: ctx.isDryRun,
    });
    state.progress.begin(resourceName);
    const rsyncResult = await transfer.run((progress) => {
        state.progress.update(resourceName, progress.bytesDone);
    });
    state.progress.finish(resourceName, rsyncResult.bytesTransferred);
    return {
        resource: resourceName,
        bytesTransferred: rsyncResult.bytesTransferred,
        duration: rsyncResult.duration,
        checksumVerified: false,
    };
}
async function loadManifest(ctx) {
    if (ctx.manifest) {
        return ctx.manifest;
    }
    const manifestPath = node_path_1.default.join(ctx.config.paths.checkpointDir, 'manifest.json');
    if (ctx.isDryRun && !(await (0, fs_js_1.fileExists)(manifestPath))) {
        return {
            createdAt: new Date().toISOString(),
            sourceHost: 'dry-run',
            dockerProjects: [],
            externalVolumes: [],
            pm2Apps: [],
            databases: [],
            nginxProxyManager: {
                dataPath: ctx.config.paths.nginxProxyManagerDataPath,
                version: 'dry-run',
                proxyHostCount: 0,
            },
        };
    }
    return (0, fs_js_1.readJson)(manifestPath);
}
async function runPhase3(ctx) {
    const manifest = await loadManifest(ctx);
    const state = {
        manifest,
        transferResults: [],
        progress: new AggregateTransferProgress(),
    };
    const dumpDir = ctx.config.paths.dumpDir || defaults_js_1.DEFAULT_DUMP_DIR;
    const pm2DumpPath = ctx.config.paths.pm2DumpPath;
    const initialTotalBytes = await estimateTotalTransferBytes(state.manifest, dumpDir, pm2DumpPath);
    state.progress.setTotal(initialTotalBytes);
    const steps = [
        {
            id: 'transfer.db-dumps',
            name: 'Dump databases on source',
            run: async () => {
                state.manifest.databases = await (0, db_dumps_js_1.dumpAll)(state.manifest.databases, dumpDir);
                ctx.manifest = state.manifest;
                await (0, fs_js_1.writeJson)(node_path_1.default.join(ctx.config.paths.checkpointDir, 'manifest.json'), state.manifest);
                const refreshedTotal = await estimateTotalTransferBytes(state.manifest, dumpDir, pm2DumpPath);
                state.progress.setTotal(refreshedTotal);
            },
        },
        {
            id: 'transfer.docker-volumes',
            name: 'Transfer Docker volumes',
            run: async () => {
                const results = await withSSH(ctx, async () => (0, volumes_js_1.transferAllVolumes)(state.manifest.externalVolumes, ctx.ssh, ctx.config, ctx.isDryRun, (name, progress) => {
                    const resource = `volume:${name}`;
                    state.progress.begin(resource);
                    state.progress.update(resource, progress.bytesDone);
                }));
                for (const result of results) {
                    state.progress.finish(result.resource, result.bytesTransferred);
                    state.transferResults.push(result);
                    logTransfer(ctx.log, result);
                }
                await persistTransferResults(ctx, state.transferResults);
            },
        },
        {
            id: 'transfer.docker-projects',
            name: 'Transfer Docker project directories',
            run: async () => {
                for (const project of state.manifest.dockerProjects) {
                    const result = await transferDirectory(`compose-project:${project.name}`, project.dir, project.dir, ctx, state);
                    state.transferResults.push(result);
                    logTransfer(ctx.log, result);
                }
                await persistTransferResults(ctx, state.transferResults);
            },
        },
        {
            id: 'transfer.db-dump-files',
            name: 'Transfer DB dump files',
            run: async () => {
                if (!(await (0, fs_js_1.fileExists)(dumpDir))) {
                    return;
                }
                const result = await transferDirectory('db-dumps', dumpDir, dumpDir, ctx, state);
                state.transferResults.push(result);
                logTransfer(ctx.log, result);
                await persistTransferResults(ctx, state.transferResults);
            },
        },
        {
            id: 'transfer.pm2-apps',
            name: 'Transfer PM2 app directories',
            run: async () => {
                const results = await withSSH(ctx, async () => (0, pm2_apps_js_1.transferPM2Apps)(state.manifest.pm2Apps, ctx.ssh, ctx.config, ctx.isDryRun, (appName, progress) => {
                    const resource = `pm2-app:${appName}`;
                    state.progress.begin(resource);
                    state.progress.update(resource, progress.bytesDone);
                }));
                for (const result of results) {
                    state.progress.finish(result.resource, result.bytesTransferred);
                    state.transferResults.push(result);
                    logTransfer(ctx.log, result);
                }
                await persistTransferResults(ctx, state.transferResults);
            },
        },
        {
            id: 'transfer.pm2-ecosystem',
            name: 'Transfer PM2 ecosystem dump',
            run: async () => {
                const result = await withSSH(ctx, async () => (0, pm2_apps_js_1.transferPM2Ecosystem)(pm2DumpPath, ctx.ssh, ctx.config));
                if (!result) {
                    return;
                }
                state.progress.addCompleted(result.bytesTransferred);
                state.transferResults.push(result);
                logTransfer(ctx.log, result);
                await persistTransferResults(ctx, state.transferResults);
            },
        },
        {
            id: 'transfer.nginx-data',
            name: 'Transfer NGINX Proxy Manager data',
            run: async () => {
                const result = await withSSH(ctx, async () => (0, nginx_data_js_1.transferNginxData)(state.manifest.nginxProxyManager, ctx.ssh, ctx.config, ctx.isDryRun, (progress) => {
                    const resource = 'nginx-data';
                    state.progress.begin(resource);
                    state.progress.update(resource, progress.bytesDone);
                }));
                if (!result) {
                    return;
                }
                state.progress.finish(result.resource, result.bytesTransferred);
                state.transferResults.push(result);
                logTransfer(ctx.log, result);
                await persistTransferResults(ctx, state.transferResults);
            },
        },
        {
            id: 'transfer.manifest',
            name: 'Transfer manifest to destination checkpoint dir',
            run: async () => {
                const localManifestPath = node_path_1.default.join(ctx.config.paths.checkpointDir, 'manifest.json');
                await (0, fs_js_1.writeJson)(localManifestPath, state.manifest);
                await withSSH(ctx, async () => {
                    const remoteManifestPath = node_path_1.default.join(ctx.config.paths.checkpointDir, 'manifest.json');
                    const remoteTransferResultsPath = node_path_1.default.join(ctx.config.paths.checkpointDir, 'transfer-results.json');
                    const mkdirResult = await ctx.ssh.exec(`mkdir -p ${JSON.stringify(node_path_1.default.dirname(remoteManifestPath))}`);
                    if (mkdirResult.code !== 0) {
                        throw new Error(`Failed creating destination checkpoint directory: ${mkdirResult.stderr}`);
                    }
                    await ctx.ssh.putFile(localManifestPath, remoteManifestPath);
                    const localTransferResultsPath = node_path_1.default.join(ctx.config.paths.checkpointDir, 'transfer-results.json');
                    if (await (0, fs_js_1.fileExists)(localTransferResultsPath)) {
                        await ctx.ssh.putFile(localTransferResultsPath, remoteTransferResultsPath);
                    }
                });
                const bytesTransferred = await safeGetSize(localManifestPath);
                state.progress.addCompleted(bytesTransferred);
                const manifestTransferResult = {
                    resource: 'manifest',
                    bytesTransferred,
                    duration: 0,
                    checksumVerified: false,
                };
                state.transferResults.push(manifestTransferResult);
                logTransfer(ctx.log, manifestTransferResult);
                await persistTransferResults(ctx, state.transferResults);
            },
        },
    ];
    ctx.checkpoint.phase = 3;
    const runner = new executor_js_1.StepRunner(ctx);
    try {
        await runner.run(steps);
    }
    finally {
        state.progress.stop();
    }
}
