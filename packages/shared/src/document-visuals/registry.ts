import type { DocumentDomain, VisualKind, VisualRegistryInput, VisualSuggestion } from './types.ts';

const DATE_PATTERN = /\b(?:20\d{2}|19\d{2})[-/.年](?:0?[1-9]|1[0-2])(?:[-/.月](?:0?[1-9]|[12]\d|3[01])日?)?\b/i;
const NUMBER_PATTERN = /[-+]?\d+(?:,\d{3})*(?:\.\d+)?%?/;
const COORDINATE_PATTERN = /\b(?:lat(?:itude)?|lon(?:gitude)?|坐标|coordinate|easting|northing)\b|[-+]?\d{1,3}\.\d{3,}\s*,\s*[-+]?\d{1,3}\.\d{3,}/i;
const IMAGE_REF_PATTERN = /!\[[^\]]*]\([^)]+\)|\b(?:image|figure|screenshot|contour|plot)\b/i;

const DOMAIN_PATTERNS: Array<[DocumentDomain, RegExp]> = [
  ['construction', /construction|施工|tender|wbs|boq|baseline|milestone|critical path|progress date|primavera|p6|project schedule|进度计划/i],
  ['investment', /investment|现金流|cash\s*flow|npv|irr|capex|opex|revenue|sensitivity|融资|投资/i],
  ['geospatial', /gis|geospatial|coordinate|latitude|longitude|route|chainage|km\s*\d|site location|地图|坐标|路线|桩号/i],
  ['simulation', /ansys|cae|fea|finite element|simulation|residual|stress|strain|displacement|仿真|有限元|应力|位移/i],
  ['legal', /contract|clause|obligation|compliance|liability|notice period|dispute|合同|条款|义务|合规/i],
  ['software', /software|architecture|api|service|database|event queue|sequence|microservice|系统架构|接口|数据库/i],
  ['business', /business|workflow|approval|organization|responsibility|process|流程|审批|组织|职责/i],
  ['research', /research|paper|source|method|sample size|publication|finding|evidence|文献|论文|研究|证据/i],
];

export function detectDocumentDomain(input: string): DocumentDomain {
  for (const [domain, pattern] of DOMAIN_PATTERNS) {
    if (pattern.test(input)) return domain;
  }
  return 'general';
}

export function suggestVisuals(input: VisualRegistryInput): VisualSuggestion[] {
  const text = input.text.trim();
  if (!text) return [];

  const domain = detectDocumentDomain(text);
  const suggestions: VisualSuggestion[] = [];

  if (domain === 'construction') {
    addConstructionSuggestions(suggestions, input, domain);
  } else if (domain === 'investment') {
    addInvestmentSuggestions(suggestions, input, domain);
  } else if (domain === 'geospatial') {
    addGeospatialSuggestions(suggestions, input, domain);
  } else if (domain === 'simulation') {
    addSimulationSuggestions(suggestions, input, domain);
  } else if (domain === 'business') {
    addSuggestion(suggestions, 'process-flow', domain, 0.72, 'Detected business workflow or approval sequence.', ['workflow or step sequence'], []);
    if (/\b(?:organization|org chart|role|responsibility|职责|组织)\b/i.test(text)) {
      addSuggestion(suggestions, 'organization-chart', domain, 0.68, 'Detected roles or responsibilities that can be shown as an organization chart.', ['roles or responsibility list'], []);
    }
  } else if (domain === 'legal') {
    addSuggestion(suggestions, 'obligations-matrix', domain, 0.73, 'Detected legal obligations or clause comparison evidence.', ['clauses or obligations'], []);
    if (/\b(?:risk|liability|dispute|compliance|风险|责任|合规)\b/i.test(text)) {
      addSuggestion(suggestions, 'risk-matrix', domain, 0.66, 'Detected legal risk or compliance allocation evidence.', ['risk or compliance items'], []);
    }
  } else if (domain === 'software') {
    addSuggestion(suggestions, 'system-architecture-diagram', domain, 0.76, 'Detected software components suitable for architecture mapping.', ['systems, services, or components'], []);
    if (/\b(?:sequence|request|event|queue|flow|调用|消息)\b/i.test(text)) {
      addSuggestion(suggestions, 'sequence-flow', domain, 0.67, 'Detected request or event flow suitable for sequence visualization.', ['actors and interaction order'], []);
    }
  } else if (domain === 'research') {
    addSuggestion(suggestions, 'evidence-comparison-table', domain, 0.71, 'Detected research evidence, methods, sources, or findings for comparison.', ['sources or studies'], []);
  } else {
    addGenericSuggestions(suggestions, input);
  }

  return uniqueSuggestions(suggestions).sort((a, b) => b.score - a.score);
}

