import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type { TenderDocumentAnalysisBatchManifest } from './tender-document-batches.ts';
import type { TenderBoqBatchManifest } from './tender-boq-batches.ts';
import { artifactLooksAcceptable } from './tender-document-artifacts.ts';
import { publishDocumentAnalysisArtifactsToOfficialOutputs } from './tender-document-analysis-md.ts';

export type TenderDeliverableKind = 'pack' | 'markdown' | 'summary' | 'report';
export type TenderDeliverablePresence = 'present' | 'missing' | 'thin';

export interface TenderStageDeliverableItem {
  id: string;
  kind: TenderDeliverableKind;
  label: string;
  path: string;
  presence: TenderDeliverablePresence;
  /** Where the authoritative file lives when different from published path. */
  sourcePath?: string;
  publishedPath?: string;
  citable: boolean;
  notes?: string;
}

export interface TenderStageDeliverablesCatalog {
  schemaVersion: 1;
  projectId: string;
  stageId: string;
  updatedAt: string;
  parentSessionId?: string;
  catalogPath: string;
  summaryPath?: string;
  publishedToOfficial: boolean;
  presentCount: number;
  missingCount: number;
  thinCount: number;
  items: TenderStageDeliverableItem[];
  /** Short lines for handoff injection. */
  indexLines: string[];
}

export interface OrganizeStageDeliverablesResult {
  catalog: TenderStageDeliverablesCatalog;
  healed: number;
  published: number;
}

function atomicWriteJson(filePath: string, value: unknown): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  renameSync(temporary, filePath);
}

function probeFile(filePath: string, softMarkdown = false): TenderDeliverablePresence {
  if (!existsSync(filePath)) return 'missing';
  if (softMarkdown) {
    return artifactLooksAcceptable(filePath) ? 'present' : 'thin';
  }
  try {
    const stat = statSync(filePath);
    if (stat.size <= 2) return 'thin';
    return 'present';
  } catch {
    return 'missing';
  }
}

function copyIfNeeded(sourcePath: string, destinationPath: string): boolean {
  if (!existsSync(sourcePath)) return false;
  mkdirSync(dirname(destinationPath), { recursive: true });
  if (existsSync(destinationPath)) {
    try {
      const sourceStat = statSync(sourcePath);
      const destStat = statSync(destinationPath);
      if (destStat.mtimeMs >= sourceStat.mtimeMs && destStat.size === sourceStat.size) {
        return false;
      }
    } catch {
      // fall through
    }
  }
  copyFileSync(sourcePath, destinationPath);
  return true;
}

export function stageDeliverablesCatalogPath(projectDirectory: string, stageId: string): string {
  return join(projectDirectory, 'orchestration', `stage-deliverables-${stageId}.json`);
}

export function readStageDeliverablesCatalog(
  projectDirectory: string,
  stageId: string,
): TenderStageDeliverablesCatalog | undefined {
  const catalogPath = stageDeliverablesCatalogPath(projectDirectory, stageId);
  if (!existsSync(catalogPath)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(catalogPath, 'utf8')) as TenderStageDeliverablesCatalog;
    if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.items)) return undefined;
    return { ...parsed, catalogPath };
  } catch {
    return undefined;
  }
}

