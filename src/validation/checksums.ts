import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import { fileExists, writeJson, readJson } from '../utils/fs.js'

export interface ChecksumManifest {
  createdAt: string
  entries: Record<string, string>
}

export interface ChecksumMismatch {
  path: string
  expected: string
  actual: string
}

export interface ChecksumVerifyResult {
  ok: boolean
  checked: number
  mismatches: ChecksumMismatch[]
}

async function getFileChecksum(filePath: string): Promise<string> {
  const hash = createHash('sha256')

  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath)
    stream.on('data', (chunk: Buffer) => {
      hash.update(chunk)
    })
    stream.on('error', reject)
    stream.on('end', resolve)
  })

  return hash.digest('hex')
}

async function collectFilesRecursively(dirPath: string): Promise<string[]> {
  const entries = await fs.readdir(dirPath, { withFileTypes: true })
  const files: string[] = []

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await collectFilesRecursively(fullPath)))
      continue
    }

    if (entry.isFile()) {
      files.push(fullPath)
    }
  }

  return files
}

export async function checksumFile(filePath: string): Promise<string> {
  return getFileChecksum(filePath)
}

export async function checksumDir(dirPath: string): Promise<string> {
  const files = (await collectFilesRecursively(dirPath)).sort((a, b) => a.localeCompare(b))
  const treeHash = createHash('sha256')

  for (const filePath of files) {
    const relativePath = path.relative(dirPath, filePath)
    const fileHash = await getFileChecksum(filePath)
    treeHash.update(`${relativePath}:${fileHash}\n`)
  }

  return treeHash.digest('hex')
}

export async function buildChecksumManifest(paths: string[]): Promise<ChecksumManifest> {
  const entries: Record<string, string> = {}

  for (const targetPath of paths) {
    if (!(await fileExists(targetPath))) {
      continue
    }

    const stats = await fs.lstat(targetPath)
    if (stats.isDirectory()) {
      entries[targetPath] = await checksumDir(targetPath)
      continue
    }

    if (stats.isFile()) {
      entries[targetPath] = await checksumFile(targetPath)
    }
  }

  return {
    createdAt: new Date().toISOString(),
    entries,
  }
}

export async function verifyChecksums(
  manifest: ChecksumManifest,
  paths?: string[]
): Promise<ChecksumVerifyResult> {
  const mismatches: ChecksumMismatch[] = []
  const targetPaths = paths ?? Object.keys(manifest.entries)

  for (const targetPath of targetPaths) {
    const expected = manifest.entries[targetPath]
    if (!expected) {
      continue
    }

    if (!(await fileExists(targetPath))) {
      mismatches.push({
        path: targetPath,
        expected,
        actual: 'MISSING',
      })
      continue
    }

    const stats = await fs.lstat(targetPath)
    const actual = stats.isDirectory()
      ? await checksumDir(targetPath)
      : stats.isFile()
        ? await checksumFile(targetPath)
        : 'UNSUPPORTED'

    if (actual !== expected) {
      mismatches.push({
        path: targetPath,
        expected,
        actual,
      })
    }
  }

  return {
    ok: mismatches.length === 0,
    checked: targetPaths.length,
    mismatches,
  }
}

export async function saveChecksumManifest(filePath: string, manifest: ChecksumManifest): Promise<void> {
  await writeJson(filePath, manifest)
}

export async function loadChecksumManifest(filePath: string): Promise<ChecksumManifest> {
  return readJson<ChecksumManifest>(filePath)
}
