"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.transferNginxData = transferNginxData;
const node_path_1 = __importDefault(require("node:path"));
const rsync_js_1 = require("../core/rsync.js");
const fs_js_1 = require("../utils/fs.js");
async function transferNginxData(snapshot, ssh, config, isDryRun, onProgress) {
    if (!(await (0, fs_js_1.fileExists)(snapshot.dataPath))) {
        return null;
    }
    const remoteDir = snapshot.dataPath;
    const remoteParent = node_path_1.default.dirname(remoteDir);
    const mkdirResult = await ssh.exec(`mkdir -p ${JSON.stringify(remoteParent)} ${JSON.stringify(remoteDir)}`);
    if (mkdirResult.code !== 0) {
        throw new Error(`Failed to create destination NPM directory: ${mkdirResult.stderr}`);
    }
    const transfer = new rsync_js_1.RsyncTransfer({
        sourcePath: `${snapshot.dataPath}/`,
        destinationHost: config.destination.host,
        destinationUser: config.destination.user,
        destinationPort: config.destination.port,
        destinationPath: `${remoteDir}/`,
        sshKeyPath: config.destination.sshKeyPath,
        rsyncExtraArgs: config.transfer.rsyncExtraArgs,
        dryRun: isDryRun,
    });
    const rsyncResult = await transfer.run(onProgress);
    return {
        resource: 'nginx-data',
        bytesTransferred: rsyncResult.bytesTransferred,
        duration: rsyncResult.duration,
        checksumVerified: false,
    };
}
