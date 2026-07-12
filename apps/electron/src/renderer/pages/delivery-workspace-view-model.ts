import type { DeliveryWorkspaceBundleDto } from '@craft-agent/shared/protocol';

export type DeliveryWorkspaceTabId =
  | 'sources'
  | 'baselines'
  | 'programme'
  | 'resources'
  | 'cost'
  | 'cashflow'
  | 'riskChange'
  | 'reporting';

export interface DeliveryWorkspaceRow {
  id: string;
  title: string;
  subtitle?: string;
  status?: string;
}

export interface DeliveryWorkspaceTab {
  id: DeliveryWorkspaceTabId;
  label: string;
  count: number;
  readiness: string;
  stale: boolean;
  issueCount: number;
  rows: DeliveryWorkspaceRow[];
}

export interface DeliveryWorkspaceViewModel {
  projectId: string;
  title: string;
  status: string;
  dataDate?: string;
  revision: number;
  readiness: string;
  issueCount: number;
  tabs: DeliveryWorkspaceTab[];
  paths: DeliveryWorkspaceBundleDto['paths'];
}

const TAB_DEFINITIONS: Array<{ id: DeliveryWorkspaceTabId; label: string; capability?: string }> = [
  { id: 'sources', label: 'Sources' },
  { id: 'baselines', label: 'Contract and Baselines', capability: 'contract_scope' },
  { id: 'programme', label: 'Programme and Progress', capability: 'programme_progress' },
  { id: 'resources', label: 'Resources and Procurement', capability: 'resource_procurement' },
  { id: 'cost', label: 'Cost and Commercial', capability: 'cost_commercial' },
  { id: 'cashflow', label: 'Cash Flow', capability: 'cashflow' },
  { id: 'riskChange', label: 'Risk and Change', capability: 'risk_change' },
  { id: 'reporting', label: 'Reporting and Audit', capability: 'reporting_audit' },
];

export function buildDeliveryWorkspaceViewModel(bundle: DeliveryWorkspaceBundleDto): DeliveryWorkspaceViewModel {
  const workspace = record(bundle.workspace);
  const project = record(workspace.project);
  const audit = record(bundle.audit);
  const entries = array(record(bundle.capabilityIndex).capabilities).map(record);
  const entryByCapability = new Map(entries.map((entry) => [text(entry.capability), entry]));
  const tabs = TAB_DEFINITIONS.map((definition): DeliveryWorkspaceTab => {
    const entry = definition.capability ? entryByCapability.get(definition.capability) : undefined;
    const rows = rowsForTab(definition.id, workspace, bundle.packs);
    return {
      id: definition.id,
      label: definition.label,
      count: rows.length,
      readiness: entry ? text(entry.readiness, 'not_ready') : text(audit.readiness, 'not_ready'),
      stale: entry?.stale === true,
      issueCount: number(entry?.issueCount),
      rows,
    };
  });
  return {
    projectId: text(project.id),
    title: text(project.title, 'Delivery Workspace'),
    status: text(project.status),
    dataDate: text(project.dataDate) || undefined,
    revision: number(workspace.revision),
    readiness: text(audit.readiness, 'not_ready'),
    issueCount: array(audit.issues).length,
    tabs,
    paths: bundle.paths,
  };
}

