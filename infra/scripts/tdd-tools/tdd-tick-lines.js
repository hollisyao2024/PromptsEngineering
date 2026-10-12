/**
 * tdd-tick 的任务文档逐行处理：复选框、表格状态列与交付物行的识别与勾选。
 * 纯文本函数，不读写文件；由 tdd-tick.js 使用并重新导出。
 */

function normalizePlainText(text) {
  return text
    .replace(/[*_`~]/g, '')
    .replace(/[()[\]{}（）【】<>《》"'.,:;!?/\\-]/g, '')
    .replace(/\s+/g, '')
    .toUpperCase();
}

function extractChecklistPrimaryTaskId(line) {
  const checklistMatch = line.match(/^(\s*)- \[( |x|X)\]\s*(.*)$/);
  if (!checklistMatch) {
    return null;
  }

  const content = checklistMatch[3].trim();
  const match = content.match(/^(?:\*\*|__|`)?(TASK-[A-Z0-9]+-[0-9]+)(?:\*\*|__|`)?(?=$|[\s:：—–-])/i);
  return match ? match[1].toUpperCase() : null;
}

function extractTablePrimaryTaskId(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|')) {
    return null;
  }

  const cells = line.split('|');
  const primaryCell = cells.slice(1).find((cell) => cell.trim() !== '');
  if (!primaryCell) {
    return null;
  }

  const normalized = primaryCell.trim().replace(/^(?:\*\*|__|`)|(?:\*\*|__|`)$/g, '').trim();
  const match = normalized.match(/^TASK-[A-Z0-9]+-[0-9]+$/i);
  return match ? match[0].toUpperCase() : null;
}

function lineOwnsTaskId(line, taskIds) {
  const primaryTaskId = extractChecklistPrimaryTaskId(line) || extractTablePrimaryTaskId(line);
  return primaryTaskId ? taskIds.includes(primaryTaskId) : false;
}

function processChecklistLine(line, targetIds) {
  const checklistMatch = line.match(/^(\s*)- \[( |x|X)\](.*)$/);
  if (!checklistMatch) {
    return null;
  }

  const primaryTaskId = extractChecklistPrimaryTaskId(line);
  if (!primaryTaskId || !targetIds.has(primaryTaskId)) {
    return null;
  }

  const relevantIds = [primaryTaskId];
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

function isMarkdownTableSeparator(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|')) {
    return false;
  }
  const cells = line.split('|').slice(1, -1).map((cell) => cell.trim());
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function findDeclaredTableStatusIndexes(lines) {
  const indexes = new Map();
  let activeStatusIndex = -1;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim().startsWith('|')) {
      activeStatusIndex = -1;
      continue;
    }
    if (index + 1 < lines.length && isMarkdownTableSeparator(lines[index + 1])) {
      const cells = line.split('|');
      activeStatusIndex = cells.findIndex((cell) => {
        const normalized = normalizePlainText(cell);
        return normalized === 'STATUS' || normalized === 'STATE' || normalized === '状态';
      });
      continue;
    }
    if (!isMarkdownTableSeparator(line)) {
      indexes.set(index, activeStatusIndex);
    }
  }
  return indexes;
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
    const taskId = extractTablePrimaryTaskId(line);
    if (!taskId || !targetIds.has(taskId)) {
      return;
    }

    const primaryIndex = cells.findIndex((cell) => cell.trim() !== '');
    const nameCell = cells[primaryIndex + 1] ? cells[primaryIndex + 1].replace(/\*\*/g, '').trim() : '';
    if (nameCell) {
      const variants = createNameVariants(nameCell);
      nameMap.set(taskId, {
        raw: nameCell,
        normalizedVariants: variants
      });
    }
  });
  return nameMap;
}

function processTableLine(line, targetIds, completionText, declaredStatusIndex) {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|') || trimmed.startsWith('| 任务') || trimmed.startsWith('|---------')) {
    return null;
  }

  const cells = line.split('|');
  const primaryTaskId = extractTablePrimaryTaskId(line);
  if (!primaryTaskId || !targetIds.has(primaryTaskId)) {
    return null;
  }

  const relevantIds = new Set([primaryTaskId]);
  const handledIds = new Set(relevantIds);
  const statusIdx = Number.isInteger(declaredStatusIndex)
    ? declaredStatusIndex
    : findStatusCellIndex(cells);
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

module.exports = {
  extractTaskNameMap,
  findDeclaredTableStatusIndexes,
  lineOwnsTaskId,
  processChecklistLine,
  processDeliverableLine,
  processTableLine,
};
