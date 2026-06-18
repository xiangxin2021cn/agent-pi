# Agentic Orchestrator 路线图

适用分支：`codex/agentic-orchestrator-roadmap`  
目标版本方向：v0.11+ 实验性能力，当前 v0.10.6 发版保持稳定。  
最后更新：2026-06-18。

## 1. 结论

把左侧 **自动化 -> 智能体** 发展为 Agent π 的“运行过程指挥中枢”是可行的，也适合作为本项目区别于普通聊天壳、普通代码助手和普通自动化工具的长期护城河。

但实现路径不应该直接做成一个不可见的“超级大脑”。更稳妥的产品路线是：

1. 先补齐 Agent 运行事件的真实执行链，让 `PreToolUse`、`PostToolUseFailure`、`SubagentStop` 等事件能可靠触发 prompt/webhook。
2. 再围绕过程文件、正式输出和会话状态建立可追踪的 artifact/review 机制。
3. 最后把专家智能体团组织成可配置、可审计、可关闭的 Orchestrator，而不是让它无边界干预主会话。

也就是说，它应该先成为 **可观察、可审查、可配置的工作流协调层**，再逐步进化为“专家团大脑”。

## 2. 为什么这个方向适合 Agent π

Agent π 当前已经有几块适合做 Orchestrator 的底座：

- Workspace、工作目录、会话、分支会话已经能组织长期项目。
- 右侧信息面板已经能展示工作目录、会话目录、正式输出和过程文件。
- 正式输出目录 `Agent Pi Outputs` 已经把最终成果从缓存目录拉回项目工作目录。
- 自动化系统已有 `automations.json`、cron、App events、prompt action、webhook action、历史记录和测试入口。
- 技能系统已有全局、Workspace、项目三级技能，可作为专家团的能力来源。
- Agent events 已经在类型层和 UI 层预留，包括工具调用、权限请求、子智能体、上下文压缩等关键节点。

这些能力对“文档型工作台”尤其重要。代码处理不是本项目最强项，Agent π 更应该把优势放在：

- 长文档处理。
- 多文件证据链。
- 大型 Office/Excel/PDF 资料研究。
- 过程材料沉淀。
- 正式成果审查。
- 多模型、多专家、多轮质检。
- 面向业务垂直流程的工作包。

注意：这里的业务垂直不应局限于标书和工程文件。标书、工程、合同、法律、财务、研究报告、产品需求、审计、知识库整理、培训材料、医学/药政/标准文件等，都属于“文档密集型 Work 场景”。

## 3. 当前源码基线

当前左侧“智能体”菜单本质上是 Agentic Automations 的筛选视图。

### 3.1 UI 已经支持分类

自动化在 UI 中被分为：

- `scheduled`：定时任务。
- `event`：应用事件触发。
- `agentic`：智能体运行事件。

相关文件：

- `apps/electron/src/renderer/components/app-shell/AppShell.tsx`
- `apps/electron/src/renderer/components/automations/AutomationsListPanel.tsx`
- `apps/electron/src/renderer/components/automations/types.ts`

`agentic` 会映射到 `AutomationFilterKind = "agent"`，然后筛选 `AGENT_EVENTS`。

### 3.2 Agent events 已定义

当前已有事件：

- `PreToolUse`
- `PostToolUse`
- `PostToolUseFailure`
- `Notification`
- `UserPromptSubmit`
- `SessionStart`
- `SessionEnd`
- `Stop`
- `SubagentStart`
- `SubagentStop`
- `PreCompact`
- `PermissionRequest`
- `Setup`

这些事件覆盖了“指挥中枢”最需要观察的运行节点。

### 3.3 App events 已能真实执行

当前可稳定执行的是 App events，例如：

- `SchedulerTick`
- `LabelAdd`
- `LabelRemove`
- `PermissionModeChange`
- `FlagChange`
- `SessionStatusChange`

这些事件可以触发：

- `prompt` action：创建新会话并发送提示。
- `webhook` action：调用外部 HTTP 服务。

核心执行路径：

- `packages/shared/src/automations/handlers/prompt-handler.ts`
- `packages/shared/src/automations/handlers/webhook-handler.ts`
- `packages/server-core/src/sessions/SessionManager.ts#executePromptAutomation`

