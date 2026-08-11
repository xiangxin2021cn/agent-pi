import { describe, expect, test } from 'bun:test';
import { normalizeSourceRef, normalizeSourceRefs, sourceRefsNeededCoercion } from './source-locator.ts';

describe('normalizeSourceRef', () => {
  test('coerces plain string documentId', () => {
    expect(normalizeSourceRef('book1')).toEqual({ documentId: 'book1' });
  });

  test('slugifies spaced string ids', () => {
    expect(normalizeSourceRef('Book 1')).toEqual({ documentId: 'book-1' });
  });

  test('keeps object locators', () => {
    expect(normalizeSourceRef({ documentId: 'boq', page: 3 })).toEqual({ documentId: 'boq', page: 3 });
  });

  test('drops empty', () => {
    expect(normalizeSourceRef('')).toBeUndefined();
    expect(normalizeSourceRef(null)).toBeUndefined();
  });
});

describe('normalizeSourceRefs', () => {
  test('maps mixed string/object arrays', () => {
    expect(normalizeSourceRefs(['doc-a', { documentId: 'doc-b', clause: '4.1' }])).toEqual([
      { documentId: 'doc-a' },
      { documentId: 'doc-b', clause: '4.1' },
    ]);
  });
});

describe('sourceRefsNeededCoercion', () => {
  test('detects string entries', () => {
    expect(sourceRefsNeededCoercion(['book1'])).toBe(true);
    expect(sourceRefsNeededCoercion([{ documentId: 'book1' }])).toBe(false);
  });
});
