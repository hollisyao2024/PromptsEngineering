-- 任务示例表：示范数据语义约定（业务命名、全量注释、审计字段、软删除、字符串状态）
CREATE TABLE "task" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "title" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'todo',
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "created_by" TEXT NOT NULL DEFAULT 'system',
  "updated_by" TEXT NOT NULL DEFAULT 'system',
  "deleted_at" TIMESTAMP(3),
  "deleted_by" TEXT,
  CONSTRAINT "task_status_check" CHECK ("status" IN ('todo', 'doing', 'done'))
);
CREATE INDEX "task_created_at_id_idx" ON "task"("created_at", "id");
CREATE INDEX "task_status_updated_at_idx" ON "task"("status", "updated_at");
COMMENT ON TABLE "task" IS '任务：示例业务表，删除为软删除';
COMMENT ON COLUMN "task"."id" IS '任务 ID（UUID）';
COMMENT ON COLUMN "task"."title" IS '任务标题';
COMMENT ON COLUMN "task"."status" IS '任务状态：todo=待处理 doing=进行中 done=已完成';
COMMENT ON COLUMN "task"."version" IS '乐观锁版本号，每次更新加 1';
COMMENT ON COLUMN "task"."created_at" IS '创建时间';
COMMENT ON COLUMN "task"."updated_at" IS '最后修改时间';
COMMENT ON COLUMN "task"."created_by" IS '创建人标识，无登录主体时为 system';
COMMENT ON COLUMN "task"."updated_by" IS '最后修改人标识，无登录主体时为 system';
COMMENT ON COLUMN "task"."deleted_at" IS '软删除时间，为空表示未删除';
COMMENT ON COLUMN "task"."deleted_by" IS '软删除操作人标识';
