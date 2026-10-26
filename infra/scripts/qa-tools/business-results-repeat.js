'use strict';

// 业务测试结果模型之多轮比较（G6）：qa run --repeat N 在同一 HEAD 上把全部套件运行 N 轮，
// 这里逐用例比较各轮状态，找出不稳定（flaky）的用例与套件。纯函数：不访问文件、网络、时钟与随机数，
// 同样的输入逐字节产生同样的输出，qa verify 才能用各轮报告副本重算并与记录比对。
// 不依赖 business-results.js（它反过来引用本文件），避免循环依赖。

const { CASE_STATUSES, extractCaseLabels } = require('./business-results-aggregate');
const { compareText } = require('./business-spec');

// 某轮里找不到该用例（套件没产出报告，或报告里少了这条）时记为 missing。
const MISSING = 'missing';
const RATE_SCALE = 10000;

const sortedUnique = (items) => [...new Set(items)].sort(compareText);

// 用例 → 绑定的 AC 与必需优先级。绑定规则与 aggregateResults 一致：
// 显式标注且在原子表中的 AC 优先；没有时才按 TC 列展开到列出该 TC 的全部 AC。
// required 表示至少绑定一条“自动化且优先级在 requiredPriorities 内”的 AC，与门禁的必需判定一致。
function caseBinder(spec, requiredPriorities) {
  if (!spec || !Array.isArray(spec.acs)) throw new Error('spec 须为 loadBusinessSpec 的结果');
  const required = new Set(requiredPriorities || []);
  const acById = new Map(spec.acs.map((ac) => [ac.id, ac]));
  const acsOfTc = new Map();
  for (const ac of spec.acs) {
    for (const tc of ac.tcs) {
      if (!acsOfTc.has(tc)) acsOfTc.set(tc, []);
      acsOfTc.get(tc).push(ac.id);
    }
  }
  return (item) => {
    const labels = extractCaseLabels(item);
    const bound = new Set(labels.acs.filter((id) => acById.has(id)));
    if (bound.size === 0) {
      for (const tc of labels.tcs) for (const id of acsOfTc.get(tc) || []) bound.add(id);
    }
    const ids = sortedUnique([...bound]);
    const priorities = sortedUnique(ids
      .map((id) => acById.get(id))
      .filter((ac) => ac.verification === 'auto' && required.has(ac.priority))
      .map((ac) => ac.priority));
    return { ids, priorities, required: priorities.length > 0 };
  };
}

// 同一套件内 classname 与 name 都相同的用例按出现序号区分，避免重名用例互相覆盖。
function caseKeys(suiteName, cases) {
  const seen = new Map();
  return cases.map((item) => {
    const base = `${suiteName}\u0000${item.classname}\u0000${item.name}`;
    const occurrence = (seen.get(base) || 0) + 1;
    seen.set(base, occurrence);
    return `${base}\u0000${occurrence}`;
  });
}

// rounds：按轮次排列的 [{ run, suites:[{ name, status, cases|null }] }]，第 1 轮在前；
// cases 为 null 表示该轮套件没有可用报告（其用例在该轮记为 missing）。
// 返回 { flaky, unstable_suites, summary }：
// - flaky：各轮状态不完全相同的用例，按首次出现的轮次、套件与用例顺序排列；
// - unstable_suites：套件状态（ok/exit_nonzero/timeout…）在各轮之间不一致的套件；
// - summary.rate = flaky / 用例总数，保留 4 位小数，没有用例时为 0。
function compareRuns({ spec, requiredPriorities, rounds } = {}) {
  if (!Array.isArray(rounds) || rounds.length === 0) throw new Error('rounds 须为非空数组');
  const bind = caseBinder(spec, requiredPriorities);
  const runs = rounds.length;

  const order = [];
  const entries = new Map();
  const suiteStatuses = new Map();
  rounds.forEach((round, index) => {
    if (!round || !Array.isArray(round.suites)) throw new Error(`rounds[${index}].suites 须为数组`);
    for (const suite of round.suites) {
      if (!suiteStatuses.has(suite.name)) suiteStatuses.set(suite.name, new Array(runs).fill(MISSING));
      suiteStatuses.get(suite.name)[index] = suite.status;
      const cases = Array.isArray(suite.cases) ? suite.cases : [];
      const keys = caseKeys(suite.name, cases);
      cases.forEach((item, position) => {
        if (!CASE_STATUSES.includes(item.status)) throw new Error(`用例 ${JSON.stringify(item.name)} 的状态 ${JSON.stringify(item.status)} 无效`);
        const key = keys[position];
        if (!entries.has(key)) {
          entries.set(key, { suite: suite.name, classname: item.classname, name: item.name, statuses: new Array(runs).fill(MISSING) });
          order.push(key);
        }
        entries.get(key).statuses[index] = item.status;
      });
    }
  });

  const flaky = [];
  for (const key of order) {
    const entry = entries.get(key);
    if (new Set(entry.statuses).size === 1) continue;
    flaky.push({ suite: entry.suite, classname: entry.classname, name: entry.name, ...bind(entry), statuses: entry.statuses });
  }
  const unstable = [];
  for (const [name, statuses] of suiteStatuses) {
    if (new Set(statuses).size > 1) unstable.push({ name, statuses });
  }
  const cases = order.length;
  return {
    flaky,
    unstable_suites: unstable,
    summary: {
      runs,
      cases,
      flaky: flaky.length,
      required_flaky: flaky.filter((item) => item.required).length,
      rate: cases === 0 ? 0 : Math.round((flaky.length / cases) * RATE_SCALE) / RATE_SCALE,
    },
  };
}

module.exports = { MISSING, caseBinder, compareRuns };
