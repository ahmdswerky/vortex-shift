"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.migrationConfigSchema = exports.healthCheckConfigSchema = exports.transferConfigSchema = exports.sshConfigSchema = void 0;
const zod_1 = require("zod");
exports.sshConfigSchema = zod_1.z.object({
    host: zod_1.z.string().min(1, 'destination.host is required'),
    user: zod_1.z.string().min(1, 'destination.user is required'),
    port: zod_1.z.number().int().positive(),
    sshKeyPath: zod_1.z.string().min(1, 'destination.sshKeyPath is required'),
});
exports.transferConfigSchema = zod_1.z.object({
    retries: zod_1.z.number().int().min(0),
    concurrency: zod_1.z.number().int().positive(),
    rsyncExtraArgs: zod_1.z.array(zod_1.z.string()),
    excludePaths: zod_1.z.array(zod_1.z.string()),
});
exports.healthCheckConfigSchema = zod_1.z.object({
    name: zod_1.z.string().min(1),
    url: zod_1.z.string().url(),
    timeout: zod_1.z.number().int().positive(),
});
exports.migrationConfigSchema = zod_1.z.object({
    destination: exports.sshConfigSchema,
    transfer: exports.transferConfigSchema,
    healthChecks: zod_1.z.array(exports.healthCheckConfigSchema),
    paths: zod_1.z.object({
        dumpDir: zod_1.z.string().min(1),
        checkpointDir: zod_1.z.string().min(1),
        logFile: zod_1.z.string().min(1),
        nginxProxyManagerDataPath: zod_1.z.string().min(1),
        pm2DumpPath: zod_1.z.string().min(1),
    }),
    verbose: zod_1.z.boolean(),
});
