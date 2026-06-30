import type { ContentBadge, StoredAttachment } from '@craft-agent/core/types'
import type { SessionDocumentPlan, SessionGoalCriterion, SessionGoalMode, SessionTaskContract, SessionTaskContractType } from '@craft-agent/shared/sessions'

export type SessionGoalCriterionSpec = Omit<SessionGoalCriterion, 'id'>

export interface BuildGoalCriteriaInput {
  message: string
  storedAttachments?: StoredAttachment[]
  badges?: ContentBadge[]
  workingDirectory?: string
}

export interface GoalExecutionPolicy {
  mode: SessionGoalMode
  maxIterations: number
  maxWallClockMs: number
}

const BASE_DELIVERABLE_CRITERION: SessionGoalCriterionSpec = {
  text: 'Complete the user request, including any requested deliverables, constraints, referenced files, and verification steps.',
  kind: 'deliverable',
  required: true,
}

const SOURCE_GROUNDED_CRITERION: SessionGoalCriterionSpec = {
  text: 'Ground key facts, figures, clauses, and requirements in available source material; clearly mark assumptions when source evidence is unavailable.',
  kind: 'evidence',
  required: true,
}

export const FILE_OUTPUT_REQUIRED_CRITERION_TEXT = 'Create or update the requested output file(s), and leave verifiable file path evidence in the turn.'
export const TOOL_VERIFICATION_REQUIRED_CRITERION_TEXT = 'Run the requested verification command(s), and leave successful tool evidence in the turn.'
export const COMPREHENSIVE_QUALITY_CRITERION_TEXT = 'Cover the requested scope comprehensively and in enough detail for the requested high-quality work product.'
export const DOCUMENT_QUALITY_REQUIRED_CRITERION_TEXT = 'Pass a document quality audit for structure, evidence grounding, specificity, and visible gaps before completion.'
export const OUTPUT_FORMAT_REQUIRED_CRITERION_PREFIX = 'Create output file(s) in the requested format(s):'

