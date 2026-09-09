import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
export async function startFixture() {
  const target=process.env.XIRANG_CONSUMER;
  if(!target)throw new Error('Explicit disposable XIRANG_CONSUMER required');
  const config=JSON.parse(readFileSync(path.join(target,'architecture.config.json')));
  const store=config.datastores.find(d=>d.id===config.example.datastore);
  if(store.engine!=='sqlite'||store.access!=='prisma')throw new Error('Browser fixture requires isolated SQLite consumer');
  const dbRoot=path.join(target,store.path),dbUrl='file:'+path.join(target,'qa-e2e.sqlite');
  const load=p=>import(pathToFileURL(path.join(target,p)));
  const migration=spawnSync(process.execPath,['migrate.mjs','deploy'],{cwd:dbRoot,env:{...process.env,DATABASE_URL:dbUrl,['DATABASE_'+store.id.toUpperCase()+'_URL']:dbUrl},encoding:'utf8'});
  if(migration.status)throw new Error(migration.stderr);
  const {createDatabase}=await load(store.path+'/dist/index.js'),{createApp}=await load('apps/api/dist/server.js'),{readServerConfig}=await load('packages/config/dist/index.js');
  const db=createDatabase(dbUrl),token=randomUUID()+randomUUID(),serverConfig=readServerConfig({NODE_ENV:'production',API_WRITE_TOKEN:token});
  const api=createApp({db,config:serverConfig});await new Promise(resolve=>api.listen(0,'127.0.0.1',resolve));
  const apiUrl='http://127.0.0.1:'+api.address().port;
  const app=config.applications.find(a=>a.stack==='react-vite'),appRoot=path.join(target,app.path);
  const require=createRequire(path.join(appRoot,'package.json')),{createServer}=await import(pathToFileURL(require.resolve('vite')));
  const vite=await createServer({root:appRoot,configFile:path.join(appRoot,'vite.config.ts'),logLevel:'error',define:{'import.meta.env.VITE_API_URL':JSON.stringify(apiUrl)},server:{host:'127.0.0.1',port:0,strictPort:false}});
  await vite.listen();const webUrl='http://127.0.0.1:'+vite.httpServer.address().port;serverConfig.corsOrigins.add(webUrl);
  return {target,db,token,apiUrl,webUrl,async close(){await vite.close();await new Promise(resolve=>api.close(resolve));await db.$disconnect();}};
}
