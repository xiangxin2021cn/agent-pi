import { describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  PROJECT_MEMORY_BRAIN_DIR_NAME,
  PROJECT_MEMORY_DIR_NAME,
  PROJECT_MEMORY_ENTRIES_FILE_NAME,
  getProjectBrainPath,
  loadProjectMemoryContextForSession,
} from './storage.ts';

describe('loadProjectMemoryContextForSession', () => {
  it('isolates business-session memory even when sessions share a working directory', async () => {
    const workingDirectory = await mkdtemp(join(tmpdir(), 'agent-pi-business-memory-'));
    const tenderContext = {
      module: 'tender' as const,
      projectId: 'n3-tender',
      workflowId: 'tender-main',
      stageId: 'boq-pricing',
    };
    const firstScope = { sessionId: '260716-first-task', businessContext: tenderContext };
    const secondScope = { sessionId: '260716-second-task', businessContext: tenderContext };

    try {
      const firstBrainPath = getProjectBrainPath(workingDirectory, firstScope)!;
      const secondBrainPath = getProjectBrainPath(workingDirectory, secondScope)!;
      expect(secondBrainPath).not.toBe(firstBrainPath);

      await mkdir(firstBrainPath, { recursive: true });
      await writeFile(join(firstBrainPath, PROJECT_MEMORY_ENTRIES_FILE_NAME), JSON.stringify({
        type: 'formal_output_created',
        title: 'First task only',
        summary: 'This memory must not appear in another workbench conversation.',
        trust: 'verified',
        createdAt: 1,
      }));

      const firstContext = loadProjectMemoryContextForSession(workingDirectory, firstScope);
      const secondContext = loadProjectMemoryContextForSession(workingDirectory, secondScope);

      expect(firstContext).toContain('First task only');
      expect(secondContext).toBeNull();
    } finally {
      await rm(workingDirectory, { recursive: true, force: true });
    }
  });

  it('filters archived, stale, and unverified entries out of prompt context', async () => {
    const workingDirectory = await mkdtemp(join(tmpdir(), 'agent-pi-memory-context-'));
    try {
      const brainPath = join(workingDirectory, PROJECT_MEMORY_DIR_NAME, PROJECT_MEMORY_BRAIN_DIR_NAME);
      await mkdir(brainPath, { recursive: true });
      await writeFile(join(brainPath, PROJECT_MEMORY_ENTRIES_FILE_NAME), [
        JSON.stringify({
          type: 'formal_output_created',
          title: 'Verified report',
          summary: 'Use the verified cost report as the current baseline.',
          trust: 'verified',
          createdAt: 1,
        }),
        JSON.stringify({
          type: 'old_decision',
          title: 'Archived decision',
          summary: 'This should not be injected anymore.',
          trust: 'verified',
          status: 'archived',
          createdAt: 2,
        }),
        JSON.stringify({
          type: 'old_fact',
          title: 'Stale fact',
          summary: 'This stale item should not guide current execution.',
          trust: 'verified',
          status: 'stale',
          createdAt: 3,
        }),
        JSON.stringify({
          type: 'draft_note',
          title: 'Unverified draft',
          summary: 'This unverified draft should stay out of prompt context.',
          trust: 'unverified',
          createdAt: 4,
        }),
        JSON.stringify({
          type: 'known_gap',
          title: 'Open citation gap',
          summary: 'Need source citations before finalizing.',
          trust: 'needs_review',
          missingCriteria: ['Add source citations.'],
          createdAt: 5,
        }),
      ].join('\n'));

      const context = loadProjectMemoryContextForSession(workingDirectory);

      expect(context).toContain('Verified report');
      expect(context).toContain('Open citation gap');
      expect(context).toContain('Need source citations before finalizing.');
      expect(context).not.toContain('Archived decision');
      expect(context).not.toContain('Stale fact');
      expect(context).not.toContain('Unverified draft');
    } finally {
      await rm(workingDirectory, { recursive: true, force: true });
    }
  });
});
