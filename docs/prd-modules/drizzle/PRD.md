# Drizzle 数据访问 - PRD

依据：2026-10-01 用户要求正式支持并继续补齐。总纲：[PRD](../../PRD.md)。

## 1. 模块概述
项目维护者可在 Node TypeScript 数据包选择 Prisma 或 Drizzle；默认保持 Prisma。目标是让初始化、开发、迁移与升级具有同等可验证边界。

## 2. 范围与约束
支持 PostgreSQL、MySQL/MariaDB、SQLite 的两套稳定 ORM 选择；其余数据库不在范围。支持已验证组合、四个已有蓝图、配置式数据包、任务示例、身份权限、文件元数据、pg-boss 同库事务和升级检查。沿用 workspace 导出、公开 DTO 与浏览器隔离。非目标：MongoDB/Oracle、原生桌面 ORM、生产部署、自动迁移已有数据库或把已有 Prisma 项目改为 Drizzle。已发布迁移只追加；初始化/更新不连接数据库。

## 3. 用户故事与验收
| Story | Given / When / Then | Test |
| --- | --- | --- |
| US-DRIZZLE-001 | AC-DRIZZLE-001：Given 支持矩阵中的数据库与 node-ts，When 配置或蓝图选择 drizzle 并初始化，Then 独立数据包、驱动、类型、构建和任务 API 可用；非法选择零写阻断 | TC-DRIZZLE-001 |
| US-DRIZZLE-002 | AC-DRIZZLE-002：Given schema/SQL/快照/历史，When 生成和显式应用迁移，Then 真实数据库执行与回滚验证通过，已应用 SQL 缺失/改写、异常历史与混用迁移器阻断；环境按 worktree 隔离 | TC-DRIZZLE-002 |
| US-DRIZZLE-003 | AC-DRIZZLE-003：Given Drizzle 数据包，When 选择身份权限、文件元数据或同库队列事务，Then 配套适配和授权、CAS、回滚验证通过 | TC-DRIZZLE-003 |
| US-DRIZZLE-004 | AC-DRIZZLE-004：Given Prisma/旧 SQL 或有定制的 Drizzle 项目，When 更新/检查，Then 旧行为保持、业务 schema 不覆盖、迁移受保护、重复更新收敛且浏览器访问数据库阻断 | TC-DRIZZLE-004 |
| US-DRIZZLE-005 | AC-DRIZZLE-005：Given 官方息壤源 linked worktree 有修改，When 完成交付同步，Then 整体模板版本自动递增并同步清单；架构修改同步递增独立架构版本；重复同步不重复递增，实际项目仍保持自身发布策略 | TC-DRIZZLE-006 |

## 4. 非功能需求
负向门禁全部非零退出；固定稳定版 ORM/Kit 与驱动在隔离消费者验证；数据库样本仅使用合成数据。连接和迁移只由显式命令执行，不自动 reset；查询及条件写入继续落实主体与版本条件。

## 5. 依赖与风险
依赖现有 Monorepo、身份权限、文件存储和队列模块。需 PoC：Drizzle 稳定版快照/journal 结构、历史校验、PG/SQLite 事务以及 Better Auth adapter。Kit 格式随版本变化，采用固定版本；自动历史转换不在范围内。

## 6. 里程碑与 Gate
PRD → ARCH → TASK → TDD → QA。CLI 选项、文档、生成器、真实消费者验证、升级收敛必须共同交付。无新增前端交互，沿用任务示例和既有 UX。

## 7. 追溯与开放问题
[追溯矩阵](../../data/traceability-matrix.md)。用户授权完整补齐；稳定版优先，RC 专有组合明确阻断并标注原因；后续采用 RC 需独立版本与验证。用户最新要求仅保留 PostgreSQL、MySQL/MariaDB、SQLite，删除其他方言实现与测试；模板每次修改完成交付必须自动递增版本，实际项目升级可识别版本。无阻塞需求问题。版本递增仅针对官方模板源，发布版本可显式选择更高 minor/major；相同基线重复同步只生成一次版本。
