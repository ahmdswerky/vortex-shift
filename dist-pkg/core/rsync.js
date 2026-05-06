"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RsyncTransfer = void 0;
const shell_js_1 = require("../utils/shell.js");
const defaults_js_1 = require("../config/defaults.js");
const NUMBER_WITH_COMMAS = /[\d,]+/;
function parseInteger(input) {
    return Number.parseInt(input.replaceAll(',', ''), 10);
}
class RsyncTransfer {
    options;
    constructor(options) {
        this.options = options;
    }
    async run(onProgress) {
        const errors = [];
        const startedAt = Date.now();
        let currentFile = '';
        let bytesDone = 0;
        let bytesTotal = 0;
        let speedMBps = 0;
        let etaSeconds = 0;
        let filesTransferred = 0;
        let bytesTransferred = 0;
        const sshArgs = `ssh -p ${this.options.destinationPort} -i ${this.options.sshKeyPath}`;
        const args = [
            ...defaults_js_1.RSYNC_BASE_ARGS,
            '--stats',
            ...(this.options.rsyncExtraArgs ?? []),
            '-e',
            sshArgs,
            this.options.sourcePath,
            `${this.options.destinationUser}@${this.options.destinationHost}:${this.options.destinationPath}`,
        ];
        if (this.options.dryRun) {
            process.stdout.write(`[dry-run][rsync] rsync ${args.join(' ')}\n`);
            return {
                bytesTransferred: 0,
                duration: 0,
                filesTransferred: 0,
                errors: [],
            };
        }
        const emit = () => {
            onProgress?.({
                file: currentFile,
                bytesDone,
                bytesTotal,
                speedMBps,
                etaSeconds,
            });
        };
        try {
            await (0, shell_js_1.runStream)('rsync', args, ({ stream, data }) => {
                const text = data.replaceAll('\r', '\n');
                const lines = text
                    .split('\n')
                    .map((line) => line.trim())
                    .filter((line) => line.length > 0);
                for (const line of lines) {
                    if (stream === 'stderr') {
                        errors.push(line);
                        continue;
                    }
                    if (!line.startsWith('sending incremental file list') &&
                        !line.includes('bytes/sec') &&
                        !line.includes('speedup is')) {
                        const isProgressLine = line.includes('%') && line.includes('to-check=');
                        if (!isProgressLine) {
                            currentFile = line;
                            filesTransferred += 1;
                        }
                    }
                    const progressMatch = line.match(new RegExp(`(${NUMBER_WITH_COMMAS.source})\\s+(\\d+)%\\s+(${NUMBER_WITH_COMMAS.source}\\.\\d+[kMG]?B/s|${NUMBER_WITH_COMMAS.source}[kMG]?B/s)\\s+(\\d+:\\d+:\\d+|\\d+:\\d+)\\s+\\(xfr#\\d+,\\s*to-check=\\d+/\\d+\\)`));
                    if (progressMatch) {
                        bytesDone = parseInteger(progressMatch[1] ?? '0');
                        const speedToken = progressMatch[3] ?? '0B/s';
                        const normalized = speedToken.toUpperCase();
                        if (normalized.endsWith('GB/S')) {
                            speedMBps = Number.parseFloat(normalized.replace('GB/S', '')) * 1024;
                        }
                        else if (normalized.endsWith('MB/S')) {
                            speedMBps = Number.parseFloat(normalized.replace('MB/S', ''));
                        }
                        else if (normalized.endsWith('KB/S')) {
                            speedMBps = Number.parseFloat(normalized.replace('KB/S', '')) / 1024;
                        }
                        else {
                            speedMBps = Number.parseFloat(normalized.replace('B/S', '')) / (1024 * 1024);
                        }
                        const etaToken = progressMatch[4] ?? '0:00';
                        const etaParts = etaToken.split(':').map((part) => Number.parseInt(part, 10));
                        if (etaParts.length === 2) {
                            etaSeconds = (etaParts[0] ?? 0) * 60 + (etaParts[1] ?? 0);
                        }
                        else if (etaParts.length === 3) {
                            etaSeconds =
                                (etaParts[0] ?? 0) * 3600 + (etaParts[1] ?? 0) * 60 + (etaParts[2] ?? 0);
                        }
                        emit();
                    }
                    const totalSizeMatch = line.match(new RegExp(`total size is\\s+(${NUMBER_WITH_COMMAS.source})`, 'i'));
                    if (totalSizeMatch) {
                        bytesTotal = parseInteger(totalSizeMatch[1] ?? '0');
                    }
                    const transferredMatch = line.match(new RegExp(`Total transferred file size:\\s+(${NUMBER_WITH_COMMAS.source})\\s+bytes`, 'i'));
                    if (transferredMatch) {
                        bytesTransferred = parseInteger(transferredMatch[1] ?? '0');
                    }
                }
            }, { reject: true });
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(`${message}. You can resume transfer with: vortex-shift source --resume`);
        }
        const duration = Date.now() - startedAt;
        return {
            bytesTransferred: bytesTransferred || bytesDone,
            duration,
            filesTransferred,
            errors,
        };
    }
}
exports.RsyncTransfer = RsyncTransfer;
