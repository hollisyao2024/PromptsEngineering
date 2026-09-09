CREATE TABLE "Task" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "title" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'todo',
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "Task_createdAt_id_idx" ON "Task"("createdAt", "id");
CREATE INDEX "Task_status_idx" ON "Task"("status");
