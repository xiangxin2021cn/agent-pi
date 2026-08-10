import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type { HandlerFn, RpcServer } from '../../transport/types.ts'
import { registerBusinessProjectHandlers } from './business-projects.ts'
import { registerTenderWorkspaceHandlers } from './tender-workspace.ts'

const requestContext = { clientId: 'test', workspaceId: 'workspace-test', webContentsId: 1 }

function harness() {
  const handlers = new Map<string, HandlerFn>()
  const server: RpcServer = {
    handle(channel, handler) { handlers.set(channel, handler) },
    push() {},
    async invokeClient() { return undefined },
    hasClientCapability() { return false },
    findClientsWithCapability() { return [] },
  }
  registerBusinessProjectHandlers(server)
  registerTenderWorkspaceHandlers(server)
  return handlers
}

describe('tender stage pipeline RPC integration', () => {
  let root = ''

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true })
  })

  test('registers project sources, completes document batches, and merges controlled BOQ pricing batches', async () => {
    root = mkdtempSync(join(tmpdir(), 'tender-stage-pipeline-'))
    const workspaceRootPath = join(root, 'workspace')
    const projectRoot = join(root, 'project')
    const specificationPath = join(root, 'Technical Specification.pdf')
    const boqPath = join(root, 'Pricing Schedule BOQ.xlsx')
    writeFileSync(specificationPath, 'specification')
    writeFileSync(boqPath, 'boq')

    const handlers = harness()
    const createProject = handlers.get(RPC_CHANNELS.businessProjects.CREATE)!
    const runStage = handlers.get(RPC_CHANNELS.tenderWorkspace.STAGE_RUN)!
    const mutateTender = handlers.get(RPC_CHANNELS.tenderWorkspace.MUTATE)!

    await createProject(requestContext, {
      workspaceRootPath,
      module: 'tender',
      projectId: 'n3-tender',
      name: 'N3 Tender',
      rootPath: projectRoot,
      workflowId: 'tender-main',
      createDirectory: true,
      inputPaths: [specificationPath, boqPath],
    })

    const documentStarted = await runStage(requestContext, {
      action: 'start', workspaceRootPath, projectId: 'n3-tender', stageId: 'tender-document-analysis',
    }) as any
    expect(documentStarted.status).toBe('running')
    expect(documentStarted.sourceBoundary.registeredCount).toBe(2)
    expect(documentStarted.batchProgress).toEqual(expect.objectContaining({
      batchType: 'document_analysis', itemCount: 2, batchCount: 2, completedBatches: 0,
    }))

    const documentManifest = readJson<any>(documentStarted.paths.documentAnalysisBatchManifestPath)
    const mergedSections: any[] = []
    for (const batch of documentManifest.batches) {
      const brief = readJson<any>(batch.briefPath)
      expect(brief.allowedSources).toEqual([{ documentId: batch.documentId, path: batch.sourcePath }])
      expect(brief.reportPath).toBe(batch.reportPath)
      expect(brief.spawnPolicy).toBe('forbidden')
      const section = {
        id: `${batch.documentId}-summary`,
        kind: 'project_information',
        title: 'Registered source summary',
        summary: 'Evidence-linked analysis of the assigned registered source.',
        sourceRefs: [{ documentId: batch.documentId, page: 1 }],
        status: 'reviewed',
      }
      writeJson(batch.reportPath, {
        schemaVersion: 1,
        batchId: batch.batchId,
        documentId: batch.documentId,
        sections: [section],
      })
      mergedSections.push({ ...section, documentId: batch.documentId })
    }

    const boundary = readJson<any>(documentStarted.paths.sourceBoundaryPath)
    const specificationDocumentId = boundary.files.find((file: any) => file.path === specificationPath).documentId
    const boqDocumentId = boundary.files.find((file: any) => file.path === boqPath).documentId
    const boq = buildBoq(boqDocumentId, specificationDocumentId)

    await writeCapability(mutateTender, projectRoot, 'document_analysis', { sections: mergedSections })
    await writeCapability(mutateTender, projectRoot, 'evaluation_strategy', { strategies: [] })
    await writeCapability(mutateTender, projectRoot, 'boq_reconciliation', boq)

    const documentCompleted = await runStage(requestContext, {
      action: 'complete', workspaceRootPath, projectId: 'n3-tender', stageId: 'tender-document-analysis',
    }) as any
    expect(documentCompleted.status).toBe('complete')
    expect(documentCompleted.batchProgress.completedBatches).toBe(2)
    expect(documentCompleted.missingItems).toEqual([])

    const pricingStarted = await runStage(requestContext, {
      action: 'start', workspaceRootPath, projectId: 'n3-tender', stageId: 'boq-five-step-pricing',
    }) as any
    expect(pricingStarted.status).toBe('running')
    // V2.4.0: chapter-aware batching — one C5.1 chapter of 41 items splits at 25.
    expect(pricingStarted.batchProgress).toEqual(expect.objectContaining({
      batchType: 'boq_five_step_pricing', itemCount: 41, batchCount: 2, completedBatches: 0,
    }))

    const pricingManifest = readJson<any>(pricingStarted.paths.boqBatchManifestPath)
    expect(pricingManifest.batches.map((batch: any) => batch.itemIds.length)).toEqual([25, 16])
    const allBuildUps: any[] = []
    for (const batch of pricingManifest.batches) {
      const brief = readJson<any>(batch.briefPath)
      expect(brief.itemIds).toEqual(batch.itemIds)
      expect(brief.scope.documentId).toBe(boqDocumentId)
      expect(brief.allowedSources).toEqual(expect.arrayContaining([
        { documentId: boqDocumentId, path: boqPath },
        { documentId: specificationDocumentId, path: specificationPath },
      ]))
      expect(brief.reportPath).toBe(batch.reportPath)
      expect(brief.spawnPolicy).toBe('forbidden')
      const buildUps = batch.itemIds.map((itemId: string) => buildUp(itemId, boqDocumentId, specificationDocumentId))
      writeJson(batch.reportPath, { schemaVersion: 1, batchId: batch.batchId, itemBuildUps: buildUps })
      allBuildUps.push(...buildUps)
    }

    // All batches complete → the runtime owns the deterministic merge; the
    // inline payload is ignored by design (V2.3.4/V2.4.0 anti-loop rule).
    await writeCapability(mutateTender, projectRoot, 'boq_five_step_pricing', {
      currency: 'ZAR',
      pricingStandard: 'c51_pure_direct_cost_v1',
      vatTreatment: 'exclusive',
      indirectCostPolicy: 'excluded_from_item_direct_cost',
      pricingStatus: 'reviewed',
      itemBuildUps: allBuildUps,
      resourceSummary: [],
      assumptions: [],
    })

    // V2.4.0: the consolidated pricing stage also requires user-confirmed
    // bidder commitments before it can complete.
    const indexPath = join(
      projectRoot, '.agent-pi', 'business', 'tender', 'n3-tender', 'capability-index.json',
    )
    const index = readJson<any>(indexPath)
    index.capabilities.push({
      capability: 'bidder_commitments', enabled: true, required: true, revision: 1,
      readiness: 'ready', issueCount: 0, stale: false, updatedAt: '2026-08-10T00:00:00.000Z',
    })
    writeJson(indexPath, index)

    const pricingCompleted = await runStage(requestContext, {
      action: 'complete', workspaceRootPath, projectId: 'n3-tender', stageId: 'boq-five-step-pricing',
    }) as any
    expect(pricingCompleted.status).toBe('complete')
    expect(pricingCompleted.batchProgress).toEqual(expect.objectContaining({
      batchCount: 2, completedBatches: 2, missingItemCount: 0,
    }))
    expect(pricingCompleted.missingItems).toEqual([])
  })
})

