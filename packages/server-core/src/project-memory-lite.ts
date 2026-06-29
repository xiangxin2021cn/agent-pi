import { open, mkdir, appendFile, writeFile } from 'fs/promises'
import { basename, dirname, extname, join } from 'path'
import type { ProjectMemoryContextEntry, SessionGoalAuditEvidence, SessionGoalAuditResult, SessionGoalState } from '@craft-agent/shared/sessions'
import { PROJECT_MEMORY_ENTRIES_FILE_NAME, getProjectBrainPath } from '@craft-agent/shared/sessions'
import { pathStartsWith } from '@craft-agent/shared/utils'

export interface ProjectMemoryLiteInitResult {
  brainPath: string
  directories: string[]
  files: string[]
}

export interface ProjectMemoryGoalAuditInput {
  workingDirectory: string
  sessionId: string
  goalState: SessionGoalState
  result: SessionGoalAuditResult
}

export interface ProjectMemoryFormalOutputInput {
  workingDirectory: string
  sessionId: string
  sourcePath?: string
  outputPath: string
  reason?: 'user_promoted' | 'formal_output'
  createdAt?: number
}

export interface ProjectMemoryLiteWriteResult {
  brainPath: string
  entriesPath: string
  entryCount: number
}

const PROJECT_MEMORY_SUBDIRECTORIES = ['sources', 'artifacts', 'outputs', 'outputs/reviews'] as const

const DECISIONS_TEMPLATE = [
  '# Project Decisions',
  '',
  'Use this file for concise, durable decisions tied to this working directory.',
  'Keep entries short and link them to source files, artifacts, or formal outputs when possible.',
  '',
].join('\n')

export async function ensureProjectMemoryLite(workingDirectory: string): Promise<ProjectMemoryLiteInitResult> {
  const brainPath = getProjectBrainPath(workingDirectory)
  if (!brainPath) {
    throw new Error('Cannot initialize project memory without a working directory.')
  }

  const directories = [
    brainPath,
    ...PROJECT_MEMORY_SUBDIRECTORIES.map(name => join(brainPath, name)),
  ]
  for (const directory of directories) {
    await mkdir(directory, { recursive: true })
  }

  const files = [
    await ensureFileIfMissing(join(brainPath, 'decisions.md'), DECISIONS_TEMPLATE),
    await ensureFileIfMissing(join(brainPath, PROJECT_MEMORY_ENTRIES_FILE_NAME), ''),
    await ensureFileIfMissing(join(brainPath, 'facts.jsonl'), ''),
    await ensureFileIfMissing(join(brainPath, 'citations.jsonl'), ''),
  ].filter((file): file is string => file !== undefined)

  return {
    brainPath,
    directories,
    files,
  }
}

