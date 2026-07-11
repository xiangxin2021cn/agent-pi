import type {
  SessionArtifactDeliverable,
  SessionArtifactKind,
  SessionArtifactValidationLevel,
} from '../sessions/types.ts';

export interface ArtifactFormatCapability {
  id: string;
  format: string;
  kinds: SessionArtifactKind[];
  generation: 'transactional' | 'native_export' | 'tool_backed' | 'unregistered';
  validationLevel: SessionArtifactValidationLevel;
  preview: 'native' | 'converted' | 'external' | 'none';
}

const CAPABILITIES: Record<string, ArtifactFormatCapability> = {
  MD: capability('md-transactional', 'MD', ['document'], 'transactional', 'syntax', 'native'),
  HTML: capability('html-native-export', 'HTML', ['document'], 'native_export', 'syntax', 'native'),
  DOCX: capability('docx-native-export', 'DOCX', ['document'], 'native_export', 'schema', 'converted'),
  PDF: capability('pdf-native-export', 'PDF', ['document'], 'native_export', 'syntax', 'native'),
  XLSX: capability('xlsx-tool-backed', 'XLSX', ['workbook', 'data'], 'tool_backed', 'schema', 'native'),
  PPTX: capability('pptx-tool-backed', 'PPTX', ['presentation'], 'tool_backed', 'syntax', 'external'),
  CSV: capability('csv-tool-backed', 'CSV', ['data', 'workbook'], 'tool_backed', 'syntax', 'native'),
  JSON: capability('json-tool-backed', 'JSON', ['data'], 'tool_backed', 'syntax', 'native'),
  TXT: capability('txt-tool-backed', 'TXT', ['document', 'data'], 'tool_backed', 'syntax', 'native'),
};

const FORMAT_ALIASES: Record<string, string> = {
  MARKDOWN: 'MD',
  HTM: 'HTML',
  DOC: 'DOCX',
  XLS: 'XLSX',
  XLSM: 'XLSX',
  PPT: 'PPTX',
  TEXT: 'TXT',
};

export function normalizeArtifactFormat(value: string | null | undefined): string | undefined {
  const normalized = value?.trim().replace(/^\.+/, '').toUpperCase();
  if (!normalized) return undefined;
  return FORMAT_ALIASES[normalized] ?? normalized;
}

export function getArtifactFormatCapability(format: string): ArtifactFormatCapability {
  const normalized = normalizeArtifactFormat(format) ?? 'UNKNOWN';
  return CAPABILITIES[normalized] ?? {
    id: `unregistered-${normalized.toLowerCase()}`,
    format: normalized,
    kinds: ['other'],
    generation: 'unregistered',
    validationLevel: 'existence',
    preview: 'external',
  };
}

export function deriveOutputFormats(deliverables: SessionArtifactDeliverable[]): string[] {
  return [...new Set(deliverables
    .filter(deliverable => deliverable.required)
    .map(deliverable => normalizeArtifactFormat(deliverable.format))
    .filter((format): format is string => Boolean(format)))];
}

function capability(
  id: string,
  format: string,
  kinds: SessionArtifactKind[],
  generation: ArtifactFormatCapability['generation'],
  validationLevel: SessionArtifactValidationLevel,
  preview: ArtifactFormatCapability['preview'],
): ArtifactFormatCapability {
  return { id, format, kinds, generation, validationLevel, preview };
}
