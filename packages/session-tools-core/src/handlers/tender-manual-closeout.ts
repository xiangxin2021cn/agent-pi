import { existsSync, readFileSync, readdirSync, statSync, type Dirent } from 'node:fs';
import { basename, join } from 'node:path';
import {
  parseTenderCapabilityIndex,
  type TenderCapabilityId,
  type TenderCapabilityIndex,
  type TenderCapabilityIndexEntry,
} from '@agent-pi/business-core/tender';

export interface TenderManualCloseoutEvidence {
  capability: TenderCapabilityId;
  filePath: string;
  label: string;
  updatedAt: string;
}

export interface TenderManualCloseoutApplyResult {
  index: TenderCapabilityIndex;
  changed: boolean;
  evidence: TenderManualCloseoutEvidence[];
}

const CLOSEOUT_FILE_PATTERN = /^STAGE_CLOSEOUT.*\.md$/i;
const MANUAL_EVIDENCE_CAPABILITIES: TenderCapabilityId[] = ['document_analysis'];
const MAX_SEARCH_DEPTH = 3;
const MAX_CLOSEOUT_FILES = 200;

export function applyManualTenderCloseoutEvidence(
  index: TenderCapabilityIndex,
  options: {
    projectDirectory: string;
    workingDirectory: string;
    coreRevision: number;
  },
): TenderManualCloseoutApplyResult {
  const evidence = findManualTenderCloseoutEvidence(options.projectDirectory, options.workingDirectory);
  if (evidence.length === 0) return { index, changed: false, evidence };

  const entries = new Map<TenderCapabilityId, TenderCapabilityIndexEntry>(
    index.capabilities.map((entry) => [entry.capability, entry]),
  );
  let changed = false;
  for (const item of evidence) {
    const current = entries.get(item.capability);
    if (current && current.revision > 0 && current.readiness === 'ready' && !current.stale) continue;
    entries.set(item.capability, {
      capability: item.capability,
      enabled: true,
      required: current?.required ?? false,
      revision: Math.max(current?.revision ?? 0, 1),
      readiness: 'ready',
      issueCount: 0,
      stale: false,
      updatedAt: item.updatedAt,
    });
    changed = true;
  }

  if (!changed) return { index, changed: false, evidence };
  return {
    index: parseTenderCapabilityIndex({
      ...index,
      coreRevision: options.coreRevision,
      capabilities: [...entries.values()],
    }),
    changed: true,
    evidence,
  };
}

export function findManualTenderCloseoutEvidence(
  projectDirectory: string,
  workingDirectory: string,
): TenderManualCloseoutEvidence[] {
  const byCapability = new Map<TenderCapabilityId, TenderManualCloseoutEvidence>();
  for (const filePath of findCloseoutFiles(projectDirectory, workingDirectory)) {
    const stat = safeStat(filePath);
    if (!stat?.isFile()) continue;
    const content = safeReadText(filePath);
    if (!content || !isCloseoutEvidenceDocument(filePath, content)) continue;
    const updatedAt = stat.mtime.toISOString();
    for (const capability of MANUAL_EVIDENCE_CAPABILITIES) {
      const label = confirmedCapabilityLine(content, capability);
      if (!label) continue;
      const current = byCapability.get(capability);
      if (!current || updatedAt > current.updatedAt) {
        byCapability.set(capability, { capability, filePath, label, updatedAt });
      }
    }
  }
  return [...byCapability.values()];
}

function findCloseoutFiles(projectDirectory: string, workingDirectory: string): string[] {
  const roots = uniqueExistingDirectories([
    projectDirectory,
    join(workingDirectory, 'Agent Pi Outputs'),
  ]);
  const result: string[] = [];
  for (const root of roots) {
    collectCloseoutFiles(root, 0, result);
    if (result.length >= MAX_CLOSEOUT_FILES) break;
  }
  return result;
}

function collectCloseoutFiles(directory: string, depth: number, result: string[]): void {
  if (depth > MAX_SEARCH_DEPTH || result.length >= MAX_CLOSEOUT_FILES) return;
  let entries: Dirent[];
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (result.length >= MAX_CLOSEOUT_FILES) return;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '.git' || entry.name === 'node_modules') continue;
      collectCloseoutFiles(path, depth + 1, result);
    } else if (entry.isFile() && CLOSEOUT_FILE_PATTERN.test(entry.name)) {
      result.push(path);
    }
  }
}

function uniqueExistingDirectories(paths: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const path of paths) {
    if (seen.has(path) || !safeStat(path)?.isDirectory()) continue;
    seen.add(path);
    result.push(path);
  }
  return result;
}

function isCloseoutEvidenceDocument(filePath: string, content: string): boolean {
  return CLOSEOUT_FILE_PATTERN.test(basename(filePath))
    || /能力包覆盖证据|阶段完成声明|阶段关闭确认|capability\s+coverage/i.test(content);
}

function confirmedCapabilityLine(content: string, capability: TenderCapabilityId): string | undefined {
  const capabilityPattern = new RegExp(`(^|[^A-Za-z0-9_])${escapeRegExp(capability)}([^A-Za-z0-9_]|$)`, 'i');
  return content.split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => {
      if (!capabilityPattern.test(line)) return false;
      if (/待执行|执行待定|待定|未完成|not[_ -]?ready|pending|blocked|🔜|❌/i.test(line)) return false;
      return /✅|已完成|完成|\bready\b|\bcomplete(?:d)?\b/i.test(line);
    });
}

function safeReadText(filePath: string): string | undefined {
  try {
    return readFileSync(filePath, 'utf8');
  } catch {
    return undefined;
  }
}

function safeStat(path: string) {
  try {
    return existsSync(path) ? statSync(path) : undefined;
  } catch {
    return undefined;
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
