CREATE TABLE "FileObject" (
  "id" TEXT NOT NULL PRIMARY KEY, "ownerId" TEXT NOT NULL, "storeId" TEXT NOT NULL,
  "objectKey" TEXT NOT NULL, "state" TEXT NOT NULL, "version" INTEGER NOT NULL,
  "record" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "FileObject_storeId_objectKey_key" ON "FileObject"("storeId","objectKey");
CREATE INDEX "FileObject_ownerId_id_idx" ON "FileObject"("ownerId","id");
CREATE INDEX "FileObject_state_updatedAt_idx" ON "FileObject"("state","updatedAt");
