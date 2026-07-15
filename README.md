# Agent π / Agent Pi

<p align="center">
  <img src="docs/assets/agent-pi-logo.png" alt="AIPI Always π AI Studio" width="560" />
</p>

**中文** | Agent π 是基于 Craft Agents OSS 深度改造的 Windows 桌面智能体工作台，面向长周期项目分析、招投标文件处理、工程资料研究、多智能体协作和可追溯成果沉淀。

**English** | Agent Pi is a Windows desktop agent workbench forked and deeply adapted from Craft Agents OSS. It is designed for long-running project analysis, tender/document production, engineering research, multi-agent workflows, and traceable project outputs.

Agent π 的目标不是做一个普通聊天壳，而是把智能体升级为真实项目作业里的 **超级工作台**：主会话按工作目录组织，分支智能体折叠到主会话下，正式成果落回项目工作目录，过程文件可在应用内预览、编辑、导出，长任务由 Goal Loop 做自我审查和纠偏。

Agent Pi is not a thin chat wrapper. It is a project workbench: conversations are organized by working directory, spawned agents fold under the parent session, formal deliverables are written back to the project folder, files can be previewed/edited/exported inside the app, and Goal Loop reviews long tasks before accepting them as done.

## Latest Version / 最新版本

**Current release: V2.2.0.**

**当前发布版：V2.2.0。**

GitHub Releases / 发布页:

