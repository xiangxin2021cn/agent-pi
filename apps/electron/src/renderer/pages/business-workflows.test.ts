import { describe, expect, test } from 'bun:test'
import { getBusinessWorkflow } from './business-workflows.ts'

describe('business workflows', () => {
  test('tender workflow is ordered as a dependent tender production pipeline', () => {
    const workflow = getBusinessWorkflow('tender')
    const stageIds = workflow.stages.map((stage) => stage.id)

    expect(stageIds).toEqual([
      'project-setup',
      'tender-document-analysis',
      'boq-five-step-pricing',
      'work-plan-methodology',
      'schedule-resource-planning',
      'cost-cashflow-planning',
      'tender-submission-documents',
      'submission-audit',
    ])
    expect(workflow.stages.find((stage) => stage.id === 'tender-document-analysis')?.producesCapabilities)
      .toEqual(['document_analysis', 'evaluation_strategy', 'boq_reconciliation'])
    expect(workflow.stages.find((stage) => stage.id === 'tender-document-analysis')?.dispatchPolicy)
      .toEqual('controlled-subagents')
    expect(workflow.stages.find((stage) => stage.id === 'boq-five-step-pricing')?.requiredCapabilities)
      .toEqual(['document_analysis', 'boq_reconciliation'])
    expect(workflow.stages.find((stage) => stage.id === 'boq-five-step-pricing')?.producesCapabilities)
      .toEqual(['boq_five_step_pricing'])
    expect(workflow.stages.find((stage) => stage.id === 'boq-five-step-pricing')?.dispatchPolicy)
      .toEqual('controlled-subagents')
    expect(workflow.stages.find((stage) => stage.id === 'work-plan-methodology')?.requiredCapabilities)
      .toEqual(['document_analysis', 'boq_reconciliation', 'boq_five_step_pricing'])
    expect(workflow.stages.find((stage) => stage.id === 'schedule-resource-planning')?.requiredCapabilities)
      .toEqual(['execution_plan', 'boq_five_step_pricing'])
    expect(workflow.stages.find((stage) => stage.id === 'schedule-resource-planning')?.producesCapabilities)
      .toEqual(['schedule_resources'])
    expect(workflow.stages.find((stage) => stage.id === 'schedule-resource-planning')?.skillSlugs)
      .toEqual(['tender-schedule-resource-planning', 'construction-schedule-planner'])
    expect(workflow.stages.find((stage) => stage.id === 'cost-cashflow-planning')?.requiredCapabilities)
      .toEqual(['boq_reconciliation', 'boq_five_step_pricing', 'schedule_resources'])
    expect(workflow.stages.find((stage) => stage.id === 'cost-cashflow-planning')?.producesCapabilities)
      .toEqual(['cost_cashflow'])
    expect(workflow.stages.find((stage) => stage.id === 'cost-cashflow-planning')?.skillSlugs)
      .toEqual(['tender-cost-cashflow-planning'])
    expect(workflow.stages.find((stage) => stage.id === 'tender-submission-documents')?.requiredCapabilities)
      .toEqual(['execution_plan', 'schedule_resources', 'cost_cashflow'])
    expect(workflow.stages.find((stage) => stage.id === 'tender-submission-documents')?.producesCapabilities)
      .toEqual(['submission_documents'])
    expect(workflow.stages.find((stage) => stage.id === 'tender-submission-documents')?.prompt)
      .toContain('WORK PLAN AND PROPOSED METHODOLOGY')
    expect(workflow.stages.find((stage) => stage.id === 'tender-submission-documents')?.prompt)
      .toContain('现金流计划')
    expect(workflow.stages.find((stage) => stage.id === 'work-plan-methodology')?.skillSlug)
      .toBe('tender-execution-planning')
    expect(workflow.stages.find((stage) => stage.id === 'boq-five-step-pricing')?.skillSlug)
      .toBe('tender-boq-five-step-pricing')
  })

  test.each(['tender', 'delivery', 'investment'] as const)('%s has a stable first stage', (moduleId) => {
    const workflow = getBusinessWorkflow(moduleId)
    expect(workflow.id).toBe(`${moduleId}-main`)
    expect(workflow.stages[0]?.id).toBe('project-setup')
  })
})
