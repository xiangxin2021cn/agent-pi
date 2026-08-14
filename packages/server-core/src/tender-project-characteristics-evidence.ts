import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  parseTenderDocumentAnalysisData,
  type TenderDocumentAnalysisData,
  type TenderDocumentAnalysisSection,
} from '@agent-pi/business-core/tender';
import { tenderOfficialOutputsDir } from './tender-official-outputs.ts';

export const PROJECT_CHARACTERISTICS_EVIDENCE_GATE = 'project-characteristics:evidence-gap';

export interface ProjectCharacteristicsSourceHint {
  kind?: string;
  name?: string;
  path?: string;
  status?: string;
}

export interface ProjectCharacteristicsEvidenceGap {
  chapterId: string;
  title: string;
  reason: 'missing_source_file' | 'empty_chapter' | 'mentioned_standard_without_file';
  blocking: boolean;
  detail: string;
  suggestedUpload: string;
}

export interface ProjectCharacteristicsEvidenceLedger {
  schemaVersion: 1;
  projectId: string;
  generatedAt: string;
  characteristicsPath?: string;
  evidenceFileNames: string[];
  gaps: ProjectCharacteristicsEvidenceGap[];
  blockingGapCount: number;
  webDiligenceAuthorizedAt?: string;
}

export interface ProjectCharacteristicsEvidencePolicy {
  webDiligenceAuthorized: boolean;
  blocking: boolean;
  evidenceFileNames: string[];
  gaps: ProjectCharacteristicsEvidenceGap[];
  rule: string;
}

const NARRATIVE_KINDS = new Set([
  'specification',
  'contract_data',
  'supporting_evidence',
  'tender_data',
  'addendum',
  'notice',
  'scope',
]);
const NON_EVIDENCE_KINDS = new Set(['boq', 'drawing', 'template', 'returnable_schedule']);
const DEDICATED_SPEC_KINDS = new Set(['specification', 'contract_data']);
const EVIDENCE_NAME_PATTERN = /(specification|\bspec\b|coto|colto|fidic|gcc\b|nec[34]|particular condition|standard specification|合同条件|专用条款|规范|标准|地质|岩土|geotech|borehole|soil report|知识库)/i;
const DEDICATED_SPEC_NAME_PATTERN = /(specification|\bspec\b|coto|colto|fidic|gcc\b|nec[34]|particular condition|standard specification|合同条件|专用条款|规范)/i;
const NAMED_STANDARD_PATTERN = /\b(coto|colto|fidic|sabs|bs en|nec[34]|jbcc|gcc\b)\b|规范|合同条件/i;

export const PROJECT_CHARACTERISTICS_EVIDENCE_POLICY_RULE = [
  'Project-characteristic facts (contract form, spec clauses, geology, climate, calendar, subcontracting, sequence) require a registered source file, knowledge-base entry, or user-authorized web diligence.',
  'Do not fill gaps from model memory.',
  'Market-rate webEvidence remains allowed for unit rates and is separate from this authorization.',
  'If webDiligenceAuthorized is false: do not use the web to invent missing specs, geology, or other characteristic facts; mark them unverified and ask the parent session to request an upload or force-pass.',
  'If webDiligenceAuthorized is true: diligence only the listed gaps and record url + accessedAt; still never fabricate.',
].join(' ');

const EMPTY_CHAPTERS: Array<{ id: string; title: string; suggestedUpload: string }> = [
  { id: 'contract', title: '合同制式与专用条款', suggestedUpload: '合同条件 / 专用条款 / FIDIC 或其它制式文本' },
  { id: 'specs', title: '技术规范与条文修订', suggestedUpload: '项目规范 PDF、标准规范（如 COTO）或企业知识库规范条目' },
  { id: 'calendar', title: '工作时间与节假日', suggestedUpload: '招标文件中的工时、日历或节假日说明' },
  { id: 'subcontract', title: '分包限定与属地化', suggestedUpload: '分包限制、属地化或当地含量条款' },
  { id: 'sequence', title: '施工顺序及其他招标限定', suggestedUpload: '招标文件对施工顺序、占道或分段交工的限定' },
  { id: 'site', title: '工期、地点与自然条件', suggestedUpload: '工期、地点、地质或气候资料' },
];

