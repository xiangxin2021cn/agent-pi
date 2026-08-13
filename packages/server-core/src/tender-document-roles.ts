/**
 * Infer project industry and document role for professional tender analysis briefs.
 * Heuristics only — boundary stage may override later.
 */

export const TENDER_PROJECT_INDUSTRIES = [
  'highway_road',
  'building_civil',
  'hospital_healthcare',
  'power_energy',
  'water_environmental',
  'mining_industrial',
  'generic_infrastructure',
] as const;

export type TenderProjectIndustry = (typeof TENDER_PROJECT_INDUSTRIES)[number];

export const TENDER_DOCUMENT_ROLES = [
  'boq_pricing_schedule',
  'technical_specification',
  'contract_conditions',
  'hse_ohs',
  'geotechnical',
  'environmental_permit',
  'drawings_layout',
  'addendum_clarification',
  'returnable_forms',
  'tender_data',
  'other',
] as const;

export type TenderDocumentRole = (typeof TENDER_DOCUMENT_ROLES)[number];

const INDUSTRY_HINTS: Array<{ industry: TenderProjectIndustry; pattern: RegExp }> = [
  { industry: 'highway_road', pattern: /\b(highway|road|route|motorway|freeway|pavement|carriageway|sanral|coto|colto|moloto|\br\d{2,4}\b|n\d{1,3}\b)\b/i },
  { industry: 'hospital_healthcare', pattern: /\b(hospital|clinic|healthcare|medical\s+ward|theatre)\b/i },
  { industry: 'power_energy', pattern: /\b(substation|transmission|power\s+plant|solar|wind\s+farm|hv\b|mv\b)\b/i },
  { industry: 'water_environmental', pattern: /\b(water\s+treatment|wastewater|pipeline|reservoir|sewerage|wul|dws)\b/i },
  { industry: 'mining_industrial', pattern: /\b(mine|mining|smelter|plant\s+upgrade|process\s+plant)\b/i },
  { industry: 'building_civil', pattern: /\b(building|school|campus|residential|office|warehouse|civil\s+works)\b/i },
];

const ROLE_HINTS: Array<{ role: TenderDocumentRole; pattern: RegExp }> = [
  { role: 'boq_pricing_schedule', pattern: /\bboq\b|bill[ _-]*of[ _-]*quantit|pricing[ _-]*schedule|schedule\s+[abcd]\b/i },
  { role: 'hse_ohs', pattern: /health[ _-]*and[ _-]*safety|ohs\b|hse\b|baseline[ _-]*risk|safety\s+spec/i },
  { role: 'geotechnical', pattern: /geotech|geotechnical|soil\s+investigation|foundation\s+investigation|quarry/i },
  { role: 'environmental_permit', pattern: /\bempr\b|environmental\s+authori|general\s+authori|\bwul\b|nei\s*ma|ga\s+granted/i },
  { role: 'technical_specification', pattern: /specification|\bspec\b|coto|colto|standard\s+spec/i },
  { role: 'contract_conditions', pattern: /conditions?\s+of\s+contract|fidic|particular\s+conditions|contract\s+data/i },
  { role: 'drawings_layout', pattern: /drawing|\bdwg\b|layout|plan\s+sheet|general\s+arrangement/i },
  { role: 'addendum_clarification', pattern: /addendum|clarification|bulletin|corrigendum/i },
  { role: 'returnable_forms', pattern: /returnable|return\s+schedule|form\s+c\d/i },
  { role: 'tender_data', pattern: /tender\s+data|bid\s+data|invitation\s+to\s+tender|\brfp\b/i },
];

export function inferProjectIndustry(hints: Array<{ name?: string; path?: string; kind?: string }>): TenderProjectIndustry {
  const blob = hints.map((h) => `${h.name ?? ''} ${h.path ?? ''} ${h.kind ?? ''}`).join(' ');
  for (const entry of INDUSTRY_HINTS) {
    if (entry.pattern.test(blob)) return entry.industry;
  }
  return 'generic_infrastructure';
}

