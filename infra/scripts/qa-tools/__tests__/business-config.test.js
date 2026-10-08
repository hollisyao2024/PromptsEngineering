'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { DEFAULT_CONFIG, loadConfig } = require('../../shared/config');
const { registeredSuiteCommands, resolveBusinessConfig } = require('../business-config');
const { createProject } = require('./fixtures/business-testing/builders');

const SUITE = {
  name: 'web-e2e',
  platform: 'web',
  command: 'pnpm exec playwright test',
  report: 'test-results/junit.xml',
  timeoutSeconds: 600,
};

const configWith = (business) => ({ qa: { business } });
const fields = (resolved) => resolved.errors.map((error) => error.field);

// ---------------------------------------------------------------- 默认值

test('模板默认配置关闭业务门禁且没有套件', () => {
  assert.deepEqual(DEFAULT_CONFIG.qa.business, {
    enabled: false,
    requiredPriorities: ['P0'],
    suites: [],
  });

  const resolved = resolveBusinessConfig(DEFAULT_CONFIG);
  assert.equal(resolved.ok, true);
  assert.equal(resolved.enabled, false);
  assert.deepEqual(resolved.requiredPriorities, ['P0']);
  assert.deepEqual(resolved.suites, []);
  assert.deepEqual(resolved.errors, []);
});

for (const [label, config] of [['空对象', {}], ['缺少 business', { qa: {} }], ['undefined', undefined]]) {
  test(`qa.business 缺省（${label}）等同默认值`, () => {
    const resolved = resolveBusinessConfig(config);

    assert.equal(resolved.ok, true);
    assert.equal(resolved.enabled, false);
    assert.deepEqual(resolved.requiredPriorities, ['P0']);
    assert.deepEqual(resolved.suites, []);
  });
}

test('agent.config.json 的 qa.business 覆盖默认值，数组整体替换', () => {
  const project = createProject({
    'agent.config.json': JSON.stringify({ qa: { business: { enabled: true, suites: [SUITE] } } }),
  });
  try {
    const config = loadConfig({ repoRoot: project.repo, env: {}, cli: {} });
    const resolved = resolveBusinessConfig(config);

    assert.equal(resolved.ok, true, JSON.stringify(resolved.errors));
    assert.equal(resolved.enabled, true);
    assert.deepEqual(resolved.requiredPriorities, ['P0']);
    assert.deepEqual(resolved.suites.map((suite) => suite.name), ['web-e2e']);
  } finally {
    project.cleanup();
  }
});

// ---------------------------------------------------------------- 规范化

test('合法配置被规范化，缺省 platform 为 -，缺省超时 900 秒', () => {
  const resolved = resolveBusinessConfig(configWith({
    enabled: true,
    requiredPriorities: ['P0', 'P1'],
    suites: [SUITE, { name: 'api', command: 'node api-suite.js', report: 'out/api.xml' }],
  }));

  assert.equal(resolved.ok, true, JSON.stringify(resolved.errors));
  assert.equal(resolved.enabled, true);
  assert.deepEqual(resolved.requiredPriorities, ['P0', 'P1']);
  assert.deepEqual(resolved.suites[0], SUITE);
  assert.deepEqual(resolved.suites[1], {
    name: 'api',
    platform: '-',
    command: 'node api-suite.js',
    report: 'out/api.xml',
    timeoutSeconds: 900,
  });
  assert.match(resolved.digest, /^sha256:[0-9a-f]{64}$/u);
});

test('requiredPriorities 去重并按优先级排序，等价写法摘要一致', () => {
  const a = resolveBusinessConfig(configWith({ requiredPriorities: ['P1', 'P0', 'P0'], suites: [SUITE] }));
  const b = resolveBusinessConfig(configWith({ requiredPriorities: ['P0', 'P1'], suites: [SUITE] }));

  assert.deepEqual(a.requiredPriorities, ['P0', 'P1']);
  assert.equal(a.digest, b.digest);
});

