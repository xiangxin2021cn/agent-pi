import type { SessionDocumentPlan, SessionGoalState } from '@craft-agent/shared/sessions'

type Translate = (key: string, values?: Record<string, unknown>) => string

export interface DocumentEnhancementViewModel {
  title: string
  summary: string
  chips: string[]
  tooltip: string
  source: 'draft' | 'contract'
}

const DOCUMENT_TASK_PATTERN = /报告|方案|文档|总结|分析|审查|计划|手册|说明|简报|PPT|幻灯片|word|docx|pptx|pdf|report|proposal|document|summary|analysis|review|plan|manual|brief|slides?/i
const TABLE_PATTERN = /表格|清单|矩阵|对比表|统计表|table|matrix|schedule|boq|excel|xlsx|csv/i
const CHART_PATTERN = /图表|图形|可视化|柱状|折线|饼图|占比|趋势|分布|流程图|架构图|关系图|chart|graph|plot|visual|bar|line|pie|trend|distribution|flowchart|diagram/i
const CITATION_PATTERN = /引用|出处|来源|依据|页码|证据|citation|cite|source|evidence|page/i
const NO_FABRICATION_PATTERN = /不能编造|不要编造|禁止编造|不得编造|真实|准确|高保真|依据|verified|no fabrication|do not invent|source-backed/i
const FORMAT_PATTERN = /pdf|word|docx|excel|xlsx|pptx|ppt|markdown|md|html|json|csv|txt/i

export function getDocumentEnhancementViewModel(
  t: Translate,
  options: {
    input?: string
    goalState?: SessionGoalState
  },
): DocumentEnhancementViewModel | undefined {
  const contract = options.goalState?.taskContract
  const plan = contract?.documentPlan
  if (plan) {
    return buildContractViewModel(t, plan, contract.forbiddenShortcuts)
  }

  const input = options.input?.trim() ?? ''
  if (!input || !shouldShowDraftHint(input)) {
    return undefined
  }

  return buildDraftViewModel(t, input)
}

export function getDocumentPlanStatusText(
  t: Translate,
  goalState?: SessionGoalState,
): string | undefined {
  const contract = goalState?.taskContract
  const plan = contract?.documentPlan
  if (!plan) return undefined

  const chips = getPlanChips(t, plan, contract.forbiddenShortcuts)
  if (chips.length === 0) {
    return t('sessionInfo.documentPlanEnabled', { defaultValue: 'Task contract enabled' })
  }

  return t('sessionInfo.documentPlanStatus', {
    items: chips.join(' / '),
    defaultValue: `${chips.join(' / ')} enabled`,
  })
}

function shouldShowDraftHint(input: string): boolean {
  return DOCUMENT_TASK_PATTERN.test(input)
    || TABLE_PATTERN.test(input)
    || CHART_PATTERN.test(input)
    || CITATION_PATTERN.test(input)
    || NO_FABRICATION_PATTERN.test(input)
    || FORMAT_PATTERN.test(input)
}

function buildContractViewModel(
  t: Translate,
  plan: SessionDocumentPlan,
  forbiddenShortcuts: readonly string[] | undefined,
): DocumentEnhancementViewModel {
  const chips = getPlanChips(t, plan, forbiddenShortcuts)
  return {
    title: t('sessionInfo.documentEnhancement', { defaultValue: '文档增强' }),
    summary: t('sessionInfo.documentEnhancementContractSummary', {
      defaultValue: '任务契约已启用，文档任务将按章节、表格、图表、引用和交付格式审查。',
    }),
    chips,
    tooltip: t('sessionInfo.documentEnhancementContractTooltip', {
      defaultValue: 'Document Plan 已进入当前会话的任务契约，Goal Loop 会按这些约束审查后续输出。',
    }),
    source: 'contract',
  }
}

function buildDraftViewModel(t: Translate, input: string): DocumentEnhancementViewModel {
  const chips = [
    t('sessionInfo.documentEnhancementTaskContract', { defaultValue: '任务契约' }),
    t('sessionInfo.documentPlanSections', { defaultValue: '章节' }),
  ]

  if (TABLE_PATTERN.test(input)) chips.push(t('sessionInfo.documentPlanTables', { defaultValue: '表格' }))
  if (CHART_PATTERN.test(input)) chips.push(t('sessionInfo.documentPlanCharts', { defaultValue: '图表' }))
  if (CITATION_PATTERN.test(input)) chips.push(t('sessionInfo.documentPlanCitations', { defaultValue: '引用' }))
  if (FORMAT_PATTERN.test(input)) chips.push(t('sessionInfo.documentPlanFormats', { defaultValue: '交付格式' }))
  if (NO_FABRICATION_PATTERN.test(input) || CHART_PATTERN.test(input)) {
    chips.push(t('sessionInfo.documentPlanNoFabrication', { defaultValue: '禁止编造' }))
  }

  return {
    title: t('sessionInfo.documentEnhancement', { defaultValue: '文档增强' }),
    summary: t('sessionInfo.documentEnhancementDraftSummary', {
      defaultValue: '已启用文档增强审查：将检查章节完整性、图表依据、引用和交付格式。',
    }),
    chips: unique(chips).slice(0, 6),
    tooltip: t('sessionInfo.documentEnhancementDraftTooltip', {
      defaultValue: '发送后会生成任务契约和 Document Plan，并要求图表、HTML 内嵌块、引用和交付格式不能脱离真实依据。',
    }),
    source: 'draft',
  }
}

function getPlanChips(
  t: Translate,
  plan: SessionDocumentPlan,
  forbiddenShortcuts: readonly string[] | undefined,
): string[] {
  const chips: string[] = []
  if ((plan.sections ?? []).length > 0) chips.push(t('sessionInfo.documentPlanSections', { defaultValue: '章节' }))
  if ((plan.tables ?? []).length > 0) chips.push(t('sessionInfo.documentPlanTables', { defaultValue: '表格' }))
  if ((plan.charts ?? []).length > 0) chips.push(t('sessionInfo.documentPlanCharts', { defaultValue: '图表' }))
  if ((plan.citations ?? []).length > 0) chips.push(t('sessionInfo.documentPlanCitations', { defaultValue: '引用' }))
  if ((plan.deliveryFormats ?? []).length > 0) chips.push(t('sessionInfo.documentPlanFormats', { defaultValue: '交付格式' }))
  if (hasNoFabricationRule(plan, forbiddenShortcuts)) {
    chips.push(t('sessionInfo.documentPlanNoFabrication', { defaultValue: '禁止编造' }))
  }
  if ((plan.enhancements ?? []).some(item => /html|embedded|内嵌|嵌入/i.test(item))) {
    chips.push(t('sessionInfo.documentPlanHtml', { defaultValue: 'HTML增强' }))
  }
  return unique(chips).slice(0, 7)
}

function hasNoFabricationRule(
  plan: SessionDocumentPlan,
  forbiddenShortcuts: readonly string[] | undefined,
): boolean {
  return (plan.enhancements ?? []).some(item => /verified|source data|明确输入|依据|不可支撑/i.test(item))
    || (forbiddenShortcuts ?? []).some(item => /invent|编造|verified data|source/i.test(item))
}

function unique(items: string[]): string[] {
  return [...new Set(items.map(item => item.trim()).filter(Boolean))]
}
