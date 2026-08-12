import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { getBundledAssetsDir } from '@craft-agent/shared/utils';

export type TenderJurisdictionProfileId = 'generic-international' | 'sa-sanral-highway' | string;

export interface TenderBindingRef {
  path: string;
  role: string;
  title?: string;
}

export interface TenderKnowledgeBindings {
  schemaVersion: 1;
  /** Jurisdiction profile that produced these bindings (V2.6+). */
  profileId?: TenderJurisdictionProfileId;
  pricing: {
    methodStandard: TenderBindingRef;
  };
  planning: {
    methodologyDepthTemplate: TenderBindingRef;
    workPlanDocxTemplate: TenderBindingRef;
    cashflowHtmlTemplate: TenderBindingRef;
    plantHistogramStyleRef: TenderBindingRef;
    labourHistogramStyleRef: TenderBindingRef;
  };
}

export interface TenderJurisdictionProfile {
  id: TenderJurisdictionProfileId;
  label: string;
  labelZh?: string;
  pricingStandard: string;
  currencyHint?: string;
  knowledgePack: string;
  bindings: TenderKnowledgeBindings;
}

interface TenderProfilesRegistry {
  schemaVersion: 1;
  defaultProfileId: TenderJurisdictionProfileId;
  profiles: Record<string, TenderJurisdictionProfile>;
}

const SA_BUNDLE_REL = 'knowledge/tender-sa-sanral';
const GENERIC_BUNDLE_REL = 'knowledge/tender-generic';
export const DEFAULT_TENDER_PROFILE_ID: TenderJurisdictionProfileId = 'generic-international';

function fallbackGenericBindings(): TenderKnowledgeBindings {
  return {
    schemaVersion: 1,
    profileId: 'generic-international',
    pricing: {
      methodStandard: {
        title: 'Generic five-step direct-cost method depth',
        path: `${GENERIC_BUNDLE_REL}/generic_direct_cost_five_step.md`,
        role: 'method_and_depth_standard',
      },
    },
    planning: {
      methodologyDepthTemplate: {
        path: `${GENERIC_BUNDLE_REL}/methodology_depth_guide.md`,
        role: 'depth_and_toc_standard',
      },
      workPlanDocxTemplate: {
        path: `${GENERIC_BUNDLE_REL}/work_plan_template_notes.md`,
        role: 'formal_submission_template',
      },
      cashflowHtmlTemplate: {
        path: `${GENERIC_BUNDLE_REL}/cashflow_chart_notes.md`,
        role: 'cashflow_chart_template',
      },
      plantHistogramStyleRef: {
        path: `${GENERIC_BUNDLE_REL}/histogram_style_notes.md`,
        role: 'style_reference',
      },
      labourHistogramStyleRef: {
        path: `${GENERIC_BUNDLE_REL}/histogram_style_notes.md`,
        role: 'style_reference',
      },
    },
  };
}

function fallbackSanralBindings(): TenderKnowledgeBindings {
  return {
    schemaVersion: 1,
    profileId: 'sa-sanral-highway',
    pricing: {
      methodStandard: {
        title: 'C5.1 路床单价推导（五步法对标）',
        path: `${SA_BUNDLE_REL}/C5.1_路床_单价推导.md`,
        role: 'method_and_depth_standard',
      },
    },
    planning: {
      methodologyDepthTemplate: {
        path: `${SA_BUNDLE_REL}/N2-18施工策划报告_R05修订版.md`,
        role: 'depth_and_toc_standard',
      },
      workPlanDocxTemplate: {
        path: `${SA_BUNDLE_REL}/N2-18-Work_Plan_and_Proposed_Methodology.docx`,
        role: 'formal_submission_template',
      },
      cashflowHtmlTemplate: {
        path: `${SA_BUNDLE_REL}/S-Curve_Cash_Flow_Chart.html`,
        role: 'cashflow_chart_template',
      },
      plantHistogramStyleRef: {
        path: `${SA_BUNDLE_REL}/Attachment2_Plant_Histogram_R00.pdf`,
        role: 'style_reference',
      },
      labourHistogramStyleRef: {
        path: `${SA_BUNDLE_REL}/Attachment3_Labour_Histogram_R00.pdf`,
        role: 'style_reference',
      },
    },
  };
}

