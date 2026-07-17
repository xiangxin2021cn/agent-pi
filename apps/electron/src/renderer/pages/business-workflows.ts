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
        label: 'BOQ 逐项五步法成本分解组价',
        prompt: '按 C5.1 纯直接费标准，对每一条 BOQ 清单项无遗漏形成独立工作底稿：原样锁定清单编码/描述/单位/工程量；引用规范与计量支付条款；给出施工顺序、劳机班组、瓶颈公式及乐观/基准/悲观生产率；逐项计算每 BOQ 单位的人材机、分包、运输和损耗消耗；使用注明日期、地点、来源类型、取得方式且不含 VAT 的费率；复核分类小计、纯直接单价、清单合价、工期及项目特定风险。通用人材机数据库、市场价格汇总、章节叙述或未组价范围清单只能作为输入，不能作为本阶段产物。间接费、利润、一般预备费和调价不得计入逐项纯直接费；逐项现金流留到后续阶段。',
        skillSlug: 'tender-boq-five-step-pricing',
        requiredCapabilities: ['document_analysis', 'boq_reconciliation'],
        producesCapabilities: ['boq_five_step_pricing'],
        dispatchPolicy: 'controlled-subagents',
      },
      {
        id: 'bidder-commitments',
        label: '投标投入条件与策划约束确认',
        prompt: '在 BOQ 五步法计算需求基础上，由用户确认本项目实际拟投入条件。可通过本对话输入或上传文件，逐项确认劳动力与管理人员总量、机械设备数量及自有调拨/新购/当地租赁方式、材料询价与历史采购依据、营地投入及位置、施工方法与生产率修订、初步施工顺序和时间方向、分包决策。必须明确区分“BOQ 计算需求”与“投标人拟投入承诺”；不得由模型替用户补齐或默认确认。九类条件均须确认、接受为显式假设或标记不适用，形成 bidder_commitments 能力包后才能进入施工总策划。',
        skillSlug: 'tender-bidder-commitments',
        requiredCapabilities: ['document_analysis', 'boq_five_step_pricing'],
        producesCapabilities: ['bidder_commitments'],
      },
      {
        id: 'work-plan-methodology',
        label: '施工总策划 / WORK PLAN AND PROPOSED METHODOLOGY',
        prompt: '基于招标工期要求、项目所在地工作时间/节假日规定、BOQ 五步法推导以及用户已确认的 bidder_commitments 投入条件与策划约束，编制投标施工总策划与 WORK PLAN AND PROPOSED METHODOLOGY。内容应覆盖施工总体部署、关键施工方法、分区分段顺序、组织资源、质量安全环保、交通/接口/临设/风险措施，并匹配标书评审要求。用户确认的资源、采购、营地、生产率、顺序和分包决策优先于模型推算；差异必须显式说明。',
        skillSlug: 'tender-execution-planning',
        requiredCapabilities: ['document_analysis', 'boq_reconciliation', 'boq_five_step_pricing', 'bidder_commitments'],
        producesCapabilities: ['execution_plan'],
      },
      {
        id: 'schedule-resource-planning',
        label: '进度与资源计划',
        prompt: '在施工总策划基础上细化施工总进度计划和人材机资源计划。计划必须依据招标工期、作业日历、BOQ 五步法生产率、施工逻辑和资源约束，并生成可审阅的结构化 schedule_resources 能力包；需要专业计划文件时，再依据该能力包生成 P6、Project 或 Candy 导入文件。',
        skillSlugs: ['tender-schedule-resource-planning', 'construction-schedule-planner'],
        requiredCapabilities: ['execution_plan', 'boq_five_step_pricing'],
        producesCapabilities: ['schedule_resources'],
      },
      {
        id: 'cost-cashflow-planning',
        label: '成本与现金流计划',
        prompt: '基于 BOQ 对账、逐项五步法成本包和已审定进度资源计划，形成成本计划、时间分布成本和现金流计划。每项金额必须可追溯到 BOQ 项、资源费率、计划活动或明确假设，写入独立 cost_cashflow 能力包。',
        skillSlugs: ['tender-cost-cashflow-planning'],
        requiredCapabilities: ['boq_reconciliation', 'boq_five_step_pricing', 'schedule_resources'],
        producesCapabilities: ['cost_cashflow'],
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
