import { describe, expect, it } from 'bun:test';
import {
  appendSubAgentLifecycleEntry,
  attachOrchestrationArtifacts,
  buildSessionOrchestrationState,
  formatOrchestrationContext,
  getOrchestrationEntropySignal,
  updateOrchestrationTaskStatus,
} from './orchestration.ts';
import type { SessionTaskContract } from './types.ts';

const contract: SessionTaskContract = {
  originalRequest: '只分析选中的 COTO Chapter 1 知识库，输出中文分析报告。',
  taskType: 'document',
  documentQualityMode: 'multi_agent_deep',
  deliverables: ['Produce a scoped Chapter 1 analysis.'],
  mustPreserve: ['Selected source: file-memory-chapter-1'],
  evidenceRequirements: ['Use only the selected knowledge base source.'],
  outputFormats: ['MD'],
  acceptanceCriteria: ['[evidence] Cite selected source chunks.'],
  forbiddenShortcuts: ['Do not analyze other COTO chapters.'],
  documentPlan: {
    sections: ['Chapter 1 scope', 'Clause analysis'],
    tables: [],
    charts: [],
    enhancements: [],
    citations: ['Cite Chapter 1 chunks.'],
    deliveryFormats: ['MD'],
    agentPlan: {
      mode: 'chapter_agents',
      finalSynthesisOwner: 'main-session',
      assignments: [
        {
          id: 'chapter-1-agent',
          title: 'COTO Chapter 1',
          role: 'source_evidence_agent',
          reviewFocus: 'only selected source evidence',
        },
      ],
      reviewStages: ['Audit handoff before final merge.'],
      guardrails: ['No other chapters.'],
    },
  },
};

