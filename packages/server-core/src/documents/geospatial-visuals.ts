export interface GeoJsonFeatureCollection {
  type: 'FeatureCollection';
  features: GeoJsonFeature[];
}

export interface GeoJsonFeature {
  type: 'Feature';
  properties: Record<string, unknown>;
  geometry: {
    type: 'Point' | 'LineString';
    coordinates: [number, number] | Array<[number, number]>;
  };
}

export interface SpatialOptions {
  title?: string;
  crs?: string;
  source?: string;
  date?: string;
}

export interface SpatialNormalizeResult {
  geojson?: GeoJsonFeatureCollection;
  warnings: string[];
  fallbackTable?: string;
}

export interface GeospatialSvgResult extends SpatialNormalizeResult {
  svg: string;
  usedFallbackTable: boolean;
}

export function normalizeSpatialInput(input: string | unknown, options: SpatialOptions = {}): SpatialNormalizeResult {
  const parsed = typeof input === 'string' ? tryParseJson(input) : input;
  const warnings: string[] = [];

  if (isFeatureCollection(parsed)) {
    if (!options.crs && !hasGeoJsonCrs(parsed)) {
      warnings.push('CRS is missing; assuming WGS84 for schematic reporting only.');
    }
    return { geojson: parsed, warnings };
  }

  if (typeof input !== 'string') {
    return ambiguousCoordinates();
  }

  const rows = parseDelimitedRows(input);
  const features = rowsToFeatures(rows);
  if (features.length === 0) {
    return ambiguousCoordinates();
  }

  if (!options.crs) {
    warnings.push('CRS is missing; assuming WGS84 for schematic reporting only.');
  }

  return {
    geojson: {
      type: 'FeatureCollection',
      features: maybeAddRouteFeature(features),
    },
    warnings,
  };
}

export function renderGeospatialSvg(input: string | unknown, options: SpatialOptions = {}): GeospatialSvgResult {
  const normalized = normalizeSpatialInput(input, options);
  if (!normalized.geojson || normalized.geojson.features.length === 0) {
    return {
      svg: '',
      warnings: normalized.warnings,
      fallbackTable: normalized.fallbackTable,
      usedFallbackTable: true,
    };
  }

  const width = 900;
  const height = 560;
  const left = 72;
  const top = 82;
  const mapWidth = 720;
  const mapHeight = 360;
  const points = extractPointCoordinates(normalized.geojson);
  const bbox = getBounds(points);
  const title = options.title ?? 'Location Map';
  const crsLabel = options.crs ?? 'assumed WGS84';
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    '<style>.title{font:700 24px Arial,sans-serif;fill:#111827}.label{font:12px Arial,sans-serif;fill:#374151}.small{font:11px Arial,sans-serif;fill:#6b7280}.frame{fill:#f8fafc;stroke:#cbd5e1}.site-point{fill:#dc2626;stroke:#7f1d1d;stroke-width:1.5}.route-line{fill:none;stroke:#2563eb;stroke-width:4;stroke-linecap:round;stroke-linejoin:round}.legend-box{fill:#fff;stroke:#d1d5db}</style>',
    '<rect width="100%" height="100%" fill="#ffffff"/>',
    `<text class="title" x="40" y="42">${escapeXml(title)}</text>`,
    `<rect class="frame" x="${left}" y="${top}" width="${mapWidth}" height="${mapHeight}" rx="4"/>`,
  ];

  for (const feature of normalized.geojson.features) {
    if (feature.geometry.type === 'LineString') {
      const projected = (feature.geometry.coordinates as Array<[number, number]>)
        .map(([lon, lat]) => projectPoint(lon, lat, bbox, left, top, mapWidth, mapHeight));
      parts.push(`<polyline class="route-line" points="${projected.map(point => `${point.x},${point.y}`).join(' ')}"/>`);
      continue;
    }

    const [lon, lat] = feature.geometry.coordinates as [number, number];
    const point = projectPoint(lon, lat, bbox, left, top, mapWidth, mapHeight);
    parts.push(`<circle class="site-point" cx="${point.x}" cy="${point.y}" r="6"/>`);
    const label = String(feature.properties.chainage ?? feature.properties.name ?? 'Point');
    parts.push(`<text class="small" x="${point.x + 8}" y="${point.y - 8}">${escapeXml(label)}</text>`);
  }

  parts.push(`<g aria-label="Layer legend"><rect class="legend-box" x="610" y="466" width="240" height="58" rx="4"/>`);
  parts.push('<text class="small" x="626" y="486">Layer legend</text><circle class="site-point" cx="632" cy="506" r="5"/><text class="small" x="646" y="510">Site / chainage point</text><line class="route-line" x1="746" y1="506" x2="782" y2="506"/><text class="small" x="790" y="510">Route</text></g>');
  parts.push(`<text class="small" x="40" y="476">Scale note: schematic report map, not a survey drawing.</text>`);
  parts.push(`<text class="small" x="40" y="496">CRS: ${escapeXml(crsLabel)}</text>`);
  if (options.source) parts.push(`<text class="small" x="40" y="516">Source: ${escapeXml(options.source)}</text>`);
  if (options.date) parts.push(`<text class="small" x="40" y="536">Date: ${escapeXml(options.date)}</text>`);
  parts.push('</svg>');

  return {
    ...normalized,
    svg: parts.join(''),
    usedFallbackTable: false,
  };
}

