import { open, mkdir, appendFile, writeFile, readFile } from 'fs/promises'
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

export interface ProjectMemoryQualityTelemetryResetResult {
  brainPath: string
  factsPath: string
  removedCount: number
  retainedCount: number
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
  const qualityReviewerFacts = parseQualityReviewerEvidence(input.result.evidence)
  const qualityRouteFacts = parseQualityRouteEvidence(input.result.evidence)
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
    failureCategories: input.result.failureCategories,
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
    failureCategories: input.result.failureCategories,
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
      failureCategories: input.result.failureCategories,
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
      failureCategories: input.result.failureCategories,
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

  for (const reviewerFact of qualityReviewerFacts) {
    await appendJsonl(join(brainPath, 'facts.jsonl'), {
      type: 'quality_reviewer_fact',
      role: reviewerFact.role,
      model: reviewerFact.model,
      requestedModel: reviewerFact.requestedModel,
      fallbackModel: reviewerFact.fallbackModel,
      status: reviewerFact.status,
      taskType: input.goalState.taskContract?.taskType,
      failureCategories: reviewerFact.failureCategories,
      latencyMs: reviewerFact.latencyMs,
      inputTokens: reviewerFact.inputTokens,
      outputTokens: reviewerFact.outputTokens,
      summary: reviewerFact.summary,
      sessionId: input.sessionId,
      goalAuditId: auditId,
      createdAt: input.result.createdAt,
    })
  }

