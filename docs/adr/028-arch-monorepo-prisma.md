# ADR-028：多端 Monorepo、按需依赖与 Prisma

状态：Accepted；日期：2026-09-09；依据：用户已授权全自动实施。

实际项目是一个多端复合应用，蓝图只是首次选择的便捷入口。采用 pnpm workspace 共享 UI、合约、API client、Query 与基础能力；架构配置 v2 保持 v1 兼容。Node TS 项目采用 Prisma，PostgreSQL 与 SQLite 各自维护客户端和迁移历史，Go 与原生宿主保留独立数据访问实现。

模板源码维护版本清单和可实例化源码；应用依赖只安装于选择了该能力的实际项目或隔离验证样例。这样 agent-only 升级不需要应用技术栈，生成器也不依赖项目安装顺序。必要的 YAML 解析器属于更新器工具代码，固定版本并携带许可证。

业务 schema、公开 API 与服务首次生成后归项目；包装器/组件三方更新，迁移只追加，package/workspace 结构化合并，generated 与包管理器锁分别由对应工具生成。升级不自动切数据库、不执行迁移，也不重新展开蓝图覆盖项目决策。

代价是必须维护真实消费者兼容性矩阵、迁移历史检查、包边界和冻结计划恢复测试。详见 [架构](../arch-modules/monorepo-platform/ARCH.md)。