### 3.4 Agent events 目前没有完整执行链

当前缺口非常明确：

- `PromptHandler` 只处理 App events。
- `WebhookHandler` 只处理 App events。
- `AutomationSystem.executeAgentEvent()` 对 Agent events 只做匹配和诊断，实际执行是 no-op。
- `AutomationSystem.buildSdkHooks()` 目前返回 `{}`。

这说明“智能体”分类是未来接口，不是成熟功能。它适合作为下一阶段开发方向，但不能在当前发版中宣传为稳定能力。

## 4. 产品定位

建议把这个方向命名为：

**Agentic Orchestrator**  
中文可称：**智能体指挥中枢** 或 **专家审查中枢**。

它不是另一个普通聊天智能体，而是一个运行在主会话旁边的协调层：

- 观察主会话和子会话的运行过程。
- 识别关键节点、风险、失败、遗漏和成果文件。
- 调度专家智能体进行审查。
- 将审查建议以可控方式反馈给主会话。
- 将过程文件分类、评分、提升为正式成果或要求返工。
- 为用户提供“项目级工作质量看板”。

一句话定位：

> Agent π 不只是让模型回答问题，而是让一个专家团队持续监督、审查和改进工作过程。

## 5. 设计原则

### 5.1 不破坏当前发版

当前 v0.10.6 保持稳定。所有 Orchestrator 能力必须：

- 在独立分支开发。
- 默认关闭。
- 通过 Workspace 设置或实验开关启用。
- 不改变现有会话、文件预览、正式输出和模型切换的默认行为。

### 5.2 可观察，不黑箱

Orchestrator 的每一次建议、拦截、自动审查、自动创建会话，都必须能在 UI 中看见：

- 为什么触发。
- 使用了哪个专家角色。
- 读取了哪些文件。
- 输出了什么建议。
- 是否影响主会话。
- 是否产生费用或额外模型调用。

### 5.3 先审查，再干预

早期版本不应该自动改写主会话行为。建议分四级：

- `off`：关闭。
- `observe`：只记录事件和产物。
- `advise`：生成建议卡片，由用户决定是否采纳。
- `gate`：关键节点必须通过审查后继续。
- `auto`：成熟后才允许自动创建修复会话或反馈主会话。

### 5.4 专家团是可配置能力，不是硬编码角色

专家角色应来自：

- 内置专家模板。
- Workspace 专家包。
- 项目级 `.agents/skills`。
- 用户自定义模型/连接。
- 外部 MCP/API 数据源。

这可以避免产品被某一个行业锁死。

### 5.5 证据优先

每个专家建议必须绑定证据：

- 关联的会话。
- 关联的工具调用。
- 关联的文件路径。
- 关联的输出片段。
- 关联的原始资料。

没有证据链的建议只能作为弱建议，不能作为 gate 阻断主流程。

## 6. 专家智能体团设计

第一批专家建议设计为通用 Work 专家，而不是行业专家。

| 专家 | 触发点 | 职责 |
| --- | --- | --- |
| 过程总监 | `SessionStart`、`UserPromptSubmit`、计划生成后 | 判断任务目标、拆分策略、是否需要子智能体。 |
| 证据审计员 | 文件读取后、正式输出前 | 检查结论是否有来源、引用是否对应文件。 |
| 文件管家 | `PostToolUse`、文件创建/变更后 | 识别过程文件、数据文件、正式成果候选。 |
| 成果审稿人 | `SubagentStop`、`SessionEnd`、正式输出创建后 | 审查报告结构、完整性、可读性和交付质量。 |
| 风险控制员 | `PermissionRequest`、执行模式切换、危险工具前 | 判断权限风险、路径风险、批量写入风险。 |
| 故障诊断员 | `PostToolUseFailure`、超时、模型错误 | 分析失败原因，提出恢复方案。 |
| 领域专家 | 用户选择或项目包配置 | 针对法律、工程、财务、合同、研究等领域审查。 |
| 汇总编辑 | 多子智能体完成后 | 合并子结论，消除冲突，形成主会话可用摘要。 |

后续可以按行业增加专家包：

