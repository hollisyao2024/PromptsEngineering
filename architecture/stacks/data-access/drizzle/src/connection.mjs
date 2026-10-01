import {existsSync,readFileSync} from 'node:fs';
import {parseEnv} from 'node:util';
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
/** @param {string | undefined} [url] @returns {string} */
export function databaseUrl(url){
 const file=path.join(root,'.env'),env=existsSync(file)?parseEnv(readFileSync(file,'utf8')):{};
 url ||=process.env['{{storeEnv}}']||process.env.DATABASE_URL||env['{{storeEnv}}']||env.DATABASE_URL;
 const pattern='{{engine}}'==='sqlite'?/^file:/:['mysql','mariadb'].includes('{{engine}}')?/^mysql:\/\//:/^postgres(?:ql)?:\/\//;
 if(!url||!pattern.test(url))throw Error('Explicit {{engine}} database URL required');return url;
}
export function sqliteUrl(url){if(url==='file::memory:')return url;return pathToFileURL(path.resolve(root,decodeURIComponent(url.slice(5)))).href;}

export function postgresConfiguration(url){const u=new URL(url),schema=u.searchParams.get('schema')||'public';if(schema!=='public')throw Error('Drizzle Kit public foreign keys require a dedicated PostgreSQL database; custom schemas require explicit project integration');return {schema,connectionString:url,options:'-c search_path='+JSON.stringify(schema)};}
