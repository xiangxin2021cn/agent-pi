import { describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { PROJECT_MEMORY_ENTRIES_FILE_NAME, getProjectBrainPath } from '@craft-agent/shared/sessions'
import {
  ensureProjectMemoryLite,
  getProjectGbrainRuntimeStatus,
  initializeProjectGbrainRuntime,
  recordProjectMemoryFormalOutput,
  recordProjectMemoryGoalAudit,
  syncProjectMemoryToGbrain,
} from './project-memory-lite'
import {
  getProjectGbrainPostgresDatabaseName,
  getProjectGbrainPostgresDatabaseUrl,
} from './project-gbrain-source'

describe('ensureProjectMemoryLite', () => {
  test('creates the project brain directory skeleton', async () => {
    const workingDirectory = await mkdtemp(join(tmpdir(), 'agent-pi-brain-'))
    try {
      const result = await ensureProjectMemoryLite(workingDirectory)
      const brainPath = getProjectBrainPath(workingDirectory)!

      expect(result.brainPath).toBe(brainPath)
      expect(existsSync(join(brainPath, 'sources'))).toBe(true)
      expect(existsSync(join(brainPath, 'artifacts'))).toBe(true)
      expect(existsSync(join(brainPath, 'outputs'))).toBe(true)
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

  test('records goal audits into project memory indexes', async () => {
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
      const gbrainSync = readJsonLines(join(brainPath, 'gbrain', 'project-memory-sync.jsonl'))

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
      await expect(gbrainSync).resolves.toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'goal_audit_completed' }),
        expect.objectContaining({ type: 'formal_output_created' }),
      ]))
      await expect(readFile(join(brainPath, 'gbrain', 'project-memory-sync.md'), 'utf8')).resolves.toContain('## Create tender report')
      await expect(readFile(join(brainPath, 'gbrain', 'sync-manifest.json'), 'utf8')).resolves.toContain('"status": "prepared"')
      await expect(readFile(join(brainPath, 'gbrain', 'sync-manifest.json'), 'utf8')).resolves.toContain('project-memory-sync.md')
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

  test('imports the prepared feed into local gbrain when the backend is enabled', async () => {
    const workingDirectory = await mkdtemp(join(tmpdir(), 'agent-pi-brain-'))
    try {
      const calls: Array<{ args: string[]; gbrainHome: string; namespace: string }> = []
      const result = await syncProjectMemoryToGbrain(workingDirectory, [{
        type: 'formal_output_created',
        title: 'Known cost basis',
        summary: 'Schedule A is the dominant cost bucket.',
        trust: 'verified',
        outputPath: join(workingDirectory, 'Agent Pi Outputs', 'session-3', 'cost.md'),
        createdAt: 30,
      }], {
        projectMemory: {
          gbrain: {
            enabled: true,
            backend: 'local_pglite',
          },
        },
        runGbrainCommand: async (args, context) => {
          calls.push({
            args,
            gbrainHome: context.gbrainHome,
            namespace: context.namespace,
          })
          return { ok: true, stdout: 'ok', stderr: '' }
        },
      })

      const brainPath = getProjectBrainPath(workingDirectory)!
      expect(result.status).toBe('imported')
      expect(calls.map(call => call.args)).toEqual([
        ['doctor', '--json'],
        ['sources', 'add', expect.stringMatching(/^project-[a-f0-9]{16}$/), '--path', workingDirectory],
        ['import', join(brainPath, 'gbrain')],
        ['extract', 'all', '--source', 'db', '--json'],
        ['dream', '--phase', 'extract_facts', '--source', expect.stringMatching(/^project-[a-f0-9]{16}$/), '--json'],
        ['embed', '--stale'],
      ])
      expect(calls[0].gbrainHome).toBe(join(workingDirectory, '.agent-pi', 'gbrain'))
      expect(calls[0].namespace).toMatch(/^project-[a-f0-9]{16}$/)
      expect(calls[1].namespace).toBe(calls[0].namespace)
      const manifest = await readFile(join(brainPath, 'gbrain', 'sync-manifest.json'), 'utf8')
      expect(manifest).toContain('"status": "imported"')
      expect(manifest).toContain('"maintenance"')
    } finally {
      await rm(workingDirectory, { recursive: true, force: true })
    }
  })

  test('initializes a local project gbrain store for the selected working directory', async () => {
    const workingDirectory = await mkdtemp(join(tmpdir(), 'agent-pi-brain-'))
    try {
      let initialized = false
      const calls: string[][] = []
      const result = await initializeProjectGbrainRuntime(workingDirectory, {
        gbrain: {
          enabled: true,
          backend: 'local_pglite',
        },
      }, {
        runGbrainCommand: async (args) => {
          calls.push(args)
          if (args[0] === 'doctor') {
            return initialized
              ? { ok: true, stdout: '{"ok":true}', stderr: '' }
              : { ok: false, stdout: '', stderr: 'not initialized', code: 1 }
          }
          initialized = true
          return { ok: true, stdout: 'initialized', stderr: '' }
        },
      })

      expect(result.initialized).toBe(true)
      expect(result.status).toBe('ready')
      expect(result.projectGbrainPath).toBe(join(workingDirectory, '.agent-pi', 'gbrain'))
      expect(calls).toEqual([
        ['doctor', '--json'],
        ['init', '--pglite', '--no-embedding'],
        ['doctor', '--json'],
        ['sources', 'add', expect.stringMatching(/^project-[a-f0-9]{16}$/), '--path', workingDirectory],
      ])
    } finally {
      await rm(workingDirectory, { recursive: true, force: true })
    }
  })

  test('reports unavailable when the gbrain command is not installed', async () => {
    const workingDirectory = await mkdtemp(join(tmpdir(), 'agent-pi-brain-'))
    try {
      const result = await getProjectGbrainRuntimeStatus(workingDirectory, {
        gbrain: {
          enabled: true,
          backend: 'local_pglite',
        },
      }, {
        runGbrainCommand: async () => ({ ok: false, stdout: '', stderr: 'command not found: gbrain', code: 127 }),
      })

      expect(result.status).toBe('unavailable')
      expect(result.canInitialize).toBe(false)
    } finally {
      await rm(workingDirectory, { recursive: true, force: true })
    }
  })

  test('treats a warning-heavy doctor response as ready when the database checks pass', async () => {
    const workingDirectory = await mkdtemp(join(tmpdir(), 'agent-pi-brain-'))
    try {
      const result = await getProjectGbrainRuntimeStatus(workingDirectory, {
        gbrain: {
          enabled: true,
          backend: 'local_postgres',
          postgresUrl: 'postgres://postgres:secret@127.0.0.1:5433/agent_pi_gbrain',
        },
      }, {
        runGbrainCommand: async () => ({
          ok: false,
          stdout: `doctor warnings\n${JSON.stringify({
            status: 'unhealthy',
            checks: [
              { name: 'connection', status: 'ok' },
              { name: 'pgvector', status: 'ok' },
              { name: 'schema_version', status: 'ok' },
              { name: 'embeddings', status: 'warn' },
            ],
          })}`,
          stderr: 'embedding provider is not configured',
          code: 1,
        }),
      })

      expect(result.status).toBe('ready')
      expect(result.canInitialize).toBe(false)
      expect(result.message).toContain('non-blocking warnings')
      expect(result.doctor?.ok).toBe(false)
    } finally {
      await rm(workingDirectory, { recursive: true, force: true })
    }
  })

  test('initializes a local PostgreSQL project gbrain store with a redacted command status', async () => {
    const workingDirectory = await mkdtemp(join(tmpdir(), 'agent-pi-brain-'))
    try {
      const postgresUrl = 'postgres://postgres:secret@127.0.0.1:5433/agent_pi_gbrain'
      const projectPostgresUrl = getProjectGbrainPostgresDatabaseUrl(workingDirectory, postgresUrl)!
      const projectDatabaseName = getProjectGbrainPostgresDatabaseName(workingDirectory, postgresUrl)
      let initialized = false
      const calls: Array<{ args: string[]; databaseUrl?: string; databaseName?: string }> = []
      const ensureCalls: Array<{ databaseUrl: string; databaseName: string }> = []
      const result = await initializeProjectGbrainRuntime(workingDirectory, {
        gbrain: {
          enabled: true,
          backend: 'local_postgres',
          postgresUrl,
        },
      }, {
        runGbrainCommand: async (args, context) => {
          calls.push({ args, databaseUrl: context.databaseUrl, databaseName: context.databaseName })
          if (args[0] === 'doctor') {
            return initialized
              ? { ok: true, stdout: '{"ok":true}', stderr: '' }
              : { ok: false, stdout: '', stderr: 'not initialized', code: 1 }
          }
          initialized = true
          return { ok: true, stdout: 'ok', stderr: '' }
        },
        ensurePostgresDatabase: async (context) => {
          ensureCalls.push({
            databaseUrl: context.databaseUrl,
            databaseName: context.databaseName,
          })
          return {
            command: 'psql ensure project database',
            ok: true,
            stdout: 'ready',
          }
        },
      })

      expect(result.initialized).toBe(true)
      expect(result.status).toBe('ready')
      expect(result.init?.command).toBe(`gbrain init --url ${projectPostgresUrl.replace(':secret@', ':***@')} --no-embedding`)
      expect(ensureCalls).toEqual([{
        databaseUrl: projectPostgresUrl,
        databaseName: projectDatabaseName,
      }])
      expect(calls.map(call => call.args)).toEqual([
        ['doctor', '--json'],
        ['init', '--url', projectPostgresUrl, '--no-embedding'],
        ['doctor', '--json'],
        ['sources', 'add', expect.stringMatching(/^project-[a-f0-9]{16}$/), '--path', workingDirectory],
      ])
      expect(calls.every(call => call.databaseUrl === projectPostgresUrl)).toBe(true)
      expect(calls.every(call => call.databaseName === projectDatabaseName)).toBe(true)
    } finally {
      await rm(workingDirectory, { recursive: true, force: true })
    }
  })

  test('registers the project source when the local gbrain store is already ready', async () => {
    const workingDirectory = await mkdtemp(join(tmpdir(), 'agent-pi-brain-'))
    try {
      const calls: string[][] = []
      const result = await initializeProjectGbrainRuntime(workingDirectory, {
        gbrain: {
          enabled: true,
          backend: 'local_pglite',
        },
      }, {
        runGbrainCommand: async (args) => {
          calls.push(args)
          return { ok: true, stdout: 'ok', stderr: '' }
        },
      })

      expect(result.initialized).toBe(true)
      expect(result.status).toBe('ready')
      expect(calls).toEqual([
        ['doctor', '--json'],
        ['sources', 'add', expect.stringMatching(/^project-[a-f0-9]{16}$/), '--path', workingDirectory],
      ])
    } finally {
      await rm(workingDirectory, { recursive: true, force: true })
    }
  })

  test('falls back to no-embed import when embedding import fails', async () => {
    const workingDirectory = await mkdtemp(join(tmpdir(), 'agent-pi-brain-'))
    try {
      const calls: string[][] = []
      const result = await syncProjectMemoryToGbrain(workingDirectory, [{
        type: 'formal_output_created',
        title: 'Known project logic',
        summary: 'The project should reuse verified same-directory conclusions.',
        trust: 'verified',
        outputPath: join(workingDirectory, 'Agent Pi Outputs', 'session-4', 'logic.md'),
        createdAt: 40,
      }], {
        projectMemory: {
          gbrain: {
            enabled: true,
            backend: 'local_pglite',
          },
        },
        runGbrainCommand: async (args) => {
          calls.push(args)
          if (args[0] === 'doctor') return { ok: true, stdout: 'ok', stderr: '' }
          if (args[0] === 'sources') return { ok: true, stdout: 'source ready', stderr: '' }
          if (args.includes('--no-embed')) return { ok: true, stdout: 'text import ok', stderr: '' }
          return { ok: false, stdout: '', stderr: 'embedding provider is not configured', code: 1 }
        },
      })

      const brainPath = getProjectBrainPath(workingDirectory)!
      expect(result.status).toBe('imported')
      expect(result.importAttempt?.command).toBe(`gbrain import ${join(brainPath, 'gbrain')} --no-embed`)
      expect(result.importAttempt?.maintenance?.links?.ok).toBe(false)
      expect(result.importAttempt?.maintenance?.facts?.ok).toBe(false)
      expect(result.importAttempt?.maintenance?.embeddings?.ok).toBe(false)
      expect(calls).toEqual([
        ['doctor', '--json'],
        ['sources', 'add', expect.stringMatching(/^project-[a-f0-9]{16}$/), '--path', workingDirectory],
        ['import', join(brainPath, 'gbrain')],
        ['import', join(brainPath, 'gbrain'), '--no-embed'],
        ['extract', 'all', '--source', 'db', '--json'],
        ['dream', '--phase', 'extract_facts', '--source', expect.stringMatching(/^project-[a-f0-9]{16}$/), '--json'],
        ['embed', '--stale'],
      ])
    } finally {
      await rm(workingDirectory, { recursive: true, force: true })
    }
  })

  test('prepares the local PostgreSQL project database before syncing to gbrain', async () => {
    const workingDirectory = await mkdtemp(join(tmpdir(), 'agent-pi-brain-'))
    try {
      const postgresUrl = 'postgres://postgres:secret@127.0.0.1:5433/agent_pi_gbrain'
      const projectPostgresUrl = getProjectGbrainPostgresDatabaseUrl(workingDirectory, postgresUrl)!
      const projectDatabaseName = getProjectGbrainPostgresDatabaseName(workingDirectory, postgresUrl)
      const calls: Array<{ args: string[]; databaseUrl?: string; databaseName?: string }> = []
      const ensureCalls: Array<{ databaseUrl: string; databaseName: string }> = []

      const result = await syncProjectMemoryToGbrain(workingDirectory, [{
        type: 'formal_output_created',
        title: 'Known project logic',
        summary: 'The project should reuse verified same-directory conclusions.',
        trust: 'verified',
        outputPath: join(workingDirectory, 'Agent Pi Outputs', 'session-5', 'logic.md'),
        createdAt: 50,
      }], {
        projectMemory: {
          gbrain: {
            enabled: true,
            backend: 'local_postgres',
            postgresUrl,
          },
        },
        ensurePostgresDatabase: async (context) => {
          ensureCalls.push({
            databaseUrl: context.databaseUrl,
            databaseName: context.databaseName,
          })
          return {
            command: 'psql ensure project database',
            ok: true,
            stdout: 'ready',
          }
        },
        runGbrainCommand: async (args, context) => {
          calls.push({
            args,
            databaseUrl: context.databaseUrl,
            databaseName: context.databaseName,
          })
          return { ok: true, stdout: 'ok', stderr: '' }
        },
      })

      expect(result.status).toBe('imported')
      expect(ensureCalls).toEqual([{
        databaseUrl: projectPostgresUrl,
        databaseName: projectDatabaseName,
      }])
      expect(calls.map(call => call.args)).toEqual([
        ['doctor', '--json'],
        ['sources', 'add', expect.stringMatching(/^project-[a-f0-9]{16}$/), '--path', workingDirectory],
        ['import', join(getProjectBrainPath(workingDirectory)!, 'gbrain')],
        ['extract', 'all', '--source', 'db', '--json'],
        ['dream', '--phase', 'extract_facts', '--source', expect.stringMatching(/^project-[a-f0-9]{16}$/), '--json'],
        ['embed', '--stale'],
      ])
      expect(calls.every(call => call.databaseUrl === projectPostgresUrl)).toBe(true)
      expect(calls.every(call => call.databaseName === projectDatabaseName)).toBe(true)
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
