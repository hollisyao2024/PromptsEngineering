'use strict';

// qa repro 测试夹具：迷你项目里 src/user.js 的 lockAfter 决定“第几次失败锁定”，
// 桩运行器 tools/run-tests.js 逐个执行 tests/*.test.js 导出的用例，把 JUnit 写到 $XIRANG_REPRO_REPORT。
// base 提交没有测试文件，只有叠加 HEAD 的测试文件后，base 侧才跑得出绑定用例。

const path = require('node:path');

const { commitAll, createProject, runGit, runNodeScript } = require('./fixtures/business-testing/builders');
const { designDoc } = require('./qa-design.helpers');

const SCRIPT = path.join(__dirname, '..', 'qa-repro.js');
const BUG = 'BUG-USER-001';
const DESIGN_FILE = 'docs/qa-modules/user/TEST-DESIGN.md';
const RUNNER_COMMAND = 'node tools/run-tests.js';
const RULE = ['RUL-USER-001', 'rule', '第 5 次失败锁定', 'AC-USER-001-01', 'P0', 'example', 'TC-USER-010'];
const BUG_ROW = [BUG, '第 6 次失败才锁定', 'RUL-USER-001', 'qa-audit', 'TC-USER-020', '-'];

// 退出码随失败数非零：qa repro 必须以报告为准，而不是以退出码为准。
const RUNNER = `'use strict';
const fs = require('node:fs');
const path = require('node:path');
const user = require(path.resolve('src/user.js'));
const dir = path.resolve('tests');
const cases = [];
if (fs.existsSync(dir)) {
  for (const file of fs.readdirSync(dir).filter((name) => name.endsWith('.test.js')).sort()) {
    cases.push(...require(path.join(dir, file)));
  }
}
const escape = (value) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
let failures = 0;
const body = cases.map((item) => {
  const attrs = 'name="' + escape(item.name) + '" classname="user" time="0.01"';
  let ok;
  try { ok = item.check(user); } catch (error) { return '<testcase ' + attrs + '><error message="crash">' + escape(String(error)) + '</error></testcase>'; }
  if (ok === 'skip') return '<testcase ' + attrs + '><skipped/></testcase>';
  if (ok) return '<testcase ' + attrs + '/>';
  failures += 1;
  return '<testcase ' + attrs + '><failure message="boom">expected</failure></testcase>';
});
fs.mkdirSync(path.dirname(process.env.XIRANG_REPRO_REPORT), { recursive: true });
fs.writeFileSync(process.env.XIRANG_REPRO_REPORT, '<?xml version="1.0"?>\\n<testsuites><testsuite name="user" tests="' + cases.length + '">' + body.join('') + '</testsuite></testsuites>\\n');
// 运行目录会被 qa repro 清理，环境探针写到夹具指定的目录，供测试核对传入的变量与 cwd。
if (process.env.REPRO_FIXTURE_PROBE) {
  fs.mkdirSync(process.env.REPRO_FIXTURE_PROBE, { recursive: true });
  fs.writeFileSync(path.join(process.env.REPRO_FIXTURE_PROBE, process.env.XIRANG_REPRO_SIDE + '.json'), JSON.stringify({
    bug: process.env.XIRANG_REPRO_BUG,
    tcs: process.env.XIRANG_REPRO_TCS,
    pattern: process.env.XIRANG_REPRO_PATTERN,
    report: process.env.XIRANG_REPRO_REPORT,
    side: process.env.XIRANG_REPRO_SIDE,
    cwd: process.cwd(),
  }));
}
process.exit(failures > 0 ? 1 : 0);
`;

// 默认测试文件：TC-USER-010 与缺陷无关、两侧都通过；TC-USER-020 绑定 BUG-USER-001，只在 lockAfter=5 时通过。
const DEFAULT_TESTS = [
  "{ name: 'TC-USER-010 锁定阈值为正数', check: (user) => user.lockAfter > 0 }",
  "{ name: 'TC-USER-020 BUG-USER-001 第 5 次失败即锁定', check: (user) => user.lockAfter === 5 }",
];

const testsModule = (cases) => `'use strict';\nmodule.exports = [\n  ${cases.join(',\n  ')},\n];\n`;
const userModule = (lockAfter) => `'use strict';\nmodule.exports = { lockAfter: ${lockAfter} };\n`;

// base：缺陷版本、无测试文件、设计里没有 BUG 行；HEAD：修复源码、新增测试文件与 BUG 行。
// config 整体写进 agent.config.json（默认只设 qa.repro.command）。
function reproProject(t, {
  baseLockAfter = 6,
  headLockAfter = 5,
  config = { qa: { repro: { command: RUNNER_COMMAND } } },
  bugs = [BUG_ROW],
  tests = DEFAULT_TESTS,
} = {}) {
  const project = createProject({
    'package.json': `${JSON.stringify({ name: 'fixture', private: true })}\n`,
    'agent.config.json': `${JSON.stringify(config, null, 2)}\n`,
    'tools/run-tests.js': RUNNER,
    'src/user.js': userModule(baseLockAfter),
    [DESIGN_FILE]: designDoc({ rules: [RULE] }),
  }, { git: true });
  t.after(() => project.cleanup());
  const baseSha = runGit(project.repo, ['rev-parse', 'HEAD']).trim();
  project.write({
    'src/user.js': userModule(headLockAfter),
    'tests/user.test.js': testsModule(tests),
    [DESIGN_FILE]: designDoc({ rules: [RULE], bugs }),
  });
  const headSha = commitAll(project.repo, 'fix: lock after 5 failures');
  const probe = path.join(project.root, 'probe');
  return {
    ...project,
    baseSha,
    headSha,
    probe,
    run(args = ['--bug', BUG, '--base', baseSha]) {
      return runNodeScript(SCRIPT, { cwd: project.repo, args, env: { ...process.env, REPRO_FIXTURE_PROBE: probe } });
    },
    commit(files, message = 'more') {
      project.write(files);
      return commitAll(project.repo, message);
    },
  };
}

// 解析 KEY=VALUE 行；同名键取最后一次出现。
function fields(stdout) {
  const result = {};
  for (const line of stdout.split('\n')) {
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/u.exec(line);
    if (match) result[match[1]] = match[2];
  }
  return result;
}

const show = (result) => `${result.stdout}\n${result.stderr}`;

module.exports = {
  BUG,
  BUG_ROW,
  DEFAULT_TESTS,
  DESIGN_FILE,
  RULE,
  RUNNER,
  RUNNER_COMMAND,
  SCRIPT,
  fields,
  reproProject,
  show,
  testsModule,
  userModule,
};
