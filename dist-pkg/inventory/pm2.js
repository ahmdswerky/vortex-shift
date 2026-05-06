"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.discoverPM2Apps = discoverPM2Apps;
const shell_js_1 = require("../utils/shell.js");
function toPM2App(item) {
    const env = item.pm2_env ?? {};
    const name = item.name ?? env.name ?? 'unknown';
    const script = env.pm_exec_path ?? '';
    const cwd = env.pm_cwd ?? '';
    return {
        name,
        script,
        cwd,
        pm2Id: typeof item.pm_id === 'number' ? item.pm_id : -1,
        status: env.status ?? 'unknown',
        ecosystemEntry: `${name}:${script}`,
    };
}
async function discoverPM2Apps(onWarn) {
    try {
        const listResult = await (0, shell_js_1.run)('pm2', ['jlist']);
        let parsed;
        try {
            parsed = JSON.parse(listResult.stdout);
        }
        catch {
            parsed = [];
        }
        if (!Array.isArray(parsed)) {
            return [];
        }
        try {
            await (0, shell_js_1.run)('pm2', ['save']);
        }
        catch {
            // best effort: inventory still valid without forcing save
        }
        return parsed.map((item) => toPM2App(item));
    }
    catch (error) {
        if (error instanceof shell_js_1.ShellError) {
            onWarn?.('PM2 not found; PM2 inventory will be empty.');
            return [];
        }
        throw error;
    }
}
