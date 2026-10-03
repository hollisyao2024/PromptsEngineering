# 数据语义约定与 Schema 变更治理 - PRD

依据：2026-10-03 用户确认的数据库语义化改造与变更治理要求；2026-10-04 追加确认“所有核心表、业务表新建时必须有注释、规范命名、审计字段与软删除字段”及身份表分层合规方案。总纲：[PRD](../../PRD.md)。

## 1. 模块概述
让模型和协作者读 schema 即可理解业务：表与字段使用业务语言、全部带注释，审计时间与操作者齐全，删除默认保留历史；任何 schema 变更都同时生成迁移文件并更新数据架构文档，数据库只能通过迁移修改。

## 2. 范围与约束
范围：模板自有的数据标准、专家审查清单、字典模板、`tdd sync` 的 schema 门禁、语义检查，Prisma/Drizzle 四种数据库新生成的任务示例，以及模板模块自有核心表（Better Auth 身份表、文件元数据表）的新安装 schema、迁移与软删除行为。业务 schema 仍归项目，模板升级不改写已有 schema、已发布迁移和项目规则；已有项目通过规范与门禁逐步跟进。

非目标：自动改造已有项目表结构或已安装的旧版模块表（旧版 `FileObject`、驼峰身份表保持原字节并继续豁免）；pg-boss 与迁移历史等系统表的结构调整；检测直接连接生产库执行的手工 DDL（后续以 `db:status` 漂移检测补充）。

## 3. 用户故事与验收
| Story | Given / When / Then | Test |
| --- | --- | --- |
| US-DATA-001 | AC-DATA-001：Given 实际项目或模板源，When 阅读数据标准与专家清单，Then 明确命名、注释、状态值、六个审计字段、软删除及豁免、变更流程和只经迁移改库的规则 | TC-DATA-001 |
| US-DATA-002 | AC-DATA-002：Given 架构配置登记的 Prisma/Drizzle/旧 SQL 数据存储，When schema 有实质变化而无新迁移、迁移无 schema 变化且未声明数据迁移、已有迁移或快照被修改删除重命名、文档或字典未同步，Then `tdd sync` 非零阻断并给出修复方式 | TC-DATA-002 |
| US-DATA-003 | AC-DATA-003：Given 本次新增的迁移，When 新表或新列缺少审计字段、软删除列、注释、snake_case 命名或整数状态说明，Then 按 `tdd.schemaGate.semantic` 处理（默认值见 US-DATA-005） | TC-DATA-003 |
| US-DATA-004 | AC-DATA-004：Given 新初始化的 Prisma/Drizzle 数据包，When 生成任务示例，Then 表与列为 snake_case、带注释、含六个审计字段、按 `deleted_at` 软删除并保留部分索引、状态为字符串枚举约束；已有项目的 schema 和服务不被覆盖 | TC-DATA-004 |
| US-DATA-005 | AC-DATA-005：Given 未配置 `tdd.schemaGate.semantic` 的项目，When 新增迁移含不合规的核心/业务表，Then `tdd sync` 默认非零阻断；项目显式配置 `warn` 或 `off` 时降级；已发布迁移不重新检查 | TC-DATA-005 |
| US-DATA-006 | AC-DATA-006：Given 项目自建与模块同名的表（如 `account`、`user`），When 未安装对应旧版模块或模块已是语义版，Then 不被默认豁免并照常检查；默认豁免只保留迁移历史、`app_metadata`、`pgboss.*` 等系统表；`-- xirang:hard-delete <表> <原因>` 只免除 `deleted_at/deleted_by` 并保留其他检查 | TC-DATA-006 |
| US-DATA-007 | AC-DATA-007：Given SQLite 或 Drizzle 数据存储，When 新增表/列，Then 字典对应字段行的说明列必须非空（SQLite 注释层）；Drizzle schema 源中的 `/** */` 表与列注释由 `db:generate` 自动写入 PostgreSQL `COMMENT ON`、MySQL/MariaDB 内联 `COMMENT`，无需手工补写 | TC-DATA-007 |
| US-DATA-008 | AC-DATA-008：Given 新安装的身份模块（Prisma 或 Drizzle），When 生成 schema 与迁移，Then 全部身份表为 snake_case 且带表/列注释；`user`、`organization`、`member`、`invitation` 含六个审计字段并软删除，未删除行内邮箱/slug 唯一；`session`、`account`、`verification` 含创建/更新审计字段并保持物理删除，每次删除写入不含令牌、密码与验证值的 `auth_audit_log`；Better Auth 及组织插件的读取、更新与删除均经适配器层统一过滤或改写 | TC-DATA-008 |
| US-DATA-009 | AC-DATA-009：Given 新安装的文件存储模块，When 生成元数据表并删除文件，Then 表为 `file_object`（snake_case、注释、六审计字段），创建与更新写入 `created_by/updated_by`，文件进入 `deleted` 状态时同时写入 `deleted_at/deleted_by`；列表不返回已删除元数据，重复删除保持幂等 | TC-DATA-009 |
| US-DATA-010 | AC-DATA-010：Given 已安装旧版身份或文件模块的项目，When 执行模板同步与架构更新，Then 继续输出原 schema、迁移与服务字节，`append`/`init-if-missing` 无冲突、收敛 dry-run 无差异，且旧版模块表保持豁免 | TC-DATA-010 |

## 4. 非功能需求
门禁只基于 git 差异与文件内容，离线运行、不连接数据库；结果可解析且失败非零退出；跳过须给出原因。语义检查不得误伤模板源夹具与已安装旧版模块表；身份审计日志不得记录令牌、密码、验证值等敏感数据；软删除不得改变 Better Auth 对外 API。

## 5. 依赖与风险
依赖 Drizzle 数据访问、Monorepo/Prisma 与既有 Schema-Doc Sync 门禁。风险：SQL 正则解析覆盖不全（以增量迁移为单位、保守识别）；MySQL/MariaDB 不支持部分索引（任务示例用普通索引；身份表用“未删除时取值”的生成列加唯一索引）；Prisma 部分唯一索引依赖 `partialIndexes` 预览特性，已有 `schema.prisma` 未启用时退回普通唯一索引（已删除行继续占用邮箱/slug）；SQLite 无原生 COMMENT（以字典说明补位）；Better Auth 内部删除路径不全走钩子，软删除须在适配器层实现并以真实 Better Auth 回归验证。

## 6. 里程碑与 Gate
ARCH → TASK → TDD → QA；规范、门禁、生成器与文档同次交付。

## 7. 追溯与开放问题
[追溯矩阵](../../data/traceability-matrix.md)。用户确认：流程类检查阻断；语义检查初版默认告警，2026-10-04 改为默认阻断且只作用于新增迁移；核心模块表完全合规，身份表按分层方案（会话/账户/验证令牌物理删除加审计日志）；列名 snake_case；软删除对业务表强制、系统/第三方/日志表豁免并另设隐私清除；状态值优先字符串枚举。无阻塞问题。
