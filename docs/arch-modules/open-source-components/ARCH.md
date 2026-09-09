# 开源公共能力架构

依据：[PRD](../../prd-modules/open-source-components/PRD.md)。覆盖 US-OSSKIT-001～008。用户已选定的推荐组件全部作为按需实现，备选目录独立记录条件和验证状态。

## 配置与目录

沿用 v2 modules，增加 auth、auth-client、authorization、jobs、i18n、logging、telemetry、api-mocks。需要配置的模块通过严格校验 options 记录 datastore、backend 等选择；applications.modules 明确消费关系。路径默认 packages/<module>，项目显式配置可映射。auth/auth-client 分包解决 Better Auth/Vitest peer 冲突，后端模块不允许被浏览器导入。

UI 在 componentSets 增加 uploads/editor/charts/sortable/flow/virtual-table。公共组合存放在 components.advanced（共享包为 packages/ui/src/advanced），依赖按组件闭包安装。shadcn 原子在 UI 层组合，第三方引擎只负责编辑/上传/图形/拖拽/虚拟化状态。虚拟化扩展唯一 DataTable，不复制排序、筛选和多选逻辑。

## 身份与权限

Better Auth 使用 Prisma 7 PG/SQLite，Schema 单独文件与只追加迁移；auth factory 显式接收 secret/baseURL/trustedOrigins，组织等插件开启范围可见。auth-client 只导出公开客户端。第三方 OAuth/邮件需要实际项目配置，示例会话不代替原生平台登录验收。

CASL 7 通过 @casl/prisma/runtime 绑定实际 Prisma.TypeMap，提供查询和条件写入包装，拒绝全部使用 createCaslExtension。默认策略文件 init-if-missing，由项目维护；不从请求体信任租户、角色，不把隐藏按钮作为授权。

## 后台任务

jobs options 选择 pg-boss/postgres 或 bullmq/redis|postgres，缺基础设施不回退。pg-boss 提供 fromPrisma 的同事务投递示例；BullMQ PG 显式迁移，Redis 跨数据库投递以业务幂等/Outbox 示例说明，不声称 exactly-once。提供有界任务数据校验、稳定 jobId、重试、取消和 graceful shutdown。队列 schema/连接由环境配置，初始化与普通启动不隐式执行生产迁移。

## UI 与工程基础

Uppy 作为上传引擎与文件会话适配；Tiptap 开源核心和 shadcn 工具栏；Recharts 与 shadcn Chart 使用语义 Token 并提供文本数据替代；dnd-kit 排序提供键盘可操作入口；React Flow 只编辑节点/边，不执行工作流。示例均保留空/失败/禁用与受控数据边界。

i18next 创建实例而非跨请求全局单例；项目词条 init-if-missing。Pino 服务端 JSON 日志递归脱敏并绑定请求上下文。OpenTelemetry 显式 start/shutdown，选择导出端点，不默认发送遥测；不在多次导入时重复注册 provider。MSW 为开发/测试工具，handlers 可组合，worker 由消费者 CLI 生成且生产不自动启动。

## 升级与验证

公共封装与组件 update，package.json 结构化合并，业务策略/词条/Schema init-if-missing，迁移 append。版本与许可证固定在清单，兼容问题按包隔离而非全局放宽 peer。consumer tests 覆盖真实 PG/SQLite、Redis、HTTP/SDK 适配、React 组件以及升级定制。Keycloak/Temporal 等备选只进入状态目录，不生成空壳或虚假成功命令。
