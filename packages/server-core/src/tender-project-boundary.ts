import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  organizationOutlineMeetsMinimum,
  parseTenderCapabilityEnvelope,
  parseTenderProjectBoundaryPack,
  type TenderCapabilityEnvelope,
  type TenderProjectBoundaryPack,
  type TenderProjectBoundarySource,
} from '@agent-pi/business-core/tender';
import { readTenderBindings, type TenderKnowledgeBindings, pricingStandardForProfile } from './tender-bindings.ts';
import { normalizeBoundarySource } from './tender-boundary-sources.ts';

const SA_METHOD_MARKERS = [
  'tender-sa-sanral',
  'C5.1',
  'c51_pure_direct_cost',
  'N2-18',
];

export function projectBoundaryPackPath(projectDirectory: string): string {
  return join(projectDirectory, 'packs', 'project-boundary.json');
}

export function projectBoundaryMarkdownPath(
  projectRoot: string,
  parentSessionId: string,
): string {
  return join(projectRoot, 'Agent Pi Outputs', parentSessionId, 'project-boundary', '项目边界条件.md');
}

export function formatProjectBoundaryMarkdown(pack: TenderProjectBoundaryPack): string {
  const lines = [
    '# 项目边界条件',
    '',
    `- 预设：${pack.profileId ?? '（未选）'}`,
    `- 币种：${pack.jurisdiction.currency}${pack.jurisdiction.countryCode ? ` · ${pack.jurisdiction.countryCode}` : ''}`,
    `- 计量标准：${pack.standards.measurementStandard.title || pack.standards.measurementStandard.id}`,
    `- 组价标准：${pack.pricing.pricingStandard}`,
    `- 税口径：${pack.pricing.taxRegime.vatTreatment}`,
    `- 费率地点：${pack.pricing.ratePolicy.location}`,
    `- 状态：${pack.readiness}${pack.humanConfirmedAt ? ` · 确认于 ${pack.humanConfirmedAt}` : ''}`,
    '',
    '## 适用规范',
    '',
  ];
  if (pack.standards.technicalSpecs.length === 0) {
    lines.push('_（尚未列出）_');
  } else {
    for (const spec of pack.standards.technicalSpecs) {
      lines.push(`- [${spec.role}] ${spec.title}${spec.version ? ` (${spec.version})` : ''}`);
    }
  }
  if (pack.standards.contractForm) {
    lines.push('', `合同框架：${pack.standards.contractForm.title}`);
  }
  lines.push(
    '',
    '## 组织策划大纲',
    '',
    pack.organizationOutline.text.trim() || '_（空）_',
    '',
    '## 投标人自有资源',
    '',
    pack.bidderResources.outline.trim() || '_（空）_',
    '',
  );
  if (pack.organizationOutline.derivedAssumptions?.length) {
    lines.push('## 派生假设', '');
    for (const item of pack.organizationOutline.derivedAssumptions) {
      lines.push(`- ${item}`);
    }
    lines.push('');
  }
  const sources = pack.boundarySources ?? [];
  lines.push('## 界限来源', '');
  if (sources.length === 0) {
    lines.push('_（尚未登记知识库规范、本标规范绑定或投标人自有文件）_');
    lines.push('');
  } else {
    for (const source of sources) {
      const locator = source.path || source.knowledgeSlug || source.documentId || '';
      lines.push(`- [${source.kind}/${source.role}] ${source.title}${locator ? ` — ${locator}` : ''} · ${source.parseStatus}`);
    }
    lines.push('');
  }
  const inventory = pack.extractedInventory;
  if (inventory && (inventory.plant.length + inventory.labour.length + inventory.materialSources.length + inventory.constraints.length) > 0) {
    lines.push('## 抽出的资源围栏', '');
    if (inventory.plant.length) lines.push(`- 设备：${inventory.plant.join('；')}`);
    if (inventory.labour.length) lines.push(`- 人员：${inventory.labour.join('；')}`);
    if (inventory.materialSources.length) lines.push(`- 料源：${inventory.materialSources.join('；')}`);
    if (inventory.constraints.length) lines.push(`- 约束：${inventory.constraints.join('；')}`);
    lines.push('');
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

export function publishProjectBoundaryMarkdown(input: {
  projectRoot: string;
  parentSessionId: string;
  pack: TenderProjectBoundaryPack;
}): string {
  const outputPath = projectBoundaryMarkdownPath(input.projectRoot, input.parentSessionId);
  mkdirSync(dirname(outputPath), { recursive: true });
  const temporary = `${outputPath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporary, formatProjectBoundaryMarkdown(input.pack), 'utf8');
  renameSync(temporary, outputPath);
  return outputPath;
}

function atomicWriteJson(filePath: string, value: unknown): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  renameSync(temporary, filePath);
}

export function readProjectBoundaryPack(
  projectDirectory: string,
): TenderCapabilityEnvelope<TenderProjectBoundaryPack> | null {
  const path = projectBoundaryPackPath(projectDirectory);
  if (!existsSync(path)) return null;
  try {
    const envelope = parseTenderCapabilityEnvelope(JSON.parse(readFileSync(path, 'utf8')));
    if (envelope.capability !== 'project_boundary') return null;
    return {
      ...envelope,
      data: parseTenderProjectBoundaryPack(envelope.data),
    };
  } catch {
    return null;
  }
}

export function writeProjectBoundaryPack(
  projectDirectory: string,
  envelope: TenderCapabilityEnvelope<TenderProjectBoundaryPack>,
): string {
  const path = projectBoundaryPackPath(projectDirectory);
  atomicWriteJson(path, envelope);
  return path;
}

export function looksLikeSanralBoundProject(bindings: TenderKnowledgeBindings): boolean {
  const blob = [
    bindings.pricing.methodStandard.path,
    bindings.pricing.methodStandard.title ?? '',
    bindings.planning.methodologyDepthTemplate.path,
    bindings.planning.workPlanDocxTemplate.path,
  ].join('\n');
  return SA_METHOD_MARKERS.some((marker) => blob.includes(marker));
}

function seedSourcesFromBindings(bindings?: TenderKnowledgeBindings): TenderProjectBoundarySource[] {
  if (!bindings) return [];
  const method = bindings.pricing.methodStandard;
  return [
    normalizeBoundarySource({
      kind: 'knowledge_standard',
      role: 'method',
      title: method.title ?? 'Pricing method standard',
      path: method.path,
      parseStatus: 'not_required',
    }),
  ];
}

/**
 * Build a draft project_boundary pack from legacy SANRAL/C5.1 bindings.
 * Does not write the pack or mark human confirmation — caller must persist via tender_capability.
 */
export function buildSanralProjectBoundaryDraft(input: {
  projectId: string;
  bindings?: TenderKnowledgeBindings;
  currency?: string;
  countryCode?: string;
  locationHint?: string;
}): TenderProjectBoundaryPack {
  const bindings = input.bindings;
  const methodTitle = bindings?.pricing.methodStandard.title
    ?? 'C5.1 pure direct cost (SANRAL highway profile)';
  return {
    schemaVersion: 1,
    projectId: input.projectId,
    profileId: 'sa-sanral-highway',
    jurisdiction: {
      countryCode: input.countryCode ?? 'ZA',
      authority: 'SANRAL',
      currency: input.currency ?? 'ZAR',
    },
    standards: {
      technicalSpecs: [
        {
          id: 'coto',
          title: 'COTO Standard Specifications for Road and Bridge Works',
          role: 'primary',
        },
      ],
      measurementStandard: {
        id: 'coto-measurement-payment',
        title: 'COTO measurement & payment',
        notes: 'Migrated from legacy SANRAL tender bindings; confirm against this tender.',
      },
    },
    pricing: {
      pricingStandard: 'c51_pure_direct_cost_v1',
      indirectCostPolicy: 'exclude_from_item_direct_cost',
      taxRegime: { vatTreatment: 'exclusive', notes: 'Legacy SA default — confirm for this bid.' },
      ratePolicy: {
        location: input.locationHint ?? 'South Africa (project-specific location TBD)',
        mustVerifyOnline: ['cement', 'diesel', 'bitumen', 'aggregates'],
        allowUnverifiedLabel: true,
      },
    },
    productivity: {
      basis: 'spec_derived',
      notes: `Method depth reference: ${methodTitle}`,
      sources: bindings
        ? [{
            title: methodTitle,
            pathOrUrl: bindings.pricing.methodStandard.path,
            confidence: 'medium',
          }]
        : [],
    },
    bidderResources: {
      outline: 'Legacy SA draft — replace with bidder-owned plant, labour, materials and subcontract boundaries for this tender.',
    },
    organizationOutline: {
      text: [
        'Legacy SANRAL/C5.1 profile draft auto-migrated from project bindings.',
        'Confirm traffic accommodation, temporary works, borrow/quarry strategy,',
        'and chapter sequencing before releasing BOQ pricing batches.',
        'Replace this outline with the project-specific organisation plan.',
      ].join(' '),
      derivedAssumptions: [
        'VAT exclusive item rates',
        'COTO chapter-oriented BOQ segmentation',
        'C5.1 pure direct cost quality checks',
      ],
    },
    boundarySources: seedSourcesFromBindings(bindings),
    readiness: 'draft',
  };
}

export function suggestProjectBoundaryDraftFromBindings(input: {
  projectDirectory: string;
  projectId: string;
  currency?: string;
}): { draft: TenderProjectBoundaryPack; source: 'sa-sanral-bindings' | 'generic' } | null {
  const existing = readProjectBoundaryPack(input.projectDirectory);
  if (existing) return null;

  const bindings = readTenderBindings(input.projectDirectory);
  if (looksLikeSanralBoundProject(bindings)) {
    return {
      source: 'sa-sanral-bindings',
      draft: buildSanralProjectBoundaryDraft({
        projectId: input.projectId,
        bindings,
        currency: input.currency,
      }),
    };
  }

  return {
    source: 'generic',
    draft: {
      schemaVersion: 1,
      projectId: input.projectId,
      profileId: 'generic-international',
      jurisdiction: {
        currency: input.currency ?? 'USD',
      },
      standards: {
        technicalSpecs: [],
        measurementStandard: {
          id: 'to-confirm',
          title: 'Confirm measurement standard from tender documents',
        },
      },
      pricing: {
        pricingStandard: pricingStandardForProfile('generic-international'),
        indirectCostPolicy: 'exclude_from_item_direct_cost',
        taxRegime: { vatTreatment: 'to_confirm' },
        ratePolicy: {
          location: 'Project location TBD',
          mustVerifyOnline: [],
          allowUnverifiedLabel: true,
        },
      },
      productivity: {
        basis: 'user_provided',
        sources: [],
      },
      bidderResources: {
        outline: 'Describe owned plant, labour, material sources and subcontract boundaries.',
      },
      organizationOutline: {
        text: '',
      },
      boundarySources: seedSourcesFromBindings(readTenderBindings(input.projectDirectory)),
      readiness: 'draft',
    },
  };
}

export function projectBoundarySoftGateMissing(pack: TenderProjectBoundaryPack | null): string[] {
  if (!pack) return ['project_boundary:missing'];
  const missing: string[] = [];
  if (!organizationOutlineMeetsMinimum(pack.organizationOutline.text)) {
    missing.push('project_boundary:outline');
  }
  if (!pack.standards.measurementStandard.id.trim() && !pack.standards.measurementStandard.title.trim()) {
    missing.push('project_boundary:measurement');
  }
  if (!pack.pricing.pricingStandard.trim()) missing.push('project_boundary:pricingStandard');
  if (!pack.jurisdiction.currency.trim()) missing.push('project_boundary:currency');
  return missing;
}

export function applyBoundarySourcesToPack(
  pack: TenderProjectBoundaryPack,
  sources: TenderProjectBoundarySource[],
): TenderProjectBoundaryPack {
  const previous = (pack.boundarySources ?? []).map((source) => `${source.id}:${source.path ?? ''}:${source.knowledgeSlug ?? ''}:${source.documentId ?? ''}`).sort().join('|');
  const next = sources.map((source) => `${source.id}:${source.path ?? ''}:${source.knowledgeSlug ?? ''}:${source.documentId ?? ''}`).sort().join('|');
  const sourcesChanged = previous !== next;
  if (!sourcesChanged) {
    return { ...pack, boundarySources: sources };
  }
  const { humanConfirmedAt: _cleared, ...rest } = pack;
  return {
    ...rest,
    boundarySources: sources,
    readiness: 'needs_review',
  };
}
