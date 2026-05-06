"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SSHClient = exports.SSHError = void 0;
exports.detectSSHKey = detectSSHKey;
exports.generateSSHKey = generateSSHKey;
exports.displayPublicKey = displayPublicKey;
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const node_fs_1 = require("node:fs");
const node_ssh_1 = require("node-ssh");
const shell_js_1 = require("../utils/shell.js");
const SSH_KEY_CANDIDATES = ['id_ed25519', 'id_rsa', 'id_ecdsa'];
class SSHError extends Error {
    cause;
    constructor(message, cause) {
        super(message);
        this.name = 'SSHError';
        this.cause = cause;
    }
}
exports.SSHError = SSHError;
async function detectSSHKey() {
    const sshDir = node_path_1.default.join(node_os_1.default.homedir(), '.ssh');
    for (const candidate of SSH_KEY_CANDIDATES) {
        const candidatePath = node_path_1.default.join(sshDir, candidate);
        try {
            const stat = await node_fs_1.promises.stat(candidatePath);
            if (stat.isFile()) {
                return candidatePath;
            }
        }
        catch {
            continue;
        }
    }
    return null;
}
async function generateSSHKey() {
    const sshDir = node_path_1.default.join(node_os_1.default.homedir(), '.ssh');
    const privateKeyPath = node_path_1.default.join(sshDir, 'id_ed25519');
    const publicKeyPath = `${privateKeyPath}.pub`;
    await node_fs_1.promises.mkdir(sshDir, { recursive: true });
    await (0, shell_js_1.run)('ssh-keygen', ['-t', 'ed25519', '-f', privateKeyPath, '-N', '']);
    const publicKey = (await node_fs_1.promises.readFile(publicKeyPath, 'utf8')).trim();
    return { privateKeyPath, publicKey };
}
function displayPublicKey(pubKey) {
    const lines = [
        '',
        '================== SSH Public Key ==================',
        pubKey,
        '====================================================',
        'Add this key to destination ~/.ssh/authorized_keys',
        '',
    ];
    process.stdout.write(`${lines.join('\n')}\n`);
}
class SSHClient {
    client = new node_ssh_1.NodeSSH();
    connected = false;
    dryRun = false;
    lastConfig = null;
    setDryRun(dryRun) {
        this.dryRun = dryRun;
    }
    manualSshHint(command = 'echo "vortex-ok"') {
        if (!this.lastConfig) {
            return 'Manual SSH test: ssh -i ~/.ssh/id_ed25519 -p 22 user@host \'echo "vortex-ok"\'';
        }
        return (`Manual SSH test: ssh -i ${this.lastConfig.sshKeyPath} -p ${this.lastConfig.port} ` +
            `${this.lastConfig.user}@${this.lastConfig.host} '${command}'`);
    }
    async connect(config) {
        this.lastConfig = config;
        if (this.dryRun) {
            process.stdout.write(`[dry-run][ssh] connect ${config.user}@${config.host}:${config.port} key=${config.sshKeyPath}\n`);
            this.connected = true;
            return;
        }
        try {
            await this.client.connect({
                host: config.host,
                username: config.user,
                port: config.port,
                privateKeyPath: config.sshKeyPath,
            });
            this.connected = true;
        }
        catch (error) {
            throw new SSHError(`Failed to connect to ${config.user}@${config.host}:${config.port}. ${this.manualSshHint()}`, error);
        }
    }
    async exec(command) {
        this.assertConnected();
        if (this.dryRun) {
            process.stdout.write(`[dry-run][ssh] exec ${command}\n`);
            return { stdout: '', stderr: '', code: 0 };
        }
        try {
            const result = await this.client.execCommand(command);
            const code = typeof result.code === 'number' ? result.code : 1;
            if (code !== 0) {
                throw new SSHError(`Remote command exited with code ${code}: ${command}. ${this.manualSshHint(command)}`);
            }
            return {
                stdout: result.stdout,
                stderr: result.stderr,
                code,
            };
        }
        catch (error) {
            if (error instanceof SSHError) {
                throw error;
            }
            throw new SSHError(`Remote command failed: ${command}. ${this.manualSshHint(command)}`, error);
        }
    }
    async execStream(command, onData) {
        this.assertConnected();
        if (this.dryRun) {
            process.stdout.write(`[dry-run][ssh] execStream ${command}\n`);
            return { stdout: '', stderr: '', code: 0 };
        }
        try {
            let stdout = '';
            let stderr = '';
            const result = await this.client.execCommand(command, {
                onStdout(chunk) {
                    const data = chunk.toString('utf8');
                    stdout += data;
                    onData({ stream: 'stdout', data });
                },
                onStderr(chunk) {
                    const data = chunk.toString('utf8');
                    stderr += data;
                    onData({ stream: 'stderr', data });
                },
            });
            const code = typeof result.code === 'number' ? result.code : 1;
            if (code !== 0) {
                throw new SSHError(`Remote streamed command exited with code ${code}: ${command}. ${this.manualSshHint(command)}`);
            }
            return {
                stdout,
                stderr,
                code,
            };
        }
        catch (error) {
            if (error instanceof SSHError) {
                throw error;
            }
            throw new SSHError(`Remote streamed command failed: ${command}. ${this.manualSshHint(command)}`, error);
        }
    }
    async putFile(localPath, remotePath) {
        this.assertConnected();
        if (this.dryRun) {
            process.stdout.write(`[dry-run][ssh] putFile ${localPath} -> ${remotePath}\n`);
            return;
        }
        try {
            await this.client.putFile(localPath, remotePath);
        }
        catch (error) {
            throw new SSHError(`Failed uploading ${localPath} to ${remotePath}. ${this.manualSshHint()}`, error);
        }
    }
    async getFile(remotePath, localPath) {
        this.assertConnected();
        if (this.dryRun) {
            process.stdout.write(`[dry-run][ssh] getFile ${remotePath} -> ${localPath}\n`);
            return;
        }
        try {
            await this.client.getFile(localPath, remotePath);
        }
        catch (error) {
            throw new SSHError(`Failed downloading ${remotePath} to ${localPath}. ${this.manualSshHint()}`, error);
        }
    }
    disconnect() {
        this.client.dispose();
        this.connected = false;
    }
    assertConnected() {
        if (!this.connected) {
            throw new SSHError('SSH client is not connected');
        }
    }
}
exports.SSHClient = SSHClient;
