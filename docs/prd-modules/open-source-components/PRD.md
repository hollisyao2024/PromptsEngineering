# 开源组件能力包 - PRD

主纲：[PRD](../../PRD.md)。状态：已确认。依据：用户明确要求实施此前全部推荐组件，不仅 OSS。存储需求继续由 [文件模块](../file-storage/PRD.md) 持有。US-OSSKIT-009 依据：用户 2026-10-06 提出的业务测试自动化目标（闭环见 [业务测试自动化](../business-testing/PRD.md)，3.9.0 已合并）；2026-10-07 用户回复“继续”，据此按对话中声明的范围交付其驱动脚手架。

## 1. 模块概述

为多端 Monorepo 提供按需可生成、可运行、可升级的公共能力。覆盖 Better Auth、CASL/Prisma、pg-boss、BullMQ Redis/PG、Uppy、Tiptap、Recharts/shadcn Chart、TanStack Virtual、dnd-kit、React Flow、i18next/react-i18next、Pino、OpenTelemetry、MSW，以及业务测试驱动 Playwright（`e2e` 驱动脚手架）。已有 shadcn/Table/Query/RHF/Zod/Prisma 保留。

`e2e` 是面向 UI 应用的可选模块：生成 Playwright 驱动脚手架，使 3.9.0 的业务测试闭环（`qa paths`、`qa run`、`qa verify` 业务门禁）在 Web 端开箱可接入，而不改变该闭环的接口契约。

## 2. 范围与约束

Auth.js、Keycloak、Casbin、Temporal、Asynq、MinIO SDK、Unstorage 为有采用条件的备选，进入清晰选型与状态目录；本轮不把尚未验证或已知审计阻断的备选标成可初始化实现。商业插件/托管服务不默认启用，不创建实际身份/云资源，不运行生产数据库迁移或改变其他实际项目。

`e2e` 范围：Web 端与 Tauri 的 Web 层；生成配置、示例用例与说明，并给出可粘贴的套件配置片段。非范围：iOS、Android 与原生桌面驱动（仍由项目按业务测试契约自选）；改写项目的 `agent.config.json`；下载浏览器；启动真实后端或数据库；替项目编写 PRD 原子 AC 与路径模型；flaky 重试、突变采样等质量策略（后续另行立项）。

## 3. 用户故事与验收

