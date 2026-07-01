import { describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { PROJECT_MEMORY_ENTRIES_FILE_NAME, getProjectBrainPath } from '@craft-agent/shared/sessions'
import {
  ensureProjectMemoryLite,
  loadProjectMemoryReviewerPerformanceSummary,
  recordProjectMemoryFormalOutput,
  recordProjectMemoryGoalAudit,
  resetProjectMemoryQualityTelemetry,
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
          taskContract: {
            originalRequest: 'Create tender report',
            taskType: 'document',
            deliverables: ['Tender report'],
            mustPreserve: [],
            evidenceRequirements: ['Cite source evidence.'],
            outputFormats: ['MD'],
            acceptanceCriteria: ['[evidence] Cite sources.'],
            forbiddenShortcuts: ['Do not create a brief outline.'],
          },
          auditHistory: [],
        },
        result: {
          iteration: 1,
          status: 'fail',
          summary: 'Document quality failed.',
          missingCriteria: ['Need source citations.'],
          failureCategories: ['evidence_gap', 'shallow_output'],
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
            {
              type: 'system',
              label: 'quality_role_artifact_reviewer',
              detail: 'model=cheap-artifact-reviewer; requested_model=strong-artifact-reviewer; fallback_model=true; status=fail; categories=evidence_gap,shallow_output; latency_ms=42; input_tokens=321; output_tokens=76; summary=Missing source citations.',
            },
            {
              type: 'system',
              label: 'quality_route',
              detail: 'task=document; roles=acceptance_reviewer,artifact_reviewer,risk_reviewer; models=artifact_reviewer:cheap-artifact-reviewer; telemetry_roles=artifact_reviewer; common_gaps=evidence_gap',
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
      const facts = readJsonLines(join(brainPath, 'facts.jsonl'))
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
        failureCategories: ['evidence_gap', 'shallow_output'],
      })
      await expect(events).resolves.toEqual(expect.arrayContaining([
        expect.objectContaining({
          type: 'GoalAuditCompleted',
          failureCategories: ['evidence_gap', 'shallow_output'],
        }),
        expect.objectContaining({
          type: 'ArtifactCreated',
          path: outputPath,
          failureCategories: ['evidence_gap', 'shallow_output'],
        }),
        expect.objectContaining({
          type: 'FormalOutputCreated',
          outputPath,
          failureCategories: ['evidence_gap', 'shallow_output'],
        }),
      ]))
      await expect(entries).resolves.toEqual(expect.arrayContaining([
        expect.objectContaining({
          type: 'goal_audit_completed',
          goalAuditId: 'session-1:goal-1:1',
          failureCategories: ['evidence_gap', 'shallow_output'],
        }),
        expect.objectContaining({
          type: 'known_gap',
          summary: 'Need source citations.',
          failureCategories: ['evidence_gap', 'shallow_output'],
        }),
      ]))
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
      await expect(facts).resolves.toEqual(expect.arrayContaining([
        expect.objectContaining({
          type: 'quality_reviewer_fact',
          role: 'artifact_reviewer',
          model: 'cheap-artifact-reviewer',
          requestedModel: 'strong-artifact-reviewer',
          fallbackModel: true,
          status: 'fail',
          taskType: 'document',
          failureCategories: ['evidence_gap', 'shallow_output'],
          latencyMs: 42,
          inputTokens: 321,
          outputTokens: 76,
          goalAuditId: 'session-1:goal-1:1',
        }),
        expect.objectContaining({
          type: 'quality_route_fact',
          taskType: 'document',
          status: 'fail',
          roles: ['acceptance_reviewer', 'artifact_reviewer', 'risk_reviewer'],
          modelAssignments: { artifact_reviewer: 'cheap-artifact-reviewer' },
          telemetryRoles: ['artifact_reviewer'],
          commonGaps: ['evidence_gap'],
          goalAuditId: 'session-1:goal-1:1',
        }),
      ]))
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

  test('summarizes quality reviewer facts for future goal reviews', async () => {
    const workingDirectory = await mkdtemp(join(tmpdir(), 'agent-pi-brain-'))
    try {
      const { brainPath } = await ensureProjectMemoryLite(workingDirectory)
      await writeFile(join(brainPath, 'facts.jsonl'), [
        JSON.stringify({
          type: 'quality_reviewer_fact',
          role: 'artifact_reviewer',
          model: 'cheap-artifact-reviewer',
          status: 'fail',
          taskType: 'research',
          failureCategories: ['evidence_gap'],
          latencyMs: 42,
          inputTokens: 321,
          outputTokens: 76,
          summary: 'Missing source citations.',
          goalAuditId: 'session-1:goal-1:1',
          createdAt: 10,
        }),
        JSON.stringify({
          type: 'document_quality_fact',
          subject: 'Other fact',
          createdAt: 11,
        }),
      ].join('\n') + '\n')

      const summary = await loadProjectMemoryReviewerPerformanceSummary(workingDirectory)

      expect(summary).toContain('artifact_reviewer')
      expect(summary).toContain('cheap-artifact-reviewer')
      expect(summary).toContain('fail')
      expect(summary).toContain('task=research')
      expect(summary).toContain('evidence_gap')
      expect(summary).toContain('latency=42ms')
      expect(summary).toContain('tokens=321/76')
      expect(summary).toContain('Missing source citations.')
      expect(summary).not.toContain('document_quality_fact')
    } finally {
      await rm(workingDirectory, { recursive: true, force: true })
    }
  })

  test('aggregates reviewer performance by task type and role', async () => {
    const workingDirectory = await mkdtemp(join(tmpdir(), 'agent-pi-brain-'))
    try {
      const { brainPath } = await ensureProjectMemoryLite(workingDirectory)
      await writeFile(join(brainPath, 'facts.jsonl'), [
        JSON.stringify({
          type: 'quality_reviewer_fact',
          role: 'research_source_reviewer',
          model: 'source-model-a',
          requestedModel: 'strong-source-reviewer',
          fallbackModel: true,
          status: 'fail',
          taskType: 'research',
          failureCategories: ['evidence_gap'],
          latencyMs: 40,
          inputTokens: 100,
          outputTokens: 20,
          summary: 'Missing citations.',
          createdAt: 10,
        }),
        JSON.stringify({
          type: 'quality_reviewer_fact',
          role: 'research_source_reviewer',
          model: 'source-model-a',
          requestedModel: 'strong-source-reviewer',
          fallbackModel: true,
          status: 'pass',
          taskType: 'research',
          failureCategories: [],
          latencyMs: 60,
          inputTokens: 120,
          outputTokens: 30,
          summary: 'Sources were grounded.',
          createdAt: 11,
        }),
        JSON.stringify({
          type: 'quality_reviewer_fact',
          role: 'code_implementation_reviewer',
          model: 'code-model-b',
          status: 'fail',
          taskType: 'code',
          failureCategories: ['verification_gap'],
          latencyMs: 50,
          inputTokens: 140,
          outputTokens: 40,
          summary: 'Missing typecheck evidence.',
          createdAt: 12,
        }),
      ].join('\n') + '\n')

      const summary = await loadProjectMemoryReviewerPerformanceSummary(workingDirectory)

      expect(summary).toContain('Reviewer performance aggregates:')
      expect(summary).toContain('task=research role=research_source_reviewer total=2 pass=1 fail=1 uncertain=0')
      expect(summary).toContain('fallbacks=2')
      expect(summary).toContain('common_gaps=evidence_gap')
      expect(summary).toContain('avg_latency=50ms')
      expect(summary).toContain('task=code role=code_implementation_reviewer total=1 pass=0 fail=1 uncertain=0')
      expect(summary).toContain('Recent reviewer facts:')
      expect(summary).toContain('Missing citations.')
    } finally {
      await rm(workingDirectory, { recursive: true, force: true })
    }
  })

  test('aggregates quality route outcomes for learned routing', async () => {
    const workingDirectory = await mkdtemp(join(tmpdir(), 'agent-pi-brain-'))
    try {
      const { brainPath } = await ensureProjectMemoryLite(workingDirectory)
      await writeFile(join(brainPath, 'facts.jsonl'), [
        JSON.stringify({
          type: 'quality_route_fact',
          taskType: 'research',
          status: 'fail',
          roles: ['acceptance_reviewer', 'artifact_reviewer', 'risk_reviewer', 'research_source_reviewer'],
          modelAssignments: { research_source_reviewer: 'source-model-a' },
          telemetryRoles: ['research_source_reviewer'],
          commonGaps: ['evidence_gap'],
          failureCategories: ['evidence_gap'],
          createdAt: 10,
        }),
        JSON.stringify({
          type: 'quality_route_fact',
          taskType: 'research',
          status: 'pass',
          roles: ['acceptance_reviewer', 'artifact_reviewer', 'risk_reviewer', 'research_source_reviewer'],
          modelAssignments: { research_source_reviewer: 'source-model-a' },
          telemetryRoles: ['research_source_reviewer'],
          commonGaps: [],
          failureCategories: [],
          createdAt: 11,
        }),
        JSON.stringify({
          type: 'quality_route_fact',
          taskType: 'code',
          status: 'fail',
          roles: ['acceptance_reviewer', 'artifact_reviewer', 'risk_reviewer', 'code_implementation_reviewer'],
          modelAssignments: { code_implementation_reviewer: 'code-model-b' },
          telemetryRoles: [],
          commonGaps: ['verification_gap'],
          failureCategories: ['verification_gap'],
          createdAt: 12,
        }),
      ].join('\n') + '\n')

      const summary = await loadProjectMemoryReviewerPerformanceSummary(workingDirectory)

      expect(summary).toContain('Quality route outcome aggregates:')
      expect(summary).toContain('task=research total=2 pass=1 fail=1 uncertain=0')
      expect(summary).toContain('roles=acceptance_reviewer,artifact_reviewer,risk_reviewer,research_source_reviewer')
      expect(summary).toContain('models=research_source_reviewer:source-model-a')
      expect(summary).toContain('common_gaps=evidence_gap')
      expect(summary).toContain('task=code total=1 pass=0 fail=1 uncertain=0')
      expect(summary).toContain('common_gaps=verification_gap')
    } finally {
      await rm(workingDirectory, { recursive: true, force: true })
    }
  })

  test('resets learned quality telemetry without deleting other project facts', async () => {
    const workingDirectory = await mkdtemp(join(tmpdir(), 'agent-pi-brain-'))
    try {
      const { brainPath } = await ensureProjectMemoryLite(workingDirectory)
      await writeFile(join(brainPath, 'facts.jsonl'), [
        JSON.stringify({
          type: 'document_quality_fact',
          subject: 'Risk report',
          value: 72,
          createdAt: 10,
        }),
        JSON.stringify({
          type: 'quality_reviewer_fact',
          role: 'artifact_reviewer',
          status: 'fail',
          taskType: 'research',
          createdAt: 11,
        }),
        JSON.stringify({
          type: 'quality_route_fact',
          taskType: 'research',
          status: 'fail',
          roles: ['acceptance_reviewer'],
          createdAt: 12,
        }),
        'not-json-but-user-owned',
      ].join('\n') + '\n')

      const result = await resetProjectMemoryQualityTelemetry(workingDirectory)
      const facts = await readFile(join(brainPath, 'facts.jsonl'), 'utf8')

      expect(result).toMatchObject({
        removedCount: 2,
        retainedCount: 2,
      })
      expect(facts).toContain('document_quality_fact')
      expect(facts).toContain('not-json-but-user-owned')
      expect(facts).not.toContain('quality_reviewer_fact')
      expect(facts).not.toContain('quality_route_fact')
      await expect(loadProjectMemoryReviewerPerformanceSummary(workingDirectory)).resolves.toBeUndefined()
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
