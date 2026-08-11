export interface MigratableStageSnapshot {
  stageId?: string;
  status?: string;
  updatedAt?: string;
  completedAt?: string;
  [key: string]: unknown;
}

export interface MigratableStageState {
  schemaVersion: 1;
  projectId: string;
  updatedAt: string;
  stages: Record<string, MigratableStageSnapshot>;
  /** Set when legacy keys were folded so UI can offer reset CTA. */
  migratedFromLegacy?: boolean;
}

const LEGACY_TO_CANONICAL: Record<string, string> = {
  planning: 'planning-and-submission',
  submission: 'planning-and-submission',
  'work-plan-methodology': 'planning-and-submission',
  'schedule-resource-planning': 'planning-and-submission',
  'cost-cashflow-planning': 'planning-and-submission',
  'tender-submission-documents': 'planning-and-submission',
  'submission-audit': 'planning-and-submission',
  'bidder-commitments': 'boq-five-step-pricing',
};

const STATUS_RANK: Record<string, number> = {
  blocked: 1,
  ready: 2,
  running: 3,
  complete: 4,
};

function pickStatus(statuses: string[]): string {
  if (statuses.length === 0) return 'ready';
  // Canonical planning stage is complete only when every legacy contributor that
  // maps into it was complete; otherwise take the most advanced incomplete state.
  if (statuses.every((status) => status === 'complete')) return 'complete';
  let best = 'blocked';
  let bestRank = 0;
  for (const status of statuses) {
    if (status === 'complete') continue;
    const rank = STATUS_RANK[status] ?? 0;
    if (rank >= bestRank) {
      best = status;
      bestRank = rank;
    }
  }
  return best;
}

function newerIso(left?: string, right?: string): string | undefined {
  if (!left) return right;
  if (!right) return left;
  return left > right ? left : right;
}

/**
 * Fold legacy V2.4 stage keys into V2.5 canonical ids.
 * Keeps original legacy entries for audit; adds/updates canonical snapshots.
 */
export function migrateTenderStageState(state: MigratableStageState): MigratableStageState {
  const stages = { ...state.stages };
  let migratedFromLegacy = Boolean(state.migratedFromLegacy);
  const buckets = new Map<string, MigratableStageSnapshot[]>();

  for (const [key, snapshot] of Object.entries(state.stages)) {
    const canonical = LEGACY_TO_CANONICAL[key];
    if (!canonical) continue;
    migratedFromLegacy = true;
    const list = buckets.get(canonical) ?? [];
    list.push({ ...snapshot, stageId: key });
    buckets.set(canonical, list);
  }

  for (const [canonical, contributors] of buckets) {
    const existing = stages[canonical];
    const statuses = [
      ...contributors.map((entry) => entry.status).filter((status): status is string => Boolean(status)),
      ...(existing?.status ? [existing.status] : []),
    ];
    const updatedAt = contributors.reduce<string | undefined>(
      (latest, entry) => newerIso(latest, entry.updatedAt),
      existing?.updatedAt,
    ) ?? state.updatedAt;
    const completedAt = statuses.every((status) => status === 'complete')
      ? contributors.reduce<string | undefined>(
        (latest, entry) => newerIso(latest, entry.completedAt),
        existing?.completedAt,
      )
      : undefined;
    stages[canonical] = {
      ...(existing ?? {}),
      schemaVersion: 1,
      projectId: state.projectId,
      stageId: canonical,
      status: pickStatus(statuses),
      updatedAt,
      ...(completedAt ? { completedAt } : {}),
      requiredCapabilities: existing?.requiredCapabilities
        ?? contributors.find((entry) => Array.isArray(entry.requiredCapabilities))?.requiredCapabilities
        ?? [],
      producedCapabilities: existing?.producedCapabilities
        ?? contributors.find((entry) => Array.isArray(entry.producedCapabilities))?.producedCapabilities
        ?? [],
      generatedPacks: existing?.generatedPacks
        ?? contributors.find((entry) => Array.isArray(entry.generatedPacks))?.generatedPacks
        ?? [],
      missingItems: existing?.missingItems
        ?? contributors.find((entry) => Array.isArray(entry.missingItems))?.missingItems
        ?? [],
    };
  }

  return {
    ...state,
    stages,
    ...(migratedFromLegacy ? { migratedFromLegacy: true } : {}),
  };
}

export function hasLegacyTenderStageKeys(state: MigratableStageState): boolean {
  return Object.keys(state.stages).some((key) => key in LEGACY_TO_CANONICAL);
}
