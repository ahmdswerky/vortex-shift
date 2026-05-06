"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.discoverExternalVolumes = discoverExternalVolumes;
const defaults_js_1 = require("../config/defaults.js");
const shell_js_1 = require("../utils/shell.js");
const docker_js_1 = require("./docker.js");
const ANONYMOUS_VOLUME_NAME_REGEX = /^[a-f0-9]{64}$/;
function parseDuSize(output) {
    const token = output.trim().split(/\s+/)[0] ?? '0';
    const size = Number.parseInt(token, 10);
    return Number.isFinite(size) ? size : 0;
}
function isInsideDirectory(target, parent) {
    return target === parent || target.startsWith(`${parent}/`);
}
async function discoverExternalVolumes() {
    const composeProjects = await (0, docker_js_1.discoverComposeProjects)(defaults_js_1.COMPOSE_SEARCH_PATHS);
    const projectDirs = composeProjects.map((project) => project.dir);
    const listResult = await (0, shell_js_1.run)('docker', ['volume', 'ls', '--format', '{{.Name}}']);
    const allNames = listResult.stdout
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .filter((name) => !ANONYMOUS_VOLUME_NAME_REGEX.test(name));
    const volumes = [];
    for (const volumeName of allNames) {
        const inspectResult = await (0, shell_js_1.run)('docker', ['volume', 'inspect', volumeName]);
        const inspectPayload = JSON.parse(inspectResult.stdout);
        if (!Array.isArray(inspectPayload) || inspectPayload.length === 0) {
            continue;
        }
        const inspect = inspectPayload[0];
        const mountpoint = inspect.Mountpoint ?? '';
        const driver = inspect.Driver ?? 'local';
        const labels = inspect.Labels ?? {};
        const linkedProject = labels['com.docker.compose.project'];
        const insideProjectDir = projectDirs.some((dir) => isInsideDirectory(mountpoint, dir));
        if (insideProjectDir) {
            continue;
        }
        let size = 0;
        try {
            const duResult = await (0, shell_js_1.run)('du', ['-sb', mountpoint]);
            size = parseDuSize(duResult.stdout);
        }
        catch {
            size = 0;
        }
        const baseVolume = {
            name: inspect.Name ?? volumeName,
            driver,
            mountpoint,
            size,
        };
        volumes.push(linkedProject ? { ...baseVolume, linkedProject } : baseVolume);
    }
    return volumes.sort((a, b) => a.name.localeCompare(b.name));
}
