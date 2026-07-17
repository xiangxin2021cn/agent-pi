import { describe, expect, test } from 'bun:test'
import type { TenderStageRunRequest, TenderStageRunResultDto } from '@craft-agent/shared/protocol'
import { preflightTenderStageLaunch, startTenderStageLaunch, summarizeTenderStage } from './business-tender-stage.ts'

function result(status: TenderStageRunResultDto['status'], overrides: Partial<TenderStageRunResultDto> = {}): TenderStageRunResultDto {
  return {
    schemaVersion: 1,
    projectId: 'n3',
    stageId: 'boq-five-step-pricing',
    status,
    requiredCapabilities: ['document_analysis', 'boq_reconciliation'],
    producedCapabilities: ['boq_five_step_pricing'],
    generatedPacks: ['document_analysis'],
    missingItems: [],
    sourceBoundary: {
      schemaVersion: 1,
      projectId: 'n3',
      generatedAt: '2026-07-16T00:00:00.000Z',
      registeredCount: 2,
      missingPaths: [],
      files: [],
    },
    updatedAt: '2026-07-16T00:00:00.000Z',
    paths: {
      projectDirectory: 'C:/project/.agent-pi/business/tender/n3',
      workspacePath: 'C:/project/.agent-pi/business/tender/n3/tender-workspace.json',
      sourceBoundaryPath: 'C:/project/.agent-pi/business/tender/n3/source-boundary.json',
      stageStatePath: 'C:/project/.agent-pi/business/tender/n3/stage-state.json',
    },
    ...overrides,
  }
}

describe('Tender Workbench stage launch', () => {
  test('does not start a blocked stage', async () => {
    const calls: TenderStageRunRequest[] = []
    const run = async (request: TenderStageRunRequest) => {
      calls.push(request)
      return result('blocked', { missingItems: ['capability:boq_reconciliation'] })
    }

    const launch = await preflightTenderStageLaunch(run, {
      workspaceRootPath: 'C:/workspace', projectId: 'n3', stageId: 'boq-five-step-pricing',
    })

    expect(launch.ok).toBe(false)
    expect(launch.result.status).toBe('blocked')
    expect(calls.map((call) => call.action)).toEqual(['preflight'])
  })

  test('preflights without starting before the parent session exists', async () => {
    const calls: TenderStageRunRequest[] = []
    const run = async (request: TenderStageRunRequest) => {
      calls.push(request)
      return result(request.action === 'preflight' ? 'ready' : 'running')
    }

    const launch = await preflightTenderStageLaunch(run, {
      workspaceRootPath: 'C:/workspace', projectId: 'n3', stageId: 'boq-five-step-pricing',
    })

    expect(launch.ok).toBe(true)
    expect(launch.result.status).toBe('ready')
    expect(calls.map((call) => call.action)).toEqual(['preflight'])
  })

  test('starts through the backend controller with the visible parent session id', async () => {
    const calls: TenderStageRunRequest[] = []
    const run = async (request: TenderStageRunRequest) => {
      calls.push(request)
      return result('running')
    }

    const launch = await startTenderStageLaunch(run, {
      workspaceRootPath: 'C:/workspace', projectId: 'n3', stageId: 'boq-five-step-pricing',
    }, 'parent-session-1')

    expect(launch.ok).toBe(true)
    expect(calls).toEqual([expect.objectContaining({
      action: 'start',
      parentSessionId: 'parent-session-1',
    })])
  })

  test('summarizes packs, missing items, and BOQ batch progress for the UI', () => {
    const summary = summarizeTenderStage(result('blocked', {
      missingItems: ['boq-batches:incomplete'],
      batchProgress: {
        batchType: 'boq_five_step_pricing',
        itemCount: 81,
        batchCount: 3,
        completedBatches: 2,
        missingItemCount: 27,
        manifestPath: 'C:/project/boq-batch-manifest.json',
        pendingBatches: 0,
        runningBatches: 1,
        failedBatches: 0,
        blockedBatches: 0,
        tasks: [],
      },
    }))

    expect(summary.statusLabel).toBe('阻塞')
    expect(summary.upstreamLabel).toBe('上游能力 1/2')
    expect(summary.sourceLabel).toBe('已登记资料 2 份')
    expect(summary.batchLabel).toBe('批次 2/3 · 运行 1 · 待覆盖 27 项')
    expect(summary.missingLabel).toContain('BOQ 批次未完成')
  })

  test('labels document batches and deterministic merge failures distinctly', () => {
    const summary = summarizeTenderStage(result('blocked', {
      stageId: 'tender-document-analysis',
      missingItems: [
        'document-batches:incomplete',
        'document-merge:missing final document section: requirements-1',
      ],
      batchProgress: {
        batchType: 'document_analysis',
        itemCount: 7,
        batchCount: 7,
        completedBatches: 6,
        missingItemCount: 1,
        manifestPath: 'C:/project/document-analysis-batch-manifest.json',
        pendingBatches: 0,
        runningBatches: 1,
        failedBatches: 0,
        blockedBatches: 0,
        tasks: [],
      },
    }))

    expect(summary.batchLabel).toBe('批次 6/7 · 运行 1 · 待覆盖 1 份资料')
    expect(summary.missingLabel).toContain('资料分析批次未完成')
    expect(summary.missingLabel).toContain('资料分析合并校验失败')
  })
})
