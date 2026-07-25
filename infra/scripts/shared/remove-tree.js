#!/usr/bin/env node
'use strict'

const { spawnSync } = require('node:child_process')
const { existsSync, lstatSync, rmSync } = require('node:fs')

const TRANSIENT_REMOVE_ERRORS = new Set(['EBUSY', 'EMFILE', 'ENFILE', 'ENOTEMPTY', 'EPERM'])
const REMOVE_OPTIONS = {
  recursive: true,
  force: true,
  maxRetries: 10,
  retryDelay: 200,
}

function sleepSync(milliseconds) {
  if (milliseconds <= 0) return
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds)
}

function pathExists(target) {
  if (existsSync(target)) return true
  try {
    lstatSync(target)
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

function clearMacOSAttributes(target, platform = process.platform) {
  if (platform !== 'darwin') return
  spawnSync('xattr', ['-cr', target], { stdio: 'ignore' })
}

function removeTreeWithRetries(target, options = {}) {
  if (!target || typeof target !== 'string') throw new TypeError('remove-tree target is required')
  const exists = options.exists || pathExists
  if (!exists(target)) return

  const remove = options.remove || rmSync
  const sleep = options.sleep || sleepSync
  const clearAttributes = options.clearAttributes || ((value) => clearMacOSAttributes(value, options.platform))
  const maxAttempts = options.maxAttempts || 5
  const retryDelay = options.retryDelay || 250

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    clearAttributes(target)
    try {
      remove(target, REMOVE_OPTIONS)
      return
    } catch (error) {
      if (!TRANSIENT_REMOVE_ERRORS.has(error?.code) || attempt === maxAttempts) throw error
      options.onRetry?.({ attempt, error, target })
      sleep(retryDelay * attempt)
    }
  }
}

function parseCli(argv) {
  let target = ''
  let platform = process.platform
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === '--platform' && argv[index + 1]) {
      platform = argv[index + 1]
      index += 1
    } else if (!target) {
      target = value
    } else {
      throw new Error(`unexpected argument: ${value}`)
    }
  }
  if (!target) throw new Error('remove-tree target is required')
  return { platform, target }
}

function main(argv = process.argv.slice(2)) {
  try {
    const { platform, target } = parseCli(argv)
    removeTreeWithRetries(target, {
      platform,
      onRetry: ({ attempt, error }) => {
        console.warn(`[remove-tree] retry ${attempt}: ${error.code} ${target}`)
      },
    })
  } catch (error) {
    console.error(`[remove-tree] ${error.message}`)
    process.exitCode = 1
  }
}

if (require.main === module) main()

module.exports = {
  TRANSIENT_REMOVE_ERRORS,
  clearMacOSAttributes,
  parseCli,
  pathExists,
  removeTreeWithRetries,
  sleepSync,
}
