/**
 * Project-local configuration initialized by the template update wrapper:
 * runtime environment files created from their examples in the main checkout,
 * and the ignored Codex config with its auto-compaction defaults.
 */

const fs = require('fs');
const path = require('path');
const { getMainRepoRoot } = require('../shared/config');
const { isGitWorktree, run } = require('./update-template-git');

const ENVIRONMENT_FILE_PAIRS = Object.freeze([
  Object.freeze({ example: '.env.example', runtime: '.env.local' }),
  Object.freeze({ example: '.env.staging.example', runtime: '.env.staging' }),
  Object.freeze({ example: '.env.production.example', runtime: '.env.production' }),
]);

function initializeEnvironmentFiles(targetRoot, write) {
  if (write) {
    for (const { example, runtime } of ENVIRONMENT_FILE_PAIRS) {
      if (fs.existsSync(path.join(targetRoot, runtime))) continue;
      if (!fs.existsSync(path.join(targetRoot, example))) {
        throw new Error(`environment example missing: ${example}`);
      }
    }
  }

  return ENVIRONMENT_FILE_PAIRS.map(({ example, runtime }) => {
    const runtimePath = path.join(targetRoot, runtime);
    if (fs.existsSync(runtimePath)) {
      return { status: 'unchanged', path: runtime, reason: 'target exists' };
    }
    if (!write) {
      return { status: 'created', path: runtime, reason: 'initialized from corresponding example' };
    }

    const content = fs.readFileSync(path.join(targetRoot, example));
    try {
      fs.writeFileSync(runtimePath, content, { flag: 'wx', mode: 0o600 });
      return { status: 'created', path: runtime, reason: 'initialized from corresponding example' };
    } catch (error) {
      if (error && error.code === 'EEXIST') {
        return { status: 'unchanged', path: runtime, reason: 'target exists' };
      }
      throw error;
    }
  });
}

function reportEnvironmentFiles(results) {
  for (const result of results) {
    const key = result.path.replace(/^\./u, '').replace(/[^a-zA-Z0-9]+/gu, '_').toUpperCase();
    console.log(`ENV_FILE_${key}=${result.status}`);
    if (result.reason) console.log(`ENV_FILE_${key}_REASON=${result.reason}`);
  }
}

// Environment files belong to the project's main checkout. Template-owned
// tracked files still go through the normal development-worktree apply plan.
function initializeProjectEnvironmentFiles(sourceRoot, targetRoot, write) {
  const gitTarget = isGitWorktree(targetRoot);
  if (!gitTarget && lstatIfPresent(path.join(targetRoot, '.git'))) {
    throw new Error('Cannot resolve environment project Git root');
  }
  const root = gitTarget ? getMainRepoRoot(targetRoot) : path.resolve(targetRoot);
  if (gitTarget) {
    const verified = run('git', ['rev-parse', '--show-toplevel'], { cwd: root });
    if (verified.status !== 0 || path.resolve(verified.stdout.trim()) !== path.resolve(root)) {
      throw new Error('Cannot verify environment main repo root');
    }
  }

  // Read all required inputs before creating any environment files. Existing
  // runtime files are never read, and existing examples always take priority.
  const examples = ENVIRONMENT_FILE_PAIRS.map(({ example, runtime }) => {
    const destination = path.join(root, example);
    const exists = Boolean(lstatIfPresent(destination));
    let content;
    if (!exists) {
      const source = path.join(sourceRoot, example);
      if (!fs.existsSync(source)) throw new Error(`environment example source missing: ${example}`);
      content = fs.readFileSync(source);
    } else if (!lstatIfPresent(path.join(root, runtime))) {
      fs.readFileSync(destination); // Preflight readability before any writes.
    }
    return { example, destination, exists, content };
  });

  if (write && gitTarget) {
    // Protect local runtime files even before the tracked gitignore update is
    // merged. These root-anchored rules do not ignore the example files.
    const resolved = run('git', ['rev-parse', '--path-format=absolute', '--git-path', 'info/exclude'], { cwd: root });
    if (resolved.status !== 0 || !resolved.stdout.trim()) throw new Error('Cannot resolve environment Git exclude');
    const exclude = resolved.stdout.trim();
    const stat = lstatIfPresent(exclude);
    if (stat && (!stat.isFile() || stat.isSymbolicLink())) throw new Error('Invalid environment Git exclude file');
    const content = stat ? fs.readFileSync(exclude, 'utf8') : '';
    const lines = new Set(content.split(/\r?\n/u));
    const missing = ENVIRONMENT_FILE_PAIRS.map(({ runtime }) => `/${runtime}`).filter(line => !lines.has(line));
    if (missing.length) {
      fs.mkdirSync(path.dirname(exclude), { recursive: true });
      fs.appendFileSync(exclude, `${content && !content.endsWith('\n') ? '\n' : ''}${missing.join('\n')}\n`);
    }
  }

  const files = examples.map(({ example, destination, exists, content }) => {
    if (exists) return { status: 'unchanged', path: example, reason: 'target exists' };
    if (write) {
      try { fs.writeFileSync(destination, content, { flag: 'wx', mode: 0o644 }); }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        return { status: 'unchanged', path: example, reason: 'target exists' };
      }
    }
    return { status: 'created', path: example, reason: 'initialized from template example' };
  });
  files.push(...initializeEnvironmentFiles(root, write));
  return { root, files };
}

