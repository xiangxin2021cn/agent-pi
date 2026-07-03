import { describe, expect, test } from 'bun:test';
import { formatProfessionalTable, profileProfessionalTable } from './professional-table.ts';

describe('professional table formatter', () => {
  test('profiles investment cash-flow tables with currency, dates, scenarios, totals, and negative values', () => {
    const profile = profileProfessionalTable([
      ['Year', 'Base Revenue USD', 'Downside Revenue USD', 'Opex USD', 'Net Cash Flow USD'],
      ['2026', '0', '0', '-25000', '-1025000'],
      ['2027', '350000', '290000', '-80000', '270000'],
      ['Total', '350000', '290000', '-105000', '-755000'],
    ], { domain: 'investment' });

    expect(profile.numericColumns).toEqual(['Base Revenue USD', 'Downside Revenue USD', 'Opex USD', 'Net Cash Flow USD']);
    expect(profile.currencyColumns).toEqual(['Base Revenue USD', 'Downside Revenue USD', 'Opex USD', 'Net Cash Flow USD']);
    expect(profile.dateColumns).toEqual(['Year']);
    expect(profile.hasScenarioColumns).toBe(true);
    expect(profile.hasTotals).toBe(true);
    expect(profile.hasNegativeValues).toBe(true);
  });

  test('renders investment tables with source notes and raw sidecar references', () => {
    const result = formatProfessionalTable([
      ['Year', 'Net Cash Flow USD'],
      ['2026', '-1025000'],
      ['2027', '270000'],
    ], {
      title: 'Investment Cash Flow',
      domain: 'investment',
      sourceLabel: 'feasibility-model.xlsx',
      rawSidecarPath: 'outputs/tables/cash-flow.raw.json',
    });

    expect(result.markdown).toContain('### Investment Cash Flow');
    expect(result.markdown).toContain('| 2026 | (1,025,000) |');
    expect(result.markdown).toContain('Source: feasibility-model.xlsx.');
    expect(result.markdown).toContain('Raw table: `outputs/tables/cash-flow.raw.json`.');
    expect(result.profile.currencyColumns).toEqual(['Net Cash Flow USD']);
  });

  test('formats BOQ cost tables without changing numeric values except display rounding', () => {
    const result = formatProfessionalTable([
      ['Item', 'Unit', 'Quantity', 'Rate ZAR', 'Amount ZAR'],
      ['Excavation', 'm3', '1000', '12.5', '12500'],
      ['Subtotal', '', '', '', '12500'],
    ], {
      title: 'BOQ Cost Breakdown',
      domain: 'construction',
    });

    expect(result.markdown).toContain('| Excavation | m3 | 1,000 | 12.50 | 12,500 |');
    expect(result.profile.unitColumns).toEqual(['Unit']);
    expect(result.profile.hasTotals).toBe(true);
  });

  test('summarizes over-wide engineering result tables and recommends an appendix', () => {
    const result = formatProfessionalTable([
      ['Node', 'Stress MPa', 'Displacement mm', 'Strain', 'Mode 1', 'Mode 2', 'Mode 3', 'Mode 4'],
      ['N1', '145.126', '2.345', '0.0012', '1', '2', '3', '4'],
    ], {
      title: 'ANSYS Result Summary',
      domain: 'simulation',
      maxDisplayColumns: 5,
      rawSidecarPath: 'outputs/tables/ansys.raw.csv',
    });

    expect(result.markdown).toContain('| Node | Stress MPa | Displacement mm | Strain | Mode 1 |');
    expect(result.markdown).not.toContain('Mode 4');
    expect(result.markdown).toContain('Appendix recommended: original table has 8 columns; displayed first 5 columns.');
    expect(result.markdown).toContain('Raw table: `outputs/tables/ansys.raw.csv`.');
  });
});
