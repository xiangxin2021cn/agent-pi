import { describe, expect, test } from 'bun:test';
import { normalizeSpatialInput, renderGeospatialSvg } from './geospatial-visuals.ts';

describe('geospatial visual renderer', () => {
  test('normalizes CSV latitude/longitude into GeoJSON features', () => {
    const result = normalizeSpatialInput([
      'Name,Latitude,Longitude',
      'Site A,-22.5609,17.0658',
      'Site B,-22.5700,17.0800',
    ].join('\n'), { crs: 'EPSG:4326' });

    expect(result.geojson?.type).toBe('FeatureCollection');
    expect(result.geojson?.features).toHaveLength(2);
    expect(result.warnings).toEqual([]);
  });

  test('accepts GeoJSON FeatureCollection input', () => {
    const result = normalizeSpatialInput({
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        properties: { name: 'Borrow pit' },
        geometry: { type: 'Point', coordinates: [17.0658, -22.5609] },
      }],
    }, { crs: 'EPSG:4326' });

    expect(result.geojson?.features[0]?.properties?.name).toBe('Borrow pit');
  });

  test('renders report-ready SVG maps with title, legend, scale, CRS, source, and date', () => {
    const result = renderGeospatialSvg([
      'Name,Latitude,Longitude',
      'Site A,-22.5609,17.0658',
    ].join('\n'), {
      title: 'Project Site Location',
      crs: 'EPSG:4326',
      source: 'survey-control.csv',
      date: '2026-07-03',
    });

    expect(result.usedFallbackTable).toBe(false);
    expect(result.svg).toContain('Project Site Location');
    expect(result.svg).toContain('Layer legend');
    expect(result.svg).toContain('Scale note');
    expect(result.svg).toContain('CRS: EPSG:4326');
    expect(result.svg).toContain('Source: survey-control.csv');
    expect(result.svg).toContain('Date: 2026-07-03');
  });

  test('renders route chainage tables as route schematics', () => {
    const result = renderGeospatialSvg([
      '| Chainage | Latitude | Longitude |',
      '| --- | ---: | ---: |',
      '| km 0+000 | -22.5609 | 17.0658 |',
      '| km 1+500 | -22.5650 | 17.0750 |',
    ].join('\n'), {
      title: 'Highway Route Strip',
      crs: 'EPSG:4326',
    });

    expect(result.svg).toContain('class="route-line"');
    expect(result.svg).toContain('km 0+000');
    expect(result.svg).toContain('Route');
  });

  test('warns when CRS is missing but coordinates are otherwise usable', () => {
    const result = renderGeospatialSvg('Name,Latitude,Longitude\nA,-22.5609,17.0658');

    expect(result.warnings).toContain('CRS is missing; assuming WGS84 for schematic reporting only.');
    expect(result.svg).toContain('CRS: assumed WGS84');
  });

  test('returns an audit warning and fallback table when coordinates are incomplete', () => {
    const result = renderGeospatialSvg('Name,Latitude,Longitude\nA,-22.5609,');

    expect(result.usedFallbackTable).toBe(true);
    expect(result.warnings).toContain('Coordinates are incomplete or ambiguous; map rendering skipped.');
    expect(result.fallbackTable).toContain('| Evidence | Issue |');
  });
});
