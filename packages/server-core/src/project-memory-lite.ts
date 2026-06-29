import { execFile } from 'child_process'
import { existsSync, readdirSync } from 'fs'
import { open, mkdir, appendFile, writeFile } from 'fs/promises'
import { basename, delimiter, dirname, extname, join } from 'path'
import type { ProjectMemoryContextEntry, SessionGoalAuditEvidence, SessionGoalAuditResult, SessionGoalState } from '@craft-agent/shared/sessions'
import { PROJECT_MEMORY_ENTRIES_FILE_NAME, getProjectBrainPath } from '@craft-agent/shared/sessions'
import { pathStartsWith } from '@craft-agent/shared/utils'
import type { WorkspaceProjectMemoryConfig } from '@craft-agent/shared/workspaces'
import { getProjectGbrainContext } from './project-gbrain-source'

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
  projectMemory?: WorkspaceProjectMemoryConfig
}

export interface ProjectMemoryFormalOutputInput {
  workingDirectory: string
  sessionId: string
  sourcePath?: string
  outputPath: string
  reason?: 'user_promoted' | 'formal_output'
  createdAt?: number
  projectMemory?: WorkspaceProjectMemoryConfig
}

export interface ProjectMemoryGbrainSyncResult {
  status: 'prepared' | 'imported' | 'failed'
  syncPath: string
  markdownPath: string
  manifestPath: string
  entryCount: number
  importAttempt?: ProjectMemoryGbrainImportAttempt
}

export interface ProjectMemoryGbrainImportAttempt {
  enabled: boolean
  command?: string
  status: 'skipped' | 'doctor_failed' | 'import_failed' | 'imported'
  reason?: string
  stdout?: string
  stderr?: string
  maintenance?: ProjectMemoryGbrainMaintenanceAttempt
}

export interface ProjectMemoryGbrainMaintenanceAttempt {
  links?: ProjectGbrainCommandStatus
  facts?: ProjectGbrainCommandStatus
  embeddings?: ProjectGbrainCommandStatus
}

export interface ProjectMemoryGbrainSyncOptions {
  projectMemory?: WorkspaceProjectMemoryConfig
  runGbrainCommand?: GbrainCommandRunner
  ensurePostgresDatabase?: PostgresDatabaseEnsurer
  timeoutMs?: number
}

export type ProjectGbrainRuntimeStatusValue =
  | 'disabled'
  | 'missing_working_directory'
  | 'remote_configured'
  | 'ready'
  | 'needs_init'
  | 'unavailable'
  | 'error'

export interface ProjectGbrainCommandStatus {
  command: string
  ok: boolean
  stdout?: string
  stderr?: string
  code?: number | string
}

export interface ProjectGbrainRuntimeStatus {
  enabled: boolean
  backend: 'local_pglite' | 'local_postgres' | 'remote_mcp'
  status: ProjectGbrainRuntimeStatusValue
  canInitialize: boolean
  message: string
  workingDirectory?: string
  projectBrainPath?: string
  projectGbrainPath?: string
  namespace?: string
  doctor?: ProjectGbrainCommandStatus
}

export interface ProjectGbrainInitializeResult extends ProjectGbrainRuntimeStatus {
  initialized: boolean
  init?: ProjectGbrainCommandStatus
}

export type GbrainCommandRunner = (
  args: string[],
  context: {
    workingDirectory: string
    gbrainHome: string
    namespace: string
    databaseUrl?: string
    databaseName?: string
    timeoutMs: number
  },
) => Promise<GbrainCommandResult>

export type PostgresDatabaseEnsurer = (
  context: {
    databaseUrl: string
    databaseName: string
    timeoutMs: number
  },
) => Promise<ProjectGbrainCommandStatus>

export interface GbrainCommandResult {
  ok: boolean
  stdout: string
  stderr: string
  code?: number | string
}

const PROJECT_MEMORY_SUBDIRECTORIES = ['sources', 'artifacts', 'outputs', 'outputs/reviews', 'gbrain'] as const

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

