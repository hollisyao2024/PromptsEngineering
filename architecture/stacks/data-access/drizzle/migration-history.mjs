import {existsSync,readFileSync,readdirSync,lstatSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const real=p=>{if(lstatSync(p).isSymbolicLink())throw Error('Migration symlink');};
export function diskMigrations(root,expectedDialect){
 if(root instanceof URL)root=fileURLToPath(root);
 if(!existsSync(root))return [];real(root);
 const meta=path.join(root,'meta'),file=path.join(meta,'_journal.json');
 if(!existsSync(file)){if(readdirSync(root).length)throw Error('Migration journal missing');return [];}
 real(meta);real(file);const journal=JSON.parse(readFileSync(file,'utf8'));
 if(journal.version!=='7'||!['postgresql','mysql','sqlite'].includes(journal.dialect)||!Array.isArray(journal.entries))throw Error('Unsupported migration journal format; explicit Kit upgrade required');
 if(expectedDialect&&journal.dialect!==expectedDialect)throw Error('Migration dialect mismatch');
 const tags=new Set(),times=new Set(),snapshots=new Set();let last=-1,previous='00000000-0000-0000-0000-000000000000';
 for(const name of readdirSync(meta)){real(path.join(meta,name));if(/^\d{4}_snapshot\.json$/.test(name)&&Number(name.slice(0,4))>=journal.entries.length)throw Error('Unregistered migration snapshot: '+name);}
 const entries=journal.entries.map((e,i)=>{
  if(e.idx!==i||!/^\d{4}_[a-zA-Z0-9_-]+$/.test(e.tag)||!e.tag.startsWith(String(i).padStart(4,'0')+'_')||tags.has(e.tag)||!Number.isSafeInteger(e.when)||e.when<=last||times.has(e.when)||typeof e.breakpoints!=='boolean')throw Error('Invalid migration journal order/tag/timestamp');
  const snapshot=path.join(meta,String(i).padStart(4,'0')+'_snapshot.json');if(!existsSync(snapshot))throw Error('Migration snapshot missing: '+e.tag);real(snapshot);const data=JSON.parse(readFileSync(snapshot,'utf8'));if(data.dialect!==journal.dialect||typeof data.id!=='string'||snapshots.has(data.id)||data.prevId!==previous)throw Error('Invalid migration snapshot');
  snapshots.add(data.id);previous=data.id;tags.add(e.tag);times.add(e.when);last=e.when;const sql=path.join(root,e.tag+'.sql');if(!existsSync(sql))throw Error('Registered migration missing: '+e.tag);real(sql);if(!lstatSync(sql).isFile())throw Error('Migration SQL must be a regular file');
  return {name:e.tag,timestamp:e.when,checksum:createHash('sha256').update(readFileSync(sql)).digest('hex')};
 });
 for(const name of readdirSync(root)){real(path.join(root,name));if(name.endsWith('.sql')&&!tags.has(name.slice(0,-4)))throw Error('Unregistered SQL migration missing from journal: '+name);}
 return entries;
}
export function verifyHistory(disk,history){
 if(history.length>disk.length)throw Error('Applied migration history missing on disk');
 let id=-1;
 for(let i=0;i<history.length;i++){
  const row=history[i],item=disk[i];if(!Number.isSafeInteger(Number(row.id))||Number(row.id)<=id)throw Error('Invalid or duplicate migration history');id=Number(row.id);
  if(Number(row.created_at)!==item.timestamp)throw Error('Migration history timestamp/order mismatch: '+item.name);
  if(row.hash!==item.checksum)throw Error('Applied migration checksum changed: '+item.name);
 }
 return {applied:disk.slice(0,history.length).map(x=>x.name),pending:disk.slice(history.length).map(x=>x.name)};
}
