'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  INCLUDE_DIR_PATTERNS,
  getSessionFiles,
  normalizePathSeparators,
} = require('../generate-codemap');

test('normalizes Windows repository paths before matching scan patterns', () => {
  const windowsPath =
    'apps\\desktop\\src\\services\\builtin-browser\\policy.ts';
  const normalized = normalizePathSeparators(windowsPath);

  assert.equal(
    normalized,
    'apps/desktop/src/services/builtin-browser/policy.ts'
  );
  assert.equal(
    INCLUDE_DIR_PATTERNS.some((pattern) => pattern.test(normalized)),
    true
  );
});

test('keeps POSIX repository paths unchanged', () => {
  const posixPath = 'packages/database/src/index.ts';

  assert.equal(normalizePathSeparators(posixPath), posixPath);
});

// --scope=session used to overwrite docs/data/CODEBASE_MAP.md with only the branch's changed files, so every
// tdd sync replaced the full map with a fragment. The map is always built from the full file set; the session
// scope only adds the changed high-value files as a report.
test('session scope keeps the full file set and reports the changed files separately', () => {
  const { selectFilesForScope } = require('../generate-codemap');
  const allFiles = ['/r/apps/a.ts', '/r/packages/b.ts', '/r/infra/c.js'];
  const session = selectFilesForScope({ scope: 'session', allFiles, sessionFiles: new Set(['/r/packages/b.ts', '/r/docs/x.md']) });
  assert.deepEqual(session, { files: allFiles, changed: ['/r/packages/b.ts'] });
  assert.deepEqual(selectFilesForScope({ scope: 'session', allFiles, sessionFiles: null }), { files: allFiles, changed: [] });
  assert.deepEqual(selectFilesForScope({ scope: 'project', allFiles, sessionFiles: new Set(allFiles) }), { files: allFiles, changed: [] });
});

