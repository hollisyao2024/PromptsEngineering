# 环境文件初始化架构说明

> 模块 ID：`ENVINIT`  
> 状态：Accepted  
> 负责人：@template-maintainers  
> 最后更新：2026-08-24  
> 对应 PRD：[环境文件初始化 PRD](../../prd-modules/environment-file-initialization/PRD.md)

## 1. 摘要

### 目标

- 模板 apply 时为目标项目补齐六个缺失的环境文件。
- 保证已有文件零修改，并明确 example/实际文件的 Git 所有权。

### 非目标

- 不同步后续内容，不加载或验证目标项目业务变量，不保存真实凭据。

### 关键决策

| ID | 决策 | 原因 | 状态 |
| --- | --- | --- | --- |
| ADR-002 | example 由 manifest `init-if-missing` 创建；实际文件由初始化器从目标项目对应 example 独占创建 | 复用模板所有权引擎，同时让实际文件继承项目已有 example 内容且永不覆盖 | Accepted |

## 2. 上下文与边界

```mermaid
flowchart LR
  T[模板源 example 文件] --> M[Manifest apply]
  M --> E[目标项目 example 文件]
  E --> I[环境实际文件初始化器]
  I --> R[目标项目实际环境文件]
  G[gitignore append-block] --> R
```

### 职责

- Manifest 创建缺失的 `.env.example`、`.env.staging.example`、`.env.production.example`。
- 初始化器按固定映射创建缺失的 `.env.local`、`.env.staging`、`.env.production`。
- Git ignore 模板确保三个实际文件不进入版本控制。

### 不负责

- 不决定目标框架如何加载文件，不把实际文件传播回模板源。

### 依赖

| 依赖 | 类型 | 合约 | 失败影响 | 降级 |
| --- | --- | --- | --- | --- |
| template manifest | internal | `init-if-missing` | example 缺失 | fail closed |
| target example | internal | UTF-8 文件内容 | 无法初始化实际文件 | fail closed，不创建空替代品 |
| gitignore append-block | internal | 三个精确文件名 | 实际文件可能被跟踪 | QA 阻断 |

## 3. 组件设计

### 组件/服务清单

| 组件 ID | 组件 | 职责 | 输入 | 输出 | 所有者 |
| --- | --- | --- | --- | --- | --- |
| ENVINIT-SVC-001 | Manifest apply engine | 首次复制三个 example | sourceRoot、targetRoot | created/unchanged | template |
| ENVINIT-SVC-002 | Environment file initializer | 从目标 example 首次生成实际文件 | 三组路径、write 标志 | 每个文件的 created/unchanged 状态 | template |
| ENVINIT-SVC-003 | Gitignore merge block | 保护实际文件 | 目标 `.gitignore` | ignore 规则 | template |

### 关键调用链

1. Dry-run 运行 manifest 预检，并只计算三个实际文件的预期状态。
2. Write apply 先创建缺失 example，再由初始化器读取目标 example。
3. 初始化器使用独占创建；目标已存在则不读取、不追加、不覆盖。
4. 第二次 apply 所有六个文件均收敛为 unchanged。

## 4. 接口与合约

### 提供的接口

| 名称 | 方向 | 请求 | 响应 | 幂等键 | 错误 |
| --- | --- | --- | --- | --- | --- |
| environment initialization | internal | `{sourceRoot,targetRoot,write}` | 六文件状态列表 | 目标绝对路径 | example 缺失/读取失败/独占创建失败 |

固定映射：

| Example | 实际文件 |
| --- | --- |
| `.env.example` | `.env.local` |
| `.env.staging.example` | `.env.staging` |
| `.env.production.example` | `.env.production` |

### 依赖的接口

| 依赖 | 合约 | 失败行为 |
| --- | --- | --- |
| Manifest apply | example `init-if-missing` | 非零退出并停止实际文件初始化 |
| Target filesystem | UTF-8 读取、exclusive create | 不覆盖已有文件，错误可见 |
| Git ignore matcher | 三个实际文件精确匹配 | QA 阻断合并 |

兼容策略：已有文件永远优先；模板升级不承担内容迁移。原先向已有 `.env.local` 追加 `GH_TOKEN` 的行为被明确废弃，以满足零修改约束。

## 5. 数据设计

无数据库。持久数据为六个 UTF-8 文本文件；example 可跟踪，实际文件视为敏感本地配置。实际文件首次内容等于创建时目标项目对应 example 的内容。

