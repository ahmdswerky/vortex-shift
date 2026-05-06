import path from 'node:path'
import type { MigrationConfig } from '../types/config.js'
import type { NginxSnapshot } from '../types/manifest.js'
import type { TransferResult } from '../types/report.js'
import type { SSHClient } from '../core/ssh.js'
import { RsyncTransfer, type RsyncProgress } from '../core/rsync.js'
import { fileExists } from '../utils/fs.js'

export async function transferNginxData(
  snapshot: NginxSnapshot,
  ssh: SSHClient,
  config: MigrationConfig,
  onProgress?: (progress: RsyncProgress) => void
): Promise<TransferResult | null> {
  if (!(await fileExists(snapshot.dataPath))) {
    return null
  }

  const remoteDir = snapshot.dataPath
  const remoteParent = path.dirname(remoteDir)
  const mkdirResult = await ssh.exec(`mkdir -p ${JSON.stringify(remoteParent)} ${JSON.stringify(remoteDir)}`)
  if (mkdirResult.code !== 0) {
    throw new Error(`Failed to create destination NPM directory: ${mkdirResult.stderr}`)
  }

  const transfer = new RsyncTransfer({
    sourcePath: `${snapshot.dataPath}/`,
    destinationHost: config.destination.host,
    destinationUser: config.destination.user,
    destinationPort: config.destination.port,
    destinationPath: `${remoteDir}/`,
    sshKeyPath: config.destination.sshKeyPath,
    rsyncExtraArgs: config.transfer.rsyncExtraArgs,
  })

  const rsyncResult = await transfer.run(onProgress)
  return {
    resource: 'nginx-data',
    bytesTransferred: rsyncResult.bytesTransferred,
    duration: rsyncResult.duration,
    checksumVerified: false,
  }
}
