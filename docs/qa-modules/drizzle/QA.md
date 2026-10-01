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
| US-DRIZZLE-005 / AC-DRIZZLE-005 | TC-DRIZZLE-006 | P0 | 官方源固定基线自动版本、幂等、失败零写、主目录阻断、项目隔离 | Pass |
| US-DRIZZLE-001 / AC-DRIZZLE-001 | TC-DRIZZLE-005 | P1 | 本地单并发 API 延迟 smoke，保持 CRUD/分页结果 | Pass |

自动化：architecture/__tests__/drizzle.test.js、database-safety.test.mjs 与九套受影响回归；architecture/tests/drizzle.integration.test.mjs、drizzle-api.integration.test.mjs、prisma-database.integration.test.mjs、drizzle-performance.test.mjs。入口均为 pnpm agent -- test --file <file> -- node --test <file>，长运行由 task exec 留证。

边界：非法 ORM、未知 schema/operator/scalar、未登录/错误 token、跨组织/owner、SQL 整体事务、原子版本竞态、数据契约与 LIKE 字面量、空列表/无结果、有界列表、迁移恢复。错误修复后原失败用例与受影响回归已重跑；未新增浏览器 UI，复用真实 HTTP API 和身份端口 E2E。

## 4. 功能与兼容结果

| 验证 | 结果 | 证据日志 |
| --- | --- | --- |
| 收窄范围定向回归 | 前12套55项 Pass；发布面长度失败修正后22/22 Pass | drizzle-revised-regressions.log、source-version-surface-corrected.log |
| 标题修复影响回归 | Drizzle/PG安全/Monorepo共11项 Pass | drizzle-title-final-delta.log |
| 四库 Drizzle 实测 | SQLite 6、PG 7、MySQL 5、MariaDB 5 Pass；MySQL/MariaDB 各1项专属隔离用例 Skip | drizzle-revised-real-runtime.log |
| Task API E2E | SQLite/MySQL/PG 各8项 Pass | drizzle-{sqlite,mysql,postgres}-task-api.log |
| SDK 子路径边界 | 三个消费者各1项 Pass | drizzle-revised-boundaries.log |
| Prisma MySQL/MariaDB | 各3项 Pass，包含200个Unicode字符标题、CAS/回滚、历史摘要 | prisma-title-green-runtime.log |
| 独立消费者构建 | 六消费者及修复后的两新Prisma消费者 strict-peer安装/类型/构建 Pass | drizzle-revised-consumer-builds.log、prisma-title-final-builds.log |
| 源版本与主干集成 | 源版本4项；Monorepo5、模板升级9、环境初始化6项 Pass | drizzle-base-integration-regressions.log |
| 实际源同步 | required fetch、固定基线、版本一致、Schema-Doc同步 Pass | drizzle-final-source-sync-recovered.log |

分批回归存在重叠，不累加为独立测试总数。首次发布面测试的长度失败保留原日志，修正规范长度后仅重跑失败范围；200字符标题先复现 P2000，再在新数据库验证修复，未改写已应用迁移。

## 5. 非功能与安全

性能：SQLite/MySQL/PostgreSQL 各 1 项通过，CRUD p95=10.30/25.26/40.44ms、读取 p95=2.43/4.45/10.73ms，错误数0（drizzle-qa-performance.log）；采用单并发、5 次预热、30 次 CRUD 和 50 次列表读取，p95<500ms、p99<1500ms、错误数0。容量/生产性能不在结论内。

安全：真实身份会话/组织隔离、默认拒绝与未知条件阻断、CAS、参数化 SQL、浏览器数据库 SDK 隔离、敏感配置脱敏均通过。源模板没有已选 formal SAST/DAST 工具；静态语义核查与自动边界检查替代该范围的源检查，不声称全量扫描。

可靠性：事务回滚、重复迁移、连续追加、SQL 摘要及未知/缺失历史、PG 专属数据库、SQLite 数据库级恢复锁均实测；MySQL DDL 失败保留恢复标记，必须人工核验而非盲重放。Kit 原生历史没有 snapshot 摘要，快照不可改写由项目 Git/规则维护。

## 6. 缺陷与限制

