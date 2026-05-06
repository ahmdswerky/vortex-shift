import os from 'node:os'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import { NodeSSH } from 'node-ssh'
import type { SSHConfig } from '../types/config.js'
import { run } from '../utils/shell.js'

const SSH_KEY_CANDIDATES = ['id_ed25519', 'id_rsa', 'id_ecdsa']

export class SSHError extends Error {
  public override readonly cause: unknown

  public constructor(message: string, cause?: unknown) {
    super(message)
    this.name = 'SSHError'
    this.cause = cause
  }
}

export async function detectSSHKey(): Promise<string | null> {
  const sshDir = path.join(os.homedir(), '.ssh')

  for (const candidate of SSH_KEY_CANDIDATES) {
    const candidatePath = path.join(sshDir, candidate)
    try {
      const stat = await fs.stat(candidatePath)
      if (stat.isFile()) {
        return candidatePath
      }
    } catch {
      continue
    }
  }

  return null
}

export async function generateSSHKey(): Promise<{ privateKeyPath: string; publicKey: string }> {
  const sshDir = path.join(os.homedir(), '.ssh')
  const privateKeyPath = path.join(sshDir, 'id_ed25519')
  const publicKeyPath = `${privateKeyPath}.pub`

  await fs.mkdir(sshDir, { recursive: true })

  await run('ssh-keygen', ['-t', 'ed25519', '-f', privateKeyPath, '-N', ''])
  const publicKey = (await fs.readFile(publicKeyPath, 'utf8')).trim()

  return { privateKeyPath, publicKey }
}

export function displayPublicKey(pubKey: string): void {
  const lines = [
    '',
    '================== SSH Public Key ==================',
    pubKey,
    '====================================================',
    'Add this key to destination ~/.ssh/authorized_keys',
    '',
  ]

  process.stdout.write(`${lines.join('\n')}\n`)
}

export class SSHClient {
  private readonly client = new NodeSSH()
  private connected = false
  private dryRun = false
  private lastConfig: SSHConfig | null = null

  public setDryRun(dryRun: boolean): void {
    this.dryRun = dryRun
  }

  private manualSshHint(command = 'echo "vortex-ok"'): string {
    if (!this.lastConfig) {
      return 'Manual SSH test: ssh -i ~/.ssh/id_ed25519 -p 22 user@host \'echo "vortex-ok"\''
    }

    return (
      `Manual SSH test: ssh -i ${this.lastConfig.sshKeyPath} -p ${this.lastConfig.port} ` +
      `${this.lastConfig.user}@${this.lastConfig.host} '${command}'`
    )
  }

  public async connect(config: SSHConfig): Promise<void> {
    this.lastConfig = config

    if (this.dryRun) {
      process.stdout.write(
        `[dry-run][ssh] connect ${config.user}@${config.host}:${config.port} key=${config.sshKeyPath}\n`
      )
      this.connected = true
      return
    }

    try {
      await this.client.connect({
        host: config.host,
        username: config.user,
        port: config.port,
        privateKeyPath: config.sshKeyPath,
      })
      this.connected = true
    } catch (error) {
      throw new SSHError(
        `Failed to connect to ${config.user}@${config.host}:${config.port}. ${this.manualSshHint()}`,
        error
      )
    }
  }

  public async exec(command: string): Promise<{ stdout: string; stderr: string; code: number }> {
    this.assertConnected()

    if (this.dryRun) {
      process.stdout.write(`[dry-run][ssh] exec ${command}\n`)
      return { stdout: '', stderr: '', code: 0 }
    }

    try {
      const result = await this.client.execCommand(command)
      const code = typeof result.code === 'number' ? result.code : 1
      if (code !== 0) {
        throw new SSHError(
          `Remote command exited with code ${code}: ${command}. ${this.manualSshHint(command)}`
        )
      }
      return {
        stdout: result.stdout,
        stderr: result.stderr,
        code,
      }
    } catch (error) {
      if (error instanceof SSHError) {
        throw error
      }
      throw new SSHError(
        `Remote command failed: ${command}. ${this.manualSshHint(command)}`,
        error
      )
    }
  }

  public async execStream(
    command: string,
    onData: (chunk: { stream: 'stdout' | 'stderr'; data: string }) => void
  ): Promise<{ stdout: string; stderr: string; code: number }> {
    this.assertConnected()

    if (this.dryRun) {
      process.stdout.write(`[dry-run][ssh] execStream ${command}\n`)
      return { stdout: '', stderr: '', code: 0 }
    }

    try {
      let stdout = ''
      let stderr = ''
      const result = await this.client.execCommand(command, {
        onStdout(chunk) {
          const data = chunk.toString('utf8')
          stdout += data
          onData({ stream: 'stdout', data })
        },
        onStderr(chunk) {
          const data = chunk.toString('utf8')
          stderr += data
          onData({ stream: 'stderr', data })
        },
      })
      const code = typeof result.code === 'number' ? result.code : 1
      if (code !== 0) {
        throw new SSHError(
          `Remote streamed command exited with code ${code}: ${command}. ${this.manualSshHint(command)}`
        )
      }

      return {
        stdout,
        stderr,
        code,
      }
    } catch (error) {
      if (error instanceof SSHError) {
        throw error
      }
      throw new SSHError(
        `Remote streamed command failed: ${command}. ${this.manualSshHint(command)}`,
        error
      )
    }
  }

  public async putFile(localPath: string, remotePath: string): Promise<void> {
    this.assertConnected()

    if (this.dryRun) {
      process.stdout.write(`[dry-run][ssh] putFile ${localPath} -> ${remotePath}\n`)
      return
    }

    try {
      await this.client.putFile(localPath, remotePath)
    } catch (error) {
      throw new SSHError(
        `Failed uploading ${localPath} to ${remotePath}. ${this.manualSshHint()}`,
        error
      )
    }
  }

  public async getFile(remotePath: string, localPath: string): Promise<void> {
    this.assertConnected()

    if (this.dryRun) {
      process.stdout.write(`[dry-run][ssh] getFile ${remotePath} -> ${localPath}\n`)
      return
    }

    try {
      await this.client.getFile(localPath, remotePath)
    } catch (error) {
      throw new SSHError(
        `Failed downloading ${remotePath} to ${localPath}. ${this.manualSshHint()}`,
        error
      )
    }
  }

  public disconnect(): void {
    this.client.dispose()
    this.connected = false
  }

  private assertConnected(): void {
    if (!this.connected) {
      throw new SSHError('SSH client is not connected')
    }
  }
}
