import pRetry, { type FailedAttemptError } from 'p-retry'
import { isStepDone, markStepComplete, markStepFailed, saveCheckpoint } from './checkpoint.js'
import type { MigrationContext } from '../types/context.js'

export interface Step {
  id: string
  name: string
  run: (ctx: MigrationContext) => Promise<void>
  retries?: number
}

export class MigrationError extends Error {
  public readonly stepId: string
  public readonly phase: 1 | 2 | 3 | 4
  public override readonly cause: unknown

  public constructor(stepId: string, phase: 1 | 2 | 3 | 4, cause: unknown, message?: string) {
    super(message ?? `Migration failed at step "${stepId}" (phase ${phase})`)
    this.name = 'MigrationError'
    this.stepId = stepId
    this.phase = phase
    this.cause = cause
  }
}

export class StepRunner {
  private readonly ctx: MigrationContext

  public constructor(ctx: MigrationContext) {
    this.ctx = ctx
  }

  public async run(steps: Step[]): Promise<void> {
    for (const step of steps) {
      if (isStepDone(this.ctx.checkpoint, step.id)) {
        this.ctx.log.info(`Skipping step (already completed): ${step.id}`)
        continue
      }

      this.ctx.log.info(`Starting step: ${step.name}`)

      try {
        await pRetry(
          async () => {
            await step.run(this.ctx)
          },
          {
            retries: step.retries ?? this.ctx.config.transfer.retries,
            factor: 2,
            minTimeout: 2_000,
            maxTimeout: 30_000,
            onFailedAttempt: (error: FailedAttemptError) => {
              this.ctx.log.warn(
                `Step ${step.id} failed (attempt ${error.attemptNumber}, retries left: ${error.retriesLeft})`
              )
              this.ctx.log.debug(`Step error: ${String(error.message)}`)
            },
          }
        )

        markStepComplete(this.ctx.checkpoint, step.id)
        await saveCheckpoint(this.ctx.config.paths.checkpointDir, this.ctx.checkpoint)
        this.ctx.log.success(`Completed step: ${step.name}`)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        markStepFailed(this.ctx.checkpoint, step.id, message)
        await saveCheckpoint(this.ctx.config.paths.checkpointDir, this.ctx.checkpoint)
        throw new MigrationError(step.id, this.ctx.checkpoint.phase, error)
      }
    }
  }
}
