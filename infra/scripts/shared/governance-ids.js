'use strict';

const MODULE_ID_SOURCE = '[A-Z][A-Z0-9]*(?:-[A-Z][A-Z0-9]*)*';
const STORY_ID_SOURCE = `US-${MODULE_ID_SOURCE}-\\d{3}`;
const FEATURE_ID_SOURCE = `FEAT-${MODULE_ID_SOURCE}-\\d{3}`;
const STORY_OR_FEATURE_ID_SOURCE = `(?:${STORY_ID_SOURCE}|${FEATURE_ID_SOURCE})`;
const AC_ID_SOURCE = `AC-${MODULE_ID_SOURCE}-\\d{3}-\\d{2}`;
const TASK_ID_SOURCE = `TASK-${MODULE_ID_SOURCE}-\\d{3}`;
const TEST_CASE_ID_SOURCE = `TC-${MODULE_ID_SOURCE}-\\d{3}`;
const BUG_ID_SOURCE = `BUG-${MODULE_ID_SOURCE}-\\d{3}`;
const COMPONENT_TYPE_SOURCE = '(?:SVC|DB|CACHE|MQ|API|JOB)';
const COMPONENT_ID_SOURCE = `${MODULE_ID_SOURCE}-${COMPONENT_TYPE_SOURCE}-\\d{3}`;

function exactPattern(source) {
  return new RegExp(`^${source}$`);
}

function searchPattern(source, flags = 'g') {
  return new RegExp(`(?<![A-Z0-9-])(?:${source})(?!-[A-Z0-9])`, flags);
}

function extractIds(content, source) {
  return String(content).match(searchPattern(source)) || [];
}

function markdownCells(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) return [];
  return trimmed.slice(1, -1).split('|').map((cell) => cell.trim());
}

module.exports = {
  MODULE_ID_SOURCE,
  STORY_ID_SOURCE,
  FEATURE_ID_SOURCE,
  STORY_OR_FEATURE_ID_SOURCE,
  AC_ID_SOURCE,
  TASK_ID_SOURCE,
  TEST_CASE_ID_SOURCE,
  BUG_ID_SOURCE,
  COMPONENT_ID_SOURCE,
  exactPattern,
  searchPattern,
  extractIds,
  markdownCells,
};
