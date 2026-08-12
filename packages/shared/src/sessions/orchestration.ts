import type {
  SessionOrchestrationArtifactPaths,
  SessionOrchestrationEntropySignal,
  SessionOrchestrationProgressLedger,
  SessionOrchestrationPhase,
  SessionOrchestrationState,
  SessionOrchestrationTask,
  SessionOrchestrationTaskStatus,
  SessionSubAgentLifecycleEntry,
  SessionTaskContract,
} from './types.ts';

export interface BuildSessionOrchestrationStateInput {
  objective: string;
  taskContract?: SessionTaskContract;
  enabledSourceSlugs?: string[];
  now?: number;
}

export interface OrchestrationEntropyInput {
  enabledSourceCount: number;
  spawnedSessionCount?: number;
  failedToolCount?: number;
  artifactWriteFailureCount?: number;
  workspaceDiscoveryCount?: number;
  repeatedFailureCount?: number;
  contextUsagePercent?: number;
  now?: number;
}

export interface UpdateOrchestrationTaskStatusOptions {
  currentTaskId?: string;
  evidencePackagePath?: string;
  needsUserConfirmation?: boolean;
  artifactPaths?: string[];
  now?: number;
}

export interface MarkSubAgentHandoffReadyInput {
  sessionId: string;
  reportPath?: string;
  reportSize?: number;
  now?: number;
}

export interface MarkSubAgentHandoffNeedsReviewInput {
  sessionId: string;
  now?: number;
}

export interface TransitionOrchestrationPhaseOptions {
  artifactReady?: boolean;
  now?: number;
}

export type OrchestrationPhaseTransitionResult =
  | { ok: true; orchestration: SessionOrchestrationState }
  | {
      ok: false;
      orchestration: SessionOrchestrationState | undefined;
      reason: 'orchestration_not_initialized' | 'invalid_transition' | 'phase_tasks_incomplete' | 'artifact_not_ready';
      blockingTaskIds: string[];
    };

const HANDOFF_FIELDS = [
  'task_id',
  'scope',
  'sources_used',
  'evidence',
  'artifacts',
  'gaps',
  'recommendation',
];

export function buildSessionOrchestrationState(input: BuildSessionOrchestrationStateInput): SessionOrchestrationState | undefined {
  const contract = input.taskContract;
  if (!contract) return undefined;

  const now = input.now ?? Date.now();
  const selectedSourceSlugs = unique(input.enabledSourceSlugs ?? []);
  const tasks = buildTaskBoardTasks(contract, selectedSourceSlugs);
  const sourceScoped = selectedSourceSlugs.length > 0;
  const workflowMode = contract.documentQualityMode;
  if (workflowMode === 'native_quick') return undefined;

  const orchestrationEnabled = sourceScoped
    || workflowMode === 'professional_document'
    || workflowMode === 'strict_delivery'
    || workflowMode === 'multi_agent_deep'
    || tasks.length > 0;

  if (!orchestrationEnabled) return undefined;

  return {
    version: 1,
    phase: 'plan',
    createdAt: now,
    updatedAt: now,
    policy: {
      selectedSourceSlugs,
      forbidWorkingDirectoryDiscovery: sourceScoped,
      requireStructuredHandoff: workflowMode === 'multi_agent_deep' || tasks.length > 1,
      requireUserConfirmationPause: true,
      maxAutomaticRepairPasses: 2,
    },
    taskBoard: {
      tasks,
    },
    subAgents: [],
  };
}

/**
 * Keep the hard source-boundary snapshot aligned with the session's live
 * enabled sources. Model-switch MCP remounts used to leave
 * policy.selectedSourceSlugs frozen (e.g. anysearch) while new tools were
 * already mounted, so image/other MCP calls stayed blocked.
 */
