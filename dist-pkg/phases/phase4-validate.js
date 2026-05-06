"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runPhase4 = runPhase4;
const node_path_1 = __importDefault(require("node:path"));
const defaults_js_1 = require("../config/defaults.js");
const reporter_js_1 = require("../core/reporter.js");
const executor_js_1 = require("../core/executor.js");
const fs_js_1 = require("../utils/fs.js");
const shell_js_1 = require("../utils/shell.js");
const checksums_js_1 = require("../validation/checksums.js");
const health_js_1 = require("../validation/health.js");
const services_js_1 = require("../validation/services.js");
function toTransferPathCandidates(manifest) {
    const paths = new Set();
    for (const volume of manifest.externalVolumes) {
        paths.add(volume.mountpoint);
    }
    for (const project of manifest.dockerProjects) {
        paths.add(project.dir);
    }
    for (const app of manifest.pm2Apps) {
        paths.add(app.cwd);
    }
    for (const db of manifest.databases) {
        if (db.dumpFile) {
            paths.add(db.dumpFile);
        }
    }
    paths.add(manifest.nginxProxyManager.dataPath);
    return [...paths];
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
async function loadTransferResults(ctx) {
    const transferFilePath = node_path_1.default.join(ctx.config.paths.checkpointDir, 'transfer-results.json');
    if (!(await (0, fs_js_1.fileExists)(transferFilePath))) {
        return [];
    }
    return (0, fs_js_1.readJson)(transferFilePath);
}
async function getComposeContainerIds(composeFile) {
    const result = await (0, shell_js_1.run)('docker', ['compose', '-f', composeFile, 'ps', '-q']);
    return result.stdout
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
}
async function runPhase4(ctx) {
    const manifest = await loadManifest(ctx);
    const transferResults = await loadTransferResults(ctx);
    const state = {
        manifest,
        transferResults,
        serviceResults: [],
        warnings: [],
        errors: [],
    };
    const checksumsPath = node_path_1.default.join(ctx.config.paths.checkpointDir, 'checksums.json');
    const steps = [
        {
            id: 'validate.checksums',
            name: 'Verify checksums',
            run: async () => {
                const targetPaths = toTransferPathCandidates(state.manifest);
                if (!(await (0, fs_js_1.fileExists)(checksumsPath))) {
                    const generated = await (0, checksums_js_1.buildChecksumManifest)(targetPaths);
                    await (0, checksums_js_1.saveChecksumManifest)(checksumsPath, generated);
                    state.warnings.push('No source checksum manifest found; generated destination baseline only.');
                    return;
                }
                const manifestChecksums = await (0, checksums_js_1.loadChecksumManifest)(checksumsPath);
                const result = await (0, checksums_js_1.verifyChecksums)(manifestChecksums, targetPaths);
                if (!result.ok) {
                    const errors = result.mismatches.map((item) => `Checksum mismatch for ${item.path}: expected=${item.expected} actual=${item.actual}`);
                    state.errors.push(...errors);
                    throw new Error(`Checksum verification failed for ${result.mismatches.length} path(s)`);
                }
            },
        },
        {
            id: 'validate.docker-volumes',
            name: 'Validate destination Docker volumes',
            run: async () => {
                for (const volume of state.manifest.externalVolumes) {
                    const inspectResult = await (0, shell_js_1.run)('docker', [
                        'volume',
                        'inspect',
                        '--format',
                        '{{.Mountpoint}}',
                        volume.name,
                    ]);
                    const mountpoint = inspectResult.stdout.trim();
                    if (!mountpoint) {
                        throw new Error(`Volume missing on destination: ${volume.name}`);
                    }
                    const existence = await (0, shell_js_1.run)('sh', ['-c', `[ -d ${JSON.stringify(mountpoint)} ] && echo yes || echo no`]);
                    if (existence.stdout.trim() !== 'yes') {
                        throw new Error(`Volume mountpoint missing for ${volume.name}: ${mountpoint}`);
                    }
                    const nonEmpty = await (0, shell_js_1.run)('sh', [
                        '-c',
                        `[ "$(ls -A ${JSON.stringify(mountpoint)} 2>/dev/null | wc -l)" -gt 0 ] && echo yes || echo no`,
                    ]);
                    if (nonEmpty.stdout.trim() !== 'yes') {
                        throw new Error(`Volume mountpoint is empty for ${volume.name}: ${mountpoint}`);
                    }
                }
            },
        },
        {
            id: 'validate.db-restore',
            name: 'Restore databases',
            run: async () => {
                const results = await (0, services_js_1.restoreDatabases)(state.manifest.databases);
                state.serviceResults.push(...results);
            },
        },
        {
            id: 'validate.compose-up',
            name: 'Start compose projects',
            run: async () => {
                const results = await (0, services_js_1.startComposeProjects)(state.manifest.dockerProjects);
                state.serviceResults.push(...results);
            },
        },
        {
            id: 'validate.compose-health',
            name: 'Validate compose container health',
            run: async () => {
                for (const project of state.manifest.dockerProjects) {
                    const containerIds = await getComposeContainerIds(project.composeFile);
                    for (const containerId of containerIds) {
                        const healthy = await (0, health_js_1.waitForDockerHealthy)(containerId, defaults_js_1.HEALTH_CHECK_TIMEOUT_MS);
                        if (!healthy) {
                            throw new Error(`Container did not become healthy: ${containerId} (${project.name})`);
                        }
                    }
                }
            },
        },
        {
            id: 'validate.pm2-restore',
            name: 'Restore PM2 apps',
            run: async () => {
                const results = await (0, services_js_1.startPM2Apps)(state.manifest.pm2Apps);
                state.serviceResults.push(...results);
            },
        },
        {
            id: 'validate.nginx-restore',
            name: 'Restore NGINX Proxy Manager',
            run: async () => {
                const result = await (0, services_js_1.startNginxProxyManager)(state.manifest.nginxProxyManager);
                state.serviceResults.push(result);
            },
        },
        {
            id: 'validate.service-health',
            name: 'Run configured HTTP health checks',
            run: async () => {
                for (const healthCheck of ctx.config.healthChecks) {
                    const ok = await (0, health_js_1.waitForHttp)(healthCheck.url, 200, healthCheck.timeout || defaults_js_1.HEALTH_CHECK_TIMEOUT_MS, defaults_js_1.HEALTH_CHECK_POLL_INTERVAL_MS);
                    if (ok) {
                        state.serviceResults.push({
                            name: healthCheck.name,
                            type: 'system',
                            status: 'ok',
                            healthCheck: healthCheck.url,
                        });
                    }
                    else {
                        state.serviceResults.push({
                            name: healthCheck.name,
                            type: 'system',
                            status: 'failed',
                            healthCheck: healthCheck.url,
                            error: 'Timed out waiting for expected HTTP 200',
                        });
                    }
                }
            },
        },
        {
            id: 'validate.report',
            name: 'Generate final migration report',
            run: async () => {
                const report = (0, reporter_js_1.buildReport)(ctx, state.serviceResults, state.transferResults, state.warnings, state.errors);
                (0, reporter_js_1.printReport)(report, ctx.log);
                await (0, reporter_js_1.saveReport)(report, (0, reporter_js_1.defaultReportPath)(ctx));
            },
        },
    ];
    ctx.checkpoint.phase = 4;
    const runner = new executor_js_1.StepRunner(ctx);
    await runner.run(steps);
}
