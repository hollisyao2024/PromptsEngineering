# Monorepo 与 Prisma 实施计划

状态：已规划，2026-09-09。输入：[PRD](../../prd-modules/monorepo-platform/PRD.md)、[ARCH](../../arch-modules/monorepo-platform/ARCH.md)。本任务由当前执行者顺序实施，独立命令可并行验证。

## WBS 与交付物

| Task | Story / Test Case | 交付物与通过条件 | 依赖 | Owner | 估算 | 状态 |
| --- | --- | --- | --- | --- | --- | --- |
| TASK-MONOPLAT-001 | US-MONOPLAT-001 / TC-MONOPLAT-001、008、009 | v2 配置、蓝图、workspace、结构合并；四组合收敛、旧版升级、冲突恢复负例 | 已确认 ARCH | TDD | 1-2 人天等效 | 待实施 |
| TASK-MONOPLAT-002 | US-MONOPLAT-002 / TC-MONOPLAT-002、003 | Prisma PG/SQLite 包和 Node TS；真实 CRUD、事务回滚、迁移缺失/修改/失败阻断 | 001 | TDD | 1-2 人天等效 | 待实施 |
| TASK-MONOPLAT-003 | US-MONOPLAT-004 / TC-MONOPLAT-004、005 | OpenAPI、client、Query、任务 API/页面；错误、授权、分页、批删、导出联动 | 002 | TDD | 1-2 人天等效 | 待实施 |
| TASK-MONOPLAT-004 | US-MONOPLAT-006 / TC-MONOPLAT-006、007 | AppShell、主题、边界、platform、config、observability；UI/能力/泄漏负例 | 001、003 | TDD | 1-2 人天等效 | 待实施 |
| TASK-MONOPLAT-005 | 全部 | 独立消费者 PG/SQLite、浏览器、桌面当前平台构建、回归及传播收敛证据 | 001-004 | QA | 1 人天等效 | 待验证 |
| TASK-MONOPLAT-006 | 009 | 版本/规范更新，本地 TDD/QA、PR 合并、主干双 SHA、completion guard | 005 | QA | 0.5 人天等效 | 待验证 |

估算用于表达复杂度，不承诺实际墙钟时间。关键路径 001 → 002 → 003 → 004 → 005 → 006；用户已批准整体验收，不再逐阶段请求重复确认。

## DB 与接口变更

| 阶段 | Expand | Migrate | Contract | Backfill | 双写观察 | 对账 | 回滚 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 新消费者 | 新建独立 Prisma 包/示例任务表 | 显式迁移命令，仅验证库执行 | OpenAPI DTO 不输出 ORM 类型 | 不涉及真实业务 | 不引入双写 | PG/SQLite CRUD、事务与迁移状态比对 | 删除隔离验证库；项目部署回滚由项目审批 |
| 旧消费者 | 保留原 SQL 包和目录映射 | 不自动转换历史 | 保持 v1 选择 | 无自动搬运 | 无 | 本地 schema/迁移/定制 sentinel 保留 | updater 固定 plan/journal 恢复；冲突不写入 |

## 验证矩阵

1. 工作区：四蓝图、共享包一次生成、嵌套路径、exports、workspace:*、安装根、generate 顺序、幂等、YAML 自定义键与注释。
2. 数据访问：真实 PostgreSQL 与 SQLite 连接、分页 CRUD、乐观并发、事务回滚、销毁 client、无浏览器导入。
3. 迁移：pending/完成、SQL 修改、历史文件缺失、失败记录、不同 worktree URL；init/update 不连接数据库。
4. 合约：公开类型生成、过期检查、运行时请求/响应负例、客户端取消、错误 requestId、缓存失效。
5. 页面：新增/修改/删除/多选/分页/筛选/排序/导出，授权失败保留表单值，窄屏布局与键盘。
6. 多端：Browser adapter 与不支持能力、Tauri 当前机器宿主验证；其他平台清楚记录未运行。
7. 配置：缺失环境、未知 profile、日志脱敏、跨应用和数据库边界负例。
8. 升级：v3.1 fixture 自定义脚本/schema/UI、只更新选择包、重复更新、冻结计划漂移/恢复、包管理器锁。
9. 全量：源 Node tests、架构 check、生成消费者 typecheck/build、Git QA 门禁。

## 环境与风险

Owner DevOps 的环境准备限于隔离本地测试数据库、消费者安装及构建命令；不修改或触发 GitHub CI，不部署生产，不执行已有项目数据库操作。原生驱动兼容和 Prisma 预发布 latest 是依赖风险：使用可验证的稳定版本，真实数据库测试和消费者构建作为交付门禁。

高风险语义审查覆盖 SQL 授权/事务、迁移完整性、YAML 合并、冻结计划和边界校验；记录 Codex review skipped by policy，正常运行其余门禁。

## 里程碑

- M1：RED 用例能因缺失功能失败，随后单元/结构验证通过。
- M2：实际生成消费者安装、真实数据库和 UI 旅程通过，所有缺陷已修正。
- M3：规范、QA 证据、版本一致，本地/远端 main SHA 一致，finish 输出 OK。
