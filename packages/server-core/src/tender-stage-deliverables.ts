import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import {
  parseTenderCapabilityEnvelope,
  parseTenderDocumentAnalysisData,
} from '@agent-pi/business-core/tender';
import type { TenderDocumentAnalysisBatchManifest } from './tender-document-batches.ts';
import type { TenderBoqBatchManifest } from './tender-boq-batches.ts';
import type { TenderBoundaryBatchManifest } from './tender-boundary-batches.ts';
import { artifactLooksAcceptable } from './tender-document-artifacts.ts';
import {
  publishDocumentAnalysisArtifactsToOfficialOutputs,
  projectCharacteristicsMarkdownPath,
  writeDocumentAnalysisOfficialMarkdown,
} from './tender-document-analysis-md.ts';
import {
  publishProjectBoundaryMarkdown,
  readProjectBoundaryPack,
} from './tender-project-boundary.ts';
import { publishBoqPricingOfficialOutputs } from './tender-boq-pricing-md.ts';
import { resourceScheduleArtifactPaths } from './tender-resource-schedule.ts';
import { copyFileIfNewer, tenderOfficialOutputsDir } from './tender-official-outputs.ts';
import { projectCharacteristicsEvidenceOfficialPath } from './tender-project-characteristics-evidence.ts';

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
  return copyFileIfNewer(sourcePath, destinationPath);
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
    ? tenderOfficialOutputsDir(input.projectRoot, input.parentSessionId, 'document-analysis')
    : undefined;
  const summaryPath = input.parentSessionId
    ? join(tenderOfficialOutputsDir(input.projectRoot, input.parentSessionId), 'document-analysis-summary.md')
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

  if (input.parentSessionId) {
    const characteristicsPath = projectCharacteristicsMarkdownPath(input.projectRoot, input.parentSessionId);
    const presence = probeFile(characteristicsPath, true);
    items.push({
      id: 'md:project_characteristics',
      kind: 'markdown',
      label: '项目特征.md',
      path: characteristicsPath,
      presence,
      citable: presence === 'present',
      publishedPath: characteristicsPath,
    });
    const evidencePath = projectCharacteristicsEvidenceOfficialPath(input.projectRoot, input.parentSessionId);
    const evidencePresence = probeFile(evidencePath);
    items.push({
      id: 'json:project_characteristics_evidence',
      kind: 'report',
      label: '项目特征-证据.json',
      path: evidencePath,
      presence: evidencePresence,
      citable: evidencePresence === 'present',
      publishedPath: evidencePath,
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

function buildProjectBoundaryItems(input: {
  projectRoot: string;
  projectDirectory: string;
  parentSessionId?: string;
  manifest?: TenderBoundaryBatchManifest;
}): TenderStageDeliverableItem[] {
  const items: TenderStageDeliverableItem[] = [];
  const packPath = join(input.projectDirectory, 'packs', 'project-boundary.json');
  const packPresence = probeFile(packPath);
  items.push({
    id: 'pack:project_boundary',
    kind: 'pack',
    label: 'project_boundary pack',
    path: packPath,
    presence: packPresence,
    citable: packPresence === 'present',
  });

  if (input.parentSessionId) {
    const mdPath = join(
      tenderOfficialOutputsDir(input.projectRoot, input.parentSessionId, 'project-boundary'),
      '项目边界条件.md',
    );
    const presence = probeFile(mdPath, true);
    items.push({
      id: 'md:project_boundary',
      kind: 'markdown',
      label: '项目边界条件.md',
      path: mdPath,
      presence,
      citable: presence === 'present',
      publishedPath: mdPath,
    });
  }

  const officialDir = input.parentSessionId
    ? tenderOfficialOutputsDir(input.projectRoot, input.parentSessionId, 'project-boundary')
    : undefined;
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
      id: `md:boundary-source:${batch.sourceId}`,
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
  parentSessionId?: string;
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

  const officialDir = input.parentSessionId
    ? tenderOfficialOutputsDir(input.projectRoot, input.parentSessionId, 'boq-pricing')
    : undefined;
  const summaryPath = input.parentSessionId
    ? join(tenderOfficialOutputsDir(input.projectRoot, input.parentSessionId), 'boq-pricing-summary.md')
    : undefined;
  if (summaryPath) {
    const presence = probeFile(summaryPath, true);
    items.push({
      id: 'summary:boq_five_step_pricing',
      kind: 'summary',
      label: 'boq-pricing-summary.md',
      path: summaryPath,
      presence,
      citable: presence === 'present',
      publishedPath: summaryPath,
    });
  }

  const schedule = resourceScheduleArtifactPaths(
    input.projectRoot,
    input.parentSessionId ?? input.projectId,
  );
  const publishedSchedule = officialDir
    ? join(officialDir, '施工资源消耗总表.md')
    : undefined;
  const scheduleSourcePresence = probeFile(schedule.markdownPath, true);
  const schedulePublishedPresence = publishedSchedule ? probeFile(publishedSchedule, true) : 'missing';
  const schedulePresence = schedulePublishedPresence === 'present' || scheduleSourcePresence === 'present'
    ? 'present'
    : schedulePublishedPresence === 'thin' || scheduleSourcePresence === 'thin'
      ? 'thin'
      : 'missing';
  items.push({
    id: 'md:construction_resource_schedule',
    kind: 'markdown',
    label: '施工资源消耗总表.md',
    path: publishedSchedule && schedulePublishedPresence === 'present' ? publishedSchedule : schedule.markdownPath,
    sourcePath: schedule.markdownPath,
    publishedPath: publishedSchedule,
    presence: schedulePresence,
    citable: schedulePresence === 'present',
  });

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
      id: `md:${batch.batchId}`,
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
  boundaryManifest?: TenderBoundaryBatchManifest;
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
      ? join(tenderOfficialOutputsDir(input.projectRoot, input.parentSessionId), 'document-analysis-summary.md')
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
  if (input.stageId === 'project-boundary-conditions') {
    const items = buildProjectBoundaryItems({
      projectRoot: input.projectRoot,
      projectDirectory: input.projectDirectory,
      parentSessionId: input.parentSessionId,
      manifest: input.boundaryManifest,
    });
    const summaryPath = input.parentSessionId
      ? join(tenderOfficialOutputsDir(input.projectRoot, input.parentSessionId, 'project-boundary'), '项目边界条件.md')
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
    const items = buildBoqItems({
      projectRoot: input.projectRoot,
      projectId: input.projectId,
      projectDirectory: input.projectDirectory,
      parentSessionId: input.parentSessionId,
      manifest: input.boqManifest,
    });
    const summaryPath = input.parentSessionId
      ? join(tenderOfficialOutputsDir(input.projectRoot, input.parentSessionId), 'boq-pricing-summary.md')
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
  boundaryManifest?: TenderBoundaryBatchManifest;
}): OrganizeStageDeliverablesResult {
  let healed = 0;
  let published = 0;

  if (input.stageId === 'tender-document-analysis' && input.documentManifest && input.parentSessionId) {
    const packPath = join(input.projectDirectory, 'packs', 'document-analysis.json');
    if (existsSync(packPath)) {
      try {
        const envelope = parseTenderCapabilityEnvelope(JSON.parse(readFileSync(packPath, 'utf8')));
        const data = parseTenderDocumentAnalysisData(envelope.data);
        writeDocumentAnalysisOfficialMarkdown(data, {
          projectId: input.projectId,
          parentSessionId: input.parentSessionId,
          workingDirectory: input.projectRoot,
          manifest: input.documentManifest,
          projectDirectory: input.projectDirectory,
        });
        published += 1;
      } catch {
        // Pack may be incomplete during early polls — catalog still lists missing files.
      }
    }
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

  if (input.stageId === 'project-boundary-conditions' && input.parentSessionId) {
    const envelope = readProjectBoundaryPack(input.projectDirectory);
    if (envelope) {
      publishProjectBoundaryMarkdown({
        projectRoot: input.projectRoot,
        parentSessionId: input.parentSessionId,
        pack: envelope.data,
      });
      published += 1;
    }
    const destDir = tenderOfficialOutputsDir(input.projectRoot, input.parentSessionId, 'project-boundary');
    for (const batch of input.boundaryManifest?.batches ?? []) {
      if (batch.status !== 'complete') continue;
      const dest = join(destDir, basename(batch.markdownPath));
      if (copyIfNeeded(batch.markdownPath, dest)) healed += 1;
    }
  }

  if (input.stageId === 'boq-five-step-pricing' && input.boqManifest && input.parentSessionId) {
    const publish = publishBoqPricingOfficialOutputs({
      workingDirectory: input.projectRoot,
      projectId: input.projectId,
      projectDirectory: input.projectDirectory,
      parentSessionId: input.parentSessionId,
      manifest: input.boqManifest,
    });
    published += publish.published;
    if (publish.summaryPath) healed += 1;
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
