import { defineConfig } from 'prisma/config';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const envFile=fileURLToPath(new URL('.env',import.meta.url));
if(existsSync(envFile))process.loadEnvFile(envFile);
export default defineConfig({
  schema:'prisma/schema.prisma',
  migrations:{path:'prisma/migrations'},
  // Generation is offline. Mutation commands require an explicit URL in migrate.mjs.
  datasource:{url:process.env['{{storeEnv}}']||process.env.DATABASE_URL||('{{engine}}'==='sqlite'?'file:./dev.sqlite':'postgresql://127.0.0.1:5432/offline'),...((process.env['SHADOW_{{storeEnv}}']||process.env.SHADOW_DATABASE_URL)?{shadowDatabaseUrl:process.env['SHADOW_{{storeEnv}}']||process.env.SHADOW_DATABASE_URL}:{})},
});
