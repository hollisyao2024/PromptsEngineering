const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { expandBlueprint, validateConfig, createArchitecturePlan } = require('../scripts/project');
const { applyPlan } = require('../../tooling/xirang/engine');
const { checkWorkspace, privateModuleIds } = require('../checks/workspace-check');
const { resolveBusinessConfig } = require('../../infra/scripts/qa-tools/business-config');
const { AC_ID_SOURCE, TEST_CASE_ID_SOURCE, extractIds } = require('../../infra/scripts/shared/governance-ids');

const source = path.resolve(__dirname, '../..');
const owner = 'architecture:module:e2e';
const pinned = '1.62.1';

const readJson = (...segments) => JSON.parse(fs.readFileSync(path.join(...segments), 'utf8'));
const readText = (...segments) => fs.readFileSync(path.join(...segments), 'utf8');
const unique = (values) => [...new Set(values)];

// admin-api gives react-vite (admin) and node-ts (api); site and desktop add the other two UI stacks.
function selection(modulePath = 'packages/e2e') {
  const config = expandBlueprint('admin-api', { source, database: 'sqlite' });
  const admin = config.applications.find((app) => app.id === 'admin');
  const consumer = () => ({
    modules: [...admin.modules],
    components: { ...admin.components },
    componentSets: [...admin.componentSets],
  });
  config.applications.push(
    { id: 'site', stack: 'react-next', path: 'apps/site', ...consumer() },
    { id: 'desktop', stack: 'tauri', path: 'apps/desktop', ...consumer() },
  );
  config.modules.push({ id: 'e2e', path: modulePath });
  return config;
}

const serverOnly = () => ({
  schemaVersion: 2,
  workspace: { packageManager: 'pnpm@10.18.3' },
  applications: [{ id: 'api', path: 'apps/api', stack: 'node-ts' }],
  datastores: [],
  modules: [{ id: 'e2e', path: 'packages/e2e' }],
});

function tempRoot(t, prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const target = path.join(root, 'repo');
  fs.mkdirSync(target);
  return { root, target };
}

function install(t, config = selection()) {
  const { root, target } = tempRoot(t, 'xirang-e2e-');
  const request = { source, target, config, includeRuntime: false };
  const plan = createArchitecturePlan(request);
  assert.deepEqual(plan.conflicts, []);
  applyPlan(plan, { runRoot: path.join(root, 'runs') });
  return { request, target, plan, config };
}

function readApps(target, modulePath = 'packages/e2e') {
  const match = /export const apps: E2EApp\[\] = (\[[\s\S]*\]);\s*$/.exec(readText(target, modulePath, 'src/apps.ts'));
  assert.ok(match, 'src/apps.ts must export the apps array as a JSON literal');
  return JSON.parse(match[1]);
}

// The README carries the only thing a project has to paste into agent.config.json.
function readSuite(target, modulePath = 'packages/e2e') {
  const block = /```json\n([\s\S]*?)\n```/.exec(readText(target, modulePath, 'README.md'));
  assert.ok(block, 'README must carry a pasteable qa.business snippet');
  const resolved = resolveBusinessConfig({ qa: { business: JSON.parse(block[1]).qa.business } });
  assert.equal(resolved.ok, true, (resolved.errors || []).join('; '));
  assert.equal(resolved.suites.length, 1);
  return resolved.suites[0];
}

test('TC-OSSKIT-009 e2e is registered consistently in schema, manifest, dependencies, audit, catalog, guide and example', () => {
  const root = path.join(source, 'architecture');
  const schema = readJson(root, 'architecture.schema.json');
  assert.ok(schema.properties.modules.items.properties.id.enum.includes('e2e'), 'schema module id enum');

  const manifest = readJson(root, 'manifest.json');
  assert.deepEqual(manifest.modules.e2e, { template: 'modules/open-source/e2e', requiresWorkspace: true });

  const dependencies = readJson(root, 'dependencies.json');
  assert.deepEqual(dependencies.modules.e2e, { '@playwright/test': pinned });

  const audit = readJson(root, 'dependency-audit.json').packages.find((p) => p.name === '@playwright/test');
  assert.ok(audit, 'dependency-audit.json must record @playwright/test');
  assert.equal(audit.selected, pinned);
  assert.equal(audit.license, 'Apache-2.0');
  assert.match(audit.latest, /^\d+\.\d+\.\d+$/);

  const catalog = readJson(root, 'open-source-catalog.json');
  const item = catalog.implemented.find((m) => m.selection.includes('e2e'));
  assert.ok(item, 'open-source-catalog.json must list e2e as implemented');
  assert.equal(item.status, 'implemented');
  assert.equal(item.defaultPaths, 'packages/e2e');
  assert.deepEqual(item.packages, [{ name: '@playwright/test', version: pinned }]);
  assert.ok(item.sources.length > 0 && item.sources.every((s) => s.startsWith('https://')));
  assert.ok(catalog.verification.tests.includes('__tests__/e2e-driver.test.js'));

  const guide = readText(root, 'guides/open-source-components.md');
  assert.match(guide, /"id"\s*:\s*"e2e"/);
  assert.match(guide, /playwright install/);

  const example = readJson(root, 'examples/open-source-monorepo.json');
  assert.ok(example.modules.some((m) => m.id === 'e2e' && m.path === 'packages/e2e'));
});

