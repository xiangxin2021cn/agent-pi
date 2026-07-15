export type BusinessModuleId = 'tender' | 'delivery' | 'investment'

export interface BusinessProjectRecord {
  schemaVersion: 1
  projectId: string
  module: BusinessModuleId
  name: string
  rootPath: string
  workflowId: string
  inputPaths: string[]
  createdAt: string
  updatedAt: string
}

export interface CreateBusinessProjectInput {
  workspaceRootPath: string
  projectId: string
  module: BusinessModuleId
  name: string
  rootPath: string
  workflowId: string
  createDirectory: boolean
  inputPaths?: string[]
}

export interface SessionBusinessContext {
  module: BusinessModuleId
  projectId: string
  workflowId: string
  stageId: string
}
