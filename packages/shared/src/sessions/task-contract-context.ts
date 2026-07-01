import type { SessionTaskContract } from './types.ts';

const MAX_ITEMS_PER_SECTION = 3;
const MAX_ITEM_LENGTH = 260;

export function formatTaskContractContext(contract: SessionTaskContract | undefined): string | undefined {
  if (!contract) return undefined;

  const sections = [
    formatLine('Original request', contract.originalRequest, 500),
    formatList('Deliverables', contract.deliverables),
    formatList('Must preserve', contract.mustPreserve),
    formatList('Evidence requirements', contract.evidenceRequirements),
    formatList('Output formats', contract.outputFormats),
    formatList('Acceptance criteria', contract.acceptanceCriteria),
    formatList('Forbidden shortcuts', contract.forbiddenShortcuts),
  ].filter(Boolean);

  if (sections.length === 0) return undefined;

  return [
    `<goal_contract taskType="${escapeAttribute(contract.taskType)}">`,
    'Execution guidance:',
    '- Treat this contract as the acceptance boundary for the current task.',
    '- Preserve explicit requirements and referenced evidence before optimizing for brevity.',
    '- Do not claim completion until deliverables, evidence requirements, and forbidden shortcuts are checked.',
    '',
    ...sections,
    '</goal_contract>',
  ].join('\n');
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