export function syncOrchestrationSelectedSources(
  orchestration: SessionOrchestrationState | undefined,
  enabledSourceSlugs: string[] | undefined,
  now = Date.now(),
): SessionOrchestrationState | undefined {
  if (!orchestration) return orchestration;
  // Cold sessions leave enabledSourceSlugs undefined until JSONL hydrate.
  // Do not treat that as "no sources" or the snapshot would be wiped.
  if (enabledSourceSlugs === undefined) return orchestration;

  const selectedSourceSlugs = unique(enabledSourceSlugs);
  const forbidWorkingDirectoryDiscovery = selectedSourceSlugs.length > 0;
  if (
    sameSlugSet(orchestration.policy.selectedSourceSlugs, selectedSourceSlugs)
    && orchestration.policy.forbidWorkingDirectoryDiscovery === forbidWorkingDirectoryDiscovery
  ) {
    return orchestration;
  }

  return {
    ...orchestration,
    updatedAt: now,
    policy: {
      ...orchestration.policy,
      selectedSourceSlugs,
      forbidWorkingDirectoryDiscovery,
    },
  };
}

export function appendSubAgentLifecycleEntry(
  orchestration: SessionOrchestrationState | undefined,
  entry: Omit<SessionSubAgentLifecycleEntry, 'createdAt' | 'updatedAt' | 'expectedHandoff' | 'sourceSlugs'> & {
    sourceSlugs?: string[];
    expectedHandoff?: string[];
  },
  now = Date.now(),
): SessionOrchestrationState | undefined {
  if (!orchestration) return orchestration;
  const sourceSlugs = unique(entry.sourceSlugs ?? orchestration.policy.selectedSourceSlugs);
  const nextEntry: SessionSubAgentLifecycleEntry = {
    ...entry,
    sourceSlugs,
    expectedHandoff: entry.expectedHandoff ?? HANDOFF_FIELDS,
    createdAt: now,
    updatedAt: now,
  };
  return {
    ...orchestration,
    updatedAt: now,
    subAgents: [...orchestration.subAgents.filter(item => item.sessionId !== entry.sessionId), nextEntry],
  };
}

export function filterSupersededSubAgentHandoffs(
  subAgents: readonly SessionSubAgentLifecycleEntry[],
): SessionSubAgentLifecycleEntry[] {
  const readyExactReportPaths = new Set<string>();
  const readySplitFamilyCounts = new Map<string, number>();

  for (const agent of subAgents) {
    if (!isSubAgentHandoffReady(agent) || !agent.reportPath) continue;
    readyExactReportPaths.add(normalizeReportPath(agent.reportPath));
    const family = getHandoffReportFamily(agent.reportPath);
    if (family?.splitMarker) {
      readySplitFamilyCounts.set(family.key, (readySplitFamilyCounts.get(family.key) ?? 0) + 1);
    }
  }

  return subAgents.filter(agent => {
    if (isSubAgentHandoffReady(agent) || !agent.reportPath) return true;
    if (readyExactReportPaths.has(normalizeReportPath(agent.reportPath))) return false;

    const family = getHandoffReportFamily(agent.reportPath);
    return !(family && !family.splitMarker && (readySplitFamilyCounts.get(family.key) ?? 0) >= 2);
  });
}

export function markSubAgentHandoffReady(
  orchestration: SessionOrchestrationState | undefined,
  input: MarkSubAgentHandoffReadyInput,
): SessionOrchestrationState | undefined {
  if (!orchestration) return orchestration;

  const child = orchestration.subAgents.find(item => item.sessionId === input.sessionId);
  if (!child) return orchestration;

  const reportPath = input.reportPath ?? child.reportPath;
  const reportSize = input.reportSize ?? child.reportSize ?? 0;
  if (!reportPath || reportSize <= 0) return orchestration;

  const now = input.now ?? Date.now();
  const subAgents = orchestration.subAgents.map(item => {
    if (item.sessionId !== input.sessionId) return item;
    return {
      ...item,
      status: item.status === 'completed' ? item.status : 'handoff_received',
      reportPath,
      reportSize,
      lastActivityAt: now,
      updatedAt: now,
    } satisfies SessionSubAgentLifecycleEntry;
  });
  const tasks = orchestration.taskBoard.tasks.map(task => {
    if (task.id !== child.taskId) return task;
    return {
      ...task,
      status: task.status === 'completed' ? task.status : 'handoff_ready',
      artifactPaths: unique([...(task.artifactPaths ?? []), reportPath]),
    } satisfies SessionOrchestrationTask;
  });

  return refreshOrchestrationLedger({
    ...orchestration,
    updatedAt: now,
    taskBoard: { tasks },
    subAgents,
  }, {
    currentTaskId: child.taskId,
    now,
  });
}

