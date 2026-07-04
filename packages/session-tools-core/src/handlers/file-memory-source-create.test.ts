import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import type { SessionToolContext } from '../context.ts';
import type { SourceConfig } from '../types.ts';
import { handleFileMemorySourceCreate } from './file-memory-source-create.ts';

function createTestContext(workspacePath: string, workingDirectory: string, overrides: Partial<SessionToolContext> = {}): SessionToolContext {
  return {
    sessionId: 'session-1',
    workspacePath,
    plansFolderPath: join(workspacePath, 'plans'),
    workingDirectory,
    get sourcesPath() {
      return join(workspacePath, 'sources');
    },
    get skillsPath() {
      return join(workspacePath, 'skills');
    },
    callbacks: {
      onPlanSubmitted: () => {},
      onAuthRequest: () => {},
    },
    fs: {
      exists: (path: string) => existsSync(path),
      readFile: (path: string) => readFileSync(path, 'utf-8'),
      readFileBuffer: (path: string) => readFileSync(path),
      writeFile: (path: string, content: string) => writeFileSync(path, content, 'utf-8'),
      isDirectory: (path: string) => existsSync(path) && statSync(path).isDirectory(),
      readdir: (path: string) => [],
      stat: (path: string) => {
        const stats = statSync(path);
        return {
          size: stats.size,
          isDirectory: () => stats.isDirectory(),
        };
      },
    },
    loadSourceConfig: (sourceSlug: string): SourceConfig | null => {
      const configPath = join(workspacePath, 'sources', sourceSlug, 'config.json');
      if (!existsSync(configPath)) return null;
      return JSON.parse(readFileSync(configPath, 'utf-8')) as SourceConfig;
    },
    saveSourceConfig: (source: SourceConfig) => {
      const configPath = join(workspacePath, 'sources', source.slug, 'config.json');
      writeFileSync(configPath, JSON.stringify(source, null, 2), 'utf-8');
    },
    ...overrides,
  };
}

