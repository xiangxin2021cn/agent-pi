import type { SessionDocumentAgentPlan, SessionDocumentArtifactVisibilityPlan, SessionDocumentDeliveryReviewPlan, SessionDocumentEvidenceMatrixEntry, SessionDocumentPlan, SessionRequirementLedger, SessionTaskContract } from './types.ts';

const MAX_ITEMS_PER_SECTION = 3;
const MAX_ITEM_LENGTH = 260;
const BOQ_PRICING_WORKBOOK_PROTOCOL_PATTERN = /组价|单价|报价|清单项|工程量清单|工程量|人材机|材料|机械|人工|boq|bill of quantities|pricing|unit[-\s]?rate|rate build[-\s]?up|resource rate|schedule of rates/i;
const WORKBOOK_PROTOCOL_PATTERN = /excel|xlsx?|xlsm|workbook|spreadsheet|worksheet|sheet|表格|工作簿|工作表|清单|schedule|csv/i;

export function formatTaskContractContext(contract: SessionTaskContract | undefined): string | undefined {
  if (!contract) return undefined;
  if (contract.documentQualityMode === 'native_quick') return undefined;

  const sections = [
    formatInline('Document workflow mode', contract.documentQualityMode, 80),
    formatDocumentWorkflowExecutionProtocol(contract),
    formatDocumentArtifactWritingProtocol(contract),
    formatCriticalReasoningProtocol(contract),
    formatDocumentPlan(contract.documentPlan),
    formatLine('Original request', contract.originalRequest, 500),
    formatList('Deliverables', contract.deliverables),
    formatArtifactDeliverables(contract),
    formatList('Must preserve', contract.mustPreserve),
    formatList('Evidence requirements', contract.evidenceRequirements),
    formatList('Output formats', contract.outputFormats),
    formatList('Acceptance criteria', contract.acceptanceCriteria),
    formatList('Forbidden shortcuts', contract.forbiddenShortcuts),
    formatRequirementLedger(contract.requirementLedger),
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

function formatRequirementLedger(ledger: SessionRequirementLedger | undefined): string | undefined {
  if (!ledger || ledger.entries.length === 0) return undefined;
  const entries = ledger.entries.slice(0, 48).map(entry => {
    const sources = entry.sourceRefs.length > 0 ? ` Sources: ${entry.sourceRefs.join(', ')}.` : '';
    return `${entry.id} [${entry.kind}/${entry.status}] ${entry.text} Verification: ${entry.verification}.${sources}`;
  });
  return ['Requirement ledger:', ...entries.map((entry, index) => `${index + 1}. ${entry}`)].join('\n');
}

function formatDocumentArtifactWritingProtocol(contract: SessionTaskContract): string | undefined {
  const mode = contract.documentQualityMode;
  if (mode !== 'professional_document' && mode !== 'strict_delivery' && mode !== 'multi_agent_deep') return undefined;

  const hasMarkdownDeliverable = (contract.artifactDeliverables?.length ?? 0) > 0
    ? contract.artifactDeliverables?.some(deliverable => deliverable.required && deliverable.format.toUpperCase() === 'MD')
    : contract.outputFormats.some(format => format.toUpperCase() === 'MD');

  if (!hasMarkdownDeliverable) {
    return [
      'Document artifact production protocol:',
      '1. Use the registered capability for each requested artifact format; do not create Markdown or PDF as an unrequested intermediate deliverable.',
      '2. Validate each artifact only to its declared validation level and report stronger validation as unavailable rather than implied.',
      '3. Keep source evidence and internal audit artifacts separate from the reader-facing deliverable unless the user explicitly requests them.',
    ].join('\n');
  }

  return [
    'Document artifact writing protocol:',
    '1. Use document_artifact for long Markdown deliverables; do not construct them with one large Write/Bash/Python/heredoc payload.',
    '2. Follow this transaction exactly: init -> write_section -> status -> prepare_merge -> assemble -> validate.',
    '3. Declare the complete ordered section manifest during init and write one bounded section at a time.',
    '4. If one section write fails, rewrite only that section; never rebuild the whole document from model memory.',
    '5. Do not bypass prepare_merge or assemble: they freeze section hashes and atomically write only the verified set to the formal output folder.',
    '6. Before final response, call validate with exact required headings or constraint markers from the task contract.',
  ].join('\n');
}

function formatArtifactDeliverables(contract: SessionTaskContract): string | undefined {
  const items = contract.artifactDeliverables?.map(deliverable => {
    const requirement = deliverable.required ? 'required' : 'optional';
    const template = deliverable.templatePath ? `; template=${deliverable.templatePath}` : '';
    return `${deliverable.format} [${deliverable.kind}] ${requirement}; origin=${deliverable.origin}; validation=${deliverable.validationLevel}${template}`;
  });
  return formatList('Artifact deliverables', items);
}

function formatCriticalReasoningProtocol(contract: SessionTaskContract): string | undefined {
  const mode = contract.documentQualityMode;
  if (mode !== 'professional_document' && mode !== 'strict_delivery' && mode !== 'multi_agent_deep') return undefined;

  const lines = [
    'Critical reasoning protocol:',
    '1. Test material claims, counterarguments, and evidence gaps privately before drafting.',
    '2. Resolve contradictions and keep unverified claims conditional until source evidence supports them.',
    '3. Do not expose reasoning scaffolds as numbered sections, framework tables, or review narration.',
    '4. Draft only the reader-facing genre, structure, and decision support defined by the document plan.',
  ];

  if (mode === 'strict_delivery') {
    lines.push('5. Do not invent cases, data, citations, or source locators; mark unavailable evidence as a gap.');
  }

  if (mode === 'multi_agent_deep') {
    lines.push('5. Use reviewer or chapter-agent handoffs to surface opposing views privately before final synthesis.');
  }

  return lines.join('\n');
}

function formatDocumentWorkflowExecutionProtocol(contract: SessionTaskContract): string | undefined {
  if (contract.documentQualityMode === 'professional_document') {
    const lines = [
      'Document workflow execution protocol:',
      '1. Build or update the evidence matrix before drafting source-backed claims. Keep it as an internal artifact and do not place it in reader-facing prose unless explicitly requested.',
      '2. When writing evidence-matrix.json, use valid JSON with schemaVersion=1, non-empty sources[], and claims[] entries containing id, claim, sourceId, locator, and status (verified, assumption, or unverified). Markdown stored under a .json filename is invalid.',
      '3. Plan sections, tables, visuals, and citations before writing final prose.',
      '4. Keep source notes for key claims, tables, and visual evidence.',
      '5. Run a document-quality pass before claiming completion.',
    ];
    const nextIndex = appendComplexAgentOrchestrationProtocol(lines, contract, 6);
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
    `6. After spawn_session returns, use get_spawn_status and follow parentAction. While it is "wait", do not inspect original sources, calculate substitutes, or write child reports; the runtime pauses and resumes the parent only after every terminal handoff is ready.`,
    `7. Keep active spawned chapter sessions in small batches and do not spawn nested child sessions.`,
    `8. Each spawned chapter session must return a handoff note only and must not write or replace the final artifact.`,
    `9. Omit workingDirectory in spawned chapter sessions unless a different directory is explicitly required, so they inherit the current session working directory.`,
    `10. Record chapter-agent handoff notes with source gaps and unresolved assumptions.`,
    `11. Read the completed handoff reports and resolve contradictory claims before final synthesis; a statement that consistency review occurred is not sufficient evidence.`,
    `12. Only ${finalSynthesisOwner} may write the final synthesized deliverable after cross-chapter review.`,
  ];
  appendBoqPricingWorkbookProtocol(lines, contract, 13);
  return lines.join('\n');
}

function appendComplexAgentOrchestrationProtocol(lines: string[], contract: SessionTaskContract, startIndex: number): number {
  const agentPlan = contract.documentPlan?.agentPlan;
  if (!agentPlan || agentPlan.assignments.length === 0) return startIndex;

  lines.push(`${startIndex}. Because a Document agent plan is present, the main session must decide orchestration before drafting and use spawn_session for the listed scoped assignments when the task has multiple chapters, sources, files, or review domains.`);
  lines.push(`${startIndex + 1}. Spawned helper sessions must inherit selected sources or name the same knowledge-base/source slugs, must not broaden into working-directory discovery, and must return handoff notes rather than final artifacts.`);
  lines.push(`${startIndex + 2}. After spawning, use get_spawn_status and follow parentAction. Pending helpers retain exclusive ownership of their assigned work; do not replace them after a fixed timeout or treat status "todo" as failure.`);
  lines.push(`${startIndex + 3}. The main session remains the final synthesis owner. It may read, compare, and resolve terminal helper handoffs before writing the final deliverable; if a helper fails or loses its report, retry it or record an explicit missing-child gap instead of fabricating the child report.`);
  return startIndex + 4;
}

function appendBoqPricingWorkbookProtocol(lines: string[], contract: SessionTaskContract, startIndex: number): number {
  if (!isBoqPricingWorkbookContract(contract)) return startIndex;

  lines.push(`${startIndex}. For BOQ/pricing workbook tasks, run xlsx-tool info first to inventory worksheets, tables, dimensions, and candidate item ranges before any pricing derivation.`);
  lines.push(`${startIndex + 1}. Do not read or export the full pricing workbook in one pass for derivation; use xlsx-tool read with --sheet, --range, and bounded reads.`);
  lines.push(`${startIndex + 2}. Spawn one sheet-pricing agent per worksheet or BOQ table, but keep active sheet agents in small batches to avoid memory pressure.`);
  lines.push(`${startIndex + 3}. If a sheet is still too large, the main session must split it into bounded item ranges and spawn those range agents itself; child agents must return a split request instead of spawning nested sessions.`);
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
  const editorialProfile = plan?.editorialProfile
    ? [
        'Document editorial profile:',
        `Genre: ${plan.editorialProfile.genre}`,
        `Reader decision: ${plan.editorialProfile.readerDecision}`,
        `Narrative first: ${plan.editorialProfile.narrativeFirst ? 'yes' : 'no'}`,
        `Budgets: headings<=${plan.editorialProfile.maxHeadings}, tables<=${plan.editorialProfile.maxTables}, tableLineRatio<=${plan.editorialProfile.maxTableLineRatio}`,
      ].join('\n')
    : undefined;
  const sectionPlan = formatList('Document section plan', plan?.sections);
  const tablePlan = formatList('Document table plan', plan?.tables);
  const chartPlan = formatList('Document chart plan', plan?.charts);
  const enhancementPlan = formatList('Document enhancement plan', plan?.enhancements);
  const citationPlan = formatList('Document citation plan', plan?.citations);
  const deliveryFormats = formatList('Document delivery formats', plan?.deliveryFormats);
  const agentPlan = formatDocumentAgentPlan(plan?.agentPlan);
  const evidenceMatrix = formatDocumentEvidenceMatrix(plan?.evidenceMatrix);
  const deliveryReviewPlan = formatDocumentDeliveryReviewPlan(plan?.deliveryReviewPlan);
  const artifactVisibility = formatDocumentArtifactVisibility(plan?.artifactVisibility);
  if (!editorialProfile && !sectionPlan && !tablePlan && !chartPlan && !enhancementPlan && !citationPlan && !deliveryFormats && !agentPlan && !evidenceMatrix && !deliveryReviewPlan && !artifactVisibility) return undefined;

  return [
    editorialProfile,
    sectionPlan,
    tablePlan,
    chartPlan,
    enhancementPlan,
    citationPlan,
    deliveryFormats,
    agentPlan ? ['Document agent plan:', agentPlan].join('\n') : undefined,
    evidenceMatrix ? ['Evidence matrix:', evidenceMatrix].join('\n') : undefined,
    deliveryReviewPlan ? ['Delivery review plan:', deliveryReviewPlan].join('\n') : undefined,
    artifactVisibility ? ['Artifact visibility:', artifactVisibility].join('\n') : undefined,
  ].filter(Boolean).join('\n');
}

function formatDocumentArtifactVisibility(plan: SessionDocumentArtifactVisibilityPlan | undefined): string | undefined {
  if (!plan) return undefined;
  return [
    `Reader-facing: ${plan.readerFacing.join(', ')}`,
    `Internal only by default: ${plan.internal.join(', ')}`,
    `Explicitly visible internal artifacts: ${plan.visibleInternal.join(', ') || '(none)'}`,
    `Table-led profile: ${plan.tableLed ? 'yes' : 'no'}`,
    'Keep internal control artifacts out of the final body unless listed as explicitly visible.',
  ].join('\n');
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
