import type { BusinessModuleId, BusinessProjectRecord } from '@craft-agent/shared/business-projects'
import type { TenderStageRunResultDto } from '@craft-agent/shared/protocol'
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
  stageRun?: TenderStageRunResultDto,
): string {
  const preset = getBusinessModuleLaunchPreset(moduleId)
  const specialistSkills = [...new Set([
    ...(stage.skillSlugs ?? []),
    ...(stage.skillSlug ? [stage.skillSlug] : []),
  ])]
  const specialistSkill = specialistSkills.length > 0
    ? `\n${specialistSkills.map((slug) => `[skill:${slug}]`).join('\n')}`
    : ''
  const capabilityBlock = buildCapabilityBlock(stage)
  const dispatchBlock = buildDispatchBlock(stage)
  const stageControlBlock = buildStageControlBlock(stageRun)
  const registeredInputs = project.inputPaths.length > 0
    ? project.inputPaths.map((path) => `- ${path}`).join('\n')
    : '- 暂无；开始分析前请由用户明确添加资料。'

  return `${preset.input}${specialistSkill}

项目 / Project: ${project.name}
当前阶段 / Stage: ${stage.label}
阶段要求: ${stage.prompt}
${capabilityBlock}${stageControlBlock}${dispatchBlock}

用户明确登记的输入资料:
${registeredInputs}

只允许使用上述登记资料以及用户在本对话中明确添加的数据源或知识库条目。项目工作目录仅用于保存过程文件和交付物，不得将其扫描为来源。

`
}

function buildStageControlBlock(stageRun?: TenderStageRunResultDto): string {
  if (!stageRun) return ''
  return `
<tender_stage_control>
status: ${stageRun.status}
source_boundary_path: ${stageRun.paths.sourceBoundaryPath}
stage_state_path: ${stageRun.paths.stageStatePath}
generated_capability_packs: ${stageRun.generatedPacks.join(', ') || '(none)'}
missing_items: ${stageRun.missingItems.join(', ') || '(none)'}
${stageRun.paths.boqBatchManifestPath ? `boq_batch_manifest_path: ${stageRun.paths.boqBatchManifestPath}` : ''}
${stageRun.paths.documentAnalysisBatchManifestPath ? `document_analysis_batch_manifest_path: ${stageRun.paths.documentAnalysisBatchManifestPath}` : ''}
${stageRun.paths.taskBoardPath ? `task_board_path: ${stageRun.paths.taskBoardPath}` : ''}
Use these exact controller paths. Do not discover or replace them by scanning the project working directory.
</tender_stage_control>
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
  if (stage.id === 'tender-document-analysis') {
    return `
<controlled_subagent_dispatch>
The backend stage controller owns document batch dispatch, concurrency, retry, and child-session lifecycle. The main session must not call spawn_session, rewrite child briefs, or take over an unfinished batch.
Monitor the exact task_board_path and document_analysis_batch_manifest_path. When every batch report is schema-valid, call stage status/resume or tender_capability init/replace for document_analysis with NO inline data — runtime merges batch reports (namespaced ids) into packs/document-analysis.json and writes Agent Pi Outputs/<parentSession>/document-analysis-summary.md. Never compress, truncate, or rewrite section summaries to fit tool-call size limits; that breaks merge gates and causes retry loops. Then write evaluation_strategy and boq_reconciliation via dataPath or modest payloads.
</controlled_subagent_dispatch>
`
  }
  return `
<controlled_subagent_dispatch>
The backend stage controller owns BOQ batch dispatch, bounded concurrency, retry, and child-session lifecycle. The main session must not call spawn_session, rewrite child briefs, directly price an unfinished child range, or create substitute reports.
Batches are segmented by BOQ sheet chapter (each BOQ page ≈ one COTO chapter). Each child follows the C5.1 pure-direct-cost quality standard embedded in its brief and verifies key resource rates online (webEvidence); unverifiable rates stay "unverified".
Monitor the exact task_board_path and boq_batch_manifest_path. When every batch report is accepted, call stage status/resume or tender_capability init/replace for boq_five_step_pricing with NO inline data — the runtime merges batch reports into packs/boq-five-step-pricing.json deterministically. Never hand-assemble, compress, or rewrite pricing content into the tool call. Review normalization warnings and unverified rates with the user, then confirm bidder commitments (bidder_commitments) before downstream planning.
</controlled_subagent_dispatch>
`
}
