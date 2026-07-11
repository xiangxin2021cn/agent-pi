import type { VisualSpec } from '@craft-agent/shared/document-visuals';

export interface VisualSpecAudit {
  passed: boolean;
  issues: string[];
}

export function validateVisualSpec(spec: VisualSpec): VisualSpecAudit {
  const issues: string[] = [];

  if (!spec.title.trim()) issues.push('Visual requires a non-empty title.');
  if (!spec.caption.trim()) issues.push('Visual requires a non-empty caption.');
  if (!spec.altText.trim()) issues.push('Visual requires non-empty alt text.');
  if (spec.sourceRefs.length === 0 || spec.sourceRefs.every(source => !source.trim())) {
    issues.push('Visual requires at least one source reference.');
  }
  if (spec.target.formats.length === 0 || spec.target.formats.every(format => !format.trim())) {
    issues.push('Visual requires at least one target delivery format.');
  }
  if (spec.evidenceType === 'data_derived' && !spec.dataPath?.trim()) {
    issues.push('Data-derived visual requires a data sidecar.');
  }
  if (spec.evidenceType === 'source_image' && !spec.assetPath?.trim()) {
    issues.push('Source-image visual requires an asset path.');
  }

  return { passed: issues.length === 0, issues };
}
