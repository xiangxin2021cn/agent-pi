/**
 * Base Event Adapter
 *
 * Abstract base class for provider-specific event adapters. Provides shared
 * state management (Maps, lifecycle) used by ClaudeEventAdapter and
 * PiEventAdapter.
 *
 * Subclasses implement provider-specific event dispatch (adapt*() methods)
 * while inheriting:
 * - Block reason tracking (for permission-declined tool results)
 * - Read command classification (bash commands → Read tool display)
 * - Command output accumulation (streaming deltas → final tool result)
 * - Tool start/result construction helpers
 * - Turn lifecycle (reset on new turn)
 */

import type { AgentEvent } from '@craft-agent/core/types';
import { parseReadCommand, type ReadCommandInfo } from './read-patterns.ts';
import { createLogger } from '../../utils/debug.ts';
/** MCP server name used by the pool server */
const POOL_SERVER_MCP_NAME = 'sources';

/**
 * Soft cap for streamed tool output kept in memory.
 * Unbounded `current + delta` hits V8 `RangeError: Invalid string length` on large
 * PDF/OCR/Excel tool streams and storms the main process (see stability.log).
 */
export const MAX_COMMAND_OUTPUT_CHARS = 4 * 1024 * 1024; // 4 MiB of UTF-16 code units

const COMMAND_OUTPUT_TRUNCATION_MARKER =
  '\n\n[truncated: tool output exceeded in-memory cap; further deltas discarded]\n';

export { type ReadCommandInfo } from './read-patterns.ts';

type Logger = ReturnType<typeof createLogger>;

export abstract class BaseEventAdapter {
  protected log: Logger;
  protected turnIndex: number = 0;
  protected currentTurnId: string | null = null;

  /** Session directory for toolMetadataStore lookups (concurrent-session safe) */
  protected sessionDir: string | undefined;

  // Shared state maps used by subclass event adapters
  protected commandOutput: Map<string, string> = new Map();
  /** Tool call ids whose output was truncated — further deltas are ignored. */
  protected truncatedCommandOutputIds: Set<string> = new Set();
  protected readCommands: Map<string, ReadCommandInfo> = new Map();
  protected blockReasons: Map<string, string> = new Map();

  constructor(logScope: string) {
    this.log = createLogger(logScope);
  }

  /**
   * Set the session directory for concurrent-safe toolMetadataStore lookups.
   * Called by the agent after creating the adapter.
   */
  setSessionDir(dir: string): void {
    this.sessionDir = dir;
  }

  // ============================================================
  // Turn Lifecycle
  // ============================================================

  /**
   * Start a new turn — resets shared state and calls subclass hook.
   */
  startTurn(turnId?: string): void {
    this.turnIndex++;
    this.commandOutput.clear();
    this.truncatedCommandOutputIds.clear();
    this.readCommands.clear();
    this.blockReasons.clear();
    this.currentTurnId = turnId || null;
    this.onTurnStart();
  }

  /**
   * Subclass hook called during startTurn() for resetting provider-specific state.
   */
  protected abstract onTurnStart(): void;

  // ============================================================
  // Block Reason Tracking
  // ============================================================

  /**
   * Store the block reason for a tool call that will be declined.
   * Called from the agent when PreToolUse/permission check blocks a tool.
   */
  setBlockReason(id: string, reason: string): void {
    this.log.warn('Block reason recorded', { id, reason });
    this.blockReasons.set(id, reason);
  }

  /**
   * Consume and delete the block reason for a tool call.
   * Returns undefined if no block reason was stored.
   */
  protected consumeBlockReason(...keys: string[]): string | undefined {
    for (const key of keys) {
      const reason = this.blockReasons.get(key);
      if (reason !== undefined) {
        this.blockReasons.delete(key);
        return reason;
      }
    }
    return undefined;
  }

  // ============================================================
  // Read Command Classification
  // ============================================================

  /**
   * Attempt to classify a bash command as a file read.
   * If classified, stores the ReadCommandInfo for later tool_result mapping.
   *
   * @returns ReadCommandInfo if the command was classified as a read, null otherwise
   */
  protected classifyReadCommand(id: string, command: string): ReadCommandInfo | null {
    const readInfo = parseReadCommand(command);
    if (readInfo) {
      this.readCommands.set(id, readInfo);
    }
    return readInfo;
  }