export async function getProjectGbrainRuntimeStatus(
  workingDirectory: string | undefined,
  projectMemory: WorkspaceProjectMemoryConfig | undefined,
  options: ProjectMemoryGbrainSyncOptions = {},
): Promise<ProjectGbrainRuntimeStatus> {
  const gbrain = projectMemory?.gbrain
  const backend = gbrain?.backend ?? 'local_pglite'
  if (!gbrain?.enabled) {
    return {
      enabled: false,
      backend,
      status: 'disabled',
      canInitialize: false,
      message: 'Project gbrain is disabled for this workspace.',
    }
  }
  if (!workingDirectory) {
    return {
      enabled: true,
      backend,
      status: 'missing_working_directory',
      canInitialize: false,
      message: 'Select a working directory before enabling project gbrain memory.',
    }
  }
  if (backend === 'local_postgres' && !gbrain.postgresUrl?.trim()) {
    return {
      enabled: true,
      backend,
      status: 'error',
      canInitialize: false,
      message: 'PostgreSQL connection URL is required for local Postgres project gbrain.',
      workingDirectory,
    }
  }
  if (backend === 'remote_mcp') {
    return {
      enabled: true,
      backend,
      status: gbrain.remoteMcpUrl?.trim() ? 'remote_configured' : 'error',
      canInitialize: false,
      message: gbrain.remoteMcpUrl?.trim()
        ? 'Remote gbrain MCP is configured. Agent Pi will send the project namespace at runtime.'
        : 'Remote gbrain MCP URL is required.',
      workingDirectory,
    }
  }

  const { brainPath } = await ensureProjectMemoryLite(workingDirectory)
  const context = getProjectGbrainContext(workingDirectory, projectMemory)
  if (!context) {
    return {
      enabled: true,
      backend,
      status: 'error',
      canInitialize: false,
      message: 'Project gbrain context is unavailable for this working directory.',
      workingDirectory,
      projectBrainPath: brainPath,
    }
  }

  await mkdir(context.projectGbrainPath, { recursive: true })
  const runner = options.runGbrainCommand ?? runGbrainCommand
  const timeoutMs = options.timeoutMs ?? 30_000
  const commandContext = {
    workingDirectory,
    gbrainHome: context.projectGbrainPath,
    namespace: context.namespace,
    databaseUrl: backend === 'local_postgres' ? context.postgresDatabaseUrl : undefined,
    databaseName: backend === 'local_postgres' ? context.postgresDatabaseName : undefined,
    timeoutMs,
  }
  const doctorResult = await runner(['doctor', '--json'], commandContext)
  const doctor = toCommandStatus('gbrain doctor --json', doctorResult)
  const doctorReady = isGbrainDoctorRuntimeReady(doctorResult)
  if (doctorReady) {
    return {
      enabled: true,
      backend,
      status: 'ready',
      canInitialize: false,
      message: doctorResult.ok
        ? 'Project gbrain is ready for this working directory.'
        : 'Project gbrain database is ready; doctor reported non-blocking warnings.',
      workingDirectory,
      projectBrainPath: brainPath,
      projectGbrainPath: context.projectGbrainPath,
      namespace: context.namespace,
      doctor,
    }
  }

  const unavailable = isGbrainCommandUnavailable(doctorResult)
  return {
    enabled: true,
    backend,
    status: unavailable ? 'unavailable' : 'needs_init',
    canInitialize: !unavailable,
    message: unavailable
      ? 'gbrain command is not available on PATH. Install or bundle gbrain before enabling the advanced backend.'
      : 'Project gbrain local store is not initialized for this working directory.',
    workingDirectory,
    projectBrainPath: brainPath,
    projectGbrainPath: context.projectGbrainPath,
    namespace: context.namespace,
    doctor,
  }
}

