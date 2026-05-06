"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.checksumFile = checksumFile;
exports.checksumDir = checksumDir;
exports.buildChecksumManifest = buildChecksumManifest;
exports.verifyChecksums = verifyChecksums;
exports.saveChecksumManifest = saveChecksumManifest;
exports.loadChecksumManifest = loadChecksumManifest;
const node_crypto_1 = require("node:crypto");
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const node_fs_2 = require("node:fs");
const fs_js_1 = require("../utils/fs.js");
async function getFileChecksum(filePath) {
    const hash = (0, node_crypto_1.createHash)('sha256');
    await new Promise((resolve, reject) => {
        const stream = (0, node_fs_1.createReadStream)(filePath);
        stream.on('data', (chunk) => {
            hash.update(chunk);
        });
        stream.on('error', reject);
        stream.on('end', resolve);
    });
    return hash.digest('hex');
}
async function collectFilesRecursively(dirPath) {
    const entries = await node_fs_2.promises.readdir(dirPath, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
        const fullPath = node_path_1.default.join(dirPath, entry.name);
        if (entry.isDirectory()) {
            files.push(...(await collectFilesRecursively(fullPath)));
            continue;
        }
        if (entry.isFile()) {
            files.push(fullPath);
        }
    }
    return files;
}
async function checksumFile(filePath) {
    return getFileChecksum(filePath);
}
async function checksumDir(dirPath) {
    const files = (await collectFilesRecursively(dirPath)).sort((a, b) => a.localeCompare(b));
    const treeHash = (0, node_crypto_1.createHash)('sha256');
    for (const filePath of files) {
        const relativePath = node_path_1.default.relative(dirPath, filePath);
        const fileHash = await getFileChecksum(filePath);
        treeHash.update(`${relativePath}:${fileHash}\n`);
    }
    return treeHash.digest('hex');
}
async function buildChecksumManifest(paths) {
    const entries = {};
    for (const targetPath of paths) {
        if (!(await (0, fs_js_1.fileExists)(targetPath))) {
            continue;
        }
        const stats = await node_fs_2.promises.lstat(targetPath);
        if (stats.isDirectory()) {
            entries[targetPath] = await checksumDir(targetPath);
            continue;
        }
        if (stats.isFile()) {
            entries[targetPath] = await checksumFile(targetPath);
        }
    }
    return {
        createdAt: new Date().toISOString(),
        entries,
    };
}
async function verifyChecksums(manifest, paths) {
    const mismatches = [];
    const targetPaths = paths ?? Object.keys(manifest.entries);
    for (const targetPath of targetPaths) {
        const expected = manifest.entries[targetPath];
        if (!expected) {
            continue;
        }
        if (!(await (0, fs_js_1.fileExists)(targetPath))) {
            mismatches.push({
                path: targetPath,
                expected,
                actual: 'MISSING',
            });
            continue;
        }
        const stats = await node_fs_2.promises.lstat(targetPath);
        const actual = stats.isDirectory()
            ? await checksumDir(targetPath)
            : stats.isFile()
                ? await checksumFile(targetPath)
                : 'UNSUPPORTED';
        if (actual !== expected) {
            mismatches.push({
                path: targetPath,
                expected,
                actual,
            });
        }
    }
    return {
        ok: mismatches.length === 0,
        checked: targetPaths.length,
        mismatches,
    };
}
async function saveChecksumManifest(filePath, manifest) {
    await (0, fs_js_1.writeJson)(filePath, manifest);
}
async function loadChecksumManifest(filePath) {
    return (0, fs_js_1.readJson)(filePath);
}
