#!/usr/bin/env node
const path = require('path');
const { spawnSync } = require('child_process');
const { loadConfig, resolveRepoRoot } = require('../shared/config');
const { spawnExitCode } = require('../shared/spawn-exit');
const { createWindowsCmdInvocation, resolvePnpmBin } = require('../shared/toolchain-env');
const { resolveMigrationRegistryConfig } = require('./check-migration-registry');
const { buildGitHubGitEnv } = require('../shared/github-auth');
const { getMainRepoRoot, runWorktreeBootstrap } = require('../worktree-tools/worktree-core');
const { globToRegExp } = require('../qa-tools/qa-integrity');

const repoRoot = resolveRepoRoot({ scriptDir: __dirname });

function parseScope(argv) {
  let scope = 'session';
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--project') {
      scope = 'project';
      continue;
    }
    if (arg === '--scope' && argv[i + 1]) {
      scope = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg.startsWith('--scope=')) {
      scope = arg.split('=')[1];
    }
  }
  return scope === 'project' ? 'project' : 'session';
}

function isHelp(argv) {
  return argv.includes('--help') || argv.includes('-h');
}

function printHelp() {
  console.log(`Usage: node infra/scripts/tdd-tools/tdd-sync.js [options]

Synchronize TDD task/document state after implementation.

Options:
  --scope <session|project>   Sync scope. Defaults to session.
  --project                   Alias for --scope project.
  --base <ref>                Base ref passed to Schema-Doc Sync Gate.
  --quiet                     Reduce gate output where supported.
  --skip-schema-doc-sync      Skip Schema-Doc Sync Gate when policy allows it.
  --all-checks                Run every tdd.projectChecks entry, ignoring paths scoping.
  --keep-going                Keep running project checks after a required failure.
  -h, --help                  Show this help message.
`);
}

function runSchemaDocSyncCheck(argv) {
  const checkScript = path.join(__dirname, 'check-schema-doc-sync.js');
  const scriptArgs = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--skip-schema-doc-sync' || arg.startsWith('--skip-schema-doc-sync=')) {
      scriptArgs.push(arg);
      continue;
    }
    if (arg === '--base' && argv[i + 1]) {
      scriptArgs.push(arg, argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg.startsWith('--base=') || arg === '--quiet') {
      scriptArgs.push(arg);
    }
  }
  const result = spawnSync(process.execPath, [checkScript, ...scriptArgs], {
    encoding: 'utf8',
    stdio: 'inherit',
  });
  return result.status === 0;
}

// paths / projectChecksRunAll 使用与 qa integrity 相同的 glob 语义：`**/` 匹配零或多级目录，`*`/`?` 不跨 `/`。
// 目录须写成 `apps/web/**`，根级通配须写成 `**/*.md`。
function normalizeGlobList(value) {
  if (!Array.isArray(value) || value.length === 0) return null;
  const globs = [];
  for (const item of value) {
    if (typeof item !== 'string' || !item.trim()) return null;
    globs.push(item.trim());
  }
  return globs;
}

function resolveProjectChecks(config = {}) {
  const configured = config.tdd?.projectChecks || [];
  if (!Array.isArray(configured)) {
    throw new Error('invalid tdd.projectChecks entry: expected an array');
  }
  return configured.map((entry) => {
    if (
      !entry
      || typeof entry !== 'object'
      || Array.isArray(entry)
      || typeof entry.name !== 'string'
      || !/^[A-Za-z0-9][A-Za-z0-9:_-]*$/.test(entry.name)
      || typeof entry.required !== 'boolean'
    ) {
      throw new Error(`invalid tdd.projectChecks entry: ${JSON.stringify(entry)}`);
    }
    if (entry.paths === undefined) return { name: entry.name, required: entry.required };
    // paths 一旦声明必须是非空 glob 数组；空数组会让检查永远跳过，按配置错误阻断而不是静默放行。
    const paths = normalizeGlobList(entry.paths);
    if (!paths) {
      throw new Error(`invalid tdd.projectChecks entry: paths must be a non-empty array of glob strings: ${JSON.stringify(entry)}`);
    }
    return { name: entry.name, required: entry.required, paths };
  });
}

function resolveProjectChecksRunAll(config = {}) {
  const configured = config.tdd?.projectChecksRunAll;
  if (configured === undefined || (Array.isArray(configured) && configured.length === 0)) return [];
  const globs = normalizeGlobList(configured);
  if (!globs) {
    throw new Error(`invalid tdd.projectChecksRunAll: expected an array of glob strings: ${JSON.stringify(configured)}`);
  }
  return globs;
}

