# Agent π

<p align="center">
  <img src="docs/assets/agent-pi-logo.png" alt="AIPI Always π AI Studio" width="620" />
</p>

**Agent π 1.1.1 已正式发布。** 这是基于 Craft Agents OSS 深度改造的 Windows 桌面智能体工作台，面向长周期项目分析、招投标文件处理、工程资料研究、多模型协同和可追溯成果沉淀。

Agent π 的目标不是做一个普通聊天壳，而是把智能体升级为真实项目作业里的 **超级工作台**：主会话按工作目录组织，分支智能体折叠到主会话下，正式成果落回项目工作目录，过程文件可在应用内预览、编辑、导出，长任务由 Goal Loop 做自我审查和纠偏。

## Agent π 1.1.1 发布

[下载 Agent π 1.1.1 Windows 安装包](https://github.com/xiangxin2021cn/agent-pi/releases/latest)

V1.1.1 是 Agent π 进入 1.0 时代后的质量修复与增强版本：继续强化长文档任务的 Goal Loop 自我纠偏，同时把项目记忆路线收敛为零配置的 **Project Memory Lite**，不要求用户配置数据库、向量库、外部 API Key 或 gbrain 服务。

核心变化：

- **Goal Loop / 目标自我纠偏增强**：围绕用户目标、输出文件、指定格式、工作目录、附件来源、文件预览、文档质量和验证证据做阶段性审查，减少长任务“口头完成”、遗漏和跑偏。
- **主输入框 Goal 开关**：在“探索 / 询问 / 执行”同一菜单中加入“目标：自动改进 / 只检查 / 关闭”，用户可在发送任务前决定是否启用长任务审查。
- **提示词优化修复**：一键优化提示词会优先调用当前会话/工作区配置的模型连接，不再在新会话首轮因为没有锁定连接而直接退回本地模板；本地兜底也不会重复包裹已经优化过的提示词。
- **文档预览、编辑、导出**：Markdown 可保持渲染状态直接编辑，支持表格内容保真；Markdown 预览可导出 PDF/DOCX，PDF、Office、Excel、代码和文本文件可在应用内预览。
- **项目工作目录成果沉淀**：正式输出目录、文件来源标识、过程资料提升为正式成果，让智能体产物回到真实项目资料体系。
- **项目物理隔离与轻量记忆**：会话开始后锁定工作目录，Project Memory Lite 固定写入该目录下 `.agent-pi/brain`，不同项目默认不共享记忆，避免跨工作目录污染。
- **右侧面板修复**：正式输出文件优先展示并保持可预览，不再被 Goal Loop 阶段信息挤占。
- **文件/目录选择超时修复**：上传附件、选择文件夹、选择工作目录会一直等待用户选择或取消，不再因为 30 秒 RPC 超时失效。
- **核心运行时升级**：集成 Claude Agent SDK `0.3.195` 与 Pi `0.80.2`，并强化 Windows 打包中 Bun、Claude native binary、ripgrep 和 helper servers 的随包能力。
- **面向专业长文写作**：重点服务招投标、合同审查、施工方案、BOQ/Excel 分析、技术报告、研究资料整理等高确定性工作场景。

## 版本更新

| 版本 | 重点更新 | 发布页 |
| --- | --- | --- |
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

## 为什么是 V1.1

**Agent π V1.0** 标志着本项目从 Craft Agents OSS 的通用智能体外壳，迈向长任务文档工作台。**Agent π V1.1** 则把这条路线继续落到稳定性和开箱即用上：Goal Loop 不只是检查文件是否存在，还会更重视正式输出、预览可用性、来源证据、文档结构和内容质量。

V1.1 同时明确放弃把 gbrain 作为默认发布路径，改为内置零配置的 **Project Memory Lite**。项目记忆只写入当前工作目录下 `.agent-pi/brain`，不同工作目录物理隔离；公司或行业知识仍然必须由用户显式启用，避免跨项目记忆污染。

这次还修复了提示词优化的关键问题：新会话首轮优化现在会解析工作区默认模型连接，尽量调用当前配置的 LLM 来理解用户任务；只有模型不可用时才回退到本地保守模板。这样一键优化不再写死投标流程，而是围绕用户输入的真实任务提升可执行性。

V1.1 继续补强文档工作台能力：Markdown 文件可在预览窗口中保持渲染状态直接编辑并保存，PDF/DOCX 可从 Markdown 预览导出，PDF、Office、Excel、Markdown 等常见过程文件可以在应用内预览。目标是让智能体负责执行和协作，用户随时能查看、修订、导出和审查成果。

## 主要优化

| 模块 | 优化内容 |
| --- | --- |
| Goal Loop | 新增目标自我纠偏与证据审查机制，对长任务输出进行持续检查，避免遗漏指定文件、指定格式、正式输出目录、关键来源和明显低质量文档。 |
| 文档专家报告 | 文档型 Goal 审查会显示结构、证据、数字、规范、风险和总分，并为正式输出生成 `_reviews/*.review.md` 伴随审稿报告，帮助用户判断“文档好不好”，不只判断“文件在不在”。 |
| Project Memory Lite | 零配置项目记忆，不依赖 gbrain、数据库或外部向量服务；为每个有效工作目录预置 `.agent-pi/brain`，沉淀来源、过程分析、正式成果、项目决策、关键事实、引用链和正式成果审稿索引。 |
| 项目隔离 | 会话开始后锁定工作目录，防止同一对话切换项目导致记忆污染；项目记忆和正式输出按物理工作目录隔离。 |
| 会话导航 | 会话按工作文件夹分组显示，主会话更容易定位；分支智能体和派生会话折叠在主会话下，适合多智能体并行研究。 |
| 右侧信息面板 | 信息面板展示标题、进度、模型、工作目录、正式输出目录、会话文件、附件、数据文件和来源，避免只靠聊天记录寻找上下文。 |
| 正式输出目录 | 支持在工作目录内创建 `Agent Pi Outputs`，把过程文件提升为正式成果，并用“正式/附件/数据”等来源标签区分文件性质。 |
| 文件预览与编辑 | Markdown、文本、代码、JSON、PDF、Office 和 Excel 文件优先在应用内有界预览；Markdown 文件支持渲染态编辑、保存、下载，以及导出 PDF/DOCX。 |
| 提示词优化 | 一键优化会调用当前会话或工作区默认模型连接理解用户任务，失败时才使用保守本地模板；优化目标从固定行业流程放宽为“让智能体更完整理解用户意图并可靠执行”。 |
| 大文件稳定性 | 大型 Excel/Office 附件改为路径托管和服务端有界预览，降低 renderer 内存占用，减少上传/预览导致的卡死。 |
| 模型切换 | 空闲会话允许受控切换模型/连接；切换时保留最近上下文摘要，便于从文本模型切到视觉模型或其它已配置模型。 |
| 运行清理 | 退出应用时等待会话 runtime、Pi/Claude 子进程、MCP pool、watcher 和 messaging worker 清理，减少退出后驻留进程。 |
| Windows 打包 | Windows 构建脚本补齐 Bun、Claude SDK native binary、ripgrep 的校验和复制逻辑，降低缺资源导致的安装/运行风险。 |

## 当前定位

Agent π 适合这些场景：

- 对投标文件、BOQ、Excel 清单、技术规范和过程资料做长周期分析。
- 一个主任务下派生多个子智能体并行研究，但仍需要回到主窗口汇总。
- 要求正式成果保存在项目工作目录，而不是只落在应用缓存目录。
- 需要在 DeepSeek、Qwen、Mimo、Claude 兼容接口等已配置模型之间按任务能力切换。
- 需要对智能体生成和读取过的文件做来源识别、预览和归档。

## 品牌

本项目使用 **AIPI / Always π AI Studio** 工作室标识。`AIPI-logo.png` 是当前品牌源图，应用左下角品牌面板和 GitHub 首页展示图均由该图同步生成。

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
