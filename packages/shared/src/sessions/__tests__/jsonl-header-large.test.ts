import { describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { patchSessionJsonlHeader, readSessionHeader, readSessionJsonl, readSessionJsonlAsync, writeSessionJsonl } from '../jsonl.ts';
import type { StoredSession } from '../types.ts';

describe('jsonl header loading', () => {
  it('reads session metadata when persisted goal state makes the header exceed 8KB', () => {
    const root = mkdtempSync(join(tmpdir(), 'agent-pi-large-header-'));
    try {
      const sessionDir = join(root, 'sessions', 'session-1');
      const sessionFile = join(sessionDir, 'session.jsonl');
      const workingDirectory = join(root, 'project-a');
      mkdirSync(sessionDir, { recursive: true });
      const session: StoredSession = {
        id: 'session-1',
        workspaceRootPath: root,
        createdAt: 1,
        lastUsedAt: 2,
        workingDirectory,
        messages: [],
        goalState: {
          id: 'goal-1',
          objective: `Keep every restored session visible after restart. ${'o'.repeat(9000)}`,
          mode: 'auto_improve',
          status: 'needs_review',
          createdAt: 1,
          updatedAt: 2,
          iteration: 3,
          maxIterations: 4,
          criteria: [],
          auditHistory: Array.from({ length: 40 }, (_, index) => ({
            iteration: index + 1,
            status: 'fail',
            summary: `Long audit summary ${index} ${'x'.repeat(200)}`,
            missingCriteria: [`Missing criterion ${index} ${'y'.repeat(120)}`],
            evidence: [{
              type: 'system',
              label: 'quality_route',
              detail: `task=research; roles=acceptance_reviewer; route_health=degraded; common_gaps=evidence_gap; route_history=pass=0,fail=${index + 1},uncertain=0; extra_reviewers=1/1; ${'z'.repeat(120)}`,
            }],
            createdAt: index + 1,
          })),
        },
        tokenUsage: {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          contextTokens: 0,
          costUsd: 0,
        },
      };

      writeSessionJsonl(sessionFile, session);

      const header = readSessionHeader(sessionFile);

      expect(header?.id).toBe('session-1');
      expect(header?.workingDirectory).toBe(workingDirectory);
      expect(header?.goalState?.auditHistory.length).toBe(10);
      expect(header?.goalState?.auditHistory.at(0)?.iteration).toBe(31);
      expect(header?.goalState?.auditHistory.at(-1)?.iteration).toBe(40);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('async JSONL read matches the sync reader', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agent-pi-jsonl-async-'));
    try {
      const sessionDir = join(root, 'sessions', 'session-1');
      const sessionFile = join(sessionDir, 'session.jsonl');
      mkdirSync(sessionDir, { recursive: true });
      const session: StoredSession = {
        id: 'session-1',
        workspaceRootPath: root,
        createdAt: 1,
        lastUsedAt: 2,
        messages: [
          { id: 'm1', type: 'user', content: 'hello', timestamp: 1 },
          { id: 'm2', type: 'assistant', content: 'world', timestamp: 2 },
        ],
      };

      writeSessionJsonl(sessionFile, session);

      const sync = readSessionJsonl(sessionFile);
      const asyncLoaded = await readSessionJsonlAsync(sessionFile);

      expect(asyncLoaded?.id).toBe(sync?.id);
      expect(asyncLoaded?.messages).toEqual(sync?.messages);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('async JSONL parse yields across many message lines', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agent-pi-jsonl-yield-'));
    try {
      const sessionDir = join(root, 'sessions', 'session-1');
      const sessionFile = join(sessionDir, 'session.jsonl');
      mkdirSync(sessionDir, { recursive: true });
      const messages = Array.from({ length: 80 }, (_, i) => ({
        id: `m${i}`,
        type: i % 2 === 0 ? 'user' : 'assistant',
        content: `line ${i}`,
        timestamp: i + 1,
      }));
      const session: StoredSession = {
        id: 'session-1',
        workspaceRootPath: root,
        createdAt: 1,
        lastUsedAt: 2,
        messages,
      };

      writeSessionJsonl(sessionFile, session);
      const loaded = await readSessionJsonlAsync(sessionFile);
      expect(loaded?.messages).toHaveLength(80);
      expect(loaded?.messages[79]?.id).toBe('m79');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('patches the JSONL header without rewriting parsed messages', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agent-pi-jsonl-patch-'));
    try {
      const sessionDir = join(root, 'sessions', 'session-1');
      const sessionFile = join(sessionDir, 'session.jsonl');
      mkdirSync(sessionDir, { recursive: true });
      const messages = Array.from({ length: 40 }, (_, i) => ({
        id: `m${i}`,
        type: i % 2 === 0 ? 'user' : 'assistant',
        content: `payload ${i} ${'x'.repeat(200)}`,
        timestamp: i + 1,
      }));
      const session: StoredSession = {
        id: 'session-1',
        workspaceRootPath: root,
        createdAt: 1,
        lastUsedAt: 2,
        messages,
        hasUnread: true,
      };

      writeSessionJsonl(sessionFile, session);
      expect(patchSessionJsonlHeader(sessionFile, (header) => {
        header.hasUnread = false;
        header.name = 'patched';
      })).toBe(true);

      const loaded = readSessionJsonl(sessionFile);
      expect(loaded?.name).toBe('patched');
      expect(loaded?.hasUnread).toBe(false);
      expect(loaded?.messages).toHaveLength(40);
      expect(loaded?.messages[39]?.id).toBe('m39');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
