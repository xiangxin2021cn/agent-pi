import type { SessionGoalAuditEvidence, SessionGoalFailureCategory } from '@craft-agent/shared/sessions'
import type { Message } from '@craft-agent/core/types'
import { withTimeout, type LLMQueryRequest, type LLMQueryResult } from '@craft-agent/shared/agent/llm-tool'
import type { GoalReviewInput, GoalReviewResult } from './goal-controller'
import { formatTaskContractForPrompt } from './goal-criteria'

const QUALITY_ROLE_REVIEW_TIMEOUT_MS = 20_000

const QUALITY_REVIEW_ROLES = [
  {
    name: 'acceptance_reviewer',
    focus: 'Check whether every explicit required criterion and user constraint is satisfied.',
  },
  {
    name: 'artifact_reviewer',
    focus: 'Check verified artifact previews and output evidence before trusting the final assistant text.',
  },
  {
    name: 'risk_reviewer',
    focus: 'Find shallow work, scope reduction, missing verification, or likely user-disappointing gaps.',
  },
] as const

interface QualityReviewRole {
  name: string
  focus: string
  model?: string
}

interface QualityReviewRouteOptions {
  reviewerModels?: Record<string, string | undefined>
  maxExtraReviewers?: number
}

interface QualityReviewRoute {
  roles: QualityReviewRole[]
  evidence: SessionGoalAuditEvidence
}

type QualityRouteHealth = 'no_history' | 'mixed' | 'degraded'

export interface GoalQualityCouncilReviewOptions {
  input: GoalReviewInput
  queryLlm: (request: LLMQueryRequest) => Promise<LLMQueryResult>
  reviewerTimeoutMs?: number
  route?: QualityReviewRouteOptions
  now?: () => number
}

interface RoleReview {
  role: string
  status: GoalReviewResult['status']
  summary: string
  missingCriteria: string[]
  failureCategories: SessionGoalFailureCategory[]
  correctivePrompt?: string
  model?: string
  requestedModel?: string
  fallbackModel?: boolean
  latencyMs?: number
  inputTokens?: number
  outputTokens?: number
  warning?: string
}

