import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RsyncTransfer } from './rsync.js'
import { runStream } from '../utils/shell.js'

vi.mock('../utils/shell.js', () => ({
  runStream: vi.fn(),
}))

describe('core/rsync', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('parses progress output into callback and result fields', async () => {
    vi.mocked(runStream).mockImplementation(async (_cmd, _args, onData) => {
      onData({ stream: 'stdout', data: 'example-file.txt\n' })
      onData({
        stream: 'stdout',
        data: '1,024  10%   1.00MB/s    0:01 (xfr#1, to-check=9/10)\n',
      })
      onData({
        stream: 'stdout',
        data: 'Total transferred file size: 2,048 bytes\n',
      })
      return { stdout: '', stderr: '', exitCode: 0 }
    })

    const transfer = new RsyncTransfer({
      sourcePath: '/src/',
      destinationHost: 'host',
      destinationUser: 'root',
      destinationPort: 22,
      destinationPath: '/dst/',
      sshKeyPath: '/tmp/key',
    })

    const progressSpy = vi.fn()
    const result = await transfer.run(progressSpy)

    expect(progressSpy).toHaveBeenCalled()
    const progress = progressSpy.mock.calls.at(-1)?.[0]
    expect(progress?.file).toBe('example-file.txt')
    expect(progress?.bytesDone).toBe(1024)
    expect(progress?.speedMBps).toBeCloseTo(1)
    expect(progress?.etaSeconds).toBe(1)

    expect(result.bytesTransferred).toBe(2048)
    expect(result.filesTransferred).toBe(2)
  })

  it('builds rsync command with expected base structure', async () => {
    vi.mocked(runStream).mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 })

    const transfer = new RsyncTransfer({
      sourcePath: '/src/',
      destinationHost: 'dest-host',
      destinationUser: 'deploy',
      destinationPort: 2222,
      destinationPath: '/dst/',
      sshKeyPath: '/keys/id_ed25519',
      rsyncExtraArgs: ['--exclude=.git'],
    })

    await transfer.run()

    expect(runStream).toHaveBeenCalledTimes(1)
    const [cmd, args] = vi.mocked(runStream).mock.calls[0] ?? []
    expect(cmd).toBe('rsync')
    expect(args).toContain('--stats')
    expect(args).toContain('--exclude=.git')
    expect(args).toContain('/src/')
    expect(args).toContain('deploy@dest-host:/dst/')
  })

  it('throws with resume hint on non-zero rsync exit', async () => {
    vi.mocked(runStream).mockRejectedValue(new Error('rsync failed'))

    const transfer = new RsyncTransfer({
      sourcePath: '/src/',
      destinationHost: 'host',
      destinationUser: 'root',
      destinationPort: 22,
      destinationPath: '/dst/',
      sshKeyPath: '/tmp/key',
    })

    await expect(transfer.run()).rejects.toThrow(/resume/i)
  })
})
