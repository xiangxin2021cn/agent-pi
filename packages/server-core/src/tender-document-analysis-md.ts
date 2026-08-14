import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type { TenderDocumentAnalysisData, TenderDocumentAnalysisSection } from '@agent-pi/business-core/tender';
import type { TenderDocumentAnalysisBatchManifest } from './tender-document-batches.ts';
import {
  copyFileIfNewer,
  tenderOfficialOutputsDir,
} from './tender-official-outputs.ts';
import {
  assessProjectCharacteristicsEvidence,
  formatProjectCharacteristicsEvidenceMarkdown,
  readProjectCharacteristicsEvidenceLedger,
  readRegisteredSourceHints,
  writeProjectCharacteristicsEvidenceLedger,
} from './tender-project-characteristics-evidence.ts';

export interface DocumentAnalysisMarkdownMeta {
  projectId: string;
  parentSessionId: string;
  workingDirectory: string;
  manifest: TenderDocumentAnalysisBatchManifest;
  generatedAt?: string;
  projectDirectory?: string;
  sourceFiles?: Array<{ kind?: string; name?: string; path?: string; status?: string }>;
}

export interface PublishDocumentAnalysisArtifactsResult {
  directory: string;
  published: number;
  skipped: number;
}

export interface WriteDocumentAnalysisOfficialMarkdownResult {
  summaryPath: string;
  characteristicsPath: string;
}

function resolveEvidenceSourceFiles(meta: DocumentAnalysisMarkdownMeta) {
  return meta.sourceFiles ?? (meta.projectDirectory ? readRegisteredSourceHints(meta.projectDirectory) : undefined);
}

const EMPTY_CHARACTERISTIC = '_招标文件解析要点中未单独归纳此项；组价时按已登记招标资料原文核对，不得臆造。_';

const CHARACTERISTIC_CHAPTERS = [
  {
    id: 'contract',
    title: '合同制式与专用条款',
    kinds: new Set(['special_conditions']),
    pattern: /\b(fidic|gcc\b|nec3|nec4|jbcc|particular condition|专用条款|合同条件|合同制式|red book|yellow book|pink book|silver book|conditions of contract|contract data|通用条件)\b/i,
  },
  {
    id: 'specs',
    title: '技术规范与条文修订',
    kinds: new Set<string>(),
    pattern: /\b(specification|coto|colto|sabs|bs en|规范|条文修订|particular specification|standard specification|project specification|amendment)\b/i,
  },
  {
    id: 'calendar',
    title: '工作时间与节假日',
    kinds: new Set<string>(),
    pattern: /\b(working hour|working time|work week|holiday|节假日|工作时间|shift|calendar|public holiday|rest day)\b/i,
  },
  {
    id: 'subcontract',
    title: '分包限定与属地化',
    kinds: new Set<string>(),
    pattern: /\b(subcontract|nominated|属地|locali[sz]e|local content|b-?bbee|分包|local labour|cidb|domestic preference)\b/i,
  },
  {
    id: 'sequence',
    title: '施工顺序及其他招标限定',
    kinds: new Set<string>(),
    pattern: /\b(sequence|phasing|construction order|施工顺序|traffic accommodation|possession|access constraint|sectional completion)\b/i,
  },
  {
    id: 'site',
    title: '工期、地点与自然条件',
    kinds: new Set(['project_information', 'geotechnical']),
    pattern: /\b(duration|completion date|time for completion|工期|地点|site location|geolog|地质|climat|气候|weather|rainfall|foundation|borrow)\b/i,
  },
  {
    id: 'other',
    title: '其他硬约束与待澄清项',
    kinds: new Set(['risk_gap', 'tender_requirements', 'addenda_clarifications']),
    pattern: /(?:)/,
  },
] as const;

/**
 * Build a project-level professional synopsis of merged document analysis.
 * Avoid pack-path tutorials and meta dumps — body is bid-facing.
 */