export async function initializeProjectGbrainRuntime(
  workingDirectory: string | undefined,
  projectMemory: WorkspaceProjectMemoryConfig | undefined,
  options: ProjectMemoryGbrainSyncOptions = {},
): Promise<ProjectGbrainInitializeResult> {
  const gbrain = projectMemory?.gbrain
  const context = getProjectGbrainContext(workingDirectory, projectMemory)
  const databaseUrl = gbrain?.backend === 'local_postgres' ? context?.postgresDatabaseUrl : undefined
  const databaseName = gbrain?.backend === 'local_postgres' ? context?.postgresDatabaseName : undefined
  if (gbrain?.enabled && gbrain.backend === 'local_postgres') {
    if (!workingDirectory || !context || !databaseUrl || !databaseName) {
      return {
        enabled: true,
        backend: 'local_postgres',
        status: workingDirectory ? 'error' : 'missing_working_directory',
        canInitialize: false,
        initialized: false,
        message: workingDirectory
          ? 'Project gbrain PostgreSQL database URL could not be derived for this working directory.'
          : 'Select a working directory before enabling project gbrain memory.',
        ...(workingDirectory ? { workingDirectory } : {}),
      }
    }
    const ensurePostgresDatabase = options.ensurePostgresDatabase ?? ensurePostgresProjectDatabase
    const ensureResult = await ensurePostgresDatabase({
      databaseUrl,
      databaseName,
      timeoutMs: options.timeoutMs ?? 120_000,
    })
    if (!ensureResult.ok) {
      return {
        enabled: true,
        backend: 'local_postgres',
        status: 'error',
        canInitialize: true,
        initialized: false,
        message: 'Failed to prepare the project-specific PostgreSQL gbrain database.',
        workingDirectory,
        projectBrainPath: context.projectBrainPath,
        projectGbrainPath: context.projectGbrainPath,
        namespace: context.namespace,
        init: ensureResult,
      }
    }
  }

  const status = await getProjectGbrainRuntimeStatus(workingDirectory, projectMemory, options)
  if (status.status === 'ready' && workingDirectory && status.namespace && status.projectGbrainPath) {
    const source = await ensureProjectGbrainSourceRegistered(workingDirectory, status.projectGbrainPath, status.namespace, {
      runGbrainCommand: options.runGbrainCommand,
      timeoutMs: options.timeoutMs,
      databaseUrl,
      databaseName,
    })
    if (!source.ok) {
      return {
        ...status,
        status: 'error',
        canInitialize: true,
        initialized: false,
        message: 'Project gbrain database is ready, but the working-directory source could not be registered.',
        init: source,
      }
    }
  }
  if (!status.canInitialize || !workingDirectory || !status.namespace || !status.projectGbrainPath) {
    return {
      ...status,
      initialized: status.status === 'ready',
    }
  }

  const runner = options.runGbrainCommand ?? runGbrainCommand
  const timeoutMs = options.timeoutMs ?? 120_000
  const initArgs = gbrain?.backend === 'local_postgres' && databaseUrl
    ? ['init', '--url', databaseUrl, '--no-embedding']
    : ['init', '--pglite', '--no-embedding']
  const initResult = await runner(initArgs, {
    workingDirectory,
    gbrainHome: status.projectGbrainPath,
    namespace: status.namespace,
    databaseUrl,
    databaseName,
    timeoutMs,
  })
  const init = toCommandStatus(formatGbrainCommand(initArgs), initResult)
  if (!initResult.ok) {
    return {
      ...status,
      status: 'error',
      canInitialize: true,
      initialized: false,
      message: 'Failed to initialize the project gbrain local store.',
      init,
    }
  }

  const nextStatus = await getProjectGbrainRuntimeStatus(workingDirectory, projectMemory, options)
  if (nextStatus.status === 'ready') {
    await ensureProjectGbrainSourceRegistered(workingDirectory, nextStatus.projectGbrainPath, nextStatus.namespace, {
      runGbrainCommand: options.runGbrainCommand,
      timeoutMs: options.timeoutMs,
      databaseUrl,
      databaseName,
    })
  }
  return {
    ...nextStatus,
    initialized: nextStatus.status === 'ready',
    init,
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

  await writeProjectMemoryLite(input.workingDirectory, memoryEntries, {
    projectMemory: input.projectMemory,
  })
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
  }], {
    projectMemory: input.projectMemory,
  })
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
  options: ProjectMemoryGbrainSyncOptions = {},
): Promise<ProjectMemoryGbrainSyncResult | undefined> {
  if (entries.length === 0) return undefined
  const { brainPath } = await ensureProjectMemoryLite(workingDirectory)
  for (const entry of entries) {
    await appendJsonl(join(brainPath, PROJECT_MEMORY_ENTRIES_FILE_NAME), entry)
  }
  return syncProjectMemoryToGbrain(workingDirectory, entries, options)
}

