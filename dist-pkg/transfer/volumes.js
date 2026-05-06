"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.transferVolume = transferVolume;
exports.transferAllVolumes = transferAllVolumes;
const node_path_1 = __importDefault(require("node:path"));
const rsync_js_1 = require("../core/rsync.js");
function toTransferResult(resource, bytesTransferred, duration) {
    return {
        resource,
        bytesTransferred,
        duration,
        checksumVerified: false,
    };
}
async function transferVolume(volume, ssh, config, isDryRun, onProgress) {
    const remotePath = volume.mountpoint;
    const remoteParent = node_path_1.default.dirname(remotePath);
    const mkdirResult = await ssh.exec(`mkdir -p ${JSON.stringify(remoteParent)} ${JSON.stringify(remotePath)}`);
    if (mkdirResult.code !== 0) {
        throw new Error(`Failed to create destination directory for volume ${volume.name}: ${mkdirResult.stderr}`);
    }
    const transfer = new rsync_js_1.RsyncTransfer({
        sourcePath: `${volume.mountpoint}/`,
        destinationHost: config.destination.host,
        destinationUser: config.destination.user,
        destinationPort: config.destination.port,
        destinationPath: `${remotePath}/`,
        sshKeyPath: config.destination.sshKeyPath,
        rsyncExtraArgs: config.transfer.rsyncExtraArgs,
        dryRun: isDryRun,
    });
    const result = await transfer.run(onProgress);
    return toTransferResult(`volume:${volume.name}`, result.bytesTransferred, result.duration);
}
async function transferAllVolumes(volumes, ssh, config, isDryRun, onProgress) {
    const results = [];
    for (const volume of volumes) {
        const result = await transferVolume(volume, ssh, config, isDryRun, (progress) => {
            onProgress?.(volume.name, progress);
        });
        results.push(result);
    }
    return results;
}
