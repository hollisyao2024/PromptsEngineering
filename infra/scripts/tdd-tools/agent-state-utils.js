#!/usr/bin/env node
/**
 * agent-state-utils.js
 * 共享工具：读写 docs/AGENT_STATE.md 的 IN_PROGRESS 区
 * 被 tdd-push.js、generate-qa.js、qa-verify.js、qa-merge.js 引用。
 * 多任务运行态请使用容器层 ../tmp/worktree-sessions/，不要扩展本文件为并行调度源。
 */
const fs = require('fs');

const SECTION_HEADER = '## IN_PROGRESS';

/**
 * 解析 IN_PROGRESS 区的字段，返回 { branch, pr, step, started_at }
 * 若区块不存在，返回 null
 */
function parseInProgress(content) {
  const idx = content.indexOf(SECTION_HEADER);
  if (idx === -1) return null;

  const section = content.slice(idx);
  const get = (key) => {
    const m = section.match(new RegExp(`^${key}:\\s*(.*)$`, 'm'));
    return m ? m[1].trim() : '';
  };

  return {
    branch: get('branch'),
    pr: get('pr'),
    step: get('step'),
    started_at: get('started_at'),
  };
}

/**
 * 将 IN_PROGRESS 区的指定字段写入文件
 * fields: Partial<{ branch, pr, step, started_at }>
 * 区块不存在时静默跳过（不创建）
 */
function writeInProgressFields(agentStatePath, fields) {
  if (!fs.existsSync(agentStatePath)) return;

  let content = fs.readFileSync(agentStatePath, 'utf8');
  const idx = content.indexOf(SECTION_HEADER);
  if (idx === -1) return;

  for (const [key, value] of Object.entries(fields)) {
    content = content.replace(new RegExp(`(^${key}:)\\s*.*$`, 'm'), `$1 ${value}`);
  }

  fs.writeFileSync(agentStatePath, content, 'utf8');
}

/**
 * 清除 IN_PROGRESS 区所有字段值（纯字符串操作，保留 key 行）
 */
function clearInProgressContent(content) {
  let result = content;
  for (const key of ['branch', 'pr', 'step', 'started_at']) {
    result = result.replace(new RegExp(`(^${key}:)\\s*.*$`, 'm'), `$1 `);
  }
  return result;
}

/**
 * 清除 IN_PROGRESS 区所有字段值（文件级操作，保留 key 行）
 */
function clearInProgress(agentStatePath) {
  if (!fs.existsSync(agentStatePath)) return;

  let content = fs.readFileSync(agentStatePath, 'utf8');
  const idx = content.indexOf(SECTION_HEADER);
  if (idx === -1) return;

  fs.writeFileSync(agentStatePath, clearInProgressContent(content), 'utf8');
}

/**
 * 格式化当前时间为 YYYY-MM-DD HH:MM
 */
function nowDatetime() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

module.exports = { parseInProgress, writeInProgressFields, clearInProgress, clearInProgressContent, nowDatetime };
