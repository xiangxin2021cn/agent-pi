import { describe, expect, test } from 'bun:test'
import { sessionsForBusinessProject } from './business-project-view-model.ts'

describe('business project session tree', () => {
  test('shows only sessions explicitly assigned to the selected module and project', () => {
    const sessions = [
      { id: 't1', lastMessageAt: 20, businessContext: { module: 'tender', projectId: 'n3', workflowId: 'tender-main', stageId: 'project-setup' } },
      { id: 'd1', lastMessageAt: 30, businessContext: { module: 'delivery', projectId: 'n3', workflowId: 'delivery-main', stageId: 'project-setup' } },
      { id: 'legacy', lastMessageAt: 40, workingDirectory: 'C:/n3' },
      { id: 't2', lastMessageAt: 10, businessContext: { module: 'tender', projectId: 'other', workflowId: 'tender-main', stageId: 'project-setup' } },
    ] as const

    expect(sessionsForBusinessProject(sessions, 'tender', 'n3').map((session) => session.id)).toEqual(['t1'])
  })

  test('includes spawned descendants whose project context is inherited through the parent session', () => {
    const sessions = [
      { id: 'parent', lastMessageAt: 10, businessContext: { module: 'tender', projectId: 'n3', workflowId: 'tender-main', stageId: 'boq-pricing' } },
      { id: 'child', lastMessageAt: 20, parentSessionId: 'parent', parentSessionKind: 'spawn' },
      { id: 'grandchild', lastMessageAt: 30, parentSessionId: 'child', parentSessionKind: 'spawn' },
      { id: 'other-parent', lastMessageAt: 40, businessContext: { module: 'tender', projectId: 'other', workflowId: 'tender-main', stageId: 'boq-pricing' } },
      { id: 'other-child', lastMessageAt: 50, parentSessionId: 'other-parent', parentSessionKind: 'spawn' },
    ] as const

    expect(sessionsForBusinessProject(sessions, 'tender', 'n3').map((session) => session.id)).toEqual([
      'grandchild',
      'child',
      'parent',
    ])
  })
})
