#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {spawnSync} = require('node:child_process');

const SKILLS = ['xirang-setup','xirang-task','xirang-resume','xirang-deliver'];
// Explicit payload prevents repository state, credentials and unrelated files entering a release.
const PAYLOAD = ['plugin.json','.claude-plugin/plugin.json','README.md','references/workflow.md',
  'scripts/inspect-project.cjs','assets/icon.svg',...SKILLS.map(name => `skills/${name}/SKILL.md`)];

function collectFiles(source) {
  const root = fs.realpathSync(source);
  for (const relative of PAYLOAD) {
    let current = root;
    for (const part of relative.split('/')) {
      current = path.join(current, part);
      if (!fs.existsSync(current)) throw new Error('missing payload '+relative);
      if (fs.lstatSync(current).isSymbolicLink()) throw new Error('symbolic payload is not supported: '+relative);
    }
    if (!fs.statSync(current).isFile()) throw new Error('payload must be a file: '+relative);
  }
  const portable = JSON.parse(fs.readFileSync(path.join(root,'plugin.json'),'utf8'));
  const claude = JSON.parse(fs.readFileSync(path.join(root,'.claude-plugin/plugin.json'),'utf8'));
  if (portable.name !== 'xirang' || portable.name !== claude.name || portable.version !== claude.version) {
    throw new Error('plugin identity or version differs between manifests');
  }
  const openai = portable.extensions?.['com.openai'];
  for (const manifest of [portable,claude,openai || {}]) {
    for (const component of ['hooks','mcpServers','apps','commands','agents','lspServers']) {
      if (Object.hasOwn(manifest,component)) throw new Error('unsupported component in skills-only package: '+component);
    }
  }
  if (claude.skills !== './skills/' || openai?.requires_local_executor !== true) throw new Error('invalid local skills-only package metadata');
  const resource = value => {
    if (typeof value !== 'string' || !value.startsWith('./') || value.split('/').includes('..') || !PAYLOAD.includes(value.slice(2))) {
      throw new Error('resource must belong to the fixed package payload: '+String(value));
    }
  };
  for (const reference of [openai.onboardingSkill,openai.interface?.logo,openai.interface?.composerIcon]) resource(reference);
  for (const name of SKILLS) {
    const filename = `skills/${name}/SKILL.md`;
    const text = fs.readFileSync(path.join(root,filename),'utf8');
    for (const [,target] of text.matchAll(/\]\(([^)]+)\)/gu)) {
      if (/^https?:/u.test(target)) continue;
      const relative = path.posix.normalize(path.posix.join(path.posix.dirname(filename),target.split('#')[0]));
      if (!PAYLOAD.includes(relative)) throw new Error('skill resource is outside the fixed package payload: '+target);
    }
  }
  return [...PAYLOAD].sort();
}

function packagePlugin({source = path.join(__dirname,'xirang'), output, zipCommand = 'zip'} = {}) {
  if (!output || !path.isAbsolute(output) || path.extname(output) !== '.zip') throw new Error('output must be an absolute .zip path');
  const root = fs.realpathSync(source);
  const parent = fs.realpathSync(path.dirname(output));
  const destination = path.join(parent,path.basename(output));
  const relative = path.relative(root,destination);
  if (!relative.startsWith('..'+path.sep) && !path.isAbsolute(relative)) throw new Error('output must stay outside the plugin');
  if (fs.existsSync(destination)) throw new Error('output already exists');
  const files = collectFiles(root);
  const temporary = fs.mkdtempSync(path.join(parent,'.xirang-pack-'));
  try {
    const archive = path.join(temporary,'payload.zip');
    const zipped = spawnSync(zipCommand,['-X','-q',archive,...files],{cwd:root,encoding:'utf8',timeout:30000,maxBuffer:1024*1024});
    if (zipped.error || zipped.status !== 0) throw new Error('zip failed: '+(zipped.error?.message || zipped.stderr.trim()));
    // COPYFILE_EXCL also protects against a destination created after the initial check.
    fs.copyFileSync(archive,destination,fs.constants.COPYFILE_EXCL);
    return {status:'OK',output:destination,files,sha256:crypto.createHash('sha256').update(fs.readFileSync(destination)).digest('hex')};
  } finally {
    // Only remove the exact temporary directory created by this call.
    fs.rmSync(temporary,{recursive:true,force:true});
  }
}

if (require.main === module) {
  try {
    const args = process.argv.slice(2);
    if (args.length !== 2 || args[0] !== '--output') throw new Error('Usage: node plugins/pack.cjs --output <absolute-new.zip> (requires zip)');
    console.log(JSON.stringify(packagePlugin({output:args[1]}),null,2));
  } catch (error) { console.error('STATUS=FAILED\nREASON='+error.message); process.exitCode=1; }
}
module.exports = {collectFiles,packagePlugin};