function addConstructionSuggestions(suggestions: VisualSuggestion[], input: VisualRegistryInput, domain: DocumentDomain): void {
  const text = getEvidenceText(input);
  const hasScheduleEvidence = /wbs|task|activity|施工|baseline|current|start|finish|milestone|progress date|critical path|进度|里程碑/i.test(text)
    && (DATE_PATTERN.test(text) || hasTable(input) || /duration|工期|days|weeks|months/i.test(text));

  if (/boq|cost|rate|quantity|amount|bill of quantities|工程量|成本|单价|合价/i.test(text) && hasNumericEvidence(input)) {
    addSuggestion(suggestions, 'professional-table', domain, 0.7, 'Detected construction BOQ or cost evidence suitable for a professional table.', ['cost or quantity table'], []);
  }

  if (!hasScheduleEvidence) return;

  addSuggestion(suggestions, 'construction-gantt', domain, 0.92, 'Detected construction schedule evidence with WBS, dates, baseline/current plan, milestones, or critical path.', ['task or WBS', 'start/finish or duration'], []);
  addSuggestion(suggestions, 'schedule-s-curve', domain, 0.77, 'Detected schedule/progress evidence suitable for an S-curve when progress or baseline data is available.', ['schedule dates', 'progress or baseline values'], []);

  if (/resource|crew|labor|plant|equipment|资源|人工|机械/i.test(text)) {
    addSuggestion(suggestions, 'resource-histogram', domain, 0.62, 'Detected construction resource terms suitable for a histogram.', ['resource quantities by period'], hasNumericEvidence(input) ? [] : ['resource quantities by period']);
  }
}

function addInvestmentSuggestions(suggestions: VisualSuggestion[], input: VisualRegistryInput, domain: DocumentDomain): void {
  const text = getEvidenceText(input);
  const hasNumbers = hasNumericEvidence(input);
  if (!hasNumbers) return;

  addSuggestion(suggestions, 'investment-cash-flow-table', domain, 0.88, 'Detected investment cash-flow evidence with numeric financial inputs.', ['period', 'cash-flow values'], []);

  if (/\b(?:npv|irr|净现值|内部收益率)\b/i.test(text)) {
    addSuggestion(suggestions, 'npv-irr-summary', domain, 0.82, 'Detected NPV/IRR terms with numeric financial inputs.', ['NPV or IRR inputs/results'], []);
  }

  if (/\b(?:sensitivity|scenario|敏感性|情景)\b/i.test(text)) {
    addSuggestion(suggestions, 'sensitivity-matrix', domain, 0.78, 'Detected sensitivity or scenario evidence with numeric inputs.', ['scenario variables', 'numeric outcomes'], []);
  }

  if (/\b(?:cumulative|累计|cash\s*flow|现金流)\b/i.test(text)) {
    addSuggestion(suggestions, 'cumulative-cash-flow-curve', domain, 0.74, 'Detected period cash-flow data suitable for a cumulative curve.', ['period', 'cash-flow values'], []);
  }
}