export function formatDocumentAnalysisMarkdown(
  data: TenderDocumentAnalysisData,
  meta: DocumentAnalysisMarkdownMeta,
): string {
  const generatedAt = meta.generatedAt ?? new Date().toISOString();
  const byDocument = new Map<string, TenderDocumentAnalysisSection[]>();
  for (const section of data.sections) {
    const list = byDocument.get(section.documentId) ?? [];
    list.push(section);
    byDocument.set(section.documentId, list);
  }

  const documentNameById = documentNameMap(meta.manifest);
  const characteristicChapters = formatProjectCharacteristicsChapters(data, documentNameById);
  const evidence = assessProjectCharacteristicsEvidence({
    projectId: meta.projectId,
    data,
    sourceFiles: resolveEvidenceSourceFiles(meta),
    webDiligenceAuthorizedAt: meta.projectDirectory
      ? readProjectCharacteristicsEvidenceLedger(meta.projectDirectory)?.webDiligenceAuthorizedAt
      : undefined,
  });

  const lines: string[] = [
    '# 招标文件解析纪要',
    '',
    `项目 \`${meta.projectId}\` · 已覆盖 ${byDocument.size} 份资料 · ${data.sections.length} 个要点 · ${generatedAt.slice(0, 10)}`,
    '',
    '本稿供估价 / 技术 / 商务阅读：硬约束、组价与施工含义、风险与待澄清项。逐文件正文见同期发布的分册 Markdown。解析完成后汇总的项目限定条件见下方「项目特征」，并另存独立文件 `项目特征.md`，作为下一阶段 BOQ 组价依据。缺规范/合同原文时须补传或放行尽调，禁止臆造。',
    '',
    '## 项目特征',
    '',
    ...characteristicChapters,
    ...formatProjectCharacteristicsEvidenceMarkdown(evidence),
    '',
  ];

  for (const [documentId, sections] of byDocument) {
    const title = documentNameById.get(documentId) ?? documentId;
    lines.push(`## ${title}`);
    lines.push('');

    const reviewed = sections.filter((section) => section.status === 'reviewed');
    const blocked = sections.filter((section) => section.status === 'blocked');
    if (blocked.length > 0) {
      lines.push(`- 待处理 / 受阻要点：${blocked.length}`);
    }
    if (reviewed.length > 0 && reviewed.length !== sections.length) {
      lines.push(`- 已整理要点：${reviewed.length}/${sections.length}`);
    }
    if (blocked.length > 0 || (reviewed.length > 0 && reviewed.length !== sections.length)) {
      lines.push('');
    }

    for (const section of sections) {
      lines.push(`### ${section.title}`);
      lines.push('');
      lines.push(section.summary.trim() || '_（无摘要）_');
      lines.push('');
      appendUsefulLocators(lines, section);
    }
  }

  return `${lines.join('\n').trimEnd()}\n`;
}

export function formatProjectCharacteristicsMarkdown(
  data: TenderDocumentAnalysisData,
  meta: DocumentAnalysisMarkdownMeta,
): string {
  const generatedAt = meta.generatedAt ?? new Date().toISOString();
  const documentNameById = documentNameMap(meta.manifest);
  const chapters = formatProjectCharacteristicsChapters(data, documentNameById);
  const evidence = assessProjectCharacteristicsEvidence({
    projectId: meta.projectId,
    data,
    sourceFiles: resolveEvidenceSourceFiles(meta),
    webDiligenceAuthorizedAt: meta.projectDirectory
      ? readProjectCharacteristicsEvidenceLedger(meta.projectDirectory)?.webDiligenceAuthorizedAt
      : undefined,
  });
  return [
    '# 项目特征',
    '',
    `项目 \`${meta.projectId}\` · 由招标文件解析汇总编制 · ${generatedAt.slice(0, 10)}`,
    '',
    '本稿从已合并的解析要点归纳招标文件对本工程的限定条件，供 BOQ 组价与后续策划引用。未单独归纳的条目须回原文核对，不得臆造。缺规范/合同/知识库原文时，后续阶段主会话须请用户补传解析或放行网络尽调，禁止用模型记忆填空。',
    '',
    ...chapters,
    ...formatProjectCharacteristicsEvidenceMarkdown(evidence),
    '',
  ].join('\n').trimEnd() + '\n';
}

