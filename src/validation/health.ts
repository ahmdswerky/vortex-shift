import net from 'node:net'
import { HEALTH_CHECK_POLL_INTERVAL_MS } from '../config/defaults.js'
import { run, ShellError } from '../utils/shell.js'

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

export async function waitForPort(
  host: string,
  port: number,
  timeoutMs: number,
  pollIntervalMs = HEALTH_CHECK_POLL_INTERVAL_MS
): Promise<boolean> {
  const start = Date.now()

  while (Date.now() - start < timeoutMs) {
    const ok = await new Promise<boolean>((resolve) => {
      const socket = net.createConnection({ host, port })
      const done = (value: boolean): void => {
        socket.removeAllListeners()
        socket.destroy()
        resolve(value)
      }

      socket.setTimeout(Math.min(5_000, pollIntervalMs))
      socket.once('connect', () => done(true))
      socket.once('error', () => done(false))
      socket.once('timeout', () => done(false))
    })

    if (ok) {
      return true
    }

    await sleep(pollIntervalMs)
  }

  return false
}

export async function httpGet(url: string, timeoutMs: number): Promise<number> {
  const controller = new AbortController()
  const timer = setTimeout(() => {
    controller.abort()
  }, timeoutMs)

  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
    })
    return response.status
  } finally {
    clearTimeout(timer)
  }
}

export async function waitForHttp(
  url: string,
  expectedStatus: number,
  timeoutMs: number,
  pollIntervalMs = HEALTH_CHECK_POLL_INTERVAL_MS
): Promise<boolean> {
  const start = Date.now()

  while (Date.now() - start < timeoutMs) {
    try {
      const status = await httpGet(url, pollIntervalMs)
      if (status === expectedStatus) {
        return true
      }
    } catch {
      // keep polling
    }

    await sleep(pollIntervalMs)
  }

  return false
}

function parseDockerHealth(stdout: string): string {
  return stdout.trim().toLowerCase()
}

export async function waitForDockerHealthy(
  containerName: string,
  timeoutMs: number,
  pollIntervalMs = HEALTH_CHECK_POLL_INTERVAL_MS
): Promise<boolean> {
  const start = Date.now()

  while (Date.now() - start < timeoutMs) {
    try {
      const result = await run('docker', [
        'inspect',
        '--format',
        '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}',
        containerName,
      ])
      const status = parseDockerHealth(result.stdout)
      if (status === 'healthy' || status === 'running') {
        return true
      }
    } catch (error) {
      if (!(error instanceof ShellError)) {
        throw error
      }
    }

    await sleep(pollIntervalMs)
  }

  return false
}

export async function checkContainerRunning(containerName: string): Promise<boolean> {
  try {
    const result = await run('docker', [
      'inspect',
      '--format',
      '{{if .State.Running}}true{{else}}false{{end}}',
      containerName,
    ])
    return result.stdout.trim() === 'true'
  } catch (error) {
    if (error instanceof ShellError) {
      return false
    }

    throw error
  }
}