export function inferDocumentRole(input: {
  name?: string;
  path?: string;
  kind?: string;
}): TenderDocumentRole {
  const blob = `${input.name ?? ''} ${input.path ?? ''} ${input.kind ?? ''}`;
  for (const entry of ROLE_HINTS) {
    if (entry.pattern.test(blob)) return entry.role;
  }
  if (input.kind === 'boq') return 'boq_pricing_schedule';
  if (input.kind === 'specification') return 'technical_specification';
  if (input.kind === 'contract_data') return 'contract_conditions';
  if (input.kind === 'drawing') return 'drawings_layout';
  if (input.kind === 'addendum') return 'addendum_clarification';
  if (input.kind === 'returnable_schedule') return 'returnable_forms';
  if (input.kind === 'tender_data') return 'tender_data';
  return 'other';
}

export function industryWritingGuidance(industry: TenderProjectIndustry): string {
  switch (industry) {
    case 'highway_road':
      return 'Use highway tender jargon: chainage/km, carriageway, pavement layers, traffic accommodation, temporary works, P&G, measurement & payment clauses.';
    case 'hospital_healthcare':
      return 'Use healthcare facility jargon: departments, MEP, medical gases, infection control, commissioning, soft landings.';
    case 'power_energy':
      return 'Use power/energy jargon: bay/feeder, protection, outage windows, grid code, SCADA, HV/MV interfaces.';
    case 'water_environmental':
      return 'Use water/environment jargon: process units, hydraulic capacity, discharge limits, EMP/WUL conditions, construction windows.';
    case 'mining_industrial':
      return 'Use mining/industrial jargon: process areas, shutdown interfaces, brownfield constraints, plant availability.';
    case 'building_civil':
      return 'Use building/civil jargon: trade packages, preliminaries, method statements, temporary works, handover.';
    default:
      return 'Use professional infrastructure tender language for the inferred sector; avoid generic file-catalog tone.';
  }
}

export function documentRoleWritingGuidance(role: TenderDocumentRole): string {
  switch (role) {
    case 'boq_pricing_schedule':
      return 'Focus on schedule structure, provisional/PC sums, unpriced measured items, chapter boundaries, and pricing implications.';
    case 'hse_ohs':
      return 'Focus on mandatory HSE deliverables, staffing ratios, hard constraints (school grounds, traffic, demolitions), and bid-cost implications.';
    case 'geotechnical':
      return 'Focus on ground conditions, borrow/quarry, foundation risks, and impacts on method/productivity.';
    case 'environmental_permit':
      return 'Focus on permit conditions, windows, water-use limits, and compliance that constrains programme/method.';
    case 'technical_specification':
      return 'Focus on governing specs, materials, tolerances, testing, and measurement/payment cross-links.';
    case 'contract_conditions':
      return 'Focus on contract form, risk allocation, programme/penalty clauses, payment, and returnables.';
    case 'drawings_layout':
      return 'Focus on scope extents, interfaces, and constructability risks visible on drawings.';
    case 'addendum_clarification':
      return 'Focus on changed requirements and superseding instructions that alter price/programme.';
    case 'returnable_forms':
      return 'Focus on mandatory returnables, declarations, and evaluation traps.';
    case 'tender_data':
      return 'Focus on closing date, eligibility, submission rules, and evaluation framework.';
    default:
      return 'Extract bid-relevant constraints, risks, and open questions; do not narrate the file.';
  }
}

export function buildProfessionalDocumentAnalysisObjective(input: {
  projectIndustry: TenderProjectIndustry;
  documentRole: TenderDocumentRole;
}): string {
  return [
    'Analyze exactly one registered tender source for a professional bid team (estimator / technical / commercial).',
    `Project industry draft: ${input.projectIndustry}. ${industryWritingGuidance(input.projectIndustry)}`,
    `Document role draft: ${input.documentRole}. ${documentRoleWritingGuidance(input.documentRole)}`,
    'Write structured JSON sections to reportPath and a customer-facing Markdown report to markdownPath.',
    'Markdown must read like a tender working memo: hard constraints, bid implications, risks/gaps, clarifications needed.',
    'Do NOT center the report on filenames, documentId, absolute paths, Agent Pi Outputs, or “analysis scope” boilerplate.',
    'Put source filename at most once in a one-line header; body uses industry jargon and clause/page cites only where useful.',
    'Empty sourceRefs are accepted; documentId/batchId are inferred from the brief when omitted. No cross-document invention.',
    'Read [skill:tender-formal-writing] then honor writingContract: tender-grounded professional bid writing with AI filler stripped.',
  ].join(' ');
}
