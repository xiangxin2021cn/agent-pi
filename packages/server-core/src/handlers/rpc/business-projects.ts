import {
  createBusinessProject,
  listBusinessProjects,
  registerBusinessProjectInputs,
  unregisterBusinessProject,
} from '@craft-agent/shared/business-projects'
import {
  RPC_CHANNELS,
  type CreateBusinessProjectInput,
  type ListBusinessProjectsRequest,
  type UnregisterBusinessProjectRequest,
  type UpdateBusinessProjectInputsRequest,
} from '@craft-agent/shared/protocol'
import type { RpcServer } from '../../transport/types.ts'

export function registerBusinessProjectHandlers(server: RpcServer): void {
  server.handle(RPC_CHANNELS.businessProjects.LIST, async (_ctx, request: ListBusinessProjectsRequest) => {
    return listBusinessProjects(request.workspaceRootPath, request.module)
  })
  server.handle(RPC_CHANNELS.businessProjects.CREATE, async (_ctx, request: CreateBusinessProjectInput) => {
    return createBusinessProject(request)
  })
  server.handle(RPC_CHANNELS.businessProjects.UPDATE_INPUTS, async (_ctx, request: UpdateBusinessProjectInputsRequest) => {
    return registerBusinessProjectInputs(request.workspaceRootPath, request.module, request.projectId, request.inputPaths)
  })
  server.handle(RPC_CHANNELS.businessProjects.UNREGISTER, async (_ctx, request: UnregisterBusinessProjectRequest) => {
    unregisterBusinessProject(request.workspaceRootPath, request.module, request.projectId)
    return { success: true }
  })
}
