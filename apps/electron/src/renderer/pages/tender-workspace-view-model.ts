import type { TenderWorkspaceBundleDto } from '@craft-agent/shared/protocol';

export type TenderWorkspaceTabId =
  | 'sources'
  | 'compliance'
  | 'analysis'
  | 'evaluation'
  | 'boq'
  | 'pricing'
  | 'execution'
  | 'schedule'
  | 'cost'
  | 'submissionDocuments'
  | 'submission';

export interface TenderWorkspaceRow {
  id: string;
  title: string;
  subtitle?: string;
  status?: string;
}

export interface TenderWorkspaceTab {
  id: TenderWorkspaceTabId;
  label: string;
  count: number;
  readiness: string;
  stale: boolean;
  issueCount: number;
  rows: TenderWorkspaceRow[];
}

export interface TenderWorkspaceViewModel {
  projectId: string;
  title: string;
  status: string;
  revision: number;
  readiness: string;
  issueCount: number;
  tabs: TenderWorkspaceTab[];
  paths: TenderWorkspaceBundleDto['paths'];
}

const TAB_DEFINITIONS: Array<{
  id: TenderWorkspaceTabId;
  label: string;
  capability?: string;
}> = [
  { id: 'sources', label: 'Sources and Addenda' },
  { id: 'compliance', label: 'Compliance and Deliverables' },
  { id: 'analysis', label: 'Tender Document Analysis', capability: 'document_analysis' },
  { id: 'evaluation', label: 'Evaluation', capability: 'evaluation_strategy' },
  { id: 'boq', label: 'BOQ Reconciliation', capability: 'boq_reconciliation' },
  { id: 'pricing', label: 'BOQ Five-Step Pricing', capability: 'boq_five_step_pricing' },
  { id: 'execution', label: 'Execution Plan', capability: 'execution_plan' },
  { id: 'schedule', label: 'Programme and Resources', capability: 'schedule_resources' },
  { id: 'cost', label: 'Cost and Cash Flow', capability: 'cost_cashflow' },
  { id: 'submissionDocuments', label: 'Submission Documents', capability: 'submission_documents' },
  { id: 'submission', label: 'Submission Audit', capability: 'submission_audit' },
];

export function buildTenderWorkspaceViewModel(bundle: TenderWorkspaceBundleDto): TenderWorkspaceViewModel {
  const workspace = record(bundle.workspace);
  const project = record(workspace.project);
  const audit = record(bundle.audit);
  const entries = array(record(bundle.capabilityIndex).capabilities).map(record);
  const entryByCapability = new Map(entries.map((entry) => [text(entry.capability), entry]));

  const tabs = TAB_DEFINITIONS.map((definition): TenderWorkspaceTab => {
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
    title: text(project.title, 'Tender Workspace'),
    status: text(project.status),
    revision: number(workspace.revision),
    readiness: text(audit.readiness, 'not_ready'),
    issueCount: array(audit.issues).length,
    tabs,
    paths: bundle.paths,
  };
}

function rowsForTab(
  tab: TenderWorkspaceTabId,
  workspace: Record<string, unknown>,
  packs: TenderWorkspaceBundleDto['packs'],
): TenderWorkspaceRow[] {
  if (tab === 'sources') {
    return array(workspace.documents).map((value) => {
      const item = record(value);
      return row(item, text(item.name), text(item.kind));
    });
  }
  if (tab === 'compliance') {
    const requirements = array(workspace.requirements).map((value) => {
      const item = record(value);
      return row(item, text(item.title), `Requirement · ${text(item.criticality)}`);
    });
    const deliverables = array(workspace.deliverables).map((value) => {
      const item = record(value);
      return row(item, text(item.title), `Deliverable · ${text(item.format, 'format pending')}`);
    });
    return [...requirements, ...deliverables];
  }
  const capability = TAB_DEFINITIONS.find((definition) => definition.id === tab)?.capability;
  const data = record(record(capability ? packs[capability] : undefined).data);
  if (tab === 'analysis') return mapRows(data.sections, (item) => text(item.title, text(item.kind)), 'id');
  if (tab === 'evaluation') return mapRows(data.strategies, (item) => text(item.responseTheme, text(item.criterionId)), 'criterionId');
  if (tab === 'boq') return mapRows(data.items, (item) => `${text(item.code)} ${text(item.description)}`.trim(), 'id');
  if (tab === 'pricing') return mapRows(data.itemBuildUps, (item) => `BOQ ${text(item.boqItemId)} · ${text(item.directCost)}`, 'boqItemId');
  if (tab === 'execution') return mapRows(data.workPackages, (item) => text(item.title), 'id');
  if (tab === 'schedule') return mapRows(data.activities, (item) => text(item.name), 'id');
  if (tab === 'cost') return mapRows(data.buildUps, (item) => `BOQ ${text(item.boqItemId)} · ${text(item.total)}`, 'boqItemId');
  if (tab === 'submissionDocuments') return mapRows(data.items, (item) => text(item.title, text(item.kind)), 'id');
  if (tab === 'submission') return mapRows(data.items, (item) => text(item.filePath, text(item.deliverableId)), 'deliverableId');
  return [];
}

function mapRows(value: unknown, title: (item: Record<string, unknown>) => string, idKey: string): TenderWorkspaceRow[] {
  return array(value).map((entry, index) => {
    const item = record(entry);
    return row(item, title(item), undefined, text(item[idKey], `${idKey}-${index}`));
  });
}

function row(item: Record<string, unknown>, title: string, subtitle?: string, fallbackId?: string): TenderWorkspaceRow {
  return {
    id: text(item.id, fallbackId ?? title),
    title,
    subtitle,
    status: text(item.status ?? item.validationStatus ?? item.quantityStatus),
  };
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

function number(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