export function markSubAgentHandoffNeedsReview(
  orchestration: SessionOrchestrationState | undefined,
  input: MarkSubAgentHandoffNeedsReviewInput,
): SessionOrchestrationState | undefined {
  if (!orchestration) return orchestration;

  const child = orchestration.subAgents.find(item => item.sessionId === input.sessionId);
  if (!child) return orchestration;

  const now = input.now ?? Date.now();
  const subAgents = orchestration.subAgents.map(item => {
    if (item.sessionId !== input.sessionId) return item;
    return {
      ...item,
      status: item.status === 'completed' ? item.status : 'needs_review',
      lastActivityAt: now,
      updatedAt: now,
    } satisfies SessionSubAgentLifecycleEntry;
  });
  const tasks = orchestration.taskBoard.tasks.map(task => {
    if (task.id !== child.taskId) return task;
    return {
      ...task,
      status: task.status === 'completed' ? task.status : 'needs_review',
    } satisfies SessionOrchestrationTask;
  });

  return refreshOrchestrationLedger({
    ...orchestration,
    phase: 'paused',
    updatedAt: now,
    taskBoard: { tasks },
    subAgents,
  }, {
    currentTaskId: child.taskId,
    needsUserConfirmation: true,
    now,
  });
}

export function attachOrchestrationArtifacts(
  orchestration: SessionOrchestrationState | undefined,
  artifacts: SessionOrchestrationArtifactPaths,
  now = Date.now(),
): SessionOrchestrationState | undefined {
  if (!orchestration) return orchestration;
  return refreshOrchestrationLedger({
    ...orchestration,
    artifacts,
    updatedAt: now,
  }, { now });
}

export function mergeSessionOrchestrationState(
  existing: SessionOrchestrationState | undefined,
  rebuilt: SessionOrchestrationState | undefined,
  now = Date.now(),
): SessionOrchestrationState | undefined {
  if (!existing) return rebuilt ? refreshOrchestrationLedger(rebuilt, { now }) : undefined;
  if (!rebuilt) return refreshOrchestrationLedger(existing, { now });

  const rebuiltById = new Map(rebuilt.taskBoard.tasks.map(task => [task.id, task]));
  const tasks = existing.taskBoard.tasks.map(task => {
    const refreshed = rebuiltById.get(task.id);
    if (!refreshed) return task;
    rebuiltById.delete(task.id);
    return {
      ...refreshed,
      status: task.status,
      ownerSessionId: task.ownerSessionId,
      artifactPaths: task.artifactPaths,
    } satisfies SessionOrchestrationTask;
  });
  tasks.push(...rebuiltById.values());

  return refreshOrchestrationLedger({
    ...rebuilt,
    phase: existing.phase,
    createdAt: existing.createdAt,
    updatedAt: now,
    taskBoard: { tasks },
    subAgents: existing.subAgents,
    artifacts: existing.artifacts ?? rebuilt.artifacts,
    ledger: existing.ledger,
    entropy: existing.entropy,
  }, { now });
}

export function resumeSessionOrchestrationForFollowUp(
  orchestration: SessionOrchestrationState | undefined,
  now = Date.now(),
): SessionOrchestrationState | undefined {
  if (!orchestration || orchestration.phase === 'plan') return orchestration;

  const tasks = orchestration.taskBoard.tasks.map(task => {
    const resetPhaseGate = task.phase === 'audit' || task.phase === 'merge';
    const resetBlockedWork = task.status === 'blocked' || task.status === 'needs_review';
    return resetPhaseGate || resetBlockedWork
      ? { ...task, status: 'pending' as const }
      : task;
  });
  const currentTaskId = tasks.some(task => (
    task.id === orchestration.ledger?.currentTaskId
    && task.phase === 'plan'
    && task.status === 'running'
  ))
    ? orchestration.ledger?.currentTaskId
    : undefined;

  return refreshOrchestrationLedger({
    ...orchestration,
    phase: 'plan',
    updatedAt: now,
    taskBoard: { tasks },
    ledger: orchestration.ledger
      ? { ...orchestration.ledger, currentTaskId }
      : orchestration.ledger,
  }, {
    currentTaskId,
    needsUserConfirmation: false,
    now,
  });
}

