#!/usr/bin/env node
/**
 * Schema → ERD/Dictionary 联动校验（TDD 专家文档回写 Gate Step 1.7）
 *
 * 触发：本次 commit/branch 改动了 schema.prisma 或 migrations/*.sql
 * 校验：必须同时改动 docs/data/ERD.md 与 docs/data/dictionary.md
 * 失败：返回 exit 非零，输出缺失文件清单
 * 绕过：--skip-schema-doc-sync=<原因> 显式声明（reason 必填，会回显到 stderr）
 *
 * 启发式：仅含纯注释（///）/ @@map **新增** / 空白调整的 schema diff 可视为不需要文档同步
 * （`@@map` 值变更等于改 DB 表名，**不视为 trivial**）
 */

const { spawnSync } = require('child_process');

const SCHEMA_PATTERNS = [/schema\.prisma$/, /\/migrations\/.+\.sql$/];
const REQUIRED_DOCS = ['docs/data/ERD.md', 'docs/data/dictionary.md'];
const VALID_BASE_REF = /^[A-Za-z0-9_./@~^-]+$/; // 防御 CLI 参数 shell 注入

function parseFlags(argv) {
  const flags = { skip: false, skipReason: '', base: 'origin/main', quiet: false };
  for (const arg of argv) {
    if (arg === '--skip-schema-doc-sync') {
      flags.skip = true;
    } else if (arg.startsWith('--skip-schema-doc-sync=')) {
      flags.skip = true;
      flags.skipReason = arg.slice('--skip-schema-doc-sync='.length).trim();
    } else if (arg.startsWith('--base=')) {
      flags.base = arg.slice('--base='.length);
    } else if (arg === '--quiet') {
      flags.quiet = true;
    }
  }
  // base ref 安全校验（避免 shell 注入）
  if (!VALID_BASE_REF.test(flags.base)) {
    throw new Error(
      `非法 --base 值（仅允许字母/数字/./_/-/@/~/^/）: ${JSON.stringify(flags.base)}`
    );
  }
  return flags;
}

function gitDiffNameOnly(base) {
  const workingTreeFiles = getWorkingTreeFiles();

  // 优先：base...HEAD（feature 分支与 base 的对比）
  const tryRange = spawnSync('git', ['diff', '--name-only', `${base}...HEAD`], {
    encoding: 'utf8',
  });
  if (tryRange.status === 0) {
    return {
      files: parseFileList([tryRange.stdout, workingTreeFiles.join('\n')].join('\n')),
      mode: workingTreeFiles.length ? 'range+working' : 'range',
    };
  }

  // Fallback 1：HEAD~1..HEAD（仅最近一个 commit；当 base ref 不存在时使用）
  const tryHead = spawnSync('git', ['diff', '--name-only', 'HEAD~1', 'HEAD'], {
    encoding: 'utf8',
  });
  if (tryHead.status === 0) {
    return {
      files: parseFileList([tryHead.stdout, workingTreeFiles.join('\n')].join('\n')),
      mode: workingTreeFiles.length ? 'head1+working' : 'head1',
    };
  }

  // Fallback 2：staged + working tree（仅在 commit 之前的 sync 阶段有意义）
  return {
    files: workingTreeFiles,
    mode: 'working',
  };
}

function getWorkingTreeFiles() {
  const staged = spawnSync('git', ['diff', '--cached', '--name-only'], { encoding: 'utf8' });
  const work = spawnSync('git', ['diff', '--name-only'], { encoding: 'utf8' });
  const status = spawnSync('git', ['status', '--porcelain', '--untracked-files=all'], {
    encoding: 'utf8',
  });
  return parseFileList([
    staged.stdout || '',
    work.stdout || '',
    parseStatusFileList(status.stdout || '').join('\n'),
  ].join('\n'));
}

function parseStatusFileList(text) {
  return String(text || '')
    .split('\n')
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .flatMap((line) => {
      const file = line.slice(3).trim();
      if (!file) return [];
      if (file.includes(' -> ')) return file.split(' -> ').map((item) => item.trim());
      return [file];
    });
}

