import path from 'node:path'
import * as cliProgress from 'cli-progress'
import { DEFAULT_DUMP_DIR } from '../config/defaults.js'
import { StepRunner, type Step } from '../core/executor.js'
import { RsyncTransfer, type RsyncProgress } from '../core/rsync.js'
import { dumpAll } from '../transfer/db-dumps.js'
import { transferNginxData } from '../transfer/nginx-data.js'
import { transferPM2Apps, transferPM2Ecosystem } from '../transfer/pm2-apps.js'
import { transferAllVolumes } from '../transfer/volumes.js'
import type { MigrationContext } from '../types/context.js'
import type { Manifest } from '../types/manifest.js'
import type { TransferResult } from '../types/report.js'
import { fileExists, getSize, readJson, writeJson } from '../utils/fs.js'
import { formatBytes, formatDuration } from '../utils/format.js'

class AggregateTransferProgress {
  private total = 1
  private completed = 0
  private readonly active = new Map<string, number>()
  private readonly bar: cliProgress.SingleBar

  public constructor() {
    this.bar = new cliProgress.SingleBar(
      {
        format: 'Transfer [{bar}] {percentage}% | {value}/{total} bytes',
        hideCursor: true,
      },
      cliProgress.Presets.shades_classic
    )
    this.bar.start(this.total, 0)
  }

  public setTotal(total: number): void {
    this.total = Math.max(1, total)
    this.bar.setTotal(this.total)
    this.refresh()
  }

  public begin(resource: string): void {
    if (!this.active.has(resource)) {
      this.active.set(resource, 0)
      this.refresh()
    }
  }

  public update(resource: string, bytesDone: number): void {
    this.active.set(resource, Math.max(0, bytesDone))
    this.refresh()
  }

  public finish(resource: string, bytesTransferred: number): void {
    this.completed += Math.max(0, bytesTransferred)
    this.active.delete(resource)
    this.refresh()
  }

  public addCompleted(bytes: number): void {
    this.completed += Math.max(0, bytes)
    this.refresh()
  }

  public stop(): void {
    this.bar.stop()
  }

  private refresh(): void {
    const activeBytes = [...this.active.values()].reduce((sum, value) => sum + value, 0)
    const value = Math.min(this.total, this.completed + activeBytes)
    this.bar.update(value)
  }
}

interface Phase3State {
  manifest: Manifest
  transferResults: TransferResult[]
  progress: AggregateTransferProgress
}

async function safeGetSize(targetPath: string): Promise<number> {
  try {
    if (!(await fileExists(targetPath))) {
      return 0
    }
    return await getSize(targetPath)
  } catch {
    return 0
  }
}

async function estimateTotalTransferBytes(manifest: Manifest, dumpDir: string, pm2DumpPath: string): Promise<number> {
  let total = manifest.externalVolumes.reduce((sum, volume) => sum + volume.size, 0)

  for (const project of manifest.dockerProjects) {
    total += await safeGetSize(project.dir)
  }

  for (const app of manifest.pm2Apps) {
    total += await safeGetSize(app.cwd)
  }

  total += await safeGetSize(manifest.nginxProxyManager.dataPath)
  total += await safeGetSize(dumpDir)
  total += await safeGetSize(pm2DumpPath)

  return total
}

function logTransfer(logger: MigrationContext['log'], result: TransferResult): void {
  logger.info(
    `[${result.resource}] transferred ${formatBytes(result.bytesTransferred)} in ${formatDuration(result.duration)}`
  )
}

async function withSSH<T>(ctx: MigrationContext, task: () => Promise<T>): Promise<T> {
  await ctx.ssh.connect(ctx.config.destination)
  try {
    return await task()
  } finally {
    ctx.ssh.disconnect()
  }
}

async function transferDirectory(
  resourceName: string,
  sourceDir: string,
  destinationDir: string,
  ctx: MigrationContext,
  state: Phase3State
): Promise<TransferResult> {
  await withSSH(ctx, async () => {
    const mkdirResult = await ctx.ssh.exec(
      `mkdir -p ${JSON.stringify(path.dirname(destinationDir))} ${JSON.stringify(destinationDir)}`
    )
    if (mkdirResult.code !== 0) {
      throw new Error(`Failed to create destination path ${destinationDir}: ${mkdirResult.stderr}`)
    }
  })

  const transfer = new RsyncTransfer({
    sourcePath: `${sourceDir}/`,
    destinationHost: ctx.config.destination.host,
    destinationUser: ctx.config.destination.user,
    destinationPort: ctx.config.destination.port,
    destinationPath: `${destinationDir}/`,
    sshKeyPath: ctx.config.destination.sshKeyPath,
    rsyncExtraArgs: ctx.config.transfer.rsyncExtraArgs,
  })

  state.progress.begin(resourceName)
  const rsyncResult = await transfer.run((progress: RsyncProgress) => {
    state.progress.update(resourceName, progress.bytesDone)
  })
  state.progress.finish(resourceName, rsyncResult.bytesTransferred)

  return {
    resource: resourceName,
    bytesTransferred: rsyncResult.bytesTransferred,
    duration: rsyncResult.duration,
    checksumVerified: false,
  }
}

async function loadManifest(ctx: MigrationContext): Promise<Manifest> {
  if (ctx.manifest) {
    return ctx.manifest
  }

  const manifestPath = path.join(ctx.config.paths.checkpointDir, 'manifest.json')
  return readJson<Manifest>(manifestPath)
}

