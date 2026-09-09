# Monorepo 与 Prisma 多端架构

状态：已定义，2026-09-09。需求见 [PRD](../../prd-modules/monorepo-platform/PRD.md)，决策见 [ADR-028](../../adr/028-arch-monorepo-prisma.md)。

## 1. 能力与依赖边界

agent 工作流包、architecture 架构包独立选择；模板源保留生成器、版本清单、维护的组件源码和必要工具代码。Prisma、驱动、React、Query 等运行依赖在实际消费者 workspace 安装。测试样例也属于隔离消费者，不向模板根安装所有技术栈，不提交 node_modules。

配置 v1 和既有 node/Go/SQL 迁移栈保持行为。v2 增加 workspace、blueprint、example 和 datastore.access；新增 node-ts 栈。workspace 首期支持 pnpm，其他包管理器须显式扩展，禁止悄悄转换。蓝图只在新建配置时展开一次，升级以保存的项目配置为准。

## 2. 组件与目录视图

### 组件/服务清单

| 单元 | 默认实际路径 | 职责 |
| --- | --- | --- |
| 应用 | apps/web、admin、api、worker、desktop | 独立运行入口；按配置选择 |
| UI | packages/ui/src/{ui,data-table,forms,selectors,feedback} | shadcn 基础控件与组合；workspace exports |
| domain | packages/domain | 纯业务 DTO/常量示例，无 ORM/React |
| contracts | packages/contracts | OpenAPI 3.1、生成的公开 TS 类型、运行时验证 |
| api-client | packages/api-client | 无 React 的类型化 HTTP 客户端、统一错误与取消 |
| query | packages/query | React Query key、分页缓存及写入失效 |
| 数据访问 | packages/database/<store> | 独立 Prisma schema、client、迁移目录、驱动 |
| platform | packages/platform | 浏览器/桌面能力端口与显式不支持结果 |
| config/observability | packages/config、observability | 环境校验、请求 ID、脱敏、错误协议 |

根 pnpm-workspace.yaml 精确登记实际包路径，保留已有 packages/catalog 配置；package.json 使用 workspace:*。单一根锁文件由 pnpm 维护。生成与构建按依赖顺序：contracts/database generate → 基础包 → api-client/query → 应用；类型检查和构建不得引用尚未生成的 client。

目录由 architecture.config.json 映射决定。移动已有目录需项目显式迁移，更新器不自动搬动业务源码。共享 UI 只实例化一份，消费端通过包 exports 引用；保留旧 v1 应用内 alias 行为。

## 3. 运行时、数据与接口

示例链路：shadcn DataTable/表单 → Query → API client → Node TS API → 请求校验/授权 → 业务服务 → Prisma → PostgreSQL 或 SQLite。

API 提供任务分页、查询、允许列排序、创建、版本控制修改、限定数量批删和按筛选/选中 ID 导出；公开模型不暴露 Prisma 类型。分页设上限并使用 ID 次序作为稳定排序兜底，批处理设上限，计数使用数据库查询，事务失败全回滚。响应包含 requestId 与稳定错误码；写权限在服务端校验，默认不提供可用的公共写密钥。示例认证可由项目替换，不能作为生产身份系统。

OpenAPI 是公开合约事实源，openapi-typescript 生成类型，运行时按 schema 校验请求与响应；生成物可重新生成且有过期检查。调用方传递 AbortSignal，Query key 纳入筛选/页码/排序，修改后失效列表缓存；UI 保留失败表单值，删除明确范围。

Prisma 使用一致稳定版本的 CLI/client/adapter，每个 store 一套 schema/output/migrations/env URL，每个进程一套 client。PG 和 SQLite 不共享迁移历史，不把数据库切换称为无损转换。Prisma 仅运行于 Node；浏览器访问 API，Tauri 原生本地数据库走宿主端口，不把 Node Prisma 打包到 Rust 宿主。

迁移由 Prisma Migrate 单独持有执行历史。显式 db:status/db:deploy 前对比磁盘迁移与 _prisma_migrations 的名称、SHA256 和失败状态；缺失、修改、失败均阻断。新迁移可以 pending，初始化和模板更新不连接/写入数据库。已有 SQL 栈保持原迁移器，采用 Prisma 时需项目显式选择/迁移，不自动生成第二份执行账本。

开发、测试与 shadow URL 单独配置；SQLite 默认样例路径位于各自 worktree，PG 隔离 schema 由显式准备命令建立。脚本不推断或清空生产数据库，不使用隐式 reset。

## 4. 多端与公共能力

AppShell 用共享 shadcn Button/Sheet 等实现导航，配合主题、错误边界及状态反馈。Browser adapter 提供受宿主能力约束的剪贴板、文件、通知、链接及存储；Tauri adapter 使用宿主插件/命令并声明 capability，unsupported 显式返回。桌面默认在线 API 模式；原生 SQLite 需要项目另行接入宿主数据协议，当前蓝图默认不启用；数据库选择不隐含本地/云端同步。

不预设移动框架、登录供应商、租户模型、队列、搜索引擎及离线同步策略。目录可预留，未实现的能力明确标识，不输出虚假的可运行模板。

## 5. 预置组合

