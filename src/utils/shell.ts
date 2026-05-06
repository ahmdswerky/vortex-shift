import { execa, type Options as ExecaOptions } from 'execa'

const ANSI_REGEX =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: needed for ANSI stripping
  // eslint-disable-next-line no-control-regex
  /\u001B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g

export interface RunOptions extends ExecaOptions {
  timeoutMs?: number
}

export interface RunResult {
  stdout: string
  stderr: string
  exitCode: number
}

export class ShellError extends Error {
  public readonly command: string
  public readonly args: string[]
  public readonly stdout: string
  public readonly stderr: string
  public readonly exitCode: number

  public constructor(
    command: string,
    args: string[],
    message: string,
    stdout: string,
    stderr: string,
    exitCode: number
  ) {
    super(message)
    this.name = 'ShellError'
    this.command = command
    this.args = args
    this.stdout = stdout
    this.stderr = stderr
    this.exitCode = exitCode
  }
}

function stripAnsi(input: string): string {
  return input.replace(ANSI_REGEX, '')
}

function toText(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }

  if (value instanceof Uint8Array) {
    return Buffer.from(value).toString('utf8')
  }

  if (Array.isArray(value)) {
    return value.map((item) => String(item)).join('\n')
  }

  if (value === undefined || value === null) {
    return ''
  }

  return String(value)
}

function toShellError(
  error: unknown,
  command: string,
  args: string[],
  fallbackMessage: string
): ShellError {
  const err = error as {
    message?: string
    stdout?: string
    stderr?: string
    exitCode?: number
  }

  const stdout = stripAnsi(err.stdout ?? '')
  const stderr = stripAnsi(err.stderr ?? '')
  const exitCode = typeof err.exitCode === 'number' ? err.exitCode : 1

  return new ShellError(command, args, err.message ?? fallbackMessage, stdout, stderr, exitCode)
}

export async function run(command: string, args: string[] = [], opts: RunOptions = {}): Promise<RunResult> {
  const { timeoutMs, ...execaOpts } = opts

  try {
    const options: ExecaOptions =
      timeoutMs === undefined
        ? {
            ...execaOpts,
            reject: true,
            encoding: 'utf8',
          }
        : {
            ...execaOpts,
            reject: true,
            encoding: 'utf8',
            timeout: timeoutMs,
          }

    const result = await execa(command, args, {
      ...options,
    })

    return {
      stdout: stripAnsi(toText(result.stdout)),
      stderr: stripAnsi(toText(result.stderr)),
      exitCode: result.exitCode ?? 0,
    }
  } catch (error) {
    throw toShellError(error, command, args, `Command failed: ${command}`)
  }
}

export async function runStream(
  command: string,
  args: string[] = [],
  onData: (chunk: { stream: 'stdout' | 'stderr'; data: string }) => void,
  opts: RunOptions = {}
): Promise<RunResult> {
  const { timeoutMs, ...execaOpts } = opts

  try {
    const options: ExecaOptions =
      timeoutMs === undefined
        ? {
            ...execaOpts,
            all: false,
            reject: false,
            encoding: 'utf8',
          }
        : {
            ...execaOpts,
            all: false,
            reject: false,
            encoding: 'utf8',
            timeout: timeoutMs,
          }

    const subprocess = execa(command, args, {
      ...options,
    })

    if (subprocess.stdout) {
      subprocess.stdout.setEncoding('utf8')
      subprocess.stdout.on('data', (data: string) => {
        onData({
          stream: 'stdout',
          data: stripAnsi(data),
        })
      })
    }

    if (subprocess.stderr) {
      subprocess.stderr.setEncoding('utf8')
      subprocess.stderr.on('data', (data: string) => {
        onData({
          stream: 'stderr',
          data: stripAnsi(data),
        })
      })
    }

    const result = await subprocess
    const stdout = stripAnsi(toText(result.stdout))
    const stderr = stripAnsi(toText(result.stderr))
    const exitCode = result.exitCode ?? 1

    if (exitCode !== 0) {
      throw new ShellError(command, args, `Command failed: ${command}`, stdout, stderr, exitCode)
    }

    return {
      stdout,
      stderr,
      exitCode,
    }
  } catch (error) {
    if (error instanceof ShellError) {
      throw error
    }

    throw toShellError(error, command, args, `Command failed: ${command}`)
  }
}