### 数据资产表

| 表名 | 类型 | 关键字段 | 保留策略 |
| --- | --- | --- | --- |
| Environment example files | 可跟踪文本文件 | 注释、变量名、空占位、安全默认值 | 目标项目长期维护 |
| Environment runtime files | 被忽略的敏感文本文件 | 项目本地或环境值 | 目标项目自行保留/删除 |

- 事务边界：单文件独占创建；任一已有文件不进入写路径。
- 并发策略：使用 exclusive create，竞争者先创建成功后其余调用返回 unchanged 或明确失败，不覆盖。
- 幂等策略：文件存在性是唯一幂等条件。
- 迁移/回滚：删除新增的 example 文件与 manifest 条目可回滚模板；不得自动删除目标项目已生成文件。

## 6. 质量属性

| 属性 | 可测目标 | 设计措施 | 验证方式 |
| --- | --- | --- | --- |
| 性能 | 常数级六路径检查 | 固定映射，无目录扫描 | 单元测试 |
| 可用性 | 重复 apply 100% 收敛 | init-if-missing + exclusive create | 双次 apply |
| 安全 | 0 个真实凭据；实际文件 100% ignored | 占位内容 + ignore 契约 | 内容与 Git ignore 测试 |
| 可观测性 | 六文件状态可见 | 逐文件结构化状态输出 | stdout 断言 |

### 失败与恢复

| 失败场景 | 检测 | 行为 | 恢复 | 告警 |
| --- | --- | --- | --- | --- |
| 对应 example 不存在 | 文件检查 | fail closed，不创建实际文件 | 修复模板源/目标 example 后重试 | STATUS=BLOCKED |
| 实际文件已存在 | 文件检查 | unchanged | 无需恢复 | 状态输出 |
| 写入竞争 | exclusive create 错误 | 不覆盖竞争者内容 | 重新检查文件后报告 | 非零退出或 unchanged |

## 7. 安全与隐私

- example 只允许注释、变量名、空占位和安全默认值。
- 实际文件可能包含秘密，必须被精确 ignore；日志不得打印文件内容。
- 初始化器不得把实际文件复制回模板或 Git index。

## 8. 部署与运行

无独立部署单元。逻辑随模板更新脚本传播；首次 apply 生成文件，后续 apply 只检查存在性。生产 secret 注入仍由目标项目 CI/CD 负责。

## 9. 可测试性

| 层级 | 合约或场景 | 测试类型 | 证据 |
| --- | --- | --- | --- |
| 单元 | 三组映射首次创建、dry-run、已有内容保护 | node:test | TC-ENVINIT-001/003/004 |
| 集成 | manifest apply 后六文件与 ignore 状态 | integration | TC-ENVINIT-002 |
| 系统 | 第二次 apply 收敛 | contract | QA template convergence |

## 10. 风险与验证表

| ID | 风险类型 | 影响 | 缓解/负责人 | 截止 |
| --- | --- | --- | --- | --- |
| R-ENV-001 | `.env.staging`/`.env.production` 不被目标框架自动加载 | 文件存在但运行时未消费 | 明确 Out of Scope，由项目配置加载方式 / @project | 使用前 |

## 11. 实现约束

- 必须：先完成 example apply，再初始化实际文件；逐文件输出状态；保持已有内容逐字节不变。
- 禁止：append、truncate、覆盖、提交真实秘密、从空缺 example 生成空实际文件。
- 可选：在支持的平台以 owner-only 权限创建实际文件。
- TASK 拆分提示：先测映射和不覆盖，再改 manifest/初始化器，最后做传播与 Git ignore 验收。

## 12. Story/Component 追溯表

| Story | Component |
| --- | --- |
| US-ENVINIT-001 | ENVINIT-SVC-001、ENVINIT-SVC-002、ENVINIT-SVC-003 |
| US-ENVINIT-002 | ENVINIT-SVC-002 |
| US-ENVINIT-003 | ENVINIT-SVC-001、ENVINIT-SVC-002 |

## 13. 完成检查

- [x] PRD Story/AC 均有架构落点。
- [x] 边界、合约、失败路径明确。
- [x] 安全、幂等与可观测性可测试。
- [x] 回滚策略明确。
- [x] 无待决阻塞项。
- [x] 已更新模块清单。
