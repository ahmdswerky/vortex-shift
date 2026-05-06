"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createStatusCommand = createStatusCommand;
const commander_1 = require("commander");
const defaults_js_1 = require("../config/defaults.js");
const checkpoint_js_1 = require("../core/checkpoint.js");
const fs_js_1 = require("../utils/fs.js");
const format_js_1 = require("../utils/format.js");
const TOTAL_ESTIMATED_STEPS = 35;
function estimateCompletionPercent(completedSteps) {
    const ratio = TOTAL_ESTIMATED_STEPS > 0 ? completedSteps / TOTAL_ESTIMATED_STEPS : 0;
    return Math.min(100, Math.max(0, Math.round(ratio * 100)));
}
function createStatusCommand(getLogger) {
    return new commander_1.Command('status')
        .description('Show migration checkpoint status')
        .option('--checkpoint-dir <dir>', 'Checkpoint directory override')
        .action(async (options) => {
        const logger = getLogger();
        const checkpointDir = (0, fs_js_1.expandHome)(options.checkpointDir ?? defaults_js_1.DEFAULT_CHECKPOINT_DIR);
        const checkpoint = await (0, checkpoint_js_1.loadCheckpoint)(checkpointDir);
        if (!checkpoint) {
            logger.info('No migration in progress');
            return;
        }
        const completion = estimateCompletionPercent(checkpoint.completedSteps.length);
        logger.info(`Checkpoint directory: ${checkpointDir}`);
        logger.info(`Started at: ${(0, format_js_1.formatDate)(checkpoint.startedAt)}`);
        logger.info(`Last updated: ${(0, format_js_1.formatDate)(checkpoint.lastUpdatedAt)}`);
        logger.info(`Current phase: ${checkpoint.phase}`);
        logger.info(`Completed steps: ${checkpoint.completedSteps.length}`);
        if (checkpoint.completedSteps.length > 0) {
            logger.info(`Completed step IDs:\n${(0, format_js_1.formatList)(checkpoint.completedSteps)}`);
        }
        if (checkpoint.failedStep) {
            logger.warn(`Failed step: ${checkpoint.failedStep}`);
            logger.warn(`Error: ${checkpoint.error ?? 'Unknown error'}`);
        }
        logger.info(`Estimated completion: ~${completion}%`);
    });
}
