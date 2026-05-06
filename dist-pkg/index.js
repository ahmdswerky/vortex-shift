"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const commander_1 = require("commander");
const package_json_1 = __importDefault(require("../package.json"));
const defaults_js_1 = require("./config/defaults.js");
const destination_js_1 = require("./commands/destination.js");
const init_js_1 = require("./commands/init.js");
const reset_js_1 = require("./commands/reset.js");
const source_js_1 = require("./commands/source.js");
const status_js_1 = require("./commands/status.js");
const logger_js_1 = require("./core/logger.js");
const fs_js_1 = require("./utils/fs.js");
const program = new commander_1.Command();
let logger = null;
function getLogger() {
    if (!logger) {
        throw new Error('Logger is not initialized.');
    }
    return logger;
}
async function ensureLoggerInitialized(globalOptions) {
    if (logger) {
        return;
    }
    logger = await (0, logger_js_1.createLog)({
        verbose: globalOptions.verbose ?? false,
        logFile: (0, fs_js_1.expandHome)(globalOptions.logFile ?? defaults_js_1.DEFAULT_LOG_FILE),
    });
}
function handleTopLevelFailure(error) {
    const message = error instanceof Error ? error.message : String(error);
    if (logger) {
        logger.error(message);
    }
    else {
        process.stderr.write(`Error: ${message}\n`);
    }
    process.exitCode = 1;
}
process.on('uncaughtException', (error) => {
    handleTopLevelFailure(error);
});
process.on('unhandledRejection', (reason) => {
    handleTopLevelFailure(reason);
});
program
    .name('vortex-shift')
    .description('CLI for full server migration between Rocky Linux servers')
    .version(package_json_1.default.version)
    .option('--config <path>', 'Path to vortex-shift config file')
    .option('--log-file <path>', 'Path to log file')
    .option('--verbose', 'Enable verbose logging')
    .option('--yes', 'Auto-confirm prompts')
    .option('--dry-run', 'Preview actions without executing')
    .hook('preSubcommand', async (thisCommand) => {
    const options = thisCommand.opts();
    await ensureLoggerInitialized(options);
});
program.addCommand((0, source_js_1.createSourceCommand)(getLogger));
program.addCommand((0, destination_js_1.createDestinationCommand)(getLogger));
program.addCommand((0, status_js_1.createStatusCommand)(getLogger));
program.addCommand((0, reset_js_1.createResetCommand)(getLogger));
program.addCommand((0, init_js_1.createInitCommand)(getLogger));
try {
    program.parse(process.argv);
}
catch (error) {
    handleTopLevelFailure(error);
}