export async function runGoalQualityCouncilReview(options: GoalQualityCouncilReviewOptions): Promise<GoalReviewResult> {
  const reviewerTimeoutMs = options.reviewerTimeoutMs ?? QUALITY_ROLE_REVIEW_TIMEOUT_MS
  const now = options.now ?? Date.now
  const route = buildQualityReviewRoute(options.input, options.route)
  const roles = route.roles
  const reviews = await Promise.all(roles.map(async role => {
    let response: LLMQueryResult | undefined
    const startedAt = now()
    try {
      response = await withTimeout(
        options.queryLlm({
          prompt: buildRolePrompt(options.input, role.name, role.focus),
          model: role.model,
          temperature: 0,
          maxTokens: 1200,
          outputSchema: {
            type: 'object',
            properties: {
              status: { type: 'string' },
              summary: { type: 'string' },
              missingCriteria: { type: 'array', items: { type: 'string' } },
              failureCategories: { type: 'array', items: { type: 'string' } },
              correctivePrompt: { type: 'string' },
            },
            required: ['status', 'summary', 'missingCriteria'],
          },
        }),
        reviewerTimeoutMs,
        `Quality reviewer ${role.name} timed out after ${Math.floor(reviewerTimeoutMs / 1000)}s`,
      )
      const parsed = parseRoleReview(response.text)
      const normalized = normalizeNonFinalRolePass(parsed, response.warning)
      return {
        role: role.name,
        ...normalized,
        model: response.model,
        requestedModel: role.model,
        fallbackModel: isModelFallback(role.model, response.model),
        latencyMs: Math.max(0, now() - startedAt),
        inputTokens: response.inputTokens,
        outputTokens: response.outputTokens,
        warning: response.warning,
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      return {
        role: role.name,
        status: 'uncertain',
        summary: `Reviewer failed to return usable JSON: ${reason}`,
        missingCriteria: [],
        failureCategories: [],
        model: response?.model,
        requestedModel: role.model,
        fallbackModel: isModelFallback(role.model, response?.model),
        latencyMs: Math.max(0, now() - startedAt),
        inputTokens: response?.inputTokens,
        outputTokens: response?.outputTokens,
      } satisfies RoleReview
    }
  }))

  return aggregateRoleReviews(reviews, options.input.result, route.evidence)
}

function buildRolePrompt(
  input: GoalReviewInput,
  role: string,
  focus: string,
): string {
  const requiredCriteria = input.goalState.criteria
    .filter(criterion => criterion.required)
    .map((criterion, index) => `${index + 1}. [${criterion.kind}] ${criterion.text}`)
    .join('\n')
  const evidence = input.result.evidence.length > 0
    ? input.result.evidence.map((item, index) => {
        const detail = item.detail ? ` - ${item.detail}` : ''
        return `${index + 1}. [${item.type}] ${item.label}${detail}`
      }).join('\n')
    : '(none)'
  const previousAudits = buildPreviousAuditSummary(input.goalState.auditHistory)
  const taskContract = formatTaskContractForPrompt(input.goalState.taskContract)
  const recentTurnContext = buildRecentTurnContext(input.messages, input.finalAssistant.id)
  const reviewerPerformanceMemory = input.reviewerPerformanceMemory?.trim() || '(none)'

  return [
    `Role: ${role}`,
    `Focus: ${focus}`,
    '',
    'Review whether the agent completed the user objective. Return only compact JSON:',
    '{"status":"pass|fail|uncertain","summary":"...","missingCriteria":["..."],"failureCategories":["scope_gap|evidence_gap|verification_gap|shallow_output|tool_failure"],"correctivePrompt":"..."}',
    '',
    'Objective:',
    input.goalState.objective,
    '',
    'Task contract:',
    taskContract,
    '',
    'Required criteria:',
    requiredCriteria || '(none)',
    '',
    'Deterministic audit summary:',
    input.result.summary,
    '',
    'Audit evidence:',
    evidence,
    '',
    'Previous goal audits:',
    previousAudits,
    '',
    'Reviewer performance memory:',
    reviewerPerformanceMemory,
    '',
    'Recent turn context:',
    recentTurnContext,
    '',
    'Assistant final response:',
    input.finalAssistant.content.slice(0, 8000),
    '',
    'Rules:',
    '- Treat the task contract as binding. Do not accept scope reduction, skipped granularity, missing deliverables, or omitted hard constraints.',
    '- Use pass only when the evidence clearly proves all required criteria.',
    '- When verified file previews are present, judge the artifact content instead of relying only on the final response.',
    '- When source_file_preview evidence is present, use it as source material for grounding and citation checks, not as proof that a requested output file was produced.',
    '- When status is "pass", missingCriteria must be [] and correctivePrompt must be omitted.',
    '- If any criterion is missing or any correctivePrompt is needed, status must not be "pass".',
    '- Use fail when another pass can fix concrete missing work.',
    '- Use uncertain when evidence is insufficient or human input is needed.',
    '- Keep missingCriteria specific and grounded in the required criteria.',
    '- Use evidence_gap for missing citations, source grounding, files, or artifact proof.',
    '- Use verification_gap for missing test/build/check evidence.',
    '- Use scope_gap for unmet requested scope or omitted requirements.',
    '- Use shallow_output for outline-level, placeholder, or insufficiently detailed work.',
    '- Use tool_failure only for failed tools or execution errors.',
  ].join('\n')
}

function buildQualityReviewRoles(input: GoalReviewInput): QualityReviewRole[] {
  const roles: QualityReviewRole[] = [...QUALITY_REVIEW_ROLES]
  const taskType = input.goalState.taskContract?.taskType

  if (taskType === 'research') {
    roles.push({
      name: 'research_source_reviewer',
      focus: 'Check cited sources, unsupported claims, assumptions, and unresolved questions.',
    })
  } else if (taskType === 'code') {
    roles.push({
      name: 'code_implementation_reviewer',
      focus: 'Check whether the implementation changed the right surface and whether verification evidence matches the code change.',
    })
  }

  return roles
}

function buildQualityReviewRoute(
  input: GoalReviewInput,
  options: QualityReviewRouteOptions = {},
): QualityReviewRoute {
  const taskType = input.goalState.taskContract?.taskType ?? 'unknown'
  const telemetry = parseQualityRouteTelemetry(input.reviewerPerformanceMemory, taskType)
  const baseRoles = buildQualityReviewRoles(input)
  const maxExtraReviewers = normalizeMaxExtraReviewers(options.maxExtraReviewers)
  const shouldAddRouteHistoryReviewer = telemetry.routeHealth === 'degraded' && maxExtraReviewers > 0
  const routedRoles = shouldAddRouteHistoryReviewer
    ? [
        ...baseRoles,
        {
          name: 'route_history_reviewer',
          focus: `Check the current output against historical route failures for this task type, especially ${telemetry.commonGaps.join(', ') || 'repeated missing acceptance evidence'}.`,
        },
      ]
    : baseRoles
  const roles = routedRoles.map(role => {
    const model = options.reviewerModels?.[role.name]?.trim()
    return model ? { ...role, model } : role
  })
  const modelAssignments = roles
    .filter(role => role.model)
    .map(role => `${role.name}:${role.model}`)
    .join(',')

  return {
    roles,
    evidence: {
      type: 'system',
      label: 'quality_route',
      detail: [
        `task=${taskType}`,
        `roles=${roles.map(role => role.name).join(',')}`,
        `models=${modelAssignments || 'none'}`,
        `telemetry_roles=${telemetry.roles.join(',') || 'none'}`,
        `common_gaps=${telemetry.commonGaps.join(',') || 'none'}`,
        `route_history=${telemetry.routeHistory ?? 'none'}`,
        `route_health=${telemetry.routeHealth}`,
        `extra_reviewers=${routedRoles.length - baseRoles.length}/${maxExtraReviewers}`,
      ].join('; '),
    },
  }
}

function normalizeMaxExtraReviewers(value: number | undefined): number {
  if (value === undefined) return 1
  if (!Number.isFinite(value)) return 1
  return Math.max(0, Math.floor(value))
}

function parseQualityRouteTelemetry(
  reviewerPerformanceMemory: string | undefined,
  taskType: string,
): { roles: string[]; commonGaps: string[]; routeHistory?: string; routeHealth: QualityRouteHealth } {
  const roles: string[] = []
  const commonGaps: string[] = []
  let routeHistory: string | undefined
  let routeHealth: QualityRouteHealth = 'no_history'

  for (const line of reviewerPerformanceMemory?.split('\n') ?? []) {
    const task = readQualityRouteField(line, 'task')
    if (task !== taskType) continue

    const role = readQualityRouteField(line, 'role')
    if (role) roles.push(role)
    const gaps = readQualityRouteField(line, 'common_gaps')
    if (gaps) {
      commonGaps.push(...gaps.split(',').map(value => value.trim()).filter(Boolean))
    }
    const total = readQualityRouteField(line, 'total')
    const pass = readQualityRouteField(line, 'pass')
    const fail = readQualityRouteField(line, 'fail')
    const uncertain = readQualityRouteField(line, 'uncertain')
    if (total && pass && fail && uncertain) {
      routeHistory = `total:${total},pass:${pass},fail:${fail},uncertain:${uncertain}`
      routeHealth = getQualityRouteHealth({
        total: Number(total),
        pass: Number(pass),
        fail: Number(fail),
      })
    }
  }

  return {
    roles: uniqueStrings(roles),
    commonGaps: uniqueStrings(commonGaps),
    routeHistory,
    routeHealth,
  }
}

function getQualityRouteHealth(counts: { total: number; pass: number; fail: number }): QualityRouteHealth {
  if (!Number.isFinite(counts.total) || counts.total <= 0) return 'no_history'
  if (counts.total >= 3 && counts.fail >= 2 && counts.fail > counts.pass) return 'degraded'
  return 'mixed'
}

function readQualityRouteField(line: string, key: string): string | undefined {
  const match = line.match(new RegExp(`(?:^|\\s)${key}=([^\\s;]+)`))
  return match?.[1]
}

function buildPreviousAuditSummary(history: GoalReviewInput['goalState']['auditHistory']): string {
  if (history.length === 0) return '(none)'

  return history.slice(-3).map(result => {
    const missing = result.missingCriteria.length > 0
      ? `\n  Missing: ${result.missingCriteria.slice(0, 4).map(summarizePromptText).join('; ')}`
      : ''
    const correction = result.correctivePrompt
      ? `\n  Correction: ${summarizePromptText(result.correctivePrompt)}`
      : ''
    return `Iteration ${result.iteration}: ${result.status} - ${summarizePromptText(result.summary)}${missing}${correction}`
  }).join('\n')
}

function summarizePromptText(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 1000) || '(empty)'
}

