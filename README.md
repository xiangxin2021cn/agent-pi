# Agent π

<p align="center">
  <img src="docs/assets/agent-pi-logo.png" alt="AIPI Always π AI Studio" width="620" />
</p>

**Agent π 1.1.3 实验版已发布。** 这是基于 Craft Agents OSS 深度改造的 Windows 桌面智能体工作台，面向长周期项目分析、招投标文件处理、工程资料研究、多模型协同和可追溯成果沉淀。

Agent π 的目标不是做一个普通聊天壳，而是把智能体升级为真实项目作业里的 **超级工作台**：主会话按工作目录组织，分支智能体折叠到主会话下，正式成果落回项目工作目录，过程文件可在应用内预览、编辑、导出，长任务由 Goal Loop 做自我审查和纠偏。

## Agent π 1.1.3 发布

[下载 Agent π 1.1.3 Windows 安装包](https://github.com/xiangxin2021cn/agent-pi/releases/latest)

V1.1.3 是面向“提升智能体产出质量和自我改进能力”的实验版。核心方向是把 MoA 思路落到低风险的质量审查和自我纠偏环节：执行模型仍是单一主智能体，多个评审角色负责从验收、产物、风险、研究来源、代码实现等角度检查结果，并把缺口转成下一轮自动改进提示，避免多个模型同时操作文件造成混乱。

Goal Loop 增加了质量路由和评审证据沉淀。应用会根据任务类型选择更合适的审查角色，记录 `quality_route` 证据，并把评审表现、失败类别、常见缺口和模型 fallback 写入 Project Memory Lite，后续同类任务可以复用本地质量经验。右侧信息面板也会显示质量路由、上下文压力、项目记忆状态和可重置的学习遥测。

本版同时修复两个会话资产相关问题：重启应用后 UI 丢失最近会话的问题通过读取大 JSONL header 和压缩持久化 Goal 审计历史解决；展开工作文件夹后自动跳到顶部的问题通过标准化工作目录 key 并保留目录最新活动时间解决。

开箱即用方面，Windows 安装包已集成 Git for Windows 2.55.0。安装时会静默检测本机 Git 版本：未安装则安装，已安装但版本更低则升级，本机版本更高则跳过，不弹额外对话框。Pi SDK 升级到 0.80.3，Claude Agent SDK 升级到上游 Craft Agents OSS v0.10.5 使用的 0.3.197，并加入 Claude Sonnet 5 模型与 Bedrock 路由支持。

## Agent π 1.1.2 发布

V1.1.2 将 Goal Loop 从普通完成检查升级为“任务契约”驱动的审查循环。应用会把用户原始要求、后续补充、交付物、硬约束、证据要求、输出格式、验收标准、禁止偷懒项和工作目录绑定成可持久化的 Task Contract，并在自动改进和审查模型中作为硬约束传递，减少长任务被模型精简、跳步或只修局部问题的情况。

文档型任务会额外生成 Document Plan，记录标题、受众、语气、篇幅、章节、表格、图表、引用、交付格式和可读性增强要求。图表、HTML 内嵌块、流程图等增强表达只能基于已验证数据或用户明确输入生成；缺少依据时必须说明不可支撑，不能为了版面丰富而编造。

界面层也增加了可见提示：输入框会在检测到文档任务时显示“文档增强”徽标，Goal 选项改为更清晰的“目标循环 / 文档增强审查”，右侧信息面板会以一行状态显示 Document Plan 已启用的章节、表格、图表、引用、交付格式和禁止编造约束。

V1.1.1 的原生文件/目录选择不限时修复仍保留：上传附件、选择文件夹、选择工作目录会一直等待用户选择或取消；普通后台 RPC 仍保留超时保护，避免真正卡死的请求无限挂起。

## 版本更新

| 版本 | 重点更新 | 发布页 |
| --- | --- | --- |
| V1.1.3 | 实验性引入 MoA 启发的质量评审 council、任务质量路由、Project Memory Lite 评审经验沉淀和自动纠偏增强；修复重启后最近会话丢失、展开工作文件夹跳顶；Windows 安装包集成 Git 2.55.0，Pi 升级到 0.80.3，Claude Agent SDK 升级到 0.3.197 并补充 Sonnet 5。 | [v1.1.3](https://github.com/xiangxin2021cn/agent-pi/releases/tag/v1.1.3) |
| V1.1.2 | 新增 Task Contract + Document Plan，并补充文档增强可见层：输入框徽标、Goal 选项文案、右侧 Document Plan 状态和图表/HTML 禁止编造提示。 | [v1.1.2](https://github.com/xiangxin2021cn/agent-pi/releases/tag/v1.1.2) |
| V1.1.1 | 修复文件选择、文件夹附件、工作目录选择的 30 秒超时问题；用户可慢慢选择，普通 RPC 仍保留超时保护。 | [v1.1.1](https://github.com/xiangxin2021cn/agent-pi/releases/tag/v1.1.1) |
| V1.1.0 | 强化 Goal Loop、Project Memory Lite、工作目录隔离、右侧正式输出预览，并修复提示词优化调用默认模型连接的问题。 | [v1.1.0](https://github.com/xiangxin2021cn/agent-pi/releases/tag/v1.1.0) |
| V1.0.0 | 首个重大工作台版本：引入 Goal Loop、渲染态 Markdown 编辑、PDF/DOCX 导出和长任务文档质量护栏。 | [v1.0.0](https://github.com/xiangxin2021cn/agent-pi/releases/tag/v1.0.0) |

## 用户手册

第一次使用或准备在真实项目中落地前，建议先阅读 [Agent π 用户操作手册](docs/USER_MANUAL.md)。手册覆盖 Windows 安装、Workspace、工作目录、会话折叠、模型切换、文件预览、正式输出、数据源、技能、自动化和常见问题处理。

## 下载

Windows x64 安装包从 GitHub Releases 发布：

[下载最新版 Agent-Pi-x64.exe](https://github.com/xiangxin2021cn/agent-pi/releases/latest)

自动更新使用同一 Release 通道，Windows 发布资产包含：

- `Agent-Pi-x64.exe`
- `Agent-Pi-x64.exe.blockmap`
- `latest.yml`

## 主要优化

| 模块 | 优化内容 |
| --- | --- |
| Goal Loop | 新增目标自我纠偏与证据审查机制，对长任务输出进行持续检查，避免遗漏指定文件、指定格式、正式输出目录、关键来源和明显低质量文档。V1.1.3 进一步加入多角色质量评审 council，把验收、产物、风险、研究来源和代码实现等检查结果合成为下一轮纠偏提示。 |
| 质量路由 | 根据任务类型选择评审角色，记录 `quality_route` 证据；Project Memory Lite 会沉淀评审表现、失败类别、常见缺口和模型 fallback，为后续同类任务提供本地质量经验。 |
| Task Contract | 将用户指令转成可持久化任务契约，记录原始要求、后续补充、交付物、硬约束、证据要求、输出格式、验收标准和禁止偷懒项；自动改进和审查模型必须按契约验收，降低模型执行打折和随意精简。 |
| Document Plan | 文档任务会提取标题、受众、语气、篇幅、章节、表格、图表、引用、交付格式和增强表达要求；输入框和右侧信息面板会显示启用状态；图表、HTML 内嵌块和流程图必须来自已验证数据或明确输入，不能编造。 |
| 文档专家报告 | 文档型 Goal 审查会显示结构、证据、数字、规范、风险和总分，并为正式输出生成 `_reviews/*.review.md` 伴随审稿报告，帮助用户判断“文档好不好”，不只判断“文件在不在”。 |
| Project Memory Lite | 零配置项目记忆，不依赖 gbrain、数据库或外部向量服务；为每个有效工作目录预置 `.agent-pi/brain`，沉淀来源、过程分析、正式成果、项目决策、关键事实、引用链和正式成果审稿索引。 |
| 项目隔离 | 会话开始后锁定工作目录，防止同一对话切换项目导致记忆污染；项目记忆和正式输出按物理工作目录隔离。 |
| 会话导航 | 会话按工作文件夹分组显示，主会话更容易定位；分支智能体和派生会话折叠在主会话下，适合多智能体并行研究。V1.1.3 修复展开文件夹后自动跳到顶部的问题，并按工作目录最新活动时间保持稳定排序。 |
| 会话资产保护 | 修复重启后 UI 丢失最近对话的问题；会话文件仍在磁盘时，列表会正确读取大 header 并显示最近会话。 |
| 右侧信息面板 | 信息面板展示标题、进度、模型、工作目录、正式输出目录、会话文件、附件、数据文件和来源，避免只靠聊天记录寻找上下文；V1.1.3 增加质量路由、上下文压力和项目记忆状态提示。 |
| 正式输出目录 | 支持在工作目录内创建 `Agent Pi Outputs`，把过程文件提升为正式成果，并用“正式/附件/数据”等来源标签区分文件性质。 |
| 文件预览与编辑 | Markdown、文本、代码、JSON、PDF、Office 和 Excel 文件优先在应用内有界预览；Markdown 文件支持渲染态编辑、保存、下载，以及导出 PDF/DOCX。 |
| 提示词优化 | 一键优化会调用当前会话或工作区默认模型连接理解用户任务，失败时才使用保守本地模板；优化目标从固定行业流程放宽为“让智能体更完整理解用户意图并可靠执行”。 |
| 大文件稳定性 | 大型 Excel/Office 附件改为路径托管和服务端有界预览，降低 renderer 内存占用，减少上传/预览导致的卡死。 |
| 模型切换 | 空闲会话允许受控切换模型/连接；切换时保留最近上下文摘要，便于从文本模型切到视觉模型或其它已配置模型。 |
| 运行清理 | 退出应用时等待会话 runtime、Pi/Claude 子进程、MCP pool、watcher 和 messaging worker 清理，减少退出后驻留进程。 |
| Windows 打包 | Windows 构建脚本补齐 Bun、Claude SDK native binary、ripgrep 的校验和复制逻辑，降低缺资源导致的安装/运行风险；V1.1.3 安装包集成 Git for Windows 2.55.0，并按本机版本静默安装、升级或跳过。 |

## 当前定位

Agent π 适合这些场景：

- 对投标文件、BOQ、Excel 清单、技术规范和过程资料做长周期分析。
- 一个主任务下派生多个子智能体并行研究，但仍需要回到主窗口汇总。
- 要求正式成果保存在项目工作目录，而不是只落在应用缓存目录。
- 需要在 DeepSeek、Qwen、Mimo、Claude 兼容接口等已配置模型之间按任务能力切换。
- 需要对智能体生成和读取过的文件做来源识别、预览和归档。

## 能力增强路线

V1.1.3 先完成 MoA 启发的质量评审、自我纠偏和本地质量经验沉淀底座，后续会继续探索更强的任务路由、评审模型组合、计划/草稿聚合和端侧/私有化弱模型能力增强。

V1.1.2 已完成任务契约和 Document Plan 底座，后续文档路线会从“会写内容”继续升级为“会生产正式文件”。详细计划见 [Professional Document Workbench Roadmap](docs/PROFESSIONAL_DOCUMENT_WORKBENCH.md)。

- Word 报告引擎：支持 `.docx` 模板参考、原生标题样式、目录、页眉页脚、编号、表格、图片和图表嵌入。
- PPT 工作台：以 slide spec 管理每页结构，支持参考模板、结论页、对比页、流程图、图表页和 PDF 导出。
- Excel 结构化输出：生成 workbook 规格，包含 sheet、表头、公式、格式和图表，而不是仅输出文本表格。
- 图表规格化：先生成 `chart.json` 等结构化规格，再渲染 SVG/PNG/HTML 可视块并嵌入正式成果。
- 交付物审查：Goal Loop 将继续扩展到版式、章节完整性、图表数量、引用、表格可读性、页边距和导出文件可打开性。

## 开发

安装依赖：

```bash
bun install
```

运行发布前检查：

```bash
bun run typecheck:all
bun run lint
```

生成 Windows 安装包：

```powershell
cd apps/electron
powershell -ExecutionPolicy Bypass -File scripts\build-win.ps1
```

产物位置：

```text
apps/electron/release/Agent-Pi-x64.exe
```

## 许可证

Apache-2.0. See [LICENSE](LICENSE).

## 版权与联系

<p align="center">
  <img src="AIPI-logo.png" alt="Always π AI Studio" width="360" />
</p>

© 2026 Always π AI Studio. Agent π is released under the Apache-2.0 license.

作者/维护者联系：567601@qq.com
