import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export type TenderDocumentHumanReview = 'pending' | 'accepted' | 'rejected';

export interface TenderDocumentReviewEntry {
  documentId: string;
  artifactPath: string;
  humanReview: TenderDocumentHumanReview;
  updatedAt: string;
  notes?: string;
}

export interface TenderDocumentReviewLedger {
  schemaVersion: 1;
  projectId: string;
  documents: TenderDocumentReviewEntry[];
}

function ledgerPath(projectDirectory: string): string {
  return join(projectDirectory, 'orchestration', 'document-review.json');
}

function atomicWriteJson(filePath: string, value: unknown): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  renameSync(temporary, filePath);
}

export function safeDocumentFileStem(name: string): string {
  const stem = name.replace(/\.[^.]+$/, '');
  return stem
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'document';
}

export function documentArtifactPath(
  projectRoot: string,
  projectId: string,
  documentId: string,
  sourceName: string,
): string {
  return join(
    projectRoot,
    'Agent Pi Outputs',
    projectId,
    'document-analysis',
    `${documentId}__${safeDocumentFileStem(sourceName)}.md`,
  );
}

export function readDocumentReviewLedger(
  projectDirectory: string,
  projectId: string,
): TenderDocumentReviewLedger {
  const path = ledgerPath(projectDirectory);
  if (!existsSync(path)) {
    return { schemaVersion: 1, projectId, documents: [] };
  }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as TenderDocumentReviewLedger;
    if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.documents)) {
      return { schemaVersion: 1, projectId, documents: [] };
    }
    return { ...parsed, projectId };
  } catch {
    return { schemaVersion: 1, projectId, documents: [] };
  }
}

export function ensureDocumentReviewEntries(
  projectDirectory: string,
  projectId: string,
  projectRoot: string,
  documents: Array<{ documentId: string; name: string }>,
): TenderDocumentReviewLedger {
  const previous = readDocumentReviewLedger(projectDirectory, projectId);
  const byId = new Map(previous.documents.map((entry) => [entry.documentId, entry]));
  const now = new Date().toISOString();
  const nextDocuments = documents.map((document) => {
    const artifactPath = documentArtifactPath(projectRoot, projectId, document.documentId, document.name);
    const existing = byId.get(document.documentId);
    if (existing) {
      return { ...existing, artifactPath };
    }
    return {
      documentId: document.documentId,
      artifactPath,
      humanReview: 'pending' as const,
      updatedAt: now,
    };
  });
  const ledger: TenderDocumentReviewLedger = {
    schemaVersion: 1,
    projectId,
    documents: nextDocuments,
  };
  atomicWriteJson(ledgerPath(projectDirectory), ledger);
  return ledger;
}

export function markDocumentHumanReview(options: {
  projectDirectory: string;
  projectId: string;
  projectRoot: string;
  documentId: string;
  humanReview: Exclude<TenderDocumentHumanReview, 'pending'>;
  sourceName?: string;
  notes?: string;
}): TenderDocumentReviewLedger {
  const ledger = readDocumentReviewLedger(options.projectDirectory, options.projectId);
  const now = new Date().toISOString();
  const existing = ledger.documents.find((entry) => entry.documentId === options.documentId);
  const artifactPath = existing?.artifactPath
    ?? documentArtifactPath(
      options.projectRoot,
      options.projectId,
      options.documentId,
      options.sourceName ?? options.documentId,
    );
  const entry: TenderDocumentReviewEntry = {
    documentId: options.documentId,
    artifactPath,
    humanReview: options.humanReview,
    updatedAt: now,
    ...(options.notes ? { notes: options.notes } : {}),
  };
  const documents = existing
    ? ledger.documents.map((item) => item.documentId === options.documentId ? entry : item)
    : [...ledger.documents, entry];
  const next: TenderDocumentReviewLedger = { schemaVersion: 1, projectId: options.projectId, documents };
  atomicWriteJson(ledgerPath(options.projectDirectory), next);
  return next;
}

/** True when a customer-facing analysis MD exists with any usable content. */
export function artifactLooksAcceptable(artifactPath: string): boolean {
  if (!existsSync(artifactPath)) return false;
  try {
    // Soft gate: do not require headings / magic filenames — only that the child
    // left a non-trivial readable artifact for humans to skim.
    const text = readFileSync(artifactPath, 'utf8').trim();
    return text.length >= 20;
  } catch {
    return false;
  }
}

/**
 * Soft advisory: true when the MD looks like a path/meta dump instead of a
 * professional tender reading note. Does not block stage completion.
 */
export function documentArtifactLooksMetaDense(artifactPath: string): boolean {
  if (!existsSync(artifactPath)) return false;
  try {
    const text = readFileSync(artifactPath, 'utf8');
    const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
    if (lines.length === 0) return false;
    const metaHits = lines.filter((line) =>
      /documentId|batchId|sourceRefs|allowedSources|reportPath|markdownPath|Working Folder|knowledge\/tender|bindings\.json|artifactPath/i
        .test(line)
    ).length;
    return metaHits / lines.length >= 0.35;
  } catch {
    return false;
  }
}

/**
 * Soft document-parse gate for stage completion.
 * Human review is advisory only — pending/rejected must not block advancement.
 * Missing MD still soft-blocks because there is no customer-facing result yet.
 */
export function assertDocumentParseGate(
  ledger: TenderDocumentReviewLedger,
  registeredDocumentIds: string[],
): string[] {
  const missing: string[] = [];
  const byId = new Map(ledger.documents.map((entry) => [entry.documentId, entry]));
  for (const documentId of registeredDocumentIds) {
    const entry = byId.get(documentId);
    if (!entry) {
      // Ledger auto-heals on refresh; missing entry alone is not a hard stop.
      continue;
    }
    if (!artifactLooksAcceptable(entry.artifactPath)) {
      missing.push(`document-review:missing-md:${documentId}`);
    }
  }
  return missing;
}
