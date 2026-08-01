import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { removeTree, removeTreeWithRetries } = require('../remove-tree.js')

describe('removeTreeWithRetries', () => {
  it('uses native rmdir for large Windows trees instead of Node recursive deletion', () => {
    const calls = []
    removeTree('C:\\runtime\\node_modules\\.pnpm', {
      platform: 'win32',
      exists: () => true,
      spawn: (...args) => {
        calls.push(args)
        return { status: 0 }
      },
    })

    expect(calls).toHaveLength(1)
    expect(calls[0][0]).toBe('cmd.exe')
    expect(calls[0][1]).toEqual([
      '/d',
      '/c',
      'rmdir',
      '/s',
      '/q',
      '\\\\?\\C:\\runtime\\node_modules\\.pnpm',
    ])
    expect(calls[0][2]).toMatchObject({ stdio: 'ignore', windowsHide: true })
  })

  it('restarts a recursive removal after transient ENOTEMPTY failures', () => {
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

    expect(attempts).toHaveLength(3)
    expect(attempts.every((options) => options.recursive && options.force)).toBe(true)
  })

  it('retries transient Windows rmdir failures reported by the native remover', () => {
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

    expect(attempts).toBe(3)
  })

  it('returns immediately for a missing path', () => {
    let removed = false
    removeTreeWithRetries('/tmp/missing-tree', {
      exists: () => false,
      remove: () => { removed = true },
    })

    expect(removed).toBe(false)
  })

  it('does not hide non-transient filesystem errors', () => {
    expect(() => removeTreeWithRetries('/tmp/protected-tree', {
      exists: () => true,
      remove: () => {
        const error = new Error('read-only filesystem')
        error.code = 'EROFS'
        throw error
      },
      clearAttributes: () => {},
    })).toThrow('read-only filesystem')
  })
})