const CHAPTER_PATTERNS: Record<string, RegExp> = {
  contract: /\b(fidic|gcc\b|nec3|nec4|jbcc|particular condition|专用条款|合同条件|合同制式|red book|yellow book|pink book|silver book|conditions of contract|contract data|通用条件)\b/i,
  specs: /\b(specification|coto|colto|sabs|bs en|规范|条文修订|particular specification|standard specification|project specification|amendment)\b/i,
  calendar: /\b(working hour|working time|work week|holiday|节假日|工作时间|shift|calendar|public holiday|rest day)\b/i,
  subcontract: /\b(subcontract|nominated|属地|locali[sz]e|local content|b-?bbee|分包|local labour|cidb|domestic preference)\b/i,
  sequence: /\b(sequence|phasing|construction order|施工顺序|traffic accommodation|possession|access constraint|sectional completion)\b/i,
  site: /\b(duration|completion date|time for completion|工期|地点|site location|geolog|地质|climat|气候|weather|rainfall|foundation|borrow)\b/i,
};

export function isProjectCharacteristicsEvidenceGateItem(item: string): boolean {
  return item === PROJECT_CHARACTERISTICS_EVIDENCE_GATE
    || item.startsWith(`${PROJECT_CHARACTERISTICS_EVIDENCE_GATE}:`);
}

export function projectCharacteristicsEvidenceLedgerPath(projectDirectory: string): string {
  return join(projectDirectory, 'orchestration', 'project-characteristics-evidence.json');
}

export function projectCharacteristicsEvidenceOfficialPath(
  workingDirectory: string,
  parentSessionId: string,
): string {
  return join(tenderOfficialOutputsDir(workingDirectory, parentSessionId), '项目特征-证据.json');
}

export function looksLikeProjectCharacteristicsEvidenceFile(file: ProjectCharacteristicsSourceHint): boolean {
  if (file.status && file.status !== 'registered') return false;
  const kind = (file.kind ?? '').toLowerCase();
  if (NON_EVIDENCE_KINDS.has(kind)) return false;
  if (NARRATIVE_KINDS.has(kind)) return true;
  return EVIDENCE_NAME_PATTERN.test(`${file.name ?? ''} ${file.path ?? ''}`);
}

export function looksLikeDedicatedSpecOrContractFile(file: ProjectCharacteristicsSourceHint): boolean {
  if (file.status && file.status !== 'registered') return false;
  const kind = (file.kind ?? '').toLowerCase();
  if (DEDICATED_SPEC_KINDS.has(kind)) return true;
  return DEDICATED_SPEC_NAME_PATTERN.test(`${file.name ?? ''} ${file.path ?? ''}`);
}

export function assessProjectCharacteristicsEvidence(input: {
  projectId: string;
  data: TenderDocumentAnalysisData;
  sourceFiles?: ProjectCharacteristicsSourceHint[];
  webDiligenceAuthorizedAt?: string;
  characteristicsPath?: string;
}): ProjectCharacteristicsEvidenceLedger {
  const evidenceFiles = (input.sourceFiles ?? []).filter(looksLikeProjectCharacteristicsEvidenceFile);
  const evidenceFileNames = evidenceFiles.map((file) => file.name || file.path || '').filter(Boolean);
  const hasEvidenceFile = evidenceFiles.length > 0;
  const gaps: ProjectCharacteristicsEvidenceGap[] = [];

  if (!hasEvidenceFile) {
    gaps.push({
      chapterId: 'sources',
      title: '规范 / 合同 / 知识库原文',
      reason: 'missing_source_file',
      blocking: true,
      detail: '已登记资料中没有可引用的招标文件、规范 PDF、合同条件或地质等证据原文（仅有清单/图纸不够）。组价与策划不得用模型记忆填空。',
      suggestedUpload: '招标文件、技术规范、合同条件/专用条款、地质报告，或企业知识库中的对应规范条目',
    });
  }

  const hasDedicatedSpec = evidenceFiles.some(looksLikeDedicatedSpecOrContractFile)
    || (input.sourceFiles ?? []).some(looksLikeDedicatedSpecOrContractFile);
  const mentionsNamedStandard = input.data.sections.some((section) => NAMED_STANDARD_PATTERN.test(blobOf(section)));
  if (mentionsNamedStandard && !hasDedicatedSpec) {
    gaps.push({
      chapterId: 'specs',
      title: '点名的规范/合同制式缺少原文',
      reason: 'mentioned_standard_without_file',
      blocking: false,
      detail: '解析要点点名了规范或合同制式，但资料里没有对应规范/合同原文。引用条文时须回已登记文件；缺页则请用户补传或放行尽调，禁止用模型记忆补条款。',
      suggestedUpload: '点名的标准规范、项目规范或合同条件 PDF / 知识库条目',
    });
  }

  for (const chapter of EMPTY_CHAPTERS) {
    const filled = input.data.sections.some((section) => chapterHasContent(section, chapter.id));
    if (filled) continue;
    const blocking = false;
    gaps.push({
      chapterId: chapter.id,
      title: chapter.title,
      reason: 'empty_chapter',
      blocking,
      detail: `招标文件解析要点未单独归纳「${chapter.title}」。后续阶段不得臆造该条。`,
      suggestedUpload: chapter.suggestedUpload,
    });
  }

  return {
    schemaVersion: 1,
    projectId: input.projectId,
    generatedAt: new Date().toISOString(),
    ...(input.characteristicsPath ? { characteristicsPath: input.characteristicsPath } : {}),
    evidenceFileNames,
    gaps,
    blockingGapCount: gaps.filter((gap) => gap.blocking).length,
    ...(input.webDiligenceAuthorizedAt ? { webDiligenceAuthorizedAt: input.webDiligenceAuthorizedAt } : {}),
  };
}

