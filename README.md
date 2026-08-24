<p align="center">
  <img src="docs/assets/hero-light.jpg" alt="Agent Pi DSH — engineering light theme" width="100%">
</p>

<p align="center">
  <img src="docs/assets/logo-mark.png" width="88" alt="Agent π">
</p>

<h1 align="center">Agent Pi DSH</h1>

<p align="center">
  <b>工程企业的垂直智能体</b><br>
  <strong>长程任务，一次跑完</strong>
</p>

<p align="center">
  The vertical agent for engineering enterprises — tender, delivery, investment.<br>
  Long-horizon jobs, finished in one run.
</p>

<p align="center">
  <a href="https://www.agent-pi.app"><img src="https://img.shields.io/badge/官网-agent--pi.app-2f6df0?style=flat-square" alt="Website"></a>
  <a href="https://github.com/xiangxin2021cn/agent-pi/releases/tag/v3.3.2"><img src="https://img.shields.io/badge/v3.3.2-DSH%20dsh--v0.1.1--rc.2-2f6df0?style=flat-square" alt="v3.3.2"></a>
  <a href="https://www.agent-pi.app/docs.html"><img src="https://img.shields.io/badge/文档-Docs-0fb5c9?style=flat-square" alt="Docs"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-see%20repo-8593ab?style=flat-square" alt="License"></a>
</p>

<p align="center">
  <a href="https://github.com/xiangxin2021cn/agent-pi/releases/download/v3.3.2/Agent-Pi-DSH-3.3.2-x64.exe"><b>Windows x64</b></a>
  ·
  <a href="https://github.com/xiangxin2021cn/agent-pi/releases/download/v3.3.2/Agent-Pi-DSH-3.3.2-mac-arm64.dmg"><b>macOS arm64</b></a>
  ·
  <a href="https://github.com/xiangxin2021cn/agent-pi/releases/download/v3.3.2/Agent-Pi-DSH-3.3.2-linux-x86_64.AppImage"><b>Linux AppImage</b></a>
  ·
  <a href="https://www.agent-pi.app">官网</a>
  ·
  <a href="https://www.agent-pi.app/docs.html">文档</a>
</p>

通用办公助手陪你聊天，**Agent Pi DSH 替你干活**：吃透投标、实施、投资的垂直作业系统。长程任务不断档、目标不偏离、证据可追溯——数十份标书文件一次搞定，数千条 BOQ 逐项推导，成果直接落盘为正式文档。

