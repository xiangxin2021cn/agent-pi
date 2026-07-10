import type { SessionToolContext } from '../context.ts';
import type { ToolResult } from '../types.ts';
import { successResponse, errorResponse } from '../response.ts';

export interface GetSpawnStatusArgs {
  sessionId?: string;
}

export async function handleGetSpawnStatus(
  ctx: SessionToolContext,
  args: GetSpawnStatusArgs
): Promise<ToolResult> {
  if (!ctx.getSpawnStatus) {
    return errorResponse('get_spawn_status is not available in this context.');
  }

  try {
    const status = ctx.getSpawnStatus(args.sessionId);
    if (!status) {
      return errorResponse(`Spawn status not found: ${args.sessionId ?? ctx.sessionId}`);
    }
    return successResponse(JSON.stringify(status, null, 2));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return errorResponse(`Failed to get spawn status: ${message}`);
  }
}
