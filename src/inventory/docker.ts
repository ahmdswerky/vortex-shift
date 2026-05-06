import path from 'node:path'
import { readFile } from 'node:fs/promises'
import { run, ShellError } from '../utils/shell.js'
import { fileExists } from '../utils/fs.js'
import type { DockerProject } from '../types/manifest.js'

const DB_IMAGE_HINTS = [
  'postgres',
  'mysql',
  'mariadb',
  'redis',
  'mongo',
  'elasticsearch',
]

export interface RunningContainer {
  id: string
  name: string
  image: string
  status: string
  state: string
  labels: string
}

export type DockerInspect = Record<string, unknown>

function parseTopLevelComposeName(content: string): string | null {
  const match = content.match(/^\s*name:\s*["']?([^"'\n#]+)["']?\s*$/m)
  return match?.[1]?.trim() ?? null
}

function includesKnownDatabaseImage(text: string): boolean {
  const lower = text.toLowerCase()
  return DB_IMAGE_HINTS.some((keyword) => lower.includes(keyword))
}

function extractServicesFromComposeText(content: string): string[] {
  const lines = content.split('\n')
  const services: string[] = []
  let inServices = false
  let servicesIndent = -1

  for (const line of lines) {
    const raw = line.replace(/\t/g, '  ')
    const trimmed = raw.trim()
    if (!trimmed || trimmed.startsWith('#')) {
      continue
    }

    const indent = raw.length - raw.trimStart().length

    if (!inServices && /^services:\s*$/.test(trimmed)) {
      inServices = true
      servicesIndent = indent
      continue
    }

    if (!inServices) {
      continue
    }

    if (indent <= servicesIndent) {
      break
    }

    const serviceMatch = raw.match(/^\s{2,}([a-zA-Z0-9_.-]+):\s*$/)
    if (serviceMatch?.[1] && indent === servicesIndent + 2) {
      services.push(serviceMatch[1])
    }
  }

  return [...new Set(services)]
}

async function findComposeFilesInPath(searchPath: string): Promise<string[]> {
  if (!(await fileExists(searchPath))) {
    return []
  }

  const result = await run('find', [
    searchPath,
    '-type',
    'f',
    '(',
    '-name',
    'docker-compose.yml',
    '-o',
    '-name',
    'docker-compose.yaml',
    '-o',
    '-name',
    'compose.yml',
    '-o',
    '-name',
    'compose.yaml',
    ')',
    '-not',
    '-path',
    '/proc/*',
    '-not',
    '-path',
    '/sys/*',
    '-not',
    '-path',
    '/dev/*',
    '-not',
    '-path',
    '/run/*',
  ])

  return result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

async function getComposeServices(composeFile: string, content: string): Promise<string[]> {
  try {
    const result = await run('docker', ['compose', '-f', composeFile, 'config', '--services'])
    const services = result.stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)

    if (services.length > 0) {
      return services
    }
  } catch (error) {
    if (!(error instanceof ShellError)) {
      throw error
    }
  }

  return extractServicesFromComposeText(content)
}

export async function discoverComposeProjects(searchPaths: string[]): Promise<DockerProject[]> {
  const composeFiles = new Set<string>()

  for (const searchPath of searchPaths) {
    const files = await findComposeFilesInPath(searchPath)
    for (const file of files) {
      composeFiles.add(file)
    }
  }

  const projects: DockerProject[] = []

  for (const composeFile of composeFiles) {
    const composeDir = path.dirname(composeFile)
    const content = await readFile(composeFile, 'utf8')
    const services = await getComposeServices(composeFile, content)
    let hasDatabase = includesKnownDatabaseImage(content)
    try {
      const renderedConfig = await run('docker', ['compose', '-f', composeFile, 'config'])
      hasDatabase = includesKnownDatabaseImage(renderedConfig.stdout)
    } catch (error) {
      if (!(error instanceof ShellError)) {
        throw error
      }
    }
    const name = parseTopLevelComposeName(content) ?? path.basename(composeDir)

    projects.push({
      name,
      dir: composeDir,
      composeFile,
      services,
      hasDatabase,
    })
  }

  return projects.sort((a, b) => a.name.localeCompare(b.name))
}

export async function getRunningContainers(): Promise<RunningContainer[]> {
  const result = await run('docker', ['ps', '--format', '{{json .}}'])

  const containers: RunningContainer[] = []
  const lines = result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

  for (const line of lines) {
    const parsed = JSON.parse(line) as Record<string, unknown>
    containers.push({
      id: String(parsed.ID ?? ''),
      name: String(parsed.Names ?? ''),
      image: String(parsed.Image ?? ''),
      status: String(parsed.Status ?? ''),
      state: String(parsed.State ?? ''),
      labels: String(parsed.Labels ?? ''),
    })
  }

  return containers
}

export async function getContainerDetails(name: string): Promise<DockerInspect> {
  const result = await run('docker', ['inspect', name])
  const parsed = JSON.parse(result.stdout) as unknown

  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error(`No docker inspect data returned for container: ${name}`)
  }

  const first = parsed[0]
  if (!first || typeof first !== 'object') {
    throw new Error(`Invalid docker inspect payload for container: ${name}`)
  }

  return first as DockerInspect
}
