import { randomUUID } from 'crypto';
import type { FolderSourceConfig, SourceGuide } from './types.ts';
import {
  loadSourceConfig,
  saveSourceConfig,
  saveSourceGuide,
  sourceExists,
} from './storage.ts';

export const ANYSEARCH_SOURCE_ID = 'anysearch-mcp' as const;
export const ANYSEARCH_SOURCE_SLUG = 'anysearch-mcp' as const;
export const ANYSEARCH_MCP_URL = 'https://api.anysearch.com/mcp' as const;
export const ANYSEARCH_DOCS_URL = 'https://www.anysearch.com/docs#search-api' as const;
export const ANYSEARCH_API_KEYS_URL = 'https://anysearch.com/console/api-keys' as const;

export type RecommendedSourceId = typeof ANYSEARCH_SOURCE_ID;

export interface RecommendedSourceTemplate {
  id: RecommendedSourceId;
  slug: string;
  name: string;
  provider: string;
  description: string;
  docsUrl: string;
  credentialUrl: string;
  config: FolderSourceConfig;
  guide: SourceGuide;
}

export function getRecommendedSourceTemplates(): RecommendedSourceTemplate[] {
  return [getAnySearchMcpTemplate()];
}

export function getRecommendedSourceTemplate(id: RecommendedSourceId): RecommendedSourceTemplate {
  switch (id) {
    case ANYSEARCH_SOURCE_ID:
      return getAnySearchMcpTemplate();
  }
}

export async function installRecommendedSource(
  workspaceRootPath: string,
  id: RecommendedSourceId,
): Promise<FolderSourceConfig> {
  const template = getRecommendedSourceTemplate(id);

  if (sourceExists(workspaceRootPath, template.slug)) {
    const existing = loadSourceConfig(workspaceRootPath, template.slug);
    if (!existing) {
      throw new Error(`Recommended source '${template.slug}' exists but could not be loaded`);
    }
    return existing;
  }

  saveSourceConfig(workspaceRootPath, {
    ...template.config,
    id: `${template.slug}_${randomUUID().slice(0, 8)}`,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  saveSourceGuide(workspaceRootPath, template.slug, template.guide);

  const saved = loadSourceConfig(workspaceRootPath, template.slug);
  if (!saved) {
    throw new Error(`Failed to install recommended source '${template.slug}'`);
  }
  return saved;
}

function getAnySearchMcpTemplate(): RecommendedSourceTemplate {
  const config: FolderSourceConfig = {
    id: `${ANYSEARCH_SOURCE_SLUG}_template`,
    name: 'AnySearch MCP',
    slug: ANYSEARCH_SOURCE_SLUG,
    enabled: false,
    provider: 'anysearch',
    type: 'mcp',
    mcp: {
      transport: 'http',
      url: ANYSEARCH_MCP_URL,
      authType: 'bearer',
    },
    tagline: 'Search API and MCP connector for web research',
    isAuthenticated: false,
    connectionStatus: 'needs_auth',
    connectionError: `Enter an AnySearch API key from ${ANYSEARCH_API_KEYS_URL} before enabling this source.`,
  };

  const guide: SourceGuide = {
    raw: `# AnySearch MCP

AnySearch MCP provides web search, vertical search, batch search, and full-page extraction through the AnySearch remote MCP endpoint.

## Scope

- Use for external web research and citation/source verification after the user enables this source.
- Do not use for project-local questions unless external verification is requested.
- Do not call this source when the user asks to avoid external search.

## Authentication

This recommended source is installed disabled by default. The app must ask the user for an API key before enabling authenticated AnySearch MCP.

- MCP endpoint: ${ANYSEARCH_MCP_URL}
- API docs: ${ANYSEARCH_DOCS_URL}
- API key console: ${ANYSEARCH_API_KEYS_URL}

If anonymous mode is offered later, it must be an explicit user choice and must not happen as a silent fallback from a missing, invalid, or expired API key.
`,
  };

  return {
    id: ANYSEARCH_SOURCE_ID,
    slug: ANYSEARCH_SOURCE_SLUG,
    name: config.name,
    provider: config.provider,
    description: config.tagline ?? '',
    docsUrl: ANYSEARCH_DOCS_URL,
    credentialUrl: ANYSEARCH_API_KEYS_URL,
    config,
    guide,
  };
}
