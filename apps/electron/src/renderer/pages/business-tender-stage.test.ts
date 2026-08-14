import { describe, expect, test, beforeAll } from 'bun:test'
import { setupI18n, i18n } from '@craft-agent/shared/i18n'
import type { TenderStageRunResultDto } from '@craft-agent/shared/protocol'
import {
  resolveProjectParentSessionId,
  resolveStageParentSessionId,
  shouldOpenNewParentSession,
  shouldOpenNewProjectParentSession,
  summarizeTenderStage,
} from './business-tender-stage.ts'

beforeAll(async () => {
  setupI18n()
  await i18n.changeLanguage('en')
})

function stubRun(partial: Partial<TenderStageRunResultDto> = {}): TenderStageRunResultDto {
  return {
    schemaVersion: 1,
    projectId: 'p1',
    stageId: 'tender-document-analysis',
    status: 'running',
    requiredCapabilities: [],
    producedCapabilities: [],
    generatedPacks: [],
    missingItems: [],
    sourceBoundary: {
      schemaVersion: 1,
      projectId: 'p1',
      generatedAt: new Date().toISOString(),
      files: [],
      registeredCount: 0,
      missingPaths: [],
    },
    paths: {
      projectDirectory: '',
      workspacePath: '',
      sourceBoundaryPath: '',
      stageStatePath: '',
    },
    updatedAt: new Date().toISOString(),
    ...partial,
  }
}

describe('business tender stage helpers', () => {
  test('parent session reuse helpers', () => {
    expect(shouldOpenNewParentSession(undefined)).toBe(true)
    expect(shouldOpenNewParentSession(stubRun())).toBe(true)
    const withParent = stubRun({
      batchProgress: {
        batchType: 'document_analysis',
        itemCount: 1,
        batchCount: 1,
        completedBatches: 0,
        missingItemCount: 1,
        manifestPath: 'm.json',
        parentSessionId: 'parent-1',
        pendingBatches: 1,
        runningBatches: 0,
        failedBatches: 0,
        blockedBatches: 0,
        tasks: [],
      },
    })
    expect(resolveStageParentSessionId(withParent)).toBe('parent-1')
    expect(shouldOpenNewParentSession(withParent)).toBe(false)
  })

  test('resolveProjectParentSessionId prefers projectParentSessionId across stages', () => {
    const runs = {
      'project-setup': stubRun({
        stageId: 'project-setup',
        projectParentSessionId: 'canon-parent',
      }),
      'boq-five-step-pricing': stubRun({
        stageId: 'boq-five-step-pricing',
        batchProgress: {
          batchType: 'boq_pricing',
          itemCount: 1,
          batchCount: 1,
          completedBatches: 0,
          missingItemCount: 1,
          manifestPath: 'm.json',
          parentSessionId: 'legacy-stage-parent',
          pendingBatches: 1,
          runningBatches: 0,
          failedBatches: 0,
          blockedBatches: 0,
          tasks: [],
        },
      }),
    }
    expect(resolveProjectParentSessionId(runs)).toBe('canon-parent')
    expect(shouldOpenNewProjectParentSession(runs)).toBe(false)
    expect(shouldOpenNewProjectParentSession({})).toBe(true)
  })

  test('summarize formats project-parent mismatch', () => {
    const summary = summarizeTenderStage(stubRun({
      missingItems: ['project-parent:mismatch:parent-x'],
    }))
    expect(summary.missingLabel).toContain('project chat')
    expect(summary.missingLabel).toContain('parent-x')
  })

  test('summarize formats document-review missing items', () => {
    const summary = summarizeTenderStage(stubRun({
      missingItems: ['document-review:pending:book1', 'document-review:missing-md:book2'],
    }))
    expect(summary.missingLabel).toContain('Parse draft awaiting review: book1')
    expect(summary.missingLabel).toContain('Missing readable parse MD: book2')
  })

  test('summarize formats project boundary confirmation and parse gates', () => {
    const summary = summarizeTenderStage(stubRun({
      missingItems: ['project_boundary:unconfirmed', 'project_boundary:parse-incomplete'],
    }))
    expect(summary.missingLabel).toContain('not human-confirmed')
    expect(summary.missingLabel).toContain('Boundary-source parse batches are incomplete')
  })

  test('summarize formats project characteristics evidence gap', () => {
    const summary = summarizeTenderStage(stubRun({
      missingItems: ['project-characteristics:evidence-gap'],
    }))
    expect(summary.missingLabel).toContain('upload and re-parse')
    expect(summary.missingLabel).toContain('force-pass')
  })

  test('summarize formats planning-substep missing items', () => {
    const summary = summarizeTenderStage(stubRun({
      stageId: 'planning-and-submission',
      missingItems: ['planning-substep:plan-methodology:methodology-review:pending'],
    }))
    expect(summary.missingLabel).toContain('4-A Methodology')
    expect(summary.missingLabel).toContain('methodology-review:pending')
  })

  test('summarize uses Chinese copy when the UI language is zh-Hans', async () => {
    await i18n.changeLanguage('zh-Hans')
    try {
      const summary = summarizeTenderStage(stubRun({
        missingItems: ['project-characteristics:evidence-gap'],
      }))
      expect(summary.missingLabel).toContain('补传并重新解析')
      expect(summary.missingLabel).toContain('强制放行')
    } finally {
      await i18n.changeLanguage('en')
    }
  })
})
