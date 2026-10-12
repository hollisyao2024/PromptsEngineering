'use strict';

// business-spec 各主题测试共用的文件路径常量、违规码提取与临时项目包装。

const { createProject } = require('./fixtures/business-testing/builders');

const PRD_FILE = 'docs/prd-modules/shop/PRD.md';
const PATHS_FILE = 'docs/qa-modules/shop/PATHS.md';

const codes = (violations) => violations.map((violation) => violation.code);

function withProject(files, run) {
  const project = createProject(files);
  try {
    return run(project);
  } finally {
    project.cleanup();
  }
}

module.exports = {
  PATHS_FILE,
  PRD_FILE,
  codes,
  withProject,
};
