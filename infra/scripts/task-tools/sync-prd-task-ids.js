#!/usr/bin/env node

'use strict';

/**
 * PRD → TASK canonical traceability gate.
 *
 * Canonical definitions are deliberately narrower than free-form references:
 * - Story/AC definitions come from Story heading blocks in PRD documents.
 * - Task definitions come from Task-ID-first tables or Task detail headings.
 * - Mapping rows must start with one exact Story ID.
 *
 * This prevents reference-only prose from inflating both sides of the gate and
 * makes multi-segment IDs such as US-RUNTIME-TRUST-001 fail closed correctly.
 */

const fs = require('node:fs');
const path = require('node:path');
const { resolveRepoRoot } = require('../shared/config');
const {
  AC_ID_SOURCE,
  STORY_ID_SOURCE,
  TASK_ID_SOURCE,
  exactPattern,
  extractIds,
  markdownCells,
} = require('../shared/governance-ids');

const PROJECT_ROOT = resolveRepoRoot({ scriptDir: __dirname });
const CONFIG = {
  prdPath: path.join(PROJECT_ROOT, 'docs/PRD.md'),
  prdModulesDir: path.join(PROJECT_ROOT, 'docs/prd-modules'),
  taskPath: path.join(PROJECT_ROOT, 'docs/TASK.md'),
  taskModulesDir: path.join(PROJECT_ROOT, 'docs/task-modules'),
  storyTaskMappingPath: path.join(PROJECT_ROOT, 'docs/data/story-task-mapping.md'),
};

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function canonicalModuleFiles(directory, filename) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => path.join(directory, entry.name, filename))
    .filter((filePath) => fs.existsSync(filePath))
    .sort();
}

function stripMarkdown(value) {
  return String(value).trim().replace(/^(`|\*\*|__)+|(`|\*\*|__)+$/g, '').trim();
}

function addNumericRange(target, canonicalId, endSuffix, width) {
  const parts = canonicalId.split('-');
  const start = Number(parts.pop());
  const prefix = parts.join('-');
  const end = endSuffix === undefined ? start : Number(endSuffix);
  if (!Number.isInteger(start) || !Number.isInteger(end) || end < start) return;
  for (let suffix = start; suffix <= end; suffix += 1) {
    target.add(`${prefix}-${String(suffix).padStart(width, '0')}`);
  }
}

function extractAcceptanceCriteriaIdsFromText(content) {
  const ids = new Set();
  const pattern = new RegExp(
    `(?<![A-Z0-9-])(${AC_ID_SOURCE})(?!-[A-Z0-9])(?:\\.\\.(\\d{2}))?((?:\\s*[、,，]\\s*\\d{2}(?:\\.\\.\\d{2})?)*)`,
    'g',
  );

  for (const match of String(content).matchAll(pattern)) {
    addNumericRange(ids, match[1], match[2], 2);
    const parts = match[1].split('-');
    parts.pop();
    const base = parts.join('-');
    for (const sparse of match[3].matchAll(/[、,，]\s*(\d{2})(?:\.\.(\d{2}))?/g)) {
      addNumericRange(ids, `${base}-${sparse[1]}`, sparse[2], 2);
    }
  }
  return ids;
}

function extractTaskIdsFromText(content) {
  const ids = new Set();
  const pattern = new RegExp(
    `(?<![A-Z0-9-])(${TASK_ID_SOURCE})(?!-[A-Z0-9])(?:\\.\\.(\\d{3}))?`,
    'g',
  );
  for (const match of String(content).matchAll(pattern)) {
    addNumericRange(ids, match[1], match[2], 3);
  }
  return ids;
}

function extractStoryIds(filePath) {
  if (!fs.existsSync(filePath)) return new Set();
  return new Set(extractIds(fs.readFileSync(filePath, 'utf8'), STORY_ID_SOURCE));
}

function extractTaskIds(filePath) {
  if (!fs.existsSync(filePath)) return new Set();
  return extractTaskIdsFromText(fs.readFileSync(filePath, 'utf8'));
}

