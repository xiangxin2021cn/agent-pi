# Agent π

<p align="center">
  <img src="docs/assets/agent-pi-logo.png" alt="AIPI Always π AI Studio" width="620" />
</p>

**Agent π 1.1.1 已正式发布。** 这是基于 Craft Agents OSS 深度改造的 Windows 桌面智能体工作台，面向长周期项目分析、招投标文件处理、工程资料研究、多模型协同和可追溯成果沉淀。

Agent π 的目标不是做一个普通聊天壳，而是把智能体升级为真实项目作业里的 **超级工作台**：主会话按工作目录组织，分支智能体折叠到主会话下，正式成果落回项目工作目录，过程文件可在应用内预览、编辑、导出，长任务由 Goal Loop 做自我审查和纠偏。

## Agent π 1.1.1 发布

[下载 Agent π 1.1.1 Windows 安装包](https://github.com/xiangxin2021cn/agent-pi/releases/latest)

V1.1.1 是 V1.1 系列的补丁版，重点修复原生文件/目录选择的 30 秒请求超时问题。上传附件、选择文件夹、选择工作目录现在会一直等待用户选择或取消；普通后台 RPC 仍保留超时保护，避免真正卡死的请求无限挂起。

V1.1 系列的完整能力包括 Goal Loop、Project Memory Lite、文档预览编辑、正式输出管理和工作目录隔离，详见下方版本更新与主要优化。

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
