/**
 * Resolve the session working directory for business / session tools.
 *
 * Preference order:
 * 1. ctx.workingDirectory (may be a live lazy getter from session bindings)
 * 2. Live session metadata via getSessionInfo (restore / spawn safe)
 * 3. Persisted session.jsonl header (works before callbacks are wired)
 */

import type { SessionToolContext } from './context.ts';
import { errorResponse } from './response.ts';
import type { ToolResult } from './types.ts';
import { resolveSessionWorkingDirectory } from './source-helpers.ts';

export function resolveContextWorkingDirectory(ctx: SessionToolContext): string | undefined {
  if (ctx.workingDirectory) return ctx.workingDirectory;
  const fromInfo = ctx.getSessionInfo?.(ctx.sessionId)?.workingDirectory;
  if (fromInfo) return fromInfo;
  return resolveSessionWorkingDirectory(ctx.workspacePath, ctx.sessionId);
}

export function requireContextWorkingDirectory(
  ctx: SessionToolContext,
  toolName: string,
): string | ToolResult {
  const workingDirectory = resolveContextWorkingDirectory(ctx);
  if (!workingDirectory) {
    return errorResponse(
      `${toolName} requires an explicit session working directory. `
      + 'Set or re-select the session working directory, then retry.',
    );
  }
  return workingDirectory;
}