test('main writes the map from the full file set in session scope', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(path.join(__dirname, '..', 'generate-codemap.js'), 'utf8');
  const mainBody = source.slice(source.indexOf('function main()'));
  assert.match(mainBody, /selectFilesForScope\(/);
  assert.doesNotMatch(mainBody, /allFiles\.filter\(/);
  assert.match(mainBody, /SESSION_CHANGED_FILES=/);
});

// 根目录 src/ 布局的项目此前恒为 0 条：扫描范围写死 apps/packages 且无法配置。以下用例的期望取自修复任务
// codemap-empty-index 的验收口径：范围可配、默认行为不变、无 export 的入口文件入图、扫描为空有告警。
function withRepo(files, run) {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codemap-'));
  try {
    for (const [relPath, content] of Object.entries(files)) {
      const target = path.join(root, relPath);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content);
    }
    return run(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function buildMap(root, options) {
  const path = require('node:path');
  const { collectFiles, generateMap } = require('../generate-codemap');
  const files = options.scanDirs.flatMap((dir) => collectFiles(path.join(root, dir), options, root));
  return generateMap(files, options, root);
}

test('template defaults still map apps/ and packages/ into the original sections', () => {
  const { DEFAULT_CONFIG } = require('../../shared/config');
  const { resolveCodemapOptions } = require('../generate-codemap');
  const options = resolveCodemapOptions(DEFAULT_CONFIG);
  withRepo(
    {
      'apps/web/src/app/page.tsx': 'export default function Page() {}\n',
      'apps/web/src/app/api/users/route.ts': 'export const GET = () => {};\n',
      'apps/web/src/lib/auth/session.ts': 'export const session = 1;\n',
      'packages/db/src/index.ts': 'export const db = 1;\n',
    },
    (root) => {
      const { output, indexedFileCount } = buildMap(root, options);
      assert.equal(indexedFileCount, 4);
      for (const title of ['## Web Pages', '## Web API Routes', '## Web Core Libs', '## Database Package']) {
        assert.ok(output.includes(title), title);
      }
      assert.match(output, /Scanned: apps, packages/);
    }
  );
});

test('configured scan range indexes a root src/ layout that the defaults leave empty', () => {
  const { DEFAULT_CONFIG } = require('../../shared/config');
  const { resolveCodemapOptions } = require('../generate-codemap');
  const options = resolveCodemapOptions({
    codemap: {
      scanDirs: ['src'],
      includePatterns: ['^src/'],
      groups: [
        { id: 'main', title: 'Main Process', pattern: '^src/main/', summary: 'main', detailLimit: 2, bucketPattern: '^src/main/([^/.-]+)' },
      ],
    },
  });
  const files = {
    'src/main/account-a.ts': 'export const a = 1;\n',
    'src/main/account-b.ts': 'export const b = 1;\n',
    'src/main/zeta-c.ts': 'export const c = 1;\n',
  };
  withRepo(files, (root) => {
    assert.equal(buildMap(root, resolveCodemapOptions(DEFAULT_CONFIG)).indexedFileCount, 0);
    const { output, indexedFileCount, keyEntryCount } = buildMap(root, options);
    assert.equal(indexedFileCount, 3);
    assert.equal(keyEntryCount, 2);
    assert.match(output, /Scanned: src/);
    // bucketPattern 让 detailLimit 覆盖不同业务域，而不是字母序靠前的同域文件
    assert.ok(output.includes('src/main/zeta-c.ts'));
  });
});

test('entry files without exports are indexed and ranked as key entries', () => {
  const { resolveCodemapOptions } = require('../generate-codemap');
  const options = resolveCodemapOptions({
    codemap: {
      scanDirs: ['src'],
      includePatterns: ['^src/'],
      groups: [{ id: 'main', title: 'Main', pattern: '^src/main/', summary: 'main', detailLimit: 1 }],
    },
  });
  withRepo(
    {
      'src/main/aaa.ts': 'export const a = 1;\n',
      'src/main/main.ts': "import './aaa';\nstart();\n",
      'src/main/no-export.ts': "import './aaa';\n",
    },
    (root) => {
      const { output, indexedFileCount } = buildMap(root, options);
      assert.equal(indexedFileCount, 2);
      assert.ok(output.includes('- src/main/main.ts:'));
      assert.ok(!output.includes('no-export.ts'));
    }
  );
});

test('test-file filter keeps source files that merely contain the letters "test"', () => {
  const { SKIP_PATTERNS } = require('../generate-codemap');
  const skipped = (relPath) => SKIP_PATTERNS.some((pattern) => pattern.test(relPath));
  for (const relPath of ['src/main/proxy-connection-tester.ts', 'src/main/migrations/071_shop_wechat_latest_orders.ts', 'src/attest.ts']) {
    assert.equal(skipped(relPath), false, relPath);
  }
  for (const relPath of ['src/foo.test.ts', 'src/test-utils.ts', 'src/foo-test.js', 'src/testUtils.ts', 'src/test.ts', 'src/tests', 'src/__tests__']) {
    assert.equal(skipped(relPath), true, relPath);
  }
});

test('an empty map names the missing directories and the config to set', () => {
  const { emptyMapWarning } = require('../generate-codemap');
  withRepo({ 'src/a.ts': 'export const a = 1;\n' }, (root) => {
    const warning = emptyMapWarning({ indexedFileCount: 0, scanDirs: ['apps', 'src'], root });
    assert.match(warning, /^CODEMAP_EMPTY=/);
    assert.match(warning, /apps/);
    assert.match(warning, /codemap\.scanDirs/);
    assert.equal(emptyMapWarning({ indexedFileCount: 1, scanDirs: ['src'], root }), null);
  });
});

test('invalid codemap config fails before anything is written', () => {
  const { resolveCodemapOptions } = require('../generate-codemap');
  const group = { id: 'g', title: 'G', pattern: '^src/', summary: 's', detailLimit: 1 };
  const valid = { scanDirs: ['src'], includePatterns: ['^src/'], groups: [group] };
  assert.throws(() => resolveCodemapOptions({ codemap: { ...valid, scanDirs: [] } }), /codemap\.scanDirs/);
  assert.throws(() => resolveCodemapOptions({ codemap: { ...valid, includePatterns: ['('] } }), /codemap\.includePatterns/);
  assert.throws(() => resolveCodemapOptions({ codemap: { ...valid, groups: [{ ...group, pattern: '(' }] } }), /codemap\.groups\[0\]\.pattern/);
  assert.throws(() => resolveCodemapOptions({ codemap: { ...valid, groups: [{ ...group, detailLimit: 0 }] } }), /codemap\.groups\[0\]\.detailLimit/);
  assert.throws(() => resolveCodemapOptions({ codemap: { ...valid, groups: [{ ...group, bucketPattern: '^src/' }] } }), /codemap\.groups\[0\]\.bucketPattern/);
});

test('session scan diffs against the fetched remote base when it exists', (t) => {
  t.mock.method(console, 'warn', () => {});
  const calls = [];
  const exec = (command) => {
    calls.push(command);
    if (command.startsWith('git rev-parse')) return 'a'.repeat(40) + '\n';
    return 'src/app.js\nREADME.md\n';
  };
  const files = getSessionFiles(exec, { baseBranch: 'develop' });
  assert.deepEqual(calls, [
    'git rev-parse --verify --quiet refs/remotes/origin/develop',
    'git diff origin/develop...HEAD --name-only',
  ]);
  assert.equal(files.size, 1);
  assert.ok([...files][0].endsWith('src/app.js'));
});

test('session scan falls back to the local base when no remote base ref exists', (t) => {
  t.mock.method(console, 'warn', () => {});
  const calls = [];
  const exec = (command) => {
    calls.push(command);
    if (command.startsWith('git rev-parse')) throw new Error('missing ref');
    return 'src/app.js\n';
  };
  getSessionFiles(exec, { baseBranch: 'develop' });
  assert.equal(calls[1], 'git diff develop...HEAD --name-only');
});

test('session scan rejects unsafe base branch names instead of building a shell command', (t) => {
  t.mock.method(console, 'warn', () => {});
  const calls = [];
  const exec = (command) => { calls.push(command); return 'src/app.js\n'; };
  assert.equal(getSessionFiles(exec, { baseBranch: 'main; rm -rf /' }), null);
  assert.deepEqual(calls, [], 'must not run git with an unsafe base branch');
});

// 每次运行都写入新的 "Last updated" 时间戳并无条件覆盖，导致每次 tdd sync 都弄脏 CODEBASE_MAP.md，
// tdd push 自动提交后 HEAD 改变、TEST_SCOPE_RESULT 与 qa run 证据失效。以下期望取自修复任务
// codemap-stable-timestamp 的验收 AC1–AC3：时间戳不算内容变化；内容变化或缺失照常写；读失败不静默覆盖。
const HEADER = '# Codebase Map\n> Auto-generated by `pnpm run codemap`. Do not edit manually.\n';
function mapWith(timestamp, { indexed = 3, body = '\n## Packages\n- `packages/a.ts` — a\n' } = {}) {
  return `${HEADER}> Last updated: ${timestamp} | Indexed files: ${indexed} | Key entries: 1 | Scanned: packages\n`
    + `> Format: high-level navigation with key entry files only.\n${body}`;
}

test('AC1 codemap-stable-timestamp: a map that differs only in its timestamp is left untouched', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const { writeCodemapIfChanged } = require('../generate-codemap');
  withRepo({ 'docs/data/CODEBASE_MAP.md': mapWith('2020-01-01T00:00:00') }, (root) => {
    const output = path.join(root, 'docs/data/CODEBASE_MAP.md');
    const before = fs.statSync(output).mtimeMs;
    assert.equal(writeCodemapIfChanged(output, mapWith('2026-11-15T08:30:00')), 'UNCHANGED');
    assert.equal(fs.readFileSync(output, 'utf8'), mapWith('2020-01-01T00:00:00'), 'old timestamp must be kept');
    assert.equal(fs.statSync(output).mtimeMs, before, 'file must not be rewritten');
  });
});

test('AC1 codemap-stable-timestamp: CRLF checkouts of an unchanged map are left untouched', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const { writeCodemapIfChanged } = require('../generate-codemap');
  const crlf = mapWith('2020-01-01T00:00:00').replace(/\n/g, '\r\n');
  withRepo({ 'docs/data/CODEBASE_MAP.md': crlf }, (root) => {
    const output = path.join(root, 'docs/data/CODEBASE_MAP.md');
    assert.equal(writeCodemapIfChanged(output, mapWith('2026-11-15T08:30:00')), 'UNCHANGED');
    assert.equal(fs.readFileSync(output, 'utf8'), crlf);
  });
});

test('AC1 codemap-stable-timestamp: a regenerated map with the same files counts as unchanged', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const { DEFAULT_CONFIG } = require('../../shared/config');
  const { resolveCodemapOptions, writeCodemapIfChanged } = require('../generate-codemap');
  const options = resolveCodemapOptions(DEFAULT_CONFIG);
  withRepo({ 'packages/db/src/index.ts': 'export const db = 1;\n' }, (root) => {
    const output = path.join(root, 'docs/data/CODEBASE_MAP.md');
    const first = buildMap(root, options).output;
    fs.mkdirSync(path.dirname(output), { recursive: true });
    // 模拟上一次运行留下的旧时间戳
    fs.writeFileSync(output, first.replace(/Last updated: [^ |]+/, 'Last updated: 2000-01-01T00:00:00'));
    const second = buildMap(root, options).output;
    assert.equal(writeCodemapIfChanged(output, second), 'UNCHANGED');
    assert.match(fs.readFileSync(output, 'utf8'), /Last updated: 2000-01-01T00:00:00/);
  });
});

