import type { BusinessModuleId } from '@craft-agent/shared/business-projects'

export interface BusinessWorkflowStage {
  id: string
  label: string
  prompt: string
  skillSlug?: string
}

export interface BusinessWorkflowDefinition {
  id: string
  label: string
  stages: BusinessWorkflowStage[]
}

const WORKFLOWS: Record<BusinessModuleId, BusinessWorkflowDefinition> = {
  tender: {
    id: 'tender-main',
    label: '投标全流程',
    stages: [
      { id: 'project-setup', label: '项目与资料确认', prompt: '确认项目边界、用户指定资料、文件优先级和交付物。不得把工作目录当作来源扫描。' },
      { id: 'tender-analysis', label: '招标文件与合规分析', prompt: '提取硬性指标、提交格式、评分点、合同条件和 BOQ 范围，并保留出处。', skillSlug: 'tender-evaluation-strategy' },
      { id: 'project-planning', label: '项目总体策划', prompt: '基于已核实招标要求形成项目总体策划、组织、资源、进度、成本与现金流框架。', skillSlug: 'tender-execution-planning' },
      { id: 'work-plan-methodology', label: 'WORK PLAN AND PROPOSED METHODOLOGY', prompt: '基于项目策划与招标要求编制可提交的 WORK PLAN AND PROPOSED METHODOLOGY，方法、资源、顺序、质量、安全和环境措施必须可追溯。', skillSlug: 'tender-execution-planning' },
      { id: 'boq-five-step-pricing', label: 'BOQ 逐项五步法成本分解组价', prompt: '对每一条清单项分别执行五步法：范围与工程量依据、施工方法与生产率、资源消耗、询源单价与直接成本、复核与条件风险。不得用汇总项代替逐项推导。', skillSlug: 'tender-cost-cashflow-planning' },
      { id: 'programme-resources', label: '进度、资源、成本与现金流', prompt: '将方法论与清单组价联动为 CPM 计划、资源计划、成本计划和现金流计划。', skillSlug: 'tender-schedule-resource-planning' },
      { id: 'submission-audit', label: '递交审查', prompt: '按招标要求、模板、交付格式、证据覆盖和内部一致性完成提交前审查。', skillSlug: 'tender-submission-audit' },
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
