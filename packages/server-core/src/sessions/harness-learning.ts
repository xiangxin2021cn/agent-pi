import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import type { ToolFailureCategory, ToolInputShape } from './tool-recovery.ts'

export interface HarnessExecutionProfile {
  provider?: string
  model?: string
  mode?: string
}

export interface HarnessRouteHint {
  id: string
  toolName: string
  category: ToolFailureCategory
  requiredInputKeys: string[]
  failedAttempts: number
  successCount: number
}

interface HarnessRouteRecord extends HarnessRouteHint {
  taskTokenHashes: string[]
  profile: HarnessExecutionProfile
  failedInputShape: ToolInputShape
  successfulInputShape: ToolInputShape
  sessionHashes: string[]
  traceHashes: string[]
  state: 'verified_advisory' | 'disabled'
  firstSeenAt: number
  lastSeenAt: number
}

interface HarnessExperienceLedger {
  schemaVersion: 1
  routes: HarnessRouteRecord[]
}

export type HarnessFeedbackCategory =
  | 'scope'
  | 'coverage'
  | 'template'
  | 'depth'
  | 'evidence'
  | 'format'
  | 'tool'
  | 'other'

export interface HarnessQualityFeedback {
  id: string
  sessionHash: string
  projectScope: string
  originalTaskHash: string
  feedback: string
  categories: HarnessFeedbackCategory[]
  artifactRefs: string[]
  createdAt: number
}

export interface HarnessRegressionCase {
  id: string
  feedbackId: string
  projectScope: string
  originalTaskHash: string
  expectedBehaviors: string[]
  artifactRefs: string[]
  state: 'candidate' | 'approved' | 'disabled'
  createdAt: number
}

interface HarnessFeedbackLedger {
  schemaVersion: 1
  feedback: HarnessQualityFeedback[]
  regressionCases: HarnessRegressionCase[]
}

export type HarnessPolicyAction =
  | { type: 'stop_retry'; afterFailures: number }
  | { type: 'require_prerequisite'; prerequisite: 'guide' | 'source_auth' | 'attachment' }
  | { type: 'suggest_tool_route'; toolName: string; requiredInputKeys: string[] }
  | { type: 'enforce_artifact_gate'; gate: 'boq_coverage' | 'template_fidelity' | 'citation_integrity' }

export interface HarnessPolicyAsset {
  id: string
  version: number
  state: 'draft' | 'shadow' | 'approved' | 'disabled'
  condition: {
    toolName?: string
    failureCategory?: ToolFailureCategory
    provider?: string
    model?: string
    mode?: string
  }
  action: HarnessPolicyAction
  hash: string
  previousVersionHash?: string
}

export interface HarnessRegressionSuiteResult {
  baselinePassed: number
  candidatePassed: number
  total: number
}

const MAX_ROUTES = 300
const MAX_FEEDBACK = 300
const MAX_REGRESSION_CASES = 500

