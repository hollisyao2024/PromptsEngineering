# 开源组件能力包 - PRD

主纲：[PRD](../../PRD.md)。状态：已确认。依据：用户明确要求实施此前全部推荐组件，不仅 OSS。存储需求继续由 [文件模块](../file-storage/PRD.md) 持有。

## 1. 模块概述

为多端 Monorepo 提供按需可生成、可运行、可升级的公共能力。覆盖 Better Auth、CASL/Prisma、pg-boss、BullMQ Redis/PG、Uppy、Tiptap、Recharts/shadcn Chart、TanStack Virtual、dnd-kit、React Flow、i18next/react-i18next、Pino、OpenTelemetry、MSW。已有 shadcn/Table/Query/RHF/Zod/Prisma 保留。

## 2. 范围与约束

Auth.js、Keycloak、Casbin、Temporal、Asynq、MinIO SDK、Unstorage 为有采用条件的备选，进入清晰选型与状态目录；本轮不把尚未验证或已知审计阻断的备选标成可初始化实现。商业插件/托管服务不默认启用，不创建实际身份/云资源，不运行生产数据库迁移或改变其他实际项目。

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

## 4. 非功能需求

所有推荐模块须有实际消费者安装、类型/构建和功能测试；按 npm 元数据固定兼容稳定版本并审计。Better Auth 与 Vitest 5 的 peer 冲突通过独立包隔离；CASL 7 绑定项目 Prisma TypeMap。数据库隔离使用合成数据，日志/报告无凭据。

## 5. 依赖与风险

上传沿用文件模块 UX；编辑/拖拽/流程工具栏用 shadcn，空/失败/禁用/键盘与窄屏可用性有自动化验证；图表提供文本替代，流程画布具备可访问标签。国际化在项目词条之外维护公共默认词条。生产身份提供方、邮件、原生 OAuth 回调与遥测后端需要项目环境，未验证项单列。

## 6. 里程碑与 Gate

PRD → ARCH → TASK → TDD → QA → 合并。用户已授权全量实现，不再逐项请求同意。

## 7. 追溯矩阵与验证

追溯见 [矩阵](../../data/traceability-matrix.md)，验证证据见 [QA](../../qa-modules/open-source-components/QA.md)。
