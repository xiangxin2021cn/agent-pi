import type { SessionGoalState } from '@craft-agent/shared/sessions'
import { normalizePathForComparison } from '@craft-agent/shared/utils'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import type { Dirent } from 'node:fs'
import { basename, join } from 'node:path'

interface DocumentArtifactManifest {
  version: 1
  artifactId: string
  outputFile: string
  phase: string
  finalPath?: string
  assembledSha256?: string
}

export interface DocumentArtifactReadinessInput {
  goalState: SessionGoalState
  sessionPath: string
  expectedOutputDirectory: string
  currentOutputPaths: string[]
}

export interface DocumentArtifactReadinessResult {
  required: boolean
  ready: boolean
  artifactId?: string
  finalPath?: string
  reason?: string
}

export function verifyDocumentArtifactReadiness(
  input: DocumentArtifactReadinessInput,
): DocumentArtifactReadinessResult {
  if (!requiresValidatedMarkdownArtifact(input.goalState)) {
    return { required: false, ready: true }
  }

  const currentOutputPaths = new Set(input.currentOutputPaths.map(normalizePathForComparison))
  if (currentOutputPaths.size === 0) {
    return missingArtifactResult()
  }

  const artifactsRoot = join(input.sessionPath, 'data', 'document-artifacts')
  if (!existsSync(artifactsRoot)) {
    return missingArtifactResult()
  }

  let lastReason = 'No validated document artifact matched the formal output directory.'
  let entries: Dirent[]
  try {
    entries = readdirSync(artifactsRoot, { withFileTypes: true, encoding: 'utf-8' })
  } catch {
    return { required: true, ready: false, reason: 'Document artifact manifests could not be listed.' }
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const manifestPath = join(artifactsRoot, entry.name, 'manifest.json')
    if (!existsSync(manifestPath)) continue

    try {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as DocumentArtifactManifest
      if (manifest.version !== 1 || manifest.phase !== 'validated') continue
      if (!manifest.outputFile || basename(manifest.outputFile) !== manifest.outputFile || !manifest.outputFile.toLowerCase().endsWith('.md')) {
        lastReason = 'Validated document artifact has an invalid output file name.'
        continue
      }

      const expectedFinalPath = join(input.expectedOutputDirectory, manifest.outputFile)
      const comparableExpectedFinalPath = normalizePathForComparison(expectedFinalPath)
      if (!manifest.finalPath || normalizePathForComparison(manifest.finalPath) !== comparableExpectedFinalPath) {
        lastReason = 'Validated document artifact is outside the formal output directory.'
        continue
      }
      if (!currentOutputPaths.has(comparableExpectedFinalPath)) {
        lastReason = 'Validated document artifact does not match a verified output from the current turn.'
        continue
      }
      if (!existsSync(expectedFinalPath) || !statSync(expectedFinalPath).isFile() || statSync(expectedFinalPath).size === 0) {
        lastReason = 'Validated document artifact is missing or empty.'
        continue
      }

      const content = readFileSync(expectedFinalPath)
      const currentHash = createHash('sha256').update(content).digest('hex')
      if (!manifest.assembledSha256 || currentHash !== manifest.assembledSha256) {
        lastReason = 'Validated document artifact hash no longer matches the final file.'
        continue
      }

      return {
        required: true,
        ready: true,
        artifactId: manifest.artifactId,
        finalPath: expectedFinalPath,
      }
    } catch {
      lastReason = 'Validated document artifact manifest could not be read.'
    }
  }

  return { required: true, ready: false, reason: lastReason }
}

function requiresValidatedMarkdownArtifact(goalState: SessionGoalState): boolean {
  const contract = goalState.taskContract
  if (!contract || !contract.documentQualityMode || contract.documentQualityMode === 'native_quick' || contract.documentQualityMode === 'quick') return false
  return contract.outputFormats.some(format => {
    const normalized = format.trim().toLowerCase()
    return normalized === 'md' || normalized === 'markdown'
  })
}

function missingArtifactResult(): DocumentArtifactReadinessResult {
  return {
    required: true,
    ready: false,
    reason: 'A validated document artifact is required before merge and completion.',
  }
}
