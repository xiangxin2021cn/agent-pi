# OAG 与 Agent Pi 本地知识库适配性调研

> 状态：调研归档，暂不进入产品路线或开发计划
> 日期：2026-07-17
> 主题：Palantir Ontology-Augmented Generation（OAG）、Foundry Ontology 与本地部署适配性

## 1. 调研结论

Palantir 的 OAG 思想适合 Agent Pi 的投标、合同、BOQ、项目实施和资源投资场景，但 Palantir Foundry/Ontology 本身不适合作为桌面应用默认内置依赖。

核心判断如下：

1. OAG 并非取消检索或完全替代 RAG，而是在检索基础上增加业务对象、关系、确定性逻辑、受控行动、权限和审计。
2. Foundry/AIP 是企业平台级产品。其官方架构包含大量微服务、数据处理、对象引擎、权限和部署组件；Apollo 虽支持本地、私有云和断网环境，但属于 Kubernetes/数据中心级部署，不是桌面端嵌入式组件。
3. Ontology MCP 和 OSDK 是访问既有 Palantir 平台的客户端，不是独立可嵌入的本体数据库。
4. Agent Pi 已经具备确定性全文检索、精确引用、项目隔离、业务对象类型和能力依赖图，具备未来构建轻量本地 OAG 的基础。
5. 如未来重启该方向，推荐在现有知识库上增加轻量对象/关系层，不引入完整 Foundry，也不应一次性把全文装入模型上下文。

本轮决定：**仅保留调研记录，暂不实施 OAG、本体图谱或相关 UI。**

## 2. 对“OAG 替代 RAG”的校正

参考文章将 RAG 概括为“检索文本”，将 OAG 概括为“操作业务语义”。该表述有启发性，但容易造成三个误解。

### 2.1 OAG 仍然需要检索

Palantir 官方 OAG 文档仍建议根据上下文规模采用：

- 直接提供完整上下文；
- 文档分块；
- 关键词排序；
- Embedding 和语义搜索；
- 查询扩展和 HyDE；
- 关键词与语义混合搜索。

因此，更准确的关系是：

```text
OAG = Retrieval/RAG + Typed Objects + Links + Deterministic Logic
      + Governed Actions + Security/Audit
```

### 2.2 OAG 的重点是业务操作层

Palantir Ontology 不只是知识图谱。其主要组成包括：

- 数据：对象类型、属性、关系、接口；
- 逻辑：Functions、规则和计算；
- 行动：Action Types 和受控事务；
- 安全：对象级权限、行动权限和审计。

这类能力适合需要回答“哪个条款约束哪个 BOQ 项”“哪个补遗替代了哪个原条款”“某项变更会影响哪些进度、资源和现金流”的业务任务。

### 2.3 离线部署不等于桌面本地部署

Apollo 支持云、私有数据中心和断网环境，但其部署对象仍是企业微服务和 Kubernetes 环境。将其称为“可私有化”是准确的，将其理解为“可以作为 Electron 应用内置数据库”则不准确。

## 3. 重资产评估

| 方案 | 运行负担 | 开发与治理负担 | Agent Pi 适配性 |
| --- | --- | --- | --- |
| 内置完整 Foundry/Ontology | 很高 | 高 | 不适合 |
| 连接客户已有 Palantir | 中 | 中 | 可作为可选企业连接器 |
| 自建轻量本地 OAG | 低至中 | 中高 | 技术上最适合 |

Palantir 路线的主要成本不仅是计算和存储，还包括：

- 企业对象建模；
- 数据映射和主数据治理；
- 版本、生效日期和替代关系维护；
- 权限、审计和行动安全；
- 平台采购、部署和运维。

对 Agent Pi 而言，直接引入会显著扩大产品复杂度，并削弱当前桌面本地、可控、轻量的部署优势。

## 4. Agent Pi 现有基础

当前代码已经具备“轻量 OAG”所需的部分基础：

