import { describe, expect, test } from 'bun:test';
import {
  buildMineruExtractionManifest,
  buildMineruJsonArgs,
  buildMineruMarkdownArgs,
  cleanMineruMarkdownScanNoise,
  DEFAULT_MINERU_COMMAND,
  extractMineruCitationBlocks,
  getBundledMineruCommandCandidates,
  getMineruPlatformPackageName,
  getMineruCredentialId,
  isMineruExtractionEnabled,
  resolveMineruCommandPath,
  resolveMineruMode,
  shouldRunMineruExtraction,
} from '../mineru.ts';
import type { WorkspaceConfig } from '../../workspaces/types.ts';

describe('MinerU document extraction helpers', () => {
  test('is disabled when workspace config is missing', () => {
    expect(isMineruExtractionEnabled(undefined)).toBe(false);
    expect(resolveMineruCommandPath(undefined)).toBe(DEFAULT_MINERU_COMMAND);
    expect(resolveMineruMode(undefined)).toBeUndefined();
  });

  test('requires an explicit workspace opt-in', () => {
    const config = {
      defaults: {
        documentExtraction: {
          mineru: {
            enabled: false,
          },
        },
      },
    } as WorkspaceConfig;

    expect(isMineruExtractionEnabled(config)).toBe(false);
  });

  test('does not run extraction from token presence alone', () => {
    const disabledConfig = {
      defaults: {
        documentExtraction: {
          mineru: {
            enabled: false,
          },
        },
      },
    } as WorkspaceConfig;
    const enabledConfig = {
      defaults: {
        documentExtraction: {
          mineru: {
            enabled: true,
          },
        },
      },
    } as WorkspaceConfig;

    expect(shouldRunMineruExtraction(undefined, 'mineru-token')).toBe(false);
    expect(shouldRunMineruExtraction(disabledConfig, 'mineru-token')).toBe(false);
    expect(shouldRunMineruExtraction(enabledConfig, '')).toBe(false);
    expect(shouldRunMineruExtraction(enabledConfig, 'mineru-token')).toBe(true);
  });

  test('resolves explicit command and mode', () => {
    const config = {
      defaults: {
        documentExtraction: {
          mineru: {
            enabled: true,
            commandPath: 'C:/Tools/mineru-open-api.cmd',
            mode: 'pipeline',
          },
        },
      },
    } as WorkspaceConfig;

    expect(isMineruExtractionEnabled(config)).toBe(true);
    expect(resolveMineruCommandPath(config)).toBe('C:/Tools/mineru-open-api.cmd');
    expect(resolveMineruMode(config)).toBe('pipeline');
  });

  test('discovers bundled MinerU platform binaries without enabling extraction', () => {
    const commandPath = 'C:\\AgentPi\\resources\\app\\resources\\bin\\win32-x64\\mineru-open-api.exe';
    const config = {
      defaults: {
        documentExtraction: {
          mineru: {
            enabled: false,
          },
        },
      },
    } as WorkspaceConfig;

    expect(resolveMineruCommandPath(config, {
      resourcesPath: 'C:\\AgentPi\\resources',
      platform: 'win32',
      arch: 'x64',
      fileExists: (path) => path === commandPath,
    })).toBe(commandPath);
    expect(isMineruExtractionEnabled(config)).toBe(false);
  });

  test('discovers packaged MinerU optional-dependency binaries', () => {
    const commandPath = 'C:\\AgentPi\\resources\\app\\node_modules\\mineru-open-api-win32-x64\\bin\\mineru-open-api.exe';

    expect(resolveMineruCommandPath(undefined, {
      resourcesPath: 'C:\\AgentPi\\resources',
      platform: 'win32',
      arch: 'x64',
      fileExists: (path) => path === commandPath,
    })).toBe(commandPath);
  });

  test('builds deterministic bundled MinerU candidate paths', () => {
    expect(getMineruPlatformPackageName('win32', 'x64')).toBe('mineru-open-api-win32-x64');
    expect(getMineruPlatformPackageName('freebsd', 'x64')).toBeUndefined();
    expect(getBundledMineruCommandCandidates({
      resourcesBasePath: 'C:\\AgentPi\\resources\\app',
      appRootPath: 'C:\\AgentPi\\resources\\app',
      resourcesPath: 'C:\\AgentPi\\resources',
      platform: 'win32',
      arch: 'x64',
    })).toContain('C:\\AgentPi\\resources\\app\\resources\\bin\\win32-x64\\mineru-open-api.exe');
  });

  test('builds token-safe Markdown extraction args', () => {
    expect(buildMineruMarkdownArgs('C:/Docs/sample.pdf', 'vlm')).toEqual([
      'extract',
      'C:/Docs/sample.pdf',
      '-f',
      'md',
      '--model',
      'vlm',
    ]);
  });

  test('builds token-safe raw JSON extraction args', () => {
    expect(buildMineruJsonArgs('C:/Docs/sample.pdf', 'pipeline')).toEqual([
      'extract',
      'C:/Docs/sample.pdf',
      '-f',
      'json',
      '--model',
      'pipeline',
    ]);
  });

  test('builds a stable MinerU extraction manifest', () => {
    expect(buildMineruExtractionManifest({
      sourcePath: 'C:/Docs/source.pdf',
      sourceName: 'source.pdf',
      markdownPath: 'C:/Docs/source.mineru.md',
      rawJsonPath: 'C:/Docs/source.mineru.raw.json',
      cleanupAuditPath: 'C:/Docs/source.mineru.cleanup.json',
      model: 'pipeline',
      cleanupScanNoise: true,
      createdAt: '2026-07-02T00:00:00.000Z',
    })).toEqual({
      schemaVersion: 1,
      provider: 'mineru',
      sourcePath: 'C:/Docs/source.pdf',
      sourceName: 'source.pdf',
      markdownPath: 'C:/Docs/source.mineru.md',
      rawJsonPath: 'C:/Docs/source.mineru.raw.json',
      cleanupAuditPath: 'C:/Docs/source.mineru.cleanup.json',
      model: 'pipeline',
      cleanupScanNoise: true,
      createdAt: '2026-07-02T00:00:00.000Z',
    });
  });

  test('cleans repeated scan noise lines with an audit trail', () => {
    const markdown = [
      'CONFIDENTIAL WATERMARK',
      '## Scope',
      'Keep this project requirement.',
      'Page 1 of 3',
      '',
      'CONFIDENTIAL WATERMARK',
      '## Pricing',
      'Keep this pricing requirement.',
      'Page 2 of 3',
      '',
      'CONFIDENTIAL WATERMARK',
      '## Contract',
      'Keep this contract requirement.',
      'Page 3 of 3',
    ].join('\n');

    const result = cleanMineruMarkdownScanNoise(markdown);

    expect(result.markdown).not.toContain('CONFIDENTIAL WATERMARK');
    expect(result.markdown).not.toContain('Page 1 of 3');
    expect(result.markdown).toContain('Keep this project requirement.');
    expect(result.markdown).toContain('Keep this pricing requirement.');
    expect(result.audit).toMatchObject({
      schemaVersion: 1,
      provider: 'mineru',
      enabled: true,
      removedLineCount: 6,
      candidates: expect.arrayContaining([
        expect.objectContaining({
          text: 'CONFIDENTIAL WATERMARK',
          occurrences: 3,
          removedCount: 3,
        }),
        expect.objectContaining({
          signature: 'page # of #',
          occurrences: 3,
          removedCount: 3,
        }),
      ]),
    });
  });

  test('extracts page and block citation records from MinerU raw JSON', () => {
    const rawJson = {
      pages: [
        {
          page_idx: 0,
          para_blocks: [
            {
              type: 'title',
              bbox: [10, 20, 300, 60],
              lines: [
                { spans: [{ text: 'Bid requirements' }] },
              ],
            },
            {
              block_type: 'text',
              text: 'Submit technical proposal with signed forms.',
            },
          ],
        },
        {
          page_no: 2,
          blocks: [
            {
              category: 'table',
              content: 'Evaluation: price 60%, technical 40%',
            },
          ],
        },
      ],
    };

    expect(extractMineruCitationBlocks(rawJson)).toEqual([
      {
        blockId: 'mineru-block-1',
        jsonPath: '$.pages[0].para_blocks[0]',
        text: 'Bid requirements',
        page: 1,
        pageIndex: 0,
        blockType: 'title',
        bbox: [10, 20, 300, 60],
      },
      {
        blockId: 'mineru-block-2',
        jsonPath: '$.pages[0].para_blocks[1]',
        text: 'Submit technical proposal with signed forms.',
        page: 1,
        pageIndex: 0,
        blockType: 'text',
      },
      {
        blockId: 'mineru-block-3',
        jsonPath: '$.pages[1].blocks[0]',
        text: 'Evaluation: price 60%, technical 40%',
        page: 2,
        blockType: 'table',
      },
    ]);
  });

  test('extracts citations from alternate MinerU layout schemas', () => {
    const rawJson = {
      pdf_info: [
        {
          page_id: 0,
          layout_dets: [
            {
              category_type: 'plain text',
              text_content: 'Alternative schema paragraph text.',
              position: { x0: 12, y0: 24, x1: 320, y1: 88 },
            },
            {
              layout_type: 'seal',
              ocrText: 'Signed company seal',
              poly: [10, 10, 40, 10, 40, 30, 10, 30],
            },
          ],
        },
        {
          pageNum: 3,
          elements: [
            {
              tag: 'table',
              html: '<table><tr><td>Commercial score</td></tr></table>',
              boundingBox: { x: 5, y: 8, width: 90, height: 30 },
            },
          ],
        },
      ],
    };

    expect(extractMineruCitationBlocks(rawJson)).toEqual([
      {
        blockId: 'mineru-block-1',
        jsonPath: '$.pdf_info[0].layout_dets[0]',
        text: 'Alternative schema paragraph text.',
        page: 1,
        pageIndex: 0,
        blockType: 'plain text',
        bbox: [12, 24, 320, 88],
      },
      {
        blockId: 'mineru-block-2',
        jsonPath: '$.pdf_info[0].layout_dets[1]',
        text: 'Signed company seal',
        page: 1,
        pageIndex: 0,
        blockType: 'seal',
        bbox: [10, 10, 40, 30],
      },
      {
        blockId: 'mineru-block-3',
        jsonPath: '$.pdf_info[1].elements[0]',
        text: '<table><tr><td>Commercial score</td></tr></table>',
        page: 3,
        blockType: 'table',
        bbox: [5, 8, 95, 38],
      },
    ]);
  });

  test('limits extracted citation blocks and text preview size', () => {
    const rawJson = {
      pages: [
        {
          page_idx: 0,
          blocks: [
            { type: 'text', text: 'A'.repeat(300) },
            { type: 'text', text: 'second block' },
          ],
        },
      ],
    };

    expect(extractMineruCitationBlocks(rawJson, { limit: 1, maxTextChars: 100 })).toEqual([
      expect.objectContaining({
        blockId: 'mineru-block-1',
        text: 'A'.repeat(100),
      }),
    ]);
  });

  test('uses a workspace-scoped MinerU credential ID', () => {
    expect(getMineruCredentialId('ws-1')).toEqual({
      type: 'document_api_token',
      workspaceId: 'ws-1',
      name: 'mineru',
    });
  });
});
