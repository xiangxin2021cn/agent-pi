export type DocumentDomain =
  | 'construction'
  | 'investment'
  | 'geospatial'
  | 'simulation'
  | 'business'
  | 'legal'
  | 'software'
  | 'research'
  | 'general';

export type VisualKind =
  | 'construction-gantt'
  | 'schedule-s-curve'
  | 'resource-histogram'
  | 'investment-cash-flow-table'
  | 'npv-irr-summary'
  | 'sensitivity-matrix'
  | 'cumulative-cash-flow-curve'
  | 'professional-table'
  | 'site-location-map'
  | 'route-map'
  | 'geospatial-evidence-panel'
  | 'simulation-convergence-plot'
  | 'simulation-result-table'
  | 'time-history-plot'
  | 'process-flow'
  | 'organization-chart'
  | 'obligations-matrix'
  | 'risk-matrix'
  | 'system-architecture-diagram'
  | 'sequence-flow'
  | 'evidence-comparison-table';

export interface VisualRegistryInput {
  text: string;
  tables?: string[][];
  mode?: 'standard' | 'professional';
}

export interface VisualSuggestion {
  kind: VisualKind;
  domain: DocumentDomain;
  score: number;
  reason: string;
  requiredData: string[];
  missingData: string[];
}

export interface VisualOpportunity {
  id: string;
  domain: DocumentDomain;
  recommendedKind: VisualKind;
  score: number;
  reason: string;
  requiredData: string[];
  missingData: string[];
}

export interface VisualPlan {
  mode: 'standard' | 'professional';
  opportunities: VisualOpportunity[];
  selectedKinds: VisualKind[];
  auditRequirements: string[];
}

export type VisualEvidenceType = 'source_image' | 'data_derived' | 'source_derived_diagram' | 'illustrative';

export interface VisualSpec {
  id: string;
  kind: VisualKind;
  title: string;
  caption: string;
  altText: string;
  evidenceType: VisualEvidenceType;
  sourceRefs: string[];
  assetPath?: string;
  dataPath?: string;
  target: {
    formats: string[];
    pageSize?: 'A4' | 'A3' | 'letter' | 'custom';
    orientation?: 'portrait' | 'landscape';
  };
}

export interface TemplateProfile {
  id: string;
  sourcePath: string;
  sourceType: 'docx' | 'pdf';
  pageSize?: 'A4' | 'A3' | 'letter' | 'custom';
  orientation?: 'portrait' | 'landscape';
  styles: Array<{
    id: string;
    name: string;
    role?: 'title' | 'heading' | 'body' | 'caption' | 'table' | 'toc' | 'header' | 'footer';
  }>;
  numbering?: Array<{
    id: string;
    levels: number;
  }>;
  margins?: {
    top?: number;
    right?: number;
    bottom?: number;
    left?: number;
  };
}

export interface ScheduleTask {
  id: string;
  name: string;
  wbs?: string;
  start?: string;
  finish?: string;
  baselineStart?: string;
  baselineFinish?: string;
  percentComplete?: number;
  dependencies?: string[];
  critical?: boolean;
  milestone?: boolean;
}

export interface ProfessionalTableProfile {
  domain: DocumentDomain;
  title?: string;
  numericColumns: string[];
  dateColumns: string[];
  currencyColumns: string[];
  unitColumns: string[];
  hasTotals: boolean;
  hasScenarioColumns: boolean;
}

export interface GeoVisualProfile {
  kind: Extract<VisualKind, 'site-location-map' | 'route-map' | 'geospatial-evidence-panel'>;
  coordinateSystem?: string;
  points?: Array<{
    label?: string;
    latitude?: number;
    longitude?: number;
    easting?: number;
    northing?: number;
  }>;
  chainageRange?: string;
}

export interface SimulationResultProfile {
  solver?: string;
  resultTypes: string[];
  numericSeries: string[];
  imageRefs: string[];
  units: string[];
}