function reportProjectEnvironmentFiles(result) {
  console.log(`ENVIRONMENT_ROOT=${result.root}`);
  reportEnvironmentFiles(result.files);
}

const AGENT_CONFIG_RELATIVE = 'agent.config.json';

// Template 3.12 renamed the DEVOPS phase to OPS. Rename the legacy `devops` config key in place
// (same key position) and drop the retired `features.devopsDeploy` flag. The environment variable
// AGENT_DEVOPS_DEPLOY_ENABLED is outside this file and is not handled here.
function migrateLegacyAgentConfig(targetRoot, write) {
  const configPath = path.join(targetRoot, AGENT_CONFIG_RELATIVE);
  if (!lstatIfPresent(configPath)) return { status: 'unchanged', changes: [] };
  const content = fs.readFileSync(configPath, 'utf8');
  let config;
  try { config = JSON.parse(content.replace(/^\uFEFF/u, '')); }
  catch (error) { throw new Error(`${AGENT_CONFIG_RELATIVE} is not valid JSON: ${error.message}`); }
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error(`${AGENT_CONFIG_RELATIVE} must contain a JSON object`);
  }
  const hasDevops = Object.prototype.hasOwnProperty.call(config, 'devops');
  if (hasDevops && Object.prototype.hasOwnProperty.call(config, 'ops')) {
    throw new Error(`${AGENT_CONFIG_RELATIVE} defines both legacy devops and ops; merge them manually`);
  }

  const changes = [];
  let next = config;
  if (hasDevops) {
    next = Object.fromEntries(Object.entries(next).map(([key, value]) => [key === 'devops' ? 'ops' : key, value]));
    changes.push('devops->ops');
  }
  const features = next.features;
  if (features && typeof features === 'object' && !Array.isArray(features)
    && Object.prototype.hasOwnProperty.call(features, 'devopsDeploy')) {
    const { devopsDeploy, ...rest } = features;
    changes.push('features.devopsDeploy removed');
    if (Object.keys(rest).length) next = { ...next, features: rest };
    else {
      next = Object.fromEntries(Object.entries(next).filter(([key]) => key !== 'features'));
      changes.push('features removed (empty)');
    }
  }
  if (!changes.length) return { status: 'unchanged', changes };
  if (write) fs.writeFileSync(configPath, `${JSON.stringify(next, null, 2)}\n`);
  return { status: 'migrated', changes };
}

function reportAgentConfigMigration(result) {
  console.log(`AGENT_CONFIG_MIGRATION=${result.status}`);
  if (result.changes.length) console.log(`AGENT_CONFIG_MIGRATION_CHANGES=${result.changes.join(',')}`);
}

const CODEX_CONFIG_RELATIVE = '.codex/config.toml';
const CODEX_COMPACTION_DEFAULTS = Object.freeze({
  model_auto_compact_token_limit: '180000',
  model_auto_compact_token_limit_scope: '"total"',
});