export function recordRecoveredToolRoute(
  workspaceRoot: string,
  input: {
    sessionId: string
    taskText: string
    profile: HarnessExecutionProfile
    toolName: string
    category: ToolFailureCategory
    failedInputShape: ToolInputShape
    successfulInputShape: ToolInputShape
    failedAttempts: number
    traceRef: string
    now?: number
  },
): HarnessRouteHint {
  const now = input.now ?? Date.now()
  const ledger = readExperienceLedger(workspaceRoot)
  const taskTokenHashes = hashTaskTokens(input.taskText)
  const routeKey = stableHash({
    toolName: input.toolName,
    category: input.category,
    profile: normalizeProfile(input.profile),
    failedInputShape: input.failedInputShape,
    successfulInputShape: input.successfulInputShape,
  })
  const existingIndex = ledger.routes.findIndex(route => route.id === `route_${routeKey.slice(0, 20)}`)
  const sessionHash = stableHash(input.sessionId)
  const traceHash = stableHash(input.traceRef)

  const route: HarnessRouteRecord = existingIndex >= 0
    ? {
        ...ledger.routes[existingIndex]!,
        taskTokenHashes: unique([...ledger.routes[existingIndex]!.taskTokenHashes, ...taskTokenHashes]).slice(0, 96),
        sessionHashes: unique([...ledger.routes[existingIndex]!.sessionHashes, sessionHash]).slice(-20),
        traceHashes: unique([...ledger.routes[existingIndex]!.traceHashes, traceHash]).slice(-20),
        failedAttempts: Math.max(ledger.routes[existingIndex]!.failedAttempts, input.failedAttempts),
        successCount: ledger.routes[existingIndex]!.successCount + 1,
        lastSeenAt: now,
      }
    : {
        id: `route_${routeKey.slice(0, 20)}`,
        toolName: input.toolName,
        category: input.category,
        requiredInputKeys: input.successfulInputShape.keys,
        failedAttempts: input.failedAttempts,
        successCount: 1,
        taskTokenHashes,
        profile: normalizeProfile(input.profile),
        failedInputShape: input.failedInputShape,
        successfulInputShape: input.successfulInputShape,
        sessionHashes: [sessionHash],
        traceHashes: [traceHash],
        state: 'verified_advisory',
        firstSeenAt: now,
        lastSeenAt: now,
      }

  if (existingIndex >= 0) ledger.routes[existingIndex] = route
  else ledger.routes.push(route)
  ledger.routes = ledger.routes
    .sort((left, right) => right.lastSeenAt - left.lastSeenAt)
    .slice(0, MAX_ROUTES)
  writeJsonAtomic(experienceLedgerPath(workspaceRoot), ledger)
  return toRouteHint(route)
}

export function getReusableRouteHints(
  workspaceRoot: string,
  input: {
    taskText: string
    profile: HarnessExecutionProfile
    limit?: number
  },
): HarnessRouteHint[] {
  const queryTokens = new Set(hashTaskTokens(input.taskText))
  if (queryTokens.size === 0) return []
  const profile = normalizeProfile(input.profile)
  const limit = Math.max(0, Math.min(input.limit ?? 3, 3))

  return readExperienceLedger(workspaceRoot).routes
    .filter(route => route.state === 'verified_advisory')
    .map(route => ({
      route,
      score: taskSimilarity(queryTokens, route.taskTokenHashes) + profileScore(profile, route.profile),
    }))
    .filter(item => item.score >= 0.16)
    .sort((left, right) => right.score - left.score || right.route.lastSeenAt - left.route.lastSeenAt)
    .slice(0, limit)
    .map(item => toRouteHint(item.route))
}

export function buildHarnessGuidance(hints: HarnessRouteHint[], policies: HarnessPolicyAsset[] = []): string | undefined {
  const routeLines = hints.slice(0, 3).map(hint => (
    `- ${hint.toolName}: after ${hint.category}, the recovered call used fields [${hint.requiredInputKeys.join(', ')}]. `
      + `Do not repeat an identical failed call more than once.`
  ))
  const policyLines = policies
    .filter(policy => policy.state === 'approved')
    .slice(0, 3)
    .map(policy => `- ${formatPolicyAction(policy.action)} (policy ${policy.id} v${policy.version})`)
  if (routeLines.length === 0 && policyLines.length === 0) return undefined

  return [
    '<verified_execution_routes>',
    'These are bounded advisory routes from prior successful recoveries. They never override the current user request, selected sources, or artifact schema.',
    ...routeLines,
    ...policyLines,
    '</verified_execution_routes>',
  ].join('\n')
}

