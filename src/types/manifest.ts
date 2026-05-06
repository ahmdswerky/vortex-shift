export interface DockerProject {
  name: string
  dir: string
  composeFile: string
  services: string[]
  hasDatabase: boolean
}

export interface DockerVolume {
  name: string
  driver: string
  mountpoint: string
  size: number
  linkedProject?: string
}

export interface PM2App {
  name: string
  script: string
  cwd: string
  pm2Id: number
  status: string
  ecosystemEntry: string
}

export type DatabaseEngine =
  | 'postgres'
  | 'mysql'
  | 'mariadb'
  | 'redis'
  | 'mongo'
  | 'mongodb'
  | 'elasticsearch'
  | 'other'

export interface DatabaseContainer {
  containerName: string
  engine: DatabaseEngine
  image: string
  volumes: string[]
  credentials?: Record<string, string>
  dumpFile?: string
}

export interface NginxSnapshot {
  dataPath: string
  version: string
  proxyHostCount: number
}

export interface Manifest {
  createdAt: string
  sourceHost: string
  dockerProjects: DockerProject[]
  externalVolumes: DockerVolume[]
  pm2Apps: PM2App[]
  databases: DatabaseContainer[]
  nginxProxyManager: NginxSnapshot
}
