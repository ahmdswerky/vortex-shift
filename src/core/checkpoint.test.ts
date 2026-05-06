import os from 'node:os'
import path from 'node:path'
import { mkdtemp, stat } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import {
  CHECKPOINT_SCHEMA_VERSION,
  clearCheckpoint,
  isStepDone,
  loadCheckpoint,
  markStepComplete,
  markStepFailed,
  saveCheckpoint,
} from './checkpoint.js'
import type { CheckpointState } from '../types/checkpoint.js'
import { fileExists } from '../utils/fs.js'

function sampleCheckpoint(): CheckpointState {
  const now = new Date().toISOString()
  return {
    version: CHECKPOINT_SCHEMA_VERSION,
    mode: 'source',
    destHost: 'dest.example.com',
    phase: 2,
    completedSteps: ['detect.os'],
    failedStep: null,
    error: null,
    startedAt: now,
    lastUpdatedAt: now,
  }
}

describe('core/checkpoint', () => {
  it('loadCheckpoint returns null when file is missing', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'vortex-checkpoint-missing-'))
    const loaded = await loadCheckpoint(dir)
    expect(loaded).toBeNull()
  })

  it('loadCheckpoint parses valid checkpoint data', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'vortex-checkpoint-valid-'))
    const state = sampleCheckpoint()
    await saveCheckpoint(dir, state)

    const loaded = await loadCheckpoint(dir)
    expect(loaded).not.toBeNull()
    expect(loaded?.destHost).toBe(state.destHost)
    expect(loaded?.phase).toBe(state.phase)
    expect(loaded?.completedSteps).toEqual(state.completedSteps)
  })

  it('loadCheckpoint migrates checkpoint without version field', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'vortex-checkpoint-migrate-'))
    const state = sampleCheckpoint()
    const legacyState = JSON.parse(JSON.stringify(state)) as Record<string, unknown>
    delete legacyState.version
    await saveCheckpoint(dir, legacyState as CheckpointState)

    const loaded = await loadCheckpoint(dir)
    expect(loaded?.version).toBe(CHECKPOINT_SCHEMA_VERSION)
  })

  it('saveCheckpoint writes atomically and leaves no temp file', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'vortex-checkpoint-atomic-'))
    const state = sampleCheckpoint()

    await saveCheckpoint(dir, state)

    const checkpointPath = path.join(dir, 'checkpoint.json')
    const tmpPath = `${checkpointPath}.tmp`

    expect(await fileExists(checkpointPath)).toBe(true)
    expect(await fileExists(tmpPath)).toBe(false)
    const metadata = await stat(checkpointPath)
    expect(metadata.isFile()).toBe(true)
  })

  it('markStepComplete adds step and clears failure state', () => {
    const state = sampleCheckpoint()
    state.failedStep = 'detect.node'
    state.error = 'boom'

    const updated = markStepComplete(state, 'detect.node')
    expect(updated.completedSteps).toContain('detect.node')
    expect(updated.failedStep).toBeNull()
    expect(updated.error).toBeNull()
  })

  it('markStepFailed sets failure metadata', () => {
    const state = sampleCheckpoint()
    const updated = markStepFailed(state, 'detect.rsync', 'missing rsync')
    expect(updated.failedStep).toBe('detect.rsync')
    expect(updated.error).toBe('missing rsync')
  })

  it('isStepDone reports completion correctly', () => {
    const state = sampleCheckpoint()
    expect(isStepDone(state, 'detect.os')).toBe(true)
    expect(isStepDone(state, 'detect.pm2')).toBe(false)
  })

  it('clearCheckpoint removes checkpoint file', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'vortex-checkpoint-clear-'))
    await saveCheckpoint(dir, sampleCheckpoint())

    await clearCheckpoint(dir)
    expect(await loadCheckpoint(dir)).toBeNull()
  })
})
