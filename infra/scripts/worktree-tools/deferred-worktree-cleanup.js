#!/usr/bin/env node
'use strict'

const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { loadConfig, resolveContainerPath } = require('../shared/config')
const { removeWorktreeSafely, removeSession, safeRemoveTreeNoFollow } = require('./worktree-core')

const [mainRoot, branch, worktreePath, delayRaw = '1500'] = process.argv.slice(2)
if (!mainRoot || !branch || !worktreePath) throw new Error('main repository path, branch and worktree path are required')
const delay = Math.max(250, Number(delayRaw) || 1500)

const retryDelays = [1000, 2000, 4000, 8000, 16000]

function finish(config) {
  removeSession(config, mainRoot, branch)
  spawnSync('git', ['worktree', 'prune', '--expire', 'now'], { cwd: mainRoot, stdio: 'ignore' })
  spawnSync('git', ['branch', '-D', branch], { cwd: mainRoot, stdio: 'ignore' })
}

function attempt(attemptNumber = 0) {
  const config = loadConfig({ repoRoot: mainRoot })
  const worktreesRoot = resolveContainerPath(config, mainRoot, 'worktrees')
  try {
    if (attemptNumber === 0) {
      removeWorktreeSafely({ mainRoot, worktreePath, worktreesRoot, force: true })
    } else {
      // The first pass may have removed every child but hit Windows EBUSY on
      // the final directory. This worker owns this exact post-merge path.
      safeRemoveTreeNoFollow(worktreePath, { allowedRoot: worktreesRoot })
    }
    finish(config)
  } catch (error) {
    if (attemptNumber >= retryDelays.length) {
      console.error(`[deferred-worktree-cleanup] giving up: ${error.message}`)
      process.exitCode = 1
      return
    }
    setTimeout(() => attempt(attemptNumber + 1), retryDelays[attemptNumber])
  }
}

setTimeout(() => attempt(), delay)
