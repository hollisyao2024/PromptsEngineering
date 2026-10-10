#!/usr/bin/env node
'use strict';

// qa automate：单模块业务测试自动化的确定性编排入口（/qa automate <模块>）。
//
// 设计取舍：
// - 只读。原子 AC、PATHS.md 与测试用例必须由模型按 PRD/QA 专家规范生成；脚本若代写这些内容，
//   就会把“被测代码当前的样子”反写成规格，业务验收失去意义。所以这里只检查现状、
//   指出当前步骤、要激活的专家和要读的手册章节，从不创建目录或写文件。
// - 不重写解析：规格走 qa paths 的 analyzeSpec，套件配置走 resolveBusinessConfig，
//   结果走 readResults/judgeAc，与 qa paths、qa run、qa verify 业务门禁保持同一口径。
// - 套件配置不带模块字段（business-config 的键是严格的），所以步骤 4 只能检查 qa.business
//   整体已启用且登记了套件；步骤 3 用静态扫描判断用例是否已写：测试文件名含 .spec./.test.，
//   且文本引用了该模块每条必需优先级 auto AC 的 AC ID 或其 TC。这样“写了用例但没登记套件”
//   能停在步骤 4，而不是被笼统地归到“没有结果”。
// - 步骤 5 只证明本模块：结果须绑定当前 HEAD、干净工作区与当前配置摘要，且本模块必需优先级
//   的 auto AC 全部被 judgeAc 证明。全局完整性、其他模块与路径覆盖仍由 qa verify 业务门禁把关。
// - 未完成不是错误：STATUS=PENDING 以 0 退出，便于模型循环“执行 → 复查”；
//   只有参数非法、某步需要先修正失败（BLOCKED）或脚本异常（FAILED）才以非零退出。

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { exitOnHelp } = require('../shared/cli-help');
const { getMainRepoRoot, loadConfig, resolveRepoRoot } = require('../shared/config');
const { AC_ID_SOURCE, TEST_CASE_ID_SOURCE, searchPattern } = require('../shared/governance-ids');
const { oneLine } = require('../shared/result-block');
const { resolveBusinessConfig } = require('./business-config');
const { judgeAc, readResults, resultsDirectory } = require('./business-results');
const { PRD_MODULES_DIR, QA_MODULES_DIR } = require('./business-spec');
const { analyzeSpec, formatViolation } = require('./qa-paths');

const USAGE = [
  'Usage: pnpm agent -- qa automate --module <模块>',
  '',
  '只读检查单个模块业务测试自动化的五个步骤，输出当前步骤、要激活的专家与要读的手册章节：',
  '  1 ac-table      模块 PRD §3.2 原子 AC 表（PRD 专家）',
  '  2 paths-model   docs/qa-modules/<模块>/PATHS.md 且 qa paths 无本模块违规（QA 专家）',
  '  3 test-cases    测试用例名引用每条必需优先级 auto AC 的 AC/TC 编号（QA 专家）',
  '  4 suite-config  agent.config.json 的 qa.business 已启用并登记套件',
  '  5 run-results   提交后 qa run 的结果绑定当前 HEAD，且本模块必需 AC 全部通过',
  '',
  '全部完成 STATUS=OK；未完成 STATUS=PENDING（退出码 0）；需先修正 STATUS=BLOCKED（非零退出）。',
  '不创建目录、不写文件、不运行测试。',
].join('\n');

const MODULE_PATTERN = /^[a-z0-9][a-z0-9_-]*$/i;
const HEAD_PATTERN = /^[0-9a-f]{40}([0-9a-f]{24})?$/;
const TEST_FILE_PATTERN = /\.(spec|test)\.[A-Za-z0-9]+$/;
const MAX_TEST_FILE_BYTES = 1024 * 1024;
const PLAYBOOK = 'AgentRoles/Handbooks/QA-TESTING-EXPERT.playbook.md';