function fallbackRegistry(): TenderProfilesRegistry {
  return {
    schemaVersion: 1,
    defaultProfileId: DEFAULT_TENDER_PROFILE_ID,
    profiles: {
      'generic-international': {
        id: 'generic-international',
        label: 'Generic international',
        labelZh: '通用国际',
        pricingStandard: 'generic_direct_cost_v1',
        currencyHint: 'USD',
        knowledgePack: GENERIC_BUNDLE_REL,
        bindings: fallbackGenericBindings(),
      },
      'sa-sanral-highway': {
        id: 'sa-sanral-highway',
        label: 'South Africa SANRAL highway',
        labelZh: '南非 SANRAL 公路',
        pricingStandard: 'c51_pure_direct_cost_v1',
        currencyHint: 'ZAR',
        knowledgePack: SA_BUNDLE_REL,
        bindings: fallbackSanralBindings(),
      },
    },
  };
}

function resolveProfilesJsonPath(): string | undefined {
  const knowledgeRoot = getBundledAssetsDir('knowledge');
  if (knowledgeRoot) {
    const candidate = join(knowledgeRoot, 'profiles.json');
    if (existsSync(candidate)) return candidate;
  }
  const nested = getBundledAssetsDir('knowledge/profiles.json');
  if (nested && existsSync(nested)) return nested;

  // Dev / test: walk from package cwd to apps/electron/resources/knowledge/profiles.json
  const candidates = [
    join(process.cwd(), 'apps', 'electron', 'resources', 'knowledge', 'profiles.json'),
    join(process.cwd(), '..', '..', 'apps', 'electron', 'resources', 'knowledge', 'profiles.json'),
    join(process.cwd(), '..', 'electron', 'resources', 'knowledge', 'profiles.json'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

export function loadTenderProfilesRegistry(): TenderProfilesRegistry {
  const path = resolveProfilesJsonPath();
  if (!path) return fallbackRegistry();
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as TenderProfilesRegistry;
    if (parsed.schemaVersion !== 1 || !parsed.profiles || typeof parsed.profiles !== 'object') {
      return fallbackRegistry();
    }
    return parsed;
  } catch {
    return fallbackRegistry();
  }
}

export function listTenderJurisdictionProfiles(): TenderJurisdictionProfile[] {
  const registry = loadTenderProfilesRegistry();
  return Object.values(registry.profiles);
}

export function getTenderJurisdictionProfile(
  profileId: TenderJurisdictionProfileId = DEFAULT_TENDER_PROFILE_ID,
): TenderJurisdictionProfile {
  const registry = loadTenderProfilesRegistry();
  const profile = registry.profiles[profileId] ?? registry.profiles[registry.defaultProfileId];
  if (profile) return profile;
  return fallbackRegistry().profiles['generic-international']!;
}

/** Resolve default knowledge bindings for a jurisdiction profile (D2: new projects → generic). */
export function resolveDefaultBindings(
  profileId: TenderJurisdictionProfileId = DEFAULT_TENDER_PROFILE_ID,
): TenderKnowledgeBindings {
  const profile = getTenderJurisdictionProfile(profileId);
  const bindings = structuredClone(profile.bindings);
  bindings.profileId = profile.id;
  return bindings;
}

/** @deprecated Prefer resolveDefaultBindings(profileId). Defaults to generic-international. */
export function defaultTenderKnowledgeBindings(): TenderKnowledgeBindings {
  return resolveDefaultBindings(DEFAULT_TENDER_PROFILE_ID);
}

/** Explicit SANRAL/C5.1 bindings (legacy profile). */
export function sanralTenderKnowledgeBindings(): TenderKnowledgeBindings {
  return resolveDefaultBindings('sa-sanral-highway');
}

function bindingsPath(projectDirectory: string): string {
  return join(projectDirectory, 'bindings.json');
}

function atomicWriteJson(filePath: string, value: unknown): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  renameSync(temporary, filePath);
}

export function writeTenderBindings(
  projectDirectory: string,
  bindings: TenderKnowledgeBindings,
): TenderKnowledgeBindings {
  atomicWriteJson(bindingsPath(projectDirectory), bindings);
  return bindings;
}

/** Rewrite project bindings from a jurisdiction profile (used when boundary profile changes). */
export function applyTenderProfileBindings(
  projectDirectory: string,
  profileId: TenderJurisdictionProfileId,
): TenderKnowledgeBindings {
  return writeTenderBindings(projectDirectory, resolveDefaultBindings(profileId));
}

export function ensureDefaultTenderBindings(projectDirectory: string): TenderKnowledgeBindings {
  const path = bindingsPath(projectDirectory);
  if (existsSync(path)) {
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf8')) as TenderKnowledgeBindings;
      if (parsed.schemaVersion === 1 && parsed.pricing?.methodStandard?.path) return parsed;
    } catch {
      // fall through and rewrite defaults
    }
  }
  const defaults = resolveDefaultBindings(DEFAULT_TENDER_PROFILE_ID);
  atomicWriteJson(path, defaults);
  return defaults;
}