function lstatIfPresent(filePath) {
  try { return fs.lstatSync(filePath); }
  catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function readUtf8Exactly(filePath) {
  const bytes = fs.readFileSync(filePath);
  const content = bytes.toString('utf8');
  if (!Buffer.from(content, 'utf8').equals(bytes)) {
    throw new Error(`${CODEX_CONFIG_RELATIVE} is not valid UTF-8`);
  }
  return content;
}

function configuredCodexCompactionKeys(content) {
  const found = new Set();
  const keys = Object.keys(CODEX_COMPACTION_DEFAULTS);
  for (const line of content.replace(/^\uFEFF/u, '').split(/\r?\n/u)) {
    const text = line.trimStart();
    if (!text || text.startsWith('#')) continue;
    // A tiny, conservative top-level scanner is enough for these two keys.
    // Refuse ambiguous multiline strings rather than misreading their contents.
    if (text.includes('"""') || text.includes("'''")) {
      throw new Error(`Cannot safely inspect multiline TOML in ${CODEX_CONFIG_RELATIVE}`);
    }
    if (text.startsWith('[')) {
      if (!/^\[\[?[^\]]+\]\]?\s*(?:#.*)?$/u.test(text)) {
        throw new Error(`Cannot safely inspect table header in ${CODEX_CONFIG_RELATIVE}`);
      }
      break;
    }
    for (const key of keys) {
      if (new RegExp(`^(?:${key}|"${key}"|'${key}')\\s*=`, 'u').test(text)) found.add(key);
      else if (new RegExp(`^(?:${key}|"${key}"|'${key}')\\s*\\.`, 'u').test(text)) {
        throw new Error(`Cannot safely update dotted ${key} in ${CODEX_CONFIG_RELATIVE}`);
      }
    }
  }
  return found;
}

function writePrivateConfigAtomically(filePath, content, mode, previous) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = path.join(path.dirname(filePath), `.config.toml.xirang-${process.pid}-${Date.now()}`);
  try {
    const handle = fs.openSync(temporary, 'wx', mode);
    try {
      fs.writeFileSync(handle, content, 'utf8');
      fs.fsyncSync(handle);
    } finally {
      fs.closeSync(handle);
    }
    const current = lstatIfPresent(filePath);
    if (previous === null ? current !== null : !current || !current.isFile() || readUtf8Exactly(filePath) !== previous) {
      throw new Error(`${CODEX_CONFIG_RELATIVE} changed during template sync`);
    }
    fs.renameSync(temporary, filePath);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

function initializeCodexConfig(targetRoot, write) {
  const mainRoot = isGitWorktree(targetRoot) ? getMainRepoRoot(targetRoot) : targetRoot;
  const mainConfig = path.join(mainRoot, CODEX_CONFIG_RELATIVE);
  const linkedConfig = path.join(targetRoot, CODEX_CONFIG_RELATIVE);
  const mainStat = lstatIfPresent(mainConfig);
  const linkedStat = linkedConfig === mainConfig ? mainStat : lstatIfPresent(linkedConfig);
  if (mainStat && !mainStat.isFile()) {
    throw new Error(`${CODEX_CONFIG_RELATIVE} in the main project must be a regular file`);
  }
  if (linkedConfig !== mainConfig && linkedStat) {
    if (!linkedStat.isSymbolicLink()) {
      throw new Error(`${CODEX_CONFIG_RELATIVE} in the linked worktree conflicts with the main project config`);
    }
    if (!mainStat || fs.realpathSync(linkedConfig) !== fs.realpathSync(mainConfig)) {
      throw new Error(`${CODEX_CONFIG_RELATIVE} worktree symlink does not point to the main project config`);
    }
  }

  const oldContent = mainStat ? readUtf8Exactly(mainConfig) : '';
  const present = configuredCodexCompactionKeys(oldContent);
  const missing = Object.keys(CODEX_COMPACTION_DEFAULTS).filter(key => !present.has(key));
  const status = !mainStat ? 'created' : missing.length ? 'updated' : 'unchanged';
  const linkStatus = linkedConfig !== mainConfig && !linkedStat ? 'created' : 'unchanged';
  if (missing.length && isGitWorktree(mainRoot)) {
    const tracked = run('git', ['ls-files', '--error-unmatch', '--', CODEX_CONFIG_RELATIVE], { cwd: mainRoot });
    if (tracked.status === 0) throw new Error(`${CODEX_CONFIG_RELATIVE} is tracked; refusing to change a project-owned file`);
    const ignored = run('git', ['check-ignore', '--quiet', '--', CODEX_CONFIG_RELATIVE], { cwd: mainRoot });
    if (ignored.status !== 0) throw new Error(`${CODEX_CONFIG_RELATIVE} must be ignored by the main project before initialization`);
  }
  if (!write) return { status, linkStatus, missing };

  if (missing.length) {
    const newline = oldContent.includes('\r\n') ? '\r\n' : '\n';
    const bom = oldContent.startsWith('\uFEFF') ? '\uFEFF' : '';
    const body = bom ? oldContent.slice(1) : oldContent;
    const additions = missing.map(key => `${key} = ${CODEX_COMPACTION_DEFAULTS[key]}`).join(newline);
    const next = bom + additions + newline + (body ? newline + body : '');
    writePrivateConfigAtomically(mainConfig, next, mainStat ? mainStat.mode & 0o777 : 0o600,
      mainStat ? oldContent : null);
  }
  if (linkStatus === 'created') {
    fs.mkdirSync(path.dirname(linkedConfig), { recursive: true });
    fs.symlinkSync(mainConfig, linkedConfig);
  }
  return { status, linkStatus, missing };
}

function reportCodexConfig(result) {
  console.log(`CODEX_CONFIG_STATUS=${result.status}`);
  console.log(`CODEX_CONFIG_LINK_STATUS=${result.linkStatus}`);
  console.log(`CODEX_CONFIG_MISSING_KEYS=${result.missing.join(',') || '(none)'}`);
}

module.exports = {
  AGENT_CONFIG_RELATIVE,
  CODEX_CONFIG_RELATIVE,
  ENVIRONMENT_FILE_PAIRS,
  initializeCodexConfig,
  initializeEnvironmentFiles,
  initializeProjectEnvironmentFiles,
  migrateLegacyAgentConfig,
  reportAgentConfigMigration,
  reportCodexConfig,
  reportProjectEnvironmentFiles,
};
