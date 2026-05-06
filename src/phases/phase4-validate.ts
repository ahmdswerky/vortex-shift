import path from 'node:path'
import { HEALTH_CHECK_TIMEOUT_MS, HEALTH_CHECK_POLL_INTERVAL_MS } from '../config/defaults.js'
import { buildReport, defaultReportPath, printReport, saveReport } from '../core/reporter.js'
import { StepRunner, type Step } from '../core/executor.js'
import type { MigrationContext } from '../types/context.js'
import type { Manifest } from '../types/manifest.js'
import type { ServiceResult, TransferResult } from '../types/report.js'
import { fileExists, readJson } from '../utils/fs.js'
import { run } from '../utils/shell.js'
import { buildChecksumManifest, loadChecksumManifest, saveChecksumManifest, verifyChecksums } from '../validation/checksums.js'
import { waitForDockerHealthy, waitForHttp } from '../validation/health.js'
import {
  restoreDatabases,
  startComposeProjects,
  startNginxProxyManager,
  startPM2Apps,
} from '../validation/services.js'

interface Phase4State {
  manifest: Manifest
  transferResults: TransferResult[]
  serviceResults: ServiceResult[]
  warnings: string[]
  errors: string[]
}

function toTransferPathCandidates(manifest: Manifest): string[] {
  const paths = new Set<string>()

  for (const volume of manifest.externalVolumes) {
    paths.add(volume.mountpoint)
  }
  for (const project of manifest.dockerProjects) {
    paths.add(project.dir)
  }
  for (const app of manifest.pm2Apps) {
    paths.add(app.cwd)
  }
  for (const db of manifest.databases) {
    if (db.dumpFile) {
      paths.add(db.dumpFile)
    }
  }
  paths.add(manifest.nginxProxyManager.dataPath)

  return [...paths]
}

async function loadManifest(ctx: MigrationContext): Promise<Manifest> {
  if (ctx.manifest) {
    return ctx.manifest
  }

  const manifestPath = path.join(ctx.config.paths.checkpointDir, 'manifest.json')
  if (ctx.isDryRun && !(await fileExists(manifestPath))) {
    return {
      createdAt: new Date().toISOString(),
      sourceHost: 'dry-run',
      dockerProjects: [],
      externalVolumes: [],
      pm2Apps: [],
      databases: [],
      nginxProxyManager: {
        dataPath: ctx.config.paths.nginxProxyManagerDataPath,
        version: 'dry-run',
        proxyHostCount: 0,
      },
    }
  }

  return readJson<Manifest>(manifestPath)
}

async function loadTransferResults(ctx: MigrationContext): Promise<TransferResult[]> {
  const transferFilePath = path.join(ctx.config.paths.checkpointDir, 'transfer-results.json')
  if (!(await fileExists(transferFilePath))) {
    return []
  }

  return readJson<TransferResult[]>(transferFilePath)
}

