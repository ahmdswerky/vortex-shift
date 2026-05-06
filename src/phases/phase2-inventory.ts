import path from 'node:path'
import { COMPOSE_SEARCH_PATHS, DEFAULT_NPM_DATA_PATH } from '../config/defaults.js'
import { StepRunner, type Step } from '../core/executor.js'
import { identifyDatabaseContainers } from '../inventory/databases.js'
import { discoverComposeProjects, getRunningContainers } from '../inventory/docker.js'
import { snapshotNginxProxyManager } from '../inventory/nginx.js'
import { discoverPM2Apps } from '../inventory/pm2.js'
import { discoverExternalVolumes } from '../inventory/volumes.js'
import type { MigrationContext } from '../types/context.js'
import type { Manifest } from '../types/manifest.js'
import { formatBytes, formatList, formatTable } from '../utils/format.js'
import { getSize, writeJson } from '../utils/fs.js'
import { confirm } from '../utils/prompt.js'
import { run } from '../utils/shell.js'

interface Phase2State {
  manifest: Manifest | null
  warnings: string[]
  totalEstimatedBytes: number
}

async function getSourceHost(): Promise<string> {
  try {
    const fqdn = await run('hostname', ['-f'])
    const value = fqdn.stdout.trim()
    if (value.length > 0) {
      return value
    }
  } catch {
    // fallback below
  }

  const host = await run('hostname', [])
  return host.stdout.trim()
}

async function estimateProjectSizes(projectDirs: string[]): Promise<number> {
  let total = 0
  for (const dir of projectDirs) {
    try {
      total += await getSize(dir)
    } catch {
      continue
    }
  }
  return total
}

export async function runPhase2(ctx: MigrationContext): Promise<void> {
  const state: Phase2State = {
    manifest: null,
    warnings: [],
    totalEstimatedBytes: 0,
  }

  const steps: Step[] = [
    {
      id: 'inventory.docker-projects',
      name: 'Inventory Docker Compose projects',
      run: async () => {
        const projects = await discoverComposeProjects(COMPOSE_SEARCH_PATHS)

        const host = await getSourceHost()
        state.manifest = {
          createdAt: new Date().toISOString(),
          sourceHost: host,
          dockerProjects: projects,
          externalVolumes: [],
          pm2Apps: [],
          databases: [],
          nginxProxyManager: {
            dataPath: ctx.config.paths.nginxProxyManagerDataPath || DEFAULT_NPM_DATA_PATH,
            version: 'unknown',
            proxyHostCount: 0,
          },
        }
      },
    },
    {
      id: 'inventory.docker-volumes',
      name: 'Inventory external Docker volumes',
      run: async () => {
        if (!state.manifest) {
          throw new Error('Manifest not initialized before volume inventory')
        }

        state.manifest.externalVolumes = await discoverExternalVolumes()
      },
    },
    {
      id: 'inventory.pm2-apps',
      name: 'Inventory PM2 apps',
      run: async () => {
        if (!state.manifest) {
          throw new Error('Manifest not initialized before PM2 inventory')
        }

        state.manifest.pm2Apps = await discoverPM2Apps((message) => {
          state.warnings.push(message)
          ctx.log.warn(message)
        })
      },
    },
    {
      id: 'inventory.db-containers',
      name: 'Inventory database containers',
      run: async () => {
        if (!state.manifest) {
          throw new Error('Manifest not initialized before database inventory')
        }

        const running = await getRunningContainers()
        state.manifest.databases = await identifyDatabaseContainers(running)
      },
    },
    {
      id: 'inventory.nginx',
      name: 'Inventory NGINX Proxy Manager',
      run: async () => {
        if (!state.manifest) {
          throw new Error('Manifest not initialized before NGINX inventory')
        }

        state.manifest.nginxProxyManager = await snapshotNginxProxyManager(
          ctx.config.paths.nginxProxyManagerDataPath
        )
      },
    },
    {
      id: 'inventory.save-manifest',
      name: 'Save inventory manifest',
      run: async () => {
        if (!state.manifest) {
          throw new Error('Manifest not available for save')
        }

        const manifestPath = path.join(ctx.config.paths.checkpointDir, 'manifest.json')
        await writeJson(manifestPath, state.manifest)
        ctx.manifest = state.manifest
        ctx.log.info(`Manifest saved to ${manifestPath}`)
      },
    },
    {
      id: 'inventory.display-summary',
      name: 'Display inventory summary',
      run: async () => {
        if (!state.manifest) {
          throw new Error('Manifest not available for summary')
        }

        const volumeBytes = state.manifest.externalVolumes.reduce((sum, volume) => sum + volume.size, 0)
        const projectBytes = await estimateProjectSizes(
          state.manifest.dockerProjects.map((project) => project.dir)
        )
        state.totalEstimatedBytes = volumeBytes + projectBytes

        const unlinkedVolumes = state.manifest.externalVolumes.filter((volume) => !volume.linkedProject)
        if (unlinkedVolumes.length > 0) {
          state.warnings.push(
            `${unlinkedVolumes.length} external volume(s) are not linked to a compose project`
          )
        }

        const rows = [
          { resource: 'Docker projects', count: state.manifest.dockerProjects.length },
          { resource: 'External volumes', count: state.manifest.externalVolumes.length },
          { resource: 'PM2 apps', count: state.manifest.pm2Apps.length },
          { resource: 'DB containers', count: state.manifest.databases.length },
          {
            resource: 'NGINX Proxy Manager',
            count: state.manifest.nginxProxyManager.version === 'not-running' ? 0 : 1,
          },
        ]

        ctx.log.info(
          `\n${formatTable(rows, [
            { key: 'resource', header: 'Resource' },
            { key: 'count', header: 'Count' },
          ])}`
        )
        ctx.log.info(`Estimated transfer size: ${formatBytes(state.totalEstimatedBytes)}`)
        ctx.log.info(`NPM proxy hosts: ${state.manifest.nginxProxyManager.proxyHostCount}`)

        if (state.warnings.length > 0) {
          ctx.log.warn(`Inventory warnings:\n${formatList(state.warnings)}`)
        }
      },
    },
    {
      id: 'inventory.confirm',
      name: 'Confirm inventory before transfer',
      run: async () => {
        const proceed = await confirm('Inventory complete. Proceed to transfer phase?', true)
        if (!proceed) {
          throw new Error('Migration stopped by user after inventory review.')
        }
      },
    },
  ]

  ctx.checkpoint.phase = 2
  const runner = new StepRunner(ctx)
  await runner.run(steps)
}
