import { describe, expect, test } from 'bun:test'
import { getBusinessWorkflow } from './business-workflows.ts'

describe('business workflows', () => {
  test('tender workflow is the controllable pipeline with a writing contract on every stage', () => {
    const workflow = getBusinessWorkflow('tender')
    const stageIds = workflow.stages.map((stage) => stage.id)

    expect(stageIds).toEqual([
      'project-setup',
      'tender-document-analysis',
      'project-boundary-conditions',
      'boq-five-step-pricing',
      'planning-and-submission',
    ])
    expect(workflow.stages.find((stage) => stage.id === 'project-setup')?.label).toBe('项目资料登记')
    expect(workflow.stages.find((stage) => stage.id === 'tender-document-analysis')?.label).toBe('招标文件解析')
    expect(workflow.stages.find((stage) => stage.id === 'tender-document-analysis')?.producesCapabilities)
      .toEqual(['document_analysis', 'boq_reconciliation'])
    expect(workflow.stages.find((stage) => stage.id === 'tender-document-analysis')?.producesCapabilities)
      .not.toContain('evaluation_strategy')
    expect(workflow.stages.find((stage) => stage.id === 'tender-document-analysis')?.skillSlug)
      .toBe('tender-document-parsing')
    expect(workflow.stages.find((stage) => stage.id === 'project-boundary-conditions')?.producesCapabilities)
      .toEqual(['project_boundary'])
    expect(workflow.stages.find((stage) => stage.id === 'project-boundary-conditions')?.dispatchPolicy)
      .toBe('controlled-subagents')
    expect(workflow.stages.find((stage) => stage.id === 'boq-five-step-pricing')?.requiredCapabilities)
      .toEqual(['document_analysis', 'project_boundary'])
    expect(workflow.stages.find((stage) => stage.id === 'boq-five-step-pricing')?.producesCapabilities)
      .toEqual(['boq_five_step_pricing', 'construction_resource_schedule', 'bidder_commitments'])
    expect(workflow.stages.find((stage) => stage.id === 'planning-and-submission')?.requiredCapabilities)
      .toEqual(['boq_five_step_pricing'])
    expect(workflow.stages.find((stage) => stage.id === 'planning-and-submission')?.producesCapabilities)
      .toEqual([
        'execution_plan',
        'schedule_resources',
        'cost_cashflow',
        'submission_documents',
        'submission_audit',
      ])
    expect(workflow.stages.find((stage) => stage.id === 'planning-and-submission')?.prompt)
      .toContain('MS Project')
    expect(workflow.stages.find((stage) => stage.id === 'planning-and-submission')?.prompt)
      .toContain('P6')
    expect(workflow.stages.every((stage) => /专业化写作|去 AI|原术语|本标/.test(stage.prompt)))
      .toBe(true)
  })

  test.each(['tender', 'delivery', 'investment'] as const)('%s has a stable first stage', (moduleId) => {
    const workflow = getBusinessWorkflow(moduleId)
    expect(workflow.id).toBe(`${moduleId}-main`)
    expect(workflow.stages[0]?.id).toBe('project-setup')
  })
})
