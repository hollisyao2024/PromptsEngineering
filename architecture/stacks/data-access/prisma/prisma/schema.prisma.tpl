generator client {
  provider = "prisma-client"
  output = "../src/generated"
  moduleFormat = "esm"
  importFileExtension = "ts"
}
datasource db {
  provider = "{{provider}}"
}
{{taskModel}}