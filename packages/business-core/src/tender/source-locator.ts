import type { TenderSourceLocator } from './types.ts';

const ENTITY_ID_MAX = 80;

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Coerce free-form document ids (incl. spaces) into filesystem-safe entity ids. */
export function coerceDocumentId(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (/^[a-z0-9][a-z0-9._-]{0,79}$/i.test(trimmed)) return trimmed.slice(0, ENTITY_ID_MAX);
  const slug = trimmed
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, ENTITY_ID_MAX);
  if (!slug || !/^[a-z0-9]/i.test(slug)) return undefined;
  return slug;
}

export function normalizeSourceRef(value: unknown): TenderSourceLocator | undefined {
  if (typeof value === 'string') {
    const documentId = coerceDocumentId(value);
    return documentId ? { documentId } : undefined;
  }
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  const rawId = typeof record.documentId === 'string' ? record.documentId : '';
  const documentId = coerceDocumentId(rawId);
  if (!documentId) return undefined;

  const ref: TenderSourceLocator = { documentId };
  for (const key of ['sheet', 'clause', 'section', 'cell', 'blockId', 'excerpt'] as const) {
    const text = normalizeText(record[key]);
    if (text) ref[key] = text;
  }
  const page = Number(record.page);
  if (Number.isInteger(page) && page > 0) ref.page = page;
  if (Array.isArray(record.bbox) && record.bbox.length === 4) {
    const bbox = record.bbox.map(Number);
    if (bbox.every((n) => Number.isFinite(n))) {
      ref.bbox = bbox as [number, number, number, number];
    }
  }
  return ref;
}

export function normalizeSourceRefs(value: unknown): TenderSourceLocator[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const ref = normalizeSourceRef(entry);
    return ref ? [ref] : [];
  });
}

/** True when any array entry needed string→object (or id slug) coercion. */
export function sourceRefsNeededCoercion(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  return value.some((entry) => {
    if (typeof entry === 'string') return true;
    if (!entry || typeof entry !== 'object') return false;
    const documentId = (entry as { documentId?: unknown }).documentId;
    return typeof documentId === 'string' && coerceDocumentId(documentId) !== documentId.trim();
  });
}
