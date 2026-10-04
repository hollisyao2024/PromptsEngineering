'use strict';

const os = require('node:os');

// spawnSync reports status=null when the child is terminated by a signal; treat that as failure.
function spawnExitCode(result) {
  if (typeof result.status === 'number') return result.status;
  const signalNumber = result.signal ? os.constants.signals[result.signal] : undefined;
  return signalNumber ? 128 + signalNumber : 1;
}

module.exports = { spawnExitCode };
