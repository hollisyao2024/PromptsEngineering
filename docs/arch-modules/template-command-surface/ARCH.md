# 模板命令面架构说明

> 模块 ID：`CMDSURF`  
> 状态：Accepted  
> 负责人：@template-maintainers  
> 最后更新：2026-08-26  
> 对应 PRD：[`US-CMDSURF-001~005`](../../prd-modules/template-command-surface/PRD.md)

## 1. 摘要

目标是以单一模板执行面覆盖本地服务、客户端开发、客户端构建和环境部署。模板配置登记稳定的规范 alias，项目实现或覆盖 alias；产品参数继续外置。非目标是规定具体客户端框架或真实部署实现。

| ID | 决策 | 原因 | 状态 |
| --- | --- | --- | --- |
| ADR-001 | 扩展现有 Agent CLI 和 DevOps dispatcher | 保持单一执行面与证据模型 | Accepted |
| ADR-003 | 在共享配置层提供显式、按需的容器目录初始化器 | 统一路径校验与失败语义，同时避免配置读取产生副作用 | Accepted |

## 2. 上下文与边界

```mermaid
flowchart LR
  S[Slash 语义] --> CLI[CMDSURF-API-001 Agent CLI]
  CLI --> DISPATCH[CMDSURF-SVC-001 Dispatcher]
  CFG[CMDSURF-SVC-002 Config Resolver] --> DISPATCH
  DIR[CMDSURF-SVC-003 Container Directory Initializer] --> DISPATCH
  CFG --> DIR
  DISPATCH --> CMD[项目自有命令]
```

职责：解析稳定动作、校验平台/profile/环境、精确选择配置、执行并输出证据。不负责定义端口、服务名、框架、数据库或签名策略。

## 3. 组件设计

### 组件/服务清单

| 组件 ID | 组件 | 职责 | 输入 | 输出 | 所有者 |
| --- | --- | --- | --- | --- | --- |
| CMDSURF-API-001 | Agent CLI Router | 将 `app dev/build` 等路由为执行器动作 | CLI argv | action argv | 模板 |
| CMDSURF-SVC-001 | Command Dispatcher | 维度校验、执行、结构化结果 | action/platform/target/env | STATUS 与运行证据 | 模板 |
| CMDSURF-SVC-002 | Config Resolver | 从合并配置精确选择命令 | `app.commands`、`devServer.commands`、`devops.commands` | command 或空 | 模板 |
| CMDSURF-SVC-003 | Container Directory Initializer | 对声明的容器目录执行解析、拓扑校验、递归创建与真实目录复核 | config、main root、目录 key 集合 | 已校验绝对路径或明确错误 | 模板 |

关键调用链：CLI 标准化参数 → Dispatcher 校验必需维度 → Config Resolver 精确查找 → 按动作声明并初始化所需容器目录 → 项目命令执行 → 记录结果。

初始化策略：

- `resolveContainerPath()` 保持纯解析、无文件系统副作用。
- 新增显式初始化接口，只接受白名单 key：`worktrees`、`tmp`、`cache`、`artifacts`；内部先复用拓扑校验与绝对路径解析，再以 recursive 方式创建，并用 `lstat` 拒绝文件或符号链接冒充目录。
- 状态/worktree/template 命令只声明自身写入的目录；构建、CI、发布等项目命令在启动前声明 `tmp`、`cache`、`artifacts`，并通过环境变量获得同一批已初始化绝对路径。
- 只读列表、状态审计或单纯配置加载不调用初始化接口。

## 4. 接口视图

### 提供的接口

| 名称 | 请求 | 响应 | 错误 |
| --- | --- | --- | --- |
| `app dev` | `--platform=<platform> [--target=<profile>]` | 结构化执行结果 | missing platform/config |
| `app build` | `--platform=<platform> [--target=<profile>]` | 结构化执行结果 | missing platform/config |
| `dev restart` | 可选内部 `--target=<profile>` | 结构化执行结果 | missing profile config |

用户快捷语法将 `/private restart` 翻译为内部 `dev restart --target=private`；模板文档不把后者呈现为用户快捷命令。

### 依赖的接口

| 依赖 | 合约 | 失败行为 |
| --- | --- | --- |
| `loadConfig()` | CLI > env > project > template defaults | 配置无效时阻断 |
| 项目命令 | shell command string | 非零退出转 `STATUS=BLOCKED` |
| 容器路径解析 | `resolveContainerPath()` | 越界路径阻断 |
| 容器目录初始化 | 显式目录 key 集合；返回绝对路径映射 | 非白名单 key、非法拓扑、非目录目标或创建失败时阻断 |

兼容策略：`config.example.json` 提供完整默认矩阵，项目稀疏 `agent.config.json` 通过深合并继承并可在任意叶级覆盖；已有 package aliases 不删除。项目显式选择未知 profile、平台或环境时不跨维度回退。

## 5. 数据视图

### 数据资产表

