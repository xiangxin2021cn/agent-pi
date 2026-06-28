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

export interface GoalTurnSnapshot {
  messages: Message[]
  turnStartFinalMessageId?: string
  stoppedReason: 'complete' | 'interrupted' | 'error' | 'timeout'
  now?: number
}

export class GoalController {
  onTurnStopped(goalState: SessionGoalState | undefined, snapshot: GoalTurnSnapshot): GoalControllerDecision {
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
      summary = 'Goal audit failed because the turn did not complete normally.'
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

    const result: SessionGoalAuditResult = {
      iteration,
      status,
      summary,
      missingCriteria,
      evidence,
      createdAt: now,
    }

    const shouldAutoImprove = status === 'uncertain'
      && (goalState.mode === 'auto_improve' || goalState.mode === 'strict_work')
    const hasRemainingIterations = iteration < goalState.maxIterations
    const correctivePrompt = shouldAutoImprove && hasRemainingIterations
      ? buildCorrectivePrompt(goalState, result)
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

function getMessagesAfterFinalAssistant(messages: Message[], turnStartFinalMessageId?: string): Message[] {
  if (!turnStartFinalMessageId) return messages
  const index = messages.findIndex(message => message.id === turnStartFinalMessageId)
  return index === -1 ? messages : messages.slice(index + 1)
}

function buildCorrectivePrompt(goalState: SessionGoalState, result: SessionGoalAuditResult): string {
  const missing = result.missingCriteria.length > 0
    ? result.missingCriteria.map((criterion, index) => `${index + 1}. ${criterion}`).join('\n')
    : '1. Re-check the deliverable against the original objective.'

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
    'Continue from the existing conversation. Improve the actual deliverable, verify the missing criteria, and finish with a concise summary of what changed.',
    '</goal-audit>',
  ].join('\n')
}