function buildDocumentAnalysisItems(input: {
  projectRoot: string;
  projectId: string;
  projectDirectory: string;
  parentSessionId?: string;
  manifest?: TenderDocumentAnalysisBatchManifest;
}): TenderStageDeliverableItem[] {
  const items: TenderStageDeliverableItem[] = [];
  const packPath = join(input.projectDirectory, 'packs', 'document-analysis.json');
  const packPresence = probeFile(packPath);
  items.push({
    id: 'pack:document_analysis',
    kind: 'pack',
    label: 'document_analysis pack',
    path: packPath,
    presence: packPresence,
    citable: packPresence === 'present',
  });

  const officialDir = input.parentSessionId
    ? join(input.projectRoot, 'Agent Pi Outputs', input.parentSessionId, 'document-analysis')
    : undefined;
  const summaryPath = input.parentSessionId
    ? join(input.projectRoot, 'Agent Pi Outputs', input.parentSessionId, 'document-analysis-summary.md')
    : undefined;
  if (summaryPath) {
    const presence = probeFile(summaryPath, true);
    items.push({
      id: 'summary:document_analysis',
      kind: 'summary',
      label: 'document-analysis-summary.md',
      path: summaryPath,
      presence,
      citable: presence === 'present',
    });
  }

  for (const batch of input.manifest?.batches ?? []) {
    const projectMd = batch.markdownPath;
    const publishedPath = officialDir
      ? join(officialDir, basename(projectMd))
      : undefined;
    const sourcePresence = probeFile(projectMd, true);
    const publishedPresence = publishedPath ? probeFile(publishedPath, true) : 'missing';
    const presence = sourcePresence === 'present' || publishedPresence === 'present'
      ? 'present'
      : sourcePresence === 'thin' || publishedPresence === 'thin'
        ? 'thin'
        : 'missing';
    items.push({
      id: `md:${batch.documentId}`,
      kind: 'markdown',
      label: basename(projectMd),
      path: publishedPath && publishedPresence === 'present' ? publishedPath : projectMd,
      sourcePath: projectMd,
      publishedPath,
      presence,
      citable: presence === 'present',
      notes: batch.status === 'complete' ? undefined : `batch:${batch.status}`,
    });
  }
  return items;
}

function buildBoqItems(input: {
  projectRoot: string;
  projectId: string;
  projectDirectory: string;
  manifest?: TenderBoqBatchManifest;
}): TenderStageDeliverableItem[] {
  const items: TenderStageDeliverableItem[] = [];
  const packPath = join(input.projectDirectory, 'packs', 'boq-five-step-pricing.json');
  const packPresence = probeFile(packPath);
  items.push({
    id: 'pack:boq_five_step_pricing',
    kind: 'pack',
    label: 'boq_five_step_pricing pack',
    path: packPath,
    presence: packPresence,
    citable: packPresence === 'present',
  });
  for (const batch of input.manifest?.batches ?? []) {
    const presence = probeFile(batch.markdownPath, true);
    items.push({
      id: `md:${batch.batchId}`,
      kind: 'markdown',
      label: basename(batch.markdownPath),
      path: batch.markdownPath,
      presence,
      citable: presence === 'present',
      notes: batch.status === 'complete' ? undefined : `batch:${batch.status}`,
    });
  }
  return items;
}

function finalizeCatalog(input: {
  projectId: string;
  stageId: string;
  projectDirectory: string;
  parentSessionId?: string;
  items: TenderStageDeliverableItem[];
  summaryPath?: string;
}): TenderStageDeliverablesCatalog {
  const catalogPath = stageDeliverablesCatalogPath(input.projectDirectory, input.stageId);
  const presentCount = input.items.filter((item) => item.presence === 'present').length;
  const missingCount = input.items.filter((item) => item.presence === 'missing').length;
  const thinCount = input.items.filter((item) => item.presence === 'thin').length;
  const publishedToOfficial = input.items
    .filter((item) => item.kind === 'markdown' && item.publishedPath)
    .every((item) => item.presence === 'present' && item.publishedPath && existsSync(item.publishedPath));
  const indexLines = input.items
    .filter((item) => item.citable)
    .slice(0, 40)
    .map((item) => `- [${item.kind}] ${item.label} → ${item.path}`);
  return {
    schemaVersion: 1,
    projectId: input.projectId,
    stageId: input.stageId,
    updatedAt: new Date().toISOString(),
    ...(input.parentSessionId ? { parentSessionId: input.parentSessionId } : {}),
    catalogPath,
    ...(input.summaryPath ? { summaryPath: input.summaryPath } : {}),
    publishedToOfficial,
    presentCount,
    missingCount,
    thinCount,
    items: input.items,
    indexLines,
  };
}

