import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import type { Message } from '@craft-agent/core/types'
import {
  getSessionPath,
  type SessionGoalAuditEvidence,
  type SessionGoalAuditResult,
  type SessionGoalState,
  type SessionOrchestrationArtifactPaths,
  type SessionOrchestrationState,
  type SessionOrchestrationTask,
} from '@craft-agent/shared/sessions'

export function buildOrchestrationArtifactPaths(workspaceRootPath: string, sessionId: string): SessionOrchestrationArtifactPaths {
  const rootPath = join(getSessionPath(workspaceRootPath, sessionId), 'orchestration')
  return {
    rootPath,
    briefsPath: join(rootPath, 'briefs'),
    reportsPath: join(rootPath, 'reports'),
    evidencePackagesPath: join(rootPath, 'evidence-packages'),
    progressLedgerPath: join(rootPath, 'progress-ledger.json'),
  }
}

export async function ensureOrchestrationArtifactDirs(artifacts: SessionOrchestrationArtifactPaths): Promise<void> {
  await Promise.all([
    mkdir(artifacts.briefsPath, { recursive: true }),
    mkdir(artifacts.reportsPath, { recursive: true }),
    mkdir(artifacts.evidencePackagesPath, { recursive: true }),
  ])
}

export function pickOrchestrationTaskForSpawn(
  orchestration: SessionOrchestrationState | undefined,
  name: string | undefined,
  prompt: string,
): SessionOrchestrationTask | undefined {
  const tasks = orchestration?.taskBoard.tasks.filter(task => task.phase === 'plan') ?? []
  if (tasks.length === 0) return undefined

  const haystack = `${name ?? ''}\n${prompt}`.toLowerCase()
  return tasks.find(task =>
    haystack.includes(task.id.toLowerCase())
    || haystack.includes(task.title.toLowerCase())
  ) ?? tasks.find(task => task.status === 'pending') ?? tasks[0]
}

export function getOrchestrationReportPath(artifacts: SessionOrchestrationArtifactPaths, taskId: string | undefined): string {
  return join(artifacts.reportsPath, `${sanitizeFileName(taskId || 'spawn-task')}.md`)
}

export async function writeOrchestrationTaskBrief(input: {
  artifacts: SessionOrchestrationArtifactPaths
  task?: SessionOrchestrationTask
  parentObjective?: string
  prompt: string
  reportPath: string
  workingDirectory?: string
  allowedSourceSlugs: string[]
}): Promise<string> {
  await ensureOrchestrationArtifactDirs(input.artifacts)
  const taskId = input.task?.id || 'spawn-task'
  const briefPath = join(input.artifacts.briefsPath, `${sanitizeFileName(taskId)}.md`)
  const allowedSources = input.allowedSourceSlugs.length > 0 ? input.allowedSourceSlugs.join(', ') : '(none)'
  const content = [
    '# Spawned Agent Brief',
    '',
    `task_id: ${taskId}`,
    `task_title: ${input.task?.title ?? '(unnamed)'}`,
    `parent_objective: ${input.parentObjective ?? '(none)'}`,
    `working_directory: ${input.workingDirectory ?? 'none'}`,
    `allowed_sources: ${allowedSources}`,
    `report_path: ${input.reportPath}`,
    '',
    '## Scope',
    input.task?.scope ?? 'Execute only the assigned parent task.',
    '',
    '## Forbidden Actions',
    ...(input.task?.forbiddenActions?.length
      ? input.task.forbiddenActions.map(action => `- ${action}`)
      : ['- Do not broaden scope beyond this brief.']),
    '- Do not spawn child sessions.',
    '- Do not scan the working directory as a source corpus unless this brief names an exact path.',
    '- Do not write final synthesis artifacts outside report_path.',
    '',
    '## Required Handoff',
    ...(input.task?.expectedHandoff?.length
      ? input.task.expectedHandoff.map(field => `- ${field}: ...`)
      : ['- task_id: ...', '- sources_used: ...', '- evidence: ...', '- artifacts: ...', '- gaps: ...', '- recommendation: ...']),
    '',
    '## Parent Prompt',
    input.prompt,
    '',
    'Write the completed handoff report to report_path before replying.',
  ].join('\n')
  await writeFile(briefPath, content, 'utf8')
  return briefPath
}

export async function writeOrchestrationProgressLedger(input: {
  artifacts: SessionOrchestrationArtifactPaths
  sessionId: string
  orchestration: SessionOrchestrationState
}): Promise<void> {
  await ensureOrchestrationArtifactDirs(input.artifacts)
  const payload = {
    version: 1,
    sessionId: input.sessionId,
    updatedAt: input.orchestration.updatedAt,
    artifacts: input.artifacts,
    ledger: input.orchestration.ledger,
    taskBoard: input.orchestration.taskBoard,
    subAgents: input.orchestration.subAgents,
    entropy: input.orchestration.entropy,
  }
  await writeFile(input.artifacts.progressLedgerPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
}

export async function writeGoalEvidencePackage(input: {
  artifacts: SessionOrchestrationArtifactPaths
  goalState: SessionGoalState
  result: SessionGoalAuditResult
  messages: Message[]
  finalAssistant?: Message
}): Promise<SessionGoalAuditEvidence> {
  await ensureOrchestrationArtifactDirs(input.artifacts)
  const packagePath = join(input.artifacts.evidencePackagesPath, `audit-${input.result.iteration}.json`)
  const payload = {
    version: 1,
    goalId: input.goalState.id,
    iteration: input.result.iteration,
    objective: input.goalState.objective,
    selectedSourceSlugs: input.goalState.orchestration?.policy.selectedSourceSlugs ?? [],
    taskBoard: input.goalState.orchestration?.taskBoard,
    ledger: input.goalState.orchestration?.ledger,
    requirementLedger: input.goalState.taskContract?.requirementLedger,
    audit: {
      status: input.result.status,
      summary: input.result.summary,
      missingCriteria: input.result.missingCriteria,
      failureCategories: input.result.failureCategories ?? [],
      evidence: input.result.evidence,
    },
    finalAssistant: input.finalAssistant ? compactMessage(input.finalAssistant) : undefined,
    recentMessages: input.messages.slice(-30).map(compactMessage),
  }
  await writeFile(packagePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  return {
    type: 'file',
    label: 'orchestration_evidence_package',
    detail: packagePath,
  }
}

function compactMessage(message: Message): Record<string, unknown> {
  return {
    id: message.id,
    role: message.role,
    toolName: message.toolName,
    toolStatus: message.toolStatus,
    content: message.content.slice(0, 1600),
    toolInput: compactValue(message.toolInput),
    toolResult: compactValue(message.toolResult),
  }
}

function compactValue(value: unknown): unknown {
  if (typeof value === 'string') return value.slice(0, 1600)
  if (!value || typeof value !== 'object') return value
  try {
    const text = JSON.stringify(value)
    return text.length <= 1600 ? JSON.parse(text) : `${text.slice(0, 1600)}...`
  } catch {
    return String(value).slice(0, 1600)
  }
}

function sanitizeFileName(value: string): string {
  const sanitized = value.trim().replace(/[<>:"/\\|?*\u0000-\u001F]+/g, '-').replace(/\s+/g, '-')
  return sanitized.slice(0, 120) || 'task'
}