[https://github.com/xiangxin2021cn/agent-pi/releases](https://github.com/xiangxin2021cn/agent-pi/releases)

## Recent Changes / 最近三次变更

### V2.2.0 Enterprise Workbenches and Document Quality / V2.2.0 企业工作台与文档质量

V2.2.0 adds independent tender, project-delivery, and resource-investment workbenches while keeping the existing conversation engine as the execution surface. It also introduces a Document Quality First patch so focused professional reports prioritize genre, reader decisions, narrative coherence, and clean formal deliverables instead of workflow-heavy prose.

V2.2.0 新增相互独立的投标、项目实施和资源投资工作台，并继续复用现有对话引擎执行专业任务。同时加入“文档质量优先”补丁，让聚焦型专业报告优先匹配文体、读者决策、叙事连贯性和正式成果纯净度，不再被工作流式正文淹没。

| Area / 模块 | English | 中文 |
| --- | --- | --- |
| Enterprise workbenches | Tender, delivery, and investment projects have dedicated project lists, guided workflow bars, source intake, conversations, and output views. | 投标、实施和投资项目拥有独立项目列表、流程引导、资料输入、会话和成果视图。 |
| Independent source boundaries | Delivery and investment projects can start from their own inputs without depending on tender-stage data. | 实施和投资项目可直接使用各自输入启动，不依赖投标阶段资料。 |
| Controlled knowledge sharing | Explicitly approved artifacts are copied into immutable, hash-addressed enterprise knowledge storage for corroborative reuse across workbenches. | 经明确确认的成果复制到不可变、哈希寻址的企业知识库，供不同工作台受控复用和相互印证。 |
| Document Quality First | Genre-aware editorial profiles, narrative-first planning, and table/heading budgets keep focused reports readable and professional. | 文体感知、叙事优先规划及表格/标题预算让聚焦型报告保持专业和可读。 |
| Clean formal deliverables | Evidence matrices, handoffs, progress ledgers, and review metadata remain internal; the editorial reviewer checks answer visibility, source applicability, and process leakage. | 证据矩阵、交接、进度台账和审查元数据保持为内部文件；编辑审查检查结论可见性、来源适用性和过程信息泄漏。 |
| Core runtime | Claude Agent SDK 0.3.209 and Anthropic SDK 0.111.0 are bundled; Pi remains on 0.80.6. | 内置 Claude Agent SDK 0.3.209 和 Anthropic SDK 0.111.0；Pi 保持 0.80.6。 |

### V2.1.1 Controlled Source Analysis / V2.1.1 受控来源分析

V2.1.1 keeps narrow source questions narrow and makes professional delivery gates deterministic. Single-page and single-table analysis no longer expands into a generic five-section report, while evidence, assumptions, sub-agent handoffs, requested formats, and reader-facing quality are checked before completion.

V2.1.1 让局部来源问题保持局部，并把专业交付门槛落实到确定性检查。单页、单表分析不再膨胀为通用五章报告；证据、假设、子智能体交接、指定格式和正文质量均在完成前接受审查。

| Area / 模块 | English | 中文 |
| --- | --- | --- |
| Quick source analysis | Single-page, single-table, and bounded-range questions default to one result table, one explanation, and one confirmation item without automatic multi-agent expansion. | 单页、单表和局部范围问题默认输出一张结果表、一段解释和一个待确认事项，不自动扩展多智能体。 |
| Evidence-neutral briefs | Sub-agent briefs contain only the question, scope, allowed sources/files, and report destination; unverified parent conclusions are excluded. | 子智能体 brief 只包含问题、范围、允许来源/文件和报告路径，不携带主会话未经验证的结论。 |
| Assumption gate | Claims marked `assumption` or `unverified` in the evidence matrix cannot become unconditional core conclusions. | 证据矩阵中标记为 `assumption` 或 `unverified` 的声明不能无条件进入核心结论。 |
| Handoff lifecycle | Child work uses activity-based stale detection and report readiness instead of a fixed wait; contradictory handoffs block merge. | 子智能体按活动时间和报告就绪状态判断，不再固定等待；交接结论冲突会阻止合并。 |
| Completion and evidence | Agent-side `done` is rejected until Goal Audit passes; evidence matrices use versioned JSON and zero source coverage cannot pass. | Goal Audit 通过前拒绝智能体设置 `done`；证据矩阵使用版本化 JSON，零来源覆盖不能通过。 |
| Professional artifacts | Requested Office/data/professional formats are tracked explicitly; PDF is produced only when requested, and DOCX export preserves A3/A4 page intent. | 显式追踪 Office、数据和专业格式；仅在用户要求时输出 PDF，DOCX 导出保留 A3/A4 页面意图。 |
| Reader-facing quality | Internal evidence matrices and audit records stay out of the body by default; table balance, visual evidence, captions, sources, and export structure are audited. | 内部证据矩阵和审计记录默认不进入正文；表格比例、视觉证据、图注、来源和导出结构均接受审查。 |

### V2.1.0 Verifiable Document Delivery / V2.1.0 可验证文档交付

V2.1.0 turns enterprise long-document execution into an application-owned delivery protocol. Stable requirements, recoverable section artifacts, executable Plan/Audit/Merge transitions, complete-text checks, and final evidence packages make delivery state inspectable instead of relying on model self-reporting.

V2.1.0 将企业长文档执行升级为应用负责的交付协议。稳定需求账本、可恢复章节产物、可执行 Plan/Audit/Merge、全文校验和最终证据包让交付状态可检查，不再只依赖模型自述。

| Area / 模块 | English | 中文 |
| --- | --- | --- |
| Stable requirement ledger | Assigns stable IDs and verification rules to deliverables, constraints, evidence, formats, and acceptance criteria; follow-ups extend rather than reset the ledger. | 为交付物、约束、证据、格式和验收项分配稳定 ID 与验证规则；后续要求只扩展、不重置账本。 |
| Requirement provenance | Final audits persist status, evidence references, verification time, and failure reason per requirement; the session Info popover shows a bounded summary. | 最终审查按需求记录状态、证据引用、验证时间和失败原因；会话“信息”弹窗展示受控摘要。 |
| Transactional Markdown | `document_artifact` writes section chunks, freezes hashes, assembles atomically, and validates the final file so failed sections resume without rewriting completed work. | `document_artifact` 分章节写入、冻结哈希、原子组装并校验最终文件，失败后可从章节续跑。 |
| Executable orchestration | Dependency-aware Plan/Audit/Merge/Done transitions block premature review, merge, or completion when tasks, handoffs, sections, or artifacts are incomplete. | 依赖感知的 Plan/Audit/Merge/Done 状态机会在任务、交接、章节或产物未完成时阻止过早审查、合并或结束。 |
| Complete-text audit | Markdown, text, and JSON outputs up to 5 MiB are audited in full while previews stay bounded; oversized mandatory audits fail closed to manual review. | 5 MiB 以内 Markdown、文本和 JSON 输出执行全文审查，预览仍保持受控；超限的强制审查转入人工复核。 |
| Current-turn completion proof | Completion requires a transactionally validated artifact that the deterministic verifier identifies as output of the current turn; old files, read-only access, and reviewer claims cannot pass the gate. | 完成必须同时具备事务校验产物和确定性“本轮输出”证明；旧文件、只读访问和审查模型自述不能通过门槛。 |
| Final evidence package | Goal Audit uses a compact evidence package first and rewrites it after reviewer and completion gates resolve. | Goal Audit 优先使用紧凑证据包，并在审查与完成门槛结束后写回最终状态。 |
| Core runtime | Claude Agent SDK 0.3.206 adds lifecycle/terminal-state signals; Pi 0.80.6 improves Windows discovery, long-run retries, compaction accounting, truncated tool calls, and DeepSeek DS4 overflow detection. | Claude Agent SDK 0.3.206 增加生命周期与终态信号；Pi 0.80.6 改进 Windows 发现、长任务重试、压缩预算、截断工具调用和 DeepSeek DS4 溢出识别。 |

Older release details are available on GitHub Releases.

更早版本说明请查看 GitHub Releases。

## Core Capabilities / 核心能力

| Capability | English | 中文 |
| --- | --- | --- |
| Goal Loop | Reviews long-running tasks against the user's stated goal, required files, formats, evidence, and verification signals before accepting completion. | 按用户目标、必需文件、格式、证据和验证信号审查长任务结果，避免过早完成。 |
| Task Contract | Converts user instructions into a durable task contract with hard constraints, acceptance checks, evidence requirements, and forbidden shortcuts. | 将用户要求转成可持久化任务契约，记录硬约束、验收标准、证据要求和禁止偷懒项。 |
| Requirement Ledger | Tracks each material requirement with a stable ID, verification rule, status, evidence references, and failure reason across follow-up turns. | 跨后续轮次以稳定 ID、验证规则、状态、证据引用和失败原因追踪每项关键要求。 |
| Transactional Document Artifact | Writes long Markdown as recoverable sections and accepts completion only after hash-frozen atomic assembly and validation. | 将长 Markdown 写成可恢复章节，仅在冻结哈希、原子组装并校验后接受完成。 |
| Document Plan | Adds structure, audience, tone, section, table, chart, citation, and delivery-format expectations for document tasks. | 为文档任务提取标题、受众、语气、章节、表格、图表、引用和交付格式约束。 |
| Project Memory Lite | Stores local project facts, sources, citations, decisions, formal outputs, reviews, and quality telemetry under `.agent-pi/brain`. | 在 `.agent-pi/brain` 中沉淀来源、引用、决策、正式成果、审稿和质量经验。 |
| Enterprise Knowledge Base | Promotes local files into stable file-memory MCP knowledge sources with category/folder metadata and explicit user activation. | 将本地文件提升为稳定 file-memory MCP 知识源，带分类/文件夹元数据，并要求用户显式启用。 |
| Working-directory isolation | Locks sessions to a physical working directory so project memory and outputs do not leak across projects. | 会话锁定物理工作目录，项目记忆和正式成果按项目隔离。 |
| Formal outputs | Promotes deliverables into `Agent Pi Outputs` and labels files as formal output, attachment, data file, or process artifact. | 将成果提升到 `Agent Pi Outputs`，并区分正式成果、附件、数据文件和过程文件。 |
| File preview | Opens Markdown, text, code, JSON, PDF, Office, Excel, image, and sidecar Markdown previews inside the app where possible. | 在应用内预览 Markdown、文本、代码、JSON、PDF、Office、Excel、图片及 Markdown 伴随文件。 |
| Multi-agent sessions | Spawns sub-agents for parallel work while keeping them folded under the parent task and project directory. | 支持分智能体并行处理，并折叠到主会话和项目目录下。 |

## Download / 下载

Installers are published from GitHub Releases after validation:

安装包会在验证通过后发布到 GitHub Releases：

[https://github.com/xiangxin2021cn/agent-pi/releases/latest](https://github.com/xiangxin2021cn/agent-pi/releases/latest)

Release assets / 发布资产:

- Windows x64: `Agent-Pi-x64.exe`, `Agent-Pi-x64.exe.blockmap`, `latest.yml`
- macOS Apple Silicon: `Agent-Pi-arm64.dmg`, `Agent-Pi-arm64.zip`
- macOS Intel: `Agent-Pi-x64.dmg`, `Agent-Pi-x64.zip`, shared `latest-mac.yml`
- Linux x64: `Agent-Pi-x64.AppImage`, `latest-linux.yml`

## User Manual / 用户手册

Read the manual before using Agent Pi on production project work:

真实项目落地前建议先阅读用户手册：

[docs/USER_MANUAL.md](docs/USER_MANUAL.md)

The manual covers installation, Workspace, working directories, session folding, model switching, file preview, formal outputs, sources, skills, automations, and troubleshooting.

手册覆盖 Windows 安装、Workspace、工作目录、会话折叠、模型切换、文件预览、正式输出、数据源、技能、自动化和常见问题处理。

## Roadmap / 未来路线

Agent Pi will continue moving from a general AI desktop toward a vertical professional agent workbench. The long-term direction is not just chatting with files, but producing auditable, editable, source-grounded project artifacts.

Agent π 将从通用 AI 桌面应用继续向垂直专业智能体工作台演进。长期目标不是“和文件聊天”，而是持续生成可审查、可编辑、有来源、有过程记忆的项目成果。

Future directions include:

- Construction and tender intelligence: PDF drawing recognition, OCR/vector extraction, BOQ reconciliation, quantity takeoff, construction planning, cost-loaded schedules, and highway/civil tender workflows.
- Engineering and BIM workflows: road/corridor data models, IFC/GeoJSON/LandXML-style intermediate data, Blender/Bonsai/IfcOpenShell visualization, 4D progress views, and model-backed report figures.
- Professional document automation: Word/PDF/DOCX output quality, strict template matching, structured evidence matrices, evidence-rich Markdown, visual asset generation, export verification, and Agent Pi's document workflow quality modes.
- Multi-agent document production: chapter-agent assignments, role review, final synthesis ownership, and cross-chapter consistency checks for large tenders, engineering reports, investment reports, and due diligence.
- Enterprise knowledge: local-global knowledge MCPs first, then team/network knowledge bases, permission governance, category management, and reusable company standards.
- Domain-specific intelligence: investment analysis, GIS reporting, simulation/ANSYS/CAE post-processing, legal/compliance review, and other vertical expert workflows.

未来重点包括：

- 施工与投标智能：PDF 图纸识别、OCR/矢量提取、BOQ 对照、工程量拆分、施工策划、成本加载进度计划、公路/市政投标工作流。
- 工程与 BIM：道路/廊道数据模型、IFC/GeoJSON/LandXML 类中间数据、Blender/Bonsai/IfcOpenShell 可视化、4D 进度展示、模型驱动报告图。
- 专业文档自动化：Word/PDF/DOCX 成果质量、严格模板匹配、结构化证据矩阵、有证据的 Markdown、专业图表资产生成、导出校验，以及 Agent π 自有的文档工作流质量模式。
- 多智能体文档生产：面向大型投标、工程报告、投资报告和尽调任务的章节智能体分工、多角色评审、最终合成负责人和跨章节一致性检查。
- 知识库：先做本机全局知识 MCP 和分类/文件夹管理，再扩展团队/联网知识库、权限治理、分类管理和企业标准复用。
- 垂直领域智能：投资分析、GIS 报告、仿真/ANSYS/CAE 后处理、法律合规审查以及更多行业专家工作流。

## Collaboration / 合作共建

Agent Pi welcomes vertical-domain experts, engineers, researchers, builders, and teams who want to turn agent workflows into real production systems. We especially welcome contributors in construction management, quantity surveying, tendering, BIM/GIS, structural simulation, investment analysis, knowledge-base management, document automation, MCP tooling, and agent runtime engineering.

Agent π 欢迎垂直领域专家、工程师、研究者、开发者和团队共同参与，把智能体工作流真正做成可落地的生产系统。特别欢迎施工管理、工程造价、招投标、BIM/GIS、结构仿真、投资分析、知识库管理、文档自动化、MCP 工具和智能体运行时方向的伙伴加入。

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
powershell -ExecutionPolicy Bypass -File scripts/build-win.ps1
```

## License / 许可证

Apache-2.0