test('timeoutSeconds 边界值 1 与 7200 合法', () => {
  for (const timeoutSeconds of [1, 7200]) {
    const resolved = resolveBusinessConfig(configWith({ suites: [{ ...SUITE, timeoutSeconds }] }));
    assert.equal(resolved.ok, true, JSON.stringify(resolved.errors));
  }
});

// ---------------------------------------------------------------- 逐项违规

const INVALID_CASES = [
  ['enabled 不是布尔', { enabled: 'yes' }, 'qa.business.enabled'],
  ['requiredPriorities 为空', { requiredPriorities: [] }, 'qa.business.requiredPriorities'],
  ['requiredPriorities 含非法值', { requiredPriorities: ['P0', 'P9'] }, 'qa.business.requiredPriorities'],
  ['requiredPriorities 不是数组', { requiredPriorities: 'P0' }, 'qa.business.requiredPriorities'],
  ['suites 不是数组', { suites: 'web-e2e' }, 'qa.business.suites'],
  ['套件不是对象', { suites: ['web-e2e'] }, 'qa.business.suites[0]'],
  ['缺少 name', { suites: [{ ...SUITE, name: undefined }] }, 'qa.business.suites[0].name'],
  ['name 含大写', { suites: [{ ...SUITE, name: 'Web' }] }, 'qa.business.suites[0].name'],
  ['name 以数字开头', { suites: [{ ...SUITE, name: '1web' }] }, 'qa.business.suites[0].name'],
  ['name 重复', { suites: [SUITE, { ...SUITE }] }, 'qa.business.suites[1].name'],
  ['platform 含大写', { suites: [{ ...SUITE, platform: 'Web' }] }, 'qa.business.suites[0].platform'],
  ['platform 多个标签', { suites: [{ ...SUITE, platform: 'web,ios' }] }, 'qa.business.suites[0].platform'],
  ['command 为空', { suites: [{ ...SUITE, command: '  ' }] }, 'qa.business.suites[0].command'],
  ['command 不是字符串', { suites: [{ ...SUITE, command: 123 }] }, 'qa.business.suites[0].command'],
  ['缺少 report', { suites: [{ ...SUITE, report: undefined }] }, 'qa.business.suites[0].report'],
  ['report 为绝对路径', { suites: [{ ...SUITE, report: '/tmp/junit.xml' }] }, 'qa.business.suites[0].report'],
  ['report 为 Windows 绝对路径', { suites: [{ ...SUITE, report: 'C:\\out\\junit.xml' }] }, 'qa.business.suites[0].report'],
  ['report 越出仓库', { suites: [{ ...SUITE, report: '../junit.xml' }] }, 'qa.business.suites[0].report'],
  ['report 经 .. 越出仓库', { suites: [{ ...SUITE, report: 'a/../../junit.xml' }] }, 'qa.business.suites[0].report'],
  ['report 指向仓库根目录', { suites: [{ ...SUITE, report: '.' }] }, 'qa.business.suites[0].report'],
  ['report 以斜杠结尾（目录）', { suites: [{ ...SUITE, report: 'out/' }] }, 'qa.business.suites[0].report'],
  ['report 为空串', { suites: [{ ...SUITE, report: '' }] }, 'qa.business.suites[0].report'],
  ['report 以 .. 结尾（指向目录）', { suites: [{ ...SUITE, report: 'out/..' }] }, 'qa.business.suites[0].report'],
  ['report 位于 .git 目录内', { suites: [{ ...SUITE, report: '.git/config' }] }, 'qa.business.suites[0].report'],
  ['report 位于 .GIT 目录内（大小写不敏感文件系统）', { suites: [{ ...SUITE, report: './.GIT/hooks/report.xml' }] }, 'qa.business.suites[0].report'],
  ['qa.business 是字符串', 'oops', 'qa.business'],
  ['qa.business 是数组', [], 'qa.business'],
  ['qa.business 是 false', false, 'qa.business'],
  ['timeoutSeconds 为 0', { suites: [{ ...SUITE, timeoutSeconds: 0 }] }, 'qa.business.suites[0].timeoutSeconds'],
  ['timeoutSeconds 超上限', { suites: [{ ...SUITE, timeoutSeconds: 7201 }] }, 'qa.business.suites[0].timeoutSeconds'],
  ['timeoutSeconds 非整数', { suites: [{ ...SUITE, timeoutSeconds: 1.5 }] }, 'qa.business.suites[0].timeoutSeconds'],
  ['timeoutSeconds 是字符串', { suites: [{ ...SUITE, timeoutSeconds: '900' }] }, 'qa.business.suites[0].timeoutSeconds'],
  ['qa.business 出现未知键', { enable: true }, 'qa.business.enable'],
  ['套件出现未知键', { suites: [{ ...SUITE, timeout: 30 }] }, 'qa.business.suites[0].timeout'],
];

