import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type { SessionToolContext } from '../context.ts';
import { errorResponse, successResponse } from '../response.ts';
import type { ToolResult } from '../types.ts';

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const MAX_SECTIONS = 128;
const MAX_SECTION_BYTES = 1024 * 1024;

export interface DocumentArtifactSectionInput {
  id: string;
  title: string;
  order: number;
  required?: boolean;
}

export interface DocumentArtifactArgs {
  action: 'init' | 'write_section' | 'status' | 'prepare_merge' | 'assemble' | 'validate';
  artifactId: string;
  outputFile?: string;
  sections?: DocumentArtifactSectionInput[];
  overwrite?: boolean;
  sectionId?: string;
  content?: string;
  requiredStrings?: string[];
}

interface ArtifactSection extends DocumentArtifactSectionInput {
  required: boolean;
  file: string;
  bytes?: number;
  sha256?: string;
  updatedAt?: number;
}

interface ArtifactManifest {
  version: 1;
  artifactId: string;
  outputFile: string;
  phase: 'draft' | 'merge_ready' | 'assembled' | 'validated';
  sections: ArtifactSection[];
  preparedSectionHashes?: Record<string, string>;
  finalPath?: string;
  assembledSha256?: string;
  createdAt: number;
  updatedAt: number;
}

export async function handleDocumentArtifact(
  ctx: SessionToolContext,
  args: DocumentArtifactArgs,
): Promise<ToolResult> {
  try {
    if (!ctx.sessionPath || !ctx.dataPath) {
      return errorResponse('document_artifact requires sessionPath and dataPath in context.');
    }
    if (!SAFE_ID.test(args.artifactId)) {
      return errorResponse('artifactId must contain only letters, numbers, dot, underscore, or hyphen.');
    }

    const artifactDir = join(ctx.dataPath, 'document-artifacts', args.artifactId);
    const manifestPath = join(artifactDir, 'manifest.json');

    switch (args.action) {
      case 'init':
        return initializeArtifact(args, artifactDir, manifestPath);
      case 'write_section':
        return writeArtifactSection(args, artifactDir, manifestPath);
      case 'status':
        return artifactStatus(manifestPath);
      case 'prepare_merge':
        return prepareArtifactMerge(artifactDir, manifestPath);
      case 'assemble':
        return assembleArtifact(ctx, artifactDir, manifestPath);
      case 'validate':
        return validateArtifact(ctx, args, manifestPath);
    }
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : String(error));
  }
}

function initializeArtifact(
  args: DocumentArtifactArgs,
  artifactDir: string,
  manifestPath: string,
): ToolResult {
  if (!args.outputFile || !isSafeMarkdownFileName(args.outputFile)) {
    return errorResponse('outputFile must be a Markdown file name without directory components.');
  }
  const sections = args.sections ?? [];
  if (sections.length > MAX_SECTIONS) {
    return errorResponse(`document_artifact supports at most ${MAX_SECTIONS} sections.`);
  }
  if (existsSync(manifestPath) && !args.overwrite) {
    return errorResponse('Artifact already exists. Pass overwrite=true to replace its manifest.');
  }

  const ids = new Set<string>();
  const normalizedSections: ArtifactSection[] = [];
  for (const section of sections) {
    if (!SAFE_ID.test(section.id) || ids.has(section.id)) {
      return errorResponse(`Invalid or duplicate section ID: ${section.id}`);
    }
    if (!Number.isInteger(section.order) || section.order < 0) {
      return errorResponse(`Section order must be a non-negative integer: ${section.id}`);
    }
    ids.add(section.id);
    normalizedSections.push({
      ...section,
      title: section.title.trim() || section.id,
      required: section.required !== false,
      file: `sections/${String(section.order).padStart(4, '0')}-${section.id}.md`,
    });
  }

  mkdirSync(join(artifactDir, 'sections'), { recursive: true });
  const now = Date.now();
  const manifest: ArtifactManifest = {
    version: 1,
    artifactId: args.artifactId,
    outputFile: args.outputFile,
    phase: 'draft',
    sections: normalizedSections.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id)),
    createdAt: now,
    updatedAt: now,
  };
  atomicWriteJson(manifestPath, manifest);
  return successJson({ artifactId: manifest.artifactId, phase: manifest.phase, manifestPath });
}

