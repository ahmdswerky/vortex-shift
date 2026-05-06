import path from 'node:path'
import { ensureDir, fileExists, readJson, writeJson } from '../utils/fs.js'
import type { CheckpointState } from '../types/checkpoint.js'
import type { Logger } from './logger.js'

const CHECKPOINT_FILE = 'checkpoint.json'

function getCheckpointPath(dir: string): string {
  return path.join(dir, CHECKPOINT_FILE)
}

export async function loadCheckpoint(dir: string): Promise<CheckpointState | null> {
  const checkpointPath = getCheckpointPath(dir)
  if (!(await fileExists(checkpointPath))) {
    return null
  }

  return readJson<CheckpointState>(checkpointPath)
}

export async function saveCheckpoint(dir: string, state: CheckpointState): Promise<void> {
  await ensureDir(dir)
  await writeJson(getCheckpointPath(dir), state)
}

export async function clearCheckpoint(dir: string): Promise<void> {
  const checkpointPath = getCheckpointPath(dir)
  if (!(await fileExists(checkpointPath))) {
    return
  }

  const fs = await import('node:fs/promises')
  await fs.unlink(checkpointPath)
}

export function markStepComplete(state: CheckpointState, stepId: string): CheckpointState {
  if (!state.completedSteps.includes(stepId)) {
    state.completedSteps.push(stepId)
  }

  state.failedStep = null
  state.error = null
  state.lastUpdatedAt = new Date().toISOString()
  return state
}

export function markStepFailed(state: CheckpointState, stepId: string, error: string): CheckpointState {
  state.failedStep = stepId
  state.error = error
  state.lastUpdatedAt = new Date().toISOString()
  return state
}

export function isStepDone(state: CheckpointState, stepId: string): boolean {
  return state.completedSteps.includes(stepId)
}

export function displayCheckpointSummary(state: CheckpointState, logger: Logger): void {
  logger.info('Checkpoint found. Resuming migration state:')
  logger.info(`  phase: ${state.phase}`)
  logger.info(`  completed steps: ${state.completedSteps.length}`)
  if (state.failedStep) {
    logger.warn(`  last failed step: ${state.failedStep}`)
  }
  logger.info(`  started at: ${state.startedAt}`)
  logger.info(`  last updated: ${state.lastUpdatedAt}`)
}

export { CHECKPOINT_FILE }
