'use strict';

// qa.business 配置的解析、校验与摘要。纯函数：不读文件、不访问网络、不创建目录；
// 输入是 loadConfig 合并后的配置对象，输出规范化的套件定义与配置摘要。
// 报告路径只做静态规范化；是否真实位于仓库内、是否为已跟踪文件由 qa run 在运行时核对。

const crypto = require('node:crypto');
const path = require('node:path');
const { PRIORITIES } = require('./business-spec');

const FIELD = 'qa.business';
const DEFAULT_TIMEOUT_SECONDS = 900;
const MAX_TIMEOUT_SECONDS = 7200;
const NO_PLATFORM = '-';
const TAG_PATTERN = /^[a-z][a-z0-9-]*$/u;
const DRIVE_PREFIX = /^[A-Za-z]:/u;
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/u;
const BUSINESS_KEYS = ['enabled', 'requiredPriorities', 'suites'];
const SUITE_KEYS = ['name', 'platform', 'command', 'report', 'timeoutSeconds'];
const DEFAULT_PRIORITIES = ['P0'];

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const show = (value) => JSON.stringify(value) ?? String(value);

// 规范化为相对仓库根的 POSIX 文件路径；返回 { value } 或 { error }。
function normalizeReport(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') return { error: '须为非空字符串，指向相对仓库根的报告文件' };
  if (CONTROL_CHARS.test(raw)) return { error: '不得包含控制字符' };
  if (DRIVE_PREFIX.test(raw) || raw.startsWith('/') || raw.startsWith('\\')) return { error: '不得是绝对路径（含 Windows 盘符与 UNC 路径）' };
  const posix = raw.replace(/\\/gu, '/');
  const last = posix.slice(posix.lastIndexOf('/') + 1);
  if (last === '' || last === '.' || last === '..') return { error: '须指向文件，不能是目录、仓库根或以斜杠结尾' };
  const normalized = path.posix.normalize(posix);
  if (normalized === '..' || normalized.startsWith('../')) return { error: '不得越出仓库根目录' };
  // qa run 会在运行前删除旧报告；.git 内的文件不是报告，大小写不敏感的文件系统上也要拦住。
  if (normalized.split('/')[0].toLowerCase() === '.git') return { error: '不得位于 .git 目录内' };
  return { value: normalized };
}

function resolveEnabled(raw, fail) {
  if (raw === undefined) return false;
  if (typeof raw === 'boolean') return raw;
  fail(`${FIELD}.enabled`, '须为布尔值 true 或 false；无法判读时按已开启处理');
  return true;
}

// 去重并按 P0..P3 排序，使等价写法得到同一摘要。
function resolvePriorities(raw, fail) {
  const field = `${FIELD}.requiredPriorities`;
  if (raw === undefined) return [...DEFAULT_PRIORITIES];
  if (!Array.isArray(raw) || raw.length === 0) {
    fail(field, `须为非空数组，元素取自 ${PRIORITIES.join('/')}`);
    return null;
  }
  const invalid = raw.filter((item) => !PRIORITIES.includes(item));
  if (invalid.length > 0) {
    fail(field, `含非法优先级 ${invalid.map(show).join('、')}，须取自 ${PRIORITIES.join('/')}`);
    return null;
  }
  return PRIORITIES.filter((priority) => raw.includes(priority));
}

function resolveSuite(raw, index, seenNames, fail) {
  const at = `${FIELD}.suites[${index}]`;
  if (!isObject(raw)) {
    fail(at, '须为对象');
    return null;
  }
  const bad = (key, message) => fail(`${at}.${key}`, message);
  for (const key of Object.keys(raw)) {
    if (!SUITE_KEYS.includes(key)) bad(key, `未知配置项，套件仅支持 ${SUITE_KEYS.join('、')}`);
  }

  const { name, platform = NO_PLATFORM, command, report, timeoutSeconds = DEFAULT_TIMEOUT_SECONDS } = raw;
  if (name === undefined) {
    bad('name', '缺少必填项 name');
  } else if (typeof name !== 'string' || !TAG_PATTERN.test(name)) {
    bad('name', `${show(name)} 须匹配 [a-z][a-z0-9-]*`);
  } else if (seenNames.has(name)) {
    bad('name', `套件名称 ${name} 重复`);
  } else {
    seenNames.add(name);
  }
  if (typeof platform !== 'string' || (platform !== NO_PLATFORM && !TAG_PATTERN.test(platform))) {
    bad('platform', `${show(platform)} 须为单个端标签 [a-z][a-z0-9-]* 或 ${NO_PLATFORM}`);
  }
  if (typeof command !== 'string' || command.trim() === '') bad('command', '须为非空字符串');

  const normalized = normalizeReport(report);
  if (normalized.error) bad('report', normalized.error);
  if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 1 || timeoutSeconds > MAX_TIMEOUT_SECONDS) {
    bad('timeoutSeconds', `${show(timeoutSeconds)} 须为 1 到 ${MAX_TIMEOUT_SECONDS} 之间的整数（秒）`);
  }
  return { name, platform, command, report: normalized.value, timeoutSeconds };
}

