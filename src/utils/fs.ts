import os from 'node:os'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import fse from 'fs-extra'
import { type ZodSchema } from 'zod'

export async function readJson<T>(filePath: string, schema?: ZodSchema<T>): Promise<T> {
  const value = (await fse.readJson(filePath)) as unknown

  if (!schema) {
    return value as T
  }

  return schema.parse(value)
}

export async function writeJson(filePath: string, data: unknown): Promise<void> {
  const tmpPath = `${filePath}.tmp`
  await fse.ensureDir(path.dirname(filePath))
  await fse.writeJson(tmpPath, data, { spaces: 2 })
  await fs.rename(tmpPath, filePath)
}

export async function ensureDir(dirPath: string): Promise<void> {
  await fse.ensureDir(dirPath)
}

export async function fileExists(filePath: string): Promise<boolean> {
  return fse.pathExists(filePath)
}

export function expandHome(inputPath: string): string {
  if (inputPath === '~') {
    return os.homedir()
  }

  if (inputPath.startsWith('~/')) {
    return path.join(os.homedir(), inputPath.slice(2))
  }

  return inputPath
}

export async function getSize(targetPath: string): Promise<number> {
  const stats = await fs.lstat(targetPath)

  if (!stats.isDirectory()) {
    return stats.size
  }

  const entries = await fs.readdir(targetPath, { withFileTypes: true })

  let total = 0
  for (const entry of entries) {
    const entryPath = path.join(targetPath, entry.name)
    if (entry.isDirectory()) {
      total += await getSize(entryPath)
      continue
    }

    const entryStats = await fs.lstat(entryPath)
    total += entryStats.size
  }

  return total
}