async function writeCapability(
  mutateTender: HandlerFn,
  workingDirectory: string,
  capability: string,
  data: unknown,
) {
  const result = await mutateTender(requestContext, {
    workingDirectory,
    target: 'capability',
    args: { action: 'init', projectId: 'n3-tender', capability, data, enabled: true, required: true },
  }) as any
  expect(result.audit.issues).toEqual([])
  expect(result.effectiveReadiness).toBe('ready')
}

function buildBoq(boqDocumentId: string, tenderDocumentId: string) {
  const items = Array.from({ length: 41 }, (_, index) => {
    const number = index + 1
    return {
      id: `item-${number}`,
      source: { documentId: boqDocumentId, sheet: 'C5.1', cell: `A${number}:F${number}` },
      code: `5.1.${number}`,
      description: `BOQ item ${number}`,
      unit: 'm',
      quantity: '1',
      quantityBasis: 'boq',
      quantityStatus: 'sourced',
      quantityRefs: [{ documentId: boqDocumentId, sheet: 'C5.1', cell: `F${number}` }],
    }
  })
  return {
    items,
    scopeLinks: items.map((item) => ({
      boqItemId: item.id,
      requirementIds: [],
      specificationRefs: [{ documentId: tenderDocumentId, page: 1, clause: 'C5.1' }],
      drawingRefs: [],
      measurementRuleRefs: [{ documentId: tenderDocumentId, page: 1, clause: 'C5.1' }],
      inclusions: ['Assigned BOQ scope'],
      exclusions: [],
      assumptions: [],
      gapStatus: 'clear',
    })),
  }
}