function buildRecentTurnContext(messages: Message[], finalAssistantId: string): string {
  const lines = messages
    .filter(message => message.id !== finalAssistantId)
    .filter(message => message.role === 'user' || message.role === 'tool' || message.role === 'error' || message.role === 'info')
    .slice(-8)
    .map(message => {
      if (message.role === 'tool') {
        const label = message.toolName ? `tool ${message.toolName}` : 'tool'
        const status = message.toolStatus ? ` (${message.toolStatus})` : ''
        return `${label}${status}: ${summarizeUnknownPromptText(message.toolResult ?? message.content)}`
      }
      return `${message.role}: ${summarizeUnknownPromptText(message.content)}`
    })

  return lines.length > 0 ? lines.join('\n') : '(none)'
}

function summarizeUnknownPromptText(value: unknown): string {
  const text = typeof value === 'string'
    ? value
    : value == null
    ? ''
    : JSON.stringify(value)
  return text.replace(/\s+/g, ' ').trim().slice(0, 1000) || '(empty)'
}

function aggregateRoleReviews(
  reviews: RoleReview[],
  fallbackResult: GoalReviewInput['result'],
  routeEvidence?: SessionGoalAuditEvidence,
): GoalReviewResult {
  const status = reviews.some(review => review.status === 'fail')
    ? 'fail'
    : reviews.some(review => review.status === 'uncertain')
    ? 'uncertain'
    : 'pass'
  const missingCriteria = uniqueStrings(reviews.flatMap(review => review.missingCriteria))
  const failureCategories = uniqueFailureCategories(reviews.flatMap(review => review.failureCategories))
  const effectiveMissingCriteria = missingCriteria.length > 0
    ? missingCriteria
    : fallbackResult.missingCriteria
  const effectiveFailureCategories = failureCategories.length > 0
    ? failureCategories
    : fallbackResult.failureCategories
  const correctivePrompt = buildCombinedCorrectivePrompt(reviews)
  const summaries = reviews
    .map(review => `${review.role}: ${review.summary}`)
    .join(' | ')
  const roleEvidence: SessionGoalAuditEvidence[] = reviews.map(review => ({
    type: 'system',
    label: `quality_role_${review.role}`,
    detail: [
      review.model ? `model=${review.model}` : undefined,
      review.requestedModel ? `requested_model=${formatEvidenceFieldValue(review.requestedModel)}` : undefined,
      review.fallbackModel ? 'fallback_model=true' : undefined,
      `status=${review.status}`,
      review.failureCategories.length > 0 ? `categories=${review.failureCategories.join(',')}` : undefined,
      review.latencyMs !== undefined ? `latency_ms=${review.latencyMs}` : undefined,
      review.inputTokens !== undefined ? `input_tokens=${review.inputTokens}` : undefined,
      review.outputTokens !== undefined ? `output_tokens=${review.outputTokens}` : undefined,
      review.warning ? `warning=${formatEvidenceFieldValue(review.warning)}` : undefined,
      `summary=${formatEvidenceFieldValue(review.summary)}`,
    ].filter(Boolean).join('; '),
  }))
  const disagreementEvidence = buildCouncilDisagreementEvidence(reviews)
  const evidence = [
    routeEvidence,
    ...roleEvidence,
    disagreementEvidence,
  ].filter((item): item is SessionGoalAuditEvidence => item !== undefined)

  return {
    status,
    summary: `Quality council review: ${summaries}`,
    missingCriteria: status === 'pass' ? [] : effectiveMissingCriteria,
    failureCategories: status === 'pass' ? undefined : effectiveFailureCategories,
    correctivePrompt: status === 'pass' ? undefined : correctivePrompt,
    evidence,
  }
}

