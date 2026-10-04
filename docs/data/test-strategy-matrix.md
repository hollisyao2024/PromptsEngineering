# 全局测试矩阵

历史模块沿各自 QA 维护；下表登记 3.5–3.7 增量模块与 3.4 及以前的回归基线。

| 模块 | 优先级 / 风险 | 验证策略与证据 |
| --- | --- | --- |
| [模板命令面](../qa-modules/template-command-surface/QA.md) | P0 任务记录/失败恢复、测试范围证据门禁、固定提交合并证据；P1 PR 摘要与合并提交格式 | 定向负例 + 原消费者回归、真实 Git 夹具、QA 双 SHA 回执；无业务 UI/数据库，不适用 E2E 与负载 |
| [Drizzle 数据访问](../qa-modules/drizzle/QA.md) | P0 schema/迁移、默认拒绝授权、事务与并发、源版本自动递增；P1 API 延迟 smoke | 四库矩阵、Kit 迁移部署/重放与篡改阻断、身份隔离、CAS 竞态、单并发 p95 基线 |
| [架构按需获取](../qa-modules/architecture-on-demand/QA.md) | P0 固定源/删除/缓存恢复；P1 入口/消费/作用域 | 447 源测试、3.3 升级 2/2、Web 20/20、真实冷缓存 CLI 与定向 SAST |
| [开源公共组件](../qa-modules/open-source-components/QA.md) | P0 身份/数据/升级；P1 UI/队列 | 源回归、PG/SQLite、三类队列、Chrome、k6、SAST/SCA |
| [统一文件存储](../qa-modules/file-storage/QA.md) | P0 主体/双写/路径/签名；P1 SDK/交互 | Node 协议、Go race/构建、CAS/恢复/重放、浏览器文件内容一致性 |

外部服务和生产容量的未验证项在各模块 nfr-tracking.md 记录；不以本地测试替代云账号/SSO 验收。