  /**
   * Consume and delete the read command info for a tool call.
   */
  protected consumeReadCommand(id: string): ReadCommandInfo | undefined {
    const info = this.readCommands.get(id);
    if (info) {
      this.readCommands.delete(id);
    }
    return info;
  }

  // ============================================================
  // Command Output Accumulation
  // ============================================================

  /**
   * Accumulate streaming command output for a tool call.
   * Called from output delta handlers (not emitted as an event).
   * Caps size so large tool streams cannot throw `RangeError: Invalid string length`.
   */
  accumulateOutput(id: string, delta: string): void {
    if (!delta || this.truncatedCommandOutputIds.has(id)) return;

    const current = this.commandOutput.get(id) || '';
    const nextLength = current.length + delta.length;
    if (nextLength <= MAX_COMMAND_OUTPUT_CHARS) {
      this.commandOutput.set(id, current + delta);
      return;
    }

    const room = Math.max(0, MAX_COMMAND_OUTPUT_CHARS - current.length - COMMAND_OUTPUT_TRUNCATION_MARKER.length);
    const clipped = room > 0 ? current + delta.slice(0, room) : current.slice(0, Math.max(0, MAX_COMMAND_OUTPUT_CHARS - COMMAND_OUTPUT_TRUNCATION_MARKER.length));
    this.commandOutput.set(id, clipped + COMMAND_OUTPUT_TRUNCATION_MARKER);
    this.truncatedCommandOutputIds.add(id);
    this.log.warn('Tool output truncated to in-memory cap', {
      id,
      maxChars: MAX_COMMAND_OUTPUT_CHARS,
      discardedApprox: nextLength - MAX_COMMAND_OUTPUT_CHARS,
    });
  }

  /**
   * Consume and delete accumulated command output for a tool call.
   */
  protected consumeOutput(id: string): string | undefined {
    const output = this.commandOutput.get(id);
    if (output !== undefined) {
      this.commandOutput.delete(id);
      this.truncatedCommandOutputIds.delete(id);
    }
    return output;
  }

  // ============================================================
  // MCP Tool Name Helpers
  // ============================================================

  /**
   * Build the canonical proxy tool name for an MCP tool call.
   *
   * Pool server tools already include the source slug in their name
   * (e.g., "craft__search_spaces") because the pool strips the `mcp__` prefix.
   * We just need to re-add `mcp__` to produce "mcp__craft__search_spaces".
   * Without this, we'd get "mcp__sources__craft__search_spaces" which breaks
   * source lookup in resolveToolDisplayMeta().
   */
  protected buildMcpToolName(serverName: string, toolName: string): string {
    if (serverName === POOL_SERVER_MCP_NAME && toolName.includes('__')) {
      return `mcp__${toolName}`;
    }
    return `mcp__${serverName}__${toolName}`;
  }

  // ============================================================
  // Event Construction Helpers
  // ============================================================

  /**
   * Create a tool_start AgentEvent.
   */
  protected createToolStart(
    id: string,
    toolName: string,
    input: Record<string, unknown>,
    intent?: string,
    displayName?: string,
    parentToolUseId?: string,
  ): AgentEvent {
    return {
      type: 'tool_start',
      toolName,
      toolUseId: id,
      input,
      intent,
      displayName,
      turnId: this.currentTurnId || undefined,
      parentToolUseId,
    };
  }

  /**
   * Create a tool_result AgentEvent.
   */
  protected createToolResult(
    id: string,
    toolName: string,
    result: string,
    isError: boolean,
    parentToolUseId?: string,
  ): AgentEvent {
    return {
      type: 'tool_result',
      toolUseId: id,
      toolName,
      result,
      isError,
      turnId: this.currentTurnId || undefined,
      parentToolUseId,
    };
  }

  /**
   * Build a Read-classified tool_start event from a ReadCommandInfo.
   */
  protected createReadToolStart(
    id: string,
    readInfo: ReadCommandInfo,
    intent?: string,
    displayName?: string,
    parentToolUseId?: string,
  ): AgentEvent {
    return this.createToolStart(
      id,
      'Read',
      {
        file_path: readInfo.filePath,
        offset: readInfo.startLine,
        limit: readInfo.endLine
          ? readInfo.endLine - (readInfo.startLine || 1) + 1
          : undefined,
        _command: readInfo.originalCommand,
      },
      intent,
      displayName ?? 'Read File',
      parentToolUseId,
    );
  }
}
