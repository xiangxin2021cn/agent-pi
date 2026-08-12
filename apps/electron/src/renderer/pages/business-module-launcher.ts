import {
  TENDER_WRITING_CONTRACT_DRAFT,
  type BusinessModuleId,
  type BusinessProjectRecord,
} from '@craft-agent/shared/business-projects'
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
  const deliverablesBlock = buildDeliverablesBlock(stageRun)
  const registeredInputs = project.inputPaths.length > 0
    ? project.inputPaths.map((path) => `- ${path}`).join('\n')
    : '- 暂无；开始分析前请由用户明确添加资料。'

  return `${preset.input}${specialistSkill}

项目 / Project: ${project.name}
当前阶段 / Stage: ${stage.label}
阶段要求: ${stage.prompt}
${capabilityBlock}${stageControlBlock}${deliverablesBlock}${dispatchBlock}${moduleId === 'tender' ? `\n${TENDER_WRITING_CONTRACT_DRAFT}\n` : ''}

用户明确登记的输入资料:
${registeredInputs}

只允许使用上述登记资料以及用户在本对话中明确添加的数据源或知识库条目。项目工作目录仅用于保存过程文件和交付物，不得将其扫描为来源。

本项目使用单一主会话贯穿全部阶段；请在本对话中继续，不要另开阶段主会话。大文件解析、界限来源解析与 BOQ 章节组价由运行时派发子会话完成。

`
}

/** Injected when the same project parent advances into a new stageId. */
export function buildStageHandoffDraft(
  moduleId: BusinessModuleId,
  project: BusinessProjectRecord,
  stage: BusinessWorkflowStage,
  stageRun?: TenderStageRunResultDto,
): string {
  if (moduleId !== 'tender') return buildBusinessTaskDraft(moduleId, project, stage, stageRun)
  return `【阶段切换 — 请在本项目主会话继续】

项目: ${project.name}
新阶段: ${stage.label} (\`${stage.id}\`)
阶段要求: ${stage.prompt}

${buildCapabilityBlock(stage)}${buildStageControlBlock(stageRun)}${buildDeliverablesBlock(stageRun)}${buildDispatchBlock(stage)}

${TENDER_WRITING_CONTRACT_DRAFT}

规则:
- 这是同一条主对话的阶段推进，不是新会话；项目记忆与上文继续有效。
- 大 PDF 解析 / 界限来源解析 / BOQ 章节组价由**主会话**按 task board brief/report 调用 spawn_session 派发（默认并发最多 4）；工作台「下一步 / 恢复」是补位与停启控制，不要一次打满队列。
- 子会话写出 JSON handoff 与客户可读 MD；正式成果以 packs / Agent Pi Outputs / orchestration 为准。
- 优先阅读 tender_stage_deliverables 索引与 catalog_path，不要扫工作目录找上游成果。
- 完成门禁所需制品后再请求进入下一阶段。
- 本阶段全部可读成果按本标书专业化写作并去 AI 味（见 tender_writing_contract）。

请确认当前阶段目标，并按阶段要求推进。
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
${stageRun.paths.boundaryBatchManifestPath ? `boundary_batch_manifest_path: ${stageRun.paths.boundaryBatchManifestPath}` : ''}
${stageRun.paths.taskBoardPath ? `task_board_path: ${stageRun.paths.taskBoardPath}` : ''}
${stageRun.paths.stageDeliverablesCatalogPath ? `stage_deliverables_catalog_path: ${stageRun.paths.stageDeliverablesCatalogPath}` : ''}
Use these exact controller paths. Do not discover or replace them by scanning the project working directory.
</tender_stage_control>
`
}

function buildDeliverablesBlock(stageRun?: TenderStageRunResultDto): string {
  const deliverables = stageRun?.deliverables
  if (!deliverables) return ''
  const lines = deliverables.indexLines.length > 0 ? deliverables.indexLines : ['- (none yet)']
  return `
<tender_stage_deliverables>
catalog_path: ${deliverables.catalogPath}
present: ${deliverables.presentCount} · missing: ${deliverables.missingCount} · thin: ${deliverables.thinCount}
published_to_official: ${deliverables.publishedToOfficial}
${deliverables.summaryPath ? `summary_path: ${deliverables.summaryPath}` : ''}
citable_index:
${lines.join('\n')}
Read catalog_path / listed paths for upstream evidence. Do not rescan the working tree for discovery.
</tender_stage_deliverables>
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
The parent session is the command surface for spawn_session. Dispatch children using the exact briefPath/reportPath/markdownPath from the task board / document_analysis_batch_manifest; keep at most 4 in flight (stage default). Each child must write JSON + customer-facing MD at markdownPath — parent must not author those MDs. Workbench 「下一步 / 恢复未完任务」 complements fill-up and stop/resume — do not flood beyond concurrency. Do not rewrite child briefs or take over an unfinished batch.
Monitor the exact task_board_path and document_analysis_batch_manifest_path. When every batch report is schema-valid, wait for runtime/UI merge into packs/document-analysis.json (or call tender_capability init/replace for document_analysis with NO inline data as a fallback). Never compress, truncate, or rewrite section summaries to fit tool-call size limits; that breaks merge gates and causes retry loops. Optional evaluation_strategy and boq_reconciliation may use dataPath or modest payloads after merge.
</controlled_subagent_dispatch>
`
  }
  if (stage.id === 'project-boundary-conditions') {
    return `
<controlled_subagent_dispatch>
The parent session is the command surface for spawn_session. The Overview panel is the registration/confirmation desk; do not recatalog employer tender files already parsed in document analysis. Dispatch children using the exact briefPath/reportPath/markdownPath from the task board / boundary_batch_manifest; keep at most 4 in flight. Each child parses one registered fence source (enterprise KB file or bidder-owned file) and writes JSON + customer-facing MD — parent must not author those MDs. After every parse batch is complete, wait for runtime merge into packs/project-boundary.json. Then ask the user to confirm the pack; unconfirmed packs are not a BOQ fence.
Monitor the exact task_board_path and boundary_batch_manifest_path. Do not rewrite child briefs or invent plant/labour/specs outside the registered sources.
</controlled_subagent_dispatch>
`
  }
  return `
<controlled_subagent_dispatch>
The parent session is the command surface for spawn_session. Dispatch BOQ chapter children using exact briefPath/reportPath/markdownPath from the task board / boq_batch_manifest; default concurrency is 4. Each child must write JSON + customer-facing chapter MD at markdownPath — parent must not author those MDs. Workbench 「下一步 / 恢复未完任务」 complements fill-up and stop/resume. Do not rewrite child briefs, directly price an unfinished child range, or create substitute reports.
Batches are segmented by BOQ sheet/chapter. Each child follows the qualityStandard.id from its brief (from project_boundary.pricingStandard) and verifies key resource rates online (webEvidence); unverifiable rates stay "unverified". Read projectBoundary.fence / allowedSourceIds / extractedInventory / upstreamDeliverables before inventing method, plant, or tax assumptions. Do not invent resources outside that fence.
Monitor the exact task_board_path and boq_batch_manifest_path. When every batch report is accepted, wait for runtime/UI merge into packs/boq-five-step-pricing.json (or call tender_capability init/replace with NO inline data as a fallback). Never hand-assemble, compress, or rewrite pricing content into the tool call. Review normalization warnings and unverified rates with the user, then confirm bidder commitments (bidder_commitments) before downstream planning.
</controlled_subagent_dispatch>
`
}