export function formatProjectCharacteristicsEvidenceMarkdown(ledger: ProjectCharacteristicsEvidenceLedger): string[] {
  const lines = [
    '## 证据与缺口',
    '',
    ledger.evidenceFileNames.length > 0
      ? `已登记可引用证据：${ledger.evidenceFileNames.join('；')}`
      : '已登记可引用证据：无（缺少规范 PDF / 合同条件 / 地质或知识库原文）。',
    '',
  ];
  if (ledger.webDiligenceAuthorizedAt) {
    lines.push(`用户已于 ${ledger.webDiligenceAuthorizedAt.slice(0, 19)} 放行网络尽调。网上核证必须留下 url 与访问时间，仍不得用模型记忆填空。`);
    lines.push('');
  }
  const blocking = ledger.gaps.filter((gap) => gap.blocking);
  const soft = ledger.gaps.filter((gap) => !gap.blocking);
  if (blocking.length > 0 && !ledger.webDiligenceAuthorizedAt) {
    lines.push('**阻断缺口（组价/策划前须处理，禁止臆造）：**');
    for (const gap of blocking) {
      lines.push(`- ${gap.title} — ${gap.detail} 建议补传：${gap.suggestedUpload}`);
    }
    lines.push('');
    lines.push('请用户二选一：1）回到「项目资料登记」补充招标文件/规范/合同/地质/知识库并重新解析；2）在工作台对本阶段点「强制放行」，授权网络尽调（须留 url 证据，仍不得臆造）。');
    lines.push('');
  }
  if (soft.length > 0) {
    lines.push('未单独归纳的项目特征（不阻断，但用到时须有原文或放行尽调，禁止臆造）：');
    for (const gap of soft) {
      lines.push(`- ${gap.title} — ${gap.detail}`);
    }
    lines.push('');
  }
  if (blocking.length === 0 && soft.length === 0) {
    lines.push('项目特征各章均有解析要点，且已登记规范/合同类证据。后续阶段仍不得超出这些原文与已登记资料编造。');
    lines.push('');
  }
  return lines;
}

export function readProjectCharacteristicsEvidenceLedger(
  projectDirectory: string,
): ProjectCharacteristicsEvidenceLedger | undefined {
  const ledgerPath = projectCharacteristicsEvidenceLedgerPath(projectDirectory);
  if (!existsSync(ledgerPath)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(ledgerPath, 'utf8')) as ProjectCharacteristicsEvidenceLedger;
    if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.gaps)) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

export function writeProjectCharacteristicsEvidenceLedger(input: {
  projectDirectory: string;
  ledger: ProjectCharacteristicsEvidenceLedger;
  workingDirectory?: string;
  parentSessionId?: string;
}): string {
  const ledgerPath = projectCharacteristicsEvidenceLedgerPath(input.projectDirectory);
  atomicWriteJson(ledgerPath, input.ledger);
  if (input.workingDirectory && input.parentSessionId) {
    atomicWriteJson(
      projectCharacteristicsEvidenceOfficialPath(input.workingDirectory, input.parentSessionId),
      input.ledger,
    );
  }
  return ledgerPath;
}

export function authorizeProjectCharacteristicsWebDiligence(input: {
  projectDirectory: string;
  projectId?: string;
  at?: string;
  workingDirectory?: string;
  parentSessionId?: string;
  sourceFiles?: ProjectCharacteristicsSourceHint[];
  data?: TenderDocumentAnalysisData;
}): ProjectCharacteristicsEvidenceLedger {
  const existing = resolveLiveProjectCharacteristicsEvidence({
    projectDirectory: input.projectDirectory,
    projectId: input.projectId,
    sourceFiles: input.sourceFiles,
    data: input.data,
  });
  const next: ProjectCharacteristicsEvidenceLedger = {
    ...existing,
    webDiligenceAuthorizedAt: input.at ?? new Date().toISOString(),
  };
  writeProjectCharacteristicsEvidenceLedger({
    projectDirectory: input.projectDirectory,
    ledger: next,
    workingDirectory: input.workingDirectory,
    parentSessionId: input.parentSessionId,
  });
  return next;
}

