"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.readJson = readJson;
exports.writeJson = writeJson;
exports.ensureDir = ensureDir;
exports.fileExists = fileExists;
exports.expandHome = expandHome;
exports.getSize = getSize;
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const node_fs_1 = require("node:fs");
const fs_extra_1 = __importDefault(require("fs-extra"));
async function readJson(filePath, schema) {
    const value = (await fs_extra_1.default.readJson(filePath));
    if (!schema) {
        return value;
    }
    return schema.parse(value);
}
async function writeJson(filePath, data) {
    const tmpPath = `${filePath}.tmp`;
    await fs_extra_1.default.ensureDir(node_path_1.default.dirname(filePath));
    await fs_extra_1.default.writeJson(tmpPath, data, { spaces: 2 });
    await node_fs_1.promises.rename(tmpPath, filePath);
}
async function ensureDir(dirPath) {
    await fs_extra_1.default.ensureDir(dirPath);
}
async function fileExists(filePath) {
    return fs_extra_1.default.pathExists(filePath);
}
function expandHome(inputPath) {
    if (inputPath === '~') {
        return node_os_1.default.homedir();
    }
    if (inputPath.startsWith('~/')) {
        return node_path_1.default.join(node_os_1.default.homedir(), inputPath.slice(2));
    }
    return inputPath;
}
async function getSize(targetPath) {
    const stats = await node_fs_1.promises.lstat(targetPath);
    if (!stats.isDirectory()) {
        return stats.size;
    }
    const entries = await node_fs_1.promises.readdir(targetPath, { withFileTypes: true });
    let total = 0;
    for (const entry of entries) {
        const entryPath = node_path_1.default.join(targetPath, entry.name);
        if (entry.isDirectory()) {
            total += await getSize(entryPath);
            continue;
        }
        const entryStats = await node_fs_1.promises.lstat(entryPath);
        total += entryStats.size;
    }
    return total;
}
