import { createHash } from 'node:crypto'

export type ToolFailureCategory =
  | 'invalid_input'
  | 'missing_prerequisite'
  | 'path'
  | 'range'
  | 'permission'
  | 'timeout'
  | 'output_limit'
  | 'external'
  | 'unknown'

export type ToolRecoveryDecision = 'retry_allowed' | 'change_route' | 'manual_review'

export interface ToolInputShape {
  keys: string[]
  valueKinds: Record<string, string>
}

export interface ToolFailureObservation {
  toolName: string
  category: ToolFailureCategory
  callSignature: string
  inputShape: ToolInputShape
  attempts: number
  decision: ToolRecoveryDecision
  firstFailedAt: number
  lastFailedAt: number
  resolvedAt?: number
}

export interface RecoveredToolRoute {
  toolName: string
  category: ToolFailureCategory
  failedInputShape: ToolInputShape
  successfulInputShape: ToolInputShape
  failedAttempts: number
  recoveredAt: number
}

export interface ToolRecoveryRuntime {
  failuresByCallSignature: Map<string, ToolFailureObservation>
  unresolvedByTool: Map<string, ToolFailureObservation[]>
}

export function createToolRecoveryRuntime(): ToolRecoveryRuntime {
  return {
    failuresByCallSignature: new Map(),
    unresolvedByTool: new Map(),
  }
}

export function classifyToolFailure(result: string): ToolFailureCategory {
  const value = result.replace(/\s+/g, ' ').trim().toLowerCase()
  if (!value) return 'unknown'

  if (/\b(?:401|403)\b|unauthori[sz]ed|api[- ]?key.{0,30}(?:required|missing)|token.{0,30}(?:expired|required|missing)|authentication required|source is disabled|read .{0,30}guide(?:\.md)? first/.test(value)) {
    return 'missing_prerequisite'
  }
  if (/permission denied|eacces|eperm|not permitted|access is denied|拒绝访问|无权限/.test(value)) {
    return 'permission'
  }
  if (/offset.{0,80}(?:beyond|past|outside|out of range)|line.{0,40}(?:beyond|past).{0,40}(?:file|end)|range.{0,30}(?:invalid|outside)|超过文件末尾|超出.*范围/.test(value)) {
    return 'range'
  }
  if (/enoent|no such file|file not found|path not found|cannot find (?:the )?(?:file|path)|系统找不到|找不到指定|does not exist/.test(value)) {
    return 'path'
  }
  if (/validation failed|invalid (?:input|argument|parameter)|must have required propert|missing required (?:field|parameter|property)|expected .{0,40} received|参数.{0,20}(?:错误|缺失)|格式错误/.test(value)) {
    return 'invalid_input'
  }
  if (/timed? out|timeout|deadline exceeded|超时/.test(value)) {
    return 'timeout'
  }
  if (/too (?:large|long)|exceeds?.{0,30}(?:limit|maximum)|payload.{0,30}(?:limit|large)|argument list too long|command line is too long|heredoc.{0,30}too long|truncat|内容太长|输入过长|截断/.test(value)) {
    return 'output_limit'
  }
  if (/\b(?:429|500|502|503|504)\b|rate limit|network error|connection (?:reset|refused)|service unavailable|temporary failure|dns|socket hang up/.test(value)) {
    return 'external'
  }
  return 'unknown'
}

export function createToolCallSignature(toolName: string, input: Record<string, unknown>): string {
  const canonical = canonicalizeForHash(input)
  const digest = createHash('sha256')
    .update(normalizeToolName(toolName))
    .update('\u0000')
    .update(JSON.stringify(canonical))
    .digest('hex')
    .slice(0, 24)
  return `tool_call_${digest}`
}

export function createToolInputShape(input: Record<string, unknown>): ToolInputShape {
  const keys = Object.keys(input).sort()
  return {
    keys,
    valueKinds: Object.fromEntries(keys.map(key => [key, describeValueKind(key, input[key])])),
  }
}

export function registerToolFailure(
  runtime: ToolRecoveryRuntime,
  input: {
    toolName: string
    input: Record<string, unknown>
    result: string
    now?: number
  },
): ToolFailureObservation {
  const now = input.now ?? Date.now()
  const toolName = normalizeToolName(input.toolName)
  const callSignature = createToolCallSignature(toolName, input.input)
  const previous = runtime.failuresByCallSignature.get(callSignature)
  const attempts = (previous?.attempts ?? 0) + 1
  const category = classifyToolFailure(input.result)
  const decision = decideToolRecovery(category, attempts)
  const observation: ToolFailureObservation = {
    toolName,
    category,
    callSignature,
    inputShape: createToolInputShape(input.input),
    attempts,
    decision,
    firstFailedAt: previous?.firstFailedAt ?? now,
    lastFailedAt: now,
  }

  runtime.failuresByCallSignature.set(callSignature, observation)
  const unresolved = (runtime.unresolvedByTool.get(toolName) ?? [])
    .filter(item => item.callSignature !== callSignature && item.resolvedAt === undefined)
  unresolved.push(observation)
  runtime.unresolvedByTool.set(toolName, unresolved.slice(-8))
  return observation
}

