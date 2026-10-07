# 开源公共能力架构

依据：[PRD](../../prd-modules/open-source-components/PRD.md)。覆盖 US-OSSKIT-001～009。用户已选定的推荐组件全部作为按需实现，备选目录独立记录条件和验证状态。US-OSSKIT-009 的决策见 [ADR-039](../../adr/039-arch-e2e-driver-scaffold.md)。

## 配置与目录

沿用 v2 modules，增加 auth、auth-client、authorization、jobs、i18n、logging、telemetry、api-mocks、e2e。需要配置的模块通过严格校验 options 记录 datastore、backend 等选择；applications.modules 明确消费关系。路径默认 packages/<module>，项目显式配置可映射。auth/auth-client 分包解决 Better Auth/Vitest peer 冲突，后端模块不允许被浏览器导入。

UI 在 componentSets 增加 uploads/editor/charts/sortable/flow/virtual-table。公共组合存放在 components.advanced（共享包为 packages/ui/src/advanced），依赖按组件闭包安装。shadcn 原子在 UI 层组合，第三方引擎只负责编辑/上传/图形/拖拽/虚拟化状态。虚拟化扩展唯一 DataTable，不复制排序、筛选和多选逻辑。

## 身份与权限

Better Auth 使用 Prisma 7 PG/SQLite，Schema 单独文件与只追加迁移；auth factory 显式接收 secret/baseURL/trustedOrigins，组织等插件开启范围可见。auth-client 只导出公开客户端。第三方 OAuth/邮件需要实际项目配置，示例会话不代替原生平台登录验收。

CASL 7 通过 @casl/prisma/runtime 绑定实际 Prisma.TypeMap，提供查询和条件写入包装，拒绝全部使用 createCaslExtension。默认策略文件 init-if-missing，由项目维护；不从请求体信任租户、角色，不把隐藏按钮作为授权。

## 后台任务

jobs options 选择 pg-boss/postgres 或 bullmq/redis|postgres，缺基础设施不回退。pg-boss 提供 fromPrisma 的同事务投递示例；BullMQ PG 显式迁移，Redis 跨数据库投递以业务幂等/Outbox 示例说明，不声称 exactly-once。提供有界任务数据校验、稳定 jobId、重试、取消和 graceful shutdown。队列 schema/连接由环境配置，初始化与普通启动不隐式执行生产迁移。

## UI 与工程基础

Uppy 作为上传引擎与文件会话适配；Tiptap 开源核心和 shadcn 工具栏；Recharts 与 shadcn Chart 使用语义 Token 并提供文本数据替代；dnd-kit 排序提供键盘可操作入口；React Flow 只编辑节点/边，不执行工作流。示例均保留空/失败/禁用与受控数据边界。

i18next 创建实例而非跨请求全局单例；项目词条 init-if-missing。Pino 服务端 JSON 日志递归脱敏并绑定请求上下文。OpenTelemetry 显式 start/shutdown，选择导出端点，不默认发送遥测；不在多次导入时重复注册 provider。MSW 为开发/测试工具，handlers 可组合，worker 由消费者 CLI 生成且生产不自动启动。

## 业务测试驱动（e2e）

服务 US-OSSKIT-009（AC-OSSKIT-009-01～04），决策见 [ADR-039](../../adr/039-arch-e2e-driver-scaffold.md)，闭环契约见 [业务测试自动化 ARCH](../business-testing/ARCH.md)。`e2e` 是可选模块，默认 `packages/e2e`、包名 `@project/e2e`、所有权 `architecture:module:e2e`；它是私有根包，不进入应用的 `modules`，不导出 API。

**校验**（`plan` 阶段、写任何文件之前）：v2 workspace；至少一个 UI 应用（manifest 中 `stacks.<stack>.ui` 非空）；没有应用声明 `e2e`；不接受 `options`。

**接口契约**（沿用业务测试自动化，不新增也不改变）：

| 契约 | e2e 的做法 | 服务的验收 |
| --- | --- | --- |
| JUnit XML 报告 | Playwright junit reporter 写 `reports/junit.xml`，相对配置文件目录解析；`reports/` 写入模块 `.gitignore`（R-BIZ-008）；路径只出现在配置文件，不在套件 `command` 中内联（R-BIZ-009） | AC-OSSKIT-009-01、009-04 |
| 用例名携带 AC/TC 标识 | `describe` 标题含 AC 标识，`test` 标题含 TC 标识；示例用例使用占位标识，项目改为 PRD 真实标识 | AC-OSSKIT-009-02、009-04 |
| 套件 `platform` 标签 | README 的可粘贴片段使用 `web`；模块不写 `agent.config.json` | AC-OSSKIT-009-02 |

