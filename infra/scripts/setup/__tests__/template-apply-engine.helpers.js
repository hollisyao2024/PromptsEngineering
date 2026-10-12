'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

function mkTmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `merge-json-${prefix}-`));
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

module.exports = {
  mkTmpDir,
  writeJson,
};