  for (const routeFact of qualityRouteFacts) {
    await appendJsonl(join(brainPath, 'facts.jsonl'), {
      type: 'quality_route_fact',
      taskType: routeFact.taskType ?? input.goalState.taskContract?.taskType,
      status: input.result.status,
      roles: routeFact.roles,
      modelAssignments: routeFact.modelAssignments,
      telemetryRoles: routeFact.telemetryRoles,
      commonGaps: routeFact.commonGaps,
      failureCategories: input.result.failureCategories,
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
    failureCategories: input.result.failureCategories,
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
      failureCategories: input.result.failureCategories,
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
        failureCategories: input.result.failureCategories,
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
      failureCategories: input.result.failureCategories,
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

export async function loadProjectMemoryReviewerPerformanceSummary(
  workingDirectory: string | undefined,
  limit = 8,
): Promise<string | undefined> {
  const brainPath = workingDirectory ? getProjectBrainPath(workingDirectory) : undefined
  if (!brainPath || limit <= 0) return undefined

  let content: string
  try {
    content = await readFile(join(brainPath, 'facts.jsonl'), 'utf8')
  } catch {
    return undefined
  }

  const reviewerFacts = content
    .split('\n')
    .map(line => parseQualityReviewerFactLine(line))
    .filter((fact): fact is ProjectMemoryQualityReviewerFact => fact !== undefined)
    .slice(-limit)
  const routeFacts = content
    .split('\n')
    .map(line => parseQualityRouteFactLine(line))
    .filter((fact): fact is ProjectMemoryQualityRouteFact => fact !== undefined)
    .slice(-limit)

  if (reviewerFacts.length === 0 && routeFacts.length === 0) return undefined

  const sections: string[] = []
  if (reviewerFacts.length > 0) {
    sections.push(
      'Reviewer performance aggregates:',
      formatQualityReviewerAggregateSummary(reviewerFacts),
      '',
      'Recent reviewer facts:',
      reviewerFacts.map(formatQualityReviewerFactSummary).join('\n'),
    )
  }
  if (routeFacts.length > 0) {
    if (sections.length > 0) sections.push('')
    sections.push(
      'Quality route outcome aggregates:',
      formatQualityRouteAggregateSummary(routeFacts),
    )
  }

  return sections.join('\n')
}

export async function resetProjectMemoryQualityTelemetry(
  workingDirectory: string,
): Promise<ProjectMemoryQualityTelemetryResetResult> {
  const { brainPath } = await ensureProjectMemoryLite(workingDirectory)
  const factsPath = join(brainPath, 'facts.jsonl')
  const content = await readFile(factsPath, 'utf8')
  const retainedLines: string[] = []
  let removedCount = 0

  for (const line of content.split('\n')) {
    if (!line.trim()) continue
    if (isProjectMemoryQualityTelemetryLine(line)) {
      removedCount += 1
    } else {
      retainedLines.push(line)
    }
  }

  await writeFile(factsPath, retainedLines.length > 0 ? `${retainedLines.join('\n')}\n` : '', 'utf8')
  return {
    brainPath,
    factsPath,
    removedCount,
    retainedCount: retainedLines.length,
  }
}

function isProjectMemoryQualityTelemetryLine(line: string): boolean {
  try {
    const parsed = JSON.parse(line) as { type?: unknown }
    return parsed.type === 'quality_reviewer_fact' || parsed.type === 'quality_route_fact'
  } catch {
    return false
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

interface ProjectMemoryQualityReviewerFact {
  type: 'quality_reviewer_fact'
  role?: string
  model?: string
  requestedModel?: string
  fallbackModel?: boolean
  status?: string
  taskType?: string
  failureCategories?: unknown
  latencyMs?: unknown
  inputTokens?: unknown
  outputTokens?: unknown
  summary?: string
}

interface ProjectMemoryQualityRouteFact {
  type: 'quality_route_fact'
  taskType?: string
  status?: string
  roles?: unknown
  modelAssignments?: unknown
  telemetryRoles?: unknown
  commonGaps?: unknown
  failureCategories?: unknown
}

function parseQualityReviewerFactLine(line: string): ProjectMemoryQualityReviewerFact | undefined {
  const trimmed = line.trim()
  if (!trimmed) return undefined

  try {
    const parsed = JSON.parse(trimmed) as ProjectMemoryQualityReviewerFact
    return parsed?.type === 'quality_reviewer_fact' ? parsed : undefined
  } catch {
    return undefined
  }
}

function parseQualityRouteFactLine(line: string): ProjectMemoryQualityRouteFact | undefined {
  const trimmed = line.trim()
  if (!trimmed) return undefined

  try {
    const parsed = JSON.parse(trimmed) as ProjectMemoryQualityRouteFact
    return parsed?.type === 'quality_route_fact' ? parsed : undefined
  } catch {
    return undefined
  }
}

function formatQualityReviewerFactSummary(fact: ProjectMemoryQualityReviewerFact): string {
  const role = typeof fact.role === 'string' && fact.role.trim() ? fact.role.trim() : 'unknown_role'
  const model = typeof fact.model === 'string' && fact.model.trim() ? ` via ${fact.model.trim()}` : ''
  const requestedModel = typeof fact.requestedModel === 'string' && fact.requestedModel.trim()
    ? ` requested=${fact.requestedModel.trim()}`
    : ''
  const fallback = fact.fallbackModel === true ? ' fallback=true' : ''
  const status = typeof fact.status === 'string' && fact.status.trim() ? fact.status.trim() : 'unknown'
  const taskType = typeof fact.taskType === 'string' && fact.taskType.trim()
    ? ` task=${fact.taskType.trim()}`
    : ''
  const categories = Array.isArray(fact.failureCategories)
    ? fact.failureCategories.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).join(',')
    : ''
  const latency = typeof fact.latencyMs === 'number' && Number.isFinite(fact.latencyMs)
    ? ` latency=${fact.latencyMs}ms`
    : ''
  const tokens = typeof fact.inputTokens === 'number' && typeof fact.outputTokens === 'number'
    ? ` tokens=${fact.inputTokens}/${fact.outputTokens}`
    : ''
  const summary = typeof fact.summary === 'string' && fact.summary.trim()
    ? ` - ${fact.summary.replace(/\s+/g, ' ').trim().slice(0, 300)}`
    : ''

  return `${role}${model}: ${status}${requestedModel}${fallback}${taskType}${categories ? ` ${categories}` : ''}${latency}${tokens}${summary}`
}

function formatQualityReviewerAggregateSummary(facts: ProjectMemoryQualityReviewerFact[]): string {
  const groups = new Map<string, {
    taskType: string
    role: string
    total: number
    pass: number
    fail: number
    uncertain: number
    fallbackCount: number
    gapCounts: Map<string, number>
    latencyTotal: number
    latencyCount: number
  }>()

  for (const fact of facts) {
    const taskType = normalizeQualityReviewerText(fact.taskType, 'unknown')
    const role = normalizeQualityReviewerText(fact.role, 'unknown_role')
    const key = `${taskType}\u0000${role}`
    const group = groups.get(key) ?? {
      taskType,
      role,
      total: 0,
      pass: 0,
      fail: 0,
      uncertain: 0,
      fallbackCount: 0,
      gapCounts: new Map<string, number>(),
      latencyTotal: 0,
      latencyCount: 0,
    }

    group.total += 1
    const status = normalizeQualityReviewerStatus(fact.status)
    if (status === 'pass') group.pass += 1
    else if (status === 'fail') group.fail += 1
    else group.uncertain += 1
    if (fact.fallbackModel === true) group.fallbackCount += 1

    for (const category of getQualityReviewerFailureCategories(fact)) {
      group.gapCounts.set(category, (group.gapCounts.get(category) ?? 0) + 1)
    }

    if (typeof fact.latencyMs === 'number' && Number.isFinite(fact.latencyMs)) {
      group.latencyTotal += fact.latencyMs
      group.latencyCount += 1
    }

    groups.set(key, group)
  }

  return [...groups.values()]
    .sort((left, right) => left.taskType.localeCompare(right.taskType) || left.role.localeCompare(right.role))
    .map(group => {
      const commonGaps = [...group.gapCounts.entries()]
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
        .slice(0, 3)
        .map(([category]) => category)
      const gaps = commonGaps.length > 0 ? ` common_gaps=${commonGaps.join(',')}` : ''
      const fallbacks = group.fallbackCount > 0 ? ` fallbacks=${group.fallbackCount}` : ''
      const latency = group.latencyCount > 0
        ? ` avg_latency=${Math.round(group.latencyTotal / group.latencyCount)}ms`
        : ''

      return `task=${group.taskType} role=${group.role} total=${group.total} pass=${group.pass} fail=${group.fail} uncertain=${group.uncertain}${fallbacks}${gaps}${latency}`
    })
    .join('\n')
}

function formatQualityRouteAggregateSummary(facts: ProjectMemoryQualityRouteFact[]): string {
  const groups = new Map<string, {
    taskType: string
    roles: string[]
    models: string
    total: number
    pass: number
    fail: number
    uncertain: number
    gapCounts: Map<string, number>
  }>()

  for (const fact of facts) {
    const taskType = normalizeQualityReviewerText(fact.taskType, 'unknown')
    const roles = getQualityRouteStringArray(fact.roles)
    const models = formatQualityRouteModels(fact.modelAssignments)
    const key = `${taskType}\u0000${roles.join(',')}\u0000${models}`
    const group = groups.get(key) ?? {
      taskType,
      roles,
      models,
      total: 0,
      pass: 0,
      fail: 0,
      uncertain: 0,
      gapCounts: new Map<string, number>(),
    }

    group.total += 1
    const status = normalizeQualityReviewerStatus(fact.status)
    if (status === 'pass') group.pass += 1
    else if (status === 'fail') group.fail += 1
    else group.uncertain += 1

    for (const category of [
      ...getQualityRouteStringArray(fact.commonGaps),
      ...getQualityRouteStringArray(fact.failureCategories),
    ]) {
      group.gapCounts.set(category, (group.gapCounts.get(category) ?? 0) + 1)
    }

    groups.set(key, group)
  }

  return [...groups.values()]
    .sort((left, right) => left.taskType.localeCompare(right.taskType) || left.roles.join(',').localeCompare(right.roles.join(',')))
    .map(group => {
      const commonGaps = [...group.gapCounts.entries()]
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
        .slice(0, 3)
        .map(([category]) => category)
      const roles = group.roles.length > 0 ? ` roles=${group.roles.join(',')}` : ''
      const models = group.models ? ` models=${group.models}` : ''
      const gaps = commonGaps.length > 0 ? ` common_gaps=${commonGaps.join(',')}` : ''

      return `task=${group.taskType} total=${group.total} pass=${group.pass} fail=${group.fail} uncertain=${group.uncertain}${roles}${models}${gaps}`
    })
    .join('\n')
}

function getQualityRouteStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : []
}

function formatQualityRouteModels(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ''
  return Object.entries(value)
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[0].trim().length > 0 && entry[1].trim().length > 0)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([role, model]) => `${role.trim()}:${model.trim()}`)
    .join(',')
}

function normalizeQualityReviewerText(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function normalizeQualityReviewerStatus(value: unknown): 'pass' | 'fail' | 'uncertain' {
  const status = normalizeQualityReviewerText(value, 'uncertain').toLowerCase()
  if (status === 'pass') return 'pass'
  if (status === 'fail') return 'fail'
  return 'uncertain'
}

function getQualityReviewerFailureCategories(fact: ProjectMemoryQualityReviewerFact): string[] {
  return Array.isArray(fact.failureCategories)
    ? fact.failureCategories.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : []
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

interface QualityReviewerFact {
  role: string
  model?: string
  requestedModel?: string
  fallbackModel?: boolean
  status?: string
  failureCategories?: string[]
  latencyMs?: number
  inputTokens?: number
  outputTokens?: number
  summary?: string
}

interface QualityRouteFact {
  taskType?: string
  roles: string[]
  modelAssignments: Record<string, string>
  telemetryRoles: string[]
  commonGaps: string[]
}

function parseQualityReviewerEvidence(evidence: SessionGoalAuditEvidence[]): QualityReviewerFact[] {
  return evidence
    .filter(item => item.label.startsWith('quality_role_'))
    .map(item => parseQualityReviewerFact(item))
    .filter((fact): fact is QualityReviewerFact => fact !== undefined)
}

function parseQualityReviewerFact(evidence: SessionGoalAuditEvidence): QualityReviewerFact | undefined {
  const role = evidence.label.slice('quality_role_'.length)
  if (!role) return undefined

  const fields = parseEvidenceDetailFields(evidence.detail)
  const latencyMs = parseOptionalNumber(fields.get('latency_ms'))
  const inputTokens = parseOptionalNumber(fields.get('input_tokens'))
  const outputTokens = parseOptionalNumber(fields.get('output_tokens'))
  const categories = fields.get('categories')
    ?.split(',')
    .map(category => category.trim())
    .filter(Boolean)

  return {
    role,
    model: fields.get('model'),
    requestedModel: fields.get('requested_model'),
    fallbackModel: fields.get('fallback_model') === 'true' ? true : undefined,
    status: fields.get('status'),
    failureCategories: categories && categories.length > 0 ? categories : undefined,
    latencyMs,
    inputTokens,
    outputTokens,
    summary: fields.get('summary'),
  }
}

function parseQualityRouteEvidence(evidence: SessionGoalAuditEvidence[]): QualityRouteFact[] {
  return evidence
    .filter(item => item.label === 'quality_route')
    .map(item => parseQualityRouteFact(item))
    .filter((fact): fact is QualityRouteFact => fact !== undefined)
}

function parseQualityRouteFact(evidence: SessionGoalAuditEvidence): QualityRouteFact | undefined {
  const fields = parseEvidenceDetailFields(evidence.detail)
  const roles = parseCommaList(fields.get('roles'))
  if (roles.length === 0) return undefined

  return {
    taskType: normalizeOptionalRouteField(fields.get('task')),
    roles,
    modelAssignments: parseRouteModelAssignments(fields.get('models')),
    telemetryRoles: parseCommaList(fields.get('telemetry_roles')).filter(value => value !== 'none'),
    commonGaps: parseCommaList(fields.get('common_gaps')).filter(value => value !== 'none'),
  }
}

function parseCommaList(value: string | undefined): string[] {
  return value
    ?.split(',')
    .map(item => item.trim())
    .filter(Boolean) ?? []
}

function normalizeOptionalRouteField(value: string | undefined): string | undefined {
  const normalized = value?.trim()
  return normalized && normalized !== 'unknown' && normalized !== 'none' ? normalized : undefined
}

function parseRouteModelAssignments(value: string | undefined): Record<string, string> {
  const assignments: Record<string, string> = {}
  for (const item of parseCommaList(value)) {
    if (item === 'none') continue
    const index = item.indexOf(':')
    if (index <= 0) continue
    const role = item.slice(0, index).trim()
    const model = item.slice(index + 1).trim()
    if (role && model) assignments[role] = model
  }
  return assignments
}

function parseEvidenceDetailFields(detail: string | undefined): Map<string, string> {
  const fields = new Map<string, string>()
  for (const segment of detail?.split(';') ?? []) {
    const index = segment.indexOf('=')
    if (index <= 0) continue

    const key = segment.slice(0, index).trim()
    const value = segment.slice(index + 1).trim()
    if (key && value) fields.set(key, value)
  }
  return fields
}

function parseOptionalNumber(value: string | undefined): number | undefined {
  if (!value) return undefined
  const number = Number(value)
  return Number.isFinite(number) ? number : undefined
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
