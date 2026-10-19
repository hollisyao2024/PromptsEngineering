#!/usr/bin/env node
'use strict';
// Read-only discovery. Never load project JavaScript, environment files or hooks.
const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');

function inspectProject(projectPath, {gitCommand = 'git'} = {}) {
  if (!projectPath || !fs.existsSync(projectPath) || !fs.statSync(projectPath).isDirectory()) {
    throw new Error('project must name an existing directory');
  }
  const requestedPath = fs.realpathSync(projectPath);
  const git = (...args) => spawnSync(gitCommand, args, {
    cwd: requestedPath, encoding: 'utf8', timeout: 5000, maxBuffer: 1024 * 1024,
    env: {...process.env, GIT_OPTIONAL_LOCKS: '0'},
  });
  const gitAvailable = git('--version').status === 0;
  const top = gitAvailable ? git('rev-parse', '--show-toplevel') : null;
  const isGit = top?.status === 0;
  const projectRoot = isGit ? fs.realpathSync(top.stdout.trim()) : requestedPath;
  const exists = relative => fs.existsSync(path.join(projectRoot, relative));
  let worktreeKind = 'none';
  if (isGit) {
    const own = git('rev-parse', '--absolute-git-dir');
    const common = git('rev-parse', '--git-common-dir');
    if (own.status === 0 && common.status === 0) {
      worktreeKind = path.resolve(requestedPath, own.stdout.trim()) === path.resolve(requestedPath, common.stdout.trim()) ? 'main' : 'linked';
    }
  }
  const report = {status:'UNMANAGED', requestedPath, projectRoot, worktreeKind, gitAvailable, node:process.version, problems:[]};
  const markers = ['agent.config.json','xirang.lock.json','infra/scripts/agent-runner/agent-cli.js'];
  if (!markers.some(exists)) return report;
  const json = (relative, required = true) => {
    if (!exists(relative)) {
      if (required) report.problems.push('missing '+relative);
      return null;
    }
    try {
      const value = JSON.parse(fs.readFileSync(path.join(projectRoot,relative),'utf8'));
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('not an object');
      return value;
    } catch {
      report.problems.push('invalid or unreadable '+relative);
      return null;
    }
  };
  const config = json('agent.config.json');
  const origin = isGit ? git('remote','get-url','origin') : null;
  const official = origin?.status === 0 && /^(?:https:\/\/github\.com\/|git@github\.com:)hollisyao2024\/PromptsEngineering(?:\.git)?\/?$/iu.test(origin.stdout.trim());
  const source = config?.template?.role === 'source' && official;
  if (config?.template?.role === 'source' && !official) report.problems.push('source role requires the verified official origin');
  for (const relative of ['AGENTS.md','docs/CONVENTIONS.md',...(source ? [] : ['RULES.md'])]) {
    try {
      if (!fs.readFileSync(path.join(projectRoot,relative),'utf8').trim()) throw new Error('empty');
    } catch { report.problems.push('missing, empty or unreadable '+relative); }
  }
  const packageJson = json('package.json');
  if (typeof packageJson?.scripts?.agent !== 'string' || packageJson.scripts.agent.trim() !== 'node infra/scripts/agent-runner/agent-cli.js') {
    report.problems.push('unsupported package.json scripts.agent; inspect the project entry before execution');
  }
  try {
    if (!fs.statSync(path.join(projectRoot,'infra/scripts/agent-runner/agent-cli.js')).isFile()) throw new Error('not a file');
  } catch { report.problems.push('missing or invalid agent CLI'); }
  if (!source) {
    json('xirang.lock.json');
    try {
      if (!fs.statSync(path.join(projectRoot,'.xirang/baselines')).isDirectory()) throw new Error('not a directory');
    } catch { report.problems.push('missing .xirang/baselines'); }
  }
  report.status = report.problems.length ? 'INCOMPLETE' : source ? 'SOURCE' : !isGit ? 'NEEDS_GIT' : 'READY';
  return report;
}

if (require.main === module) {
  try {
    const args = process.argv.slice(2);
    if (args.length !== 2 || args[0] !== '--project') throw new Error('Usage: node inspect-project.cjs --project <existing-directory>');
    const report = inspectProject(args[1]);
    console.log(JSON.stringify(report, null, 2));
    if (report.status === 'INCOMPLETE' || report.status === 'NEEDS_GIT') process.exitCode = 2;
  } catch (error) {
    console.error(JSON.stringify({status:'ERROR',reason:error.message}));
    process.exitCode = 1;
  }
}
module.exports = {inspectProject};