| 表名 | 类型 | 关键字段 | 保留策略 |
| --- | --- | --- | --- |
| `app.commands` | JSON 配置，不是数据库表 | action → platform → profile → command | 模板登记规范 alias 默认值；项目稀疏覆盖 |
| `devops-runs/result.json` | 临时运行证据 | action/platform/target/command/cwd/status | 容器 tmp 策略 |

无 schema 迁移、事务、并发写入或业务数据保留变化。

## 6. 质量属性

| 属性 | 可测目标 | 设计措施 | 验证方式 |
| --- | --- | --- | --- |
| 可靠性 | 不发生跨 profile 回退 | 精确嵌套选择 | 负向单元测试 |
| 可移植性 | 0 个产品硬编码参数且完整矩阵可继承 | 规范 alias 默认值 + 项目叶级覆盖 | 内容扫描与枚举契约测试 |
| 可观测性 | 每次执行有结构化字段 | 复用 run directory | 集成测试 |
| 兼容性 | 既有 dev/ship 测试全部通过 | 增量 action 分支 | 回归测试 |
| 可恢复性 | 缺目录首次写入成功，重复调用不改已有内容 | 共享显式初始化器 + recursive mkdir + lstat | 缺失/已存在/文件占位/只读场景测试 |

## 7. 安全与隐私

不新增身份、权限或外部接口。命令字符串只来自受版本控制的配置或既有环境覆盖；输出不得展开凭据。显式 profile 不得回退 default。

## 8. 部署与运行

无新部署单元、daemon 或端口。模板更新通过 manifest 传播；真实客户端和服务端命令由目标项目执行并负责其健康/产物验收。

## 9. 可测试性

| 层级 | 合约或场景 | 测试类型 | 证据 |
| --- | --- | --- | --- |
| 单元 | CLI 路由、配置选择、缺失维度 | Node unit | `agent-cli`、`devops-run` tests |
| 集成 | dry-run 结构化输出 | process integration | dispatcher test |
| 系统 | 模板 apply 所有权与收敛 | template integration | update-template test + 目标 dry-run |
| 单元/集成 | 四类容器目录缺失、重复初始化和非法目标 | Node unit/process integration | shared config、worktree、task、devops tests |

## 10. 风险与验证表

| ID | 风险类型 | 影响 | 缓解/负责人 | 截止 |
| --- | --- | --- | --- | --- |
| R-001 | profile fallback | 操作错误目标 | 精确查找 + @template-maintainers | TDD Gate |
| R-002 | alias 实现缺失 | 配置可解析但项目脚本执行失败 | 模板只登记规范名称；目标项目负责实现或覆盖，传播验收检查目标 alias | ARCH/QA Gate |
| R-003 | project-owned overwrite | 目标行为损坏 | manifest 收敛测试 + @qa | QA Gate |
| R-004 | 配置读取隐式创建目录 | 只读命令污染文件系统 | 解析与初始化 API 分离，只在写入边界显式调用 | TDD Gate |
| R-005 | 文件或链接冒充容器目录 | 写入越界或状态损坏 | `lstat` 复核真实目录，异常 fail closed | TDD Gate |

## 11. 实现约束

- 必须：模板配置登记 mac、win、ios、android 的 dev/build 默认与 private 变体、本地服务五项生命周期默认与 private 变体、dev/staging/prod 服务端 build 默认与 private 变体。
- 必须：`ship` 只保留配置槽且无可执行默认值；显式清空或未知维度时 `STATUS=BLOCKED`。
- 禁止：在模板中写入 XiaoLan 名称、端口、URL、脚本或签名参数。
- 可选：项目通过同名 package aliases 实现规范名称，或在 `agent.config.json` 覆盖为项目命令。
- TASK 拆分提示：先负向测试，再路由和选择器实现，最后传播验收。
- 必须：容器目录初始化集中于共享 helper；调用方声明目录需求，禁止复制散落的 `mkdir` 与 `../tmp` 路径猜测。
- 必须：项目命令启动前提供已创建的 `AGENT_TMP_DIR`、`AGENT_CACHE_DIR`、`AGENT_ARTIFACTS_DIR`；只读命令不触发全量目录创建。

## 12. Story/Component 追溯表

| Story | Component |
| --- | --- |
| US-CMDSURF-001 | CMDSURF-API-001、CMDSURF-SVC-001 |
| US-CMDSURF-002 | CMDSURF-API-001、CMDSURF-SVC-002 |
| US-CMDSURF-003 | CMDSURF-SVC-001、CMDSURF-SVC-002 |
| US-CMDSURF-004 | CMDSURF-SVC-002、模板 manifest |
| US-CMDSURF-005 | CMDSURF-SVC-003、CMDSURF-SVC-001 |

## 13. 完成检查

- [x] PRD Story/AC 均有架构落点。
- [x] 边界、合约、数据和失败路径明确。
- [x] 安全、兼容和可观测性可测试。
- [x] 无迁移或新部署单元。
- [x] 风险有验证 Gate。