**生成物**：

| 文件 | 策略 | 说明 |
| --- | --- | --- |
| `playwright.config.ts` | update | 每个 UI 应用一个 project 与 webServer；`retries` 为 0；`reuseExistingServer` 为 `false`；校验 `E2E_BASE_PORT` |
| `src/apps.ts` | update | 应用 id、栈与启动命令（`{port}` 占位），随 `architecture.config.json` 生成 |
| `tests/<应用 id>/sample.spec.ts` | init-if-missing | 示例用例，项目改写后归项目 |
| `README.md` | update | 用法、环境变量、浏览器获取方式与可粘贴的套件片段 |
| `package.json`、`tsconfig.json` | merge-json | 无 `exports`；脚本只有 `type-check` 与 `e2e`；`@playwright/test` 为 devDependencies |
| `.gitignore` | append-lines | `node_modules/`、`reports/`、`test-results/`、`playwright-report/` |

**运行**：端口为 `E2E_BASE_PORT`（默认 4310）加应用序号；每个应用的启动命令是 `pnpm --filter @project/<应用 id> run <脚本与端口参数>`，其中 react-vite 为 `run dev --port {port} --strictPort`，react-next 为 `run dev -p {port}`，tauri 为 `run dev:web --port {port} --strictPort`（只启 Web 层），`{port}` 在配置中替换为该应用的端口。`E2E_BROWSER_CHANNEL` 选择系统浏览器，`E2E_SKIP_WEBSERVER=1` 针对已启动的服务运行。

**边界**：`workspace-check` 的私有根包列表加入 `e2e`；包内不定义 `test`、`build`、`generate`，避免根目录聚合命令误启动浏览器与开发服务器，`type-check` 保留。

**选型**：

| 选项 | 决策 | 原因 |
| --- | --- | --- |
| Playwright 1.62.1，精确固定 | 采用 | 内置 JUnit reporter、`webServer` 与多 project；该版本已在本机以真实浏览器运行验证 |
| Playwright 1.63.0（npm 最新） | 暂不采用 | 未实际运行，不把未验证版本写入模板；差异记入审计与 QA，升级须重跑真实驱动证据 |
| 其他浏览器驱动（Cypress、WebdriverIO 等） | 不采用 | 未评估也未运行；驱动无关契约允许项目自选，不被阻断 |
| iOS、Android、原生桌面驱动 | 范围外 | 依赖原生工具链；项目按契约自选 Maestro、XCUITest、Espresso 等 |

**风险**：

| 风险 | 缓解 | 状态 |
| --- | --- | --- |
| 真实 react-vite、react-next 开发服务器对端口参数的处理未用真实依赖验证 | pnpm 参数透传与端口占用报错已实测；QA 披露，项目首次接入以一次真实运行确认 | 已披露 |
| Playwright 1.63.0 未验证 | 精确固定 1.62.1；升级重跑真实驱动证据 | 已接受 |
| 开发服务器端口冲突 | 独立 e2e 端口与 `reuseExistingServer: false`，冲突时 Playwright 以退出码 1 明确报错 | 已收敛 |
| 重试把失败变成通过 | `retries` 为 0 | 已收敛 |
| 报告被提交 | 模块 `.gitignore`，且 `qa run` 拒绝已跟踪的报告路径 | 已收敛 |
| 项目忘记替换示例占位标识 | 占位标识不在 PRD 中，`qa verify` 将其作为未知标识披露为风险，不会满足任何 AC | 已披露 |
| 驱动被根聚合命令误运行 | 包内不定义 `test`、`build`、`generate` | 已收敛 |

## 升级与验证

公共封装与组件 update，package.json 结构化合并，业务策略/词条/Schema init-if-missing，迁移 append。版本与许可证固定在清单，兼容问题按包隔离而非全局放宽 peer。consumer tests 覆盖真实 PG/SQLite、Redis、HTTP/SDK 适配、React 组件以及升级定制。Keycloak/Temporal 等备选只进入状态目录，不生成空壳或虚假成功命令。
