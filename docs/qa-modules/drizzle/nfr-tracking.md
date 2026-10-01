# Drizzle NFR

| 指标 | 口径 | 状态 | 证据 |
| --- | --- | --- | --- |
| 非法选择/历史负向门禁 | 非零退出，禁止接管或改写 | Pass | 单元/实库迁移日志 |
| 主体/版本条件写入 | owner/store/version 原子 CAS | Pass | 四种 Drizzle 实测 |
| 事务一致性 | 失败无业务写入；PG 任务/队列共同回滚 | Pass | 实库与 API 日志 |
| 本地 API 性能 | p95<500ms、p99<1500ms、错误数0，单并发 smoke | Pass | drizzle-qa-performance.log |
| 隔离与隐私 | 合成数据、独立消费者；秘密不进入源/报告 | Pass | 目标守卫/配置检查 |
| 生产容量/真实云 | 本次非目标 | N/A | PRD 范围 |

