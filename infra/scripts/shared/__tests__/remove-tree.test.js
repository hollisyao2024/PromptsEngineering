import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { removeTreeWithRetries } = require('../remove-tree.js')

describe('removeTreeWithRetries', () => {
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
