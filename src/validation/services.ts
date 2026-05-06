import path from 'node:path'
import { DEFAULT_DUMP_DIR, HEALTH_CHECK_TIMEOUT_MS } from '../config/defaults.js'
import type { DatabaseContainer, DockerProject, NginxSnapshot, PM2App } from '../types/manifest.js'
import type { ServiceResult } from '../types/report.js'
import { fileExists } from '../utils/fs.js'
import { run, ShellError } from '../utils/shell.js'
import { checkContainerRunning, waitForDockerHealthy, waitForPort } from './health.js'

function ok(name: string, type: ServiceResult['type'], healthCheck: string): ServiceResult {
  return { name, type, status: 'ok', healthCheck }
}

function failed(
  name: string,
  type: ServiceResult['type'],
  healthCheck: string,
  error: string
): ServiceResult {
  return { name, type, status: 'failed', healthCheck, error }
}

async function getComposeContainerIds(composeFile: string): Promise<string[]> {
  const result = await run('docker', ['compose', '-f', composeFile, 'ps', '-q'])
  return result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

async function waitForComposeHealthy(composeFile: string, timeoutMs: number): Promise<boolean> {
  const containerIds = await getComposeContainerIds(composeFile)
  for (const containerId of containerIds) {
    const healthy = await waitForDockerHealthy(containerId, timeoutMs)
    if (!healthy) {
      return false
    }
  }

  return true
}

export async function startComposeProjects(projects: DockerProject[]): Promise<ServiceResult[]> {
  const dbFirst = projects.filter((project) => project.hasDatabase)
  const rest = projects.filter((project) => !project.hasDatabase)
  const ordered = [...dbFirst, ...rest]
  const results: ServiceResult[] = []

  for (const project of ordered) {
    try {
      await run('docker', ['compose', '-f', project.composeFile, 'up', '-d'])

      if (project.hasDatabase) {
        const healthy = await waitForComposeHealthy(project.composeFile, HEALTH_CHECK_TIMEOUT_MS)
        if (!healthy) {
          results.push(
            failed(project.name, 'docker', 'docker compose health', 'Database containers did not become healthy')
          )
          continue
        }
      }

      results.push(ok(project.name, 'docker', 'docker compose up -d'))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      results.push(failed(project.name, 'docker', 'docker compose up -d', message))
    }
  }

  return results
}

export async function startPM2Apps(apps: PM2App[]): Promise<ServiceResult[]> {
  const results: ServiceResult[] = []

  try {
    await run('pm2', ['resurrect'])
  } catch (error) {
    if (error instanceof ShellError) {
      for (const app of apps) {
        try {
          await run('pm2', ['start', app.script, '--name', app.name, '--cwd', app.cwd])
        } catch (startError) {
          const message = startError instanceof Error ? startError.message : String(startError)
          results.push(failed(app.name, 'pm2', 'pm2 start fallback', message))
        }
      }
    } else {
      throw error
    }
  }

  let list: unknown = []
  try {
    const jlist = await run('pm2', ['jlist'])
    list = JSON.parse(jlist.stdout)
  } catch {
    list = []
  }
  const appStatusByName = new Map<string, string>()
  if (Array.isArray(list)) {
    for (const item of list as Array<Record<string, unknown>>) {
      const name = String(item.name ?? '')
      const env = (item.pm2_env ?? {}) as Record<string, unknown>
      const status = String(env.status ?? 'unknown')
      if (name) {
        appStatusByName.set(name, status)
      }
    }
  }

  for (const app of apps) {
    const status = appStatusByName.get(app.name)
    if (status === 'online') {
      results.push(ok(app.name, 'pm2', 'pm2 status online'))
    } else if (!results.some((result) => result.name === app.name && result.type === 'pm2')) {
      results.push(failed(app.name, 'pm2', 'pm2 status online', `Current status: ${status ?? 'unknown'}`))
    }
  }

  return results
}

export async function startNginxProxyManager(snapshot: NginxSnapshot): Promise<ServiceResult> {
  const primaryComposeFile = path.join(snapshot.dataPath, 'docker-compose.yml')
  const secondaryComposeFile = path.join(snapshot.dataPath, 'compose.yml')
  const composeCandidates = [primaryComposeFile, secondaryComposeFile]

  let composeFile: string = primaryComposeFile
  for (const candidate of composeCandidates) {
    if (await fileExists(candidate)) {
      composeFile = candidate
      break
    }
  }

  try {
    await run('docker', ['compose', '-f', composeFile, 'up', '-d'])
    const portReady = await waitForPort('127.0.0.1', 81, HEALTH_CHECK_TIMEOUT_MS)

    if (!portReady) {
      return failed(
        'nginx-proxy-manager',
        'nginx',
        'port 81 ready',
        'NPM admin port did not become ready'
      )
    }

    return ok('nginx-proxy-manager', 'nginx', 'port 81 ready')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return failed('nginx-proxy-manager', 'nginx', 'docker compose up -d', message)
  }
}

export async function restoreDatabases(dbContainers: DatabaseContainer[]): Promise<ServiceResult[]> {
  const results: ServiceResult[] = []

  for (const db of dbContainers) {
    const dumpFile = db.dumpFile ?? path.join(DEFAULT_DUMP_DIR, `${db.containerName}-${db.engine}.sql`)

    try {
      const running = await checkContainerRunning(db.containerName)
      if (!running) {
        results.push(failed(db.containerName, 'system', 'container running', 'Container is not running'))
        continue
      }

      if (db.engine === 'postgres') {
        await run('sh', [
          '-c',
          `docker exec -i ${JSON.stringify(db.containerName)} psql -U postgres < ${JSON.stringify(dumpFile)}`,
        ])
        results.push(ok(db.containerName, 'system', 'psql restore'))
        continue
      }

      if (db.engine === 'mysql' || db.engine === 'mariadb') {
        await run('sh', [
          '-c',
          `docker exec -i ${JSON.stringify(db.containerName)} mysql -uroot < ${JSON.stringify(dumpFile)}`,
        ])
        results.push(ok(db.containerName, 'system', 'mysql restore'))
        continue
      }

      if (db.engine === 'redis') {
        await run('docker', ['cp', dumpFile, `${db.containerName}:/data/dump.rdb`])
        await run('docker', ['restart', db.containerName])
        results.push(ok(db.containerName, 'system', 'redis dump restore'))
        continue
      }

      if (db.engine === 'mongo' || db.engine === 'mongodb') {
        await run('sh', [
          '-c',
          `docker exec -i ${JSON.stringify(db.containerName)} mongorestore --archive --gzip < ${JSON.stringify(
            dumpFile
          )}`,
        ])
        results.push(ok(db.containerName, 'system', 'mongorestore'))
        continue
      }

      results.push({
        name: db.containerName,
        type: 'system',
        status: 'warning',
        healthCheck: 'restore skipped',
        error: `No restore automation for engine ${db.engine}`,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      results.push(failed(db.containerName, 'system', 'database restore', message))
    }
  }

  return results
}
