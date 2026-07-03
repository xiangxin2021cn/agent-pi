import { describe, expect, test } from 'bun:test';
import { detectDocumentDomain, suggestVisuals } from './registry.ts';
import type { SessionDocumentPlan } from '../sessions/types.ts';

function kindsFor(text: string, tables?: string[][]): string[] {
  return suggestVisuals({ text, tables }).map(suggestion => suggestion.kind);
}

describe('document visual registry', () => {
  test('suggests professional construction schedule visuals when schedule evidence exists', () => {
    const suggestions = suggestVisuals({
      text: [
        '施工总进度计划 WBS: 1.1 Earthworks, 1.2 Structures.',
        'Baseline start 2026-07-01 baseline finish 2026-08-20.',
        'Current start 2026-07-05 current finish 2026-08-28.',
        'Progress date 2026-07-31, critical path and milestones are marked.',
      ].join(' '),
    });

    expect(suggestions.map(item => item.kind)).toContain('construction-gantt');
    expect(suggestions.map(item => item.kind)).toContain('schedule-s-curve');
    expect(suggestions.every(item => item.domain === 'construction')).toBe(true);
    expect(suggestions.find(item => item.kind === 'construction-gantt')?.missingData).toEqual([]);
  });

  test('suggests investment visuals only when numeric financial inputs exist', () => {
    const suggestions = suggestVisuals({
      text: 'Investment model with yearly cash flow, capex, opex, revenue, NPV, IRR, sensitivity scenarios, and cumulative cash flow.',
      tables: [
        ['Year', 'Capex', 'Revenue', 'Opex', 'Net Cash Flow'],
        ['2026', '-1000000', '0', '-25000', '-1025000'],
        ['2027', '0', '350000', '-80000', '270000'],
      ],
    });

    expect(suggestions.map(item => item.kind)).toEqual(expect.arrayContaining([
      'investment-cash-flow-table',
      'npv-irr-summary',
      'sensitivity-matrix',
      'cumulative-cash-flow-curve',
    ]));

    expect(kindsFor('Investment outlook and market narrative without figures.')).not.toContain('cumulative-cash-flow-curve');
  });

  test('requires spatial data before suggesting geospatial maps', () => {
    const suggestions = suggestVisuals({
      text: 'Route map for the site at latitude -22.5609 longitude 17.0658 with chainage km 0+000 to km 12+500 and coordinate points.',
    });

    expect(detectDocumentDomain(suggestions[0]?.reason ?? 'route coordinate map')).toBe('geospatial');
    expect(suggestions.map(item => item.kind)).toEqual(expect.arrayContaining([
      'route-map',
      'site-location-map',
    ]));
    expect(kindsFor('Site location overview without coordinates or route geometry.')).not.toContain('site-location-map');
  });

  test('requires simulation result data or images before suggesting CAE plots', () => {
    const suggestions = suggestVisuals({
      text: 'ANSYS finite element result table includes residual convergence, stress MPa, displacement mm, load step, and time history.',
      tables: [
        ['Step', 'Residual', 'Stress MPa', 'Displacement mm'],
        ['1', '0.0012', '145', '2.3'],
        ['2', '0.0004', '162', '2.8'],
      ],
    });

    expect(suggestions.map(item => item.kind)).toEqual(expect.arrayContaining([
      'simulation-convergence-plot',
      'simulation-result-table',
      'time-history-plot',
    ]));
    expect(kindsFor('ANSYS simulation chapter with no result table or exported image.')).toEqual([]);
  });

  test('suggests business, legal, software, and research visuals from domain-specific evidence', () => {
    expect(kindsFor('Business process workflow with approval roles and organization responsibilities.')).toEqual(expect.arrayContaining([
      'process-flow',
      'organization-chart',
    ]));

    expect(kindsFor('Contract clause obligations, compliance matrix, risk allocation, notice periods, and dispute procedure.')).toEqual(expect.arrayContaining([
      'obligations-matrix',
      'risk-matrix',
    ]));

    expect(kindsFor('Software architecture with services, API gateway, database, event queue, and request sequence.')).toEqual(expect.arrayContaining([
      'system-architecture-diagram',
      'sequence-flow',
    ]));

    expect(kindsFor('Research evidence compares papers, sources, methods, sample size, publication date, and findings.')).toContain('evidence-comparison-table');
  });

  test('keeps generic report suggestions low-risk and refuses data-hungry charts without evidence', () => {
    const generic = suggestVisuals({
      text: 'Write a general report with steps, responsibilities, and a concise summary table.',
    });

    expect(generic.map(item => item.kind).sort()).toEqual(['process-flow', 'professional-table']);
    expect(suggestVisuals({ text: 'Make this section more visual and impressive.' })).toEqual([]);
  });

  test('session document plans can carry visual and template fidelity metadata', () => {
    const plan: SessionDocumentPlan = {
      title: 'Template-based construction report',
      sections: ['Executive summary'],
      tables: [],
      charts: [],
      enhancements: [],
      citations: [],
      deliveryFormats: ['DOCX'],
      domain: 'construction',
      templateProfileId: 'tpl-001',
      strictTemplate: true,
      visualPlan: {
        mode: 'professional',
        opportunities: [{
          id: 'visual-1',
          domain: 'construction',
          recommendedKind: 'construction-gantt',
          score: 0.95,
          reason: 'Schedule table includes WBS, baseline, current plan, progress date, and milestones.',
          requiredData: ['task', 'start', 'finish'],
          missingData: [],
        }],
        selectedKinds: ['construction-gantt'],
        auditRequirements: ['Verify source data before rendering.'],
      },
    };

    expect(plan.domain).toBe('construction');
    expect(plan.visualPlan?.selectedKinds).toContain('construction-gantt');
    expect(plan.strictTemplate).toBe(true);
  });
});
