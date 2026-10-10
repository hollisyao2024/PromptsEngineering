'use strict';

// 门禁与闭环测试共用的场景：真实 git 项目，ac-results.json 由真实的 `qa run` CLI
// 针对 suites/emit.js 桩套件生成。门禁读到的因此是生产代码写出的结果，
// 测试再按场景改动结果、报告副本或仓库来制造“陈旧、被改动、失败”等状态。

const fs = require('node:fs');
const path = require('node:path');

const { DEFAULT_CONFIG, loadConfig } = require('../../../../shared/config');
const { RESULTS_FILE, readResults, resultsDirectory } = require('../../../business-results');
const { commitAll, createProject, junitReport, runGit, runNodeScript, shopProject } = require('./builders');

const QA_RUN = path.join(__dirname, '..', '..', '..', 'qa-run.js');
const EMIT = path.join(__dirname, 'suites', 'emit.js');

const quote = (value) => JSON.stringify(String(value));

// SHOP 规格下 web 套件覆盖 AC-SHOP-001-01/02/03，ios 套件覆盖 AC-SHOP-001-02 的 ios 端。
const WEB_CASES = [
  { name: 'AC-SHOP-001-01 / TC-SHOP-001 结算进入支付页', status: 'passed' },
  { name: 'AC-SHOP-001-02 / TC-SHOP-002 web 支付成功', status: 'passed' },
  { name: 'AC-SHOP-001-03 / TC-SHOP-003 银行拒绝后可重试', status: 'passed' },
];
const IOS_CASES = [{ name: 'AC-SHOP-001-02 iOS 支付成功', status: 'passed' }];

function withStatus(cases, name, status) {
  return cases.map((item) => (item.name.includes(name) ? { ...item, status } : item));
}

// files 追加到项目；默认忽略 reports/，这样“运行 → 提交 → 再运行”的循环不会把报告提交进仓库。
function createScenario({ files = {}, shop = true } = {}) {
  const seed = { '.gitignore': 'reports/\n', ...files };
  const project = shop
    ? shopProject(seed, { git: true })
    : createProject({ 'README.md': '# 空项目\n', ...seed }, { git: true });
  const aux = path.join(project.root, 'aux');
  fs.mkdirSync(aux, { recursive: true });
  const marker = path.join(aux, 'markers.log');
  const resultsDir = resultsDirectory(DEFAULT_CONFIG, project.repo, project.repo);
  const resultsFile = path.join(resultsDir, RESULTS_FILE);

  return {
    project,
    aux,
    resultsDir,
    resultsFile,

    // 把预置报告复制到 target 并以 code 退出的套件；没有 cases/xml 时不产出报告。
    suite(name, { platform = '-', cases, xml, code = 0, report = `reports/${name}.xml`, timeoutSeconds } = {}) {
      let source = '-';
      const content = xml !== undefined ? xml : (cases ? junitReport(cases, { suite: name }) : undefined);
      if (content !== undefined) {
        source = path.join(aux, `${name}.source.xml`);
        fs.writeFileSync(source, content);
      }
      const args = [EMIT, name, source, report, code, marker];
      const entry = { name, platform, command: `${quote(process.execPath)} ${args.map(quote).join(' ')}`, report };
      if (timeoutSeconds !== undefined) entry.timeoutSeconds = timeoutSeconds;
      return entry;
    },

    // 写入 qa.business 配置并提交，返回提交后的 HEAD。
    configure(suites, business = {}) {
      project.write({ 'agent.config.json': `${JSON.stringify({ qa: { business: { enabled: true, ...business, suites } } }, null, 2)}\n` });
      return commitAll(project.repo, 'configure business suites');
    },

    // 运行真实的 qa run；套件有失败时它以非零退出，但结果照常写出。env 追加到子进程环境（如注入探针变量）。
    run({ env = {} } = {}) {
      return runNodeScript(QA_RUN, { cwd: project.repo, env: { ...process.env, ...env } });
    },

    // 基线：web 与 ios 两个套件全部通过，AC-SHOP-002-01 是人工验收。
    baseline(business = {}) {
      this.configure([
        this.suite('web', { platform: 'web', cases: WEB_CASES }),
        this.suite('ios', { platform: 'ios', cases: IOS_CASES }),
      ], business);
      const result = this.run();
      if (result.status !== 0) throw new Error(`基线 qa run 应当成功：${result.stdout}${result.stderr}`);
      return this;
    },

    head() {
      return runGit(project.repo, ['rev-parse', 'HEAD']).trim();
    },

    // 以磁盘上的当前配置（含未提交的改动）加载完整配置。
    config() {
      return loadConfig({ repoRoot: project.repo, env: {}, cli: {} });
    },

    results() {
      return readResults(resultsDir);
    },

    // 读出 ac-results.json，交给 mutate 修改后按原格式写回。
    editResults(mutate) {
      const results = JSON.parse(fs.readFileSync(resultsFile, 'utf8'));
      mutate(results);
      fs.writeFileSync(resultsFile, `${JSON.stringify(results, null, 2)}\n`);
      return results;
    },

    copyFile(name) {
      return path.join(resultsDir, 'reports', `${name}.xml`);
    },

    cleanup() {
      project.cleanup();
    },
  };
}

module.exports = { IOS_CASES, WEB_CASES, createScenario, withStatus };