export async function syncProjectMemoryToGbrain(
  workingDirectory: string,
  entries: ProjectMemoryContextEntry[],
  options: ProjectMemoryGbrainSyncOptions = {},
): Promise<ProjectMemoryGbrainSyncResult> {
  const { brainPath } = await ensureProjectMemoryLite(workingDirectory)
  const syncPath = join(brainPath, 'gbrain', 'project-memory-sync.jsonl')
  const markdownPath = join(brainPath, 'gbrain', 'project-memory-sync.md')
  const manifestPath = join(brainPath, 'gbrain', 'sync-manifest.json')
  for (const entry of entries) {
    await appendJsonl(syncPath, entry)
  }
  await appendFile(markdownPath, `${entries.map(formatGbrainMarkdownEntry).join('\n\n')}\n\n`, 'utf8')
  const importAttempt = await maybeImportProjectMemoryToGbrain(workingDirectory, brainPath, options)
  const status: ProjectMemoryGbrainSyncResult['status'] = importAttempt.status === 'imported'
    ? 'imported'
    : importAttempt.status === 'doctor_failed' || importAttempt.status === 'import_failed'
    ? 'failed'
    : 'prepared'
  await writeFile(manifestPath, JSON.stringify({
    status,
    syncPath,
    markdownPath,
    entryCount: entries.length,
    updatedAt: Date.now(),
    importAttempt,
    note: status === 'imported'
      ? 'Imported Project Memory Lite feed into the working-directory scoped local gbrain backend.'
      : 'Prepared Project Memory Lite entries for the project gbrain backend. Import the Markdown feed only within this working-directory scoped brain/source.',
  }, null, 2), 'utf8')
  return {
    status,
    syncPath,
    markdownPath,
    manifestPath,
    entryCount: entries.length,
    importAttempt,
  }
}

