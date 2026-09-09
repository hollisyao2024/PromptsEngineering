const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { spawnSync } = require('node:child_process');
const { validateConfig, walk, catalog } = require('../scripts/project');
const { safePath, hash, parseJson, read } = require('../../tooling/xirang/engine');
const { componentCatalog, resolveComponentSets } = require('../scripts/component-sets');
const RAW_UI = new Set(['button','input','select','option','textarea','dialog','details','summary','table']);
function checkProject(target, raw, { source, syntax = true } = {}) {
  optionCache.clear();
  const config = validateConfig(raw, { target, source }), failures = [], checks = [];
  const cat = catalog(source);
  const fail = (name, reason) => failures.push({ name, reason });
  for (const app of config.applications) {
    const dir = safePath(target, app.path);
    if (!fs.existsSync(dir)) { fail(app.id,'Application directory missing'); continue; }
    const roots = [app.path, ...Object.values(app.components || {}).filter(p => !p.startsWith(app.path + '/'))];
    const files = [...new Set(roots.flatMap(root => walk(safePath(target, root)).map(file => `${root}/${file}`)))].filter(p => /\.(?:[cm]?[jt]sx?|rs|go)$/.test(p));
    let ts;
    if (cat.stacks[app.stack].ui && syntax) {
      try { ts = createRequire(path.join(dir,'package.json'))('typescript'); }
      catch { fail(app.id,'TypeScript dependency missing; run architecture install-deps'); continue; }
      const components = parseJson(read(target, `${app.path}/components.json`) || '{}', 'components.json');
      const tsconfig = ts.readConfigFile(path.join(dir,'tsconfig.json'), ts.sys.readFile);
      if (tsconfig.error) { fail(app.id,'Cannot parse tsconfig.json'); continue; }
      const parsed = ts.parseJsonConfigFileContent(tsconfig.config, ts.sys, dir);
      const opts = parsed.options;
      const sets = resolveComponentSets(app.componentSets, componentCatalog(source)).sets;
      const probes = [[components.aliases?.ui, app.components.ui, 'button']];
      for (const [set,kind,alias,probe] of [['data-table','dataTable','data-table','data-table'],['forms','forms','forms','form-field'],['selectors','selectors','selectors','search-select'],['dates','selectors','selectors','date-picker'],['feedback','feedback','feedback','confirm-dialog']]) if (sets.includes(set)) probes.push([`@/components/${alias}`,app.components[kind],probe]);
      for (const [alias, expected, probe] of probes) {
        const result = alias && ts.resolveModuleName(`${alias}/${probe}`,path.join(dir,app.sourceDir,'__xirang_check__.tsx'),opts,ts.sys).resolvedModule;
        if (!result || path.resolve(result.resolvedFileName) !== path.resolve(target,expected,`${probe}.tsx`)) fail(app.id,`Component alias does not resolve to configured path: ${alias}`);
      }
    }
    for (const relative of files) {
      const rel = path.posix.relative(app.path, relative), content = fs.readFileSync(safePath(target,relative),'utf8');
      const primitive = app.components && relative.startsWith(app.components.ui + '/');
      const commonTable = app.components && relative.startsWith(app.components.dataTable + '/');
      if (ts && /\.[jt]sx?$/.test(rel)) {
        const tree = ts.createSourceFile(relative,content,ts.ScriptTarget.Latest,true,rel.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
        const visit = node => {
          if (!primitive && (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node))) {
            const tag = node.tagName.getText(tree);
            if (RAW_UI.has(tag)) fail(relative,`Use shadcn/common DataTable instead of native <${tag}>`);
            if (!commonTable && /^Table(?:Head|Header|Body|Cell|Row|Footer|Caption)?$/.test(tag)) fail(relative,'Business tables must use the common DataTable');
          }
          const specifier = (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) ? node.moduleSpecifier : ts.isCallExpression(node) && node.arguments?.[0] && (node.expression.kind === ts.SyntaxKind.ImportKeyword || node.expression.getText(tree) === 'require') ? node.arguments[0] : undefined;
          if (specifier && ts.isStringLiteral(specifier)) {
            const imported = specifier.text;
            if (!primitive && !commonTable && /(?:^|\/)ui\/table$/.test(imported) && !node.importClause?.isTypeOnly) fail(relative,'Low-level Table imports belong inside the common DataTable');
            if (!primitive && !commonTable && /@tanstack\/react-table/.test(imported) && !node.importClause?.isTypeOnly && /useReactTable|TableBody|TableRow/.test(node.getText(tree))) fail(relative,'Business code must not implement a second table');
            const resolved = ts.resolveModuleName(imported,path.join(target,relative),optsFor(app,ts,dir),ts.sys).resolvedModule?.resolvedFileName;
            if (resolved && !resolved.replaceAll('\\','/').split('/').includes('node_modules') && config.applications.some(other => (other.id !== app.id || relative.startsWith('packages/')) && path.resolve(resolved).startsWith(path.resolve(target,other.path)+path.sep))) fail(relative,`Cross-application source import: ${imported}`);
          }
          ts.forEachChild(node,visit);
        };
        visit(tree);
      }
      if (!ts) for (const other of config.applications.filter(a=>a.id!==app.id)) {
        // Language-specific import strings only; deeper domain checks remain project checks.
        if (new RegExp(`(?:from\\s+|require\\s*\\(|import\\s*\\()["'][^"']*apps/${other.id}/`).test(content)) fail(relative,'Cross-application source import');
      }
    }
    checks.push(`application:${app.id}`);
  }
  for (const store of config.datastores) {
    if(store.access==='prisma')continue;
    try {
      const registry = parseJson(read(target,`${store.path}/migrations.json`) || 'null','migration registry');
      if (!Array.isArray(registry)) throw new Error('Missing migration registry');
      const seen = new Set(); let previous='';
      for (const item of registry) {
        if (!/^[0-9][a-zA-Z0-9_-]*$/.test(item.id) || !/^[0-9][a-zA-Z0-9_-]*\.sql$/.test(item.file) || seen.has(item.id) || item.id <= previous) throw new Error('Invalid or unordered migration');
        previous=item.id;seen.add(item.id);
        if (hash(read(target,`${store.path}/migrations/${item.file}`)) !== item.checksum) throw new Error(`Migration checksum mismatch: ${item.id}`);
      }
      const files = walk(safePath(target,`${store.path}/migrations`)).filter(p=>p.endsWith('.sql'));
      if (files.some(file=>!registry.some(item=>item.file===file))) throw new Error('Unregistered migration file');
      checks.push(`datastore:${store.id}`);
    } catch(error) { fail(store.id,error.message); }
  }
  const commands = { contracts: ['generate.mjs','--check'], 'runtime-assets': ['verify.mjs'], plugins: ['verify.mjs'] };
  for (const module of config.modules) {
    if (commands[module.id]) {
      const result = spawnSync(process.execPath,commands[module.id],{cwd:safePath(target,module.path),encoding:'utf8',shell:false,timeout:30000});
      if (result.status !== 0) fail(module.id, result.error?.message || result.stderr || 'module check failed'); else checks.push(`module:${module.id}`);
    }
  }
  const agent = read(target,'agent.config.json');
  if (agent) {
    const { derivePaths }=require('../scripts/project'); const paths=parseJson(agent,'agent.config.json').paths || {}, derived=derivePaths(config);
    for(const key of ['primaryApp','webAppDir','apiAppDir','databaseDir','migrationsDir']) if(paths[key] && derived[key] && paths[key]!==derived[key]) fail(`paths.${key}`,`agent.config.json conflicts with architecture mapping: ${paths[key]} != ${derived[key]}`);
  }
  if(config.schemaVersion===2){const workspace=require('./workspace-check').checkWorkspace(target,config,{syntax});checks.push(...workspace.checks);failures.push(...workspace.failures);}
  return { status: failures.length ? 'BLOCKED' : 'OK', checks, failures };
}
const optionCache = new Map();
function optsFor(app, ts, dir) {
  if (!optionCache.has(dir)) { const parsed=ts.readConfigFile(path.join(dir,'tsconfig.json'),ts.sys.readFile); optionCache.set(dir,ts.parseJsonConfigFileContent(parsed.config,ts.sys,dir).options); }
  return optionCache.get(dir);
}
module.exports = { checkProject };