export function registerToolSuccess(
  runtime: ToolRecoveryRuntime,
  input: {
    toolName: string
    input: Record<string, unknown>
    now?: number
  },
): RecoveredToolRoute | undefined {
  const toolName = normalizeToolName(input.toolName)
  const successfulSignature = createToolCallSignature(toolName, input.input)
  const unresolved = runtime.unresolvedByTool.get(toolName) ?? []
  const failure = [...unresolved]
    .reverse()
    .find(item => item.resolvedAt === undefined && item.callSignature !== successfulSignature)
  if (!failure) return undefined

  const recoveredAt = input.now ?? Date.now()
  const resolved: ToolFailureObservation = { ...failure, resolvedAt: recoveredAt }
  runtime.failuresByCallSignature.set(failure.callSignature, resolved)
  runtime.unresolvedByTool.set(toolName, unresolved.map(item => (
    item.callSignature === failure.callSignature ? resolved : item
  )))

  return {
    toolName,
    category: failure.category,
    failedInputShape: failure.inputShape,
    successfulInputShape: createToolInputShape(input.input),
    failedAttempts: failure.attempts,
    recoveredAt,
  }
}

export function guardToolRetry(
  runtime: ToolRecoveryRuntime,
  toolName: string,
  input: Record<string, unknown>,
): { action: 'allow' } | { action: 'block'; reason: string } {
  const signature = createToolCallSignature(toolName, input)
  const failure = runtime.failuresByCallSignature.get(signature)
  if (!failure || failure.attempts < 2 || failure.resolvedAt !== undefined) {
    return { action: 'allow' }
  }

  return {
    action: 'block',
    reason: [
      `STOP. This identical ${failure.toolName} call already failed ${failure.attempts} times (${failure.category}).`,
      'Do not repeat the same call again.',
      'Change the input or tool route, use a verified fallback, or ask the user when no safe alternative exists.',
    ].join(' '),
  }
}

function decideToolRecovery(category: ToolFailureCategory, attempts: number): ToolRecoveryDecision {
  if (attempts >= 2) return 'change_route'
  if (category === 'permission') return 'manual_review'
  return 'retry_allowed'
}

function normalizeToolName(toolName: string): string {
  return toolName.trim() || 'unknown'
}

function canonicalizeForHash(value: unknown, key = ''): unknown {
  if (value === null || value === undefined) return value ?? null
  if (Array.isArray(value)) return value.map(item => canonicalizeForHash(item, key))
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([childKey, childValue]) => [childKey, canonicalizeForHash(childValue, childKey)]))
  }
  if (typeof value === 'string' && isSecretKey(key)) {
    return `secret:${createHash('sha256').update(value).digest('hex')}`
  }
  return value
}

function describeValueKind(key: string, value: unknown): string {
  if (isSecretKey(key)) return 'secret'
  if (value === null) return 'null'
  if (Array.isArray(value)) return `array:${sizeBucket(value.length)}`
  if (typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>).sort().slice(0, 12)
    return `object:${keys.join(',')}`
  }
  if (typeof value === 'string') {
    if (looksLikePathKey(key) || /[\\/]/.test(value)) {
      const extension = value.match(/(\.[a-z0-9]{1,10})(?:[?#].*)?$/i)?.[1]?.toLowerCase() ?? ''
      return `path:${extension || 'none'}`
    }
    if (/^https?:\/\//i.test(value)) return 'url'
    if (key.toLowerCase().includes('command')) {
      const verb = value.trim().match(/^["']?([a-z0-9_.-]+)/i)?.[1]?.toLowerCase() ?? 'unknown'
      return `command:${verb}`
    }
    return `string:${sizeBucket(value.length)}`
  }
  return typeof value
}

function isSecretKey(key: string): boolean {
  return /(?:api[-_]?key|token|secret|password|authorization|credential|private[-_]?key)/i.test(key)
}

function looksLikePathKey(key: string): boolean {
  return /(?:^|_)(?:path|file|directory|dir|cwd)(?:$|_)/i.test(key) || /path|filename/i.test(key)
}

function sizeBucket(size: number): string {
  if (size === 0) return 'empty'
  if (size <= 32) return 'small'
  if (size <= 512) return 'medium'
  if (size <= 8_192) return 'large'
  return 'very_large'
}