async function maybeImportProjectMemoryToGbrain(
  workingDirectory: string,
  brainPath: string,
  options: ProjectMemoryGbrainSyncOptions,
): Promise<ProjectMemoryGbrainImportAttempt> {
  const gbrain = options.projectMemory?.gbrain
  if (!gbrain?.enabled) {
    return {
      enabled: false,
      status: 'skipped',
      reason: 'Project gbrain backend is disabled.',
    }
  }
  const backend = gbrain.backend ?? 'local_pglite'
  if (backend === 'remote_mcp') {
    return {
      enabled: true,
      status: 'skipped',
      reason: 'Remote MCP gbrain sync is prepared as files; remote import must be performed by the remote service.',
    }
  }
  if (backend === 'local_postgres' && !gbrain.postgresUrl?.trim()) {
    return {
      enabled: true,
      status: 'skipped',
      reason: 'PostgreSQL connection URL is required for local Postgres gbrain sync.',
    }
  }

  const context = getProjectGbrainContext(workingDirectory, options.projectMemory)
  if (!context) {
    return {
      enabled: true,
      status: 'skipped',
      reason: 'Project gbrain context is unavailable for this working directory.',
    }
  }

  const runner = options.runGbrainCommand ?? runGbrainCommand
  const timeoutMs = options.timeoutMs ?? 60_000
  const commandContext = {
    workingDirectory,
    gbrainHome: context.projectGbrainPath,
    namespace: context.namespace,
    databaseUrl: backend === 'local_postgres' ? context.postgresDatabaseUrl : undefined,
    databaseName: backend === 'local_postgres' ? context.postgresDatabaseName : undefined,
    timeoutMs,
  }

  if (backend === 'local_postgres') {
    if (!commandContext.databaseUrl || !commandContext.databaseName) {
      return {
        enabled: true,
        status: 'import_failed',
        reason: 'Project gbrain PostgreSQL database URL could not be derived for this working directory.',
      }
    }
    const ensurePostgresDatabase = options.ensurePostgresDatabase ?? ensurePostgresProjectDatabase
    const ensured = await ensurePostgresDatabase({
      databaseUrl: commandContext.databaseUrl,
      databaseName: commandContext.databaseName,
      timeoutMs,
    })
    if (!ensured.ok) {
      return {
        enabled: true,
        command: ensured.command,
        status: 'import_failed',
        reason: 'Failed to prepare the project-specific PostgreSQL gbrain database.',
        stdout: ensured.stdout,
        stderr: ensured.stderr,
      }
    }
  }

  const doctor = await runner(['doctor', '--json'], commandContext)
  if (!isGbrainDoctorRuntimeReady(doctor)) {
    return {
      enabled: true,
      command: 'gbrain doctor --json',
      status: 'doctor_failed',
      reason: 'gbrain doctor failed. Run gbrain init --pglite for this project memory backend, then retry.',
      stdout: trimCommandOutput(doctor.stdout),
      stderr: trimCommandOutput(doctor.stderr),
    }
  }

  const sourceReady = await ensureProjectGbrainSourceRegistered(workingDirectory, context.projectGbrainPath, context.namespace, {
    runGbrainCommand: runner,
    timeoutMs,
    databaseUrl: commandContext.databaseUrl,
    databaseName: commandContext.databaseName,
  })
  if (!sourceReady.ok) {
    return {
      enabled: true,
      command: sourceReady.command,
      status: 'import_failed',
      reason: 'gbrain project source registration failed.',
      stdout: sourceReady.stdout,
      stderr: sourceReady.stderr,
    }
  }

  const importDir = join(brainPath, 'gbrain')
  const imported = await runner(['import', importDir], commandContext)
  if (!imported.ok) {
    const importedWithoutEmbedding = await runner(['import', importDir, '--no-embed'], commandContext)
    if (importedWithoutEmbedding.ok) {
      const maintenance = await runProjectGbrainPostImportMaintenance(runner, commandContext)
      return {
        enabled: true,
        command: `gbrain import ${importDir} --no-embed`,
        status: 'imported',
        reason: getPostImportReason(
          'Imported the project memory feed without embeddings. Configure a gbrain embedding provider later for vector recall.',
          maintenance,
        ),
        stdout: trimCommandOutput(importedWithoutEmbedding.stdout),
        stderr: trimCommandOutput(importedWithoutEmbedding.stderr),
        maintenance,
      }
    }

    return {
      enabled: true,
      command: `gbrain import ${importDir}`,
      status: 'import_failed',
      reason: 'gbrain import failed for the project memory feed.',
      stdout: trimCommandOutput(importedWithoutEmbedding.stdout || imported.stdout),
      stderr: trimCommandOutput(importedWithoutEmbedding.stderr || imported.stderr),
    }
  }

  const maintenance = await runProjectGbrainPostImportMaintenance(runner, commandContext)
  return {
    enabled: true,
    command: `gbrain import ${importDir}`,
    status: 'imported',
    reason: getPostImportReason(undefined, maintenance),
    stdout: trimCommandOutput(imported.stdout),
    stderr: trimCommandOutput(imported.stderr),
    maintenance,
  }
}

async function runProjectGbrainPostImportMaintenance(
  runner: GbrainCommandRunner,
  context: {
    workingDirectory: string
    gbrainHome: string
    namespace: string
    databaseUrl?: string
    databaseName?: string
    timeoutMs: number
  },
): Promise<ProjectMemoryGbrainMaintenanceAttempt> {
  const linksArgs = ['extract', 'all', '--source', 'db', '--json']
  const factsArgs = ['dream', '--phase', 'extract_facts', '--source', context.namespace, '--json']
  const embeddingsArgs = ['embed', '--stale']

  const links = toCommandStatus(formatGbrainCommand(linksArgs), await runner(linksArgs, context))
  const facts = toCommandStatus(formatGbrainCommand(factsArgs), await runner(factsArgs, context))
  const embeddings = toCommandStatus(formatGbrainCommand(embeddingsArgs), await runner(embeddingsArgs, context))

  return {
    links,
    facts,
    embeddings,
  }
}

function getPostImportReason(
  baseReason: string | undefined,
  maintenance: ProjectMemoryGbrainMaintenanceAttempt,
): string | undefined {
  const failed = [
    maintenance.links?.ok === false ? 'links' : undefined,
    maintenance.facts?.ok === false ? 'facts' : undefined,
    maintenance.embeddings?.ok === false ? 'embeddings' : undefined,
  ].filter((item): item is string => item !== undefined)
  if (failed.length === 0) return baseReason
  const suffix = `Post-import maintenance incomplete: ${failed.join(', ')}.`
  return baseReason ? `${baseReason} ${suffix}` : suffix
}

