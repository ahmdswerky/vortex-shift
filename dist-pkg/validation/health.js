"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.waitForPort = waitForPort;
exports.httpGet = httpGet;
exports.waitForHttp = waitForHttp;
exports.waitForDockerHealthy = waitForDockerHealthy;
exports.checkContainerRunning = checkContainerRunning;
const node_net_1 = __importDefault(require("node:net"));
const defaults_js_1 = require("../config/defaults.js");
const shell_js_1 = require("../utils/shell.js");
function sleep(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}
async function waitForPort(host, port, timeoutMs, pollIntervalMs = defaults_js_1.HEALTH_CHECK_POLL_INTERVAL_MS) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const ok = await new Promise((resolve) => {
            const socket = node_net_1.default.createConnection({ host, port });
            const done = (value) => {
                socket.removeAllListeners();
                socket.destroy();
                resolve(value);
            };
            socket.setTimeout(Math.min(5_000, pollIntervalMs));
            socket.once('connect', () => done(true));
            socket.once('error', () => done(false));
            socket.once('timeout', () => done(false));
        });
        if (ok) {
            return true;
        }
        await sleep(pollIntervalMs);
    }
    return false;
}
async function httpGet(url, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => {
        controller.abort();
    }, timeoutMs);
    try {
        const response = await fetch(url, {
            method: 'GET',
            signal: controller.signal,
        });
        return response.status;
    }
    finally {
        clearTimeout(timer);
    }
}
async function waitForHttp(url, expectedStatus, timeoutMs, pollIntervalMs = defaults_js_1.HEALTH_CHECK_POLL_INTERVAL_MS) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        try {
            const status = await httpGet(url, pollIntervalMs);
            if (status === expectedStatus) {
                return true;
            }
        }
        catch {
            // keep polling
        }
        await sleep(pollIntervalMs);
    }
    return false;
}
function parseDockerHealth(stdout) {
    return stdout.trim().toLowerCase();
}
async function waitForDockerHealthy(containerName, timeoutMs, pollIntervalMs = defaults_js_1.HEALTH_CHECK_POLL_INTERVAL_MS) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        try {
            const result = await (0, shell_js_1.run)('docker', [
                'inspect',
                '--format',
                '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}',
                containerName,
            ]);
            const status = parseDockerHealth(result.stdout);
            if (status === 'healthy' || status === 'running') {
                return true;
            }
        }
        catch (error) {
            if (!(error instanceof shell_js_1.ShellError)) {
                throw error;
            }
        }
        await sleep(pollIntervalMs);
    }
    return false;
}
async function checkContainerRunning(containerName) {
    try {
        const result = await (0, shell_js_1.run)('docker', [
            'inspect',
            '--format',
            '{{if .State.Running}}true{{else}}false{{end}}',
            containerName,
        ]);
        return result.stdout.trim() === 'true';
    }
    catch (error) {
        if (error instanceof shell_js_1.ShellError) {
            return false;
        }
        throw error;
    }
}
