import type {
  SessionGoalAuditEvidence,
  SessionGoalFailureCategory,
  SessionGoalAuditResult,
  SessionGoalState,
} from '@craft-agent/shared/sessions'

const DEFAULT_AUDIT_LIMIT = 3
const MISSING_CRITERIA_LIMIT = 3
const EVIDENCE_LIMIT = 4
const FAILURE_CATEGORY_LIMIT = 3

export interface GoalAuditFailureCategoryViewModel {
  id: SessionGoalFailureCategory
  labelKey: string
}

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

export interface QualityRouteViewModel {
  task: string
  health: 'no_history' | 'mixed' | 'degraded' | string
  roles: string[]
  commonGaps: string[]
  routeHistory?: string
  extraReviewersUsed: number
  extraReviewersLimit: number
  addedRouteHistoryReviewer: boolean
}

export interface GoalAuditViewModel {
  iteration: number
  status: SessionGoalAuditResult['status']
  summary: string
  missingCriteria: string[]
  hiddenMissingCriteriaCount: number
  failureCategories: GoalAuditFailureCategoryViewModel[]
  hiddenFailureCategoryCount: number
  evidence: SessionGoalAuditEvidence[]
  hiddenEvidenceCount: number
  documentExpertReport?: DocumentExpertReportViewModel
  qualityRoute?: QualityRouteViewModel
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
      const qualityRoute = parseQualityRoute(result.evidence)
      const evidence = result.evidence.filter(item => {
        if (documentExpertReport && item.label === 'document_quality_report') return false
        if (qualityRoute && item.label === 'quality_route') return false
        return true
      })

      return {
        iteration: result.iteration,
        status: result.status,
        summary: result.summary,
        missingCriteria: result.missingCriteria.slice(0, MISSING_CRITERIA_LIMIT),
        hiddenMissingCriteriaCount: Math.max(0, result.missingCriteria.length - MISSING_CRITERIA_LIMIT),
        failureCategories: mapFailureCategories(result.failureCategories).slice(0, FAILURE_CATEGORY_LIMIT),
        hiddenFailureCategoryCount: Math.max(0, (result.failureCategories?.length ?? 0) - FAILURE_CATEGORY_LIMIT),
        evidence: evidence.slice(0, EVIDENCE_LIMIT),
        hiddenEvidenceCount: Math.max(0, evidence.length - EVIDENCE_LIMIT),
        documentExpertReport,
        qualityRoute,
        createdAt: result.createdAt,
      }
    })
}

function mapFailureCategories(categories: SessionGoalFailureCategory[] | undefined): GoalAuditFailureCategoryViewModel[] {
  if (!categories?.length) return []

  const labelKeys: Record<SessionGoalFailureCategory, string> = {
    scope_gap: 'sessionInfo.goalAuditFailureScope',
    evidence_gap: 'sessionInfo.goalAuditFailureEvidence',
    verification_gap: 'sessionInfo.goalAuditFailureVerification',
    shallow_output: 'sessionInfo.goalAuditFailureShallowOutput',
    tool_failure: 'sessionInfo.goalAuditFailureTool',
  }

  return categories
    .filter((category): category is SessionGoalFailureCategory => category in labelKeys)
    .map(category => ({
      id: category,
      labelKey: labelKeys[category],
    }))
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

function parseQualityRoute(evidence: SessionGoalAuditEvidence[]): QualityRouteViewModel | undefined {
  const detail = evidence.find(item => item.label === 'quality_route')?.detail
  if (!detail) return undefined

  const fields = Object.fromEntries(detail
    .split(';')
    .map(part => {
      const separator = part.indexOf('=')
      if (separator === -1) return undefined
      const key = part.slice(0, separator).trim()
      const value = part.slice(separator + 1).trim()
      return key ? [key, value] : undefined
    })
    .filter((entry): entry is [string, string] => Boolean(entry)))

  const task = fields.task || 'unknown'
  const health = fields.route_health || 'no_history'
  const roles = parseCommaList(fields.roles)
  const commonGaps = parseCommaList(fields.common_gaps).filter(item => item !== 'none')
  const extraReviewers = parseExtraReviewers(fields.extra_reviewers)

  return {
    task,
    health,
    roles,
    commonGaps,
    routeHistory: fields.route_history && fields.route_history !== 'none' ? fields.route_history : undefined,
    extraReviewersUsed: extraReviewers.used,
    extraReviewersLimit: extraReviewers.limit,
    addedRouteHistoryReviewer: roles.includes('route_history_reviewer') || extraReviewers.used > 0,
  }
}

function parseCommaList(value: string | undefined): string[] {
  if (!value) return []
  return value
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
}

function parseExtraReviewers(value: string | undefined): { used: number; limit: number } {
  const match = value?.match(/^(\d+)\/(\d+)$/)
  if (!match) return { used: 0, limit: 0 }
  return {
    used: Number(match[1]),
    limit: Number(match[2]),
  }
}
