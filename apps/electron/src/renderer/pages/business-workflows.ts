import type { BusinessModuleId } from '@craft-agent/shared/business-projects'

export interface BusinessWorkflowStage {
  id: string
  label: string
  prompt: string
  skillSlug?: string
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
      },
      {
        id: 'boq-five-step-pricing',
        label: 'BOQ 逐项五步法成本分解组价',
        prompt: '基于已完成的招标文件分析、合同要求、专用条款修订、规范工作范围定义和 BOQ 项，对每一条清单项无遗漏执行五步法：范围与工程量依据、施工方法与生产率、人材机资源消耗、询源单价与直接成本、复核与条件风险。必须汇总人材机数量、形成成本分解，并为后续工期、资源和现金流推定提供结构化依据。',
        skillSlug: 'tender-boq-five-step-pricing',
        requiredCapabilities: ['document_analysis', 'boq_reconciliation'],
        producesCapabilities: ['boq_five_step_pricing'],
        dispatchPolicy: 'controlled-subagents',
      },
      {
        id: 'work-plan-methodology',
        label: '施工总策划 / WORK PLAN AND PROPOSED METHODOLOGY',
        prompt: '基于招标工期要求、项目所在地工作时间/节假日规定、BOQ 五步法推导、人材机约束和可参考知识库模板，编制投标施工总策划与 WORK PLAN AND PROPOSED METHODOLOGY。内容应覆盖施工总体部署、关键施工方法、分区分段顺序、组织资源、质量安全环保、交通/接口/临设/风险措施，并匹配标书评审要求。',
        skillSlug: 'tender-execution-planning',
        requiredCapabilities: ['document_analysis', 'boq_reconciliation', 'boq_five_step_pricing'],
        producesCapabilities: ['execution_plan'],
      },
      {
        id: 'programme-resources-cost-cashflow',
        label: '进度、资源、成本与现金流',
        prompt: '在施工总策划基础上细化施工总进度计划、人材机资源计划、成本计划和现金流计划。进度计划必须依据工期要求、作业日历、生产率和施工逻辑；资源和现金流必须追溯到 BOQ 五步法组价和施工部署。',
        skillSlug: 'tender-schedule-resource-planning',
        requiredCapabilities: ['execution_plan', 'boq_five_step_pricing'],
        producesCapabilities: ['schedule_resources', 'cost_cashflow'],
      },
      {
        id: 'tender-submission-documents',
        label: '递交文件编制',
        prompt: '按投标要求生成正式递交文档模块，包括 WORK PLAN AND PROPOSED METHODOLOGY、施工进度计划、人员/材料/机械计划、现金流计划以及用户或招标文件明确要求的其他专业格式文件。只在用户或招标文件要求时导出 PDF/DOCX/XLSX/Project/P6 等格式；默认先产出可审阅的正式 Markdown/结构化源文件。',
        skillSlug: 'tender-submission-documents',
        requiredCapabilities: ['execution_plan', 'schedule_resources', 'cost_cashflow'],
        producesCapabilities: ['submission_documents'],
      },
      {
        id: 'submission-audit',
        label: '递交审查',
        prompt: '按招标要求、模板、交付格式、证据覆盖和内部一致性完成提交前审查。重点核查 WORK PLAN AND PROPOSED METHODOLOGY、施工进度计划、人材机计划、现金流计划是否和招标边界、BOQ 组价、施工策划一致。',
        skillSlug: 'tender-submission-audit',
        requiredCapabilities: ['submission_documents'],
        producesCapabilities: ['submission_audit'],
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