export function recordQualityFeedback(
  workspaceRoot: string,
  input: {
    sessionId: string
    projectScope: string
    originalTask: string
    feedback: string
    artifactRefs?: string[]
    now?: number
  },
): {
    created: boolean
    feedback: HarnessQualityFeedback
    regressionCase: HarnessRegressionCase
  } {
  const now = input.now ?? Date.now()
  const ledger = readFeedbackLedger(workspaceRoot)
  const categories = classifyQualityFeedback(input.feedback)
  const id = `feedback_${stableHash({
    projectScope: input.projectScope,
    originalTask: input.originalTask,
    feedback: input.feedback,
  }).slice(0, 20)}`
  const existing = ledger.feedback.find(item => item.id === id)
  const existingCase = ledger.regressionCases.find(item => item.feedbackId === id)
  if (existing && existingCase) {
    return { created: false, feedback: existing, regressionCase: existingCase }
  }

  const artifactRefs = unique((input.artifactRefs ?? []).map(sanitizeArtifactRef)).slice(0, 20)
  const feedback: HarnessQualityFeedback = {
    id,
    sessionHash: stableHash(input.sessionId),
    projectScope: input.projectScope,
    originalTaskHash: stableHash(input.originalTask),
    feedback: input.feedback.replace(/\s+/g, ' ').trim().slice(0, 1600),
    categories,
    artifactRefs,
    createdAt: now,
  }
  const regressionCase: HarnessRegressionCase = {
    id: `regression_${stableHash(id).slice(0, 20)}`,
    feedbackId: id,
    projectScope: input.projectScope,
    originalTaskHash: feedback.originalTaskHash,
    expectedBehaviors: expectedBehaviorsFor(categories),
    artifactRefs,
    state: 'candidate',
    createdAt: now,
  }
  ledger.feedback = [...ledger.feedback, feedback].slice(-MAX_FEEDBACK)
  ledger.regressionCases = [...ledger.regressionCases, regressionCase].slice(-MAX_REGRESSION_CASES)
  writeJsonAtomic(feedbackLedgerPath(workspaceRoot), ledger)
  return { created: true, feedback, regressionCase }
}

export function classifyQualityFeedback(feedback: string): HarnessFeedbackCategory[] {
  const text = feedback.toLowerCase()
  const categories: HarnessFeedbackCategory[] = []
  if (/跑偏|超出范围|只要求|不要多做|wrong scope|out of scope|scope drift/.test(text)) categories.push('scope')
  if (/漏|遗漏|逐条|全量|每一(?:条|项)|覆盖|不完整|missing|omit|full coverage|every item/.test(text)) categories.push('coverage')
  if (/模板|模版|版式|字体|目录|页眉|页脚|template|layout|formatting reference/.test(text)) categories.push('template')
  if (/太浅|不深入|质量差|专业性|可读性|内容少|shallow|weak depth|poor quality|not detailed/.test(text)) categories.push('depth')
  if (/依据|证据|引用|来源|编造|无支撑|evidence|citation|source|unsupported/.test(text)) categories.push('evidence')
  if (/格式|文件类型|docx|pdf|xlsx|markdown|输出类型|wrong format/.test(text)) categories.push('format')
  if (/工具|调用失败|报错|重试|循环|tool|retry|error loop/.test(text)) categories.push('tool')
  return categories.length > 0 ? unique(categories) : ['other']
}

export function validateHarnessPolicyAsset(value: unknown): HarnessPolicyAsset {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Harness policy must be an object')
  const input = value as Record<string, unknown>
  const action = input.action
  if (!action || typeof action !== 'object' || Array.isArray(action)) throw new Error('Harness policy action must be an object')
  const actionRecord = action as Record<string, unknown>
  const type = actionRecord.type
  if (!['stop_retry', 'require_prerequisite', 'suggest_tool_route', 'enforce_artifact_gate'].includes(String(type))) {
    throw new Error(`Unsupported harness policy action: ${String(type)}`)
  }

  const id = typeof input.id === 'string' && input.id.trim() ? input.id.trim() : randomUUID()
  const version = typeof input.version === 'number' && Number.isInteger(input.version) && input.version > 0 ? input.version : 1
  const state = ['draft', 'shadow', 'approved', 'disabled'].includes(String(input.state))
    ? input.state as HarnessPolicyAsset['state']
    : 'draft'
  const conditionInput = input.condition && typeof input.condition === 'object' && !Array.isArray(input.condition)
    ? input.condition as Record<string, unknown>
    : {}
  const condition: HarnessPolicyAsset['condition'] = {
    ...(typeof conditionInput.toolName === 'string' ? { toolName: conditionInput.toolName } : {}),
    ...(typeof conditionInput.failureCategory === 'string' ? { failureCategory: conditionInput.failureCategory as ToolFailureCategory } : {}),
    ...(typeof conditionInput.provider === 'string' ? { provider: conditionInput.provider } : {}),
    ...(typeof conditionInput.model === 'string' ? { model: conditionInput.model } : {}),
    ...(typeof conditionInput.mode === 'string' ? { mode: conditionInput.mode } : {}),
  }
  const normalizedAction = validatePolicyAction(actionRecord)
  const previousVersionHash = typeof input.previousVersionHash === 'string' ? input.previousVersionHash : undefined
  const hash = stableHash({ id, version, state, condition, action: normalizedAction, previousVersionHash })
  return { id, version, state, condition, action: normalizedAction, hash, previousVersionHash }
}

