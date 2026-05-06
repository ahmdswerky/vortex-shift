import { run, ShellError } from '../utils/shell.js'
import type { PM2App } from '../types/manifest.js'

interface PM2ProcessEnv {
  name?: string
  pm_exec_path?: string
  pm_cwd?: string
  status?: string
}

interface PM2Process {
  name?: string
  pm_id?: number
  pm2_env?: PM2ProcessEnv
}

function toPM2App(item: PM2Process): PM2App {
  const env = item.pm2_env ?? {}
  const name = item.name ?? env.name ?? 'unknown'
  const script = env.pm_exec_path ?? ''
  const cwd = env.pm_cwd ?? ''

  return {
    name,
    script,
    cwd,
    pm2Id: typeof item.pm_id === 'number' ? item.pm_id : -1,
    status: env.status ?? 'unknown',
    ecosystemEntry: `${name}:${script}`,
  }
}

export async function discoverPM2Apps(onWarn?: (message: string) => void): Promise<PM2App[]> {
  try {
    const listResult = await run('pm2', ['jlist'])
    let parsed: unknown
    try {
      parsed = JSON.parse(listResult.stdout)
    } catch {
      parsed = []
    }

    if (!Array.isArray(parsed)) {
      return []
    }

    try {
      await run('pm2', ['save'])
    } catch {
      // best effort: inventory still valid without forcing save
    }

    return parsed.map((item) => toPM2App(item as PM2Process))
  } catch (error) {
    if (error instanceof ShellError) {
      onWarn?.('PM2 not found; PM2 inventory will be empty.')
      return []
    }

    throw error
  }
}
