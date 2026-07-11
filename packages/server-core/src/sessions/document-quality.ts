import { basename, extname } from 'path'
import type { SessionDocumentInternalArtifactKind } from '@craft-agent/shared/sessions'

export interface DocumentQualityReport {
  passed: boolean
  score: number
  threshold: number
  issues: string[]
  strengths: string[]
  dimensions: {
    structure: number
    evidence: number
    numbers: number
    specification: number
    risk: number
    visuals?: number
    template?: number
  }
  metrics: {
    textLength: number
    headingCount: number
    paragraphCount: number
    citationMarkerCount: number
    sourceReferenceCount: number
    numericClaimCount: number
    tableMarkerCount: number
    placeholderCount: number
    internalControlMarkerCount: number
    tableLineRatio: number
  }
}

export interface AnalyzeDocumentQualityInput {
  contents: string[]
  sourceFilePaths?: string[]
  strict?: boolean
  allowVisibleInternalArtifacts?: SessionDocumentInternalArtifactKind[]
  tableLed?: boolean
}

const CITATION_MARKER_PATTERN = /来源|依据|引用|参考|条款|章节|第\s*\d+\s*页|source|according to|based on|citation|cite|clause|section|page|§|\[[^\]]+\]/gi
const NUMERIC_CLAIM_PATTERN = /(?:\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)(?:\s?%|\s?(?:m2|m3|m|km|kg|t|rmb|usd|zar|r|元|万元|亿元|天|月|年))?/gi
const PLACEHOLDER_PATTERN = /待补充|待确认|TODO|TBD|placeholder|lorem ipsum|xxx|\[填|【填|<insert/gi
const SPECIFICATION_PATTERN = /规范|标准|条款|合同|招标|投标|清单|工程量|boq|specification|standard|clause|contract|tender|requirement/gi
const RISK_PATTERN = /风险|问题|缺口|假设|建议|控制|复核|risk|gap|assumption|mitigation|recommendation|review/gi
const INTERNAL_CONTROL_HEADING_PATTERNS: Array<{ kind: SessionDocumentInternalArtifactKind; pattern: RegExp }> = [
  { kind: 'evidence_matrix', pattern: /(?:^|\n)\s*#{1,6}\s*(?:\d+[.、]\s*)?(?:证据矩阵|evidence matrix)\s*(?=\n|$|\/)/gi },
  { kind: 'goal_audit', pattern: /(?:^|\n)\s*#{1,6}\s*(?:目标审计|goal audit|document expert review)\s*(?=\n|$|\/)/gi },
  { kind: 'assumption_register', pattern: /(?:^|\n)\s*#{1,6}\s*(?:假设登记|假设台账|assumption register)\s*(?=\n|$|\/)/gi },
  { kind: 'visual_manifest', pattern: /(?:^|\n)\s*#{1,6}\s*(?:视觉清单|图表清单|visual manifest)\s*(?=\n|$|\/)/gi },
]
const EDITORIAL_PROCESS_PATTERN = /(?:goal audit requested improvement|内部审计结果|编制过程记录|审计指出缺少|以下为审计过程|document expert review)/gi

export function analyzeDocumentQuality(input: AnalyzeDocumentQualityInput): DocumentQualityReport {
  const raw = input.contents.map(content => content.trim()).filter(Boolean).join('\n\n')
  const normalized = raw.replace(/\s+/g, ' ').trim()
  const sourceFilePaths = input.sourceFilePaths ?? []
  const sourceReferenceCount = countSourceReferences(raw, sourceFilePaths)
  const citationMarkerCount = countMatches(raw, CITATION_MARKER_PATTERN)
  const headingCount = countHeadings(raw)
  const paragraphCount = raw
    .split(/\n\s*\n/)
    .map(paragraph => paragraph.replace(/\s+/g, ' ').trim())
    .filter(paragraph => paragraph.length >= 40)
    .length
  const numericClaimCount = countMatches(raw, NUMERIC_CLAIM_PATTERN)
  const tableMarkerCount = countTableMarkers(raw)
  const placeholderCount = countMatches(raw, PLACEHOLDER_PATTERN)
  const specificationMarkerCount = countMatches(raw, SPECIFICATION_PATTERN)
  const riskMarkerCount = countMatches(raw, RISK_PATTERN)
  const internalControlMarkerCount = countInternalControlMarkers(raw, input.allowVisibleInternalArtifacts ?? [])
    + countMatches(raw, EDITORIAL_PROCESS_PATTERN)
  const tableLineRatio = calculateTableLineRatio(raw)

  const issues: string[] = []
  const strengths: string[] = []
  let score = 100

  if (normalized.length < 400) {
    score -= 35
    issues.push('正文内容过短，难以支撑高质量文档交付。')
  } else if (normalized.length < 800) {
    score -= 15
    issues.push('正文深度偏薄，建议补充关键章节、依据和结论。')
  } else {
    strengths.push('正文长度达到文档型任务的基础审查门槛。')
  }

  if (headingCount < 2) {
    score -= 20
    issues.push('缺少清晰章节结构。')
  } else {
    strengths.push('包含可识别的章节结构。')
  }

  if (paragraphCount < 3) {
    score -= 10
    issues.push('有效段落不足，内容颗粒度偏粗。')
  }

  const groundingCount = citationMarkerCount + sourceReferenceCount
  if (sourceFilePaths.length > 0 && groundingCount === 0) {
    score -= 35
    issues.push('没有看到对输入材料的来源标识或引用。')
  } else if (sourceFilePaths.length > 0 && groundingCount < 2) {
    score -= 10
    issues.push('来源标识偏少，关键结论需要更多回链。')
  } else if (groundingCount > 0) {
    strengths.push('包含来源、依据或引用标识。')
  }

  if (numericClaimCount >= 5 && groundingCount === 0) {
    score -= 15
    issues.push('存在较多数字性表述，但缺少依据标识。')
  } else if (numericClaimCount > 0) {
    strengths.push('包含可审查的数字性表述。')
  }

  if (tableMarkerCount > 0) {
    strengths.push('包含表格或清单化结构。')
  }

  if (placeholderCount > 0) {
    score -= 30
    issues.push('存在未清理的占位符或待补充内容。')
  }

  if (internalControlMarkerCount > 0) {
    score -= 25
    issues.push('正文包含内部审计或编制过程内容。')
  }

  const tableBalanceFailed = !input.tableLed && tableLineRatio > 0.45
  if (tableBalanceFailed) {
    score -= 15
    issues.push('表格占比过高，正文叙述不足。')
  }

  const threshold = input.strict ? 75 : 70
  const clampedScore = Math.max(0, Math.min(100, score))
  const dimensions = {
    structure: scoreStructureDimension(headingCount, paragraphCount, normalized.length),
    evidence: scoreEvidenceDimension(sourceFilePaths.length, groundingCount, citationMarkerCount),
    numbers: scoreNumbersDimension(numericClaimCount, groundingCount),
    specification: scoreKeywordDimension(specificationMarkerCount, sourceFilePaths.length > 0),
    risk: scoreKeywordDimension(riskMarkerCount, false),
  }

  return {
    passed: clampedScore >= threshold
      && placeholderCount === 0
      && internalControlMarkerCount === 0
      && !tableBalanceFailed
      && !(sourceFilePaths.length > 0 && groundingCount === 0),
    score: clampedScore,
    threshold,
    issues,
    strengths,
    dimensions,
    metrics: {
      textLength: normalized.length,
      headingCount,
      paragraphCount,
      citationMarkerCount,
      sourceReferenceCount,
      numericClaimCount,
      tableMarkerCount,
      placeholderCount,
      internalControlMarkerCount,
      tableLineRatio,
    },
  }
}

export function formatDocumentQualityReport(report: DocumentQualityReport): string {
  const optionalDimensions = [
    typeof report.dimensions.visuals === 'number' ? `visuals=${report.dimensions.visuals}` : undefined,
    typeof report.dimensions.template === 'number' ? `template=${report.dimensions.template}` : undefined,
  ].filter(Boolean)
  const dimensionsText = [
    `structure=${report.dimensions.structure}`,
    `evidence=${report.dimensions.evidence}`,
    `numbers=${report.dimensions.numbers}`,
    `specification=${report.dimensions.specification}`,
    `risk=${report.dimensions.risk}`,
    ...optionalDimensions,
  ].join(', ')

  return [
    `status: ${report.passed ? 'pass' : 'fail'}`,
    `score: ${report.score}/${report.threshold}`,
    `dimensions: ${dimensionsText}`,
    `metrics: textLength=${report.metrics.textLength}, headings=${report.metrics.headingCount}, paragraphs=${report.metrics.paragraphCount}, citations=${report.metrics.citationMarkerCount}, sourceRefs=${report.metrics.sourceReferenceCount}, numericClaims=${report.metrics.numericClaimCount}, tables=${report.metrics.tableMarkerCount}, tableLineRatio=${report.metrics.tableLineRatio.toFixed(2)}, placeholders=${report.metrics.placeholderCount}, internalControlMarkers=${report.metrics.internalControlMarkerCount}`,
    report.issues.length > 0 ? `issues:\n${report.issues.map(issue => `- ${issue}`).join('\n')}` : 'issues: none',
    report.strengths.length > 0 ? `strengths:\n${report.strengths.map(strength => `- ${strength}`).join('\n')}` : 'strengths: none',
  ].join('\n')
}

function countHeadings(content: string): number {
  const markdownHeadings = content.match(/(?:^|\n)\s*#{1,6}\s+\S/g)?.length ?? 0
  const numberedHeadings = content.match(/(?:^|\n)\s*(?:\d+[.)、]|[一二三四五六七八九十]+[、.．])\s*\S/g)?.length ?? 0
  const boldHeadings = content.match(/(?:^|\n)\s*\*\*[^*\n]{2,80}\*\*\s*$/g)?.length ?? 0
  return markdownHeadings + numberedHeadings + boldHeadings
}

function countTableMarkers(content: string): number {
  const markdownTableRows = content.match(/(?:^|\n)\s*\|.+\|\s*(?=\n|$)/g)?.length ?? 0
  const listRows = content.match(/(?:^|\n)\s*(?:[-*]|\d+[.)、])\s+\S.{10,}/g)?.length ?? 0
  return markdownTableRows + listRows
}

function calculateTableLineRatio(content: string): number {
  const lines = content.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  if (lines.length === 0) return 0
  const tableLines = lines.filter(line => /^\|.*\|$/.test(line)).length
  return tableLines / lines.length
}

function countInternalControlMarkers(
  content: string,
  allowed: SessionDocumentInternalArtifactKind[],
): number {
  const allowedSet = new Set(allowed)
  return INTERNAL_CONTROL_HEADING_PATTERNS.reduce((count, marker) => {
    if (allowedSet.has(marker.kind)) return count
    return count + countMatches(content, marker.pattern)
  }, 0)
}

function countSourceReferences(content: string, sourceFilePaths: string[]): number {
  const normalized = content.toLowerCase()
  let count = 0
  for (const filePath of sourceFilePaths) {
    const name = basename(filePath).toLowerCase()
    if (name && normalized.includes(name)) count += 1
    const stem = name.slice(0, name.length - extname(name).length)
    if (stem && stem.length >= 3 && normalized.includes(stem)) count += 1
  }
  return count
}

function countMatches(content: string, pattern: RegExp): number {
  pattern.lastIndex = 0
  return content.match(pattern)?.length ?? 0
}

function scoreStructureDimension(headingCount: number, paragraphCount: number, textLength: number): number {
  if (headingCount >= 3 && paragraphCount >= 4 && textLength >= 800) return 90
  if (headingCount >= 2 && paragraphCount >= 3 && textLength >= 500) return 78
  if (headingCount >= 1 || paragraphCount >= 2) return 60
  return 35
}

function scoreEvidenceDimension(sourceCount: number, groundingCount: number, citationMarkerCount: number): number {
  if (sourceCount > 0 && groundingCount >= 3) return 90
  if (sourceCount > 0 && groundingCount >= 1) return 70
  if (sourceCount > 0) return 35
  if (citationMarkerCount >= 2) return 78
  if (citationMarkerCount === 1) return 65
  return 55
}

function scoreNumbersDimension(numericClaimCount: number, groundingCount: number): number {
  if (numericClaimCount >= 5 && groundingCount > 0) return 85
  if (numericClaimCount >= 5) return 50
  if (numericClaimCount > 0) return 72
  return 60
}

function scoreKeywordDimension(markerCount: number, requiredBySource: boolean): number {
  if (markerCount >= 3) return 85
  if (markerCount >= 1) return 70
  return requiredBySource ? 45 : 60
}