const DOCUMENT_WORK_PATTERN = /报告|方案|文档|总结|分析|审查|计划|手册|说明|report|proposal|document|summary|analysis|review|plan|manual/i
const VERIFICATION_PATTERN = /验证|测试|检查|核对|复核|校验|verify|test|check|validate/i
const COMPREHENSIVE_PATTERN = /全面|详细|认真|深入|系统|高质量|复核|审稿|comprehensive|detailed|thorough|deep|high[- ]quality|review/i
const UNTIL_DONE_PATTERN = /直到|直至|不达标不|满足要求再|反复|多轮|continue until|until .*done|until .*complete|until .*satisf/i
const SOURCE_SENSITIVE_PATTERN = /招标|投标|合同|规范|条款|清单|工程量|图纸|报价|标书|附件|源文件|依据|boq|pdf|excel|xlsx?|csv|tender|contract|specification|clause|source|citation|cite|spreadsheet|workbook/i
const CODE_CHANGE_ACTION_PATTERN = /实现|修复|改造|开发|重构|升级|集成|接入|调试|debug|implement|fix|refactor|upgrade|integrate|debug/i
const CODE_CHANGE_SURFACE_PATTERN = /代码|源码|应用|程序|前端|后端|界面|按钮|组件|接口|路由|状态|构建|打包|脚本|测试|仓库|分支|提交|bug|崩溃|报错|typecheck|lint|build|electron|react|typescript|javascript|api|sdk|ui|button|component|frontend|backend|server|client|app|code|repo|branch|commit|crash|error/i
const OUTPUT_FILE_REQUEST_PATTERN = /(?:生成|输出|导出|保存|写入|创建|另存|转换|generate|create|write|save|export|convert).{0,80}(?:文件|file|pdf|word|excel|markdown|md|docx?|xlsx?|pptx?|csv|html?|json|txt|\.pdf|\.md|\.docx?|\.xlsx?|\.pptx?|\.csv|\.html?|\.json|\.txt)/i
const TOOL_VERIFICATION_REQUEST_PATTERN = /(?:运行|执行|跑|\b(?:run|execute)\b).{0,60}(?:测试|单测|验证|检查|构建|类型检查|\b(?:test|tests|verify|validate|check|typecheck|lint|build|tsc|pytest|vitest|jest|playwright|eslint)\b)|(?:测试|单测|验证|检查|构建|类型检查|\b(?:test|tests|verify|validate|check|typecheck|lint|build)\b).{0,40}(?:通过|成功|\b(?:pass|green|clean)\b)/i
const OUTPUT_TARGET_SEGMENT_PATTERN = /(?:转换为|转换成|转为|转成|导出为|保存为|另存为|\bconvert\b.{0,60}\b(?:to|into|as)\b|\bexport\b.{0,60}\b(?:to|as)\b|\bsave\b.{0,60}\bas\b)(.{0,80})/i
const EXPLICIT_REQUIREMENT_INTRO_PATTERN = /(?:必须包含|需要包含|应包含|至少包含|包含以下|包括以下|输出要求|验收标准|要求如下|requirements?|acceptance criteria|must include|should include|include the following)\s*[:：]?\s*([\s\S]*)/i
const EXPLICIT_REQUIREMENT_ITEM_PATTERN = /^\s*(?:[-*•]|\d+[.)、]|[一二三四五六七八九十]+[、.．]|[a-z][.)])\s*(.+)$/i
const DOCUMENT_AUDIENCE_PATTERN = /(?:面向|给|for)\s*([^，。,.；;\n]{2,40})(?:使用|阅读|汇报|生成|输出|制作|看的|$)/i
const DOCUMENT_TONE_PATTERN = /(?:语气|风格|口吻|tone|style)\s*[:：为是]?\s*([^，。,.；;\n]{2,40})/i
const DOCUMENT_LENGTH_PATTERN = /(?:篇幅|长度|字数|页数|length)\s*[:：为是]?\s*([^，。,.；;\n]{2,40})/i
const TITLE_HINT_PATTERN = /(?:标题|题目|命名为|文件名|title)\s*[:：为是]?\s*([^，。,.；;\n]{2,80})/i
const VISUAL_ENHANCEMENT_PATTERN = /图表|图形|可视化|柱状|折线|饼图|占比|趋势|分布|流程图|架构图|关系图|chart|graph|plot|visual|visualization|bar|line|pie|trend|distribution|flowchart|diagram/i
const EMBEDDED_HTML_PATTERN = /html|HTML|内嵌|嵌入|embed|embedded|interactive/i
const PROCESS_VISUAL_PATTERN = /流程|关系|架构|步骤|路径|process|workflow|architecture|relationship|diagram/i
const OUTPUT_FORMAT_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: 'PDF', pattern: /(?:\.pdf\b|\bpdf\b)/i },
  { label: 'DOCX', pattern: /(?:\.docx?\b|\bdocx?\b|\bword\b)/i },
  { label: 'XLSX', pattern: /(?:\.xlsx?\b|\bxlsx?\b|\bexcel\b|\bspreadsheet\b|\bworkbook\b)/i },
  { label: 'PPTX', pattern: /(?:\.pptx?\b|\bpptx?\b|\bpowerpoint\b|\bslides?\b)/i },
  { label: 'MD', pattern: /(?:\.md\b|markdown|\bmd\b)/i },
  { label: 'CSV', pattern: /(?:\.csv\b|\bcsv\b)/i },
  { label: 'HTML', pattern: /(?:\.html?\b|\bhtml?\b)/i },
  { label: 'JSON', pattern: /(?:\.json\b|\bjson\b)/i },
  { label: 'TXT', pattern: /(?:\.txt\b|\btxt\b|\btext\b)/i },
]