export async function recordProjectMemoryGoalAudit(input: ProjectMemoryGoalAuditInput): Promise<void> {
  const { brainPath } = await ensureProjectMemoryLite(input.workingDirectory)
  const auditId = `${input.sessionId}:${input.goalState.id}:${input.result.iteration}`
  const documentQuality = parseDocumentQualityEvidence(input.result.evidence)
  const sourceEvidence = input.result.evidence
    .filter(isSourceEvidence)
    .map(evidenceToFileRecord)
    .filter((record): record is ProjectMemoryFileRecord => record !== undefined)
  const outputEvidence = input.result.evidence
    .filter(isOutputEvidence)
    .map(evidenceToFileRecord)
    .filter((record): record is ProjectMemoryFileRecord => record !== undefined)
  const formalOutputReviews = documentQuality
    ? await writeFormalOutputReviewReports({
        workingDirectory: input.workingDirectory,
        brainPath,
        auditId,
        sessionId: input.sessionId,
        goalState: input.goalState,
        result: input.result,
        documentQuality,
        sources: sourceEvidence,
        outputs: outputEvidence,
      })
    : []
  const reviewByOutputPath = new Map(formalOutputReviews.map(review => [review.outputPath, review]))
  const memoryEntries = extractProjectMemoryEntries(input, {
    reviewByOutputPath,
    documentQuality,
    sourceEvidence,
    outputEvidence,
  })

  await appendJsonl(join(brainPath, 'artifacts', 'goal-audits.jsonl'), {
    type: 'goal_audit',
    id: auditId,
    sessionId: input.sessionId,
    goalId: input.goalState.id,
    iteration: input.result.iteration,
    status: input.result.status,
    objective: input.goalState.objective,
    summary: input.result.summary,
    missingCriteria: input.result.missingCriteria,
    documentQuality,
    evidence: input.result.evidence.map(evidence => ({
      type: evidence.type,
      label: evidence.label,
      detail: evidence.detail,
    })),
    createdAt: input.result.createdAt,
  })
  await appendJsonl(join(brainPath, 'artifacts', 'events.jsonl'), {
    type: 'GoalAuditCompleted',
    id: auditId,
    sessionId: input.sessionId,
    goalId: input.goalState.id,
    iteration: input.result.iteration,
    status: input.result.status,
    createdAt: input.result.createdAt,
  })

  for (const source of sourceEvidence) {
    await appendJsonl(join(brainPath, 'sources', 'sources.jsonl'), {
      type: 'source_evidence',
      id: `${auditId}:source:${source.path}`,
      sessionId: input.sessionId,
      goalAuditId: auditId,
      path: source.path,
      name: basename(source.path),
      evidenceLabel: source.label,
      createdAt: input.result.createdAt,
    })
    await appendJsonl(join(brainPath, 'citations.jsonl'), {
      type: 'goal_audit_source',
      sourcePath: source.path,
      targetType: 'goal_audit',
      targetId: auditId,
      sessionId: input.sessionId,
      evidenceLabel: source.label,
      createdAt: input.result.createdAt,
    })
  }

  for (const output of outputEvidence) {
    const review = reviewByOutputPath.get(output.path)
    await appendJsonl(join(brainPath, 'outputs', 'outputs.jsonl'), {
      type: 'output_evidence',
      id: `${auditId}:output:${output.path}`,
      sessionId: input.sessionId,
      goalAuditId: auditId,
      path: output.path,
      name: basename(output.path),
      evidenceLabel: output.label,
      reviewPath: review?.reviewPath,
      createdAt: input.result.createdAt,
    })
    await appendJsonl(join(brainPath, 'artifacts', 'events.jsonl'), {
      type: 'ArtifactCreated',
      id: `${auditId}:artifact:${output.path}`,
      artifactType: 'formal_output',
      sessionId: input.sessionId,
      goalAuditId: auditId,
      path: output.path,
      sourcePaths: sourceEvidence.map(source => source.path),
      createdAt: input.result.createdAt,
    })
    await appendJsonl(join(brainPath, 'artifacts', 'events.jsonl'), {
      type: 'FormalOutputCreated',
      id: `${auditId}:formal-output:${output.path}`,
      sessionId: input.sessionId,
      goalAuditId: auditId,
      outputPath: output.path,
      reviewPath: review?.reviewPath,
      sourcePaths: sourceEvidence.map(source => source.path),
      createdAt: input.result.createdAt,
    })
  }

  if (documentQuality) {
    for (const review of formalOutputReviews) {
      await appendJsonl(join(brainPath, 'outputs', 'reviews.jsonl'), {
        type: 'formal_output_review',
        id: `${auditId}:review:${review.outputPath}`,
        sessionId: input.sessionId,
        goalAuditId: auditId,
        outputPath: review.outputPath,
        reviewPath: review.reviewPath,
        score: documentQuality.score,
        threshold: documentQuality.threshold,
        status: documentQuality.status,
        dimensions: documentQuality.dimensions,
        createdAt: input.result.createdAt,
      })
    }

    await appendJsonl(join(brainPath, 'facts.jsonl'), {
      type: 'document_quality_fact',
      subject: input.goalState.objective,
      predicate: 'document_quality_score',
      value: documentQuality.score,
      threshold: documentQuality.threshold,
      status: documentQuality.status,
      dimensions: documentQuality.dimensions,
      sessionId: input.sessionId,
      goalAuditId: auditId,
      createdAt: input.result.createdAt,
    })
  }

  await writeProjectMemoryLite(input.workingDirectory, memoryEntries)
}

