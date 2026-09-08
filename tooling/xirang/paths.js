// One compatibility projection; architecture.config.json owns the actual choices.
function derivePaths(config) {
  const apps=config.applications||[],stores=config.datastores||[];
  const web=apps.find(app=>['react-vite','react-next'].includes(app.stack)),api=apps.find(app=>['node','go'].includes(app.stack));
  return {appDirs:apps.map(app=>app.path),primaryApp:web?.path||apps[0]?.path||'',webAppDir:web?.path||'',apiAppDir:api?.path||'',databaseDir:stores[0]?.path||'',migrationsDir:stores[0]?`${stores[0].path}/migrations`:''};
}
module.exports={derivePaths};
