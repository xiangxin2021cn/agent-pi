import { describe, expect, it } from 'bun:test'
import type { SessionGoalState } from '@craft-agent/shared/sessions'
import { getGoalAuditViewModels } from './goal-audit-view-model'

function goalState(overrides: Partial<SessionGoalState> = {}): SessionGoalState {
  return {
    id: 'goal-1',
    objective: 'Create a verified deliverable',
    mode: 'auto_improve',
    status: 'needs_review',
    createdAt: 1,
    updatedAt: 1,
    iteration: 4,
    maxIterations: 4,
    criteria: [],
    auditHistory: [],
    ...overrides,
  }
}

describe('goal audit view model', () => {
  it('returns recent audit entries newest first', () => {
    const items = getGoalAuditViewModels(goalState({
      auditHistory: [1, 2, 3, 4].map(iteration => ({
        iteration,
        status: iteration === 4 ? 'fail' : 'uncertain',
        summary: `summary ${iteration}`,
        missingCriteria: [],
        evidence: [],
        createdAt: iteration,
      })),
    }))

    expect(items.map(item => item.iteration)).toEqual([4, 3, 2])
  })

  it('limits long missing criteria and evidence lists for compact display', () => {
    const items = getGoalAuditViewModels(goalState({
      auditHistory: [{
        iteration: 1,
        status: 'uncertain',
        summary: 'needs evidence',
        missingCriteria: ['a', 'b', 'c', 'd'],
        evidence: [
          { type: 'message', label: 'assistant', detail: 'a1' },
          { type: 'file', label: 'Write', detail: '/tmp/report.md' },
          { type: 'tool', label: 'Read', detail: 'source.xlsx' },
          { type: 'system', label: 'reviewer', detail: 'ok' },
          { type: 'test', label: 'typecheck', detail: 'pass' },
        ],
        createdAt: 1,
      }],
    }))

    expect(items[0].missingCriteria).toEqual(['a', 'b', 'c'])
    expect(items[0].hiddenMissingCriteriaCount).toBe(1)
    expect(items[0].evidence).toHaveLength(4)
    expect(items[0].hiddenEvidenceCount).toBe(1)
  })

  it('maps failure categories into compact correction focus chips', () => {
    const items = getGoalAuditViewModels(goalState({
      auditHistory: [{
        iteration: 1,
        status: 'fail',
        summary: 'needs correction',
        missingCriteria: ['Cite sources.'],
        failureCategories: ['evidence_gap', 'verification_gap', 'shallow_output', 'scope_gap', 'tool_failure'],
        evidence: [],
        createdAt: 1,
      }],
    }))

    expect(items[0].failureCategories).toEqual([
      { id: 'evidence_gap', labelKey: 'sessionInfo.goalAuditFailureEvidence' },
      { id: 'verification_gap', labelKey: 'sessionInfo.goalAuditFailureVerification' },
      { id: 'shallow_output', labelKey: 'sessionInfo.goalAuditFailureShallowOutput' },
    ])
    expect(items[0].hiddenFailureCategoryCount).toBe(2)
  })

  it('extracts document expert reports from goal evidence', () => {
    const items = getGoalAuditViewModels(goalState({
      auditHistory: [{
        iteration: 1,
        status: 'fail',
        summary: 'Document quality failed.',
        missingCriteria: ['Document quality audit did not pass.'],
        evidence: [
          { type: 'file', label: 'file_verified', detail: '/tmp/source.pdf' },
          {
            type: 'system',
            label: 'document_quality_report',
            detail: [
              'status: fail',
              'score: 58/70',
              'dimensions: structure=60, evidence=35, numbers=50, specification=45, risk=70',
              'metrics: textLength=320, headings=1, paragraphs=2, citations=0, sourceRefs=0, numericClaims=6, tables=0, placeholders=0',
              'issues:',
              '- 缺少清晰章节结构。',
              '- 没有看到对输入材料的来源标识或引用。',
              'strengths:',
              '- 包含可识别的风险建议。',
            ].join('\n'),
          },
        ],
        createdAt: 1,
      }],
    }))

    expect(items[0].documentExpertReport).toEqual({
      status: 'fail',
      score: 58,
      threshold: 70,
      dimensions: {
        structure: 60,
        evidence: 35,
        numbers: 50,
        specification: 45,
        risk: 70,
      },
      issues: ['缺少清晰章节结构。', '没有看到对输入材料的来源标识或引用。'],
      strengths: ['包含可识别的风险建议。'],
    })
    expect(items[0].evidence.map(item => item.label)).toEqual(['file_verified'])
  })

  it('extracts quality route decisions from goal evidence', () => {
    const items = getGoalAuditViewModels(goalState({
      auditHistory: [{
        iteration: 1,
        status: 'fail',
        summary: 'Council review found repeated evidence gaps.',
        missingCriteria: ['Ground claims in sources.'],
        evidence: [
          { type: 'system', label: 'reviewer', detail: 'status=fail' },
          {
            type: 'system',
            label: 'quality_route',
            detail: 'task=research; roles=acceptance_reviewer,artifact_reviewer,risk_reviewer,research_source_reviewer,route_history_reviewer; models=none; telemetry_roles=acceptance_reviewer; common_gaps=evidence_gap,verification_gap; route_history=pass=1,fail=3,uncertain=0; route_health=degraded; extra_reviewers=1/1',
          },
        ],
        createdAt: 1,
      }],
    }))

    expect(items[0].qualityRoute).toEqual({
      task: 'research',
      health: 'degraded',
      roles: ['acceptance_reviewer', 'artifact_reviewer', 'risk_reviewer', 'research_source_reviewer', 'route_history_reviewer'],
      commonGaps: ['evidence_gap', 'verification_gap'],
      routeHistory: 'pass=1,fail=3,uncertain=0',
      extraReviewersUsed: 1,
      extraReviewersLimit: 1,
      addedRouteHistoryReviewer: true,
    })
    expect(items[0].evidence.map(item => item.label)).toEqual(['reviewer'])
  })

  it('shows degraded route health even when extra learned reviewers are disabled', () => {
    const items = getGoalAuditViewModels(goalState({
      auditHistory: [{
        iteration: 1,
        status: 'uncertain',
        summary: 'Route history is degraded but extra reviewers are budget-disabled.',
        missingCriteria: [],
        evidence: [{
          type: 'system',
          label: 'quality_route',
          detail: 'task=research; roles=acceptance_reviewer,artifact_reviewer,risk_reviewer,research_source_reviewer; models=none; telemetry_roles=acceptance_reviewer; common_gaps=evidence_gap; route_history=pass=0,fail=3,uncertain=0; route_health=degraded; extra_reviewers=0/0',
        }],
        createdAt: 1,
      }],
    }))

    expect(items[0].qualityRoute).toMatchObject({
      health: 'degraded',
      extraReviewersUsed: 0,
      extraReviewersLimit: 0,
      addedRouteHistoryReviewer: false,
    })
  })
})
