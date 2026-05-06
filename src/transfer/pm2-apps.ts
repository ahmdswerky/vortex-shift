import path from 'node:path'
import { stat } from 'node:fs/promises'
import type { MigrationConfig } from '../types/config.js'
import type { PM2App } from '../types/manifest.js'
import type { TransferResult } from '../types/report.js'
import type { SSHClient } from '../core/ssh.js'
import { RsyncTransfer, type RsyncProgress } from '../core/rsync.js'
import { fileExists } from '../utils/fs.js'

function toTransferResult(resource: string, bytesTransferred: number, duration: number): TransferResult {
  return {
    resource,
    bytesTransferred,
    duration,
    checksumVerified: false,
  }
}

export async function transferPM2Apps(
  apps: PM2App[],
  ssh: SSHClient,
  config: MigrationConfig,
  onProgress?: (appName: string, progress: RsyncProgress) => void
): Promise<TransferResult[]> {
  const results: TransferResult[] = []

  for (const app of apps) {
    if (!(await fileExists(app.cwd))) {
      continue
    }

    const remoteDir = app.cwd
    const remoteParent = path.dirname(remoteDir)
    const mkdirResult = await ssh.exec(`mkdir -p ${JSON.stringify(remoteParent)} ${JSON.stringify(remoteDir)}`)
    if (mkdirResult.code !== 0) {
      throw new Error(`Failed to create destination PM2 directory for ${app.name}: ${mkdirResult.stderr}`)
    }

    const transfer = new RsyncTransfer({
      sourcePath: `${app.cwd}/`,
      destinationHost: config.destination.host,
      destinationUser: config.destination.user,
      destinationPort: config.destination.port,
      destinationPath: `${remoteDir}/`,
      sshKeyPath: config.destination.sshKeyPath,
      rsyncExtraArgs: config.transfer.rsyncExtraArgs,
    })

    const rsyncResult = await transfer.run((progress) => {
      onProgress?.(app.name, progress)
    })

    results.push(toTransferResult(`pm2-app:${app.name}`, rsyncResult.bytesTransferred, rsyncResult.duration))
  }

  return results
}

export async function transferPM2Ecosystem(
  dumpPath: string,
  ssh: SSHClient,
  _config: MigrationConfig
): Promise<TransferResult | null> {
  if (!(await fileExists(dumpPath))) {
    return null
  }

  const start = Date.now()
  const remoteParent = path.dirname(dumpPath)
  const mkdirResult = await ssh.exec(`mkdir -p ${JSON.stringify(remoteParent)}`)
  if (mkdirResult.code !== 0) {
    throw new Error(`Failed to create destination PM2 dump directory: ${mkdirResult.stderr}`)
  }

  await ssh.putFile(dumpPath, dumpPath)
  const bytesTransferred = (await stat(dumpPath)).size

  return toTransferResult('pm2-ecosystem', bytesTransferred, Date.now() - start)
}
