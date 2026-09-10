const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { planUpdate, hash, json, read, safePath, parseJson, readLock } = require('../../tooling/xirang/engine');
const DEFAULT_SOURCE = path.resolve(__dirname, '../..');
const { derivePaths } = require('../../tooling/xirang/paths');
const { componentCatalog, validateSelection, resolveComponentSets, fileGroup, componentOwner } = require('./component-sets');
const CONFIG = 'architecture.config.json';
const catalog = (source = DEFAULT_SOURCE) => parseJson(fs.readFileSync(path.join(source, 'architecture/manifest.json'), 'utf8'), 'architecture catalog');
const identifier = (value, label) => { if (typeof value !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(value)) throw new Error(`invalid ${label}: ${value}`); return value; };
function validateConfig(raw, { target = process.cwd(), source = DEFAULT_SOURCE } = {}) {
  const config = parseJson(JSON.stringify(raw), CONFIG), cat = catalog(source);
  if (!Array.isArray(config.applications)) throw new Error('applications must be an explicit array');
  if (![1,2].includes(config.schemaVersion)) throw new Error('architecture schemaVersion must be 1 or 2');
  const allowed = new Set(['$schema', 'schemaVersion', 'applications', 'datastores', 'modules', 'profiles', 'fileStorage', ...(config.schemaVersion === 2 ? ['workspace','blueprint','example'] : [])]);
  for (const key of Object.keys(config)) if (!allowed.has(key)) throw new Error(`unknown architecture field: ${key}`);
  for (const key of ['applications', 'datastores', 'modules', 'profiles']) {
    if (config[key] === undefined) config[key] = [];
    if (!Array.isArray(config[key])) throw new Error(`${key} must be an array`);
  }
  const roots = [], ids = new Set();
  const register = (item, kind) => {
    if (!item || typeof item !== 'object') throw new Error(`invalid ${kind}`);
    identifier(item.id, `${kind} id`);
    const keys = {application:['id','path','stack','sourceDir','targets','components','componentSets','modules'],datastore:['id','path','engine','consumers',...(config.schemaVersion===2?['access']:[])],module:['id','path','options'],profile:['id','kind','path','edition','environment','applications','denyPatterns']}[kind];
    for(const key of Object.keys(item))if(!keys.includes(key))throw new Error(`unknown ${kind} field: ${key}`);
    if (ids.has(`${kind}:${item.id}`)) throw new Error(`duplicate ${kind} id: ${item.id}`);
    ids.add(`${kind}:${item.id}`); safePath(target, item.path);
    if (!/^(apps|packages|db|infra|tooling)\//.test(item.path)) throw new Error(`unsupported architecture target path: ${item.path}`);
    const lower = item.path.toLowerCase();
    if (roots.some(p => p === lower || p.startsWith(lower + '/') || lower.startsWith(p + '/'))) throw new Error(`overlapping architecture path: ${item.path}`);
    roots.push(lower);
  };
  for (const app of config.applications) {
    register(app, 'application');
    const stack = cat.stacks[app.stack]; if (!stack) throw new Error(`unknown stack: ${app.stack}`);
    app.sourceDir ||= 'src';
    if (typeof app.sourceDir !== 'string') throw new Error('sourceDir must be a relative directory');
    if (['react-next', 'go'].includes(app.stack) && app.sourceDir !== 'src') throw new Error(`Stack ${app.stack} requires its conventional source layout`);
    safePath(target, app.sourceDir); safePath(target, `${app.path}/${app.sourceDir}`);
    app.targets ||= [stack.targets[0]];
    if (!Array.isArray(app.targets) || !app.targets.length || app.targets.some(t => !stack.targets.includes(t)) || new Set(app.targets).size !== app.targets.length) throw new Error(`unsupported or duplicate target for ${app.id}`);
    if (stack.ui) {
      if(app.components && (typeof app.components!=='object'||Array.isArray(app.components)||Object.keys(app.components).some(key=>!['ui','dataTable','forms','selectors','feedback','advanced'].includes(key))))throw new Error('invalid component mapping');
      app.components = { ui: `${app.path}/${app.sourceDir}/components/ui`, dataTable: `${app.path}/${app.sourceDir}/components/data-table`, ...(app.components || {}) };
      app.componentSets = validateSelection(app.componentSets, source);
      const componentBase = app.components.ui.startsWith('packages/') ? path.posix.dirname(app.components.ui) : `${app.path}/${app.sourceDir}/components`;
      app.components = { forms: `${componentBase}/forms`, selectors: `${componentBase}/selectors`, feedback: `${componentBase}/feedback`, advanced: `${componentBase}/advanced`, ...app.components };
      for (const p of Object.values(app.components)) {
        safePath(target, p);
        if (!(p.startsWith(app.path + '/') || p.startsWith('packages/'))) throw new Error(`component path must be in its app or shared packages: ${p}`);
      }
      if (app.components.dataTable.startsWith('packages/') && !app.components.ui.startsWith('packages/')) throw new Error('Shared data-table requires shared UI primitives');
      const ui = app.components.ui.toLowerCase(), table = app.components.dataTable.toLowerCase();
      if (ui === table || table.startsWith(ui + '/') || ui.startsWith(table + '/')) throw new Error('data-table must be separate from UI primitives');
    } else if (app.components || app.componentSets !== undefined) throw new Error(`components not supported by stack: ${app.stack}`);
    if (app.modules && (!Array.isArray(app.modules) || app.modules.some(m => !config.modules.some(x => x.id === m)))) throw new Error(`unknown application module: ${app.id}`);
  }
  for (const store of config.datastores) {
    register(store, 'datastore');
    if (!cat.databases[store.engine]) throw new Error(`unknown database engine: ${store.engine}`);
    if (!Array.isArray(store.consumers) || !store.consumers.length || store.consumers.some(id => !config.applications.some(app => app.id === id))) throw new Error(`unknown/missing datastore consumer: ${store.id}`);
    if (store.consumers.some(id => cat.stacks[config.applications.find(a => a.id === id).stack].kind === 'web')) throw new Error('browser applications must access a datastore through an API/host port');
  }
  for (const module of config.modules) { register(module, 'module'); if (!cat.modules[module.id]) throw new Error(`unknown module: ${module.id}`); }
  for (const profile of config.profiles) {
    register(profile, 'profile'); profile.kind ||= profile.id; if (!cat.profiles[profile.kind]) throw new Error(`unknown profile kind: ${profile.kind}`);
    identifier(profile.edition, 'edition'); identifier(profile.environment, 'environment');
    if (!Array.isArray(profile.applications) || profile.applications.some(id => !config.applications.some(a => a.id === id))) throw new Error('unknown profile application');
    if (!Array.isArray(profile.denyPatterns) || profile.denyPatterns.some(p => typeof p !== 'string' || !p)) throw new Error('profile denyPatterns must be strings');
  }
  const componentRoots = [];
  for (const app of config.applications) for (const [kind, directory] of Object.entries(app.components || {})) {
    const lower = directory.toLowerCase();
    const overlaps = other => lower === other || lower.startsWith(other + '/') || other.startsWith(lower + '/');
    for (const other of [...config.applications.filter(a => a.id !== app.id), ...config.datastores, ...config.modules, ...config.profiles]) {
      if (overlaps(other.path.toLowerCase())) throw new Error(`component path overlaps another architecture owner: ${directory}`);
    }
    for (const other of componentRoots) {
      if (overlaps(other.path) && !(lower === other.path && kind === other.kind)) throw new Error(`component paths overlap: ${directory}`);
    }
    componentRoots.push({ path: lower, kind });
  }
  require('./storage').validateStorage(config, target);
  require('./open-source').validateModules(config);
  require('./monorepo').validateWorkspaceConfig(config, cat);
  return config;
}
function walk(root, relative = '') {
  const result = [];
  if (!fs.existsSync(path.join(root, relative))) return result;
  for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true }).sort((a,b) => a.name.localeCompare(b.name))) {
    if (['.git','node_modules','.DS_Store','target','dist','.next','.turbo','coverage','out'].includes(entry.name)) continue;
    const p = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) throw new Error(`source symlink: ${p}`);
    if (entry.isDirectory()) result.push(...walk(root, p)); else if (entry.isFile()) result.push(p);
  }
  return result;
}
function detectProject(target) {
  const existing = read(target, CONFIG);
  if (existing) return { ...parseJson(existing, CONFIG), detection: { existingConfig: true, warnings: [] } };
  const config = { schemaVersion: 1, applications: [], datastores: [], modules: [], profiles: [] }, warnings = [];
  for (const parent of ['apps']) {
    const base = safePath(target, parent); if (!fs.existsSync(base)) continue;
    for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const p = `${parent}/${entry.name}`, packageText = read(target, `${p}/package.json`), pkg = packageText ? parseJson(packageText, p) : {}, deps = { ...pkg.dependencies, ...pkg.devDependencies };
      let stack = read(target, `${p}/src-tauri/Cargo.toml`) !== null ? 'tauri' : deps.next ? 'react-next' : deps.react ? 'react-vite' : read(target, `${p}/go.mod`) !== null ? 'go' : packageText ? 'node' : '';
      if (!stack) { warnings.push(`unrecognized app: ${p}`); continue; }
      const app = { id: entry.name, path: p, stack };
      if (['tauri','react-next','react-vite'].includes(stack)) {
        const comp = read(target, `${p}/components.json`), tsText = read(target, `${p}/tsconfig.json`);
        const settings = comp ? parseJson(comp, `${p}/components.json`) : {};
        let ts = {};
        if (tsText) { try { ts = parseJson(tsText, 'tsconfig'); } catch { warnings.push(`JSONC/extended tsconfig needs explicit path review: ${p}`); } }
        const source = fs.existsSync(safePath(target, `${p}/src/renderer/src`)) ? 'src/renderer/src' : 'src'; app.sourceDir = source;
        const resolveAlias = (alias, fallback) => {
          if (!alias) return fallback;
          for (const [key, mapped] of Object.entries(ts.compilerOptions?.paths || {})) {
            const prefix = key.replace(/\*$/, '');
            if (alias.startsWith(prefix) && mapped[0]) {
              const value = mapped[0].replace(/\*$/, alias.slice(prefix.length));
              const resolved = path.posix.normalize(`${p}/${ts.compilerOptions?.baseUrl || '.'}/${value}`);
              safePath(target, resolved); return resolved;
            }
          }
          warnings.push(`unresolved alias ${alias}; verify suggested path for ${p}`); return fallback;
        };
        app.components = { ui: resolveAlias(settings.aliases?.ui, `${p}/${source}/components/ui`), dataTable: `${p}/${source}/components/data-table` };
        const legacy = `${app.components.ui}/data-table.tsx`;
        if (read(target, legacy) !== null) warnings.push(`existing table at ${legacy}; migrate explicitly before selecting a new common table location`);
      }
      config.applications.push(app);
    }
  }
  // Detect storage evidence without guessing a database from directory names alone.
  for (const p of ['db','packages/database']) {
    if (!fs.existsSync(safePath(target, p))) continue;
    const pkg = read(target, `${p}/package.json`), text = pkg || '';
    const engines = [ /"pg"|postgresql/i.test(text) ? 'postgres' : '', /sqlite/i.test(text) ? 'sqlite' : '' ].filter(Boolean);
    if (engines.length === 1) config.datastores.push({ id: 'primary', engine: engines[0], path: p, consumers: config.applications.filter(a => ['node','go','tauri'].includes(a.stack)).map(a => a.id) });
    else warnings.push(`storage responsibilities require project choice: ${p}`);
  }
  return { ...config, detection: { existingConfig: false, warnings } };
}
const { sourceIdentity } = require('../../tooling/xirang/source-cache');

