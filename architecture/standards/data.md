# 数据与迁移标准

数据库按职责选型。每个存储独立目录、连接环境变量、迁移历史和备份策略，允许云端 PostgreSQL 与桌面 SQLite 并存。ORM/查询工具由项目选择。

旧版 SQL 栈的迁移采用稳定且递增的文件 ID，新增迁移追加到 migrations.json，记录文件 SHA-256 和事务属性。已执行迁移文件不可修改、删除或重排；修改约束/索引/查询对应新增迁移和验证。迁移执行前检查历史缺失、摘要变化和未完成状态；PostgreSQL 使用 advisory lock，SQLite 使用写事务协调。

旧版模板初始化/升级只生成 SQL 与注册项，不连接数据库。`node migrate.mjs` 只预检，`--apply` 才执行。SQLITE_PATH/DATABASE_URL 必须显式提供。失败记录保留，先诊断再恢复，不自动跳过失败迁移。生产执行前项目负责备份、回滚/补偿和新旧代码兼容验证。

Node TypeScript 新蓝图使用 Prisma 7，PG 和 SQLite 分别生成独立 Schema/Client/迁移。Prisma Migrate 是唯一执行历史，不再同时使用 migrations.json。db:status / db:deploy 对比磁盘 SQL 与 _prisma_migrations，缺失、变更和失败状态阻断；只有显式命令连接数据库。已发布 SQL 不修改，业务 schema 由项目持有，generated client 忽略并重建。DATABASE_<STORE>_URL 与 TEST/SHADOW 配置应按 worktree 分开。切换 provider/access 或接管旧 SQL 历史须独立项目迁移；不得直接让模板转换。