export function evaluatePolicyPromotion(
  _policy: HarnessPolicyAsset,
  suites: {
    target: HarnessRegressionSuiteResult
    heldOut: HarnessRegressionSuiteResult
    protected: HarnessRegressionSuiteResult
  },
): { approved: boolean; reason: 'approved' | 'no_target_improvement' | 'held_out_regression' | 'protected_regression' | 'invalid_suite' } {
  if (![suites.target, suites.heldOut, suites.protected].every(isValidSuite)) {
    return { approved: false, reason: 'invalid_suite' }
  }
  if (suites.target.candidatePassed <= suites.target.baselinePassed) {
    return { approved: false, reason: 'no_target_improvement' }
  }
  if (suites.heldOut.candidatePassed < suites.heldOut.baselinePassed) {
    return { approved: false, reason: 'held_out_regression' }
  }
  if (suites.protected.candidatePassed < suites.protected.baselinePassed
    || suites.protected.candidatePassed !== suites.protected.total) {
    return { approved: false, reason: 'protected_regression' }
  }
  return { approved: true, reason: 'approved' }
}

export function saveHarnessPolicyAsset(workspaceRoot: string, value: unknown): HarnessPolicyAsset {
  const policy = validateHarnessPolicyAsset(value)
  const id = validatePolicyId(policy.id)
  const existing = readPolicyAssets(workspaceRoot).find(item => (
    item.id === id && item.version === policy.version && item.state === policy.state
  ))
  if (existing) {
    if (existing.hash !== policy.hash) {
      throw new Error(`Harness policy ${id} v${policy.version} ${policy.state} already exists with a different hash`)
    }
    return existing
  }
  writeJsonAtomic(policyAssetPath(workspaceRoot, policy), policy)
  return policy
}

export function listApprovedHarnessPolicies(workspaceRoot: string): HarnessPolicyAsset[] {
  const latestById = new Map<string, HarnessPolicyAsset>()
  for (const policy of readPolicyAssets(workspaceRoot).filter(item => item.state === 'approved')) {
    const current = latestById.get(policy.id)
    if (!current || policy.version > current.version) latestById.set(policy.id, policy)
  }
  return [...latestById.values()].sort((left, right) => left.id.localeCompare(right.id))
}

export function promoteHarnessPolicyAsset(
  workspaceRoot: string,
  value: unknown,
  suites: {
    target: HarnessRegressionSuiteResult
    heldOut: HarnessRegressionSuiteResult
    protected: HarnessRegressionSuiteResult
  },
): {
  result: ReturnType<typeof evaluatePolicyPromotion>
  policy?: HarnessPolicyAsset
} {
  const candidate = validateHarnessPolicyAsset(value)
  const result = evaluatePolicyPromotion(candidate, suites)
  if (!result.approved) return { result }
  const approved = saveHarnessPolicyAsset(workspaceRoot, {
    ...candidate,
    state: 'approved',
    previousVersionHash: candidate.hash,
  })
  return { result, policy: approved }
}

export function rollbackHarnessPolicyAsset(
  workspaceRoot: string,
  id: string,
  targetVersion: number,
): HarnessPolicyAsset {
  const policyId = validatePolicyId(id)
  const assets = readPolicyAssets(workspaceRoot).filter(item => item.id === policyId)
  const target = assets
    .filter(item => item.version === targetVersion)
    .sort((left, right) => policyStateRank(right.state) - policyStateRank(left.state))[0]
  if (!target) throw new Error(`Harness policy ${policyId} v${targetVersion} was not found`)
  const current = assets
    .filter(item => item.state === 'approved')
    .sort((left, right) => right.version - left.version)[0]
  if (!current) throw new Error(`Harness policy ${policyId} has no approved version to roll back`)
  const nextVersion = Math.max(...assets.map(item => item.version)) + 1
  return saveHarnessPolicyAsset(workspaceRoot, {
    id: policyId,
    version: nextVersion,
    state: 'approved',
    condition: target.condition,
    action: target.action,
    previousVersionHash: current.hash,
  })
}