export async function recordProjectMemoryFormalOutput(input: ProjectMemoryFormalOutputInput): Promise<void> {
  const { brainPath } = await ensureProjectMemoryLite(input.workingDirectory)
  const createdAt = input.createdAt ?? Date.now()
  const artifactId = `${input.sessionId}:formal-output:${input.outputPath}`

  await appendJsonl(join(brainPath, 'artifacts', 'events.jsonl'), {
    type: 'ArtifactCreated',
    id: artifactId,
    artifactType: input.reason ?? 'formal_output',
    sessionId: input.sessionId,
    path: input.outputPath,
    sourcePath: input.sourcePath,
    createdAt,
  })
  await appendJsonl(join(brainPath, 'artifacts', 'events.jsonl'), {
    type: 'FormalOutputCreated',
    id: artifactId,
    sessionId: input.sessionId,
    outputPath: input.outputPath,
    sourcePath: input.sourcePath,
    createdAt,
  })
  await appendJsonl(join(brainPath, 'outputs', 'outputs.jsonl'), {
    type: 'formal_output',
    id: artifactId,
    sessionId: input.sessionId,
    path: input.outputPath,
    name: basename(input.outputPath),
    sourcePath: input.sourcePath,
    createdAt,
  })

  await writeProjectMemoryLite(input.workingDirectory, [{
    type: 'formal_output_created',
    id: artifactId,
    title: basename(input.outputPath),
    summary: input.sourcePath
      ? 'User promoted a process artifact into the formal project output set.'
      : 'Formal project output was recorded.',
    trust: input.reason === 'user_promoted' ? 'user_promoted' : 'verified',
    sessionId: input.sessionId,
    outputPath: input.outputPath,
    path: input.outputPath,
    sourcePaths: input.sourcePath ? [input.sourcePath] : [],
    createdAt,
  }])
}

export function extractProjectMemoryEntries(
  input: ProjectMemoryGoalAuditInput,
  options: {
    reviewByOutputPath?: Map<string, FormalOutputReviewRecord>
    documentQuality?: ReturnType<typeof parseDocumentQualityEvidence>
    sourceEvidence?: ProjectMemoryFileRecord[]
    outputEvidence?: ProjectMemoryFileRecord[]
  } = {},
): ProjectMemoryContextEntry[] {
  const auditId = `${input.sessionId}:${input.goalState.id}:${input.result.iteration}`
  const documentQuality = options.documentQuality ?? parseDocumentQualityEvidence(input.result.evidence)
  const sourceEvidence = options.sourceEvidence ?? input.result.evidence
    .filter(isSourceEvidence)
    .map(evidenceToFileRecord)
    .filter((record): record is ProjectMemoryFileRecord => record !== undefined)
  const outputEvidence = options.outputEvidence ?? input.result.evidence
    .filter(isOutputEvidence)
    .map(evidenceToFileRecord)
    .filter((record): record is ProjectMemoryFileRecord => record !== undefined)
  const sourcePaths = sourceEvidence.map(source => source.path)
  const trust: ProjectMemoryContextEntry['trust'] = input.result.status === 'pass' && documentQuality?.status !== 'fail'
    ? 'verified'
    : 'needs_review'
  const outputPreviewByPath = new Map(
    input.result.evidence
      .filter(isOutputEvidence)
      .map(evidence => {
        const path = extractEvidencePath(evidence.detail)
        const preview = extractEvidencePreview(evidence.detail)
        return path && preview ? [path, preview] as const : undefined
      })
      .filter((item): item is readonly [string, string] => item !== undefined)
  )

  const entries: ProjectMemoryContextEntry[] = [{
    type: 'goal_audit_completed',
    id: auditId,
    title: input.goalState.objective,
    summary: input.result.summary,
    trust,
    status: input.result.status,
    sessionId: input.sessionId,
    goalAuditId: auditId,
    sourcePaths,
    missingCriteria: input.result.missingCriteria,
    createdAt: input.result.createdAt,
  }]

  for (const output of outputEvidence) {
    const review = options.reviewByOutputPath?.get(output.path)
    const preview = outputPreviewByPath.get(output.path)
    entries.push({
      type: 'formal_output_created',
      id: `${auditId}:output:${output.path}`,
      title: basename(output.path),
      summary: documentQuality
        ? `Formal output linked to goal audit; document quality ${documentQuality.status} (${documentQuality.score}/${documentQuality.threshold}).`
        : 'Formal output linked to goal audit.',
      trust,
      status: documentQuality?.status ?? input.result.status,
      sessionId: input.sessionId,
      goalAuditId: auditId,
      outputPath: output.path,
      path: output.path,
      reviewPath: review?.reviewPath,
      sourcePaths,
      missingCriteria: input.result.missingCriteria,
      createdAt: input.result.createdAt,
    })
    if (preview && sourcePaths.length > 0) {
      entries.push({
        type: 'source_backed_analysis',
        id: `${auditId}:analysis:${output.path}`,
        title: basename(output.path),
        summary: preview,
        trust,
        status: input.result.status,
        sessionId: input.sessionId,
        goalAuditId: auditId,
        outputPath: output.path,
        path: output.path,
        reviewPath: review?.reviewPath,
        sourcePaths,
        missingCriteria: input.result.missingCriteria,
        createdAt: input.result.createdAt,
      })
    }
  }

  for (const criterion of input.result.missingCriteria.slice(0, 10)) {
    entries.push({
      type: 'known_gap',
      id: `${auditId}:gap:${criterion.slice(0, 80)}`,
      title: input.goalState.objective,
      summary: criterion,
      trust: 'needs_review',
      status: input.result.status,
      sessionId: input.sessionId,
      goalAuditId: auditId,
      sourcePaths,
      createdAt: input.result.createdAt,
    })
  }

  return entries
}

