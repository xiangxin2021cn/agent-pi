import {
  createBusinessProject,
  listBusinessProjects,
  registerBusinessProjectInputs,
  unregisterBusinessProject,
} from '@craft-agent/shared/business-projects/storage'
import {
  RPC_CHANNELS,
  type CreateBusinessProjectInput,
  type ListBusinessProjectsRequest,
  type UnregisterBusinessProjectRequest,
  type UpdateBusinessProjectInputsRequest,
} from '@craft-agent/shared/protocol'
import type { RpcServer } from '../../transport/types.ts'
import { runTenderStage } from '../../tender-stage-run.ts'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.businessProjects.LIST,
  RPC_CHANNELS.businessProjects.CREATE,
  RPC_CHANNELS.businessProjects.UPDATE_INPUTS,
  RPC_CHANNELS.businessProjects.UNREGISTER,
] as const

export function registerBusinessProjectHandlers(server: RpcServer): void {
  server.handle(RPC_CHANNELS.businessProjects.LIST, async (_ctx, request: ListBusinessProjectsRequest) => {
    return listBusinessProjects(request.workspaceRootPath, request.module)
  })
  server.handle(RPC_CHANNELS.businessProjects.CREATE, async (_ctx, request: CreateBusinessProjectInput) => {
    const project = createBusinessProject(request)
    if (project.module === 'tender') {
      await runTenderStage({
        action: 'preflight',
        workspaceRootPath: request.workspaceRootPath,
        projectId: project.projectId,
        stageId: 'project-setup',
      })
    }
    return project
  })
  server.handle(RPC_CHANNELS.businessProjects.UPDATE_INPUTS, async (_ctx, request: UpdateBusinessProjectInputsRequest) => {
    const project = registerBusinessProjectInputs(request.workspaceRootPath, request.module, request.projectId, request.inputPaths)
    if (project.module === 'tender') {
      await runTenderStage({
        action: 'preflight',
        workspaceRootPath: request.workspaceRootPath,
        projectId: project.projectId,
        stageId: 'project-setup',
      })
    }
    return project
  })
  server.handle(RPC_CHANNELS.businessProjects.UNREGISTER, async (_ctx, request: UnregisterBusinessProjectRequest) => {
    unregisterBusinessProject(request.workspaceRootPath, request.module, request.projectId)
    return { success: true }
  })
}