function runGbrainCommand(
  args: string[],
  context: {
    workingDirectory: string
    gbrainHome: string
    namespace: string
    databaseUrl?: string
    databaseName?: string
    timeoutMs: number
  },
): Promise<GbrainCommandResult> {
  return new Promise(resolve => {
    execFile(resolveGbrainExecutable(), args, {
      cwd: context.workingDirectory,
      env: {
        ...process.env,
        PATH: withUserBunBinOnPath(process.env.PATH),
        GBRAIN_HOME: context.gbrainHome,
        GBRAIN_NAMESPACE: context.namespace,
        GBRAIN_SOURCE: context.namespace,
        ...(context.databaseUrl ? {
          GBRAIN_DATABASE_URL: context.databaseUrl,
          DATABASE_URL: context.databaseUrl,
        } : {}),
        AGENT_PI_GBRAIN_MODE: 'project',
      },
      timeout: context.timeoutMs,
      maxBuffer: 200_000,
      windowsHide: true,
    }, (error, stdout, stderr) => {
      if (error) {
        const code = typeof error === 'object' && error !== null && 'code' in error
          ? (error as { code?: number | string }).code
          : undefined
        resolve({
          ok: false,
          stdout: String(stdout ?? ''),
          stderr: String(stderr ?? ''),
          code,
        })
        return
      }
      resolve({
        ok: true,
        stdout: String(stdout ?? ''),
        stderr: String(stderr ?? ''),
      })
    })
  })
}

async function ensurePostgresProjectDatabase(
  context: {
    databaseUrl: string
    databaseName: string
    timeoutMs: number
  },
): Promise<ProjectGbrainCommandStatus> {
  const psql = resolvePostgresPsqlExecutable()
  const adminUrl = toPostgresAdminUrl(context.databaseUrl)
  const projectUrl = toPostgresPasswordlessUrl(context.databaseUrl)
  const env = toPostgresCommandEnv(context.databaseUrl)
  const existsSql = `SELECT 1 FROM pg_database WHERE datname = ${quoteSqlLiteral(context.databaseName)};`

  const existsResult = await runPsqlCommand(psql, ['--dbname', adminUrl, '-v', 'ON_ERROR_STOP=1', '-Atc', existsSql], env, context.timeoutMs)
  if (!existsResult.ok) {
    return toCommandStatus(`psql --dbname ${redactConnectionUrl(adminUrl)} -c ${quoteShellLike(existsSql)}`, existsResult)
  }

  if (!existsResult.stdout.trim().split(/\s+/).includes('1')) {
    const createSql = `CREATE DATABASE ${quotePostgresIdentifier(context.databaseName)};`
    const createResult = await runPsqlCommand(psql, ['--dbname', adminUrl, '-v', 'ON_ERROR_STOP=1', '-c', createSql], env, context.timeoutMs)
    if (!createResult.ok) {
      return toCommandStatus(`psql --dbname ${redactConnectionUrl(adminUrl)} -c ${quoteShellLike(createSql)}`, createResult)
    }
  }

  const extensionSql = [
    'CREATE EXTENSION IF NOT EXISTS vector;',
    'CREATE EXTENSION IF NOT EXISTS pg_trgm;',
    'CREATE EXTENSION IF NOT EXISTS "uuid-ossp";',
  ].join(' ')
  const extensionResult = await runPsqlCommand(psql, ['--dbname', projectUrl, '-v', 'ON_ERROR_STOP=1', '-c', extensionSql], env, context.timeoutMs)
  if (!extensionResult.ok) {
    return toCommandStatus(`psql --dbname ${redactConnectionUrl(projectUrl)} -c ${quoteShellLike(extensionSql)}`, extensionResult)
  }

  return {
    command: `psql --dbname ${redactConnectionUrl(projectUrl)} -c ${quoteShellLike(extensionSql)}`,
    ok: true,
    stdout: trimCommandOutput(extensionResult.stdout),
    stderr: trimCommandOutput(extensionResult.stderr),
  }
}