function rowsForTab(tab: DeliveryWorkspaceTabId, workspace: Record<string, unknown>, packs: DeliveryWorkspaceBundleDto['packs']): DeliveryWorkspaceRow[] {
  if (tab === 'sources') return mapRows(workspace.sources, (item) => text(item.name), (item) => text(item.kind), 'id');
  if (tab === 'baselines') {
    const baselines = mapRows(workspace.baselines, (item) => text(item.title), (item) => `Baseline · ${text(item.kind)}`, 'id');
    const data = packData(packs, 'contract_scope');
    const obligations = mapRows(data.obligations, (item) => text(item.title), () => 'Contract obligation', 'id');
    const scopeItems = mapRows(data.scopeItems, (item) => `${text(item.wbsCode)} ${text(item.title)}`.trim(), () => 'Scope item', 'id');
    return [...baselines, ...obligations, ...scopeItems];
  }
  if (tab === 'programme') {
    const data = packData(packs, 'programme_progress');
    return [
      ...mapRows(data.activities, (item) => text(item.name), (item) => `${text(item.baselineStart)} → ${text(item.forecastFinish)}`, 'id'),
      ...mapRows(data.milestones, (item) => text(item.title), () => 'Milestone', 'id'),
    ];
  }
  if (tab === 'resources') {
    const data = packData(packs, 'resource_procurement');
    return [
      ...mapRows(data.resources, (item) => text(item.name), (item) => text(item.category), 'id'),
      ...mapRows(data.allocations, (item) => text(item.id), (item) => `Activity · ${text(item.activityId)}`, 'id'),
      ...mapRows(data.procurementPackages, (item) => text(item.title), (item) => `Required ${text(item.requiredOnSiteDate)}`, 'id'),
    ];
  }
  if (tab === 'cost') {
    const data = packData(packs, 'cost_commercial');
    return [
      ...mapRows(data.budgetLines, (item) => text(item.title), (item) => `Budget · ${text(item.currentBudget)}`, 'id'),
      ...mapRows(data.commitments, (item) => text(item.supplier), (item) => `Commitment · ${text(item.committedAmount)}`, 'id'),
      ...mapRows(data.forecasts, (item) => text(item.costCodeId), (item) => `EAC · ${text(item.estimateAtCompletion)}`, 'costCodeId'),
    ];
  }
  if (tab === 'cashflow') {
    const data = packData(packs, 'cashflow');
    return [
      ...mapRows(data.periods, (item) => text(item.period), (item) => `Forecast outflow · ${text(record(item.forecast).outflow)}`, 'period'),
      ...mapRows(data.fundingConstraints, (item) => text(item.title), (item) => `Due ${text(item.dueDate)}`, 'id'),
    ];
  }
  if (tab === 'riskChange') {
    const data = packData(packs, 'risk_change');
    return [
      ...mapRows(data.risks, (item) => text(item.title), (item) => `Risk · ${number(item.rating)}`, 'id'),
      ...mapRows(data.issues, (item) => text(item.title), () => 'Issue', 'id'),
      ...mapRows(data.notices, (item) => text(item.title), () => 'Notice', 'id'),
      ...mapRows(data.changes, (item) => text(item.title), () => 'Change', 'id'),
      ...mapRows(data.claims, (item) => text(item.title), () => 'Claim', 'id'),
      ...mapRows(data.decisions, (item) => text(item.title), () => 'Decision', 'id'),
    ];
  }
  const data = packData(packs, 'reporting_audit');
  return [
    ...mapRows(data.capabilityAttestations, (item) => text(item.capability), () => 'Attestation', 'capability'),
    ...mapRows(data.varianceExplanations, (item) => text(item.metric), (item) => text(item.variance), 'id'),
    ...mapRows(data.managementReports, (item) => text(item.title), (item) => text(item.format), 'id'),
  ];
}

function packData(packs: DeliveryWorkspaceBundleDto['packs'], capability: string): Record<string, unknown> {
  return record(record(packs[capability]).data);
}

function mapRows(
  value: unknown,
  title: (item: Record<string, unknown>) => string,
  subtitle: (item: Record<string, unknown>) => string,
  idKey: string,
): DeliveryWorkspaceRow[] {
  return array(value).map((entry, index) => {
    const item = record(entry);
    return {
      id: text(item[idKey], `${idKey}-${index}`),
      title: title(item),
      subtitle: subtitle(item),
      status: text(item.status ?? item.confidence),
    };
  });
}

function record(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function array(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function text(value: unknown, fallback = ''): string { return typeof value === 'string' && value.trim() ? value : fallback; }
function number(value: unknown): number { return typeof value === 'number' && Number.isFinite(value) ? value : 0; }