for (const [label, business, field] of INVALID_CASES) {
  test(`非法配置逐项报告 ← ${label}`, () => {
    const resolved = resolveBusinessConfig(configWith(business));

    assert.equal(resolved.ok, false);
    assert.equal(resolved.digest, null);
    assert.ok(fields(resolved).includes(field), `期望报告 ${field}，实际 ${fields(resolved).join(',')}`);
    for (const error of resolved.errors) assert.ok(error.message.length > 0);
  });
}

test('多处非法时全部列出，而不是只报告第一处', () => {
  const resolved = resolveBusinessConfig(configWith({
    enabled: 'yes',
    suites: [{ ...SUITE, name: 'Bad' }, { ...SUITE, name: 'ok', timeoutSeconds: 0 }],
  }));

  assert.equal(resolved.ok, false);
  assert.deepEqual(fields(resolved).sort(), [
    'qa.business.enabled',
    'qa.business.suites[0].name',
    'qa.business.suites[1].timeoutSeconds',
  ]);
});

test('门禁关闭时其余字段的问题不改变 enabled，仍然报告', () => {
  const resolved = resolveBusinessConfig(configWith({ enabled: false, suites: [{ ...SUITE, name: 'Bad' }] }));

  assert.equal(resolved.ok, false);
  assert.equal(resolved.enabled, false);
  assert.deepEqual(fields(resolved), ['qa.business.suites[0].name']);
});

// 加载配置时模板默认值已补上 enabled=false，开关键拼错（enable）后 enabled 不会缺省，所以未知键本身就要触发 fail-closed。
for (const [label, business] of [
  ['enabled 不是布尔', { enabled: 'false' }],
  ['qa.business 不是对象', 'off'],
  ['开关键拼错（合并默认值后 enabled=false 且多出 enable）', { enabled: false, enable: true }],
  ['其他字段拼错（requiredPriority）', { enabled: false, requiredPriority: ['P0', 'P1'] }],
]) {
  test(`无法判读开关时按开启处理（fail-closed）← ${label}`, () => {
    const resolved = resolveBusinessConfig(configWith(business));

    assert.equal(resolved.ok, false);
    assert.equal(resolved.enabled, true);
  });
}

test('显式关闭且键名都合法时，其余字段的问题仍不改变 enabled=false', () => {
  const resolved = resolveBusinessConfig(configWith({ enabled: false, requiredPriorities: 'P0', suites: 'x' }));

  assert.equal(resolved.ok, false);
  assert.equal(resolved.enabled, false);
  assert.deepEqual(fields(resolved).sort(), ['qa.business.requiredPriorities', 'qa.business.suites']);
});

