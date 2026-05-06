import path from 'node:path'
import type { MigrationConfig } from '../types/config.js'
import type { DockerVolume } from '../types/manifest.js'
import type { TransferResult } from '../types/report.js'
import type { SSHClient } from '../core/ssh.js'
import { RsyncTransfer, type RsyncProgress } from '../core/rsync.js'

function toTransferResult(resource: string, bytesTransferred: number, duration: number): TransferResult {
  return {
    resource,
    bytesTransferred,
    duration,
    checksumVerified: false,
  }
}

export async function transferVolume(
  volume: DockerVolume,
  ssh: SSHClient,
  config: MigrationConfig,
  onProgress?: (progress: RsyncProgress) => void
): Promise<TransferResult> {
  const remotePath = volume.mountpoint
  const remoteParent = path.dirname(remotePath)
  const mkdirResult = await ssh.exec(`mkdir -p ${JSON.stringify(remoteParent)} ${JSON.stringify(remotePath)}`)
  if (mkdirResult.code !== 0) {
    throw new Error(`Failed to create destination directory for volume ${volume.name}: ${mkdirResult.stderr}`)
  }

  const transfer = new RsyncTransfer({
    sourcePath: `${volume.mountpoint}/`,
    destinationHost: config.destination.host,
    destinationUser: config.destination.user,
    destinationPort: config.destination.port,
    destinationPath: `${remotePath}/`,
    sshKeyPath: config.destination.sshKeyPath,
    rsyncExtraArgs: config.transfer.rsyncExtraArgs,
  })

  const result = await transfer.run(onProgress)
  return toTransferResult(`volume:${volume.name}`, result.bytesTransferred, result.duration)
}

export async function transferAllVolumes(
  volumes: DockerVolume[],
  ssh: SSHClient,
  config: MigrationConfig,
  onProgress?: (volumeName: string, progress: RsyncProgress) => void
): Promise<TransferResult[]> {
  const results: TransferResult[] = []

  for (const volume of volumes) {
    const result = await transferVolume(volume, ssh, config, (progress) => {
      onProgress?.(volume.name, progress)
    })
    results.push(result)
  }

  return results
}
