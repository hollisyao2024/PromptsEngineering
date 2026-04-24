#!/usr/bin/env node
/**
 * Shared agent template configuration loader.
 *
 * Priority: CLI args > environment variables > agent.config.json >
 * infra/templates/agent/config.example.json > built-in defaults.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const DEFAULT_CONFIG = {
  projectName: 'portable-agent-template',
  baseBranch: 'main',
  packageManager: 'pnpm',
  containerDirs: {
    worktrees: '../worktrees',
    tmp: '../tmp',
    cache: '../cache',
    artifacts: '../artifacts',
  },
  commands: {
    lint: 'pnpm run lint',
    typecheck: 'pnpm run type-check',
    test: 'pnpm test',
    build: 'pnpm run build',
    qaGenerate: 'pnpm run qa:generate',
    qaVerify: 'pnpm run qa:verify',
    qaMerge: 'pnpm run qa:merge',
  },
  paths: {
    primaryApp: '',
    appDirs: [],
    webAppDir: '',
    databaseDir: '',
    prismaSchema: '',
    migrationsDir: '',
    e2eDir: 'e2e',
    perfDir: 'perf',
    securityDir: 'security',
  },
  worktree: {
    defaultForChanges: true,
    copyStrategy: 'full-checkout',
    envSymlinks: ['.env.local'],
    sharedConfigSymlinks: [
      '.codex/config.toml',
      '.claude/settings.json',
      '.gemini/settings.json',
    ],
    sessionDir: '../tmp/worktree-sessions',
    lockDir: '../tmp/agent-locks',
  },
  automation: {
    defaultExecutor: 'codex',
    autoPush: true,
    autoPr: true,
    autoMerge: false,
  },
  template: {
    manifest: 'infra/templates/agent/template.manifest.json',
    applyReportDir: '../tmp/template-apply-reports',
  },
  release: {
    bumpVersion: false,
    versionFile: 'package.json',
    updateChangelog: false,
    changelogFile: 'CHANGELOG.md',
    createTag: false,
    tagPrefix: 'v',
  },
  devServer: {
    portStart: 3000,
    portEnd: 3099,
    appDir: '',
    command: '',
    commands: {
      start: '',
      restart: '',
      stop: '',
      status: '',
      logs: '',
    },
  },
  devops: {
    deployEnabled: false,
    framework: 'custom',
    appDir: '',
    databaseDir: '',
    buildCommand: '',
    startCommand: '',
    healthCheckPath: '/',
    commands: {
      ship: {
        dev: '',
        staging: '',
        production: '',
      },
      cd: {
        staging: '',
        production: '',
      },
      ciRun: '',
      ciStatus: '',
      envCheck: {
        dev: '',
        staging: '',
        production: '',
      },
      envStatus: '',
    },
    workflows: {
      ci: '',
      staging: '',
      production: '',
    },
    healthCheck: {
      dev: '',
      staging: '',
      production: '',
    },
    environments: {
      dev: {},
      staging: {},
      production: {},
    },
  },
  cron: {
    enabled: false,
    registry: [],
  },
  features: {
    devopsDeploy: false,
  },
};

function gitValue(cwd, args) {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: 'pipe',
  });
  return result.status === 0 ? result.stdout.trim() : '';
}

function getRepoRoot() {
  return path.resolve(__dirname, '..', '..', '..');
}

function getWorktreeRoot(cwd = process.cwd()) {
  return gitValue(cwd, ['rev-parse', '--show-toplevel']) || getRepoRoot();
}

function mainRootFromCommonDir(commonDir) {
  if (!commonDir) return '';
  const normalized = path.resolve(commonDir);
  if (path.basename(normalized) === '.git') return path.dirname(normalized);

  const marker = `${path.sep}.git${path.sep}worktrees${path.sep}`;
  const markerIndex = normalized.indexOf(marker);
  if (markerIndex !== -1) return normalized.slice(0, markerIndex);

  return '';
}

function getMainRepoRoot(cwd = process.cwd()) {
  const commonDir = gitValue(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  return mainRootFromCommonDir(commonDir) || getWorktreeRoot(cwd);
}

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) return {};
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`Invalid JSON in ${filePath}: ${error.message}`);
  }
}

function isPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function deepMerge(base, override) {
  const output = Array.isArray(base) ? [...base] : { ...base };
  for (const [key, value] of Object.entries(override || {})) {
    if (isPlainObject(value) && isPlainObject(output[key])) {
      output[key] = deepMerge(output[key], value);
    } else {
      output[key] = value;
    }
  }
  return output;
}

function parseCliArgs(argv = process.argv.slice(2)) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const raw = argv[i];
    if (raw === '--') continue;
    if (!raw.startsWith('--')) continue;

    const eq = raw.indexOf('=');
    if (eq !== -1) {
      args[raw.slice(2, eq)] = raw.slice(eq + 1);
      continue;
    }

    const key = raw.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      args[key] = next;
      i += 1;
    } else {
      args[key] = true;
    }
  }
  return args;
}

function envOverrides(env = process.env) {
  const output = {};
  if (env.AGENT_PROJECT_NAME) output.projectName = env.AGENT_PROJECT_NAME;
  if (env.AGENT_BASE_BRANCH) output.baseBranch = env.AGENT_BASE_BRANCH;
  if (env.AGENT_PACKAGE_MANAGER) output.packageManager = env.AGENT_PACKAGE_MANAGER;
  if (env.AGENT_WORKTREES_DIR) {
    output.containerDirs = { ...(output.containerDirs || {}), worktrees: env.AGENT_WORKTREES_DIR };
  }
  if (env.AGENT_TMP_DIR) {
    output.containerDirs = { ...(output.containerDirs || {}), tmp: env.AGENT_TMP_DIR };
  }
  if (env.AGENT_CACHE_DIR) {
    output.containerDirs = { ...(output.containerDirs || {}), cache: env.AGENT_CACHE_DIR };
  }
  if (env.AGENT_ARTIFACTS_DIR) {
    output.containerDirs = { ...(output.containerDirs || {}), artifacts: env.AGENT_ARTIFACTS_DIR };
  }
  if (env.AGENT_DEFAULT_EXECUTOR) {
    output.automation = { ...(output.automation || {}), defaultExecutor: env.AGENT_DEFAULT_EXECUTOR };
  }
  if (env.AGENT_PRIMARY_APP) output.paths = { ...(output.paths || {}), primaryApp: env.AGENT_PRIMARY_APP };
  if (env.AGENT_WEB_APP_DIR) output.paths = { ...(output.paths || {}), webAppDir: env.AGENT_WEB_APP_DIR };
  if (env.AGENT_DATABASE_DIR) output.paths = { ...(output.paths || {}), databaseDir: env.AGENT_DATABASE_DIR };
  if (env.AGENT_PRISMA_SCHEMA) output.paths = { ...(output.paths || {}), prismaSchema: env.AGENT_PRISMA_SCHEMA };
  if (env.AGENT_MIGRATIONS_DIR) output.paths = { ...(output.paths || {}), migrationsDir: env.AGENT_MIGRATIONS_DIR };
  if (env.AGENT_RELEASE_BUMP_VERSION) {
    output.release = {
      ...(output.release || {}),
      bumpVersion: env.AGENT_RELEASE_BUMP_VERSION === 'true',
    };
  }
  if (env.AGENT_RELEASE_UPDATE_CHANGELOG) {
    output.release = {
      ...(output.release || {}),
      updateChangelog: env.AGENT_RELEASE_UPDATE_CHANGELOG === 'true',
    };
  }
  if (env.AGENT_DEVOPS_DEPLOY_ENABLED) {
    output.devops = {
      ...(output.devops || {}),
      deployEnabled: env.AGENT_DEVOPS_DEPLOY_ENABLED === 'true',
    };
  }
  if (env.AGENT_DEV_SERVER_COMMAND) {
    output.devServer = {
      ...(output.devServer || {}),
      command: env.AGENT_DEV_SERVER_COMMAND,
    };
  }
  return output;
}

function cliOverrides(cli = {}) {
  const output = {};
  if (cli.project || cli.projectName) output.projectName = cli.project || cli.projectName;
  if (cli.base || cli.baseBranch) output.baseBranch = cli.base || cli.baseBranch;
  if (cli.executor) output.automation = { defaultExecutor: cli.executor };
  if (cli.worktreesDir) output.containerDirs = { worktrees: cli.worktreesDir };
  if (cli.appDir || cli.primaryApp) output.paths = { primaryApp: cli.appDir || cli.primaryApp };
  if (cli.webAppDir) output.paths = { ...(output.paths || {}), webAppDir: cli.webAppDir };
  if (cli.databaseDir) output.paths = { ...(output.paths || {}), databaseDir: cli.databaseDir };
  return output;
}

function loadConfig(options = {}) {
  const repoRoot = options.repoRoot || options.configRoot || getWorktreeRoot(process.cwd());
  const cli = options.cli || parseCliArgs(options.argv);
  const examplePath = path.join(repoRoot, 'infra/templates/agent/config.example.json');
  const localPath = path.join(repoRoot, 'agent.config.json');

  return deepMerge(
    deepMerge(
      deepMerge(
        deepMerge(DEFAULT_CONFIG, readJsonIfExists(examplePath)),
        readJsonIfExists(localPath)
      ),
      envOverrides(options.env || process.env)
    ),
    cliOverrides(cli)
  );
}

function resolveFromRepo(repoRoot, relativePath) {
  if (!relativePath) return repoRoot;
  if (path.isAbsolute(relativePath)) return relativePath;
  return path.resolve(repoRoot, relativePath);
}

function resolveContainerPath(config, mainRoot, key) {
  const configured = config.containerDirs && config.containerDirs[key];
  return resolveFromRepo(mainRoot, configured || `../${key}`);
}

module.exports = {
  DEFAULT_CONFIG,
  deepMerge,
  getMainRepoRoot,
  getRepoRoot,
  getWorktreeRoot,
  loadConfig,
  parseCliArgs,
  resolveContainerPath,
  resolveFromRepo,
};