| 蓝图 | 默认组合 | 数据库 |
| --- | --- | --- |
| admin-api | Admin + Node TS API | PostgreSQL，可选 SQLite |
| fullstack | Web + Admin + API | PostgreSQL，可选 SQLite；Worker 可独立追加 |
| web-desktop | Web + Tauri + API | PostgreSQL，可选 SQLite；默认在线 |
| local-private | Admin + API + private 发布配置 | SQLite |

蓝图引用同一套模块，保存展开后的选择与 blueprint 版本供追溯，不持有后续项目决策。已有配置与 --blueprint 同时传入时阻断，避免升级重新选择架构。

## 6. 所有权与升级

| 文件 | 策略 |
| --- | --- |
| 模板协议、生成器、标准 | overwrite，校验本地漂移 |
| 共享组件/通用包装器 | update，基线三方合并 |
| package.json、workspace YAML | 结构化三方合并，保留项目键，冲突阻断 |
| 项目架构选择、业务 schema/业务服务/公开合约 | init-if-missing，之后项目持有 |
| 已发布迁移 | append，不修改历史 |
| Prisma client、合约生成物 | 工具生成、忽略/检查，不回灌 |
| pnpm-lock.yaml | 包管理器生成、提交实际项目，不由模板硬拷贝 |
| .env、数据库文件 | 项目私有，不覆盖、不回灌 |

保持固定 SHA 来源、冻结 plan、源/目标哈希、外部 journal 与恢复协议。引擎新增 YAML 策略使用固定版本的成熟解析器工具代码（含许可证/来源），离线 updater 不依赖消费者先安装应用栈。未识别 YAML/不安全键阻断。

## 7. 安全、运维与验证

- 跨包边界检查覆盖浏览器导入 database/server、应用间源码穿透、业务原生交互控件与绕开 DataTable；测试负例证明阻断。
- 服务端环境 fail closed，日志脱敏 token/password/authorization，requestId 贯穿 API 错误与客户端。
- 初始化安装后显式 generate/typecheck/build，不触发 schema push/migrate/reset，不连接真实数据库。
- 本次仅运行隔离测试数据库和消费者；实际生产部署、签名、多平台发版不在本次范围。
- PRD 九项验收分别映射 workspace、Prisma、migrations、contracts、CRUD UI、platform、config、blueprints、upgrade 测试；真实数据库和浏览器证据记录在 QA 模块。
- 高风险范围为更新引擎、数据库事务/迁移及共享边界；进行语义审查。Codex review skipped by policy，不替代测试和 QA。

## 8. 外部依据

[Prisma Monorepo](https://www.prisma.io/docs/guides/deployment/pnpm-workspaces)、[多数据库](https://www.prisma.io/docs/guides/database/multiple-databases)、[迁移生产流程](https://docs.prisma.io/docs/orm/v7/prisma-migrate/workflows/development-and-production)、[pnpm workspace](https://pnpm.io/workspaces)、[shadcn Monorepo](https://ui.shadcn.com/docs/monorepo)、[OpenAPI TypeScript](https://openapi-ts.dev/introduction)。版本以兼容性验证后的 dependencies.json 为准，不把 npm latest 的预发布版本当作稳定版本。

## 9. 接口、数据与风险追溯

### 提供的接口

Task API 的 GET/POST/DELETE /tasks、PATCH /tasks/{id}、GET /tasks/export，由 OpenAPI 3.1 定义请求/响应；公开客户端、Query hooks、UI 和平台端口通过 workspace exports 使用。health 用于只读存活验证，不返回运行密钥。

### 依赖的接口

API 依赖 Prisma Task 的查询与事务；迁移守卫依赖 Prisma CLI 和数据库执行账本。平台端口依赖浏览器受限能力或所选 Tauri 插件。公开组件不依赖服务端 Prisma/config/observability，具体依赖版本及兼容覆盖记录在 dependency-audit.json。

| 表名 | 所属存储 | 用途 | 所有权 |
| --- | --- | --- | --- |
| Task | 所选 Prisma store | 任务示例及乐观版本 | 首次初始化后项目维护 |
| _prisma_migrations | 同一 Prisma store | 已执行迁移名称、摘要、完成/回滚状态 | Prisma Migrate 唯一维护 |

字段、约束和索引见 [数据字典](../../data/dictionary.md) 及 [ERD](../../data/ERD.md)。

风险与验证表：

| 风险类型 | 处理及验证 |
| --- | --- |
| 合约、授权及并发 | 请求/响应 2020-12 校验、有界输入、服务端授权、条件版本和事务回滚负例 |
| 升级破坏本地定制 | v1 兼容、三方合并、不可变迁移、原始 3.1 快照升级、冻结计划漂移/恢复 |
| 跨端与共享依赖 | packages 边界检查、共享 Tailwind 扫描、独立消费者生成/构建、Chrome 和 macOS 原生验证 |
| 工具链供应链 | 固定兼容版本、按选择安全 overrides、消费者审计、vendor 来源摘要和许可证 |

Story/Component 追溯表由 [九项验收矩阵](../../data/traceability-matrix.md) 与 [模块 QA](../../qa-modules/monorepo-platform/QA.md) 共同维护，运行证据位于容器 tmp，避免将运行日志写入架构决策。
