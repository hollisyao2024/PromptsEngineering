'use strict';

// 业务测试规格的表格结构与字段格式：原子 AC 表与 PATHS.md 各表的表头、ID 形状和取值枚举。

const {
  AC_ID_SOURCE,
  MODULE_ID_SOURCE,
  STORY_ID_SOURCE,
  TEST_CASE_ID_SOURCE,
  exactPattern,
} = require('../shared/governance-ids');

const PRD_MODULES_DIR = 'docs/prd-modules';
const QA_MODULES_DIR = 'docs/qa-modules';
const PATHS_FILE_NAME = 'PATHS.md';

const AC_TABLE_HEADER = Object.freeze(['AC ID', 'Story', '优先级', '验证', '端', 'Given', 'When', 'Then', 'TC']);
const PRIORITIES = Object.freeze(['P0', 'P1', 'P2', 'P3']);
const VERIFICATIONS = Object.freeze(['auto', 'manual']);
const CRITERIA = Object.freeze(['all-transitions', 'all-states', 'none']);

const AC_ID = exactPattern(AC_ID_SOURCE);
const STORY_ID = exactPattern(STORY_ID_SOURCE);
const TEST_CASE_ID = exactPattern(TEST_CASE_ID_SOURCE);
const PLATFORM_TAG = /^[a-z][a-z0-9-]*$/u;

const PATHS_TABLES = Object.freeze([
  { name: 'screens', label: '界面', header: ['ID', '名称', '端', '说明'], idPattern: exactPattern(`SCR-${MODULE_ID_SOURCE}-\\d{3}`) },
  { name: 'states', label: '状态', header: ['ID', '界面', '名称', '说明'], idPattern: exactPattern(`STA-${MODULE_ID_SOURCE}-\\d{3}`) },
  {
    name: 'transitions',
    label: '转移',
    header: ['ID', '起始状态', '操作', '守卫', '目标状态', '关联 AC'],
    idPattern: exactPattern(`TRN-${MODULE_ID_SOURCE}-\\d{3}`),
  },
  { name: 'paths', label: '路径', header: ['ID', '转移序列', '关联 TC', '说明'], idPattern: exactPattern(`PTH-${MODULE_ID_SOURCE}-\\d{3}`) },
]);

const AC_TABLE = Object.freeze({ name: 'acs', label: '原子 AC', header: AC_TABLE_HEADER });

module.exports = {
  AC_ID,
  AC_TABLE,
  AC_TABLE_HEADER,
  CRITERIA,
  PATHS_FILE_NAME,
  PATHS_TABLES,
  PLATFORM_TAG,
  PRD_MODULES_DIR,
  PRIORITIES,
  QA_MODULES_DIR,
  STORY_ID,
  TEST_CASE_ID,
  VERIFICATIONS,
};
