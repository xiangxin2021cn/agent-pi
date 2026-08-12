import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import {
  TENDER_BOUNDARY_SOURCE_ROLES,
  type TenderBoundaryParseStatus,
  type TenderBoundarySourceKind,
  type TenderBoundarySourceRole,
  type TenderProjectBoundarySource,
} from '@agent-pi/business-core/tender';

export interface TenderBoundarySourceRegistry {
  schemaVersion: 1;
  projectId: string;
  updatedAt: string;
  sources: TenderProjectBoundarySource[];
}

export interface TenderBoundarySourceInput {
  id?: string;
  kind: TenderBoundarySourceKind;
  role?: string;
  title: string;
  path?: string;
  knowledgeSlug?: string;
  documentId?: string;
  markdownPath?: string;
  parseStatus?: TenderBoundaryParseStatus;
}

export function boundarySourceRegistryPath(projectDirectory: string): string {
  return join(projectDirectory, 'boundary-sources.json');
}

function atomicWriteJson(filePath: string, value: unknown): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  renameSync(temporary, filePath);
}

export function boundarySourceId(input: {
  kind: TenderBoundarySourceKind;
  path?: string;
  knowledgeSlug?: string;
  documentId?: string;
  title: string;
}): string {
  const key = [
    input.kind,
    input.path ?? '',
    input.knowledgeSlug ?? '',
    input.documentId ?? '',
    input.title,
  ].join('\u0000');
  return `bnd-${createHash('sha256').update(key).digest('hex').slice(0, 12)}`;
}

export function inferBoundarySourceRole(input: {
  kind: TenderBoundarySourceKind;
  title: string;
  path?: string;
}): TenderBoundarySourceRole {
  const blob = `${input.title} ${input.path ?? ''}`.toLowerCase();
  if (input.kind === 'bidder_resource') {
    if (/plant|equipment|机具|设备|fleet/.test(blob)) return 'plant';
    if (/labour|labor|人员|劳务|crew|manpower/.test(blob)) return 'labour';
    if (/material|材料|quarry|borrow|aggregate/.test(blob)) return 'material';
    if (/camp|营地|establishment|临建/.test(blob)) return 'camp';
    if (/rate|price|报价|单价|quotation/.test(blob)) return 'rates';
    if (/org|组织|organigram|机构/.test(blob)) return 'organisation';
    return 'other';
  }
  if (/measur|计量|payment/.test(blob)) return 'measurement';
  if (/quota|定额/.test(blob)) return 'quota';
  if (/c5\.1|five-step|组价|method/.test(blob)) return 'method';
  if (/coto|colto|fidic|specification|规范/.test(blob)) return 'primary_spec';
  return input.kind === 'tender_spec_binding' ? 'primary_spec' : 'reference_spec';
}

export function normalizeBoundarySource(input: TenderBoundarySourceInput): TenderProjectBoundarySource {
  const kind = input.kind;
  const title = input.title.trim() || (input.path ? basename(input.path) : 'Untitled');
  const role = (TENDER_BOUNDARY_SOURCE_ROLES as readonly string[]).includes(input.role ?? '')
    ? input.role as TenderBoundarySourceRole
    : inferBoundarySourceRole({ kind, title, path: input.path });
  const needsParse = Boolean(input.path) && kind !== 'tender_spec_binding';
  return {
    id: input.id?.trim() || boundarySourceId({
      kind,
      path: input.path,
      knowledgeSlug: input.knowledgeSlug,
      documentId: input.documentId,
      title,
    }),
    kind,
    role,
    title,
    ...(input.path ? { path: input.path } : {}),
    ...(input.knowledgeSlug ? { knowledgeSlug: input.knowledgeSlug } : {}),
    ...(input.documentId ? { documentId: input.documentId } : {}),
    ...(input.markdownPath ? { markdownPath: input.markdownPath } : {}),
    parseStatus: input.parseStatus
      ?? (needsParse ? 'registered' : 'not_required'),
  };
}

export function readBoundarySourceRegistry(
  projectDirectory: string,
  projectId: string,
): TenderBoundarySourceRegistry {
  const path = boundarySourceRegistryPath(projectDirectory);
  if (!existsSync(path)) {
    return { schemaVersion: 1, projectId, updatedAt: new Date().toISOString(), sources: [] };
  }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as TenderBoundarySourceRegistry;
    if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.sources)) {
      return { schemaVersion: 1, projectId, updatedAt: new Date().toISOString(), sources: [] };
    }
    return {
      schemaVersion: 1,
      projectId,
      updatedAt: parsed.updatedAt,
      sources: parsed.sources.map((source) => normalizeBoundarySource(source)),
    };
  } catch {
    return { schemaVersion: 1, projectId, updatedAt: new Date().toISOString(), sources: [] };
  }
}

export function writeBoundarySourceRegistry(
  projectDirectory: string,
  projectId: string,
  sources: TenderBoundarySourceInput[],
): TenderBoundarySourceRegistry {
  const previous = readBoundarySourceRegistry(projectDirectory, projectId);
  const previousById = new Map(previous.sources.map((source) => [source.id, source]));
  const nextSources = sources.map((input) => {
    const normalized = normalizeBoundarySource(input);
    const existing = previousById.get(normalized.id);
    if (!existing) return normalized;
    const sameCorpus = existing.path === normalized.path
      && existing.knowledgeSlug === normalized.knowledgeSlug
      && existing.documentId === normalized.documentId;
    if (!sameCorpus) return normalized;
    return {
      ...normalized,
      parseStatus: existing.parseStatus,
      ...(existing.markdownPath && !normalized.markdownPath ? { markdownPath: existing.markdownPath } : {}),
    };
  });
  const registry: TenderBoundarySourceRegistry = {
    schemaVersion: 1,
    projectId,
    updatedAt: new Date().toISOString(),
    sources: nextSources,
  };
  atomicWriteJson(boundarySourceRegistryPath(projectDirectory), registry);
  return registry;
}

export function sourcesFingerprint(sources: TenderProjectBoundarySource[]): string {
  return sources
    .map((source) => `${source.id}:${source.kind}:${source.path ?? ''}:${source.knowledgeSlug ?? ''}:${source.documentId ?? ''}`)
    .sort()
    .join('|');
}

export function parseableBoundarySources(sources: TenderProjectBoundarySource[]): TenderProjectBoundarySource[] {
  return sources.filter((source) => Boolean(source.path) && source.parseStatus !== 'not_required');
}
