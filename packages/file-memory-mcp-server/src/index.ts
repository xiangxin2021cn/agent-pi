#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import {
  formatChunk,
  formatManifestSummary,
  formatSearchResults,
  loadManifestFromPath,
  readChunk,
  resolveManifestPath,
  searchManifest,
  type LoadedFileMemoryManifest,
} from './search.ts';
import {
  auditKnowledgeBaseCitations,
  findKnowledgeBaseClause,
  findKnowledgeBaseTable,
  formatKnowledgeBaseSearch,
  formatKnowledgeBaseSources,
  listKnowledgeBaseSources,
  readKnowledgeBaseChunk,
  readKnowledgeBaseRange,
  searchKnowledgeBase,
} from './knowledge-base-index.ts';

interface CliArgs {
  manifest?: string;
  indexDir?: string;
  knowledgeBaseRoot?: string;
}

const SearchArgsSchema = z.object({
  query: z.string().min(1),
  limit: z.number().int().min(1).max(20).optional(),
});

const ReadChunkArgsSchema = z.object({
  chunkId: z.string().min(1),
});

const KnowledgeBaseSearchArgsSchema = z.object({
  query: z.string().min(1),
  limit: z.number().int().min(1).max(50).optional(),
  sourceSlugs: z.array(z.string().min(1)).optional(),
  folder: z.string().optional(),
});

const KnowledgeBaseReadChunkArgsSchema = z.object({
  sourceSlug: z.string().min(1),
  chunkId: z.string().min(1),
});

const KnowledgeBaseReadRangeArgsSchema = z.object({
  sourceSlug: z.string().min(1),
  startLine: z.number().int().min(1),
  endLine: z.number().int().min(1),
  contextLines: z.number().int().min(0).max(20).optional(),
});

const KnowledgeBaseFindArgsSchema = z.object({
  value: z.string().min(1),
  limit: z.number().int().min(1).max(50).optional(),
  sourceSlugs: z.array(z.string().min(1)).optional(),
  folder: z.string().optional(),
});

const KnowledgeBaseCitationAuditArgsSchema = z.object({
  citations: z.array(z.object({
    sourceSlug: z.string().min(1),
    chunkId: z.string().min(1),
  })),
  requiredSourceSlugs: z.array(z.string().min(1)).optional(),
});

const fileMemoryTools: Tool[] = [
  {
    name: 'get_file_memory_manifest',
    description: 'Show metadata for this file memory source, including source file and chunk count.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'search_file_memory',
    description: 'Search indexed chunks from this single file memory source and return evidence snippets with citations.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search terms, exact phrase, clause number, table label, or document fact to locate.',
        },
        limit: {
          type: 'number',
          description: 'Maximum results to return, from 1 to 20. Defaults to 5.',
          minimum: 1,
          maximum: 20,
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'read_file_memory_chunk',
    description: 'Read the full text for one indexed file memory chunk by chunk id.',
    inputSchema: {
      type: 'object',
      properties: {
        chunkId: {
          type: 'string',
          description: 'Chunk id returned by search_file_memory.',
        },
      },
      required: ['chunkId'],
      additionalProperties: false,
    },
  },
];