test('TC-OSSKIT-009 generates one project and web server per UI app under e2e ownership and converges', (t) => {
  const { request, target, plan } = install(t);
  const mine = plan.entries.filter((entry) => entry.owner === owner);
  assert.deepEqual(Object.fromEntries(mine.map((entry) => [entry.path, entry.strategy])), {
    'packages/e2e/.gitignore': 'append-lines',
    'packages/e2e/README.md': 'update',
    'packages/e2e/package.json': 'merge-json',
    'packages/e2e/playwright.config.ts': 'update',
    'packages/e2e/src/apps.ts': 'update',
    'packages/e2e/tests/admin/sample.spec.ts': 'init-if-missing',
    'packages/e2e/tests/desktop/sample.spec.ts': 'init-if-missing',
    'packages/e2e/tests/site/sample.spec.ts': 'init-if-missing',
    'packages/e2e/tsconfig.json': 'merge-json',
  });

  assert.deepEqual(readApps(target), [
    { id: 'admin', stack: 'react-vite', command: 'pnpm --filter @project/admin run dev --port {port} --strictPort' },
    { id: 'site', stack: 'react-next', command: 'pnpm --filter @project/site run dev -p {port}' },
    { id: 'desktop', stack: 'tauri', command: 'pnpm --filter @project/desktop run dev:web --port {port} --strictPort' },
  ]);

  const lock = readJson(target, 'xirang.lock.json');
  assert.deepEqual(lock.packages[owner].selection, { id: 'e2e', path: 'packages/e2e' });
  assert.match(readText(target, 'pnpm-workspace.yaml'), /packages\/e2e/);

  assert.equal(createArchitecturePlan(request).changes.length, 0);
  fs.appendFileSync(path.join(target, 'packages/e2e/tests/admin/sample.spec.ts'), '\n// project customization\n');
  assert.equal(createArchitecturePlan(request).changes.length, 0);
});

test('TC-OSSKIT-009 a UI app added later updates the app list and adds only its own sample spec', (t) => {
  const { request, target, config } = install(t);
  const admin = config.applications.find((app) => app.id === 'admin');
  config.applications.push({
    id: 'console',
    stack: 'react-vite',
    path: 'apps/console',
    modules: [...admin.modules],
    components: { ...admin.components },
    componentSets: [...admin.componentSets],
  });
  // Adding an app is a project decision: architecture.config.json is project-owned and is updated first.
  fs.writeFileSync(path.join(target, 'architecture.config.json'), JSON.stringify(config));
  const next = createArchitecturePlan(request);
  assert.deepEqual(next.conflicts, []);
  // plan.changes lists changed paths; ownership comes from the plan entries.
  const mine = new Set(next.entries.filter((entry) => entry.owner === owner).map((entry) => entry.path));
  assert.deepEqual(next.changes.filter((changed) => mine.has(changed)).sort(), [
    'packages/e2e/src/apps.ts',
    'packages/e2e/tests/console/sample.spec.ts',
  ]);
  applyPlan(next, { runRoot: path.join(path.dirname(target), 'runs-next') });
  assert.deepEqual(readApps(target).map((app) => app.id), ['admin', 'site', 'desktop', 'console']);
  assert.equal(createArchitecturePlan(request).changes.length, 0);
});

test('TC-OSSKIT-009/010 honours a project-chosen module path in generated files and the pasteable suite', (t) => {
  const { target } = install(t, selection('packages/browser-e2e'));
  assert.ok(fs.existsSync(path.join(target, 'packages/browser-e2e/playwright.config.ts')));
  assert.equal(fs.existsSync(path.join(target, 'packages/e2e')), false);
  const suite = readSuite(target, 'packages/browser-e2e');
  assert.equal(suite.report, 'packages/browser-e2e/reports/junit.xml');
  assert.equal(suite.command, 'pnpm --filter @project/e2e run e2e');
});

