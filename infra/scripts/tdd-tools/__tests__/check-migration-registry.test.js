'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  inspectMigrationRegistry,
  resolveMigrationRegistryConfig,
} = require('../check-migration-registry');

test('migration registry gate reports every migration omitted by the runtime registry', () => {
  const errors = inspectMigrationRegistry({
    migrationFiles: [
      'src/main/migrations/001_initial_schema.ts',
      'src/main/migrations/002_expand_local_workflows.ts',
      'src/main/migrations/003_add_account_note.ts',
    ],
    registryFile: 'src/main/migrations/index.ts',
    registryContent: `
      import './001_initial_schema';
      import './002_expand_local_workflows';
    `,
  });

  assert.deepEqual(errors, [
    'src/main/migrations/index.ts: migration registry is missing: src/main/migrations/003_add_account_note.ts',
  ]);
});

test('migration registry gate accepts a complete registry in filename order', () => {
  const errors = inspectMigrationRegistry({
    migrationFiles: [
      'src/main/migrations/001_initial_schema.ts',
      'src/main/migrations/002_expand_local_workflows.ts',
    ],
    registryFile: 'src/main/migrations/index.ts',
    registryContent: `
      import './001_initial_schema';
      import './002_expand_local_workflows';
    `,
  });

  assert.deepEqual(errors, []);
});

test('migration registry gate is opt-in for projects without an explicit registry', () => {
  const resolved = resolveMigrationRegistryConfig({
    paths: { migrationsDir: 'database/migrations' },
    tdd: {
      migrationRegistry: {
        registryFile: '',
        filePattern: '^\\d{3}_[a-z0-9_]+\\.ts$',
      },
    },
  });

  assert.equal(resolved, null);
});

test('migration registry gate rejects filename order drift and ignores commented registrations', () => {
  const orderedFiles = [
    'database/migrations/001_initial_schema.ts',
    'database/migrations/002_expand_workflows.ts',
  ];
  assert.deepEqual(inspectMigrationRegistry({
    migrationFiles: orderedFiles,
    registryFile: 'database/migrations/index.ts',
    registryContent: `
      import './002_expand_workflows';
      import './001_initial_schema';
    `,
  }), [
    'database/migrations/index.ts: migration registry must follow migration filename order',
  ]);
  assert.deepEqual(inspectMigrationRegistry({
    migrationFiles: orderedFiles,
    registryFile: 'database/migrations/index.ts',
    registryContent: `
      import './001_initial_schema';
      // import './002_expand_workflows';
    `,
  }), [
    'database/migrations/index.ts: migration registry is missing: database/migrations/002_expand_workflows.ts',
  ]);
});
