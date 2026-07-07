import { describe, expect, it } from 'bun:test'
import type { SessionGoalState } from '@craft-agent/shared/sessions'
import { getOrchestrationBadgePreview, getOrchestrationInfoViewModel } from './orchestration-view-model'

const t = (key: string, values?: Record<string, unknown>) => {
  if (typeof values?.defaultValue === 'string') {
    return values.defaultValue
      .replace('{{count}}', String(values.count ?? ''))
      .replace('{{sources}}', String(values.sources ?? ''))
  }
  return key
}

function goalState(overrides: Partial<SessionGoalState> = {}): SessionGoalState {
  return {
    id: 'goal-1',
    objective: 'Create a report',
    mode: 'auto_improve',
    status: 'running',
    createdAt: 1,
    updatedAt: 1,
    iteration: 1,
    maxIterations: 3,
    criteria: [],
    auditHistory: [],
    ...overrides,
  }
}

describe('orchestration view model', () => {
  it('returns nothing when orchestration has not been initialized', () => {
    expect(getOrchestrationInfoViewModel(t, goalState())).toBeUndefined()
    expect(getOrchestrationBadgePreview(t, goalState())).toBeUndefined()
  })

  it('summarizes phase, source boundary, task board, sub-agents, and entropy', () => {
    const info = getOrchestrationInfoViewModel(t, goalState({
      orchestration: {
        version: 1,
        phase: 'audit',
        createdAt: 1,
        updatedAt: 2,
        policy: {
          selectedSourceSlugs: ['chapter-1', 'boq'],
          forbidWorkingDirectoryDiscovery: true,
          requireStructuredHandoff: true,
          requireUserConfirmationPause: true,
          maxAutomaticRepairPasses: 2,
        },
        taskBoard: {
          tasks: [
            {
              id: 'task-1',
              title: 'Read selected chapter',
              phase: 'plan',
              role: 'planner',
              status: 'completed',
              scope: 'Chapter 1 only',
              dependencies: [],
              allowedSourceSlugs: ['chapter-1'],
              forbiddenActions: [],
              expectedHandoff: ['Scope confirmation'],
            },
            {
              id: 'task-2',
              title: 'Audit output',
              phase: 'audit',
              role: 'auditor',
              status: 'needs_review',
              scope: 'Check source boundary',
              dependencies: ['task-1'],
              allowedSourceSlugs: ['chapter-1'],
              forbiddenActions: ['scan_workdir'],
              expectedHandoff: ['Audit notes'],
            },
          ],
        },
        subAgents: [
          {
            sessionId: 'sub-1',
            name: 'Chapter auditor',
            taskId: 'task-2',
            status: 'started',
            sourceSlugs: ['chapter-1'],
            createdAt: 1,
            updatedAt: 2,
            expectedHandoff: ['Audit notes'],
          },
        ],
        entropy: {
          level: 'high',
          score: 87,
          reasons: ['too many sub-agents', 'source drift'],
          createdAt: 2,
        },
        ledger: {
          currentTaskId: 'task-2',
          pending: 0,
          running: 0,
          handoffReady: 0,
          completed: 1,
          needsReview: 1,
          blocked: 0,
          cancelled: 0,
          needsUserConfirmation: true,
          evidencePackagePath: 'C:/session/orchestration/evidence-packages/audit-1.json',
          updatedAt: 3,
        },
      },
    }), {
      sourceNameBySlug: new Map([
        ['chapter-1', 'COTO Chapter 1'],
        ['boq', 'BOQ'],
      ]),
    })

    expect(info?.phase).toBe('审查')
    expect(info?.selectedSourceBoundary).toContain('COTO Chapter 1')
    expect(info?.selectedSourceBoundary).toContain('已启用硬边界')
    expect(info?.taskBoardSummary).toBe('2 项任务')
    expect(info?.tasks).toHaveLength(2)
    expect(info?.tasks[1].tone).toBe('warning')
    expect(info?.subAgentSummary).toBe('1 个子智能体')
    expect(info?.subAgents[0].title).toBe('Chapter auditor')
    expect(info?.entropy?.tone).toBe('danger')
    expect(info?.entropy?.detail).toContain('source drift')
    expect(info?.ledger?.summary).toContain('当前 task-2')
    expect(info?.ledger?.summary).toContain('完成 1')
    expect(info?.ledger?.summary).toContain('待确认')
  })

  it('uses the entropy warning as the compact Goal badge hint', () => {
    const preview = getOrchestrationBadgePreview(t, goalState({
      orchestration: {
        version: 1,
        phase: 'merge',
        createdAt: 1,
        updatedAt: 2,
        policy: {
          selectedSourceSlugs: [],
          forbidWorkingDirectoryDiscovery: false,
          requireStructuredHandoff: true,
          requireUserConfirmationPause: false,
          maxAutomaticRepairPasses: 2,
        },
        taskBoard: { tasks: [] },
        subAgents: [],
        entropy: {
          level: 'warning',
          score: 42,
          reasons: ['many handoffs'],
          createdAt: 2,
        },
      },
    }))

    expect(preview?.label).toBe('熵告警')
    expect(preview?.tone).toBe('warning')
  })
})
