'use strict';

const START = '<!-- xirang:source-only:start -->';
const END = '<!-- xirang:source-only:end -->';

// Keep the source file intact for AI routing and frozen-input verification.
// Only the consumer asset loses these explicitly marked, whole-line blocks.
function stripSourceOnly(content, file) {
  let inside = false;
  const output = [];
  for (const line of content.split(/(?<=\n)/u)) {
    const marker = line.trim();
    if (marker === START) {
      if (inside) throw new Error(`Nested source-only block in ${file}`);
      inside = true;
    } else if (marker === END) {
      if (!inside) throw new Error(`Unexpected source-only end in ${file}`);
      inside = false;
    } else {
      if (line.includes('<!-- xirang:source-only:')) throw new Error(`Invalid source-only marker in ${file}`);
      if (!inside) output.push(line);
    }
  }
  if (inside) throw new Error(`Unclosed source-only block in ${file}`);
  return output.join('');
}

module.exports = { stripSourceOnly };