const LOCAL_PATH_PATTERN = /(?:[A-Za-z]:\\[^\s"'<>|]+|\/[^\s"'<>|]+)/g
const NUMERIC_DETAIL_PATTERN = /(?:\b\d+(?:[.,]\d+)*(?:\s?[%万亿千百元美元日天月年页项轮次mb|gb|kb|m|km|h])?\b|\b\d{4}[-/.年]\d{1,2}(?:[-/.月]\d{1,2}日?)?\b)/gi

export function buildGoalCriteriaFromMessage(input: BuildGoalCriteriaInput): SessionGoalCriterionSpec[] {
  const criteria: SessionGoalCriterionSpec[] = [BASE_DELIVERABLE_CRITERION]
  const message = input.message.trim()
  const referencedNames = getReferencedNames(input)

  if (referencedNames.length > 0) {
    criteria.push({
      text: `Use and cite the referenced input material where relevant: ${referencedNames.join(', ')}.`,
      kind: 'evidence',
      required: true,
    })
  } else if (SOURCE_SENSITIVE_PATTERN.test(message)) {
    criteria.push(SOURCE_GROUNDED_CRITERION)
  }

  if (DOCUMENT_WORK_PATTERN.test(message)) {
    criteria.push({
      text: 'Produce a structured, readable deliverable with clear sections and enough detail for the requested work product.',
      kind: 'format',
      required: true,
    })
  }

  if (COMPREHENSIVE_PATTERN.test(message)) {
    criteria.push({
      text: COMPREHENSIVE_QUALITY_CRITERION_TEXT,
      kind: 'coverage',
      required: true,
    })
  }

  if (DOCUMENT_WORK_PATTERN.test(message) && (referencedNames.length > 0 || SOURCE_SENSITIVE_PATTERN.test(message) || COMPREHENSIVE_PATTERN.test(message))) {
    criteria.push({
      text: DOCUMENT_QUALITY_REQUIRED_CRITERION_TEXT,
      kind: 'coverage',
      required: true,
    })
  }

  for (const requirement of extractExplicitUserRequirements(message)) {
    criteria.push({
      text: `Must satisfy explicit user requirement: ${requirement}.`,
      kind: 'user_constraint',
      required: true,
    })
  }

  if (VERIFICATION_PATTERN.test(message)) {
    criteria.push({
      text: 'Run or describe appropriate validation steps, and report the verification result clearly.',
      kind: 'test',
      required: true,
    })
  }

  if (TOOL_VERIFICATION_REQUEST_PATTERN.test(message) || isCodeChangeRequest(message)) {
    criteria.push({
      text: TOOL_VERIFICATION_REQUIRED_CRITERION_TEXT,
      kind: 'test',
      required: true,
    })
  }

  if (OUTPUT_FILE_REQUEST_PATTERN.test(message)) {
    criteria.push({
      text: FILE_OUTPUT_REQUIRED_CRITERION_TEXT,
      kind: 'deliverable',
      required: true,
    })

    const outputFormats = getRequestedOutputFormats(message)
    if (outputFormats.length > 0) {
      criteria.push({
        text: `${OUTPUT_FORMAT_REQUIRED_CRITERION_PREFIX} ${outputFormats.join(', ')}.`,
        kind: 'format',
        required: true,
      })
    }
  }

  return dedupeCriteria(criteria)
}

export function buildTaskContractFromMessage(input: BuildGoalCriteriaInput): SessionTaskContract {
  const message = input.message.trim()
  const referencedNames = getReferencedNames(input)
  const explicitRequirements = extractExplicitUserRequirements(message)
  const outputFormats = getRequestedOutputFormats(message)
  const taskType = getTaskContractType(message)
  const deliverables = buildTaskContractDeliverables(message, taskType)
  const documentPlan = buildDocumentPlan({
    message,
    taskType,
    referencedNames,
    explicitRequirements,
    outputFormats,
  })
  const evidenceRequirements = buildTaskContractEvidenceRequirements(message, referencedNames, taskType)
  const acceptanceCriteria = buildGoalCriteriaFromMessage(input).map(criterion => `[${criterion.kind}] ${criterion.text}`)
  const mustPreserve = uniqueBounded([
    ...explicitRequirements.map(item => `Explicit requirement: ${item}`),
    ...referencedNames.map(item => `Referenced material: ${item}`),
    ...outputFormats.map(item => `Requested output format: ${item}`),
    ...extractLocalPathMentions(message).map(item => `Path: ${item}`),
    ...extractNumericDetails(message).map(item => `Numeric/date detail: ${item}`),
  ], 16)
  const forbiddenShortcuts = buildForbiddenShortcuts(message, taskType)

  return {
    originalRequest: message.slice(0, 4000),
    taskType,
    documentPlan,
    deliverables,
    mustPreserve,
    evidenceRequirements,
    outputFormats,
    acceptanceCriteria,
    forbiddenShortcuts,
    workingDirectory: input.workingDirectory,
  }
}

export function mergeTaskContracts(current: SessionTaskContract | undefined, next: SessionTaskContract): SessionTaskContract {
  if (!current) return next

  return {
    ...current,
    followUpRequests: uniqueBounded([
      ...(current.followUpRequests ?? []),
      next.originalRequest,
      ...(next.followUpRequests ?? []),
    ], 8).map(item => item.slice(0, 1200)),
    taskType: current.taskType === 'general' ? next.taskType : current.taskType,
    documentPlan: mergeDocumentPlans(current.documentPlan, next.documentPlan),
    deliverables: uniqueBounded([...current.deliverables, ...next.deliverables], 12),
    mustPreserve: uniqueBounded([...current.mustPreserve, ...next.mustPreserve], 24),
    evidenceRequirements: uniqueBounded([...current.evidenceRequirements, ...next.evidenceRequirements], 12),
    outputFormats: uniqueBounded([...current.outputFormats, ...next.outputFormats], 8),
    acceptanceCriteria: uniqueBounded([...current.acceptanceCriteria, ...next.acceptanceCriteria], 24),
    forbiddenShortcuts: uniqueBounded([...current.forbiddenShortcuts, ...next.forbiddenShortcuts], 12),
    workingDirectory: current.workingDirectory ?? next.workingDirectory,
  }
}

export function formatTaskContractForPrompt(contract: SessionTaskContract | undefined): string {
  if (!contract) return '(none)'

  const sections = [
    ['Task type', contract.taskType],
    ['Document plan', formatDocumentPlan(contract.documentPlan)],
    ['Original request', contract.originalRequest],
    ['Follow-up requests', formatContractList(contract.followUpRequests)],
    ['Deliverables', formatContractList(contract.deliverables)],
    ['Must preserve', formatContractList(contract.mustPreserve)],
    ['Evidence requirements', formatContractList(contract.evidenceRequirements)],
    ['Output formats', formatContractList(contract.outputFormats)],
    ['Acceptance criteria', formatContractList(contract.acceptanceCriteria)],
    ['Forbidden shortcuts', formatContractList(contract.forbiddenShortcuts)],
    ['Working directory', contract.workingDirectory ?? '(none)'],
  ]

  return sections
    .map(([label, value]) => `${label}:\n${value}`)
    .join('\n\n')
}

export function buildGoalCriteriaUpdateFromMessage(input: BuildGoalCriteriaInput): SessionGoalCriterionSpec[] {
  const message = input.message.trim()
  const criteria = buildGoalCriteriaFromMessage(input)
    .filter(criterion => criterion.kind !== BASE_DELIVERABLE_CRITERION.kind || criterion.text !== BASE_DELIVERABLE_CRITERION.text)

  if (message) {
    criteria.unshift({
      text: `Also satisfy this follow-up instruction: ${message.slice(0, 1000)}.`,
      kind: 'user_constraint',
      required: true,
    })
  }

  return dedupeCriteria(criteria)
}

function getTaskContractType(message: string): SessionTaskContractType {
  if (isCodeChangeRequest(message)) return 'code'
  if (/自动化|定时任务|事件触发|workflow|automation|scheduled|trigger/i.test(message)) return 'automation'
  if (/调研|搜索|尽调|研究|资料|research|investigate|survey/i.test(message)) return 'research'
  if (DOCUMENT_WORK_PATTERN.test(message)) return 'document'
  if (/数据|表格|清单|统计|测算|分析表|excel|xlsx?|csv|database|sql|data|spreadsheet/i.test(message)) return 'data'
  if (OUTPUT_FILE_REQUEST_PATTERN.test(message) || /文件|目录|附件|上传|转换|file|folder|attachment|convert/i.test(message)) return 'file'
  return 'general'
}

function buildTaskContractDeliverables(message: string, taskType: SessionTaskContractType): string[] {
  const deliverables: string[] = []

  if (DOCUMENT_WORK_PATTERN.test(message)) {
    deliverables.push('Produce a structured, readable work product with clear sections and enough detail for the requested audience.')
  }
  if (OUTPUT_FILE_REQUEST_PATTERN.test(message)) {
    deliverables.push('Create or update the requested output file(s) and report verifiable local file path evidence.')
  }
  if (isCodeChangeRequest(message)) {
    deliverables.push('Change only the necessary code, preserve existing behavior outside the request, and verify the change.')
  }
  if (taskType === 'research') {
    deliverables.push('Provide a sourced research result with conclusions separated from assumptions or unresolved questions.')
  }
  if (taskType === 'data') {
    deliverables.push('Preserve important figures, tables, formulas, and data boundaries when analyzing or transforming data.')
  }

  if (deliverables.length === 0) {
    deliverables.push('Complete the user request without reducing its scope or replacing it with a generic summary.')
  }

  return uniqueBounded(deliverables, 8)
}

function buildTaskContractEvidenceRequirements(
  message: string,
  referencedNames: string[],
  taskType: SessionTaskContractType,
): string[] {
  const requirements: string[] = []

  if (referencedNames.length > 0) {
    requirements.push(`Use the referenced material where relevant: ${referencedNames.join(', ')}.`)
  } else if (SOURCE_SENSITIVE_PATTERN.test(message)) {
    requirements.push('Ground key facts, figures, clauses, and requirements in available source material; mark unsupported claims as assumptions.')
  }
  if (taskType === 'code') {
    requirements.push('Inspect the actual implementation before changing code and verify with the narrowest meaningful checks.')
  }
  if (VERIFICATION_PATTERN.test(message)) {
    requirements.push('Leave clear verification evidence instead of only stating that verification was done.')
  }
  if (VISUAL_ENHANCEMENT_PATTERN.test(message) || EMBEDDED_HTML_PATTERN.test(message)) {
    requirements.push('Create visual enhancements only from verified source data; if data is unavailable, state that the visualization cannot be supported.')
  }

  return uniqueBounded(requirements, 8)
}

function buildDocumentPlan(input: {
  message: string
  taskType: SessionTaskContractType
  referencedNames: string[]
  explicitRequirements: string[]
  outputFormats: string[]
}): SessionDocumentPlan | undefined {
  if (!shouldCreateDocumentPlan(input.message, input.taskType)) {
    return undefined
  }

  const sections = buildDocumentPlanSections(input.message, input.explicitRequirements, input.taskType)
  const tables = buildDocumentPlanTables(input.message, input.explicitRequirements, input.taskType)
  const charts = buildDocumentPlanCharts(input.message, input.explicitRequirements)
  const enhancements = buildDocumentPlanEnhancements(input.message, tables, charts)
  const citations = input.referencedNames.length > 0
    ? input.referencedNames.map(name => `Cite or reference ${name} where it supports key facts.`)
    : SOURCE_SENSITIVE_PATTERN.test(input.message)
      ? ['Cite source files, clauses, tables, pages, or clearly mark unavailable evidence as pending verification.']
      : []

  return {
    title: extractFirstMatch(input.message, TITLE_HINT_PATTERN),
    audience: extractFirstMatch(input.message, DOCUMENT_AUDIENCE_PATTERN),
    tone: extractFirstMatch(input.message, DOCUMENT_TONE_PATTERN),
    length: extractFirstMatch(input.message, DOCUMENT_LENGTH_PATTERN),
    sections,
    tables,
    charts,
    enhancements,
    citations,
    deliveryFormats: input.outputFormats,
  }
}

function shouldCreateDocumentPlan(message: string, taskType: SessionTaskContractType): boolean {
  return taskType === 'document'
    || taskType === 'research'
    || (taskType === 'data' && DOCUMENT_WORK_PATTERN.test(message))
    || /报告|方案|简报|手册|清单|章节|表格|图表|引用|交付|PPT|幻灯片|word|docx|pptx|pdf|report|proposal|brief|manual|slides?|section|table|chart|citation|deliverable/i.test(message)
}

function buildDocumentPlanSections(message: string, explicitRequirements: string[], taskType: SessionTaskContractType): string[] {
  const sections = explicitRequirements.length > 0
    ? explicitRequirements
    : taskType === 'research'
      ? ['Research objective', 'Key findings', 'Evidence and sources', 'Risks or uncertainties', 'Recommended next steps']
      : taskType === 'data'
        ? ['Objective and data scope', 'Method', 'Key tables', 'Charts and interpretation', 'Conclusions and caveats']
        : ['Objective and scope', 'Source material and assumptions', 'Main analysis', 'Risks or gaps', 'Conclusion and next steps']

  if (/目录|toc|table of contents/i.test(message)) {
    sections.unshift('Table of contents')
  }
  if (/摘要|执行摘要|summary|executive summary/i.test(message)) {
    sections.unshift('Executive summary')
  }
  if (/附录|appendix/i.test(message)) {
    sections.push('Appendix')
  }

  return uniqueBounded(sections, 16)
}

function buildDocumentPlanTables(message: string, explicitRequirements: string[], taskType: SessionTaskContractType): string[] {
  const tables: string[] = []
  const hasTableRequest = /表格|清单|矩阵|对比表|统计表|table|matrix|schedule|boq|excel|xlsx|csv/i.test(message)

  if (hasTableRequest || taskType === 'data') {
    tables.push('Use readable native tables for key structured data instead of plain text table-like paragraphs.')
  }
  for (const requirement of explicitRequirements) {
    if (/表|清单|矩阵|对比|风险|问题|数据|table|matrix|risk|issue|data/i.test(requirement)) {
      tables.push(`Table for: ${requirement}`)
    }
  }

  return uniqueBounded(tables, 8)
}

function buildDocumentPlanCharts(message: string, explicitRequirements: string[]): string[] {
  const charts: string[] = []
  if (VISUAL_ENHANCEMENT_PATTERN.test(message)) {
    charts.push('Generate chart specs from verified data first, then render charts as inspectable SVG/PNG before embedding in formal documents.')
  }
  for (const requirement of explicitRequirements) {
    if (VISUAL_ENHANCEMENT_PATTERN.test(requirement)) {
      charts.push(`Chart for: ${requirement}`)
    }
  }
  return uniqueBounded(charts, 8)
}

function buildDocumentPlanEnhancements(message: string, tables: string[], charts: string[]): string[] {
  const enhancements: string[] = []

  if (charts.length > 0) {
    enhancements.push('Use structured chart specifications such as chart.json before rendering visual assets; every data point must come from verified source data.')
  }
  if (EMBEDDED_HTML_PATTERN.test(message)) {
    enhancements.push('HTML or embedded visual blocks may improve readability, but they must be based on verified data and remain inspectable.')
  }
  if (PROCESS_VISUAL_PATTERN.test(message)) {
    enhancements.push('Use diagram or flow visuals only when the process or relationship is supported by source material or explicit user input.')
  }
  if (tables.length > 0) {
    enhancements.push('Prefer native readable tables for structured facts; do not replace source-backed tables with prose only.')
  }

  return uniqueBounded(enhancements, 8)
}

function mergeDocumentPlans(current: SessionDocumentPlan | undefined, next: SessionDocumentPlan | undefined): SessionDocumentPlan | undefined {
  if (!current) return next
  if (!next) return current

  return {
    title: current.title ?? next.title,
    audience: current.audience ?? next.audience,
    tone: current.tone ?? next.tone,
    length: current.length ?? next.length,
    sections: uniqueBounded([...current.sections, ...next.sections], 24),
    tables: uniqueBounded([...current.tables, ...next.tables], 12),
    charts: uniqueBounded([...current.charts, ...next.charts], 12),
    enhancements: uniqueBounded([...(current.enhancements ?? []), ...(next.enhancements ?? [])], 12),
    citations: uniqueBounded([...current.citations, ...next.citations], 12),
    deliveryFormats: uniqueBounded([...current.deliveryFormats, ...next.deliveryFormats], 8),
  }
}

function formatDocumentPlan(plan: SessionDocumentPlan | undefined): string {
  if (!plan) return '(none)'
  return [
    `Title: ${plan.title ?? '(unspecified)'}`,
    `Audience: ${plan.audience ?? '(unspecified)'}`,
    `Tone: ${plan.tone ?? '(unspecified)'}`,
    `Length: ${plan.length ?? '(unspecified)'}`,
    `Sections:\n${formatContractList(plan.sections)}`,
    `Tables:\n${formatContractList(plan.tables)}`,
    `Charts:\n${formatContractList(plan.charts)}`,
    `Enhancements:\n${formatContractList(plan.enhancements ?? [])}`,
    `Citations:\n${formatContractList(plan.citations)}`,
    `Delivery formats:\n${formatContractList(plan.deliveryFormats)}`,
  ].join('\n')
}

function extractFirstMatch(message: string, pattern: RegExp): string | undefined {
  const value = message.match(pattern)?.[1]?.trim()
  return value || undefined
}

function buildForbiddenShortcuts(message: string, taskType: SessionTaskContractType): string[] {
  const shortcuts: string[] = [
    'Do not silently simplify, summarize away, or omit explicit user requirements.',
    'Do not claim completion without evidence for requested files, checks, or source-backed facts.',
  ]

  if (COMPREHENSIVE_PATTERN.test(message) || DOCUMENT_WORK_PATTERN.test(message)) {
    shortcuts.push('Do not replace the requested document-quality work product with a high-level outline, template, or brief note.')
  }
  if (SOURCE_SENSITIVE_PATTERN.test(message)) {
    shortcuts.push('Do not invent facts, figures, clauses, page numbers, file names, dates, prices, or technical parameters.')
  }
  if (VISUAL_ENHANCEMENT_PATTERN.test(message) || EMBEDDED_HTML_PATTERN.test(message)) {
    shortcuts.push('Do not create charts, HTML visual blocks, diagrams, or visual summaries from invented data; use verified data or mark the visualization basis as unavailable.')
  }
  if (taskType === 'code') {
    shortcuts.push('Do not refactor unrelated code or skip verification when the user asked for an implementation fix.')
  }

  return uniqueBounded(shortcuts, 8)
}

function extractLocalPathMentions(message: string): string[] {
  return uniqueBounded([...message.matchAll(LOCAL_PATH_PATTERN)].map(match => match[0].trim()), 8)
}

function extractNumericDetails(message: string): string[] {
  return uniqueBounded([...message.matchAll(NUMERIC_DETAIL_PATTERN)].map(match => match[0].trim()), 12)
}

function formatContractList(items: readonly string[] | undefined): string {
  const values = (items ?? []).map(item => item.trim()).filter(Boolean)
  return values.length > 0
    ? values.map((item, index) => `${index + 1}. ${item}`).join('\n')
    : '(none)'
}

function uniqueBounded(items: string[], limit: number): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const item of items) {
    const cleaned = item.replace(/\s+/g, ' ').trim()
    if (!cleaned) continue
    const key = cleaned.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    result.push(cleaned)
    if (result.length >= limit) break
  }
  return result
}