export function updateOrchestrationTaskStatus(
  orchestration: SessionOrchestrationState | undefined,
  taskId: string | undefined,
  status: SessionOrchestrationTaskStatus,
  options: UpdateOrchestrationTaskStatusOptions = {},
): SessionOrchestrationState | undefined {
  if (!orchestration || !taskId) return orchestration;
  const now = options.now ?? Date.now();
  const tasks = orchestration.taskBoard.tasks.map(task => {
    if (task.id !== taskId) return task;
    return {
      ...task,
      status,
      artifactPaths: options.artifactPaths
        ? unique([...(task.artifactPaths ?? []), ...options.artifactPaths])
        : task.artifactPaths,
    };
  });
  return refreshOrchestrationLedger({
    ...orchestration,
    updatedAt: now,
    taskBoard: { tasks },
  }, options);
}

export function getRunnableOrchestrationTasks(
  orchestration: SessionOrchestrationState | undefined,
): SessionOrchestrationTask[] {
  if (!orchestration || orchestration.phase === 'paused' || orchestration.phase === 'done') return [];

  const statuses = new Map(orchestration.taskBoard.tasks.map(task => [task.id, task.status]));
  return orchestration.taskBoard.tasks.filter(task => (
    task.phase === orchestration.phase
    && task.status === 'pending'
    && task.dependencies.every(dependency => isDependencySatisfied(statuses.get(dependency)))
  ));
}

export function transitionOrchestrationPhase(
  orchestration: SessionOrchestrationState | undefined,
  target: SessionOrchestrationPhase,
  options: TransitionOrchestrationPhaseOptions = {},
): OrchestrationPhaseTransitionResult {
  if (!orchestration) {
    return {
      ok: false,
      orchestration,
      reason: 'orchestration_not_initialized',
      blockingTaskIds: [],
    };
  }

  if (orchestration.phase === target) return { ok: true, orchestration };

  if (target === 'paused' && orchestration.phase !== 'done') {
    return transitionTo(orchestration, target, options);
  }
  if (orchestration.phase === 'paused' && target === 'plan') {
    return transitionTo(orchestration, target, options);
  }
  if (orchestration.phase === 'audit' && target === 'plan') {
    return transitionTo(orchestration, target, options);
  }

  const expectedTarget: Partial<Record<SessionOrchestrationPhase, SessionOrchestrationPhase>> = {
    plan: 'audit',
    audit: 'merge',
    merge: 'done',
  };
  if (expectedTarget[orchestration.phase] !== target) {
    return {
      ok: false,
      orchestration,
      reason: 'invalid_transition',
      blockingTaskIds: [],
    };
  }

  const blockingTaskIds = orchestration.taskBoard.tasks
    .filter(task => task.phase === orchestration.phase && !isPhaseTaskSatisfied(task))
    .map(task => task.id);
  if (blockingTaskIds.length > 0) {
    return {
      ok: false,
      orchestration,
      reason: 'phase_tasks_incomplete',
      blockingTaskIds,
    };
  }

  if ((target === 'merge' || target === 'done') && !options.artifactReady) {
    return {
      ok: false,
      orchestration,
      reason: 'artifact_not_ready',
      blockingTaskIds: [],
    };
  }

  return transitionTo(orchestration, target, options);
}

export function refreshOrchestrationLedger(
  orchestration: SessionOrchestrationState | undefined,
  options: UpdateOrchestrationTaskStatusOptions = {},
): SessionOrchestrationState | undefined {
  if (!orchestration) return orchestration;
  const now = options.now ?? Date.now();
  const ledger = buildProgressLedger(orchestration, options, now);
  return {
    ...orchestration,
    updatedAt: now,
    ledger,
  };
}