async function getComposeContainerIds(composeFile: string): Promise<string[]> {
  const result = await run('docker', ['compose', '-f', composeFile, 'ps', '-q'])
  return result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

export async function runPhase4(ctx: MigrationContext): Promise<void> {
  const manifest = await loadManifest(ctx)
  const transferResults = await loadTransferResults(ctx)
  const state: Phase4State = {
    manifest,
    transferResults,
    serviceResults: [],
    warnings: [],
    errors: [],
  }

  const checksumsPath = path.join(ctx.config.paths.checkpointDir, 'checksums.json')

  const steps: Step[] = [
    {
      id: 'validate.checksums',
      name: 'Verify checksums',
      run: async () => {
        const targetPaths = toTransferPathCandidates(state.manifest)

        if (!(await fileExists(checksumsPath))) {
          const generated = await buildChecksumManifest(targetPaths)
          await saveChecksumManifest(checksumsPath, generated)
          state.warnings.push('No source checksum manifest found; generated destination baseline only.')
          return
        }

        const manifestChecksums = await loadChecksumManifest(checksumsPath)
        const result = await verifyChecksums(manifestChecksums, targetPaths)
        if (!result.ok) {
          const errors = result.mismatches.map(
            (item) => `Checksum mismatch for ${item.path}: expected=${item.expected} actual=${item.actual}`
          )
          state.errors.push(...errors)
          throw new Error(`Checksum verification failed for ${result.mismatches.length} path(s)`)
        }
      },
    },
    {
      id: 'validate.docker-volumes',
      name: 'Validate destination Docker volumes',
      run: async () => {
        for (const volume of state.manifest.externalVolumes) {
          const inspectResult = await run('docker', [
            'volume',
            'inspect',
            '--format',
            '{{.Mountpoint}}',
            volume.name,
          ])
          const mountpoint = inspectResult.stdout.trim()
          if (!mountpoint) {
            throw new Error(`Volume missing on destination: ${volume.name}`)
          }

          const existence = await run('sh', ['-c', `[ -d ${JSON.stringify(mountpoint)} ] && echo yes || echo no`])
          if (existence.stdout.trim() !== 'yes') {
            throw new Error(`Volume mountpoint missing for ${volume.name}: ${mountpoint}`)
          }

          const nonEmpty = await run('sh', [
            '-c',
            `[ "$(ls -A ${JSON.stringify(mountpoint)} 2>/dev/null | wc -l)" -gt 0 ] && echo yes || echo no`,
          ])
          if (nonEmpty.stdout.trim() !== 'yes') {
            throw new Error(`Volume mountpoint is empty for ${volume.name}: ${mountpoint}`)
          }
        }
      },
    },
    {
      id: 'validate.db-restore',
      name: 'Restore databases',
      run: async () => {
        const results = await restoreDatabases(state.manifest.databases)
        state.serviceResults.push(...results)
      },
    },
    {
      id: 'validate.compose-up',
      name: 'Start compose projects',
      run: async () => {
        const results = await startComposeProjects(state.manifest.dockerProjects)
        state.serviceResults.push(...results)
      },
    },
    {
      id: 'validate.compose-health',
      name: 'Validate compose container health',
      run: async () => {
        for (const project of state.manifest.dockerProjects) {
          const containerIds = await getComposeContainerIds(project.composeFile)
          for (const containerId of containerIds) {
            const healthy = await waitForDockerHealthy(containerId, HEALTH_CHECK_TIMEOUT_MS)
            if (!healthy) {
              throw new Error(`Container did not become healthy: ${containerId} (${project.name})`)
            }
          }
        }
      },
    },
    {
      id: 'validate.pm2-restore',
      name: 'Restore PM2 apps',
      run: async () => {
        const results = await startPM2Apps(state.manifest.pm2Apps)
        state.serviceResults.push(...results)
      },
    },
    {
      id: 'validate.nginx-restore',
      name: 'Restore NGINX Proxy Manager',
      run: async () => {
        const result = await startNginxProxyManager(state.manifest.nginxProxyManager)
        state.serviceResults.push(result)
      },
    },
    {
      id: 'validate.service-health',
      name: 'Run configured HTTP health checks',
      run: async () => {
        for (const healthCheck of ctx.config.healthChecks) {
          const ok = await waitForHttp(
            healthCheck.url,
            200,
            healthCheck.timeout || HEALTH_CHECK_TIMEOUT_MS,
            HEALTH_CHECK_POLL_INTERVAL_MS
          )
          if (ok) {
            state.serviceResults.push({
              name: healthCheck.name,
              type: 'system',
              status: 'ok',
              healthCheck: healthCheck.url,
            })
          } else {
            state.serviceResults.push({
              name: healthCheck.name,
              type: 'system',
              status: 'failed',
              healthCheck: healthCheck.url,
              error: 'Timed out waiting for expected HTTP 200',
            })
          }
        }
      },
    },
    {
      id: 'validate.report',
      name: 'Generate final migration report',
      run: async () => {
        const report = buildReport(
          ctx,
          state.serviceResults,
          state.transferResults,
          state.warnings,
          state.errors
        )
        printReport(report, ctx.log)
        await saveReport(report, defaultReportPath(ctx))
      },
    },
  ]

  ctx.checkpoint.phase = 4
  const runner = new StepRunner(ctx)
  await runner.run(steps)
}
