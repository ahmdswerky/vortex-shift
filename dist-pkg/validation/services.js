"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startComposeProjects = startComposeProjects;
exports.startPM2Apps = startPM2Apps;
exports.startNginxProxyManager = startNginxProxyManager;
exports.restoreDatabases = restoreDatabases;
const node_path_1 = __importDefault(require("node:path"));
const defaults_js_1 = require("../config/defaults.js");
const fs_js_1 = require("../utils/fs.js");
const shell_js_1 = require("../utils/shell.js");
const health_js_1 = require("./health.js");
function ok(name, type, healthCheck) {
    return { name, type, status: 'ok', healthCheck };
}
function failed(name, type, healthCheck, error) {
    return { name, type, status: 'failed', healthCheck, error };
}
async function getComposeContainerIds(composeFile) {
    const result = await (0, shell_js_1.run)('docker', ['compose', '-f', composeFile, 'ps', '-q']);
    return result.stdout
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
}
async function waitForComposeHealthy(composeFile, timeoutMs) {
    const containerIds = await getComposeContainerIds(composeFile);
    for (const containerId of containerIds) {
        const healthy = await (0, health_js_1.waitForDockerHealthy)(containerId, timeoutMs);
        if (!healthy) {
            return false;
        }
    }
    return true;
}
async function startComposeProjects(projects) {
    const dbFirst = projects.filter((project) => project.hasDatabase);
    const rest = projects.filter((project) => !project.hasDatabase);
    const ordered = [...dbFirst, ...rest];
    const results = [];
    for (const project of ordered) {
        try {
            await (0, shell_js_1.run)('docker', ['compose', '-f', project.composeFile, 'up', '-d']);
            if (project.hasDatabase) {
                const healthy = await waitForComposeHealthy(project.composeFile, defaults_js_1.HEALTH_CHECK_TIMEOUT_MS);
                if (!healthy) {
                    results.push(failed(project.name, 'docker', 'docker compose health', 'Database containers did not become healthy'));
                    continue;
                }
            }
            results.push(ok(project.name, 'docker', 'docker compose up -d'));
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            results.push(failed(project.name, 'docker', 'docker compose up -d', message));
        }
    }
    return results;
}
async function startPM2Apps(apps) {
    const results = [];
    try {
        await (0, shell_js_1.run)('pm2', ['resurrect']);
    }
    catch (error) {
        if (error instanceof shell_js_1.ShellError) {
            for (const app of apps) {
                try {
                    await (0, shell_js_1.run)('pm2', ['start', app.script, '--name', app.name, '--cwd', app.cwd]);
                }
                catch (startError) {
                    const message = startError instanceof Error ? startError.message : String(startError);
                    results.push(failed(app.name, 'pm2', 'pm2 start fallback', message));
                }
            }
        }
        else {
            throw error;
        }
    }
    let list = [];
    try {
        const jlist = await (0, shell_js_1.run)('pm2', ['jlist']);
        list = JSON.parse(jlist.stdout);
    }
    catch {
        list = [];
    }
    const appStatusByName = new Map();
    if (Array.isArray(list)) {
        for (const item of list) {
            const name = String(item.name ?? '');
            const env = (item.pm2_env ?? {});
            const status = String(env.status ?? 'unknown');
            if (name) {
                appStatusByName.set(name, status);
            }
        }
    }
    for (const app of apps) {
        const status = appStatusByName.get(app.name);
        if (status === 'online') {
            results.push(ok(app.name, 'pm2', 'pm2 status online'));
        }
        else if (!results.some((result) => result.name === app.name && result.type === 'pm2')) {
            results.push(failed(app.name, 'pm2', 'pm2 status online', `Current status: ${status ?? 'unknown'}`));
        }
    }
    return results;
}
async function startNginxProxyManager(snapshot) {
    const primaryComposeFile = node_path_1.default.join(snapshot.dataPath, 'docker-compose.yml');
    const secondaryComposeFile = node_path_1.default.join(snapshot.dataPath, 'compose.yml');
    const composeCandidates = [primaryComposeFile, secondaryComposeFile];
    let composeFile = primaryComposeFile;
    for (const candidate of composeCandidates) {
        if (await (0, fs_js_1.fileExists)(candidate)) {
            composeFile = candidate;
            break;
        }
    }
    try {
        await (0, shell_js_1.run)('docker', ['compose', '-f', composeFile, 'up', '-d']);
        const portReady = await (0, health_js_1.waitForPort)('127.0.0.1', 81, defaults_js_1.HEALTH_CHECK_TIMEOUT_MS);
        if (!portReady) {
            return failed('nginx-proxy-manager', 'nginx', 'port 81 ready', 'NPM admin port did not become ready');
        }
        return ok('nginx-proxy-manager', 'nginx', 'port 81 ready');
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return failed('nginx-proxy-manager', 'nginx', 'docker compose up -d', message);
    }
}
async function restoreDatabases(dbContainers) {
    const results = [];
    for (const db of dbContainers) {
        const dumpFile = db.dumpFile ?? node_path_1.default.join(defaults_js_1.DEFAULT_DUMP_DIR, `${db.containerName}-${db.engine}.sql`);
        try {
            const running = await (0, health_js_1.checkContainerRunning)(db.containerName);
            if (!running) {
                results.push(failed(db.containerName, 'system', 'container running', 'Container is not running'));
                continue;
            }
            if (db.engine === 'postgres') {
                await (0, shell_js_1.run)('sh', [
                    '-c',
                    `docker exec -i ${JSON.stringify(db.containerName)} psql -U postgres < ${JSON.stringify(dumpFile)}`,
                ]);
                results.push(ok(db.containerName, 'system', 'psql restore'));
                continue;
            }
            if (db.engine === 'mysql' || db.engine === 'mariadb') {
                await (0, shell_js_1.run)('sh', [
                    '-c',
                    `docker exec -i ${JSON.stringify(db.containerName)} mysql -uroot < ${JSON.stringify(dumpFile)}`,
                ]);
                results.push(ok(db.containerName, 'system', 'mysql restore'));
                continue;
            }
            if (db.engine === 'redis') {
                await (0, shell_js_1.run)('docker', ['cp', dumpFile, `${db.containerName}:/data/dump.rdb`]);
                await (0, shell_js_1.run)('docker', ['restart', db.containerName]);
                results.push(ok(db.containerName, 'system', 'redis dump restore'));
                continue;
            }
            if (db.engine === 'mongo' || db.engine === 'mongodb') {
                await (0, shell_js_1.run)('sh', [
                    '-c',
                    `docker exec -i ${JSON.stringify(db.containerName)} mongorestore --archive --gzip < ${JSON.stringify(dumpFile)}`,
                ]);
                results.push(ok(db.containerName, 'system', 'mongorestore'));
                continue;
            }
            results.push({
                name: db.containerName,
                type: 'system',
                status: 'warning',
                healthCheck: 'restore skipped',
                error: `No restore automation for engine ${db.engine}`,
            });
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            results.push(failed(db.containerName, 'system', 'database restore', message));
        }
    }
    return results;
}
