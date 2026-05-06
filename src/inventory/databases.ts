import type { DatabaseContainer, DatabaseEngine } from '../types/manifest.js'
import { getContainerDetails, type RunningContainer } from './docker.js'

export interface DatabaseDumpPlan {
  containerName: string
  engine: DatabaseEngine
  outputFile: string
  command: string
}

const ENGINE_IMAGE_HINTS: Array<{ engine: DatabaseEngine; hints: string[] }> = [
  { engine: 'postgres', hints: ['postgres'] },
  { engine: 'mysql', hints: ['mysql'] },
  { engine: 'mariadb', hints: ['mariadb'] },
  { engine: 'redis', hints: ['redis'] },
  { engine: 'mongo', hints: ['mongo'] },
  { engine: 'elasticsearch', hints: ['elasticsearch'] },
]

const CREDENTIAL_KEYS: Record<DatabaseEngine, string[]> = {
  postgres: ['POSTGRES_USER', 'POSTGRES_PASSWORD', 'POSTGRES_DB'],
  mysql: ['MYSQL_ROOT_PASSWORD', 'MYSQL_USER', 'MYSQL_PASSWORD', 'MYSQL_DATABASE'],
  mariadb: ['MYSQL_ROOT_PASSWORD', 'MYSQL_USER', 'MYSQL_PASSWORD', 'MYSQL_DATABASE'],
  redis: ['REDIS_PASSWORD'],
  mongo: ['MONGO_INITDB_ROOT_USERNAME', 'MONGO_INITDB_ROOT_PASSWORD'],
  mongodb: ['MONGO_INITDB_ROOT_USERNAME', 'MONGO_INITDB_ROOT_PASSWORD'],
  elasticsearch: ['ELASTIC_PASSWORD'],
  other: [],
}

function detectEngine(image: string): DatabaseEngine {
  const lower = image.toLowerCase()
  for (const entry of ENGINE_IMAGE_HINTS) {
    if (entry.hints.some((hint) => lower.includes(hint))) {
      return entry.engine
    }
  }

  return 'other'
}

function parseEnv(env: string[]): Record<string, string> {
  const result: Record<string, string> = {}
  for (const entry of env) {
    const index = entry.indexOf('=')
    if (index <= 0) {
      continue
    }

    const key = entry.slice(0, index)
    const value = entry.slice(index + 1)
    result[key] = value
  }
  return result
}

export async function identifyDatabaseContainers(
  containers: RunningContainer[]
): Promise<DatabaseContainer[]> {
  const databases: DatabaseContainer[] = []

  for (const container of containers) {
    const engine = detectEngine(container.image)
    if (engine === 'other') {
      continue
    }

    const details = await getContainerDetails(container.name)
    const config = (details.Config ?? {}) as { Env?: string[] }
    const envMap = parseEnv(config.Env ?? [])

    const credentialKeys = CREDENTIAL_KEYS[engine]
    const credentials: Record<string, string> = {}
    for (const key of credentialKeys) {
      const value = envMap[key]
      if (value) {
        credentials[key] = value
      }
    }

    const mountsRaw = (details.Mounts ?? []) as Array<Record<string, unknown>>
    const volumeNames = mountsRaw
      .filter((mount) => mount.Type === 'volume')
      .map((mount) => String(mount.Name ?? ''))
      .filter((value) => value.length > 0)

    databases.push({
      containerName: container.name,
      engine,
      image: container.image,
      volumes: volumeNames,
      credentials,
    })
  }

  return databases
}

function dumpFileExtension(engine: DatabaseEngine): string {
  if (engine === 'postgres' || engine === 'mysql' || engine === 'mariadb') {
    return 'sql'
  }
  if (engine === 'redis') {
    return 'rdb'
  }
  if (engine === 'mongo' || engine === 'mongodb') {
    return 'archive.gz'
  }
  return 'dump'
}

export function planDumps(dbContainers: DatabaseContainer[]): DatabaseDumpPlan[] {
  return dbContainers.map((db) => {
    const extension = dumpFileExtension(db.engine)
    const outputFile = `${db.containerName}-${db.engine}.${extension}`

    let command = ''
    if (db.engine === 'postgres') {
      command = `docker exec ${db.containerName} pg_dumpall -U postgres > ${outputFile}`
    } else if (db.engine === 'mysql' || db.engine === 'mariadb') {
      command = `docker exec ${db.containerName} mysqldump --all-databases --single-transaction > ${outputFile}`
    } else if (db.engine === 'redis') {
      command = `docker exec ${db.containerName} redis-cli BGSAVE && docker cp ${db.containerName}:/data/dump.rdb ${outputFile}`
    } else if (db.engine === 'mongo' || db.engine === 'mongodb') {
      command = `docker exec ${db.containerName} mongodump --archive --gzip > ${outputFile}`
    } else if (db.engine === 'elasticsearch') {
      command = `echo "Elasticsearch snapshot requires repository configuration (manual step)"`
    } else {
      command = `echo "Unsupported database engine for automatic dump"`
    }

    return {
      containerName: db.containerName,
      engine: db.engine,
      outputFile,
      command,
    }
  })
}
