import { describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  evaluatePolicyPromotion,
  getReusableRouteHints,
  listApprovedHarnessPolicies,
  promoteHarnessPolicyAsset,
  recordQualityFeedback,
  recordRecoveredToolRoute,
  rollbackHarnessPolicyAsset,
  saveHarnessPolicyAsset,
  validateHarnessPolicyAsset,
} from './harness-learning.ts'

describe('workspace harness learning', () => {
  test('reuses a recovered route for a similar task without persisting source values', () => {
    const root = mkdtempSync(join(tmpdir(), 'agent-pi-harness-'))
    try {
      recordRecoveredToolRoute(root, {
        sessionId: 'session-a',
        taskText: '逐条读取 BOQ 清单并生成五步法成本推导',
        profile: { provider: 'claude-protocol', model: 'deepseek-v4', mode: 'multi_agent_deep' },
        toolName: 'Read',
        category: 'range',
        failedInputShape: { keys: ['file_path', 'offset', 'limit'], valueKinds: { file_path: 'path:.md', offset: 'number', limit: 'number' } },
        successfulInputShape: { keys: ['file_path', 'offset', 'limit'], valueKinds: { file_path: 'path:.md', offset: 'number', limit: 'number' } },
        failedAttempts: 1,
        traceRef: 'session-a:tool-4',
        now: 100,
      })

      const hints = getReusableRouteHints(root, {
        taskText: '对 BOQ 每条清单进行完整五步法组价推导',
        profile: { provider: 'claude-protocol', model: 'deepseek-v4', mode: 'multi_agent_deep' },
        limit: 3,
      })

      expect(hints).toHaveLength(1)
      expect(hints[0]).toMatchObject({ toolName: 'Read', category: 'range' })
      const persisted = readFileSync(join(root, 'harness', 'experience-ledger.json'), 'utf8')
      expect(persisted).not.toContain('BOQ 清单')
      expect(persisted).not.toContain('session-a:tool-4')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('turns explicit user corrections into deduplicated regression candidates', () => {
    const root = mkdtempSync(join(tmpdir(), 'agent-pi-feedback-'))
    try {
      const first = recordQualityFeedback(root, {
        sessionId: 'session-b',
        projectScope: 'project-hash',
        originalTask: '按模板逐条推导全部 BOQ 清单',
        feedback: '没有按模板写，而且漏了很多 BOQ 清单项，必须逐条全量推导。',
        artifactRefs: ['output/report.md'],
        now: 200,
      })
      const duplicate = recordQualityFeedback(root, {
        sessionId: 'session-b',
        projectScope: 'project-hash',
        originalTask: '按模板逐条推导全部 BOQ 清单',
        feedback: '没有按模板写，而且漏了很多 BOQ 清单项，必须逐条全量推导。',
        artifactRefs: ['output/report.md'],
        now: 300,
      })

      expect(first.feedback.categories).toEqual(expect.arrayContaining(['template', 'coverage']))
      expect(first.regressionCase.expectedBehaviors).toEqual(expect.arrayContaining([
        'preserve_template_fidelity',
        'prove_full_item_coverage',
      ]))
      expect(duplicate.created).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('rejects executable policy actions and promotes only without held-out or protected regression', () => {
    expect(() => validateHarnessPolicyAsset({
      id: 'bad-policy',
      version: 1,
      state: 'draft',
      condition: { toolName: 'Bash', failureCategory: 'unknown' },
      action: { type: 'run_command', command: 'rm -rf .' },
    })).toThrow('Unsupported harness policy action')

    const policy = validateHarnessPolicyAsset({
      id: 'safe-policy',
      version: 1,
      state: 'shadow',
      condition: { toolName: 'Read', failureCategory: 'range' },
      action: { type: 'stop_retry', afterFailures: 2 },
    })

    expect(evaluatePolicyPromotion(policy, {
      target: { baselinePassed: 2, candidatePassed: 4, total: 4 },
      heldOut: { baselinePassed: 3, candidatePassed: 3, total: 3 },
      protected: { baselinePassed: 5, candidatePassed: 5, total: 5 },
    }).approved).toBe(true)

    expect(evaluatePolicyPromotion(policy, {
      target: { baselinePassed: 2, candidatePassed: 4, total: 4 },
      heldOut: { baselinePassed: 3, candidatePassed: 2, total: 3 },
      protected: { baselinePassed: 5, candidatePassed: 5, total: 5 },
    })).toMatchObject({ approved: false, reason: 'held_out_regression' })
  })

  test('persists only validated policies and supports regression-gated promotion plus rollback', () => {
    const root = mkdtempSync(join(tmpdir(), 'agent-pi-policy-'))
    try {
      const shadow = saveHarnessPolicyAsset(root, {
        id: 'read-range-route',
        version: 1,
        state: 'shadow',
        condition: { toolName: 'Read', failureCategory: 'range' },
        action: { type: 'stop_retry', afterFailures: 2 },
      })
      expect(listApprovedHarnessPolicies(root)).toHaveLength(0)

      const promoted = promoteHarnessPolicyAsset(root, shadow, {
        target: { baselinePassed: 2, candidatePassed: 4, total: 4 },
        heldOut: { baselinePassed: 3, candidatePassed: 3, total: 3 },
        protected: { baselinePassed: 5, candidatePassed: 5, total: 5 },
      })
      expect(promoted.result).toMatchObject({ approved: true, reason: 'approved' })
      expect(listApprovedHarnessPolicies(root)).toHaveLength(1)

      const rolledBack = rollbackHarnessPolicyAsset(root, 'read-range-route', 1)
      expect(rolledBack.version).toBe(2)
      expect(rolledBack.state).toBe('approved')
      expect(rolledBack.previousVersionHash).toBe(promoted.policy?.hash)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
