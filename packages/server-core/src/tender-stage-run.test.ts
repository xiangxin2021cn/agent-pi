import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createBusinessProject } from '@craft-agent/shared/business-projects';
import type { SpawnSessionRequest } from '@craft-agent/shared/agent';
import { documentArtifactPath } from './tender-document-artifacts.ts';
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

  test('requires user-confirmed bidder commitments before planning (legacy stage ids resolve)', async () => {
    const fixture = createFixture();
    await runTenderStage({
      action: 'preflight', workspaceRootPath: fixture.workspaceRoot,
      projectId: 'n3-tender', stageId: 'project-setup',
    });
    const projectDirectory = join(fixture.projectRoot, '.agent-pi', 'business', 'tender', 'n3-tender');
    const entry = (capability: string) => ({
      capability, enabled: true, required: true, revision: 1, readiness: 'ready',
      issueCount: 0, stale: false, updatedAt: '2026-07-17T00:00:00.000Z',
    });
    writeFileSync(join(projectDirectory, 'capability-index.json'), JSON.stringify({
      schemaVersion: 1,
      projectId: 'n3-tender',
      coreRevision: 2,
      capabilities: [
        entry('document_analysis'),
        entry('boq_reconciliation'),
        entry('boq_five_step_pricing'),
      ],
    }));

    // V2.4.0: bidder commitments merged into the pricing stage; methodology/
    // schedule/cost stages merged into planning. Legacy ids still resolve.
    const planning = await runTenderStage({
      action: 'start', workspaceRootPath: fixture.workspaceRoot,
      projectId: 'n3-tender', stageId: 'work-plan-methodology',
    });

    expect(planning.stageId).toBe('planning-and-submission');
    expect(planning.status).toBe('blocked');
    expect(planning.missingItems).toContain('capability:bidder_commitments');
    expect(planning.missingItems).toContain('capability:construction_resource_schedule');

    writeFileSync(join(projectDirectory, 'capability-index.json'), JSON.stringify({
      schemaVersion: 1,
      projectId: 'n3-tender',
      coreRevision: 3,
      capabilities: [
        entry('document_analysis'),
        entry('boq_reconciliation'),
        entry('boq_five_step_pricing'),
        entry('construction_resource_schedule'),
        entry('bidder_commitments'),
      ],
    }));
    const unblocked = await runTenderStage({
      action: 'start', workspaceRootPath: fixture.workspaceRoot,
      projectId: 'n3-tender', stageId: 'planning',
    });
    expect(unblocked.status).toBe('running');
    expect(unblocked.producedCapabilities).toEqual([
      'execution_plan',
      'schedule_resources',
      'cost_cashflow',
      'submission_documents',
      'submission_audit',
    ]);
  });

  test('uses manual stage closeout evidence to satisfy document-analysis upstream readiness', async () => {
    const fixture = createFixture();
    await runTenderStage({
      action: 'preflight', workspaceRootPath: fixture.workspaceRoot,
      projectId: 'n3-tender', stageId: 'project-setup',
    });
    const projectDirectory = join(fixture.projectRoot, '.agent-pi', 'business', 'tender', 'n3-tender');
    const closeoutDirectory = join(fixture.projectRoot, 'Agent Pi Outputs', '260720-light-crane');
    mkdirSync(closeoutDirectory, { recursive: true });
    writeFileSync(join(closeoutDirectory, 'STAGE_CLOSEOUT_Phase1_Document_Analysis.md'), [
      '# Stage Closeout',
      '## Capability Coverage',
      '### document_analysis ✅',
    ].join('\n'));
    const entry = (capability: string) => ({
      capability, enabled: true, required: true, revision: 1, readiness: 'ready',
      issueCount: 0, stale: false, updatedAt: '2026-07-16T00:00:00.000Z',
    });
    writeFileSync(join(projectDirectory, 'capability-index.json'), JSON.stringify({
      schemaVersion: 1,
      projectId: 'n3-tender',
      coreRevision: 2,
      capabilities: [entry('boq_reconciliation')],
    }));
    writeCapabilityPack(projectDirectory, 'boq_reconciliation', {
      items: [{
        id: 'item-1', source: { documentId: sourceId(fixture.boqPath), sheet: 'C5.1', cell: 'A1:F1' },
        code: '5.1.1', description: 'BOQ item', unit: 'm', quantity: '1',
        quantityBasis: 'boq', quantityStatus: 'sourced', quantityRefs: [],
      }],
      scopeLinks: [{
        boqItemId: 'item-1', requirementIds: [], specificationRefs: [], drawingRefs: [],
        measurementRuleRefs: [], inclusions: [], exclusions: [], assumptions: [], gapStatus: 'needs_review',
      }],
    });

    const result = await runTenderStage({
      action: 'start', workspaceRootPath: fixture.workspaceRoot,
      projectId: 'n3-tender', stageId: 'boq-five-step-pricing',
    });

    expect(result.status).toBe('running');
    expect(result.generatedPacks).toContain('document_analysis');
    expect(result.missingItems).not.toContain('capability:document_analysis');
    const persistedIndex = JSON.parse(readFileSync(join(projectDirectory, 'capability-index.json'), 'utf8'));
    expect(persistedIndex.capabilities.find((capability: any) => capability.capability === 'document_analysis')?.readiness)
      .toBe('ready');
  });

  test('gates submission on all planning packs under the consolidated stages', async () => {
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
        entry('construction_resource_schedule'),
        entry('bidder_commitments'),
      ],
    }));

    const planning = await runTenderStage({
      action: 'start', workspaceRootPath: fixture.workspaceRoot,
      projectId: 'n3-tender', stageId: 'planning',
    });
    // Legacy audit id resolves into the consolidated planning-and-submission stage.
    const aliased = await runTenderStage({
      action: 'status', workspaceRootPath: fixture.workspaceRoot,
      projectId: 'n3-tender', stageId: 'submission-audit',
    });
    const completionBlocked = await runTenderStage({
      action: 'complete', workspaceRootPath: fixture.workspaceRoot,
      projectId: 'n3-tender', stageId: 'planning-and-submission',
    });

    expect(planning.status).toBe('running');
    expect(planning.stageId).toBe('planning-and-submission');
    expect(planning.producedCapabilities).toEqual([
      'execution_plan',
      'schedule_resources',
      'cost_cashflow',
      'submission_documents',
      'submission_audit',
    ]);
    expect(aliased.stageId).toBe('planning-and-submission');
    expect(completionBlocked.status).toBe('blocked');
    expect(completionBlocked.missingItems).toContain('output:execution_plan');
    expect(completionBlocked.missingItems).toContain('output:schedule_resources');
    expect(completionBlocked.missingItems).toContain('output:cost_cashflow');
    expect(completionBlocked.missingItems).toContain('output:submission_documents');
  });

  test('creates one document-analysis batch per registered source and gates the stage merge', async () => {
    const fixture = createFixture();
    const started = await runTenderStage({
      action: 'start', workspaceRootPath: fixture.workspaceRoot,
      projectId: 'n3-tender', stageId: 'tender-document-analysis',
      parentSessionId: 'parent-doc-analysis',
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
    }
    const projectDirectory = join(fixture.projectRoot, '.agent-pi', 'business', 'tender', 'n3-tender');
    const packPath = join(projectDirectory, 'packs', 'document-analysis.json');
    expect(existsSync(packPath)).toBe(false);

    // Seed sibling capabilities as ready so stage completion only depends on document_analysis.
    writeFileSync(join(projectDirectory, 'capability-index.json'), JSON.stringify(capabilityIndex(false)));

    await runTenderStage({
      action: 'start', workspaceRootPath: fixture.workspaceRoot,
      projectId: 'n3-tender', stageId: 'tender-document-analysis',
      parentSessionId: 'parent-doc-analysis',
    });

    for (const file of started.sourceBoundary.files.filter((entry) => entry.status === 'registered')) {
      const artifactPath = documentArtifactPath(fixture.projectRoot, 'n3-tender', file.documentId, file.name);
      mkdirSync(dirname(artifactPath), { recursive: true });
      writeFileSync(
        artifactPath,
        `# ${file.name}\n\n## 摘要\n\nEvidence-linked parse summary for ${file.documentId}.\n`,
        'utf8',
      );
      await runTenderStage({
        action: 'status',
        workspaceRootPath: fixture.workspaceRoot,
        projectId: 'n3-tender',
        stageId: 'tender-document-analysis',
        parentSessionId: 'parent-doc-analysis',
        documentReview: { documentId: file.documentId, humanReview: 'accepted' },
      });
    }

    const completed = await runTenderStage({
      action: 'status', workspaceRootPath: fixture.workspaceRoot,
      projectId: 'n3-tender', stageId: 'tender-document-analysis',
      parentSessionId: 'parent-doc-analysis',
    });

    expect(existsSync(packPath)).toBe(true);
    const pack = JSON.parse(readFileSync(packPath, 'utf8'));
    expect(pack.data.sections).toHaveLength(2);
    const summaryPath = join(
      fixture.projectRoot,
      'Agent Pi Outputs',
      'parent-doc-analysis',
      'document-analysis-summary.md',
    );
    expect(existsSync(summaryPath)).toBe(true);
    expect(readFileSync(summaryPath, 'utf8')).toContain('# Document Analysis Summary');
    expect(completed.status).toBe('complete');
    expect(completed.batchProgress?.completedBatches).toBe(2);
    expect(completed.generatedPacks).toContain('document_analysis');
    expect(completed.missingItems.some((item) => item.startsWith('document-merge:'))).toBe(false);
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
    expect(spawnRequests).toHaveLength(0);
    expect(started.batchProgress?.runningBatches).toBe(0);
    expect(started.batchProgress?.pendingBatches).toBe(2);

    const advanced = await runTenderStage({
      action: 'advance', workspaceRootPath: fixture.workspaceRoot,
      projectId: 'n3-tender', stageId: 'tender-document-analysis', parentSessionId: 'parent-1',
    }, { execution });

    expect(spawnRequests).toHaveLength(2);
    expect(spawnRequests.every((entry) => entry.parentSessionId === 'parent-1')).toBe(true);
    expect(spawnRequests.map((entry) => entry.request.briefPath)).toEqual(
      advanced.batchProgress?.tasks.map((task) => task.briefPath) ?? [],
    );
    expect(advanced.batchProgress?.runningBatches).toBe(2);
    expect(advanced.batchProgress?.pendingBatches).toBe(0);
    expect(advanced.batchProgress?.tasks.every((task) => task.status === 'running')).toBe(true);

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
    // A stale hand-written pack that disagrees with the child report gets
    // deterministically replaced by the runtime merge — no boq-merge deadlock.
    writeCapabilityPack(projectDirectory, 'boq_five_step_pricing', pricingData([{ ...buildUp, directCost: '11' }]));
    const merged = await runTenderStage({
      action: 'complete', workspaceRootPath: fixture.workspaceRoot,
      projectId: 'n3-tender', stageId: 'boq-five-step-pricing',
    });
    expect(merged.missingItems.some((item) => item.startsWith('boq-merge:'))).toBe(false);
    expect(merged.missingItems.filter((item) => item.startsWith('resource-schedule:'))).toEqual([]);
    expect(existsSync(join(projectDirectory, 'packs', 'construction-resource-schedule.json'))).toBe(true);
    expect(existsSync(join(
      fixture.projectRoot,
      'Agent Pi Outputs',
      'n3-tender',
      'boq-pricing',
      '施工资源消耗总表.md',
    ))).toBe(true);
    // V2.4.0: the pricing stage also gates on user-confirmed bidder commitments.
    expect(merged.status).toBe('blocked');
    expect(merged.missingItems).toContain('output:bidder_commitments');
    const packAfterMerge = JSON.parse(readFileSync(join(projectDirectory, 'packs', 'boq-five-step-pricing.json'), 'utf8'));
    expect(packAfterMerge.data.itemBuildUps[0].directCost).toBe('10');

    writeFileSync(join(projectDirectory, 'capability-index.json'), JSON.stringify({
      ...capabilityIndex(true),
      capabilities: [
        ...capabilityIndex(true).capabilities,
        {
          capability: 'construction_resource_schedule', enabled: true, required: true, revision: 1, readiness: 'ready',
          issueCount: 0, stale: false, updatedAt: '2026-07-16T00:00:00.000Z',
        },
        {
          capability: 'bidder_commitments', enabled: true, required: true, revision: 1, readiness: 'ready',
          issueCount: 0, stale: false, updatedAt: '2026-07-16T00:00:00.000Z',
        },
      ],
    }));
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
      currency: 'ZAR', pricingStandard: 'c51_pure_direct_cost_v1', vatTreatment: 'exclusive',
      indirectCostPolicy: 'excluded_from_item_direct_cost', pricingStatus: 'reviewed',
      itemBuildUps, resourceSummary: [], assumptions: [],
    };
  }

  function completeBuildUp(boqItemId: string, documentId: string) {
    const step = {
      narrative: 'Evidence-linked derivation.',
      sourceRefs: [{ documentId, sheet: 'C5.1', cell: 'A1:F1' }],
    };
    const sourceRef = { documentId, sheet: 'C5.1', cell: 'A1:F1' };
    const clauseRef = { documentId, clause: '5.1.1' };
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
      itemIdentity: { code: '5.1.1', description: 'BOQ item', unit: 'm', quantity: '1', sourceRef },
      scopeBasis: {
        specificationRefs: [clauseRef], measurementRuleRefs: [{ documentId, clause: '5.1.1-payment' }],
        inclusions: ['Complete measured work'], exclusions: ['General overhead and profit'],
        testingRequirements: ['Acceptance check'], methodConstraints: ['Execute to specification'],
      },
      productivityBasis: {
        methodSequence: ['Set out', 'Execute', 'Inspect'],
        crew: [{ id: 'item-1-crew', kind: 'labour', description: 'Work crew', count: '1', assumptionStatus: 'sourced', sourceRefs: [clauseRef] }],
        workingHoursPerDay: '8', bottleneck: 'Crew output', theoreticalProductionRate: '2',
        calculationFormula: '2 m/day x effective factor',
        scenarios: [
          { scenario: 'optimistic', productionRate: '1.2', quantityUnit: 'm', timeUnit: 'working_day', effectiveFactor: '0.6', basis: 'Good conditions', assumptionStatus: 'scenario', sourceRefs: [clauseRef] },
          { scenario: 'base', productionRate: '1', quantityUnit: 'm', timeUnit: 'working_day', effectiveFactor: '0.5', basis: 'Normal conditions', assumptionStatus: 'sourced', sourceRefs: [clauseRef] },
          { scenario: 'pessimistic', productionRate: '0.8', quantityUnit: 'm', timeUnit: 'working_day', effectiveFactor: '0.4', basis: 'Constrained conditions', assumptionStatus: 'scenario', sourceRefs: [clauseRef] },
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
        costComponentId: `${boqItemId}-labour`, sourceRefs: [clauseRef],
      }],
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
        id: `${boqItemId}-labour`, kind: 'labour', description: 'Labour', quantity: '1', unit: 'hour/m',
        rate: '10', amount: '10', rateSourceRef: sourceRef,
        rateBasis: { sourceType: 'published_schedule', acquisitionMode: 'not_applicable', location: 'Durban', effectiveDate: '2026-07-16', vatTreatment: 'exclusive' },
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
        assumptionStatus: 'sourced', sourceRefs: [clauseRef],
      }],
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
