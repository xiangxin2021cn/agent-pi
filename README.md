# Agent π

<p align="center">
  <img src="docs/assets/agent-pi-logo.png" alt="AIPI Always π AI Studio" width="620" />
</p>

**Agent π 1.0 已正式发布。** 这是基于 Craft Agents OSS 深度改造的 Windows 桌面智能体工作台，面向长周期项目分析、招投标文件处理、工程资料研究、多模型协同和可追溯成果沉淀。

Agent π 的目标不是做一个普通聊天壳，而是把智能体升级为真实项目作业里的 **超级工作台**：主会话按工作目录组织，分支智能体折叠到主会话下，正式成果落回项目工作目录，过程文件可在应用内预览、编辑、导出，长任务由 Goal Loop 做自我审查和纠偏。

## Agent π 1.0 发布

[下载 Agent π 1.0 Windows 安装包](https://github.com/xiangxin2021cn/agent-pi/releases/latest)

V1.0 是本项目的重大分水岭：从 Craft Agents OSS 的通用智能体外壳，升级为面向长文档、强证据、可审查成果输出的智能体工作台。

核心变化：

- **Goal Loop / 目标自我纠偏**：围绕用户目标、输出文件、指定格式、工作目录、附件来源、文件预览、文档质量和验证证据做阶段性审查，减少长任务“口头完成”、遗漏和跑偏。
- **主输入框 Goal 开关**：在“探索 / 询问 / 执行”同一菜单中加入“目标：自动改进 / 只检查 / 关闭”，用户可在发送任务前决定是否启用长任务审查。
- **文档预览、编辑、导出**：Markdown 可保持渲染状态直接编辑，支持表格内容保真；Markdown 预览可导出 PDF/DOCX，PDF、Office、Excel、代码和文本文件可在应用内预览。
- **项目工作目录成果沉淀**：正式输出目录、文件来源标识、过程资料提升为正式成果，让智能体产物回到真实项目资料体系。
- **项目物理隔离**：会话开始后锁定工作目录，Project Memory Lite 固定写入该目录下 `.agent-pi/brain`，不同项目默认不共享记忆，避免跨工作目录污染。
- **核心运行时升级**：集成 Claude Agent SDK `0.3.195` 与 Pi `0.80.2`，并强化 Windows 打包中 Bun、Claude native binary、ripgrep 和 helper servers 的随包能力。
- **面向专业长文写作**：重点服务招投标、合同审查、施工方案、BOQ/Excel 分析、技术报告、研究资料整理等高确定性工作场景。

## 用户手册

第一次使用或准备在真实项目中落地前，建议先阅读 [Agent π 用户操作手册](docs/USER_MANUAL.md)。手册覆盖 Windows 安装、Workspace、工作目录、会话折叠、模型切换、文件预览、正式输出、数据源、技能、自动化和常见问题处理。

## 下载

Windows x64 安装包从 GitHub Releases 发布：

[下载最新版 Agent-Pi-x64.exe](https://github.com/xiangxin2021cn/agent-pi/releases/latest)

自动更新使用同一 Release 通道，Windows 发布资产包含：

- `Agent-Pi-x64.exe`
- `Agent-Pi-x64.exe.blockmap`
- `latest.yml`

## 为什么是 V1.0

**Agent π V1.0** 标志着本项目从 Craft Agents OSS 的通用智能体外壳，正式迈向长任务文档工作台。核心升级是 **Goal Loop / 目标自我纠偏机制**：智能体不再只按最后一句回复判断任务是否结束，而会围绕用户目标、输出文件、指定格式、工作目录、附件来源、文件预览和验证证据做阶段性审查，降低长文档任务中常见的遗漏、跑偏、空泛总结和“口头完成”问题。

这次升级尤其面向招投标、合同、施工方案、研究报告、BOQ/Excel 分析等高确定性写作场景。系统会更重视“是否真的产出文件”“文件是否在目标输出目录”“PDF/DOCX/Markdown/Excel 等格式是否匹配”“关键来源是否可追溯”“输出内容是否足够实质”。它不是把模型变成不可控的自动驾驶，而是给长任务加上可观察、可检查、可回退的质量护栏。

同时，V1.0 完成了文档工作台能力的关键补齐：Markdown 文件可在预览窗口中保持渲染状态直接编辑并保存，PDF/DOCX 可从 Markdown 预览导出，PDF、Office、Excel、Markdown 等常见过程文件可以在应用内预览。这些能力共同把 Agent π 推向一个更接近“超级工作台”的方向：智能体负责执行和协作，用户能随时查看、修订、导出和审查成果。

后续 V1.1-V1.4 的开发方向不再拆成多个零散小版本，而是收敛为一个 **文档工作台质量与项目隔离包**：Goal Loop 深度审稿、正式输出优先预览、Markdown 渲染态编辑、PDF/DOCX 导出、工作目录强绑定和 Project Memory Lite 物理隔离会作为同一组能力迭代。

## 主要优化

| 模块 | 优化内容 |
| --- | --- |
| Goal Loop | 新增目标自我纠偏与证据审查机制，对长任务输出进行持续检查，避免遗漏指定文件、指定格式、正式输出目录、关键来源和明显低质量文档。 |
| 文档专家报告 | 文档型 Goal 审查会显示结构、证据、数字、规范、风险和总分，并为正式输出生成 `_reviews/*.review.md` 伴随审稿报告，帮助用户判断“文档好不好”，不只判断“文件在不在”。 |
| Project Memory Lite | 为每个有效工作目录预置 `.agent-pi/brain` 轻量项目记忆骨架，沉淀来源、过程分析、正式成果、项目决策、关键事实、引用链和正式成果审稿索引。 |
| 项目隔离 | 会话开始后锁定工作目录，防止同一对话切换项目导致记忆污染；项目记忆和正式输出按物理工作目录隔离。 |
| 会话导航 | 会话按工作文件夹分组显示，主会话更容易定位；分支智能体和派生会话折叠在主会话下，适合多智能体并行研究。 |
| 右侧信息面板 | 信息面板展示标题、进度、模型、工作目录、正式输出目录、会话文件、附件、数据文件和来源，避免只靠聊天记录寻找上下文。 |
| 正式输出目录 | 支持在工作目录内创建 `Agent Pi Outputs`，把过程文件提升为正式成果，并用“正式/附件/数据”等来源标签区分文件性质。 |
| 文件预览与编辑 | Markdown、文本、代码、JSON、PDF、Office 和 Excel 文件优先在应用内有界预览；Markdown 文件支持渲染态编辑、保存、下载，以及导出 PDF/DOCX。 |
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
