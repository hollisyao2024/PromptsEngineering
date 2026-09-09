const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildArchitectureAssets, createArchitecturePlan } = require('../scripts/project');
const { buildRegistry } = require('../scripts/build-registry');
const { applyPlan, planUpdate } = require('../../tooling/xirang/engine');
const source = path.resolve(__dirname, '../..');

test('generated applications and shared UI declare cn and a compatible compiler configuration', t => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'xirang-dependencies-'));
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));
  const { assets } = buildArchitectureAssets({ source, target, includeRuntime: false, config: {
    schemaVersion: 1,
    applications: [
      { id: 'web', stack: 'react-vite', path: 'apps/web', components: { ui: 'packages/ui/src/ui', dataTable: 'packages/ui/src/data-table' } },
      { id: 'next', stack: 'react-next', path: 'apps/next' },
      { id: 'desktop', stack: 'tauri', path: 'apps/desktop' },
    ],
  } });
  const content = file => assets.find(asset => asset.path === file).content;
  for (const root of ['apps/web', 'apps/next', 'apps/desktop', 'packages/ui']) {
    const pkg = JSON.parse(content(`${root}/package.json`));
    assert.match(pkg.dependencies.cn || '', /^\d+\.\d+\.\d+$/);
  }
  for (const root of ['apps/web', 'apps/next', 'apps/desktop']) {
    const config = JSON.parse(content(`${root}/tsconfig.json`));
    assert.equal(config.compilerOptions.baseUrl, undefined);
    assert.ok(config.compilerOptions.types.includes('node'));
    for (const values of Object.values(config.compilerOptions.paths)) {
      assert.ok(values.every(value => value.startsWith('./') || value.startsWith('../')));
    }
  }
  assert.match(content('packages/ui/lib/utils.ts'), /export \{ cn \} from ["']cn["']/);
  assert.match(content('apps/next/next-env.d.ts'), /reference types="next"/);
});

test('upgrading cn preserves existing project utility exports and converges', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xirang-cn-upgrade-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const target = path.join(root, 'repo'); fs.mkdirSync(target);
  const config = { schemaVersion: 1, applications: [{ id: 'web', stack: 'react-vite', path: 'apps/web', components: { ui: 'packages/ui/src/ui', dataTable: 'packages/ui/src/data-table' } }] };
  const built = buildArchitectureAssets({ source, target, config, includeRuntime: false });
  const utility = 'packages/ui/lib/utils.ts';
  const legacy = 'import { clsx } from "clsx";\nimport { twMerge } from "tailwind-merge";\nexport const cn = (...values) => twMerge(clsx(values));\n';
  const oldAssets = built.assets.map(asset => asset.path === utility ? { ...asset, strategy: 'update', content: legacy } : asset);
  const runRoot = path.join(root, 'runs');
  applyPlan(planUpdate({ source, target, assets: oldAssets, packages: built.packages }), { runRoot });
  const customized = legacy + '\nexport const projectLabel = "keep";\n';
  fs.writeFileSync(path.join(target, utility), customized);
  const next = () => createArchitecturePlan({ source, target, config, includeRuntime: false });
  const plan = next();
  assert.equal(plan.conflicts.length, 0);
  applyPlan(plan, { runRoot });
  assert.equal(fs.readFileSync(path.join(target, utility), 'utf8'), customized);
  assert.equal(next().changes.length, 0);
});

test('registry output installs one pinned version per runtime import, including upstream cn', () => {
  const catalog = require('../dependencies.json');
  const versions = { ...catalog.frontend, ...catalog.components };
  const items = buildRegistry(source);
  for (const item of items) {
    const names = item.dependencies.map(value => value.slice(0, value.lastIndexOf('@')));
    assert.equal(new Set(names).size, names.length, `${item.name}: conflicting dependency versions`);
    assert.ok(item.dependencies.includes(`cn@${versions.cn}`));
    const utils = item.files.find(file => file.target === '@lib/utils.ts');
    assert.match(utils.content, /export \{ cn \} from ["']cn["']/);
    for (const file of item.files) {
      for (const [, specifier] of file.content.matchAll(/from ["']([^"']+)["']/g)) {
        if (specifier.startsWith('.') || specifier.startsWith('@/')) continue;
        const name = specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0];
        assert.ok(item.dependencies.includes(`${name}@${versions[name]}`), `${item.name}: missing ${name}`);
      }
    }
  }
});