export function formatOrchestrationContext(orchestration: SessionOrchestrationState | undefined): string | undefined {
  if (!orchestration) return undefined;

  const selectedSources = orchestration.policy.selectedSourceSlugs.length > 0
    ? orchestration.policy.selectedSourceSlugs.join(', ')
    : '(none)';
  const tasks = orchestration.taskBoard.tasks.length > 0
    ? orchestration.taskBoard.tasks.map(formatTask).join('\n')
    : '- main-session: execute only the user-requested scope and record evidence before final response.';
  const entropy = orchestration.entropy
    ? `Current orchestration entropy: ${orchestration.entropy.level} (${orchestration.entropy.score}) - ${orchestration.entropy.reasons.join('; ')}`
    : 'Current orchestration entropy: not elevated.';
  const artifactPaths = orchestration.artifacts
    ? [
        `briefs=${orchestration.artifacts.briefsPath}`,
        `reports=${orchestration.artifacts.reportsPath}`,
        `evidence_packages=${orchestration.artifacts.evidencePackagesPath}`,
        `progress_ledger=${orchestration.artifacts.progressLedgerPath}`,
      ].join('; ')
    : '(not initialized)';
  const ledger = orchestration.ledger
    ? [
        `current_task=${orchestration.ledger.currentTaskId ?? '(none)'}`,
        `completed=${orchestration.ledger.completed}`,
        `running=${orchestration.ledger.running}`,
        `blocked=${orchestration.ledger.blocked}`,
        `needs_review=${orchestration.ledger.needsReview}`,
        `needs_user_confirmation=${orchestration.ledger.needsUserConfirmation ? 'yes' : 'no'}`,
      ].join('; ')
    : '(not initialized)';

  return [
    `<orchestration_state version="${orchestration.version}" phase="${orchestration.phase}">`,
    'Plan/Audit/Merge separation:',
    '- PLAN: update the structured task board, select only necessary agents/sources, and do not draft final prose.',
    '- AUDIT: verify instruction fidelity, selected-source compliance, handoff completeness, and evidence before accepting any result.',
    '- MERGE: only the main synthesis owner writes the final artifact after audited handoffs are available.',
    '',
    'Task board is authoritative. Do not add tasks, sources, chapters, formats, languages, or working-directory discovery outside this board unless the user explicitly approves it.',
    'Spawn governance: spawned sub-agents must not spawn further sessions or create extra child-agent layers; if work is too large, return a structured handoff with gaps and recommendation to the main session.',
    `Selected source hard boundary: ${selectedSources}`,
    orchestration.policy.forbidWorkingDirectoryDiscovery
      ? 'Do not inventory or search the working directory as a source corpus. Use only selected sources, user attachments, or explicitly named file/folder paths.'
      : 'Working-directory discovery is allowed only when the user explicitly requests folder discovery.',
    'If a required decision, source expansion, scope expansion, or ambiguity blocks correct execution, emit this exact pause block and stop:',
    '<requires_user_decision>',
    'decision: ...',
    'reason: ...',
    'options: ...',
    '</requires_user_decision>',
    '',
    'Required sub-agent handoff format:',
    '<agent_handoff>',
    ...HANDOFF_FIELDS.map(field => `${field}: ...`),
    '</agent_handoff>',
    '',
    'Task board:',
    tasks,
    '',
    `Bounded autonomy artifact paths: ${artifactPaths}`,
    `Progress ledger: ${ledger}`,
    'Spawn dispatch rule: child agents receive only brief_path, allowed_sources, and report_path; they must read the brief and write their report instead of relying on broad parent context.',
    'Audit rule: before scanning conversation history or working directories, prefer evidence packages and report paths listed in the ledger.',
    '',
    entropy,
    '</orchestration_state>',
  ].join('\n');
}

