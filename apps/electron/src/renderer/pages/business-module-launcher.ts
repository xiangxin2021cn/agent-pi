import type { BusinessModuleId, BusinessProjectRecord } from '@craft-agent/shared/business-projects'
import type { BusinessWorkflowStage } from './business-workflows'

export type { BusinessModuleId }

interface BusinessModuleLaunchPreset {
  name: string
  input: string
  send: false
}

const PRESETS: Record<BusinessModuleId, BusinessModuleLaunchPreset> = {
  tender: {
    name: '投标任务',
    input: `[skill:tender-intelligence-core]
[Source boundary: user-selected attachments, data sources, and knowledge-base entries only. Do not scan the working directory.]
请进入投标工作流。先确认项目、资料范围、文件优先级和预期交付物，再开始分析。

任务 / Task: `,
    send: false,
  },
  delivery: {
    name: '项目实施任务',
    input: `[skill:project-delivery-controls-core]
[Source boundary: user-selected attachments, data sources, and knowledge-base entries only. Do not scan the working directory.]
请进入项目实施控制工作流。先确认项目输入、数据日期、控制范围和预期交付物，再开始处理。

任务 / Task: `,
    send: false,
  },
  investment: {
    name: '资源投资研究任务',
    input: `[skill:resource-investment-intelligence-core]
[Source boundary: user-selected attachments, data sources, and knowledge-base entries only. Do not scan the working directory.]
请进入资源投资研究工作流。先确认投资阶段、研究范围、估值基准日和预期交付物，再开始分析。

任务 / Task: `,
    send: false,
  },
}

export function getBusinessModuleLaunchPreset(moduleId: BusinessModuleId): BusinessModuleLaunchPreset {
  return PRESETS[moduleId]
}

export function buildBusinessTaskDraft(
  moduleId: BusinessModuleId,
  project: BusinessProjectRecord,
  stage: BusinessWorkflowStage,
): string {
  const preset = getBusinessModuleLaunchPreset(moduleId)
  const specialistSkill = stage.skillSlug ? `\n[skill:${stage.skillSlug}]` : ''
  const capabilityBlock = buildCapabilityBlock(stage)
  const dispatchBlock = buildDispatchBlock(stage)
  const registeredInputs = project.inputPaths.length > 0
    ? project.inputPaths.map((path) => `- ${path}`).join('\n')
    : '- 暂无；开始分析前请由用户明确添加资料。'

  return `${preset.input}${specialistSkill}

项目 / Project: ${project.name}
当前阶段 / Stage: ${stage.label}
阶段要求: ${stage.prompt}
${capabilityBlock}${dispatchBlock}

用户明确登记的输入资料:
${registeredInputs}

只允许使用上述登记资料以及用户在本对话中明确添加的数据源或知识库条目。项目工作目录仅用于保存过程文件和交付物，不得将其扫描为来源。

`
}

function buildCapabilityBlock(stage: BusinessWorkflowStage): string {
  const lines: string[] = []
  if (stage.requiredCapabilities?.length) {
    lines.push(`上游能力要求 / Required capabilities: ${stage.requiredCapabilities.join(', ')}`)
  }
  if (stage.producesCapabilities?.length) {
    lines.push(`本阶段应写入能力包 / Capability outputs: ${stage.producesCapabilities.join(', ')}`)
  }
  return lines.length ? `\n${lines.join('\n')}\n` : ''
}

function buildDispatchBlock(stage: BusinessWorkflowStage): string {
  if (stage.dispatchPolicy !== 'controlled-subagents') return ''
  return `
<controlled_subagent_dispatch>
Use spawn_session only from the main session when the BOQ item set is too large for a single pass.
Create orchestration/briefs and orchestration/reports before dispatch.
Each child brief must contain only: assigned BOQ item IDs, the exact question, allowed sources, report_path, and the target capability boq_five_step_pricing.
child agents must not call spawn_session or create child sessions.
Child agents must write only their structured handoff report to report_path; they must not write final synthesis artifacts.
The main session must merge child reports, run conflict checks, and write the boq_five_step_pricing capability pack before downstream planning.
</controlled_subagent_dispatch>
`
}