export function projectCharacteristicsMarkdownPath(
  workingDirectory: string,
  parentSessionId: string,
): string {
  return join(tenderOfficialOutputsDir(workingDirectory, parentSessionId), '项目特征.md');
}

export function writeDocumentAnalysisOfficialMarkdown(
  data: TenderDocumentAnalysisData,
  meta: DocumentAnalysisMarkdownMeta,
): WriteDocumentAnalysisOfficialMarkdownResult {
  const summaryPath = join(
    tenderOfficialOutputsDir(meta.workingDirectory, meta.parentSessionId),
    'document-analysis-summary.md',
  );
  const characteristicsPath = projectCharacteristicsMarkdownPath(
    meta.workingDirectory,
    meta.parentSessionId,
  );
  atomicWriteText(summaryPath, formatDocumentAnalysisMarkdown(data, meta));
  atomicWriteText(characteristicsPath, formatProjectCharacteristicsMarkdown(data, meta));
  if (meta.projectDirectory) {
    const previous = readProjectCharacteristicsEvidenceLedger(meta.projectDirectory);
    const ledger = assessProjectCharacteristicsEvidence({
      projectId: meta.projectId,
      data,
      sourceFiles: resolveEvidenceSourceFiles(meta),
      characteristicsPath,
      webDiligenceAuthorizedAt: previous?.webDiligenceAuthorizedAt,
    });
    writeProjectCharacteristicsEvidenceLedger({
      projectDirectory: meta.projectDirectory,
      ledger,
      workingDirectory: meta.workingDirectory,
      parentSessionId: meta.parentSessionId,
    });
  }
  return { summaryPath, characteristicsPath };
}

export function writeDocumentAnalysisSummaryMarkdown(
  data: TenderDocumentAnalysisData,
  meta: DocumentAnalysisMarkdownMeta,
): string {
  return writeDocumentAnalysisOfficialMarkdown(data, meta).summaryPath;
}

export function writeProjectCharacteristicsMarkdown(
  data: TenderDocumentAnalysisData,
  meta: DocumentAnalysisMarkdownMeta,
): string {
  return writeDocumentAnalysisOfficialMarkdown(data, meta).characteristicsPath;
}

/**
 * Copy completed per-document analysis Markdown into the parent session's
 * Official Outputs tree when they were written elsewhere. Same-path copies are skipped.
 */
export function publishDocumentAnalysisArtifactsToOfficialOutputs(
  workingDirectory: string,
  parentSessionId: string,
  manifest: TenderDocumentAnalysisBatchManifest,
): PublishDocumentAnalysisArtifactsResult {
  const directory = tenderOfficialOutputsDir(workingDirectory, parentSessionId, 'document-analysis');
  mkdirSync(directory, { recursive: true });
  let published = 0;
  let skipped = 0;
  for (const batch of manifest.batches) {
    if (batch.status !== 'complete') {
      skipped += 1;
      continue;
    }
    const sourcePath = batch.markdownPath;
    if (!sourcePath || !existsSync(sourcePath)) {
      skipped += 1;
      continue;
    }
    const destinationPath = join(directory, basename(sourcePath));
    if (copyFileIfNewer(sourcePath, destinationPath)) published += 1;
    else skipped += 1;
  }
  return { directory, published, skipped };
}

function documentNameMap(manifest: TenderDocumentAnalysisBatchManifest): Map<string, string> {
  return new Map(
    manifest.batches.map((batch) => {
      const rawPath = batch.sourcePath ?? batch.markdownPath ?? '';
      const name = rawPath.replace(/\\/g, '/').split('/').pop() || batch.documentId;
      return [batch.documentId, name] as const;
    }),
  );
}

