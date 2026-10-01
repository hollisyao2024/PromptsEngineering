generator client {
  provider = "prisma-client"
  output = "../src/generated"
  moduleFormat = "esm"
  importFileExtension = "ts"
}
datasource db {
  provider = "{{provider}}"
}
// Project-owned example. Change the schema here, then create a new migration.
model Task {
  id        String   @id @default(uuid()){{stringNative}}
  title     String{{stringNative}}
  status    String   @default("todo"){{stringNative}}
  version   Int      @default(1)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  @@index([createdAt, id])
  @@index([status])
}
