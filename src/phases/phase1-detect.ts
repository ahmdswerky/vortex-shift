import path from 'node:path'
import { readFile } from 'node:fs/promises'
import { COMPOSE_SEARCH_PATHS, DEFAULT_DUMP_DIR } from '../config/defaults.js'
import { StepRunner, type Step } from '../core/executor.js'
import { detectSSHKey, displayPublicKey, generateSSHKey } from '../core/ssh.js'
import type { MigrationContext } from '../types/context.js'
import { fileExists, getSize } from '../utils/fs.js'
import { pause } from '../utils/prompt.js'
import { run, ShellError } from '../utils/shell.js'
import { formatBytes } from '../utils/format.js'

interface Phase1State {
  requiresSSHSetup: boolean
  sshKeyPath: string | null
}

function parseOsRelease(contents: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const line of contents.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) {
      continue
    }

    const index = trimmed.indexOf('=')
    if (index === -1) {
      continue
    }

    const key = trimmed.slice(0, index).trim()
    const rawValue = trimmed.slice(index + 1).trim()
    const value = rawValue.replace(/^"/, '').replace(/"$/, '')
    result[key] = value
  }
  return result
}

function parseNodeMajor(version: string): number | null {
  const match = version.trim().match(/^v(\d+)\./)
  if (!match?.[1]) {
    return null
  }

  return Number.parseInt(match[1], 10)
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

async function safeFindComposeFiles(basePath: string): Promise<string[]> {
  try {
    const result = await run(
      'find',
      [
        basePath,
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
      ],
      { reject: true }
    )

    return result.stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
  } catch (error) {
    if (error instanceof ShellError) {
      return error.stdout
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
    }

    return []
  }
}

async function estimateTransferSizeBytes(ctx: MigrationContext): Promise<number> {
  let total = 0
  const countedPaths = new Set<string>()

  try {
    const volumes = await run('docker', ['volume', 'ls', '--format', '{{.Name}}'])
    const volumeNames = volumes.stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)

    for (const volumeName of volumeNames) {
      try {
        const inspect = await run('docker', ['volume', 'inspect', volumeName, '--format', '{{.Mountpoint}}'])
        const mountpoint = inspect.stdout.trim()
        if (!mountpoint || countedPaths.has(mountpoint)) {
          continue
        }
        if (!(await fileExists(mountpoint))) {
          continue
        }
        total += await getSize(mountpoint)
        countedPaths.add(mountpoint)
      } catch {
        continue
      }
    }
  } catch {
    ctx.log.warn('Could not estimate Docker volume sizes; continuing with partial estimate')
  }

  const projectDirs = new Set<string>()
  for (const searchPath of COMPOSE_SEARCH_PATHS) {
    if (!(await fileExists(searchPath))) {
      continue
    }
    const composeFiles = await safeFindComposeFiles(searchPath)
    for (const composeFile of composeFiles) {
      projectDirs.add(path.dirname(composeFile))
    }
  }

  for (const projectDir of projectDirs) {
    if (countedPaths.has(projectDir)) {
      continue
    }

    try {
      if (await fileExists(projectDir)) {
        total += await getSize(projectDir)
        countedPaths.add(projectDir)
      }
    } catch {
      continue
    }
  }

  const dumpDir = ctx.config.paths.dumpDir || DEFAULT_DUMP_DIR
  if (!countedPaths.has(dumpDir) && (await fileExists(dumpDir))) {
    try {
      total += await getSize(dumpDir)
    } catch {
      // ignore
    }
  }

  return total
}

function parseAvailableBytesFromDf(output: string): number | null {
  const lines = output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
  if (lines.length === 0) {
    return null
  }

  const last = lines[lines.length - 1] ?? ''
  const numeric = last.replace(/[^\d]/g, '')
  if (!numeric) {
    return null
  }

  return Number.parseInt(numeric, 10)
}

