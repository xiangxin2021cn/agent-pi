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
})
