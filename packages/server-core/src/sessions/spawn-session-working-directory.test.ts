import { describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  buildSpawnedSessionGovernancePrompt,
  resolveExplicitSpawnDispatchPaths,
  resolveSpawnedSessionWorkingDirectory,
} from './SessionManager'

describe('spawn_session working directory inheritance', () => {
  it('uses an explicit spawned-session working directory when provided', () => {
    expect(resolveSpawnedSessionWorkingDirectory('C:/child', 'C:/parent')).toBe('C:/child')
  })

  it('inherits the parent session working directory when omitted', () => {
    expect(resolveSpawnedSessionWorkingDirectory(undefined, 'C:/parent-project')).toBe('C:/parent-project')
  })

  it('preserves parent no-working-directory sessions instead of falling back to workspace default', () => {
    expect(resolveSpawnedSessionWorkingDirectory(undefined, undefined)).toBe('none')
  })

  it('adds governance instructions to spawned prompts when parent orchestration is active', () => {
    const prompt = buildSpawnedSessionGovernancePrompt('Price MEDIAN BARRIER only.', {
      parentObjective: 'Only price the MEDIAN BARRIER page.',
      orchestration: {
        version: 1,
        phase: 'plan',
        createdAt: 1,
        updatedAt: 1,
        policy: {
          selectedSourceSlugs: ['kb-median-barrier'],
          forbidWorkingDirectoryDiscovery: true,
          requireStructuredHandoff: true,
          requireUserConfirmationPause: true,
          maxAutomaticRepairPasses: 2,
        },
        taskBoard: { tasks: [] },
        subAgents: [],
      },
    })

    expect(prompt).toContain('<spawned_session_contract>')
    expect(prompt).toContain('selected_sources: kb-median-barrier')
    expect(prompt).toContain('spawn_session: forbidden')
    expect(prompt).toContain('Price MEDIAN BARRIER only.')
  })

  it('narrows spawned prompts to a task brief path, allowed sources, and report path when provided', () => {
    const prompt = buildSpawnedSessionGovernancePrompt('Original broad prompt that should be externalized.', {
      parentObjective: 'Only price the MEDIAN BARRIER page.',
      taskBriefPath: 'C:/session/orchestration/briefs/task-1.md',
      reportPath: 'C:/session/orchestration/reports/task-1.md',
      evidencePackagesPath: 'C:/session/orchestration/evidence-packages',
      orchestration: {
        version: 1,
        phase: 'plan',
        createdAt: 1,
        updatedAt: 1,
        policy: {
          selectedSourceSlugs: ['kb-median-barrier'],
          forbidWorkingDirectoryDiscovery: true,
          requireStructuredHandoff: true,
          requireUserConfirmationPause: true,
          maxAutomaticRepairPasses: 2,
        },
        taskBoard: { tasks: [] },
        subAgents: [],
      },
    })

    expect(prompt).toContain('brief_path: C:/session/orchestration/briefs/task-1.md')
    expect(prompt).toContain('allowed_sources: kb-median-barrier')
    expect(prompt).toContain('report_path: C:/session/orchestration/reports/task-1.md')
    expect(prompt).toContain('evidence_packages_path: C:/session/orchestration/evidence-packages')
    expect(prompt).not.toContain('Original broad prompt that should be externalized.')
  })

  it('enforces an explicit brief contract even when the parent has no goal orchestration state', () => {
    const prompt = buildSpawnedSessionGovernancePrompt('Do not expose this broad fallback.', {
      taskBriefPath: 'C:/project/brief.json',
      reportPath: 'C:/project/report.json',
    })

    expect(prompt).toContain('brief_path: C:/project/brief.json')
    expect(prompt).toContain('report_path: C:/project/report.json')
    expect(prompt).toContain('spawn_session: forbidden')
    expect(prompt).not.toContain('Do not expose this broad fallback.')
  })

  it('accepts paired explicit dispatch paths inside the child working directory', () => {
    const root = mkdtempSync(join(tmpdir(), 'agent-pi-spawn-dispatch-'))
    const briefPath = join(root, 'orchestration', 'briefs', 'batch.json')
    const reportPath = join(root, 'orchestration', 'reports', 'batch.json')
    mkdirSync(join(root, 'orchestration', 'briefs'), { recursive: true })
    writeFileSync(briefPath, '{}', { flag: 'wx' })

    expect(resolveExplicitSpawnDispatchPaths({ briefPath, reportPath }, root)).toEqual({ briefPath, reportPath })
  })

  it('rejects incomplete or out-of-bound explicit dispatch paths', () => {
    const root = mkdtempSync(join(tmpdir(), 'agent-pi-spawn-dispatch-'))
    const briefPath = join(root, 'brief.json')
    writeFileSync(briefPath, '{}', { flag: 'wx' })

    expect(() => resolveExplicitSpawnDispatchPaths({ briefPath }, root)).toThrow('must be provided together')
    expect(() => resolveExplicitSpawnDispatchPaths({
      briefPath,
      reportPath: join(root, '..', 'outside-report.json'),
    }, root)).toThrow('inside the spawned session working directory')
  })
})
