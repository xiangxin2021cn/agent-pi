import type {
  SessionGoalAuditEvidence,
  SessionGoalAuditResult,
  SessionGoalState,
} from '@craft-agent/shared/sessions'

const DEFAULT_AUDIT_LIMIT = 3
const MISSING_CRITERIA_LIMIT = 3
const EVIDENCE_LIMIT = 4

export interface DocumentExpertReportViewModel {
  status: 'pass' | 'fail'
  score: number
  threshold: number
  dimensions: {
    structure: number
    evidence: number
    numbers: number
    specification: number
    risk: number
  }
  issues: string[]
  strengths: string[]
}

export interface GoalAuditViewModel {
  iteration: number
  status: SessionGoalAuditResult['status']
  summary: string
  missingCriteria: string[]
  hiddenMissingCriteriaCount: number
  evidence: SessionGoalAuditEvidence[]
  hiddenEvidenceCount: number
  documentExpertReport?: DocumentExpertReportViewModel
  createdAt: number
}

export function getGoalAuditViewModels(
  goalState: SessionGoalState | undefined,
  limit = DEFAULT_AUDIT_LIMIT,
): GoalAuditViewModel[] {
  if (!goalState?.auditHistory.length) return []

  return goalState.auditHistory
    .slice(-limit)
    .reverse()
    .map(result => {
      const documentExpertReport = parseDocumentExpertReport(result.evidence)
      const evidence = documentExpertReport
        ? result.evidence.filter(item => item.label !== 'document_quality_report')
        : result.evidence

      return {
        iteration: result.iteration,
        status: result.status,
        summary: result.summary,
        missingCriteria: result.missingCriteria.slice(0, MISSING_CRITERIA_LIMIT),
        hiddenMissingCriteriaCount: Math.max(0, result.missingCriteria.length - MISSING_CRITERIA_LIMIT),
        evidence: evidence.slice(0, EVIDENCE_LIMIT),
        hiddenEvidenceCount: Math.max(0, evidence.length - EVIDENCE_LIMIT),
        documentExpertReport,
        createdAt: result.createdAt,
      }
    })
}

function parseDocumentExpertReport(evidence: SessionGoalAuditEvidence[]): DocumentExpertReportViewModel | undefined {
  const detail = evidence.find(item => item.label === 'document_quality_report')?.detail
  if (!detail) return undefined

  const status = detail.match(/^status:\s*(pass|fail)/m)?.[1] as 'pass' | 'fail' | undefined
  const scoreMatch = detail.match(/^score:\s*(\d+)\/(\d+)/m)
  const dimensionsMatch = detail.match(/^dimensions:\s*structure=(\d+),\s*evidence=(\d+),\s*numbers=(\d+),\s*specification=(\d+),\s*risk=(\d+)/m)
  if (!status || !scoreMatch || !dimensionsMatch) return undefined

  return {
    status,
    score: Number(scoreMatch[1]),
    threshold: Number(scoreMatch[2]),
    dimensions: {
      structure: Number(dimensionsMatch[1]),
      evidence: Number(dimensionsMatch[2]),
      numbers: Number(dimensionsMatch[3]),
      specification: Number(dimensionsMatch[4]),
      risk: Number(dimensionsMatch[5]),
    },
    issues: parseBulletSection(detail, 'issues').filter(item => item !== 'none').slice(0, 3),
    strengths: parseBulletSection(detail, 'strengths').filter(item => item !== 'none').slice(0, 3),
  }
}

function parseBulletSection(detail: string, section: 'issues' | 'strengths'): string[] {
  const lines = detail.split('\n')
  const start = lines.findIndex(line => line.trim().startsWith(`${section}:`))
  if (start === -1) return []

  const firstLineValue = lines[start].trim().slice(`${section}:`.length).trim()
  const values = firstLineValue ? [firstLineValue] : []
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index].trim()
    if (line.startsWith('issues:') || line.startsWith('strengths:')) break
    values.push(line)
  }

  return values
    .map(line => line.replace(/^-\s*/, '').trim())
    .filter(Boolean)
}
