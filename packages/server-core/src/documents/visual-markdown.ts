import { relative } from 'node:path';

export type VisualMarkdownInput =
  | {
      kind: 'mermaid';
      title: string;
      mermaid: string;
      caption: string;
      source: string;
      auditReason: string;
    }
  | {
      kind: 'svg';
      title: string;
      assetPath: string;
      outputDir?: string;
      caption: string;
      source: string;
      auditReason: string;
    }
  | {
      kind: 'table';
      title: string;
      tableMarkdown: string;
      rawSidecarPath?: string;
      caption: string;
      source: string;
      auditReason: string;
    };

export interface VisualManifestEntry {
  kind: VisualMarkdownInput['kind'];
  title: string;
  caption: string;
  source: string;
  auditReason: string;
  relativePath?: string;
  rawSidecarPath?: string;
}

export interface VisualMarkdownResult {
  markdown: string;
  manifest: VisualManifestEntry[];
}

export function renderVisualMarkdownBlock(input: VisualMarkdownInput): VisualMarkdownResult {
  const manifestEntry: VisualManifestEntry = {
    kind: input.kind,
    title: input.title,
    caption: input.caption,
    source: input.source,
    auditReason: input.auditReason,
  };

  if (input.kind === 'mermaid') {
    return {
      markdown: [
        `#### ${input.title}`,
        '',
        '```mermaid',
        input.mermaid.trim(),
        '```',
        '',
        formatNotes(input.caption, input.source),
      ].join('\n'),
      manifest: [manifestEntry],
    };
  }

  if (input.kind === 'svg') {
    const relativePath = toRelativeAssetPath(input.assetPath, input.outputDir);
    manifestEntry.relativePath = relativePath;
    return {
      markdown: [
        `#### ${input.title}`,
        '',
        `![${input.caption}](${relativePath})`,
        '',
        formatNotes(input.caption, input.source),
      ].join('\n'),
      manifest: [manifestEntry],
    };
  }

  manifestEntry.rawSidecarPath = input.rawSidecarPath;
  return {
    markdown: [
      `#### ${input.title}`,
      '',
      input.tableMarkdown.trim(),
      '',
      formatNotes(input.caption, input.source, input.rawSidecarPath),
    ].join('\n'),
    manifest: [manifestEntry],
  };
}

function formatNotes(caption: string, source: string, rawSidecarPath?: string): string {
  return [
    `> ${caption}`,
    `> Source: ${source}.`,
    ...(rawSidecarPath ? [`> Raw table: \`${rawSidecarPath}\`.`] : []),
  ].join('\n');
}

function toRelativeAssetPath(assetPath: string, outputDir: string | undefined): string {
  if (!outputDir) return normalizePath(assetPath);
  const relativePath = relative(outputDir, assetPath);
  return normalizePath(relativePath.startsWith('..') ? assetPath : relativePath);
}

function normalizePath(path: string): string {
  return path.replaceAll('\\', '/');
}
