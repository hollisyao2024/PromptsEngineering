'use strict';

// business-results 系列测试共用的常量与夹具：shop 规格、临时规格、临时目录与用例构造。
// 不含任何测试，由 business-results*.test.js 共享。

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { loadBusinessSpec } = require('../business-spec');
const { createProject, shopProject } = require('./fixtures/business-testing/builders');

const HEAD = 'a'.repeat(40);
const DIGEST = `sha256:${'b'.repeat(64)}`;
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

function withShop(fn) {
  const project = shopProject();
  try {
    return fn({ project, spec: loadBusinessSpec({ repoRoot: project.repo }) });
  } finally {
    project.cleanup();
  }
}

function withSpec(files, fn) {
  const project = createProject(files);
  try {
    return fn({ project, spec: loadBusinessSpec({ repoRoot: project.repo }) });
  } finally {
    project.cleanup();
  }
}

function withTempDir(fn) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'xirang-results-'));
  try {
    return fn(directory);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

const parsed = (cases) => ({ cases });
const web = (cases, name = 'web-e2e') => ({ name, platform: 'web', ...parsed(cases) });
const kase = (name, status = 'passed', classname = '') => ({ name, classname, status });

module.exports = { DIGEST, HEAD, kase, sha256, web, withShop, withSpec, withTempDir };
