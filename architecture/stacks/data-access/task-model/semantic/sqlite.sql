-- 任务示例表：示范数据语义约定（业务命名、审计字段、软删除、字符串状态）
-- 任务：示例业务表，删除为软删除；SQLite 无列注释，字段含义见 docs/data/dictionary.md
CREATE TABLE "task" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "title" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'todo' CHECK ("status" IN ('todo', 'doing', 'done')),
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" DATETIME NOT NULL,
  "created_by" TEXT NOT NULL DEFAULT 'system',
  "updated_by" TEXT NOT NULL DEFAULT 'system',
  "deleted_at" DATETIME,
  "deleted_by" TEXT
);
CREATE INDEX "task_created_at_id_idx" ON "task"("created_at", "id");
CREATE INDEX "task_status_updated_at_idx" ON "task"("status", "updated_at");
