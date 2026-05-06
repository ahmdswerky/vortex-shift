import path from 'node:path'
import chalk from 'chalk'
import ora, { type Ora } from 'ora'
import { createLogger, format, transports } from 'winston'
import type { Logger as WinstonLogger } from 'winston'
import { ensureDir } from '../utils/fs.js'

type LogLevel = 'debug' | 'info' | 'success' | 'warn' | 'error'

export interface LoggerOptions {
  verbose: boolean
  logFile: string
}

export class Logger {
  private readonly verbose: boolean
  private readonly fileLogger: WinstonLogger
  private spinner: Ora | null = null

  public constructor(options: LoggerOptions, fileLogger: WinstonLogger) {
    this.verbose = options.verbose
    this.fileLogger = fileLogger
  }

  public info(message: string, data?: unknown): void {
    this.emit('info', message, data)
  }

  public success(message: string, data?: unknown): void {
    this.emit('success', message, data)
  }

  public warn(message: string, data?: unknown): void {
    this.emit('warn', message, data)
  }

  public error(message: string, data?: unknown): void {
    this.emit('error', message, data)
  }

  public debug(message: string, data?: unknown): void {
    if (!this.verbose) {
      this.fileLogger.debug(message, data === undefined ? undefined : { data })
      return
    }

    this.emit('debug', message, data)
  }

  public startSpinner(label: string): void {
    this.stopSpinner()
    this.spinner = ora(label).start()
  }

  public stopSpinner(success = true): void {
    if (!this.spinner) {
      return
    }

    if (success) {
      this.spinner.succeed()
    } else {
      this.spinner.fail()
    }

    this.spinner = null
  }

  private emit(level: LogLevel, message: string, data?: unknown): void {
    const line = this.formatTerminal(level, message)
    if (this.spinner?.isSpinning) {
      this.spinner.stop()
      process.stdout.write(`${line}\n`)
      this.spinner.start()
    } else {
      process.stdout.write(`${line}\n`)
    }

    const winstonLevel = level === 'success' ? 'info' : level
    this.fileLogger.log(winstonLevel, message, data === undefined ? undefined : { data })
  }

  private formatTerminal(level: LogLevel, message: string): string {
    if (level === 'info') {
      return `${chalk.blue('ℹ')} ${message}`
    }

    if (level === 'success') {
      return `${chalk.green('✔')} ${message}`
    }

    if (level === 'warn') {
      return `${chalk.yellow('⚠')} ${message}`
    }

    if (level === 'error') {
      return `${chalk.red('✖')} ${message}`
    }

    return `${chalk.gray('·')} ${chalk.gray(message)}`
  }
}

export let log: Logger

export async function createLog(options: LoggerOptions): Promise<Logger> {
  await ensureDir(path.dirname(options.logFile))

  const fileLogger = createLogger({
    level: 'debug',
    format: format.combine(format.timestamp(), format.errors({ stack: true }), format.json()),
    transports: [new transports.File({ filename: options.logFile })],
  })

  log = new Logger(options, fileLogger)
  return log
}