export function buildGoalExecutionPolicyFromMessage(input: BuildGoalCriteriaInput): GoalExecutionPolicy {
  const message = input.message.trim()
  let maxIterations = 2
  let maxWallClockMs = 15 * 60 * 1000

  if ((input.storedAttachments?.length ?? 0) > 0 && (DOCUMENT_WORK_PATTERN.test(message) || SOURCE_SENSITIVE_PATTERN.test(message))) {
    maxIterations = 3
    maxWallClockMs = 30 * 60 * 1000
  }

  if (COMPREHENSIVE_PATTERN.test(message)) {
    maxIterations = 3
    maxWallClockMs = 30 * 60 * 1000
  }

  if (UNTIL_DONE_PATTERN.test(message)) {
    maxIterations = 4
    maxWallClockMs = 45 * 60 * 1000
  }

  return {
    mode: 'auto_improve',
    maxIterations,
    maxWallClockMs,
  }
}

function getReferencedNames(input: BuildGoalCriteriaInput): string[] {
  const names = new Set<string>()

  for (const attachment of input.storedAttachments ?? []) {
    if (attachment.name.trim()) names.add(attachment.name.trim())
  }

  for (const badge of input.badges ?? []) {
    if ((badge.type === 'file' || badge.type === 'folder') && badge.label.trim()) {
      names.add(badge.label.trim())
    }
  }

  return [...names].slice(0, 6)
}

