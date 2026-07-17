# Agent Pi 可迁移扩展包设计

## 1. 结论

Agent Pi 可以把已经调试成熟的 Skill、知识库和 MCP 数据源导出为一个安装包，在另一台安装 Agent Pi 的计算机上导入。但不能直接复制当前目录：知识库注册表和 file-memory MCP 包含本机绝对路径，MCP 可能依赖本机命令，凭据由独立的安全存储管理。

推荐新增版本化的 `.agentpi-bundle` 压缩包。扩展包只携带可公开迁移的定义和原始资料；目标机负责路径重写、知识库重建索引和凭据重新授权。

## 2. 当前代码基础

- Skill 已分为 bundled、global、workspace 和 project 四层，目录式 Skill 天然适合选择性打包和安装。加载优先级为 `bundled < global < workspace < project`。
- 数据源保存在 `{workspace}/sources/{slug}`，包含 `config.json`、`guide.md` 和资源文件。普通 local source 路径已有 portable path 转换，但 MCP command/args 仍可能包含本机路径。
- 数据源凭据不在普通配置中，必须继续使用 Agent Pi 的 credential manager；任何导出包都不得包含凭据缓存。
- 企业知识库注册表保存 `sourceFilePath`、`originalSourceFilePath` 等绝对路径。file-memory 创建流程会把知识文件复制到托管目录并生成 manifest/chunks，因此目标机可以复用现有创建流程重建，而不应复制旧索引。
- 当前 file-memory 首版索引仅接收 `.md/.txt/.json`，单个结构化文件上限为 20 MB。PDF、Word、Excel 等应携带原文件或结构化结果，并在目标机走现有提取/入库流程。

## 3. 建议包结构

```text
company-tender-kit.agentpi-bundle
  bundle.json
  checksums.json
  skills/
    tender-example/SKILL.md
    tender-example/references/...
  sources/
    anysearch/config.sanitized.json
    anysearch/guide.md
    anysearch/assets/...
  knowledge-base/
    entries.json
    files/<entry-id>/source.md
    files/<entry-id>/original.pdf       # 可选
```

`bundle.json` 至少记录：

```json
{
  "schemaVersion": 1,
  "minimumAppVersion": "2.2.4",
  "name": "Company Tender Kit",
  "createdAt": "2026-07-17T00:00:00.000Z",
  "items": {
    "skills": ["tender-example"],
    "sources": ["anysearch"],
    "knowledgeBaseEntries": ["coto-chapter-1"]
  }
}
```

## 4. 导出规则

1. 用户选择导出范围和安装层级：全局、当前 workspace 或项目。
2. Skill 连同 `SKILL.md`、scripts、references、templates 和 assets 原样打包，并记录文件哈希。
3. MCP/API/local source 导出经过清洗的配置、guide 和资源文件。
4. 企业知识库导出分类、文件夹、显示名称、结构化源文件及可选原文件，不导出 manifest、chunks 或旧 registry 路径。
5. 导出前扫描危险内容：路径穿越、符号链接、超大文件、配置中疑似 token/API key、外部可执行命令和缺失依赖。
6. 生成 `checksums.json`，导入时逐项校验。

必须排除：

- API Key、OAuth token、密码、cookie 和 credential cache。
- `.credential-cache.json`、`.env` 及任何已解密凭据。
- `isAuthenticated=true` 等可误导目标机的运行状态。
- 旧机器的知识库 manifest、chunks、registry 绝对路径。
- 会话、工作目录、临时文件和模型配置，除非未来单独定义迁移协议。

## 5. 目标机安装流程

1. 校验压缩包结构、schema/app 版本、哈希和 zip-slip 风险。
2. 展示内容清单、权限、外部依赖和冲突；用户选择覆盖、并存改名或跳过。
3. 安装 Skill 到用户选择的 global/workspace/project 层，并刷新 Skill 缓存。
4. 安装 source 定义，重写内置 MCP runtime 路径；外部命令型 MCP 先保持禁用，待依赖检查通过。
5. 将所有外部连接标为未认证，逐项引导用户在目标机重新输入凭据。
6. 通过现有知识库文件创建流程复制托管文件、重新分块、生成 manifest 并写入新的 registry。
7. 执行 source test、Skill validation 和知识库抽样检索，最后生成安装报告。

## 6. 产品入口

建议未来在“设置 -> 扩展包”提供：

- `导出扩展包`：树形选择 Skill、知识库、MCP/API 数据源。
- `安装扩展包`：预检、冲突处理、安装层级、重新授权和重建进度。
- `安装报告`：已安装、跳过、待授权、缺少依赖、知识库索引失败。

也可增加右键入口：Skill/知识库/数据源 -> `加入扩展包`。扩展包应是配置迁移工具，不负责迁移会话和项目业务数据。

## 7. MVP 实施范围

第一阶段只支持：

- 目录式 Skill。
- Agent Pi 已知的 MCP/API source 配置和 guide，凭据始终排除。
- `.md/.txt/.json` 企业知识库条目，导入后强制重建 file-memory。
- 同一主版本 Agent Pi 之间迁移。
- 覆盖、改名、跳过三种冲突策略。

暂不支持：

- 自动搬运系统级可执行文件、Python/Node 环境或 Docker 服务。
- 跨平台转换任意 shell 命令。
- 导出模型账号、API Key 或 OAuth 会话。
- 把旧知识库索引直接恢复到另一台机器。

## 8. 后续代码落点

- shared：定义 bundle schema、清洗规则、哈希和路径安全校验。
- server-core：实现 export/import service、RPC、冲突策略和安装报告。
- Electron：实现选择、预检、重新授权和进度 UI。
- knowledge base：导入时复用现有知识库创建 handler，避免出现第二套索引逻辑。
- skills/sources：安装完成后复用现有 cache invalidation 和 source test。

## 9. 验收条件

- 从计算机 A 导出的 Skill 在计算机 B 可被发现并按原说明执行。
- MCP/API source 在 B 中安装后默认禁用或未认证，不包含 A 的任何秘密。
- 知识库在 B 中使用新的托管路径和 manifest，原文件删除或 A 的盘符不存在时仍可检索。
- 重名条目不会静默覆盖，安装报告可追踪每一项结果。
- 恶意路径、损坏哈希、未知 schema 和疑似密钥会阻止安装。

该方案适合企业内部共享经过验证的 Agent Pi 能力包，但正式开发前应先确定扩展包签名、企业管理员审批和大文件传输策略。