function parseProjectCheckFlags(argv = []) {
  return {
    allChecks: argv.includes('--all-checks'),
    keepGoing: argv.includes('--keep-going'),
  };
}

// 变更文件 = merge-base(baseRef, HEAD)..HEAD 的提交改动 ∪ 相对 HEAD 的暂存/未暂存改动 ∪ 未忽略的未跟踪文件。
// --no-renames 让重命名同时计入旧路径与新路径；-z 避免中文与空格路径被 core.quotepath 转义。
// 任一步失败返回 ok=false，由调用方回退为全量运行，绝不把“无法计算”当成“没有改动”。
function defaultLocalGit(args, cwd) {
  return spawnSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe', maxBuffer: 64 * 1024 * 1024 });
}

function collectChangedFiles({ repoRoot: cwd, baseRef, runGit }) {
  const git = (args) => {
    const result = runGit ? runGit(args) : defaultLocalGit(args, cwd);
    if (result.error) return { ok: false, detail: result.error.message };
    if (result.status !== 0) return { ok: false, detail: String(result.stderr || result.stdout || '').trim() || `exit ${result.status}` };
    return { ok: true, stdout: String(result.stdout || '') };
  };
  const mergeBase = git(['merge-base', baseRef, 'HEAD']);
  if (!mergeBase.ok) return { ok: false, reason: `merge-base ${baseRef} HEAD failed: ${mergeBase.detail}` };
  const base = mergeBase.stdout.trim();
  const listings = [
    ['diff', '--name-only', '-z', '--no-renames', base, 'HEAD'],
    ['diff', '--name-only', '-z', '--no-renames', 'HEAD'],
    ['ls-files', '--others', '--exclude-standard', '-z'],
  ];
  const files = new Set();
  for (const args of listings) {
    const listed = git(args);
    if (!listed.ok) return { ok: false, reason: `git ${args.slice(0, 2).join(' ')} failed: ${listed.detail}` };
    for (const file of listed.stdout.split('\0')) if (file) files.add(file);
  }
  return { ok: true, mergeBase: base, files: [...files].sort() };
}

function findGlobMatch(files, globs) {
  for (const glob of globs) {
    const pattern = globToRegExp(glob);
    const file = files.find((candidate) => pattern.test(candidate));
    if (file) return { file, glob };
  }
  return null;
}

// 选择规则：--all-checks、diff 不可用、命中 projectChecksRunAll 时全量运行；否则未声明 paths 的检查始终运行，
// 声明 paths 的检查仅在有变更文件命中时运行。被跳过的检查记为 SKIPPED，不计为通过。
function selectProjectChecks(checks, { changedFiles, diffError, allChecks, runAllGlobs = [] } = {}) {
  const runAll = (mode, reason) => ({ mode, reason, plan: checks.map((check) => ({ check, run: true })) });
  if (allChecks) return runAll('ALL_CHECKS_FLAG', '--all-checks');
  if (!Array.isArray(changedFiles)) return runAll('DIFF_UNAVAILABLE', diffError || 'changed files not provided');
  const runAllMatch = findGlobMatch(changedFiles, runAllGlobs);
  if (runAllMatch) return runAll('RUN_ALL_MATCH', `${runAllMatch.file} matches ${runAllMatch.glob}`);
  return {
    mode: 'SCOPED',
    reason: '',
    plan: checks.map((check) => ({ check, run: !check.paths || Boolean(findGlobMatch(changedFiles, check.paths)) })),
  };
}

function createPnpmRunInvocation(scriptName, options = {}) {
  const platform = options.platform || process.platform;
  const env = options.env || process.env;
  const pnpmBin = options.pnpmBin || resolvePnpmBin(platform, env);
  return createWindowsCmdInvocation(
    pnpmBin,
    ['run', scriptName],
    {
      cwd: options.cwd || repoRoot,
      stdio: 'inherit',
      encoding: 'utf8',
      env,
    },
    platform,
    env,
  );
}

function monotonicMs() {
  return Number(process.hrtime.bigint() / 1000000n);
}

