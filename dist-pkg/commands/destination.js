"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createDestinationCommand = createDestinationCommand;
const commander_1 = require("commander");
const node_path_1 = __importDefault(require("node:path"));
const checkpoint_js_1 = require("../core/checkpoint.js");
const executor_js_1 = require("../core/executor.js");
const phase1_detect_js_1 = require("../phases/phase1-detect.js");
const phase4_validate_js_1 = require("../phases/phase4-validate.js");
const shared_js_1 = require("./shared.js");
const fs_js_1 = require("../utils/fs.js");
async function waitForManifest(checkpointDir, logger) {
    const manifestPath = node_path_1.default.join(checkpointDir, 'manifest.json');
    logger.info(`Waiting for source manifest at ${manifestPath}`);
    while (!(await (0, fs_js_1.fileExists)(manifestPath))) {
        await new Promise((resolve) => {
            setTimeout(resolve, 5_000);
        });
    }
}
function createDestinationCommand(getLogger) {
    const command = new commander_1.Command('destination')
        .description('Run destination-side migration validation')
        .option('--port <port>', 'Coordination port (reserved for active mode)', (value) => Number.parseInt(value, 10))
        .option('--run-phase4', 'Run Phase 4 immediately (used by source trigger)')
        .option('--checkpoint-dir <dir>', 'Checkpoint directory override')
        .option('--ssh-key-path <path>', 'SSH key path override')
        .action(async (_options, cmd) => {
        const logger = getLogger();
        const options = cmd.optsWithGlobals();
        const config = await (0, shared_js_1.resolveMigrationConfig)('destination', options);
        const existing = await (0, checkpoint_js_1.loadCheckpoint)(config.paths.checkpointDir);
        const checkpoint = existing ?? (0, shared_js_1.createCheckpointState)('destination', config.destination.host);
        const manifest = await (0, shared_js_1.loadManifestFromCheckpoint)(config.paths.checkpointDir);
        const ctx = (0, shared_js_1.buildContext)('destination', config, checkpoint, logger, manifest, options.dryRun === true);
        const unregisterInterrupts = (0, shared_js_1.registerInterruptHandlers)(ctx);
        try {
            await (0, phase1_detect_js_1.runPhase1)(ctx);
            if (options.port) {
                logger.info(`Destination coordination port configured: ${options.port}`);
            }
            if (!options.runPhase4 && !ctx.isDryRun) {
                await waitForManifest(config.paths.checkpointDir, logger);
            }
            ctx.manifest = await (0, shared_js_1.loadManifestFromCheckpoint)(config.paths.checkpointDir);
            if (!ctx.manifest) {
                throw new Error('Manifest not found. Source transfer may not have completed.');
            }
            await (0, phase4_validate_js_1.runPhase4)(ctx);
        }
        catch (error) {
            if (error instanceof executor_js_1.MigrationError) {
                logger.error(`Destination migration failed at step ${error.stepId} (phase ${error.phase}).`);
                logger.error(`Check logs at ${config.paths.logFile}. Run "vortex-shift status", then resume with --resume.`);
                throw error;
            }
            const message = error instanceof Error ? error.message : String(error);
            logger.error(`Destination command failed: ${message}`);
            throw error;
        }
        finally {
            unregisterInterrupts();
            ctx.ssh.disconnect();
        }
    });
    return command;
}