function formatProjectCharacteristicsChapters(
  data: TenderDocumentAnalysisData,
  documentNameById: Map<string, string>,
): string[] {
  const buckets = new Map<string, TenderDocumentAnalysisSection[]>();
  for (const chapter of CHARACTERISTIC_CHAPTERS) {
    buckets.set(chapter.id, []);
  }
  const assigned = new Set<string>();
  for (const chapter of CHARACTERISTIC_CHAPTERS) {
    if (chapter.id === 'other') continue;
    for (const section of data.sections) {
      if (assigned.has(section.id)) continue;
      if (!sectionMatchesChapter(section, chapter)) continue;
      buckets.get(chapter.id)!.push(section);
      assigned.add(section.id);
    }
  }
  for (const section of data.sections) {
    if (assigned.has(section.id)) continue;
    if (section.kind === 'boq_characteristics' && !/\b(constraint|限定|preliminar|P&G|general item)\b/i.test(blobOf(section))) {
      continue;
    }
    buckets.get('other')!.push(section);
  }

  const lines: string[] = [];
  for (const chapter of CHARACTERISTIC_CHAPTERS) {
    lines.push(`### ${chapter.title}`);
    lines.push('');
    const sections = buckets.get(chapter.id) ?? [];
    if (sections.length === 0) {
      lines.push(EMPTY_CHARACTERISTIC);
      lines.push('');
      continue;
    }
    for (const section of sections) {
      const sourceName = documentNameById.get(section.documentId) ?? section.documentId;
      lines.push(`- **${section.title}**（${sourceName}）— ${section.summary.trim() || '（无摘要）'}`);
      const locators = usefulLocatorLabels(section);
      if (locators.length > 0) {
        lines.push(`  - 定位：${locators.join('；')}`);
      }
    }
    lines.push('');
  }
  return lines;
}

function sectionMatchesChapter(
  section: TenderDocumentAnalysisSection,
  chapter: (typeof CHARACTERISTIC_CHAPTERS)[number],
): boolean {
  const blob = blobOf(section);
  if (chapter.pattern.source !== '(?:)' && chapter.pattern.test(blob)) return true;
  if (chapter.kinds.has(section.kind) && chapter.id !== 'other') {
    return chapter.id === 'site' || chapter.id === 'contract';
  }
  return false;
}

function blobOf(section: TenderDocumentAnalysisSection): string {
  return `${section.title}\n${section.summary}\n${section.kind}`;
}

function usefulLocatorLabels(section: TenderDocumentAnalysisSection): string[] {
  return section.sourceRefs
    .filter((ref) => ref.page != null || Boolean(ref.sheet) || Boolean(ref.clause) || Boolean(ref.section))
    .map((ref) => [
      ref.page != null ? `p.${ref.page}` : null,
      ref.sheet ? `sheet ${ref.sheet}` : null,
      ref.clause ? `clause ${ref.clause}` : null,
      ref.section ? `§ ${ref.section}` : null,
    ].filter(Boolean).join(' · '));
}

function appendUsefulLocators(lines: string[], section: TenderDocumentAnalysisSection): void {
  const usefulRefs = section.sourceRefs.filter((ref) =>
    ref.page != null || Boolean(ref.sheet) || Boolean(ref.clause) || Boolean(ref.section),
  );
  if (usefulRefs.length === 0) return;
  lines.push('定位：');
  for (const label of usefulLocatorLabels(section)) {
    lines.push(`- ${label}`);
  }
  lines.push('');
}

function atomicWriteText(outputPath: string, markdown: string): void {
  mkdirSync(dirname(outputPath), { recursive: true });
  const temporary = `${outputPath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporary, markdown, 'utf8');
  renameSync(temporary, outputPath);
}
