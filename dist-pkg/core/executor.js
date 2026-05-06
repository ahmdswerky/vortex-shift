"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.StepRunner = exports.MigrationError = void 0;
const p_retry_1 = __importDefault(require("p-retry"));
const checkpoint_js_1 = require("./checkpoint.js");
class MigrationError extends Error {
    stepId;
    phase;
    cause;
    constructor(stepId, phase, cause, message) {
        super(message ?? `Migration failed at step "${stepId}" (phase ${phase})`);
        this.name = 'MigrationError';
        this.stepId = stepId;
        this.phase = phase;
        this.cause = cause;
    }
}
exports.MigrationError = MigrationError;
class StepRunner {
    ctx;
    constructor(ctx) {
        this.ctx = ctx;
    }
    async run(steps) {
        if (this.ctx.isDryRun) {
            const planned = [];
            for (const step of steps) {
                if ((0, checkpoint_js_1.isStepDone)(this.ctx.checkpoint, step.id)) {
                    this.ctx.log.info(`[dry-run] Skip already completed step: ${step.id}`);
                    continue;
                }
                this.ctx.log.info(`[dry-run] Would run step: ${step.id} (${step.name})`);
                planned.push(step.id);
            }
            if (planned.length > 0) {
                this.ctx.log.info(`[dry-run] Summary: ${planned.length} step(s) would execute.`);
            }
            else {
                this.ctx.log.info('[dry-run] Summary: no pending steps.');
            }
            return;
        }
        for (const step of steps) {
            if ((0, checkpoint_js_1.isStepDone)(this.ctx.checkpoint, step.id)) {
                this.ctx.log.info(`Skipping step (already completed): ${step.id}`);
                continue;
            }
            this.ctx.log.info(`Starting step: ${step.name}`);
            try {
                await (0, p_retry_1.default)(async () => {
                    await step.run(this.ctx);
                }, {
                    retries: step.retries ?? this.ctx.config.transfer.retries,
                    factor: 2,
                    minTimeout: 2_000,
                    maxTimeout: 30_000,
                    onFailedAttempt: (error) => {
                        this.ctx.log.warn(`Step ${step.id} failed (attempt ${error.attemptNumber}, retries left: ${error.retriesLeft})`);
                        this.ctx.log.debug(`Step error: ${String(error.message)}`);
                    },
                });
                (0, checkpoint_js_1.markStepComplete)(this.ctx.checkpoint, step.id);
                await (0, checkpoint_js_1.saveCheckpoint)(this.ctx.config.paths.checkpointDir, this.ctx.checkpoint);
                this.ctx.log.success(`Completed step: ${step.name}`);
            }
            catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                (0, checkpoint_js_1.markStepFailed)(this.ctx.checkpoint, step.id, `${message} | Resume hint: vortex-shift status && vortex-shift source --resume`);
                await (0, checkpoint_js_1.saveCheckpoint)(this.ctx.config.paths.checkpointDir, this.ctx.checkpoint);
                throw new MigrationError(step.id, this.ctx.checkpoint.phase, error);
            }
        }
    }
}
exports.StepRunner = StepRunner;