[缺陷记录](defect-log.md)、[NFR](nfr-tracking.md)、[优先级](priority-matrix.md)。先前 API 数据库类型、Kit bin 导出、PG public 外键隔离、SQLite 历史 rowid 等问题已修复并重跑原场景。无未关闭的本范围 P0/P1 实现缺陷。


## 7. 发布建议

Go / PASS：5个受影响 Story、5个必需AC均有通过证据，P0用例全部通过，无未关闭的本范围P0/P1缺陷。模板3.7.0、架构包3.5.0。升级先 dry-run/检查冲突，再应用、检查收敛并在隔离库审核和执行项目迁移。源版本同步不连接业务数据库。生产容量、真实云和未改变的浏览器UI未执行。

## 8. 证据摘要

模板3.7.0、架构包3.5.0；发布元数据契约22/22通过。下列日志均在任务 evidence，SHA-256 用于复核，完整运行状态以任务为准。

| 日志 | SHA-256 |
| --- | --- |
| drizzle-revised-regressions.log | 6d0b862be50f5e53a2b171473ab1418f1bd09ac3abfa29c19c4fe6203be9c149 |
| source-version-surface-corrected.log | f3739de01004e2482fadb9262756001dd466c6d6ef03b2dfe1646cfe689f7ccd |
| drizzle-title-final-delta.log | c5828222fbd0352e29f9b875e924ec063a3a76d61535a907914a89f5f5e1bf84 |
| drizzle-revised-real-runtime.log | 2e9868b5b097a5a54062d59b8ab582e815c02461c03f3c37e2949477b0ddfdb7 |
| drizzle-revised-boundaries.log | 825414dfc3e653953e8f97f30e757cdf12d0198b95f0fd44a29ac5732a517c5d |
| prisma-title-green-runtime.log | 06974799005b1546b9330f4c4fd823d318947dadb2e715e79caabd3aa5704cd5 |
| prisma-title-final-builds.log | 09490e9c3820e93ca4294024a03ac66848e0e39feb55674dd1ceb5296f0dc928 |
| drizzle-revised-consumer-builds.log | 7de9979b38caa31eb7af799ea78e05de1c44939157d5bf3c725e79e59a1bccb7 |
| drizzle-base-integration-regressions.log | ff69b97b963c115177c8bd6046a845f2ff0ce58cefec491899b15b372ac17397 |
| drizzle-final-source-sync-recovered.log | d1ae6018e79978e10d1939c0b51cbce38b94d96fc2cae9740ae7887f4f316ad9 |
| drizzle-sqlite-task-api.log | 169c8a2c3a4cb3d0892fcab4903c9929b7d7cdd62fa0b7155b75d947772a5434 |
| drizzle-mysql-task-api.log | a3a1b14a377a1cbdb2494525fd20b1d084bae7549362c542527e4522cb894608 |
| drizzle-postgres-task-api.log | 1fe2b4b6dfe6fdf7f0da4bb6b57ff17eb567d9e075665a965117b722913ce49f |
| drizzle-qa-performance.log | 19f8f46e94f472d93a54575af94846ae04f7ffc5a6ae9412341a4d1cef56626d |

## 9. 覆盖摘要

| Story | 实际覆盖 | 性能 | 安全与边界 |
| --- | --- | --- | --- |
| US-DRIZZLE-001 | 三种任务API各8项E2E；正常/空列表/错误恢复/竞态；四库生成及构建 | 三库smoke | 参数化查询/字面量过滤/SDK隔离 |
| US-DRIZZLE-002 | 四库原生追加/部署/重放、历史异常与恢复锁集成 | N/A | 历史改写/混用/非隔离目标阻断 |
| US-DRIZZLE-003 | 四库身份会话/组织隔离、权限、文件CAS；PG队列事务 | 沿用API smoke | 未登录/错误token/跨主体/未知条件拒绝 |
| US-DRIZZLE-004 | Prisma/旧SQL回归、升级收敛/定制保留/已发布迁移保护 | N/A | 三消费者SDK子路径边界 |
| US-DRIZZLE-005 | 真实Git worktree专项4项及实际同步/清单契约 | N/A | fetch失败零写/主目录阻断/项目隔离 |

需求覆盖5/5、必需AC5/5、最终P0通过率100%。本次没有新增UI、生产负载或正式SAST/DAST工具选型，对应范围未运行；不把未运行项计为通过。