export function readTenderBindings(projectDirectory: string): TenderKnowledgeBindings {
  return ensureDefaultTenderBindings(projectDirectory);
}

export function resolveTenderBindingPath(options: {
  projectDirectory: string;
  bindingPath: string;
  bundledKnowledgeRoot?: string;
}): { absolutePath: string; source: 'project' | 'bundle' } {
  const bindingPath = options.bindingPath.trim();
  if (!bindingPath) throw new Error('binding path is empty');

  if (isAbsolute(bindingPath) && existsSync(bindingPath)) {
    return { absolutePath: bindingPath, source: 'project' };
  }

  const projectCandidate = join(options.projectDirectory, bindingPath);
  if (existsSync(projectCandidate)) {
    return { absolutePath: projectCandidate, source: 'project' };
  }

  const fileName = bindingPath.includes('/') || bindingPath.includes('\\')
    ? bindingPath.split(/[\\/]/).pop()!
    : bindingPath;

  const packHint = bindingPath.includes('tender-generic')
    ? GENERIC_BUNDLE_REL
    : bindingPath.includes('tender-sa-sanral')
      ? SA_BUNDLE_REL
      : undefined;

  const searchRoots: string[] = [];
  if (options.bundledKnowledgeRoot) searchRoots.push(options.bundledKnowledgeRoot);
  if (packHint) {
    const packRoot = getBundledAssetsDir(packHint);
    if (packRoot) searchRoots.push(packRoot);
  }
  const knowledgeRoot = getBundledAssetsDir('knowledge');
  if (knowledgeRoot) searchRoots.push(knowledgeRoot);
  // Dev fallbacks
  searchRoots.push(
    join(process.cwd(), 'apps', 'electron', 'resources', 'knowledge'),
    join(process.cwd(), '..', '..', 'apps', 'electron', 'resources', 'knowledge'),
  );

  for (const root of searchRoots) {
    const direct = join(root, fileName);
    if (existsSync(direct)) return { absolutePath: direct, source: 'bundle' };
    const genericNested = join(root, 'tender-generic', fileName);
    if (existsSync(genericNested)) return { absolutePath: genericNested, source: 'bundle' };
    const saNested = join(root, 'tender-sa-sanral', fileName);
    if (existsSync(saNested)) return { absolutePath: saNested, source: 'bundle' };
    // Root may already be the pack folder
    if (packHint && existsSync(join(root, fileName))) {
      return { absolutePath: join(root, fileName), source: 'bundle' };
    }
  }

  throw new Error(`Tender binding not found: ${bindingPath}`);
}

export function resolveTenderMethodStandardPath(projectDirectory: string): {
  absolutePath: string;
  source: 'project' | 'bundle';
  title?: string;
} {
  const bindings = readTenderBindings(projectDirectory);
  const resolved = resolveTenderBindingPath({
    projectDirectory,
    bindingPath: bindings.pricing.methodStandard.path,
  });
  return { ...resolved, title: bindings.pricing.methodStandard.title };
}

export function pricingStandardForProfile(profileId: TenderJurisdictionProfileId): string {
  return getTenderJurisdictionProfile(profileId).pricingStandard;
}