export function getHarnessStoreSummary(workspaceRoot: string): {
  routeCount: number
  feedbackCount: number
  regressionCandidateCount: number
} {
  const experience = readExperienceLedger(workspaceRoot)
  const feedback = readFeedbackLedger(workspaceRoot)
  return {
    routeCount: experience.routes.filter(route => route.state === 'verified_advisory').length,
    feedbackCount: feedback.feedback.length,
    regressionCandidateCount: feedback.regressionCases.filter(item => item.state === 'candidate').length,
  }
}

function validatePolicyAction(action: Record<string, unknown>): HarnessPolicyAction {
  switch (action.type) {
    case 'stop_retry': {
      const afterFailures = Number(action.afterFailures)
      if (!Number.isInteger(afterFailures) || afterFailures < 1 || afterFailures > 3) {
        throw new Error('stop_retry afterFailures must be an integer from 1 to 3')
      }
      return { type: 'stop_retry', afterFailures }
    }
    case 'require_prerequisite':
      if (!['guide', 'source_auth', 'attachment'].includes(String(action.prerequisite))) {
        throw new Error('Unsupported harness prerequisite')
      }
      return { type: 'require_prerequisite', prerequisite: action.prerequisite as 'guide' | 'source_auth' | 'attachment' }
    case 'suggest_tool_route':
      if (typeof action.toolName !== 'string' || !Array.isArray(action.requiredInputKeys)
        || !action.requiredInputKeys.every(key => typeof key === 'string')) {
        throw new Error('suggest_tool_route requires toolName and requiredInputKeys')
      }
      return { type: 'suggest_tool_route', toolName: action.toolName, requiredInputKeys: unique(action.requiredInputKeys as string[]).sort() }
    case 'enforce_artifact_gate':
      if (!['boq_coverage', 'template_fidelity', 'citation_integrity'].includes(String(action.gate))) {
        throw new Error('Unsupported harness artifact gate')
      }
      return { type: 'enforce_artifact_gate', gate: action.gate as 'boq_coverage' | 'template_fidelity' | 'citation_integrity' }
    default:
      throw new Error(`Unsupported harness policy action: ${String(action.type)}`)
  }
}

function formatPolicyAction(action: HarnessPolicyAction): string {
  switch (action.type) {
    case 'stop_retry':
      return `stop identical retries after ${action.afterFailures} failures`
    case 'require_prerequisite':
      return `require prerequisite ${action.prerequisite}`
    case 'suggest_tool_route':
      return `prefer ${action.toolName} with fields [${action.requiredInputKeys.join(', ')}]`
    case 'enforce_artifact_gate':
      return `enforce ${action.gate}`
  }
}

function expectedBehaviorsFor(categories: HarnessFeedbackCategory[]): string[] {
  const behaviors = new Set<string>()
  for (const category of categories) {
    if (category === 'scope') behaviors.add('stay_within_explicit_scope')
    if (category === 'coverage') behaviors.add('prove_full_item_coverage')
    if (category === 'template') behaviors.add('preserve_template_fidelity')
    if (category === 'depth') behaviors.add('meet_requested_professional_depth')
    if (category === 'evidence') behaviors.add('cite_verifiable_sources')
    if (category === 'format') behaviors.add('produce_only_requested_formats')
    if (category === 'tool') behaviors.add('use_bounded_verified_tool_route')
    if (category === 'other') behaviors.add('satisfy_explicit_user_correction')
  }
  return [...behaviors]
}

function readExperienceLedger(workspaceRoot: string): HarnessExperienceLedger {
  return readJson(experienceLedgerPath(workspaceRoot), { schemaVersion: 1, routes: [] })
}

function readFeedbackLedger(workspaceRoot: string): HarnessFeedbackLedger {
  return readJson(feedbackLedgerPath(workspaceRoot), { schemaVersion: 1, feedback: [], regressionCases: [] })
}

function experienceLedgerPath(workspaceRoot: string): string {
  return join(workspaceRoot, 'harness', 'experience-ledger.json')
}

function feedbackLedgerPath(workspaceRoot: string): string {
  return join(workspaceRoot, 'harness', 'feedback-ledger.json')
}

