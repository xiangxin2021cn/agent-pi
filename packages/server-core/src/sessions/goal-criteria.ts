import type { ContentBadge, StoredAttachment } from '@craft-agent/core/types'
import { detectDocumentDomain, suggestVisuals } from '@craft-agent/shared/document-visuals'
import type { VisualOpportunity, VisualPlan } from '@craft-agent/shared/document-visuals'
import type { SessionDocumentAgentPlan, SessionDocumentDeliveryGate, SessionDocumentDeliveryReviewPlan, SessionDocumentEvidenceMatrixEntry, SessionDocumentPlan, SessionDocumentQualityMode, SessionGoalCriterion, SessionGoalMode, SessionTaskContract, SessionTaskContractType } from '@craft-agent/shared/sessions'

export type SessionGoalCriterionSpec = Omit<SessionGoalCriterion, 'id'>

export interface BuildGoalCriteriaInput {
  message: string
  storedAttachments?: StoredAttachment[]
  badges?: ContentBadge[]
  workingDirectory?: string
  documentQualityMode?: SessionDocumentQualityMode
}

export interface GoalExecutionPolicy {
  mode: SessionGoalMode
  maxIterations: number
  maxWallClockMs: number
}

export const MAX_AUTOMATIC_GOAL_REPAIR_PASSES = 2

const BASE_DELIVERABLE_CRITERION: SessionGoalCriterionSpec = {
  text: 'Complete the user request, including any requested deliverables, constraints, referenced files, and verification steps.',
  kind: 'deliverable',
  required: true,
}

const SOURCE_GROUNDED_CRITERION: SessionGoalCriterionSpec = {
  text: 'Ground key facts, figures, clauses, and requirements in user-selected sources, attachments, or explicitly named files/folders; clearly mark assumptions when source evidence is unavailable.',
  kind: 'evidence',
  required: true,
}

export const FILE_OUTPUT_REQUIRED_CRITERION_TEXT = 'Create or update the requested output file(s), and leave verifiable file path evidence in the turn.'
export const TOOL_VERIFICATION_REQUIRED_CRITERION_TEXT = 'Run the requested verification command(s), and leave successful tool evidence in the turn.'
export const COMPREHENSIVE_QUALITY_CRITERION_TEXT = 'Cover the requested scope comprehensively and in enough detail for the requested high-quality work product.'
export const DOCUMENT_QUALITY_REQUIRED_CRITERION_TEXT = 'Pass a document quality audit for structure, evidence grounding, specificity, and visible gaps before completion.'
export const VISUAL_BLOCK_AUDIT_REQUIRED_CRITERION_TEXT = 'Pass a visual block audit for required professional visuals, captions, source notes, and evidence-backed data before completion.'
export const TEMPLATE_FIDELITY_REQUIRED_CRITERION_TEXT = 'Pass a template fidelity audit when a reference template or strict layout requirement is present; prompt-only compliance is insufficient.'
export const OUTPUT_FORMAT_REQUIRED_CRITERION_PREFIX = 'Create output file(s) in the requested format(s):'

