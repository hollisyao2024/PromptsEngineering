-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Task" (
    "id" STRING NOT NULL,
    "title" STRING NOT NULL,
    "status" STRING NOT NULL DEFAULT 'todo',
    "version" INT4 NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Task_createdAt_id_idx" ON "Task"("createdAt", "id");

-- CreateIndex
CREATE INDEX "Task_status_idx" ON "Task"("status");