function policiesDirectory(workspaceRoot: string): string {
  return join(workspaceRoot, 'harness', 'policies')
}

function policyAssetPath(workspaceRoot: string, policy: HarnessPolicyAsset): string {
  const id = validatePolicyId(policy.id)
  return join(policiesDirectory(workspaceRoot), `${id}.v${policy.version}.${policy.state}.json`)
}

function readPolicyAssets(workspaceRoot: string): HarnessPolicyAsset[] {
  const directory = policiesDirectory(workspaceRoot)
  if (!existsSync(directory)) return []
  return readdirSync(directory)
    .filter(name => name.endsWith('.json'))
    .flatMap(name => {
      try {
        return [validateHarnessPolicyAsset(JSON.parse(readFileSync(join(directory, name), 'utf8')))]
      } catch {
        return []
      }
    })
}

function readJson<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T
  } catch {
    return fallback
  }
}

function writeJsonAtomic(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  renameSync(temporary, path)
}

function validatePolicyId(id: string): string {
  if (!/^[a-z0-9][a-z0-9._-]{0,79}$/i.test(id)) throw new Error('Harness policy id contains unsupported characters')
  return id
}

function policyStateRank(state: HarnessPolicyAsset['state']): number {
  if (state === 'approved') return 4
  if (state === 'shadow') return 3
  if (state === 'draft') return 2
  return 1
}

function hashTaskTokens(text: string): string[] {
  const normalized = text.toLowerCase().replace(/\s+/g, ' ').trim()
  const tokens = new Set<string>()
  for (const match of normalized.matchAll(/[a-z0-9][a-z0-9_.+-]{1,30}/g)) tokens.add(match[0])
  for (const match of normalized.matchAll(/[\u3400-\u9fff]{2,}/g)) {
    const value = match[0]
    for (let index = 0; index < value.length - 1; index += 1) tokens.add(value.slice(index, index + 2))
    for (let index = 0; index < value.length - 2; index += 1) tokens.add(value.slice(index, index + 3))
  }
  return [...tokens].slice(0, 128).map(token => stableHash(token).slice(0, 16)).sort()
}

function taskSimilarity(query: Set<string>, candidate: string[]): number {
  const candidateSet = new Set(candidate)
  const intersection = [...query].filter(token => candidateSet.has(token)).length
  const union = new Set([...query, ...candidateSet]).size
  return union === 0 ? 0 : intersection / union
}

function profileScore(left: HarnessExecutionProfile, right: HarnessExecutionProfile): number {
  let score = 0
  if (left.provider && left.provider === right.provider) score += 0.05
  if (left.model && left.model === right.model) score += 0.05
  if (left.mode && left.mode === right.mode) score += 0.05
  return score
}

function normalizeProfile(profile: HarnessExecutionProfile): HarnessExecutionProfile {
  return {
    ...(profile.provider ? { provider: profile.provider.trim().toLowerCase() } : {}),
    ...(profile.model ? { model: profile.model.trim().toLowerCase() } : {}),
    ...(profile.mode ? { mode: profile.mode.trim().toLowerCase() } : {}),
  }
}

function toRouteHint(route: HarnessRouteRecord): HarnessRouteHint {
  return {
    id: route.id,
    toolName: route.toolName,
    category: route.category,
    requiredInputKeys: route.requiredInputKeys,
    failedAttempts: route.failedAttempts,
    successCount: route.successCount,
  }
}

function sanitizeArtifactRef(value: string): string {
  const normalized = value.replace(/\\/g, '/').trim()
  if (/^(?:[a-z]:\/|\/)/i.test(normalized)) return basename(normalized)
  return normalized.replace(/^\.\//, '').slice(0, 240)
}

function isValidSuite(result: HarnessRegressionSuiteResult): boolean {
  return Number.isInteger(result.total)
    && result.total >= 0
    && Number.isInteger(result.baselinePassed)
    && Number.isInteger(result.candidatePassed)
    && result.baselinePassed >= 0
    && result.candidatePassed >= 0
    && result.baselinePassed <= result.total
    && result.candidatePassed <= result.total
}

function stableHash(value: unknown): string {
  return createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex')
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)]
}