const knowledgeBaseIndexTools: Tool[] = [
  {
    name: 'list_sources',
    description: 'List registered knowledge-base file-memory sources. Use this first to understand available folders and source slugs.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'search_kb',
    description: 'Search all registered knowledge-base chunks deterministically. Returns snippets, source slugs, chunk ids, and citations. Does not load full documents.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Exact phrase, clause number, table name, BOQ ref, Chinese term, or technical search query.' },
        limit: { type: 'number', minimum: 1, maximum: 50 },
        sourceSlugs: { type: 'array', items: { type: 'string' }, description: 'Optional source slug filter.' },
        folder: { type: 'string', description: 'Optional knowledge folder filter.' },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'read_chunk',
    description: 'Read one full cited knowledge-base chunk by source slug and chunk id returned by search_kb/find_clause/find_table.',
    inputSchema: {
      type: 'object',
      properties: {
        sourceSlug: { type: 'string' },
        chunkId: { type: 'string' },
      },
      required: ['sourceSlug', 'chunkId'],
      additionalProperties: false,
    },
  },
  {
    name: 'read_range',
    description: 'Read a line range from the managed indexed source file for exact quotation checks. Use sparingly after search/read_chunk.',
    inputSchema: {
      type: 'object',
      properties: {
        sourceSlug: { type: 'string' },
        startLine: { type: 'number', minimum: 1 },
        endLine: { type: 'number', minimum: 1 },
        contextLines: { type: 'number', minimum: 0, maximum: 20 },
      },
      required: ['sourceSlug', 'startLine', 'endLine'],
      additionalProperties: false,
    },
  },
  {
    name: 'find_clause',
    description: 'Locate a clause/section reference across the knowledge base using deterministic lexical search.',
    inputSchema: {
      type: 'object',
      properties: {
        value: { type: 'string', description: 'Clause or section reference, for example 1101 or Clause 2203(g).' },
        limit: { type: 'number', minimum: 1, maximum: 50 },
        sourceSlugs: { type: 'array', items: { type: 'string' } },
        folder: { type: 'string' },
      },
      required: ['value'],
      additionalProperties: false,
    },
  },
  {
    name: 'find_table',
    description: 'Locate a table heading, BOQ table, schedule, or tabular evidence across the knowledge base.',
    inputSchema: {
      type: 'object',
      properties: {
        value: { type: 'string', description: 'Table title, schedule name, BOQ ref, or header text.' },
        limit: { type: 'number', minimum: 1, maximum: 50 },
        sourceSlugs: { type: 'array', items: { type: 'string' } },
        folder: { type: 'string' },
      },
      required: ['value'],
      additionalProperties: false,
    },
  },
  {
    name: 'citation_audit',
    description: 'Verify that cited sourceSlug/chunkId references exist before final source-backed conclusions are accepted.',
    inputSchema: {
      type: 'object',
      properties: {
        citations: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              sourceSlug: { type: 'string' },
              chunkId: { type: 'string' },
            },
            required: ['sourceSlug', 'chunkId'],
            additionalProperties: false,
          },
        },
        requiredSourceSlugs: { type: 'array', items: { type: 'string' } },
      },
      required: ['citations'],
      additionalProperties: false,
    },
  },
];

function parseCliArgs(argv: string[]): CliArgs {
  const args: CliArgs = {};
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--manifest') {
      args.manifest = argv[++index];
    } else if (arg === '--index-dir') {
      args.indexDir = argv[++index];
    } else if (arg === '--knowledge-base-root') {
      args.knowledgeBaseRoot = argv[++index];
    } else if (arg === '--help' || arg === '-h') {
      process.stdout.write(
        [
          'Usage: file-memory-mcp-server --manifest <path>',
          '   or: file-memory-mcp-server --index-dir <path>',
          '   or: file-memory-mcp-server --knowledge-base-root <path>',
          '',
          'Use --manifest/--index-dir for one file memory source, or --knowledge-base-root for a deterministic collection index.',
          '',
        ].join('\n')
      );
      process.exit(0);
    }
  }
  return args;
}

function textResult(text: string): CallToolResult {
  return {
    content: [{ type: 'text', text }],
  };
}

function errorResult(message: string): CallToolResult {
  return {
    isError: true,
    content: [{ type: 'text', text: message }],
  };
}

