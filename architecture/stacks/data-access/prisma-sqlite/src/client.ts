import {PrismaClient} from './generated/client.ts';
import {PrismaBetterSqlite3} from '@prisma/adapter-better-sqlite3';
import {existsSync,readFileSync} from 'node:fs';
import {parseEnv} from 'node:util';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url)),envFile=new URL('../.env',import.meta.url);
export function createDatabase(url?:string) {
  const environment=existsSync(envFile)?parseEnv(readFileSync(envFile,'utf8')):{};
  url ||= process.env['{{storeEnv}}']||process.env.DATABASE_URL||environment['{{storeEnv}}']||environment.DATABASE_URL;
  if(!url || !url.startsWith('file:'))throw new Error('SQLite file: DATABASE_URL required');
  const file=decodeURIComponent(url.slice(5));
  return new PrismaClient({adapter:new PrismaBetterSqlite3({url:file===':memory:'?'file::memory:':'file:'+path.resolve(root,file)})});
}
let instance:PrismaClient|undefined;
export const getDatabase=()=>instance ||= createDatabase();
export async function disconnectDatabase(){if(instance)await instance.$disconnect();instance=undefined;}