// qa paths 中属于路径模型的违规码；其余落在本模块 PRD 内的违规归步骤 1。
// AC_UNLINKED 的位置在 PRD 行上，但修正方式是在 PATHS.md 加转移，所以归步骤 2。
const PATHS_CODES = new Set([
  'PATHS_MISSING', 'PATHS_TABLE_MISSING', 'CRITERION_INVALID', 'REF_UNKNOWN',
  'PATH_EMPTY', 'PATH_DISCONNECTED', 'COVERAGE_GAP', 'AC_UNLINKED',
]);

const STEPS = [
  {
    n: 1,
    name: 'ac-table',
    expert: 'PRD',
    read: `AgentRoles/PRD-WRITER-EXPERT.md；docs/prd-modules/MODULE-TEMPLATE.md#3.2 原子 AC 清单；${PLAYBOOK}#业务测试自动化`,
    action: (module) => `激活 PRD 专家，在 ${PRD_MODULES_DIR}/${module}/PRD.md §3.2 补齐原子 AC 表并按 VIOLATION 修正；优先级与验证方式有歧义时只问最少的问题`,
  },
  {
    n: 2,
    name: 'paths-model',
    expert: 'QA',
    read: `AgentRoles/QA-TESTING-EXPERT.md；${PLAYBOOK}#路径推导；docs/data/templates/qa/PATHS-TEMPLATE.md`,
    action: (module) => `激活 QA 专家，按原子 AC 推导 ${QA_MODULES_DIR}/${module}/PATHS.md，执行 pnpm agent -- qa paths 直到本模块无 VIOLATION`,
  },
  {
    n: 3,
    name: 'test-cases',
    expert: 'QA',
    read: `AgentRoles/QA-TESTING-EXPERT.md；${PLAYBOOK}#数据驱动用例与测试命名`,
    action: () => '按 PATHS.md 的路径编写 Playwright 等自动化用例，测试名包含 AC ID 与 TC 编号，覆盖每条 UNREFERENCED_AC',
  },
  {
    n: 4,
    name: 'suite-config',
    expert: 'QA',
    read: `${PLAYBOOK}#配置与使用顺序`,
    action: () => '在 agent.config.json 设置 qa.business.enabled=true 并在 qa.business.suites 登记套件（name、command、report，可选 platform）',
  },
  {
    n: 5,
    name: 'run-results',
    expert: 'QA',
    read: `${PLAYBOOK}#配置与使用顺序`,
    action: () => '先完成 tdd sync 与 tdd push（push 会自动提交 sync 生成的 CODEBASE_MAP 并改变 HEAD），再在干净工作区对最终 HEAD 执行 pnpm agent -- qa run；有失败先修用例或实现再重跑',
  },
];

function parseArgs(argv) {
  let module = '';
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') continue;
    if (arg === '--module') module = argv[++index] ?? '';
    else if (arg.startsWith('--module=')) module = arg.slice('--module='.length);
    else if (!arg.startsWith('-') && !module) module = arg;
    else throw new Error(`未知参数：${arg}`);
  }
  if (!module) throw new Error('缺少 --module <模块>');
  if (!MODULE_PATTERN.test(module)) throw new Error(`模块名「${module}」不合法：只允许字母、数字、下划线与连字符`);
  return { module };
}

function git(repoRoot, args) {
  const result = spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8', stdio: 'pipe' });
  return { ok: result.status === 0, stdout: result.stdout || '' };
}