async function main(): Promise<void> {
  const cliArgs = parseCliArgs(process.argv.slice(2));
  const knowledgeBaseRoot = cliArgs.knowledgeBaseRoot;
  const manifestPath = knowledgeBaseRoot ? null : resolveManifestPath(cliArgs);
  let manifest: LoadedFileMemoryManifest | null = manifestPath ? loadManifestFromPath(manifestPath) : null;

  const server = new Server(
    {
      name: 'file-memory-mcp-server',
      version: '0.10.6',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: knowledgeBaseRoot ? knowledgeBaseIndexTools : fileMemoryTools,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      const toolName = request.params.name;

      if (knowledgeBaseRoot) {
        if (toolName === 'list_sources') {
          return textResult(formatKnowledgeBaseSources(listKnowledgeBaseSources(knowledgeBaseRoot)));
        }

        if (toolName === 'search_kb') {
          const args = KnowledgeBaseSearchArgsSchema.parse(request.params.arguments ?? {});
          return textResult(formatKnowledgeBaseSearch(searchKnowledgeBase(knowledgeBaseRoot, args)));
        }

        if (toolName === 'read_chunk') {
          const args = KnowledgeBaseReadChunkArgsSchema.parse(request.params.arguments ?? {});
          const result = readKnowledgeBaseChunk(knowledgeBaseRoot, args.sourceSlug, args.chunkId);
          return result ? textResult(result.text) : errorResult(`Chunk not found: ${args.sourceSlug}:${args.chunkId}`);
        }

        if (toolName === 'read_range') {
          const args = KnowledgeBaseReadRangeArgsSchema.parse(request.params.arguments ?? {});
          const result = readKnowledgeBaseRange(knowledgeBaseRoot, args.sourceSlug, args);
          return result
            ? textResult([
                `# Knowledge Base Range`,
                ``,
                `Source: ${result.sourceSlug} / ${result.sourceName}`,
                `Citation: ${result.citation}`,
                ``,
                result.text,
              ].join('\n'))
            : errorResult(`Range not found: ${args.sourceSlug} lines ${args.startLine}-${args.endLine}`);
        }

        if (toolName === 'find_clause') {
          const args = KnowledgeBaseFindArgsSchema.parse(request.params.arguments ?? {});
          return textResult(formatKnowledgeBaseSearch(findKnowledgeBaseClause(knowledgeBaseRoot, args.value, args)));
        }

        if (toolName === 'find_table') {
          const args = KnowledgeBaseFindArgsSchema.parse(request.params.arguments ?? {});
          return textResult(formatKnowledgeBaseSearch(findKnowledgeBaseTable(knowledgeBaseRoot, args.value, args)));
        }

        if (toolName === 'citation_audit') {
          const args = KnowledgeBaseCitationAuditArgsSchema.parse(request.params.arguments ?? {});
          return textResult(JSON.stringify(auditKnowledgeBaseCitations(knowledgeBaseRoot, args), null, 2));
        }

        return errorResult(`Unknown knowledge-base-index tool: ${toolName}`);
      }

      if (toolName === 'get_file_memory_manifest') {
        manifest = loadManifestFromPath(manifestPath!);
        return textResult(formatManifestSummary(manifest));
      }

      if (toolName === 'search_file_memory') {
        const args = SearchArgsSchema.parse(request.params.arguments ?? {});
        manifest = loadManifestFromPath(manifestPath!);
        const results = searchManifest(manifest, args.query, args.limit ?? 5);
        return textResult(formatSearchResults(manifest, args.query, results));
      }

      if (toolName === 'read_file_memory_chunk') {
        const args = ReadChunkArgsSchema.parse(request.params.arguments ?? {});
        manifest = loadManifestFromPath(manifestPath!);
        const chunk = readChunk(manifest, args.chunkId);
        if (!chunk) {
          return errorResult(`Chunk not found: ${args.chunkId}`);
        }
        return textResult(formatChunk(manifest, chunk));
      }

      return errorResult(`Unknown tool: ${toolName}`);
    } catch (err) {
      return errorResult(err instanceof Error ? err.message : String(err));
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  process.stderr.write(`file-memory-mcp-server failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
