import { TENDER_FORMAL_WRITING_SKILL_SLUG, type BusinessModuleId } from '@craft-agent/shared/business-projects'

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
    label: '投标全流程',
    stages: [
      {
        id: 'project-setup',
        label: '项目资料登记',
        prompt: '上传并登记招标资料即可。资料齐套后由用户确认进入解析；本步不派生子智能体，不进行组价或策划。登记说明沿用招标文件原名与原术语，禁止 AI 导读腔。',
      },
      {
        id: 'tender-document-analysis',
        label: '招标文件解析',
        prompt: '对每个已登记文件产出可读 Markdown 解析稿（一等成果），归纳关键约束与交叉引用；完成后合成 document_analysis 与 boq_reconciliation。evaluation_strategy 可选，不阻塞本阶段。默认最多 4 并发；子会话同时交付 JSON+MD，不得由主会话代写 MD；不得提前进入组价或策划。解析稿按本标书专业化写作并去 AI 味：用雇主术语与条款写组价/施工/合规含义，禁止套话与文件目录腔。',
        skillSlug: 'tender-document-parsing',
        skillSlugs: ['tender-document-parsing', TENDER_FORMAL_WRITING_SKILL_SLUG],
        producesCapabilities: ['document_analysis', 'boq_reconciliation'],
        dispatchPolicy: 'controlled-subagents',
      },
      {
        id: 'project-boundary-conditions',
        label: '项目边界条件',
        prompt: '面板是登记台和确认台：选用企业知识库规范、勾选本标已解析规范、上传投标人自有文件（设备/队伍/营地/历史价/组织机构），不要再扫一遍招标资料。主会话按登记来源派发解析子会话，把抽出的规范与资源写入 project_boundary pack；人工确认后该 pack 成为组价 brief 的硬围栏。边界说明用本标书术语与已确认条件，禁止通用教材腔与 AI 套话。',
        skillSlug: 'tender-project-boundary',
        skillSlugs: ['tender-project-boundary', TENDER_FORMAL_WRITING_SKILL_SLUG],
        requiredCapabilities: ['document_analysis'],
        producesCapabilities: ['project_boundary'],
        dispatchPolicy: 'controlled-subagents',
      },
      {
        id: 'boq-five-step-pricing',
        label: 'BOQ 逐页组价与资源汇总',
        prompt: '按项目边界条件 pack 的硬围栏（allowedSourceIds / extractedInventory / pricingStandard / 计量标准）组价：以清单分册/章节为单位逐项组价；原样锁定清单编码/描述/单位/工程量；引用规范与计量支付条款；给出施工顺序、劳机班组、瓶颈公式及乐观/基准/悲观生产率；逐项计算每 BOQ 单位的人材机、分包、运输和损耗消耗；费率必须注明日期、地点、来源类型、取得方式，关键费率必须联网询价核证并留 webEvidence。不得编造围栏外设备、工法或料源。默认串行按页；汇总行与人造组合项不属于定价对象。结束后汇总施工资源消耗总表，并由用户确认投入条件。组价工作底稿用本标清单/规范/计量支付用语书写并去 AI 味，禁止空泛施工教科书段落。',
        skillSlugs: ['tender-boq-five-step-pricing', 'tender-bidder-commitments', TENDER_FORMAL_WRITING_SKILL_SLUG],
        requiredCapabilities: ['document_analysis', 'project_boundary'],
        producesCapabilities: ['boq_five_step_pricing', 'construction_resource_schedule', 'bidder_commitments'],
        dispatchPolicy: 'controlled-subagents',
      },
      {
        id: 'planning-and-submission',
        label: '施工策划、进度、成本与出稿',
        prompt: '按可见子步骤推进：施工策划 → 进度/资源/现金流（同时产出 MS Project 与 P6 XML、人机直方图、S 曲线）→ Work Plan DOCX 与一致性核对。必须充分阅读解析 MD、项目边界条件与组价成果；结合工期、项目特征与工效/资源；不得跳过子步骤门禁。策划、进度说明与正式出稿按招标回标格式与本标术语撰写并去 AI 味，禁止通用方案模板腔。',
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
