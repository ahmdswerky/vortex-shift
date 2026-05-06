import { COMPOSE_SEARCH_PATHS } from '../config/defaults.js'
import { run } from '../utils/shell.js'
import type { DockerVolume } from '../types/manifest.js'
import { discoverComposeProjects } from './docker.js'

const ANONYMOUS_VOLUME_NAME_REGEX = /^[a-f0-9]{64}$/

interface DockerVolumeInspect {
  Name?: string
  Driver?: string
  Mountpoint?: string
  Labels?: Record<string, string>
}

function parseDuSize(output: string): number {
  const token = output.trim().split(/\s+/)[0] ?? '0'
  const size = Number.parseInt(token, 10)
  return Number.isFinite(size) ? size : 0
}

function isInsideDirectory(target: string, parent: string): boolean {
  return target === parent || target.startsWith(`${parent}/`)
}

export async function discoverExternalVolumes(): Promise<DockerVolume[]> {
  const composeProjects = await discoverComposeProjects(COMPOSE_SEARCH_PATHS)
  const projectDirs = composeProjects.map((project) => project.dir)

  const listResult = await run('docker', ['volume', 'ls', '--format', '{{.Name}}'])
  const allNames = listResult.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((name) => !ANONYMOUS_VOLUME_NAME_REGEX.test(name))

  const volumes: DockerVolume[] = []

  for (const volumeName of allNames) {
    const inspectResult = await run('docker', ['volume', 'inspect', volumeName])
    const inspectPayload = JSON.parse(inspectResult.stdout) as unknown
    if (!Array.isArray(inspectPayload) || inspectPayload.length === 0) {
      continue
    }

    const inspect = inspectPayload[0] as DockerVolumeInspect
    const mountpoint = inspect.Mountpoint ?? ''
    const driver = inspect.Driver ?? 'local'
    const labels = inspect.Labels ?? {}
    const linkedProject = labels['com.docker.compose.project']
    const insideProjectDir = projectDirs.some((dir) => isInsideDirectory(mountpoint, dir))

    if (insideProjectDir) {
      continue
    }

    let size = 0
    try {
      const duResult = await run('du', ['-sb', mountpoint])
      size = parseDuSize(duResult.stdout)
    } catch {
      size = 0
    }

    const baseVolume: DockerVolume = {
      name: inspect.Name ?? volumeName,
      driver,
      mountpoint,
      size,
    }

    volumes.push(linkedProject ? { ...baseVolume, linkedProject } : baseVolume)
  }

  return volumes.sort((a, b) => a.name.localeCompare(b.name))
}