function parseDelimitedRows(input: string): string[][] {
  const lines = input.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (lines.every(line => line.startsWith('|'))) {
    return lines
      .filter(line => !/^\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?$/.test(line))
      .map(line => line.replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim()));
  }

  return lines.map(line => line.split(',').map(cell => cell.trim()));
}

function rowsToFeatures(rows: string[][]): GeoJsonFeature[] {
  const [headers, ...body] = rows;
  if (!headers) return [];
  const normalizedHeaders = headers.map(header => header.toLowerCase().replace(/[^a-z0-9]+/g, ''));
  const latIndex = findHeader(normalizedHeaders, ['latitude', 'lat']);
  const lonIndex = findHeader(normalizedHeaders, ['longitude', 'lon', 'lng']);
  const nameIndex = findHeader(normalizedHeaders, ['name', 'point', 'site']);
  const chainageIndex = findHeader(normalizedHeaders, ['chainage', 'km']);
  if (latIndex < 0 || lonIndex < 0) return [];

  return body.flatMap((row, index): GeoJsonFeature[] => {
    const lat = Number.parseFloat(row[latIndex] ?? '');
    const lon = Number.parseFloat(row[lonIndex] ?? '');
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return [];
    const properties: Record<string, unknown> = {
      name: row[nameIndex] || `Point ${index + 1}`,
    };
    if (chainageIndex >= 0 && row[chainageIndex]) properties.chainage = row[chainageIndex];
    return [{
      type: 'Feature',
      properties,
      geometry: { type: 'Point', coordinates: [lon, lat] },
    }];
  });
}

function maybeAddRouteFeature(features: GeoJsonFeature[]): GeoJsonFeature[] {
  const routePoints = features.filter(feature => typeof feature.properties.chainage === 'string');
  if (routePoints.length < 2) return features;
  return [
    {
      type: 'Feature',
      properties: { name: 'Route' },
      geometry: {
        type: 'LineString',
        coordinates: routePoints.map(feature => feature.geometry.coordinates as [number, number]),
      },
    },
    ...features,
  ];
}

function findHeader(headers: string[], candidates: string[]): number {
  return headers.findIndex(header => candidates.includes(header));
}

function extractPointCoordinates(geojson: GeoJsonFeatureCollection): Array<[number, number]> {
  return geojson.features.flatMap(feature =>
    feature.geometry.type === 'Point'
      ? [feature.geometry.coordinates as [number, number]]
      : feature.geometry.coordinates as Array<[number, number]>
  );
}

function getBounds(points: Array<[number, number]>): { minLon: number; maxLon: number; minLat: number; maxLat: number } {
  const lons = points.map(([lon]) => lon);
  const lats = points.map(([, lat]) => lat);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  return {
    minLon: minLon === maxLon ? minLon - 0.01 : minLon,
    maxLon: minLon === maxLon ? maxLon + 0.01 : maxLon,
    minLat: minLat === maxLat ? minLat - 0.01 : minLat,
    maxLat: minLat === maxLat ? maxLat + 0.01 : maxLat,
  };
}

function projectPoint(
  lon: number,
  lat: number,
  bbox: { minLon: number; maxLon: number; minLat: number; maxLat: number },
  left: number,
  top: number,
  width: number,
  height: number,
): { x: number; y: number } {
  return {
    x: Math.round(left + ((lon - bbox.minLon) / (bbox.maxLon - bbox.minLon)) * width),
    y: Math.round(top + (1 - (lat - bbox.minLat) / (bbox.maxLat - bbox.minLat)) * height),
  };
}

function isFeatureCollection(value: unknown): value is GeoJsonFeatureCollection {
  return typeof value === 'object'
    && value !== null
    && (value as { type?: unknown }).type === 'FeatureCollection'
    && Array.isArray((value as { features?: unknown }).features);
}

function hasGeoJsonCrs(value: unknown): boolean {
  return typeof value === 'object' && value !== null && 'crs' in value;
}

function tryParseJson(input: string): unknown {
  try {
    return JSON.parse(input);
  } catch {
    return undefined;
  }
}

function ambiguousCoordinates(): SpatialNormalizeResult {
  return {
    warnings: ['Coordinates are incomplete or ambiguous; map rendering skipped.'],
    fallbackTable: [
      '| Evidence | Issue |',
      '| --- | --- |',
      '| spatial input | Coordinates are incomplete or ambiguous. |',
    ].join('\n'),
  };
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
