import { describe, expect, it } from 'bun:test'
import type { SessionGoalState } from '@craft-agent/shared/sessions'
import { getDocumentEnhancementViewModel, getDocumentPlanStatusText } from './document-enhancement-view-model'

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
    expect(viewModel?.chips).toContain('模板审计')
    expect(viewModel?.chips).toContain('导出校验')
  })

  it('stays hidden for ordinary chat input', () => {
    expect(getDocumentEnhancementViewModel(t, { input: '你好' })).toBeUndefined()
  })
})
