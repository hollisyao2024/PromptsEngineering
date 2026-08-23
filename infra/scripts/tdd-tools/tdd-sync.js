#!/usr/bin/env node
const path = require('path');
const { spawnSync } = require('child_process');
const { loadConfig, resolveRepoRoot } = require('../shared/config');
const { createWindowsCmdInvocation, resolvePnpmBin } = require('../shared/toolchain-env');

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

function main() {
  const argv = process.argv.slice(2);
  if (isHelp(argv)) {
    printHelp();
    return;
  }

  const scope = parseScope(argv);

  const config = loadConfig({ repoRoot });
  if (!runProjectChecks(config)) {
    console.error('❌ /tdd sync 失败：项目硬门禁未通过');
    process.exit(1);
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
    }
  }

  process.exit(result.status || 0);
}

if (require.main === module) main();

module.exports = {
  createPnpmRunInvocation,
  resolveProjectChecks,
  runProjectChecks,
};
