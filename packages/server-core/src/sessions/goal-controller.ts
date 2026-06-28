import type { Message } from '@craft-agent/core/types'
import type {
  SessionGoalAuditEvidence,
  SessionGoalAuditResult,
  SessionGoalState,
} from '@craft-agent/shared/sessions'

export type GoalControllerDecision =
  | { action: 'skip' }
  | { action: 'complete'; goalState: SessionGoalState; result: SessionGoalAuditResult }
  | { action: 'needs_review'; goalState: SessionGoalState; result: SessionGoalAuditResult; reason: string }
  | { action: 'continue'; goalState: SessionGoalState; result: SessionGoalAuditResult; prompt: string }

export interface GoalReviewInput {
  goalState: SessionGoalState
  messages: Message[]
  finalAssistant: Message
  result: SessionGoalAuditResult
}

export interface GoalReviewResult {
  status: SessionGoalAuditResult['status']
  summary: string
  missingCriteria?: string[]
  correctivePrompt?: string
  evidence?: SessionGoalAuditEvidence[]
}

export interface GoalTurnSnapshot {
  messages: Message[]
  turnStartFinalMessageId?: string
  stoppedReason: 'complete' | 'interrupted' | 'error' | 'timeout'
  now?: number
  reviewer?: (input: GoalReviewInput) => Promise<GoalReviewResult>
}

export class GoalController {
  async onTurnStopped(goalState: SessionGoalState | undefined, snapshot: GoalTurnSnapshot): Promise<GoalControllerDecision> {
    if (!goalState || goalState.mode === 'off') {
      return { action: 'skip' }
    }

    const now = snapshot.now ?? Date.now()
    const iteration = goalState.iteration + 1
    const turnMessages = getMessagesAfterFinalAssistant(snapshot.messages, snapshot.turnStartFinalMessageId)
    const finalAssistant = [...turnMessages].reverse().find(message =>
      message.role === 'assistant' && !message.isIntermediate && message.content.trim().length > 0
    )
    const errorMessages = turnMessages.filter(message => message.role === 'error')
    const failedTools = turnMessages.filter(message =>
      message.role === 'tool' && (message.toolStatus === 'error' || message.isError === true)
    )

    const evidence: SessionGoalAuditEvidence[] = []
    if (finalAssistant) {
      evidence.push({
        type: 'message',
        label: 'final_assistant_message',
        detail: finalAssistant.id,
      })
    }
    for (const message of turnMessages) {
      if (message.role !== 'tool') continue
      const paths = new Set([
        ...extractFilePaths(message.toolInput),
        ...extractFilePathsFromText(message.toolResult),
      ])
      for (const path of paths) {
        evidence.push({
          type: 'file',
          label: message.toolName ?? 'tool_file',
          detail: path.slice(0, 500),
        })
      }
    }
    for (const message of errorMessages) {
      evidence.push({
        type: 'system',
        label: 'error_message',
        detail: message.content.slice(0, 500),
      })
    }
    for (const message of failedTools) {
      evidence.push({
        type: 'tool',
        label: message.toolName ?? 'tool_error',
        detail: message.toolResult?.slice(0, 500),
      })
    }

    const missingCriteria: string[] = []
    let status: SessionGoalAuditResult['status'] = 'pass'
    let summary = 'Goal audit passed deterministic completion checks.'

    if (snapshot.stoppedReason !== 'complete') {
      status = 'fail'
      missingCriteria.push(`Turn stopped with reason: ${snapshot.stoppedReason}`)
      summary = `Goal audit failed because the turn stopped with reason: ${snapshot.stoppedReason}.`
    }

    if (!finalAssistant) {
      status = 'fail'
      missingCriteria.push('No final assistant response was produced in this turn.')
      summary = 'Goal audit failed because no final assistant response was produced.'
    }

    if (errorMessages.length > 0 || failedTools.length > 0) {
      status = 'fail'
      if (errorMessages.length > 0) missingCriteria.push(`${errorMessages.length} error message(s) were produced.`)
      if (failedTools.length > 0) missingCriteria.push(`${failedTools.length} tool failure(s) were produced.`)
      summary = 'Goal audit failed because this turn produced errors.'
    }

    if (status === 'pass' && goalState.criteria.some(criterion => criterion.required)) {
      status = 'uncertain'
      missingCriteria.push(
        ...goalState.criteria
          .filter(criterion => criterion.required)
          .map(criterion => criterion.text)
      )
      summary = 'Goal audit could not prove all explicit criteria with deterministic checks only.'
    }

    let result: SessionGoalAuditResult = {
      iteration,
      status,
      summary,
      missingCriteria,
      evidence,
      createdAt: now,
    }

    let reviewerFailed = false
    if (status === 'uncertain' && finalAssistant && snapshot.reviewer) {
      try {
        const review = await snapshot.reviewer({
          goalState,
          messages: turnMessages,
          finalAssistant,
          result,
        })
        const reviewMissingCriteria = review.missingCriteria ?? (review.status === 'pass' ? [] : missingCriteria)
        const contradictoryPass = review.status === 'pass' && (reviewMissingCriteria.length > 0 || review.correctivePrompt !== undefined)
        status = contradictoryPass
          ? 'uncertain'
          : review.status
        summary = contradictoryPass
          ? 'Goal reviewer requested more work while marking the result as pass.'
          : review.summary
        result = {
          ...result,
          status,
          summary,
          missingCriteria: reviewMissingCriteria,
          correctivePrompt: review.correctivePrompt,
          evidence: review.evidence ? [...evidence, ...review.evidence] : evidence,
        }
      } catch (error) {
        reviewerFailed = true
        summary = 'Goal reviewer failed; manual review is required.'
        result = {
          ...result,
          status: 'uncertain',
          summary,
          evidence: [
            ...evidence,
            {
              type: 'system',
              label: 'reviewer_error',
              detail: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500),
            },
          ],
        }
      }
    }

