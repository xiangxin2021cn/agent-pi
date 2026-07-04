import { describe, expect, it } from 'bun:test'
import type { SessionGoalState } from '@craft-agent/shared/sessions'
import { getDocumentEnhancementViewModel, getDocumentPlanDetailItems, getDocumentPlanStatusText } from './document-enhancement-view-model'

const t = (key: string, values?: Record<string, unknown>) => {
  if (key === 'sessionInfo.documentPlanStatus') {
    return `${String(values?.items ?? '')} 已启用`
  }
  if (typeof values?.defaultValue === 'string') {
    return values.defaultValue.replace('{{items}}', String(values.items ?? ''))
  }
  return key
}

function goalState(overrides: Partial<SessionGoalState> = {}): SessionGoalState {
  return {
    id: 'goal-1',
    objective: 'Create a report',
    mode: 'auto_improve',
    status: 'running',
    createdAt: 1,
    updatedAt: 1,
    iteration: 1,
    maxIterations: 3,
    criteria: [],
    auditHistory: [],
    ...overrides,
  }
}

describe('document enhancement view model', () => {
  it('shows a draft hint for document generation with visual and no-fabrication constraints', () => {
    const viewModel = getDocumentEnhancementViewModel(t, {
      input: '生成 Word 报告，加入图表和 HTML 内嵌增强，但不能编造数据，需要引用来源。',
    })

    expect(viewModel?.source).toBe('draft')
    expect(viewModel?.title).toBe('文档增强')
    expect(viewModel?.summary).toContain('已启用文档增强审查')
    expect(viewModel?.chips).toContain('图表')
    expect(viewModel?.chips).toContain('引用')
    expect(viewModel?.chips).toContain('禁止编造')
  })

  it('summarizes the persisted document plan for the session info panel', () => {
    const status = getDocumentPlanStatusText(t, goalState({
      taskContract: {
        originalRequest: '生成报告',
        taskType: 'document',
        documentPlan: {
          sections: ['摘要', '分析'],
          tables: ['风险表'],
          charts: ['趋势图'],
          enhancements: ['Use structured chart specifications such as chart.json before rendering visual assets; every data point must come from verified source data.'],
          citations: ['引用附件'],
          deliveryFormats: ['DOCX'],
        },
        deliverables: [],
        mustPreserve: [],
        evidenceRequirements: [],
        outputFormats: ['DOCX'],
        acceptanceCriteria: [],
        forbiddenShortcuts: ['Do not create charts from invented data.'],
      },
    }))

    expect(status).toBe('章节 / 表格 / 图表 / 引用 / 交付格式 / 禁止编造 已启用')
  })

  it('shows professional visual, template, and export audit chips from the document plan', () => {
    const viewModel = getDocumentEnhancementViewModel(t, {
      goalState: goalState({
        taskContract: {
          originalRequest: '生成专业报告',
          taskType: 'document',
          documentPlan: {
            domain: 'construction',
            visualPlan: {
              mode: 'professional',
              selectedKinds: [
                'construction-gantt',
                'investment-cash-flow-table',
                'site-location-map',
                'simulation-result-table',
              ],
              opportunities: [],
              auditRequirements: [],
            },
            strictTemplate: true,
            sections: ['摘要'],
            tables: [],
            charts: [],
            enhancements: [],
            citations: [],
            deliveryFormats: ['PDF', 'DOCX'],
            evidenceMatrix: [
              {
                id: 'evidence-source-1',
                source: 'tender.pdf',
                sourceType: 'file',
                supports: 'Source-backed claims, tables, visuals, and gaps.',
                reliabilityNote: 'User-provided file; cite page or clause before treating as verified.',
                citationFields: ['source', 'locator', 'claim'],
                reuseStatus: 'candidate',
              },
            ],
          },
          deliverables: [],
          mustPreserve: [],
          evidenceRequirements: [],
          outputFormats: ['PDF', 'DOCX'],
          acceptanceCriteria: [],
          forbiddenShortcuts: [],
        },
      }),
    })

    expect(viewModel?.chips).toContain('图表增强')
    expect(viewModel?.chips).toContain('专业甘特')
    expect(viewModel?.chips).toContain('A3横向')
    expect(viewModel?.chips).toContain('投资图表')
    expect(viewModel?.chips).toContain('GIS图')
    expect(viewModel?.chips).toContain('仿真图')
    expect(viewModel?.chips).toContain('证据矩阵')
    expect(viewModel?.chips).toContain('模板审计')
    expect(viewModel?.chips).toContain('导出校验')
  })

  it('builds visible document review details from contract plan gates', () => {
    const details = getDocumentPlanDetailItems(t, goalState({
      taskContract: {
        originalRequest: '大型投标报告',
        taskType: 'document',
        documentQualityMode: 'multi_agent_deep',
        documentPlan: {
          domain: 'construction',
          visualPlan: {
            mode: 'professional',
            selectedKinds: ['construction-gantt', 'site-location-map'],
            opportunities: [],
            auditRequirements: [],
          },
          strictTemplate: true,
          templateProfileId: 'pending-template-profile',
          sections: ['摘要'],
          tables: [],
          charts: [],
          enhancements: [],
          citations: [],
          deliveryFormats: ['PDF', 'DOCX'],
          deliveryReviewPlan: {
            mode: 'strict_delivery',
            failureAction: 'needs_review_or_auto_improve',
            gates: [
              {
                id: 'source_integrity',
                requirement: 'Source-backed claims must cite evidence.',
                evidence: 'Evidence matrix entries with locators.',
              },
              {
                id: 'template_fidelity',
                requirement: 'Template fidelity must be verified.',
                evidence: 'Parsed template profile and exported DOCX/PDF structure evidence.',
              },
              {
                id: 'export_files',
                requirement: 'Requested export formats must exist.',
                evidence: 'Verified output files for PDF and DOCX.',
              },
            ],
          },
          evidenceMatrix: [
            {
              id: 'evidence-source-1',
              source: 'tender.pdf',
              sourceType: 'file',
              supports: 'Source-backed claims, tables, visuals, and gaps.',
              reliabilityNote: 'User-provided file; cite page or clause before treating as verified.',
              citationFields: ['source', 'locator', 'claim'],
              reuseStatus: 'candidate',
            },
            {
              id: 'evidence-source-2',
              source: 'boq.xlsx',
              sourceType: 'file',
              supports: 'Source-backed claims, tables, visuals, and gaps.',
              reliabilityNote: 'User-provided file; cite sheet before treating as verified.',
              citationFields: ['source', 'locator', 'claim'],
              reuseStatus: 'candidate',
            },
          ],
          agentPlan: {
            mode: 'chapter_agents',
            finalSynthesisOwner: 'final_synthesis_owner',
            assignments: [
              {
                id: 'chapter-agent-1',
                title: '技术方案',
                role: 'technical_chapter_agent',
                reviewFocus: '技术完整性',
              },
              {
                id: 'chapter-agent-2',
                title: '施工进度',
                role: 'schedule_chapter_agent',
                reviewFocus: '进度逻辑',
              },
            ],
            reviewStages: ['Cross-chapter consistency review before final synthesis.'],
            guardrails: ['Only the final synthesis owner may write or replace the final deliverable after chapter drafts are reviewed.'],
          },
        },
        deliverables: [],
        mustPreserve: [],
        evidenceRequirements: [],
        outputFormats: ['PDF', 'DOCX'],
        acceptanceCriteria: [],
        forbiddenShortcuts: [],
      },
    }))

    expect(details).toEqual([
      { id: 'evidenceMatrix', label: '证据矩阵', value: 'tender.pdf · boq.xlsx' },
      { id: 'deliveryReview', label: '交付门槛', value: 'source_integrity · template_fidelity · export_files' },
      { id: 'visualAudit', label: '图表审查', value: 'construction-gantt · site-location-map' },
      { id: 'templateAudit', label: '模板审计', value: 'pending-template-profile' },
      { id: 'exportAudit', label: '导出校验', value: 'PDF · DOCX' },
      { id: 'agentPlan', label: '章节智能体', value: '技术方案 · 施工进度' },
      { id: 'agentReview', label: '统稿与评审', value: '最终统稿: final_synthesis_owner · 1项评审: Cross-chapter consistency review before final synthesis.' },
    ])
  })

  it('shows strict delivery mode in the session document plan status', () => {
    const status = getDocumentPlanStatusText(t, goalState({
      taskContract: {
        originalRequest: '生成严格交付报告',
        taskType: 'document',
        documentQualityMode: 'strict_delivery',
        documentPlan: {
          sections: ['摘要'],
          tables: [],
          charts: [],
          enhancements: [],
          citations: [],
          deliveryFormats: ['PDF', 'DOCX'],
          strictTemplate: true,
        },
        deliverables: [],
        mustPreserve: [],
        evidenceRequirements: [],
        outputFormats: ['PDF', 'DOCX'],
        acceptanceCriteria: [],
        forbiddenShortcuts: [],
      },
    }))

    expect(status).toContain('严格交付')
    expect(status).toContain('模板审计')
    expect(status).toContain('交付格式')
  })

  it('shows multi-agent deep mode in the contract enhancement chips', () => {
    const viewModel = getDocumentEnhancementViewModel(t, {
      goalState: goalState({
        taskContract: {
          originalRequest: '大型投标报告，多智能体深度模式',
          taskType: 'document',
          documentQualityMode: 'multi_agent_deep',
          documentPlan: {
            sections: ['第一章', '第二章'],
            tables: [],
            charts: [],
            enhancements: [],
            citations: [],
            deliveryFormats: ['MD'],
            agentPlan: {
              mode: 'chapter_agents',
              finalSynthesisOwner: 'final_synthesis_owner',
              assignments: [
                {
                  id: 'chapter-agent-1',
                  title: '第一章',
                  role: 'source_evidence_agent',
                  reviewFocus: '出处完整性',
                },
              ],
              reviewStages: ['Cross-chapter consistency review before final synthesis.'],
              guardrails: ['Only the final synthesis owner may write or replace the final deliverable after chapter drafts are reviewed.'],
            },
          },
          deliverables: [],
          mustPreserve: [],
          evidenceRequirements: [],
          outputFormats: ['MD'],
          acceptanceCriteria: [],
          forbiddenShortcuts: [],
        },
      }),
    })

    expect(viewModel?.chips[0]).toBe('多智能体深度')
    expect(viewModel?.chips).toContain('章节智能体')
    expect(viewModel?.tooltip).toContain('多智能体深度')
  })

  it('stays hidden for ordinary chat input', () => {
    expect(getDocumentEnhancementViewModel(t, { input: '你好' })).toBeUndefined()
  })
})
