import { describe, expect, test } from 'bun:test'
import { getBusinessWorkflow } from './business-workflows.ts'

describe('business workflows', () => {
  test('tender workflow includes methodology and item-by-item five-step pricing', () => {
    const workflow = getBusinessWorkflow('tender')
    const labels = workflow.stages.map((stage) => stage.label)

    expect(labels).toContain('WORK PLAN AND PROPOSED METHODOLOGY')
    expect(labels).toContain('BOQ 逐项五步法成本分解组价')
    expect(workflow.stages.find((stage) => stage.id === 'boq-five-step-pricing')?.prompt)
      .toContain('每一条清单项')
    expect(workflow.stages.find((stage) => stage.id === 'work-plan-methodology')?.skillSlug)
      .toBe('tender-execution-planning')
    expect(workflow.stages.find((stage) => stage.id === 'boq-five-step-pricing')?.skillSlug)
      .toBe('tender-cost-cashflow-planning')
  })

  test.each(['tender', 'delivery', 'investment'] as const)('%s has a stable first stage', (moduleId) => {
    const workflow = getBusinessWorkflow(moduleId)
    expect(workflow.id).toBe(`${moduleId}-main`)
    expect(workflow.stages[0]?.id).toBe('project-setup')
  })
})
