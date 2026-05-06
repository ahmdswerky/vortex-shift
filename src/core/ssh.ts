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

  public async connect(config: SSHConfig): Promise<void> {
    try {
      await this.client.connect({
        host: config.host,
        username: config.user,
        port: config.port,
        privateKeyPath: config.sshKeyPath,
      })
      this.connected = true
    } catch (error) {
      throw new SSHError(`Failed to connect to ${config.user}@${config.host}:${config.port}`, error)
    }
  }

  public async exec(command: string): Promise<{ stdout: string; stderr: string; code: number }> {
    this.assertConnected()

    try {
      const result = await this.client.execCommand(command)
      return {
        stdout: result.stdout,
        stderr: result.stderr,
        code: typeof result.code === 'number' ? result.code : 1,
      }
    } catch (error) {
      throw new SSHError(`Remote command failed: ${command}`, error)
    }
  }

  public async execStream(
    command: string,
    onData: (chunk: { stream: 'stdout' | 'stderr'; data: string }) => void
  ): Promise<{ stdout: string; stderr: string; code: number }> {
    this.assertConnected()

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

      return {
        stdout,
        stderr,
        code: typeof result.code === 'number' ? result.code : 1,
      }
    } catch (error) {
      throw new SSHError(`Remote streamed command failed: ${command}`, error)
    }
  }

  public async putFile(localPath: string, remotePath: string): Promise<void> {
    this.assertConnected()

    try {
      await this.client.putFile(localPath, remotePath)
    } catch (error) {
      throw new SSHError(`Failed uploading ${localPath} to ${remotePath}`, error)
    }
  }

  public async getFile(remotePath: string, localPath: string): Promise<void> {
    this.assertConnected()

    try {
      await this.client.getFile(localPath, remotePath)
    } catch (error) {
      throw new SSHError(`Failed downloading ${remotePath} to ${localPath}`, error)
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