- 合同与法务包。
- 招投标与工程包。
- 财务审计包。
- 研究报告包。
- 产品需求/PRD 包。
- 企业知识库整理包。
- 标准规范审查包。
- 医药注册/标准文件包。

## 7. 目标体验

### 7.1 用户体验示例：过程审查

用户让主会话分析一批合同文件。主会话生成中间报告后：

1. 文件管家发现 `draft_report.md` 是成果候选。
2. 成果审稿人自动创建一个折叠的审查子会话。
3. 审查子会话读取 `draft_report.md` 和关联证据文件。
4. 它生成一张“审查卡片”：
   - 缺少付款条款风险。
   - 引用了不存在的附件。
   - 建议补充交付验收章节。
5. 主会话收到一条可采纳建议：
   - “是否把审查建议注入下一轮？”
   - “是否创建修订任务？”
   - “是否仍提升为正式成果？”

### 7.2 用户体验示例：工具失败自修复

Excel 解析失败后：

1. `PostToolUseFailure` 触发故障诊断员。
2. 诊断员分析失败工具、文件路径、错误信息和文件大小。
3. 给出恢复策略：
   - 改用只读路径。
   - 关闭占用文件。
   - 转 CSV。
   - 分 sheet 提取。
4. 用户可一键让主会话按建议重试。

### 7.3 用户体验示例：子智能体汇总

主会话启动 5 个子智能体分别读不同文件。每个子智能体结束后：

1. `SubagentStop` 触发汇总编辑。
2. 汇总编辑生成结构化摘要。
3. 所有摘要进入主会话的“专家建议/子结论”面板。
4. 主会话最终汇总时自动引用这些摘要，而不需要用户从聊天记录中寻找。

## 8. 分阶段开发路线

### Phase 0：路线图分支和当前发版保护

目标：建立长期方向，不影响当前发布。

任务：

- 创建独立分支：`codex/agentic-orchestrator-roadmap`。
- 新增本路线图文档。
- 不修改 package version。
- 不生成新安装包。
- 不改变 `main` 当前发布通道。

验收：

- `main` 仍保留 v0.10.6 发布状态。
- 路线图只在分支中存在。

### Phase 1：补齐 Agent events 执行链

目标：让“自动化 -> 智能体”从展示分类变成可执行能力。

核心改造：

- 将 `PromptHandler` 扩展为可处理 Agent events。
- 将 `WebhookHandler` 扩展为可处理 Agent events。
- 保留 App events 现有行为不变。
- 在 `executeAgentEvent()` 中复用统一 action 执行路径。
- 给 Agent event action 加 loop guard，防止无限触发。
- 给 prompt action 创建的会话打上 `triggeredBy`、`parentSessionId`、`eventName`、`orchestratorRole`。
- 在 UI 上把“智能体”改名为“智能体事件”或加实验标识。

关键文件：

- `packages/shared/src/automations/automation-system.ts`
- `packages/shared/src/automations/handlers/prompt-handler.ts`
- `packages/shared/src/automations/handlers/webhook-handler.ts`
- `packages/shared/src/automations/types.ts`
- `packages/shared/src/automations/schemas.ts`
- `packages/shared/src/agent/pi-agent.ts`
- `packages/shared/src/agent/claude-agent.ts`
- `packages/server-core/src/sessions/SessionManager.ts`
- `apps/electron/src/renderer/components/automations/*`

必须加入的保护：

- 每个 session 每分钟 Agent event prompt action 上限。
- 自动创建的会话默认不能再次触发同类自动化。
- `UserPromptSubmit` 默认不允许创建新会话，除非显式启用。
- `PreToolUse` 默认只能 webhook/observe，不能阻塞主工具调用。
- 所有自动创建会话默认 `permissionMode = safe`。

验收测试：

- `PreToolUse` 匹配后可写入 history。
- `PostToolUseFailure` 可触发 webhook。
- `SubagentStop` 可触发 prompt 并创建审查会话。
- loop guard 能阻止自动化互相触发。
- 禁用开关能完全关闭 Agent event 自动化执行。

### Phase 2：Artifact 事件和文件审查管线

目标：把“过程生成文件”纳入 Orchestrator 观察对象。

