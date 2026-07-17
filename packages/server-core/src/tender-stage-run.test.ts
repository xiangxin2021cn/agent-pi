import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBusinessProject } from '@craft-agent/shared/business-projects';
import type { SpawnSessionRequest } from '@craft-agent/shared/agent';
import { runTenderStage } from './tender-stage-run.ts';

describe('tender stage runner', () => {
  let root = '';

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  test('preflight builds a source boundary and registers Business Project inputs', async () => {
    const fixture = createFixture();

    const result = await runTenderStage({
      action: 'preflight',
      workspaceRootPath: fixture.workspaceRoot,
      projectId: 'n3-tender',
      stageId: 'project-setup',
    });

    expect(result.status).toBe('ready');
    expect(result.sourceBoundary.registeredCount).toBe(2);
    expect(result.sourceBoundary.missingPaths).toEqual([]);
    expect(existsSync(result.paths.sourceBoundaryPath)).toBe(true);
    const boundary = JSON.parse(readFileSync(result.paths.sourceBoundaryPath, 'utf8'));
    expect(boundary.files.map((file: any) => file.priority)).toEqual([1, 2]);
    expect(boundary.files.map((file: any) => file.kind)).toEqual(['tender_data', 'boq']);

    const workspace = JSON.parse(readFileSync(result.paths.workspacePath, 'utf8'));
    expect(workspace.documents).toHaveLength(2);
    expect(workspace.documents.map((document: any) => document.kind)).toEqual(['tender_data', 'boq']);
  });

  test('persists start, status, and completion state', async () => {
    const fixture = createFixture();
    await runTenderStage({
      action: 'preflight', workspaceRootPath: fixture.workspaceRoot,
      projectId: 'n3-tender', stageId: 'project-setup',
    });
    const started = await runTenderStage({
      action: 'start', workspaceRootPath: fixture.workspaceRoot,
      projectId: 'n3-tender', stageId: 'project-setup',
    });
    const status = await runTenderStage({
      action: 'status', workspaceRootPath: fixture.workspaceRoot,
      projectId: 'n3-tender', stageId: 'project-setup',
    });
    const completed = await runTenderStage({
      action: 'complete', workspaceRootPath: fixture.workspaceRoot,
      projectId: 'n3-tender', stageId: 'project-setup',
    });

    expect(started.status).toBe('running');
    expect(status.status).toBe('complete');
    expect(completed.status).toBe('complete');
    expect(existsSync(completed.paths.stageStatePath)).toBe(true);
  });

  test('blocks a stage when required upstream capability packs are not ready', async () => {
    const fixture = createFixture();

    const result = await runTenderStage({
      action: 'start',
      workspaceRootPath: fixture.workspaceRoot,
      projectId: 'n3-tender',
      stageId: 'boq-five-step-pricing',
    });

    expect(result.status).toBe('blocked');
    expect(result.missingItems).toContain('capability:document_analysis');
    expect(result.missingItems).toContain('capability:boq_reconciliation');
  });

  test('keeps schedule/resources and cost/cashflow as separate gated stages', async () => {
    const fixture = createFixture();
    await runTenderStage({
      action: 'preflight', workspaceRootPath: fixture.workspaceRoot,
      projectId: 'n3-tender', stageId: 'project-setup',
    });
    const projectDirectory = join(fixture.projectRoot, '.agent-pi', 'business', 'tender', 'n3-tender');
    mkdirSync(projectDirectory, { recursive: true });
    const entry = (capability: string) => ({
      capability, enabled: true, required: true, revision: 1, readiness: 'ready',
      issueCount: 0, stale: false, updatedAt: '2026-07-16T00:00:00.000Z',
    });
    writeFileSync(join(projectDirectory, 'capability-index.json'), JSON.stringify({
      schemaVersion: 1,
      projectId: 'n3-tender',
      coreRevision: 2,
      capabilities: [
        entry('boq_reconciliation'),
        entry('boq_five_step_pricing'),
        entry('execution_plan'),
      ],
    }));

    const schedule = await runTenderStage({
      action: 'start', workspaceRootPath: fixture.workspaceRoot,
      projectId: 'n3-tender', stageId: 'schedule-resource-planning',
    });
    const costBlocked = await runTenderStage({
      action: 'start', workspaceRootPath: fixture.workspaceRoot,
      projectId: 'n3-tender', stageId: 'cost-cashflow-planning',
    });

    expect(schedule.status).toBe('running');
    expect(schedule.producedCapabilities).toEqual(['schedule_resources']);
    expect(costBlocked.status).toBe('blocked');
    expect(costBlocked.missingItems).toContain('capability:schedule_resources');
  });

  test('creates one document-analysis batch per registered source and gates the stage merge', async () => {
    const fixture = createFixture();
    const started = await runTenderStage({
      action: 'start', workspaceRootPath: fixture.workspaceRoot,
      projectId: 'n3-tender', stageId: 'tender-document-analysis',
    });

    expect(started.status).toBe('running');
    expect(started.batchProgress?.batchType).toBe('document_analysis');
    expect(started.batchProgress?.batchCount).toBe(2);
    expect(existsSync(started.paths.documentAnalysisBatchManifestPath!)).toBe(true);

    const blocked = await runTenderStage({
      action: 'complete', workspaceRootPath: fixture.workspaceRoot,
      projectId: 'n3-tender', stageId: 'tender-document-analysis',
    });
    expect(blocked.status).toBe('blocked');
    expect(blocked.missingItems).toContain('document-batches:incomplete');

    const manifest = JSON.parse(readFileSync(started.paths.documentAnalysisBatchManifestPath!, 'utf8'));
    const mergedSections: unknown[] = [];
    for (const batch of manifest.batches) {
      const section = {
        id: `${batch.documentId}-summary`,
        kind: 'project_information',
        title: 'Project information',
        summary: 'Evidence-linked source summary.',
        sourceRefs: [{ documentId: batch.documentId, page: 1 }],
        status: 'reviewed',
      };
      writeFileSync(batch.reportPath, JSON.stringify({
        schemaVersion: 1,
        batchId: batch.batchId,
        documentId: batch.documentId,
        sections: [section],
      }));
      mergedSections.push({ ...section, documentId: batch.documentId });
    }
    const projectDirectory = join(fixture.projectRoot, '.agent-pi', 'business', 'tender', 'n3-tender');
    writeFileSync(join(projectDirectory, 'capability-index.json'), JSON.stringify(capabilityIndex(false)));
    writeCapabilityPack(projectDirectory, 'document_analysis', { sections: mergedSections.slice(0, 1) });
    const mergeBlocked = await runTenderStage({
      action: 'complete', workspaceRootPath: fixture.workspaceRoot,
      projectId: 'n3-tender', stageId: 'tender-document-analysis',
    });
    expect(mergeBlocked.status).toBe('blocked');
    expect(mergeBlocked.missingItems.some((item) => item.startsWith('document-merge:'))).toBe(true);

    writeCapabilityPack(projectDirectory, 'document_analysis', { sections: mergedSections });
    await runTenderStage({
      action: 'start', workspaceRootPath: fixture.workspaceRoot,
      projectId: 'n3-tender', stageId: 'tender-document-analysis',
    });
    const completed = await runTenderStage({
      action: 'status', workspaceRootPath: fixture.workspaceRoot,
      projectId: 'n3-tender', stageId: 'tender-document-analysis',
    });

    expect(completed.status).toBe('complete');
    expect(completed.batchProgress?.completedBatches).toBe(2);
  });

  test('dispatches document-analysis batches through the backend runtime without duplicate spawning', async () => {
    const fixture = createFixture();
    const sessions = new Map<string, {
      id: string;
      isProcessing: boolean;
      sessionStatus: string;
      goalState?: { status: string };
    }>();
    const spawnRequests: Array<{ parentSessionId: string; request: SpawnSessionRequest }> = [];
    const execution = {
      spawnSession: async (parentSessionId: string, request: SpawnSessionRequest) => {
        const sessionId = `child-${spawnRequests.length + 1}`;
        spawnRequests.push({ parentSessionId, request });
        sessions.set(sessionId, { id: sessionId, isProcessing: true, sessionStatus: 'todo' });
        return { sessionId, name: String(request.name), status: 'started' as const };
      },
      getSession: async (sessionId: string) => sessions.get(sessionId) ?? null,
    };

    const started = await runTenderStage({
      action: 'start', workspaceRootPath: fixture.workspaceRoot,
      projectId: 'n3-tender', stageId: 'tender-document-analysis', parentSessionId: 'parent-1',
    }, { execution });

    expect(started.status).toBe('running');
    expect(spawnRequests).toHaveLength(2);
    expect(spawnRequests.every((entry) => entry.parentSessionId === 'parent-1')).toBe(true);
    expect(spawnRequests.map((entry) => entry.request.briefPath)).toEqual(
      started.batchProgress?.tasks.map((task) => task.briefPath) ?? [],
    );
    expect(started.batchProgress?.runningBatches).toBe(2);
    expect(started.batchProgress?.pendingBatches).toBe(0);
    expect(started.batchProgress?.tasks.every((task) => task.status === 'running')).toBe(true);

    const polled = await runTenderStage({
      action: 'status', workspaceRootPath: fixture.workspaceRoot,
      projectId: 'n3-tender', stageId: 'tender-document-analysis',
    }, { execution });
    expect(spawnRequests).toHaveLength(2);
    expect(polled.batchProgress?.runningBatches).toBe(2);

    const manifest = JSON.parse(readFileSync(started.paths.documentAnalysisBatchManifestPath!, 'utf8'));
    const first = manifest.batches[0];
    writeFileSync(first.reportPath, JSON.stringify({
      schemaVersion: 1,
      batchId: first.batchId,
      documentId: first.documentId,
      sections: [{
        id: `${first.documentId}-summary`,
        kind: 'project_information',
        title: 'Project information',
        summary: 'Evidence-linked source summary.',
        sourceRefs: [{ documentId: first.documentId, page: 1 }],
        status: 'reviewed',
      }],
    }));
    sessions.set('child-1', { id: 'child-1', isProcessing: false, sessionStatus: 'done' });

    const progressed = await runTenderStage({
      action: 'status', workspaceRootPath: fixture.workspaceRoot,
      projectId: 'n3-tender', stageId: 'tender-document-analysis',
    }, { execution });
    expect(progressed.batchProgress?.completedBatches).toBe(1);
    expect(progressed.batchProgress?.runningBatches).toBe(1);
    expect(progressed.batchProgress?.tasks.find((task) => task.batchId === first.batchId)?.status).toBe('complete');
  });

  test('blocks production batch dispatch until a parent session is supplied', async () => {
    const fixture = createFixture();
    const execution = {
      spawnSession: async () => { throw new Error('must not spawn'); },
      getSession: async () => null,
    };

    const result = await runTenderStage({
      action: 'start', workspaceRootPath: fixture.workspaceRoot,
      projectId: 'n3-tender', stageId: 'tender-document-analysis',
    }, { execution });

    expect(result.status).toBe('blocked');
    expect(result.missingItems).toContain('task-board:parent-session-required');
    expect(result.batchProgress?.pendingBatches).toBe(2);
  });

  test('creates BOQ batch briefs and refuses completion until every batch report is complete', async () => {
    const fixture = createFixture();
    await runTenderStage({
      action: 'preflight', workspaceRootPath: fixture.workspaceRoot,
      projectId: 'n3-tender', stageId: 'project-setup',
    });
    const projectDirectory = join(fixture.projectRoot, '.agent-pi', 'business', 'tender', 'n3-tender');
    mkdirSync(join(projectDirectory, 'packs'), { recursive: true });
    writeFileSync(join(projectDirectory, 'capability-index.json'), JSON.stringify(capabilityIndex(false)));
    writeFileSync(join(projectDirectory, 'packs', 'boq-reconciliation.json'), JSON.stringify({
      schemaVersion: 1,
      capability: 'boq_reconciliation',
      projectId: 'n3-tender',
      revision: 1,
      coreRevision: 2,
      upstream: [],
      updatedAt: '2026-07-16T00:00:00.000Z',
      data: {
        items: [{
          id: 'item-1', source: { documentId: sourceId(fixture.boqPath), sheet: 'C5.1', cell: 'A1:F1' },
          code: '5.1.1', description: 'BOQ item', unit: 'm', quantity: '1', quantityBasis: 'boq',
          quantityStatus: 'sourced', quantityRefs: [],
        }],
        scopeLinks: [{
          boqItemId: 'item-1', requirementIds: [], specificationRefs: [], drawingRefs: [],
          measurementRuleRefs: [], inclusions: [], exclusions: [], assumptions: [], gapStatus: 'needs_review',
        }],
      },
    }));

    const started = await runTenderStage({
      action: 'start', workspaceRootPath: fixture.workspaceRoot,
      projectId: 'n3-tender', stageId: 'boq-five-step-pricing',
    });
    expect(started.status).toBe('running');
    expect(started.batchProgress?.batchCount).toBe(1);
    expect(existsSync(started.paths.boqBatchManifestPath!)).toBe(true);

    const blocked = await runTenderStage({
      action: 'complete', workspaceRootPath: fixture.workspaceRoot,
      projectId: 'n3-tender', stageId: 'boq-five-step-pricing',
    });
    expect(blocked.status).toBe('blocked');
    expect(blocked.missingItems).toContain('boq-batches:incomplete');

    const manifest = JSON.parse(readFileSync(started.paths.boqBatchManifestPath!, 'utf8'));
    const buildUp = completeBuildUp('item-1', sourceId(fixture.boqPath));
    writeFileSync(manifest.batches[0].reportPath, JSON.stringify({
      schemaVersion: 1,
      batchId: manifest.batches[0].batchId,
      itemBuildUps: [buildUp],
    }));
    writeFileSync(join(projectDirectory, 'capability-index.json'), JSON.stringify(capabilityIndex(true)));
    writeCapabilityPack(projectDirectory, 'boq_five_step_pricing', pricingData([{ ...buildUp, directCost: '11' }]));
    const mergeBlocked = await runTenderStage({
      action: 'complete', workspaceRootPath: fixture.workspaceRoot,
      projectId: 'n3-tender', stageId: 'boq-five-step-pricing',
    });
    expect(mergeBlocked.status).toBe('blocked');
    expect(mergeBlocked.missingItems.some((item) => item.startsWith('boq-merge:'))).toBe(true);

    writeCapabilityPack(projectDirectory, 'boq_five_step_pricing', pricingData([buildUp]));
    const completed = await runTenderStage({
      action: 'complete', workspaceRootPath: fixture.workspaceRoot,
      projectId: 'n3-tender', stageId: 'boq-five-step-pricing',
    });
    expect(completed.status).toBe('complete');
    expect(completed.batchProgress?.completedBatches).toBe(1);
  });

  function createFixture() {
    root = mkdtempSync(join(tmpdir(), 'tender-stage-run-'));
    const workspaceRoot = join(root, 'workspace');
    const projectRoot = join(root, 'project');
    const tenderPath = join(root, 'Tender Data.pdf');
    const boqPath = join(root, 'Pricing Schedule BOQ.xlsx');
    writeFileSync(tenderPath, 'tender');
    writeFileSync(boqPath, 'boq');
    createBusinessProject({
      workspaceRootPath: workspaceRoot,
      projectId: 'n3-tender',
      module: 'tender',
      name: 'N3 Tender',
      rootPath: projectRoot,
      workflowId: 'tender-main',
      createDirectory: true,
      inputPaths: [tenderPath, boqPath],
    });
    return { workspaceRoot, projectRoot, boqPath };
  }

  function capabilityIndex(pricingReady: boolean) {
    const entry = (capability: string) => ({
      capability, enabled: true, required: true, revision: 1, readiness: 'ready',
      issueCount: 0, stale: false, updatedAt: '2026-07-16T00:00:00.000Z',
    });
    return {
      schemaVersion: 1,
      projectId: 'n3-tender',
      coreRevision: 2,
      capabilities: [
        entry('document_analysis'),
        entry('evaluation_strategy'),
        entry('boq_reconciliation'),
        ...(pricingReady ? [entry('boq_five_step_pricing')] : []),
      ],
    };
  }

  function writeCapabilityPack(projectDirectory: string, capability: string, data: unknown) {
    const packDirectory = join(projectDirectory, 'packs');
    mkdirSync(packDirectory, { recursive: true });
    writeFileSync(join(packDirectory, `${capability.replaceAll('_', '-')}.json`), JSON.stringify({
      schemaVersion: 1,
      capability,
      projectId: 'n3-tender',
      revision: 1,
      coreRevision: 2,
      upstream: [],
      updatedAt: '2026-07-16T00:00:00.000Z',
      data,
    }));
  }

  function pricingData(itemBuildUps: unknown[]) {
    return {
      currency: 'ZAR', pricingStatus: 'reviewed', itemBuildUps, resourceSummary: [], assumptions: [],
    };
  }

  function completeBuildUp(boqItemId: string, documentId: string) {
    const step = {
      narrative: 'Evidence-linked derivation.',
      sourceRefs: [{ documentId, sheet: 'C5.1', cell: 'A1:F1' }],
    };
    return {
      boqItemId,
      status: 'reviewed',
      steps: {
        scopeQuantity: step,
        methodProductivity: step,
        resourceConsumption: step,
        sourcedRatesDirectCost: step,
        reconciliationRisk: step,
      },
      resourceConsumptions: [],
      planningBasis: {
        methodId: 'linear-installation', productionRate: '1', quantityUnit: 'm', timeUnit: 'working_day',
        duration: '1', calendarId: 'calendar-standard', activityId: `activity-${boqItemId}`,
        assumptionStatus: 'sourced', sourceRefs: [{ documentId, sheet: 'C5.1', cell: 'A1:F1' }],
      },
      initialCashFlow: [{
        period: '2026-08', activityId: `activity-${boqItemId}`, weight: '1', amount: '10',
        basis: 'Single-period initial allocation.', assumptionStatus: 'sourced',
        sourceRefs: [{ documentId, sheet: 'C5.1', cell: 'A1:F1' }],
      }],
      costComponents: [{
        id: `${boqItemId}-labour`, kind: 'labour', description: 'Labour', quantity: '1', unit: 'hour',
        rate: '10', amount: '10', rateSourceRef: { documentId, sheet: 'C5.1', cell: 'A1:F1' },
        assumptionStatus: 'sourced',
      }],
      directCost: '10',
      conditions: [],
      riskNotes: [],
    };
  }

  function sourceId(path: string): string {
    const stem = 'pricing-schedule-boq';
    const hash = new Bun.CryptoHasher('sha256').update(path.toLowerCase()).digest('hex').slice(0, 12);
    return `src-${stem}-${hash}`;
  }
});
