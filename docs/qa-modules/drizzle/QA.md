# Drizzle 数据访问 QA

模块 ID：DRIZZLE · 状态：Passed · 日期：2026-10-01 · PR：[#122](https://github.com/hollisyao2024/PromptsEngineering/pull/122)

[主 QA](../../QA.md) · [PRD](../../prd-modules/drizzle/PRD.md) · [ARCH](../../arch-modules/drizzle/ARCH.md) · [TASK](../../task-modules/drizzle/TASK.md)

## 1. 验收范围与风险

验证四种 engine 的稳定 ORM 矩阵、四种 Drizzle 原生迁移与任务 API、身份权限/文件 CAS/同库队列事务、升级历史与默认兼容性。初始化不连接库，不接管已有迁移器，不自动切换 access/engine。生产数据、真实云、容量和新前端交互不在范围。

高风险：schema/迁移、授权默认拒绝、写入删除、事务与并发、共享数据包及浏览器边界；对应正反例与真实消费者已覆盖。缓存、外部 API 合约变更与 hotfix 为 N/A。Codex review skipped by policy；语义核查结论记录在 task state/PR。

## 2. 环境与复现

Node 24.19.0、pnpm 10.18.3；Prisma 7.10.0、Drizzle ORM 0.45.3、Kit 0.31.11，依赖与 audit 固定。每个消费者单独安装 node_modules；macOS arm64/Docker PostgreSQL 18.6、MySQL 8.4、MariaDB 11.4、SQLite/libSQL。仅回环地址、任务专属库/文件与合成数据。

任务 drizzle-support 的日志位于解析后的容器 tmp/agent-task-runs/drizzle-support/evidence；运行 task paths/context 可定位，日志摘要绑定交付 HEAD 见 TEST_SCOPE_RESULT。测试指定 XIRANG_CONSUMER 和 XIRANG_TEST_DATABASE_URL，拒绝非隔离目标。验证后精确清理本任务容器，保留日志与消费者。

## 3. 验收追踪与用例

| Story / AC | 用例 | 优先级 | 场景与预期 | 状态 |
| --- | --- | --- | --- | --- |
| US-DRIZZLE-001 / AC-DRIZZLE-001 | TC-DRIZZLE-001 | P0 | 合法选择生成/编译、非法组合写入前拒绝；任务 API 写读/CAS/合同不变 | Pass |
| US-DRIZZLE-002 / AC-DRIZZLE-002 | TC-DRIZZLE-002 | P0 | 生成两次 Kit 迁移并部署/重放；篡改/缺失/异常历史/恢复锁明确阻断 | Pass |
| US-DRIZZLE-003 / AC-DRIZZLE-003 | TC-DRIZZLE-003 | P0 | 注册→会话→组织隔离；SQL 权限默认拒绝；文件版本竞态一胜；任务/队列回滚 | Pass |
| US-DRIZZLE-004 / AC-DRIZZLE-004 | TC-DRIZZLE-004 | P0 | 旧 Prisma/SQL 与定制保留、迁移保护、重复更新收敛、客户端 SDK 泄漏阻断 | Pass |
| US-DRIZZLE-001 / AC-DRIZZLE-001 | TC-DRIZZLE-005 | P1 | 本地单并发 API 延迟 smoke，保持 CRUD/分页结果 | Pass |

自动化：architecture/__tests__/drizzle.test.js、database-safety.test.mjs 与九套受影响回归；architecture/tests/drizzle.integration.test.mjs、drizzle-api.integration.test.mjs、prisma-database.integration.test.mjs、drizzle-performance.test.mjs。入口均为 pnpm agent -- test --file <file> -- node --test <file>，长运行由 task exec 留证。

边界：非法 ORM、未知 schema/operator/scalar、未登录/错误 token、跨组织/owner、SQL 整体事务、原子版本竞态、数据契约与 LIKE 字面量、空列表/无结果、有界列表、迁移恢复。错误修复后原失败用例与受影响回归已重跑；未新增浏览器 UI，复用真实 HTTP API 和身份端口 E2E。

## 4. 功能与兼容结果

| 验证 | 结果 | 证据日志 |
| --- | --- | --- |
| 九套架构定向回归 | 44 项 Pass | drizzle-targeted-final-corrected.log |
| 最后 Drizzle/安全/Monorepo 回归 | 11 项 Pass | drizzle-final-delta-regression.log |
| Drizzle 四库实测 | SQLite 6、PG 7、MySQL 5、MariaDB 5 Pass；两项只适用 PG/SQLite 的隔离用例在 MySQL/MariaDB 明确 Skip | drizzle-authorization-final-runtime.log |
| Task API E2E | SQLite/MySQL/PG 各 8 项 Pass | drizzle-{sqlite,mysql,postgres}-task-api.log |
| 最后 SDK 子路径边界 | 三个消费者各 1 项 Pass | drizzle-final-boundary-{sqlite,mysql,postgres}.log |
| Prisma MySQL/MariaDB 实测 | 各 2 项 Pass | prisma-{mysql,mariadb}-runtime.log |
| 独立消费者与完整任务 API 构建 | strict-peer 安装/类型/构建 Pass | drizzle-final-consumer-builds.log、drizzle-final-example-builds.log、drizzle-final-authorization-build.log |


## 5. 非功能与安全

性能：SQLite/MySQL/PostgreSQL 各 1 项通过，CRUD p95=10.30/25.26/40.44ms、读取 p95=2.43/4.45/10.73ms，错误数0（drizzle-qa-performance.log）；采用单并发、5 次预热、30 次 CRUD 和 50 次列表读取，p95<500ms、p99<1500ms、错误数0。容量/生产性能不在结论内。

安全：真实身份会话/组织隔离、默认拒绝与未知条件阻断、CAS、参数化 SQL、浏览器数据库 SDK 隔离、敏感配置脱敏均通过。源模板没有已选 formal SAST/DAST 工具；静态语义核查与自动边界检查替代该范围的源检查，不声称全量扫描。

可靠性：事务回滚、重复迁移、连续追加、SQL 摘要及未知/缺失历史、PG 专属数据库、SQLite 数据库级恢复锁均实测；MySQL DDL 失败保留恢复标记，必须人工核验而非盲重放。Kit 原生历史没有 snapshot 摘要，快照不可改写由项目 Git/规则维护。

## 6. 缺陷与限制

[缺陷记录](defect-log.md)、[NFR](nfr-tracking.md)、[优先级](priority-matrix.md)。先前 API 数据库类型、Kit bin 导出、PG public 外键隔离、SQLite 历史 rowid 等问题已修复并重跑原场景。无未关闭的本范围 P0/P1 实现缺陷。


## 7. 发布建议



## 8. 证据摘要

模板3.7.0、架构包3.5.0；发布元数据契约22/22通过。下列日志均在任务 evidence，SHA-256 用于复核，完整运行状态以任务为准。

| 日志 | SHA-256 |
| --- | --- |
| drizzle-targeted-final-corrected.log | 75fdc6f74b9fa3e1be78852fc66ca0e899802c3fba532f974b6af56805a759e4 |
| drizzle-final-delta-regression.log | 9c7dfbd0f323b5278b54b754bab7196f34953f0998696d9ec190f8431e615fb6 |
| drizzle-authorization-final-runtime.log | 5981c6e7b88af8b4c38d8f4bc1b36503f078fbd2ac7840b795e8072a51309951 |
| drizzle-sqlite-task-api.log | 169c8a2c3a4cb3d0892fcab4903c9929b7d7cdd62fa0b7155b75d947772a5434 |
| drizzle-mysql-task-api.log | a3a1b14a377a1cbdb2494525fd20b1d084bae7549362c542527e4522cb894608 |
| drizzle-postgres-task-api.log | 1fe2b4b6dfe6fdf7f0da4bb6b57ff17eb567d9e075665a965117b722913ce49f |
| drizzle-final-boundary-sqlite.log | 090c4f70d102001ea42eb293bcc4ba7ea5199c1158effc9e86a792dcfda6e006 |
| drizzle-final-boundary-mysql.log | 18cf7ac767d57d3bc54373239c9d1090de3c86a361279a0d2d32199c242e19c9 |
| drizzle-final-boundary-postgres.log | 597827bb44e7c2bea88ed00f5da3fb2115bac83c6419b46c5aaf6788bbee8d6f |
| prisma-mysql-runtime.log | 4a51ff4b90bb5a6e44380b57beaf70300abbdf371c1fa76e1062988f351203eb |
| prisma-mariadb-runtime.log | 143aaf81947dafa72a205deb53a43a882fb7c945b9d47eea3b1af484124330cc |
| drizzle-final-consumer-builds.log | b41ddad1bdf83ce4a207f90d2ff5ccb69d570c474bc3d38d23f587c728b3df2c |
| drizzle-final-example-builds.log | 1f94ec32d05a3aa1f354f15587177b97ff6dafe5eb4d8234f267e3258625c263 |
| drizzle-final-authorization-build.log | b326f63734803067d825f52c0817c30846f46fe7def23a3cd794c24a80235fae |
| drizzle-qa-performance.log | 19f8f46e94f472d93a54575af94846ae04f7ffc5a6ae9412341a4d1cef56626d |
| drizzle-template-version-surface.log | f1a658f83aaf483fb028d21bb02b4378753bb31f1b9738bc320c594f2cc9c1d8 |

## 用户最新范围与自动模板版本

数据库仅 PostgreSQL、MySQL/MariaDB、SQLite，两套稳定 ORM 一致；其他方言实现与专项测试移除。US-DRIZZLE-005 / AC-DRIZZLE-005 / TC-DRIZZLE-006 验证官方源交付同步自动发布：固定基线、整体与独立架构版本、幂等、更高显式版本保留、失败阻断与实际项目隔离。新回归结果完成后绑定本次 HEAD，先前已验证的无变化 API/身份/文件/性能证据按影响复用。
