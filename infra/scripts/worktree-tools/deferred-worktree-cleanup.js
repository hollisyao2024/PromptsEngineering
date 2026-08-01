#!/usr/bin/env node
'use strict'

const { loadConfig } = require('../shared/config')
const { reconcilePendingCleanups } = require('./deferred-cleanup-state')

const [mainRoot, branch, worktreePath, delayRaw = '1500', mode = 'observe'] = process.argv.slice(2)
if (!mainRoot || !branch || !worktreePath) throw new Error('main repository path, branch and worktree path are required')
const delay = Math.max(250, Number(delayRaw) || 1500)

function attempt() {
  const config = loadConfig({ repoRoot: mainRoot })
  try {
    const result = reconcilePendingCleanups({
      mainRoot,
      config,
      branch,
      observeOnly: mode !== 'finalize',
    })
    if (result.errors.length > 0 && result.recoveryRequired.length === 0) process.exitCode = 1
  } catch (error) {
    console.error(`[deferred-worktree-cleanup] ${error.message}`)
    process.exitCode = 1
  }
}

setTimeout(attempt, delay)
