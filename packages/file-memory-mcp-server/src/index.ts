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

interface CliArgs {
  manifest?: string;
  indexDir?: string;
}

const SearchArgsSchema = z.object({
  query: z.string().min(1),
  limit: z.number().int().min(1).max(20).optional(),
});

const ReadChunkArgsSchema = z.object({
  chunkId: z.string().min(1),
});

const tools: Tool[] = [
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

function parseCliArgs(argv: string[]): CliArgs {
  const args: CliArgs = {};
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--manifest') {
      args.manifest = argv[++index];
    } else if (arg === '--index-dir') {
      args.indexDir = argv[++index];
    } else if (arg === '--help' || arg === '-h') {
      process.stdout.write(
        [
          'Usage: file-memory-mcp-server --manifest <path>',
          '   or: file-memory-mcp-server --index-dir <path>',
          '',
          'The manifest must contain indexed chunks for one file memory source.',
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
  const manifestPath = resolveManifestPath(parseCliArgs(process.argv.slice(2)));
  let manifest: LoadedFileMemoryManifest = loadManifestFromPath(manifestPath);

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

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      const toolName = request.params.name;

      if (toolName === 'get_file_memory_manifest') {
        manifest = loadManifestFromPath(manifestPath);
        return textResult(formatManifestSummary(manifest));
      }

      if (toolName === 'search_file_memory') {
        const args = SearchArgsSchema.parse(request.params.arguments ?? {});
        manifest = loadManifestFromPath(manifestPath);
        const results = searchManifest(manifest, args.query, args.limit ?? 5);
        return textResult(formatSearchResults(manifest, args.query, results));
      }

      if (toolName === 'read_file_memory_chunk') {
        const args = ReadChunkArgsSchema.parse(request.params.arguments ?? {});
        manifest = loadManifestFromPath(manifestPath);
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
