import { describe, expect, it } from 'vitest'
import { migrationConfigSchema } from './config.js'

describe('types/config schema', () => {
  it('accepts a valid config', () => {
    const input = {
      destination: {
        host: 'dest.example.com',
        user: 'root',
        port: 22,
        sshKeyPath: '/root/.ssh/id_ed25519',
      },
      transfer: {
        retries: 3,
        concurrency: 2,
        rsyncExtraArgs: [],
        excludePaths: [],
      },
      healthChecks: [],
      paths: {
        dumpDir: '/tmp/vortex-dumps',
        checkpointDir: '/tmp/vortex-checkpoint',
        logFile: './vortex.log',
        nginxProxyManagerDataPath: '/opt/nginx-proxy-manager',
        pm2DumpPath: '/root/.pm2/dump.pm2',
      },
      verbose: false,
    }

    expect(() => migrationConfigSchema.parse(input)).not.toThrow()
  })

  it('fails when a required field is missing', () => {
    const input = {
      destination: {
        host: 'dest.example.com',
        user: 'root',
        port: 22,
      },
      transfer: {
        retries: 3,
        concurrency: 2,
        rsyncExtraArgs: [],
        excludePaths: [],
      },
      healthChecks: [],
      paths: {
        dumpDir: '/tmp/vortex-dumps',
        checkpointDir: '/tmp/vortex-checkpoint',
        logFile: './vortex.log',
        nginxProxyManagerDataPath: '/opt/nginx-proxy-manager',
        pm2DumpPath: '/root/.pm2/dump.pm2',
      },
      verbose: false,
    }

    expect(() => migrationConfigSchema.parse(input)).toThrow()
  })

  it('fails when SSH port is not a number', () => {
    const input = {
      destination: {
        host: 'dest.example.com',
        user: 'root',
        port: '22',
        sshKeyPath: '/root/.ssh/id_ed25519',
      },
      transfer: {
        retries: 3,
        concurrency: 2,
        rsyncExtraArgs: [],
        excludePaths: [],
      },
      healthChecks: [],
      paths: {
        dumpDir: '/tmp/vortex-dumps',
        checkpointDir: '/tmp/vortex-checkpoint',
        logFile: './vortex.log',
        nginxProxyManagerDataPath: '/opt/nginx-proxy-manager',
        pm2DumpPath: '/root/.pm2/dump.pm2',
      },
      verbose: false,
    }

    expect(() => migrationConfigSchema.parse(input)).toThrow()
  })
})