function buildUp(boqItemId: string, boqDocumentId: string, tenderDocumentId: string) {
  const number = Number(boqItemId.split('-').at(-1))
  const rowSource = { documentId: boqDocumentId, sheet: 'C5.1', cell: `A${number}:F${number}` }
  const specificationSource = { documentId: tenderDocumentId, page: 1, clause: 'C5.1' }
  const boqStep = {
    narrative: 'Quantity and scope are traced to the assigned BOQ item.',
    sourceRefs: [rowSource],
  }
  const tenderStep = {
    narrative: 'Method, productivity, consumption, rates, and risk are supported by the registered tender source.',
    sourceRefs: [specificationSource],
  }
  return {
    boqItemId,
    status: 'reviewed',
    steps: {
      scopeQuantity: boqStep,
      methodProductivity: tenderStep,
      resourceConsumption: tenderStep,
      sourcedRatesDirectCost: tenderStep,
      reconciliationRisk: tenderStep,
    },
    itemIdentity: {
      code: `5.1.${number}`, description: `BOQ item ${number}`, unit: 'm', quantity: '1', sourceRef: rowSource,
    },
    scopeBasis: {
      specificationRefs: [specificationSource], measurementRuleRefs: [specificationSource],
      inclusions: ['Assigned BOQ scope'], exclusions: ['General overhead and profit'],
      testingRequirements: ['Acceptance check'], methodConstraints: ['Execute to specification'],
    },
    productivityBasis: {
      methodSequence: ['Set out', 'Execute', 'Inspect'],
      crew: [{ id: `${boqItemId}-crew`, kind: 'labour', description: 'Work crew', count: '1', assumptionStatus: 'sourced', sourceRefs: [specificationSource] }],
      workingHoursPerDay: '8', bottleneck: 'Crew output', theoreticalProductionRate: '2',
      calculationFormula: '2 m/day x effective factor',
      scenarios: [
        { scenario: 'optimistic', productionRate: '1.2', quantityUnit: 'm', timeUnit: 'working_day', effectiveFactor: '0.6', basis: 'Good conditions', assumptionStatus: 'scenario', sourceRefs: [specificationSource] },
        { scenario: 'base', productionRate: '1', quantityUnit: 'm', timeUnit: 'working_day', effectiveFactor: '0.5', basis: 'Normal conditions', assumptionStatus: 'sourced', sourceRefs: [specificationSource] },
        { scenario: 'pessimistic', productionRate: '0.8', quantityUnit: 'm', timeUnit: 'working_day', effectiveFactor: '0.4', basis: 'Constrained conditions', assumptionStatus: 'scenario', sourceRefs: [specificationSource] },
      ],
    },
    resourceCoverage: [
      { kind: 'labour', applicability: 'included', basis: 'Direct crew' },
      { kind: 'plant', applicability: 'not_applicable', basis: 'No plant' },
      { kind: 'material', applicability: 'not_applicable', basis: 'No material' },
      { kind: 'subcontract', applicability: 'not_applicable', basis: 'Self-performed' },
      { kind: 'transport', applicability: 'not_applicable', basis: 'No transport' },
      { kind: 'waste', applicability: 'not_applicable', basis: 'No waste' },
    ],
    resourceConsumptions: [{
      id: `${boqItemId}-labour-consumption`, kind: 'labour', description: 'Labour', quantity: '1', unit: 'hour/m',
      assumptionStatus: 'sourced', quantityBasis: 'per_boq_unit', calculationBasis: 'One hour per metre',
      costComponentId: `${boqItemId}-labour`, sourceRefs: [specificationSource],
    }],
    planningBasis: {
      methodId: 'linear-installation',
      productionRate: '1',
      quantityUnit: 'm',
      timeUnit: 'working_day',
      duration: '1',
      calendarId: 'calendar-standard',
      activityId: `activity-${boqItemId}`,
      assumptionStatus: 'sourced',
      sourceRefs: [specificationSource],
    },
    initialCashFlow: [{
      period: '2026-08',
      activityId: `activity-${boqItemId}`,
      weight: '1',
      amount: '10',
      basis: 'Single-period initial allocation.',
      assumptionStatus: 'sourced',
      sourceRefs: [specificationSource],
    }],
    costComponents: [{
      id: `${boqItemId}-labour`,
      kind: 'labour',
      description: 'Labour',
      quantity: '1',
      unit: 'hour/m',
      rate: '10',
      amount: '10',
      rateSourceRef: { documentId: tenderDocumentId, page: 1 },
      rateBasis: {
        sourceType: 'published_schedule', acquisitionMode: 'not_applicable', location: 'Durban',
        effectiveDate: '2026-07-16', vatTreatment: 'exclusive',
      },
      assumptionStatus: 'sourced',
    }],
    directCost: '10',
    directCostSummary: {
      labour: '10', plant: '0', material: '0', subcontract: '0', transport: '0', waste: '0', other: '0',
      unitDirectCost: '10', boqQuantity: '1', itemDirectCost: '10',
    },
    riskScenarios: [{
      id: `${boqItemId}-risk`, variable: 'Crew productivity', optimistic: '1.2 m/day', base: '1 m/day',
      pessimistic: '0.8 m/day', trigger: 'Restricted access', treatment: 'Rebalance crew',
      assumptionStatus: 'sourced', sourceRefs: [specificationSource],
    }],
    conditions: [],
    riskNotes: [],
  }
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}
