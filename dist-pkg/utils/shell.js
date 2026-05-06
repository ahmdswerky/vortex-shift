"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ShellError = void 0;
exports.run = run;
exports.runStream = runStream;
const execa_1 = require("execa");
const ANSI_REGEX = 
// biome-ignore lint/suspicious/noControlCharactersInRegex: needed for ANSI stripping
/\u001B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;
class ShellError extends Error {
    command;
    args;
    stdout;
    stderr;
    exitCode;
    constructor(command, args, message, stdout, stderr, exitCode) {
        super(message);
        this.name = 'ShellError';
        this.command = command;
        this.args = args;
        this.stdout = stdout;
        this.stderr = stderr;
        this.exitCode = exitCode;
    }
}
exports.ShellError = ShellError;
function stripAnsi(input) {
    return input.replace(ANSI_REGEX, '');
}
function toText(value) {
    if (typeof value === 'string') {
        return value;
    }
    if (value instanceof Uint8Array) {
        return Buffer.from(value).toString('utf8');
    }
    if (Array.isArray(value)) {
        return value.map((item) => String(item)).join('\n');
    }
    if (value === undefined || value === null) {
        return '';
    }
    return String(value);
}
function toShellError(error, command, args, fallbackMessage) {
    const err = error;
    const stdout = stripAnsi(err.stdout ?? '');
    const stderr = stripAnsi(err.stderr ?? '');
    const exitCode = typeof err.exitCode === 'number' ? err.exitCode : 1;
    return new ShellError(command, args, err.message ?? fallbackMessage, stdout, stderr, exitCode);
}
async function run(command, args = [], opts = {}) {
    const { timeoutMs, ...execaOpts } = opts;
    try {
        const options = timeoutMs === undefined
            ? {
                ...execaOpts,
                reject: true,
                encoding: 'utf8',
            }
            : {
                ...execaOpts,
                reject: true,
                encoding: 'utf8',
                timeout: timeoutMs,
            };
        const result = await (0, execa_1.execa)(command, args, {
            ...options,
        });
        return {
            stdout: stripAnsi(toText(result.stdout)),
            stderr: stripAnsi(toText(result.stderr)),
            exitCode: result.exitCode ?? 0,
        };
    }
    catch (error) {
        throw toShellError(error, command, args, `Command failed: ${command}`);
    }
}
async function runStream(command, args = [], onData, opts = {}) {
    const { timeoutMs, ...execaOpts } = opts;
    try {
        const options = timeoutMs === undefined
            ? {
                ...execaOpts,
                all: false,
                reject: false,
                encoding: 'utf8',
            }
            : {
                ...execaOpts,
                all: false,
                reject: false,
                encoding: 'utf8',
                timeout: timeoutMs,
            };
        const subprocess = (0, execa_1.execa)(command, args, {
            ...options,
        });
        if (subprocess.stdout) {
            subprocess.stdout.setEncoding('utf8');
            subprocess.stdout.on('data', (data) => {
                onData({
                    stream: 'stdout',
                    data: stripAnsi(data),
                });
            });
        }
        if (subprocess.stderr) {
            subprocess.stderr.setEncoding('utf8');
            subprocess.stderr.on('data', (data) => {
                onData({
                    stream: 'stderr',
                    data: stripAnsi(data),
                });
            });
        }
        const result = await subprocess;
        const stdout = stripAnsi(toText(result.stdout));
        const stderr = stripAnsi(toText(result.stderr));
        const exitCode = result.exitCode ?? 1;
        if (exitCode !== 0) {
            throw new ShellError(command, args, `Command failed: ${command}`, stdout, stderr, exitCode);
        }
        return {
            stdout,
            stderr,
            exitCode,
        };
    }
    catch (error) {
        if (error instanceof ShellError) {
            throw error;
        }
        throw toShellError(error, command, args, `Command failed: ${command}`);
    }
}