// 摘要覆盖影响测试结论的全部字段，但不含 enabled：开关切换不应使已有结果失效。
function digestOf(requiredPriorities, suites) {
  const canonical = JSON.stringify({
    requiredPriorities,
    suites: suites.map(({ name, platform, command, report, timeoutSeconds }) => ({ name, platform, command, report, timeoutSeconds })),
  });
  return `sha256:${crypto.createHash('sha256').update(canonical).digest('hex')}`;
}

// 返回 { ok, enabled, requiredPriorities, suites, digest, errors:[{field,message}] }。
// ok=false 时 requiredPriorities/suites 为默认空值、digest 为 null，调用方不得据此运行；
// enabled 始终独立判读，无法判读（非布尔、qa.business 非对象，或 qa.business 下出现未知键）时按 true 处理（fail-closed）。
// 未知键也算无法判读：loadConfig 合并模板默认值后 enabled 恒为 false，开关键拼错（如 enable）不会让 enabled 缺省，只能靠未知键本身触发。
function resolveBusinessConfig(config) {
  const qa = isObject(config) ? config.qa : undefined;
  const raw = isObject(qa) ? qa.business : undefined;
  const errors = [];
  const fail = (field, message) => errors.push({ field, message });

  let enabled = false;
  let requiredPriorities = [...DEFAULT_PRIORITIES];
  const suites = [];

  if (raw !== undefined && !isObject(raw)) {
    fail(FIELD, '须为对象');
    enabled = true;
  } else if (raw !== undefined) {
    enabled = resolveEnabled(raw.enabled, fail);
    requiredPriorities = resolvePriorities(raw.requiredPriorities, fail) ?? requiredPriorities;
    if (raw.suites !== undefined && !Array.isArray(raw.suites)) {
      fail(`${FIELD}.suites`, '须为数组');
    } else if (raw.suites !== undefined) {
      const seenNames = new Set();
      for (let index = 0; index < raw.suites.length; index += 1) {
        const suite = resolveSuite(raw.suites[index], index, seenNames, fail);
        if (suite) suites.push(suite);
      }
    }
    for (const key of Object.keys(raw)) {
      if (BUSINESS_KEYS.includes(key)) continue;
      fail(`${FIELD}.${key}`, `未知配置项，仅支持 ${BUSINESS_KEYS.join('、')}（可能是拼写错误；存在未知配置项时 qa verify 按已开启处理并阻断）`);
      enabled = true;
    }
  }

  if (errors.length > 0) {
    return { ok: false, enabled, requiredPriorities: [...DEFAULT_PRIORITIES], suites: [], digest: null, errors };
  }
  return { ok: true, enabled, requiredPriorities, suites, digest: digestOf(requiredPriorities, suites), errors };
}

// 已登记套件的命令原文，按套件顺序返回，供 task exec 的测试范围护栏放行与登记一致的命令。
// 与 enabled 无关（开关只决定 qa verify 是否启用门禁）；配置无效时整份 qa.business 都不可信，返回空数组，
// 不让其中恰好有效的套件放行命令。
function registeredSuiteCommands(config) {
  const resolved = resolveBusinessConfig(config);
  return resolved.ok ? resolved.suites.map((suite) => suite.command) : [];
}

module.exports = {
  DEFAULT_TIMEOUT_SECONDS,
  MAX_TIMEOUT_SECONDS,
  NO_PLATFORM,
  registeredSuiteCommands,
  resolveBusinessConfig,
};
