import path from 'node:path'
import { readdir } from 'node:fs/promises'
import { DEFAULT_NPM_DATA_PATH } from '../config/defaults.js'
import type { NginxSnapshot } from '../types/manifest.js'
import { fileExists } from '../utils/fs.js'
import { getRunningContainers } from './docker.js'

function parseImageVersion(image: string): string {
  const parts = image.split(':')
  if (parts.length < 2) {
    return 'unknown'
  }

  return parts[parts.length - 1] || 'unknown'
}

async function findProxyHostDir(basePath: string): Promise<string | null> {
  const candidates = [path.join(basePath, 'data', 'nginx', 'proxy_host'), path.join(basePath, 'nginx', 'proxy_host')]
  for (const candidate of candidates) {
    if (await fileExists(candidate)) {
      return candidate
    }
  }

  return null
}

export async function snapshotNginxProxyManager(dataPath = DEFAULT_NPM_DATA_PATH): Promise<NginxSnapshot> {
  const containers = await getRunningContainers()
  const npmContainer = containers.find((container) => {
    const image = container.image.toLowerCase()
    const name = container.name.toLowerCase()
    return image.includes('nginx-proxy-manager') || name.includes('nginx-proxy-manager')
  })

  const resolvedDataPath = dataPath
  const proxyHostDir = await findProxyHostDir(resolvedDataPath)

  let proxyHostCount = 0
  if (proxyHostDir) {
    const entries = await readdir(proxyHostDir, { withFileTypes: true })
    proxyHostCount = entries.filter((entry) => entry.isFile()).length
  }

  return {
    dataPath: resolvedDataPath,
    version: npmContainer ? parseImageVersion(npmContainer.image) : 'not-running',
    proxyHostCount,
  }
}
