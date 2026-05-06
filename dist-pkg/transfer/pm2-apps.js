"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.transferPM2Apps = transferPM2Apps;
exports.transferPM2Ecosystem = transferPM2Ecosystem;
const node_path_1 = __importDefault(require("node:path"));
const promises_1 = require("node:fs/promises");
const rsync_js_1 = require("../core/rsync.js");
const fs_js_1 = require("../utils/fs.js");
function toTransferResult(resource, bytesTransferred, duration) {
    return {
        resource,
        bytesTransferred,
        duration,
        checksumVerified: false,
    };
}
async function transferPM2Apps(apps, ssh, config, isDryRun, onProgress) {
    const results = [];
    for (const app of apps) {
        if (!(await (0, fs_js_1.fileExists)(app.cwd))) {
            continue;
        }
        const remoteDir = app.cwd;
        const remoteParent = node_path_1.default.dirname(remoteDir);
        const mkdirResult = await ssh.exec(`mkdir -p ${JSON.stringify(remoteParent)} ${JSON.stringify(remoteDir)}`);
        if (mkdirResult.code !== 0) {
            throw new Error(`Failed to create destination PM2 directory for ${app.name}: ${mkdirResult.stderr}`);
        }
        const transfer = new rsync_js_1.RsyncTransfer({
            sourcePath: `${app.cwd}/`,
            destinationHost: config.destination.host,
            destinationUser: config.destination.user,
            destinationPort: config.destination.port,
            destinationPath: `${remoteDir}/`,
            sshKeyPath: config.destination.sshKeyPath,
            rsyncExtraArgs: config.transfer.rsyncExtraArgs,
            dryRun: isDryRun,
        });
        const rsyncResult = await transfer.run((progress) => {
            onProgress?.(app.name, progress);
        });
        results.push(toTransferResult(`pm2-app:${app.name}`, rsyncResult.bytesTransferred, rsyncResult.duration));
    }
    return results;
}
async function transferPM2Ecosystem(dumpPath, ssh, _config) {
    if (!(await (0, fs_js_1.fileExists)(dumpPath))) {
        return null;
    }
    const start = Date.now();
    const remoteParent = node_path_1.default.dirname(dumpPath);
    const mkdirResult = await ssh.exec(`mkdir -p ${JSON.stringify(remoteParent)}`);
    if (mkdirResult.code !== 0) {
        throw new Error(`Failed to create destination PM2 dump directory: ${mkdirResult.stderr}`);
    }
    await ssh.putFile(dumpPath, dumpPath);
    const bytesTransferred = (await (0, promises_1.stat)(dumpPath)).size;
    return toTransferResult('pm2-ecosystem', bytesTransferred, Date.now() - start);
}