function addGeospatialSuggestions(suggestions: VisualSuggestion[], input: VisualRegistryInput, domain: DocumentDomain): void {
  const text = getEvidenceText(input);
  const hasSpatialData = COORDINATE_PATTERN.test(text) || hasCoordinateTable(input);
  if (!hasSpatialData) return;

  if (/\b(?:route|chainage|alignment|km\s*\d|路线|桩号)\b/i.test(text)) {
    addSuggestion(suggestions, 'route-map', domain, 0.84, 'Detected geospatial coordinate route evidence.', ['route geometry or chainage', 'coordinates'], []);
  }

  addSuggestion(suggestions, 'site-location-map', domain, 0.78, 'Detected geospatial coordinate site evidence.', ['site coordinates'], []);
}

function addSimulationSuggestions(suggestions: VisualSuggestion[], input: VisualRegistryInput, domain: DocumentDomain): void {
  const text = getEvidenceText(input);
  const hasResultEvidence = hasNumericEvidence(input) || (IMAGE_REF_PATTERN.test(text) && !hasNegatedResultEvidence(text));
  if (!hasResultEvidence) return;

  if (/\b(?:residual|convergence|收敛)\b/i.test(text)) {
    addSuggestion(suggestions, 'simulation-convergence-plot', domain, 0.84, 'Detected simulation convergence or residual result evidence.', ['residual or convergence series'], []);
  }

  addSuggestion(suggestions, 'simulation-result-table', domain, 0.76, 'Detected simulation result evidence suitable for a summarized engineering table.', ['result values or result image'], []);

  if (/\b(?:time history|time\s*\(|load step|step|时程|时间)\b/i.test(text)) {
    addSuggestion(suggestions, 'time-history-plot', domain, 0.69, 'Detected time or load-step result data.', ['time/load step series'], []);
  }
}

function addGenericSuggestions(suggestions: VisualSuggestion[], input: VisualRegistryInput): void {
  const text = input.text;
  if (/\b(?:table|summary table|清单|表格|汇总)\b/i.test(text)) {
    addSuggestion(suggestions, 'professional-table', 'general', 0.54, 'Detected a generic summary-table request.', ['explicit table or list content'], []);
  }

  if (/\b(?:steps|workflow|process|procedure|流程|步骤|程序)\b/i.test(text)) {
    addSuggestion(suggestions, 'process-flow', 'general', 0.51, 'Detected a generic process or step sequence.', ['steps or procedure sequence'], []);
  }
}

function addSuggestion(
  suggestions: VisualSuggestion[],
  kind: VisualKind,
  domain: DocumentDomain,
  score: number,
  reason: string,
  requiredData: string[],
  missingData: string[],
): void {
  suggestions.push({ kind, domain, score, reason, requiredData, missingData });
}

function hasTable(input: VisualRegistryInput): boolean {
  return Array.isArray(input.tables) && input.tables.length > 0 && input.tables.some(row => row.length > 0);
}

function getEvidenceText(input: VisualRegistryInput): string {
  return [
    input.text,
    ...(input.tables ?? []).map(row => row.join(' ')),
  ].join('\n');
}

function hasNumericEvidence(input: VisualRegistryInput): boolean {
  const text = getEvidenceText(input);
  if (NUMBER_PATTERN.test(text) && /cash|capex|opex|revenue|npv|irr|stress|strain|displacement|residual|progress|percent|%|金额|收入|成本|应力|位移/i.test(text)) {
    return true;
  }

  return (input.tables ?? []).some(row => row.some(cell => NUMBER_PATTERN.test(cell)));
}

function hasCoordinateTable(input: VisualRegistryInput): boolean {
  return (input.tables ?? []).some(row => row.some(cell => COORDINATE_PATTERN.test(cell)));
}

function hasNegatedResultEvidence(text: string): boolean {
  return /\b(?:no|without|missing|absent|缺少|没有|无)\b.{0,80}\b(?:result|data|table|image|figure|plot|结果|数据|表格|图片|图表)\b/i.test(text);
}

function uniqueSuggestions(suggestions: VisualSuggestion[]): VisualSuggestion[] {
  const seen = new Set<VisualKind>();
  const unique: VisualSuggestion[] = [];

  for (const suggestion of suggestions) {
    if (seen.has(suggestion.kind)) continue;
    seen.add(suggestion.kind);
    unique.push(suggestion);
  }

  return unique;
}
