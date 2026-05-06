declare module 'fs-extra' {
  interface WriteJsonOptions {
    spaces?: number
  }

  interface FSExtra {
    readJson(path: string): Promise<unknown>
    writeJson(path: string, data: unknown, options?: WriteJsonOptions): Promise<void>
    ensureDir(path: string): Promise<void>
    pathExists(path: string): Promise<boolean>
  }

  const fse: FSExtra
  export default fse
}

declare module 'cli-progress' {
  export interface SingleBarOptions {
    format?: string
    hideCursor?: boolean
  }

  export class SingleBar {
    constructor(options?: SingleBarOptions, preset?: unknown)
    start(total: number, startValue: number): void
    setTotal(total: number): void
    update(value: number): void
    stop(): void
  }

  export const Presets: {
    shades_classic: unknown
  }
}