export function readRegisteredSourceHints(projectDirectory: string): ProjectCharacteristicsSourceHint[] {
  const boundaryPath = join(projectDirectory, 'source-boundary.json');
  if (!existsSync(boundaryPath)) return [];
  try {
    const parsed = JSON.parse(readFileSync(boundaryPath, 'utf8')) as {
      files?: ProjectCharacteristicsSourceHint[];
    };
    return Array.isArray(parsed.files) ? parsed.files : [];
  } catch {
    return [];
  }
}

export function readDocumentAnalysisDataForEvidence(projectDirectory: string): TenderDocumentAnalysisData {
  const packPath = join(projectDirectory, 'packs', 'document-analysis.json');
  if (!existsSync(packPath)) return { sections: [] };
  try {
    const envelope = JSON.parse(readFileSync(packPath, 'utf8')) as { data?: unknown };
    return parseTenderDocumentAnalysisData(envelope.data ?? envelope);
  } catch {
    return { sections: [] };
  }
}

export function resolveLiveProjectCharacteristicsEvidence(input: {
  projectDirectory: string;
  projectId?: string;
  sourceFiles?: ProjectCharacteristicsSourceHint[];
  data?: TenderDocumentAnalysisData;
  characteristicsPath?: string;
}): ProjectCharacteristicsEvidenceLedger {
  const previous = readProjectCharacteristicsEvidenceLedger(input.projectDirectory);
  return assessProjectCharacteristicsEvidence({
    projectId: input.projectId ?? previous?.projectId ?? 'unknown',
    data: input.data ?? readDocumentAnalysisDataForEvidence(input.projectDirectory),
    sourceFiles: input.sourceFiles ?? readRegisteredSourceHints(input.projectDirectory),
    characteristicsPath: input.characteristicsPath ?? previous?.characteristicsPath,
    webDiligenceAuthorizedAt: previous?.webDiligenceAuthorizedAt,
  });
}

export function buildProjectCharacteristicsEvidencePolicy(
  ledger: ProjectCharacteristicsEvidenceLedger,
): ProjectCharacteristicsEvidencePolicy {
  return {
    webDiligenceAuthorized: Boolean(ledger.webDiligenceAuthorizedAt),
    blocking: ledger.blockingGapCount > 0 && !ledger.webDiligenceAuthorizedAt,
    evidenceFileNames: ledger.evidenceFileNames,
    gaps: ledger.gaps,
    rule: PROJECT_CHARACTERISTICS_EVIDENCE_POLICY_RULE,
  };
}

export function toProjectCharacteristicsEvidenceDto(ledger: ProjectCharacteristicsEvidenceLedger): {
  blocking: boolean;
  webDiligenceAuthorized: boolean;
  evidenceFileNames: string[];
  gaps: Array<{
    chapterId: string;
    title: string;
    blocking: boolean;
    detail: string;
    suggestedUpload: string;
  }>;
} {
  return {
    blocking: ledger.blockingGapCount > 0 && !ledger.webDiligenceAuthorizedAt,
    webDiligenceAuthorized: Boolean(ledger.webDiligenceAuthorizedAt),
    evidenceFileNames: ledger.evidenceFileNames,
    gaps: ledger.gaps.map((gap) => ({
      chapterId: gap.chapterId,
      title: gap.title,
      blocking: gap.blocking,
      detail: gap.detail,
      suggestedUpload: gap.suggestedUpload,
    })),
  };
}

export function projectCharacteristicsEvidenceMissingItems(
  ledger: ProjectCharacteristicsEvidenceLedger | undefined,
): string[] {
  if (!ledger) return [];
  if (ledger.webDiligenceAuthorizedAt) return [];
  if (ledger.blockingGapCount <= 0) return [];
  return [PROJECT_CHARACTERISTICS_EVIDENCE_GATE];
}

function chapterHasContent(section: TenderDocumentAnalysisSection, chapterId: string): boolean {
  const pattern = CHAPTER_PATTERNS[chapterId];
  if (pattern?.test(blobOf(section))) return true;
  if (chapterId === 'contract' && section.kind === 'special_conditions') return true;
  if (chapterId === 'site' && section.kind === 'project_information') return true;
  return false;
}

function blobOf(section: TenderDocumentAnalysisSection): string {
  return `${section.title}\n${section.summary}\n${section.kind}`;
}

function atomicWriteJson(filePath: string, value: unknown): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  renameSync(temporary, filePath);
}
