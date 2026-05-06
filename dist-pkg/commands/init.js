"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createInitCommand = createInitCommand;
const commander_1 = require("commander");
const node_path_1 = __importDefault(require("node:path"));
const defaults_js_1 = require("../config/defaults.js");
const fs_js_1 = require("../utils/fs.js");
const prompt_js_1 = require("../utils/prompt.js");
function createInitCommand(getLogger) {
    return new commander_1.Command('init')
        .description('Generate a vortex-shift.json config file')
        .option('--output <path>', 'Output config path', 'vortex-shift.json')
        .option('--dest-host <host>', 'Destination host placeholder')
        .option('--dest-user <user>', 'Default destination SSH user')
        .option('--dest-port <port>', 'Default destination SSH port', (value) => Number.parseInt(value, 10))
        .option('--retries <count>', 'Default retries', (value) => Number.parseInt(value, 10))
        .option('--overwrite', 'Overwrite existing config file')
        .action(async (_options, cmd) => {
        const logger = getLogger();
        const options = cmd.optsWithGlobals();
        const outputPath = node_path_1.default.resolve((0, fs_js_1.expandHome)(options.output ?? 'vortex-shift.json'));
        if ((await (0, fs_js_1.fileExists)(outputPath)) && !options.overwrite) {
            const allowed = options.yes === true || (await (0, prompt_js_1.confirm)(`Config exists at ${outputPath}. Overwrite?`, false));
            if (!allowed) {
                logger.info('Config generation cancelled.');
                return;
            }
        }
        const config = {
            destination: {
                host: options.destHost ?? 'your-destination-host',
                user: options.destUser ?? defaults_js_1.DEFAULT_SSH_USER,
                port: options.destPort ?? defaults_js_1.DEFAULT_SSH_PORT,
                sshKeyPath: (0, fs_js_1.expandHome)('~/.ssh/id_ed25519'),
            },
            transfer: {
                retries: options.retries ?? defaults_js_1.DEFAULT_RETRIES,
                concurrency: 2,
                rsyncExtraArgs: [],
                excludePaths: [],
            },
            healthChecks: [],
            paths: {
                dumpDir: defaults_js_1.DEFAULT_DUMP_DIR,
                checkpointDir: defaults_js_1.DEFAULT_CHECKPOINT_DIR,
                logFile: defaults_js_1.DEFAULT_LOG_FILE,
                nginxProxyManagerDataPath: defaults_js_1.DEFAULT_NPM_DATA_PATH,
                pm2DumpPath: defaults_js_1.DEFAULT_PM2_DUMP_PATH,
            },
            verbose: false,
        };
        await (0, fs_js_1.writeJson)(outputPath, config);
        logger.success(`Config written to ${outputPath}`);
    });
}