function parseFileList(text) {
  return Array.from(
    new Set(
      String(text || '')
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean)
    )
  );
}

function isSchemaFile(file) {
  return SCHEMA_PATTERNS.some((re) => re.test(file));
}

/**
 * 启发式：判断 schema.prisma 的 diff 是否仅含注释 / @@map 新增 / 空白
 * - 命中 → 视为非实质变更，不要求文档同步
 * - 注意：`@@map` 值变更（改表名）属于实质变更，不视为 trivial
 */
function isTrivialSchemaDiff(file, base) {
  if (!VALID_BASE_REF.test(base)) {
    throw new Error(`非法 base ref: ${JSON.stringify(base)}`);
  }
  const result = spawnSync('git', ['diff', `${base}...HEAD`, '--', file], { encoding: 'utf8' });
  if (result.status !== 0) {
    // base 不可达时不能确认 trivial，保守返回 false
    const headFallback = spawnSync('git', ['diff', 'HEAD~1', 'HEAD', '--', file], {
      encoding: 'utf8',
    });
    if (headFallback.status !== 0) return false;
    const workingDiff = getWorkingTreeDiff(file);
    const diffText = [headFallback.stdout || '', workingDiff].join('\n');
    return diffText.trim() ? analyzeDiffTrivial(diffText) : false;
  }
  const workingDiff = getWorkingTreeDiff(file);
  const diffText = [result.stdout || '', workingDiff].join('\n');
  return diffText.trim() ? analyzeDiffTrivial(diffText) : false;
}

function getWorkingTreeDiff(file) {
  const staged = spawnSync('git', ['diff', '--cached', '--', file], { encoding: 'utf8' });
  const work = spawnSync('git', ['diff', '--', file], { encoding: 'utf8' });
  return [staged.stdout || '', work.stdout || ''].join('\n');
}

function analyzeDiffTrivial(diff) {
  const lines = String(diff || '').split('\n');
  // 收集所有 + 和 - 行（去掉 +++/--- 文件头），按内容做配对分析
  const added = [];
  const removed = [];
  for (const line of lines) {
    if (line.startsWith('+++') || line.startsWith('---')) continue;
    if (line.startsWith('+')) added.push(line.slice(1));
    else if (line.startsWith('-')) removed.push(line.slice(1));
  }
  // 任何 - 包含非 trivial 内容（如 `@@map(...)` 删除/改值）→ 视为实质变更
  // 注意：`@@map` 值变更在 diff 中表现为「- @@map("old") 与 + @@map("new")」配对
  const hasNonTrivialAddition = added.some((l) => !isTrivialLine(l, /* isAddition */ true));
  const hasNonTrivialRemoval = removed.some((l) => !isTrivialLine(l, /* isAddition */ false));
  return !hasNonTrivialAddition && !hasNonTrivialRemoval;
}

function isTrivialLine(line, isAddition) {
  const content = line.trim();
  if (!content) return true;
  if (content.startsWith('//')) return true; // 普通注释
  if (content.startsWith('///')) return true; // doc 注释
  // @@map 仅在 **新增**（addition）时视为 trivial；删除或修改值都不是 trivial
  if (isAddition && /^@@map\(".+"\)$/.test(content)) return true;
  return false;
}

