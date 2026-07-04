import type { SessionDocumentAgentPlan, SessionDocumentDeliveryReviewPlan, SessionDocumentEvidenceMatrixEntry, SessionDocumentPlan, SessionTaskContract } from './types.ts';

const MAX_ITEMS_PER_SECTION = 3;
const MAX_ITEM_LENGTH = 260;

export function formatTaskContractContext(contract: SessionTaskContract | undefined): string | undefined {
  if (!contract) return undefined;

  const sections = [
    formatInline('Document workflow mode', contract.documentQualityMode, 80),
    formatDocumentWorkflowExecutionProtocol(contract),
    formatCriticalReasoningProtocol(contract),
    formatDocumentPlan(contract.documentPlan),
    formatLine('Original request', contract.originalRequest, 500),
    formatList('Deliverables', contract.deliverables),
    formatList('Must preserve', contract.mustPreserve),
    formatList('Evidence requirements', contract.evidenceRequirements),
    formatList('Output formats', contract.outputFormats),
    formatList('Acceptance criteria', contract.acceptanceCriteria),
    formatList('Forbidden shortcuts', contract.forbiddenShortcuts),
  ].filter(Boolean);

  if (sections.length === 0) return undefined;

  return [
    formatGoalContractOpenTag(contract),
    'Execution guidance:',
    '- Treat this contract as the acceptance boundary for the current task.',
    '- Preserve explicit requirements and referenced evidence before optimizing for brevity.',
    '- Do not claim completion until deliverables, evidence requirements, and forbidden shortcuts are checked.',
    '',
    ...sections,
    '</goal_contract>',
  ].join('\n');
}

function formatCriticalReasoningProtocol(contract: SessionTaskContract): string | undefined {
  const mode = contract.documentQualityMode;
  if (mode !== 'professional_document' && mode !== 'strict_delivery' && mode !== 'multi_agent_deep') return undefined;

  const lines = [
    'Critical reasoning protocol:',
    '1. Break the problem into three material dimensions and state why each dimension matters.',
    '2. Compare optimistic and pessimistic interpretations for each material dimension. Include explicit assumptions, evidence, and counterarguments.',
    '3. Challenge the draft from a skeptical third-party reviewer view. Identify the weakest logic or evidence gaps.',
    '4. Reconcile the challenge by revising claims, structure, or assumptions before finalizing.',
    '5. End with a bounded conclusion that states conditions, risks, and what would change the answer.',
    '6. Use this as private reasoning scaffolding unless the requested deliverable explicitly asks for visible step headings.',
  ];

  if (mode === 'strict_delivery') {
    lines.push('7. Do not invent cases, data, citations, or source locators; mark unavailable evidence as a gap.');
  }

  if (mode === 'multi_agent_deep') {
    lines.push('7. Use reviewer or chapter-agent handoffs to surface opposing views before final synthesis.');
  }

  return lines.join('\n');
}

function formatDocumentWorkflowExecutionProtocol(contract: SessionTaskContract): string | undefined {
  if (contract.documentQualityMode === 'professional_document') {
    return [
      'Document workflow execution protocol:',
      '1. Build or update the evidence matrix before drafting source-backed claims.',
      '2. Plan sections, tables, visuals, and citations before writing final prose.',
      '3. Keep source notes for key claims, tables, and visual evidence.',
      '4. Run a document-quality pass before claiming completion.',
    ].join('\n');
  }

  if (contract.documentQualityMode === 'strict_delivery') {
    return [
      'Document workflow execution protocol:',
      '1. Resolve source, template, export, visual, and format gates before claiming strict delivery.',
      '2. Write missing gate evidence into the artifact or report the gate as blocked.',
      '3. Verify requested output files and cite the verification evidence before final response.',
      '4. Do not accept prompt-only compliance for template, export, visual, or source gates.',
    ].join('\n');
  }

  if (contract.documentQualityMode !== 'multi_agent_deep') return undefined;

  const finalSynthesisOwner = contract.documentPlan?.agentPlan?.finalSynthesisOwner ?? 'final_synthesis_owner';
  return [
    'Document workflow execution protocol:',
    `1. Use the chapter-agent assignments as the work breakdown before drafting the final artifact.`,
    `2. When spawn_session is available, call spawn_session with help=true first, then spawn one session per chapter-agent assignment.`,
    `3. Each spawned chapter session must return a handoff note only and must not write or replace the final artifact.`,
    `4. Omit workingDirectory in spawned chapter sessions unless a different directory is explicitly required, so they inherit the current session working directory.`,
    `5. Record chapter-agent handoff notes with source gaps and unresolved assumptions.`,
    `6. Resolve cross-chapter consistency conflicts before final synthesis.`,
    `7. Only ${finalSynthesisOwner} may write the final synthesized deliverable after cross-chapter review.`,
  ].join('\n');
}