describe('session orchestration state', () => {
  it('builds a structured task board with selected-source hard boundaries', () => {
    const orchestration = buildSessionOrchestrationState({
      objective: contract.originalRequest,
      taskContract: contract,
      enabledSourceSlugs: ['file-memory-chapter-1'],
      now: 100,
    });

    expect(orchestration).toBeDefined();
    expect(orchestration?.version).toBe(1);
    expect(orchestration?.phase).toBe('plan');
    expect(orchestration?.policy.selectedSourceSlugs).toEqual(['file-memory-chapter-1']);
    expect(orchestration?.policy.forbidWorkingDirectoryDiscovery).toBe(true);
    expect(orchestration?.policy.requireStructuredHandoff).toBe(true);
    expect(orchestration?.taskBoard.tasks).toContainEqual(expect.objectContaining({
      id: 'chapter-1-agent',
      phase: 'plan',
      status: 'pending',
      scope: 'COTO Chapter 1',
      allowedSourceSlugs: ['file-memory-chapter-1'],
    }));
    expect(orchestration?.taskBoard.tasks).toContainEqual(expect.objectContaining({
      id: 'main-session-audit',
      phase: 'audit',
      status: 'pending',
      dependencies: ['chapter-1-agent'],
    }));
    expect(orchestration?.taskBoard.tasks).toContainEqual(expect.objectContaining({
      id: 'main-session-merge',
      phase: 'merge',
      status: 'pending',
      dependencies: ['main-session-audit'],
    }));
  });

  it('formats Plan/Audit/Merge instructions and the required sub-agent handoff schema', () => {
    const orchestration = buildSessionOrchestrationState({
      objective: contract.originalRequest,
      taskContract: contract,
      enabledSourceSlugs: ['file-memory-chapter-1'],
      now: 100,
    });

    const formatted = formatOrchestrationContext(orchestration);

    expect(formatted).toContain('<orchestration_state version="1" phase="plan">');
    expect(formatted).toContain('Plan/Audit/Merge separation:');
    expect(formatted).toContain('Task board is authoritative');
    expect(formatted).toContain('Spawn governance: spawned sub-agents must not spawn further sessions');
    expect(formatted).toContain('Selected source hard boundary: file-memory-chapter-1');
    expect(formatted).toContain('Do not inventory or search the working directory as a source corpus');
    expect(formatted).toContain('<requires_user_decision>');
    expect(formatted).toContain('<agent_handoff>');
    expect(formatted).toContain('task_id:');
    expect(formatted).toContain('sources_used:');
    expect(formatted).toContain('gaps:');
  });

  it('raises entropy when sources, subagents, tool failures, and workspace discovery accumulate', () => {
    const signal = getOrchestrationEntropySignal({
      enabledSourceCount: 7,
      spawnedSessionCount: 5,
      failedToolCount: 2,
      artifactWriteFailureCount: 1,
      workspaceDiscoveryCount: 2,
      repeatedFailureCount: 1,
    });

    expect(signal?.level).toBe('high');
    expect(signal?.score).toBeGreaterThanOrEqual(80);
    expect(signal?.reasons).toContain('many enabled sources');
    expect(signal?.reasons).toContain('workspace discovery under scoped-source policy');
  });

  it('records spawned sub-agent lifecycle state with expected handoff fields', () => {
    const orchestration = buildSessionOrchestrationState({
      objective: contract.originalRequest,
      taskContract: contract,
      enabledSourceSlugs: ['file-memory-chapter-1'],
      now: 100,
    });

    const updated = appendSubAgentLifecycleEntry(orchestration, {
      sessionId: 'child-1',
      name: 'Chapter 1 worker',
      status: 'started',
      workingDirectory: 'C:/project',
    }, 200);

    expect(updated?.subAgents).toContainEqual(expect.objectContaining({
      sessionId: 'child-1',
      name: 'Chapter 1 worker',
      status: 'started',
      sourceSlugs: ['file-memory-chapter-1'],
      expectedHandoff: expect.arrayContaining(['task_id', 'sources_used', 'gaps']),
    }));
  });

  it('tracks bounded-autonomy artifact paths and progress ledger counts', () => {
    const orchestration = buildSessionOrchestrationState({
      objective: contract.originalRequest,
      taskContract: contract,
      enabledSourceSlugs: ['file-memory-chapter-1'],
      now: 100,
    });

    const withArtifacts = attachOrchestrationArtifacts(orchestration, {
      rootPath: 'C:/project/session/orchestration',
      briefsPath: 'C:/project/session/orchestration/briefs',
      reportsPath: 'C:/project/session/orchestration/reports',
      evidencePackagesPath: 'C:/project/session/orchestration/evidence-packages',
      progressLedgerPath: 'C:/project/session/orchestration/progress-ledger.json',
    }, 150);
    const updated = updateOrchestrationTaskStatus(withArtifacts, 'chapter-1-agent', 'running', {
      currentTaskId: 'chapter-1-agent',
      evidencePackagePath: 'C:/project/session/orchestration/evidence-packages/audit-1.json',
      now: 200,
    });

    expect(updated?.artifacts?.briefsPath).toBe('C:/project/session/orchestration/briefs');
    expect(updated?.ledger?.currentTaskId).toBe('chapter-1-agent');
    expect(updated?.ledger?.running).toBe(1);
    expect(updated?.ledger?.pending).toBe(2);
    expect(updated?.ledger?.completed).toBe(0);
    expect(updated?.ledger?.needsUserConfirmation).toBe(false);
    expect(updated?.ledger?.evidencePackagePath).toBe('C:/project/session/orchestration/evidence-packages/audit-1.json');
  });

  describe('IWG-style regression checkpoints', () => {
    it('keeps the orchestrator light by externalizing scope, handoff, and entropy state', () => {
      const orchestration = buildSessionOrchestrationState({
        objective: contract.originalRequest,
        taskContract: contract,
        enabledSourceSlugs: ['file-memory-chapter-1'],
        now: 100,
      });
      const formatted = formatOrchestrationContext(orchestration);

      expect(formatted).toContain('Task board is authoritative');
      expect(formatted).toContain('Selected source hard boundary: file-memory-chapter-1');
      expect(formatted).toContain('Required sub-agent handoff format:');
      expect(formatted).toContain('Current orchestration entropy: not elevated.');
    });
  });
});
