import openapiTS,{astToString} from 'openapi-typescript';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
const url=new URL('./openapi.json',import.meta.url);
const spec=JSON.parse(readFileSync(url,'utf8'));
const generated=astToString(await openapiTS(spec));
const schemas='// Generated from openapi.json. Do not edit.\nexport const schemas = '+JSON.stringify(spec.components.schemas,null,2)+' as const;\n';
for(const [name,text] of [['generated.ts',generated],['schemas.ts',schemas]]) {
  const file=new URL('./src/'+name,import.meta.url);
  if(process.argv.includes('--check')) {
    if(!existsSync(file)||readFileSync(file,'utf8')!==text)throw new Error('Stale generated contract: '+name);
  } else writeFileSync(file,text);
}
