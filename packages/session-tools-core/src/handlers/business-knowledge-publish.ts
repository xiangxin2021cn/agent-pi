import { resolve } from 'node:path';
import type { SessionToolContext } from '../context.ts';
import { publishBusinessKnowledgeArtifact, toBusinessEvidenceSnapshot, type BusinessPluginId } from '../knowledge-base-business-publication.ts';
import { errorResponse, successResponse } from '../response.ts';
import { isPathWithinDirectory } from '../runtime/path-security.ts';

export interface BusinessKnowledgePublishArgs {
  artifactPath: string;
  publicationId: string;
  producerPlugin: BusinessPluginId;
  producerWorkspaceId: string;
  producerRevision: number;
  title: string;
  category: string;
  approvalState: 'approved';
  userConfirmed: true;
  snapshotId: string;
}

export async function handleBusinessKnowledgePublish(ctx: SessionToolContext, args: BusinessKnowledgePublishArgs) {
  try {
    if (!ctx.workingDirectory) return errorResponse('business_knowledge_publish requires an explicit session working directory.');
    if (!ctx.knowledgeBaseRegistryRootPath) return errorResponse('business_knowledge_publish requires the global knowledge base registry root.');
    const artifactPath = resolve(ctx.workingDirectory, args.artifactPath);
    if (!isPathWithinDirectory(artifactPath, ctx.workingDirectory)) return errorResponse('artifactPath must be an explicit file inside the session working directory.');
    const publishedAt = new Date().toISOString();
    const publication = publishBusinessKnowledgeArtifact(ctx.knowledgeBaseRegistryRootPath, artifactPath, {
      publicationId: args.publicationId, producerPlugin: args.producerPlugin,
      producerWorkspaceId: args.producerWorkspaceId, producerRevision: args.producerRevision,
      title: args.title, category: args.category, approvalState: args.approvalState,
      userConfirmed: args.userConfirmed, publishedAt,
    });
    const snapshot = toBusinessEvidenceSnapshot(publication, args.snapshotId, publishedAt);
    return successResponse(JSON.stringify({ publication, snapshot }, null, 2));
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : String(error));
  }
}
