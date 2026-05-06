"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runPhase2 = runPhase2;
const node_path_1 = __importDefault(require("node:path"));
const defaults_js_1 = require("../config/defaults.js");
const executor_js_1 = require("../core/executor.js");
const databases_js_1 = require("../inventory/databases.js");
const docker_js_1 = require("../inventory/docker.js");
const nginx_js_1 = require("../inventory/nginx.js");
const pm2_js_1 = require("../inventory/pm2.js");
const volumes_js_1 = require("../inventory/volumes.js");
const format_js_1 = require("../utils/format.js");
const fs_js_1 = require("../utils/fs.js");
const prompt_js_1 = require("../utils/prompt.js");
const shell_js_1 = require("../utils/shell.js");
async function getSourceHost() {
    try {
        const fqdn = await (0, shell_js_1.run)('hostname', ['-f']);
        const value = fqdn.stdout.trim();
        if (value.length > 0) {
            return value;
        }
    }
    catch {
        // fallback below
    }
    const host = await (0, shell_js_1.run)('hostname', []);
    return host.stdout.trim();
}
async function estimateProjectSizes(projectDirs) {
    let total = 0;
    for (const dir of projectDirs) {
        try {
            total += await (0, fs_js_1.getSize)(dir);
        }
        catch {
            continue;
        }
    }
    return total;
}
async function runPhase2(ctx) {
    const state = {
        manifest: null,
        warnings: [],
        totalEstimatedBytes: 0,
    };
    const steps = [
        {
            id: 'inventory.docker-projects',
            name: 'Inventory Docker Compose projects',
            run: async () => {
                const projects = await (0, docker_js_1.discoverComposeProjects)(defaults_js_1.COMPOSE_SEARCH_PATHS);
                const host = await getSourceHost();
                state.manifest = {
                    createdAt: new Date().toISOString(),
                    sourceHost: host,
                    dockerProjects: projects,
                    externalVolumes: [],
                    pm2Apps: [],
                    databases: [],
                    nginxProxyManager: {
                        dataPath: ctx.config.paths.nginxProxyManagerDataPath || defaults_js_1.DEFAULT_NPM_DATA_PATH,
                        version: 'unknown',
                        proxyHostCount: 0,
                    },
                };
            },
        },
        {
            id: 'inventory.docker-volumes',
            name: 'Inventory external Docker volumes',
            run: async () => {
                if (!state.manifest) {
                    throw new Error('Manifest not initialized before volume inventory');
                }
                state.manifest.externalVolumes = await (0, volumes_js_1.discoverExternalVolumes)();
            },
        },
        {
            id: 'inventory.pm2-apps',
            name: 'Inventory PM2 apps',
            run: async () => {
                if (!state.manifest) {
                    throw new Error('Manifest not initialized before PM2 inventory');
                }
                state.manifest.pm2Apps = await (0, pm2_js_1.discoverPM2Apps)((message) => {
                    state.warnings.push(message);
                    ctx.log.warn(message);
                });
            },
        },
        {
            id: 'inventory.db-containers',
            name: 'Inventory database containers',
            run: async () => {
                if (!state.manifest) {
                    throw new Error('Manifest not initialized before database inventory');
                }
                const running = await (0, docker_js_1.getRunningContainers)();
                state.manifest.databases = await (0, databases_js_1.identifyDatabaseContainers)(running);
            },
        },
        {
            id: 'inventory.nginx',
            name: 'Inventory NGINX Proxy Manager',
            run: async () => {
                if (!state.manifest) {
                    throw new Error('Manifest not initialized before NGINX inventory');
                }
                state.manifest.nginxProxyManager = await (0, nginx_js_1.snapshotNginxProxyManager)(ctx.config.paths.nginxProxyManagerDataPath);
            },
        },
        {
            id: 'inventory.save-manifest',
            name: 'Save inventory manifest',
            run: async () => {
                if (!state.manifest) {
                    throw new Error('Manifest not available for save');
                }
                const manifestPath = node_path_1.default.join(ctx.config.paths.checkpointDir, 'manifest.json');
                await (0, fs_js_1.writeJson)(manifestPath, state.manifest);
                ctx.manifest = state.manifest;
                ctx.log.info(`Manifest saved to ${manifestPath}`);
            },
        },
        {
            id: 'inventory.display-summary',
            name: 'Display inventory summary',
            run: async () => {
                if (!state.manifest) {
                    throw new Error('Manifest not available for summary');
                }
                const volumeBytes = state.manifest.externalVolumes.reduce((sum, volume) => sum + volume.size, 0);
                const projectBytes = await estimateProjectSizes(state.manifest.dockerProjects.map((project) => project.dir));
                state.totalEstimatedBytes = volumeBytes + projectBytes;
                const unlinkedVolumes = state.manifest.externalVolumes.filter((volume) => !volume.linkedProject);
                if (unlinkedVolumes.length > 0) {
                    state.warnings.push(`${unlinkedVolumes.length} external volume(s) are not linked to a compose project`);
                }
                const rows = [
                    { resource: 'Docker projects', count: state.manifest.dockerProjects.length },
                    { resource: 'External volumes', count: state.manifest.externalVolumes.length },
                    { resource: 'PM2 apps', count: state.manifest.pm2Apps.length },
                    { resource: 'DB containers', count: state.manifest.databases.length },
                    {
                        resource: 'NGINX Proxy Manager',
                        count: state.manifest.nginxProxyManager.version === 'not-running' ? 0 : 1,
                    },
                ];
                ctx.log.info(`\n${(0, format_js_1.formatTable)(rows, [
                    { key: 'resource', header: 'Resource' },
                    { key: 'count', header: 'Count' },
                ])}`);
                ctx.log.info(`Estimated transfer size: ${(0, format_js_1.formatBytes)(state.totalEstimatedBytes)}`);
                ctx.log.info(`NPM proxy hosts: ${state.manifest.nginxProxyManager.proxyHostCount}`);
                if (state.warnings.length > 0) {
                    ctx.log.warn(`Inventory warnings:\n${(0, format_js_1.formatList)(state.warnings)}`);
                }
            },
        },
        {
            id: 'inventory.confirm',
            name: 'Confirm inventory before transfer',
            run: async () => {
                const proceed = await (0, prompt_js_1.confirm)('Inventory complete. Proceed to transfer phase?', true);
                if (!proceed) {
                    throw new Error('Migration stopped by user after inventory review.');
                }
            },
        },
    ];
    ctx.checkpoint.phase = 2;
    const runner = new executor_js_1.StepRunner(ctx);
    await runner.run(steps);
}