新增事件建议：

- `ArtifactCreated`
- `ArtifactChanged`
- `ArtifactPromoted`
- `FormalOutputCreated`
- `FormalOutputPreviewFailed`
- `AttachmentStored`
- `DataExtracted`

文件元数据：

- 路径。
- 来源类型：附件、数据、下载、长响应、正式输出。
- 生成会话。
- 生成工具。
- 文件大小。
- MIME/扩展名。
- 是否可预览。
- 是否已被审查。
- 审查状态：未审、通过、需修改、风险。

UI 改造：

- 右侧信息面板增加“审查状态”。
- 文件右键增加“请求专家审查”。
- `Official Outputs` 文件显示审查标记。
- 增加“审查队列”或“专家建议”面板。

验收：

- 生成文件后能被索引。
- 正式输出创建后自动进入可审查状态。
- 用户能手动请求审查。
- 审查结果能回链到文件。

### Phase 3：专家角色注册表

目标：把专家智能体团产品化。

新增配置建议：

```json
{
  "version": 1,
  "enabled": true,
  "mode": "advise",
  "experts": [
    {
      "id": "evidence-auditor",
      "name": "证据审计员",
      "skill": "evidence-audit",
      "model": "deepseek-v4-pro",
      "events": ["FormalOutputCreated", "SubagentStop"]
    }
  ]
}
```

可选配置位置：

- Workspace：`orchestrator.json`
- 项目：`.agent-pi/orchestrator.json`
- 也可以先作为 `automations.json` 的增强字段实现，后续再拆出独立配置。

建议不要一开始就完全拆出新系统。短期用自动化系统扩展最快；中期再抽象 `orchestrator.json`。

专家能力来源：

- 内置 prompt 模板。
- 现有技能。
- 项目技能。
- 领域包。
- 数据源。

验收：

- 用户可以启用/禁用专家。
- 每个专家可指定模型、思考级别、权限模式。
- 专家审查会话能折叠在主会话下。
- 专家建议可被采纳、忽略、转为待办。

### Phase 4：指挥中枢面板

目标：让 Orchestrator 从后台事件变成可理解的工作台。

新增 UI：

- 当前任务阶段。
- 活跃专家。
- 最近触发事件。
- 待审查文件。
- 专家建议。
- 风险提醒。
- 自动创建的审查会话。
- 可采纳操作。

建议位置：

- 右侧信息面板增加 `Orchestrator` Tab。
- 或在当前信息面板中增加“专家建议”区块。

交互设计：

- 建议卡片：
  - 采纳到下一轮。
  - 创建修订任务。
  - 标记已处理。
  - 忽略。
  - 打开审查会话。
- 文件卡片：
  - 请求审查。
  - 提升为正式成果。
  - 降级为过程资料。
  - 标记需修改。

验收：

- 用户不需要翻聊天记录就能看到专家团状态。
- 专家建议不会混入主聊天造成干扰。
- 任何自动动作都有来源和原因。

### Phase 5：多专家协同协议

目标：让专家团不是一堆孤立自动化，而是一个可协同的团队。

新增概念：

- Review Run：一次审查运行。
- Review Finding：一个具体问题。
- Review Decision：用户采纳/忽略/延后。
- Advice Injection：把建议注入主会话的方式。
- Quality Gate：质量门禁。

建议数据结构：

```json
{
  "reviewId": "review-...",
  "sessionId": "260618-main",
  "artifactPath": "Agent Pi Outputs/.../report.md",
  "experts": ["evidence-auditor", "deliverable-reviewer"],
  "findings": [
    {
      "severity": "high",
      "title": "结论缺少来源",
      "evidence": ["source.pdf#page=12", "report.md#section=3"],
      "recommendation": "补充来源引用或降低结论强度"
    }
  ],
  "decision": "pending"
}
```

质量门禁模式：

- `advisory`：只提示。
- `soft-gate`：提示风险，但用户可继续。
- `hard-gate`：正式输出必须通过审查。

验收：

- 多专家审查结果可合并。
- 冲突建议可被标记。
- 主会话能读取审查摘要继续改进。
- 用户能追溯每条建议的来源。

### Phase 6：垂直 Work Packs

