/**
 * Workspace Types
 *
 * Workspaces are the top-level organizational unit. Everything (sources, sessions)
 * is scoped to a workspace.
 *
 * Directory structure:
 * ~/.agent-pi/workspaces/{slug}/
 *   ├── config.json      - Workspace settings
 *   ├── sources/         - Data sources (MCP, API, local)
 *   └── sessions/        - Conversation sessions
 */

import type { PermissionMode } from '../agent/mode-manager.ts';
import type { ThinkingLevel } from '../agent/thinking-levels.ts';
import type { SessionGoalMode } from '../sessions/types.ts';

export type WorkspaceGoalLoopDefaultMode = Extract<SessionGoalMode, 'off' | 'check_only' | 'auto_improve'>;

export interface WorkspaceGoalLoopConfig {
  /**
   * Default goal-loop behavior for newly auto-detected work sessions.
   * Undefined keeps the built-in heuristic default.
   */
  defaultMode?: WorkspaceGoalLoopDefaultMode;
}

export type WorkspaceGbrainBackend = 'local_pglite' | 'local_postgres' | 'remote_mcp';

export interface WorkspaceGbrainConfig {
  /**
   * Optional project-level advanced memory backend. Disabled by default so
   * Project Memory Lite stays the zero-config baseline; when enabled, runtime
   * sessions bind it to their selected workingDirectory namespace.
   */
  enabled?: boolean;
  backend?: WorkspaceGbrainBackend;
  localDatabasePath?: string;
  postgresUrl?: string;
  remoteMcpUrl?: string;
}

export interface WorkspaceProjectMemoryConfig {
  gbrain?: WorkspaceGbrainConfig;
}

/**
 * Local MCP server configuration
 * Controls whether stdio-based (local subprocess) MCP servers can be spawned.
 */
export interface LocalMcpConfig {
  /**
   * Whether local (stdio) MCP servers are enabled for this workspace.
   * When false, only HTTP-based MCP servers will be used.
   * Default: true (can be overridden by CRAFT_LOCAL_MCP_ENABLED env var)
   */
  enabled: boolean;
}

/**
 * Workspace configuration (stored in config.json)
 */
export interface WorkspaceConfig {
  id: string;
  name: string;
  slug: string; // Folder name (URL-safe)

  /**
   * Default settings for new sessions in this workspace
   */
  defaults?: {
    model?: string;
    /** Default LLM connection for new sessions (slug). Overrides global default. */
    defaultLlmConnection?: string;
    enabledSourceSlugs?: string[]; // Sources to enable by default
    permissionMode?: PermissionMode; // Default permission mode ('safe', 'ask', 'allow-all')
    cyclablePermissionModes?: PermissionMode[]; // Which modes can be cycled with SHIFT+TAB (min 2, default: all 3)
    workingDirectory?: string;
    thinkingLevel?: ThinkingLevel; // Default thinking level for new sessions (default: 'medium')
    colorTheme?: string; // Color theme override for this workspace (preset ID). Undefined = inherit from app default.
    goalLoop?: WorkspaceGoalLoopConfig;
  };

  /**
   * Local MCP server configuration.
   * Controls whether stdio-based MCP servers can be spawned in this workspace.
   * Resolution order: ENV (CRAFT_LOCAL_MCP_ENABLED) > workspace config > default (true)
   */
  localMcpServers?: LocalMcpConfig;

  /**
   * Project memory settings. The built-in file-based Project Memory Lite layer
   * is always available when a working directory is selected; gbrain is an
   * optional advanced backend configured here.
   */
  projectMemory?: WorkspaceProjectMemoryConfig;

  createdAt: number;
  updatedAt: number;
}

/**
 * Workspace creation input
 */
export interface CreateWorkspaceInput {
  name: string;
  defaults?: WorkspaceConfig['defaults'];
}

/**
 * Loaded workspace with resolved sources
 */
export interface LoadedWorkspace {
  config: WorkspaceConfig;
  sourceSlugs: string[]; // Available source slugs (not fully loaded to save memory)
  sessionCount: number; // Number of sessions
}

/**
 * Workspace summary for listing (lightweight)
 */
export interface WorkspaceSummary {
  slug: string;
  name: string;
  sourceCount: number;
  sessionCount: number;
  createdAt: number;
  updatedAt: number;
}

