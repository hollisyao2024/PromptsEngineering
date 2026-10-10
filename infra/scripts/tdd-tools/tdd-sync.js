#!/usr/bin/env node
const path = require('path');
const { spawnSync } = require('child_process');
const { loadConfig, resolveRepoRoot } = require('../shared/config');
const { spawnExitCode } = require('../shared/spawn-exit');
const { createWindowsCmdInvocation, resolvePnpmBin } = require('../shared/toolchain-env');
const { resolveMigrationRegistryConfig } = require('./check-migration-registry');
const { buildGitHubGitEnv } = require('../shared/github-auth');

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
    return { name: entry.name, required: entry.required };
  });
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

function runProjectChecks(config, options = {}) {
  const checks = resolveProjectChecks(config);
  const run = options.spawn || spawnSync;
  let requiredFailed = false;
  for (const check of checks) {
    console.log(`▶ Project Check Gate: ${check.name}`);
    const invocation = createPnpmRunInvocation(check.name, options);
    const result = run(invocation.bin, invocation.args, invocation.options);
    if (result.status === 0) {
      console.log(`✅ Project Check Gate 通过: ${check.name}`);
      continue;
    }
    console.error(`❌ Project Check Gate 失败: ${check.name} (exit ${result.status})`);
    if (check.required) requiredFailed = true;
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
  try { require('../shared/architecture-check').runArchitectureCheck(repoRoot); }
  catch (error) { console.error(`STATUS=BLOCKED\nREASON=${error.message}${error.nextAction ? `\nNEXT_ACTION=${error.nextAction}` : ''}`); process.exit(1); }
  if (!runMigrationRegistryCheck(config)) {
    console.error('❌ /tdd sync 失败：Migration Registry Gate 未通过');
    process.exit(1);
  }
  if (!runProjectChecks(config)) {
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
  createPnpmRunInvocation,
  resolveProjectChecks,
  runMigrationRegistryCheck,
  runProjectChecks,
  syncWithBase,
};