1. `knowledge-base-index` MCP 统一管理知识库来源。
2. 已提供 `list_sources`、`search_kb`、`read_chunk`、`read_range`、`find_clause`、`find_table` 和 `citation_audit`。
3. 文档分块带有标题路径、条款号、表格、BOQ 编号、页码和行号信息。
4. 中文检索使用 2 至 3 字符 n-gram，并支持工程编号的确定性检索。
5. 项目记忆按工作目录、业务模块、项目和会话隔离。
6. 投标模块已有 Project、Document、Revision、Requirement、Criterion、Deliverable、BOQItem 等结构化概念。
7. 投标、实施和投研 capability 已形成依赖关系，可作为未来确定性逻辑层。

仍然缺少：

- 跨文件统一对象身份和别名消歧；
- 显式对象关系和关系遍历；
- 生效日期、修订、替代和失效规则；
- 对象与原文证据的统一绑定；
- 持久化查询引擎；
- 受权限约束的行动注册和人工确认；
- 面向对象和关系的浏览维护界面。

## 5. 未来可选的轻量本地方案

如果未来重新启动该方向，建议保留现有全文知识库作为证据层，在其上增加 SQLite 本体层。

### 5.1 建议数据结构

```text
object_types
objects
link_types
links
evidence_bindings
aliases
revisions
schemas
```

对象属性可以使用 JSON 保存，但名称、编号、版本、生效日期和作用域应建立确定性索引。

### 5.2 典型对象

- 投标：Project、Document、Revision、Clause、Requirement、EvaluationCriterion、Deliverable、Addendum、BOQItem。
- 实施：Activity、Resource、Rate、CostItem、Change、RFI、Risk、Baseline、ProgressUpdate。
- 投研：Asset、License、ResourceEstimate、Offtake、Assumption、CashFlow、Risk。

### 5.3 典型关系

```text
amends
supersedes
governed_by
requires
quantified_by
priced_by
feeds
produces
contradicts
corroborates
```

### 5.4 建议调用链

```text
识别用户任务和作用域
→ 查询对象和关系
→ 定位绑定证据
→ 读取精确原文
→ 调用确定性业务逻辑
→ 生成结论或行动建议
→ 执行引用审计
→ 必要时请求人工确认后执行行动
```

不得将全部知识库内容一次性塞入模型上下文。

## 6. 主要风险

1. 对象映射错误会使模型产生比普通检索更自信的错误结论。
2. 本体范围失控会把轻量知识库重新做成重资产平台。
3. 修订、生效和替代关系错误会直接影响合同及规范判断。
4. 行动层若缺少权限和人工确认，可能修改 BOQ、计划或正式产物。
5. 本体对象不能替代原始证据；所有结论仍需回溯页码、条款号、行号或表格位置。

## 7. 若重启调研的准入条件

仅在以下条件满足后重新进入开发评估：

- 现有确定性全文知识库的准确率和引用链已稳定；
- 有一个范围明确的业务试点，例如一册规范、一个补遗和一个 BOQ；
- 已建立人工确认的对象映射和修订规则；
- 有可量化回归集，覆盖检索召回、引用准确、替代关系、矛盾检测和跨项目隔离；
- 证明本体层带来的准确率提升足以抵消系统复杂度。

## 8. 参考资料

- 头条文章：<https://www.toutiao.com/article/7661889882852000290/>
- Palantir Ontology-Augmented Generation：<https://www.palantir.com/docs/foundry/ontology/ontology-augmented-generation>
- Palantir Ontologies Overview：<https://www.palantir.com/docs/foundry/ontologies/ontologies-overview>
- Palantir Ontology System Architecture：<https://www.palantir.com/docs/foundry/architecture-center/ontology-system>
- Palantir Foundry Architecture Overview：<https://www.palantir.com/docs/foundry/architecture-center/overview>
- Palantir MCP：<https://www.palantir.com/docs/foundry/palantir-mcp/overview>
- Palantir OSDK：<https://www.palantir.com/docs/foundry/app-building/overview>
- Palantir Apollo：<https://www.palantir.com/docs/apollo/core/introduction>
