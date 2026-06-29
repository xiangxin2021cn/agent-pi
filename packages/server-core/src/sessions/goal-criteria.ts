import type { ContentBadge, StoredAttachment } from '@craft-agent/core/types'
import type { SessionGoalCriterion, SessionGoalMode } from '@craft-agent/shared/sessions'

export type SessionGoalCriterionSpec = Omit<SessionGoalCriterion, 'id'>

export interface BuildGoalCriteriaInput {
  message: string
  storedAttachments?: StoredAttachment[]
  badges?: ContentBadge[]
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
