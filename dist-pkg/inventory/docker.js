"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.discoverComposeProjects = discoverComposeProjects;
exports.getRunningContainers = getRunningContainers;
exports.getContainerDetails = getContainerDetails;
const node_path_1 = __importDefault(require("node:path"));
const promises_1 = require("node:fs/promises");
const shell_js_1 = require("../utils/shell.js");
const fs_js_1 = require("../utils/fs.js");
const DB_IMAGE_HINTS = [
    'postgres',
    'mysql',
    'mariadb',
    'redis',
    'mongo',
    'elasticsearch',
];
function parseTopLevelComposeName(content) {
    const match = content.match(/^\s*name:\s*["']?([^"'\n#]+)["']?\s*$/m);
    return match?.[1]?.trim() ?? null;
}
function includesKnownDatabaseImage(text) {
    const lower = text.toLowerCase();
    return DB_IMAGE_HINTS.some((keyword) => lower.includes(keyword));
}
function extractServicesFromComposeText(content) {
    const lines = content.split('\n');
    const services = [];
    let inServices = false;
    let servicesIndent = -1;
    for (const line of lines) {
        const raw = line.replace(/\t/g, '  ');
        const trimmed = raw.trim();
        if (!trimmed || trimmed.startsWith('#')) {
            continue;
        }
        const indent = raw.length - raw.trimStart().length;
        if (!inServices && /^services:\s*$/.test(trimmed)) {
            inServices = true;
            servicesIndent = indent;
            continue;
        }
        if (!inServices) {
            continue;
        }
        if (indent <= servicesIndent) {
            break;
        }
        const serviceMatch = raw.match(/^\s{2,}([a-zA-Z0-9_.-]+):\s*$/);
        if (serviceMatch?.[1] && indent === servicesIndent + 2) {
            services.push(serviceMatch[1]);
        }
    }
    return [...new Set(services)];
}
async function findComposeFilesInPath(searchPath) {
    if (!(await (0, fs_js_1.fileExists)(searchPath))) {
        return [];
    }
    const result = await (0, shell_js_1.run)('find', [
        searchPath,
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
        '-not',
        '-path',
        '/proc/*',
        '-not',
        '-path',
        '/sys/*',
        '-not',
        '-path',
        '/dev/*',
        '-not',
        '-path',
        '/run/*',
    ]);
    return result.stdout
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
}
async function getComposeServices(composeFile, content) {
    try {
        const result = await (0, shell_js_1.run)('docker', ['compose', '-f', composeFile, 'config', '--services']);
        const services = result.stdout
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line.length > 0);
        if (services.length > 0) {
            return services;
        }
    }
    catch (error) {
        if (!(error instanceof shell_js_1.ShellError)) {
            throw error;
        }
    }
    return extractServicesFromComposeText(content);
}
async function discoverComposeProjects(searchPaths) {
    const composeFiles = new Set();
    for (const searchPath of searchPaths) {
        const files = await findComposeFilesInPath(searchPath);
        for (const file of files) {
            composeFiles.add(file);
        }
    }
    const projects = [];
    for (const composeFile of composeFiles) {
        const composeDir = node_path_1.default.dirname(composeFile);
        const content = await (0, promises_1.readFile)(composeFile, 'utf8');
        const services = await getComposeServices(composeFile, content);
        let hasDatabase = includesKnownDatabaseImage(content);
        try {
            const renderedConfig = await (0, shell_js_1.run)('docker', ['compose', '-f', composeFile, 'config']);
            hasDatabase = includesKnownDatabaseImage(renderedConfig.stdout);
        }
        catch (error) {
            if (!(error instanceof shell_js_1.ShellError)) {
                throw error;
            }
        }
        const name = parseTopLevelComposeName(content) ?? node_path_1.default.basename(composeDir);
        projects.push({
            name,
            dir: composeDir,
            composeFile,
            services,
            hasDatabase,
        });
    }
    return projects.sort((a, b) => a.name.localeCompare(b.name));
}
async function getRunningContainers() {
    const result = await (0, shell_js_1.run)('docker', ['ps', '--format', '{{json .}}']);
    const containers = [];
    const lines = result.stdout
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
    for (const line of lines) {
        const parsed = JSON.parse(line);
        containers.push({
            id: String(parsed.ID ?? ''),
            name: String(parsed.Names ?? ''),
            image: String(parsed.Image ?? ''),
            status: String(parsed.Status ?? ''),
            state: String(parsed.State ?? ''),
            labels: String(parsed.Labels ?? ''),
        });
    }
    return containers;
}
async function getContainerDetails(name) {
    const result = await (0, shell_js_1.run)('docker', ['inspect', name]);
    const parsed = JSON.parse(result.stdout);
    if (!Array.isArray(parsed) || parsed.length === 0) {
        throw new Error(`No docker inspect data returned for container: ${name}`);
    }
    const first = parsed[0];
    if (!first || typeof first !== 'object') {
        throw new Error(`Invalid docker inspect payload for container: ${name}`);
    }
    return first;
}
