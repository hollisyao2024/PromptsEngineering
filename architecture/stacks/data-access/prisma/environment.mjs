import {createHash} from 'node:crypto';
import {realpathSync,existsSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('.',import.meta.url));
export const isolationId='wt_'+createHash('sha256').update(realpathSync(root)).digest('hex').slice(0,12);
export function loadEnvironment() {
  const file=fileURLToPath(new URL('.env',import.meta.url));
  if(existsSync(file))process.loadEnvFile(file);
  if(process.env['{{storeEnv}}'])process.env.DATABASE_URL=process.env['{{storeEnv}}'];
  if(process.env['SHADOW_{{storeEnv}}'])process.env.SHADOW_DATABASE_URL=process.env['SHADOW_{{storeEnv}}'];
}
if(process.argv[1]===fileURLToPath(import.meta.url)) {
  const example='{{engine}}'==='sqlite'
    ? 'DATABASE_URL=file:./dev-'+isolationId+'.sqlite\nTEST_DATABASE_URL=file:./test-'+isolationId+'.sqlite\n'
    : '# Fill credentials and create the database before deploying migrations.\nDATABASE_URL=postgresql://USER:PASSWORD@127.0.0.1:5432/app?schema='+isolationId+'\nTEST_DATABASE_URL=postgresql://USER:PASSWORD@127.0.0.1:5432/app?schema='+isolationId+'_test\nSHADOW_DATABASE_URL=postgresql://USER:PASSWORD@127.0.0.1:5432/app?schema='+isolationId+'_shadow\n';
  writeFileSync(new URL('.env',import.meta.url),example,{flag:'wx',mode:0o600});
  console.log('Created private .env; existing files are never replaced. ISOLATION_ID='+isolationId);
}