function extractCanonicalPrdIdsFromContent(content) {
  const storyIds = new Set();
  const acceptanceCriteriaIds = new Set();
  const storyHeading = new RegExp(
    `^(#{2,6})\\s+(${STORY_ID_SOURCE})(?=[:：\\s])`,
  );
  let activeStoryLevel = null;

  for (const line of String(content).split(/\r?\n/)) {
    const heading = line.match(/^(#{1,6})\s+/);
    const story = line.match(storyHeading);
    if (story) {
      activeStoryLevel = story[1].length;
      storyIds.add(story[2]);
    } else if (heading && activeStoryLevel !== null && heading[1].length <= activeStoryLevel) {
      activeStoryLevel = null;
    }

    if (activeStoryLevel !== null) {
      for (const id of extractAcceptanceCriteriaIdsFromText(line)) acceptanceCriteriaIds.add(id);
    }
  }

  return { storyIds, acceptanceCriteriaIds };
}

function extractCanonicalTaskIdsFromContent(content) {
  const ids = new Set();
  const exactTask = exactPattern(TASK_ID_SOURCE);
  const taskHeading = new RegExp(
    `^#{2,6}\\s+(?:\\d+(?:\\.\\d+)*\\s+)?(${TASK_ID_SOURCE})(?=[:：\\s])`,
  );
  let taskIdFirstTable = false;

  for (const line of String(content).split(/\r?\n/)) {
    const heading = line.match(taskHeading);
    if (heading) ids.add(heading[1]);

    const cells = markdownCells(line);
    if (cells.length === 0) {
      taskIdFirstTable = false;
      continue;
    }

    const firstCell = stripMarkdown(cells[0]);
    if (/^Task ID$/i.test(firstCell)) {
      taskIdFirstTable = true;
      continue;
    }
    if (/^:?-{3,}:?$/.test(firstCell)) continue;
    if (taskIdFirstTable && exactTask.test(firstCell)) ids.add(firstCell);
  }

  return ids;
}

function collectCanonicalPrdIds() {
  const storyIds = new Set();
  const acceptanceCriteriaIds = new Set();
  const files = [
    CONFIG.prdPath,
    ...canonicalModuleFiles(CONFIG.prdModulesDir, 'PRD.md'),
  ].filter((filePath) => fs.existsSync(filePath));

  for (const filePath of files) {
    const parsed = extractCanonicalPrdIdsFromContent(fs.readFileSync(filePath, 'utf8'));
    for (const id of parsed.storyIds) storyIds.add(id);
    for (const id of parsed.acceptanceCriteriaIds) acceptanceCriteriaIds.add(id);
  }
  return { storyIds, acceptanceCriteriaIds };
}

function collectAllStoryIds() {
  return collectCanonicalPrdIds().storyIds;
}

function collectAllAcceptanceCriteriaIds() {
  return collectCanonicalPrdIds().acceptanceCriteriaIds;
}

function collectAllTaskIds() {
  const ids = new Set();
  const files = [
    CONFIG.taskPath,
    ...canonicalModuleFiles(CONFIG.taskModulesDir, 'TASK.md'),
  ].filter((filePath) => fs.existsSync(filePath));
  for (const filePath of files) {
    const parsed = extractCanonicalTaskIdsFromContent(fs.readFileSync(filePath, 'utf8'));
    for (const id of parsed) ids.add(id);
  }
  return ids;
}

function parseStoryTaskMappingContent(content) {
  const mapping = new Map();
  const mappedStories = new Set();
  const mappedAcceptanceCriteria = new Set();
  const mappedTasks = new Set();
  const exactStory = exactPattern(STORY_ID_SOURCE);

  for (const line of String(content).split(/\r?\n/)) {
    const cells = markdownCells(line);
    if (cells.length < 2) continue;
    const storyId = stripMarkdown(cells[0]);
    if (!exactStory.test(storyId)) continue;

    const taskIds = [...extractTaskIdsFromText(cells.slice(1).join(' | '))];
    const acIds = extractAcceptanceCriteriaIdsFromText(cells.slice(1).join(' | '));
    mappedStories.add(storyId);
    for (const id of acIds) mappedAcceptanceCriteria.add(id);
    for (const id of taskIds) mappedTasks.add(id);

    const existing = mapping.get(storyId) || [];
    for (const id of taskIds) {
      if (!existing.includes(id)) existing.push(id);
    }
    mapping.set(storyId, existing);
  }

  return { mapping, mappedStories, mappedAcceptanceCriteria, mappedTasks };
}

function parseStoryTaskMapping() {
  if (!fs.existsSync(CONFIG.storyTaskMappingPath)) {
    return {
      mapping: new Map(),
      mappedStories: new Set(),
      mappedAcceptanceCriteria: new Set(),
      mappedTasks: new Set(),
    };
  }
  return parseStoryTaskMappingContent(fs.readFileSync(CONFIG.storyTaskMappingPath, 'utf8'));
}

function sortedDifference(source, target) {
  return [...source].filter((id) => !target.has(id)).sort();
}

function validateRepositoryTraceability(input = {}) {
  const stories = input.stories || collectAllStoryIds();
  const acceptanceCriteria = input.acceptanceCriteria || collectAllAcceptanceCriteriaIds();
  const tasks = input.tasks || collectAllTaskIds();
  const mapping = input.mapping || parseStoryTaskMapping();

  const orphanStories = sortedDifference(stories, mapping.mappedStories);
  const orphanAcceptanceCriteria = sortedDifference(
    acceptanceCriteria,
    mapping.mappedAcceptanceCriteria,
  );
  const orphanTasks = sortedDifference(tasks, mapping.mappedTasks);
  const invalidStories = sortedDifference(mapping.mappedStories, stories);
  const invalidAcceptanceCriteria = sortedDifference(
    mapping.mappedAcceptanceCriteria,
    acceptanceCriteria,
  );
  const invalidTasks = sortedDifference(mapping.mappedTasks, tasks);
  const emptyInputs = stories.size === 0 || acceptanceCriteria.size === 0 || tasks.size === 0;
  const emptyMapping = mapping.mappedStories.size === 0
    || mapping.mappedAcceptanceCriteria.size === 0
    || mapping.mappedTasks.size === 0;

  return {
    passed: !emptyInputs
      && !emptyMapping
      && orphanStories.length === 0
      && orphanAcceptanceCriteria.length === 0
      && orphanTasks.length === 0
      && invalidStories.length === 0
      && invalidAcceptanceCriteria.length === 0
      && invalidTasks.length === 0,
    emptyInputs,
    emptyMapping,
    orphanStories,
    orphanAcceptanceCriteria,
    orphanTasks,
    invalidStories,
    invalidAcceptanceCriteria,
    invalidTasks,
    counts: {
      stories: stories.size,
      acceptanceCriteria: acceptanceCriteria.size,
      tasks: tasks.size,
      mappedStories: mapping.mappedStories.size,
      mappedAcceptanceCriteria: mapping.mappedAcceptanceCriteria.size,
      mappedTasks: mapping.mappedTasks.size,
    },
  };
}

function printList(label, values, color = 'yellow') {
  if (values.length === 0) return;
  log(`${label}: ${values.length}`, color);
  for (const id of values.slice(0, 12)) log(`   - ${id}`, color);
  if (values.length > 12) log(`   ... 还有 ${values.length - 12} 个`, color);
}

function main() {
  log('='.repeat(60), 'cyan');
  log('PRD → TASK canonical traceability gate v2.0', 'cyan');
  log('='.repeat(60), 'cyan');
  const result = validateRepositoryTraceability();
  const counts = result.counts;

  log(`Canonical PRD: ${counts.stories} Story / ${counts.acceptanceCriteria} AC`, 'cyan');
  log(`Canonical TASK: ${counts.tasks} Task`, 'cyan');
  log(
    `Mapping: ${counts.mappedStories} Story / ${counts.mappedAcceptanceCriteria} AC / ${counts.mappedTasks} Task`,
    'cyan',
  );
  printList('Orphan Story', result.orphanStories);
  printList('Orphan AC', result.orphanAcceptanceCriteria);
  printList('Orphan Task', result.orphanTasks);
  printList('Invalid Story reference', result.invalidStories, 'red');
  printList('Invalid AC reference', result.invalidAcceptanceCriteria, 'red');
  printList('Invalid Task reference', result.invalidTasks, 'red');

  if (!result.passed) {
    if (result.emptyInputs || result.emptyMapping) log('❌ Empty canonical input/mapping is forbidden', 'red');
    log('❌ Traceability is incomplete; failing closed', 'red');
    return 1;
  }
  log('✅ Canonical traceability is complete', 'green');
  return 0;
}

if (require.main === module) process.exitCode = main();

module.exports = {
  CONFIG,
  collectAllAcceptanceCriteriaIds,
  collectAllStoryIds,
  collectAllTaskIds,
  extractAcceptanceCriteriaIdsFromText,
  extractCanonicalPrdIdsFromContent,
  extractCanonicalTaskIdsFromContent,
  extractStoryIds,
  extractTaskIds,
  parseStoryTaskMapping,
  parseStoryTaskMappingContent,
  validateRepositoryTraceability,
};
