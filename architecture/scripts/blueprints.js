const fs=require('node:fs');
const path=require('node:path');
const {parseJson}=require('../../tooling/xirang/engine');
function expandBlueprint(id,{source=path.resolve(__dirname,'../..'),database}={}) {
  const cat=parseJson(fs.readFileSync(path.join(source,'architecture/manifest.json'),'utf8'),'catalog');
  const blueprint=cat.blueprints?.[id];if(!blueprint)throw new Error('Unknown blueprint: '+id);
  if(database!==undefined&&!['postgres','sqlite'].includes(database))throw new Error('Unsupported blueprint database: '+database);
  const config=parseJson(fs.readFileSync(path.join(source,'architecture',blueprint.template),'utf8'),'blueprint');
  if(database)for(const store of config.datastores)store.engine=database;
  return config;
}
module.exports={expandBlueprint};