function runProjectChecks(config, options = {}) {
  const checks = resolveProjectChecks(config);
  const runAllGlobs = resolveProjectChecksRunAll(config);
  if (checks.length === 0) return true;
  const run = options.spawn || spawnSync;
  const logger = options.logger || console;
  const clock = options.clock || monotonicMs;
  const selection = selectProjectChecks(checks, { ...options, runAllGlobs });
  const changedCount = Array.isArray(options.changedFiles) ? options.changedFiles.length : 'unknown';
  logger.log(`PROJECT_CHECKS_SELECTION=${selection.mode}  CHANGED_FILES=${changedCount}${selection.reason ? `  REASON=${selection.reason}` : ''}`);

  // 每项检查立即输出一行可解析结果，长时间运行时也能看到进度与耗时。
  const results = [];
  const record = (check, status, ms, reason = '') => {
    results.push({ check, status, ms });
    const line = `PROJECT_CHECK=${check.name}|${status}|${ms}ms|${check.required ? 'required' : 'optional'}|${reason}`;
    if (status === 'FAIL') logger.error(line);
    else logger.log(line);
  };
  let requiredFailed = false;
  let stoppedBy = '';
  const gateStartedAt = clock();
  for (const { check, run: selected } of selection.plan) {
    if (!selected) {
      record(check, 'SKIPPED', 0, 'paths not matched');
      continue;
    }
    if (stoppedBy) {
      record(check, 'NOT_RUN', 0, `stopped after required failure: ${stoppedBy}`);
      continue;
    }
    logger.log(`▶ Project Check Gate: ${check.name}`);
    const invocation = createPnpmRunInvocation(check.name, options);
    const startedAt = clock();
    const result = run(invocation.bin, invocation.args, invocation.options);
    const ms = Math.max(0, Math.round(clock() - startedAt));
    if (result.status === 0) {
      logger.log(`✅ Project Check Gate 通过: ${check.name}`);
      record(check, 'PASS', ms);
      continue;
    }
    const detail = result.error ? `spawn error: ${result.error.message}` : (result.signal ? `signal ${result.signal}` : `exit ${result.status}`);
    logger.error(`❌ Project Check Gate 失败: ${check.name} (${detail})`);
    record(check, 'FAIL', ms, detail);
    if (check.required) {
      requiredFailed = true;
      // 默认失败即停：required 已失败时 sync 必然阻断，继续串行跑剩余检查只会浪费时间。
      if (!options.keepGoing) stoppedBy = check.name;
    }
  }
  const totalMs = Math.max(0, Math.round(clock() - gateStartedAt));

  const count = (status) => results.filter((item) => item.status === status).length;
  const passed = count('PASS');
  const failed = count('FAIL');
  const notRun = count('NOT_RUN');
  logger.log(`PROJECT_CHECKS_SUMMARY=total=${results.length} ran=${passed + failed} passed=${passed} failed=${failed} skipped=${count('SKIPPED')} not_run=${notRun} duration=${totalMs}ms`);
  const slowest = results
    .filter((item) => item.status === 'PASS' || item.status === 'FAIL')
    .sort((a, b) => b.ms - a.ms)
    .slice(0, 5);
  if (slowest.length > 0) {
    logger.log(`PROJECT_CHECKS_SLOWEST=${slowest.map((item) => `${item.check.name}:${item.ms}ms`).join(',')}`);
  }
  if (stoppedBy) {
    logger.error(`❌ required 检查 ${stoppedBy} 失败，已停止剩余 ${notRun} 项；需要完整失败清单时加 --keep-going 重跑`);
  }
  return !requiredFailed;
}

function runMigrationRegistryCheck(config, options = {}) {
  if (!resolveMigrationRegistryConfig(config)) return true;
  console.log('▶ Migration Registry Gate');
  const run = options.spawn || spawnSync;
  const result = run(process.execPath, [path.join(__dirname, 'check-migration-registry.js')], {
    cwd: options.cwd || repoRoot,
    stdio: 'inherit',
    encoding: 'utf8',
    env: options.env || process.env,
  });
  if (result.status === 0) {
    console.log('✅ Migration Registry Gate 通过');
    return true;
  }
  console.error(`❌ Migration Registry Gate 失败 (exit ${result.status})`);
  return false;
}

function runDocSizeCheck(config, options = {}) {
  if (config.tdd?.docSize?.enabled !== true) return true;
  console.log('▶ Doc Size Gate');
  const run = options.spawn || spawnSync;
  const result = run(process.execPath, [path.join(__dirname, 'check-doc-size.js')], {
    cwd: options.cwd || repoRoot,
    stdio: 'inherit',
    encoding: 'utf8',
    env: options.env || process.env,
  });
  if (result.status === 0) {
    console.log('✅ Doc Size Gate 通过');
    return true;
  }
  console.error(`❌ Doc Size Gate 失败 (exit ${result.status})`);
  return false;
}

// ── Base Sync Gate ──────────────────────────────────────────────────────────
// /tdd sync 在文档门禁之前把 origin/<base> 合并进当前功能分支：远端 base 前进后，qa verify 会以 STALE_QA_BASE 阻断，
// 而这件事执行器本可以在本地解决。冲突时中止合并并给出稳定错误码，不把半合并状态留给后续门禁。
const BASE_SYNC_NEXT_ACTION = {
  BASE_FETCH_FAILED: '检查网络、GH_TOKEN 与 origin 远端后重跑 pnpm agent -- tdd sync',
};

