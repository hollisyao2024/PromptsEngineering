/* Template-owned script paths renamed between releases. Shared by template sync and merge-package-scripts. */

// Only standalone occurrences are rewritten: the prefix must be start/whitespace/quote (optionally ./) and the
// suffix end/whitespace/quote, so vendor/ copies and .bak files are left untouched.
const RENAMED_SCRIPT_PATHS = Object.freeze([
  Object.freeze(['infra/scripts/devops-tools/devops-run.js', 'infra/scripts/ops-tools/ops-run.js']),
]);

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function rewriteRenamedPaths(command) {
  if (typeof command !== 'string') return { command, count: 0 };
  let count = 0;
  let next = command;
  for (const [legacy, current] of RENAMED_SCRIPT_PATHS) {
    const pattern = new RegExp(`(^|[\\s"'])(\\./)?${escapeRegExp(legacy)}(?=$|[\\s"'])`, 'g');
    next = next.replace(pattern, (match, lead, dot) => {
      count += 1;
      return `${lead}${dot || ''}${current}`;
    });
  }
  return { command: next, count };
}

// Returns a package.json value whose scripts use current paths; key order and all other fields are preserved.
function rewritePackageScripts(pkg) {
  if (!pkg || typeof pkg !== 'object' || Array.isArray(pkg) || !pkg.scripts || typeof pkg.scripts !== 'object') return pkg;
  let changed = false;
  const scripts = {};
  for (const [name, command] of Object.entries(pkg.scripts)) {
    const rewrite = rewriteRenamedPaths(command);
    if (rewrite.count) changed = true;
    scripts[name] = rewrite.command;
  }
  return changed ? { ...pkg, scripts } : pkg;
}

module.exports = { RENAMED_SCRIPT_PATHS, rewriteRenamedPaths, rewritePackageScripts };
