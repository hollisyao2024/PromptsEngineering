#!/usr/bin/env node
/**
 * 自动勾选 /docs/TASK.md 及 task-modules 中的任务复选框。
 *
 * 规则：
 * 1. 从当前 Git 分支名解析 TASK ID（支持 feature/TASK-123 或 TASK-PAY-005+TASK-NOTIF-002）。
 * 2. 在任务文档中查找以 "- [ ]" 开头且包含相应 TASK ID 的行，并改为 "- [x]".
 * 3. 若任务已勾选，则仅计为已处理，不重复修改。
 * 4. 非编码阶段分支（fix/*、feature/*、docs/*、ops/*、chore/*、hotfix/* 且不含 TASK ID）允许 no-op 放行。
 * 5. 其他分支找不到 TASK ID 时脚本报错，用以阻止漏勾选的提交。
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { resolveRepoRoot } = require('../shared/config');
const {
  extractTaskNameMap,
  findDeclaredTableStatusIndexes,
  lineOwnsTaskId,
  processChecklistLine,
  processDeliverableLine,
  processTableLine,
} = require('./tdd-tick-lines');

const repoRoot = resolveRepoRoot({ scriptDir: __dirname });
const docsDir = path.join(repoRoot, 'docs');
const mainTaskFile = path.join(docsDir, 'TASK.md');
const taskModulesDir = path.join(docsDir, 'task-modules');
const moduleListFile = path.join(taskModulesDir, 'module-list.md');

function formatCompletionText(now = new Date(), timeZone = 'Asia/Shanghai') {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(now);
  const calendar = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `✅ 已完成 (${calendar.year}-${calendar.month}-${calendar.day})`;
}

function getBranchName() {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', {
      cwd: repoRoot,
      encoding: 'utf8'
    }).trim();
  } catch (error) {
    throw new Error(`无法获取当前 Git 分支：${error.message}`);
  }
}

function parseTaskIds(branchName) {
  // 仅匹配标准 TASK ID（TASK-<DOMAIN>-<NUMBER>），避免吞掉分支描述后缀
  // 例如：feature/TASK-USER-001-targeted-fix 应提取 TASK-USER-001
  const matches = branchName.toUpperCase().match(/TASK-[A-Z0-9]+-[0-9]+/g);
  if (!matches) {
    return [];
  }
  return Array.from(new Set(matches));
}

function isNoTaskBranchAllowed(branchName) {
  const normalized = (branchName || '').trim().toLowerCase();
  // 非编码阶段（PRD/ARCH/TASK/QA/DevOps）与小需求/补丁分支允许 no-op 放行。
  // 与 worktree-core.js 的 phase→branch 前缀映射保持一致：
  //   prd|arch|task → docs/, qa → qa/, devops → ops/, fix → fix/, feature → feature/
  const allowedPrefixes = ['fix/', 'feature/', 'docs/', 'qa/', 'ops/', 'chore/', 'hotfix/', 'codex/'];
  return allowedPrefixes.some((prefix) => normalized.startsWith(prefix));
}

function parseScope(argv) {
  let scope = 'project';
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--scope' && argv[i + 1]) {
      scope = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg.startsWith('--scope=')) {
      scope = arg.split('=')[1];
    }
  }
  return scope === 'session' ? 'session' : 'project';
}

function collectTaskFiles(scope, taskIds, paths = {}) {
  const selectedMainTaskFile = paths.mainTaskFile || mainTaskFile;
  const selectedTaskModulesDir = paths.taskModulesDir || taskModulesDir;
  const selectedModuleListFile = paths.moduleListFile || moduleListFile;
  const files = [];
  if (fs.existsSync(selectedMainTaskFile)) {
    files.push(selectedMainTaskFile);
  }

  if (!fs.existsSync(selectedTaskModulesDir)) {
    return files;
  }

  if (scope === 'session') {
    if (fs.existsSync(selectedModuleListFile)) {
      files.push(selectedModuleListFile);
    }
    if (!taskIds.length) {
      return files;
    }

    const stack = [selectedTaskModulesDir];
    while (stack.length) {
      const current = stack.pop();
      const entries = fs.readdirSync(current, { withFileTypes: true });
      for (const entry of entries) {
        const entryPath = path.join(current, entry.name);
        if (entry.isDirectory()) {
          stack.push(entryPath);
          continue;
        }
        if (!entry.isFile() || entry.name !== 'TASK.md') {
          continue;
        }
        const content = fs.readFileSync(entryPath, 'utf8');
        const containsTarget = content.split(/\r?\n/).some((line) => lineOwnsTaskId(line, taskIds));
        if (containsTarget) {
          files.push(entryPath);
        }
      }
    }
    return files;
  }

  if (scope === 'project') {
    if (fs.existsSync(selectedModuleListFile)) {
      files.push(selectedModuleListFile);
    }
    const stack = [selectedTaskModulesDir];
    while (stack.length) {
      const current = stack.pop();
      const entries = fs.readdirSync(current, { withFileTypes: true });
      for (const entry of entries) {
        const entryPath = path.join(current, entry.name);
        if (entry.isDirectory()) {
          stack.push(entryPath);
        } else if (entry.isFile() && entry.name === 'TASK.md') {
          files.push(entryPath);
        }
      }
    }
  }
  return files;
}

function markTasksInFile(filePath, targetIds, completionText) {
  const originalContent = fs.readFileSync(filePath, 'utf8');
  const eol = originalContent.includes('\r\n') ? '\r\n' : '\n';
  const lines = originalContent.split(/\r?\n/);

  const deliverableMatchers = extractTaskNameMap(lines, targetIds);
  const tableStatusIndexes = findDeclaredTableStatusIndexes(lines);

  let changed = false;
  const handledIds = new Set();
  const updatedIds = new Set();

  const updatedLines = lines.map((line, lineIndex) => {
    const checklistResult = processChecklistLine(line, targetIds);
    if (checklistResult) {
      checklistResult.handledIds.forEach((id) => handledIds.add(id));
      checklistResult.updatedIds.forEach((id) => updatedIds.add(id));
      if (checklistResult.changed) {
        changed = true;
      }
      return checklistResult.line;
    }

    const tableResult = processTableLine(
      line,
      targetIds,
      completionText,
      tableStatusIndexes.get(lineIndex) ?? -1,
    );
    if (tableResult) {
      tableResult.handledIds.forEach((id) => handledIds.add(id));
      tableResult.updatedIds.forEach((id) => updatedIds.add(id));
      if (tableResult.changed) {
        changed = true;
      }
      return tableResult.line;
    }

    const deliverableResult = processDeliverableLine(line, deliverableMatchers);
    if (deliverableResult) {
      deliverableResult.handledIds.forEach((id) => handledIds.add(id));
      deliverableResult.updatedIds.forEach((id) => updatedIds.add(id));
      if (deliverableResult.changed) {
        changed = true;
      }
      return deliverableResult.line;
    }

    return line;
  });

  return {
    content: updatedLines.join(eol),
    changed,
    handledIds,
    updatedIds
  };
}

function determineBranchName() {
  const forced = process.env.TDD_BRANCH || process.env.BRANCH_NAME;
  if (forced) {
    return forced.trim();
  }
  return getBranchName();
}

function main() {
  const scope = parseScope(process.argv.slice(2));
  const branchName = determineBranchName();
  if (!branchName) {
    console.error('❌ 无法确定当前分支（git rev-parse 未返回内容）。请设置 TDD_BRANCH 环境变量或确保仓库存在 Git 分支。');
    process.exit(1);
  }
  const taskIds = parseTaskIds(branchName);

  if (!taskIds.length) {
    if (isNoTaskBranchAllowed(branchName)) {
      console.log(`ℹ️ 当前分支 ${branchName} 未包含 TASK ID，按 bug/小需求流程跳过 TASK 勾选（no-op）。`);
      process.exit(0);
    }
    console.error('❌ 当前分支名未包含任何 TASK ID（示例：feature/TASK-ACCOUNT-001-short-desc）。');
    process.exit(1);
  }

  const taskFiles = collectTaskFiles(scope, taskIds);
  if (!taskFiles.length) {
    console.error('❌ 未找到任务文档（docs/TASK.md 或 docs/task-modules/{domain}/TASK.md）。请先运行 /task plan 生成任务计划。');
    process.exit(1);
  }

  console.log(`ℹ️ tdd:tick 作用域: ${scope === 'session' ? 'session（当前会话）' : 'project（全项目）'}`);

  const targetIds = new Set(taskIds);
  const overallHandled = new Set();
  const overallUpdated = new Set();

  const completionText = formatCompletionText();

  for (const filePath of taskFiles) {
    const { content, changed, handledIds, updatedIds } = markTasksInFile(filePath, targetIds, completionText);
    handledIds.forEach((id) => overallHandled.add(id));
    updatedIds.forEach((id) => overallUpdated.add(id));

    if (changed) {
      fs.writeFileSync(filePath, content, 'utf8');
      console.log(`✅ 已在 ${path.relative(repoRoot, filePath)} 中勾选：${Array.from(updatedIds).join(', ')}`);
    }
  }

  const missingIds = taskIds.filter((id) => !overallHandled.has(id));
  if (missingIds.length) {
    console.error(`❌ 未在任何任务文档中找到以下 TASK ID：${missingIds.join(', ')}`);
    process.exit(1);
  }

  if (overallUpdated.size === 0) {
    console.log('ℹ️ 所有匹配任务已是完成状态，无需额外修改。');
  } else {
    console.log(`🎯 已自动勾选任务：${Array.from(overallUpdated).join(', ')}`);
  }
}

module.exports = {
  collectTaskFiles,
  formatCompletionText,
  markTasksInFile,
  processChecklistLine,
  processTableLine,
};

if (require.main === module) {
  main();
}
