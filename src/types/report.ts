export interface ServiceResult {
  name: string
  type: 'docker' | 'pm2' | 'nginx' | 'system'
  status: 'ok' | 'warning' | 'failed'
  healthCheck: string
  error?: string
}

export interface TransferResult {
  resource: string
  bytesTransferred: number
  duration: number
  checksumVerified: boolean
}

export interface MigrationReport {
  id: string
  startedAt: string
  endedAt: string
  sourceHost: string
  destinationHost: string
  status: 'success' | 'partial' | 'failed'
  transferResults: TransferResult[]
  serviceResults: ServiceResult[]
  warnings: string[]
  errors: string[]
}
