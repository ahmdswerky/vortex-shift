import { format } from 'date-fns'

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B'
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / 1024 ** exponent
  const fixed = value >= 100 ? 0 : value >= 10 ? 1 : 2

  return `${value.toFixed(fixed)} ${units[exponent]}`
}

export function formatDuration(ms: number): string {
  if (ms <= 0) {
    return '0s'
  }

  const totalSeconds = Math.floor(ms / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`
  }

  if (minutes > 0) {
    return `${minutes}m ${seconds}s`
  }

  return `${seconds}s`
}

export function formatDate(iso: string): string {
  return format(new Date(iso), 'yyyy-MM-dd HH:mm:ss')
}

export interface TableColumn<T extends Record<string, unknown>> {
  key: keyof T
  header: string
}

export function formatTable<T extends Record<string, unknown>>(
  rows: T[],
  columns: TableColumn<T>[]
): string {
  if (columns.length === 0) {
    return ''
  }

  const widths = columns.map((column) => {
    const values = rows.map((row) => String(row[column.key] ?? ''))
    return Math.max(column.header.length, ...values.map((value) => value.length))
  })

  const header = columns
    .map((column, index) => column.header.padEnd(widths[index] ?? column.header.length))
    .join('  ')

  const separator = widths.map((width) => '-'.repeat(width)).join('  ')

  const body = rows.map((row) =>
    columns
      .map((column, index) => String(row[column.key] ?? '').padEnd(widths[index] ?? 0))
      .join('  ')
  )

  return [header, separator, ...body].join('\n')
}

export function formatList(items: string[]): string {
  if (items.length === 0) {
    return ''
  }

  return items.map((item) => `- ${item}`).join('\n')
}