export function getOrchestrationEntropySignal(input: OrchestrationEntropyInput): SessionOrchestrationEntropySignal | undefined {
  const reasons: string[] = [];
  let score = 0;

  if (input.enabledSourceCount >= 6) {
    score += 24;
    reasons.push('many enabled sources');
  } else if (input.enabledSourceCount >= 3) {
    score += 10;
    reasons.push('multiple enabled sources');
  }

  const spawnedSessionCount = input.spawnedSessionCount ?? 0;
  if (spawnedSessionCount >= 5) {
    score += 24;
    reasons.push('many spawned sub-agents');
  } else if (spawnedSessionCount >= 2) {
    score += 12;
    reasons.push('multiple spawned sub-agents');
  }

  const failedToolCount = input.failedToolCount ?? 0;
  if (failedToolCount > 0) {
    score += Math.min(24, failedToolCount * 8);
    reasons.push('tool failures');
  }

  const artifactWriteFailureCount = input.artifactWriteFailureCount ?? 0;
  if (artifactWriteFailureCount > 0) {
    score += Math.min(20, artifactWriteFailureCount * 10);
    reasons.push('artifact write instability');
  }

  const workspaceDiscoveryCount = input.workspaceDiscoveryCount ?? 0;
  if (workspaceDiscoveryCount > 0) {
    score += Math.min(30, workspaceDiscoveryCount * 15);
    reasons.push('workspace discovery under scoped-source policy');
  }

  const repeatedFailureCount = input.repeatedFailureCount ?? 0;
  if (repeatedFailureCount > 0) {
    score += Math.min(20, repeatedFailureCount * 10);
    reasons.push('repeated audit failures');
  }

  if ((input.contextUsagePercent ?? 0) >= 80) {
    score += 20;
    reasons.push('high context usage');
  }

  if (score < 25) return undefined;

  return {
    level: score >= 80 ? 'high' : 'warning',
    score,
    reasons,
    createdAt: input.now ?? Date.now(),
  };
}

function buildTaskBoardTasks(contract: SessionTaskContract, selectedSourceSlugs: string[]): SessionOrchestrationTask[] {
  const assignments = contract.documentPlan?.agentPlan?.assignments ?? [];
  const tasks: SessionOrchestrationTask[] = assignments.map(assignment => ({
    id: assignment.id,
    title: assignment.title,
    phase: 'plan',
    role: assignment.role,
    status: 'pending',
    scope: assignment.title,
    dependencies: [],
    allowedSourceSlugs: selectedSourceSlugs,
    forbiddenActions: buildForbiddenActions(contract),
    expectedHandoff: HANDOFF_FIELDS,
  }));

  if (tasks.length > 0) {
    tasks.push({
      id: 'main-session-audit',
      title: 'Audit scoped handoffs',
      phase: 'audit',
      role: 'orchestration_auditor',
      status: 'pending',
      scope: 'Validate instruction fidelity, source compliance, and handoff evidence.',
      dependencies: tasks.map(task => task.id),
      allowedSourceSlugs: selectedSourceSlugs,
      forbiddenActions: buildForbiddenActions(contract),
      expectedHandoff: ['audit_status', 'missing_handoffs', 'scope_violations', 'source_violations'],
    });
    tasks.push({
      id: 'main-session-merge',
      title: 'Final synthesis merge',
      phase: 'merge',
      role: contract.documentPlan?.agentPlan?.finalSynthesisOwner ?? 'main-session',
      status: 'pending',
      scope: 'Write the final deliverable only after audited handoffs pass.',
      dependencies: ['main-session-audit'],
      allowedSourceSlugs: selectedSourceSlugs,
      forbiddenActions: buildForbiddenActions(contract),
      expectedHandoff: ['final_artifact_path', 'source_coverage', 'known_gaps'],
    });
  }

  return tasks;
}

function buildForbiddenActions(contract: SessionTaskContract): string[] {
  return unique([
    'working-directory corpus discovery without explicit user approval',
    'using unselected source tools',
    'broadening chapters/files/folders beyond the task board',
    'writing final artifacts from spawned sub-agents',
    ...(contract.forbiddenShortcuts ?? []),
  ]);
}

