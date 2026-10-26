'use strict';

// qa mutate 测试夹具：迷你项目的 src/calc.js 是变更源码，tests/ 下的测试文件不参与变异。
// 桩变异命令 tools/mutate.js 不真正变异，只把夹具预置的 mutation-testing-report-schema 报告
// 复制到目标路径（参数 > $XIRANG_MUTATE_REPORT），并按夹具指定的退出码退出。

const fs = require('node:fs');
const path = require('node:path');

const { commitAll, createProject, runGit, runNodeScript } = require('./fixtures/business-testing/builders');
const { designDoc } = require('./qa-design.helpers');
const { fields, show } = require('./qa-repro.helpers');

const SCRIPT = path.join(__dirname, '..', 'qa-mutate.js');
const DESIGN_FILE = 'docs/qa-modules/user/TEST-DESIGN.md';
const SOURCE_FILE = 'src/calc.js';
const TEST_FILE = 'src/calc.test.js';
const MUTATE_COMMAND = 'node tools/mutate.js';
const RULE = ['RUL-USER-001', 'rule', '金额四舍五入到分', 'AC-USER-001-01', 'P0', 'example', 'TC-USER-010'];
const P0_TEST = 'TC-USER-010 金额四舍五入到分';
const OTHER_TEST = 'calc 冒烟用例';

// 源报告路径与退出码经环境变量传入；探针记录命令收到的变量与 cwd。
const STUB = `'use strict';
const fs = require('node:fs');
const path = require('node:path');
const target = process.argv[2] ? path.resolve(process.argv[2]) : process.env.XIRANG_MUTATE_REPORT;
const source = process.env.MUTATE_FIXTURE_SOURCE;
if (process.env.MUTATE_FIXTURE_PROBE) {
  fs.mkdirSync(path.dirname(process.env.MUTATE_FIXTURE_PROBE), { recursive: true });
  fs.writeFileSync(process.env.MUTATE_FIXTURE_PROBE, JSON.stringify({
    files: process.env.XIRANG_MUTATE_FILES,
    report: process.env.XIRANG_MUTATE_REPORT,
    base: process.env.XIRANG_MUTATE_BASE,
    cwd: process.cwd(),
  }));
}
// 模拟超时：同步睡眠，期间不写报告。
if (process.env.MUTATE_FIXTURE_SLEEP) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Number(process.env.MUTATE_FIXTURE_SLEEP));
}
if (source && source !== '-') {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}
process.exit(Number(process.env.MUTATE_FIXTURE_EXIT || 0));
`;

const calcModule = (digits) => `'use strict';\nmodule.exports = { round: (value) => Number(value.toFixed(${digits})) };\n`;
const TESTS_MODULE = "'use strict';\nmodule.exports = ['TC-USER-010 金额四舍五入到分'];\n";

// 变异体构造器：status 之外的字段都有默认值；line 用来区分位置。
function mutant(id, status, { line = 2, mutator = 'ArithmeticOperator', replacement = '-', killedBy, coveredBy } = {}) {
  const item = {
    id,
    mutatorName: mutator,
    replacement,
    location: { start: { line, column: 3 }, end: { line, column: 9 } },
    status,
  };
  if (killedBy !== undefined) item.killedBy = killedBy;
  if (coveredBy !== undefined) item.coveredBy = coveredBy;
  return item;
}

// files: { 路径: [mutant] }；tests: 测试名数组，测试 id 依次为 t0、t1……
function report({ files = {}, tests = [P0_TEST, OTHER_TEST], testFile = TEST_FILE } = {}) {
  const body = {
    schemaVersion: '1.0',
    thresholds: { high: 80, low: 60 },
    files: Object.fromEntries(Object.entries(files).map(([file, mutants]) => [file, { language: 'javascript', source: '', mutants }])),
  };
  if (tests !== null) {
    body.testFiles = { [testFile]: { tests: tests.map((name, index) => ({ id: `t${index}`, name })) } };
  }
  return body;
}