目标：形成应用领域护城河。

Work Pack 应包含：

- 专家角色模板。
- 技能集合。
- 自动化规则。
- 输出模板。
- 审查清单。
- 数据源/MCP 依赖。
- 示例提示词。
- 安装和验证脚本。

第一批通用包：

| Work Pack | 目标用户 | 典型任务 |
| --- | --- | --- |
| Document Research | 通用办公/研究 | 多文档阅读、摘要、证据链、报告草稿。 |
| Contract Review | 法务/商务 | 合同条款审查、风险清单、修订建议。 |
| Tender & Engineering | 工程/投标 | 招标文件、BOQ、技术规范、施工策划。 |
| Financial Review | 财务/审计 | 报表解释、异常检查、财务说明。 |
| Policy & Standards | 合规/标准 | 政策、规范、标准条文审查。 |
| Product Docs | 产品/研发管理 | PRD、需求评审、版本说明、测试计划。 |
| Knowledge Base | 企业知识库 | 资料整理、标签、归档、问答库生成。 |

不要把产品定位锁死在工程/标书上。工程标书可以作为强样板，但底层能力应服务所有文档密集型 Work 场景。

验收：

- 用户能安装一个 Work Pack。
- 安装后自动出现对应技能、专家和自动化。
- 新建会话时能选择该工作包。
- 生成成果时自动套用对应审查流程。

### Phase 7：一句话安装服务

目标：把“会配置”变成“会安装、会验证、会修复”。

一句话安装不应只是下载文件，而应该包含：

1. 检查系统环境。
2. 安装或定位依赖。
3. 写入配置。
4. 验证服务可用。
5. 失败时生成修复建议。
6. 把安装结果沉淀为 Workspace 资源。

服务类型：

- MCP 服务。
- 本地解析器。
- 文档转换服务。
- OCR/视觉模型适配。
- 企业 API 数据源。
- Work Pack。
- 浏览器自动化服务。

建议实现：

- `Service Catalog`：服务目录。
- `Install Recipe`：安装配方。
- `Health Check`：健康检查。
- `Repair Prompt`：失败修复提示。
- `Install Session`：安装过程独立会话。

安装示例：

```text
安装合同审查工作包，并配置 PDF/Word 预览、证据审计员和正式输出审查流程。
```

Orchestrator 执行：

- 创建安装会话。
- 读取服务目录。
- 检查依赖。
- 写入技能/自动化/专家配置。
- 运行健康检查。
- 输出安装报告。

安全要求：

- 默认不执行未知脚本。
- 所有安装命令需要展示和审批。
- 外部 URL 必须可见。
- 机密配置必须进入安全凭证存储，不写入明文文档。

### Phase 8：企业级审计和团队协同

目标：为长期团队使用做准备。

能力：

- 审查历史归档。
- 输出质量评分趋势。
- 专家建议采纳率。
- 自动化执行成本。
- 多人共享 Workspace。
- 远程服务器模式下的 Orchestrator。
- Work Pack 版本管理。
- 合规审计导出。

## 9. 技术架构建议

### 9.1 分层架构

建议分四层：

1. Event Layer：统一事件总线。
2. Policy Layer：匹配规则、条件、loop guard、权限。
3. Orchestration Layer：专家选择、审查运行、建议生成。
4. UI Layer：建议卡片、审查队列、专家面板。

### 9.2 不要把 Orchestrator 写死在 automations.json

短期可以复用自动化系统，但中长期应该拆出更高层语义：

- `automations.json`：低层事件 -> action。
- `orchestrator.json`：专家团、审查策略、质量门禁。
- `work-pack.json`：领域包安装和资源集合。

### 9.3 自动化和 Orchestrator 的关系

自动化是底层触发器。Orchestrator 是产品化编排层。

可以理解为：

- 自动化回答“什么时候触发什么动作”。
- Orchestrator 回答“谁来审查、审查什么、怎么反馈、是否门禁”。

## 10. 风险和控制

### 10.1 无限循环

风险：Agent event 触发 prompt，prompt 创建新会话，新会话继续触发 Agent event。

控制：

