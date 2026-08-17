const assert = require('node:assert/strict')
const { mkdirSync, mkdtempSync, rmSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, relative } = require('node:path')
const test = require('node:test')

const {
  collectTaskFiles,
  formatCompletionText,
  markTasksInFile,
  processChecklistLine,
  processTableLine,
} = require('../tdd-tick.js')

test('completion date uses the project calendar instead of UTC', () => {
  assert.equal(
    formatCompletionText(new Date('2026-08-16T20:41:00.000Z'), 'Asia/Shanghai'),
    '✅ 已完成 (2026-08-17)',
  )
})

test('session routing finds a TASK ID even when its prefix differs from the module directory', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'xiaolan-tdd-tick-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const docsDir = join(root, 'docs')
  const modulesDir = join(docsDir, 'task-modules')
  const postgresDir = join(modulesDir, 'postgresql-migration')
  const unrelatedDir = join(modulesDir, 'commerce-content')
  mkdirSync(postgresDir, { recursive: true })
  mkdirSync(unrelatedDir, { recursive: true })
  writeFileSync(join(docsDir, 'TASK.md'), '# TASK\n')
  writeFileSync(join(modulesDir, 'module-list.md'), '# modules\n')
  writeFileSync(join(postgresDir, 'TASK.md'), '| TASK-PGMIG-001 | baseline | 📝 |\n')
  writeFileSync(
    join(unrelatedDir, 'TASK.md'),
    '| TASK-CCONT-001 | content | TASK-PGMIG-001 | 📝 |\n- [ ] TASK-OTHER-001 depends TASK-PGMIG-001\n',
  )

  const files = collectTaskFiles('session', ['TASK-PGMIG-001'], {
    mainTaskFile: join(docsDir, 'TASK.md'),
    taskModulesDir: modulesDir,
    moduleListFile: join(modulesDir, 'module-list.md'),
  }).map((file) => relative(root, file).replace(/\\/g, '/'))

  assert.deepEqual(files.sort(), [
    'docs/TASK.md',
    'docs/task-modules/module-list.md',
    'docs/task-modules/postgresql-migration/TASK.md',
  ])
})

test('table updates only the primary Task ID and ignores dependency references', () => {
  const targetIds = new Set(['TASK-PGMIG-001'])
  const completionText = '✅ 已完成 (2026-08-17)'
  const primary = processTableLine(
    '| TASK-PGMIG-001 | baseline | @qa | 3d | P0 | ARCH/ADR-115 | 📝 |',
    targetIds,
    completionText,
  )
  const dependent = processTableLine(
    '| TASK-PGMIG-002 | image | @sre | 5d | P0 | TASK-PGMIG-001 | ⏳ BLOCKED |',
    targetIds,
    completionText,
  )

  assert.equal(primary.changed, true)
  assert.match(primary.line, /TASK-PGMIG-001.*✅ 已完成/)
  assert.equal(dependent, null)
})

test('checklist updates only its primary Task ID and ignores dependency references', () => {
  const targetIds = new Set(['TASK-PGMIG-001'])
  const primary = processChecklistLine('- [ ] TASK-PGMIG-001 baseline', targetIds)
  const dependent = processChecklistLine('- [ ] TASK-OTHER-001 depends TASK-PGMIG-001', targetIds)

  assert.equal(primary.changed, true)
  assert.match(primary.line, /- \[x\] TASK-PGMIG-001/)
  assert.equal(dependent, null)
})

test('does not treat a longer task ID as the requested owner', () => {
  const targetIds = new Set(['TASK-PGMIG-001'])

  assert.equal(processChecklistLine('- [ ] TASK-PGMIG-0010 longer', targetIds), null)
  assert.equal(
    processTableLine('| TASK-PGMIG-0010 | longer | 📝 |', targetIds, '✅ 已完成 (2026-08-17)'),
    null,
  )
})

test('table mutation is limited to a declared status column', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'xiaolan-tdd-tick-status-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const taskFile = join(root, 'TASK.md')
  writeFileSync(taskFile, [
    '| Task ID | Deliverable | Status |',
    '|---|---|---|',
    '| TASK-PGMIG-005 | RLS isolation | 📝 |',
    '',
    '| Task | Dependency | Type | Gate |',
    '|---|---|---|---|',
    '| TASK-PGMIG-005 | ADR-115 | contract | app role NOBYPASSRLS + FORCE RLS |',
    '',
  ].join('\n'))

  const result = markTasksInFile(
    taskFile,
    new Set(['TASK-PGMIG-005']),
    '✅ 已完成 (2026-08-17)',
  )

  assert.match(result.content, /TASK-PGMIG-005 \| RLS isolation \| ✅ 已完成/)
  assert.match(result.content, /TASK-PGMIG-005 \| ADR-115 \| contract \| app role NOBYPASSRLS \+ FORCE RLS/)
})
