/**
 * Guards the volatile/stable context split (issue #862).
 *
 * The Pi adapter folded volatile context (date/time, session_state, sources)
 * into the cached system prefix, re-stamping it every turn and killing
 * prompt-cache reuse. The fix splits PromptBuilder.buildContextParts() into
 * buildVolatileContextParts() + buildStableContextParts() so the Pi path can
 * keep stable blocks in the system prompt and route volatile blocks to the user
 * tail (where the Claude path already puts everything).
 *
 * These tests pin three invariants:
 *  1. buildContextParts === [...volatile, ...stable] — the Claude path output is
 *     unchanged (same blocks, same order).
 *  2. Blocks are routed correctly: session_state + sources are volatile;
 *     workspace capabilities is stable.
 *  3. The one-shot mode-change signal is consumed exactly once, and only by the
 *     volatile builder — never by the stable builder.
 */
import { describe, it, expect, afterEach } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { PROJECT_MEMORY_DIR_NAME, PROJECT_MEMORY_BRAIN_DIR_NAME, PROJECT_MEMORY_ENTRIES_FILE_NAME } from '../../sessions/storage.ts'
import { TestAgent, createMockBackendConfig, createMockSession, createMockWorkspace } from './test-utils.ts'
import { cleanupModeState, initializeModeState, setPermissionMode } from '../mode-manager.ts'

// Matches createMockSession() in test-utils.ts
const SESSION_ID = 'test-session-id'
const OPTS = { plansFolderPath: '/tmp/plans', dataFolderPath: '/tmp/data' }
const SOURCE_BLOCK = '<sources>\nActive: none\n</sources>'

function makeBuilder() {
  return new TestAgent(createMockBackendConfig()).getPromptBuilder()
}