function main() {
  let flags;
  try {
    flags = parseFlags(process.argv.slice(2));
  } catch (e) {
    console.error(`❌ Schema-Doc Sync Gate: ${e.message}`);
    process.exit(2);
  }
  const log = flags.quiet ? () => {} : console.log;

  if (flags.skip) {
    if (!flags.skipReason) {
      console.error('❌ --skip-schema-doc-sync 必须提供原因');
      console.error('   用法: --skip-schema-doc-sync=<具体原因>');
      console.error('   例如: --skip-schema-doc-sync="仅调整 prisma format，无字段变更"');
      process.exit(2);
    }
    // 输出到 stderr 让 PR 评审者从 CI 日志中容易看到
    console.error(`⏭  Schema-Doc Sync Gate: 已绕过`);
    console.error(`  原因: ${flags.skipReason}`);
    console.error(`  ⚠️  请确保 PR 描述中也记录此原因供评审`);
    process.exit(0);
  }

  let diff;
  try {
    diff = gitDiffNameOnly(flags.base);
  } catch (e) {
    console.error(`❌ Schema-Doc Sync Gate: 获取 git diff 失败: ${e.message}`);
    process.exit(2);
  }

  // working-tree fallback 模式下文件列表可能为空（commit 后 working tree clean），
  // 输出 WARN 而非静默通过 — 否则会复现 PR #1017 的漏检情形
  if (diff.mode === 'working' && diff.files.length === 0) {
    console.error('⚠️  Schema-Doc Sync Gate: 无法解析 base ref 也无法用 HEAD~1，');
    console.error(`   请确认 origin/${flags.base.split('/').pop()} 已 fetch，或显式传 --base=<可达 ref>`);
    console.error('   保守处理：跳过本次检查并放行（请人工复核 schema/doc 同步）');
    process.exit(0);
  }

  if (diff.files.length === 0) {
    log(`ℹ️  Schema-Doc Sync Gate: 无变更文件，跳过（mode=${diff.mode}）`);
    process.exit(0);
  }

  const schemaFiles = diff.files.filter(isSchemaFile);
  if (schemaFiles.length === 0) {
    log(`ℹ️  Schema-Doc Sync Gate: 本次未改动 schema/migrations，跳过（mode=${diff.mode}）`);
    process.exit(0);
  }

  // 启发式：所有 schema 文件均为 trivial diff → 通过
  const baseForTrivial = diff.mode.startsWith('range') ? flags.base : 'HEAD~1';
  const nonTrivial = schemaFiles.filter((f) => {
    if (/\/migrations\/.+\.sql$/.test(f)) return true; // SQL 迁移一律视为实质变更
    return !isTrivialSchemaDiff(f, baseForTrivial);
  });

  if (nonTrivial.length === 0) {
    log('✅ Schema-Doc Sync Gate: 改动仅含注释 / @@map 新增 / 空白，跳过 Doc Sync 检查');
    process.exit(0);
  }

  const missingDocs = REQUIRED_DOCS.filter((doc) => !diff.files.includes(doc));

  if (missingDocs.length === 0) {
    log(`✅ Schema-Doc Sync Gate 通过：ERD.md + dictionary.md 已同步（mode=${diff.mode}）`);
    process.exit(0);
  }

  console.error('');
  console.error('❌ Schema-Doc Sync Gate 失败');
  console.error('');
  console.error('检测到 schema 实质变更但数据字典文档未同步：');
  console.error('');
  console.error('  改动的 schema 文件：');
  nonTrivial.forEach((f) => console.error(`    • ${f}`));
  console.error('');
  console.error('  缺失同步的文档：');
  missingDocs.forEach((f) => console.error(`    • ${f}`));
  console.error('');
  console.error('修复方式：');
  console.error('  1. 编辑上述缺失的文档以反映 schema 变更');
  console.error('     - ERD.md：实体定义 / 关系表 / 业务规则');
  console.error('     - dictionary.md：字段表 / 索引 / 约束');
  console.error('     详见 AgentRoles/TDD-PROGRAMMING-EXPERT.md §B.10');
  console.error('  2. 或显式绕过（仅极少数场景，必填原因）：');
  console.error('     pnpm run tdd:sync -- --skip-schema-doc-sync=<具体原因>');
  console.error('     原因会输出到 stderr，须在 PR 描述中同步记录');
  console.error('');
  process.exit(1);
}

if (require.main === module) {
  main();
}

module.exports = {
  isSchemaFile,
  isTrivialSchemaDiff,
  analyzeDiffTrivial,
  isTrivialLine,
  parseStatusFileList,
  REQUIRED_DOCS,
  SCHEMA_PATTERNS,
  VALID_BASE_REF,
};
