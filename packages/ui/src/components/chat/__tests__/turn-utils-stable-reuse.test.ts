import { describe, expect, test } from 'bun:test'
import {
  areActivitiesContentEqual,
  areResponsesContentEqual,
  reuseStableTurns,
  type Turn,
} from '../turn-utils'
import type { ActivityItem, ResponseContent } from '../TurnCard'

function activity(partial: Partial<ActivityItem> & Pick<ActivityItem, 'id'>): ActivityItem {
  return {
    type: 'tool',
    status: 'completed',
    timestamp: 1,
    toolName: 'Read',
    ...partial,
  }
}

describe('reuseStableTurns', () => {
  test('reuses identical completed assistant turns by reference', () => {
    const response: ResponseContent = {
      text: '## done',
      isStreaming: false,
      messageId: 'm1',
    }
    const activities = [activity({ id: 'a1' })]
    const previous: Turn[] = [{
      type: 'assistant',
      turnId: 't1',
      activities,
      response,
      isStreaming: false,
      isComplete: true,
      timestamp: 10,
    }]
    const next: Turn[] = [{
      type: 'assistant',
      turnId: 't1',
      activities: [activity({ id: 'a1' })],
      response: { ...response },
      isStreaming: false,
      isComplete: true,
      timestamp: 10,
    }]

    const stabilized = reuseStableTurns(previous, next)
    expect(stabilized[0]).toBe(previous[0])
  })

  test('keeps nested response ref when only outer turn object is new', () => {
    const response: ResponseContent = {
      text: 'stable markdown body',
      isStreaming: false,
      messageId: 'm2',
    }
    const previous: Turn[] = [{
      type: 'assistant',
      turnId: 't2',
      activities: [activity({ id: 'a1' })],
      response,
      isStreaming: false,
      isComplete: true,
      timestamp: 10,
    }]
    const next: Turn[] = [{
      type: 'assistant',
      turnId: 't2',
      activities: [activity({ id: 'a1' }), activity({ id: 'a2', toolName: 'Write' })],
      response: { ...response },
      isStreaming: false,
      isComplete: true,
      timestamp: 10,
    }]

    const stabilized = reuseStableTurns(previous, next)
    expect(stabilized[0]).not.toBe(previous[0])
    expect(stabilized[0]?.type).toBe('assistant')
    if (stabilized[0]?.type === 'assistant') {
      expect(stabilized[0].response).toBe(response)
      expect(stabilized[0].activities).toHaveLength(2)
    }
  })
})

describe('content equality helpers', () => {
  test('areResponsesContentEqual ignores object identity', () => {
    const a: ResponseContent = { text: 'x', isStreaming: false, messageId: '1' }
    const b: ResponseContent = { text: 'x', isStreaming: false, messageId: '1' }
    expect(areResponsesContentEqual(a, b)).toBe(true)
    expect(areResponsesContentEqual(a, { ...b, text: 'y' })).toBe(false)
  })

  test('areActivitiesContentEqual compares ids and statuses', () => {
    const a = [activity({ id: '1', status: 'completed' })]
    const b = [activity({ id: '1', status: 'completed' })]
    const c = [activity({ id: '1', status: 'running' })]
    expect(areActivitiesContentEqual(a, b)).toBe(true)
    expect(areActivitiesContentEqual(a, c)).toBe(false)
  })
})
