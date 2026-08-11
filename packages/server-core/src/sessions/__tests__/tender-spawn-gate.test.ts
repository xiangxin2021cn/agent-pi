import { describe, expect, it } from 'bun:test'
import {
  decideTenderParentSpawnGate,
  defaultTenderAgentSpawnConcurrency,
  isTenderControlledDispatchStage,
} from '../tender-spawn-gate'

describe('decideTenderParentSpawnGate', () => {
  it('allows non-tender sessions', () => {
    expect(decideTenderParentSpawnGate({ activeSpawnCount: 10 })).toEqual({ allowed: true })
  })

  it('allows parent agent spawn during document analysis under concurrency', () => {
    const decision = decideTenderParentSpawnGate({
      businessContext: { module: 'tender', stageId: 'tender-document-analysis' },
      dispatchSource: 'agent',
      activeSpawnCount: 1,
    })
    expect(decision.allowed).toBe(true)
    expect(decision.concurrencyLimit).toBe(4)
  })

  it('blocks parent agent flood beyond stage concurrency (default 4)', () => {
    const decision = decideTenderParentSpawnGate({
      businessContext: { module: 'tender', stageId: 'tender-document-analysis' },
      dispatchSource: 'agent',
      activeSpawnCount: 4,
    })
    expect(decision.allowed).toBe(false)
    expect(decision.reason).toBe('tender-stage-concurrency')
    expect(decision.message).toContain('(4/4)')
  })

  it('allows stage-controller dispatch even when agent slots are full', () => {
    expect(decideTenderParentSpawnGate({
      businessContext: { module: 'tender', stageId: 'tender-document-analysis' },
      dispatchSource: 'stage-controller',
      activeSpawnCount: 99,
    }).allowed).toBe(true)
  })

  it('uses BOQ default concurrency of 4 for agent spawns', () => {
    expect(decideTenderParentSpawnGate({
      businessContext: { module: 'tender', stageId: 'boq-five-step-pricing' },
      activeSpawnCount: 0,
    }).concurrencyLimit).toBe(4)
    expect(decideTenderParentSpawnGate({
      businessContext: { module: 'tender', stageId: 'boq-five-step-pricing' },
      activeSpawnCount: 4,
    }).allowed).toBe(false)
  })

  it('honors boardMaxConcurrency override', () => {
    expect(decideTenderParentSpawnGate({
      businessContext: { module: 'tender', stageId: 'tender-document-analysis' },
      activeSpawnCount: 4,
      boardMaxConcurrency: 5,
    }).allowed).toBe(true)
  })

  it('allows parent spawn during project-setup / planning without stage cap', () => {
    expect(decideTenderParentSpawnGate({
      businessContext: { module: 'tender', stageId: 'project-setup' },
      activeSpawnCount: 3,
    }).allowed).toBe(true)
  })
})

describe('isTenderControlledDispatchStage', () => {
  it('recognizes controlled stages and aliases', () => {
    expect(isTenderControlledDispatchStage('tender-document-analysis')).toBe(true)
    expect(isTenderControlledDispatchStage('boq-five-step-pricing')).toBe(true)
    expect(isTenderControlledDispatchStage('bidder-commitments')).toBe(true)
    expect(isTenderControlledDispatchStage('project-setup')).toBe(false)
  })
})

describe('defaultTenderAgentSpawnConcurrency', () => {
  it('returns stage defaults', () => {
    expect(defaultTenderAgentSpawnConcurrency('tender-document-analysis')).toBe(4)
    expect(defaultTenderAgentSpawnConcurrency('boq-five-step-pricing')).toBe(4)
    expect(defaultTenderAgentSpawnConcurrency('project-setup')).toBeUndefined()
  })
})
