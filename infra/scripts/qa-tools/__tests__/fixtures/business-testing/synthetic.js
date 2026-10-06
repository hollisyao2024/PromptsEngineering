'use strict';

// 规模夹具：按确定性公式生成的大型合成项目（默认 500 条原子 AC、2000 个用例）。
// 不含随机数与时间，同样的参数永远得到同一份规格、路径模型与报告，用来度量“校验 + 绑定 + 判定”的耗时。

const { acRowCells, junitReport, pathsDocument, prdDocument } = require('./builders');

const MODULE = 'PERF';
const DOMAIN = 'perf';
const STORY_SIZE = 10;
const VARIANTS = 2;

const pad = (value, width) => String(value).padStart(width, '0');

// 第 n 条 AC（从 1 起）：每 10 条一个 Story；每 4 条中有 1 条 P1；每 5 条中有 1 条同时要求 web 与 ios。
function syntheticAcs(count = 500) {
  return Array.from({ length: count }, (_, index) => {
    const n = index + 1;
    const story = Math.ceil(n / STORY_SIZE);
    const seq = ((n - 1) % STORY_SIZE) + 1;
    return {
      n,
      id: `AC-${MODULE}-${pad(story, 3)}-${pad(seq, 2)}`,
      story: `US-${MODULE}-${pad(story, 3)}`,
      priority: n % 4 === 0 ? 'P1' : 'P0',
      verification: 'auto',
      platform: n % 5 === 0 ? 'web,ios' : 'web',
      tc: `TC-${MODULE}-${pad(n, 3)}`,
    };
  });
}

// 一条链：第 i 个转移从状态 i 到状态 i+1 并关联第 i 条 AC；每条路径只含一个转移并关联该 AC 的 TC。
function syntheticPaths(acs) {
  const state = (n) => `STA-${MODULE}-${pad(n, 3)}`;
  return {
    criterion: 'all-transitions',
    screens: [[`SCR-${MODULE}-001`, '规模界面', 'web,ios', '规模夹具']],
    states: Array.from({ length: acs.length + 1 }, (_, index) => [state(index + 1), `SCR-${MODULE}-001`, `状态 ${index + 1}`, '']),
    transitions: acs.map((ac, index) => [
      `TRN-${MODULE}-${pad(ac.n, 3)}`, state(index + 1), `操作 ${ac.n}`, '-', state(index + 2), ac.id,
    ]),
    paths: acs.map((ac) => [`PTH-${MODULE}-${pad(ac.n, 3)}`, `TRN-${MODULE}-${pad(ac.n, 3)}`, ac.tc, `路径 ${ac.n}`]),
  };
}

// 每条 AC 在每个端各有 variants 个用例：名称同时带 AC 与 TC 编号，端由套件的 platform 决定。
function syntheticCases(acs, platform, variants = VARIANTS) {
  const cases = [];
  for (const ac of acs) {
    for (let variant = 1; variant <= variants; variant += 1) {
      const label = platform === 'ios' ? `iOS 变体 ${variant}` : `变体 ${variant}`;
      cases.push({ name: `${ac.id} / ${ac.tc} ${label}`, status: 'passed' });
    }
  }
  return cases;
}

function syntheticProject({ acCount = 500, variants = VARIANTS } = {}) {
  const acs = syntheticAcs(acCount);
  const files = {
    [`docs/prd-modules/${DOMAIN}/PRD.md`]: prdDocument(
      acs.map(({ n, ...row }) => acRowCells({ ...row, given: `前置条件 ${n}`, when: `操作 ${n}`, then: `结果 ${n}` })),
      { intro: '# 规模模块 PRD\n\n### 原子 AC 清单\n' },
    ),
    [`docs/qa-modules/${DOMAIN}/PATHS.md`]: pathsDocument(syntheticPaths(acs)),
  };
  return {
    acs,
    files,
    webXml: junitReport(syntheticCases(acs, 'web', variants), { suite: 'web' }),
    iosXml: junitReport(syntheticCases(acs, 'ios', variants), { suite: 'ios' }),
    caseCount: acs.length * variants * 2,
  };
}

module.exports = { DOMAIN, MODULE, syntheticAcs, syntheticCases, syntheticPaths, syntheticProject };
