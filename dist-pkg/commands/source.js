"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createSourceCommand = createSourceCommand;
const commander_1 = require("commander");
const node_path_1 = __importDefault(require("node:path"));
const checkpoint_js_1 = require("../core/checkpoint.js");
const executor_js_1 = require("../core/executor.js");
const phase1_detect_js_1 = require("../phases/phase1-detect.js");
const phase2_inventory_js_1 = require("../phases/phase2-inventory.js");
const phase3_transfer_js_1 = require("../phases/phase3-transfer.js");
const shared_js_1 = require("./shared.js");
const prompt_js_1 = require("../utils/prompt.js");
async function triggerDestinationPhase4(logger, destination, checkpointDir, verbose) {
    const { SSHClient } = await Promise.resolve().then(() => __importStar(require('../core/ssh.js')));
    const ssh = new SSHClient();
    try {
        await ssh.connect(destination);
        const commandParts = [
            'vortex-shift',
            'destination',
            '--run-phase4',
            '--checkpoint-dir',
            JSON.stringify(checkpointDir),
        ];
        if (verbose) {
            commandParts.push('--verbose');
        }
        const command = commandParts.join(' ');
        logger.info(`Triggering destination Phase 4: ${destination.user}@${destination.host}`);
        const result = await ssh.exec(command);
        if (result.code !== 0) {
            throw new Error(`Destination Phase 4 trigger failed (code=${result.code}): ${result.stderr || result.stdout}`);
        }
    }
    finally {
        ssh.disconnect();
    }
}
function createSourceCommand(getLogger) {
    const command = new commander_1.Command('source')
        .description('Run source-side migration orchestration')
        .requiredOption('--dest-host <host>', 'Destination host')
        .option('--dest-user <user>', 'Destination SSH user')
        .option('--dest-port <port>', 'Destination SSH port', (value) => Number.parseInt(value, 10))
        .option('--retries <count>', 'Step retry count', (value) => Number.parseInt(value, 10))
        .option('--resume', 'Resume from existing checkpoint')
        .option('--checkpoint-dir <dir>', 'Checkpoint directory override')
        .option('--ssh-key-path <path>', 'SSH key path override')
        .action(async (_options, cmd) => {
        const logger = getLogger();
        const options = cmd.optsWithGlobals();
        const overrides = {
            destinationHost: options.destHost,
        };
        if (options.destUser !== undefined) {
            overrides.destinationUser = options.destUser;
        }
        if (options.destPort !== undefined) {
            overrides.destinationPort = options.destPort;
        }
        if (options.retries !== undefined) {
            overrides.retries = options.retries;
        }
        const config = await (0, shared_js_1.resolveMigrationConfig)('source', options, overrides);
        const existingCheckpoint = await (0, checkpoint_js_1.loadCheckpoint)(config.paths.checkpointDir);
        let checkpoint = existingCheckpoint;
        if (existingCheckpoint) {
            (0, checkpoint_js_1.displayCheckpointSummary)(existingCheckpoint, logger);
            const shouldResume = options.resume === true ||
                options.yes === true ||
                (await (0, prompt_js_1.confirm)('Existing checkpoint found. Resume from checkpoint?', true));
            if (!shouldResume) {
                await (0, checkpoint_js_1.clearCheckpoint)(config.paths.checkpointDir);
                checkpoint = null;
                logger.info('Previous checkpoint cleared. Starting a new migration run.');
            }
        }
        if (!checkpoint) {
            checkpoint = (0, shared_js_1.createCheckpointState)('source', config.destination.host);
        }
        const manifest = await (0, shared_js_1.loadManifestFromCheckpoint)(config.paths.checkpointDir);
        const ctx = (0, shared_js_1.buildContext)('source', config, checkpoint, logger, manifest, options.dryRun === true);
        const unregisterInterrupts = (0, shared_js_1.registerInterruptHandlers)(ctx);
        try {
            await (0, phase1_detect_js_1.runPhase1)(ctx);
            await (0, phase2_inventory_js_1.runPhase2)(ctx);
            await (0, phase3_transfer_js_1.runPhase3)(ctx);
            if (ctx.isDryRun) {
                logger.info('[dry-run] Skipping destination Phase 4 trigger.');
            }
            else {
                await triggerDestinationPhase4(logger, config.destination, node_path_1.default.resolve(config.paths.checkpointDir), config.verbose);
            }
        }
        catch (error) {
            if (error instanceof executor_js_1.MigrationError) {
                logger.error(`Migration failed at step ${error.stepId} (phase ${error.phase}).`);
                logger.error(`Check logs at ${config.paths.logFile}. Run "vortex-shift status", then resume with --resume.`);
                throw error;
            }
            const message = error instanceof Error ? error.message : String(error);
            logger.error(`Source migration failed: ${message}`);
            logger.error(`Check logs at ${config.paths.logFile}. Run "vortex-shift status", then resume with --resume.`);
            throw error;
        }
        finally {
            unregisterInterrupts();
            ctx.ssh.disconnect();
        }
    });
    return command;
}
