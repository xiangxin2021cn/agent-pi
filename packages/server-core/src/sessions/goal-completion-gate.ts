import type { SessionGoalState } from '@craft-agent/shared/sessions'

export function getAgentSessionStatusGateError(
  goalState: SessionGoalState | undefined,
  requestedStatus: string,
): string | undefined {
  if (requestedStatus !== 'done' || !goalState || goalState.mode === 'off' || goalState.status === 'passed') {
    return undefined
  }

  return `Goal has not passed (current goal status: ${goalState.status}). The agent cannot set session status to done; wait for Goal Audit to pass or leave the task in needs review for the user.`
}