function formatTask(task: SessionOrchestrationTask): string {
  const sources = task.allowedSourceSlugs.length > 0 ? task.allowedSourceSlugs.join(', ') : '(inherit current selected sources)';
  const deps = task.dependencies.length > 0 ? task.dependencies.join(', ') : '(none)';
  return `- ${task.id} [${task.phase}/${task.status}] ${task.title}; scope=${task.scope}; role=${task.role}; deps=${deps}; allowed_sources=${sources}`;
}

function buildProgressLedger(
  orchestration: SessionOrchestrationState,
  options: UpdateOrchestrationTaskStatusOptions,
  now: number,
): SessionOrchestrationProgressLedger {
  const counts = {
    pending: 0,
    running: 0,
    handoffReady: 0,
    completed: 0,
    needsReview: 0,
    blocked: 0,
    cancelled: 0,
  };

  for (const task of orchestration.taskBoard.tasks) {
    switch (task.status) {
      case 'pending':
        counts.pending += 1;
        break;
      case 'running':
        counts.running += 1;
        break;
      case 'handoff_ready':
        counts.handoffReady += 1;
        break;
      case 'completed':
        counts.completed += 1;
        break;
      case 'needs_review':
        counts.needsReview += 1;
        break;
      case 'blocked':
        counts.blocked += 1;
        break;
      case 'cancelled':
        counts.cancelled += 1;
        break;
    }
  }

  return {
    currentTaskId: options.currentTaskId ?? orchestration.ledger?.currentTaskId,
    ...counts,
    needsUserConfirmation: options.needsUserConfirmation
      ?? orchestration.ledger?.needsUserConfirmation
      ?? (orchestration.phase === 'paused' || counts.blocked > 0),
    evidencePackagePath: options.evidencePackagePath ?? orchestration.ledger?.evidencePackagePath,
    updatedAt: now,
  };
}

function isDependencySatisfied(status: SessionOrchestrationTaskStatus | undefined): boolean {
  return status === 'completed' || status === 'handoff_ready';
}

function isPhaseTaskSatisfied(task: SessionOrchestrationTask): boolean {
  if (task.phase === 'plan') return isDependencySatisfied(task.status);
  return task.status === 'completed';
}

function transitionTo(
  orchestration: SessionOrchestrationState,
  phase: SessionOrchestrationPhase,
  options: TransitionOrchestrationPhaseOptions,
): OrchestrationPhaseTransitionResult {
  const now = options.now ?? Date.now();
  const transitioned = refreshOrchestrationLedger({
    ...orchestration,
    phase,
    updatedAt: now,
  }, {
    needsUserConfirmation: phase === 'paused',
    now,
  });
  return { ok: true, orchestration: transitioned! };
}

function unique(values: string[]): string[] {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))];
}

function sameSlugSet(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const a = [...left].sort();
  const b = [...right].sort();
  return a.every((slug, index) => slug === b[index]);
}

function isSubAgentHandoffReady(agent: SessionSubAgentLifecycleEntry): boolean {
  return agent.status === 'handoff_received' || agent.status === 'completed';
}

function normalizeReportPath(reportPath: string): string {
  return reportPath.replace(/\\/g, '/').trim().toLowerCase();
}

function getHandoffReportFamily(reportPath: string): { key: string; splitMarker?: string } | undefined {
  const normalized = normalizeReportPath(reportPath);
  const fileName = normalized.split('/').pop();
  if (!fileName) return undefined;

  const stem = fileName.replace(/\.[^.]+$/, '');
  const match = stem.match(/^(.+?)(?:[-_ ]([a-z]|part[-_ ]?\d+|p\d+))?([-_ ]handoff(?:[-_ ]v\d+)?)$/i);
  if (!match) return undefined;

  const prefix = match[1];
  const splitMarker = match[2];
  const suffix = match[3];
  if (!prefix || !suffix) return undefined;

  return {
    key: `${prefix}${suffix}`.replace(/[-_ ]+/g, '-'),
    splitMarker,
  };
}
