#!/usr/bin/env node
/**
 * 自动勾选 /docs/TASK.md 及 task-modules 中的任务复选框。
 *
 * 规则：
 * 1. 从当前 Git 分支名解析 TASK ID（支持 feature/TASK-123 或 TASK-PAY-005+TASK-NOTIF-002）。
 * 2. 在任务文档中查找以 "- [ ]" 开头且包含相应 TASK ID 的行，并改为 "- [x]".
 * 3. 若任务已勾选，则仅计为已处理，不重复修改。
 * 4. bug/小需求分支（fix/*、feature/* 且不含 TASK ID）允许 no-op 放行。
 * 5. 其他分支找不到 TASK ID 时脚本报错，用以阻止漏勾选的提交。
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { resolveRepoRoot } = require('../shared/config');

const repoRoot = resolveRepoRoot({ scriptDir: __dirname });
const docsDir = path.join(repoRoot, 'docs');
const mainTaskFile = path.join(docsDir, 'TASK.md');
const taskModulesDir = path.join(docsDir, 'task-modules');
const moduleListFile = path.join(taskModulesDir, 'module-list.md');

function formatCompletionText() {
  return `✅ 已完成 (${new Date().toISOString().slice(0, 10)})`;
}

function normalizePlainText(text) {
  return text
    .replace(/[*_`~]/g, '')
    .replace(/[()\[\]{}（）【】<>《》"'.,:;!?/\\-]/g, '')
    .replace(/\s+/g, '')
    .toUpperCase();
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
  return normalized.startsWith('fix/') || normalized.startsWith('feature/');
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

function extractTaskDomains(taskIds) {
  const domains = new Set();
  taskIds.forEach((taskId) => {
    const match = taskId.match(/^TASK-([A-Z0-9]+)-\d+$/i);
    if (match) {
      domains.add(match[1].toLowerCase());
    }
  });
  return domains;
}

function collectTaskFiles(scope, taskIds) {
  const files = [];
  if (fs.existsSync(mainTaskFile)) {
    files.push(mainTaskFile);
  }

  if (!fs.existsSync(taskModulesDir)) {
    return files;
  }

  if (scope === 'session') {
    if (fs.existsSync(moduleListFile)) {
      files.push(moduleListFile);
    }
    const domains = extractTaskDomains(taskIds);
    if (!domains.size) {
      return files;
    }

    const stack = [taskModulesDir];
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
        const relativePath = path.relative(taskModulesDir, entryPath).replace(/\\/g, '/');
        const ownerDir = relativePath.split('/')[0].toLowerCase();
        if (domains.has(ownerDir)) {
          files.push(entryPath);
        }
      }
    }
    return files;
  }

  if (scope === 'project') {
    if (fs.existsSync(moduleListFile)) {
      files.push(moduleListFile);
    }
    const stack = [taskModulesDir];
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

function processChecklistLine(line, targetIds) {
  const checklistMatch = line.match(/^(\s*)- \[( |x|X)\](.*)$/);
  if (!checklistMatch) {
    return null;
  }

  const idsInLine = (line.match(/TASK-[A-Z0-9-]+/gi) || []).map((id) => id.toUpperCase());
  const relevantIds = idsInLine.filter((id) => targetIds.has(id));
  if (!relevantIds.length) {
    return null;
  }

  const handledIds = new Set(relevantIds);
  const updatedIds = new Set();
  const markState = checklistMatch[2].trim().toLowerCase();
  if (markState === 'x') {
    return {
      line,
      changed: false,
      handledIds,
      updatedIds
    };
  }

  const newLine = line.replace(/^(\s*)- \[ \]/, '$1- [x]');
  if (newLine !== line) {
    relevantIds.forEach((id) => updatedIds.add(id));
    return {
      line: newLine,
      changed: true,
      handledIds,
      updatedIds
    };
  }

  return {
    line,
    changed: false,
    handledIds,
    updatedIds
  };
}

function findStatusCellIndex(cells) {
  for (let i = cells.length - 2; i >= 0; i -= 1) {
    if (cells[i].trim() !== '') {
      return i;
    }
  }
  return -1;
}

function createNameVariants(name) {
  const variants = new Set();
  if (!name) {
    return variants;
  }
  variants.add(normalizePlainText(name));

  const simplified = name
    .replace(/（.*?）/g, '')
    .replace(/\(.*?\)/g, '')
    .trim();
  if (simplified && simplified !== name) {
    variants.add(normalizePlainText(simplified));
  }

  return variants;
}

function extractTaskNameMap(lines, targetIds) {
  const nameMap = new Map();
  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith('|') || trimmed.startsWith('| 任务') || trimmed.startsWith('|---------')) {
      return;
    }

    const cells = line.split('|');
    for (let i = 0; i < cells.length; i += 1) {
      const cellText = cells[i].replace(/\*\*/g, '').trim();
      const match = cellText.match(/TASK-[A-Z0-9-]+/i);
      if (!match) {
        continue;
      }
      const taskId = match[0].toUpperCase();
      if (!targetIds.has(taskId)) {
        break;
      }

      const nameCell = cells[i + 1] ? cells[i + 1].replace(/\*\*/g, '').trim() : '';
      if (nameCell) {
        const variants = createNameVariants(nameCell);
        nameMap.set(taskId, {
          raw: nameCell,
          normalizedVariants: variants
        });
      }
      break;
    }
  });
  return nameMap;
}

