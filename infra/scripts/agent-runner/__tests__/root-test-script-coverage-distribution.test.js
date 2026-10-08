'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

// root-test-script-coverage.test.js 随 infra/scripts/agent-runner 分发到实际项目，但它检查的 scripts.test 只存在于息壤源。
// 这里把它复制进临时项目根目录运行：实际项目必须带原因跳过而不是抛 TypeError，息壤源内仍要强制覆盖断言。
const SUBJECT = path.join(__dirname, 'root-test-script-coverage.test.js');
const SUBJECT_PATH = 'infra/scripts/agent-runner/__tests__/root-test-script-coverage.test.js';
const SOURCE_CONFIG = { template: { role: 'source' } };
const SOURCE_TEST_SCRIPT = 'node --test infra/scripts/*/__tests__/*.test.js architecture/__tests__/*.test.js architecture/__tests__/*.test.mjs';

// 本文件同样会随 agent-runner 分发；它验证的是息壤源对分发行为的保证，实际项目无需再跑，避免给下游增加失败面和耗时。
function isTemplateSource() {
  try {
    const config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '..', '..', 'agent.config.json'), 'utf8'));
    return Boolean(config.template && config.template.role === 'source');
  } catch {
    return false;
  }
}
const TEMPLATE_SOURCE_ONLY = isTemplateSource() ? false : '仅息壤源验证根 scripts.test 覆盖检查的分发行为，实际项目跳过';

// 嵌套的 node --test 不能继承外层运行器的 NODE_TEST_CONTEXT；GIT_* 会让临时目录里的 git 命令误操作外层仓库。
function isolatedEnv() {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  for (const key of Object.keys(env)) {
    if (key.startsWith('GIT_')) delete env[key];
  }
  return env;
}

function createRoot(t, { config, packageJson, tracked = [] }) {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'xirang-root-test-coverage-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (relative, content) => {
    fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
    fs.writeFileSync(path.join(root, relative), content);
  };
  write(SUBJECT_PATH, fs.readFileSync(SUBJECT));
  write('package.json', JSON.stringify(packageJson));
  if (config !== undefined) write('agent.config.json', JSON.stringify(config));
  for (const relative of tracked) write(relative, "'use strict';\n");
  for (const args of [['init', '--quiet'], ['add', '--all']]) {
    execFileSync('git', args, { cwd: root, env: isolatedEnv(), stdio: 'pipe' });
  }
  return root;
}

function runSubject(root) {
  const result = spawnSync(process.execPath, ['--test', '--test-reporter=tap', path.join(root, SUBJECT_PATH)], {
    cwd: root,
    encoding: 'utf8',
    env: isolatedEnv(),
  });
  const output = `${result.stdout}${result.stderr}`;
  const total = (name) => Number(new RegExp(`^# ${name} (\\d+)$`, 'mu').exec(output)?.[1]);
  return { status: result.status, output, counts: { pass: total('pass'), fail: total('fail'), skipped: total('skipped') } };
}

const APPLIED_PROJECTS = [
  ['no agent.config.json and no scripts in package.json', undefined, { name: 'applied' }],
  ['initialised agent.config.json and no scripts.test', { _configNotice: 'project overrides only' }, { name: 'applied', scripts: { agent: 'node infra/scripts/agent-runner/agent-cli.js' } }],
  ['its own scripts.test without test globs', { template: { role: 'consumer' } }, { name: 'applied', scripts: { test: 'vitest run' } }],
];

for (const [description, config, packageJson] of APPLIED_PROJECTS) {
  test(`applied project with ${description} skips the template-only coverage check`, { skip: TEMPLATE_SOURCE_ONLY }, (t) => {
    const result = runSubject(createRoot(t, { config, packageJson }));
    assert.equal(result.status, 0, result.output);
    assert.deepEqual(result.counts, { pass: 0, fail: 0, skipped: 1 }, result.output);
    assert.doesNotMatch(result.output, /TypeError/u);
  });
}

test('template source with a covering scripts.test still runs and passes the check', { skip: TEMPLATE_SOURCE_ONLY }, (t) => {
  const result = runSubject(createRoot(t, {
    config: SOURCE_CONFIG,
    packageJson: { scripts: { test: SOURCE_TEST_SCRIPT } },
    tracked: ['infra/scripts/gadgets/__tests__/covered.test.js', 'architecture/__tests__/covered.test.mjs'],
  }));
  assert.equal(result.status, 0, result.output);
  assert.deepEqual(result.counts, { pass: 1, fail: 0, skipped: 0 }, result.output);
});

test('template source still fails when a tracked unit test is not covered by scripts.test', { skip: TEMPLATE_SOURCE_ONLY }, (t) => {
  const orphan = 'infra/scripts/gadgets/__tests__/orphan.test.js';
  const result = runSubject(createRoot(t, {
    config: SOURCE_CONFIG,
    packageJson: { scripts: { test: 'node --test infra/scripts/agent-runner/__tests__/*.test.js' } },
    tracked: [orphan],
  }));
  assert.notEqual(result.status, 0, result.output);
  assert.equal(result.counts.fail, 1, result.output);
  assert.ok(result.output.includes(orphan), result.output);
});

test('template source without scripts.test fails with a clear message instead of a TypeError', { skip: TEMPLATE_SOURCE_ONLY }, (t) => {
  const result = runSubject(createRoot(t, { config: SOURCE_CONFIG, packageJson: { name: 'xirang', scripts: {} } }));
  assert.notEqual(result.status, 0, result.output);
  assert.equal(result.counts.fail, 1, result.output);
  assert.match(result.output, /must define scripts\.test/u);
  assert.doesNotMatch(result.output, /TypeError/u);
});
