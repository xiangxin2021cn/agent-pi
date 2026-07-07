import type {
  SessionOrchestrationArtifactPaths,
  SessionOrchestrationEntropySignal,
  SessionOrchestrationProgressLedger,
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

function unique(values: string[]): string[] {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))];
}
