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
 * Build a project-level professional synopsis of merged document analysis.
 * Avoid pack-path tutorials and meta dumps — body is bid-facing.
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
      const name = batch.sourcePath.replace(/\\/g, '/').split('/').pop() || batch.documentId;
      return [batch.documentId, name] as const;
    }),
  );

  const lines: string[] = [
    '# 招标文件解析纪要',
    '',
    `项目 \`${meta.projectId}\` · 已覆盖 ${byDocument.size} 份资料 · ${data.sections.length} 个要点 · ${generatedAt.slice(0, 10)}`,
    '',
    '本稿供估价 / 技术 / 商务阅读：硬约束、组价与施工含义、风险与待澄清项。逐文件正文见同期发布的分册 Markdown。',
    '',
  ];

  for (const [documentId, sections] of byDocument) {
    const title = documentNameById.get(documentId) ?? documentId;
    lines.push(`## ${title}`);
    lines.push('');

    const reviewed = sections.filter((section) => section.status === 'reviewed' || section.status === 'accepted');
    const blocked = sections.filter((section) => section.status === 'blocked' || section.status === 'rejected');
    if (blocked.length > 0) {
      lines.push(`- 待处理 / 受阻要点：${blocked.length}`);
    }
    if (reviewed.length > 0 && reviewed.length !== sections.length) {
      lines.push(`- 已整理要点：${reviewed.length}/${sections.length}`);
    }
    if (blocked.length > 0 || (reviewed.length > 0 && reviewed.length !== sections.length)) {
      lines.push('');
    }

    for (const section of sections) {
      lines.push(`### ${section.title}`);
      lines.push('');
      lines.push(section.summary.trim() || '_（无摘要）_');
      lines.push('');

      const usefulRefs = section.sourceRefs.filter((ref) =>
        ref.page != null || Boolean(ref.sheet) || Boolean(ref.clause) || Boolean(ref.section),
      );
      if (usefulRefs.length > 0) {
        lines.push('定位：');
        for (const ref of usefulRefs) {
          const parts = [
            ref.page != null ? `p.${ref.page}` : null,
            ref.sheet ? `sheet ${ref.sheet}` : null,
            ref.clause ? `clause ${ref.clause}` : null,
            ref.section ? `§ ${ref.section}` : null,
          ].filter(Boolean);
          lines.push(`- ${parts.join(' · ')}`);
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
