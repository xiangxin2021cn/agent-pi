import type { SessionGoalState } from '@craft-agent/shared/sessions'

export function getAgentSessionStatusGateError(
  goalState: SessionGoalState | undefined,
  requestedStatus: string,
): string | undefined {
  if (requestedStatus !== 'done') {
    return undefined
  }

  const orchestration = goalState?.orchestration
  const hasStructuredDelegation = Boolean(orchestration && (
    orchestration.policy.requireStructuredHandoff
    || orchestration.subAgents.some(agent => Boolean(agent.reportPath))
  ))
  const unresolvedStructuredHandoffs = hasStructuredDelegation
    ? orchestration!.subAgents.filter(agent => (
        agent.status !== 'handoff_received'
        && agent.status !== 'completed'
        && agent.status !== 'needs_review'
        && agent.status !== 'failed'
      ))
    : []
  if (unresolvedStructuredHandoffs.length > 0) {
    return `The session still has unresolved structured child handoff(s): ${unresolvedStructuredHandoffs.map(agent => agent.sessionId).join(', ')}. The parent cannot mark the task done or synthesize delegated work; wait for the handoffs or leave the task for user review.`
  }

  if (!goalState || goalState.mode === 'off' || goalState.status === 'passed') {
    return undefined
  }

  return `Goal has not passed (current goal status: ${goalState.status}). The agent cannot set session status to done; wait for Goal Audit to pass or leave the task in needs review for the user.`
}