| Story | Given / When / Then | Test |
| --- | --- | --- |
| US-OSSKIT-001 | AC-OSSKIT-001-01：Given 明确能力选择，When plan/init，Then 仅安装依赖闭包，未选择的旧配置不变；不支持的语言、缺前置、冲突选型拒绝 | TC-OSSKIT-001 |
| US-OSSKIT-002 | AC-OSSKIT-002-01：Given Better Auth 与 Prisma PG/SQLite，When 注册/登录/会话/组织及权限访问，Then 真数据库路径有效，CASL 读写限制跨主体数据，UI 可见权限不替代服务端校验 | TC-OSSKIT-002 |
| US-OSSKIT-003 | AC-OSSKIT-003-01：Given pg-boss 或 BullMQ 后端，When 投递/重试/恢复/关闭，Then 任务可持久恢复、幂等边界明确；PG 迁移显式，SQLite 不伪装支持 | TC-OSSKIT-003 |
| US-OSSKIT-004 | AC-OSSKIT-004-01：Given 上传/编辑/图表/拖拽/流程选项，When 操作组件，Then shadcn 组合、键盘和失败恢复有效；Tiptap 仅开源能力、React Flow 不冒充后端执行器 | TC-OSSKIT-004 |
| US-OSSKIT-005 | AC-OSSKIT-005-01：Given 大列表 DataTable，When 启用 TanStack Virtual，Then 保留稳定行 ID、排序/选择语义和可访问表结构，普通分页不强制虚拟化 | TC-OSSKIT-005 |
| US-OSSKIT-006 | AC-OSSKIT-006-01：Given 多语言与服务端日志/追踪，When 切换语言/请求失败/导出遥测，Then 语言实例隔离、Pino 脱敏、OTel 显式生命周期与导出配置，无凭据进入公开端 | TC-OSSKIT-006 |
| US-OSSKIT-007 | AC-OSSKIT-007-01：Given MSW 开发/测试，When 模拟错误与取消，Then 使用可组合处理器，生产不自动开启，真实集成测试独立执行 | TC-OSSKIT-007 |
| US-OSSKIT-008 | AC-OSSKIT-008-01：Given 定制消费者，When 升级/重新计划，Then 配置、业务策略/Schema/翻译保留、公共实现三方合并、重复收敛，逐项状态与证据明确 | TC-OSSKIT-008 |
| US-OSSKIT-009 | AC-OSSKIT-009-01：Given 项目已有至少一个 UI 应用并选择 `e2e`，When plan/init，Then 生成 Playwright 配置（每个 UI 应用一个 project 与 webServer）、git 忽略的 JUnit 报告路径、示例用例与 README，依赖精确固定并登记于依赖、审计与目录元数据；所有权登记为 `architecture:module:e2e`，二次 plan 无变更 | TC-OSSKIT-009 |
| US-OSSKIT-009 | AC-OSSKIT-009-02：Given 生成的驱动脚手架，When 接入业务测试闭环，Then 仅以 JUnit XML、用例名携带 AC/TC 标识与套件 `platform` 标签对接：不写入 `agent.config.json`，只提供可粘贴的 `qa.business.suites` 片段；失败重试为 0；不下载浏览器 | TC-OSSKIT-010 |
| US-OSSKIT-009 | AC-OSSKIT-009-03：Given 无 UI 应用、应用声明 `e2e` 或 `e2e` 带 `options`，When plan/init，Then 以明确错误拒绝且不写入文件；`workspace-check` 视 `e2e` 为私有根包，包内不定义 `test`、`build` 脚本以免被 workspace 聚合命令误运行 | TC-OSSKIT-011 |
| US-OSSKIT-009 | AC-OSSKIT-009-04：Given 真实 Playwright 驱动按生成配置运行示例用例，When 依次执行 `qa paths`、`qa run`、`qa verify`，Then 用例通过时门禁放行，故意令其失败后门禁阻断；真实报告中的失败、跳过与含 `]]>` 的失败体被 `qa run` 正确判定 | TC-OSSKIT-012 |

## 4. 非功能需求

所有推荐模块须有实际消费者安装、类型/构建和功能测试；按 npm 元数据固定兼容稳定版本并审计。Better Auth 与 Vitest 5 的 peer 冲突通过独立包隔离；CASL 7 绑定项目 Prisma TypeMap。数据库隔离使用合成数据，日志/报告无凭据。

`e2e` 精确固定 Playwright 1.62.1，即本机离线验证过的唯一版本；registry 最新 1.63.0 未实际运行，差异记入审计与 QA。驱动重试为 0，不以重试掩盖失败；JUnit 报告与 Playwright 输出不入库。

## 5. 依赖与风险

上传沿用文件模块 UX；编辑/拖拽/流程工具栏用 shadcn，空/失败/禁用/键盘与窄屏可用性有自动化验证；图表提供文本替代，流程画布具备可访问标签。国际化在项目词条之外维护公共默认词条。生产身份提供方、邮件、原生 OAuth 回调与遥测后端需要项目环境，未验证项单列。

`e2e` 依赖 [业务测试自动化](../business-testing/PRD.md) 的三项接口契约且不改变其语义。浏览器由项目显式获取（`playwright install` 或使用系统 Chrome），模板不下载；Tauri 只覆盖 `dev:web` 的 Web 层。模板源没有应用消费者，因此未启动真实 react-vite、next 开发服务器，该限制在 QA 披露；开发服务器端口冲突交由 Playwright 明确报错。

## 6. 里程碑与 Gate

PRD → ARCH → TASK → TDD → QA → 合并。用户已授权全量实现，不再逐项请求同意。US-OSSKIT-009 随 3.10.0 交付，同样按此流程执行。

## 7. 追溯矩阵与验证

追溯见 [矩阵](../../data/traceability-matrix.md)，验证证据见 [QA](../../qa-modules/open-source-components/QA.md)。
