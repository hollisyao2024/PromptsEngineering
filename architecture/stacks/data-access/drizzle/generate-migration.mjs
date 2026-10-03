import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {diskMigrations} from './migration-history.mjs';
import {collectComments,annotateMigration} from './migration-comments.mjs';
const root=fileURLToPath(new URL('.',import.meta.url));process.chdir(root);
const args=process.argv.slice(2);
if(args.length!==2||args[0]!=='--name'||!/^[-a-zA-Z0-9_]+$/.test(args[1]))throw Error('db:generate requires --name NAME');
const before=new Set(diskMigrations(new URL('drizzle',import.meta.url),'{{dialect}}').map(m=>m.name));
const require=createRequire(import.meta.url),result=spawnSync(process.execPath,[path.join(path.dirname(require.resolve('drizzle-kit')),'bin.cjs'),'generate',...args],{stdio:'inherit',cwd:root,shell:false});
if(result.error||result.status!==0)process.exit(result.status||1);
// Only the migration created by this run is annotated, before anything applies it (ADR-035).
const schemaDir=path.join(root,'src/schema'),sources=readdirSync(schemaDir,{recursive:true}).filter(f=>String(f).endsWith('.ts')).sort().map(f=>readFileSync(path.join(schemaDir,String(f)),'utf8'));
const comments=collectComments(sources);
for(const {name} of diskMigrations(new URL('drizzle',import.meta.url),'{{dialect}}')){if(before.has(name))continue;const file=path.join(root,'drizzle',name+'.sql');writeFileSync(file,annotateMigration(readFileSync(file,'utf8'),'{{dialect}}',comments));}
diskMigrations(new URL('drizzle',import.meta.url),'{{dialect}}');