function processTableLine(line, targetIds, completionText) {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|') || trimmed.startsWith('| 任务') || trimmed.startsWith('|---------')) {
    return null;
  }

  const cells = line.split('|');
  const relevantIds = new Set();

  cells.forEach((cell) => {
    const ids = cell.match(/TASK-[A-Z0-9-]+/gi) || [];
    ids.forEach((id) => {
      const upperId = id.toUpperCase();
      if (targetIds.has(upperId)) {
        relevantIds.add(upperId);
      }
    });
  });

  if (!relevantIds.size) {
    return null;
  }

  const handledIds = new Set(relevantIds);
  const statusIdx = findStatusCellIndex(cells);
  if (statusIdx === -1) {
    return {
      line,
      changed: false,
      handledIds,
      updatedIds: new Set()
    };
  }

  const statusCell = cells[statusIdx].trim();
  const updatedIds = new Set();

  if (!statusCell.startsWith('✅')) {
    cells[statusIdx] = ` ${completionText} `;
    relevantIds.forEach((id) => updatedIds.add(id));
  }

  return {
    line: cells.join('|'),
    changed: updatedIds.size > 0,
    handledIds,
    updatedIds
  };
}

function processDeliverableLine(line, deliverableMatchers) {
  if (!deliverableMatchers.size) {
    return null;
  }
  const bulletMatch = line.match(/^(\s*)- \[( |x|X)\]\s*(.+)$/);
  if (!bulletMatch) {
    return null;
  }

  const normalizedContent = normalizePlainText(bulletMatch[3]);
  if (!normalizedContent) {
    return null;
  }

  const matchedIds = [];
  deliverableMatchers.forEach((meta, taskId) => {
    for (const variant of meta.normalizedVariants || []) {
      if (variant && normalizedContent.includes(variant)) {
        matchedIds.push(taskId);
        break;
      }
    }
  });

  if (!matchedIds.length) {
    return null;
  }

  const handledIds = new Set(matchedIds);
  const updatedIds = new Set();

  const markState = bulletMatch[2].trim().toLowerCase();
  if (markState === 'x') {
    return {
      line,
      changed: false,
      handledIds,
      updatedIds
    };
  }

  matchedIds.forEach((id) => updatedIds.add(id));
  return {
    line: line.replace(/^(\s*)- \[ \]/, '$1- [x]'),
    changed: true,
    handledIds,
    updatedIds
  };
}

function markTasksInFile(filePath, targetIds, completionText) {
  const originalContent = fs.readFileSync(filePath, 'utf8');
  const eol = originalContent.includes('\r\n') ? '\r\n' : '\n';
  const lines = originalContent.split(/\r?\n/);

  const deliverableMatchers = extractTaskNameMap(lines, targetIds);

  let changed = false;
  const handledIds = new Set();
  const updatedIds = new Set();

  const updatedLines = lines.map((line) => {
    const checklistResult = processChecklistLine(line, targetIds);
    if (checklistResult) {
      checklistResult.handledIds.forEach((id) => handledIds.add(id));
      checklistResult.updatedIds.forEach((id) => updatedIds.add(id));
      if (checklistResult.changed) {
        changed = true;
      }
      return checklistResult.line;
    }

    const tableResult = processTableLine(line, targetIds, completionText);
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

main();
