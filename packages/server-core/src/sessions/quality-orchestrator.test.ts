import { describe, expect, it } from 'bun:test'
import type { Message } from '@craft-agent/core/types'
import type { SessionGoalState } from '@craft-agent/shared/sessions'
import type { LLMQueryRequest, LLMQueryResult } from '@craft-agent/shared/agent/llm-tool'
import { runGoalQualityCouncilReview } from './quality-orchestrator'

function message(id: string, role: Message['role'], content: string): Message {
  return {
    id,
    role,
    content,
    timestamp: 1,
  }
}

function goal(): SessionGoalState {
  return {
    id: 'goal-1',
    objective: 'Create a complete risk report',
    mode: 'auto_improve',
    status: 'running',
    createdAt: 1,
    updatedAt: 1,
    iteration: 0,
    maxIterations: 2,
    criteria: [{
      id: 'crit-1',
      text: 'The report must include source citations.',
      kind: 'evidence',
      required: true,
    }],
    auditHistory: [],
  }
}

describe('runGoalQualityCouncilReview', () => {
  it('runs bounded read-only reviewer roles and records role provenance evidence', async () => {
    const requests: LLMQueryRequest[] = []
    const clockValues = [1000, 1010, 2000, 2035, 3000, 3020]
    const queryLlm = async (request: LLMQueryRequest): Promise<LLMQueryResult> => {
      requests.push(request)
      if (request.prompt.includes('artifact_reviewer')) {
        return {
          text: JSON.stringify({
            status: 'fail',
            summary: 'Artifact reviewer found missing source citations.',
            missingCriteria: ['The report must include source citations.'],
            failureCategories: ['evidence_gap', 'verification_gap'],
            correctivePrompt: 'Add source citations to the report.',
          }),
          model: 'local-artifact-reviewer',
          inputTokens: 123,
          outputTokens: 45,
        }
      }
      return {
        text: JSON.stringify({
          status: 'pass',
          summary: 'Reviewer did not find additional gaps.',
          missingCriteria: [],
        }),
        model: 'local-reviewer',
      }
    }

    const result = await runGoalQualityCouncilReview({
      input: {
        goalState: goal(),
        messages: [
          message('u1', 'user', 'write a report'),
          message('a1', 'assistant', 'Report complete.'),
        ],
        finalAssistant: message('a1', 'assistant', 'Report complete.'),
        result: {
          iteration: 1,
          status: 'uncertain',
          summary: 'Deterministic audit could not prove source citations.',
          missingCriteria: ['The report must include source citations.'],
          evidence: [],
          createdAt: 1,
        },
      },
      queryLlm,
      now: () => clockValues.shift() ?? 9999,
    })

    expect(requests).toHaveLength(3)
    expect(requests.every(request => request.temperature === 0)).toBe(true)
    expect(requests.every(request => request.maxTokens === 1200)).toBe(true)
    expect(result.status).toBe('fail')
    expect(result.missingCriteria).toEqual(['The report must include source citations.'])
    expect(result.failureCategories).toEqual(['evidence_gap', 'verification_gap'])
    expect(result.correctivePrompt).toBe('Add source citations to the report.')
    expect(requests.some(request =>
      JSON.stringify(request.outputSchema).includes('failureCategories')
    )).toBe(true)
    expect(result.evidence?.some(item =>
      item.type === 'system'
      && item.label === 'quality_role_artifact_reviewer'
      && item.detail?.includes('model=local-artifact-reviewer')
      && item.detail?.includes('status=fail')
      && item.detail?.includes('categories=evidence_gap,verification_gap')
      && item.detail?.includes('latency_ms=')
      && item.detail?.includes('input_tokens=123')
      && item.detail?.includes('output_tokens=45')
    )).toBe(true)
  })

  it('keeps council review usable when one reviewer returns malformed JSON', async () => {
    const queryLlm = async (request: LLMQueryRequest): Promise<LLMQueryResult> => {
      if (request.prompt.includes('acceptance_reviewer')) {
        return {
          text: 'not-json',
          model: 'local-brittle-reviewer',
        }
      }
      return {
        text: JSON.stringify({
          status: 'pass',
          summary: 'Reviewer did not find additional gaps.',
          missingCriteria: [],
        }),
        model: 'local-reviewer',
      }
    }

    const result = await runGoalQualityCouncilReview({
      input: {
        goalState: goal(),
        messages: [
          message('u1', 'user', 'write a report'),
          message('a1', 'assistant', 'Report complete.'),
        ],
        finalAssistant: message('a1', 'assistant', 'Report complete.'),
        result: {
          iteration: 1,
          status: 'uncertain',
          summary: 'Deterministic audit could not prove source citations.',
          missingCriteria: ['The report must include source citations.'],
          failureCategories: ['evidence_gap'],
          evidence: [],
          createdAt: 1,
        },
      },
      queryLlm,
    })

    expect(result.status).toBe('uncertain')
    expect(result.missingCriteria).toEqual(['The report must include source citations.'])
    expect(result.failureCategories).toEqual(['evidence_gap'])
    expect(result.summary).toContain('acceptance_reviewer')
    expect(result.summary).toContain('invalid JSON')
    expect(result.evidence?.some(item =>
      item.type === 'system'
      && item.label === 'quality_role_acceptance_reviewer'
      && item.detail?.includes('model=local-brittle-reviewer')
      && item.detail?.includes('status=uncertain')
      && item.detail?.includes('invalid JSON')
    )).toBe(true)
  })

  it('includes task contract and prior audit history in every reviewer prompt', async () => {
    const requests: LLMQueryRequest[] = []
    const reviewedGoal = goal()
    reviewedGoal.taskContract = {
      originalRequest: 'Create a complete risk report with a source appendix.',
      taskType: 'document',
      deliverables: ['Risk report with source appendix'],
      mustPreserve: ['Explicit requirement: include source appendix'],
      evidenceRequirements: ['Cite source.xlsx for each material risk.'],
      outputFormats: ['MD'],
      acceptanceCriteria: ['[evidence] The report must include source citations.'],
      forbiddenShortcuts: ['Do not replace the report with a short outline.'],
      workingDirectory: 'C:\\work\\risk',
    }
    reviewedGoal.auditHistory = [{
      iteration: 1,
      status: 'fail',
      summary: 'Previous pass reduced the report to an outline.',
      missingCriteria: ['Restore full report scope.'],
      failureCategories: ['scope_gap'],
      evidence: [],
      createdAt: 1,
    }]
    const queryLlm = async (request: LLMQueryRequest): Promise<LLMQueryResult> => {
      requests.push(request)
      return {
        text: JSON.stringify({
          status: 'pass',
          summary: 'Reviewer did not find additional gaps.',
          missingCriteria: [],
        }),
        model: 'local-reviewer',
      }
    }

    await runGoalQualityCouncilReview({
      input: {
        goalState: reviewedGoal,
        messages: [
          message('u1', 'user', 'write a report'),
          message('a1', 'assistant', 'Report complete.'),
        ],
        finalAssistant: message('a1', 'assistant', 'Report complete.'),
        result: {
          iteration: 2,
          status: 'uncertain',
          summary: 'Deterministic audit could not prove source citations.',
          missingCriteria: ['The report must include source citations.'],
          failureCategories: ['evidence_gap'],
          evidence: [],
          createdAt: 2,
        },
      },
      queryLlm,
    })

    expect(requests).toHaveLength(3)
    expect(requests.every(request => request.prompt.includes('Task contract:'))).toBe(true)
    expect(requests.every(request => request.prompt.includes('Do not replace the report with a short outline.'))).toBe(true)
    expect(requests.every(request => request.prompt.includes('Previous goal audits:'))).toBe(true)
    expect(requests.every(request => request.prompt.includes('Iteration 1: fail - Previous pass reduced the report to an outline.'))).toBe(true)
    expect(requests.every(request => request.prompt.includes('Missing: Restore full report scope.'))).toBe(true)
  })

  it('includes reviewer performance memory in every reviewer prompt', async () => {
    const requests: LLMQueryRequest[] = []
    const queryLlm = async (request: LLMQueryRequest): Promise<LLMQueryResult> => {
      requests.push(request)
      return {
        text: JSON.stringify({
          status: 'pass',
          summary: 'Reviewer did not find additional gaps.',
          missingCriteria: [],
        }),
        model: 'local-reviewer',
      }
    }

    await runGoalQualityCouncilReview({
      input: {
        goalState: goal(),
        messages: [
          message('u1', 'user', 'write a report'),
          message('a1', 'assistant', 'Report complete.'),
        ],
        finalAssistant: message('a1', 'assistant', 'Report complete.'),
        result: {
          iteration: 1,
          status: 'uncertain',
          summary: 'Deterministic audit could not prove source citations.',
          missingCriteria: ['The report must include source citations.'],
          evidence: [],
          createdAt: 1,
        },
        reviewerPerformanceMemory: 'artifact_reviewer via cheap-artifact-reviewer: fail evidence_gap',
      },
      queryLlm,
    })

    expect(requests).toHaveLength(3)
    expect(requests.every(request => request.prompt.includes('Reviewer performance memory:'))).toBe(true)
    expect(requests.every(request => request.prompt.includes('artifact_reviewer via cheap-artifact-reviewer: fail evidence_gap'))).toBe(true)
  })

  it('includes recent user and tool context in every reviewer prompt', async () => {
    const requests: LLMQueryRequest[] = []
    const queryLlm = async (request: LLMQueryRequest): Promise<LLMQueryResult> => {
      requests.push(request)
      return {
        text: JSON.stringify({
          status: 'pass',
          summary: 'Reviewer did not find additional gaps.',
          missingCriteria: [],
        }),
        model: 'local-reviewer',
      }
    }

    await runGoalQualityCouncilReview({
      input: {
        goalState: goal(),
        messages: [
          message('u1', 'user', 'Write a report and run typecheck before finishing.'),
          {
            id: 't1',
            role: 'tool',
            content: '',
            timestamp: 2,
            toolName: 'typecheck',
            toolStatus: 'completed',
            toolResult: 'typecheck passed with 0 errors',
          },
          message('a1', 'assistant', 'Report complete.'),
        ],
        finalAssistant: message('a1', 'assistant', 'Report complete.'),
        result: {
          iteration: 1,
          status: 'uncertain',
          summary: 'Deterministic audit could not prove source citations.',
          missingCriteria: ['The report must include source citations.'],
          evidence: [],
          createdAt: 1,
        },
      },
      queryLlm,
    })

    expect(requests).toHaveLength(3)
    expect(requests.every(request => request.prompt.includes('Recent turn context:'))).toBe(true)
    expect(requests.every(request => request.prompt.includes('user: Write a report and run typecheck before finishing.'))).toBe(true)
    expect(requests.every(request => request.prompt.includes('tool typecheck (completed): typecheck passed with 0 errors'))).toBe(true)
  })

  it('applies artifact-aware reviewer rules to every council role', async () => {
    const requests: LLMQueryRequest[] = []
    const queryLlm = async (request: LLMQueryRequest): Promise<LLMQueryResult> => {
      requests.push(request)
      return {
        text: JSON.stringify({
          status: 'pass',
          summary: 'Reviewer did not find additional gaps.',
          missingCriteria: [],
        }),
        model: 'local-reviewer',
      }
    }

    await runGoalQualityCouncilReview({
      input: {
        goalState: goal(),
        messages: [
          message('u1', 'user', 'write a report from source.xlsx'),
          message('a1', 'assistant', 'Report complete.'),
        ],
        finalAssistant: message('a1', 'assistant', 'Report complete.'),
        result: {
          iteration: 1,
          status: 'uncertain',
          summary: 'Deterministic audit found source and output previews.',
          missingCriteria: ['The report must include source citations.'],
          evidence: [
            {
              type: 'file',
              label: 'output_artifact_preview',
              detail: 'C:\\work\\report.md\nReport body',
            },
            {
              type: 'file',
              label: 'source_file_preview',
              detail: 'C:\\work\\source.xlsx\nSource data',
            },
          ],
          createdAt: 1,
        },
      },
      queryLlm,
    })

    expect(requests).toHaveLength(3)
    expect(requests.every(request =>
      request.prompt.includes('When verified file previews are present, judge the artifact content instead of relying only on the final response.')
    )).toBe(true)
    expect(requests.every(request =>
      request.prompt.includes('When source_file_preview evidence is present, use it as source material for grounding and citation checks, not as proof that a requested output file was produced.')
    )).toBe(true)
    expect(requests.every(request =>
      request.prompt.includes('When status is "pass", missingCriteria must be [] and correctivePrompt must be omitted.')
    )).toBe(true)
    expect(requests.every(request =>
      request.prompt.includes('If any criterion is missing or any correctivePrompt is needed, status must not be "pass".')
    )).toBe(true)
  })

  it('adds a source-focused reviewer for research task contracts', async () => {
    const requests: LLMQueryRequest[] = []
    const reviewedGoal = goal()
    reviewedGoal.taskContract = {
      originalRequest: 'Deeply research Hermes Agent and MoA for the 1.1.3 plan.',
      taskType: 'research',
      deliverables: ['Sourced research result'],
      mustPreserve: [],
      evidenceRequirements: ['Ground research claims in cited sources or clearly mark unavailable evidence and assumptions.'],
      outputFormats: [],
      acceptanceCriteria: ['[evidence] Ground key facts in source material.'],
      forbiddenShortcuts: ['Do not invent facts.'],
    }
    const queryLlm = async (request: LLMQueryRequest): Promise<LLMQueryResult> => {
      requests.push(request)
      return {
        text: JSON.stringify({
          status: 'pass',
          summary: 'Reviewer did not find additional gaps.',
          missingCriteria: [],
        }),
        model: 'local-reviewer',
      }
    }

    await runGoalQualityCouncilReview({
      input: {
        goalState: reviewedGoal,
        messages: [
          message('u1', 'user', 'research Hermes Agent and MoA'),
          message('a1', 'assistant', 'Research complete.'),
        ],
        finalAssistant: message('a1', 'assistant', 'Research complete.'),
        result: {
          iteration: 1,
          status: 'uncertain',
          summary: 'Deterministic audit needs source review.',
          missingCriteria: ['Ground key facts in source material.'],
          evidence: [],
          createdAt: 1,
        },
      },
      queryLlm,
    })

    expect(requests).toHaveLength(4)
    expect(requests.some(request => request.prompt.includes('Role: research_source_reviewer'))).toBe(true)
    expect(requests.find(request => request.prompt.includes('Role: research_source_reviewer'))?.prompt)
      .toContain('Check cited sources, unsupported claims, assumptions, and unresolved questions.')
  })

  it('records deterministic quality route evidence for task-specific council reviews', async () => {
    const reviewedGoal = goal()
    reviewedGoal.taskContract = {
      originalRequest: 'Deeply research Hermes Agent and MoA for the 1.1.3 plan.',
      taskType: 'research',
      deliverables: ['Sourced research result'],
      mustPreserve: [],
      evidenceRequirements: ['Ground research claims in cited sources.'],
      outputFormats: [],
      acceptanceCriteria: ['[evidence] Ground key facts in source material.'],
      forbiddenShortcuts: ['Do not invent facts.'],
    }
    const queryLlm = async (): Promise<LLMQueryResult> => ({
      text: JSON.stringify({
        status: 'pass',
        summary: 'Reviewer did not find additional gaps.',
        missingCriteria: [],
      }),
      model: 'local-reviewer',
    })

    const result = await runGoalQualityCouncilReview({
      input: {
        goalState: reviewedGoal,
        reviewerPerformanceMemory: [
          'Reviewer performance aggregates:',
          'task=research role=research_source_reviewer total=3 pass=1 fail=2 uncertain=0 common_gaps=evidence_gap avg_latency=50ms',
          '',
          'Quality route outcome aggregates:',
          'task=research total=2 pass=1 fail=1 uncertain=0 roles=acceptance_reviewer,artifact_reviewer,risk_reviewer,research_source_reviewer models=research_source_reviewer:source-model-a common_gaps=evidence_gap',
          '',
          'Recent reviewer facts:',
          'research_source_reviewer via source-model-a: pass task=research latency=50ms - Sources were grounded.',
        ].join('\n'),
        messages: [
          message('u1', 'user', 'research Hermes Agent and MoA'),
          message('a1', 'assistant', 'Research complete.'),
        ],
        finalAssistant: message('a1', 'assistant', 'Research complete.'),
        result: {
          iteration: 1,
          status: 'uncertain',
          summary: 'Deterministic audit needs source review.',
          missingCriteria: ['Ground key facts in source material.'],
          failureCategories: ['evidence_gap'],
          evidence: [],
          createdAt: 1,
        },
      },
      queryLlm,
    })

    expect(result.evidence?.some(item =>
      item.type === 'system'
      && item.label === 'quality_route'
      && item.detail?.includes('task=research')
      && item.detail?.includes('roles=acceptance_reviewer,artifact_reviewer,risk_reviewer,research_source_reviewer')
      && item.detail?.includes('telemetry_roles=research_source_reviewer')
      && item.detail?.includes('common_gaps=evidence_gap')
      && item.detail?.includes('route_history=total:2,pass:1,fail:1,uncertain:0')
    )).toBe(true)
  })

  it('adds a route-history reviewer when local route history is degraded', async () => {
    const requests: LLMQueryRequest[] = []
    const reviewedGoal = goal()
    reviewedGoal.taskContract = {
      originalRequest: 'Deeply research Hermes Agent and MoA for the 1.1.3 plan.',
      taskType: 'research',
      deliverables: ['Sourced research result'],
      mustPreserve: [],
      evidenceRequirements: ['Ground research claims in cited sources.'],
      outputFormats: [],
      acceptanceCriteria: ['[evidence] Ground key facts in source material.'],
      forbiddenShortcuts: ['Do not invent facts.'],
    }
    const queryLlm = async (request: LLMQueryRequest): Promise<LLMQueryResult> => {
      requests.push(request)
      return {
        text: JSON.stringify({
          status: 'pass',
          summary: 'Reviewer did not find additional gaps.',
          missingCriteria: [],
        }),
        model: 'local-reviewer',
      }
    }

    const result = await runGoalQualityCouncilReview({
      input: {
        goalState: reviewedGoal,
        reviewerPerformanceMemory: [
          'Quality route outcome aggregates:',
          'task=research total=3 pass=0 fail=3 uncertain=0 roles=acceptance_reviewer,artifact_reviewer,risk_reviewer,research_source_reviewer models=research_source_reviewer:source-model-a common_gaps=evidence_gap',
        ].join('\n'),
        messages: [
          message('u1', 'user', 'research Hermes Agent and MoA'),
          message('a1', 'assistant', 'Research complete.'),
        ],
        finalAssistant: message('a1', 'assistant', 'Research complete.'),
        result: {
          iteration: 1,
          status: 'uncertain',
          summary: 'Deterministic audit needs source review.',
          missingCriteria: ['Ground key facts in source material.'],
          failureCategories: ['evidence_gap'],
          evidence: [],
          createdAt: 1,
        },
      },
      queryLlm,
    })

    expect(requests.some(request => request.prompt.includes('Role: route_history_reviewer'))).toBe(true)
    expect(requests.find(request => request.prompt.includes('Role: route_history_reviewer'))?.prompt)
      .toContain('historical route failures')
    expect(result.evidence?.some(item =>
      item.type === 'system'
      && item.label === 'quality_route'
      && item.detail?.includes('route_health=degraded')
      && item.detail?.includes('route_history=total:3,pass:0,fail:3,uncertain:0')
    )).toBe(true)
  })

  it('keeps degraded route history auditable when extra reviewers are budget-disabled', async () => {
    const requests: LLMQueryRequest[] = []
    const reviewedGoal = goal()
    reviewedGoal.taskContract = {
      originalRequest: 'Deeply research Hermes Agent and MoA for the 1.1.3 plan.',
      taskType: 'research',
      deliverables: ['Sourced research result'],
      mustPreserve: [],
      evidenceRequirements: ['Ground research claims in cited sources.'],
      outputFormats: [],
      acceptanceCriteria: ['[evidence] Ground key facts in source material.'],
      forbiddenShortcuts: ['Do not invent facts.'],
    }
    const queryLlm = async (request: LLMQueryRequest): Promise<LLMQueryResult> => {
      requests.push(request)
      return {
        text: JSON.stringify({
          status: 'pass',
          summary: 'Reviewer did not find additional gaps.',
          missingCriteria: [],
        }),
        model: 'local-reviewer',
      }
    }

    const result = await runGoalQualityCouncilReview({
      input: {
        goalState: reviewedGoal,
        reviewerPerformanceMemory: [
          'Quality route outcome aggregates:',
          'task=research total=3 pass=0 fail=3 uncertain=0 roles=acceptance_reviewer,artifact_reviewer,risk_reviewer,research_source_reviewer models=research_source_reviewer:source-model-a common_gaps=evidence_gap',
        ].join('\n'),
        messages: [
          message('u1', 'user', 'research Hermes Agent and MoA'),
          message('a1', 'assistant', 'Research complete.'),
        ],
        finalAssistant: message('a1', 'assistant', 'Research complete.'),
        result: {
          iteration: 1,
          status: 'uncertain',
          summary: 'Deterministic audit needs source review.',
          missingCriteria: ['Ground key facts in source material.'],
          failureCategories: ['evidence_gap'],
          evidence: [],
          createdAt: 1,
        },
      },
      queryLlm,
      route: {
        maxExtraReviewers: 0,
      },
    })

    expect(requests.some(request => request.prompt.includes('Role: route_history_reviewer'))).toBe(false)
    expect(requests).toHaveLength(4)
    expect(result.evidence?.some(item =>
      item.type === 'system'
      && item.label === 'quality_route'
      && item.detail?.includes('route_health=degraded')
      && item.detail?.includes('extra_reviewers=0/0')
    )).toBe(true)
  })

  it('routes configured reviewer roles to their configured models', async () => {
    const requests: LLMQueryRequest[] = []
    const reviewedGoal = goal()
    reviewedGoal.taskContract = {
      originalRequest: 'Fix the upload button bug and verify tests.',
      taskType: 'code',
      deliverables: ['Minimal code fix with verification'],
      mustPreserve: [],
      evidenceRequirements: ['Inspect implementation and verify the change.'],
      outputFormats: [],
      acceptanceCriteria: ['[test] Run the requested verification command.'],
      forbiddenShortcuts: ['Do not refactor unrelated code.'],
    }
    const queryLlm = async (request: LLMQueryRequest): Promise<LLMQueryResult> => {
      requests.push(request)
      return {
        text: JSON.stringify({
          status: 'pass',
          summary: 'Reviewer did not find additional gaps.',
          missingCriteria: [],
        }),
        model: request.model,
      }
    }

    await runGoalQualityCouncilReview({
      input: {
        goalState: reviewedGoal,
        messages: [
          message('u1', 'user', 'fix upload button'),
          message('a1', 'assistant', 'Fixed and tested.'),
        ],
        finalAssistant: message('a1', 'assistant', 'Fixed and tested.'),
        result: {
          iteration: 1,
          status: 'uncertain',
          summary: 'Deterministic audit needs implementation review.',
          missingCriteria: ['Run the requested verification command.'],
          evidence: [],
          createdAt: 1,
        },
      },
      queryLlm,
      route: {
        reviewerModels: {
          code_implementation_reviewer: 'local-code-reviewer',
        },
      },
    })

    expect(requests.find(request => request.prompt.includes('Role: code_implementation_reviewer'))?.model)
      .toBe('local-code-reviewer')
    expect(requests.filter(request => !request.prompt.includes('Role: code_implementation_reviewer')).every(request => request.model === undefined))
      .toBe(true)
  })

  it('records model fallback provenance when a configured reviewer returns a different model', async () => {
    const reviewedGoal = goal()
    reviewedGoal.taskContract = {
      originalRequest: 'Fix the upload button bug and verify tests.',
      taskType: 'code',
      deliverables: ['Minimal code fix with verification'],
      mustPreserve: [],
      evidenceRequirements: ['Inspect implementation and verify the change.'],
      outputFormats: [],
      acceptanceCriteria: ['[test] Run the requested verification command.'],
      forbiddenShortcuts: ['Do not refactor unrelated code.'],
    }
    const queryLlm = async (request: LLMQueryRequest): Promise<LLMQueryResult> => ({
      text: JSON.stringify({
        status: 'pass',
        summary: 'Reviewer did not find additional gaps.',
        missingCriteria: [],
      }),
      model: request.model === 'strong-code-reviewer' ? 'cheap-fallback-reviewer' : request.model,
    })

    const result = await runGoalQualityCouncilReview({
      input: {
        goalState: reviewedGoal,
        messages: [
          message('u1', 'user', 'fix upload button'),
          message('a1', 'assistant', 'Fixed and tested.'),
        ],
        finalAssistant: message('a1', 'assistant', 'Fixed and tested.'),
        result: {
          iteration: 1,
          status: 'uncertain',
          summary: 'Deterministic audit needs implementation review.',
          missingCriteria: ['Run the requested verification command.'],
          evidence: [],
          createdAt: 1,
        },
      },
      queryLlm,
      route: {
        reviewerModels: {
          code_implementation_reviewer: 'strong-code-reviewer',
        },
      },
    })

    expect(result.evidence?.some(item =>
      item.type === 'system'
      && item.label === 'quality_role_code_implementation_reviewer'
      && item.detail?.includes('requested_model=strong-code-reviewer')
      && item.detail?.includes('model=cheap-fallback-reviewer')
      && item.detail?.includes('fallback_model=true')
    )).toBe(true)
  })

  it('records unknown model fallback provenance when a configured reviewer omits the actual model', async () => {
    const reviewedGoal = goal()
    reviewedGoal.taskContract = {
      originalRequest: 'Fix the upload button bug and verify tests.',
      taskType: 'code',
      deliverables: ['Minimal code fix with verification'],
      mustPreserve: [],
      evidenceRequirements: ['Inspect implementation and verify the change.'],
      outputFormats: [],
      acceptanceCriteria: ['[test] Run the requested verification command.'],
      forbiddenShortcuts: ['Do not refactor unrelated code.'],
    }
    const queryLlm = async (): Promise<LLMQueryResult> => ({
      text: JSON.stringify({
        status: 'pass',
        summary: 'Reviewer did not find additional gaps.',
        missingCriteria: [],
      }),
    })

    const result = await runGoalQualityCouncilReview({
      input: {
        goalState: reviewedGoal,
        messages: [
          message('u1', 'user', 'fix upload button'),
          message('a1', 'assistant', 'Fixed and tested.'),
        ],
        finalAssistant: message('a1', 'assistant', 'Fixed and tested.'),
        result: {
          iteration: 1,
          status: 'uncertain',
          summary: 'Deterministic audit needs implementation review.',
          missingCriteria: ['Run the requested verification command.'],
          evidence: [],
          createdAt: 1,
        },
      },
      queryLlm,
      route: {
        reviewerModels: {
          code_implementation_reviewer: 'strong-code-reviewer',
        },
      },
    })

    expect(result.evidence?.some(item =>
      item.type === 'system'
      && item.label === 'quality_role_code_implementation_reviewer'
      && item.detail?.includes('requested_model=strong-code-reviewer')
      && item.detail?.includes('fallback_model=true')
      && !item.detail?.includes('model=undefined')
    )).toBe(true)
  })

  it('adds an implementation-focused reviewer for code task contracts', async () => {
    const requests: LLMQueryRequest[] = []
    const reviewedGoal = goal()
    reviewedGoal.taskContract = {
      originalRequest: 'Fix the upload button bug and verify tests.',
      taskType: 'code',
      deliverables: ['Minimal code fix with verification'],
      mustPreserve: [],
      evidenceRequirements: ['Inspect implementation and verify the change.'],
      outputFormats: [],
      acceptanceCriteria: ['[test] Run the requested verification command.'],
      forbiddenShortcuts: ['Do not refactor unrelated code.'],
    }
    const queryLlm = async (request: LLMQueryRequest): Promise<LLMQueryResult> => {
      requests.push(request)
      return {
        text: JSON.stringify({
          status: 'pass',
          summary: 'Reviewer did not find additional gaps.',
          missingCriteria: [],
        }),
        model: 'local-reviewer',
      }
    }

    await runGoalQualityCouncilReview({
      input: {
        goalState: reviewedGoal,
        messages: [
          message('u1', 'user', 'fix upload button'),
          message('a1', 'assistant', 'Fixed and tested.'),
        ],
        finalAssistant: message('a1', 'assistant', 'Fixed and tested.'),
        result: {
          iteration: 1,
          status: 'uncertain',
          summary: 'Deterministic audit needs implementation review.',
          missingCriteria: ['Run the requested verification command.'],
          evidence: [],
          createdAt: 1,
        },
      },
      queryLlm,
    })

    expect(requests).toHaveLength(4)
    expect(requests.some(request => request.prompt.includes('Role: code_implementation_reviewer'))).toBe(true)
    expect(requests.find(request => request.prompt.includes('Role: code_implementation_reviewer'))?.prompt)
      .toContain('Check whether the implementation changed the right surface and whether verification evidence matches the code change.')
  })

  it('does not aggregate a contradictory reviewer pass as complete', async () => {
    const queryLlm = async (request: LLMQueryRequest): Promise<LLMQueryResult> => {
      if (request.prompt.includes('risk_reviewer')) {
        return {
          text: JSON.stringify({
            status: 'pass',
            summary: 'Marked pass but still found missing citation evidence.',
            missingCriteria: ['The report must include source citations.'],
            failureCategories: ['evidence_gap'],
            correctivePrompt: 'Add source citations before completion.',
          }),
          model: 'local-risk-reviewer',
        }
      }
      return {
        text: JSON.stringify({
          status: 'pass',
          summary: 'Reviewer did not find additional gaps.',
          missingCriteria: [],
        }),
        model: 'local-reviewer',
      }
    }

    const result = await runGoalQualityCouncilReview({
      input: {
        goalState: goal(),
        messages: [
          message('u1', 'user', 'write a report'),
          message('a1', 'assistant', 'Report complete.'),
        ],
        finalAssistant: message('a1', 'assistant', 'Report complete.'),
        result: {
          iteration: 1,
          status: 'uncertain',
          summary: 'Deterministic audit could not prove source citations.',
          missingCriteria: ['The report must include source citations.'],
          failureCategories: ['evidence_gap'],
          evidence: [],
          createdAt: 1,
        },
      },
      queryLlm,
    })

    expect(result.status).toBe('uncertain')
    expect(result.missingCriteria).toEqual(['The report must include source citations.'])
    expect(result.failureCategories).toEqual(['evidence_gap'])
    expect(result.correctivePrompt).toBe('Add source citations before completion.')
    expect(result.evidence?.some(item =>
      item.type === 'system'
      && item.label === 'quality_role_risk_reviewer'
      && item.detail?.includes('status=uncertain')
      && item.detail?.includes('contradictory pass')
    )).toBe(true)
  })

  it('does not aggregate a warned reviewer pass as complete', async () => {
    const queryLlm = async (request: LLMQueryRequest): Promise<LLMQueryResult> => {
      if (request.prompt.includes('acceptance_reviewer')) {
        return {
          text: JSON.stringify({
            status: 'pass',
            summary: 'Reviewer reached a partial pass.',
            missingCriteria: [],
          }),
          model: 'local-partial-reviewer',
          warning: 'SDK stopped at max_turns before review fully completed',
        }
      }
      return {
        text: JSON.stringify({
          status: 'pass',
          summary: 'Reviewer did not find additional gaps.',
          missingCriteria: [],
        }),
        model: 'local-reviewer',
      }
    }

    const result = await runGoalQualityCouncilReview({
      input: {
        goalState: goal(),
        messages: [
          message('u1', 'user', 'write a report'),
          message('a1', 'assistant', 'Report complete.'),
        ],
        finalAssistant: message('a1', 'assistant', 'Report complete.'),
        result: {
          iteration: 1,
          status: 'uncertain',
          summary: 'Deterministic audit could not prove source citations.',
          missingCriteria: ['The report must include source citations.'],
          failureCategories: ['evidence_gap'],
          evidence: [],
          createdAt: 1,
        },
      },
      queryLlm,
    })

    expect(result.status).toBe('uncertain')
    expect(result.missingCriteria).toEqual(['The report must include source citations.'])
    expect(result.failureCategories).toEqual(['evidence_gap'])
    expect(result.evidence?.some(item =>
      item.type === 'system'
      && item.label === 'quality_role_acceptance_reviewer'
      && item.detail?.includes('status=uncertain')
      && item.detail?.includes('warning=SDK stopped at max_turns before review fully completed')
    )).toBe(true)
  })

  it('sanitizes semicolon-delimited role evidence values before project memory parses them', async () => {
    const queryLlm = async (request: LLMQueryRequest): Promise<LLMQueryResult> => {
      if (request.prompt.includes('acceptance_reviewer')) {
        return {
          text: JSON.stringify({
            status: 'pass',
            summary: 'Partial pass; source evidence was not fully reviewed.',
            missingCriteria: [],
          }),
          model: 'local-partial-reviewer',
          warning: 'SDK stopped; max_turns reached',
        }
      }
      return {
        text: JSON.stringify({
          status: 'pass',
          summary: 'Reviewer did not find additional gaps.',
          missingCriteria: [],
        }),
        model: 'local-reviewer',
      }
    }

    const result = await runGoalQualityCouncilReview({
      input: {
        goalState: goal(),
        messages: [
          message('u1', 'user', 'write a report'),
          message('a1', 'assistant', 'Report complete.'),
        ],
        finalAssistant: message('a1', 'assistant', 'Report complete.'),
        result: {
          iteration: 1,
          status: 'uncertain',
          summary: 'Deterministic audit could not prove source citations.',
          missingCriteria: ['The report must include source citations.'],
          failureCategories: ['evidence_gap'],
          evidence: [],
          createdAt: 1,
        },
      },
      queryLlm,
    })

    const detail = result.evidence?.find(item => item.label === 'quality_role_acceptance_reviewer')?.detail

    expect(detail).toContain('warning=SDK stopped, max_turns reached')
    expect(detail).toContain('summary=Reviewer returned a pass with a backend warning: Partial pass, source evidence was not fully reviewed.')
    expect(detail).not.toContain('warning=SDK stopped; max_turns reached')
    expect(detail).not.toContain('Partial pass; source evidence')
  })

  it('combines corrective prompts from multiple reviewer roles', async () => {
    const queryLlm = async (request: LLMQueryRequest): Promise<LLMQueryResult> => {
      if (request.prompt.includes('artifact_reviewer')) {
        return {
          text: JSON.stringify({
            status: 'fail',
            summary: 'Artifact reviewer found missing citation evidence.',
            missingCriteria: ['The report must include source citations.'],
            failureCategories: ['evidence_gap'],
            correctivePrompt: 'Add source citations to every material risk.',
          }),
          model: 'artifact-reviewer',
        }
      }
      if (request.prompt.includes('risk_reviewer')) {
        return {
          text: JSON.stringify({
            status: 'fail',
            summary: 'Risk reviewer found shallow mitigation analysis.',
            missingCriteria: ['The report must include substantive risk mitigation analysis.'],
            failureCategories: ['shallow_output'],
            correctivePrompt: 'Expand mitigation analysis beyond bullet placeholders.',
          }),
          model: 'risk-reviewer',
        }
      }
      return {
        text: JSON.stringify({
          status: 'pass',
          summary: 'Reviewer did not find additional gaps.',
          missingCriteria: [],
        }),
        model: 'local-reviewer',
      }
    }

    const result = await runGoalQualityCouncilReview({
      input: {
        goalState: goal(),
        messages: [
          message('u1', 'user', 'write a report'),
          message('a1', 'assistant', 'Report complete.'),
        ],
        finalAssistant: message('a1', 'assistant', 'Report complete.'),
        result: {
          iteration: 1,
          status: 'uncertain',
          summary: 'Deterministic audit could not prove source citations.',
          missingCriteria: ['The report must include source citations.'],
          failureCategories: ['evidence_gap'],
          evidence: [],
          createdAt: 1,
        },
      },
      queryLlm,
    })

    expect(result.status).toBe('fail')
    expect(result.correctivePrompt).toContain('artifact_reviewer: Add source citations to every material risk.')
    expect(result.correctivePrompt).toContain('risk_reviewer: Expand mitigation analysis beyond bullet placeholders.')
  })

  it('records council disagreement evidence when reviewer roles do not agree', async () => {
    const queryLlm = async (request: LLMQueryRequest): Promise<LLMQueryResult> => {
      if (request.prompt.includes('artifact_reviewer')) {
        return {
          text: JSON.stringify({
            status: 'fail',
            summary: 'Artifact reviewer found missing citation evidence.',
            missingCriteria: ['The report must include source citations.'],
            failureCategories: ['evidence_gap'],
            correctivePrompt: 'Add source citations to the report.',
          }),
          model: 'artifact-reviewer',
        }
      }
      if (request.prompt.includes('risk_reviewer')) {
        return {
          text: JSON.stringify({
            status: 'uncertain',
            summary: 'Risk reviewer needs stronger evidence before passing.',
            missingCriteria: [],
          }),
          model: 'risk-reviewer',
        }
      }
      return {
        text: JSON.stringify({
          status: 'pass',
          summary: 'Acceptance criteria look satisfied.',
          missingCriteria: [],
        }),
        model: 'acceptance-reviewer',
      }
    }

    const result = await runGoalQualityCouncilReview({
      input: {
        goalState: goal(),
        messages: [
          message('u1', 'user', 'write a report'),
          message('a1', 'assistant', 'Report complete.'),
        ],
        finalAssistant: message('a1', 'assistant', 'Report complete.'),
        result: {
          iteration: 1,
          status: 'uncertain',
          summary: 'Deterministic audit could not prove source citations.',
          missingCriteria: ['The report must include source citations.'],
          failureCategories: ['evidence_gap'],
          evidence: [],
          createdAt: 1,
        },
      },
      queryLlm,
    })

    expect(result.status).toBe('fail')
    expect(result.evidence?.some(item =>
      item.type === 'system'
      && item.label === 'quality_council_disagreement'
      && item.detail?.includes('acceptance_reviewer=pass')
      && item.detail?.includes('artifact_reviewer=fail')
      && item.detail?.includes('risk_reviewer=uncertain')
    )).toBe(true)
  })

  it('keeps council review usable when one reviewer times out', async () => {
    const requests: LLMQueryRequest[] = []
    const originalSetTimeout = globalThis.setTimeout
    const immediateLongTimers = ((...args: Parameters<typeof setTimeout>) => {
      const [handler, timeout, ...rest] = args
      const delay = typeof timeout === 'number' && timeout >= 100 ? 0 : timeout
      return originalSetTimeout(handler, delay, ...rest)
    }) as typeof setTimeout
    const queryLlm = async (request: LLMQueryRequest): Promise<LLMQueryResult> => {
      requests.push(request)
      if (request.prompt.includes('acceptance_reviewer')) {
        return new Promise<LLMQueryResult>(() => {})
      }
      return {
        text: JSON.stringify({
          status: 'pass',
          summary: 'Reviewer did not find additional gaps.',
          missingCriteria: [],
        }),
        model: 'local-reviewer',
      }
    }

    let result
    try {
      globalThis.setTimeout = immediateLongTimers
      result = await runGoalQualityCouncilReview({
        input: {
          goalState: goal(),
          messages: [
            message('u1', 'user', 'write a report'),
            message('a1', 'assistant', 'Report complete.'),
          ],
          finalAssistant: message('a1', 'assistant', 'Report complete.'),
          result: {
            iteration: 1,
            status: 'uncertain',
            summary: 'Deterministic audit could not prove source citations.',
            missingCriteria: ['The report must include source citations.'],
            failureCategories: ['evidence_gap'],
            evidence: [],
            createdAt: 1,
          },
        },
        queryLlm,
        reviewerTimeoutMs: 100,
      })
    } finally {
      globalThis.setTimeout = originalSetTimeout
    }

    expect(requests).toHaveLength(3)
    expect(result.status).toBe('uncertain')
    expect(result.missingCriteria).toEqual(['The report must include source citations.'])
    expect(result.failureCategories).toEqual(['evidence_gap'])
    expect(result.evidence?.some(item =>
      item.type === 'system'
      && item.label === 'quality_role_acceptance_reviewer'
      && item.detail?.includes('status=uncertain')
      && item.detail?.includes('timed out')
    )).toBe(true)
  })
})