describe('PromptBuilder volatile/stable context split (issue #862)', () => {
  afterEach(() => cleanupModeState(SESSION_ID))

  it('buildContextParts equals [...volatile, ...stable] (Claude path stays byte-identical)', () => {
    // No pending one-shot signal → consume is a no-op → repeated calls are stable.
    cleanupModeState(SESSION_ID)
    const builder = makeBuilder()
    const composed = [
      ...builder.buildVolatileContextParts(OPTS, SOURCE_BLOCK),
      ...builder.buildStableContextParts(),
    ]
    const combined = builder.buildContextParts(OPTS, SOURCE_BLOCK)
    expect(combined).toEqual(composed)
  })

  it('routes session_state + sources to volatile and workspace capabilities to stable', () => {
    cleanupModeState(SESSION_ID)
    const builder = makeBuilder()
    const volatileText = builder.buildVolatileContextParts(OPTS, SOURCE_BLOCK).join('\n')
    const stableText = builder.buildStableContextParts().join('\n')

    // session_state + source ride the volatile tail
    expect(volatileText).toContain('permissionMode:')
    expect(volatileText).toContain(SOURCE_BLOCK)
    // workspace capabilities is stable
    expect(stableText).toContain('<workspace_capabilities>')

    // The halves must not bleed into each other
    expect(volatileText).not.toContain('<workspace_capabilities>')
    expect(stableText).not.toContain('permissionMode:')
  })

  it('injects context pressure strategy only into volatile context for large enabled source sets', () => {
    cleanupModeState(SESSION_ID)
    const builder = new TestAgent(createMockBackendConfig({
      session: createMockSession({
        enabledSourceSlugs: Array.from({ length: 12 }, (_, index) => `source-${index + 1}`),
      }),
    })).getPromptBuilder()

    const volatileText = builder.buildVolatileContextParts(OPTS, SOURCE_BLOCK).join('\n')
    const stableText = builder.buildStableContextParts().join('\n')

    expect(volatileText).toContain('<context_pressure')
    expect(volatileText).toContain('12 sources')
    expect(volatileText).toContain('narrow enabled sources')
    expect(stableText).not.toContain('<context_pressure')
  })

  it('does not inject context pressure strategy for small enabled source sets', () => {
    cleanupModeState(SESSION_ID)
    const builder = new TestAgent(createMockBackendConfig({
      session: createMockSession({
        enabledSourceSlugs: ['github', 'linear'],
      }),
    })).getPromptBuilder()

    const volatileText = builder.buildVolatileContextParts(OPTS, SOURCE_BLOCK).join('\n')

    expect(volatileText).not.toContain('<context_pressure')
  })

  it('injects a bounded goal contract only into volatile context', () => {
    cleanupModeState(SESSION_ID)
    const builder = new TestAgent(createMockBackendConfig({
      session: createMockSession({
        goalState: {
          id: 'goal-1',
          objective: 'Create a cited market research report',
          mode: 'auto_improve',
          status: 'running',
          createdAt: 1,
          updatedAt: 1,
          iteration: 0,
          maxIterations: 2,
          criteria: [],
          auditHistory: [],
          taskContract: {
            originalRequest: 'Deeply research the market and produce a cited report.',
            taskType: 'research',
            deliverables: ['Produce a structured report.'],
            mustPreserve: ['Explicit requirement: cite primary sources.'],
            evidenceRequirements: ['Cite source URLs for factual claims.'],
            outputFormats: ['MD'],
            acceptanceCriteria: ['[evidence] Ground key facts in available source material.'],
            forbiddenShortcuts: ['Do not provide a generic outline instead of the requested report.'],
          },
        },
      }),
    })).getPromptBuilder()

    const volatileText = builder.buildVolatileContextParts(OPTS, SOURCE_BLOCK).join('\n')
    const stableText = builder.buildStableContextParts().join('\n')

    expect(volatileText).toContain('<goal_contract taskType="research">')
    expect(volatileText).toContain('Produce a structured report.')
    expect(volatileText).toContain('cite primary sources')
    expect(volatileText).toContain('Do not provide a generic outline')
    expect(stableText).not.toContain('<goal_contract')
  })

  it('consumes the one-shot mode-change signal exactly once, only on the volatile path', () => {
    initializeModeState(SESSION_ID, 'safe')
    setPermissionMode(SESSION_ID, 'allow-all', {
      changedBy: 'user',
      changedAt: '2026-03-02T10:00:00.000Z',
    })
    const builder = makeBuilder()

    // Stable path never touches the one-shot signal.
    expect(builder.buildStableContextParts().join('\n')).not.toContain('modeChangeUserSignal:')

    // Volatile path emits it on the first call, then never again.
    const first = builder.buildVolatileContextParts(OPTS, SOURCE_BLOCK).join('\n')
    const second = builder.buildVolatileContextParts(OPTS, SOURCE_BLOCK).join('\n')
    expect(first).toContain('modeChangeUserSignal:')
    expect(second).not.toContain('modeChangeUserSignal:')
  })

  it('injects same-working-directory project memory only into volatile context', async () => {
    const workingDirectory = await mkdtemp(join(tmpdir(), 'agent-pi-project-memory-context-'))
    try {
      const brainPath = join(workingDirectory, PROJECT_MEMORY_DIR_NAME, PROJECT_MEMORY_BRAIN_DIR_NAME)
      await mkdir(brainPath, { recursive: true })
      await writeFile(join(brainPath, PROJECT_MEMORY_ENTRIES_FILE_NAME), `${JSON.stringify({
        type: 'formal_output_created',
        title: 'Cost summary',
        summary: 'The project established Schedule A as the dominant cost bucket.',
        trust: 'verified',
        outputPath: join(workingDirectory, 'Agent Pi Outputs', 'session-1', 'cost.md'),
        sourcePaths: [join(workingDirectory, 'boq.xlsx')],
      })}\n`, 'utf8')

      const builder = new TestAgent(createMockBackendConfig({
        workspace: createMockWorkspace({ rootPath: workingDirectory }),
        session: createMockSession({
          workspaceRootPath: workingDirectory,
          workingDirectory,
        }),
      })).getPromptBuilder()
      const volatileText = builder.buildVolatileContextParts(OPTS).join('\n')
      const stableText = builder.buildStableContextParts().join('\n')

      expect(volatileText).toContain('<project_memory_context>')
      expect(volatileText).toContain('Schedule A as the dominant cost bucket')
      expect(stableText).not.toContain('<project_memory_context>')
    } finally {
      await rm(workingDirectory, { recursive: true, force: true })
    }
  })
})