export async function runPhase3(ctx: MigrationContext): Promise<void> {
  const manifest = await loadManifest(ctx)
  const state: Phase3State = {
    manifest,
    transferResults: [],
    progress: new AggregateTransferProgress(),
  }

  const dumpDir = ctx.config.paths.dumpDir || DEFAULT_DUMP_DIR
  const pm2DumpPath = ctx.config.paths.pm2DumpPath

  const initialTotalBytes = await estimateTotalTransferBytes(state.manifest, dumpDir, pm2DumpPath)
  state.progress.setTotal(initialTotalBytes)

  const steps: Step[] = [
    {
      id: 'transfer.db-dumps',
      name: 'Dump databases on source',
      run: async () => {
        state.manifest.databases = await dumpAll(state.manifest.databases, dumpDir)
        ctx.manifest = state.manifest
        await writeJson(path.join(ctx.config.paths.checkpointDir, 'manifest.json'), state.manifest)

        const refreshedTotal = await estimateTotalTransferBytes(state.manifest, dumpDir, pm2DumpPath)
        state.progress.setTotal(refreshedTotal)
      },
    },
    {
      id: 'transfer.docker-volumes',
      name: 'Transfer Docker volumes',
      run: async () => {
        const results = await withSSH(ctx, async () =>
          transferAllVolumes(state.manifest.externalVolumes, ctx.ssh, ctx.config, (name, progress) => {
            const resource = `volume:${name}`
            state.progress.begin(resource)
            state.progress.update(resource, progress.bytesDone)
          })
        )

        for (const result of results) {
          state.progress.finish(result.resource, result.bytesTransferred)
          state.transferResults.push(result)
          logTransfer(ctx.log, result)
        }
      },
    },
    {
      id: 'transfer.docker-projects',
      name: 'Transfer Docker project directories',
      run: async () => {
        for (const project of state.manifest.dockerProjects) {
          const result = await transferDirectory(
            `compose-project:${project.name}`,
            project.dir,
            project.dir,
            ctx,
            state
          )
          state.transferResults.push(result)
          logTransfer(ctx.log, result)
        }
      },
    },
    {
      id: 'transfer.db-dump-files',
      name: 'Transfer DB dump files',
      run: async () => {
        if (!(await fileExists(dumpDir))) {
          return
        }

        const result = await transferDirectory('db-dumps', dumpDir, dumpDir, ctx, state)
        state.transferResults.push(result)
        logTransfer(ctx.log, result)
      },
    },
    {
      id: 'transfer.pm2-apps',
      name: 'Transfer PM2 app directories',
      run: async () => {
        const results = await withSSH(ctx, async () =>
          transferPM2Apps(state.manifest.pm2Apps, ctx.ssh, ctx.config, (appName, progress) => {
            const resource = `pm2-app:${appName}`
            state.progress.begin(resource)
            state.progress.update(resource, progress.bytesDone)
          })
        )

        for (const result of results) {
          state.progress.finish(result.resource, result.bytesTransferred)
          state.transferResults.push(result)
          logTransfer(ctx.log, result)
        }
      },
    },
    {
      id: 'transfer.pm2-ecosystem',
      name: 'Transfer PM2 ecosystem dump',
      run: async () => {
        const result = await withSSH(ctx, async () =>
          transferPM2Ecosystem(pm2DumpPath, ctx.ssh, ctx.config)
        )
        if (!result) {
          return
        }

        state.progress.addCompleted(result.bytesTransferred)
        state.transferResults.push(result)
        logTransfer(ctx.log, result)
      },
    },
    {
      id: 'transfer.nginx-data',
      name: 'Transfer NGINX Proxy Manager data',
      run: async () => {
        const result = await withSSH(ctx, async () =>
          transferNginxData(state.manifest.nginxProxyManager, ctx.ssh, ctx.config, (progress) => {
            const resource = 'nginx-data'
            state.progress.begin(resource)
            state.progress.update(resource, progress.bytesDone)
          })
        )
        if (!result) {
          return
        }

        state.progress.finish(result.resource, result.bytesTransferred)
        state.transferResults.push(result)
        logTransfer(ctx.log, result)
      },
    },
    {
      id: 'transfer.manifest',
      name: 'Transfer manifest to destination checkpoint dir',
      run: async () => {
        const localManifestPath = path.join(ctx.config.paths.checkpointDir, 'manifest.json')
        await writeJson(localManifestPath, state.manifest)

        await withSSH(ctx, async () => {
          const remoteManifestPath = path.join(ctx.config.paths.checkpointDir, 'manifest.json')
          const mkdirResult = await ctx.ssh.exec(
            `mkdir -p ${JSON.stringify(path.dirname(remoteManifestPath))}`
          )
          if (mkdirResult.code !== 0) {
            throw new Error(`Failed creating destination checkpoint directory: ${mkdirResult.stderr}`)
          }

          await ctx.ssh.putFile(localManifestPath, remoteManifestPath)
        })

        const bytesTransferred = await safeGetSize(localManifestPath)
        state.progress.addCompleted(bytesTransferred)
        const manifestTransferResult: TransferResult = {
          resource: 'manifest',
          bytesTransferred,
          duration: 0,
          checksumVerified: false,
        }
        state.transferResults.push(manifestTransferResult)
        logTransfer(ctx.log, manifestTransferResult)
      },
    },
  ]

  ctx.checkpoint.phase = 3
  const runner = new StepRunner(ctx)

  try {
    await runner.run(steps)
  } finally {
    state.progress.stop()
  }
}
