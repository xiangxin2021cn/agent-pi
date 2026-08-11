import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export interface TenderProjectOrchestration {
  schemaVersion: 1;
  projectId: string;
  parentSessionId?: string;
  updatedAt: string;
  /** Session ids that were demoted during migration (optional). */
  legacyParentSessionIds?: string[];
}

/** Later stages win when electing a canonical parent. */
const STAGE_ELECTION_PRIORITY = [
  'planning-and-submission',
  'boq-five-step-pricing',
  'tender-document-analysis',
  'project-setup',
] as const;

function atomicWriteJson(filePath: string, value: unknown): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  renameSync(temporary, filePath);
}

export function orchestrationPointerPath(projectDirectory: string): string {
  return join(projectDirectory, 'orchestration', 'project-orchestration.json');
}

export function readProjectOrchestration(
  projectDirectory: string,
  projectId: string,
): TenderProjectOrchestration {
  const path = orchestrationPointerPath(projectDirectory);
  if (!existsSync(path)) {
    return {
      schemaVersion: 1,
      projectId,
      updatedAt: new Date(0).toISOString(),
    };
  }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as TenderProjectOrchestration;
    if (parsed.schemaVersion !== 1) {
      return { schemaVersion: 1, projectId, updatedAt: new Date(0).toISOString() };
    }
    return { ...parsed, projectId };
  } catch {
    return { schemaVersion: 1, projectId, updatedAt: new Date(0).toISOString() };
  }
}

export function writeProjectOrchestration(
  projectDirectory: string,
  value: TenderProjectOrchestration,
): void {
  atomicWriteJson(orchestrationPointerPath(projectDirectory), value);
}

export function bindProjectParentSession(
  projectDirectory: string,
  projectId: string,
  parentSessionId: string,
): TenderProjectOrchestration {
  const previous = readProjectOrchestration(projectDirectory, projectId);
  const legacy = new Set(previous.legacyParentSessionIds ?? []);
  if (
    previous.parentSessionId
    && previous.parentSessionId !== parentSessionId
  ) {
    legacy.add(previous.parentSessionId);
  }
  legacy.delete(parentSessionId);
  const next: TenderProjectOrchestration = {
    schemaVersion: 1,
    projectId,
    parentSessionId,
    updatedAt: new Date().toISOString(),
    ...(legacy.size > 0 ? { legacyParentSessionIds: [...legacy].sort() } : {}),
  };
  writeProjectOrchestration(projectDirectory, next);
  return next;
}

export function collectParentSessionIdsFromBoards(projectDirectory: string): Array<{
  stageId: string;
  parentSessionId: string;
}> {
  const boardDirectory = join(projectDirectory, 'orchestration', 'task-boards');
  if (!existsSync(boardDirectory)) return [];
  const results: Array<{ stageId: string; parentSessionId: string }> = [];
  for (const name of readdirSync(boardDirectory)) {
    if (!name.endsWith('.json')) continue;
    const stageId = name.replace(/\.json$/, '');
    try {
      const board = JSON.parse(readFileSync(join(boardDirectory, name), 'utf8')) as {
        parentSessionId?: string;
      };
      if (board.parentSessionId?.trim()) {
        results.push({ stageId, parentSessionId: board.parentSessionId.trim() });
      }
    } catch {
      // ignore corrupt boards
    }
  }
  return results;
}

function electFromCandidates(
  boardBindings: Array<{ stageId: string; parentSessionId: string }>,
  candidateSessionIds: string[],
): string | undefined {
  const bySession = new Map<string, Set<string>>();
  for (const binding of boardBindings) {
    const stages = bySession.get(binding.parentSessionId) ?? new Set<string>();
    stages.add(binding.stageId);
    bySession.set(binding.parentSessionId, stages);
  }
  for (const id of candidateSessionIds) {
    if (!bySession.has(id)) bySession.set(id, new Set());
  }
  if (bySession.size === 0) return undefined;

  for (const stageId of STAGE_ELECTION_PRIORITY) {
    const matches = [...bySession.entries()]
      .filter(([, stages]) => stages.has(stageId))
      .map(([sessionId]) => sessionId)
      .sort();
    if (matches[0]) return matches[0];
  }

  return [...bySession.keys()].sort()[0];
}