function buildCouncilDisagreementEvidence(reviews: RoleReview[]): SessionGoalAuditEvidence | undefined {
  const statuses = [...new Set(reviews.map(review => review.status))]
  if (statuses.length <= 1) {
    return undefined
  }

  return {
    type: 'system',
    label: 'quality_council_disagreement',
    detail: reviews.map(review => `${review.role}=${review.status}`).join('; '),
  }
}

function isModelFallback(requestedModel: string | undefined, actualModel: string | undefined): boolean {
  return Boolean(requestedModel && (!actualModel || requestedModel !== actualModel))
}

function buildCombinedCorrectivePrompt(reviews: RoleReview[]): string | undefined {
  const prompts = reviews
    .map(review => review.correctivePrompt?.trim()
      ? { role: review.role, prompt: review.correctivePrompt.trim() }
      : undefined)
    .filter((value): value is { role: RoleReview['role']; prompt: string } => value !== undefined)

  if (prompts.length === 0) {
    return undefined
  }

  if (prompts.length === 1) {
    return prompts[0].prompt
  }

  return prompts.map(value => `${value.role}: ${value.prompt}`).join('\n')
}

function parseRoleReview(raw: string): Omit<RoleReview, 'role' | 'model'> {
  const parsed = JSON.parse(extractJsonObject(raw)) as Record<string, unknown>
  return {
    status: normalizeStatus(parsed.status),
    summary: typeof parsed.summary === 'string' && parsed.summary.trim()
      ? parsed.summary.trim()
      : 'Reviewer returned no summary.',
    missingCriteria: normalizeStringArray(parsed.missingCriteria),
    failureCategories: normalizeFailureCategories(parsed.failureCategories),
    correctivePrompt: typeof parsed.correctivePrompt === 'string' && parsed.correctivePrompt.trim()
      ? parsed.correctivePrompt.trim()
      : undefined,
  }
}