export function buildStageDeliverablesCatalog(input: {
  projectRoot: string;
  projectId: string;
  projectDirectory: string;
  stageId: string;
  parentSessionId?: string;
  documentManifest?: TenderDocumentAnalysisBatchManifest;
  boqManifest?: TenderBoqBatchManifest;
}): TenderStageDeliverablesCatalog {
  if (input.stageId === 'tender-document-analysis') {
    const items = buildDocumentAnalysisItems({
      projectRoot: input.projectRoot,
      projectId: input.projectId,
      projectDirectory: input.projectDirectory,
      parentSessionId: input.parentSessionId,
      manifest: input.documentManifest,
    });
    const summaryPath = input.parentSessionId
      ? join(input.projectRoot, 'Agent Pi Outputs', input.parentSessionId, 'document-analysis-summary.md')
      : undefined;
    return finalizeCatalog({
      projectId: input.projectId,
      stageId: input.stageId,
      projectDirectory: input.projectDirectory,
      parentSessionId: input.parentSessionId,
      items,
      summaryPath,
    });
  }
  if (input.stageId === 'boq-five-step-pricing') {
    return finalizeCatalog({
      projectId: input.projectId,
      stageId: input.stageId,
      projectDirectory: input.projectDirectory,
      parentSessionId: input.parentSessionId,
      items: buildBoqItems({
        projectRoot: input.projectRoot,
        projectId: input.projectId,
        projectDirectory: input.projectDirectory,
        manifest: input.boqManifest,
      }),
    });
  }
  return finalizeCatalog({
    projectId: input.projectId,
    stageId: input.stageId,
    projectDirectory: input.projectDirectory,
    parentSessionId: input.parentSessionId,
    items: [],
  });
}

/**
 * Quality-check + heal: publish missing Official Outputs mirrors and rewrite catalog.
 * Deterministic filesystem work — no agent turns.
 */
export function organizeStageDeliverables(input: {
  projectRoot: string;
  projectId: string;
  projectDirectory: string;
  stageId: string;
  parentSessionId?: string;
  documentManifest?: TenderDocumentAnalysisBatchManifest;
  boqManifest?: TenderBoqBatchManifest;
}): OrganizeStageDeliverablesResult {
  let healed = 0;
  let published = 0;

  if (input.stageId === 'tender-document-analysis' && input.documentManifest && input.parentSessionId) {
    const publish = publishDocumentAnalysisArtifactsToOfficialOutputs(
      input.projectRoot,
      input.parentSessionId,
      input.documentManifest,
    );
    published += publish.published;
    for (const batch of input.documentManifest.batches) {
      if (batch.status !== 'complete') continue;
      const dest = join(publish.directory, basename(batch.markdownPath));
      if (copyIfNeeded(batch.markdownPath, dest)) healed += 1;
    }
  }

  if (input.stageId === 'boq-five-step-pricing' && input.boqManifest) {
    for (const batch of input.boqManifest.batches) {
      if (!existsSync(batch.reportPath) || existsSync(batch.markdownPath)) continue;
      // Cannot invent MD from panel; only count missing for catalog.
    }
  }

  const catalog = buildStageDeliverablesCatalog(input);
  atomicWriteJson(catalog.catalogPath, catalog);
  return { catalog, healed, published };
}

export function formatDeliverablesHandoffBlock(catalog?: TenderStageDeliverablesCatalog): string {
  if (!catalog) return '';
  const lines = [
    '<tender_stage_deliverables>',
    `catalog_path: ${catalog.catalogPath}`,
    `present: ${catalog.presentCount} · missing: ${catalog.missingCount} · thin: ${catalog.thinCount}`,
    `published_to_official: ${catalog.publishedToOfficial}`,
    ...(catalog.summaryPath ? [`summary_path: ${catalog.summaryPath}`] : []),
    'citable_index:',
    ...(catalog.indexLines.length > 0 ? catalog.indexLines : ['- (none yet)']),
    'Read catalog_path / listed paths for upstream evidence. Do not rescan the working tree for discovery.',
    '</tender_stage_deliverables>',
    '',
  ];
  return `\n${lines.join('\n')}\n`;
}
