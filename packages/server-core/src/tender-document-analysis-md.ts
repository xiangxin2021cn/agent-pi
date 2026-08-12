import { copyFileSync, existsSync, mkdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type { TenderDocumentAnalysisData, TenderDocumentAnalysisSection } from '@agent-pi/business-core/tender';
import type { TenderDocumentAnalysisBatchManifest } from './tender-document-batches.ts';

export interface DocumentAnalysisMarkdownMeta {
  projectId: string;
  parentSessionId: string;
  workingDirectory: string;
  manifest: TenderDocumentAnalysisBatchManifest;
  generatedAt?: string;
}

export interface PublishDocumentAnalysisArtifactsResult {
  directory: string;
  published: number;
  skipped: number;
}

/**
 * Build a human-readable Markdown summary of merged document analysis.
 * Written under Agent Pi Outputs/<parentSessionId>/.
 */
export function formatDocumentAnalysisMarkdown(
  data: TenderDocumentAnalysisData,
  meta: DocumentAnalysisMarkdownMeta,
): string {
  const generatedAt = meta.generatedAt ?? new Date().toISOString();
  const byDocument = new Map<string, TenderDocumentAnalysisSection[]>();
  for (const section of data.sections) {
    const list = byDocument.get(section.documentId) ?? [];
    list.push(section);
    byDocument.set(section.documentId, list);
  }

  const documentNameById = new Map(
    meta.manifest.batches.map((batch) => {
      // Prefer brief scope name when available via source path basename
      const name = batch.sourcePath.replace(/\\/g, '/').split('/').pop() || batch.documentId;
      return [batch.documentId, name] as const;
    }),
  );

  const lines: string[] = [
    '# Document Analysis Summary',
    '',
    `- Project: \`${meta.projectId}\``,
    `- Parent session: \`${meta.parentSessionId}\``,
    `- Generated: ${generatedAt}`,
    `- Documents: ${byDocument.size}`,
    `- Sections: ${data.sections.length}`,
    `- Batches complete: ${meta.manifest.completedBatches}/${meta.manifest.batchCount}`,
    '',
    'This file is a readable projection of the authoritative pack at',
    '`.agent-pi/business/tender/<projectId>/packs/document-analysis.json`.',
    '',
    'Per-document customer Markdown deliverables are published under',
    '`Agent Pi Outputs/<parentSessionId>/document-analysis/`.',
    '',
  ];

  for (const [documentId, sections] of byDocument) {
    const title = documentNameById.get(documentId) ?? documentId;
    lines.push(`## ${title}`);
    lines.push('');
    lines.push(`- documentId: \`${documentId}\``);
    lines.push(`- sections: ${sections.length}`);
    lines.push('');
    for (const section of sections) {
      lines.push(`### ${section.title}`);
      lines.push('');
      lines.push(`- id: \`${section.id}\``);
      lines.push(`- kind: \`${section.kind}\``);
      lines.push(`- status: \`${section.status}\``);
      lines.push('');
      lines.push(section.summary.trim() || '_(empty summary)_');
      lines.push('');
      if (section.sourceRefs.length > 0) {
        lines.push('Source refs:');
        for (const ref of section.sourceRefs) {
          const parts = [
            `documentId=${ref.documentId}`,
            ref.page != null ? `page=${ref.page}` : null,
            ref.sheet ? `sheet=${ref.sheet}` : null,
            ref.clause ? `clause=${ref.clause}` : null,
            ref.section ? `section=${ref.section}` : null,
          ].filter(Boolean);
          lines.push(`- ${parts.join(', ')}`);
        }
        lines.push('');
      }
    }
  }

  return `${lines.join('\n').trimEnd()}\n`;
}

export function writeDocumentAnalysisSummaryMarkdown(
  data: TenderDocumentAnalysisData,
  meta: DocumentAnalysisMarkdownMeta,
): string {
  const outputDirectory = join(meta.workingDirectory, 'Agent Pi Outputs', meta.parentSessionId);
  const outputPath = join(outputDirectory, 'document-analysis-summary.md');
  const markdown = formatDocumentAnalysisMarkdown(data, meta);
  mkdirSync(dirname(outputPath), { recursive: true });
  const temporary = `${outputPath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporary, markdown, 'utf8');
  renameSync(temporary, outputPath);
  return outputPath;
}

/**
 * Mirror completed per-document analysis Markdown into the parent session's
 * Official Outputs tree (`Agent Pi Outputs/<parentSessionId>/document-analysis/`).
 * Project-scoped paths remain the child-agent write targets; this publish step
 * is what the Session Files 「正式输出」 panel lists.
 */
export function publishDocumentAnalysisArtifactsToOfficialOutputs(
  workingDirectory: string,
  parentSessionId: string,
  manifest: TenderDocumentAnalysisBatchManifest,
): PublishDocumentAnalysisArtifactsResult {
  const directory = join(workingDirectory, 'Agent Pi Outputs', parentSessionId, 'document-analysis');
  mkdirSync(directory, { recursive: true });
  let published = 0;
  let skipped = 0;
  for (const batch of manifest.batches) {
    if (batch.status !== 'complete') {
      skipped += 1;
      continue;
    }
    const sourcePath = batch.markdownPath;
    if (!sourcePath || !existsSync(sourcePath)) {
      skipped += 1;
      continue;
    }
    const destinationPath = join(directory, basename(sourcePath));
    try {
      if (existsSync(destinationPath)) {
        const sourceStat = statSync(sourcePath);
        const destStat = statSync(destinationPath);
        if (destStat.mtimeMs >= sourceStat.mtimeMs && destStat.size === sourceStat.size) {
          skipped += 1;
          continue;
        }
      }
      copyFileSync(sourcePath, destinationPath);
      published += 1;
    } catch {
      skipped += 1;
    }
  }
  return { directory, published, skipped };
}
