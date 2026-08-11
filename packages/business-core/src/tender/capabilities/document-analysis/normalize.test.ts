import { describe, expect, test } from 'bun:test';
import { parseTenderDocumentAnalysisData } from './schema.ts';
import { normalizeDocumentAnalysis } from './normalize.ts';

describe('normalizeDocumentAnalysis', () => {
  test('string sourceRefs become objects and parse', () => {
    const { data, warnings } = normalizeDocumentAnalysis({
      sections: [{
        id: 's1',
        documentId: 'book1',
        title: 'Tender data',
        kind: 'project_information',
        summary: 'Summary text long enough for review',
        sourceRefs: ['book1'],
        status: 'reviewed',
      }],
    });
    expect(data.sections[0]?.sourceRefs[0]).toEqual({ documentId: 'book1' });
    expect(warnings.some((w) => /sourceRefs/i.test(w))).toBe(true);
    expect(() => parseTenderDocumentAnalysisData(data)).not.toThrow();
  });

  test('parseTenderDocumentAnalysisData accepts string sourceRefs via normalize', () => {
    const parsed = parseTenderDocumentAnalysisData({
      sections: [{
        id: 's1',
        documentId: 'book1',
        title: 'Tender data',
        kind: 'tender_requirements',
        summary: 'Mandatory attendance',
        sourceRefs: ['book1'],
        status: 'draft',
      }],
    });
    expect(parsed.sections[0]?.sourceRefs).toEqual([{ documentId: 'book1' }]);
  });
});
