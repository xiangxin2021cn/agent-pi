import type { BusinessModuleId } from '@craft-agent/shared/business-projects'

export interface BusinessWorkflowStage {
  id: string
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
  label: string
  stages: BusinessWorkflowStage[]
}

export type BusinessCapabilityId =
  | 'document_analysis'
  | 'evaluation_strategy'
  | 'boq_reconciliation'
  | 'boq_five_step_pricing'
  | 'bidder_commitments'
  | 'execution_plan'
  | 'schedule_resources'
  | 'cost_cashflow'
  | 'submission_documents'
  | 'submission_audit'

const WORKFLOWS: Record<BusinessModuleId, BusinessWorkflowDefinition> = {
  tender: {
    id: 'tender-main',
    label: '投标全流程',
    stages: [
      { id: 'project-setup', label: '项目与资料确认', prompt: '确认项目边界、用户指定资料、文件优先级和交付物。不得把工作目录当作来源扫描。' },
      {
        id: 'tender-document-analysis',
        label: '招标文件与合规分析',
        prompt: '按册/卷拆解招标文件，产出项目认知、项目基本信息、硬性递交要求、评分点、专用条款及修订、答疑分析、BOQ 清单解析和工程量特征。每一类结论必须保留来源，不得提前进入施工策划或组价。',
        skillSlug: 'tender-evaluation-strategy',
        producesCapabilities: ['document_analysis', 'evaluation_strategy', 'boq_reconciliation'],
        dispatchPolicy: 'controlled-subagents',
      },
      {
        id: 'boq-five-step-pricing',
        label: 'BOQ 逐页组价与投入确认',
        prompt: '按 C5.1 纯直接费标准，以 BOQ 页（每个 COTO 章节）为单位派生子智能体逐项组价：原样锁定清单编码/描述/单位/工程量；引用规范与计量支付条款；给出施工顺序、劳机班组、瓶颈公式及乐观/基准/悲观生产率；逐项计算每 BOQ 单位的人材机、分包、运输和损耗消耗；费率必须注明日期、地点、来源类型、取得方式且不含 VAT，关键费率（柴油/人工/设备租赁/水泥/骨料/沥青/分包）必须联网询价核证并留 webEvidence 链接，无法核证的标 unverified 不得编造。随后由用户确认拟投入条件（人机料、营地、方法、工效、顺序、分包），模型不得替用户默认确认。汇总行与人造组合项不属于本阶段定价对象；间接费、利润、一般预备费和调价不得计入逐项纯直接费。',
        skillSlugs: ['tender-boq-five-step-pricing', 'tender-bidder-commitments'],
        requiredCapabilities: ['document_analysis', 'boq_reconciliation'],
        producesCapabilities: ['boq_five_step_pricing', 'bidder_commitments'],
        dispatchPolicy: 'controlled-subagents',
      },
      {
        id: 'planning',
        label: '施工策划、进度与成本',
        prompt: '基于招标工期要求、BOQ 五步法推导和用户已确认的投标投入条件，一次性完成施工总策划（WORK PLAN AND PROPOSED METHODOLOGY）、施工总进度与人材机资源计划、以及成本与现金流计划。用户确认的资源、采购、营地、生产率、顺序和分包决策优先于模型推算，差异必须显式说明；每项金额可追溯到 BOQ 项、资源费率、计划活动或明确假设。需要专业计划文件时，再依据 schedule_resources 能力包生成 P6、Project 或 Candy 导入文件。',
        skillSlugs: ['tender-execution-planning', 'tender-schedule-resource-planning', 'construction-schedule-planner', 'tender-cost-cashflow-planning'],
        requiredCapabilities: ['boq_five_step_pricing', 'bidder_commitments'],
        producesCapabilities: ['execution_plan', 'schedule_resources', 'cost_cashflow'],
      },
      {
        id: 'submission',
        label: '出稿与递交审查',
        prompt: '按投标要求汇编正式递交文档（WORK PLAN AND PROPOSED METHODOLOGY、施工进度计划、人员/材料/机械计划、现金流计划及招标明确要求的其他格式），随后立即做递交前红队审查：格式、模板、签章、哈希、证据覆盖与内部一致性，重点核查递交文件与招标边界、BOQ 组价、施工策划一致。只在用户或招标文件要求时导出 PDF/DOCX/XLSX/Project/P6；默认先产出可审阅的正式 Markdown/结构化源文件。',
        skillSlugs: ['tender-submission-documents', 'tender-submission-audit'],
        requiredCapabilities: ['execution_plan', 'schedule_resources', 'cost_cashflow'],
        producesCapabilities: ['submission_documents', 'submission_audit'],
      },
    ],
  },
  delivery: {
    id: 'delivery-main',
    label: '项目实施控制',
    stages: [
      { id: 'project-setup', label: '项目与基准确认', prompt: '确认实施输入、数据日期、合同范围、控制基准与交付物。' },
      { id: 'scope-contract', label: '合同与范围控制', prompt: '建立合同义务、范围、接口、变更与责任边界。', skillSlug: 'project-delivery-contract-scope' },
      { id: 'programme-progress', label: '进度与资源控制', prompt: '建立或更新实施进度、资源、采购和实物完成控制。', skillSlug: 'project-delivery-programme-progress' },
      { id: 'cost-cashflow', label: '成本与现金流控制', prompt: '建立预算、承诺、实际、预测和现金流控制。', skillSlug: 'project-delivery-cost-commercial' },
      { id: 'risk-change', label: '风险、问题与变更', prompt: '维护风险、问题、变更、索赔和行动闭环。', skillSlug: 'project-delivery-risk-change' },
      { id: 'period-audit', label: '周期报告与审计', prompt: '完成期末数据校验、偏差解释、预测和管理报告。', skillSlug: 'project-delivery-reporting-audit' },
    ],
  },
  investment: {
    id: 'investment-main',
    label: '资源投资研究',
    stages: [
      { id: 'project-setup', label: '项目与投资授权确认', prompt: '确认投资阶段、授权边界、估值基准日、资料和决策门槛。' },
      { id: 'mandate-screening', label: '机会筛选', prompt: '按投资授权、战略匹配和关键否决条件筛选机会。', skillSlug: 'resource-investment-mandate-screening' },
      { id: 'technical-diligence', label: '技术尽调', prompt: '核查资源、技术方案、产能、基础设施、资本与运营假设。', skillSlug: 'resource-investment-technical-diligence' },
      { id: 'market-legal-esg', label: '市场、法律与 ESG', prompt: '核查市场、承购、价格、权属、许可、合规和 ESG 风险。', skillSlug: 'resource-investment-legal-esg' },
      { id: 'financial-valuation', label: '财务模型与估值', prompt: '建立可追溯的情景、现金流、估值、敏感性和融资分析。', skillSlug: 'resource-investment-financial-valuation' },
      { id: 'investment-decision', label: '投资决策', prompt: '形成投资委员会可审议的条件、风险、价值与决策建议。', skillSlug: 'resource-investment-transaction-decision' },
    ],
  },
}

export function getBusinessWorkflow(moduleId: BusinessModuleId): BusinessWorkflowDefinition {
  return WORKFLOWS[moduleId]
}
