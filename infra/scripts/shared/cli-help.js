'use strict';

// Only flags before `--` belong to this CLI; anything after it is passed through to downstream runners.
function isHelpRequest(argv) {
  const separator = argv.indexOf('--');
  const own = separator === -1 ? argv : argv.slice(0, separator);
  return own.includes('--help') || own.includes('-h');
}

// Side-effecting entries must answer help before resolving repos, fetching, or mutating state.
function exitOnHelp(usage, argv = process.argv.slice(2)) {
  if (!isHelpRequest(argv)) return;
  console.log(usage);
  process.exit(0);
}

module.exports = { exitOnHelp, isHelpRequest };
