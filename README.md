# Agent π / Agent Pi

<p align="center">
  <img src="docs/assets/agent-pi-logo.png" alt="AIPI Always π AI Studio" width="620" />
</p>

**中文** | Agent π 是基于 Craft Agents OSS 深度改造的 Windows 桌面智能体工作台，面向长周期项目分析、招投标文件处理、工程资料研究、多智能体协作和可追溯成果沉淀。

**English** | Agent Pi is a Windows desktop agent workbench forked and deeply adapted from Craft Agents OSS. It is designed for long-running project analysis, tender/document production, engineering research, multi-agent workflows, and traceable project outputs.

Agent π 的目标不是做一个普通聊天壳，而是把智能体升级为真实项目作业里的 **超级工作台**：主会话按工作目录组织，分支智能体折叠到主会话下，正式成果落回项目工作目录，过程文件可在应用内预览、编辑、导出，长任务由 Goal Loop 做自我审查和纠偏。

Agent Pi is not a thin chat wrapper. It is a project workbench: conversations are organized by working directory, spawned agents fold under the parent session, formal deliverables are written back to the project folder, files can be previewed/edited/exported inside the app, and Goal Loop reviews long tasks before accepting them as done.

## Latest Version / 最新版本

**Current release: V1.2.5. Next major development line: V1.3.0.**

**当前发布版：V1.2.5。下一阶段重大开发线：V1.3.0。**

GitHub Releases / 发布页:

