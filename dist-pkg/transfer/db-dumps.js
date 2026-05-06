"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.dumpPostgres = dumpPostgres;
exports.dumpMySQL = dumpMySQL;
exports.dumpRedis = dumpRedis;
exports.dumpMongo = dumpMongo;
exports.dumpAll = dumpAll;
const node_path_1 = __importDefault(require("node:path"));
const p_limit_1 = __importDefault(require("p-limit"));
const fs_js_1 = require("../utils/fs.js");
const shell_js_1 = require("../utils/shell.js");
function shellQuote(value) {
    return `'${value.replaceAll("'", "'\"'\"'")}'`;
}
async function waitForRedisSave(container, baseline) {
    const maxAttempts = 60;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        const nowRaw = await (0, shell_js_1.run)('docker', ['exec', container, 'redis-cli', 'LASTSAVE']);
        const now = Number.parseInt(nowRaw.stdout.trim(), 10);
        if (Number.isFinite(now) && now > baseline) {
            return;
        }
        await new Promise((resolve) => {
            setTimeout(resolve, 1_000);
        });
    }
    throw new Error(`Timed out waiting for Redis BGSAVE completion for container ${container}`);
}
async function dumpPostgres(container, destDir) {
    const outputFile = node_path_1.default.join(destDir, `${container.containerName}-postgres.sql`);
    await (0, shell_js_1.run)('sh', [
        '-c',
        `docker exec ${shellQuote(container.containerName)} pg_dumpall -U postgres > ${shellQuote(outputFile)}`,
    ]);
    return outputFile;
}
async function dumpMySQL(container, destDir) {
    const outputFile = node_path_1.default.join(destDir, `${container.containerName}-${container.engine}.sql`);
    const password = container.credentials?.MYSQL_ROOT_PASSWORD;
    const passwordEnv = password ? `-e MYSQL_PWD=${shellQuote(password)}` : '';
    await (0, shell_js_1.run)('sh', [
        '-c',
        `docker exec ${passwordEnv} ${shellQuote(container.containerName)} mysqldump --all-databases -uroot > ${shellQuote(outputFile)}`,
    ]);
    return outputFile;
}
async function dumpRedis(container, destDir) {
    const outputFile = node_path_1.default.join(destDir, `${container.containerName}-redis.rdb`);
    const baselineRaw = await (0, shell_js_1.run)('docker', ['exec', container.containerName, 'redis-cli', 'LASTSAVE']);
    const baseline = Number.parseInt(baselineRaw.stdout.trim(), 10);
    await (0, shell_js_1.run)('docker', ['exec', container.containerName, 'redis-cli', 'BGSAVE']);
    await waitForRedisSave(container.containerName, Number.isFinite(baseline) ? baseline : 0);
    await (0, shell_js_1.run)('docker', ['cp', `${container.containerName}:/data/dump.rdb`, outputFile]);
    return outputFile;
}
async function dumpMongo(container, destDir) {
    const outputFile = node_path_1.default.join(destDir, `${container.containerName}-mongo.archive.gz`);
    await (0, shell_js_1.run)('sh', [
        '-c',
        `docker exec ${shellQuote(container.containerName)} mongodump --archive --gzip > ${shellQuote(outputFile)}`,
    ]);
    return outputFile;
}
async function dumpAll(dbContainers, destDir) {
    await (0, fs_js_1.ensureDir)(destDir);
    const limit = (0, p_limit_1.default)(2);
    await Promise.all(dbContainers.map((dbContainer) => limit(async () => {
        if (dbContainer.engine === 'postgres') {
            dbContainer.dumpFile = await dumpPostgres(dbContainer, destDir);
            return;
        }
        if (dbContainer.engine === 'mysql' || dbContainer.engine === 'mariadb') {
            dbContainer.dumpFile = await dumpMySQL(dbContainer, destDir);
            return;
        }
        if (dbContainer.engine === 'redis') {
            dbContainer.dumpFile = await dumpRedis(dbContainer, destDir);
            return;
        }
        if (dbContainer.engine === 'mongo' || dbContainer.engine === 'mongodb') {
            dbContainer.dumpFile = await dumpMongo(dbContainer, destDir);
            return;
        }
        delete dbContainer.dumpFile;
    })));
    return dbContainers;
}
