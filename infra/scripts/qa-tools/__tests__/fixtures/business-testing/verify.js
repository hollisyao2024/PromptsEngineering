'use strict';

// `qa verify` 端到端夹具：在场景仓库上补齐真实运行 `qa verify` 所需的前置——本地 bare origin、
// 已推送的特性分支、与 HEAD 绑定的测试范围证据——再以真实 CLI 运行（cwd 即场景仓库）。
// 回执、结果文件都由生产代码写出，测试只读取、不伪造。

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { checkpointTask, createTask, readTaskState, runtimeContext } = require('../../../../agent-runner/agent-task');
const { getQaVerificationReceiptPath, readQaVerificationReceipt } = require('../../../qa-verification-state');
const { commitAll, runGit, runNodeScript } = require('./builders');
const { IOS_CASES, WEB_CASES } = require('./scenario');

const QA_VERIFY = path.join(__dirname, '..', '..', '..', 'qa-verify.js');
const FEATURE_BRANCH = 'feature/accept-check';
const TASK_ID = 'accept-check';
const SCOPE_COMMAND = 'node --test qa-verify-business.test.js';

const ANSI = /\u001b\[[0-9;]*m/gu;
const stripAnsi = (text) => String(text).replace(ANSI, '');

// 本地 bare origin（推送 main）并切到特性分支；之后的提交都落在特性分支上。
function attachOrigin(scenario, branch = FEATURE_BRANCH) {
  const { root, repo } = scenario.project;
  const origin = path.join(root, 'origin.git');
  runGit(root, ['init', '--quiet', '--bare', '--initial-branch=main', origin]);
  runGit(repo, ['remote', 'add', 'origin', origin]);
  runGit(repo, ['push', '--quiet', 'origin', 'main']);
  runGit(repo, ['checkout', '--quiet', '-b', branch]);
  return branch;
}

function pushBranch(scenario, branch = FEATURE_BRANCH) {
  runGit(scenario.project.repo, ['push', '--quiet', 'origin', branch]);
}

// 任务状态目录在第一次创建任务之前并不存在：读取时是 ENOENT（目录缺失）或 “task state not found”（任务缺失）。
function taskExists(context, taskId) {
  try {
    readTaskState({ runsRoot: context.runsRoot, taskId });
    return true;
  } catch (error) {
    if (error.code === 'ENOENT' || /task state not found/u.test(error.message)) return false;
    throw error;
  }
}

// 当前 HEAD 对应的 mutation 任务：测试范围决策与结果证据都绑定该 HEAD，`qa verify` 的范围校验据此放行。
// 可重复调用：任务只创建一次，每次追加一组绑定当时 HEAD 的决策与结果。
function recordTestScope(scenario, taskId = TASK_ID) {
  const context = runtimeContext(scenario.project.repo);
  const head = scenario.head();
  if (!taskExists(context, taskId)) {
    createTask({
      runsRoot: context.runsRoot,
      lockDir: context.lockDir,
      projectRoot: context.projectRoot,
      worktree: context.worktree,
      branch: context.branch,
      taskId,
      goal: 'qa verify 业务验收夹具',
      taskType: 'mutation',
      acceptanceCriteria: ['业务验收门禁随 qa verify 运行'],
      steps: ['验证'],
    });
  }
  const decision = {
    version: 1,
    mode: 'targeted',
    impact_paths: ['infra/scripts/qa-tools/qa-verify.js'],
    commands: [SCOPE_COMMAND],
    not_run: ['全量测试'],
    reason: '夹具：只验证业务验收门禁接入',
  };
  const result = {
    version: 1,
    head_sha: head,
    environment: 'Node 夹具',
    dependencies: '无依赖变更',
    checks: [{ command: SCOPE_COMMAND, exit_code: 0, evidence: '夹具日志' }],
  };
  checkpointTask({
    runsRoot: context.runsRoot,
    lockDir: context.lockDir,
    taskId,
    stepId: 'S1',
    status: 'running',
    evidence: [`TEST_SCOPE_DECISION=${JSON.stringify(decision)}`, `TEST_SCOPE_RESULT=${JSON.stringify(result)}`],
    nextAction: '运行 qa verify',
  });
  return head;
}

// 启用门禁的完整前置：特性分支、web/ios 套件、真实 qa run、推送，并记录绑定当前 HEAD 的测试范围证据。
// business 覆盖 qa.business 的字段（如 enabled）；run 为 false 时不运行 qa run。
function readyForVerify(scenario, { web = WEB_CASES, business = {}, run = true } = {}) {
  attachOrigin(scenario);
  scenario.configure([
    scenario.suite('web', { platform: 'web', cases: web }),
    scenario.suite('ios', { platform: 'ios', cases: IOS_CASES }),
  ], business);
  if (run) {
    const result = scenario.run();
    assert.ok(fs.existsSync(scenario.resultsFile), `qa run 应写出结果文件：${result.stdout}${result.stderr}`);
  }
  pushBranch(scenario);
  recordTestScope(scenario);
}

// 追加一个提交并推送，同时重新绑定测试范围证据：qa verify 先校验范围证据，再才轮到业务门禁。
function advanceHead(scenario) {
  scenario.project.write({ 'docs/notes.md': '# 备注\n结果之后追加的改动\n' });
  commitAll(scenario.project.repo, 'docs: add notes');
  pushBranch(scenario);
  recordTestScope(scenario);
}

// 运行真实的 `qa verify`；stdout 去除 ANSI 颜色后放在 text，按行放在 lines。
function runVerify(scenario, { args = [], env = {} } = {}) {
  const childEnv = { ...process.env, NO_COLOR: '1', GH_TOKEN: '', ...env };
  delete childEnv.QA_PLAN_SESSION_STATE_PATH;
  const result = runNodeScript(QA_VERIFY, { cwd: scenario.project.repo, args, env: childEnv });
  const text = stripAnsi(result.stdout || '');
  return {
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    text,
    lines: text.split('\n').filter((line) => line !== ''),
  };
}

function receiptPath(scenario) {
  return getQaVerificationReceiptPath(scenario.config(), scenario.project.repo, scenario.project.repo);
}

function readReceipt(scenario) {
  return readQaVerificationReceipt(scenario.config(), scenario.project.repo, scenario.project.repo);
}

module.exports = {
  FEATURE_BRANCH,
  advanceHead,
  attachOrigin,
  pushBranch,
  readReceipt,
  readyForVerify,
  receiptPath,
  recordTestScope,
  runVerify,
  stripAnsi,
};
