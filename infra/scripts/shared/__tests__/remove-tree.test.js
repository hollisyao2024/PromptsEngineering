const test = require('node:test')
const assert = require('node:assert/strict')
const { removeTree, removeTreeWithRetries } = require('../remove-tree.js')

test('uses native rmdir for large Windows trees instead of Node recursive deletion', () => {
  const calls = []
  removeTree('C:\\runtime\\node_modules\\.pnpm', {
    platform: 'win32',
    exists: () => true,
    spawn: (...args) => {
      calls.push(args)
      return { status: 0 }
    },
  })

  assert.equal(calls.length, 1)
  assert.equal(calls[0][0], 'cmd.exe')
  assert.deepEqual(calls[0][1], [
    '/d',
    '/c',
    'rmdir',
    '/s',
    '/q',
    '\\\\?\\C:\\runtime\\node_modules\\.pnpm',
  ])
  assert.deepEqual(calls[0][2], { stdio: 'ignore', windowsHide: true })
})

test('restarts a recursive removal after transient ENOTEMPTY failures', () => {
  const attempts = []
  removeTreeWithRetries('/tmp/large-pnpm-tree', {
    exists: () => true,
    remove: (_target, options) => {
      attempts.push(options)
      if (attempts.length < 3) {
        const error = new Error('not empty')
        error.code = 'ENOTEMPTY'
        throw error
      }
    },
    sleep: () => {},
    clearAttributes: () => {},
  })

  assert.equal(attempts.length, 3)
  assert.equal(attempts.every((options) => options.recursive && options.force), true)
})

test('retries transient Windows rmdir failures reported by the native remover', () => {
  let attempts = 0
  removeTreeWithRetries('C:\\runtime\\node_modules\\.pnpm', {
    platform: 'win32',
    exists: () => true,
    remove: () => {
      attempts += 1
      if (attempts < 3) {
        const error = new Error('Windows rmdir failed')
        error.code = 'EREMOVE'
        throw error
      }
    },
    sleep: () => {},
    clearAttributes: () => {},
  })

  assert.equal(attempts, 3)
})

test('returns immediately for a missing path', () => {
  let removed = false
  removeTreeWithRetries('/tmp/missing-tree', {
    exists: () => false,
    remove: () => { removed = true },
  })

  assert.equal(removed, false)
})

test('does not hide non-transient filesystem errors', () => {
  assert.throws(() => removeTreeWithRetries('/tmp/protected-tree', {
    exists: () => true,
    remove: () => {
      const error = new Error('read-only filesystem')
      error.code = 'EROFS'
      throw error
    },
    clearAttributes: () => {},
  }), /read-only filesystem/)
})
