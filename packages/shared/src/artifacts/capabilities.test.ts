import { describe, expect, it } from 'bun:test';
import {
  deriveOutputFormats,
  getArtifactFormatCapability,
  normalizeArtifactFormat,
} from './capabilities.ts';

describe('artifact format capabilities', () => {
  it('registers native and tool-backed common formats with truthful validation levels', () => {
    expect(getArtifactFormatCapability('pdf')).toMatchObject({
      id: 'pdf-native-export',
      format: 'PDF',
      generation: 'native_export',
      validationLevel: 'syntax',
      preview: 'native',
    });
    expect(getArtifactFormatCapability('.docx')).toMatchObject({
      format: 'DOCX',
      generation: 'native_export',
      validationLevel: 'schema',
    });
    expect(getArtifactFormatCapability('xlsx')).toMatchObject({
      format: 'XLSX',
      generation: 'tool_backed',
      validationLevel: 'schema',
    });
  });

  it('keeps unknown professional formats explicit but existence-only', () => {
    expect(getArtifactFormatCapability('xer')).toEqual({
      id: 'unregistered-xer',
      format: 'XER',
      kinds: ['other'],
      generation: 'unregistered',
      validationLevel: 'existence',
      preview: 'external',
    });
  });

  it('normalizes dotted and mixed-case extensions', () => {
    expect(normalizeArtifactFormat('.Pdf')).toBe('PDF');
    expect(normalizeArtifactFormat('  docx  ')).toBe('DOCX');
    expect(normalizeArtifactFormat('.markdown')).toBe('MD');
    expect(normalizeArtifactFormat('.htm')).toBe('HTML');
    expect(normalizeArtifactFormat('.doc')).toBe('DOCX');
    expect(normalizeArtifactFormat('')).toBeUndefined();
  });

  it('derives only required output formats without duplicates', () => {
    expect(deriveOutputFormats([
      {
        id: 'artifact-pdf',
        kind: 'document',
        format: 'PDF',
        required: true,
        origin: 'explicit',
        validationLevel: 'syntax',
      },
      {
        id: 'artifact-pdf-copy',
        kind: 'document',
        format: '.pdf',
        required: true,
        origin: 'explicit',
        validationLevel: 'syntax',
      },
      {
        id: 'artifact-md-draft',
        kind: 'document',
        format: 'MD',
        required: false,
        origin: 'app_draft',
        validationLevel: 'syntax',
      },
    ])).toEqual(['PDF']);
  });
});
