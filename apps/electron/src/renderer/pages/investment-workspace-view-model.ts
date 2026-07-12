import type { InvestmentWorkspaceBundleDto } from '@craft-agent/shared/protocol';

export type InvestmentWorkspaceTabId = 'sources' | 'screening' | 'technical' | 'market' | 'legalEsg' | 'valuation' | 'decision';

export interface InvestmentWorkspaceRow { id: string; title: string; subtitle?: string; status?: string }
export interface InvestmentWorkspaceTab {
  id: InvestmentWorkspaceTabId; label: string; count: number; readiness: string; stale: boolean; issueCount: number; rows: InvestmentWorkspaceRow[];
}
export interface InvestmentWorkspaceViewModel {
  projectId: string; title: string; stage: string; status: string; valuationDate?: string; currency?: string;
  revision: number; readiness: string; issueCount: number; tabs: InvestmentWorkspaceTab[]; paths: InvestmentWorkspaceBundleDto['paths'];
}

const TAB_DEFINITIONS: Array<{ id: InvestmentWorkspaceTabId; label: string; capability?: string }> = [
  { id: 'sources', label: 'Sources' },
  { id: 'screening', label: 'Mandate Screening', capability: 'mandate_screening' },
  { id: 'technical', label: 'Resource and Technical', capability: 'resource_technical' },
  { id: 'market', label: 'Market and Offtake', capability: 'market_offtake' },
  { id: 'legalEsg', label: 'Legal and ESG', capability: 'legal_esg' },
  { id: 'valuation', label: 'Financial Valuation', capability: 'financial_valuation' },
  { id: 'decision', label: 'Transaction Decision', capability: 'transaction_decision' },
];

export function buildInvestmentWorkspaceViewModel(bundle: InvestmentWorkspaceBundleDto): InvestmentWorkspaceViewModel {
  const workspace = record(bundle.workspace);
  const project = record(workspace.project);
  const audit = record(bundle.audit);
  const entries = array(record(bundle.capabilityIndex).capabilities).map(record);
  const entryByCapability = new Map(entries.map((entry) => [text(entry.capability), entry]));
  const tabs = TAB_DEFINITIONS.map((definition): InvestmentWorkspaceTab => {
    const entry = definition.capability ? entryByCapability.get(definition.capability) : undefined;
    const rows = definition.id === 'sources'
      ? [
          ...mapRows(workspace.sources, (item) => text(item.name), (item) => text(item.kind), 'id'),
          ...mapRows(workspace.snapshots, (item) => text(item.id), (item) => `Knowledge snapshot · ${text(item.producerPlugin)}`, 'id'),
        ]
      : capabilityRows(bundle.packs, definition.capability ?? '');
    return {
      id: definition.id, label: definition.label, count: rows.length,
      readiness: entry ? text(entry.readiness, 'not_ready') : text(audit.readiness, 'not_ready'),
      stale: entry?.stale === true, issueCount: number(entry?.issueCount), rows,
    };
  });
  return {
    projectId: text(project.id), title: text(project.title, 'Investment Workspace'), stage: text(project.stage), status: text(project.status),
    valuationDate: text(project.valuationDate) || undefined, currency: text(project.baseCurrency) || undefined,
    revision: number(workspace.revision), readiness: text(audit.readiness, 'not_ready'), issueCount: array(audit.issues).length,
    tabs, paths: bundle.paths,
  };
}

function capabilityRows(packs: InvestmentWorkspaceBundleDto['packs'], capability: string): InvestmentWorkspaceRow[] {
  const data = record(record(packs[capability]).data);
  return [
    ...mapRows(data.findings, (item) => text(item.title), (item) => text(item.category), 'id'),
    ...mapRows(data.metrics, (item) => text(item.name), (item) => `${text(item.value)} ${text(item.unit)}`.trim(), 'id'),
    ...mapRows(data.risks, (item) => text(item.title), (item) => `Risk · ${text(item.severity)}`, 'id'),
    ...mapRows(data.approvals, (item) => text(item.title), (item) => text(item.authority), 'id'),
  ];
}

function mapRows(value: unknown, title: (item: Record<string, unknown>) => string, subtitle: (item: Record<string, unknown>) => string, idKey: string): InvestmentWorkspaceRow[] {
  return array(value).map((entry, index) => {
    const item = record(entry);
    return { id: text(item[idKey], `${idKey}-${index}`), title: title(item), subtitle: subtitle(item), status: text(item.status ?? item.decision ?? item.confidence) };
  });
}
function record(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function array(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function text(value: unknown, fallback = ''): string { return typeof value === 'string' && value.trim() ? value : fallback; }
function number(value: unknown): number { return typeof value === 'number' && Number.isFinite(value) ? value : 0; }
