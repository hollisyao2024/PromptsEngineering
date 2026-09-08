const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { planUpdate, hash, json, read, safePath, parseJson, readLock } = require('../../tooling/xirang/engine');
const DEFAULT_SOURCE = path.resolve(__dirname, '../..');
const { derivePaths } = require('../../tooling/xirang/paths');
const CONFIG = 'architecture.config.json';
const catalog = (source = DEFAULT_SOURCE) => parseJson(fs.readFileSync(path.join(source, 'architecture/manifest.json'), 'utf8'), 'architecture catalog');
const identifier = (value, label) => { if (typeof value !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(value)) throw new Error(`invalid ${label}: ${value}`); return value; };
function validateConfig(raw, { target = process.cwd(), source = DEFAULT_SOURCE } = {}) {
  const config = parseJson(JSON.stringify(raw), CONFIG), cat = catalog(source);
  if (!Array.isArray(config.applications)) throw new Error('applications must be an explicit array');
  if (config.schemaVersion !== 1) throw new Error('architecture schemaVersion must be 1');
  const allowed = new Set(['$schema', 'schemaVersion', 'applications', 'datastores', 'modules', 'profiles']);
  for (const key of Object.keys(config)) if (!allowed.has(key)) throw new Error(`unknown architecture field: ${key}`);
  for (const key of ['applications', 'datastores', 'modules', 'profiles']) {
    if (config[key] === undefined) config[key] = [];
    if (!Array.isArray(config[key])) throw new Error(`${key} must be an array`);
  }
  const roots = [], ids = new Set();
  const register = (item, kind) => {
    if (!item || typeof item !== 'object') throw new Error(`invalid ${kind}`);
    identifier(item.id, `${kind} id`);
    const keys = {application:['id','path','stack','sourceDir','targets','components','modules'],datastore:['id','path','engine','consumers'],module:['id','path'],profile:['id','kind','path','edition','environment','applications','denyPatterns']}[kind];
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
      if(app.components && (typeof app.components!=='object'||Array.isArray(app.components)||Object.keys(app.components).some(key=>!['ui','dataTable'].includes(key))))throw new Error('invalid component mapping');
      app.components = { ui: `${app.path}/${app.sourceDir}/components/ui`, dataTable: `${app.path}/${app.sourceDir}/components/data-table`, ...(app.components || {}) };
      for (const p of Object.values(app.components)) {
        safePath(target, p);
        if (!(p.startsWith(app.path + '/') || p.startsWith('packages/'))) throw new Error(`component path must be in its app or shared packages: ${p}`);
      }
      if (app.components.dataTable.startsWith('packages/') && !app.components.ui.startsWith('packages/')) throw new Error('Shared data-table requires shared UI primitives');
      const ui = app.components.ui.toLowerCase(), table = app.components.dataTable.toLowerCase();
      if (ui === table || table.startsWith(ui + '/') || ui.startsWith(table + '/')) throw new Error('data-table must be separate from UI primitives');
    } else if (app.components) throw new Error(`components not supported by stack: ${app.stack}`);
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
function sourceIdentity(source) {
  const result = spawnSync('git', ['rev-parse','HEAD'], { cwd: source, encoding: 'utf8', shell: false });
  return { id: 'xirang', commit: result.status === 0 ? result.stdout.trim() : null };
}
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
  const selected = id => !scope || scope === 'architecture' || scope === id;
  const registration = (owner, selection) => { packages[owner] = { version: cat.version, source: sourceIdentity(source), selection, parametersHash: hash(json(selection)) }; };
  if (!scope || scope === 'architecture') {
    add(CONFIG, json(config), 'init-if-missing', 'architecture:config');
    add('docs/ARCH.md', '# 项目架构\n\n模块索引：[应用架构](arch-modules/application/ARCH.md)。项目负责维护真实技术决策与 ADR。\n', 'init-if-missing', 'architecture:docs');
    add('docs/arch-modules/module-list.md', '# 架构模块\n\n| 模块 | 文档 |\n| --- | --- |\n| 应用架构 | [ARCH.md](application/ARCH.md) |\n', 'init-if-missing', 'architecture:docs');
    add('docs/arch-modules/application/ARCH.md', `# 应用架构选型\n\n配置事实源：architecture.config.json。\n\n${config.applications.map(a => `- ${a.id}：${a.stack}，目录 ${a.path}，目标 ${a.targets.join(', ')}。`).join('\n')}\n\n${config.datastores.map(d => `- ${d.id}：${d.engine}，目录 ${d.path}，消费者 ${d.consumers.join(', ')}。`).join('\n')}\n\n初始化说明请见 architecture/README.md；目录和技术约束请见 docs/standards/。\n`, 'init-if-missing', 'architecture:docs');
    const standardNames = cat.standards.filter(name => name !== 'ui' || config.applications.some(a => cat.stacks[a.stack].ui));
    for (const name of standardNames) add(`docs/standards/${name}.md`, readSource(`architecture/standards/${name}.md`), 'update', 'architecture:standards');
    registration('architecture:standards', { standards: standardNames });
  }
  for (const app of config.applications) {
    const owner = `architecture:app:${app.id}`, stack = cat.stacks[app.stack];
    if (selected(owner)) add(`${app.path}/.gitignore`, 'node_modules/\ndist/\n.next/\nout/\ncoverage/\n*.tsbuildinfo\n.env\n.env.local\n.env.*.local\nsrc-tauri/target/\n', 'init-if-missing', owner);
    if (!stack.ui) { if(selected(owner)){registration(owner,app);copy(`architecture/${stack.template}`, app.path, owner, {appId:app.id,sourceDir:app.sourceDir},p=>p==='package.json'?'merge-json':'init-if-missing');} continue; }
    const uiOwner = `architecture:ui:${app.components.ui}`, tableOwner = `architecture:table:${app.components.dataTable}`;
    for (const [kind, componentPath] of Object.entries(app.components)) {
      const componentOwner = kind === 'ui' ? uiOwner : tableOwner;
      if (!componentPath.startsWith('packages/') || !(selected(owner) || selected(componentOwner))) continue;
      const sharedRoot = componentPath.split('/').slice(0, 2).join('/'), sharedOwner = `architecture:component-package:${sharedRoot}`;
      registration(sharedOwner, { path: sharedRoot });
      add(`${sharedRoot}/.gitignore`, 'node_modules/\n', 'init-if-missing', sharedOwner);
      add(`${sharedRoot}/package.json`, json({ name: `@project/${sharedRoot.split('/')[1]}`, private: true, type: 'module', dependencies: deps.frontend, devDependencies: { '@types/react': deps.frontendDev['@types/react'], '@types/react-dom': deps.frontendDev['@types/react-dom'] } }), 'merge-json', sharedOwner);
    }
    if(selected(owner)||selected(uiOwner)){copy('architecture/components/shadcn/registry/ui', app.components.ui, uiOwner);registration(uiOwner,{path:app.components.ui});}
    if(selected(owner)||selected(tableOwner)){copy('architecture/components/shadcn/registry/data-table', app.components.dataTable, tableOwner);registration(tableOwner,{path:app.components.dataTable});}
    if(!selected(owner))continue;
    registration(owner,app);
    copy(`architecture/${stack.template}`, app.path, owner, { appId: app.id, appPath: app.path, sourceDir: app.sourceDir }, p => p === 'package.json' ? 'merge-json' : 'init-if-missing');
    add(`${app.path}/${app.sourceDir}/lib/utils.ts`, 'import { clsx, type ClassValue } from "clsx";\nimport { twMerge } from "tailwind-merge";\nexport function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)); }\n', 'update', owner);
    add(`${app.path}/${app.sourceDir}/styles.css`, readSource('architecture/components/shadcn/tokens.css') + Object.values(app.components).filter(p => !p.startsWith(app.path + '/')).map(p => `@source ${JSON.stringify(path.posix.relative(`${app.path}/${app.sourceDir}`, p))};\n`).join(''), 'update', owner);
    add(`${app.path}/${app.sourceDir}/app.tsx`, readSource('architecture/components/shadcn/example.tsx'), 'init-if-missing', owner);
    const relative = p => path.posix.relative(app.path, p);
    const utilityPath = app.components.ui.startsWith('packages/') ? `${app.components.ui.split('/').slice(0,2).join('/')}/lib/utils.ts` : `${app.path}/${app.sourceDir}/lib/utils.ts`;
    if (utilityPath.startsWith('packages/')) add(utilityPath, 'import { clsx, type ClassValue } from "clsx";\nimport { twMerge } from "tailwind-merge";\nexport function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)); }\n', 'update', `architecture:component-package:${app.components.ui.split('/').slice(0,2).join('/')}`);
    const paths = { 'react': ['./node_modules/@types/react'], 'react/*': ['./node_modules/@types/react/*'], 'react-dom': ['./node_modules/@types/react-dom'], 'react-dom/*': ['./node_modules/@types/react-dom/*'], '@/lib/utils': [relative(utilityPath)], '@/*': [`./${app.sourceDir}/*`], '@/components/ui/*': [`${relative(app.components.ui)}/*`], '@/components/data-table/*': [`${relative(app.components.dataTable)}/*`] };
    const tsconfig = { compilerOptions: { target: 'ES2022', lib: ['ES2022','DOM','DOM.Iterable'], module: 'ESNext', moduleResolution: 'Bundler', jsx: 'react-jsx', strict: true, skipLibCheck: true, esModuleInterop: true, resolveJsonModule: true, isolatedModules: true, noEmit: true, baseUrl: '.', paths }, include: [app.sourceDir, ...(app.components.ui.startsWith('packages/') ? [relative(app.components.ui),relative(app.components.dataTable)] : [])] };
    if (app.stack === 'react-next') { tsconfig.compilerOptions.plugins = [{ name: 'next' }]; tsconfig.compilerOptions.allowJs = true; tsconfig.compilerOptions.incremental = true; tsconfig.include.push('next-env.d.ts','.next/types/**/*.ts','.next/dev/types/**/*.ts'); tsconfig.exclude = ['node_modules']; }
    add(`${app.path}/tsconfig.json`, json(tsconfig), 'merge-json', owner);
    add(`${app.path}/components.json`, json({ $schema: 'https://ui.shadcn.com/schema.json', style: 'new-york', rsc: app.stack === 'react-next', tsx: true, tailwind: { config: '', css: `${app.sourceDir}/styles.css`, baseColor: 'neutral', cssVariables: true }, aliases: { components: '@/components', ui: '@/components/ui', utils: '@/lib/utils', lib: '@/lib', hooks: '@/hooks' } }), 'merge-json', owner);
    const scripts = { dev: 'vite --host 127.0.0.1', build: 'tsc --noEmit && vite build', 'type-check': 'tsc --noEmit', test: 'vitest run' };
    const dependencies = { ...deps.frontend }, devDependencies = { ...deps.frontendDev, ...deps.uiTest };
    if (app.stack === 'react-next') {
      dependencies.next = '16.3.1'; devDependencies['@tailwindcss/postcss'] = deps.frontendDev.tailwindcss;
      scripts.dev = 'next dev --hostname 127.0.0.1'; scripts.build = 'next build'; scripts.start = 'next start';
      add(`${app.path}/postcss.config.mjs`, 'export default { plugins: { "@tailwindcss/postcss": {} } };\n', 'update', owner);
      const projectRelative = path.posix.relative(app.path, '.') || '.';
      add(`${app.path}/next.config.mjs`, `import path from 'node:path';\nimport { fileURLToPath } from 'node:url';\nexport default { turbopack: { root: path.resolve(path.dirname(fileURLToPath(import.meta.url)), ${JSON.stringify(projectRelative)}) } };\n`, 'init-if-missing', owner);
    } else {
      const aliases = Object.fromEntries(Object.entries(paths).filter(([key]) => key.startsWith('@/') || key === '@/*').sort((a,b) => b[0].length - a[0].length).map(([key, val]) => [key.replace(/\/\*$/, ''), val[0].replace(/\/\*$/, '')]));
      add(`${app.path}/vite.config.ts`, `import { defineConfig } from 'vite';\nimport react from '@vitejs/plugin-react';\nimport tailwindcss from '@tailwindcss/vite';\nimport { fileURLToPath, URL } from 'node:url';\nconst paths = ${JSON.stringify(aliases)};\nexport default defineConfig({ plugins: [react(), tailwindcss()], resolve: { dedupe: ['react', 'react-dom', 'radix-ui', '@tanstack/react-table', 'lucide-react'], alias: Object.fromEntries(Object.entries(paths).map(([key, value]) => [key, fileURLToPath(new URL(value, import.meta.url))])) }, server: { host: '127.0.0.1'${app.stack === 'tauri' ? ', port: 1420, strictPort: true' : ''} } });\n`, 'update', owner);
    }
    if (app.stack === 'tauri') { dependencies['@tauri-apps/api'] = '2.11.1'; devDependencies['@tauri-apps/cli'] = '2.11.4'; scripts['dev:web'] = scripts.dev; scripts['build:web'] = scripts.build; scripts.dev = 'tauri dev'; scripts.build = 'tauri build'; }
    add(`${app.path}/package.json`, json({ name: `@project/${app.id}`, version: '0.1.0', private: true, type: 'module', engines: {node: '>=22.13'}, scripts, dependencies, devDependencies }), 'merge-json', owner);
    add(`${app.path}/vitest.config.ts`, `import { defineConfig } from 'vitest/config';\nimport react from '@vitejs/plugin-react';\nimport { fileURLToPath, URL } from 'node:url';\nexport default defineConfig({ plugins: [react()], resolve: { dedupe: ['react', 'react-dom', 'radix-ui', '@tanstack/react-table', 'lucide-react'], alias: { '@/lib/utils': fileURLToPath(new URL(${JSON.stringify(relative(utilityPath))}, import.meta.url)), '@/components/ui': fileURLToPath(new URL(${JSON.stringify(relative(app.components.ui))}, import.meta.url)), '@/components/data-table': fileURLToPath(new URL(${JSON.stringify(relative(app.components.dataTable))}, import.meta.url)), '@': fileURLToPath(new URL('./${app.sourceDir}', import.meta.url)) } }, test: { environment: 'jsdom', setupFiles: ['./tests/setup.ts'] } });\n`, 'update', owner);
    copy('architecture/components/shadcn/tests', `${app.path}/tests`, owner);
    add(`${app.path}/SHADCN-LICENSE`, readSource('architecture/components/shadcn/LICENSE'), 'append', owner);
  }
  for (const store of config.datastores) {
    const owner = `architecture:store:${store.id}`; if (!selected(owner)) continue; registration(owner, store);
    add(`${store.path}/.gitignore`, 'node_modules/\n*.sqlite\n*.sqlite-*\n.env\n', 'init-if-missing', owner);
    copy(`architecture/${cat.databases[store.engine].template}`, store.path, owner, {}, p => p.startsWith('migrations/') ? 'append' : 'init-if-missing');
    copy('architecture/modules/migrations', store.path, owner, { engine: store.engine });
    const sql = readSource(`architecture/${cat.databases[store.engine].template}/migrations/0001_initial.sql`);
    add(`${store.path}/migrations.json`, json([{ id: '0001_initial', file: '0001_initial.sql', checksum: hash(sql), transactional: true }]), 'append-json', owner);
    add(`${store.path}/package.json`, json({ name: `@project/db-${store.id}`, private: true, type: 'module', engines: {node: '>=22.13'}, scripts: { 'migrate:plan': 'node migrate.mjs', 'migrate:apply': 'node migrate.mjs --apply' }, ...(store.engine === 'postgres' ? { dependencies: { pg: '8.23.0' } } : {}) }), 'merge-json', owner);
  }
  for (const module of config.modules) {
    const owner = `architecture:module:${module.id}`; if (!selected(owner)) continue; registration(owner, module);
    copy(`architecture/${cat.modules[module.id].template}`, module.path, owner, {}, p => /manifest\.json$|contract\.json$|assets\.json$/.test(p) ? 'init-if-missing' : 'update');
  }
  for (const profile of config.profiles) {
    const owner = `architecture:profile:${profile.id}`; if (!selected(owner)) continue; registration(owner, profile);
    copy(`architecture/${cat.profiles[profile.kind].template}`, profile.path, owner);
    add(`${profile.path}/profile.json`, json(profile), 'init-if-missing', owner);
  }
  if (scope && scope !== 'architecture' && !packages[scope]) throw new Error(`scope is not an installed/selected module: ${scope}`);
  if (includeRuntime) {
    for (const root of ['architecture','tooling/xirang']) for (const file of walk(path.join(source, root))) {
      const p = `${root}/${file}`; add(p, readSource(p), 'overwrite', root === 'tooling/xirang' ? 'xirang:engine' : 'architecture:runtime');
    }
    registration('architecture:runtime', { id: 'architecture' });
  }
  const existingConfig = read(target, CONFIG);
  if (existingConfig !== null) inputMap.set(path.join(target, CONFIG), { path: path.join(target, CONFIG), hash: hash(existingConfig) });
  return { assets: assets.sort((a,b) => a.path.localeCompare(b.path)), inputs: [...inputMap.values()], packages, config };
}
function createArchitecturePlan(options) {
  const built = buildArchitectureAssets(options);
  return planUpdate({ ...options, ...built, source: sourceIdentity(options.source || DEFAULT_SOURCE) });
}
module.exports = { catalog, validateConfig, derivePaths, detectProject, buildArchitectureAssets, createArchitecturePlan, sourceIdentity, walk, CONFIG };
