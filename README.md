# Agents Package (v1.2, 2025-10-12)

包含：`AGENTS.md`、4 个专家角色（运行时短卡片）、**Handbooks**（你的原始四份完整文件），以及 DB/数据文档与迁移目录骨架。
- 触发：`/prd` → `/arch` → `/task` → `/tdd`
- DB 变更：走 Expand → Migrate/Backfill → Contract；脚本在 `/db/migrations/`（含回滚）；数据视图在 `/docs/data/`。
- 变更记录：请写入 `/docs/CHANGELOG.md`。

放到项目根目录即可开始使用。
