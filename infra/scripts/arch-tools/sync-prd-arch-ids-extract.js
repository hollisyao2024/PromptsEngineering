'use strict';

/**
 * sync-prd-arch-ids 的纯提取与文件收集工具：Story/Component ID 提取、模块文档收集与错误判定。
 * 由 sync-prd-arch-ids.js 重新导出，不依赖其模块级状态。
 */

const fs = require('fs');
const path = require('path');
const {
  COMPONENT_ID_SOURCE,
  STORY_OR_FEATURE_ID_SOURCE,
  searchPattern,
} = require('../shared/governance-ids');

function collectModuleArchFiles(dir) {
  if (!fs.existsSync(dir)) {
    return [];
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const archPath = path.join(dir, entry.name, 'ARCH.md');
    if (fs.existsSync(archPath)) {
      files.push(archPath);
    }
  }

  return files;
}

function collectModulePrdFiles(dir) {
  if (!fs.existsSync(dir)) {
    return [];
  }

  return fs.readdirSync(dir, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.md'))
    .map(entry => path.join(dir, entry.name))
    .sort();
}

/**
 * 提取 Story ID（格式：US-{MODULE}-{NNN}、FEAT-{MODULE}-{NNN}）
 */
function extractStoryIDs(content, filePath) {
  const matches = content.matchAll(searchPattern(STORY_OR_FEATURE_ID_SOURCE));
  const results = [];

  for (const match of matches) {
    const storyID = match[0];
    const line = content.substring(0, match.index).split('\n').length;
    results.push({ storyID, file: filePath, line });
  }

  return results;
}

/**
 * PRD canonical definitions only. Body references must not inflate both sides
 * of a traceability check.
 */
function extractStoryDefinitions(content, filePath) {
  const regex = new RegExp(
    `^#{2,6}\\s+(${STORY_OR_FEATURE_ID_SOURCE})(?=[:：\\s])`,
    'gm',
  );
  const results = [];
  for (const match of String(content).matchAll(regex)) {
    const line = content.substring(0, match.index).split('\n').length;
    results.push({ storyID: match[1], file: filePath, line });
  }
  return results;
}

/**
 * 提取 Component ID（格式：{MODULE}-{TYPE}-{NNN}）
 */
function extractComponentIDs(content, filePath) {
  const matches = content.matchAll(searchPattern(COMPONENT_ID_SOURCE));
  const results = [];

  for (const match of matches) {
    const componentID = match[0];
    const line = content.substring(0, match.index).split('\n').length;
    results.push({ componentID, file: filePath, line });
  }

  return results;
}

function traceabilityHasErrors(storyResults, componentResults, counts) {
  return counts.inArch === 0
    || counts.inPRD === 0
    || counts.inGraph === 0
    || counts.inModules === 0
    || storyResults.archReferencesNotInPRD.length > 0
    || storyResults.prdDefinitionsNotInArch.length > 0
    || componentResults.graphReferencesNotInModules.length > 0;
}

module.exports = {
  collectModuleArchFiles,
  collectModulePrdFiles,
  extractComponentIDs,
  extractStoryDefinitions,
  extractStoryIDs,
  traceabilityHasErrors,
};