function writeArtifactSection(
  args: DocumentArtifactArgs,
  artifactDir: string,
  manifestPath: string,
): ToolResult {
  const manifest = readManifest(manifestPath);
  if (!args.sectionId || typeof args.content !== 'string') {
    return errorResponse('write_section requires sectionId and content.');
  }
  const section = manifest.sections.find(item => item.id === args.sectionId);
  if (!section) return errorResponse(`Unknown section: ${args.sectionId}`);
  if (!args.content.trim()) return errorResponse(`Section ${args.sectionId} must not be empty.`);

  const bytes = Buffer.byteLength(args.content, 'utf-8');
  if (bytes > MAX_SECTION_BYTES) {
    return errorResponse(`Section exceeds the ${MAX_SECTION_BYTES} byte limit. Split it into smaller declared sections.`);
  }

  const content = normalizeSectionContent(args.content);
  const sectionPath = join(artifactDir, section.file);
  atomicWriteText(sectionPath, content);
  section.bytes = Buffer.byteLength(content, 'utf-8');
  section.sha256 = hash(content);
  section.updatedAt = Date.now();
  manifest.phase = 'draft';
  delete manifest.preparedSectionHashes;
  delete manifest.finalPath;
  delete manifest.assembledSha256;
  manifest.updatedAt = Date.now();
  atomicWriteJson(manifestPath, manifest);
  return successJson({ artifactId: manifest.artifactId, sectionId: section.id, bytes: section.bytes, sha256: section.sha256 });
}

function artifactStatus(manifestPath: string): ToolResult {
  const manifest = readManifest(manifestPath);
  const missingRequiredSections = manifest.sections
    .filter(section => section.required && !section.sha256)
    .map(section => section.id);
  return successJson({
    artifactId: manifest.artifactId,
    phase: manifest.phase,
    outputFile: manifest.outputFile,
    writtenSections: manifest.sections.filter(section => Boolean(section.sha256)).length,
    totalSections: manifest.sections.length,
    missingRequiredSections,
    finalPath: manifest.finalPath,
  });
}

function prepareArtifactMerge(artifactDir: string, manifestPath: string): ToolResult {
  const manifest = readManifest(manifestPath);
  const missing: string[] = [];
  const preparedSectionHashes: Record<string, string> = {};

  for (const section of manifest.sections) {
    const sectionPath = join(artifactDir, section.file);
    if (!existsSync(sectionPath) || statSync(sectionPath).size === 0) {
      if (section.required) missing.push(section.id);
      continue;
    }
    const content = readFileSync(sectionPath, 'utf-8');
    const currentHash = hash(content);
    if (section.sha256 !== currentHash) {
      return errorResponse(`Section ${section.id} changed outside document_artifact. Write it again before prepare_merge.`);
    }
    preparedSectionHashes[section.id] = currentHash;
  }

  if (missing.length > 0) {
    return errorResponse(`Required sections are missing or empty: ${missing.join(', ')}`);
  }
  if (Object.keys(preparedSectionHashes).length === 0) {
    return errorResponse('Artifact requires at least one non-empty section before prepare_merge.');
  }

  manifest.phase = 'merge_ready';
  manifest.preparedSectionHashes = preparedSectionHashes;
  manifest.updatedAt = Date.now();
  atomicWriteJson(manifestPath, manifest);
  return successJson({ artifactId: manifest.artifactId, phase: manifest.phase, preparedSections: Object.keys(preparedSectionHashes) });
}

function assembleArtifact(
  ctx: SessionToolContext,
  artifactDir: string,
  manifestPath: string,
): ToolResult {
  const manifest = readManifest(manifestPath);
  if (manifest.phase !== 'merge_ready' || !manifest.preparedSectionHashes) {
    return errorResponse('Artifact is not merge-ready. Complete required sections and run prepare_merge again.');
  }

  const parts: string[] = [];
  for (const section of manifest.sections) {
    const expectedHash = manifest.preparedSectionHashes[section.id];
    if (!expectedHash) continue;
    const sectionPath = join(artifactDir, section.file);
    const content = existsSync(sectionPath) ? readFileSync(sectionPath, 'utf-8') : '';
    if (!content || hash(content) !== expectedHash) {
      return errorResponse(`Section ${section.id} changed after prepare_merge. Run prepare_merge again.`);
    }
    parts.push(content.trimEnd());
  }

  const outputDir = resolveFormalOutputDirectory(ctx);
  mkdirSync(outputDir, { recursive: true });
  const finalPath = join(outputDir, manifest.outputFile);
  const finalContent = `${parts.join('\n\n')}\n`;
  atomicWriteText(finalPath, finalContent);
  manifest.phase = 'assembled';
  manifest.finalPath = finalPath;
  manifest.assembledSha256 = hash(finalContent);
  manifest.updatedAt = Date.now();
  atomicWriteJson(manifestPath, manifest);
  return successJson({ artifactId: manifest.artifactId, phase: manifest.phase, finalPath, bytes: statSync(finalPath).size });
}

