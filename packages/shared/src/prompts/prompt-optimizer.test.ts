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

  it('does not force unrelated tasks into a tender or engineering workflow', () => {
    const instruction = buildPromptOptimizationInstruction({
      input: '修复登录页中文输入前几个拼音字母会直接蹦出来的问题，并加一个回归测试',
      workingDirectory: 'C:\\repo',
      model: 'deepseek-v4-pro',
    })

    expect(instruction).toContain('代码修改')
    expect(instruction).toContain('最小必要改动')
    expect(instruction).toContain('修复登录页中文输入前几个拼音字母会直接蹦出来的问题')
    expect(instruction).not.toContain('招标文件内容')
    expect(instruction).not.toContain('工程量')
    expect(instruction).not.toContain('投标流程')
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

  it('keeps fallback generic for non-document tasks', () => {
    const optimized = createPromptOptimizationFallback({
      input: '检查 Electron 退出后仍有后台进程驻留的问题',
    })

    expect(optimized).toContain('检查 Electron 退出后仍有后台进程驻留的问题')
    expect(optimized).toContain('按任务类型执行')
    expect(optimized).not.toContain('招标文件')
    expect(optimized).not.toContain('工程量')
  })

  it('does not wrap an already structured fallback prompt again', () => {
    const first = createPromptOptimizationFallback({
      input: '请分析 gstack 对本应用有什么启发',
    })
    const second = createPromptOptimizationFallback({
      input: first,
    })

    expect(second).toBe(first)
    expect(second.match(/## 任务目标/g)).toHaveLength(1)
  })

  it('normalizes fenced model output to plain prompt text', () => {
    expect(normalizeOptimizedPrompt('```markdown\n# 任务\n执行分析\n```')).toBe('# 任务\n执行分析')
  })
})
