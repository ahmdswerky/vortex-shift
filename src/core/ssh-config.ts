import os from 'node:os'
import path from 'node:path'
import { promises as fs } from 'node:fs'

export interface SSHConfigHost {
  alias: string
  hostname: string
  user?: string
  port?: number
  identityFile?: string
}

const SSH_CONFIG_PATH = path.join(os.homedir(), '.ssh', 'config')

function expandPath(value: string): string {
  if (value === '~' || value.startsWith('~/')) {
    return path.join(os.homedir(), value.slice(2))
  }
  return value
}

export async function parseSSHConfig(): Promise<SSHConfigHost[]> {
  let raw: string
  try {
    raw = await fs.readFile(SSH_CONFIG_PATH, 'utf8')
  } catch {
    return []
  }

  const hosts: SSHConfigHost[] = []
  let current: Partial<SSHConfigHost> | null = null

  for (const rawLine of raw.split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) {
      continue
    }

    const spaceIndex = line.indexOf(' ')
    if (spaceIndex === -1) {
      continue
    }

    const key = line.slice(0, spaceIndex).toLowerCase()
    const value = line.slice(spaceIndex + 1).trim()

    if (key === 'host') {
      if (current?.alias && current.hostname) {
        hosts.push(current as SSHConfigHost)
      }
      // Skip wildcard blocks — they have no actionable alias
      if (value === '*' || value.includes('*')) {
        current = null
        continue
      }
      current = { alias: value }
      continue
    }

    if (!current) {
      continue
    }

    if (key === 'hostname') {
      current.hostname = value
    } else if (key === 'user') {
      current.user = value
    } else if (key === 'port') {
      const parsed = Number.parseInt(value, 10)
      if (!Number.isNaN(parsed)) {
        current.port = parsed
      }
    } else if (key === 'identityfile') {
      current.identityFile = expandPath(value)
    }
  }

  if (current?.alias && current.hostname) {
    hosts.push(current as SSHConfigHost)
  }

  return hosts
}

export async function resolveSSHConfigHost(alias: string): Promise<SSHConfigHost | null> {
  const hosts = await parseSSHConfig()
  return hosts.find((h) => h.alias === alias) ?? null
}

export async function listSSHConfigHosts(): Promise<SSHConfigHost[]> {
  return parseSSHConfig()
}
