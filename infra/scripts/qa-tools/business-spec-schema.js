'use strict';

// 业务测试规格的表格结构与字段格式：原子 AC 表与 PATHS.md 各表的表头、ID 形状和取值枚举。

const {
  AC_ID_SOURCE,
  ADV_ID_SOURCE,
  BUG_ID_SOURCE,
  INV_ID_SOURCE,
  MODULE_ID_SOURCE,
  RUL_ID_SOURCE,
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

// 测试设计（docs/qa-modules/<domain>/TEST-DESIGN.md）与 PRD 不变量表。
const DESIGN_FILE_NAME = 'TEST-DESIGN.md';
const RULE_TYPES = Object.freeze(['rule', 'invariant', 'forbidden', 'pre', 'post', 'undefined']);
const RULE_VERIFICATIONS = Object.freeze(['example', 'property', 'state-machine', 'fault', 'manual']);
const DIMENSIONS = Object.freeze(['auth', 'state', 'boundary', 'concurrency', 'dependency', 'time', 'input']);
const BUG_ORIGINS = Object.freeze(['qa-design', 'qa-redteam', 'qa-audit', 'user', 'prod']);
const CHANGE_KINDS = Object.freeze(['新增', '修改', '删除']);
const INV_TYPES = Object.freeze(['invariant', 'forbidden', 'pre', 'post']);

const INV_ID = exactPattern(INV_ID_SOURCE);
const RUL_ID = exactPattern(RUL_ID_SOURCE);
const ADV_ID = exactPattern(ADV_ID_SOURCE);
const BUG_ID = exactPattern(BUG_ID_SOURCE);

const DESIGN_TABLES = Object.freeze([
  { name: 'rules', label: '规则表', header: ['ID', '类型', '陈述', '出处', '优先级', '验证方式', 'TC'], idPattern: RUL_ID },
  { name: 'advs', label: '反例目录', header: ['ID', '规则', '维度', '场景', '预期', 'TC'], idPattern: ADV_ID },
  { name: 'bugs', label: '缺陷复现', header: ['ID', '现象', '关联规则', '来源', 'TC', '修复提交'], idPattern: BUG_ID },
  { name: 'changes', label: '变更记录', header: ['日期', '行 ID', '变更', '原因与新出处', '评审人'], idPattern: null },
]);

const INV_TABLE = Object.freeze({ name: 'invs', label: '不变量与禁止行为', header: ['INV ID', '类型', '陈述', '适用 Story', '优先级'] });

module.exports = {
  AC_ID,
  AC_TABLE,
  AC_TABLE_HEADER,
  ADV_ID,
  BUG_ID,
  BUG_ORIGINS,
  CHANGE_KINDS,
  CRITERIA,
  DESIGN_FILE_NAME,
  DESIGN_TABLES,
  DIMENSIONS,
  INV_ID,
  INV_TABLE,
  INV_TYPES,
  PATHS_FILE_NAME,
  PATHS_TABLES,
  PLATFORM_TAG,
  PRD_MODULES_DIR,
  PRIORITIES,
  QA_MODULES_DIR,
  RULE_TYPES,
  RULE_VERIFICATIONS,
  RUL_ID,
  STORY_ID,
  TEST_CASE_ID,
  VERIFICATIONS,
};