test('AC2 codemap-stable-timestamp: content changes rewrite the map with the new timestamp', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const { writeCodemapIfChanged } = require('../generate-codemap');
  withRepo({ 'docs/data/CODEBASE_MAP.md': mapWith('2020-01-01T00:00:00') }, (root) => {
    const output = path.join(root, 'docs/data/CODEBASE_MAP.md');
    const bodyChanged = mapWith('2026-11-15T08:30:00', { body: '\n## Packages\n- `packages/b.ts` — b\n' });
    assert.equal(writeCodemapIfChanged(output, bodyChanged), 'UPDATED');
    assert.equal(fs.readFileSync(output, 'utf8'), bodyChanged);
    // 时间戳所在行的计数变化同样是内容变化，不能因整行忽略而漏写
    const countChanged = mapWith('2026-11-16T00:00:00', { indexed: 4, body: '\n## Packages\n- `packages/b.ts` — b\n' });
    assert.equal(writeCodemapIfChanged(output, countChanged), 'UPDATED');
    assert.equal(fs.readFileSync(output, 'utf8'), countChanged);
  });
});

test('AC2 codemap-stable-timestamp: a missing map is created together with its directory', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const { writeCodemapIfChanged } = require('../generate-codemap');
  withRepo({}, (root) => {
    const output = path.join(root, 'docs/data/CODEBASE_MAP.md');
    assert.equal(writeCodemapIfChanged(output, mapWith('2026-11-15T08:30:00')), 'CREATED');
    assert.equal(fs.readFileSync(output, 'utf8'), mapWith('2026-11-15T08:30:00'));
  });
});

test('AC3 codemap-stable-timestamp: an unreadable existing map fails loudly instead of being overwritten', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const { writeCodemapIfChanged } = require('../generate-codemap');
  withRepo({ 'docs/data/CODEBASE_MAP.md/keep.txt': 'x' }, (root) => {
    const output = path.join(root, 'docs/data/CODEBASE_MAP.md');
    assert.throws(() => writeCodemapIfChanged(output, mapWith('2026-11-15T08:30:00')), /CODEBASE_MAP\.md/);
    assert.equal(fs.statSync(output).isDirectory(), true, 'existing path must be left as is');
  });
});
