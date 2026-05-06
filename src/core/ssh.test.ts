import os from 'node:os'
import path from 'node:path'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { detectSSHKey, SSHClient, SSHError } from './ssh.js'

describe('core/ssh', () => {
  let tmpHome: string

  beforeEach(async () => {
    tmpHome = await mkdtemp(path.join(os.tmpdir(), 'vortex-ssh-home-'))
    vi.spyOn(os, 'homedir').mockReturnValue(tmpHome)
  })

  it('detectSSHKey returns first found key by priority', async () => {
    const sshDir = path.join(tmpHome, '.ssh')
    await mkdir(sshDir, { recursive: true })
    await writeFile(path.join(sshDir, 'id_rsa'), 'rsa-key')
    await writeFile(path.join(sshDir, 'id_ed25519'), 'ed25519-key')

    const found = await detectSSHKey()
    expect(found).toBe(path.join(sshDir, 'id_ed25519'))
  })

  it('detectSSHKey returns null when no key exists', async () => {
    const found = await detectSSHKey()
    expect(found).toBeNull()
  })

  it('SSHClient.exec throws SSHError on non-zero exit', async () => {
    const client = new SSHClient() as unknown as {
      connected: boolean
      client: { execCommand: (command: string) => Promise<{ stdout: string; stderr: string; code: number }> }
      lastConfig: { host: string; user: string; port: number; sshKeyPath: string }
      exec: (command: string) => Promise<{ stdout: string; stderr: string; code: number }>
    }

    client.connected = true
    client.lastConfig = {
      host: 'dest',
      user: 'root',
      port: 22,
      sshKeyPath: '~/.ssh/id_ed25519',
    }
    client.client.execCommand = vi.fn(async () => ({
      stdout: '',
      stderr: 'failed',
      code: 1,
    }))

    await expect(client.exec('false')).rejects.toBeInstanceOf(SSHError)
  })
})
