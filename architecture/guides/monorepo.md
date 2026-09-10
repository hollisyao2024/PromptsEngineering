# 多端 Monorepo 与 Prisma 使用指南

息壤源码保存模板、维护的 shadcn/组合组件源码、版本清单和必要的更新器工具。它不安装全部应用依赖。实际项目选定蓝图或显式架构配置后，初始化器才在消费者根安装 workspace；Go/Rust 工具链仍由使用者准备。验证所需依赖在隔离消费者建立，不把 node_modules、数据库、Prisma Client 或构建产物提交到模板源。

实际项目只获得轻量架构入口，完整生成器和未选蓝图留在固定版本的源码缓存。蓝图不是强制套餐：小型项目可只选一个应用与必要组件，后续显式增加端、存储或公共模块。获取工具用 template sync --include architecture；采用选择用 init/update。来源与缓存协议见 [架构入口](../README.md)。

## 新建项目与预置组合

在实际项目的 linked worktree 中运行：

~~~bash
pnpm agent -- architecture catalog
pnpm agent -- architecture plan --blueprint admin-api --database sqlite
pnpm agent -- architecture init --blueprint admin-api --database sqlite
pnpm build
pnpm type-check
~~~

空目录也可以从息壤源码使用 node architecture/scripts/cli.js init --target <空目录> --blueprint admin-api --database sqlite。plan/dry-run 不写入项目文件；轻量入口在缺失缓存时会准备固定源码。init --no-install 只生成文件，随后用 architecture install-deps 安装并生成客户端，使用 architecture check 检查边界与生成物。

| 蓝图 | 实际应用 | 默认存储 |
| --- | --- | --- |
| admin-api | apps/admin + apps/api | PostgreSQL |
| fullstack | apps/web + apps/admin + apps/api | PostgreSQL |
| web-desktop | apps/web + apps/desktop + apps/api | PostgreSQL，桌面默认在线 API |
| local-private | apps/admin + apps/api + infra/private | SQLite |

--database 支持 postgres 或 sqlite，仅与首次 --blueprint 一起使用。蓝图展开后保存为 schemaVersion: 2 的 architecture.config.json，并记录蓝图版本；后续以这份项目文件为准。已有配置时禁止重新展开蓝图。Worker、其他前端、Go、其他数据库和移动框架应按项目需求选择；本次蓝图不包含特定队列、身份供应商、租户或离线同步实现。

## 工作区与目录

v2 使用 pnpm@10 固定补丁版本，单一根 pnpm-workspace.yaml 与 pnpm-lock.yaml。包路径由项目配置决定，支持 packages/database/main 等嵌套包；不搬动旧目录。包间使用 workspace:*，公共 UI 为 @project/ui，通过 exports 引用，不穿透 apps 源码。

默认共享目录：
- packages/ui/src/{ui,data-table,forms,selectors,feedback}，AppShell 位于 src/app-shell.tsx；兼容工具位于 lib/utils.ts。
- packages/domain：项目领域值。
- packages/contracts：OpenAPI 3.1、公开生成类型及运行时验证。
- packages/api-client：无 React 的类型化 HTTP 客户端，取消、超时和统一错误。
- packages/query：React Query、查询键、写入失效及冲突后的刷新。
- packages/database/<store>：独立 Prisma 包。
- packages/platform：浏览器端口；选中 Tauri 时追加宿主适配与插件依赖。
- packages/config、packages/observability：服务端环境、请求 ID、错误和脱敏日志。

pnpm generate 先生成数据库客户端和 API 类型；pnpm build 按依赖拓扑构建。pnpm type-check / test:workspace 会先构建需要导出声明的基础包。各 worktree 自有 node_modules，可共享 pnpm 内容缓存。根锁文件由 pnpm 生成并随实际项目提交；xirang.lock.json 记录模板版本及所有权，两者职责不同。

OpenAPI 生成器的 peer 依赖仍要求 TypeScript 5，contracts 包独立使用 5.9.3，其余应用沿用兼容 TypeScript API 的 6.0.3。CLI/client/Prisma driver adapter 固定一致版本 7.10.0；未选择 npm latest 指向的 8 RC。SQLite 使用适配器兼容范围内的 better-sqlite3 12.11.1。完整原因在 dependencies.json 和 dependency-audit.json。

## Prisma、数据库与迁移

每个存储独立维护：

~~~text
packages/database/main/
├── prisma/schema.prisma
├── prisma/migrations/<14位时间>_<名称>/migration.sql
├── prisma.config.ts
├── src/client.ts
├── src/generated/              # prisma generate，可重建
├── migrate.mjs
├── environment.mjs
└── .env.example
~~~

access: prisma 仅用于 node-ts 消费者；数据库 engine 可以分别选择 postgres 或 sqlite。每个包一份单例客户端，也可 createDatabase(url) 注入隔离连接并在退出时断开。多存储使用 DATABASE_<STORE_ID>_URL，兼容显式 DATABASE_URL；优先使用 store 专用变量，避免同进程连接混淆。

先在所选数据库包运行 pnpm db:prepare，独占创建私有 .env；已有文件不会覆盖。SQLite 文件名和 PostgreSQL schema 示例包含当前包真实路径派生的隔离标识；开发、TEST 与 SHADOW 分开。PostgreSQL 还需填写凭据、创建目标数据库。生成/更新不会连接数据库。

