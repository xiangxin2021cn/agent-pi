export interface PromptOptimizationAttachment {
  name: string
  type?: string
  size?: number
}

export interface PromptOptimizationContext {
  input: string
  attachments?: PromptOptimizationAttachment[]
  workingDirectory?: string
  model?: string
  connectionName?: string
}

function formatAttachment(attachment: PromptOptimizationAttachment): string {
  const parts = [attachment.name]
  if (attachment.type) parts.push(`type=${attachment.type}`)
  if (typeof attachment.size === 'number') parts.push(`size=${attachment.size}`)
  return `- ${parts.join(', ')}`
}

export function buildPromptOptimizationInstruction(context: PromptOptimizationContext): string {
  const input = context.input.trim()
  const attachments = context.attachments?.length
    ? context.attachments.map(formatAttachment).join('\n')
    : '无'
  const runtime = [
    context.workingDirectory ? `工作目录：${context.workingDirectory}` : undefined,
    context.connectionName ? `连接：${context.connectionName}` : undefined,
    context.model ? `模型：${context.model}` : undefined,
  ].filter(Boolean).join('\n') || '无'

  return [
    '你是 Agent π 的“发送前指令优化器”。请把用户原始输入改写成更清晰、更可执行、更利于智能体遵从的提示词。',
    '',
    '硬性规则：',
    '- 保留用户的真实意图、语言和约束，不要改变任务目标。',
    '- 不要编造文件、数据、条款、页码、结论或用户没有提供的背景。',
    '- 如果需要引用材料，要求智能体优先依据用户提供的附件、工作目录文件或对话上下文。',
    '- 如果信息不足，把“需要确认的问题”列到提示词末尾，但不要阻止智能体先完成可确定部分。',
    '- 输出要适合直接发送给智能体执行。',
    '- 只输出优化后的提示词，不要解释优化过程，不要包裹代码块。',
    '',
    '建议结构：',
    '任务目标、输入材料、关键约束、执行步骤、输出格式、验收标准、需要确认的问题。',
    '',
    '当前上下文：',
    runtime,
    '',
    '附件：',
    attachments,
    '',
    '用户原始输入：',
    input,
  ].join('\n')
}

export function createPromptOptimizationFallback(context: PromptOptimizationContext): string {
  const input = context.input.trim()
  const attachments = context.attachments?.length
    ? context.attachments.map(formatAttachment).join('\n')
    : '未提供附件'
  const materialHint = context.attachments?.length
    ? '优先读取并引用上述附件中的真实内容；关键数据、条款、页码、金额、工程量等必须来自附件或工作目录中的可核验材料。'
    : '如需使用外部材料或工作目录文件，请先明确说明需要读取哪些材料；不要编造未提供的数据、条款、页码或结论。'

  return [
    '## 任务目标',
    input,
    '',
    '## 输入材料',
    attachments,
    '',
    '## 关键约束',
    `- ${materialHint}`,
    '- 区分原始材料事实、你的分析判断和仍需用户确认的事项。',
    '- 对关键性数据、规范条文、清单数据、招标文件内容，必须说明依据来源；无法确认时标注“待核实”。',
    '- 不要编造未提供的背景、文件名、页码、金额、工期或技术参数。',
    '',
    '## 执行步骤',
    '1. 先确认任务范围和可用材料。',
    '2. 提取与任务直接相关的事实、约束和风险点。',
    '3. 基于可核验材料形成分析或草稿。',
    '4. 在输出末尾列出依据来源、未决问题和建议的下一步。',
    '',
    '## 输出格式',
    '- 使用清晰标题和分点结构。',
    '- 关键结论后附依据或“待核实”标识。',
    '- 如生成正式文档，请同时给出可落地的文件名建议。',
    '',
    '## 验收标准',
    '- 结论可追溯到材料或明确标注为分析判断。',
    '- 不遗漏用户原始任务中的核心要求。',
    '- 输出可直接用于下一步审阅、修改或落地成文件。',
  ].join('\n')
}

export function normalizeOptimizedPrompt(value: string | null | undefined): string {
  let text = (value ?? '').trim()
  const fence = text.match(/^```[a-zA-Z0-9_-]*\s*\n([\s\S]*?)\n```$/)
  if (fence) text = (fence[1] ?? '').trim()
  return text.replace(/^["']([\s\S]*)["']$/, '$1').trim()
}