function normalizeNonFinalRolePass(
  review: Omit<RoleReview, 'role' | 'model'>,
  warning?: string,
): Omit<RoleReview, 'role' | 'model'> {
  if (review.status !== 'pass') {
    return review
  }

  if (warning?.trim()) {
    return {
      ...review,
      status: 'uncertain',
      summary: `Reviewer returned a pass with a backend warning: ${review.summary}`,
    }
  }

  if (review.missingCriteria.length === 0 && !review.correctivePrompt) {
    return review
  }

  return {
    ...review,
    status: 'uncertain',
    summary: `Reviewer returned a contradictory pass: ${review.summary}`,
  }
}

function normalizeStatus(value: unknown): GoalReviewResult['status'] {
  if (typeof value !== 'string') return 'uncertain'
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, '_')
  if (normalized === 'pass' || normalized === 'passed') return 'pass'
  if (normalized === 'fail' || normalized === 'failed' || normalized === 'needs_review') return 'fail'
  return 'uncertain'
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return uniqueStrings(value
    .map(item => typeof item === 'string' ? item.trim() : '')
    .filter(Boolean))
}

function normalizeFailureCategories(value: unknown): SessionGoalFailureCategory[] {
  if (!Array.isArray(value)) return []
  return uniqueFailureCategories(value
    .map(item => typeof item === 'string' ? item.trim().toLowerCase().replace(/[\s-]+/g, '_') : '')
    .filter(Boolean))
}

function uniqueFailureCategories(values: string[]): SessionGoalFailureCategory[] {
  const valid = new Set<SessionGoalFailureCategory>([
    'scope_gap',
    'evidence_gap',
    'verification_gap',
    'shallow_output',
    'tool_failure',
  ])
  return [...new Set(values)].filter((value): value is SessionGoalFailureCategory =>
    valid.has(value as SessionGoalFailureCategory)
  )
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))]
}

function formatEvidenceFieldValue(value: string): string {
  return value
    .replace(/[;\r\n]+/g, ', ')
    .replace(/\s+/g, ' ')
    .trim()
}

function extractJsonObject(raw: string): string {
  const trimmed = raw.trim()
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) return trimmed
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('Quality reviewer returned invalid JSON')
  }
  return trimmed.slice(start, end + 1)
}
