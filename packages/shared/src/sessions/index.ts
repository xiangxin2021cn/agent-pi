/**
 * Sessions Module
 *
 * Public exports for workspace-scoped session management.
 *
 * Sessions are stored in JSONL format:
 * - Line 1: SessionHeader (metadata for fast list loading)
 * - Lines 2+: StoredMessage (one message per line)
 */

// Types
export type {
  SessionStatus,
  SessionTokenUsage,
  StoredMessage,
  SessionConfig,
  StoredSession,
  SessionMetadata,
  SessionHeader,
  SessionPersistentField,
  SessionGoalMode,
  SessionGoalStatus,
  SessionGoalCriterionKind,
  SessionGoalCriterion,
  SessionGoalAuditEvidence,
  SessionGoalAuditResult,
  SessionGoalState,
} from './types.ts';

export type { ProjectMemoryContextEntry } from './storage.ts';

// Field constants
export { SESSION_PERSISTENT_FIELDS } from './types.ts';

// Storage functions
export {
  // Directory utilities
  ensureSessionsDir,
  ensureSessionDir,
  getSessionPath,
  getSessionFilePath,
  getSessionAttachmentsPath,
  getSessionPlansPath,
  getSessionOutputPath,
  getSessionOutputPathFromSessionPath,
  getProjectBrainPath,
  getProjectMemoryEntriesPath,
  loadProjectMemoryContextForSession,
  FORMAL_OUTPUTS_DIR_NAME,
  PROJECT_MEMORY_DIR_NAME,
  PROJECT_MEMORY_BRAIN_DIR_NAME,
  PROJECT_MEMORY_ENTRIES_FILE_NAME,
  ensureAttachmentsDir,
  // ID generation
  generateSessionId,
  // Session CRUD
  createSession,
  getOrCreateSessionById,
  saveSession,
  loadSession,
  listSessions,
  deleteSession,
  clearSessionMessages,
  getOrCreateLatestSession,
  // Metadata updates
  updateSessionSdkId,
  updateSessionMetadata,
  canUpdateSdkCwd,
  flagSession,
  unflagSession,
  setSessionStatus,
  // Pending plan execution (Accept & Compact flow)
  setPendingPlanExecution,
  markCompactionComplete,
  markPendingPlanExecutionDispatched,
  clearPendingPlanExecution,
  getPendingPlanExecution,
  // Session filtering
  listFlaggedSessions,
  listCompletedSessions,
  listInboxSessions,
  // Archive management
  archiveSession,
  unarchiveSession,
  listArchivedSessions,
  listActiveSessions,
  deleteOldArchivedSessions,
  // Plan storage
  formatPlanAsMarkdown,
  parsePlanFromMarkdown,
  savePlanToFile,
  loadPlanFromFile,
  loadPlanFromPath,
  listPlanFiles,
  deletePlanFile,
  getMostRecentPlanFile,
  // Async persistence queue
  sessionPersistenceQueue,
  // Header metadata signature (for self-triggered event suppression)
  getHeaderMetadataSignature,
} from './storage.ts';

// JSONL helpers (for direct access if needed)
export {
  readSessionHeader,
  readSessionJsonl,
  writeSessionJsonl,
  createSessionHeader,
} from './jsonl.ts';

// Field utilities
export { pickSessionFields } from './utils.ts';

// Slug generator utilities
export {
  generateDatePrefix,
  generateHumanSlug,
  generateUniqueSessionId,
  parseSessionId,
  isHumanReadableId,
} from './slug-generator.ts';

// Word lists (for customization if needed)
export { ADJECTIVES, NOUNS } from './word-lists.ts';

// Session ID validation (security)
export {
  validateSessionId,
  sanitizeSessionId,
} from './validation.ts';

// Session bundle (export/import/dispatch)
export type {
  SessionBundle,
  BundleFile,
  BundleBranchInfo,
  DispatchMode,
} from './bundle.ts';
export {
  serializeSession,
  validateBundle,
  MAX_BUNDLE_SIZE_BYTES,
} from './bundle.ts';