function formatGoalContractOpenTag(contract: SessionTaskContract): string {
  const attributes = [
    `taskType="${escapeAttribute(contract.taskType)}"`,
    contract.documentQualityMode
      ? `documentQualityMode="${escapeAttribute(contract.documentQualityMode)}"`
      : undefined,
  ].filter(Boolean);
  return `<goal_contract ${attributes.join(' ')}>`;
}

function formatDocumentPlan(plan: SessionDocumentPlan | undefined): string | undefined {
  const sectionPlan = formatList('Document section plan', plan?.sections);
  const tablePlan = formatList('Document table plan', plan?.tables);
  const chartPlan = formatList('Document chart plan', plan?.charts);
  const enhancementPlan = formatList('Document enhancement plan', plan?.enhancements);
  const citationPlan = formatList('Document citation plan', plan?.citations);
  const deliveryFormats = formatList('Document delivery formats', plan?.deliveryFormats);
  const agentPlan = formatDocumentAgentPlan(plan?.agentPlan);
  const evidenceMatrix = formatDocumentEvidenceMatrix(plan?.evidenceMatrix);
  const deliveryReviewPlan = formatDocumentDeliveryReviewPlan(plan?.deliveryReviewPlan);
  if (!sectionPlan && !tablePlan && !chartPlan && !enhancementPlan && !citationPlan && !deliveryFormats && !agentPlan && !evidenceMatrix && !deliveryReviewPlan) return undefined;

  return [
    sectionPlan,
    tablePlan,
    chartPlan,
    enhancementPlan,
    citationPlan,
    deliveryFormats,
    agentPlan ? ['Document agent plan:', agentPlan].join('\n') : undefined,
    evidenceMatrix ? ['Evidence matrix:', evidenceMatrix].join('\n') : undefined,
    deliveryReviewPlan ? ['Delivery review plan:', deliveryReviewPlan].join('\n') : undefined,
  ].filter(Boolean).join('\n');
}

function formatDocumentDeliveryReviewPlan(plan: SessionDocumentDeliveryReviewPlan | undefined): string | undefined {
  if (!plan) return undefined;
  return [
    `Failure action: ${plan.failureAction}`,
    formatList('Gates', plan.gates.map(gate => `${gate.id} requires ${gate.requirement} Evidence: ${gate.evidence}`)),
  ].filter(Boolean).join('\n');
}

function formatDocumentEvidenceMatrix(entries: SessionDocumentEvidenceMatrixEntry[] | undefined): string | undefined {
  if (!entries || entries.length === 0) return undefined;
  return formatList('Sources', entries.map(formatEvidenceMatrixEntry));
}

function formatEvidenceMatrixEntry(entry: SessionDocumentEvidenceMatrixEntry): string {
  return [
    `${entry.source} [${entry.sourceType}] supports ${entry.supports}`,
    `Reliability: ${entry.reliabilityNote}`,
    `Citation fields: ${entry.citationFields.join(', ')}`,
    `Reuse: ${entry.reuseStatus}`,
  ].join(' ');
}

function formatDocumentAgentPlan(plan: SessionDocumentAgentPlan | undefined): string | undefined {
  if (!plan) return undefined;

  return [
    `Mode: ${plan.mode}`,
    `Final synthesis owner: ${plan.finalSynthesisOwner}`,
    formatList('Assignments', plan.assignments.map(assignment => `${assignment.title} - ${assignment.role} - ${assignment.reviewFocus}`)),
    formatList('Review stages', plan.reviewStages),
    formatList('Guardrails', plan.guardrails),
  ].filter(Boolean).join('\n');
}

function formatInline(label: string, value: string | undefined, maxLength = MAX_ITEM_LENGTH): string | undefined {
  const normalized = normalizeText(value, maxLength);
  return normalized ? `${label}: ${normalized}` : undefined;
}

function formatLine(label: string, value: string | undefined, maxLength = MAX_ITEM_LENGTH): string | undefined {
  const normalized = normalizeText(value, maxLength);
  return normalized ? `${label}:\n${normalized}` : undefined;
}

function formatList(label: string, values: string[] | undefined): string | undefined {
  const items = (values ?? [])
    .map(value => normalizeText(value))
    .filter((value): value is string => Boolean(value))
    .slice(0, MAX_ITEMS_PER_SECTION);

  if (items.length === 0) return undefined;

  return [
    `${label}:`,
    ...items.map((item, index) => `${index + 1}. ${item}`),
  ].join('\n');
}

function normalizeText(value: string | undefined, maxLength = MAX_ITEM_LENGTH): string | undefined {
  const normalized = value?.replace(/\s+/g, ' ').trim();
  if (!normalized) return undefined;
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}…` : normalized;
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}
