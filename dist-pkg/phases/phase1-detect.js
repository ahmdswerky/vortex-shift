"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runPhase1 = runPhase1;
const node_path_1 = __importDefault(require("node:path"));
const promises_1 = require("node:fs/promises");
const defaults_js_1 = require("../config/defaults.js");
const executor_js_1 = require("../core/executor.js");
const ssh_js_1 = require("../core/ssh.js");
const fs_js_1 = require("../utils/fs.js");
const prompt_js_1 = require("../utils/prompt.js");
const shell_js_1 = require("../utils/shell.js");
const format_js_1 = require("../utils/format.js");
function parseOsRelease(contents) {
    const result = {};
    for (const line of contents.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) {
            continue;
        }
        const index = trimmed.indexOf('=');
        if (index === -1) {
            continue;
        }
        const key = trimmed.slice(0, index).trim();
        const rawValue = trimmed.slice(index + 1).trim();
        const value = rawValue.replace(/^"/, '').replace(/"$/, '');
        result[key] = value;
    }
    return result;
}
function parseNodeMajor(version) {
    const match = version.trim().match(/^v(\d+)\./);
    if (!match?.[1]) {
        return null;
    }
    return Number.parseInt(match[1], 10);
}
async function sleep(ms) {
    await new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}
async function safeFindComposeFiles(basePath) {
    try {
        const result = await (0, shell_js_1.run)('find', [
            basePath,
            '-type',
            'f',
            '(',
            '-name',
            'docker-compose.yml',
            '-o',
            '-name',
            'docker-compose.yaml',
            '-o',
            '-name',
            'compose.yml',
            '-o',
            '-name',
            'compose.yaml',
            ')',
        ], { reject: true });
        return result.stdout
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line.length > 0);
    }
    catch (error) {
        if (error instanceof shell_js_1.ShellError) {
            return error.stdout
                .split('\n')
                .map((line) => line.trim())
                .filter((line) => line.length > 0);
        }
        return [];
    }
}
async function estimateTransferSizeBytes(ctx) {
    let total = 0;
    const countedPaths = new Set();
    try {
        const volumes = await (0, shell_js_1.run)('docker', ['volume', 'ls', '--format', '{{.Name}}']);
        const volumeNames = volumes.stdout
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line.length > 0);
        for (const volumeName of volumeNames) {
            try {
                const inspect = await (0, shell_js_1.run)('docker', ['volume', 'inspect', volumeName, '--format', '{{.Mountpoint}}']);
                const mountpoint = inspect.stdout.trim();
                if (!mountpoint || countedPaths.has(mountpoint)) {
                    continue;
                }
                if (!(await (0, fs_js_1.fileExists)(mountpoint))) {
                    continue;
                }
                total += await (0, fs_js_1.getSize)(mountpoint);
                countedPaths.add(mountpoint);
            }
            catch {
                continue;
            }
        }
    }
    catch {
        ctx.log.warn('Could not estimate Docker volume sizes; continuing with partial estimate');
    }
    const projectDirs = new Set();
    for (const searchPath of defaults_js_1.COMPOSE_SEARCH_PATHS) {
        if (!(await (0, fs_js_1.fileExists)(searchPath))) {
            continue;
        }
        const composeFiles = await safeFindComposeFiles(searchPath);
        for (const composeFile of composeFiles) {
            projectDirs.add(node_path_1.default.dirname(composeFile));
        }
    }
    for (const projectDir of projectDirs) {
        if (countedPaths.has(projectDir)) {
            continue;
        }
        try {
            if (await (0, fs_js_1.fileExists)(projectDir)) {
                total += await (0, fs_js_1.getSize)(projectDir);
                countedPaths.add(projectDir);
            }
        }
        catch {
            continue;
        }
    }
    const dumpDir = ctx.config.paths.dumpDir || defaults_js_1.DEFAULT_DUMP_DIR;
    if (!countedPaths.has(dumpDir) && (await (0, fs_js_1.fileExists)(dumpDir))) {
        try {
            total += await (0, fs_js_1.getSize)(dumpDir);
        }
        catch {
            // ignore
        }
    }
    return total;
}
function parseAvailableBytesFromDf(output) {
    const lines = output
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
    if (lines.length === 0) {
        return null;
    }
    const last = lines[lines.length - 1] ?? '';
    const numeric = last.replace(/[^\d]/g, '');
    if (!numeric) {
        return null;
    }
    return Number.parseInt(numeric, 10);
}
async function runPhase1(ctx) {
    const phaseState = {
        requiresSSHSetup: false,
        sshKeyPath: null,
    };
    const steps = [
        {
            id: 'detect.os',
            name: 'Verify Rocky Linux environment',
            run: async () => {
                const osReleaseContent = await (0, promises_1.readFile)('/etc/os-release', 'utf8');
                const osRelease = parseOsRelease(osReleaseContent);
                const id = (osRelease.ID ?? '').toLowerCase();
                const idLike = (osRelease.ID_LIKE ?? '').toLowerCase();
                const prettyName = osRelease.PRETTY_NAME ?? osRelease.NAME ?? 'Unknown Linux';
                if (id !== 'rocky' && !idLike.includes('rhel')) {
                    throw new Error(`Unsupported operating system: ${prettyName}. Vortex Shift requires Rocky Linux (or RHEL-compatible distro).`);
                }
                ctx.log.info(`OS detected: ${prettyName}`);
            },
        },
        {
            id: 'detect.docker',
            name: 'Detect Docker and Docker Compose',
            run: async () => {
                const dockerVersion = await (0, shell_js_1.run)('docker', ['--version']);
                const composeVersion = await (0, shell_js_1.run)('docker', ['compose', 'version']);
                await (0, shell_js_1.run)('docker', ['info']);
                ctx.log.info(`Docker: ${dockerVersion.stdout.trim()}`);
                ctx.log.info(`Docker Compose: ${composeVersion.stdout.trim()}`);
            },
        },
        {
            id: 'detect.pm2',
            name: 'Detect PM2',
            run: async () => {
                try {
                    const pm2Version = await (0, shell_js_1.run)('pm2', ['--version']);
                    ctx.log.info(`PM2: ${pm2Version.stdout.trim()}`);
                }
                catch (error) {
                    if (error instanceof shell_js_1.ShellError) {
                        ctx.log.warn('PM2 not found. Continuing without PM2 app migration support.');
                        return;
                    }
                    throw error;
                }
            },
        },
        {
            id: 'detect.node',
            name: 'Detect Node.js',
            run: async () => {
                const nodeVersion = await (0, shell_js_1.run)('node', ['--version']);
                const version = nodeVersion.stdout.trim();
                const major = parseNodeMajor(version);
                ctx.log.info(`Node.js: ${version}`);
                if (major !== null && major < 18) {
                    ctx.log.warn(`Node.js ${version} detected. Node 18+ is recommended.`);
                }
            },
        },
        {
            id: 'detect.rsync',
            name: 'Detect rsync',
            run: async () => {
                if (ctx.mode !== 'source') {
                    ctx.log.info('Skipping strict rsync requirement on destination mode');
                    return;
                }
                try {
                    const rsyncVersion = await (0, shell_js_1.run)('rsync', ['--version']);
                    const firstLine = rsyncVersion.stdout.split('\n')[0]?.trim() ?? 'rsync detected';
                    ctx.log.info(firstLine);
                }
                catch (error) {
                    if (error instanceof shell_js_1.ShellError) {
                        throw new Error('rsync is required on source server. Install it with: dnf install rsync');
                    }
                    throw error;
                }
            },
        },
        {
            id: 'detect.ssh-keys',
            name: 'Detect existing SSH keys',
            run: async () => {
                if (ctx.mode !== 'source') {
                    ctx.log.info('Skipping SSH key detection in destination mode');
                    return;
                }
                const keyPath = await (0, ssh_js_1.detectSSHKey)();
                phaseState.sshKeyPath = keyPath;
                if (keyPath) {
                    ctx.config.destination.sshKeyPath = keyPath;
                    phaseState.requiresSSHSetup = false;
                    ctx.log.info(`Using SSH key: ${keyPath}`);
                }
                else {
                    phaseState.requiresSSHSetup = true;
                    ctx.log.warn('No SSH key found in ~/.ssh. SSH setup required.');
                }
            },
        },
        {
            id: 'detect.ssh-setup',
            name: 'Setup SSH key if missing',
            run: async () => {
                if (ctx.mode !== 'source') {
                    ctx.log.info('Skipping SSH key setup in destination mode');
                    return;
                }
                if (!phaseState.requiresSSHSetup) {
                    ctx.log.info('SSH key exists; skipping key generation step');
                    return;
                }
                const generated = await (0, ssh_js_1.generateSSHKey)();
                phaseState.sshKeyPath = generated.privateKeyPath;
                ctx.config.destination.sshKeyPath = generated.privateKeyPath;
                (0, ssh_js_1.displayPublicKey)(generated.publicKey);
                await (0, prompt_js_1.pause)('Add this key to destination ~/.ssh/authorized_keys, then press Enter');
                ctx.log.info(`Generated SSH key: ${generated.privateKeyPath}`);
            },
        },
        {
            id: 'detect.ssh-test',
            name: 'Test SSH connectivity to destination',
            run: async () => {
                if (ctx.mode !== 'source') {
                    ctx.log.info('Skipping SSH connectivity test in destination mode');
                    return;
                }
                const keyPath = phaseState.sshKeyPath ?? ctx.config.destination.sshKeyPath;
                if (!keyPath) {
                    throw new Error('No SSH key path available for SSH connectivity test.');
                }
                const sshConfig = {
                    ...ctx.config.destination,
                    sshKeyPath: keyPath,
                };
                let lastError;
                const maxAttempts = 3;
                for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
                    try {
                        await ctx.ssh.connect(sshConfig);
                        const result = await ctx.ssh.exec('echo "vortex-ok"');
                        if (result.code !== 0 || result.stdout.trim() !== 'vortex-ok') {
                            throw new Error(`SSH command check failed (code=${result.code}, stdout="${result.stdout.trim()}", stderr="${result.stderr.trim()}")`);
                        }
                        ctx.log.success('SSH connectivity verified');
                        ctx.ssh.disconnect();
                        return;
                    }
                    catch (error) {
                        lastError = error;
                        ctx.ssh.disconnect();
                        if (attempt < maxAttempts) {
                            ctx.log.warn(`SSH test failed (attempt ${attempt}/${maxAttempts}). Retrying in 10s...`);
                            await sleep(10_000);
                        }
                    }
                }
                const manualCommand = `ssh -i ${keyPath} -p ${ctx.config.destination.port} ` +
                    `${ctx.config.destination.user}@${ctx.config.destination.host} 'echo "vortex-ok"'`;
                ctx.log.error(`Manual SSH test command: ${manualCommand}`);
                ctx.log.error('If this fails, verify destination firewall, sshd service, and authorized_keys.');
                throw new Error(`SSH connectivity test failed after ${maxAttempts} attempts: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
            },
            retries: 0,
        },
        {
            id: 'detect.disk-space',
            name: 'Check destination disk headroom',
            run: async () => {
                if (ctx.mode !== 'source') {
                    ctx.log.info('Skipping destination disk headroom check in destination mode');
                    return;
                }
                const keyPath = phaseState.sshKeyPath ?? ctx.config.destination.sshKeyPath;
                if (!keyPath) {
                    throw new Error('No SSH key path available for disk space check.');
                }
                await ctx.ssh.connect({
                    ...ctx.config.destination,
                    sshKeyPath: keyPath,
                });
                const estimatedBytes = await estimateTransferSizeBytes(ctx);
                const dfTargetPath = ctx.config.paths.dumpDir || '/tmp';
                try {
                    const dfResult = await ctx.ssh.exec(`df -B1 --output=avail ${dfTargetPath} | tail -n 1`);
                    if (dfResult.code !== 0) {
                        throw new Error(`Failed to read destination free space: ${dfResult.stderr}`);
                    }
                    const availableBytes = parseAvailableBytesFromDf(dfResult.stdout);
                    if (availableBytes === null) {
                        throw new Error(`Could not parse destination free space from: ${dfResult.stdout}`);
                    }
                    ctx.log.info(`Estimated transfer size: ${(0, format_js_1.formatBytes)(estimatedBytes)}`);
                    ctx.log.info(`Destination free space: ${(0, format_js_1.formatBytes)(availableBytes)}`);
                    const remainingBytes = availableBytes - estimatedBytes;
                    const headroomRatio = availableBytes > 0 ? remainingBytes / availableBytes : 0;
                    if (headroomRatio < 0.05) {
                        throw new Error(`Destination headroom would be below 5% after transfer (estimated). Free up disk before continuing.`);
                    }
                    if (headroomRatio < 0.2) {
                        ctx.log.warn(`Destination headroom below 20% after transfer estimate. Migration may run out of space.`);
                    }
                }
                finally {
                    ctx.ssh.disconnect();
                }
            },
        },
    ];
    ctx.checkpoint.phase = 1;
    const runner = new executor_js_1.StepRunner(ctx);
    await runner.run(steps);
}
