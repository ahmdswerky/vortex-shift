import { z } from 'zod'

export interface SSHConfig {
  host: string
  user: string
  port: number
  sshKeyPath: string
}

export interface TransferConfig {
  retries: number
  concurrency: number
  rsyncExtraArgs: string[]
  excludePaths: string[]
}

export interface HealthCheckConfig {
  name: string
  url: string
  timeout: number
}

export interface MigrationConfig {
  destination: SSHConfig
  transfer: TransferConfig
  healthChecks: HealthCheckConfig[]
  paths: {
    dumpDir: string
    checkpointDir: string
    logFile: string
    nginxProxyManagerDataPath: string
    pm2DumpPath: string
  }
  verbose: boolean
}

export interface CLIOptions {
  config?: string
  destinationHost?: string
  destinationUser?: string
  destinationPort?: number
  sshKeyPath?: string
  checkpointDir?: string
  logFile?: string
  verbose: boolean
  resume: boolean
  dryRun: boolean
}

export const sshConfigSchema = z.object({
  host: z.string().min(1, 'destination.host is required'),
  user: z.string().min(1, 'destination.user is required'),
  port: z.number().int().positive(),
  sshKeyPath: z.string().min(1, 'destination.sshKeyPath is required'),
})

export const transferConfigSchema = z.object({
  retries: z.number().int().min(0),
  concurrency: z.number().int().positive(),
  rsyncExtraArgs: z.array(z.string()),
  excludePaths: z.array(z.string()),
})

export const healthCheckConfigSchema = z.object({
  name: z.string().min(1),
  url: z.string().url(),
  timeout: z.number().int().positive(),
})

export const migrationConfigSchema = z.object({
  destination: sshConfigSchema,
  transfer: transferConfigSchema,
  healthChecks: z.array(healthCheckConfigSchema),
  paths: z.object({
    dumpDir: z.string().min(1),
    checkpointDir: z.string().min(1),
    logFile: z.string().min(1),
    nginxProxyManagerDataPath: z.string().min(1),
    pm2DumpPath: z.string().min(1),
  }),
  verbose: z.boolean(),
})

export type MigrationConfigInput = z.infer<typeof migrationConfigSchema>
