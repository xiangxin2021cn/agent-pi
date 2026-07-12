import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';

export type BusinessPluginId = 'tender' | 'delivery' | 'investment';

export interface BusinessKnowledgePublication {
  schemaVersion: 1;
  publicationId: string;
  producerPlugin: BusinessPluginId;
  producerWorkspaceId: string;
  producerRevision: number;
  title: string;
  category: string;
  managedArtifactPath: string;
  contentSha256: string;
  approvalState: 'approved' | 'withdrawn';
  publishedAt: string;
  userConfirmed: true;
}

export interface BusinessKnowledgePublicationRegistry {
  version: 1;
  entries: BusinessKnowledgePublication[];
}

export type BusinessKnowledgePublicationInput = Omit<BusinessKnowledgePublication, 'schemaVersion' | 'managedArtifactPath' | 'contentSha256'>;

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export function getBusinessKnowledgePublicationRegistryPath(rootPath: string): string {
  return join(rootPath, 'knowledge-base', 'business-publications', 'registry.json');
}

export function loadBusinessKnowledgePublications(rootPath: string): BusinessKnowledgePublicationRegistry {
  const registryPath = getBusinessKnowledgePublicationRegistryPath(rootPath);
  if (!existsSync(registryPath)) return { version: 1, entries: [] };
  try {
    const parsed = JSON.parse(readFileSync(registryPath, 'utf8')) as BusinessKnowledgePublicationRegistry;
    return { version: 1, entries: Array.isArray(parsed.entries) ? parsed.entries.filter(isPublication) : [] };
  } catch { return { version: 1, entries: [] }; }
}

export function publishBusinessKnowledgeArtifact(
  rootPath: string,
  sourcePath: string,
  input: BusinessKnowledgePublicationInput,
): BusinessKnowledgePublication {
  validateInput(input);
  if (!existsSync(sourcePath)) throw new Error(`Business publication source file does not exist: ${sourcePath}`);
  const contentSha256 = createHash('sha256').update(readFileSync(sourcePath)).digest('hex');
  const registry = loadBusinessKnowledgePublications(rootPath);
  const existing = registry.entries.find((entry) => entry.publicationId === input.publicationId);
  if (existing && existing.contentSha256 !== contentSha256) {
    throw new Error(`Business knowledge publication ${input.publicationId} is immutable; publish a new ID for changed content.`);
  }
  if (existing) return existing;
  const extension = extname(sourcePath).toLowerCase();
  const fileName = sanitizeFileName(basename(sourcePath)) || `artifact${extension || '.bin'}`;
  const managedArtifactPath = join(
    rootPath, 'knowledge-base', 'business-publications', input.producerPlugin,
    input.producerWorkspaceId, contentSha256, fileName,
  );
  mkdirSync(dirname(managedArtifactPath), { recursive: true });
  copyFileSync(sourcePath, managedArtifactPath);
  const publication: BusinessKnowledgePublication = {
    schemaVersion: 1, ...input, category: normalizeKnowledgeBaseFolder(input.category) ?? input.category.trim(),
    managedArtifactPath, contentSha256,
  };
  const entries = [...registry.entries, publication].sort((left, right) => left.publicationId.localeCompare(right.publicationId));
  atomicWriteJson(getBusinessKnowledgePublicationRegistryPath(rootPath), { version: 1, entries });
  return publication;
}

export function toBusinessEvidenceSnapshot(publication: BusinessKnowledgePublication, snapshotId: string, importedAt: string) {
  if (!SAFE_ID.test(snapshotId)) throw new Error('snapshotId must be a filesystem-safe identifier.');
  if (publication.approvalState !== 'approved' || !publication.userConfirmed) throw new Error('Only approved, user-confirmed knowledge publications may be imported as evidence snapshots.');
  return {
    id: snapshotId,
    producerPlugin: publication.producerPlugin,
    producerWorkspaceId: publication.producerWorkspaceId,
    producerRevision: publication.producerRevision,
    managedArtifactPath: publication.managedArtifactPath,
    contentSha256: publication.contentSha256,
    approvalState: publication.approvalState,
    importedAt,
    userConfirmed: publication.userConfirmed,
  } as const;
}

function validateInput(input: BusinessKnowledgePublicationInput): void {
  if (!SAFE_ID.test(input.publicationId)) throw new Error('publicationId must be a filesystem-safe identifier.');
  if (!SAFE_ID.test(input.producerWorkspaceId)) throw new Error('producerWorkspaceId must be a filesystem-safe identifier.');
  if (!Number.isInteger(input.producerRevision) || input.producerRevision < 0) throw new Error('producerRevision must be a non-negative integer.');
  if (!input.title.trim()) throw new Error('title is required.');
  if (!normalizeKnowledgeBaseFolder(input.category)) throw new Error('category is required.');
  if (!input.userConfirmed) throw new Error('Business knowledge publication requires explicit user confirmation.');
  if (!input.publishedAt.includes('T') || !Number.isFinite(Date.parse(input.publishedAt))) throw new Error('publishedAt must be an ISO date-time.');
}

function isPublication(value: unknown): value is BusinessKnowledgePublication {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<BusinessKnowledgePublication>;
  return item.schemaVersion === 1 && typeof item.publicationId === 'string'
    && typeof item.managedArtifactPath === 'string' && /^[a-f0-9]{64}$/i.test(item.contentSha256 ?? '')
    && item.userConfirmed === true;
}

function sanitizeFileName(value: string): string {
  return value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim();
}

function normalizeKnowledgeBaseFolder(value: string | undefined): string | null {
  if (!value) return null;
  const normalized = value.split(/[\\/]+/).map((segment) => segment.trim()).filter(Boolean).join('/');
  return normalized || null;
}

function atomicWriteJson(filePath: string, value: unknown): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  renameSync(tempPath, filePath);
}