> [!IMPORTANT]
> **v3.3.2** 已发布 · 内核钉在 **`dsh-v0.1.1-rc.2`** · 新会话默认 `deepseek-v4-flash-vision-exp`
>
> `main` 分支源码仍是 2.x（Craft Agents OSS）。**3.x 桌面版以 [Release 安装包](https://github.com/xiangxin2021cn/agent-pi/releases/tag/v3.3.2) 发布。** 完整产品页：[www.agent-pi.app](https://www.agent-pi.app)

<p align="center">
  <img src="docs/assets/screenshot-market.jpg" alt="Agent Pi DSH 插件市场 · 亮色工作台" width="92%">
</p>

---

## 不是又一个聊天助手

豆包、通义办公、WorkBuddy 面向所有人的日常事务。Agent Pi DSH 只为工程企业的重活而生。

| 维度 | 通用办公助手 | Agent Pi DSH |
| --- | --- | --- |
| 任务尺度 | 几十轮对话就断片、跑题 | 小时级长程任务一次跑完；崩溃只救未完工的部分 |
| 目标控制 | 聊到哪算哪 | 阶段门禁 + 成果树锁定目标 |
| 事实可靠性 | 凭模型记忆编 | 证据门禁：查不到出处就不放行 |
| 专业深度 | 通用模板 | 投标 / 实施 / 投资垂直技能；规范、FIDIC 进知识库 |
| 数据处理 | 长文档读不动，大表格丢行 | 数千条 BOQ 逐项处理，每条带规范出处 |
| 成果形态 | 一段聊天记录 | 落盘的正式成果：版式、带公式报表、出处芯片 |

---

## 投标全流程

一次长程任务，从标书到标稿。中间材料全程不丢，每一步都可核对出处。

1. **标书全量解析，规范入库存起来** — 规范、FIDIC 与特别条款修订逐条对照
2. **数千条 BOQ，逐项界定工作范围** — 不靠印象，每条都有出处芯片
3. **五步推导，算出每一条单价** — 企业数据 + 工法工效 + 实地资源价格
4. **资源汇总与成本推定** — 带公式的组价测算表可以直接改
5. **按项目特征做施工推演** — 可执行的施工策划稿，不是套话
6. **照你的模板编制正式投标文档** — 复刻版式与深度，项目事实永远来自本项目

中标之后，投标阶段的详尽基础资料直接服务实施——成本策划有据可依。

---

## 核心能力

| | |
| --- | --- |
| **内核原生并行工人** | 工具、子任务、会话、权限由 DeepSeek Harness 直接跑，不隔一层自研调度器 |
| **证据门禁** | 项目特征缺口不能用模型记忆填：找到出处，或由你尽调后授权放行 |
| **Official Outputs** | 统一成果树与阶段总报告写回 `Agent Pi Outputs`；已落盘的成果重启后不再重做 |
| **出处芯片** | 只显示源文件、页或行、题目；证据正文不贴进正式稿 |
| **本地知识库** | 两条入库路、按文档章节切条款、MinerU 转可读表、用户模板、`.apkb` 传递包 |
| **崩溃只救没递交的工人** | 已完工任务不重读、不重派；只找回还没递交成果的工人 |
| **企业级插件** | 技能、工具、工作台页、验收门禁都可以加；预置 Univer 预览 / 改组价表 |

---

## 三个业务域，一套工作台

| 01 / TENDER | 02 / DELIVERY | 03 / INVESTMENT |
| --- | --- | --- |
| **投标** | **实施交付** | **投资研究** |
| 招标解析 · 项目边界 | 合同范围 · 计划进度 | 任务筛选 · 市场承购 |
| BOQ 五步组价 · 量价核对 | 成本商务 · 现金流 | 技术尽调 · 法务 ESG |
| 评审策略 · 正式写作 | 资源采购 · 风险变更 | 财务估值 |
| 递交文件与递交前审计 | 报告审计 · 工期计划器 | 交易决策 |

---

## 架构

发动机是 **DeepSeek Harness**，工作台是 **Agent Pi**。从 3.0 起，循环交给内核；投标 / 实施 / 投资、证据门禁、正式成果仍是本产品的工作台。

```mermaid
flowchart LR
    U["打开项目下任务"] --> W["工作台 tender-host"]
    W --> K["DeepSeek Harness 内核"]
    K --> S["subagent / workflow"]
    S --> O["Official Outputs"]
    O --> C["出处芯片"]
    W --> G["证据门禁"]
    K --> B["本地知识库"]
```

| 层 | 做什么 |
| --- | --- |
| 对话、模型、权限、技能目录 | dsh Web |
| 投标 / 实施 / 投资工作台 | 对话页页签 + 建项目 |
| 阶段准备、证据门禁、成果树 | 工作台插件 |
| 并行拆活 | 内核原生 `subagent` / `workflow` |
| 桌面壳 | Electron 43.4.1 |

---

## 下载与安装

| 平台 | 文件 |
| --- | --- |
| Windows x64 | [Agent-Pi-DSH-3.3.2-x64.exe](https://github.com/xiangxin2021cn/agent-pi/releases/download/v3.3.2/Agent-Pi-DSH-3.3.2-x64.exe) |
| macOS Apple Silicon | [Agent-Pi-DSH-3.3.2-mac-arm64.dmg](https://github.com/xiangxin2021cn/agent-pi/releases/download/v3.3.2/Agent-Pi-DSH-3.3.2-mac-arm64.dmg) · [zip](https://github.com/xiangxin2021cn/agent-pi/releases/download/v3.3.2/Agent-Pi-DSH-3.3.2-mac-arm64.zip) |
| Linux x64 | [AppImage](https://github.com/xiangxin2021cn/agent-pi/releases/download/v3.3.2/Agent-Pi-DSH-3.3.2-linux-x86_64.AppImage) · [deb](https://github.com/xiangxin2021cn/agent-pi/releases/download/v3.3.2/Agent-Pi-DSH-3.3.2-linux-amd64.deb) |
| 2.6.5 经典版 | [可与 3.x 并存](https://github.com/xiangxin2021cn/agent-pi/releases/tag/v2.6.5) |

国内镜像（Windows）：[gh-proxy.com](https://gh-proxy.com/https://github.com/xiangxin2021cn/agent-pi/releases/download/v3.3.2/Agent-Pi-DSH-3.3.2-x64.exe) · [ghfast.top](https://ghfast.top/https://github.com/xiangxin2021cn/agent-pi/releases/download/v3.3.2/Agent-Pi-DSH-3.3.2-x64.exe)

Windows SHA256：`00e2552dfe17c2a2cc5cb694d2174e5afc28fd43efab44d1059f71b0bda610b7`

1. 下载对应平台安装包
2. 未签名：SmartScreen / Gatekeeper 选「仍要运行」
3. 打开 **Agent Pi DSH**，选择项目工作区
4. 配置 DeepSeek；看图请用带图片输入的视觉模型
5. 回形针上传资料后直接下任务

覆盖安装前请**完全退出**（不要只关到托盘）。工作目录和 `Agent Pi Outputs` 接着用。会话不从 2.x 迁移。

---

## 版本沿革

| 版本 | 一句话 |
| --- | --- |
| [3.3.2](https://github.com/xiangxin2021cn/agent-pi/releases/tag/v3.3.2) | 知识库完善：独立入口、知识包、用户模板、子目录、`.apkb`、MinerU 转表；内核 `0.1.1-rc.2` |
| [3.3.0](https://github.com/xiangxin2021cn/agent-pi/releases/tag/v3.3.0) | 内核 rc.8；知识库本页解析，列表与上传齐名 |
| [3.2.3](https://github.com/xiangxin2021cn/agent-pi/releases/tag/v3.2.3) | 对话框文件夹只给路径；右键恢复注入对话 |
| [3.2.2](https://github.com/xiangxin2021cn/agent-pi/releases/tag/v3.2.2) | 卸掉 J-Space 出厂技能；不再劫持 DSH 循环 |
| [3.2.1](https://github.com/xiangxin2021cn/agent-pi/releases/tag/v3.2.1) | web_fetch、AnySearch；市场放行写对 pnpm 包名 |
| [3.2.0](https://github.com/xiangxin2021cn/agent-pi/releases/tag/v3.2.0) | 内核 `0.1.0-rc.7`；崩溃只救未递交工人；引用变出处芯片 |
| [3.1.0](https://github.com/xiangxin2021cn/agent-pi/releases/tag/v3.1.0) | 蒸馏模块、知识库、成果树、质检 |
| [3.0.0](https://github.com/xiangxin2021cn/agent-pi/releases/tag/v3.0.0) | 发动机换成 DeepSeek Harness |
| [2.6.5](https://github.com/xiangxin2021cn/agent-pi/releases/tag/v2.6.5) | 经典版（Craft Agents OSS / Goal Loop），可并存 |

---

<p align="center">
  <a href="https://www.agent-pi.app"><b>www.agent-pi.app</b></a>
  · Always π AI Studio
  · pinned: dsh-v0.1.1-rc.2
</p>