describe('file_memory_source_create', () => {
  test('creates a manifest and stdio MCP source for a text file', async () => {
    const root = mkdtempSync(join(tmpdir(), 'file-memory-source-'));
    const previousServer = process.env.CRAFT_FILE_MEMORY_MCP_SERVER;
    const previousBun = process.env.CRAFT_BUN;
    const previousPackaged = process.env.CRAFT_IS_PACKAGED;

    try {
      const workspacePath = join(root, 'workspace');
      const workingDirectory = join(root, 'project');
      mkdirSync(workspacePath, { recursive: true });
      mkdirSync(workingDirectory, { recursive: true });

      const fakeServer = join(root, 'file-memory-server.js');
      writeFileSync(fakeServer, 'console.log("ok");', 'utf-8');
      process.env.CRAFT_FILE_MEMORY_MCP_SERVER = fakeServer;
      process.env.CRAFT_BUN = 'bun';
      process.env.CRAFT_IS_PACKAGED = '0';

      const sourceFile = join(workingDirectory, 'tender.md');
      writeFileSync(
        sourceFile,
        [
          '# Tender',
          '',
          'The contractor must provide a retention bond before commencement.',
          '',
          'Completion must follow the milestone schedule.',
        ].join('\n'),
        'utf-8'
      );

      const ctx = createTestContext(workspacePath, workingDirectory);
      const result = await handleFileMemorySourceCreate(ctx, {
        filePath: 'tender.md',
        sourceSlug: 'file-memory-tender',
        autoEnable: false,
      });

      expect(result.isError).toBeFalsy();
      expect(result.content[0]?.text).toContain('Created file memory source: file-memory-tender');

      const manifestPath = join(workspacePath, 'file-memory', 'file-memory-tender', 'manifest.json');
      const sourceConfigPath = join(workspacePath, 'sources', 'file-memory-tender', 'config.json');
      const guidePath = join(workspacePath, 'sources', 'file-memory-tender', 'guide.md');
      expect(existsSync(manifestPath)).toBe(true);
      expect(existsSync(sourceConfigPath)).toBe(true);
      expect(existsSync(guidePath)).toBe(true);

      const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as { chunks: Array<{ text: string }> };
      expect(manifest.chunks.length).toBeGreaterThan(0);
      expect(manifest.chunks[0]?.text).toContain('retention bond');

      const config = JSON.parse(readFileSync(sourceConfigPath, 'utf-8')) as SourceConfig;
      expect(config.type).toBe('mcp');
      expect(config.mcp?.transport).toBe('stdio');
      expect(config.mcp?.args).toContain(fakeServer);
      expect(config.mcp?.args).toContain(manifestPath);
    } finally {
      if (previousServer === undefined) delete process.env.CRAFT_FILE_MEMORY_MCP_SERVER;
      else process.env.CRAFT_FILE_MEMORY_MCP_SERVER = previousServer;
      if (previousBun === undefined) delete process.env.CRAFT_BUN;
      else process.env.CRAFT_BUN = previousBun;
      if (previousPackaged === undefined) delete process.env.CRAFT_IS_PACKAGED;
      else process.env.CRAFT_IS_PACKAGED = previousPackaged;
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('auto-enables and activates a valid source', async () => {
    const root = mkdtempSync(join(tmpdir(), 'file-memory-source-'));
    const previousServer = process.env.CRAFT_FILE_MEMORY_MCP_SERVER;
    const previousBun = process.env.CRAFT_BUN;
    const previousPackaged = process.env.CRAFT_IS_PACKAGED;

    try {
      const workspacePath = join(root, 'workspace');
      const workingDirectory = join(root, 'project');
      mkdirSync(workspacePath, { recursive: true });
      mkdirSync(workingDirectory, { recursive: true });

      const fakeServer = join(root, 'file-memory-server.js');
      writeFileSync(fakeServer, 'console.log("ok");', 'utf-8');
      process.env.CRAFT_FILE_MEMORY_MCP_SERVER = fakeServer;
      process.env.CRAFT_BUN = 'bun';
      process.env.CRAFT_IS_PACKAGED = '0';

      const sourceFile = join(workingDirectory, 'evidence.md');
      writeFileSync(sourceFile, 'Evidence line one.\n\nEvidence line two.', 'utf-8');

      const activated: string[] = [];
      const ctx = createTestContext(workspacePath, workingDirectory, {
        validateStdioMcpConnection: async () => ({
          success: true,
          toolCount: 3,
          toolNames: ['get_file_memory_manifest', 'search_file_memory', 'read_file_memory_chunk'],
        }),
        activateSourceInSession: async (sourceSlug: string) => {
          activated.push(sourceSlug);
          return { ok: true, availability: 'next-turn' };
        },
      });

      const result = await handleFileMemorySourceCreate(ctx, {
        filePath: 'evidence.md',
        sourceSlug: 'file-memory-evidence',
        autoEnable: true,
      });

      expect(result.isError).toBeFalsy();
      expect(result.structuredContent?.sourceSlug).toBe('file-memory-evidence');
      expect(result.structuredContent?.activated).toBe(true);
      expect(activated).toEqual(['file-memory-evidence']);

      const sourceConfigPath = join(workspacePath, 'sources', 'file-memory-evidence', 'config.json');
      const config = JSON.parse(readFileSync(sourceConfigPath, 'utf-8')) as SourceConfig;
      expect(config.enabled).toBe(true);
      expect(config.connectionStatus).toBe('connected');
    } finally {
      if (previousServer === undefined) delete process.env.CRAFT_FILE_MEMORY_MCP_SERVER;
      else process.env.CRAFT_FILE_MEMORY_MCP_SERVER = previousServer;
      if (previousBun === undefined) delete process.env.CRAFT_BUN;
      else process.env.CRAFT_BUN = previousBun;
      if (previousPackaged === undefined) delete process.env.CRAFT_IS_PACKAGED;
      else process.env.CRAFT_IS_PACKAGED = previousPackaged;
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('stores knowledge base metadata for supported text artifacts', async () => {
    const root = mkdtempSync(join(tmpdir(), 'file-memory-source-'));
    const previousServer = process.env.CRAFT_FILE_MEMORY_MCP_SERVER;
    const previousBun = process.env.CRAFT_BUN;
    const previousPackaged = process.env.CRAFT_IS_PACKAGED;

    try {
      const workspacePath = join(root, 'workspace');
      const workingDirectory = join(root, 'project');
      const knowledgeBaseRegistryRootPath = join(root, 'app-config');
      mkdirSync(workspacePath, { recursive: true });
      mkdirSync(workingDirectory, { recursive: true });
      mkdirSync(knowledgeBaseRegistryRootPath, { recursive: true });

      const fakeServer = join(root, 'file-memory-server.js');
      writeFileSync(fakeServer, 'console.log("ok");', 'utf-8');
      process.env.CRAFT_FILE_MEMORY_MCP_SERVER = fakeServer;
      process.env.CRAFT_BUN = 'bun';
      process.env.CRAFT_IS_PACKAGED = '0';

      const sourceFile = join(workingDirectory, 'company-standard.md');
      writeFileSync(sourceFile, '# Company Standard\n\nUse approved method statements.', 'utf-8');

      const ctx = createTestContext(workspacePath, workingDirectory, { knowledgeBaseRegistryRootPath });
      const result = await handleFileMemorySourceCreate(ctx, {
        filePath: 'company-standard.md',
        sourceSlug: 'file-memory-company-standard',
        autoEnable: false,
        knowledgeBase: {
          category: 'Tender Standards/Method Statements',
        },
      });

      expect(result.isError).toBeFalsy();

      const manifestPath = join(workspacePath, 'file-memory', 'file-memory-company-standard', 'manifest.json');
      const sourceConfigPath = join(workspacePath, 'sources', 'file-memory-company-standard', 'config.json');
      const guidePath = join(workspacePath, 'sources', 'file-memory-company-standard', 'guide.md');

      const config = JSON.parse(readFileSync(sourceConfigPath, 'utf-8')) as SourceConfig & { metadata?: Record<string, unknown> };
      expect(config.metadata).toMatchObject({
        category: 'knowledge_base',
        collectionId: 'local-file-memory',
        knowledgeCategory: 'Tender Standards/Method Statements',
        knowledgeFolder: 'Tender Standards/Method Statements',
        scope: 'global',
        sourceKind: 'file-memory',
        fileExtension: '.md',
      });
      expect(config.enabled).toBe(false);

      const stableSourceFilePath = String(config.metadata?.sourceFilePath);
      expect(stableSourceFilePath).not.toBe(sourceFile);
      expect(relative(join(knowledgeBaseRegistryRootPath, 'knowledge-base', 'files'), stableSourceFilePath)).toBe(
        join('Tender Standards', 'Method Statements', 'file-memory-company-standard', 'company-standard.md')
      );
      expect(readFileSync(stableSourceFilePath, 'utf-8')).toContain('Use approved method statements.');
      expect(config.metadata?.originalSourceFilePath).toBe(sourceFile);

      const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as { sourceFile?: string; chunks: Array<{ sourcePath: string }>; knowledgeBase?: Record<string, unknown> };
      expect(manifest.sourceFile).toBe(stableSourceFilePath);
      expect(manifest.chunks[0]?.sourcePath).toBe(stableSourceFilePath);
      expect(manifest.knowledgeBase).toMatchObject({
        category: 'Tender Standards/Method Statements',
        scope: 'global',
      });

      const guide = readFileSync(guidePath, 'utf-8');
      expect(guide).toContain('Knowledge Base');
      expect(guide).toContain('Tender Standards/Method Statements');

      const registryPath = join(knowledgeBaseRegistryRootPath, 'knowledge-base', 'registry.json');
      const registry = JSON.parse(readFileSync(registryPath, 'utf-8')) as {
        version: number;
        entries: Array<Record<string, unknown>>;
      };
      expect(registry.version).toBe(1);
      expect(registry.entries).toContainEqual(expect.objectContaining({
        sourceSlug: 'file-memory-company-standard',
        name: 'company-standard.md',
        sourceFilePath: stableSourceFilePath,
        originalSourceFilePath: sourceFile,
        workspacePath,
        collectionId: 'local-file-memory',
        knowledgeCategory: 'Tender Standards/Method Statements',
        knowledgeFolder: 'Tender Standards/Method Statements',
        scope: 'global',
        sourceKind: 'file-memory',
        fileExtension: '.md',
      }));

      const indexPath = join(knowledgeBaseRegistryRootPath, 'knowledge-base', 'index.md');
      const index = readFileSync(indexPath, 'utf-8');
      expect(index).toContain('# Agent Pi Knowledge Base Index');
      expect(index).toContain('## Tender Standards/Method Statements');
      expect(index).toContain('file-memory-company-standard');
      expect(index).toContain(sourceFile);
    } finally {
      if (previousServer === undefined) delete process.env.CRAFT_FILE_MEMORY_MCP_SERVER;
      else process.env.CRAFT_FILE_MEMORY_MCP_SERVER = previousServer;
      if (previousBun === undefined) delete process.env.CRAFT_BUN;
      else process.env.CRAFT_BUN = previousBun;
      if (previousPackaged === undefined) delete process.env.CRAFT_IS_PACKAGED;
      else process.env.CRAFT_IS_PACKAGED = previousPackaged;
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('keeps structured knowledge base copies with the indexed file extension', async () => {
    const root = mkdtempSync(join(tmpdir(), 'file-memory-source-'));
    const previousServer = process.env.CRAFT_FILE_MEMORY_MCP_SERVER;
    const previousBun = process.env.CRAFT_BUN;
    const previousPackaged = process.env.CRAFT_IS_PACKAGED;

    try {
      const workspacePath = join(root, 'workspace');
      const workingDirectory = join(root, 'project');
      const knowledgeBaseRegistryRootPath = join(root, 'app');
      mkdirSync(workspacePath, { recursive: true });
      mkdirSync(workingDirectory, { recursive: true });

      const fakeServer = join(root, 'file-memory-server.js');
      writeFileSync(fakeServer, '// fake server', 'utf-8');
      process.env.CRAFT_FILE_MEMORY_MCP_SERVER = fakeServer;
      process.env.CRAFT_BUN = process.execPath;
      process.env.CRAFT_IS_PACKAGED = '0';

      const structuredFile = join(workingDirectory, 'drawing.pdf.structured.md');
      const originalFile = join(root, 'original', 'drawing.pdf');
      mkdirSync(dirname(originalFile), { recursive: true });
      writeFileSync(structuredFile, '# Drawing\n\nStructured Markdown text.', 'utf-8');
      writeFileSync(originalFile, 'binary-placeholder', 'utf-8');

      const ctx = createTestContext(workspacePath, workingDirectory, { knowledgeBaseRegistryRootPath });
      const result = await handleFileMemorySourceCreate(ctx, {
        filePath: structuredFile,
        originalSourceFilePath: originalFile,
        name: 'drawing.pdf',
        sourceSlug: 'file-memory-drawing',
        autoEnable: false,
        knowledgeBase: {
          category: 'Drawings',
        },
      });

      expect(result.isError).toBeFalsy();

      const sourceConfigPath = join(workspacePath, 'sources', 'file-memory-drawing', 'config.json');
      const config = JSON.parse(readFileSync(sourceConfigPath, 'utf-8')) as SourceConfig & { metadata?: Record<string, unknown> };
      const stableSourceFilePath = String(config.metadata?.sourceFilePath);
      expect(stableSourceFilePath.endsWith('.md')).toBe(true);
      expect(stableSourceFilePath.endsWith('.pdf')).toBe(false);
      expect(config.metadata?.originalSourceFilePath).toBe(originalFile);
      expect(readFileSync(stableSourceFilePath, 'utf-8')).toContain('Structured Markdown text.');
    } finally {
      if (previousServer === undefined) delete process.env.CRAFT_FILE_MEMORY_MCP_SERVER;
      else process.env.CRAFT_FILE_MEMORY_MCP_SERVER = previousServer;
      if (previousBun === undefined) delete process.env.CRAFT_BUN;
      else process.env.CRAFT_BUN = previousBun;
      if (previousPackaged === undefined) delete process.env.CRAFT_IS_PACKAGED;
      else process.env.CRAFT_IS_PACKAGED = previousPackaged;
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('rejects unsupported knowledge base file formats', async () => {
    const root = mkdtempSync(join(tmpdir(), 'file-memory-source-'));

    try {
      const workspacePath = join(root, 'workspace');
      const workingDirectory = join(root, 'project');
      mkdirSync(workspacePath, { recursive: true });
      mkdirSync(workingDirectory, { recursive: true });

      const sourceFile = join(workingDirectory, 'drawing.pdf');
      writeFileSync(sourceFile, '%PDF fake content', 'utf-8');

      const ctx = createTestContext(workspacePath, workingDirectory);
      const result = await handleFileMemorySourceCreate(ctx, {
        filePath: 'drawing.pdf',
        autoEnable: false,
        knowledgeBase: {
          category: 'Drawings',
        },
      });

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('Knowledge base MCP sources support only .md, .txt, and .json files');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
