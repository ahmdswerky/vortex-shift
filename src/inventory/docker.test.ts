import { beforeEach, describe, expect, it, vi } from 'vitest'
import { discoverComposeProjects } from './docker.js'
import { run, ShellError } from '../utils/shell.js'
import { fileExists } from '../utils/fs.js'
import { readFile } from 'node:fs/promises'

vi.mock('../utils/shell.js', () => ({
  run: vi.fn(),
  ShellError: class ShellError extends Error {},
}))

vi.mock('../utils/fs.js', () => ({
  fileExists: vi.fn(),
}))

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
}))

describe('inventory/docker', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('discoverComposeProjects parses compose files and DB hints', async () => {
    vi.mocked(fileExists).mockResolvedValue(true)
    vi.mocked(run)
      .mockResolvedValueOnce({
        stdout: '/opt/app/docker-compose.yml\n',
        stderr: '',
        exitCode: 0,
      })
      .mockResolvedValueOnce({
        stdout: 'web\ndb\n',
        stderr: '',
        exitCode: 0,
      })
      .mockResolvedValueOnce({
        stdout: 'services:\n  db:\n    image: postgres:16\n',
        stderr: '',
        exitCode: 0,
      })
    vi.mocked(readFile).mockResolvedValue('name: sample-stack\nservices:\n  web:\n    image: nginx:alpine')

    const projects = await discoverComposeProjects(['/opt'])

    expect(projects).toHaveLength(1)
    expect(projects[0]?.name).toBe('sample-stack')
    expect(projects[0]?.services).toEqual(['web', 'db'])
    expect(projects[0]?.hasDatabase).toBe(true)
  })

  it('find command includes excluded system paths', async () => {
    vi.mocked(fileExists).mockResolvedValue(true)
    vi.mocked(run).mockResolvedValue({
      stdout: '',
      stderr: '',
      exitCode: 0,
    })

    await discoverComposeProjects(['/srv'])

    const findCall = vi.mocked(run).mock.calls.find(([cmd]) => cmd === 'find')
    expect(findCall).toBeTruthy()
    const args = findCall?.[1] ?? []
    expect(args).toContain('/proc/*')
    expect(args).toContain('/sys/*')
    expect(args).toContain('/dev/*')
  })

  it('identifies DB services from known image names in fallback config text', async () => {
    vi.mocked(fileExists).mockResolvedValue(true)
    vi.mocked(run)
      .mockResolvedValueOnce({
        stdout: '/home/site/compose.yml\n',
        stderr: '',
        exitCode: 0,
      })
      .mockResolvedValueOnce({
        stdout: '',
        stderr: '',
        exitCode: 0,
      })
      .mockRejectedValueOnce(new ShellError('compose render failed'))
    vi.mocked(readFile).mockResolvedValue(`
services:
  redis:
    image: redis:7
  app:
    image: node:20
`)

    const projects = await discoverComposeProjects(['/home'])

    expect(projects).toHaveLength(1)
    expect(projects[0]?.hasDatabase).toBe(true)
    expect(projects[0]?.services).toContain('redis')
  })
})
