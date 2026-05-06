export type StepStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped'

export interface CheckpointState {
  version: number
  mode: 'source' | 'destination'
  destHost: string
  phase: 1 | 2 | 3 | 4
  completedSteps: string[]
  failedStep: string | null
  error: string | null
  startedAt: string
  lastUpdatedAt: string
}