function validateArtifact(ctx: SessionToolContext, args: DocumentArtifactArgs, manifestPath: string): ToolResult {
  const manifest = readManifest(manifestPath);
  const expectedFinalPath = join(resolveFormalOutputDirectory(ctx), manifest.outputFile);
  if (manifest.finalPath !== expectedFinalPath) {
    return errorResponse('Artifact manifest finalPath does not match the formal output directory. Run assemble again.');
  }
  if (!existsSync(expectedFinalPath)) {
    return errorResponse('Assembled artifact file does not exist.');
  }
  const content = readFileSync(expectedFinalPath, 'utf-8');
  if (!content.trim() || !manifest.assembledSha256 || hash(content) !== manifest.assembledSha256) {
    return errorResponse('Final artifact changed after assembly. Run prepare_merge and assemble again.');
  }
  const requiredStrings = (args.requiredStrings ?? []).map(value => value.trim()).filter(Boolean);
  const missingStrings = requiredStrings.filter(value => !content.includes(value));
  if (missingStrings.length > 0) {
    return errorResponse(`Artifact validation failed. Missing required text: ${missingStrings.join(' | ')}`);
  }

  manifest.phase = 'validated';
  manifest.updatedAt = Date.now();
  atomicWriteJson(manifestPath, manifest);
  return successJson({
    artifactId: manifest.artifactId,
    phase: manifest.phase,
    valid: true,
    finalPath: manifest.finalPath,
    bytes: Buffer.byteLength(content, 'utf-8'),
    requiredStringsChecked: requiredStrings.length,
  });
}

function readManifest(manifestPath: string): ArtifactManifest {
  if (!existsSync(manifestPath)) throw new Error('Artifact is not initialized. Call document_artifact with action=init first.');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as ArtifactManifest;
  if (
    manifest.version !== 1
    || !SAFE_ID.test(manifest.artifactId)
    || !isSafeMarkdownFileName(manifest.outputFile)
    || !Array.isArray(manifest.sections)
    || manifest.sections.length > MAX_SECTIONS
  ) {
    throw new Error('Artifact manifest is invalid.');
  }

  const sectionIds = new Set<string>();
  for (const section of manifest.sections) {
    const expectedFile = SAFE_ID.test(section.id) && Number.isInteger(section.order) && section.order >= 0
      ? `sections/${String(section.order).padStart(4, '0')}-${section.id}.md`
      : undefined;
    if (!expectedFile || sectionIds.has(section.id) || section.file !== expectedFile) {
      throw new Error('Artifact manifest is invalid.');
    }
    sectionIds.add(section.id);
  }
  return manifest;
}

function resolveFormalOutputDirectory(ctx: SessionToolContext): string {
  const workingDirectory = ctx.workingDirectory ?? ctx.getSessionInfo?.(ctx.sessionId)?.workingDirectory;
  if (workingDirectory) return join(workingDirectory, 'Agent Pi Outputs', ctx.sessionId);
  return join(ctx.sessionPath!, 'outputs');
}

function normalizeSectionContent(content: string): string {
  return `${content.replace(/\r\n/g, '\n').trimEnd()}\n`;
}

function isSafeMarkdownFileName(fileName: string): boolean {
  return basename(fileName) === fileName && fileName.toLowerCase().endsWith('.md') && !fileName.includes('/') && !fileName.includes('\\');
}

function hash(content: string): string {
  return createHash('sha256').update(content, 'utf-8').digest('hex');
}

function atomicWriteJson(filePath: string, value: unknown): void {
  atomicWriteText(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function atomicWriteText(filePath: string, content: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tempPath, content, 'utf-8');
  renameSync(tempPath, filePath);
}

function successJson(value: unknown): ToolResult {
  return successResponse(JSON.stringify(value, null, 2));
}
