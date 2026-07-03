import { describe, expect, test } from 'bun:test';
import { normalizeSimulationResults, renderSimulationScreenshotReference, renderSimulationVisuals } from './simulation-visuals.ts';

const ansysCsv = [
  'Step,Time s,Residual,Stress MPa,Displacement mm,Load Case',
  '1,0,0.01,145,2.3,LC1',
  '2,1,0.002,162,2.8,LC1',
  '3,2,0.0004,158,2.7,LC1',
].join('\n');

describe('simulation / CAE visual renderer', () => {
  test('normalizes ANSYS/CAE CSV exports into result profiles with units and load case context', () => {
    const result = normalizeSimulationResults(ansysCsv, {
      solver: 'ANSYS Mechanical',
      source: 'ansys-export.csv',
      coordinateSystem: 'Global Cartesian',
      timestep: '1 s',
    });

    expect(result.profile?.solver).toBe('ANSYS Mechanical');
    expect(result.profile?.resultTypes).toEqual(expect.arrayContaining(['Residual', 'Stress', 'Displacement']));
    expect(result.profile?.units).toEqual(expect.arrayContaining(['s', 'MPa', 'mm']));
    expect(result.loadCases).toEqual(['LC1']);
    expect(result.strongClaimsAllowed).toBe(true);
  });

  test('generates Markdown and SVG assets for convergence, time-history, and result summaries', () => {
    const result = renderSimulationVisuals(ansysCsv, {
      solver: 'ANSYS Mechanical',
      source: 'ansys-export.csv',
      coordinateSystem: 'Global Cartesian',
      timestep: '1 s',
      resultComponent: 'von Mises stress',
      loadCase: 'LC1',
    });

    expect(result.markdown).toContain('### Simulation Result Visuals');
    expect(result.assets.map(asset => asset.kind)).toEqual(expect.arrayContaining([
      'convergence',
      'time-history',
      'result-summary',
    ]));
    expect(result.assets.find(asset => asset.kind === 'convergence')?.svg).toContain('Residual convergence');
    expect(result.markdown).toContain('Solver: ANSYS Mechanical');
    expect(result.markdown).toContain('Load case: LC1');
  });

  test('warns when metadata is missing and blocks strong result claims', () => {
    const result = normalizeSimulationResults(ansysCsv, {
      solver: 'ANSYS Mechanical',
      source: 'ansys-export.csv',
    });

    expect(result.strongClaimsAllowed).toBe(false);
    expect(result.warnings).toEqual(expect.arrayContaining([
      'Missing coordinate system; strong spatial result claims are disabled.',
      'Missing timestep/frequency; time-history claims are limited.',
    ]));
  });

  test('does not falsely interpret unsupported native proprietary result files', () => {
    const result = normalizeSimulationResults('project-result.rst');

    expect(result.profile).toBeUndefined();
    expect(result.warnings).toContain('Unsupported proprietary simulation result file; parser support is required before interpretation.');
  });

  test('allows user-provided screenshots only with provenance and evidence notes', () => {
    const accepted = renderSimulationScreenshotReference({
      imagePath: 'outputs/ansys-contour.png',
      source: 'ANSYS screenshot exported by user',
      caption: 'Stress contour under LC1',
    });
    const rejected = renderSimulationScreenshotReference({
      imagePath: 'outputs/unknown.png',
      caption: 'Unverified contour',
    });

    expect(accepted.markdown).toContain('![Stress contour under LC1](outputs/ansys-contour.png)');
    expect(accepted.markdown).toContain('Evidence note: ANSYS screenshot exported by user.');
    expect(rejected.markdown).toBe('');
    expect(rejected.warnings).toContain('Screenshot provenance is missing; image was not inserted.');
  });
});
