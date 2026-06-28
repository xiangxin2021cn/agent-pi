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

const DOCUMENT_WORK_PATTERN = /报告|方案|文档|总结|分析|审查|计划|手册|说明|report|proposal|document|summary|analysis|review|plan|manual/i
const VERIFICATION_PATTERN = /验证|测试|检查|核对|复核|校验|verify|test|check|validate/i
const COMPREHENSIVE_PATTERN = /全面|详细|认真|深入|系统|高质量|复核|审稿|comprehensive|detailed|thorough|deep|high[- ]quality|review/i
const UNTIL_DONE_PATTERN = /直到|直至|不达标不|满足要求再|反复|多轮|continue until|until .*done|until .*complete|until .*satisf/i
const SOURCE_SENSITIVE_PATTERN = /招标|投标|合同|规范|条款|清单|工程量|图纸|报价|标书|附件|源文件|依据|boq|pdf|excel|xlsx?|csv|tender|contract|specification|clause|source|citation|cite|spreadsheet|workbook/i
const OUTPUT_FILE_REQUEST_PATTERN = /(?:生成|输出|导出|保存|写入|创建|另存|转换|generate|create|write|save|export|convert).{0,80}(?:文件|file|pdf|word|excel|markdown|md|docx?|xlsx?|pptx?|csv|html?|json|txt|\.pdf|\.md|\.docx?|\.xlsx?|\.pptx?|\.csv|\.html?|\.json|\.txt)/i
const TOOL_VERIFICATION_REQUEST_PATTERN = /(?:运行|执行|跑|\b(?:run|execute)\b).{0,60}(?:测试|单测|验证|检查|构建|类型检查|\b(?:test|tests|verify|validate|check|typecheck|lint|build|tsc|pytest|vitest|jest|playwright|eslint)\b)|(?:测试|单测|验证|检查|构建|类型检查|\b(?:test|tests|verify|validate|check|typecheck|lint|build)\b).{0,40}(?:通过|成功|\b(?:pass|green|clean)\b)/i

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

  if (VERIFICATION_PATTERN.test(message)) {
    criteria.push({
      text: 'Run or describe appropriate validation steps, and report the verification result clearly.',
      kind: 'test',
      required: true,
    })
  }

  if (TOOL_VERIFICATION_REQUEST_PATTERN.test(message)) {
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

function dedupeCriteria(criteria: SessionGoalCriterionSpec[]): SessionGoalCriterionSpec[] {
  const seen = new Set<string>()
  return criteria.filter(criterion => {
    const key = `${criterion.kind}\u0000${criterion.text}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
