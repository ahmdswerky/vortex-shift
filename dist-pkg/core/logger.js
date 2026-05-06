"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.log = exports.Logger = void 0;
exports.createLog = createLog;
const node_path_1 = __importDefault(require("node:path"));
const chalk_1 = __importDefault(require("chalk"));
const ora_1 = __importDefault(require("ora"));
const winston_1 = require("winston");
const fs_js_1 = require("../utils/fs.js");
class Logger {
    verbose;
    fileLogger;
    spinner = null;
    constructor(options, fileLogger) {
        this.verbose = options.verbose;
        this.fileLogger = fileLogger;
    }
    info(message, data) {
        this.emit('info', message, data);
    }
    success(message, data) {
        this.emit('success', message, data);
    }
    warn(message, data) {
        this.emit('warn', message, data);
    }
    error(message, data) {
        this.emit('error', message, data);
    }
    debug(message, data) {
        if (!this.verbose) {
            this.fileLogger.debug(message, data === undefined ? undefined : { data });
            return;
        }
        this.emit('debug', message, data);
    }
    startSpinner(label) {
        this.stopSpinner();
        this.spinner = (0, ora_1.default)(label).start();
    }
    stopSpinner(success = true) {
        if (!this.spinner) {
            return;
        }
        if (success) {
            this.spinner.succeed();
        }
        else {
            this.spinner.fail();
        }
        this.spinner = null;
    }
    emit(level, message, data) {
        const line = this.formatTerminal(level, message);
        if (this.spinner?.isSpinning) {
            this.spinner.stop();
            process.stdout.write(`${line}\n`);
            this.spinner.start();
        }
        else {
            process.stdout.write(`${line}\n`);
        }
        const winstonLevel = level === 'success' ? 'info' : level;
        this.fileLogger.log(winstonLevel, message, data === undefined ? undefined : { data });
    }
    formatTerminal(level, message) {
        if (level === 'info') {
            return `${chalk_1.default.blue('ℹ')} ${message}`;
        }
        if (level === 'success') {
            return `${chalk_1.default.green('✔')} ${message}`;
        }
        if (level === 'warn') {
            return `${chalk_1.default.yellow('⚠')} ${message}`;
        }
        if (level === 'error') {
            return `${chalk_1.default.red('✖')} ${message}`;
        }
        return `${chalk_1.default.gray('·')} ${chalk_1.default.gray(message)}`;
    }
}
exports.Logger = Logger;
async function createLog(options) {
    await (0, fs_js_1.ensureDir)(node_path_1.default.dirname(options.logFile));
    const fileLogger = (0, winston_1.createLogger)({
        level: 'debug',
        format: winston_1.format.combine(winston_1.format.timestamp(), winston_1.format.errors({ stack: true }), winston_1.format.json()),
        transports: [new winston_1.transports.File({ filename: options.logFile })],
    });
    exports.log = new Logger(options, fileLogger);
    return exports.log;
}
