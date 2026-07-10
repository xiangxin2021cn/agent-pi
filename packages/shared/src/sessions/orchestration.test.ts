import { describe, expect, it } from 'bun:test';
import {
  appendSubAgentLifecycleEntry,
  attachOrchestrationArtifacts,
  buildSessionOrchestrationState,
  formatOrchestrationContext,
  getRunnableOrchestrationTasks,
  getOrchestrationEntropySignal,
  markSubAgentHandoffReady,
  markSubAgentHandoffNeedsReview,
  mergeSessionOrchestrationState,
  resumeSessionOrchestrationForFollowUp,
  transitionOrchestrationPhase,
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

  it('marks a running spawned assignment as handoff-ready when its report exists', () => {
    const orchestration = buildSessionOrchestrationState({
      objective: contract.originalRequest,
      taskContract: contract,
      enabledSourceSlugs: ['file-memory-chapter-1'],
      now: 100,
    });

    const withChild = appendSubAgentLifecycleEntry(
      updateOrchestrationTaskStatus(orchestration, 'chapter-1-agent', 'running', {
        artifactPaths: ['C:/project/session/orchestration/reports/chapter-1-agent.md'],
        now: 200,
      }),
      {
        sessionId: 'child-1',
        name: 'Chapter 1 worker',
        taskId: 'chapter-1-agent',
        status: 'started',
        reportPath: 'C:/project/session/orchestration/reports/chapter-1-agent.md',
      },
      200,
    );

    const updated = markSubAgentHandoffReady(withChild, {
      sessionId: 'child-1',
      reportPath: 'C:/project/session/orchestration/reports/chapter-1-agent.md',
      reportSize: 2048,
      now: 300,
    });

    expect(updated?.taskBoard.tasks).toContainEqual(expect.objectContaining({
      id: 'chapter-1-agent',
      status: 'handoff_ready',
    }));
    expect(updated?.subAgents).toContainEqual(expect.objectContaining({
      sessionId: 'child-1',
      taskId: 'chapter-1-agent',
      status: 'handoff_received',
      reportPath: 'C:/project/session/orchestration/reports/chapter-1-agent.md',
      reportSize: 2048,
    }));
    expect(updated?.ledger?.handoffReady).toBe(1);
    expect(updated?.ledger?.running).toBe(0);
  });

  it('marks a spawned assignment as needs-review when the child cannot produce a report', () => {
    const orchestration = buildSessionOrchestrationState({
      objective: contract.originalRequest,
      taskContract: contract,
      enabledSourceSlugs: ['file-memory-chapter-1'],
      now: 100,
    });

    const withChild = appendSubAgentLifecycleEntry(
      updateOrchestrationTaskStatus(orchestration, 'chapter-1-agent', 'running', {
        artifactPaths: ['C:/project/session/orchestration/reports/chapter-1-agent.md'],
        now: 200,
      }),
      {
        sessionId: 'child-1',
        name: 'Chapter 1 worker',
        taskId: 'chapter-1-agent',
        status: 'started',
        reportPath: 'C:/project/session/orchestration/reports/chapter-1-agent.md',
      },
      200,
    );

    const updated = markSubAgentHandoffNeedsReview(withChild, {
      sessionId: 'child-1',
      now: 300,
    });

    expect(updated?.taskBoard.tasks).toContainEqual(expect.objectContaining({
      id: 'chapter-1-agent',
      status: 'needs_review',
    }));
    expect(updated?.subAgents).toContainEqual(expect.objectContaining({
      sessionId: 'child-1',
      status: 'needs_review',
    }));
    expect(updated?.ledger?.needsReview).toBe(1);
    expect(updated?.ledger?.needsUserConfirmation).toBe(true);
  });

  it('returns only current-phase tasks whose dependencies are satisfied', () => {
    const orchestration = buildSessionOrchestrationState({
      objective: contract.originalRequest,
      taskContract: contract,
      enabledSourceSlugs: ['file-memory-chapter-1'],
      now: 100,
    });

    expect(getRunnableOrchestrationTasks(orchestration).map(task => task.id)).toEqual(['chapter-1-agent']);

    const handoffReady = updateOrchestrationTaskStatus(orchestration, 'chapter-1-agent', 'handoff_ready', { now: 200 });
    expect(getRunnableOrchestrationTasks(handoffReady)).toEqual([]);

    const auditTransition = transitionOrchestrationPhase(handoffReady, 'audit', { now: 300 });
    expect(auditTransition.ok).toBe(true);
    expect(getRunnableOrchestrationTasks(auditTransition.orchestration).map(task => task.id)).toEqual(['main-session-audit']);
  });

  it('blocks merge until audit completes and the artifact is ready', () => {
    const orchestration = buildSessionOrchestrationState({
      objective: contract.originalRequest,
      taskContract: contract,
      enabledSourceSlugs: ['file-memory-chapter-1'],
      now: 100,
    });
    const handoffReady = updateOrchestrationTaskStatus(orchestration, 'chapter-1-agent', 'handoff_ready', { now: 200 });
    const auditTransition = transitionOrchestrationPhase(handoffReady, 'audit', { now: 300 });

    const blockedByTask = transitionOrchestrationPhase(auditTransition.orchestration, 'merge', {
      artifactReady: true,
      now: 400,
    });
    expect(blockedByTask).toEqual(expect.objectContaining({
      ok: false,
      blockingTaskIds: ['main-session-audit'],
    }));

    const auditComplete = updateOrchestrationTaskStatus(
      auditTransition.orchestration,
      'main-session-audit',
      'completed',
      { now: 500 },
    );
    const blockedByArtifact = transitionOrchestrationPhase(auditComplete, 'merge', { now: 600 });
    expect(blockedByArtifact).toEqual(expect.objectContaining({
      ok: false,
      reason: 'artifact_not_ready',
    }));

    const mergeTransition = transitionOrchestrationPhase(auditComplete, 'merge', {
      artifactReady: true,
      now: 700,
    });
    expect(mergeTransition.ok).toBe(true);
    if (!mergeTransition.ok) throw new Error(mergeTransition.reason);
    expect(mergeTransition.orchestration.phase).toBe('merge');
    expect(getRunnableOrchestrationTasks(mergeTransition.orchestration).map(task => task.id)).toEqual(['main-session-merge']);
  });

  it('allows completion only after the merge task and final artifact are complete', () => {
    const orchestration = buildSessionOrchestrationState({
      objective: contract.originalRequest,
      taskContract: contract,
      enabledSourceSlugs: ['file-memory-chapter-1'],
      now: 100,
    });
    const planComplete = updateOrchestrationTaskStatus(orchestration, 'chapter-1-agent', 'completed', { now: 200 });
    const audit = transitionOrchestrationPhase(planComplete, 'audit', { now: 300 });
    const auditComplete = updateOrchestrationTaskStatus(audit.orchestration, 'main-session-audit', 'completed', { now: 400 });
    const merge = transitionOrchestrationPhase(auditComplete, 'merge', { artifactReady: true, now: 500 });
    const mergeComplete = updateOrchestrationTaskStatus(merge.orchestration, 'main-session-merge', 'completed', { now: 600 });

    const done = transitionOrchestrationPhase(mergeComplete, 'done', { artifactReady: true, now: 700 });
    expect(done.ok).toBe(true);
    if (!done.ok) throw new Error(done.reason);
    expect(done.orchestration.phase).toBe('done');
    expect(getRunnableOrchestrationTasks(done.orchestration)).toEqual([]);
  });

  it('preserves active orchestration runtime state when follow-up instructions rebuild the plan', () => {
    const existing = buildSessionOrchestrationState({
      objective: contract.originalRequest,
      taskContract: contract,
      enabledSourceSlugs: ['file-memory-chapter-1'],
      now: 100,
    });
    const running = appendSubAgentLifecycleEntry(
      updateOrchestrationTaskStatus(existing, 'chapter-1-agent', 'running', {
        currentTaskId: 'chapter-1-agent',
        artifactPaths: ['C:/reports/chapter-1.md'],
        now: 200,
      }),
      {
        sessionId: 'child-1',
        taskId: 'chapter-1-agent',
        status: 'started',
        reportPath: 'C:/reports/chapter-1.md',
      },
      200,
    );
    const paused = transitionOrchestrationPhase(running, 'paused', { now: 250 });
    expect(paused.ok).toBe(true);

    const rebuilt = buildSessionOrchestrationState({
      objective: `${contract.originalRequest}\n补充要求：保留中文输出。`,
      taskContract: contract,
      enabledSourceSlugs: ['file-memory-chapter-1'],
      now: 300,
    });
    const merged = mergeSessionOrchestrationState(paused.orchestration, rebuilt, 300);

    expect(merged?.phase).toBe('paused');
    expect(merged?.createdAt).toBe(100);
    expect(merged?.subAgents).toContainEqual(expect.objectContaining({
      sessionId: 'child-1',
      status: 'started',
      reportPath: 'C:/reports/chapter-1.md',
    }));
    expect(merged?.taskBoard.tasks).toContainEqual(expect.objectContaining({
      id: 'chapter-1-agent',
      status: 'running',
      artifactPaths: ['C:/reports/chapter-1.md'],
    }));
    expect(merged?.ledger?.currentTaskId).toBe('chapter-1-agent');

    const resumed = resumeSessionOrchestrationForFollowUp(merged, 400);
    expect(resumed?.phase).toBe('plan');
    expect(resumed?.subAgents).toEqual(merged?.subAgents);
    expect(resumed?.taskBoard.tasks).toContainEqual(expect.objectContaining({
      id: 'chapter-1-agent',
      status: 'running',
    }));
    expect(resumed?.taskBoard.tasks).toContainEqual(expect.objectContaining({
      id: 'main-session-audit',
      status: 'pending',
    }));
    expect(resumed?.ledger?.needsUserConfirmation).toBe(false);
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
