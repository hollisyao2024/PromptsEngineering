#!/usr/bin/env node
'use strict';

const { spawnSync } = require('child_process');
const { getMainRepoRoot, resolveRepoRoot } = require('../shared/config');

const KNOWN_COMMANDS = new Map([
  ['node infra/scripts/tdd-tools/tdd-sync.js', 'infra/scripts/tdd-tools/tdd-sync.js'],
  ['node infra/scripts/tdd-tools/tdd-push.js', 'infra/scripts/tdd-tools/tdd-push.js'],
  ['node infra/scripts/qa-tools/generate-qa.js', 'infra/scripts/qa-tools/generate-qa.js'],
  ['node infra/scripts/qa-tools/qa-verify.js', 'infra/scripts/qa-tools/qa-verify.js'],
  ['node infra/scripts/qa-tools/qa-merge.js', 'infra/scripts/qa-tools/qa-merge.js'],
]);

function parseArgs(argv) {
  const options = {
    dryRun: false,
    scope: 'session',
    skipChecks: false,
    maxPasses: 2,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--project') {
      options.scope = 'project';
    } else if (arg === '--scope' && argv[i + 1]) {
      options.scope = argv[i + 1] === 'project' ? 'project' : 'session';
      i += 1;
    } else if (arg.startsWith('--scope=')) {
      options.scope = arg.slice('--scope='.length) === 'project' ? 'project' : 'session';
    } else if (arg === '--skip-checks') {
      options.skipChecks = true;
    } else if (arg === '--max-passes' && argv[i + 1]) {
      options.maxPasses = Number(argv[i + 1]) || options.maxPasses;
      i += 1;
    } else if (arg.startsWith('--max-passes=')) {
      options.maxPasses = Number(arg.slice('--max-passes='.length)) || options.maxPasses;
    } else if (arg === '--no-qa') {
      throw new Error('tdd:finish cannot run with --no-qa because its purpose is to complete QA merge.');
    }
  }

  options.maxPasses = Math.max(1, Math.min(5, options.maxPasses));
  return options;
}

function printHelp() {
  console.log(`Usage: node infra/scripts/tdd-tools/tdd-finish.js [options]

Complete the current TDD task by following tdd-completion-guard NEXT_COMMANDS.

Options:
  --project              Use project scope for sync/push/QA scripts.
  --scope <session|project>
  --skip-checks          Pass through to qa-merge only.
  --dry-run              Print the commands that would run.
  --max-passes <n>       Guard/command passes, default 2.
  -h, --help             Show this help.
`);
}

function parseGuardOutput(output) {
  const result = {
    status: '',
    reason: '',
    nextCommands: [],
  };

  for (const rawLine of String(output || '').split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (line.startsWith('STATUS=')) {
      result.status = line.slice('STATUS='.length).trim();
    } else if (line.startsWith('REASON=')) {
      result.reason = line.slice('REASON='.length).trim();
    } else if (line.trimStart().startsWith('node ')) {
      result.nextCommands.push(line.trim());
    }
  }

  return result;
}

function commandArgs(command, options) {
  const script = KNOWN_COMMANDS.get(command);
  if (!script) {
    throw new Error(`Unsupported completion command: ${command}`);
  }

  const args = [script];
  if (options.scope === 'project') {
    args.push('--project');
  }
  if (options.skipChecks && script.endsWith('qa-merge.js')) {
    args.push('--skip-checks');
  }
  return args;
}

function runNode(args, cwd, options = {}) {
  if (options.dryRun) {
    console.log(`[dry-run] ${process.execPath} ${args.join(' ')}`);
    return { status: 0, stdout: '', stderr: '' };
  }

  const result = spawnSync(process.execPath, args, {
    cwd,
    encoding: 'utf8',
    stdio: options.capture ? 'pipe' : 'inherit',
  });
  if (result.error) {
    throw result.error;
  }
  return result;
}

function runGuard(cwd, options = {}) {
  const result = runNode(['infra/scripts/tdd-tools/tdd-completion-guard.js'], cwd, {
    capture: true,
    dryRun: false,
  });
  const stdout = result.stdout || '';
  const stderr = result.stderr || '';
  if (!options.quiet || result.status !== 0) {
    if (stdout.trim()) process.stdout.write(stdout);
    if (stderr.trim()) process.stderr.write(stderr);
  }
  return {
    exitCode: result.status || 0,
    ...parseGuardOutput(`${stdout}\n${stderr}`),
  };
}

function shouldSwitchToMainAfter(command) {
  return command === 'node infra/scripts/qa-tools/qa-merge.js';
}

function finish({ repoRoot, mainRepoRoot, options }) {
  let cwd = repoRoot;

  for (let pass = 0; pass < options.maxPasses; pass += 1) {
    const guard = runGuard(cwd, { quiet: pass > 0 });
    if (guard.status === 'OK') {
      console.log('tdd:finish complete: completion guard returned STATUS=OK');
      return 0;
    }

    if (!guard.nextCommands.length) {
      console.error(`tdd:finish blocked: ${guard.reason || 'completion guard did not provide NEXT_COMMANDS'}`);
      return 1;
    }

    if (options.dryRun) {
      for (const command of guard.nextCommands) {
        const args = commandArgs(command, options);
        console.log(`[dry-run] (${cwd}) ${process.execPath} ${args.join(' ')}`);
      }
      return 0;
    }

    for (const command of guard.nextCommands) {
      const args = commandArgs(command, options);
      console.log(`tdd:finish running: ${command}`);
      const result = runNode(args, cwd);
      if ((result.status || 0) !== 0) {
        console.error(`tdd:finish failed while running: ${command}`);
        return result.status || 1;
      }
      if (shouldSwitchToMainAfter(command)) {
        cwd = mainRepoRoot;
      }
    }
  }

  const guard = runGuard(cwd);
  return guard.status === 'OK' ? 0 : 1;
}

function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      printHelp();
      return;
    }

    const repoRoot = resolveRepoRoot({ scriptDir: __dirname });
    const mainRepoRoot = getMainRepoRoot(repoRoot);
    process.exit(finish({ repoRoot, mainRepoRoot, options }));
  } catch (error) {
    console.error(`tdd:finish failed: ${error.message}`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  commandArgs,
  finish,
  parseArgs,
  parseGuardOutput,
  shouldSwitchToMainAfter,
};