export async function writeProjectMemoryLite(
  workingDirectory: string,
  entries: ProjectMemoryContextEntry[],
): Promise<ProjectMemoryLiteWriteResult | undefined> {
  if (entries.length === 0) return undefined
  const { brainPath } = await ensureProjectMemoryLite(workingDirectory)
  const entriesPath = join(brainPath, PROJECT_MEMORY_ENTRIES_FILE_NAME)
  for (const entry of entries) {
    await appendJsonl(entriesPath, entry)
  }
  return {
    brainPath,
    entriesPath,
    entryCount: entries.length,
  }
}

async function ensureFileIfMissing(filePath: string, content: string): Promise<string | undefined> {
  try {
    const handle = await open(filePath, 'wx')
    try {
      await handle.writeFile(content)
    } finally {
      await handle.close()
    }
    return filePath
  } catch (error) {
    if (isAlreadyExistsError(error)) return undefined
    throw error
  }
}

function isAlreadyExistsError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error as { code?: string }).code === 'EEXIST'
}

interface ProjectMemoryFileRecord {
  path: string
  label: string
}

interface FormalOutputReviewInput {
  workingDirectory: string
  brainPath: string
  auditId: string
  sessionId: string
  goalState: SessionGoalState
  result: SessionGoalAuditResult
  documentQuality: NonNullable<ReturnType<typeof parseDocumentQualityEvidence>>
  sources: ProjectMemoryFileRecord[]
  outputs: ProjectMemoryFileRecord[]
}

interface FormalOutputReviewRecord {
  outputPath: string
  reviewPath: string
}

function isSourceEvidence(evidence: SessionGoalAuditEvidence): boolean {
  return evidence.label === 'user_attachment' || evidence.label.startsWith('source_file_preview')
}

function isOutputEvidence(evidence: SessionGoalAuditEvidence): boolean {
  return evidence.label === 'file_preview' || evidence.label === 'file_preview_truncated'
}

function evidenceToFileRecord(evidence: SessionGoalAuditEvidence): ProjectMemoryFileRecord | undefined {
  const path = extractEvidencePath(evidence.detail)
  if (!path) return undefined
  return {
    path,
    label: evidence.label,
  }
}

function extractEvidencePath(detail: string | undefined): string | undefined {
  const firstLine = detail?.split('\n')[0]?.trim()
  if (!firstLine) return undefined
  return firstLine.replace(/\s+\(\d+\s+bytes\)$/i, '').trim() || undefined
}

function extractEvidencePreview(detail: string | undefined): string | undefined {
  const preview = detail
    ?.split('\n')
    .slice(1)
    .join('\n')
    .replace(/\s+/g, ' ')
    .trim()
  return preview ? preview.slice(0, 1200) : undefined
}

