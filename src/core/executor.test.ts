import os from 'node:os'
import path from 'node:path'
import { mkdtemp } from 'node:fs/promises'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { StepRunner } from './executor.js'
import type { MigrationContext } from '../types/context.js'
import type { CheckpointState } from '../types/checkpoint.js'
import type { MigrationConfig } from '../types/config.js'
import type { Manifest } from '../types/manifest.js'
import { SSHClient } from './ssh.js'
import { loadCheckpoint } from './checkpoint.js'

vi.mock('p-retry', () => {
  return {
    default: async (
      task: () => Promise<void>,
      options: {
        retries: number
        onFailedAttempt?: (error: { attemptNumber: number; retriesLeft: number; message: string }) => void
      }
    ) => {
      const retries = options.retries ?? 0
      let attempt = 0
      let lastError: unknown

      while (attempt <= retries) {
        attempt += 1
        try {
          await task()
          return
        } catch (error) {
          lastError = error
          if (attempt <= retries) {
            options.onFailedAttempt?.({
              attemptNumber: attempt,
              retriesLeft: retries - attempt + 1,
              message: error instanceof Error ? error.message : String(error),
            })
          }
        }
      }

      throw lastError
    },
  }
})

function buildCheckpoint(): CheckpointState {
  const now = new Date().toISOString()
  return {
    version: 1,
    mode: 'source',
    destHost: 'dest.example.com',
    phase: 1,
    completedSteps: [],
    failedStep: null,
    error: null,
    startedAt: now,
    lastUpdatedAt: now,
  }
}

function buildConfig(checkpointDir: string): MigrationConfig {
  return {
    destination: {
      host: 'dest.example.com',
      user: 'root',
      port: 22,
      sshKeyPath: '~/.ssh/id_ed25519',
    },
    transfer: {
      retries: 2,
      concurrency: 2,
      rsyncExtraArgs: [],
      excludePaths: [],
    },
    healthChecks: [],
    paths: {
      dumpDir: '/tmp/vortex-dumps',
      checkpointDir,
      logFile: path.join(checkpointDir, 'vortex.log'),
      nginxProxyManagerDataPath: '/opt/nginx-proxy-manager',
      pm2DumpPath: '~/.pm2/dump.pm2',
    },
    verbose: false,
  }
}

function createLoggerSpy() {
  return {
    info: vi.fn(),
    success: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    startSpinner: vi.fn(),
    stopSpinner: vi.fn(),
  }
}

function buildContext(checkpointDir: string): MigrationContext {
  const logger = createLoggerSpy()
  return {
    mode: 'source',
    config: buildConfig(checkpointDir),
    isDryRun: false,
    ssh: new SSHClient(),
    manifest: null as Manifest | null,
    checkpoint: buildCheckpoint(),
    log: logger as unknown as MigrationContext['log'],
  }
}

describe('core/executor', () => {
  let checkpointDir: string

  beforeEach(async () => {
    checkpointDir = await mkdtemp(path.join(os.tmpdir(), 'vortex-executor-'))
  })

  it('skips steps that are already completed', async () => {
    const ctx = buildContext(checkpointDir)
    ctx.checkpoint.completedSteps.push('already.done')
    const stepRun = vi.fn()

    const runner = new StepRunner(ctx)
    await runner.run([
      {
        id: 'already.done',
        name: 'Already done',
        run: stepRun,
      },
    ])

    expect(stepRun).not.toHaveBeenCalled()
  })

  it('adds successful step to completedSteps and saves checkpoint', async () => {
    const ctx = buildContext(checkpointDir)
    const stepRun = vi.fn(async () => {})
    const runner = new StepRunner(ctx)

    await runner.run([
      {
        id: 'phase.step',
        name: 'Step',
        run: stepRun,
      },
    ])

    expect(stepRun).toHaveBeenCalledTimes(1)
    expect(ctx.checkpoint.completedSteps).toContain('phase.step')

    const saved = await loadCheckpoint(checkpointDir)
    expect(saved?.completedSteps).toContain('phase.step')
  })

  it('retries failed step and eventually succeeds', async () => {
    const ctx = buildContext(checkpointDir)
    let attempt = 0

    const runner = new StepRunner(ctx)
    await runner.run([
      {
        id: 'retry.step',
        name: 'Retry Step',
        retries: 2,
        run: async () => {
          attempt += 1
          if (attempt < 3) {
            throw new Error(`fail ${attempt}`)
          }
        },
      },
    ])

    expect(attempt).toBe(3)
    expect(ctx.checkpoint.completedSteps).toContain('retry.step')
  })

  it('throws MigrationError with step id after retries are exhausted', async () => {
    const ctx = buildContext(checkpointDir)
    const runner = new StepRunner(ctx)

    await expect(
      runner.run([
        {
          id: 'fatal.step',
          name: 'Fatal Step',
          retries: 1,
          run: async () => {
            throw new Error('fatal')
          },
        },
      ])
    ).rejects.toMatchObject({
      name: 'MigrationError',
      stepId: 'fatal.step',
    })

    expect(ctx.checkpoint.failedStep).toBe('fatal.step')
  })

  it('saves checkpoint after each completed step', async () => {
    const ctx = buildContext(checkpointDir)
    const runner = new StepRunner(ctx)

    await runner.run([
      {
        id: 'step.1',
        name: 'Step 1',
        run: async () => {},
      },
      {
        id: 'step.2',
        name: 'Step 2',
        run: async () => {},
      },
    ])

    const saved = await loadCheckpoint(checkpointDir)
    expect(saved?.completedSteps).toEqual(['step.1', 'step.2'])
  })

  it('does not mutate context state when step is skipped', async () => {
    const ctx = buildContext(checkpointDir)
    ctx.checkpoint.completedSteps = ['skip.me']
    const before = JSON.parse(JSON.stringify(ctx.checkpoint)) as CheckpointState
    const run = vi.fn(async () => {
      ctx.checkpoint.error = 'mutated'
    })

    const runner = new StepRunner(ctx)
    await runner.run([
      {
        id: 'skip.me',
        name: 'Skip me',
        run,
      },
    ])

    expect(run).not.toHaveBeenCalled()
    expect(ctx.checkpoint).toEqual(before)
  })
})
