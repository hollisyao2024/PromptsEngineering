# QA 总纲

## 1. QA 概览

息壤源码按功能模块记录验证。当前 3.3 交付覆盖开源能力、统一文件存储、认证/权限/队列、高级 UI 与兼容升级；测试结论为 Go。本机 QA receipt、主干同步及 completion guard 决定最终交付状态。

## 2. 模块索引

| 模块 | 报告 | 本轮范围 |
| --- | --- | --- |
| 开源公共组件 | [QA](qa-modules/open-source-components/QA.md) | 全组件、真实 DB/队列/浏览器/性能与旧版升级 |
| 统一文件存储 | [QA](qa-modules/file-storage/QA.md) | Node/Go 适配、会话、元数据、安全与恢复 |
| 多端 Monorepo 与 Prisma | [QA](qa-modules/monorepo-platform/QA.md) | 九项 AC、真实数据库/浏览器/原生与旧版升级 |
| 双能力包与架构落地 | [QA](qa-modules/architecture-platform/QA.md) | 第 8 节：公共 UI 新增 5 项 AC、嵌套日期修复、生成与升级矩阵；第 2～7 节保留历史基线 |
| 模板命令面 | [QA](qa-modules/template-command-surface/QA.md) | 既有命令、官方同步和生命周期兼容回归 |
| 环境文件初始化 | [QA](qa-modules/environment-file-initialization/QA.md) | 既有初始化和文件所有权兼容回归 |

索引：[模块清单](qa-modules/module-list.md)。详细证据、缺陷、NFR 只维护在模块报告。

## 3. 全局测试策略

使用源回归、隔离消费者集成、浏览器和原生验证；质量范围、环境与限制见各模块报告。

## 4. 跨模块整合与集成测试

本轮覆盖初始化/更新器 → workspace → 数据与契约 → API/Query → 公共表格和宿主接口的完整链路。

## 5. 全局执行矩阵与指标

详细指标和执行矩阵在模块 QA 中维护，全局追溯见 docs/data/traceability-matrix.md；不在总纲重复运行日志。

## 6. 全局缺陷汇总与回流

新发现缺陷先回流 TDD 后复验，详情见各模块 defect-log.md。合并前要求 P0/P1 全关闭。

## 7. 模块 QA 总览

PRD/ARCH/TASK/QA 模块集合一致，使用上表报告及模块清单作为索引。

## 8. 发布建议

模块验收 Go 后仍需本地 QA receipt、PR 合并、主干同步与 completion guard；实际部署由项目单独管理。

## 9. 部署记录

本轮交付模板源码，不部署生产环境；测试构建不是生产发布记录。

## 10. 追溯 & 附录

[追溯矩阵](data/traceability-matrix.md)、[模块清单](qa-modules/module-list.md)、[变更历史](../CHANGELOG.md)。
