<p align="center">
  <img src="docs/assets/agent-pi-logo.png" width="160" alt="Agent π">
</p>

# Agent π / Agent Pi

招投标、实施、投资的桌面超级工作台。打开项目就能下任务：并行工人、证据门禁、正式成果、可点击出处，都在同一扇窗里。

A desktop workbench for tender, delivery, and investment jobs. Open a project and talk — parallel workers, evidence gates, Official Outputs, and clickable citations live in one window.

> [!IMPORTANT]
> ## v3.2.1 已发布 — 预装 GenUI、抓页、AnySearch
>
> 在 3.2.0 内核之上，出厂带上 **dsh-genui**、**web_fetch**、**AnySearch**。装不上社区插件不是应用拦网；对话里也不用接 Chrome CDP。
>
> **[⬇ 下载 Windows x64](https://github.com/xiangxin2021cn/agent-pi/releases/latest)** ｜ [3.2.1 说明](https://github.com/xiangxin2021cn/agent-pi/releases/tag/v3.2.1)
>
> 安装包：`Agent-Pi-DSH-3.2.1-x64.exe`。未签名：SmartScreen 选「仍要运行」。升级请完全退出再打开（不要只关到托盘）。
>
> `main` 分支源码仍是 2.x（Craft Agents OSS）。**3.x 桌面版以 Release 安装包发布。**

---

## 3.2.1 这版你能感到什么

助手回复里可以渲染交互 UI（`dsh-ui` 围栏）。模型可以用 `web_fetch` 取页面和图片地址，再写成 Markdown 图。网络搜索走 AnySearch。社区市场若仍从 GitHub 装插件，点确认就会预写正确的 pnpm 构建放行键。对话里后来装的 bundle 插件，重启后会保留。

`web-fetch-http` 不会出现在市场的依赖列表里——overlay 加载才是正确方式。市场若写「校验失败」，是误报。

---

## 3.2.0 这版你能感到什么

### 内核更快、更稳

钉住上游 DeepSeek Harness **`v0.1.0-rc.7`**。投标场景里大量持久 Bash 不再先卡三秒多才出字；大历史分页不再栈溢出；提问卡片可折叠留草稿；推理强度可调到 `low` 省成本。3.1.x 针对上百个工人的历史与审批覆盖层全部保留。

### 崩溃只救没递交的工人

工人正常写完并回推，父会话照常收口。父会话崩了或你把应用重启后：

- **已经落到 Official Outputs 的任务不再重读 JSON、不再重派、不再重解析源文件**
- 只找回还没递交成果的工人：能续跑就续跑，续不上再下派这一条
- 不会把整个阶段当新任务重开
- 你在正式稿上改的字留在父会话里，不会把已完工工人叫醒

### 引用是出处，不是摘抄

Markdown 里的引用令牌显示成短芯片。点一下只看到：**源文件、页或行、题目或段落**，需要时再打开源文件。写作合同禁止把证据正文贴进稿里。

### 能启动，右边文件栏还在

DSH `rc.7` 把设置页插件槽改成按命名空间 keyed。本版给钉住的 `dsh-vision-router` 补上 `key`，否则一开应用就 Failed to load plugins。「资源文件」挂在根 overlay 上，会话行晚一点才带路径时不再整栏消失；顶栏文件夹按钮重新打开这一栏。

---

## 这是什么

Agent π 不是聊天壳。它把智能体放进真实项目作业：**投标解析与组价、实施策划、投资研究**。默认路径仍是打开工作区说话；工作台是加速器，不是闸门。

从 3.0 起，循环交给 DeepSeek Harness：工具、并行子任务、会话、权限由内核直接跑。投标 / 实施 / 投资、证据门禁、正式成果仍是 Agent π 的工作台，只是不再隔着一层自研 SessionManager / Goal Loop。

```mermaid
flowchart LR
    U["打开项目下任务"] --> W["工作台"]
    W --> K["DeepSeek Harness 内核"]
    K --> S["并行工人"]
    S --> O["Official Outputs"]
    O --> C["出处芯片"]
```

| 层 | 做什么 |
| --- | --- |
| 对话、模型、权限、技能目录 | dsh Web |
| 投标 / 实施 / 投资工作台 | 对话页页签 + 建项目 |
| 阶段准备、证据门禁、成果树 | 工作台插件 |
| 并行拆活 | 内核原生 `subagent` / `workflow` |

3.1 已经具备：一句话把本单活蒸馏成领域模块、本地知识库、统一成果树与阶段总报告、掌控型质检、J-Space 深推理协议。3.2 在这条线上把内核和长任务收口做稳。

---

## 安装

1. 下载 [`Agent-Pi-DSH-3.2.1-x64.exe`](https://github.com/xiangxin2021cn/agent-pi/releases/latest)
2. 未签名：SmartScreen 选「仍要运行」
3. 打开 **Agent π**，选择项目工作区
4. 配置 DeepSeek；若要看图，换带图片输入的视觉模型
5. 回形针上传资料后直接下任务

PDF 当文件读（能抽文本的不先转图）。图片走视觉模型的正常多模态链路。

| | |
| --- | --- |
| 不会自动升级 | 2.x 停在 2.6.5，避免把旧引擎静默换成新内核 |
| 项目还在 | 工作目录和 `Agent Pi Outputs` 接着用 |
| 会话不从 2.x 迁移 | 旧聊天、旧模型连接不会进 3.x |
| 可并存 | 3.x 与 [v2.6.5 经典版](https://github.com/xiangxin2021cn/agent-pi/releases/tag/v2.6.5) 可同时装 |
| 覆盖层仍在 | 上百工人的父会话：点开某一个孩子的历史不应再把整窗打死；目录菜单仍可能慢 |

官方 DeepSeek 仍是纯文本。需要看图时在设置里换视觉模型。

---

## 版本沿革

| 版本 | 一句话 |
| --- | --- |
| [3.2.1](https://github.com/xiangxin2021cn/agent-pi/releases/tag/v3.2.1) | 预装 dsh-genui、web_fetch、AnySearch；市场放行写对 pnpm 包名 |
| [3.2.0](https://github.com/xiangxin2021cn/agent-pi/releases/tag/v3.2.0) | 内核 `0.1.0-rc.7`；崩溃只救未递交工人；引用变出处芯片；能启动；资源文件栏不再丢 |
| [3.1.3](https://github.com/xiangxin2021cn/agent-pi/releases/tag/v3.1.3) | 冷子代理历史不再扫全部兄弟 |
| [3.1.2](https://github.com/xiangxin2021cn/agent-pi/releases/tag/v3.1.2) | 运行中子代理历史加载热修 |
| [3.1.0](https://github.com/xiangxin2021cn/agent-pi/releases/tag/v3.1.0) | 蒸馏模块、知识库、成果树、质检、J-Space |
| [3.0.0](https://github.com/xiangxin2021cn/agent-pi/releases/tag/v3.0.0) | 发动机换成 DeepSeek Harness |
| [2.6.5](https://github.com/xiangxin2021cn/agent-pi/releases/tag/v2.6.5) | 经典版（Craft Agents OSS / Goal Loop），可并存 |
