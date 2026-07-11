import { describe, expect, it } from 'bun:test'
import { validateEvidenceMatrixArtifact } from './evidence-matrix-artifact'

describe('structured evidence matrix artifact', () => {
  it('rejects Markdown stored under a json filename', () => {
    const result = validateEvidenceMatrixArtifact('# Evidence Matrix\n\n| Claim | Source |')

    expect(result.valid).toBe(false)
    expect(result.issues).toContain('Evidence matrix must be valid JSON.')
  })

  it('accepts the versioned source and claim schema', () => {
    const result = validateEvidenceMatrixArtifact(JSON.stringify({
      schemaVersion: 1,
      sources: [{ id: 'source-1', name: 'drain-schedule.pdf', type: 'file' }],
      claims: [{
        id: 'claim-1',
        claim: 'DRAIN 278 is listed from CH11+402 to CH11+620.',
        sourceId: 'source-1',
        locator: 'Sheet 2, N3 Median Drain Details, DRAIN 278 row',
        status: 'verified',
      }],
    }))

    expect(result).toEqual({
      valid: true,
      issues: [],
      sourceCount: 1,
      verifiedClaimCount: 1,
      unverifiedClaims: [],
    })
  })

  it('returns assumption and unverified claims for core-conclusion gating', () => {
    const result = validateEvidenceMatrixArtifact(JSON.stringify({
      schemaVersion: 1,
      sources: [{ id: 'source-1', name: 'supplier-note.txt', type: 'file' }],
      claims: [{
        id: 'claim-1',
        claim: 'The supplier lead time is 14 days.',
        sourceId: 'source-1',
        locator: 'No verified locator',
        status: 'unverified',
      }],
    }))

    expect(result.valid).toBe(true)
    expect(result.unverifiedClaims).toEqual(['The supplier lead time is 14 days.'])
  })
})