function listModuleDirs(repoRoot) {
  const names = new Set();
  for (const dir of [PRD_MODULES_DIR, QA_MODULES_DIR]) {
    let entries = [];
    try {
      entries = fs.readdirSync(path.join(repoRoot, dir), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) if (entry.isDirectory() && MODULE_PATTERN.test(entry.name)) names.add(entry.name);
  }
  return [...names].sort();
}

// 模块名按已有目录解析：精确命中优先；否则大小写不敏感地唯一命中时改用目录名，
// 避免 `--module ADMIN` 因目录是 admin 而静默停在步骤 1。都不命中时返回已有模块供提示。
function resolveModule(repoRoot, requested) {
  const available = listModuleDirs(repoRoot);
  if (available.includes(requested)) return { module: requested, resolvedFrom: '', exists: true, available };
  const matches = available.filter((name) => name.toLowerCase() === requested.toLowerCase());
  if (matches.length === 1) return { module: matches[0], resolvedFrom: requested, exists: true, available };
  return { module: requested, resolvedFrom: '', exists: false, available };
}

const inModule = (file, module) => file.startsWith(`${PRD_MODULES_DIR}/${module}/`) || file.startsWith(`${QA_MODULES_DIR}/${module}/`);

// 步骤 3 的静态扫描：受 Git 管理或未被忽略的测试文件里出现的 AC/TC 编号。
function referencedIds(repoRoot) {
  const listed = git(repoRoot, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']);
  const ids = new Set();
  if (!listed.ok) return ids;
  const patterns = [searchPattern(AC_ID_SOURCE), searchPattern(TEST_CASE_ID_SOURCE)];
  for (const relative of listed.stdout.split('\0')) {
    if (!relative || !TEST_FILE_PATTERN.test(relative) || relative.startsWith('docs/')) continue;
    const file = path.join(repoRoot, relative);
    let text;
    try {
      const stat = fs.statSync(file);
      if (!stat.isFile() || stat.size > MAX_TEST_FILE_BYTES) continue;
      text = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    for (const pattern of patterns) for (const id of text.match(pattern) || []) ids.add(id);
  }
  return ids;
}

function inspect({ repoRoot, mainRoot, config, module, exists = true }) {
  const analysis = analyzeSpec({ repoRoot });
  const business = resolveBusinessConfig(config);
  const required = new Set(business.requiredPriorities);
  const acs = analysis.spec.acs.filter((ac) => ac.domain === module);
  const autoAcs = acs.filter((ac) => ac.verification === 'auto');
  const requiredAuto = autoAcs.filter((ac) => required.has(ac.priority));

  const moduleViolations = analysis.violations.filter((item) => inModule(item.file, module));
  const pathsViolations = moduleViolations.filter((item) => PATHS_CODES.has(item.code) || item.file.startsWith(`${QA_MODULES_DIR}/${module}/`));
  const prdViolations = moduleViolations.filter((item) => !pathsViolations.includes(item));
  const otherViolations = analysis.violations.filter((item) => !inModule(item.file, module) && item.code !== 'NO_ATOMIC_AC');

  const states = [];
  const extra = [];
  const risks = [];

  // 步骤 1：本模块有原子 AC，且本模块 PRD 内没有表格层面的违规。
  if (!exists) states.push(['pending', `${PRD_MODULES_DIR}/${module}/ 不存在：新模块需先建目录与原子 AC 表，已有模块请核对 AVAILABLE_MODULES 中的名称`]);
  else if (acs.length === 0) states.push(['pending', `${PRD_MODULES_DIR}/${module}/ 下没有原子 AC 表`]);
  else if (prdViolations.length > 0) states.push(['pending', `原子 AC 表有 ${prdViolations.length} 项违规`]);
  else states.push(['done', `${acs.length} 条原子 AC（auto ${autoAcs.length}，必需优先级 auto ${requiredAuto.length}）`]);

  // 步骤 2：只有 manual AC 的模块不要求路径模型，与 qa paths 一致。
  if (autoAcs.length === 0 && acs.length > 0) states.push(['done', '本模块没有 auto AC，不需要路径模型']);
  else if (pathsViolations.length > 0) states.push(['pending', `路径模型有 ${pathsViolations.length} 项违规`]);
  else if (acs.length === 0) states.push(['pending', '等待原子 AC']);
  else states.push(['done', `${QA_MODULES_DIR}/${module}/PATHS.md 校验通过`]);
  extra.push(...[...prdViolations, ...pathsViolations].map(formatViolation));

  // 步骤 3：必需优先级 auto AC 全部被用例引用；其余 auto AC 未引用只披露为风险。
  const referenced = referencedIds(repoRoot);
  const isReferenced = (ac) => referenced.has(ac.id) || ac.tcs.some((tc) => referenced.has(tc));
  const missing = requiredAuto.filter((ac) => !isReferenced(ac));
  if (acs.length === 0) states.push(['pending', '等待原子 AC']);
  else if (missing.length > 0) states.push(['pending', `${missing.length} 条必需优先级 auto AC 没有用例引用`]);
  else states.push(['done', `${requiredAuto.length} 条必需优先级 auto AC 均有用例引用`]);
  extra.push(...missing.map((ac) => `UNREFERENCED_AC=${ac.id}`));
  for (const ac of autoAcs.filter((item) => !required.has(item.priority) && !isReferenced(item))) {
    risks.push(`RISK=AC_UNREFERENCED|${ac.id}（${ac.priority}）没有用例引用，不阻断但建议补齐`);
  }

  // 步骤 4：qa.business 合法、已启用、有套件。
  if (!business.ok) {
    states.push(['blocked', `qa.business 配置非法：${business.errors.map((item) => `${item.field} ${item.message}`).join('；')}`]);
  } else if (!business.enabled) states.push(['pending', 'qa.business.enabled 未开启']);
  else if (business.suites.length === 0) states.push(['pending', 'qa.business.suites 没有登记套件']);
  else states.push(['done', `已登记 ${business.suites.length} 个套件：${business.suites.map((suite) => suite.name).join(',')}`]);

  // 步骤 5：结果新鲜且证明本模块必需优先级 auto AC。
  states.push(resultsState({ repoRoot, mainRoot, config, business, requiredAuto }));
  if (otherViolations.length > 0) {
    risks.push(`RISK=SPEC_OTHER_MODULES|其他模块有 ${otherViolations.length} 项规格违规，qa run 与 qa verify 会整体阻断，可先执行 pnpm agent -- qa paths 查看`);
  }

  return { acs, autoAcs, requiredAuto, states, extra, risks };
}

function resultsState({ repoRoot, mainRoot, config, business, requiredAuto }) {
  if (!business.ok || !business.enabled || business.suites.length === 0) return ['pending', '等待套件登记'];
  const read = readResults(resultsDirectory(config, mainRoot, repoRoot));
  if (!read.ok) {
    return read.code === 'RESULTS_MISSING'
      ? ['pending', '还没有 qa run 结果']
      : ['blocked', `结果文件不可用：${oneLine(read.message)}`];
  }
  const { results } = read;
  const head = git(repoRoot, ['rev-parse', 'HEAD']).stdout.trim();
  if (!HEAD_PATTERN.test(head)) return ['pending', '仓库还没有提交'];
  if (results.head_sha !== head) return ['pending', '结果不是针对当前 HEAD 生成的，提交后需重跑 qa run'];
  if (results.worktree_clean !== true) return ['pending', 'qa run 时工作区不干净，提交或忽略改动后重跑'];
  if (results.config_digest !== business.digest) return ['pending', 'qa.business 配置在 qa run 之后变化，需重跑'];

  const failures = [];
  for (const ac of requiredAuto) {
    const verdict = judgeAc(results.acs?.[ac.id]);
    if (!verdict.proven) failures.push(`${ac.id}:${verdict.state}`);
  }
  if (failures.length > 0) return ['blocked', `${failures.length} 条必需 AC 未证明：${failures.join(',')}`];
  return ['done', `${requiredAuto.length} 条必需优先级 auto AC 全部通过（HEAD ${head.slice(0, 12)}）`];
}

function formatReport({ module, inspection, resolution = null }) {
  const { acs, autoAcs, requiredAuto, states, extra, risks } = inspection;
  // 后续步骤依赖前一步：前面有未完成的步骤时，后面的 done 改报 pending，避免模型跳步。
  let firstOpen = -1;
  const shown = states.map(([state, detail], index) => {
    if (firstOpen >= 0 && state === 'done') return ['pending', `等待步骤 ${firstOpen + 1}；当前检查：${detail}`];
    if (firstOpen < 0 && state !== 'done') firstOpen = index;
    return [state, detail];
  });

  const current = firstOpen >= 0 ? STEPS[firstOpen] : null;
  const blocked = current && shown[firstOpen][0] === 'blocked';
  const status = current ? (blocked ? 'BLOCKED' : 'PENDING') : 'OK';
  const lines = [
    `STATUS=${status}`,
    current
      ? `SUMMARY=模块 ${module} 停在步骤 ${current.n}（${current.name}）：${oneLine(shown[firstOpen][1])}`
      : `SUMMARY=模块 ${module} 五个步骤全部完成：${requiredAuto.length} 条必需优先级 auto AC 已由当前 HEAD 的 qa run 证明`,
    current
      ? `NEXT_ACTION=${current.action(module)}；完成后重新执行 pnpm agent -- qa automate --module ${module}`
      : 'NEXT_ACTION=走项目自身的 TDD/QA 合并链（tdd sync → tdd push → qa plan → qa verify → qa merge），由 qa verify 业务门禁做全局终判',
    `MODULE=${module}`,
    ...(resolution && resolution.resolvedFrom ? [`MODULE_RESOLVED=${resolution.resolvedFrom}->${module}`] : []),
    ...(resolution && !resolution.exists ? [`AVAILABLE_MODULES=${resolution.available.join(',') || '-'}`] : []),
    `CURRENT_STEP=${current ? current.n : '-'}`,
    `EXPERT=${current ? current.expert : '-'}`,
    `ACTIVATE=${current ? `[[ACTIVATE: ${current.expert}]]` : '-'}`,
    `READ=${current ? current.read : '-'}`,
    `AC_TOTAL=${acs.length}  AC_AUTO=${autoAcs.length}  AC_REQUIRED_AUTO=${requiredAuto.length}`,
    ...STEPS.map((step, index) => `STEP=${step.n}|${step.name}|${shown[index][0]}|${oneLine(shown[index][1])}`),
    ...extra,
    ...risks,
  ];
  return { status, lines };
}

function main(argv = process.argv.slice(2)) {
  let module;
  try {
    ({ module } = parseArgs(argv));
  } catch (error) {
    console.log([
      'STATUS=BLOCKED',
      `SUMMARY=${oneLine(error.message)}`,
      'NEXT_ACTION=执行 pnpm agent -- qa automate --module <模块>，模块名取 docs/prd-modules/ 下的目录名',
    ].join('\n'));
    process.exitCode = 2;
    return;
  }
  const repoRoot = resolveRepoRoot({ scriptDir: __dirname });
  const config = loadConfig({ repoRoot });
  const resolution = resolveModule(repoRoot, module);
  module = resolution.module;
  const inspection = inspect({ repoRoot, mainRoot: getMainRepoRoot(repoRoot), config, module, exists: resolution.exists });
  const { status, lines } = formatReport({ module, inspection, resolution });
  console.log(lines.join('\n'));
  process.exitCode = status === 'BLOCKED' ? 1 : 0;
}

if (require.main === module) {
  exitOnHelp(USAGE);
  try {
    main();
  } catch (error) {
    console.log([
      'STATUS=FAILED',
      `SUMMARY=qa automate 执行失败：${oneLine(error.message)}`,
      'NEXT_ACTION=检查 docs/prd-modules、docs/qa-modules 与 agent.config.json 是否可读后重试',
    ].join('\n'));
    process.exitCode = 1;
  }
}

module.exports = { STEPS, formatReport, inspect, parseArgs, resolveModule };
