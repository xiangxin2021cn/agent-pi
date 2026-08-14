import {
  TENDER_FORMAL_WRITING_SKILL_SLUG,
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
  const specialistSkills = collectSpecialistSkillSlugs(moduleId, stage)
  const specialistSkill = specialistSkills.length > 0
    ? `\n${specialistSkills.map((slug) => `[skill:${slug}]`).join('\n')}`
    : ''
  const capabilityBlock = buildCapabilityBlock(stage)
  const dispatchBlock = buildDispatchBlock(stage)
  const stageControlBlock = buildStageControlBlock(stageRun)
  const deliverablesBlock = buildDeliverablesBlock(stageRun)
  const evidenceBlock = buildCharacteristicsEvidenceBlock(stageRun)
  const registeredInputs = project.inputPaths.length > 0
    ? project.inputPaths.map((path) => `- ${path}`).join('\n')
    : '- 暂无；开始分析前请由用户明确添加资料。'

  return `${preset.input}${specialistSkill}

项目 / Project: ${project.name}
当前阶段 / Stage: ${stage.label}
阶段要求: ${stage.prompt}
${capabilityBlock}${stageControlBlock}${deliverablesBlock}${evidenceBlock}${dispatchBlock}${moduleId === 'tender' ? `\n${TENDER_WRITING_CONTRACT_DRAFT}\n` : ''}

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

${buildCapabilityBlock(stage)}${buildStageControlBlock(stageRun)}${buildDeliverablesBlock(stageRun)}${buildCharacteristicsEvidenceBlock(stageRun)}${buildDispatchBlock(stage)}
${formatSpecialistSkillBlock(moduleId, stage)}
${TENDER_WRITING_CONTRACT_DRAFT}

规则:
- 这是同一条主对话的阶段推进，不是新会话；项目记忆与上文继续有效。
- 大 PDF 解析 / 界限来源解析 / BOQ 章节组价由**主会话**按 task board brief/report 调用 spawn_session 派发（默认并发最多 4）；工作台「下一步 / 恢复」是补位与停启控制，不要一次打满队列。
- 各会话工作产物写入 Official Outputs（Agent Pi Outputs/<会话ID>/）。
- 优先阅读 tender_stage_deliverables 索引与 catalog_path，不要扫工作目录找上游成果。
- 完成门禁所需制品后再请求进入下一阶段。
- 项目特征缺口禁止臆造：请用户补传规范/合同/地质/知识库并重新解析，或对本阶段「强制放行」后才允许网络尽调（须留网址）。市场费率核证与此授权分开。
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

function buildCharacteristicsEvidenceBlock(stageRun?: TenderStageRunResultDto): string {
  const evidence = stageRun?.characteristicsEvidence
  if (!evidence) return ''
  const files = evidence.evidenceFileNames.length > 0
    ? evidence.evidenceFileNames.join('；')
    : '无'
  const gapLines = evidence.gaps.length > 0
    ? evidence.gaps.map((gap) => `- ${gap.blocking ? '[阻断] ' : ''}${gap.title} — ${gap.detail} 建议补传：${gap.suggestedUpload}`).join('\n')
    : '- （无缺口）'
  const action = evidence.webDiligenceAuthorized
    ? '用户已放行网络尽调：仅对下列缺口检索，必须留下 url 与访问时间；仍不得用模型记忆填空。市场费率 webEvidence 与此分开，仍按原规则核证。'
    : evidence.blocking
      ? '组价/策划已阻断。请用户二选一：1）回到项目资料登记补传招标文件/规范/合同/地质/知识库并重新解析；2）在工作台对本阶段点「强制放行」，授权网络尽调。在此之前禁止用网上材料或模型记忆填写项目特征。'
      : '下列项目特征未单独归纳。用到时须有已登记原文；否则请用户补传解析，或强制放行后再尽调。禁止臆造。'
  return `
<project_characteristics_evidence>
blocking: ${evidence.blocking ? 'yes' : 'no'}
web_diligence_authorized: ${evidence.webDiligenceAuthorized ? 'yes' : 'no'}
registered_evidence_files: ${files}
action_for_parent_session: ${action}
gaps:
${gapLines}
</project_characteristics_evidence>
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
The parent session is the command surface for spawn_session. Dispatch children using the exact briefPath/reportPath/markdownPath from the task board / document_analysis_batch_manifest; keep at most 4 in flight (stage default). Each child must write JSON + customer-facing MD at markdownPath — parent must not author those MDs. Extract bid-binding project characteristics (contract form and particular conditions, governing specs and clause amendments, duration, site/geology/climate, working hours and holidays, subcontracting and localisation, employer-imposed sequence). If a characteristic is not in the assigned file, record it as a gap — never fill from model memory. Workbench 「下一步 / 恢复未完任务」 complements fill-up and stop/resume — do not flood beyond concurrency. Do not rewrite child briefs or take over an unfinished batch.
Monitor the exact task_board_path and document_analysis_batch_manifest_path. When every batch report is schema-valid, wait for runtime/UI merge into packs/document-analysis.json (or call tender_capability init/replace for document_analysis with NO inline data as a fallback). The runtime then compiles Official Outputs 项目特征.md from the merged sections — parent must not hand-write that file. Never compress, truncate, or rewrite section summaries to fit tool-call size limits; that breaks merge gates and causes retry loops. Optional evaluation_strategy and boq_reconciliation may use dataPath or modest payloads after merge.
</controlled_subagent_dispatch>
`
  }
  return `
<controlled_subagent_dispatch>
The parent session is the command surface for spawn_session. Dispatch BOQ chapter children using exact briefPath/reportPath/markdownPath from the task board / boq_batch_manifest; default concurrency is 4. Each child must write JSON + customer-facing chapter MD at markdownPath — parent must not author those MDs. Workbench 「下一步 / 恢复未完任务」 complements fill-up and stop/resume. Do not rewrite child briefs, directly price an unfinished child range, or create substitute reports.
Batches are segmented by BOQ sheet/chapter. Each child follows the qualityStandard.id from its brief and verifies key resource rates online (webEvidence); unverifiable rates stay "unverified". Read upstreamDeliverables — especially 项目特征.md compiled after document analysis — before inventing method, plant, calendar, or tax assumptions. Honour brief.evidencePolicy: if webDiligenceAuthorized is false, do not use the web to fill missing specs/geology/calendar; ask the user to upload sources or force-pass. If authorized, diligence only listed gaps and keep url + accessedAt. Do not invent resources that contradict project characteristics or registered tender sources.
Monitor the exact task_board_path and boq_batch_manifest_path. When every batch report is accepted, wait for runtime/UI merge into packs/boq-five-step-pricing.json (or call tender_capability init/replace with NO inline data as a fallback). Never hand-assemble, compress, or rewrite pricing content into the tool call. Review normalization warnings and unverified rates with the user, then confirm bidder commitments (bidder_commitments) before downstream planning.
</controlled_subagent_dispatch>
`
}

function collectSpecialistSkillSlugs(moduleId: BusinessModuleId, stage: BusinessWorkflowStage): string[] {
  const slugs = [...new Set([
    ...(stage.skillSlugs ?? []),
    ...(stage.skillSlug ? [stage.skillSlug] : []),
  ])]
  if (moduleId === 'tender' && slugs.length > 0 && !slugs.includes(TENDER_FORMAL_WRITING_SKILL_SLUG)) {
    slugs.push(TENDER_FORMAL_WRITING_SKILL_SLUG)
  }
  return slugs
}

function formatSpecialistSkillBlock(moduleId: BusinessModuleId, stage: BusinessWorkflowStage): string {
  const slugs = collectSpecialistSkillSlugs(moduleId, stage)
  return slugs.length > 0 ? `\n${slugs.map((slug) => `[skill:${slug}]`).join('\n')}\n` : ''
}
