import { describe, expect, test } from 'bun:test'
import { buildBusinessTaskDraft, buildStageHandoffDraft, getBusinessModuleLaunchPreset } from './business-module-launcher.ts'
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

  test('tender stage draft states single parent and runtime-owned children', () => {
    const stage = getBusinessWorkflow('tender').stages.find((entry) => entry.id === 'tender-document-analysis')!
    const draft = buildBusinessTaskDraft('tender', {
      schemaVersion: 1,
      module: 'tender',
      projectId: 'n3',
      name: 'N3',
      rootPath: 'C:/projects/n3',
      workflowId: 'tender-main',
      inputPaths: ['C:/inputs/tender.pdf'],
      createdAt: '2026-07-14T00:00:00.000Z',
      updatedAt: '2026-07-14T00:00:00.000Z',
    }, stage)
    expect(draft).toContain('单一主会话')
    expect(draft).toContain('子会话')
  })

  test('stage handoff draft keeps same chat and forbids free spawn', () => {
    const stage = getBusinessWorkflow('tender').stages.find((entry) => entry.id === 'boq-five-step-pricing')!
    const draft = buildStageHandoffDraft('tender', {
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
    expect(draft).toContain('boq-five-step-pricing')
    expect(draft).toContain('同一条主对话')
    expect(draft).toContain('spawn_session')
    expect(draft).toContain('不要一次打满')
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
    expect(draft).toContain('parent session is the command surface')
    expect(draft).toContain('task_board_path')
    expect(draft).toContain('boq_batch_manifest_path')
    expect(draft).toContain('rewrite child briefs')
    expect(draft).toContain('boq_five_step_pricing')
    expect(draft).toContain('document_analysis')
    expect(draft).not.toContain('Required capabilities: document_analysis, boq_reconciliation')
  })

  test('document analysis stage dispatches exact per-source manifest briefs', () => {
    const stage = getBusinessWorkflow('tender').stages.find((entry) => entry.id === 'tender-document-analysis')!
    const draft = buildBusinessTaskDraft('tender', {
      schemaVersion: 1,
      module: 'tender',
      projectId: 'n3',
      name: 'N3',
      rootPath: 'C:/projects/n3',
      workflowId: 'tender-main',
      inputPaths: ['C:/inputs/tender.pdf'],
      createdAt: '2026-07-14T00:00:00.000Z',
      updatedAt: '2026-07-14T00:00:00.000Z',
    }, stage)

    expect(draft).toContain('parent session is the command surface')
    expect(draft).toContain('document_analysis_batch_manifest_path')
    expect(draft).toContain('at most 4 in flight')
    expect(draft).toContain('document_analysis')
  })

  test('planning stage deterministically activates planning and export skills', () => {
    const stage = getBusinessWorkflow('tender').stages.find((entry) => entry.id === 'planning-and-submission')!
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

    expect(draft).toContain('[skill:tender-schedule-resource-planning]')
    expect(draft).toContain('[skill:construction-schedule-planner]')
  })

  test('stage draft includes exact backend control paths instead of asking the model to discover them', () => {
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
    }, stage, {
      schemaVersion: 1,
      projectId: 'n3',
      stageId: stage.id,
      status: 'running',
      requiredCapabilities: ['document_analysis', 'boq_reconciliation'],
      producedCapabilities: ['boq_five_step_pricing'],
      generatedPacks: ['document_analysis', 'boq_reconciliation'],
      missingItems: [],
      batchProgress: {
        batchType: 'boq_five_step_pricing', itemCount: 80, batchCount: 2, completedBatches: 0,
        missingItemCount: 80, manifestPath: 'C:/projects/n3/.agent-pi/business/tender/n3/boq-batch-manifest.json',
        taskBoardPath: 'C:/projects/n3/.agent-pi/business/tender/n3/orchestration/task-boards/boq-five-step-pricing.json',
        pendingBatches: 0, runningBatches: 2, failedBatches: 0, blockedBatches: 0, tasks: [],
      },
      sourceBoundary: { schemaVersion: 1, projectId: 'n3', generatedAt: '2026-07-16T00:00:00.000Z', registeredCount: 1, missingPaths: [], files: [] },
      updatedAt: '2026-07-16T00:00:00.000Z',
      paths: {
        projectDirectory: 'C:/projects/n3/.agent-pi/business/tender/n3',
        workspacePath: 'C:/projects/n3/.agent-pi/business/tender/n3/tender-workspace.json',
        sourceBoundaryPath: 'C:/projects/n3/.agent-pi/business/tender/n3/source-boundary.json',
        stageStatePath: 'C:/projects/n3/.agent-pi/business/tender/n3/stage-state.json',
        boqBatchManifestPath: 'C:/projects/n3/.agent-pi/business/tender/n3/boq-batch-manifest.json',
        taskBoardPath: 'C:/projects/n3/.agent-pi/business/tender/n3/orchestration/task-boards/boq-five-step-pricing.json',
      },
    })

    expect(draft).toContain('C:/projects/n3/.agent-pi/business/tender/n3/source-boundary.json')
    expect(draft).toContain('C:/projects/n3/.agent-pi/business/tender/n3/boq-batch-manifest.json')
    expect(draft).toContain('C:/projects/n3/.agent-pi/business/tender/n3/orchestration/task-boards/boq-five-step-pricing.json')
    expect(draft).toContain('document_analysis, boq_reconciliation')
  })
})
