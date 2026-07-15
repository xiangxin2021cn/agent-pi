import { describe, expect, test } from 'bun:test'
import { buildBusinessTaskDraft, getBusinessModuleLaunchPreset } from './business-module-launcher.ts'
import { getBusinessWorkflow } from './business-workflows.ts'

describe('business module launcher', () => {
  test.each([
    ['tender', 'tender-intelligence-core'],
    ['delivery', 'project-delivery-controls-core'],
    ['investment', 'resource-investment-intelligence-core'],
  ] as const)('%s starts a standard chat with its core skill', (moduleId, skillSlug) => {
    const preset = getBusinessModuleLaunchPreset(moduleId)

    expect(preset.input).toContain(`[skill:${skillSlug}]`)
    expect(preset.input).toContain('user-selected')
    expect(preset.input).toContain('Task:')
    expect(preset.send).toBe(false)
  })

  test('stage draft activates the specialist skill and lists only registered inputs', () => {
    const stage = getBusinessWorkflow('tender').stages.find((entry) => entry.id === 'boq-five-step-pricing')!
    const draft = buildBusinessTaskDraft('tender', {
      schemaVersion: 1,
      module: 'tender',
      projectId: 'n3',
      name: 'N3',
      rootPath: 'C:/projects/n3',
      workflowId: 'tender-main',
      inputPaths: ['C:/inputs/boq.xlsx'],
      createdAt: '2026-07-14T00:00:00.000Z',
      updatedAt: '2026-07-14T00:00:00.000Z',
    }, stage)

    expect(draft).toContain('[skill:tender-intelligence-core]')
    expect(draft).toContain('[skill:tender-boq-five-step-pricing]')
    expect(draft).toContain('C:/inputs/boq.xlsx')
    expect(draft).not.toContain('C:/projects/n3/**')
  })

  test('BOQ five-step stage draft carries controlled sub-agent dispatch contract', () => {
    const stage = getBusinessWorkflow('tender').stages.find((entry) => entry.id === 'boq-five-step-pricing')!
    const draft = buildBusinessTaskDraft('tender', {
      schemaVersion: 1,
      module: 'tender',
      projectId: 'n3',
      name: 'N3',
      rootPath: 'C:/projects/n3',
      workflowId: 'tender-main',
      inputPaths: ['C:/inputs/boq.xlsx', 'C:/inputs/spec.pdf'],
      createdAt: '2026-07-14T00:00:00.000Z',
      updatedAt: '2026-07-14T00:00:00.000Z',
    }, stage)

    expect(draft).toContain('<controlled_subagent_dispatch>')
    expect(draft).toContain('spawn_session')
    expect(draft).toContain('child agents must not call spawn_session')
    expect(draft).toContain('orchestration/briefs')
    expect(draft).toContain('orchestration/reports')
    expect(draft).toContain('boq_five_step_pricing')
    expect(draft).toContain('document_analysis')
    expect(draft).toContain('boq_reconciliation')
  })
})
