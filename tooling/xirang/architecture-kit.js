const fs = require('node:fs');
const path = require('node:path');
const { readLock, read, hash, json, safePath } = require('./engine');
const { describeSource, POINTER } = require('./source-cache');

const METADATA = ['architecture/manifest.json', 'architecture/architecture.schema.json',
  'architecture/open-source-catalog.json', 'architecture/components/shadcn/component-sets.json'];
const LAUNCHER = `#!/usr/bin/env node
const path = require('node:path');
try {
  require('../../tooling/xirang/architecture-runtime').main(process.argv.slice(2), { runtimeRoot: path.resolve(__dirname, '../..') });
} catch (error) {
  console.error('STATUS=BLOCKED\\nREASON=' + error.message + '\\nNEXT_ACTION=Resolve the reported source or project condition; preserve active update journals');
  process.exitCode = 1;
}
`;
const README = `# 息壤轻量架构入口

此目录只保存架构目录、配置 schema、组件选型 metadata、固定来源指针和命令入口。完整生成器、模块模板、源码示例和测试留在息壤源或容器 cache，不进入业务仓库。业务代码由 architecture.config.json 选择，生成到 apps/、packages/ 和适用的 docs/standards/。

\`pnpm agent -- architecture catalog\` 查看选项。首次可用 \`architecture plan --blueprint admin-api --database sqlite\` 预演；确认选型后使用 init。已有项目先编辑 architecture.config.json，再执行 plan/update；普通 template sync 只更新工具及已采用选择。

\`node architecture/scripts/cli.js <action>\` 可独立运行。支持 catalog、detect、validate、plan、init、update、adopt、apply、resume、check、install-deps。init/update 默认安装所选依赖；--no-install 只生成，随后 install-deps/check。Git 项目修改使用专用 linked worktree。

runtime.json 固定官方来源、提交、版本与内容摘要。首次同步或初始化会准备容器缓存；缓存缺失时架构命令匿名获取同一提交，不自动切到 main。缓存损坏或来源不匹配会阻断；删除精确缓存目录后重建，或用 --source 指定内容匹配的本地源。未发布本地预览在缓存丢失后需要原本地源。

源码与完整指南：https://github.com/hollisyao2024/PromptsEngineering/tree/SOURCE_REF/architecture 。架构命令输出 ARCHITECTURE_SOURCE_ROOT，可在其 architecture/guides/ 和 architecture/standards/ 点读当前固定版本的指南。模板完整方案是可裁减目录，不强制安装全部组件。RULES.md、项目配置、业务代码和已有迁移仍由项目维护。
`;

function buildRuntimeAssets({ source, target, includeEngine = true }) {
  const described = describeSource(source), descriptor = described.descriptor;
  const assets = [], inputs = described.inputs;
  const add = (p, content, strategy = 'overwrite', owner = 'architecture:runtime', mode) => {
    assets.push({ path: p, content, strategy, owner, version: descriptor.version, ...(mode ? { mode } : {}) });
  };
  for (const file of METADATA) add(file, read(source, file));
  add('architecture/README.md', README.replace('SOURCE_REF', descriptor.commit || 'main'));
  add('architecture/scripts/cli.js', LAUNCHER);
  add(POINTER, json(descriptor));
  if (includeEngine) for (const file of described.files.filter(f => f.path.startsWith('tooling/xirang/'))) {
    add(file.path, fs.readFileSync(safePath(source, file.path), 'utf8'), 'overwrite', 'xirang:engine', file.mode);
  }
  const retained = new Set(assets.map(asset => asset.path));
  for (const [file, record] of Object.entries(readLock(target).files)) {
    if (record.owner === 'architecture:runtime' && file.startsWith('architecture/') && !retained.has(file)) add(file, null, 'remove');
  }
  const selection = { id: 'architecture', mode: 'on-demand' };
  return { assets, inputs, descriptor, packages: { 'architecture:runtime': {
    version: descriptor.version, source: { id: 'xirang', commit: descriptor.commit },
    selection, parametersHash: hash(json(selection)),
  } } };
}

module.exports = { buildRuntimeAssets, METADATA };