function parseDocumentQualityEvidence(evidence: SessionGoalAuditEvidence[]): {
  status: 'pass' | 'fail'
  score: number
  threshold: number
  dimensions?: Record<string, number>
} | undefined {
  const detail = evidence.find(item => item.label === 'document_quality_report')?.detail
  if (!detail) return undefined

  const status = detail.match(/^status:\s*(pass|fail)/m)?.[1] as 'pass' | 'fail' | undefined
  const scoreMatch = detail.match(/^score:\s*(\d+)\/(\d+)/m)
  if (!status || !scoreMatch) return undefined

  const dimensionsMatch = detail.match(/^dimensions:\s*structure=(\d+),\s*evidence=(\d+),\s*numbers=(\d+),\s*specification=(\d+),\s*risk=(\d+)/m)
  return {
    status,
    score: Number(scoreMatch[1]),
    threshold: Number(scoreMatch[2]),
    ...(dimensionsMatch ? {
      dimensions: {
        structure: Number(dimensionsMatch[1]),
        evidence: Number(dimensionsMatch[2]),
        numbers: Number(dimensionsMatch[3]),
        specification: Number(dimensionsMatch[4]),
        risk: Number(dimensionsMatch[5]),
      },
    } : {}),
  }
}

async function writeFormalOutputReviewReports(input: FormalOutputReviewInput): Promise<FormalOutputReviewRecord[]> {
  const reviews: FormalOutputReviewRecord[] = []
  for (const output of input.outputs) {
    if (!pathStartsWith(output.path, input.workingDirectory)) continue

    const reviewDir = join(dirname(output.path), '_reviews')
    await mkdir(reviewDir, { recursive: true })

    const reviewPath = join(reviewDir, `${sanitizeReviewFileName(output.path)}.review.md`)
    await writeFile(reviewPath, formatFormalOutputReview({ ...input, outputPath: output.path }), 'utf8')
    reviews.push({ outputPath: output.path, reviewPath })
  }
  return reviews
}

function formatFormalOutputReview(input: FormalOutputReviewInput & { outputPath: string }): string {
  const dq = input.documentQuality
  const dimensions = dq.dimensions ?? {}
  const issueLines = extractBulletSection(input.result.evidence, 'document_quality_report', 'issues')
  const strengthLines = extractBulletSection(input.result.evidence, 'document_quality_report', 'strengths')

  return [
    '# Document Expert Review',
    '',
    `- Output: ${input.outputPath}`,
    `- Goal: ${input.goalState.objective}`,
    `- Session: ${input.sessionId}`,
    `- Goal audit: ${input.auditId}`,
    `- Status: ${dq.status}`,
    `- Final score: ${dq.score}/${dq.threshold}`,
    '',
    '## Dimension Scores',
    '',
    `| Dimension | Score |`,
    `| --- | ---: |`,
    `| Structure | ${formatDimensionScore(dimensions.structure)} |`,
    `| Evidence | ${formatDimensionScore(dimensions.evidence)} |`,
    `| Numbers | ${formatDimensionScore(dimensions.numbers)} |`,
    `| Specification | ${formatDimensionScore(dimensions.specification)} |`,
    `| Risk | ${formatDimensionScore(dimensions.risk)} |`,
    '',
    '## Issues',
    '',
    ...(issueLines.length > 0 ? issueLines.map(line => `- ${line}`) : ['- None recorded.']),
    '',
    '## Strengths',
    '',
    ...(strengthLines.length > 0 ? strengthLines.map(line => `- ${line}`) : ['- None recorded.']),
    '',
    '## Source Evidence',
    '',
    ...(input.sources.length > 0
      ? input.sources.map(source => `- ${source.path}`)
      : ['- No source file evidence was captured for this audit.']),
    '',
  ].join('\n')
}

function sanitizeReviewFileName(filePath: string): string {
  const name = basename(filePath)
  const stem = name.slice(0, name.length - extname(name).length) || name
  return stem
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || 'output'
}

function formatDimensionScore(score: number | undefined): string {
  return typeof score === 'number' ? String(score) : 'n/a'
}

function extractBulletSection(evidence: SessionGoalAuditEvidence[], label: string, section: string): string[] {
  const detail = evidence.find(item => item.label === label)?.detail
  if (!detail) return []

  const lines = detail.split('\n')
  const start = lines.findIndex(line => line.trim().toLowerCase() === `${section}:`)
  if (start === -1) return []

  const items: string[] = []
  for (const line of lines.slice(start + 1)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    if (/^[a-z_ ]+:/i.test(trimmed)) break
    if (trimmed.startsWith('- ')) items.push(trimmed.slice(2).trim())
  }
  return items
}

async function appendJsonl(filePath: string, value: unknown): Promise<void> {
  await appendFile(filePath, `${JSON.stringify(value)}\n`, 'utf8')
}