export async function runPhase1(ctx: MigrationContext): Promise<void> {
  const phaseState: Phase1State = {
    requiresSSHSetup: false,
    sshKeyPath: null,
  }

  const steps: Step[] = [
    {
      id: 'detect.os',
      name: 'Verify Rocky Linux environment',
      run: async () => {
        const osReleaseContent = await readFile('/etc/os-release', 'utf8')
        const osRelease = parseOsRelease(osReleaseContent)
        const id = (osRelease.ID ?? '').toLowerCase()
        const idLike = (osRelease.ID_LIKE ?? '').toLowerCase()
        const prettyName = osRelease.PRETTY_NAME ?? osRelease.NAME ?? 'Unknown Linux'

        if (id !== 'rocky' && !idLike.includes('rhel')) {
          throw new Error(
            `Unsupported operating system: ${prettyName}. Vortex Shift requires Rocky Linux (or RHEL-compatible distro).`
          )
        }

        ctx.log.info(`OS detected: ${prettyName}`)
      },
    },
    {
      id: 'detect.docker',
      name: 'Detect Docker and Docker Compose',
      run: async () => {
        const dockerVersion = await run('docker', ['--version'])
        const composeVersion = await run('docker', ['compose', 'version'])
        await run('docker', ['info'])

        ctx.log.info(`Docker: ${dockerVersion.stdout.trim()}`)
        ctx.log.info(`Docker Compose: ${composeVersion.stdout.trim()}`)
      },
    },
    {
      id: 'detect.pm2',
      name: 'Detect PM2',
      run: async () => {
        try {
          const pm2Version = await run('pm2', ['--version'])
          ctx.log.info(`PM2: ${pm2Version.stdout.trim()}`)
        } catch (error) {
          if (error instanceof ShellError) {
            ctx.log.warn('PM2 not found. Continuing without PM2 app migration support.')
            return
          }

          throw error
        }
      },
    },
    {
      id: 'detect.node',
      name: 'Detect Node.js',
      run: async () => {
        const nodeVersion = await run('node', ['--version'])
        const version = nodeVersion.stdout.trim()
        const major = parseNodeMajor(version)
        ctx.log.info(`Node.js: ${version}`)

        if (major !== null && major < 18) {
          ctx.log.warn(`Node.js ${version} detected. Node 18+ is recommended.`)
        }
      },
    },
    {
      id: 'detect.rsync',
      name: 'Detect rsync',
      run: async () => {
        if (ctx.mode !== 'source') {
          ctx.log.info('Skipping strict rsync requirement on destination mode')
          return
        }

        try {
          const rsyncVersion = await run('rsync', ['--version'])
          const firstLine = rsyncVersion.stdout.split('\n')[0]?.trim() ?? 'rsync detected'
          ctx.log.info(firstLine)
        } catch (error) {
          if (error instanceof ShellError) {
            throw new Error(
              'rsync is required on source server. Install it with: dnf install rsync'
            )
          }
          throw error
        }
      },
    },
    {
      id: 'detect.ssh-keys',
      name: 'Detect existing SSH keys',
      run: async () => {
        if (ctx.mode !== 'source') {
          ctx.log.info('Skipping SSH key detection in destination mode')
          return
        }

        const keyPath = await detectSSHKey()
        phaseState.sshKeyPath = keyPath
        if (keyPath) {
          ctx.config.destination.sshKeyPath = keyPath
          phaseState.requiresSSHSetup = false
          ctx.log.info(`Using SSH key: ${keyPath}`)
        } else {
          phaseState.requiresSSHSetup = true
          ctx.log.warn('No SSH key found in ~/.ssh. SSH setup required.')
        }
      },
    },
    {
      id: 'detect.ssh-setup',
      name: 'Setup SSH key if missing',
      run: async () => {
        if (ctx.mode !== 'source') {
          ctx.log.info('Skipping SSH key setup in destination mode')
          return
        }

        if (!phaseState.requiresSSHSetup) {
          ctx.log.info('SSH key exists; skipping key generation step')
          return
        }

        const generated = await generateSSHKey()
        phaseState.sshKeyPath = generated.privateKeyPath
        ctx.config.destination.sshKeyPath = generated.privateKeyPath
        displayPublicKey(generated.publicKey)
        await pause('Add this key to destination ~/.ssh/authorized_keys, then press Enter')
        ctx.log.info(`Generated SSH key: ${generated.privateKeyPath}`)
      },
    },
    {
      id: 'detect.ssh-test',
      name: 'Test SSH connectivity to destination',
      run: async () => {
        if (ctx.mode !== 'source') {
          ctx.log.info('Skipping SSH connectivity test in destination mode')
          return
        }

        const keyPath = phaseState.sshKeyPath ?? ctx.config.destination.sshKeyPath
        if (!keyPath) {
          throw new Error('No SSH key path available for SSH connectivity test.')
        }

        const sshConfig = {
          ...ctx.config.destination,
          sshKeyPath: keyPath,
        }

        let lastError: unknown
        const maxAttempts = 3

        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
          try {
            await ctx.ssh.connect(sshConfig)
            const result = await ctx.ssh.exec('echo "vortex-ok"')
            if (result.code !== 0 || result.stdout.trim() !== 'vortex-ok') {
              throw new Error(
                `SSH command check failed (code=${result.code}, stdout="${result.stdout.trim()}", stderr="${result.stderr.trim()}")`
              )
            }
            ctx.log.success('SSH connectivity verified')
            ctx.ssh.disconnect()
            return
          } catch (error) {
            lastError = error
            ctx.ssh.disconnect()
            if (attempt < maxAttempts) {
              ctx.log.warn(`SSH test failed (attempt ${attempt}/${maxAttempts}). Retrying in 10s...`)
              await sleep(10_000)
            }
          }
        }

        const manualCommand =
          `ssh -i ${keyPath} -p ${ctx.config.destination.port} ` +
          `${ctx.config.destination.user}@${ctx.config.destination.host} 'echo "vortex-ok"'`

        ctx.log.error(`Manual SSH test command: ${manualCommand}`)
        ctx.log.error('If this fails, verify destination firewall, sshd service, and authorized_keys.')

        throw new Error(
          `SSH connectivity test failed after ${maxAttempts} attempts: ${
            lastError instanceof Error ? lastError.message : String(lastError)
          }`
        )
      },
      retries: 0,
    },
    {
      id: 'detect.disk-space',
      name: 'Check destination disk headroom',
      run: async () => {
        if (ctx.mode !== 'source') {
          ctx.log.info('Skipping destination disk headroom check in destination mode')
          return
        }

        const keyPath = phaseState.sshKeyPath ?? ctx.config.destination.sshKeyPath
        if (!keyPath) {
          throw new Error('No SSH key path available for disk space check.')
        }

        await ctx.ssh.connect({
          ...ctx.config.destination,
          sshKeyPath: keyPath,
        })

        const estimatedBytes = await estimateTransferSizeBytes(ctx)
        const dfTargetPath = ctx.config.paths.dumpDir || '/tmp'
        try {
          const dfResult = await ctx.ssh.exec(`df -B1 --output=avail ${dfTargetPath} | tail -n 1`)
          if (dfResult.code !== 0) {
            throw new Error(`Failed to read destination free space: ${dfResult.stderr}`)
          }

          const availableBytes = parseAvailableBytesFromDf(dfResult.stdout)
          if (availableBytes === null) {
            throw new Error(`Could not parse destination free space from: ${dfResult.stdout}`)
          }

          ctx.log.info(`Estimated transfer size: ${formatBytes(estimatedBytes)}`)
          ctx.log.info(`Destination free space: ${formatBytes(availableBytes)}`)

          const remainingBytes = availableBytes - estimatedBytes
          const headroomRatio = availableBytes > 0 ? remainingBytes / availableBytes : 0

          if (headroomRatio < 0.05) {
            throw new Error(
              `Destination headroom would be below 5% after transfer (estimated). Free up disk before continuing.`
            )
          }

          if (headroomRatio < 0.2) {
            ctx.log.warn(
              `Destination headroom below 20% after transfer estimate. Migration may run out of space.`
            )
          }
        } finally {
          ctx.ssh.disconnect()
        }
      },
    },
  ]

  ctx.checkpoint.phase = 1
  const runner = new StepRunner(ctx)
  await runner.run(steps)
}