function getRequestedOutputFormats(message: string): string[] {
  const targetSegment = message.match(OUTPUT_TARGET_SEGMENT_PATTERN)?.[1] ?? message
  return OUTPUT_FORMAT_PATTERNS
    .filter(({ pattern }) => pattern.test(targetSegment))
    .map(({ label }) => label)
}

function isCodeChangeRequest(message: string): boolean {
  return CODE_CHANGE_ACTION_PATTERN.test(message) && CODE_CHANGE_SURFACE_PATTERN.test(message)
}

function extractExplicitUserRequirements(message: string): string[] {
  const introMatch = message.match(EXPLICIT_REQUIREMENT_INTRO_PATTERN)
  const segment = introMatch?.[1]?.trim() ?? ''
  if (!segment) return []

  const items = segment
    .split(/\r?\n/)
    .map(line => line.match(EXPLICIT_REQUIREMENT_ITEM_PATTERN)?.[1] ?? line)
    .flatMap(line => splitInlineRequirementItems(line))
    .map(cleanExplicitRequirementItem)
    .filter((item): item is string => item !== undefined)

  return [...new Set(items)].slice(0, 8)
}

function splitInlineRequirementItems(line: string): string[] {
  const trimmed = line.trim()
  if (!trimmed) return []
  if (EXPLICIT_REQUIREMENT_ITEM_PATTERN.test(trimmed)) return [trimmed]
  return trimmed.split(/[;；、]/)
}

function cleanExplicitRequirementItem(value: string): string | undefined {
  const cleaned = value
    .replace(EXPLICIT_REQUIREMENT_ITEM_PATTERN, '$1')
    .replace(/[。.!！?？,，]+$/g, '')
    .replace(/^(?:和|及|以及)\s*/g, '')
    .trim()
  if (cleaned.length < 2 || cleaned.length > 160) return undefined
  if (/^(?:等|etc\.?)$/i.test(cleaned)) return undefined
  return cleaned
}

function dedupeCriteria(criteria: SessionGoalCriterionSpec[]): SessionGoalCriterionSpec[] {
  const seen = new Set<string>()
  return criteria.filter(criterion => {
    const key = `${criterion.kind}\u0000${criterion.text}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
