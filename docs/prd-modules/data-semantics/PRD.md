# 数据语义约定与 Schema 变更治理 - PRD

依据：2026-10-03 用户确认的数据库语义化改造与变更治理要求。总纲：[PRD](../../PRD.md)。

## 1. 模块概述
让模型和协作者读 schema 即可理解业务：表与字段使用业务语言、全部带注释，审计时间与操作者齐全，删除默认保留历史；任何 schema 变更都同时生成迁移文件并更新数据架构文档，数据库只能通过迁移修改。

## 2. 范围与约束
范围：模板自有的数据标准、专家审查清单、字典模板、`tdd sync` 的 schema 门禁、语义检查，以及 Prisma/Drizzle 四种数据库新生成的任务示例。业务 schema 仍归项目，模板升级不改写已有 schema、已发布迁移和项目规则；已有项目通过规范与门禁逐步跟进。

非目标：自动改造已有项目表结构；第三方或模块自有表（Better Auth、pg-boss、文件元数据 FileObject、迁移历史表）的结构调整；检测直接连接生产库执行的手工 DDL（后续以 `db:status` 漂移检测补充）。

## 3. 用户故事与验收
| Story | Given / When / Then | Test |
| --- | --- | --- |
| US-DATA-001 | AC-DATA-001：Given 实际项目或模板源，When 阅读数据标准与专家清单，Then 明确命名、注释、状态值、六个审计字段、软删除及豁免、变更流程和只经迁移改库的规则 | TC-DATA-001 |
| US-DATA-002 | AC-DATA-002：Given 架构配置登记的 Prisma/Drizzle/旧 SQL 数据存储，When schema 有实质变化而无新迁移、迁移无 schema 变化且未声明数据迁移、已有迁移或快照被修改删除重命名、文档或字典未同步，Then `tdd sync` 非零阻断并给出修复方式 | TC-DATA-002 |
| US-DATA-003 | AC-DATA-003：Given 本次新增的迁移，When 新表或新列缺少审计字段、软删除列、注释、snake_case 命名或整数状态说明，Then 默认告警，项目配置为 required 时阻断 | TC-DATA-003 |
| US-DATA-004 | AC-DATA-004：Given 新初始化的 Prisma/Drizzle 数据包，When 生成任务示例，Then 表与列为 snake_case、带注释、含六个审计字段、按 `deleted_at` 软删除并保留部分索引、状态为字符串枚举约束；已有项目的 schema 和服务不被覆盖 | TC-DATA-004 |

## 4. 非功能需求
门禁只基于 git 差异与文件内容，离线运行、不连接数据库；结果可解析且失败非零退出；跳过须给出原因。语义检查不得误伤模板源夹具与第三方表。

## 5. 依赖与风险
依赖 Drizzle 数据访问、Monorepo/Prisma 与既有 Schema-Doc Sync 门禁。风险：SQL 正则解析覆盖不全（以增量迁移为单位、保守识别）；MySQL/MariaDB 不支持部分索引（示例以普通索引并在标准中说明）；SQLite 无原生 COMMENT（以字典文档补位）。

## 6. 里程碑与 Gate
ARCH → TASK → TDD → QA；规范、门禁、生成器与文档同次交付。

## 7. 追溯与开放问题
[追溯矩阵](../../data/traceability-matrix.md)。用户确认：流程类检查阻断、语义检查默认告警；列名 snake_case；软删除对业务表强制、系统/第三方/日志表豁免并另设隐私清除；状态值优先字符串枚举。无阻塞问题。