function baseSyncError(code, message, nextAction) {
  const error = new Error(message);
  error.code = code;
  error.nextAction = nextAction || BASE_SYNC_NEXT_ACTION[code];
  return error;
}

function defaultRunGit(args, cwd) {
  return spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: 'pipe',
    env: buildGitHubGitEnv({ repoRoot: cwd, cwd, args, env: process.env }),
  });
}

function syncWithBase({ repoRoot: cwd, baseBranch, runGit }) {
  const base = String(baseBranch || '').trim();
  if (!base) throw baseSyncError('BASE_BRANCH_MISSING', 'config.baseBranch is empty', '在 agent.config.json 设置 baseBranch 后重跑 pnpm agent -- tdd sync');
  const git = (args) => {
    const result = runGit ? runGit(args) : defaultRunGit(args, cwd);
    if (result.error) throw result.error;
    return { status: result.status, stdout: String(result.stdout || ''), stderr: String(result.stderr || '') };
  };
  const baseRef = `origin/${base}`;

  if (git(['remote', 'get-url', 'origin']).status !== 0) {
    return { status: 'SKIPPED', baseRef, baseSha: '', merged: false, reason: 'origin remote is not configured' };
  }
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']).stdout.trim();
  if (branch === base) {
    return { status: 'SKIPPED', baseRef, baseSha: '', merged: false, reason: `already on base branch ${base}` };
  }

  const fetched = git(['fetch', '--prune', 'origin', base]);
  if (fetched.status !== 0) {
    throw baseSyncError('BASE_FETCH_FAILED', `git fetch origin ${base} failed (exit ${fetched.status}): ${(fetched.stderr || fetched.stdout).trim()}`);
  }
  const verified = git(['rev-parse', '--verify', `${baseRef}^{commit}`]);
  if (verified.status !== 0) {
    throw baseSyncError('BASE_FETCH_FAILED', `${baseRef} is not resolvable after fetch: ${(verified.stderr || verified.stdout).trim()}`);
  }
  const baseSha = verified.stdout.trim();

  if (git(['merge-base', '--is-ancestor', baseRef, 'HEAD']).status === 0) {
    return { status: 'OK', baseRef, baseSha, merged: false };
  }
  const merged = git(['merge', '--no-edit', baseRef]);
  if (merged.status !== 0) {
    git(['merge', '--abort']);
    throw baseSyncError(
      'BASE_MERGE_CONFLICT',
      `git merge --no-edit ${baseRef} failed (exit ${merged.status}): ${`${merged.stdout}\n${merged.stderr}`.trim()}`,
      `在当前 worktree 手动执行 git merge --no-edit ${baseRef}，解决冲突并提交后重跑 pnpm agent -- tdd sync`,
    );
  }
  return { status: 'OK', baseRef, baseSha, merged: true };
}

// ── Deps Sync Gate ──────────────────────────────────────────────────────────
// Base Sync 合并主干后，lockfile 等依赖输入可能已变化；bootstrap 只在 worktree new/resume 时运行，
// 这里复用 worktree.bootstrap（inputs 哈希戳）判定依赖是否过期：auto 模式自动刷新，check 模式阻断并给出命令。
// 允许已有未提交改动，但安装命令不得改变工作区状态。
function depsSyncError(code, message, nextAction) {
  const error = new Error(message);
  error.code = code;
  error.nextAction = nextAction || '修复后重跑 pnpm agent -- tdd sync';
  return error;
}

function syncDependencies({ repoRoot: cwd, config, bootstrap = runWorktreeBootstrap }) {
  let result;
  try {
    result = bootstrap({ worktreePath: cwd, config, cli: {}, mainRoot: getMainRepoRoot(cwd), allowDirty: true });
  } catch (error) {
    throw depsSyncError('DEPS_SYNC_FAILED', error.message, error.nextManualAction);
  }
  if (result.status === 'MISSING') {
    throw depsSyncError('DEPS_STALE', result.reason || 'dependencies are stale', result.nextManualAction);
  }
  const status = result.status === 'READY' && result.refreshed ? 'REFRESHED' : result.status;
  return { status, reason: result.reason || '' };
}

