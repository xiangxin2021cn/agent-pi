import { describe, expect, test } from 'bun:test';
import { analyzeVisualOpportunities, detectVisualOpportunities } from './visual-opportunity.ts';

describe('visual opportunity detector', () => {
  test('upgrades dense construction schedule tables to professional Gantt opportunities', () => {
    const opportunities = detectVisualOpportunities([
      '## 施工进度计划',
      '| WBS | Task | Baseline Start | Baseline Finish | Current Start | Current Finish | Critical |',
      '| --- | --- | --- | --- | --- | --- | --- |',
      '| 1.1 | Earthworks | 2026-07-01 | 2026-07-20 | 2026-07-03 | 2026-07-22 | yes |',
      '| 1.2 | Structures | 2026-07-21 | 2026-08-30 | 2026-07-25 | 2026-09-05 | yes |',
    ].join('\n'));

    expect(opportunities.map(item => item.recommendedKind)).toContain('construction-gantt');
    expect(opportunities[0]?.domain).toBe('construction');
  });

  test('detects process, responsibility, cost, investment, coordinate, and simulation sections', () => {
    const markdown = [
      '## Business Process',
      'The approval workflow has draft, review, approval, and archive steps.',
      '',
      '## Responsibility Matrix',
      'Organization roles and responsibilities include project manager, reviewer, and approver.',
      '',
      '## BOQ Cost Breakdown',
      '| Item | Unit | Quantity | Rate | Amount |',
      '| --- | --- | ---: | ---: | ---: |',
      '| Excavation | m3 | 1000 | 12 | 12000 |',
      '',
      '## Investment Cash Flow',
      '| Year | Capex | Revenue | Opex | Net Cash Flow |',
      '| --- | ---: | ---: | ---: | ---: |',
      '| 2026 | -100000 | 0 | -5000 | -105000 |',
      '| 2027 | 0 | 40000 | -10000 | 30000 |',
      '',
      '## Route Coordinates',
      '| Point | Latitude | Longitude | Chainage |',
      '| --- | ---: | ---: | --- |',
      '| A | -22.5609 | 17.0658 | km 0+000 |',
      '',
      '## ANSYS Results',
      '| Step | Residual | Stress MPa | Displacement mm |',
      '| --- | ---: | ---: | ---: |',
      '| 1 | 0.001 | 145 | 2.3 |',
    ].join('\n');

    const kinds = detectVisualOpportunities(markdown, { mode: 'professional' }).map(item => item.recommendedKind);

    expect(kinds).toEqual(expect.arrayContaining([
      'process-flow',
      'organization-chart',
      'professional-table',
      'investment-cash-flow-table',
      'site-location-map',
      'simulation-convergence-plot',
    ]));
  });

  test('refuses data-hungry chart requests when evidence is missing', () => {
    expect(detectVisualOpportunities('Please add an impressive trend chart and a map, but no data is available.')).toEqual([]);
  });

  test('caps auto-generated visuals and allows a larger professional mode cap', () => {
    const repeated = Array.from({ length: 13 }, (_, index) => [
      `## Process ${index + 1}`,
      'Workflow steps: prepare, review, approve, archive.',
    ].join('\n')).join('\n\n');

    expect(detectVisualOpportunities(repeated)).toHaveLength(5);
    expect(detectVisualOpportunities(repeated, { mode: 'professional' })).toHaveLength(12);
    expect(detectVisualOpportunities(repeated, { mode: 'professional', genre: 'executive_brief' })).toHaveLength(4);
    expect(detectVisualOpportunities(repeated, { mode: 'professional', genre: 'technical_report' })).toHaveLength(10);
  });

  test('counts existing Mermaid or image blocks and does not duplicate them', () => {
    const analysis = analyzeVisualOpportunities([
      '## Existing Visual',
      '```mermaid',
      'flowchart TD',
      '  A --> B',
      '```',
      '',
      '## Existing Image',
      '![schedule](schedule.svg)',
      '',
      '## New Process',
      'Workflow steps: draft, review, approve.',
    ].join('\n'));

    expect(analysis.existingVisualCount).toBe(2);
    expect(analysis.opportunities.map(item => item.recommendedKind)).toEqual(['process-flow']);
  });
});
