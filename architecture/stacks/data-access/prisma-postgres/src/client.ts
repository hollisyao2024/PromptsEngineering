import {PrismaClient} from './generated/client.ts';
import {PrismaPg} from '@prisma/adapter-pg';
import {existsSync,readFileSync} from 'node:fs';
import {parseEnv} from 'node:util';
const envFile=new URL('../.env',import.meta.url);
export function createDatabase(url?:string) {
  const file=existsSync(envFile)?parseEnv(readFileSync(envFile,'utf8')):{};
  url ||= process.env['{{storeEnv}}']||process.env.DATABASE_URL||file['{{storeEnv}}']||file.DATABASE_URL;
  if(!url || !/^postgres(?:ql)?:\/\//.test(url))throw new Error('PostgreSQL DATABASE_URL required');
  const schema=new URL(url).searchParams.get('schema')||'public';
  return new PrismaClient({adapter:new PrismaPg({connectionString:url,max:10,connectionTimeoutMillis:5000},{schema})});
}
let instance:PrismaClient|undefined;
export const getDatabase=()=>instance ||= createDatabase();
export async function disconnectDatabase(){if(instance)await instance.$disconnect();instance=undefined;}
