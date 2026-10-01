const fs=require('node:fs');
const path=require('node:path');
const {parseJson}=require('../../tooling/xirang/engine');
function expandBlueprint(id,{source=path.resolve(__dirname,'../..'),database,orm}={}) {
  const cat=parseJson(fs.readFileSync(path.join(source,'architecture/manifest.json'),'utf8'),'catalog');
  const blueprint=cat.blueprints?.[id];if(!blueprint)throw new Error('Unknown blueprint: '+id);
  if(database!==undefined&&!cat.databases[database])throw new Error('Unsupported blueprint database: '+database);
  if(orm!==undefined&&!cat.dataAccess[orm])throw new Error('Unsupported blueprint ORM: '+orm);
  const config=parseJson(fs.readFileSync(path.join(source,'architecture',blueprint.template),'utf8'),'blueprint');
  if(database)for(const store of config.datastores)store.engine=database;
  if(orm)for(const store of config.datastores)store.access=orm;
  for(const store of config.datastores)require('./database').databaseChoice(store,cat);
  return config;
}
module.exports={expandBlueprint};
