import { describe, expect, it } from 'vitest'
import { formatBytes, formatDate, formatDuration } from './format.js'

describe('utils/format', () => {
  it('formatBytes handles zero and byte ranges', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1024)).toContain('KB')
    expect(formatBytes(1024 * 1024)).toContain('MB')
    expect(formatBytes(1024 * 1024 * 1024)).toContain('GB')
  })

  it('formatDuration handles seconds, minutes, and hours', () => {
    expect(formatDuration(45_000)).toBe('45s')
    expect(formatDuration(201_000)).toBe('3m 21s')
    expect(formatDuration(3_661_000)).toBe('1h 1m 1s')
  })

  it('formatDate formats ISO input into readable timestamp', () => {
    const formatted = formatDate('2025-05-06T14:32:01.000Z')
    expect(formatted).toMatch(/2025-05-06/)
    expect(formatted).toMatch(/\d{2}:\d{2}:\d{2}/)
  })
})