在已核对的目标环境中显式执行：

~~~bash
pnpm --filter @project/database-main db:status
pnpm --filter @project/database-main db:deploy
pnpm --filter @project/database-main generate
pnpm build
~~~

开发改 Schema 后使用 db:dev --name <名称>，PostgreSQL 要求独立 SHADOW_DATABASE_URL；显式生成客户端，不假定 Prisma 7 自动 generate。生产仅使用已审查的 db:deploy。迁移前备份、扩展/收缩和补偿由项目管理，模板不会自动 reset。

Prisma Migrate 是唯一迁移执行历史；migrate.mjs 比对磁盘与 _prisma_migrations，已应用 SQL 被修改/缺失、失败或重复历史都会非零退出。新迁移可 pending。旧 v1 SQL 执行器及 migrations.json 保持不变，不能为同一库同时运行两套迁移器。既有 SQL 项目采用 Prisma 的反向建模/历史接管应作为单独迁移；模板禁止通过修改 engine/access 自动切换数据库。

PG 与 SQLite 的 Schema、驱动及迁移不能互换，不自动同步数据。浏览器只能通过 API 访问；Tauri 蓝图采用在线 API，本地文件/剪贴板等由宿主接口处理。需要桌面离线数据库时必须另行确定原生宿主数据协议和同步策略，不能把 Node Prisma 直接放进 Rust/WebView。

## 真实任务示例

四个蓝图都提供任务 CRUD 页面。服务端支持页大小/查询上限、允许字段筛选排序、稳定 ID 排序兜底、乐观版本控制、原子批量删除和按页/筛选/选中 ID 导出。导出最多 1000 条，批量 ID 最多 100；CSV 公式类文本按字面量输出。

先初始化数据库，再在 apps/api/.env 设置至少 24 字符的随机 API_WRITE_TOKEN，使用 pnpm --filter @project/api dev 启动 API，另一终端运行对应 Web/admin 的 pnpm dev。页面令牌输入只保存在内存，不能放进 VITE_* 或 NEXT_PUBLIC_*。

开发示例允许只读列表，写入/导出必须验证令牌；production 还对读取强制授权，并拒绝缺少令牌的配置。这是可替换的示例授权边界，实际项目的用户身份与数据权限由项目实现。失败保留表单输入；写入成功失效列表缓存，版本冲突刷新列表。公开 API 返回 DTO 和 requestId，不输出 Prisma 内部模型。

OpenAPI 的业务 contract 和 domain/service 文件首次生成后归项目。修改 OpenAPI 后运行 pnpm generate；generate.mjs --check 检查公开类型是否过期。服务端同时验证请求与响应。type-only 导入也不得把 Prisma 模型传入前端。

## 平台与检查

AppShell 提供共享导航、窄屏 Sheet、主题和错误边界；页面交互控件来自 shadcn，业务表格只使用公共 DataTable。语义容器元素仍使用正常 HTML。

Browser adapter 的文件选择、剪贴板、通知受浏览器支持和权限约束，缺失时返回 unsupported；取消和拒绝有明确结果。Tauri 使用 dialog/fs/clipboard/notification/opener/store 插件，文件范围来自用户选择，外链限制 http/https/mailto；不支持的宿主不会伪装成功。桌面默认 CSP 允许本地 API，远程 API 域名由项目明确配置。

architecture check 验证 workspace 成员、包名、单根锁、UI 依赖、Prisma provider、已发布迁移和源代码边界：禁止 apps 之间源码穿透、packages 反向依赖应用，以及浏览器/公共包依赖服务端数据库、配置或日志实现。生产和跨平台能力仍应由项目自己的构建与验收覆盖。

## 更新、覆盖与追加

| 内容 | 所有权 |
| --- | --- |
| 模板协议、生成器、版本清单 | 覆盖，先校验本地漂移 |
| shadcn/组合控件、通用包装器 | 三方更新，保留可合并定制 |
| package.json、workspace YAML | 结构化合并，保留项目键与注释，冲突阻断 |
| 架构配置、业务 Schema、OpenAPI、业务服务/页面 | 仅初始化，后续由项目维护 |
| 已发布 SQL | 只追加，不改旧文件 |
| Prisma Client、API 生成类型、dist、依赖目录 | 工具重建，不回灌 |
| pnpm-lock.yaml、Cargo.lock | 消费者包管理器维护 |
| .env、数据库文件、RULES.md | 项目持有，模板不覆盖 |

更新遵循 plan → 冲突检查 → apply → 收敛 dry-run → 安装/generate/check/build。冻结计划校验源、目标、版本锁和基线；中断使用已有 journal 恢复，不能盲目重放迁移。新蓝图版本不重写项目选择，v1 也不会在普通同步时自动变成 v2。

## 依赖审计与复验

所选消费者根 package.json 的 pnpm.overrides 固定 Prisma/OpenAPI 工具链的安全修复依赖（deepmerge-ts 8.0.2、mysql2 3.24.4、js-yaml 4.3.2），仅在对应模块被选择时生成。升级这些覆盖项必须重跑 generate、迁移及契约测试；不把工具链内部 MySQL 驱动视为新增 MySQL 架构支持。Query 缓存按客户端身份隔离；认证上下文改变时重新创建客户端，凭据不进入缓存键。OpenAPI 3.1 的运行时校验使用 Ajv 2020-12 与格式校验。
