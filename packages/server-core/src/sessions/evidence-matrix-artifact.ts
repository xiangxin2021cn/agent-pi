export interface EvidenceMatrixArtifactValidation {
  valid: boolean
  issues: string[]
  sourceCount: number
  verifiedClaimCount: number
  unverifiedClaims: string[]
}

export function validateEvidenceMatrixArtifact(content: string): EvidenceMatrixArtifactValidation {
  let value: unknown
  try {
    value = JSON.parse(content)
  } catch {
    return invalid('Evidence matrix must be valid JSON.')
  }

  if (!isRecord(value)) return invalid('Evidence matrix root must be a JSON object.')
  const issues: string[] = []
  if (value.schemaVersion !== 1) issues.push('Evidence matrix schemaVersion must be 1.')
  if (!Array.isArray(value.sources) || value.sources.length === 0) issues.push('Evidence matrix sources must be a non-empty array.')
  if (!Array.isArray(value.claims) || value.claims.length === 0) issues.push('Evidence matrix claims must be a non-empty array.')

  const sources = Array.isArray(value.sources) ? value.sources : []
  const sourceIds = new Set<string>()
  for (const source of sources) {
    if (!isRecord(source) || !isNonEmptyString(source.id) || !isNonEmptyString(source.name) || !isNonEmptyString(source.type)) {
      issues.push('Every evidence matrix source requires non-empty id, name, and type fields.')
      continue
    }
    if (sourceIds.has(source.id)) issues.push(`Duplicate evidence matrix source id: ${source.id}.`)
    sourceIds.add(source.id)
  }

  const claims = Array.isArray(value.claims) ? value.claims : []
  let verifiedClaimCount = 0
  const unverifiedClaims: string[] = []
  for (const claim of claims) {
    if (!isRecord(claim)
      || !isNonEmptyString(claim.id)
      || !isNonEmptyString(claim.claim)
      || !isNonEmptyString(claim.sourceId)
      || !isNonEmptyString(claim.locator)
      || !isEvidenceStatus(claim.status)) {
      issues.push('Every evidence matrix claim requires id, claim, sourceId, locator, and a valid status.')
      continue
    }
    if (!sourceIds.has(claim.sourceId)) issues.push(`Evidence matrix claim ${claim.id} references unknown sourceId ${claim.sourceId}.`)
    if (claim.status === 'verified') verifiedClaimCount += 1
    else unverifiedClaims.push(claim.claim)
  }

  return {
    valid: issues.length === 0,
    issues: [...new Set(issues)],
    sourceCount: sourceIds.size,
    verifiedClaimCount,
    unverifiedClaims,
  }
}

function invalid(issue: string): EvidenceMatrixArtifactValidation {
  return { valid: false, issues: [issue], sourceCount: 0, verifiedClaimCount: 0, unverifiedClaims: [] }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isEvidenceStatus(value: unknown): value is 'verified' | 'assumption' | 'unverified' {
  return value === 'verified' || value === 'assumption' || value === 'unverified'
}