[https://github.com/xiangxin2021cn/agent-pi/releases](https://github.com/xiangxin2021cn/agent-pi/releases)

## V1.3.0 Development Focus / V1.3.0 开发重点

V1.3.0 moves Agent Pi from a document workbench toward a professional delivery system: the agent can choose the right work mode, carry evidence through the task, reuse enterprise knowledge, and keep large document jobs auditable instead of relying on a single prompt.

V1.3.0 将 Agent π 从“文档工作台”继续推进到“专业交付系统”：智能体可按任务选择工作模式，贯穿证据链，复用企业知识，并让大型文档任务保持可审计，而不是只依赖一次提示词。

| Area / 模块 | English | 中文 |
| --- | --- | --- |
| Document workflow modes | Adds Quick, Professional Document, Strict Delivery, and Multi-Agent Deep modes. Users can keep lightweight chat fast, or require evidence matrices, chapter plans, strict delivery gates, and multi-agent review for major tenders, engineering reports, investment reports, and due-diligence work. | 新增快速模式、专业文档模式、严格交付模式、多智能体深度模式。普通对话保持轻量；大型投标、工程报告、投资报告和尽调任务可启用证据矩阵、章节计划、严格交付门禁和多智能体评审。 |
| Goal Loop quality gates | Strict and deep modes route work through stronger Goal Loop checks for sources, template fidelity, professional visuals, export formats, formatting review, chapter handoffs, and final synthesis ownership. | 严格/深度模式会触发更强 Goal Loop 审查，覆盖来源、模板保真、专业图表、导出格式、排版复核、章节交接和最终合成负责人。 |
| Enterprise Knowledge Base | Knowledge Base files are copied into a stable app-level store, indexed into `knowledge-base/index.md`, grouped by folder, previewable/editable/exportable in the UI, and loadable into a chat from the data-source selector with single-entry or select-all selection. | 知识库文件会入库到应用级稳定目录，生成 `knowledge-base/index.md` 索引，按文件夹归类，可在 UI 中预览/编辑/导出，并可在对话框数据源中“加载知识库”，支持单选或全选。 |
| Structured knowledge import | Knowledge Base ingestion is planned around Markdown-first memory: `.md`, `.txt`, `.json`, `.pdf`, Word, Excel, and CSV files can be converted into structured Markdown before becoming file-memory MCP sources. | 知识库入库采用 Markdown 优先记忆：`.md`、`.txt`、`.json`、`.pdf`、Word、Excel、CSV 等文件可先结构化为 Markdown，再创建 file-memory MCP 知识源。 |
| Professional document intelligence | The document workflow can request source-backed diagrams, tables, construction Gantt visuals, investment tables, GIS-style figures, simulation/CAE summaries, and export-ready assets when the content calls for richer professional expression. | 文档工作流可在内容需要时要求生成有来源支撑的流程图、表格、施工甘特图、投资表、GIS 表达、仿真/CAE 摘要和可导出图文资产。 |
| Reasoning for stronger local models | Professional modes include a bounded critical-reasoning protocol useful for DeepSeek-style models: decomposition, opposing-case review, third-party challenge, revision, and risk-qualified conclusion. Quick mode remains lightweight. | 专业模式内置适合 DeepSeek 类模型的有界批判推理流程：拆解、正反推演、第三方质疑、修正复盘、带条件和风险的结论；快速模式仍保持轻量。 |

## V1.2.5 Hotfix / V1.2.5 修复

V1.2.5 fixes a concrete Goal Loop false failure seen in document/spreadsheet production tasks. Temporary helper scripts under the session `data` directory are no longer treated as formal deliverables, Windows output paths with spaces are captured correctly, and verified files in the formal output directory are accepted as output evidence when their extension matches the requested format.

V1.2.5 修复文档/表格生产任务中的一次真实误判：会话 `data` 目录下的临时脚本不再被当成正式交付物；包含空格的 Windows 输出路径可以被正确识别；位于正式输出目录且扩展名符合请求格式的文件，会被作为有效输出证据。

This keeps the hard gates intact: real missing deliverables, wrong output directories, wrong requested formats, unresolved non-transient tool failures, and explicit runtime/system errors still fail the audit.

硬性审查仍然保留：真实缺失交付物、输出目录错误、格式不匹配、未解决的非临时工具失败，以及明确运行时/系统错误仍会判定失败。

## V1.2.4 Hotfix / V1.2.4 修复

V1.2.4 restores the automatic Goal Loop self-correction path. A recoverable tool failure inside a completed turn no longer forces an immediate manual-review stop when the audit already has a concrete correction and the goal still has iteration budget. This fixes the case where users could see a self-review report but Agent Pi did not start the next improvement pass.

V1.2.4 恢复 Goal Loop 的自动纠偏链路：当一次完整回合里出现可恢复工具失败时，只要审查已经给出明确修正方向且目标仍有迭代预算，就不再直接停到人工审查。这修复了“能看到自审查报告，但没有拉起下一轮自动改进”的问题。

Safety boundaries remain: interrupted turns, no final assistant output, explicit system error messages, repeated identical failures, and exhausted budgets still stop for manual review.

安全边界仍然保留：中断回合、没有最终助手输出、显式系统错误、连续重复同一失败、预算耗尽，仍会进入人工审查而不是无限循环。

## V1.2.3 Hotfix / V1.2.3 修复

V1.2.3 fixes the in-app What's New release-note source. V1.2.2 correctly fixed the packaged app version, but the bundled release-note assets were still missing V1.2.1 and V1.2.2 entries, so the local What's New panel could stop at V1.2.0. The release-note loader now only shows versioned `X.Y.Z.md` files and a regression test checks that the latest visible release note matches the app package version.

V1.2.3 修复应用内“最新动态”的更新说明来源。V1.2.2 已经修复应用版本号，但打包资源里缺少 V1.2.1 和 V1.2.2 更新说明，所以本地“最新动态”可能只显示到 V1.2.0。现在更新说明加载器只展示 `X.Y.Z.md` 版本文件，并新增测试校验最新可见更新说明必须等于应用包版本。

V1.2.3 also fixes read-state persistence for completed sessions. Viewing a settled session now updates `lastReadMessageId` even when `hasUnread` was already false, preventing older completed tasks from reappearing as unread after reinstall or restart.

V1.2.3 同时修复完成会话的已读状态持久化：用户查看已结束会话时，即使 `hasUnread` 已经是 false，也会同步 `lastReadMessageId`，避免老的完成任务在重装或重启后重新显示为未读。

## V1.2.2 Hotfix / V1.2.2 修复

V1.2.2 fixes the About/update version source. V1.2.1 packages were correctly built as 1.2.1, but the About page read the shared workspace package version and could display 1.1.3. The updater state now reads Electron's packaged `app.getVersion()`, and stale cached installers without version metadata are no longer treated as ready-to-install updates.

V1.2.2 修复“关于/检查更新”的版本来源。V1.2.1 安装包本身是 1.2.1，但关于页读取了 shared 工作区包版本，可能显示 1.1.3。现在更新状态改为读取 Electron 打包后的 `app.getVersion()`，并且不再把缺少版本元数据的旧缓存安装器误判为可安装更新。

## V1.2.1 Release / V1.2.1 发布

V1.2.1 turns the V1.2 document-workbench direction into a release focused on higher-quality professional outputs, reusable enterprise knowledge, and more reliable export behavior.

V1.2.1 将 V1.2 的文档工作台方向推进为正式发布版，重点提升专业成果质量、企业知识复用和导出稳定性。

| Area / 模块 | English | 中文 |
| --- | --- | --- |
| Document Quality Composer | Adds industry-aware visual detection, source-backed diagram/table requirements, evidence-rich Markdown conventions, and stricter document-quality audit signals. | 新增行业化图表识别、来源支撑的图表/表格要求、有证据的 Markdown 写作规范和更严格的文档质量审计信号。 |
| Professional reports | Adds construction-focused Gantt foundations with WBS grouping, baseline/current plan, progress line, critical path, milestones, legends, and A4/A3 landscape export intent; expands planning for investment, GIS, and simulation/CAE visuals. | 建立施工甘特图基础，支持 WBS、基线/当前计划、进度线、关键路径、里程碑、图例和 A4/A3 横向导出意图；同时扩展投资、GIS、仿真/CAE 图表规划。 |
| Export stability | Resolves Markdown image assets for export, keeps Mermaid editable in Markdown while allowing stable SVG export, and fails loudly when referenced image assets are missing. | 导出时解析 Markdown 图片资源；Mermaid 在 Markdown 中保持可编辑，同时支持稳定 SVG 导出；缺失图片会明确失败，避免空白成果。 |
| Template fidelity | Treats strict template matching as a code-level DOCX/OOXML template-rendering problem instead of prompt-only styling. | 将严格模板匹配定义为代码级 DOCX/OOXML 模板渲染问题，而不是只靠提示词控制样式。 |
| Enterprise Knowledge Base | Promotes generated `.md`, `.txt`, and `.json` artifacts into file-memory MCP knowledge sources with category/folder metadata and explicit user activation. | 可将生成的 `.md`、`.txt`、`.json` 产物提升为 file-memory MCP 知识源，带分类/文件夹元数据，并要求用户显式启用。 |
| Release packaging | Windows V1.2.1 installer is validated locally; GitHub Actions can generate macOS DMG/ZIP and Linux AppImage assets for the same release tag. | Windows V1.2.1 安装包已本地验证；GitHub Actions 可为同一 release tag 生成 macOS DMG/ZIP 与 Linux AppImage 资产。 |

## V1.2.0 Update / V1.2.0 更新

| Area / 模块 | English | 中文 |
| --- | --- | --- |
| Unified preview | File links opened from chat, attachments, and right-side outputs now share consistent preview actions. Markdown sidecars can be edited and exported to MD/PDF/DOCX. | 对话、附件和右侧输出文件的预览入口统一；带 Markdown 伴随文件时，可编辑并导出 MD/PDF/DOCX。 |
| AI rewrite in editor | Editable Markdown previews support selecting text, asking the active session to rewrite it with project memory context, previewing the replacement, and applying it back to the selected range. | Markdown 编辑状态支持选中文字后调用当前会话智能体改写，继承项目记忆，预览后回填到原选择位置。 |
| MinerU | MinerU precision extraction is bundled as an optional PDF/scanned-document enhancement. It is off by default and only runs when the workspace switch is enabled and a workspace-scoped token exists. | MinerU 作为可选 PDF/扫描件精确识别增强随包提供；默认关闭，必须工作区显式开启且配置 token 后才会运行。 |
| AnySearch MCP | AnySearch MCP is available as a recommended search connector. It installs disabled and unauthenticated; saving an API key does not silently enable it. | AnySearch MCP 作为推荐搜索连接器预置；安装后仍为禁用且未认证，保存 API key 也不会静默启用。 |
| Folder attachments | Selecting a folder now sends a path-only local folder reference instead of uploading every file under it. | 选择上传文件夹时只传本地绝对路径引用，不再递归上传文件夹下所有文件。 |
| Spawned agents | Sub-agents inherit the parent session working directory unless a working directory is explicitly supplied. | 分智能体默认继承父会话工作目录，不再误用工作区默认目录。 |
| Construction schedules | Added a project skill for generating Primavera P6 XML, Microsoft Project XML, and Candy General Importer-compatible planning artifacts from construction method statements and master programme text. | 新增施工进度计划 skill，可从施工方案、总计划文字生成 P6 XML、Microsoft Project XML 和 Candy General Importer 兼容计划文件。 |
| Runtime performance | Completed Pi-backed sessions release idle `pi-agent-server` Bun subprocesses after a short delay, reducing memory pressure when many sub-agents have finished. | Pi 会话完成后会延迟释放空闲 `pi-agent-server` Bun 子进程，减少大量分智能体完成后长期占用内存。 |

### Default-Off Guarantee / 默认关闭承诺

MinerU and AnySearch are **not enabled by default**. Token/API-key presence alone is not enough to activate either integration.

MinerU 和 AnySearch **默认不启用**。即使已经保存 token 或 API key，也不会自动开启；必须由用户在工作区或来源设置中显式启用。

## V1.2.1 Technical Scope / V1.2.1 技术范围

V1.2.1 focuses on making Agent Pi a stronger document-production and knowledge-reuse workbench for professional project teams.

V1.2.1 将重点强化 Agent π 的专业文档创作、知识复用和行业化交付能力。

| Direction | English | 中文 |
| --- | --- | --- |
| Document Quality Composer | Detect report sections that deserve richer visual expression, then generate source-backed Markdown visuals, tables, diagrams, captions, and export-ready assets. | 自动识别适合用图表、流程图、表格、组织架构等表达的内容区块，生成有来源支撑、可复用、可导出的 Markdown 图文资产。 |
| Professional visuals | Add construction Gantt charts with WBS, baseline/current plan, progress line, critical path, milestones, legends, and A4/A3 landscape export options. Also expand investment, GIS, and simulation/CAE visual profiles. | 强化专业视觉表达：建筑施工甘特图支持 WBS、基线/当前计划、进度线、关键路径、里程碑、图例、A4/A3 横向导出；同时扩展投资、GIS、仿真/CAE 等垂直场景图表。 |
| Template fidelity | When a user uploads a reference template, audit the new output against its layout intent, heading structure, depth, figure/table conventions, and delivery format. For strict Word/PDF fidelity, plan a code-level template engine that treats Markdown as semantic content and renders final DOCX through DOCX/OOXML template replication rather than prompt-only styling. | 用户上传参照模板后，严格审查新文件是否匹配页面布局意图、目录结构、内容深度、图表规范和交付格式。严格复刻 Word/PDF 版式时，规划代码级模板引擎：Markdown 只作为语义内容源，最终 DOCX 通过 DOCX/OOXML 模板复制渲染，而不是仅靠提示词控制样式。 |
| Evidence-rich Markdown | Improve how agents cite external search evidence, images, charts, screenshots, and source metadata inside `.md` deliverables. | 强化 `.md` 成果中外部资料、图片、图表、截图、来源链接、发布时间、作者/机构等证据引用。 |
| Knowledge Base | Add generated `.md`, `.txt`, and `.json` artifacts to a Knowledge Base MCP source from the right-side file panel, accept a suggested category/folder or type a custom one, and show it under Data Sources -> Knowledge Base. User selection is required before use. | 右侧产物文件可右键“加入知识库”，MVP 支持 `.md`、`.txt`、`.json`，创建时可接受推荐分类/文件夹或自定义输入，并自动出现在左侧“数据源 -> 知识库”；必须由用户选择后才启用。 |

Detailed planning:

- [V1.2.1 Document Quality Composer Plan](docs/superpowers/plans/2026-07-02-v1.2.1-document-quality-composer.md)
- [V1.2.1 Document Quality Composer Research Note](docs/research/1.2.1-document-quality-composer.md)
- [Future Engineering, BIM, And Construction Agent Framework](docs/research/future-engineering-bim-construction-agent-framework.md)

### V1.2.1 Development Update / V1.2.1 开发更新

| Area | English | 中文 |
| --- | --- | --- |
| Visual composer | Adds industry-aware visual detection and audit criteria for construction, investment, GIS, simulation/CAE, and other professional reports. Visuals require source data and must include captions and source notes. | 新增行业化图表识别与审计标准，覆盖施工、投资、GIS、仿真/CAE 等专业报告；图表必须有数据支撑，并带图注和来源说明。 |
| Construction schedules | Establishes professional Gantt foundations with WBS grouping, baseline/current plan, progress line, critical path, milestones, legends, and A4/A3 landscape export intent. | 建立专业施工甘特图基础，支持 WBS 分组、基线/当前计划、进度线、关键路径、里程碑、图例以及 A4/A3 横向导出意图。 |
| Export stability | Markdown image assets are resolved for export; Mermaid remains editable in Markdown while export can render it as stable SVG. Missing image assets fail loudly instead of producing blank documents. | Markdown 图片资源会在导出时解析；Mermaid 在 Markdown 中保持可编辑，导出时可渲染为稳定 SVG；缺失图片会明确失败而不是导出空白图。 |
| Template fidelity | Strict template mode is treated as code-level template profiling and audit. Markdown is the semantic draft; exact Word fidelity requires DOCX/OOXML template rendering rather than prompt-only styling. | 严格模板模式升级为代码级模板画像与审计：Markdown 是语义稿，精确 Word 版式需要 DOCX/OOXML 模板渲染，不能只靠提示词。 |
| Knowledge Base | Generated `.md`, `.txt`, and `.json` artifacts can be promoted to Knowledge Base file-memory MCP sources with category/folder metadata and explicit user activation. | 生成的 `.md`、`.txt`、`.json` 产物可提升为知识库 file-memory MCP 源，带分类/文件夹元数据，并要求用户显式启用。 |
| Safety boundary | No fabricated charts, maps, simulation figures, investment metrics, or template-fidelity claims. Missing inputs become audit issues or missing-input tables. | 不伪造图表、地图、仿真图、投资指标或模板保真声明；缺失输入会转成审计问题或缺失输入表。 |

## V1.1.3 Update / V1.1.3 更新

V1.1.3 introduced a MoA-inspired quality review council for Goal Loop, task quality routing, Project Memory Lite reviewer telemetry, stronger self-correction prompts, recent-session recovery after restart, stable workspace-folder ordering, bundled Git for Windows 2.55.0, Pi SDK 0.80.3, Claude Agent SDK 0.3.197, Sonnet 5, and Bedrock route support.

V1.1.3 实验性引入 MoA 启发的质量评审 council、任务质量路由、Project Memory Lite 评审经验沉淀和自动纠偏增强；修复重启后最近会话丢失、展开工作文件夹跳顶；Windows 安装包集成 Git for Windows 2.55.0，Pi 升级到 0.80.3，Claude Agent SDK 升级到 0.3.197，并补充 Sonnet 5 与 Bedrock 路由支持。

## Version History / 版本更新

| Version | English | 中文 | Release |
| --- | --- | --- | --- |
| V1.3.0 | Development line for document workflow modes, strict/deep Goal Loop quality gates, enterprise Knowledge Base indexing/loading, structured knowledge import, and professional document intelligence. | 开发线：文档工作流模式、严格/深度 Goal Loop 质量门禁、企业知识库索引与加载、结构化知识入库和专业文档智能。 | Planned |
| V1.2.5 | Hotfix for false Goal Loop failures caused by transient helper scripts and Windows output paths with spaces. | 修复临时脚本和带空格 Windows 输出路径导致的 Goal Loop 误判失败。 | [v1.2.5](https://github.com/xiangxin2021cn/agent-pi/releases/tag/v1.2.5) |
| V1.2.4 | Hotfix for Goal Loop automatic self-correction after recoverable tool failures. | 修复可恢复工具失败后 Goal Loop 未继续自动纠偏的问题。 | [v1.2.4](https://github.com/xiangxin2021cn/agent-pi/releases/tag/v1.2.4) |
| V1.2.3 | Hotfix for in-app What's New release notes, versioned release-note loading, and completed-session read-state persistence. | 修复应用内“最新动态”更新说明缺失、限定只加载版本化更新说明，并修复完成会话已读状态重启回潮。 | [v1.2.3](https://github.com/xiangxin2021cn/agent-pi/releases/tag/v1.2.3) |
| V1.2.2 | Hotfix for About/update version source and stale updater-cache detection. | 修复关于页/检查更新版本来源，以及旧更新缓存误判。 | [v1.2.2](https://github.com/xiangxin2021cn/agent-pi/releases/tag/v1.2.2) |
| V1.2.1 | Document Quality Composer, professional visual/export guardrails, code-level template-fidelity direction, enterprise Knowledge Base MCP promotion, and V1.2.1 cross-platform release packaging. | 文档质量编排、专业图表/导出护栏、代码级模板保真方向、企业知识库 MCP 提升，以及 V1.2.1 跨平台发布打包。 | [v1.2.1](https://github.com/xiangxin2021cn/agent-pi/releases/tag/v1.2.1) |
| V1.2.0 | Unified file preview/edit/export, AI selection rewrite, optional MinerU extraction, optional AnySearch MCP setup, folder path-only attachments, spawned-agent working-directory inheritance, construction schedule skill, and idle Pi runtime cleanup. | 统一文件预览/编辑/导出、选中文本 AI 改写、可选 MinerU、可选 AnySearch MCP、文件夹路径引用、分智能体继承工作目录、施工进度计划 skill、Pi 空闲 runtime 清理。 | [v1.2.0](https://github.com/xiangxin2021cn/agent-pi/releases/tag/v1.2.0) |
| V1.1.3 | MoA-inspired quality review council, quality routing, Project Memory reviewer telemetry, session UI recovery, stable workspace ordering, bundled Git, SDK upgrades. | MoA 启发质量评审、多角色质量路由、项目记忆沉淀、会话资产修复、工作目录排序修复、打包 Git、SDK 升级。 | [v1.1.3](https://github.com/xiangxin2021cn/agent-pi/releases/tag/v1.1.3) |
| V1.1.2 | Task Contract and Document Plan for document-heavy workflows. | 新增 Task Contract 与 Document Plan，强化文档任务硬约束。 | [v1.1.2](https://github.com/xiangxin2021cn/agent-pi/releases/tag/v1.1.2) |
| V1.1.1 | Fixed native file/folder picker timeout behavior. | 修复文件、文件夹和工作目录选择 30 秒超时。 | [v1.1.1](https://github.com/xiangxin2021cn/agent-pi/releases/tag/v1.1.1) |
| V1.1.0 | Strengthened Goal Loop, Project Memory Lite, working-directory isolation, formal output previews, and prompt optimization routing. | 强化 Goal Loop、Project Memory Lite、工作目录隔离、正式输出预览和提示词优化模型路由。 | [v1.1.0](https://github.com/xiangxin2021cn/agent-pi/releases/tag/v1.1.0) |
| V1.0.0 | First major workbench release with Goal Loop, rendered Markdown editing, PDF/DOCX export, and long-task document quality guardrails. | 首个重大工作台版本：Goal Loop、渲染态 Markdown 编辑、PDF/DOCX 导出和长任务文档质量护栏。 | [v1.0.0](https://github.com/xiangxin2021cn/agent-pi/releases/tag/v1.0.0) |

## Core Capabilities / 核心能力

| Capability | English | 中文 |
| --- | --- | --- |
| Goal Loop | Reviews long-running tasks against the user's stated goal, required files, formats, evidence, and verification signals before accepting completion. | 按用户目标、必需文件、格式、证据和验证信号审查长任务结果，避免过早完成。 |
| Task Contract | Converts user instructions into a durable task contract with hard constraints, acceptance checks, evidence requirements, and forbidden shortcuts. | 将用户要求转成可持久化任务契约，记录硬约束、验收标准、证据要求和禁止偷懒项。 |
| Document Plan | Adds structure, audience, tone, section, table, chart, citation, and delivery-format expectations for document tasks. | 为文档任务提取标题、受众、语气、章节、表格、图表、引用和交付格式约束。 |
| Project Memory Lite | Stores local project facts, sources, citations, decisions, formal outputs, reviews, and quality telemetry under `.agent-pi/brain`. | 在 `.agent-pi/brain` 中沉淀来源、引用、决策、正式成果、审稿和质量经验。 |
| Working-directory isolation | Locks sessions to a physical working directory so project memory and outputs do not leak across projects. | 会话锁定物理工作目录，项目记忆和正式成果按项目隔离。 |
| Formal outputs | Promotes deliverables into `Agent Pi Outputs` and labels files as formal output, attachment, data file, or process artifact. | 将成果提升到 `Agent Pi Outputs`，并区分正式成果、附件、数据文件和过程文件。 |
| File preview | Opens Markdown, text, code, JSON, PDF, Office, Excel, image, and sidecar Markdown previews inside the app where possible. | 在应用内预览 Markdown、文本、代码、JSON、PDF、Office、Excel、图片及 Markdown 伴随文件。 |
| Multi-agent sessions | Spawns sub-agents for parallel work while keeping them folded under the parent task and project directory. | 支持分智能体并行处理，并折叠到主会话和项目目录下。 |

## User Manual / 用户手册

Read the manual before using Agent Pi on production project work:

真实项目落地前建议先阅读用户手册：

[docs/USER_MANUAL.md](docs/USER_MANUAL.md)

The manual covers installation, Workspace, working directories, session folding, model switching, file preview, formal outputs, sources, skills, automations, and troubleshooting.

手册覆盖 Windows 安装、Workspace、工作目录、会话折叠、模型切换、文件预览、正式输出、数据源、技能、自动化和常见问题处理。

## Download / 下载

Installers are published from GitHub Releases after validation:

安装包会在验证通过后发布到 GitHub Releases：

[https://github.com/xiangxin2021cn/agent-pi/releases/latest](https://github.com/xiangxin2021cn/agent-pi/releases/latest)

Release assets / 发布资产:

- Windows x64: `Agent-Pi-x64.exe`, `Agent-Pi-x64.exe.blockmap`, `latest.yml`
- macOS Apple Silicon: `Agent-Pi-arm64.dmg`, `Agent-Pi-arm64.zip`
- macOS Intel: `Agent-Pi-x64.dmg`, `Agent-Pi-x64.zip`
- Linux x64: `Agent-Pi-x64.AppImage`, `latest-linux.yml`

## Roadmap / 未来路线

Agent Pi will continue moving from a general AI desktop toward a vertical professional agent workbench. The long-term direction is not just chatting with files, but producing auditable, editable, source-grounded project artifacts.

Agent π 将从通用 AI 桌面应用继续向垂直专业智能体工作台演进。长期目标不是“和文件聊天”，而是持续生成可审查、可编辑、有来源、有过程记忆的项目成果。

Future directions include:

- Construction and tender intelligence: PDF drawing recognition, OCR/vector extraction, BOQ reconciliation, quantity takeoff, construction planning, cost-loaded schedules, and highway/civil tender workflows.
- Engineering and BIM workflows: road/corridor data models, IFC/GeoJSON/LandXML-style intermediate data, Blender/Bonsai/IfcOpenShell visualization, 4D progress views, and model-backed report figures.
- Professional document automation: Word/PDF/DOCX output quality, strict template matching, structured evidence matrices, evidence-rich Markdown, visual asset generation, export verification, and Agent Pi's own document workflow quality modes: Quick, Professional Document, Strict Delivery, and Multi-Agent Deep.
- Multi-agent document production: chapter-agent assignments, role review, final synthesis ownership, and cross-chapter consistency checks for large tenders, engineering reports, investment reports, and due diligence.
- Enterprise knowledge: local-global knowledge MCPs first, then team/network knowledge bases, permission governance, category management, and reusable company standards.
- Domain-specific intelligence: investment analysis, GIS reporting, simulation/ANSYS/CAE post-processing, legal/compliance review, and other vertical expert workflows.
- Agent self-improvement: stronger Goal Loop audits, self-correction, reviewer telemetry, MoA-style quality review, and weaker/private model enhancement through tools and structured workflows.

未来重点包括：

- 施工与投标智能：PDF 图纸识别、OCR/矢量提取、BOQ 对照、工程量拆分、施工策划、成本加载进度计划、公路/市政投标工作流。
- 工程与 BIM：道路/廊道数据模型、IFC/GeoJSON/LandXML 类中间数据、Blender/Bonsai/IfcOpenShell 可视化、4D 进度展示、模型驱动报告图。
- 专业文档自动化：Word/PDF/DOCX 成果质量、严格模板匹配、结构化证据矩阵、有证据的 Markdown、专业图表资产生成、导出校验，以及 Agent π 自有的文档工作流质量模式：快速模式、专业文档模式、严格交付模式、多智能体深度模式。
- 多智能体文档生产：面向大型投标、工程报告、投资报告和尽调任务的章节智能体分工、多角色评审、最终合成负责人和跨章节一致性检查。
- 知识库：先做本机全局知识 MCP 和 Obsidian 式分类/文件夹管理，再扩展团队/联网知识库、权限治理、分类管理和企业标准复用。
- 垂直领域智能：投资分析、GIS 报告、仿真/ANSYS/CAE 后处理、法律合规审查以及更多行业专家工作流。
- 智能体自我改进：更强 Goal Loop 审计、自我纠偏、评审经验沉淀、MoA 式质量评审，以及通过工具和结构化流程增强弱模型/私有化模型。

## Collaboration / 合作共建

Agent Pi is open to collaboration with vertical-domain experts, engineers, researchers, builders, and teams who want to turn agent workflows into real production systems. We especially welcome contributors in construction management, quantity surveying, tendering, BIM/GIS, structural simulation, investment analysis, knowledge-base management, document automation, MCP tooling, and agent runtime engineering.

Agent π 欢迎垂直领域专家、工程师、研究者、开发者和团队共同参与，把智能体工作流真正做成可落地的生产系统。特别欢迎施工管理、工程造价、招投标、BIM/GIS、结构仿真、投资分析、知识库管理、文档自动化、MCP 工具和智能体运行时方向的伙伴加入。

If you have domain datasets, repeatable workflows, industry standards, validation cases, or specialized tools, you can help shape Agent Pi into a practical vertical agent platform.

如果你有行业数据、可复用流程、专业规范、验证案例或专用工具，欢迎一起把 Agent π 拓展成真正面向专业场景的垂直智能体平台。

## Development / 开发

Install dependencies / 安装依赖:

```bash
bun install
```

Run checks / 运行检查:

```bash
bun run typecheck:all
bun run lint
```

Build a local Windows installer without uploading to GitHub / 本地生成 Windows 安装包但不上传 GitHub:

```powershell
cd apps/electron
powershell -ExecutionPolicy Bypass -File scripts\build-win.ps1
```

Output / 产物位置:

```text
apps/electron/release/Agent-Pi-x64.exe
```

Use `-KillLockingProcesses` only when you intentionally want the build script to close local development Electron/Node processes.

只有明确需要关闭本地开发 Electron/Node 锁文件进程时，才添加 `-KillLockingProcesses`。

## License / 许可证

Apache-2.0. See [LICENSE](LICENSE).

## Copyright And Contact / 版权与联系

<p align="center">
  <img src="AIPI-logo.png" alt="Always π AI Studio" width="360" />
</p>

© 2026 Always π AI Studio. Agent π is released under the Apache-2.0 license.

Author / Maintainer / 作者维护者：567601@qq.com
