import { TENDER_FORMAL_WRITING_SKILL_SLUG, type BusinessModuleId } from '@craft-agent/shared/business-projects'
import { i18n } from '@craft-agent/shared/i18n'

export interface BusinessWorkflowStage {
  id: string
  /** Stable i18n key for workbench chrome. Agent drafts still use `label` / `prompt`. */
  labelKey: string
  hintKey: string
  /** Chinese agent-facing label kept for spawn drafts (not shown in the workbench UI). */
  label: string
  prompt: string
  skillSlug?: string
  skillSlugs?: string[]
  requiredCapabilities?: BusinessCapabilityId[]
  producesCapabilities?: BusinessCapabilityId[]
  dispatchPolicy?: 'controlled-subagents'
}

export interface BusinessWorkflowDefinition {
  id: string
  labelKey: string
  label: string
  stages: BusinessWorkflowStage[]
}

export type BusinessCapabilityId =
  | 'document_analysis'
  | 'evaluation_strategy'
  | 'boq_reconciliation'
  | 'project_boundary'
  | 'boq_five_step_pricing'
  | 'construction_resource_schedule'
  | 'bidder_commitments'
  | 'execution_plan'
  | 'schedule_resources'
  | 'cost_cashflow'
  | 'submission_documents'
  | 'submission_audit'