function buildArchitectureAssets({ source = DEFAULT_SOURCE, target, config: raw, includeRuntime = true, scope }) {
  const config = validateConfig(raw, { source, target }), cat = catalog(source), assets = [], inputMap = new Map(), owned = new Map(), packages = {};
  const existingChoice = read(target, CONFIG);
  if(existingChoice !== null && json(validateConfig(parseJson(existingChoice, CONFIG), {source,target})) !== json(config)) throw new Error('Project configuration differs from supplied choices; update the project-owned architecture.config.json first');
  const readSource = p => { const file = safePath(source, p); const content = fs.readFileSync(file, 'utf8'); inputMap.set(file, { path: file, hash: hash(content) }); return content; };
  const add = (p, content, strategy, owner, extra = {}) => {
    if (owned.has(p)) {
      const old = owned.get(p);
      if (old.content === content && old.strategy === strategy && old.owner === owner) return;
      throw new Error(`duplicate target ownership: ${p}`);
    }
    const item = { path: p, content, strategy, owner, version: cat.version, ...extra }; assets.push(item); owned.set(p,item);
  };
  const render = (text, values) => text.replace(/\{\{([a-zA-Z][a-zA-Z0-9]*)\}\}/g, (_, key) => { if (values[key] === undefined) throw new Error(`unknown template parameter: ${key}`); return values[key]; });
  const copy = (from, to, owner, values = {}, policy = () => 'update') => {
    if (!fs.existsSync(path.join(source, from))) throw new Error(`required template source missing: ${from}`);
    for (const rel of walk(path.join(source, from))) {
      const mapped = rel.replace(/\.tpl$/, '').replace(/^src\//, values.sourceDir ? `${values.sourceDir}/` : 'src/');
      add(`${to}/${mapped}`, render(readSource(`${from}/${rel}`), values), policy(mapped), owner);
    }
  };
  readSource('architecture/manifest.json');
  const deps = parseJson(readSource('architecture/dependencies.json'), 'dependencies');
  const closure = new Set(scope ? [scope] : []);
  // A selected capability must bring the manifests and foundations its consumers need.
  if(scope && scope !== 'architecture') {
    let size;
    do {
      size=closure.size;
      for(const app of config.applications) {
        const owner='architecture:app:'+app.id;
        const modules=(app.modules||[]).map(id=>'architecture:module:'+id);
        const stores=config.datastores.filter(d=>d.consumers.includes(app.id)).map(d=>'architecture:store:'+d.id);
        const uiOwners=Object.entries(app.components||{}).flatMap(([kind,dir])=>[componentOwner(kind,dir),'architecture:component-package:'+dir.split('/').slice(0,2).join('/')]);
        if(closure.has('architecture:workspace') || [...modules,...stores,...uiOwners].some(id=>closure.has(id)))closure.add(owner);
        if(closure.has(owner))for(const id of [...modules,...stores])closure.add(id);
      }
      for(const module of config.modules) {
        const owner='architecture:module:'+module.id,db=module.options?.datastore;
        if(db&&closure.has('architecture:store:'+db))closure.add(owner);
        if(!closure.has(owner))continue;
        if(db)closure.add('architecture:store:'+db);
        for(const id of ({contracts:['domain'],'api-client':['contracts'],query:['api-client'],'auth-client':['auth']}[module.id]||[]))closure.add('architecture:module:'+id);
      }
      const s=config.fileStorage;
      if(s) {
        const consumers=[...s.consumers,...s.uploadApplications].map(id=>'architecture:app:'+id),db=s.metadata?.datastore;
        if(consumers.some(id=>closure.has(id))||(db&&closure.has('architecture:store:'+db)))closure.add('architecture:file-storage');
        if(closure.has('architecture:file-storage')){for(const id of consumers)closure.add(id);if(db)closure.add('architecture:store:'+db);}
      }
    } while(size!==closure.size);
  }
  const selected = id => !scope || scope === 'architecture' || closure.has(id);
  const registration = (owner, selection) => { packages[owner] = { version: cat.version, source: sourceIdentity(source), selection, parametersHash: hash(json(selection)) }; };
  add(CONFIG, json(config), 'init-if-missing', 'architecture:config');
  if (!scope || scope === 'architecture') {
    add('docs/ARCH.md', '# 项目架构\n\n模块索引：[应用架构](arch-modules/application/ARCH.md)。项目负责维护真实技术决策与 ADR。\n', 'init-if-missing', 'architecture:docs');
    add('docs/arch-modules/module-list.md', '# 架构模块\n\n| 模块 | 文档 |\n| --- | --- |\n| 应用架构 | [ARCH.md](application/ARCH.md) |\n', 'init-if-missing', 'architecture:docs');
    add('docs/arch-modules/application/ARCH.md', `# 应用架构选型\n\n配置事实源：architecture.config.json。\n\n${config.applications.map(a => `- ${a.id}：${a.stack}，目录 ${a.path}，目标 ${a.targets.join(', ')}。`).join('\n')}\n\n${config.datastores.map(d => `- ${d.id}：${d.engine}，目录 ${d.path}，消费者 ${d.consumers.join(', ')}。`).join('\n')}\n\n初始化说明请见 architecture/README.md；目录和技术约束请见 docs/standards/。\n`, 'init-if-missing', 'architecture:docs');
    const standardNames = cat.standards.filter(name => name !== 'ui' || config.applications.some(a => cat.stacks[a.stack].ui));
    for (const name of standardNames) add(`docs/standards/${name}.md`, readSource(`architecture/standards/${name}.md`), 'update', 'architecture:standards');
    registration('architecture:standards', { standards: standardNames });
  }
  const uiCatalog = componentCatalog(source, readSource);
  const installed = readLock(target);
  const resolvedApps = new Map(config.applications.filter(app => cat.stacks[app.stack].ui).map(app => {
    // Deselecting is not an uninstall. Retained managed source still needs its runtime dependencies.
    const retained = Object.entries(uiCatalog.definition.sets).filter(([, set]) => set.registry.some(name => uiCatalog.registry.items.find(item => item.name === name).files.some(file => installed.files[`${app.components[fileGroup(file)]}/${path.posix.basename(file.path)}`]))).map(([name]) => name);
    return [app.id, resolveComponentSets([...new Set([...app.componentSets, ...retained])], uiCatalog)];
  }));
  const sharedImports = new Map();
  for (const app of config.applications) for (const file of resolvedApps.get(app.id)?.files || []) {
    const directory = app.components[fileGroup(file)];
    if (!directory.startsWith('packages/')) continue;
    for (const [, group, name] of file.content.matchAll(/@\/components\/([a-z-]+)\/([a-z-]+)/g)) {
      const dependency = app.components[group === 'data-table' ? 'dataTable' : group];
      if (!dependency?.startsWith('packages/')) throw new Error(`Shared component ${file.path} cannot import app source: ${group}/${name}`);
      const key = `${directory}/${path.posix.basename(file.path)}:${group}/${name}`;
      if (sharedImports.has(key) && sharedImports.get(key) !== dependency) throw new Error(`Shared component has inconsistent dependency mappings: ${key}`);
      sharedImports.set(key, dependency);
    }
  }
  const sharedPackages = new Map();
  for (const app of config.applications) {
    const resolved = resolvedApps.get(app.id); if (!resolved) continue;
    for (const file of resolved.files) {
      const directory = app.components[fileGroup(file)];
      if (!directory.startsWith('packages/')) continue;
      const root = directory.split('/').slice(0, 2).join('/');
      sharedPackages.set(root, { ...sharedPackages.get(root), ...resolved.dependencies });
    }
  }
  const touchedShared = new Set();
  for (const app of config.applications) {
    const owner = `architecture:app:${app.id}`, stack = cat.stacks[app.stack];
    if (selected(owner)) add(`${app.path}/.gitignore`, 'node_modules/\ndist/\n.next/\nout/\ncoverage/\n*.tsbuildinfo\n.env\n.env.local\n.env.*.local\nsrc-tauri/target/\n', 'init-if-missing', owner);
    if (!stack.ui) { if(selected(owner)){registration(owner,app);copy(`architecture/${stack.template}`, app.path, owner, {appId:app.id,sourceDir:app.sourceDir},p=>p==='package.json'?'merge-json':'init-if-missing');} continue; }
    const resolved = resolvedApps.get(app.id);
    // A component update also updates its consumers' aliases/dependencies and required component closure.
    const included = selected(owner) || Object.entries(app.components).some(([kind, directory]) => selected(componentOwner(kind, directory)) || selected(`architecture:component-package:${directory.split('/').slice(0, 2).join('/')}`));
    if (!included) continue;
    for (const file of resolved.files) {
      const kind = fileGroup(file), directory = app.components[kind], componentId = componentOwner(kind, directory);
      add(`${directory}/${path.posix.basename(file.path)}`, file.content, 'update', componentId);
      registration(componentId, { path: directory });
      if (directory.startsWith('packages/')) touchedShared.add(directory.split('/').slice(0, 2).join('/'));
    }
    registration(owner,app);
    copy(`architecture/${stack.template}`, app.path, owner, { appId: app.id, appPath: app.path, sourceDir: app.sourceDir }, p => p === 'package.json' ? 'merge-json' : 'init-if-missing');
    add(`${app.path}/${app.sourceDir}/lib/utils.ts`, 'export { cn } from "cn";\n', 'init-if-missing', owner);
    add(`${app.path}/${app.sourceDir}/styles.css`, readSource('architecture/components/shadcn/tokens.css') + Object.values(app.components).filter(p => !p.startsWith(app.path + '/')).map(p => `@source ${JSON.stringify(path.posix.relative(`${app.path}/${app.sourceDir}`, p))};\n`).join(''), 'update', owner);
    const hasFoundations = ['data-table', 'forms'].every(name => resolved.sets.includes(name));
    const demo = hasFoundations ? readSource('architecture/components/shadcn/examples/foundation-demo.tsx') : resolved.sets.includes('data-table') ? readSource('architecture/components/shadcn/example.tsx') : 'import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";\nexport function App() { return <main className="p-6"><Card><CardHeader><CardTitle>应用已初始化</CardTitle></CardHeader><CardContent>按 architecture.config.json 选择公共组件，并在此实现项目页面。</CardContent></Card></main>; }\n';
    add(`${app.path}/${app.sourceDir}/app.tsx`, demo, 'init-if-missing', owner);
    if (hasFoundations) add(`${app.path}/${app.sourceDir}/examples/foundation-demo.tsx`, demo, 'init-if-missing', owner);
    const relative = p => { const value = path.posix.relative(app.path, p); return value.startsWith('.') ? value : `./${value}`; };
    const utilityPath = app.components.ui.startsWith('packages/') ? `${app.components.ui.split('/').slice(0,2).join('/')}/lib/utils.ts` : `${app.path}/${app.sourceDir}/lib/utils.ts`;
    if (utilityPath.startsWith('packages/')) add(utilityPath, 'export { cn } from "cn";\n', 'init-if-missing', `architecture:component-package:${app.components.ui.split('/').slice(0,2).join('/')}`);
    const paths = { 'react': ['./node_modules/@types/react'], 'react/*': ['./node_modules/@types/react/*'], 'react-dom': ['./node_modules/@types/react-dom'], 'react-dom/*': ['./node_modules/@types/react-dom/*'], '@/lib/utils': [relative(utilityPath)], '@/*': [`./${app.sourceDir}/*`], '@/components/ui/*': [`${relative(app.components.ui)}/*`], '@/components/data-table/*': [`${relative(app.components.dataTable)}/*`] };
    for (const kind of ['forms','selectors','feedback','advanced']) paths[`@/components/${kind}/*`] = [`${relative(app.components[kind])}/*`];
    const tsconfig = { compilerOptions: { target: 'ES2022', lib: ['ES2022','DOM','DOM.Iterable'], module: 'ESNext', moduleResolution: 'Bundler', jsx: 'react-jsx', strict: true, skipLibCheck: true, esModuleInterop: true, resolveJsonModule: true, isolatedModules: true, noEmit: true, types: app.stack === 'react-next' ? ['node'] : ['node','vite/client'], paths }, include: [app.sourceDir, ...Object.values(app.components).filter(p => p.startsWith('packages/')).map(relative)] };
    if (app.stack === 'react-next') { tsconfig.compilerOptions.plugins = [{ name: 'next' }]; tsconfig.compilerOptions.allowJs = true; tsconfig.compilerOptions.incremental = true; tsconfig.include.push('next-env.d.ts','.next/types/**/*.ts','.next/dev/types/**/*.ts'); tsconfig.exclude = ['node_modules']; }
    add(`${app.path}/tsconfig.json`, json(tsconfig), 'merge-json', owner);
    add(`${app.path}/components.json`, json({ $schema: 'https://ui.shadcn.com/schema.json', style: 'new-york', rsc: app.stack === 'react-next', tsx: true, tailwind: { config: '', css: `${app.sourceDir}/styles.css`, baseColor: 'neutral', cssVariables: true }, aliases: { components: '@/components', ui: '@/components/ui', utils: '@/lib/utils', lib: '@/lib', hooks: '@/hooks' } }), 'merge-json', owner);
    const scripts = { dev: 'vite --host 127.0.0.1', build: 'tsc --noEmit && vite build', 'type-check': 'tsc --noEmit', test: 'vitest run' };
    const dependencies = { ...resolved.dependencies, ...Object.assign({}, ...Object.values(app.components).filter(p => p.startsWith('packages/')).map(p => sharedPackages.get(p.split('/').slice(0,2).join('/')))) }, devDependencies = { ...deps.frontendDev, ...deps.uiTest };
    if (app.stack === 'react-next') {
      dependencies.next = deps.frameworks.next; devDependencies['@tailwindcss/postcss'] = deps.frameworks['@tailwindcss/postcss'];
      scripts.dev = 'next dev --hostname 127.0.0.1'; scripts.build = 'next build'; scripts.start = 'next start';
      add(`${app.path}/next-env.d.ts`, '/// <reference types="next" />\n/// <reference types="next/image-types/global" />\n', 'init-if-missing', owner);
      add(`${app.path}/postcss.config.mjs`, 'export default { plugins: { "@tailwindcss/postcss": {} } };\n', 'update', owner);
      const projectRelative = path.posix.relative(app.path, '.') || '.';
      add(`${app.path}/next.config.mjs`, `import path from 'node:path';\nimport { fileURLToPath } from 'node:url';\nexport default { turbopack: { root: path.resolve(path.dirname(fileURLToPath(import.meta.url)), ${JSON.stringify(projectRelative)}) } };\n`, 'init-if-missing', owner);
    } else {
      const aliases = Object.fromEntries(Object.entries(paths).filter(([key]) => key.startsWith('@/') || key === '@/*').sort((a,b) => b[0].length - a[0].length).map(([key, val]) => [key.replace(/\/\*$/, ''), val[0].replace(/\/\*$/, '')]));
      add(`${app.path}/vite.config.ts`, `import { defineConfig } from 'vite';\nimport react from '@vitejs/plugin-react';\nimport tailwindcss from '@tailwindcss/vite';\nimport { fileURLToPath, URL } from 'node:url';\nconst paths = ${JSON.stringify(aliases)};\nexport default defineConfig({ plugins: [react(), tailwindcss()], resolve: { dedupe: ['react', 'react-dom', 'radix-ui', '@tanstack/react-table', 'lucide-react', 'react-hook-form', 'cmdk', 'react-day-picker', 'sonner', 'next-themes'], alias: Object.fromEntries(Object.entries(paths).map(([key, value]) => [key, fileURLToPath(new URL(value, import.meta.url))])) }, server: { host: '127.0.0.1'${app.stack === 'tauri' ? ', port: 1420, strictPort: true' : ''} } });\n`, 'update', owner);
    }
    if (app.stack === 'tauri') { dependencies['@tauri-apps/api'] = deps.frameworks['@tauri-apps/api']; devDependencies['@tauri-apps/cli'] = deps.frameworks['@tauri-apps/cli']; scripts['dev:web'] = scripts.dev; scripts['build:web'] = scripts.build; scripts.dev = 'tauri dev'; scripts.build = 'tauri build'; }
    add(`${app.path}/package.json`, json({ name: `@project/${app.id}`, version: '0.1.0', private: true, type: 'module', engines: deps.engines, scripts, dependencies, devDependencies }), 'merge-json', owner);
    const testAliases = Object.fromEntries(Object.entries(paths).filter(([key]) => key.startsWith('@/') || key === '@/*').sort((a,b) => b[0].length - a[0].length).map(([key, value]) => [key.replace(/\/\*$/, ''), value[0].replace(/\/\*$/, '')]));
    add(`${app.path}/vitest.config.ts`, `import { defineConfig } from 'vitest/config';\nimport react from '@vitejs/plugin-react';\nimport { fileURLToPath, URL } from 'node:url';\nconst paths = ${JSON.stringify(testAliases)};\nexport default defineConfig({ plugins: [react()], resolve: { dedupe: ['react', 'react-dom', 'radix-ui', '@tanstack/react-table', 'lucide-react', 'react-hook-form', 'cmdk', 'react-day-picker', 'sonner', 'next-themes'], alias: Object.fromEntries(Object.entries(paths).map(([key, value]) => [key, fileURLToPath(new URL(value, import.meta.url))])) }, test: { environment: 'jsdom', setupFiles: ['./tests/setup.ts'] } });\n`, 'update', owner);
    for (const file of resolved.tests) add(`${app.path}/tests/${file}`, readSource(`architecture/components/shadcn/tests/${file}`), 'update', owner);
    add(`${app.path}/SHADCN-LICENSE`, readSource('architecture/components/shadcn/LICENSE'), 'append', owner);
  }
  for (const root of touchedShared) {
    const owner = `architecture:component-package:${root}`;
    registration(owner, { path: root });
    add(`${root}/.gitignore`, 'node_modules/\n', 'init-if-missing', owner);
    add(`${root}/package.json`, json({ name: `@project/${root.split('/')[1]}`, private: true, type: 'module', dependencies: sharedPackages.get(root), devDependencies: { '@types/react': deps.frontendDev['@types/react'], '@types/react-dom': deps.frontendDev['@types/react-dom'] } }), 'merge-json', owner);
  }
  for (const store of config.datastores) {
    const owner = `architecture:store:${store.id}`; if (!selected(owner)) continue; registration(owner, store);
    if (store.access === 'prisma') { require('./monorepo').buildPrismaStore({store,owner,add,copy,readSource,deps}); continue; }
    add(`${store.path}/.gitignore`, 'node_modules/\n*.sqlite\n*.sqlite-*\n.env\n', 'init-if-missing', owner);
    copy(`architecture/${cat.databases[store.engine].template}`, store.path, owner, {}, p => p.startsWith('migrations/') ? 'append' : 'init-if-missing');
    copy('architecture/modules/migrations', store.path, owner, { engine: store.engine });
    const sql = readSource(`architecture/${cat.databases[store.engine].template}/migrations/0001_initial.sql`);
    add(`${store.path}/migrations.json`, json([{ id: '0001_initial', file: '0001_initial.sql', checksum: hash(sql), transactional: true }]), 'append-json', owner);
    add(`${store.path}/package.json`, json({ name: `@project/db-${store.id}`, private: true, type: 'module', engines: {node: '>=22.13'}, scripts: { 'migrate:plan': 'node migrate.mjs', 'migrate:apply': 'node migrate.mjs --apply' }, ...(store.engine === 'postgres' ? { dependencies: { pg: '8.23.0' } } : {}) }), 'merge-json', owner);
  }
  for (const module of config.modules) {
    const owner = `architecture:module:${module.id}`; if (!selected(owner)) continue; registration(owner, module);
    if (config.schemaVersion===2 && require('./monorepo').workspaceModules.includes(module.id)) continue;
    copy(`architecture/${cat.modules[module.id].template}`, module.path, owner, {}, p => /manifest\.json$|contract\.json$|assets\.json$/.test(p) ? 'init-if-missing' : 'update');
  }
  for (const profile of config.profiles) {
    const owner = `architecture:profile:${profile.id}`; if (!selected(owner)) continue; registration(owner, profile);
    copy(`architecture/${cat.profiles[profile.kind].template}`, profile.path, owner);
    add(`${profile.path}/profile.json`, json(profile), 'init-if-missing', owner);
  }
  require('./open-source').buildModules({config,source,target,add,copy,owned,readSource,deps,selected,registration});
  require('./storage').buildStorage({config,source,target,add,owned,copy,readSource,deps,registration,selected});
  if (config.schemaVersion===2) require('./monorepo').buildWorkspace({config,cat,assets,owned,add,copy,readSource,deps,registration,selected,target});
  if (scope && scope !== 'architecture' && !packages[scope]) throw new Error(`scope is not an installed/selected module: ${scope}`);
  if (includeRuntime) {
    const kit = require('../../tooling/xirang/architecture-kit').buildRuntimeAssets({source,target});
    for(const asset of kit.assets)add(asset.path,asset.content,asset.strategy,asset.owner,{mode:asset.mode});
    for(const input of kit.inputs)inputMap.set(input.path,input);
    Object.assign(packages,kit.packages);
  }
  const existingConfig = read(target, CONFIG);
  if (existingConfig !== null) inputMap.set(path.join(target, CONFIG), { path: path.join(target, CONFIG), hash: hash(existingConfig) });
  return { assets: assets.sort((a,b) => a.path.localeCompare(b.path)), inputs: [...inputMap.values()], packages, config };
}
function createArchitecturePlan(options) {
  const built = buildArchitectureAssets(options);
  return planUpdate({ ...options, ...built, source: sourceIdentity(options.source || DEFAULT_SOURCE) });
}
module.exports = { catalog, validateConfig, derivePaths, detectProject, buildArchitectureAssets, createArchitecturePlan, sourceIdentity, walk, CONFIG, expandBlueprint: require('./blueprints').expandBlueprint };
