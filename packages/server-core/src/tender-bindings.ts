import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { getBundledAssetsDir } from '@craft-agent/shared/utils';

export interface TenderBindingRef {
  path: string;
  role: string;
  title?: string;
}

export interface TenderKnowledgeBindings {
  schemaVersion: 1;
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

const BUNDLE_REL = 'knowledge/tender-sa-sanral';

export function defaultTenderKnowledgeBindings(): TenderKnowledgeBindings {
  return {
    schemaVersion: 1,
    pricing: {
      methodStandard: {
        title: 'C5.1 路床单价推导（五步法对标）',
        path: `${BUNDLE_REL}/C5.1_路床_单价推导.md`,
        role: 'method_and_depth_standard',
      },
    },
    planning: {
      methodologyDepthTemplate: {
        path: `${BUNDLE_REL}/N2-18施工策划报告_R05修订版.md`,
        role: 'depth_and_toc_standard',
      },
      workPlanDocxTemplate: {
        path: `${BUNDLE_REL}/N2-18-Work_Plan_and_Proposed_Methodology.docx`,
        role: 'formal_submission_template',
      },
      cashflowHtmlTemplate: {
        path: `${BUNDLE_REL}/S-Curve_Cash_Flow_Chart.html`,
        role: 'cashflow_chart_template',
      },
      plantHistogramStyleRef: {
        path: `${BUNDLE_REL}/Attachment2_Plant_Histogram_R00.pdf`,
        role: 'style_reference',
      },
      labourHistogramStyleRef: {
        path: `${BUNDLE_REL}/Attachment3_Labour_Histogram_R00.pdf`,
        role: 'style_reference',
      },
    },
  };
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
  const defaults = defaultTenderKnowledgeBindings();
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
  const bundledRoot = options.bundledKnowledgeRoot
    ?? getBundledAssetsDir(BUNDLE_REL)
    ?? getBundledAssetsDir('knowledge')
    ?? join(process.cwd(), 'resources', BUNDLE_REL);
  const nested = join(bundledRoot, fileName);
  if (existsSync(nested)) {
    return { absolutePath: nested, source: 'bundle' };
  }
  // When getBundledAssetsDir('knowledge') returned the parent, also try tender-sa-sanral child.
  const nestedPack = join(bundledRoot, 'tender-sa-sanral', fileName);
  if (existsSync(nestedPack)) {
    return { absolutePath: nestedPack, source: 'bundle' };
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
