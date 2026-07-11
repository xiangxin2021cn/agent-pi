import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Message } from '@craft-agent/core/types'
import type { SessionGoalAuditResult, SessionGoalState, SessionOrchestrationArtifactPaths, SessionOrchestrationTask } from '@craft-agent/shared/sessions'
import { writeGoalEvidencePackage, writeOrchestrationTaskBrief } from './orchestration-artifacts'

const tempPaths: string[] = []

afterEach(() => {
  for (const path of tempPaths.splice(0)) rmSync(path, { recursive: true, force: true })
})

describe('orchestration evidence package', () => {
  it('rewrites the package with final audit status and requirement provenance', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agent-pi-evidence-package-'))
    tempPaths.push(root)
    const artifacts: SessionOrchestrationArtifactPaths = {
      rootPath: root,
      briefsPath: join(root, 'briefs'),
      reportsPath: join(root, 'reports'),
      evidencePackagesPath: join(root, 'evidence-packages'),
      progressLedgerPath: join(root, 'progress-ledger.json'),
    }
    const pendingState = makeGoalState('pending')
    const initialResult = makeAuditResult('uncertain', ['Final report'])
    const finalState = makeGoalState('satisfied')
    const finalResult = makeAuditResult('pass', [])
    finalResult.evidence.push({ type: 'file', label: 'file_verified_output', detail: 'C:/outputs/final.md' })

    const first = await writeGoalEvidencePackage({
      artifacts,
      goalState: pendingState,
      result: initialResult,
      messages: [message('u1', 'user', 'Create report.')],
    })
    await writeGoalEvidencePackage({
      artifacts,
      goalState: finalState,
      result: finalResult,
      messages: [message('u1', 'user', 'Create report.'), message('a1', 'assistant', 'Done.')],
      finalAssistant: message('a1', 'assistant', 'Done.'),
    })

    const payload = JSON.parse(readFileSync(first.detail!, 'utf-8'))
    expect(payload.audit.status).toBe('pass')
    expect(payload.audit.missingCriteria).toEqual([])
    expect(payload.requirementLedger.entries).toContainEqual(expect.objectContaining({
      id: 'req-del-1',
      status: 'satisfied',
      evidenceRefs: [expect.objectContaining({ label: 'file_verified_output' })],
    }))
    expect(payload.finalAssistant.content).toBe('Done.')
  })
})

describe('orchestration task brief', () => {
  it('keeps the brief evidence-neutral and lists exact allowed files', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agent-pi-brief-'))
    tempPaths.push(root)
    const artifacts: SessionOrchestrationArtifactPaths = {
      rootPath: root,
      briefsPath: join(root, 'briefs'),
      reportsPath: join(root, 'reports'),
      evidencePackagesPath: join(root, 'evidence-packages'),
      progressLedgerPath: join(root, 'progress-ledger.json'),
    }
    const task: SessionOrchestrationTask = {
      id: 'table-analysis',
      title: 'Drain schedule table analysis',
      phase: 'plan',
      role: 'source_evidence_agent',
      status: 'pending',
      scope: 'Analyze only N3 CH10+550 to CH12+050 rows and report unresolved side mapping.',
      dependencies: [],
      allowedSourceSlugs: ['drawing-source'],
      forbiddenActions: ['Do not broaden the requested range.'],
      expectedHandoff: ['task_id', 'evidence', 'gaps'],
    }

    const briefPath = await writeOrchestrationTaskBrief({
      artifacts,
      task,
      parentObjective: 'Which listed drains serve the N3 eastbound side between CH10+550 and CH12+050?',
      prompt: 'Assume Position L = Eastbound and prove coverage is 27.9%.',
      reportPath: join(root, 'reports', 'table-analysis.md'),
      workingDirectory: 'C:\\project',
      allowedSourceSlugs: ['drawing-source'],
      allowedFilePaths: ['C:\\session\\attachments\\drain-schedule.pdf'],
    })
    const brief = readFileSync(briefPath, 'utf-8')

    expect(brief).toContain('Which listed drains serve the N3 eastbound side')
    expect(brief).toContain('Analyze only N3 CH10+550 to CH12+050 rows')
    expect(brief).toContain('allowed_sources: drawing-source')
    expect(brief).toContain('allowed_files: C:\\session\\attachments\\drain-schedule.pdf')
    expect(brief).not.toContain('## Parent Prompt')
    expect(brief).not.toContain('27.9%')
    expect(brief).not.toContain('Assume Position L = Eastbound')
  })
})

function makeGoalState(status: 'pending' | 'satisfied'): SessionGoalState {
  return {
    id: 'goal-1',
    objective: 'Create report.',
    mode: 'check_only',
    status: status === 'satisfied' ? 'passed' : 'auditing',
    createdAt: 1,
    updatedAt: 2,
    iteration: 1,
    maxIterations: 1,
    criteria: [],
    auditHistory: [],
    taskContract: {
      originalRequest: 'Create report.',
      taskType: 'document',
      documentQualityMode: 'professional_document',
      deliverables: ['Final report'],
      mustPreserve: [],
      evidenceRequirements: [],
      outputFormats: ['MD'],
      acceptanceCriteria: [],
      forbiddenShortcuts: [],
      requirementLedger: {
        version: 1,
        entries: [{
          id: 'req-del-1',
          kind: 'deliverable',
          text: 'Final report',
          verification: 'Verify formal output.',
          sourceRefs: [],
          status,
          evidenceRefs: status === 'satisfied'
            ? [{ type: 'file', label: 'file_verified_output', detail: 'C:/outputs/final.md' }]
            : [],
        }],
      },
    },
  }
}

function makeAuditResult(status: 'pass' | 'uncertain', missingCriteria: string[]): SessionGoalAuditResult {
  return {
    iteration: 1,
    status,
    summary: status === 'pass' ? 'Passed.' : 'Pending.',
    missingCriteria,
    evidence: [],
    createdAt: 2,
  }
}

function message(id: string, role: Message['role'], content: string): Message {
  return { id, role, content, timestamp: 1 }
}
