import { afterEach, describe, expect, it } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SessionGoalState } from '@craft-agent/shared/sessions'
import { verifyDocumentArtifactReadiness } from './document-artifact-readiness'

const tempPaths: string[] = []

afterEach(() => {
  for (const path of tempPaths.splice(0)) rmSync(path, { recursive: true, force: true })
})

describe('document artifact readiness', () => {
  it('blocks professional Markdown completion until a validated artifact exists', () => {
    const root = makeTempRoot()
    const result = verifyDocumentArtifactReadiness({
      goalState: makeGoalState('professional_document'),
      sessionPath: join(root, 'session'),
      expectedOutputDirectory: join(root, 'outputs'),
      currentOutputPaths: [],
    })

    expect(result.required).toBe(true)
    expect(result.ready).toBe(false)
    expect(result.reason).toContain('validated document artifact')
  })

  it('accepts only a validated non-empty artifact with a matching hash in the formal output directory', () => {
    const root = makeTempRoot()
    const sessionPath = join(root, 'session')
    const expectedOutputDirectory = join(root, 'outputs')
    const finalPath = join(expectedOutputDirectory, 'final.md')
    const content = '# Final\n\nVerified report.\n'
    mkdirSync(expectedOutputDirectory, { recursive: true })
    writeFileSync(finalPath, content, 'utf-8')
    writeManifest(sessionPath, {
      version: 1,
      artifactId: 'final-report',
      outputFile: 'final.md',
      phase: 'validated',
      sections: [],
      finalPath,
      assembledSha256: sha256(content),
      createdAt: 1,
      updatedAt: 2,
    })

    const result = verifyDocumentArtifactReadiness({
      goalState: makeGoalState('strict_delivery'),
      sessionPath,
      expectedOutputDirectory,
      currentOutputPaths: [finalPath],
    })

    expect(result).toEqual({
      required: true,
      ready: true,
      artifactId: 'final-report',
      finalPath,
    })
  })

  it('treats Windows output path casing as the same current-turn artifact', () => {
    if (process.platform !== 'win32') return

    const root = makeTempRoot()
    const sessionPath = join(root, 'session')
    const expectedOutputDirectory = join(root, 'outputs')
    const finalPath = join(expectedOutputDirectory, 'final.md')
    const content = '# Final\n\nVerified report.\n'
    mkdirSync(expectedOutputDirectory, { recursive: true })
    writeFileSync(finalPath, content, 'utf-8')
    writeManifest(sessionPath, {
      version: 1,
      artifactId: 'final-report',
      outputFile: 'final.md',
      phase: 'validated',
      sections: [],
      finalPath: finalPath.toUpperCase(),
      assembledSha256: sha256(content),
      createdAt: 1,
      updatedAt: 2,
    })

    const result = verifyDocumentArtifactReadiness({
      goalState: makeGoalState('professional_document'),
      sessionPath,
      expectedOutputDirectory,
      currentOutputPaths: [finalPath.toUpperCase()],
    })

    expect(result.ready).toBe(true)
    expect(result.finalPath).toBe(finalPath)
  })

  it('rejects a validated manifest when the final artifact changes afterward', () => {
    const root = makeTempRoot()
    const sessionPath = join(root, 'session')
    const expectedOutputDirectory = join(root, 'outputs')
    const finalPath = join(expectedOutputDirectory, 'final.md')
    mkdirSync(expectedOutputDirectory, { recursive: true })
    writeFileSync(finalPath, '# Changed\n', 'utf-8')
    writeManifest(sessionPath, {
      version: 1,
      artifactId: 'final-report',
      outputFile: 'final.md',
      phase: 'validated',
      sections: [],
      finalPath,
      assembledSha256: sha256('# Original\n'),
      createdAt: 1,
      updatedAt: 2,
    })

    const result = verifyDocumentArtifactReadiness({
      goalState: makeGoalState('multi_agent_deep'),
      sessionPath,
      expectedOutputDirectory,
      currentOutputPaths: [finalPath],
    })

    expect(result.ready).toBe(false)
    expect(result.reason).toContain('hash')
  })

  it('rejects a validated artifact from an earlier turn when it is not the current verified output', () => {
    const root = makeTempRoot()
    const sessionPath = join(root, 'session')
    const expectedOutputDirectory = join(root, 'outputs')
    const staleFinalPath = join(expectedOutputDirectory, 'earlier-report.md')
    const currentFinalPath = join(expectedOutputDirectory, 'current-report.md')
    const content = '# Earlier report\n\nThis belongs to a previous turn.\n'
    mkdirSync(expectedOutputDirectory, { recursive: true })
    writeFileSync(staleFinalPath, content, 'utf-8')
    writeManifest(sessionPath, {
      version: 1,
      artifactId: 'final-report',
      outputFile: 'earlier-report.md',
      phase: 'validated',
      sections: [],
      finalPath: staleFinalPath,
      assembledSha256: sha256(content),
      createdAt: 1,
      updatedAt: 2,
    })

    const result = verifyDocumentArtifactReadiness({
      goalState: makeGoalState('professional_document'),
      sessionPath,
      expectedOutputDirectory,
      currentOutputPaths: [currentFinalPath],
    })

    expect(result.ready).toBe(false)
    expect(result.reason).toContain('current turn')
  })

  it('does not require transactional Markdown assembly in quick mode', () => {
    const root = makeTempRoot()
    const result = verifyDocumentArtifactReadiness({
      goalState: makeGoalState('quick'),
      sessionPath: join(root, 'session'),
      expectedOutputDirectory: join(root, 'outputs'),
      currentOutputPaths: [],
    })

    expect(result).toEqual({ required: false, ready: true })
  })
})

function makeTempRoot(): string {
  const path = mkdtempSync(join(tmpdir(), 'agent-pi-artifact-ready-'))
  tempPaths.push(path)
  return path
}

function makeGoalState(mode: 'quick' | 'professional_document' | 'strict_delivery' | 'multi_agent_deep'): SessionGoalState {
  return {
    id: 'goal-1',
    mode: 'check_only',
    status: 'running',
    objective: 'Create the final report.',
    createdAt: 1,
    updatedAt: 1,
    iteration: 0,
    maxIterations: 2,
    criteria: [],
    auditHistory: [],
    taskContract: {
      originalRequest: 'Create the final report.',
      taskType: 'document',
      documentQualityMode: mode,
      deliverables: ['Final report'],
      mustPreserve: [],
      evidenceRequirements: [],
      outputFormats: ['MD'],
      acceptanceCriteria: [],
      forbiddenShortcuts: [],
    },
  }
}

function writeManifest(sessionPath: string, manifest: object): void {
  const artifactDir = join(sessionPath, 'data', 'document-artifacts', 'final-report')
  mkdirSync(artifactDir, { recursive: true })
  writeFileSync(join(artifactDir, 'manifest.json'), JSON.stringify(manifest), 'utf-8')
}

function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf-8').digest('hex')
}