test('report 路径规范化为 POSIX 相对路径，等价写法摘要一致', () => {
  const plain = resolveBusinessConfig(configWith({ suites: [{ ...SUITE, report: 'out/junit.xml' }] }));
  const dotted = resolveBusinessConfig(configWith({ suites: [{ ...SUITE, report: './out/../out//junit.xml' }] }));
  const windows = resolveBusinessConfig(configWith({ suites: [{ ...SUITE, report: 'out\\junit.xml' }] }));

  assert.equal(plain.ok && dotted.ok && windows.ok, true);
  assert.equal(dotted.suites[0].report, 'out/junit.xml');
  assert.equal(windows.suites[0].report, 'out/junit.xml');
  assert.equal(plain.digest, dotted.digest);
  assert.equal(plain.digest, windows.digest);
});

// ---------------------------------------------------------------- 配置摘要

test('仅切换 enabled 不改变配置摘要', () => {
  const off = resolveBusinessConfig(configWith({ enabled: false, suites: [SUITE] }));
  const on = resolveBusinessConfig(configWith({ enabled: true, suites: [SUITE] }));

  assert.equal(off.ok && on.ok, true);
  assert.equal(off.digest, on.digest);
});

test('摘要与键顺序、无关配置项无关，与命令、报告路径、优先级、套件顺序有关', () => {
  const base = resolveBusinessConfig(configWith({ suites: [SUITE] })).digest;
  const reordered = resolveBusinessConfig({
    other: { value: 1 },
    qa: { projectChecks: [], business: { suites: [{ timeoutSeconds: 600, report: SUITE.report, command: SUITE.command, platform: 'web', name: 'web-e2e' }] } },
  }).digest;
  assert.equal(base, reordered);

  const second = { ...SUITE, name: 'api', platform: '-', report: 'out/api.xml' };
  const variants = [
    configWith({ suites: [{ ...SUITE, command: `${SUITE.command} --retries=0` }] }),
    configWith({ suites: [{ ...SUITE, report: 'out/junit.xml' }] }),
    configWith({ suites: [{ ...SUITE, timeoutSeconds: 601 }] }),
    configWith({ suites: [{ ...SUITE, platform: 'ios' }] }),
    configWith({ requiredPriorities: ['P0', 'P1'], suites: [SUITE] }),
    configWith({ suites: [SUITE, second] }),
  ];
  const digests = variants.map((config) => resolveBusinessConfig(config).digest);
  assert.equal(new Set([base, ...digests]).size, digests.length + 1);

  const swapped = [
    resolveBusinessConfig(configWith({ suites: [SUITE, second] })).digest,
    resolveBusinessConfig(configWith({ suites: [second, SUITE] })).digest,
  ];
  assert.notEqual(swapped[0], swapped[1]);
});

// ---------------------------------------------------------------- 已登记的套件命令

test('registeredSuiteCommands 按套件顺序返回登记的命令，与 enabled 开关无关', () => {
  const guarded = {
    name: 'web-guarded',
    platform: 'web',
    command: 'node infra/scripts/test-tools/run-with-test-guards.js pnpm exec playwright test --project=web',
    report: 'test-results/guarded.xml',
  };
  for (const enabled of [false, true]) {
    assert.deepEqual(
      registeredSuiteCommands(configWith({ enabled, suites: [SUITE, guarded] })),
      [SUITE.command, guarded.command],
    );
  }
});

test('registeredSuiteCommands 在没有套件或配置无效时返回空数组而不抛错', () => {
  for (const config of [DEFAULT_CONFIG, {}, undefined, configWith({ enabled: true })]) {
    assert.deepEqual(registeredSuiteCommands(config), []);
  }
  // 任何一个套件无效，整份 qa.business 都不可信：其余套件的命令也不得被当作已登记
  for (const business of [
    { suites: [SUITE, { ...SUITE, report: 'out/dup.xml' }] },
    { suites: [SUITE, { ...SUITE, name: 'blank', command: '   ' }] },
    { suites: [SUITE, { ...SUITE, name: 'typo', cmd: 'pnpm exec vitest run' }] },
    { suites: 'pnpm exec vitest run' },
  ]) {
    assert.deepEqual(registeredSuiteCommands(configWith(business)), [], JSON.stringify(business));
  }
});
