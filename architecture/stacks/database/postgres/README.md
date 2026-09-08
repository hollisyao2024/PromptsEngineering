# postgres 数据存储

先执行 `node migrate.mjs` 查看待执行迁移；显式 `node migrate.mjs --apply` 才写入数据库。使用环境变量 DATABASE_URL（PostgreSQL）或 SQLITE_PATH（SQLite）。每个迁移在 migrations.json 登记 SHA-256。已执行文件不得改写，失败或校验不一致会阻断后续迁移。