function runPsqlCommand(
  psql: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
): Promise<GbrainCommandResult> {
  return new Promise(resolve => {
    execFile(psql, args, {
      env,
      timeout: timeoutMs,
      maxBuffer: 200_000,
      windowsHide: true,
    }, (error, stdout, stderr) => {
      if (error) {
        const code = typeof error === 'object' && error !== null && 'code' in error
          ? (error as { code?: number | string }).code
          : undefined
        resolve({
          ok: false,
          stdout: String(stdout ?? ''),
          stderr: String(stderr ?? ''),
          code,
        })
        return
      }
      resolve({
        ok: true,
        stdout: String(stdout ?? ''),
        stderr: String(stderr ?? ''),
      })
    })
  })
}

function resolveGbrainExecutable(): string {
  const configured = process.env.GBRAIN_BIN?.trim()
  if (configured) return configured

  if (process.platform === 'win32' && process.env.USERPROFILE) {
    const userBunGbrain = join(process.env.USERPROFILE, '.bun', 'bin', 'gbrain.exe')
    if (existsSync(userBunGbrain)) return userBunGbrain
  }

  return 'gbrain'
}

function resolvePostgresPsqlExecutable(): string {
  const configured = process.env.POSTGRES_PSQL_BIN?.trim()
  if (configured) return configured

  if (process.platform === 'win32') {
    const programFiles = process.env.ProgramFiles ?? 'C:\\Program Files'
    const postgresRoot = join(programFiles, 'PostgreSQL')
    if (existsSync(postgresRoot)) {
      const versions = readdirSync(postgresRoot, { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name)
        .sort((a, b) => Number(b) - Number(a))
      for (const version of versions) {
        const candidate = join(postgresRoot, version, 'bin', 'psql.exe')
        if (existsSync(candidate)) return candidate
      }
    }
  }

  return 'psql'
}

function toPostgresAdminUrl(databaseUrl: string): string {
  const url = new URL(databaseUrl)
  url.pathname = '/postgres'
  url.password = ''
  return url.toString()
}

function toPostgresPasswordlessUrl(databaseUrl: string): string {
  const url = new URL(databaseUrl)
  url.password = ''
  return url.toString()
}

function toPostgresCommandEnv(databaseUrl: string): NodeJS.ProcessEnv {
  const url = new URL(databaseUrl)
  return {
    ...process.env,
    ...(url.password ? { PGPASSWORD: decodeURIComponent(url.password) } : {}),
  }
}

function quoteSqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

function quotePostgresIdentifier(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

function quoteShellLike(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`
}

function trimCommandOutput(value: string): string | undefined {
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, 4000) : undefined
}

function toCommandStatus(command: string, result: GbrainCommandResult): ProjectGbrainCommandStatus {
  return {
    command,
    ok: result.ok,
    stdout: trimCommandOutput(result.stdout),
    stderr: trimCommandOutput(result.stderr),
    ...(result.code !== undefined ? { code: result.code } : {}),
  }
}

async function ensureProjectGbrainSourceRegistered(
  workingDirectory: string,
  gbrainHome: string | undefined,
  namespace: string | undefined,
  options: {
    runGbrainCommand?: GbrainCommandRunner
    timeoutMs?: number
    databaseUrl?: string
    databaseName?: string
  },
): Promise<ProjectGbrainCommandStatus> {
  if (!gbrainHome || !namespace) {
    return {
      command: 'gbrain sources add',
      ok: false,
      stderr: 'Project gbrain source context is unavailable.',
    }
  }

  const runner = options.runGbrainCommand ?? runGbrainCommand
  const args = ['sources', 'add', namespace, '--path', workingDirectory]
  const result = await runner(args, {
    workingDirectory,
    gbrainHome,
    namespace,
    databaseUrl: options.databaseUrl,
    databaseName: options.databaseName,
    timeoutMs: options.timeoutMs ?? 30_000,
  })
  const status = toCommandStatus(formatGbrainCommand(args), result)
  const combined = `${status.stdout ?? ''}\n${status.stderr ?? ''}`.toLowerCase()
  if (!status.ok && combined.includes('already registered')) {
    return {
      ...status,
      ok: true,
    }
  }
  return status
}

function formatGbrainCommand(args: string[]): string {
  const scrubbed = args.map((arg, index) => {
    if (index > 0 && args[index - 1] === '--url') return redactConnectionUrl(arg)
    return /\bpostgres:\/\/[^@\s]+@/i.test(arg) ? redactConnectionUrl(arg) : arg
  })
  return `gbrain ${scrubbed.join(' ')}`
}

function redactConnectionUrl(value: string): string {
  return value.replace(/(postgres(?:ql)?:\/\/[^:\s]+:)[^@\s]+@/i, '$1***@')
}

function isGbrainCommandUnavailable(result: GbrainCommandResult): boolean {
  const text = `${result.code ?? ''}\n${result.stdout}\n${result.stderr}`.toLowerCase()
  return result.code === 'ENOENT'
    || result.code === 127
    || text.includes('not recognized')
    || text.includes('command not found')
    || text.includes('cannot find')
}

function isGbrainDoctorRuntimeReady(result: GbrainCommandResult): boolean {
  if (result.ok) return true

  const payload = parseGbrainDoctorJson(`${result.stdout}\n${result.stderr}`)
  if (!payload || !Array.isArray(payload.checks)) return false

  const checks = payload.checks
  const requiredChecks = ['connection', 'pgvector', 'schema_version']
  return requiredChecks.every(name => {
    const check = checks.find(item => item?.name === name)
    return check?.status === 'ok'
  })
}

function parseGbrainDoctorJson(output: string): {
  checks?: Array<{
    name?: string
    status?: string
  }>
} | undefined {
  const start = output.indexOf('{')
  const end = output.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) return undefined

  try {
    const parsed = JSON.parse(output.slice(start, end + 1)) as unknown
    return typeof parsed === 'object' && parsed !== null ? parsed : undefined
  } catch {
    return undefined
  }
}

function withUserBunBinOnPath(currentPath: string | undefined): string {
  if (process.platform !== 'win32') return currentPath ?? ''

  const userProfile = process.env.USERPROFILE
  if (!userProfile) return currentPath ?? ''

  const bunBinPath = join(userProfile, '.bun', 'bin')
  if (!existsSync(bunBinPath)) return currentPath ?? ''

  const existing = (currentPath ?? '').split(delimiter).map(item => item.toLowerCase())
  if (existing.includes(bunBinPath.toLowerCase())) return currentPath ?? ''

  return currentPath ? `${bunBinPath}${delimiter}${currentPath}` : bunBinPath
}

function formatGbrainMarkdownEntry(entry: ProjectMemoryContextEntry): string {
  const lines = [
    `## ${formatMarkdownText(entry.title ?? entry.outputPath ?? entry.path ?? entry.id ?? entry.type)}`,
    '',
    `- Type: ${formatMarkdownText(entry.type)}`,
    entry.trust ? `- Trust: ${entry.trust}` : undefined,
    entry.status ? `- Status: ${formatMarkdownText(entry.status)}` : undefined,
    entry.sessionId ? `- Session: ${formatMarkdownText(entry.sessionId)}` : undefined,
    entry.goalAuditId ? `- Goal audit: ${formatMarkdownText(entry.goalAuditId)}` : undefined,
    entry.outputPath ? `- Output: ${formatMarkdownText(entry.outputPath)}` : undefined,
    entry.path ? `- Path: ${formatMarkdownText(entry.path)}` : undefined,
    entry.reviewPath ? `- Review: ${formatMarkdownText(entry.reviewPath)}` : undefined,
    entry.sourcePaths && entry.sourcePaths.length > 0 ? `- Sources: ${entry.sourcePaths.map(formatMarkdownText).join('; ')}` : undefined,
    entry.createdAt ? `- Created at: ${new Date(entry.createdAt).toISOString()}` : undefined,
    '',
    entry.summary ? formatMarkdownText(entry.summary) : undefined,
    entry.missingCriteria && entry.missingCriteria.length > 0 ? ['', 'Open gaps:', ...entry.missingCriteria.map(item => `- ${formatMarkdownText(item)}`)].join('\n') : undefined,
  ].filter((line): line is string => line !== undefined)
  return lines.join('\n')
}

function formatMarkdownText(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
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