/** Rewrite every task-board parentSessionId to the project parent (migration / rebind). */
export function rebindAllTaskBoardParents(
  projectDirectory: string,
  parentSessionId: string,
): number {
  const boardDirectory = join(projectDirectory, 'orchestration', 'task-boards');
  if (!existsSync(boardDirectory)) return 0;
  let changed = 0;
  for (const name of readdirSync(boardDirectory)) {
    if (!name.endsWith('.json')) continue;
    const path = join(boardDirectory, name);
    try {
      const board = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
      if (board.parentSessionId === parentSessionId) continue;
      board.parentSessionId = parentSessionId;
      board.updatedAt = new Date().toISOString();
      atomicWriteJson(path, board);
      changed += 1;
    } catch {
      // ignore
    }
  }
  return changed;
}

/**
 * Prefer an existing *live* pointer; else elect from stage task-boards / candidate ids.
 * Dead pointers (deleted sessions) are demoted to legacy and never trusted for open/dispatch.
 * When electing, persists the pointer and records demoted parents.
 */
export function resolveOrElectProjectParent(options: {
  projectDirectory: string;
  projectId: string;
  candidateSessionIds?: string[];
  /** When provided, only live sessions may remain/become the project parent. */
  isSessionAlive?: (sessionId: string) => boolean;
}): {
  parentSessionId?: string;
  elected: boolean;
  healedStalePointer: boolean;
  legacyParentSessionIds: string[];
  orchestration: TenderProjectOrchestration;
} {
  const isAlive = options.isSessionAlive ?? (() => true);
  const existing = readProjectOrchestration(options.projectDirectory, options.projectId);
  const pointer = existing.parentSessionId?.trim() || undefined;

  if (pointer && isAlive(pointer)) {
    return {
      parentSessionId: pointer,
      elected: false,
      healedStalePointer: false,
      legacyParentSessionIds: existing.legacyParentSessionIds ?? [],
      orchestration: existing,
    };
  }

  const stalePointer = pointer && !isAlive(pointer) ? pointer : undefined;
  const boardBindings = collectParentSessionIdsFromBoards(options.projectDirectory)
    .filter((binding) => isAlive(binding.parentSessionId));
  const candidates = [
    ...new Set([
      ...boardBindings.map((binding) => binding.parentSessionId),
      ...(options.candidateSessionIds ?? [])
        .map((id) => id.trim())
        .filter((id) => Boolean(id) && isAlive(id)),
    ]),
  ];
  const electedId = electFromCandidates(boardBindings, candidates);

  if (!electedId) {
    if (!stalePointer) {
      return {
        elected: false,
        healedStalePointer: false,
        legacyParentSessionIds: existing.legacyParentSessionIds ?? [],
        orchestration: existing,
      };
    }
    // Clear the dead pointer so UI/status stop advertising a deleted session.
    const legacy = new Set(existing.legacyParentSessionIds ?? []);
    legacy.add(stalePointer);
    const cleared: TenderProjectOrchestration = {
      schemaVersion: 1,
      projectId: options.projectId,
      updatedAt: new Date().toISOString(),
      legacyParentSessionIds: [...legacy].sort(),
    };
    writeProjectOrchestration(options.projectDirectory, cleared);
    return {
      elected: false,
      healedStalePointer: true,
      legacyParentSessionIds: cleared.legacyParentSessionIds ?? [],
      orchestration: cleared,
    };
  }

  const previousLegacy = new Set(existing.legacyParentSessionIds ?? []);
  if (stalePointer) previousLegacy.add(stalePointer);
  for (const id of candidates) {
    if (id !== electedId) previousLegacy.add(id);
  }
  previousLegacy.delete(electedId);
  const orchestration: TenderProjectOrchestration = {
    schemaVersion: 1,
    projectId: options.projectId,
    parentSessionId: electedId,
    updatedAt: new Date().toISOString(),
    ...(previousLegacy.size > 0 ? { legacyParentSessionIds: [...previousLegacy].sort() } : {}),
  };
  writeProjectOrchestration(options.projectDirectory, orchestration);
  return {
    parentSessionId: electedId,
    elected: true,
    healedStalePointer: Boolean(stalePointer),
    legacyParentSessionIds: orchestration.legacyParentSessionIds ?? [],
    orchestration,
  };
}
