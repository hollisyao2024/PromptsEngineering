const YAML = require('./vendor/yaml/lib');
function parseDocument(text) {
  const doc = YAML.parseDocument(text || '{}\n', { uniqueKeys: true, stringKeys: true, prettyErrors: false });
  if (doc.errors.length || doc.warnings.length) throw new Error('Invalid or unsupported workspace YAML');
  if (!YAML.isMap(doc.contents)) throw new Error('Workspace YAML must be a mapping');
  const value = doc.toJS({maxAliasCount: 50});
  JSON.stringify(value, (key,v) => { if (['__proto__','prototype','constructor'].includes(key)) throw new Error('Unsafe YAML key'); return v; });
  return {doc,value};
}
function mergeYaml(base, local, upstream, merge) {
  const {value:b} = parseDocument(base), {doc,value:l}=parseDocument(local), {value:u}=parseDocument(upstream);
  const bRest={...b},lRest={...l},uRest={...u};
  // Package membership and build allowlists are sets. Other arrays retain normal three-way conflict semantics.
  const sets={};
  for (const key of ['packages','onlyBuiltDependencies']) {
    if (!(key in u)) continue;
    for (const value of [b[key],l[key],u[key]]) if (value!==undefined && (!Array.isArray(value)||value.some(v=>typeof v!=='string'))) throw new Error('Invalid workspace '+key);
    if (base!==undefined && (b[key]||[]).some(v=>u[key].includes(v)&&!(l[key]||[]).includes(v))) throw new Error('Required workspace entry removed locally: '+key);
    sets[key]=[...new Set([...(l[key]||[]).filter(v=>!(b[key]||[]).includes(v)||u[key].includes(v)),...u[key]])];
    delete bRest[key];delete lRest[key];delete uRest[key];
  }
  const result={...merge(bRest,lRest,uRest),...sets};
  const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  function patch(before,after,keys=[]) {
    for(const key of new Set([...Object.keys(before),...Object.keys(after)])) {
      const p=[...keys,key],a=before[key],b=after[key];
      if(same(a,b))continue;
      if(b===undefined)doc.deleteIn(p);
      else if(a && b && typeof a==='object' && typeof b==='object' && !Array.isArray(a) && !Array.isArray(b))patch(a,b,p);
      else doc.setIn(p,doc.createNode(b));
    }
  }
  patch(l,result);
  return same(l,result) && local!==null ? local : doc.toString();
}
module.exports={parseDocument,mergeYaml};
