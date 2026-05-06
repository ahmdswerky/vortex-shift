"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.snapshotNginxProxyManager = snapshotNginxProxyManager;
const node_path_1 = __importDefault(require("node:path"));
const promises_1 = require("node:fs/promises");
const defaults_js_1 = require("../config/defaults.js");
const fs_js_1 = require("../utils/fs.js");
const docker_js_1 = require("./docker.js");
function parseImageVersion(image) {
    const parts = image.split(':');
    if (parts.length < 2) {
        return 'unknown';
    }
    return parts[parts.length - 1] || 'unknown';
}
async function findProxyHostDir(basePath) {
    const candidates = [node_path_1.default.join(basePath, 'data', 'nginx', 'proxy_host'), node_path_1.default.join(basePath, 'nginx', 'proxy_host')];
    for (const candidate of candidates) {
        if (await (0, fs_js_1.fileExists)(candidate)) {
            return candidate;
        }
    }
    return null;
}
async function snapshotNginxProxyManager(dataPath = defaults_js_1.DEFAULT_NPM_DATA_PATH) {
    const containers = await (0, docker_js_1.getRunningContainers)();
    const npmContainer = containers.find((container) => {
        const image = container.image.toLowerCase();
        const name = container.name.toLowerCase();
        return image.includes('nginx-proxy-manager') || name.includes('nginx-proxy-manager');
    });
    const resolvedDataPath = dataPath;
    const proxyHostDir = await findProxyHostDir(resolvedDataPath);
    let proxyHostCount = 0;
    if (proxyHostDir) {
        const entries = await (0, promises_1.readdir)(proxyHostDir, { withFileTypes: true });
        proxyHostCount = entries.filter((entry) => entry.isFile()).length;
    }
    return {
        dataPath: resolvedDataPath,
        version: npmContainer ? parseImageVersion(npmContainer.image) : 'not-running',
        proxyHostCount,
    };
}
