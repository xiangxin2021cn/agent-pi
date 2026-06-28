import { describe, expect, it } from 'bun:test'
import {
  buildPromptOptimizationInstruction,
  createPromptOptimizationFallback,
  normalizeOptimizedPrompt,
} from './prompt-optimizer'

describe('prompt optimizer helpers', () => {
  it('builds a model instruction that preserves user intent and forbids invented facts', () => {
    const instruction = buildPromptOptimizationInstruction({
      input: '分析招标文件里的关键工期和罚款条款',
      attachments: [
        { name: 'Tender.pdf', type: 'pdf', size: 1024 },
        { name: 'BOQ.xlsx', type: 'office' },
      ],
      workingDirectory: 'E:\\Project',
      model: 'deepseek-chat',
      connectionName: 'DS',
    })

    expect(instruction).toContain('分析招标文件里的关键工期和罚款条款')
    expect(instruction).toContain('Tender.pdf')
    expect(instruction).toContain('BOQ.xlsx')
    expect(instruction).toContain('不要编造')
    expect(instruction).toContain('只输出优化后的提示词')
  })

  it('creates a deterministic fallback prompt without adding fake materials', () => {
    const optimized = createPromptOptimizationFallback({
      input: '帮我写施工方案',
      attachments: [{ name: 'spec.pdf', type: 'pdf' }],
    })

    expect(optimized).toContain('任务目标')
    expect(optimized).toContain('帮我写施工方案')
    expect(optimized).toContain('spec.pdf')
    expect(optimized).toContain('不要编造')
    expect(optimized).not.toContain('未提供的图纸')
  })

  it('normalizes fenced model output to plain prompt text', () => {
    expect(normalizeOptimizedPrompt('```markdown\n# 任务\n执行分析\n```')).toBe('# 任务\n执行分析')
  })
})