test('TC-OSSKIT-010 follows the business-testing contract and nothing more', (t) => {
  const { target, plan } = install(t);
  assert.equal(fs.existsSync(path.join(target, 'agent.config.json')), false, 'the module must not write agent.config.json');
  assert.ok(
    plan.entries.filter((entry) => entry.owner === owner).every((entry) => entry.path.startsWith('packages/e2e/')),
    'every e2e-owned file lives inside the module directory',
  );

  const config = readText(target, 'packages/e2e/playwright.config.ts');
  assert.match(config, /retries:\s*0\b/);
  assert.match(config, /reuseExistingServer:\s*false/);
  assert.match(config, /outputFile:\s*['"]reports\/junit\.xml['"]/);
  assert.match(config, /from ['"]\.\/src\/apps\.ts['"]/);
  for (const name of ['E2E_BASE_PORT', 'E2E_BROWSER_CHANNEL', 'E2E_SKIP_WEBSERVER']) assert.match(config, new RegExp(name));

  const ignored = readText(target, 'packages/e2e/.gitignore').split('\n').filter(Boolean);
  for (const entry of ['node_modules/', 'reports/', 'test-results/', 'playwright-report/']) assert.ok(ignored.includes(entry), entry);

  const pkg = readJson(target, 'packages/e2e/package.json');
  assert.deepEqual(pkg.scripts, { 'type-check': 'tsc --noEmit', e2e: 'playwright test' });
  assert.equal(pkg.dependencies === undefined || Object.keys(pkg.dependencies).length === 0, true);
  assert.equal(pkg.devDependencies['@playwright/test'], readJson(source, 'architecture/dependencies.json').modules.e2e['@playwright/test']);
  assert.ok(pkg.devDependencies.typescript && pkg.devDependencies['@types/node']);

  const tsconfig = readJson(target, 'packages/e2e/tsconfig.json');
  assert.equal(tsconfig.compilerOptions.noEmit, true);
  assert.deepEqual(tsconfig.include, ['src', 'tests', 'playwright.config.ts']);

  const suite = readSuite(target);
  assert.equal(suite.name, 'e2e');
  assert.equal(suite.platform, 'web');
  assert.equal(suite.command, 'pnpm --filter @project/e2e run e2e');
  assert.equal(suite.report, 'packages/e2e/reports/junit.xml');
  assert.doesNotMatch(suite.command, /junit|reports/, 'the report path stays in the driver config, not in the command');

  const readme = readText(target, 'packages/e2e/README.md');
  for (const name of ['E2E_BASE_PORT', 'E2E_BROWSER_CHANNEL', 'E2E_SKIP_WEBSERVER']) assert.match(readme, new RegExp(name));
  assert.match(readme, /playwright install/);

  for (const app of ['admin', 'site', 'desktop']) {
    const spec = readText(target, `packages/e2e/tests/${app}/sample.spec.ts`);
    assert.deepEqual(unique(extractIds(spec, AC_ID_SOURCE)), ['AC-EXAMPLE-001-01'], app);
    assert.deepEqual(unique(extractIds(spec, TEST_CASE_ID_SOURCE)), ['TC-EXAMPLE-001'], app);
  }
});

test('TC-OSSKIT-011 rejects unsupported e2e selections with explicit errors before writing anything', (t) => {
  const declaredBy = (appId) => {
    const config = selection();
    config.applications.find((app) => app.id === appId).modules.push('e2e');
    return config;
  };
  const withOptions = (options) => {
    const config = selection();
    config.modules.find((m) => m.id === 'e2e').options = options;
    return config;
  };
  const v1 = {
    schemaVersion: 1,
    applications: [{ id: 'web', stack: 'react-vite', path: 'apps/web' }],
    modules: [{ id: 'e2e', path: 'packages/e2e' }],
  };
  const cases = [
    ['a workspace without a UI application', serverOnly(), /UI application/i],
    ['a UI application declaring e2e', declaredBy('admin'), /cannot declare|private root/i],
    ['a server application declaring e2e', declaredBy('api'), /cannot declare|private root/i],
    ['options with a browser key', withOptions({ browser: 'chromium' }), /options/i],
    ['options with a channel key', withOptions({ channel: 'chrome' }), /options/i],
    ['a v1 configuration', v1, /v2/i],
  ];
  for (const [label, config, pattern] of cases) {
    assert.throws(() => validateConfig(config, { source }), pattern, `${label}: validateConfig`);
    const { target } = tempRoot(t, 'xirang-e2e-reject-');
    assert.throws(() => createArchitecturePlan({ source, target, config, includeRuntime: false }), pattern, `${label}: plan`);
    assert.deepEqual(fs.readdirSync(target), [], `${label}: nothing is written`);
  }
});

test('TC-OSSKIT-011 workspace-check treats e2e as a private root alongside the existing private modules', () => {
  assert.ok(Array.isArray(privateModuleIds), 'workspace-check must export privateModuleIds');
  for (const id of ['config', 'observability', 'auth', 'authorization', 'jobs', 'logging', 'telemetry', 'e2e']) {
    assert.ok(privateModuleIds.includes(id), id);
  }
});

test('TC-OSSKIT-011 e2e is a private package that exports nothing and that aggregate scripts never run', (t) => {
  const { target, config } = install(t);
  const pkg = readJson(target, 'packages/e2e/package.json');
  assert.equal(pkg.name, '@project/e2e');
  assert.equal(pkg.private, true);
  assert.equal(pkg.type, 'module');
  assert.equal(pkg.exports, undefined);
  for (const name of ['test', 'build', 'generate']) assert.equal(pkg.scripts[name], undefined, `${name} would be run by workspace aggregate commands`);
  assert.equal(pkg.scripts['type-check'], 'tsc --noEmit');

  for (const app of config.applications) {
    const manifest = readJson(target, app.path, 'package.json');
    assert.equal({ ...manifest.dependencies, ...manifest.devDependencies }['@project/e2e'], undefined, `${app.id} must not depend on e2e`);
  }
  assert.deepEqual(checkWorkspace(target, config, { syntax: false }).failures, []);
});
