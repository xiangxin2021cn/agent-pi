/**
 * Sources Module
 *
 * Public exports for source management.
 */

// Types
export type {
  SourceType,
  SourceMcpAuthType,
  ApiAuthType,
  KnownProvider,
  ApiOAuthProvider,
  ApiOAuthConfig,
  McpSourceConfig,
  ApiSourceConfig,
  LocalSourceConfig,
  SourceConnectionStatus,
  FolderSourceConfig,
  SourceGuide,
  LoadedSource,
  CreateSourceInput,
  ApiRenewEndpoint,
} from './types.ts';

// Constants and helpers
export {
  API_OAUTH_PROVIDERS,
  isApiOAuthProvider,
  isGenericOAuthSource,
  hasRenewEndpoint,
  isRefreshableSource,
} from './types.ts';

// Storage functions
export {
  // Directory utilities
  ensureSourcesDir,
  getSourcePath,
  // Config operations
  loadSourceConfig,
  saveSourceConfig,
  markSourceAuthenticated,
  // Guide operations
  loadSourceGuide,
  saveSourceGuide,
  // Icon operations
  findSourceIcon,
  downloadSourceIcon,
  sourceNeedsIconDownload,
  isIconUrl,
  // Load operations
  loadSource,
  loadWorkspaceSources,
  loadAllSources,
  getEnabledSources,
  isSourceUsable,
  getSourcesBySlugs,
  // Create/Delete operations
  generateSourceSlug,
  createSource,
  deleteSource,
  sourceExists,
  // Parsing utilities
  parseGuideMarkdown,
} from './storage.ts';

// Credential Manager (unified credential operations)
export {
  SourceCredentialManager,
  getSourceCredentialManager,
  getSourcesNeedingAuth,
} from './credential-manager.ts';
export type {
  AuthResult,
  ApiCredential,
  BasicAuthCredential,
} from './credential-manager.ts';

// Server Builder (builds MCP/API servers from sources)
export {
  SourceServerBuilder,
  getSourceServerBuilder,
  normalizeMcpUrl,
  SERVER_BUILD_ERRORS,
} from './server-builder.ts';
export type {
  McpServerConfig,
  SourceWithCredential,
  BuiltServers,
} from './server-builder.ts';

// Recommended Sources (available to install, never enabled by default)
export {
  ANYSEARCH_SOURCE_ID,
  ANYSEARCH_SOURCE_SLUG,
  ANYSEARCH_MCP_URL,
  ANYSEARCH_DOCS_URL,
  ANYSEARCH_API_KEYS_URL,
  getRecommendedSourceTemplates,
  getRecommendedSourceTemplate,
  installRecommendedSource,
} from './recommended-sources.ts';
export type {
  RecommendedSourceId,
  RecommendedSourceTemplate,
} from './recommended-sources.ts';

// Built-in Sources (always available in every workspace)
export {
  getDocsSource,
  getBuiltinSources,
  isBuiltinSource,
} from './builtin-sources.ts';

// API Tools (types)
export type { SummarizeCallback } from './api-tools.ts';

// Token Refresh Manager (handles OAuth token refresh with rate limiting)
export {
  TokenRefreshManager,
  createTokenGetter,
} from './token-refresh-manager.ts';
export type {
  TokenRefreshResult,
  RefreshManagerOptions,
} from './token-refresh-manager.ts';
