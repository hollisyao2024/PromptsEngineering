// Data semantics (ADR-035): copy schema doc comments into a newly generated migration before it is applied.
// PostgreSQL gets COMMENT ON statements, MySQL/MariaDB inline COMMENT clauses, SQLite only the hard-delete markers.
const TABLE=/export\s+const\s+(\w+)\s*=\s*\w*[tT]able\(\s*['"]([^'"]+)['"]/g;
const COLUMN=/\/\*\*([\s\S]*?)\*\/\s*(\w+)\s*:\s*\w+\(\s*(?:['"]([^'"]+)['"])?/g;
function docText(raw){
 const lines=raw.split('\n').map(line=>line.replace(/^\s*\*?\s?/,'').trim()),tags={};
 const text=lines.filter(line=>{const tag=/^@(\S+)\s*(.*)$/.exec(line);if(tag){tags[tag[1]]=tag[2].trim();return false;}return line;}).join(' ').trim();
 return {text,tags};
}
// Returns Map<table,{comment,hardDelete,columns:Map<column,comment>}> from Drizzle schema sources.
export function collectComments(sources){
 const tables=new Map();
 for(const source of sources){
  const starts=[...source.matchAll(TABLE)];
  starts.forEach((match,i)=>{
   const before=source.slice(0,match.index).trimEnd(),doc=/\/\*\*((?:(?!\*\/)[\s\S])*)\*\/$/.exec(before);
   const head=doc?docText(doc[1]):{text:'',tags:{}},body=source.slice(match.index+match[0].length,i+1<starts.length?starts[i+1].index:source.length);
   const columns=new Map();
   for(const column of body.matchAll(COLUMN)){const {text}=docText(column[1]);if(text)columns.set(column[3]||column[2],text);}
   tables.set(match[2],{comment:head.text,hardDelete:head.tags['hard-delete']||'',columns});
  });
 }
 return tables;
}
const literal=text=>"'"+text.replaceAll("'","''")+"'";
function columnsOf(sql,table){
 const block=new RegExp('CREATE TABLE (?:IF NOT EXISTS )?"'+table+'" \\(\\n([\\s\\S]*?)\\n\\);').exec(sql);
 return new Set(block?[...block[1].matchAll(/^\s*"([^"]+)"\s/gm)].map(m=>m[1]):[]);
}
const BREAK='--> statement-breakpoint';
export function annotateMigration(sql,dialect,tables){
 const created=new Set(),added=[];
 const name='[`"]([^`"]+)[`"]';
 for(const m of sql.matchAll(new RegExp('CREATE TABLE (?:IF NOT EXISTS )?'+name,'g')))created.add(m[1]);
 for(const m of sql.matchAll(new RegExp('ALTER TABLE '+name+' ADD (?:COLUMN )?'+name,'g')))added.push([m[1],m[2]]);
 const markers=[...created].filter(t=>tables.get(t)?.hardDelete&&!new RegExp('xirang:hard-delete\\s+'+t+'\\s').test(sql)).map(t=>`-- xirang:hard-delete ${t} ${tables.get(t).hardDelete}\n`).join('');
 let out=sql;
 if(dialect==='postgresql'){
  const statements=[];
  for(const t of created){const info=tables.get(t);if(!info)continue;if(info.comment)statements.push(`COMMENT ON TABLE "${t}" IS ${literal(info.comment)};`);const own=columnsOf(sql,t);for(const [c,text] of info.columns)if(own.has(c))statements.push(`COMMENT ON COLUMN "${t}"."${c}" IS ${literal(text)};`);}
  for(const [t,c] of added){const text=tables.get(t)?.columns.get(c);if(text)statements.push(`COMMENT ON COLUMN "${t}"."${c}" IS ${literal(text)};`);}
  const pending=statements.filter(s=>!out.includes(s));
  if(pending.length)out=out.replace(/\s*(?:--> statement-breakpoint\s*)?$/,'')+'\n'+BREAK+'\n'+pending.join('\n'+BREAK+'\n')+'\n';
 }else if(dialect==='mysql'){
  out=out.replace(/CREATE TABLE (?:IF NOT EXISTS )?`([^`]+)` \(\n([\s\S]*?)\n\);/g,(block,t,body)=>{
   const info=tables.get(t);if(!info)return block;
   const lines=body.split('\n').map(line=>{const col=/^(\s*`([^`]+)`\s.*?)(,?)$/.exec(line);const text=col&&info.columns.get(col[2]);return text&&!/ COMMENT '/.test(line)?`${col[1]} COMMENT ${literal(text)}${col[3]}`:line;});
   return block.replace(body,lines.join('\n')).replace(/\n\);$/,info.comment?`\n) COMMENT=${literal(info.comment)};`:'\n);');
  });
  for(const [t,c] of added){const text=tables.get(t)?.columns.get(c);if(!text)continue;out=out.replace(new RegExp('(ALTER TABLE `'+t+'` ADD (?:COLUMN )?`'+c+'`[^;]*?)(;)'),(all,head,end)=>/ COMMENT '/.test(head)?all:`${head} COMMENT ${literal(text)}${end}`);}
 }
 return markers+out;
}