const WORKFLOWS: Record<BusinessModuleId, BusinessWorkflowDefinition> = {
  tender: {
    id: 'tender-main',
    labelKey: 'businessProjects.workflowTender',
    label: '投标全流程',
    stages: [
      {
        id: 'project-setup',
        labelKey: 'businessProjects.stageTenderProjectSetup',
        hintKey: 'businessProjects.hintTenderProjectSetup',
        label: '项目资料登记',
        prompt: '上传并登记招标资料即可。资料齐套后由用户确认进入解析；本步不派生子智能体，不进行组价或策划。登记说明沿用招标文件原名与原术语，禁止 AI 导读腔。',
      },
      {
        id: 'tender-document-analysis',
        labelKey: 'businessProjects.stageTenderDocumentAnalysis',
        hintKey: 'businessProjects.hintTenderDocumentAnalysis',
        label: '招标文件解析',
        prompt: '对每个已登记文件产出可读 Markdown 解析稿（一等成果），归纳关键约束与交叉引用；完成后合成 document_analysis 与 boq_reconciliation，并汇总编制「项目特征」专章/专文（合同制式与专用条款、规范及条文修订、工期地点地质气候、工作时间与节假日、分包与属地化、施工顺序等招标限定）。缺规范/合同/地质原文的条目必须标为缺口，禁止用模型记忆填空。evaluation_strategy 可选，不阻塞本阶段。默认最多 4 并发；子会话同时交付 JSON+MD，不得由主会话代写 MD；不得提前进入组价或策划。解析稿按本标书专业化写作并去 AI 味：用雇主术语与条款写组价/施工/合规含义，禁止套话与文件目录腔。',
        skillSlug: 'tender-document-parsing',
        skillSlugs: ['tender-document-parsing', TENDER_FORMAL_WRITING_SKILL_SLUG],
        producesCapabilities: ['document_analysis', 'boq_reconciliation'],
        dispatchPolicy: 'controlled-subagents',
      },
      {
        id: 'boq-five-step-pricing',
        labelKey: 'businessProjects.stageTenderBoqPricing',
        hintKey: 'businessProjects.hintTenderBoqPricing',
        label: 'BOQ 逐页组价与资源汇总',
        prompt: '以解析阶段汇总的「项目特征」为组价依据（合同制式/专用条款、规范及条文修订、工期地点地质气候、工时节假日、分包属地化、施工顺序限定等）：以清单分册/章节为单位逐项组价；原样锁定清单编码/描述/单位/工程量；引用规范与计量支付条款；给出施工顺序、劳机班组、瓶颈公式及乐观/基准/悲观生产率；逐项计算每 BOQ 单位的人材机、分包、运输和损耗消耗；费率必须注明日期、地点、来源类型、取得方式，关键费率必须联网询价核证并留 webEvidence。项目特征缺口不得臆造：请用户补传规范/合同/地质/知识库并重新解析，或对本阶段「强制放行」后才允许网络尽调（须留 url）。不得编造与项目特征或已登记招标资料相矛盾的设备、工法或料源。默认串行按页；汇总行与人造组合项不属于定价对象。结束后汇总施工资源消耗总表，并由用户确认投入条件。组价工作底稿用本标清单/规范/计量支付用语书写并去 AI 味，禁止空泛施工教科书段落。',
        skillSlugs: ['tender-boq-five-step-pricing', 'tender-bidder-commitments', TENDER_FORMAL_WRITING_SKILL_SLUG],
        requiredCapabilities: ['document_analysis'],
        producesCapabilities: ['boq_five_step_pricing', 'construction_resource_schedule', 'bidder_commitments'],
        dispatchPolicy: 'controlled-subagents',
      },
      {
        id: 'planning-and-submission',
        labelKey: 'businessProjects.stageTenderPlanning',
        hintKey: 'businessProjects.hintTenderPlanning',
        label: '施工策划、进度、成本与出稿',
        prompt: '按可见子步骤推进：施工策划 → 进度/资源/现金流（同时产出 MS Project 与 P6 XML、人机直方图、S 曲线）→ Work Plan DOCX 与一致性核对。必须充分阅读解析 MD、项目特征与组价成果；结合工期、项目特征与工效/资源；项目特征缺口不得臆造，须请用户补传证据或强制放行后网络尽调。不得跳过子步骤门禁。策划、进度说明与正式出稿按招标回标格式与本标术语撰写并去 AI 味，禁止通用方案模板腔。',
        skillSlugs: [
          'tender-execution-planning',
          'tender-schedule-resource-planning',
          'construction-schedule-planner',
          'tender-cost-cashflow-planning',
          'tender-submission-documents',
          'tender-submission-audit',
          TENDER_FORMAL_WRITING_SKILL_SLUG,
        ],
        requiredCapabilities: ['boq_five_step_pricing'],
        producesCapabilities: [
          'execution_plan',
          'schedule_resources',
          'cost_cashflow',
          'submission_documents',
          'submission_audit',
        ],
      },
    ],
  },
  delivery: {
    id: 'delivery-main',
    labelKey: 'businessProjects.workflowDelivery',
    label: '项目实施控制',
    stages: [
      { id: 'project-setup', labelKey: 'businessProjects.stageDeliveryProjectSetup', hintKey: 'businessProjects.hintDeliveryProjectSetup', label: '项目与基准确认', prompt: '确认实施输入、数据日期、合同范围、控制基准与交付物。' },
      { id: 'scope-contract', labelKey: 'businessProjects.stageDeliveryScopeContract', hintKey: 'businessProjects.hintDeliveryScopeContract', label: '合同与范围控制', prompt: '建立合同义务、范围、接口、变更与责任边界。', skillSlug: 'project-delivery-contract-scope' },
      { id: 'programme-progress', labelKey: 'businessProjects.stageDeliveryProgrammeProgress', hintKey: 'businessProjects.hintDeliveryProgrammeProgress', label: '进度与资源控制', prompt: '建立或更新实施进度、资源、采购和实物完成控制。', skillSlug: 'project-delivery-programme-progress' },
      { id: 'cost-cashflow', labelKey: 'businessProjects.stageDeliveryCostCashflow', hintKey: 'businessProjects.hintDeliveryCostCashflow', label: '成本与现金流控制', prompt: '建立预算、承诺、实际、预测和现金流控制。', skillSlug: 'project-delivery-cost-commercial' },
      { id: 'risk-change', labelKey: 'businessProjects.stageDeliveryRiskChange', hintKey: 'businessProjects.hintDeliveryRiskChange', label: '风险、问题与变更', prompt: '维护风险、问题、变更、索赔和行动闭环。', skillSlug: 'project-delivery-risk-change' },
      { id: 'period-audit', labelKey: 'businessProjects.stageDeliveryPeriodAudit', hintKey: 'businessProjects.hintDeliveryPeriodAudit', label: '周期报告与审计', prompt: '完成期末数据校验、偏差解释、预测和管理报告。', skillSlug: 'project-delivery-reporting-audit' },
    ],
  },
  investment: {
    id: 'investment-main',
    labelKey: 'businessProjects.workflowInvestment',
    label: '资源投资研究',
    stages: [
      { id: 'project-setup', labelKey: 'businessProjects.stageInvestmentProjectSetup', hintKey: 'businessProjects.hintInvestmentProjectSetup', label: '项目与投资授权确认', prompt: '确认投资阶段、授权边界、估值基准日、资料和决策门槛。' },
      { id: 'mandate-screening', labelKey: 'businessProjects.stageInvestmentMandateScreening', hintKey: 'businessProjects.hintInvestmentMandateScreening', label: '机会筛选', prompt: '按投资授权、战略匹配和关键否决条件筛选机会。', skillSlug: 'resource-investment-mandate-screening' },
      { id: 'technical-diligence', labelKey: 'businessProjects.stageInvestmentTechnicalDiligence', hintKey: 'businessProjects.hintInvestmentTechnicalDiligence', label: '技术尽调', prompt: '核查资源、技术方案、产能、基础设施、资本与运营假设。', skillSlug: 'resource-investment-technical-diligence' },
      { id: 'market-legal-esg', labelKey: 'businessProjects.stageInvestmentMarketLegalEsg', hintKey: 'businessProjects.hintInvestmentMarketLegalEsg', label: '市场、法律与 ESG', prompt: '核查市场、承购、价格、权属、许可、合规和 ESG 风险。', skillSlug: 'resource-investment-legal-esg' },
      { id: 'financial-valuation', labelKey: 'businessProjects.stageInvestmentFinancialValuation', hintKey: 'businessProjects.hintInvestmentFinancialValuation', label: '财务模型与估值', prompt: '建立可追溯的情景、现金流、估值、敏感性和融资分析。', skillSlug: 'resource-investment-financial-valuation' },
      { id: 'investment-decision', labelKey: 'businessProjects.stageInvestmentDecision', hintKey: 'businessProjects.hintInvestmentDecision', label: '投资决策', prompt: '形成投资委员会可审议的条件、风险、价值与决策建议。', skillSlug: 'resource-investment-transaction-decision' },
    ],
  },
}

export function getBusinessWorkflow(moduleId: BusinessModuleId): BusinessWorkflowDefinition {
  return WORKFLOWS[moduleId]
}

export function businessWorkflowLabel(workflow: Pick<BusinessWorkflowDefinition, 'labelKey'>): string {
  return i18n.t(workflow.labelKey)
}

export function businessStageLabel(stage: Pick<BusinessWorkflowStage, 'labelKey'>): string {
  return i18n.t(stage.labelKey)
}

export function businessStageHint(stage: Pick<BusinessWorkflowStage, 'hintKey'>): string {
  return i18n.t(stage.hintKey)
}

export function businessModuleLabel(moduleId: BusinessModuleId): string {
  const keys: Record<BusinessModuleId, string> = {
    tender: 'businessProjects.moduleTender',
    delivery: 'businessProjects.moduleDelivery',
    investment: 'businessProjects.moduleInvestment',
  }
  return i18n.t(keys[moduleId])
}