function main() {
  const argv = process.argv.slice(2);
  if (isHelp(argv)) {
    printHelp();
    return;
  }

  const scope = parseScope(argv);

  const config = loadConfig({ repoRoot });
  try {
    const baseSync = syncWithBase({ repoRoot, baseBranch: config.baseBranch || 'main' });
    console.log(`BASE_SYNC=${baseSync.status}${baseSync.baseSha ? `  BASE_REF=${baseSync.baseRef}  BASE_SHA=${baseSync.baseSha}  MERGED=${baseSync.merged}` : `  REASON=${baseSync.reason}`}`);
  } catch (error) {
    console.error(`STATUS=BLOCKED\nREASON=${error.code || 'BASE_SYNC_FAILED'}\nSUMMARY=${error.message}\nNEXT_ACTION=${error.nextAction || '修复后重跑 pnpm agent -- tdd sync'}`);
    process.exit(1);
  }
  try {
    const deps = syncDependencies({ repoRoot, config });
    console.log(`DEPS_SYNC=${deps.status}${deps.reason ? `  REASON=${deps.reason}` : ''}`);
  } catch (error) {
    console.error(`STATUS=BLOCKED
REASON=${error.code || 'DEPS_SYNC_FAILED'}
SUMMARY=${error.message}
NEXT_ACTION=${error.nextAction}`);
    process.exit(1);
  }
  try { require('../shared/architecture-check').runArchitectureCheck(repoRoot); }
  catch (error) { console.error(`STATUS=BLOCKED\nREASON=${error.message}${error.nextAction ? `\nNEXT_ACTION=${error.nextAction}` : ''}`); process.exit(1); }
  if (!runMigrationRegistryCheck(config)) {
    console.error('❌ /tdd sync 失败：Migration Registry Gate 未通过');
    process.exit(1);
  }
  if (!runDocSizeCheck(config)) {
    console.error('❌ /tdd sync 失败：Doc Size Gate 未通过');
    process.exit(1);
  }
  // 项目硬门禁按变更范围筛选：在 Base Sync 合并主干之后计算 diff，--all-checks 跳过筛选。
  const projectCheckFlags = parseProjectCheckFlags(argv);
  const projectCheckOptions = { ...projectCheckFlags };
  if (!projectCheckFlags.allChecks) {
    const changed = collectChangedFiles({ repoRoot, baseRef: `origin/${config.baseBranch || 'main'}` });
    if (changed.ok) projectCheckOptions.changedFiles = changed.files;
    else projectCheckOptions.diffError = changed.reason;
  }
  if (!runProjectChecks(config, projectCheckOptions)) {
    console.error('❌ /tdd sync 失败：项目硬门禁未通过');
    process.exit(1);
  }

  try {
    const result = require('./source-version-sync').syncSourceVersions({ repoRoot, config });
    if (result.status === 'OK') console.log('SOURCE_VERSION_SYNC=' + JSON.stringify(result));
  } catch (error) {
    console.error('STATUS=BLOCKED\nREASON=' + error.message); process.exit(1);
  }

  // Step 1.7：Schema-Doc Sync Gate（强制硬门禁，TDD-EXPERT.md §B.10）
  const schemaDocOk = runSchemaDocSyncCheck(argv);
  if (!schemaDocOk) {
    console.error('❌ /tdd sync 失败：Schema-Doc Sync Gate 未通过（详见上方提示）');
    process.exit(1);
  }

  const tickScript = path.join(__dirname, 'tdd-tick.js');
  const result = spawnSync(process.execPath, [tickScript, `--scope=${scope}`], {
    encoding: 'utf8',
    stdio: 'inherit'
  });

  if (result.error) {
    console.error(`❌ /tdd sync 失败: ${result.error.message}`);
    process.exit(1);
  }

  // tdd-tick 成功后自动生成 Codebase Map（非阻塞）
  if (result.status === 0) {
    const codemapScript = path.join(__dirname, 'generate-codemap.js');
    const codemapResult = spawnSync(process.execPath, [codemapScript, `--scope=${scope}`], {
      encoding: 'utf8',
      stdio: 'inherit'
    });
    if (codemapResult.status !== 0) {
      console.warn('⚠️  Codebase Map 生成失败（不影响 sync 结果）');
    } else {
      console.log('ℹ️  Codebase Map 改动留在工作区，tdd push 会自动提交并改变 HEAD；TEST_SCOPE_RESULT 与 qa run 请在 tdd push 之后基于最终 HEAD 记录/运行。');
    }
  }

  process.exit(spawnExitCode(result));
}

if (require.main === module) main();

module.exports = {
  collectChangedFiles,
  createPnpmRunInvocation,
  parseProjectCheckFlags,
  resolveProjectChecks,
  resolveProjectChecksRunAll,
  runDocSizeCheck,
  runMigrationRegistryCheck,
  runProjectChecks,
  selectProjectChecks,
  syncDependencies,
  syncWithBase,
};
