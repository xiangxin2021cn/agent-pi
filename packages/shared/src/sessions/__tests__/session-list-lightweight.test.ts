import { describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeSessionJsonl } from '../jsonl.ts'
import { listSessions, loadSession } from '../storage.ts'
import type { StoredSession } from '../types.ts'

describe('lightweight session listing', () => {
  it('keeps full goal state on disk but omits it from cold session metadata', () => {
    const root = mkdtempSync(join(tmpdir(), 'agent-pi-light-session-list-'))
    try {
      const sessionDir = join(root, 'sessions', 'session-1')
      mkdirSync(sessionDir, { recursive: true })
      const session: StoredSession = {
        id: 'session-1',
        workspaceRootPath: root,
        createdAt: 1,
        lastUsedAt: 2,
        messages: [],
        goalState: {
          id: 'goal-1',
          objective: `Preserve the complete goal state for the selected session. ${'x'.repeat(20_000)}`,
          mode: 'auto_improve',
          status: 'needs_review',
          createdAt: 1,
          updatedAt: 2,
          iteration: 2,
          maxIterations: 2,
          criteria: [],
          auditHistory: [],
        },
        tokenUsage: {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          contextTokens: 0,
          costUsd: 0,
        },
      }

      writeSessionJsonl(join(sessionDir, 'session.jsonl'), session)

      const listed = listSessions(root)
      const loaded = loadSession(root, session.id)

      expect(listed).toHaveLength(1)
      expect(listed[0]?.goalState).toBeUndefined()
      expect(loaded?.goalState?.objective).toBe(session.goalState?.objective)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