    const shouldAutoImprove = !reviewerFailed
      && snapshot.stoppedReason === 'complete'
      && (status === 'uncertain' || (status === 'fail' && finalAssistant !== undefined && errorMessages.length === 0 && failedTools.length === 0))
      && (goalState.mode === 'auto_improve' || goalState.mode === 'strict_work')
    const hasRemainingIterations = iteration < goalState.maxIterations
    const hasRemainingWallClock = goalState.budgets?.maxWallClockMs === undefined
      || now - goalState.createdAt < goalState.budgets.maxWallClockMs
    const correctivePrompt = shouldAutoImprove && hasRemainingIterations && hasRemainingWallClock
      ? result.correctivePrompt ?? buildCorrectivePrompt(goalState, result)
      : undefined
    if (correctivePrompt) {
      result.correctivePrompt = correctivePrompt
    }

    const nextGoalState: SessionGoalState = {
      ...goalState,
      status: status === 'pass' ? 'passed' : correctivePrompt ? 'improving' : 'needs_review',
      iteration,
      updatedAt: now,
      auditHistory: [...goalState.auditHistory, result],
    }

    if (status === 'pass') {
      return { action: 'complete', goalState: nextGoalState, result }
    }

    if (correctivePrompt) {
      return {
        action: 'continue',
        goalState: nextGoalState,
        result,
        prompt: correctivePrompt,
      }
    }

    const reason = shouldAutoImprove && !hasRemainingIterations
      ? `Reached maximum goal iterations (${goalState.maxIterations}); manual review is required.`
      : shouldAutoImprove && !hasRemainingWallClock
      ? `Reached maximum goal wall-clock budget (${goalState.budgets?.maxWallClockMs}ms); manual review is required.`
      : status === 'uncertain'
      ? 'Deterministic audit could not prove the goal criteria.'
      : result.summary

    return {
      action: 'needs_review',
      goalState: nextGoalState,
      result,
      reason,
    }
  }
}

const FILE_PATH_INPUT_KEYS = new Set([
  'file',
  'file_path',
  'file_paths',
  'filepath',
  'filepaths',
  'files',
  'filename',
  'notebook_path',
  'output',
  'output_file',
  'output_files',
  'output_path',
  'output_paths',
  'path',
  'paths',
])

const FILE_PATH_TEXT_PATTERN = /(?:[A-Za-z]:\\[^\s"'<>|]+|\/[^\s"'<>|]+)\.(?:csv|docx?|html?|json|md|pdf|pptx?|txt|xlsx?|xml|yaml|yml)\b/gi
const QUOTED_FILE_PATH_TEXT_PATTERN = /["'`]((?:[A-Za-z]:\\|\/)[^"'`<>|\r\n]+?\.(?:csv|docx?|html?|json|md|pdf|pptx?|txt|xlsx?|xml|yaml|yml))["'`]/gi

function extractFilePaths(value: unknown, key?: string): string[] {
  if (typeof value === 'string') {
    return key && FILE_PATH_INPUT_KEYS.has(key.toLowerCase()) && value.trim()
      ? [value.trim()]
      : []
  }

  if (Array.isArray(value)) {
    return value.flatMap(item => extractFilePaths(item, key))
  }

  if (!value || typeof value !== 'object') {
    return []
  }

  return Object.entries(value as Record<string, unknown>)
    .flatMap(([childKey, childValue]) => extractFilePaths(childValue, childKey))
}

function extractFilePathsFromText(value: unknown): string[] {
  if (typeof value !== 'string' || !value.trim()) {
    return []
  }

  return [...new Set([
    ...[...value.matchAll(QUOTED_FILE_PATH_TEXT_PATTERN)].map(match => match[1]),
    ...[...value.matchAll(FILE_PATH_TEXT_PATTERN)].map(match => match[0]),
  ])]
}

function getMessagesAfterFinalAssistant(messages: Message[], turnStartFinalMessageId?: string): Message[] {
  if (!turnStartFinalMessageId) return messages
  const index = messages.findIndex(message => message.id === turnStartFinalMessageId)
  return index === -1 ? messages : messages.slice(index + 1)
}

function buildCorrectivePrompt(goalState: SessionGoalState, result: SessionGoalAuditResult): string {
  const missing = result.missingCriteria.length > 0
    ? result.missingCriteria.map((criterion, index) => `${index + 1}. ${criterion}`).join('\n')
    : '1. Re-check the deliverable against the original objective.'
  const evidence = result.evidence.length > 0
    ? result.evidence.map((item, index) => {
        const detail = item.detail ? ` - ${item.detail}` : ''
        return `${index + 1}. [${item.type}] ${item.label}${detail}`
      }).join('\n')
    : '(none)'

  return [
    '<goal-audit>',
    'This is an internal goal audit instruction, not a new user request.',
    '',
    'Objective:',
    goalState.objective,
    '',
    'The previous response could not be proven complete.',
    `Audit summary: ${result.summary}`,
    '',
    'Missing or unproven criteria:',
    missing,
    '',
    'Audit evidence:',
    evidence,
    '',
    'Continue from the existing conversation. Improve the actual deliverable, verify the missing criteria, and finish with a concise summary of what changed.',
    '</goal-audit>',
  ].join('\n')
}
