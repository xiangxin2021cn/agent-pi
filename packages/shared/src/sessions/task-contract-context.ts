import type { SessionDocumentAgentPlan, SessionDocumentDeliveryReviewPlan, SessionDocumentEvidenceMatrixEntry, SessionDocumentPlan, SessionTaskContract } from './types.ts';

const MAX_ITEMS_PER_SECTION = 3;
const MAX_ITEM_LENGTH = 260;
const BOQ_PRICING_WORKBOOK_PROTOCOL_PATTERN = /组价|单价|报价|清单项|工程量清单|工程量|人材机|材料|机械|人工|boq|bill of quantities|pricing|unit[-\s]?rate|rate build[-\s]?up|resource rate|schedule of rates/i;
const WORKBOOK_PROTOCOL_PATTERN = /excel|xlsx?|xlsm|workbook|spreadsheet|worksheet|sheet|表格|工作簿|工作表|清单|schedule|csv/i;

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
    '- Use only selected sources, attached files, and explicitly named file or folder paths as task input.',
    '- Do not inventory the working directory as a source corpus unless the user explicitly requests folder discovery.',
    '- Check instruction fidelity before improving document quality.',
    '- Do not broaden requested scope, selected sources, output format, or response language during improvement passes.',
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
    const lines = [
      'Document workflow execution protocol:',
      '1. Build or update the evidence matrix before drafting source-backed claims.',
      '2. Plan sections, tables, visuals, and citations before writing final prose.',
      '3. Keep source notes for key claims, tables, and visual evidence.',
      '4. Run a document-quality pass before claiming completion.',
    ];
    const nextIndex = appendComplexAgentOrchestrationProtocol(lines, contract, 5);
    appendBoqPricingWorkbookProtocol(lines, contract, nextIndex);
    return lines.join('\n');
  }

  if (contract.documentQualityMode === 'strict_delivery') {
    const lines = [
      'Document workflow execution protocol:',
      '1. Resolve source, template, export, visual, and format gates before claiming strict delivery.',
      '2. Write missing gate evidence into the artifact or report the gate as blocked.',
      '3. Verify requested output files and cite the verification evidence before final response.',
      '4. Do not accept prompt-only compliance for template, export, visual, or source gates.',
    ];
    const nextIndex = appendComplexAgentOrchestrationProtocol(lines, contract, 5);
    appendBoqPricingWorkbookProtocol(lines, contract, nextIndex);
    return lines.join('\n');
  }

  if (contract.documentQualityMode !== 'multi_agent_deep') return undefined;

  const finalSynthesisOwner = contract.documentPlan?.agentPlan?.finalSynthesisOwner ?? 'final_synthesis_owner';
  const lines = [
    'Document workflow execution protocol:',
    `1. Before drafting, restate the exact user-requested scope and selected sources.`,
    `2. For multi-agent deep mode, create real spawned chapter sessions with spawn_session before final synthesis unless the user explicitly requests single-agent execution.`,
    `3. Call spawn_session with help=true first, then spawn only the scoped chapter-agent assignments needed for the request.`,
    `4. If the request names a single chapter, source, file, or folder, spawn only agents for that scoped input and do not spawn agents for other chapters or sources.`,
    `5. Each spawned chapter prompt must name the selected knowledge-base/source slugs or inherit them, forbid broad working-directory discovery, and require source-grounded handoff notes.`,
    `6. Each spawned chapter session must return a handoff note only and must not write or replace the final artifact.`,
    `7. Omit workingDirectory in spawned chapter sessions unless a different directory is explicitly required, so they inherit the current session working directory.`,
    `8. Record chapter-agent handoff notes with source gaps and unresolved assumptions.`,
    `9. Resolve cross-chapter consistency conflicts before final synthesis.`,
    `10. Only ${finalSynthesisOwner} may write the final synthesized deliverable after cross-chapter review.`,
  ];
  appendBoqPricingWorkbookProtocol(lines, contract, 11);
  return lines.join('\n');
}

function appendComplexAgentOrchestrationProtocol(lines: string[], contract: SessionTaskContract, startIndex: number): number {
  const agentPlan = contract.documentPlan?.agentPlan;
  if (!agentPlan || agentPlan.assignments.length === 0) return startIndex;

  lines.push(`${startIndex}. Because a Document agent plan is present, the main session must decide orchestration before drafting and use spawn_session for the listed scoped assignments when the task has multiple chapters, sources, files, or review domains.`);
  lines.push(`${startIndex + 1}. Spawned helper sessions must inherit selected sources or name the same knowledge-base/source slugs, must not broaden into working-directory discovery, and must return handoff notes rather than final artifacts.`);
  lines.push(`${startIndex + 2}. The main session remains the final synthesis owner and must resolve helper handoffs before writing the final deliverable.`);
  return startIndex + 3;
}

function appendBoqPricingWorkbookProtocol(lines: string[], contract: SessionTaskContract, startIndex: number): number {
  if (!isBoqPricingWorkbookContract(contract)) return startIndex;

  lines.push(`${startIndex}. For BOQ/pricing workbook tasks, run xlsx-tool info first to inventory worksheets, tables, dimensions, and candidate item ranges before any pricing derivation.`);
  lines.push(`${startIndex + 1}. Do not read or export the full pricing workbook in one pass for derivation; use xlsx-tool read with --sheet, --range, and bounded reads.`);
  lines.push(`${startIndex + 2}. Spawn one sheet-pricing agent per worksheet or BOQ table, but keep active sheet agents in small batches to avoid memory pressure.`);
  lines.push(`${startIndex + 3}. If a sheet is still too large, that sheet agent must spawn item-range agents before deriving every BOQ item.`);
  lines.push(`${startIndex + 4}. Each sheet or item-range agent returns a handoff only: sheet/range, items covered, unit-rate method, quantity/resource/productivity/rate/formula evidence, source gaps, and unresolved assumptions.`);
  lines.push(`${startIndex + 5}. The final pricing synthesis owner merges sheet handoffs, checks missing worksheets/items, and must not invent rates where evidence is missing.`);
  return startIndex + 6;
}

function isBoqPricingWorkbookContract(contract: SessionTaskContract): boolean {
  const text = [
    contract.originalRequest,
    ...(contract.followUpRequests ?? []),
    ...(contract.deliverables ?? []),
    ...(contract.evidenceRequirements ?? []),
    ...(contract.forbiddenShortcuts ?? []),
    ...(contract.documentPlan?.agentPlan?.guardrails ?? []),
  ].join('\n');
  return BOQ_PRICING_WORKBOOK_PROTOCOL_PATTERN.test(text) && WORKBOOK_PROTOCOL_PATTERN.test(text);
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
