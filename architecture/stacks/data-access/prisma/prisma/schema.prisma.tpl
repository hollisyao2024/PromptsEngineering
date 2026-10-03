generator client {
  provider = "prisma-client"
  output = "../src/generated"
  moduleFormat = "esm"
  importFileExtension = "ts"
  previewFeatures = ["partialIndexes"]
}
datasource db {
  provider = "{{provider}}"
}
{{taskModel}}