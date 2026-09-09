const {readLock,read,hash,json,parseJson,mergeJsonValue}=require('./engine');
const shared=new Set(['package.json','.gitignore']);
const owners=new Set(['agent','architecture:workspace']);
function baseFor(target,file){
 const record=readLock(target).files[file];if(!record)return {};
 if(!owners.has(record.owner))return {};
 const text=read(target,'.xirang/baselines/'+record.base,true);
 if(text===null||hash(text)!==record.base)throw new Error('Missing/corrupt root contribution baseline: '+file);
 return {record,text};
}
function overlay(base,next){
 if(!base||!next||typeof base!=='object'||typeof next!=='object'||Array.isArray(base)||Array.isArray(next))return next;
 return Object.fromEntries([...new Set([...Object.keys(base),...Object.keys(next)])].map(k=>[k,Object.hasOwn(next,k)?overlay(base[k],next[k]):base[k]]));
}
const lines=(...values)=>[...new Set(values.flatMap(v=>(v||'').split('\n')).filter(Boolean))].join('\n')+'\n';
// Preserve the other capability's baseline contribution, never absorb project edits as upstream.
function preserveRootContribution(asset,target){
 if(!shared.has(asset.path)||!owners.has(asset.owner))return asset;
 const lock=readLock(target),other=asset.owner==='agent'?'architecture:workspace':'agent';
 if(!lock.packages[other]&&lock.files[asset.path]?.owner===asset.owner)return asset;
 const {record,text}=baseFor(target,asset.path);if(!record)return asset;
 asset={...asset,owner:record.owner};
 if(asset.path==='package.json')asset.content=json(overlay(parseJson(text),parseJson(asset.content)));
 else {asset.content=lines(text,asset.content);if(record.strategy==='managed-block'){asset.strategy='managed-block';asset.marker='agent-template:gitignore';}}
 return asset;
}
function mergeRootContributions(left,right,target){
 if(left.path!==right.path||!shared.has(left.path)||!owners.has(left.owner)||!owners.has(right.owner))return null;
 const {record,text}=baseFor(target,left.path),owner=record?.owner||'architecture:workspace';
 if(left.path==='package.json')return {...right,owner,content:json(mergeJsonValue(text===undefined?undefined:parseJson(text),parseJson(left.content),parseJson(right.content)))};
 return {...right,owner,strategy:'managed-block',marker:'agent-template:gitignore',content:lines(left.content,right.content)};
}
module.exports={preserveRootContribution,mergeRootContributions};
