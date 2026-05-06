import path from 'node:path'
import pLimit from 'p-limit'
import { ensureDir } from '../utils/fs.js'
import { run } from '../utils/shell.js'
import type { DatabaseContainer } from '../types/manifest.js'

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\"'\"'")}'`
}

async function waitForRedisSave(container: string, baseline: number): Promise<void> {
  const maxAttempts = 60
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const nowRaw = await run('docker', ['exec', container, 'redis-cli', 'LASTSAVE'])
    const now = Number.parseInt(nowRaw.stdout.trim(), 10)
    if (Number.isFinite(now) && now > baseline) {
      return
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 1_000)
    })
  }

  throw new Error(`Timed out waiting for Redis BGSAVE completion for container ${container}`)
}

export async function dumpPostgres(container: DatabaseContainer, destDir: string): Promise<string> {
  const outputFile = path.join(destDir, `${container.containerName}-postgres.sql`)
  await run('sh', [
    '-c',
    `docker exec ${shellQuote(container.containerName)} pg_dumpall -U postgres > ${shellQuote(outputFile)}`,
  ])
  return outputFile
}

export async function dumpMySQL(container: DatabaseContainer, destDir: string): Promise<string> {
  const outputFile = path.join(destDir, `${container.containerName}-${container.engine}.sql`)
  const password = container.credentials?.MYSQL_ROOT_PASSWORD
  const passwordEnv = password ? `-e MYSQL_PWD=${shellQuote(password)}` : ''

  await run('sh', [
    '-c',
    `docker exec ${passwordEnv} ${shellQuote(container.containerName)} mysqldump --all-databases -uroot > ${shellQuote(outputFile)}`,
  ])

  return outputFile
}

export async function dumpRedis(container: DatabaseContainer, destDir: string): Promise<string> {
  const outputFile = path.join(destDir, `${container.containerName}-redis.rdb`)
  const baselineRaw = await run('docker', ['exec', container.containerName, 'redis-cli', 'LASTSAVE'])
  const baseline = Number.parseInt(baselineRaw.stdout.trim(), 10)

  await run('docker', ['exec', container.containerName, 'redis-cli', 'BGSAVE'])
  await waitForRedisSave(container.containerName, Number.isFinite(baseline) ? baseline : 0)
  await run('docker', ['cp', `${container.containerName}:/data/dump.rdb`, outputFile])

  return outputFile
}

export async function dumpMongo(container: DatabaseContainer, destDir: string): Promise<string> {
  const outputFile = path.join(destDir, `${container.containerName}-mongo.archive.gz`)
  await run('sh', [
    '-c',
    `docker exec ${shellQuote(container.containerName)} mongodump --archive --gzip > ${shellQuote(outputFile)}`,
  ])
  return outputFile
}

export async function dumpAll(
  dbContainers: DatabaseContainer[],
  destDir: string
): Promise<DatabaseContainer[]> {
  await ensureDir(destDir)
  const limit = pLimit(2)

  await Promise.all(
    dbContainers.map((dbContainer) =>
      limit(async () => {
        if (dbContainer.engine === 'postgres') {
          dbContainer.dumpFile = await dumpPostgres(dbContainer, destDir)
          return
        }

        if (dbContainer.engine === 'mysql' || dbContainer.engine === 'mariadb') {
          dbContainer.dumpFile = await dumpMySQL(dbContainer, destDir)
          return
        }

        if (dbContainer.engine === 'redis') {
          dbContainer.dumpFile = await dumpRedis(dbContainer, destDir)
          return
        }

        if (dbContainer.engine === 'mongo' || dbContainer.engine === 'mongodb') {
          dbContainer.dumpFile = await dumpMongo(dbContainer, destDir)
          return
        }

        delete dbContainer.dumpFile
      })
    )
  )

  return dbContainers
}
