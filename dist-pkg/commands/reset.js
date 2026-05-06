"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createResetCommand = createResetCommand;
const commander_1 = require("commander");
const defaults_js_1 = require("../config/defaults.js");
const checkpoint_js_1 = require("../core/checkpoint.js");
const shared_js_1 = require("./shared.js");
const fs_js_1 = require("../utils/fs.js");
const prompt_js_1 = require("../utils/prompt.js");
function createResetCommand(getLogger) {
    return new commander_1.Command('reset')
        .description('Clear migration checkpoint and optionally dump files')
        .option('--checkpoint-dir <dir>', 'Checkpoint directory override')
        .option('--delete-dumps', 'Also delete dump directory')
        .action(async (_options, cmd) => {
        const logger = getLogger();
        const options = cmd.optsWithGlobals();
        const checkpointDir = (0, fs_js_1.expandHome)(options.checkpointDir ?? defaults_js_1.DEFAULT_CHECKPOINT_DIR);
        const checkpoint = await (0, checkpoint_js_1.loadCheckpoint)(checkpointDir);
        if (!checkpoint) {
            logger.info('No checkpoint file found.');
        }
        else {
            logger.info(`Checkpoint found in ${checkpointDir}`);
            logger.info(`Phase: ${checkpoint.phase}`);
            logger.info(`Completed steps: ${checkpoint.completedSteps.length}`);
            if (checkpoint.failedStep) {
                logger.warn(`Last failed step: ${checkpoint.failedStep}`);
            }
        }
        const shouldReset = options.yes === true ||
            (await (0, prompt_js_1.confirm)('This will clear all progress. Are you sure?', false));
        if (!shouldReset) {
            logger.info('Reset cancelled.');
            return;
        }
        await (0, checkpoint_js_1.clearCheckpoint)(checkpointDir);
        logger.success('Checkpoint cleared.');
        if (options.deleteDumps) {
            const removed = await (0, shared_js_1.removePathIfExists)((0, fs_js_1.expandHome)(defaults_js_1.DEFAULT_DUMP_DIR));
            if (removed) {
                logger.success(`Dump directory removed: ${(0, fs_js_1.expandHome)(defaults_js_1.DEFAULT_DUMP_DIR)}`);
            }
            else {
                logger.info(`Dump directory not found: ${(0, fs_js_1.expandHome)(defaults_js_1.DEFAULT_DUMP_DIR)}`);
            }
        }
    });
}
