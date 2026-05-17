#!/usr/bin/env node
/**
 * Conservative lifecycle entrypoint for external agents.
 *
 * This runner does not implement expert work by itself. It normalizes the task
 * mode and prepares or resumes a worktree when a tracked-file change is needed.
 */

const fs = require('fs');
const path = require('path');
const {
  createOrResumeWorktree,
  getMainRepoRoot,
  getWorktreeRoot,
  parseCliArgs,
  resolveContainerPath,
} = require('../worktree-tools/worktree-core');
const { loadConfig } = require('../shared/config');

function ensureAgentRunDir(config, mainRoot) {
  const tmpDir = resolveContainerPath(config, mainRoot, 'tmp');
  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = path.join(tmpDir, 'agent-runs', runId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function main() {
  try {
    const cli = parseCliArgs(process.argv.slice(2));
    const mode = cli.mode || (cli.diagnose ? 'diagnose' : 'change');
    const mainRoot = getMainRepoRoot(process.cwd());
    const configRoot = getWorktreeRoot(process.cwd());
    const config = loadConfig({ repoRoot: configRoot, cli });

    if (mode === 'diagnose') {
      const runDir = ensureAgentRunDir(config, mainRoot);
      const result = {
        status: 'DIAGNOSE_READY',
        mode,
        run_dir: runDir,
        cwd_policy: 'stay in current repo/worktree; do not modify tracked files',
      };
      fs.writeFileSync(path.join(runDir, 'result.json'), JSON.stringify(result, null, 2) + '\n');
      console.log('STATUS=DIAGNOSE_READY');
      console.log(`RUN_DIR=${runDir}`);
      console.log('WORKTREE_REQUIRED=false');
      console.log('NEXT_CWD=' + process.cwd());
      return;
    }

    const result = createOrResumeWorktree({ cli, cwd: mainRoot });
    console.log(result.dryRun ? 'STATUS=DRY_RUN' : result.resumed ? 'STATUS=RESUMED' : 'STATUS=READY');
    console.log(`MODE=${mode}`);
    console.log(`BRANCH_NAME=${result.branch}`);
    console.log(`WORKTREE_PATH=${result.worktreePath}`);
    console.log(`NEXT_CWD=${result.worktreePath}`);
    console.log(`EXECUTOR=${cli.executor || config.automation.defaultExecutor || 'codex'}`);
    if (result.bootstrap) {
      console.log(`BOOTSTRAP_STATUS=${result.bootstrap.status}`);
      if (result.bootstrap.mode) console.log(`BOOTSTRAP_MODE=${result.bootstrap.mode}`);
      if (result.bootstrap.reason) console.log(`BOOTSTRAP_REASON=${result.bootstrap.reason}`);
      if (result.bootstrap.nextManualAction) console.log(`NEXT_MANUAL_ACTION=${result.bootstrap.nextManualAction}`);
    }
  } catch (error) {
    console.error('STATUS=BLOCKED');
    if (error.worktreePath) console.error(`WORKTREE_PATH=${error.worktreePath}`);
    if (error.bootstrapStatus) console.error(`BOOTSTRAP_STATUS=${error.bootstrapStatus}`);
    if (error.command) console.error(`BOOTSTRAP_COMMAND=${error.command}`);
    if (error.checkCommand) console.error(`BOOTSTRAP_CHECK_COMMAND=${error.checkCommand}`);
    if (error.dirtyFiles) console.error(`DIRTY_FILES=${error.dirtyFiles}`);
    if (error.nextManualAction) console.error(`NEXT_MANUAL_ACTION=${error.nextManualAction}`);
    console.error(`REASON=${error.message}`);
    process.exit(1);
  }
}

main();
