import path from 'node:path'
import type { MigrationContext } from '../types/context.js'
import type { MigrationReport, ServiceResult, TransferResult } from '../types/report.js'
import type { Logger } from './logger.js'
import { formatBytes, formatDate, formatDuration, formatList, formatTable } from '../utils/format.js'
import { writeJson } from '../utils/fs.js'

function reportStatus(serviceResults: ServiceResult[], warnings: string[], errors: string[]): MigrationReport['status'] {
  const hasFailedService = serviceResults.some((service) => service.status === 'failed')
  if (hasFailedService || errors.length > 0) {
    return 'failed'
  }

  if (warnings.length > 0 || serviceResults.some((service) => service.status === 'warning')) {
    return 'partial'
  }

  return 'success'
}

export function buildReport(
  ctx: MigrationContext,
  serviceResults: ServiceResult[],
  transferResults: TransferResult[],
  warnings: string[] = [],
  errors: string[] = []
): MigrationReport {
  const startedAt = ctx.checkpoint.startedAt
  const endedAt = new Date().toISOString()

  return {
    id: `migration-${Date.now()}`,
    startedAt,
    endedAt,
    sourceHost: ctx.manifest?.sourceHost ?? 'unknown-source',
    destinationHost: ctx.config.destination.host,
    status: reportStatus(serviceResults, warnings, errors),
    transferResults,
    serviceResults,
    warnings,
    errors,
  }
}

export function printReport(report: MigrationReport, log: Logger): void {
  const durationMs = new Date(report.endedAt).getTime() - new Date(report.startedAt).getTime()
  const transferRows = report.transferResults.map((row) => ({
    resource: row.resource,
    size: formatBytes(row.bytesTransferred),
    duration: formatDuration(row.duration),
    checksum: row.checksumVerified ? 'yes' : 'no',
  }))

  const serviceRows = report.serviceResults.map((row) => ({
    name: row.name,
    type: row.type,
    status: row.status,
    health: row.healthCheck,
  }))

  log.info(`Migration Report (${report.status})`)
  log.info(`Source -> Destination: ${report.sourceHost} -> ${report.destinationHost}`)
  log.info(`Started: ${formatDate(report.startedAt)}`)
  log.info(`Ended: ${formatDate(report.endedAt)}`)
  log.info(`Duration: ${formatDuration(durationMs)}`)

  if (transferRows.length > 0) {
    log.info(
      `\nTransferred Resources\n${formatTable(transferRows, [
        { key: 'resource', header: 'Resource' },
        { key: 'size', header: 'Size' },
        { key: 'duration', header: 'Duration' },
        { key: 'checksum', header: 'Checksum' },
      ])}`
    )
  }

  if (serviceRows.length > 0) {
    log.info(
      `\nServices\n${formatTable(serviceRows, [
        { key: 'name', header: 'Name' },
        { key: 'type', header: 'Type' },
        { key: 'status', header: 'Status' },
        { key: 'health', header: 'Health Check' },
      ])}`
    )
  }

  if (report.warnings.length > 0) {
    log.warn(`Warnings:\n${formatList(report.warnings)}`)
  }

  if (report.errors.length > 0) {
    log.error(`Errors:\n${formatList(report.errors)}`)
  }

  const failedServices = report.serviceResults.filter((service) => service.status === 'failed')
  if (failedServices.length > 0) {
    log.warn('Next steps: inspect failed services, check container logs, then re-run with --resume.')
  }
}

export async function saveReport(report: MigrationReport, outputPath: string): Promise<void> {
  await writeJson(outputPath, report)
}

export function defaultReportPath(ctx: MigrationContext): string {
  return path.join(ctx.config.paths.checkpointDir, 'migration-report.json')
}
