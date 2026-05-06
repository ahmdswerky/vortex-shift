"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildReport = buildReport;
exports.printReport = printReport;
exports.saveReport = saveReport;
exports.defaultReportPath = defaultReportPath;
const node_path_1 = __importDefault(require("node:path"));
const format_js_1 = require("../utils/format.js");
const fs_js_1 = require("../utils/fs.js");
function reportStatus(serviceResults, warnings, errors) {
    const hasFailedService = serviceResults.some((service) => service.status === 'failed');
    if (hasFailedService || errors.length > 0) {
        return 'failed';
    }
    if (warnings.length > 0 || serviceResults.some((service) => service.status === 'warning')) {
        return 'partial';
    }
    return 'success';
}
function buildReport(ctx, serviceResults, transferResults, warnings = [], errors = []) {
    const startedAt = ctx.checkpoint.startedAt;
    const endedAt = new Date().toISOString();
    return {
        id: `migration-${Date.now()}`,
        startedAt,
        endedAt,
        sourceHost: ctx.manifest?.sourceHost ?? 'unknown-source',
        destinationHost: ctx.config.destination.host,
        status: reportStatus(serviceResults, warnings, errors),
        transferResults,
        serviceResults,
        warnings,
        errors,
    };
}
function printReport(report, log) {
    const durationMs = new Date(report.endedAt).getTime() - new Date(report.startedAt).getTime();
    const transferRows = report.transferResults.map((row) => ({
        resource: row.resource,
        size: (0, format_js_1.formatBytes)(row.bytesTransferred),
        duration: (0, format_js_1.formatDuration)(row.duration),
        checksum: row.checksumVerified ? 'yes' : 'no',
    }));
    const serviceRows = report.serviceResults.map((row) => ({
        name: row.name,
        type: row.type,
        status: row.status,
        health: row.healthCheck,
    }));
    log.info(`Migration Report (${report.status})`);
    log.info(`Source -> Destination: ${report.sourceHost} -> ${report.destinationHost}`);
    log.info(`Started: ${(0, format_js_1.formatDate)(report.startedAt)}`);
    log.info(`Ended: ${(0, format_js_1.formatDate)(report.endedAt)}`);
    log.info(`Duration: ${(0, format_js_1.formatDuration)(durationMs)}`);
    if (transferRows.length > 0) {
        log.info(`\nTransferred Resources\n${(0, format_js_1.formatTable)(transferRows, [
            { key: 'resource', header: 'Resource' },
            { key: 'size', header: 'Size' },
            { key: 'duration', header: 'Duration' },
            { key: 'checksum', header: 'Checksum' },
        ])}`);
    }
    if (serviceRows.length > 0) {
        log.info(`\nServices\n${(0, format_js_1.formatTable)(serviceRows, [
            { key: 'name', header: 'Name' },
            { key: 'type', header: 'Type' },
            { key: 'status', header: 'Status' },
            { key: 'health', header: 'Health Check' },
        ])}`);
    }
    if (report.warnings.length > 0) {
        log.warn(`Warnings:\n${(0, format_js_1.formatList)(report.warnings)}`);
    }
    if (report.errors.length > 0) {
        log.error(`Errors:\n${(0, format_js_1.formatList)(report.errors)}`);
    }
    const failedServices = report.serviceResults.filter((service) => service.status === 'failed');
    if (failedServices.length > 0) {
        log.warn('Next steps: inspect failed services, check container logs, then re-run with --resume.');
    }
}
async function saveReport(report, outputPath) {
    await (0, fs_js_1.writeJson)(outputPath, report);
}
function defaultReportPath(ctx) {
    return node_path_1.default.join(ctx.config.paths.checkpointDir, 'migration-report.json');
}