const DOCUMENT_WORK_PATTERN = /报告|方案|文档|总结|分析|审查|计划|手册|说明|report|proposal|document|summary|analysis|review|plan|manual/i
const RESEARCH_WORK_PATTERN = /调研|搜索|尽调|研究|资料|research|investigate|survey/i
const VERIFICATION_PATTERN = /验证|测试|检查|核对|复核|校验|verify|test|check|validate/i
const COMPREHENSIVE_PATTERN = /全面|详细|认真|深入|深度|系统|高质量|复核|审稿|comprehensive|detailed|thorough|deep|high[- ]quality|review/i
const UNTIL_DONE_PATTERN = /直到|直至|不达标不|满足要求再|反复|多轮|continue until|until .*done|until .*complete|until .*satisf/i
const SOURCE_SENSITIVE_PATTERN = /招标|投标|合同|规范|条款|清单|工程量|图纸|报价|标书|附件|源文件|依据|boq|pdf|excel|xlsx?|csv|tender|contract|specification|clause|source|citation|cite|spreadsheet|workbook/i
const CODE_CHANGE_ACTION_PATTERN = /实现|修复|改造|开发|重构|升级|集成|接入|调试|debug|implement|fix|refactor|upgrade|integrate|debug/i
const CODE_CHANGE_SURFACE_PATTERN = /代码|源码|应用|程序|前端|后端|界面|按钮|组件|接口|路由|状态|构建|打包|脚本|测试|仓库|分支|提交|bug|崩溃|报错|typecheck|lint|build|electron|react|typescript|javascript|api|sdk|ui|button|component|frontend|backend|server|client|app|code|repo|branch|commit|crash|error/i
const OUTPUT_FILE_REQUEST_PATTERN = /(?:生成|输出|导出|保存|写入|创建|另存|转换|generate|create|write|save|export|convert).{0,80}(?:文件|file|pdf|word|excel|markdown|md|docx?|xlsx?|pptx?|csv|html?|json|txt|\.pdf|\.md|\.docx?|\.xlsx?|\.pptx?|\.csv|\.html?|\.json|\.txt)/i
const TOOL_VERIFICATION_REQUEST_PATTERN = /(?:运行|执行|跑|\b(?:run|execute)\b).{0,60}(?:测试|单测|验证|检查|构建|类型检查|\b(?:test|tests|verify|validate|check|typecheck|lint|build|tsc|pytest|vitest|jest|playwright|eslint)\b)|(?:测试|单测|验证|检查|构建|类型检查|\b(?:test|tests|verify|validate|check|typecheck|lint|build)\b).{0,40}(?:通过|成功|\b(?:pass|green|clean)\b)/i
const OUTPUT_TARGET_SEGMENT_PATTERN = /(?:转换为|转换成|转为|转成|导出为|保存为|另存为|\bconvert\b.{0,60}\b(?:to|into|as)\b|\bexport\b.{0,60}\b(?:to|as)\b|\bsave\b.{0,60}\bas\b)(.{0,80})/i
const EXPLICIT_REQUIREMENT_INTRO_PATTERN = /(?:必须包含|需要包含|应包含|至少包含|包含以下|包括以下|输出要求|验收标准|要求(?:如下)?|requirements?|acceptance criteria|must include|should include|include the following)\s*[:：]?\s*([\s\S]*)/i
const EXPLICIT_REQUIREMENT_ITEM_PATTERN = /^\s*(?:[-*•]|\d+[.)、]|[一二三四五六七八九十]+[、.．]|[a-z][.)])\s*(.+)$/i
const DOCUMENT_AUDIENCE_PATTERN = /(?:面向|给|for)\s*([^，。,.；;\n]{2,40})(?:使用|阅读|汇报|生成|输出|制作|看的|$)/i
const DOCUMENT_TONE_PATTERN = /(?:语气|风格|口吻|tone|style)\s*[:：为是]?\s*([^，。,.；;\n]{2,40})/i
const DOCUMENT_LENGTH_PATTERN = /(?:篇幅|长度|字数|页数|length)\s*[:：为是]?\s*([^，。,.；;\n]{2,40})/i
const TITLE_HINT_PATTERN = /(?:标题|题目|命名为|文件名|title)\s*[:：为是]?\s*([^，。,.；;\n]{2,80})/i
const VISUAL_ENHANCEMENT_PATTERN = /图表|图形|可视化|柱状|折线|饼图|占比|趋势|分布|流程图|架构图|关系图|chart|graph|plot|visual|visualization|bar|line|pie|trend|distribution|flowchart|diagram/i
const PROFESSIONAL_VISUAL_PATTERN = /专业.*(?:图|表|报告)|甘特|wbs|基线|当前计划|关键路径|进度线|里程碑|a3|a4|现金流|净现值|内部收益率|敏感性|地理|地图|路线|桩号|坐标|仿真|有限元|应力|位移|收敛|gantt|baseline|critical path|milestone|cash\s*flow|npv|irr|sensitivity|geospatial|gis|coordinate|chainage|ansys|cae|fea|stress|displacement|convergence/i
const STRICT_TEMPLATE_PATTERN = /严格.{0,12}(?:模板|版式|格式|布局|字体|目录|样式)|(?:按照|按|依照|复刻|保持|匹配).{0,24}(?:上传|参考|word|docx|pdf)?.{0,24}(?:模板|版式|格式|页面布局|字体|目录层级|大纲|样式)|template.{0,24}(?:layout|style|format|fidelity|strict)|reference.{0,16}template|word模板|pdf模板/i
const EMBEDDED_HTML_PATTERN = /html|HTML|内嵌|嵌入|embed|embedded|interactive/i
const PROCESS_VISUAL_PATTERN = /流程|关系|架构|步骤|路径|process|workflow|architecture|relationship|diagram/i
const PROFESSIONAL_DOCUMENT_MODE_PATTERN = /专业文档|专业报告|正式报告|正式文档|证据矩阵|章节计划|质量审查|高质量报告|professional document|professional report|evidence matrix|chapter plan|quality audit/i
const STRICT_DELIVERY_MODE_PATTERN = /正式交付|最终交付|交付版|必须通过.{0,40}(?:来源|模板|导出|图表|格式).*审查|strict delivery|delivery gates?/i
const MULTI_AGENT_DEEP_MODE_PATTERN = /多智能体深度|多智能体|分章节智能体|子智能体|多角色评审|大型投标|大型.{0,12}(?:工程|投标|尽调|报告)|due diligence|large tender|multi[- ]agent|sub[- ]agent|chapter agents?|role review/i
const COMPLEX_AGENT_ORCHESTRATION_PATTERN = /多文件|多来源|多章节|多专业|多角色|全文|全册|整册|全规范|大型|复杂|综合|投标|尽调|工程报告|施工组织|成本|进度|风险|many files|multiple sources|multi[- ]source|multi[- ]chapter|complex|large|full report|whole report|due diligence|tender|engineering report/i
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
  const explicitQuickMode = input.documentQualityMode === 'quick'
  const isDocumentWork = DOCUMENT_WORK_PATTERN.test(message)
  const isResearchWork = RESEARCH_WORK_PATTERN.test(message)
  const isComprehensiveWork = COMPREHENSIVE_PATTERN.test(message)
  const isSourceSensitive = SOURCE_SENSITIVE_PATTERN.test(message)

  if (referencedNames.length > 0) {
    criteria.push({
      text: `Use and cite the referenced input material where relevant: ${referencedNames.join(', ')}.`,
      kind: 'evidence',
      required: true,
    })
  } else if (isSourceSensitive || isResearchWork) {
    criteria.push(SOURCE_GROUNDED_CRITERION)
  }

  if (isDocumentWork || (isResearchWork && isComprehensiveWork)) {
    criteria.push({
      text: 'Produce a structured, readable deliverable with clear sections and enough detail for the requested work product.',
      kind: 'format',
      required: true,
    })
  }

  if (isComprehensiveWork) {
    criteria.push({
      text: COMPREHENSIVE_QUALITY_CRITERION_TEXT,
      kind: 'coverage',
      required: true,
    })
  }

  if (!explicitQuickMode && (isDocumentWork || isResearchWork) && (referencedNames.length > 0 || isSourceSensitive || isComprehensiveWork || isResearchWork)) {
    criteria.push({
      text: DOCUMENT_QUALITY_REQUIRED_CRITERION_TEXT,
      kind: 'coverage',
      required: true,
    })
  }

  if (!explicitQuickMode && requiresVisualBlockAudit(message)) {
    criteria.push({
      text: VISUAL_BLOCK_AUDIT_REQUIRED_CRITERION_TEXT,
      kind: 'coverage',
      required: true,
    })
  }

  if (!explicitQuickMode && requiresTemplateFidelityAudit(message, input.storedAttachments)) {
    criteria.push({
      text: TEMPLATE_FIDELITY_REQUIRED_CRITERION_TEXT,
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
  const detectedTaskType = getTaskContractType(message)
  const taskType = getTaskContractTypeWithDocumentMode(detectedTaskType, input.documentQualityMode)
  const documentQualityMode = input.documentQualityMode ?? getDocumentQualityMode(message, input, taskType)
  const deliverables = buildTaskContractDeliverables(message, taskType)
  const documentPlan = buildDocumentPlan({
    message,
    taskType,
    documentQualityMode,
    referencedNames,
    explicitRequirements,
    outputFormats,
  })
  const evidenceRequirements = buildTaskContractEvidenceRequirements(message, referencedNames, taskType, documentQualityMode)
  const acceptanceCriteria = buildGoalCriteriaFromMessage(input).map(criterion => `[${criterion.kind}] ${criterion.text}`)
  const mustPreserve = uniqueBounded([
    ...explicitRequirements.map(item => `Explicit requirement: ${item}`),
    ...referencedNames.map(item => `Referenced material: ${item}`),
    ...outputFormats.map(item => `Requested output format: ${item}`),
    ...extractLocalPathMentions(message).map(item => `Path: ${item}`),
    ...extractNumericDetails(message).map(item => `Numeric/date detail: ${item}`),
  ], 16)
  const forbiddenShortcuts = buildForbiddenShortcuts(message, taskType, documentQualityMode)

  return {
    originalRequest: message.slice(0, 4000),
    taskType,
    documentQualityMode,
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
    documentQualityMode: mergeDocumentQualityModes(current.documentQualityMode, next.documentQualityMode),
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
    ['Document workflow mode', contract.documentQualityMode ?? 'quick'],
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

function getTaskContractTypeWithDocumentMode(
  taskType: SessionTaskContractType,
  documentQualityMode: SessionDocumentQualityMode | undefined,
): SessionTaskContractType {
  if (!documentQualityMode || documentQualityMode === 'quick') return taskType
  if (taskType === 'code' || taskType === 'automation') return taskType
  return 'document'
}

function getDocumentQualityMode(
  message: string,
  input: BuildGoalCriteriaInput,
  taskType: SessionTaskContractType,
): SessionDocumentQualityMode {
  if (taskType === 'code' || taskType === 'automation' || taskType === 'file') return 'quick'

  const referencedCount = getReferencedNames(input).length
  const documentLike = shouldCreateDocumentPlan(message, taskType)

  if (documentLike && MULTI_AGENT_DEEP_MODE_PATTERN.test(message)) return 'multi_agent_deep'
  if (documentLike && (requiresTemplateFidelityAudit(message, input.storedAttachments) || STRICT_DELIVERY_MODE_PATTERN.test(message))) return 'strict_delivery'
  if (
    documentLike
    && (
      PROFESSIONAL_DOCUMENT_MODE_PATTERN.test(message)
      || COMPREHENSIVE_PATTERN.test(message)
      || PROFESSIONAL_VISUAL_PATTERN.test(message)
      || SOURCE_SENSITIVE_PATTERN.test(message)
      || referencedCount > 0
    )
  ) {
    return 'professional_document'
  }

  return 'quick'
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
  documentQualityMode: SessionDocumentQualityMode,
): string[] {
  const requirements: string[] = []

  if (referencedNames.length > 0) {
    requirements.push(`Use the referenced material where relevant: ${referencedNames.join(', ')}.`)
  } else if (SOURCE_SENSITIVE_PATTERN.test(message)) {
    requirements.push('Ground key facts, figures, clauses, and requirements in user-selected sources, attachments, or explicitly named files/folders; mark unsupported claims as assumptions.')
  }
  if (taskType === 'research') {
    requirements.push('Ground research claims in cited sources or clearly mark unavailable evidence and assumptions.')
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
  if (documentQualityMode === 'professional_document' || documentQualityMode === 'strict_delivery' || documentQualityMode === 'multi_agent_deep') {
    requirements.push('Build an evidence matrix that links key claims, tables, and visuals back to source files or explicit assumptions.')
  }
  if (documentQualityMode === 'strict_delivery') {
    requirements.push('Pass strict delivery gates for sources, template fidelity, exports, visuals, and final formatting before claiming completion.')
  }
  if (documentQualityMode === 'multi_agent_deep') {
    requirements.push('Use chapter-level or discipline-level evidence coverage and resolve cross-chapter inconsistencies before final synthesis.')
  }

  return uniqueBounded(requirements, 8)
}

function buildDocumentPlan(input: {
  message: string
  taskType: SessionTaskContractType
  documentQualityMode: SessionDocumentQualityMode
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
  const visualPlan = buildVisualPlan(input.message)
  const strictTemplate = requiresTemplateFidelityAudit(input.message)
  const enhancements = buildDocumentPlanEnhancements(input.message, tables, charts, visualPlan, strictTemplate, input.documentQualityMode)
  const agentPlan = buildDocumentAgentPlan(input.documentQualityMode, sections, input.message, input.taskType)
  const evidenceMatrix = buildDocumentEvidenceMatrix({
    documentQualityMode: input.documentQualityMode,
    referencedNames: input.referencedNames,
    message: input.message,
    taskType: input.taskType,
  })
  const deliveryReviewPlan = buildDocumentDeliveryReviewPlan({
    documentQualityMode: input.documentQualityMode,
    message: input.message,
    strictTemplate,
    outputFormats: input.outputFormats,
    visualPlan,
    charts,
  })
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
    domain: detectDocumentDomain(input.message),
    visualPlan,
    agentPlan,
    evidenceMatrix,
    deliveryReviewPlan,
    templateProfileId: strictTemplate ? 'pending-template-profile' : undefined,
    strictTemplate: strictTemplate || undefined,
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

function buildDocumentPlanEnhancements(
  message: string,
  tables: string[],
  charts: string[],
  visualPlan: VisualPlan | undefined,
  strictTemplate: boolean,
  documentQualityMode: SessionDocumentQualityMode,
): string[] {
  const enhancements: string[] = []

  if (documentQualityMode !== 'quick') {
    enhancements.push(`Use document workflow mode ${documentQualityMode} to drive the contract, evidence matrix, chapter plan, and quality audit depth.`)
  }
  if (visualPlan && visualPlan.selectedKinds.length > 0) {
    enhancements.push('Render required professional visuals from verified data and include captions, source notes, and audit reasons.')
  }
  if (strictTemplate) {
    enhancements.push('Use a parsed template profile for strict layout checks; Markdown remains the semantic draft and DOCX/PDF require export evidence.')
  }
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

function buildDocumentEvidenceMatrix(input: {
  documentQualityMode: SessionDocumentQualityMode
  referencedNames: string[]
  message: string
  taskType: SessionTaskContractType
}): SessionDocumentEvidenceMatrixEntry[] | undefined {
  if (input.documentQualityMode === 'quick') return undefined

  const sources = uniqueBounded(input.referencedNames, 6)
  if (sources.length > 0) {
    return sources.map((source, index) => ({
      id: `evidence-source-${index + 1}`,
      source,
      sourceType: 'file',
      supports: 'Source-backed claims, required sections, tables, visuals, and unresolved evidence gaps.',
      reliabilityNote: 'User-provided file; cite page, clause, table, figure, sheet, or extracted text before using claims as verified.',
      citationFields: ['source', 'locator', 'claim', 'excerpt_or_value', 'reliability_note'],
      reuseStatus: 'candidate',
    }))
  }

  if (SOURCE_SENSITIVE_PATTERN.test(input.message) || input.taskType === 'research') {
    return [{
      id: 'evidence-source-1',
      source: 'Pending source evidence',
      sourceType: 'assumption',
      supports: 'Claims that still need uploaded files, external search results, or explicit user evidence.',
      reliabilityNote: 'Do not treat as verified until a source is selected, attached, searched externally by request, or explicitly provided. Do not mine the working directory as the default evidence corpus.',
      citationFields: ['source', 'locator', 'claim', 'excerpt_or_value', 'reliability_note'],
      reuseStatus: 'pending',
    }]
  }

  return undefined
}

function buildDocumentDeliveryReviewPlan(input: {
  documentQualityMode: SessionDocumentQualityMode
  message: string
  strictTemplate: boolean
  outputFormats: string[]
  visualPlan: VisualPlan | undefined
  charts: string[]
}): SessionDocumentDeliveryReviewPlan | undefined {
  if (input.documentQualityMode !== 'strict_delivery') return undefined

  const gates: SessionDocumentDeliveryGate[] = [{
    id: 'source_integrity',
    requirement: 'Source-backed claims, tables, and visuals must cite evidence or mark unavailable evidence as pending.',
    evidence: 'Evidence matrix entries with locators, excerpts, values, or unresolved-gap notes.',
  }]

  if (input.strictTemplate) {
    gates.push({
      id: 'template_fidelity',
      requirement: 'Uploaded or referenced template layout, styles, headings, and pagination constraints must be verified.',
      evidence: 'Parsed template profile and exported DOCX/PDF structure evidence.',
    })
  }

  if (input.outputFormats.length > 0) {
    gates.push({
      id: 'export_files',
      requirement: 'Every requested delivery format must be produced as a verifiable output file.',
      evidence: `Verified output files for ${input.outputFormats.join(', ')}.`,
    })
  }

  if ((input.visualPlan?.selectedKinds ?? []).length > 0 || input.charts.length > 0 || VISUAL_ENHANCEMENT_PATTERN.test(input.message)) {
    gates.push({
      id: 'visual_evidence',
      requirement: 'Charts, figures, diagrams, and visual blocks must be backed by source data or explicit user input.',
      evidence: 'Chart specs, source tables, captions, and source notes for each visual.',
    })
  }

  gates.push({
    id: 'format_review',
    requirement: 'Final artifact structure, headings, tables, captions, and visible formatting must be reviewed before completion.',
    evidence: 'Rendered preview, exported file inspection, or documented manual review findings.',
  })

  return {
    mode: 'strict_delivery',
    failureAction: 'needs_review_or_auto_improve',
    gates,
  }
}

function buildDocumentAgentPlan(
  documentQualityMode: SessionDocumentQualityMode,
  sections: string[],
  message: string,
  taskType: SessionTaskContractType,
): SessionDocumentAgentPlan | undefined {
  const baseTitles = sections.filter(section => !/table of contents|appendix|目录|附录/i.test(section) && !isFinalSynthesisInstruction(section))
  const candidateTitles = uniqueBounded(baseTitles.length > 0 ? baseTitles : buildDocumentPlanSections(message, [], taskType), 8)
  const requiresDeepAgents = documentQualityMode === 'multi_agent_deep'
  const shouldCreatePlan = requiresDeepAgents || shouldCreateComplexDocumentAgentPlan(
    documentQualityMode,
    candidateTitles,
    message,
    taskType,
  )

  if (!shouldCreatePlan) return undefined

  const titles = uniqueBounded(candidateTitles, requiresDeepAgents ? 8 : 4)

  return {
    mode: 'chapter_agents',
    finalSynthesisOwner: 'final_synthesis_owner',
    assignments: titles.map((title, index) => ({
      id: `chapter-agent-${index + 1}`,
      title,
      role: getChapterAgentRole(title),
      reviewFocus: getChapterAgentReviewFocus(title),
    })),
    reviewStages: [
      'Chapter evidence review before synthesis.',
      'Cross-chapter consistency review before final synthesis.',
      'Final deliverable review by the final synthesis owner.',
    ],
    guardrails: [
      'Each chapter agent must list source gaps and unresolved assumptions before handoff.',
      'Only the final synthesis owner may write or replace the final deliverable after chapter drafts are reviewed.',
      'Do not merge conflicting chapter claims without a recorded resolution.',
    ],
  }
}

function shouldCreateComplexDocumentAgentPlan(
  documentQualityMode: SessionDocumentQualityMode,
  titles: string[],
  message: string,
  taskType: SessionTaskContractType,
): boolean {
  if (documentQualityMode === 'quick') return false
  if (documentQualityMode === 'multi_agent_deep') return true

  const titleCount = titles.filter(title => !isFinalSynthesisInstruction(title)).length
  const complexText = COMPLEX_AGENT_ORCHESTRATION_PATTERN.test(message)
    || (COMPREHENSIVE_PATTERN.test(message) && SOURCE_SENSITIVE_PATTERN.test(message))
    || (PROFESSIONAL_VISUAL_PATTERN.test(message) && SOURCE_SENSITIVE_PATTERN.test(message))
  const strictOrTemplate = documentQualityMode === 'strict_delivery'
    || STRICT_TEMPLATE_PATTERN.test(message)
    || STRICT_DELIVERY_MODE_PATTERN.test(message)

  if (titleCount >= 4) return true
  if (strictOrTemplate && titleCount >= 2) return true
  if ((taskType === 'document' || taskType === 'research') && titleCount >= 3 && complexText) return true
  return false
}

function isFinalSynthesisInstruction(value: string): boolean {
  return /最终.{0,16}合成|总编|统一合成|final synthesis|synthesis owner/i.test(value)
}

function getChapterAgentRole(title: string): string {
  if (/进度|计划|甘特|wbs|schedule|programme|program|gantt/i.test(title)) return 'schedule_chapter_agent'
  if (/成本|报价|投资|商务|风险|boq|cost|price|investment|commercial|risk/i.test(title)) return 'commercial_risk_agent'
  if (/技术|设计|施工|方案|工程|technical|design|method|construction/i.test(title)) return 'technical_chapter_agent'
  if (/证据|来源|引用|概况|背景|source|evidence|citation|overview|background/i.test(title)) return 'source_evidence_agent'
  return 'document_chapter_agent'
}

function getChapterAgentReviewFocus(title: string): string {
  if (/进度|计划|甘特|wbs|schedule|programme|program|gantt/i.test(title)) return 'schedule logic, milestones, dependencies, and critical-path consistency'
  if (/成本|报价|投资|商务|风险|boq|cost|price|investment|commercial|risk/i.test(title)) return 'commercial assumptions, cost evidence, risks, and unresolved sensitivities'
  if (/技术|设计|施工|方案|工程|technical|design|method|construction/i.test(title)) return 'technical completeness, method feasibility, and source-backed constraints'
  if (/证据|来源|引用|概况|背景|source|evidence|citation|overview|background/i.test(title)) return 'source coverage, scope boundaries, and citation completeness'
  return 'chapter completeness, evidence grounding, and handoff notes'
}

function mergeDocumentPlans(current: SessionDocumentPlan | undefined, next: SessionDocumentPlan | undefined): SessionDocumentPlan | undefined {
  if (!current) return next
  if (!next) return current

  return {
    title: current.title ?? next.title,
    audience: current.audience ?? next.audience,
    tone: current.tone ?? next.tone,
    length: current.length ?? next.length,
    domain: current.domain ?? next.domain,
    visualPlan: mergeVisualPlans(current.visualPlan, next.visualPlan),
    agentPlan: mergeDocumentAgentPlans(current.agentPlan, next.agentPlan),
    evidenceMatrix: mergeDocumentEvidenceMatrix(current.evidenceMatrix, next.evidenceMatrix),
    deliveryReviewPlan: mergeDocumentDeliveryReviewPlans(current.deliveryReviewPlan, next.deliveryReviewPlan),
    templateProfileId: current.templateProfileId ?? next.templateProfileId,
    strictTemplate: current.strictTemplate || next.strictTemplate || undefined,
    sections: uniqueBounded([...current.sections, ...next.sections], 24),
    tables: uniqueBounded([...current.tables, ...next.tables], 12),
    charts: uniqueBounded([...current.charts, ...next.charts], 12),
    enhancements: uniqueBounded([...(current.enhancements ?? []), ...(next.enhancements ?? [])], 12),
    citations: uniqueBounded([...current.citations, ...next.citations], 12),
    deliveryFormats: uniqueBounded([...current.deliveryFormats, ...next.deliveryFormats], 8),
  }
}

function mergeDocumentDeliveryReviewPlans(
  current: SessionDocumentDeliveryReviewPlan | undefined,
  next: SessionDocumentDeliveryReviewPlan | undefined,
): SessionDocumentDeliveryReviewPlan | undefined {
  if (!current) return next
  if (!next) return current

  return {
    mode: 'strict_delivery',
    failureAction: 'needs_review_or_auto_improve',
    gates: uniqueDeliveryGates([...current.gates, ...next.gates], 8),
  }
}

function uniqueDeliveryGates(gates: SessionDocumentDeliveryGate[], maxItems: number): SessionDocumentDeliveryGate[] {
  const seen = new Set<string>()
  const output: SessionDocumentDeliveryGate[] = []
  for (const gate of gates) {
    if (seen.has(gate.id)) continue
    seen.add(gate.id)
    output.push(gate)
    if (output.length >= maxItems) break
  }
  return output
}

function mergeDocumentEvidenceMatrix(
  current: SessionDocumentEvidenceMatrixEntry[] | undefined,
  next: SessionDocumentEvidenceMatrixEntry[] | undefined,
): SessionDocumentEvidenceMatrixEntry[] | undefined {
  if (!current || current.length === 0) return next
  if (!next || next.length === 0) return current

  const seen = new Set<string>()
  const entries: SessionDocumentEvidenceMatrixEntry[] = []
  for (const entry of [...current, ...next]) {
    const sourceKey = entry.source.trim().toLowerCase()
    if (!sourceKey) continue
    const key = `${entry.sourceType}\u0000${sourceKey}`
    if (seen.has(key)) continue
    seen.add(key)
    entries.push(entry)
    if (entries.length >= 12) break
  }
  return entries
}

function mergeDocumentAgentPlans(
  current: SessionDocumentAgentPlan | undefined,
  next: SessionDocumentAgentPlan | undefined,
): SessionDocumentAgentPlan | undefined {
  if (!current) return next
  if (!next) return current

  return {
    mode: 'chapter_agents',
    finalSynthesisOwner: current.finalSynthesisOwner || next.finalSynthesisOwner,
    assignments: uniqueAssignmentList([...current.assignments, ...next.assignments], 12),
    reviewStages: uniqueBounded([...current.reviewStages, ...next.reviewStages], 8),
    guardrails: uniqueBounded([...current.guardrails, ...next.guardrails], 8),
  }
}

function uniqueAssignmentList(
  assignments: SessionDocumentAgentPlan['assignments'],
  maxItems: number,
): SessionDocumentAgentPlan['assignments'] {
  const seen = new Set<string>()
  const output: SessionDocumentAgentPlan['assignments'] = []
  for (const assignment of assignments) {
    const key = assignment.title.trim().toLowerCase()
    if (!key || seen.has(key)) continue
    seen.add(key)
    output.push(assignment)
    if (output.length >= maxItems) break
  }
  return output
}

function formatDocumentPlan(plan: SessionDocumentPlan | undefined): string {
  if (!plan) return '(none)'
  return [
    `Title: ${plan.title ?? '(unspecified)'}`,
    `Audience: ${plan.audience ?? '(unspecified)'}`,
    `Tone: ${plan.tone ?? '(unspecified)'}`,
    `Length: ${plan.length ?? '(unspecified)'}`,
    `Domain: ${plan.domain ?? '(unspecified)'}`,
    `Strict template: ${plan.strictTemplate ? 'yes' : 'no'}`,
    `Template profile: ${plan.templateProfileId ?? '(none)'}`,
    `Visual plan:\n${formatVisualPlan(plan.visualPlan)}`,
    `Document agent plan:\n${formatDocumentAgentPlan(plan.agentPlan)}`,
    `Evidence matrix:\n${formatDocumentEvidenceMatrix(plan.evidenceMatrix)}`,
    `Delivery review plan:\n${formatDocumentDeliveryReviewPlan(plan.deliveryReviewPlan)}`,
    `Sections:\n${formatContractList(plan.sections)}`,
    `Tables:\n${formatContractList(plan.tables)}`,
    `Charts:\n${formatContractList(plan.charts)}`,
    `Enhancements:\n${formatContractList(plan.enhancements ?? [])}`,
    `Citations:\n${formatContractList(plan.citations)}`,
    `Delivery formats:\n${formatContractList(plan.deliveryFormats)}`,
  ].join('\n')
}

function formatDocumentDeliveryReviewPlan(plan: SessionDocumentDeliveryReviewPlan | undefined): string {
  if (!plan) return '(none)'
  return [
    `Mode: ${plan.mode}`,
    `Failure action: ${plan.failureAction}`,
    `Gates:\n${formatContractList(plan.gates.map(gate => `${gate.id} requires ${gate.requirement} Evidence: ${gate.evidence}`))}`,
  ].join('\n')
}

function formatDocumentEvidenceMatrix(entries: SessionDocumentEvidenceMatrixEntry[] | undefined): string {
  if (!entries || entries.length === 0) return '(none)'
  return formatContractList(entries.map(entry =>
    `${entry.source} [${entry.sourceType}] supports ${entry.supports} Reliability: ${entry.reliabilityNote} Citation fields: ${entry.citationFields.join(', ')} Reuse: ${entry.reuseStatus}`
  ))
}

function formatDocumentAgentPlan(plan: SessionDocumentAgentPlan | undefined): string {
  if (!plan) return '(none)'
  return [
    `Mode: ${plan.mode}`,
    `Final synthesis owner: ${plan.finalSynthesisOwner}`,
    `Assignments:\n${formatContractList(plan.assignments.map(assignment => `${assignment.title} - ${assignment.role} - ${assignment.reviewFocus}`))}`,
    `Review stages:\n${formatContractList(plan.reviewStages)}`,
    `Guardrails:\n${formatContractList(plan.guardrails)}`,
  ].join('\n')
}

function extractFirstMatch(message: string, pattern: RegExp): string | undefined {
  const value = message.match(pattern)?.[1]?.trim()
  return value || undefined
}

function buildForbiddenShortcuts(
  message: string,
  taskType: SessionTaskContractType,
  documentQualityMode: SessionDocumentQualityMode,
): string[] {
  const shortcuts: string[] = [
    'Do not silently simplify, summarize away, or omit explicit user requirements.',
    'Do not claim completion without evidence for requested files, checks, or source-backed facts.',
  ]

  if (COMPREHENSIVE_PATTERN.test(message) || DOCUMENT_WORK_PATTERN.test(message)) {
    shortcuts.push('Do not replace the requested document-quality work product with a high-level outline, template, or brief note.')
  }
  if (SOURCE_SENSITIVE_PATTERN.test(message) || taskType === 'research') {
    shortcuts.push('Do not invent facts, figures, clauses, page numbers, file names, dates, prices, or technical parameters.')
    shortcuts.push('Do not inventory or mine the working directory as a source corpus unless the user explicitly names that folder/path for analysis.')
  }
  if (VISUAL_ENHANCEMENT_PATTERN.test(message) || EMBEDDED_HTML_PATTERN.test(message)) {
    shortcuts.push('Do not create charts, HTML visual blocks, diagrams, or visual summaries from invented data; use verified data or mark the visualization basis as unavailable.')
  }
  if (requiresTemplateFidelityAudit(message)) {
    shortcuts.push('Do not claim template fidelity from prompt wording alone; strict template mode requires a parsed template profile and export evidence.')
  }
  if (documentQualityMode === 'multi_agent_deep') {
    shortcuts.push('Do not let multiple agents write the same final artifact concurrently; use one final synthesis owner.')
  }
  if (taskType === 'code') {
    shortcuts.push('Do not refactor unrelated code or skip verification when the user asked for an implementation fix.')
  }

  return uniqueBounded(shortcuts, 8)
}

function mergeDocumentQualityModes(
  current: SessionDocumentQualityMode | undefined,
  next: SessionDocumentQualityMode | undefined,
): SessionDocumentQualityMode | undefined {
  if (!current) return next
  if (!next) return current

  const rank: Record<SessionDocumentQualityMode, number> = {
    quick: 0,
    professional_document: 1,
    strict_delivery: 2,
    multi_agent_deep: 3,
  }
  return rank[next] > rank[current] ? next : current
}

function requiresVisualBlockAudit(message: string): boolean {
  return PROFESSIONAL_VISUAL_PATTERN.test(message) || suggestVisuals({ text: message, mode: 'professional' }).some(suggestion => suggestion.score >= 0.7)
}

function requiresTemplateFidelityAudit(message: string, storedAttachments: StoredAttachment[] | undefined = undefined): boolean {
  const hasTemplateAttachment = (storedAttachments ?? []).some(attachment =>
    /\.(?:docx?|pdf|md|markdown)$/i.test(attachment.name)
    && /template|模板|reference|参照|参考/i.test(attachment.name)
  )
  return STRICT_TEMPLATE_PATTERN.test(message) || hasTemplateAttachment
}

function buildVisualPlan(message: string): VisualPlan | undefined {
  if (!requiresVisualBlockAudit(message)) return undefined

  const suggestions = suggestVisuals({ text: message, mode: 'professional' })
  const opportunities = suggestions.map<VisualOpportunity>((suggestion, index) => ({
    id: `request-visual-${index + 1}`,
    domain: suggestion.domain,
    recommendedKind: suggestion.kind,
    score: suggestion.score,
    reason: suggestion.reason,
    requiredData: suggestion.requiredData,
    missingData: suggestion.missingData,
  }))
  const selectedKinds = opportunities.length > 0
    ? opportunities.map(opportunity => opportunity.recommendedKind)
    : fallbackVisualKinds(message)

  const auditRequirements = [
    'Every professional visual must have verified data, a caption, a source note, and an audit reason.',
    'If required data is unavailable, the output must state the missing data instead of drawing an unsupported visual.',
  ]
  if (selectedKinds.includes('construction-gantt') && /A3\s*横向|A3\s*landscape/i.test(message)) {
    auditRequirements.push('Construction Gantt visuals requested as A3 landscape must preserve A3 landscape page intent in the rendered asset or caption metadata.')
  }

  return {
    mode: 'professional',
    opportunities,
    selectedKinds: uniqueBounded(selectedKinds, 8) as VisualPlan['selectedKinds'],
    auditRequirements,
  }
}

function fallbackVisualKinds(message: string): VisualPlan['selectedKinds'] {
  if (/施工|进度|甘特|wbs|baseline|gantt|critical path|里程碑/i.test(message)) return ['construction-gantt']
  if (/投资|现金流|npv|irr|敏感性|cash\s*flow|sensitivity/i.test(message)) return ['investment-cash-flow-table']
  if (/gis|地理|地图|坐标|路线|桩号|geospatial|coordinate|chainage/i.test(message)) return ['site-location-map']
  if (/ansys|cae|fea|仿真|应力|位移|收敛|simulation|stress|displacement|convergence/i.test(message)) return ['simulation-result-table']
  return ['professional-table']
}

function mergeVisualPlans(current: VisualPlan | undefined, next: VisualPlan | undefined): VisualPlan | undefined {
  if (!current) return next
  if (!next) return current

  return {
    mode: current.mode === 'professional' || next.mode === 'professional' ? 'professional' : 'standard',
    opportunities: [...current.opportunities, ...next.opportunities].slice(0, 16),
    selectedKinds: uniqueBounded([...current.selectedKinds, ...next.selectedKinds], 12) as VisualPlan['selectedKinds'],
    auditRequirements: uniqueBounded([...current.auditRequirements, ...next.auditRequirements], 12),
  }
}

function formatVisualPlan(plan: VisualPlan | undefined): string {
  if (!plan) return '(none)'
  return [
    `Mode: ${plan.mode}`,
    `Selected kinds: ${plan.selectedKinds.join(', ') || '(none)'}`,
    `Audit requirements:\n${formatContractList(plan.auditRequirements)}`,
  ].join('\n')
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
  const explicitQuickMode = input.documentQualityMode === 'quick'
  const maxIterations = MAX_AUTOMATIC_GOAL_REPAIR_PASSES
  let maxWallClockMs = 15 * 60 * 1000

  if (!explicitQuickMode && (input.storedAttachments?.length ?? 0) > 0 && (DOCUMENT_WORK_PATTERN.test(message) || SOURCE_SENSITIVE_PATTERN.test(message))) {
    maxWallClockMs = 30 * 60 * 1000
  }

  if (!explicitQuickMode && COMPREHENSIVE_PATTERN.test(message)) {
    maxWallClockMs = 30 * 60 * 1000
  }

  if (input.documentQualityMode === 'professional_document') {
    maxWallClockMs = Math.max(maxWallClockMs, 30 * 60 * 1000)
  }

  if (input.documentQualityMode === 'strict_delivery' || input.documentQualityMode === 'multi_agent_deep') {
    maxWallClockMs = Math.max(maxWallClockMs, 45 * 60 * 1000)
  }

  if (UNTIL_DONE_PATTERN.test(message)) {
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
