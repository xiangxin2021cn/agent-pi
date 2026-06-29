import { describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { PROJECT_MEMORY_ENTRIES_FILE_NAME, getProjectBrainPath } from '@craft-agent/shared/sessions'
import {
  ensureProjectMemoryLite,
  recordProjectMemoryFormalOutput,
  recordProjectMemoryGoalAudit,
  writeProjectMemoryLite,
} from './project-memory-lite'

describe('ensureProjectMemoryLite', () => {
  test('creates the project brain directory skeleton without external backends', async () => {
    const workingDirectory = await mkdtemp(join(tmpdir(), 'agent-pi-brain-'))
    try {
      const result = await ensureProjectMemoryLite(workingDirectory)
      const brainPath = getProjectBrainPath(workingDirectory)!

      expect(result.brainPath).toBe(brainPath)
      expect(existsSync(join(brainPath, 'sources'))).toBe(true)
      expect(existsSync(join(brainPath, 'artifacts'))).toBe(true)
      expect(existsSync(join(brainPath, 'outputs'))).toBe(true)
      expect(existsSync(join(brainPath, 'outputs', 'reviews'))).toBe(true)
      expect(existsSync(join(brainPath, 'decisions.md'))).toBe(true)
      expect(existsSync(join(brainPath, PROJECT_MEMORY_ENTRIES_FILE_NAME))).toBe(true)
      expect(existsSync(join(brainPath, 'facts.jsonl'))).toBe(true)
      expect(existsSync(join(brainPath, 'citations.jsonl'))).toBe(true)
    } finally {
      await rm(workingDirectory, { recursive: true, force: true })
    }
  })

  test('does not overwrite existing project memory files', async () => {
    const workingDirectory = await mkdtemp(join(tmpdir(), 'agent-pi-brain-'))
    try {
      await ensureProjectMemoryLite(workingDirectory)
      const brainPath = getProjectBrainPath(workingDirectory)!
      const decisionsPath = join(brainPath, 'decisions.md')

      await writeFile(decisionsPath, '# Existing Decisions\n\nKeep this.\n')
      await ensureProjectMemoryLite(workingDirectory)

      await expect(readFile(decisionsPath, 'utf8')).resolves.toContain('Keep this.')
    } finally {
      await rm(workingDirectory, { recursive: true, force: true })
    }
  })

  test('records goal audits into Project Memory Lite indexes', async () => {
    const workingDirectory = await mkdtemp(join(tmpdir(), 'agent-pi-brain-'))
    try {
      const sourcePath = join(workingDirectory, 'tender.pdf')
      const outputPath = join(workingDirectory, 'Agent Pi Outputs', 'session-1', 'report.md')
      await recordProjectMemoryGoalAudit({
        workingDirectory,
        sessionId: 'session-1',
        goalState: {
          id: 'goal-1',
          objective: 'Create tender report',
          mode: 'auto_improve',
          status: 'needs_review',
          createdAt: 1,
          updatedAt: 2,
          iteration: 1,
          maxIterations: 3,
          criteria: [],
          auditHistory: [],
        },
        result: {
          iteration: 1,
          status: 'fail',
          summary: 'Document quality failed.',
          missingCriteria: ['Need source citations.'],
          evidence: [
            { type: 'file', label: 'source_file_preview', detail: `${sourcePath}\nClause preview` },
            { type: 'file', label: 'file_preview', detail: `${outputPath}\nReport preview` },
            {
              type: 'system',
              label: 'document_quality_report',
              detail: [
                'status: fail',
                'score: 58/70',
                'dimensions: structure=60, evidence=35, numbers=50, specification=45, risk=70',
                'metrics: textLength=320, headings=1, paragraphs=2, citations=0, sourceRefs=0, numericClaims=6, tables=0, placeholders=0',
                'issues:',
                '- 没有看到对输入材料的来源标识或引用。',
                'strengths:',
                '- 包含可审查的数字性表述。',
              ].join('\n'),
            },
          ],
          createdAt: 10,
        },
      })

      const brainPath = getProjectBrainPath(workingDirectory)!
      const audit = readFirstJsonLine(join(brainPath, 'artifacts', 'goal-audits.jsonl'))
      const source = readFirstJsonLine(join(brainPath, 'sources', 'sources.jsonl'))
      const output = readFirstJsonLine(join(brainPath, 'outputs', 'outputs.jsonl'))
      const review = readFirstJsonLine(join(brainPath, 'outputs', 'reviews.jsonl'))
      const citation = readFirstJsonLine(join(brainPath, 'citations.jsonl'))
      const fact = readFirstJsonLine(join(brainPath, 'facts.jsonl'))
      const entries = readJsonLines(join(brainPath, PROJECT_MEMORY_ENTRIES_FILE_NAME))
      const events = readJsonLines(join(brainPath, 'artifacts', 'events.jsonl'))

      await expect(audit).resolves.toMatchObject({
        type: 'goal_audit',
        id: 'session-1:goal-1:1',
        documentQuality: {
          status: 'fail',
          score: 58,
          threshold: 70,
        },
      })
      await expect(source).resolves.toMatchObject({
        type: 'source_evidence',
        path: sourcePath,
      })
      await expect(output).resolves.toMatchObject({
        type: 'output_evidence',
        path: outputPath,
      })
      await expect(review).resolves.toMatchObject({
        type: 'formal_output_review',
        outputPath,
        score: 58,
        threshold: 70,
      })
      await expect(citation).resolves.toMatchObject({
        type: 'goal_audit_source',
        sourcePath,
        targetId: 'session-1:goal-1:1',
      })
      await expect(fact).resolves.toMatchObject({
        type: 'document_quality_fact',
        value: 58,
        threshold: 70,
      })
      await expect(entries).resolves.toEqual(expect.arrayContaining([
        expect.objectContaining({
          type: 'goal_audit_completed',
          goalAuditId: 'session-1:goal-1:1',
          trust: 'needs_review',
        }),
        expect.objectContaining({
          type: 'formal_output_created',
          outputPath,
          reviewPath: expect.any(String),
        }),
        expect.objectContaining({
          type: 'source_backed_analysis',
          outputPath,
          sourcePaths: [sourcePath],
          summary: 'Report preview',
        }),
        expect.objectContaining({
          type: 'known_gap',
          summary: 'Need source citations.',
        }),
      ]))
      await expect(events).resolves.toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'GoalAuditCompleted' }),
        expect.objectContaining({ type: 'ArtifactCreated', path: outputPath }),
        expect.objectContaining({ type: 'FormalOutputCreated', outputPath }),
      ]))
      const outputRecord = await output as { reviewPath?: string }
      expect(outputRecord.reviewPath).toBeTruthy()
      await expect(readFile(outputRecord.reviewPath!, 'utf8')).resolves.toContain('Document Expert Review')
      await expect(readFile(outputRecord.reviewPath!, 'utf8')).resolves.toContain('Final score: 58/70')
    } finally {
      await rm(workingDirectory, { recursive: true, force: true })
    }
  })

  test('records user-promoted formal outputs into project memory', async () => {
    const workingDirectory = await mkdtemp(join(tmpdir(), 'agent-pi-brain-'))
    try {
      const sourcePath = join(workingDirectory, '.agent-pi', 'work', 'draft.md')
      const outputPath = join(workingDirectory, 'Agent Pi Outputs', 'session-2', 'final.md')
      await recordProjectMemoryFormalOutput({
        workingDirectory,
        sessionId: 'session-2',
        sourcePath,
        outputPath,
        reason: 'user_promoted',
        createdAt: 20,
      })

      const brainPath = getProjectBrainPath(workingDirectory)!
      await expect(readJsonLines(join(brainPath, PROJECT_MEMORY_ENTRIES_FILE_NAME))).resolves.toEqual(expect.arrayContaining([
        expect.objectContaining({
          type: 'formal_output_created',
          trust: 'user_promoted',
          outputPath,
          sourcePaths: [sourcePath],
        }),
      ]))
      await expect(readJsonLines(join(brainPath, 'artifacts', 'events.jsonl'))).resolves.toEqual(expect.arrayContaining([
        expect.objectContaining({
          type: 'ArtifactCreated',
          path: outputPath,
          sourcePath,
        }),
        expect.objectContaining({
          type: 'FormalOutputCreated',
          outputPath,
          sourcePath,
        }),
      ]))
    } finally {
      await rm(workingDirectory, { recursive: true, force: true })
    }
  })

  test('appends lightweight entries without creating external sync artifacts', async () => {
    const workingDirectory = await mkdtemp(join(tmpdir(), 'agent-pi-brain-'))
    try {
      const result = await writeProjectMemoryLite(workingDirectory, [{
        type: 'formal_output_created',
        title: 'Known cost basis',
        summary: 'Schedule A is the dominant cost bucket.',
        trust: 'verified',
        outputPath: join(workingDirectory, 'Agent Pi Outputs', 'session-3', 'cost.md'),
        createdAt: 30,
      }])

      const brainPath = getProjectBrainPath(workingDirectory)!
      expect(result).toMatchObject({
        brainPath,
        entriesPath: join(brainPath, PROJECT_MEMORY_ENTRIES_FILE_NAME),
        entryCount: 1,
      })
      await expect(readJsonLines(join(brainPath, PROJECT_MEMORY_ENTRIES_FILE_NAME))).resolves.toEqual(expect.arrayContaining([
        expect.objectContaining({
          type: 'formal_output_created',
          title: 'Known cost basis',
        }),
      ]))
    } finally {
      await rm(workingDirectory, { recursive: true, force: true })
    }
  })
})

async function readFirstJsonLine(filePath: string): Promise<unknown> {
  const content = await readFile(filePath, 'utf8')
  return JSON.parse(content.trim().split('\n')[0])
}

async function readJsonLines(filePath: string): Promise<unknown[]> {
  const content = await readFile(filePath, 'utf8')
  return content
    .trim()
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line))
}