- 自动化创建的会话默认 `orchestratorSuppressed = true`。
- 同一 matcher 同一 session 短时间内只允许触发一次。
- 最大链路深度，例如 `maxAutomationDepth = 2`。

### 10.2 成本失控

风险：每次文件生成都启动多个专家模型。

控制：

- 默认 observe/advise，不自动多模型审查。
- 文件大小、模型、频率都有限额。
- UI 显示预计成本或至少显示额外调用次数。

### 10.3 主会话被过度干扰

风险：专家建议频繁插入主会话，破坏工作流。

控制：

- 建议先进入右侧面板。
- 用户手动采纳后再注入主会话。
- 只有 hard-gate 模式才阻断正式输出。

### 10.4 专家幻觉

风险：专家审查给出没有证据的建议。

控制：

- 发现必须带证据。
- 无证据建议降级为“观察”。
- 审查提示要求引用文件路径和片段。

### 10.5 行业过窄

风险：产品被工程标书定位限制。

控制：

- 底层叫 Work Pack，不叫 Tender Pack。
- 内置第一批模板覆盖合同、财务、标准、产品文档、知识库。
- 工程标书作为强案例，不作为唯一方向。

## 11. 验收矩阵

| 阶段 | 必须证明 |
| --- | --- |
| Phase 1 | Agent events 能真实触发 action，且不会造成循环。 |
| Phase 2 | 文件产物可索引、可审查、可回链到会话。 |
| Phase 3 | 专家角色可配置、可禁用、可指定模型。 |
| Phase 4 | UI 能解释 Orchestrator 做了什么和为什么。 |
| Phase 5 | 多专家审查结果可合并并注入主会话。 |
| Phase 6 | Work Pack 可安装、可验证、可卸载。 |
| Phase 7 | 一句话安装服务可检查依赖、安装资源、失败自修复。 |
| Phase 8 | 审查和自动化历史可审计、可导出。 |

## 12. 推荐近期开发任务

优先级从高到低：

1. 改 UI 文案：把“智能体”改成“智能体事件（实验）”，避免误解。
2. 给自动化信息页明确标注 Agent event 当前执行状态。
3. 实现 Agent events 的 webhook action，因为它比 prompt action 更低风险。
4. 实现 Agent events 的 prompt action，但默认只允许 `PostToolUseFailure`、`SubagentStop`、`SessionEnd`。
5. 为 prompt action 增加 `parentSessionId`、`automationDepth`、`suppressAutomation`。
6. 在右侧信息面板增加“专家建议”只读区域。
7. 增加手动“请求审查此文件”入口。
8. 实现第一版成果审稿人：只读 Markdown/PDF/Excel 摘要，输出审查卡。
9. 做第一个非工程场景 Work Pack，例如 Contract Review。
10. 再做 Tender & Engineering Pack，作为强样板。

## 13. 分支和发布策略

当前发布：

- `main` 保持当前 v0.10.6 发布状态。
- 不更改 `package.json` 版本。
- 不重新生成 Windows 安装包。
- 不改变 GitHub Releases 最新安装包。

路线图分支：

- `codex/agentic-orchestrator-roadmap`：只沉淀路线图和规划，不进入发布通道。

后续开发建议：

- `feature/orchestrator-agent-events`：Agent events 执行链。
- `feature/orchestrator-artifacts`：Artifact 索引和审查。
- `feature/orchestrator-panel`：右侧专家建议面板。
- `feature/work-packs`：领域工作包。

发布建议：

- v0.11.0-beta：只提供关闭状态的实验入口。
- v0.11.0：Agent events webhook/prompt 可控执行。
- v0.12.0：专家建议面板和成果审查。
- v0.13.0：Work Pack 和一句话安装。

## 14. 最终产品形态

理想状态下，Agent π 的特色不再是“能聊天、能调用工具”，而是：

- 能围绕工作目录管理完整项目上下文。
- 能让多个专家在任务过程中持续审查。
- 能把过程材料和正式成果分清楚。
- 能发现文件、模型、证据、结构、质量和权限风险。
- 能把领域工作流打包成一键安装的 Work Pack。
- 能让用户在长期项目中知道“谁做了什么、为什么做、结果是否可靠”。

这就是 Agent π 相比通用智能体应用的长期护城河。