// 默认报告：src/calc.js 4 个变异体，P0 测试（t0）杀死 3 个、1 个存活，分数 75。
function defaultReport() {
  return report({
    files: {
      [SOURCE_FILE]: [
        mutant('m1', 'Killed', { line: 2, killedBy: ['t0'], coveredBy: ['t0', 't1'] }),
        mutant('m2', 'Killed', { line: 3, killedBy: ['t0'], coveredBy: ['t0'] }),
        mutant('m3', 'Timeout', { line: 4, killedBy: ['t0'], coveredBy: ['t0'] }),
        mutant('m4', 'Survived', { line: 5, mutator: 'StringLiteral', replacement: '""', coveredBy: ['t0', 't1'] }),
      ],
    },
  });
}

function mutationConfig(overrides = {}) {
  return { enabled: true, command: MUTATE_COMMAND, include: ['src/**'], minScore: 60, ...overrides };
}

// base：src/calc.js 初版与 P0 设计；HEAD：修改 src/calc.js 并新增 src/calc.test.js
// （命中 include 但属于测试文件，不得进入变异文件集）。
// config 整体写进 agent.config.json；默认启用 qa.mutation。
function mutateProject(t, { config = { qa: { mutation: mutationConfig() } }, head = true } = {}) {
  const project = createProject({
    'package.json': `${JSON.stringify({ name: 'fixture', private: true })}\n`,
    '.gitignore': 'reports/\n',
    'agent.config.json': `${JSON.stringify(config, null, 2)}\n`,
    'tools/mutate.js': STUB,
    [SOURCE_FILE]: calcModule(1),
    [DESIGN_FILE]: designDoc({ rules: [RULE] }),
  }, { git: true });
  t.after(() => project.cleanup());
  const baseSha = runGit(project.repo, ['rev-parse', 'HEAD']).trim();
  const headSha = head
    ? (project.write({ [SOURCE_FILE]: calcModule(2), [TEST_FILE]: TESTS_MODULE }), commitAll(project.repo, 'feat: round to cents'))
    : baseSha;
  const aux = path.join(project.root, 'aux');
  fs.mkdirSync(aux, { recursive: true });
  const probe = path.join(aux, 'probe.json');
  let counter = 0;

  // 把报告对象写进 aux，返回桩命令要复制的源路径；body 为字符串时原样写入（用来制造损坏报告）。
  const stage = (body) => {
    counter += 1;
    const file = path.join(aux, `report-${counter}.json`);
    fs.writeFileSync(file, typeof body === 'string' ? body : `${JSON.stringify(body, null, 2)}\n`);
    return file;
  };

  const invoke = (args, env) => runNodeScript(SCRIPT, {
    cwd: project.repo,
    args,
    env: { ...process.env, MUTATE_FIXTURE_PROBE: probe, ...env },
  });

  return {
    ...project,
    baseSha,
    headSha,
    probe,
    stage,
    // body 为 null 时桩命令不写报告；exit 为桩命令退出码。
    // sleep 为桩命令睡眠毫秒数，用来制造超时。
    run({ body = defaultReport(), exit = 0, sleep, args = ['run', '--base', baseSha] } = {}) {
      const source = body === null ? '-' : stage(body);
      const env = { MUTATE_FIXTURE_SOURCE: source, MUTATE_FIXTURE_EXIT: String(exit) };
      if (sleep !== undefined) env.MUTATE_FIXTURE_SLEEP = String(sleep);
      return invoke(args, env);
    },
    accept(mutantId, reason = '等价变异体：两种写法输出一致', extra = []) {
      return invoke(['accept', '--mutant', mutantId, '--reason', reason, '--base', baseSha, ...extra], {});
    },
    probed() {
      return fs.existsSync(probe) ? JSON.parse(fs.readFileSync(probe, 'utf8')) : null;
    },
    writeConfig(next) {
      project.write({ 'agent.config.json': `${JSON.stringify(next, null, 2)}\n` });
    },
    commit(files, message = 'more') {
      project.write(files);
      return commitAll(project.repo, message);
    },
    head() {
      return runGit(project.repo, ['rev-parse', 'HEAD']).trim();
    },
  };
}

module.exports = {
  DESIGN_FILE,
  MUTATE_COMMAND,
  OTHER_TEST,
  P0_TEST,
  RULE,
  SCRIPT,
  SOURCE_FILE,
  STUB,
  TEST_FILE,
  calcModule,
  defaultReport,
  fields,
  mutant,
  mutateProject,
  mutationConfig,
  report,
  show,
};
