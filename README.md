# Agent π / Agent Pi

<p align="center">
  <img src="docs/assets/agent-pi-logo.png" alt="AIPI Always π AI Studio" width="560" />
</p>

**中文** | Agent π 是基于 Craft Agents OSS 深度改造的 Windows 桌面智能体工作台，面向长周期项目分析、招投标文件处理、工程资料研究、多智能体协作和可追溯成果沉淀。

**English** | Agent Pi is a Windows desktop agent workbench forked and deeply adapted from Craft Agents OSS. It is designed for long-running project analysis, tender/document production, engineering research, multi-agent workflows, and traceable project outputs.

Agent π 的目标不是做一个普通聊天壳，而是把智能体升级为真实项目作业里的 **超级工作台**：主会话按工作目录组织，分支智能体折叠到主会话下，正式成果落回项目工作目录，过程文件可在应用内预览、编辑、导出，长任务由 Goal Loop 做自我审查和纠偏。

Agent Pi is not a thin chat wrapper. It is a project workbench: conversations are organized by working directory, spawned agents fold under the parent session, formal deliverables are written back to the project folder, files can be previewed/edited/exported inside the app, and Goal Loop reviews long tasks before accepting them as done.

## Latest Version / 最新版本

**Current release: V1.3.1.**

**当前发布版：V1.3.1。**

GitHub Releases / 发布页:

[https://github.com/xiangxin2021cn/agent-pi/releases](https://github.com/xiangxin2021cn/agent-pi/releases)

## Recent Changes / 最近三次变更

### V1.3.1 Hotfix / V1.3.1 紧急修复

V1.3.1 hardens knowledge-base scoped document execution, real multi-agent dispatch, BOQ/pricing workbook decomposition, and long-document/large-file reading. When users load selected knowledge-base entries, Agent Pi now treats those sources as the task scope, asks before broadening beyond them, and keeps Goal Loop focused first on instruction following before output polish.

V1.3.1 强化知识库限定范围、多智能体真实派发、BOQ/组价工作簿拆分和长文档/大文件读取：用户加载指定知识库后，Agent π 会优先把这些来源作为任务范围，扩大到工作目录前必须有明确理由或用户确认；Goal Loop 优先审查是否遵守用户指令，再审查成果质量。

| Area / 模块 | English | 中文 |
| --- | --- | --- |
| Knowledge-base scope | Selected enterprise knowledge-base/file-memory sources are injected as first-class task scope before working-folder discovery. | 已选择的企业知识库/file-memory 来源会作为首要任务范围，不再默认先扫工作目录。 |
| Real multi-agent dispatch | Multi-Agent Deep must create real spawned chapter sessions before final synthesis. Complex Professional/Strict tasks can also receive a bounded helper-agent plan after the main session decides orchestration. | 多智能体深度模式必须先真实创建章节分智能体再最终合成。复杂的专业文档/严格交付任务也会由主会话先判断并生成受控子智能体分工。 |
| BOQ/pricing decomposition | Full Excel/BOQ unit-rate work inventories sheets first, avoids one-pass workbook reads, and dispatches by worksheet/table/item range before final synthesis. | Excel/BOQ 全量组价会先清点工作表，避免一次性读取整本工作簿，并按工作表/表区/清单项区间派分后再总编合成。 |
| Goal Loop discipline | Automatic improvement checks the original instruction, follow-up feedback, selected sources, named chapters/files/folders, output format, and response language before judging quality. | 自动纠偏先核查原始指令、用户反馈、选中来源、指定章节/文件/文件夹、输出格式和语言，再审查质量。 |
| Manual confirmation | If the assistant asks the user to confirm scope or choices, Goal Loop pauses for review instead of silently continuing. | 智能体要求用户确认范围或方案时，Goal Loop 会停到人工审查，不再掩盖确认环节继续执行。 |
| Large-file safety | Pi-backed Read treats an offset past the end of a file as end-of-file; Excel reads are bounded by default for large BOQ sheets. | Pi Read 超过文件末尾时视为读完；Excel 读取默认限幅，避免大型 BOQ 表推爆内存。 |

### V1.3.0 Release / V1.3.0 正式发布

V1.3.0 moves Agent Pi from a document workbench toward a professional delivery system. The agent can choose the right work mode, carry evidence through the task, reuse enterprise knowledge, and keep large document jobs auditable instead of relying on a single prompt.

V1.3.0 将 Agent π 从“文档工作台”继续推进到“专业交付系统”：智能体可按任务选择工作模式，贯穿证据链，复用企业知识，并让大型文档任务保持可审计，而不是只依赖一次提示词。

| Area / 模块 | English | 中文 |
| --- | --- | --- |
| Document workflow modes | Adds Quick, Professional Document, Strict Delivery, and Multi-Agent Deep modes. | 新增快速模式、专业文档模式、严格交付模式、多智能体深度模式。 |
| Enterprise Knowledge Base | Knowledge Base files are copied into a stable app-level store, indexed, grouped by folder, previewable/editable/exportable, and loadable into chat. | 知识库文件入库到应用级稳定目录，支持索引、分类、预览、编辑、导出和会话加载。 |
| Professional documents | Adds source-backed diagrams, construction Gantt intent, investment tables, GIS-style figures, simulation/CAE summaries, and export-ready assets. | 支持有来源支撑的流程图、施工甘特图意图、投资表、GIS 表达、仿真/CAE 摘要和可导出图文资产。 |

### V1.2.7 Release / V1.2.7 发布

V1.2.7 keeps the V1.2.6 visual refresh and fixes release validation issues around locale ordering and i18n checks.

V1.2.7 保留 V1.2.6 的视觉更新，并修复 locale 排序和 i18n 发布校验问题。

| Area / 模块 | English | 中文 |
| --- | --- | --- |
| Visual polish | Transparent logo assets, corrected logo sizing, refined default theme, and Warm/Bronze themes. | 透明 logo、logo 尺寸修复、默认主题优化，以及暖色/古铜主题。 |
| Release validation | Locale ordering and i18n checks are stabilized for packaging. | 修复 locale 排序和 i18n 校验，提升打包稳定性。 |

Older release details are available on GitHub Releases.

更早版本说明请查看 GitHub Releases。

## Core Capabilities / 核心能力

| Capability | English | 中文 |
| --- | --- | --- |
| Goal Loop | Reviews long-running tasks against the user's stated goal, required files, formats, evidence, and verification signals before accepting completion. | 按用户目标、必需文件、格式、证据和验证信号审查长任务结果，避免过早完成。 |
| Task Contract | Converts user instructions into a durable task contract with hard constraints, acceptance checks, evidence requirements, and forbidden shortcuts. | 将用户要求转成可持久化任务契约，记录硬约束、验收标准、证据要求和禁止偷懒项。 |
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
- macOS Intel: `Agent-Pi-x64.dmg`, `Agent-Pi-x64.zip`
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
