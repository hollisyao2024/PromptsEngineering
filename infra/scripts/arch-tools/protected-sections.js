'use strict';

const MARKER_PATTERN = /<!--\s*([A-Z0-9][A-Z0-9_-]*)-PROTECTED-(START|END)\s*-->/g;

function extractProtectedBlocks(content) {
  const blocks = [];
  const seen = new Set();
  let open = null;
  let match;
  MARKER_PATTERN.lastIndex = 0;
  while ((match = MARKER_PATTERN.exec(String(content || ''))) !== null) {
    const [, token, kind] = match;
    if (kind === 'START') {
      if (open) throw new Error(`invalid protected section marker order: nested START ${token}`);
      if (seen.has(token)) throw new Error(`duplicate protected section token: ${token}`);
      open = { token, start: match.index };
      continue;
    }
    if (!open) throw new Error(`invalid protected section marker order: END without START ${token}`);
    if (open.token !== token) {
      throw new Error(`mismatched protected section markers: START ${open.token}, END ${token}`);
    }
    const end = match.index + match[0].length;
    blocks.push({ token, content: String(content || '').slice(open.start, end) });
    seen.add(token);
    open = null;
  }
  if (open) throw new Error(`unmatched protected section marker: ${open.token}`);
  return blocks;
}

function replaceGeneratedContentPreservingProtectedSections(
  existingContent,
  generatedContent,
  options = {},
) {
  const existing = String(existingContent || '');
  const generated = String(generatedContent || '');
  const existingBlocks = extractProtectedBlocks(existing);
  const generatedBlocks = extractProtectedBlocks(generated);
  if (existing && options.requiredContentPattern?.test(existing) && existingBlocks.length === 0) {
    throw new Error('required content has no protected section markers');
  }
  if (existingBlocks.length === 0) return generated;

  if (generatedBlocks.length > 0) {
    const existingTokens = existingBlocks.map(({ token }) => token).sort();
    const generatedTokens = generatedBlocks.map(({ token }) => token).sort();
    if (JSON.stringify(existingTokens) !== JSON.stringify(generatedTokens)) {
      throw new Error(
        `protected section token mismatch: existing=${existingTokens.join(',')} generated=${generatedTokens.join(',')}`,
      );
    }
    const byToken = new Map(existingBlocks.map((block) => [block.token, block.content]));
    let output = generated;
    for (const block of generatedBlocks) {
      output = output.replace(block.content, byToken.get(block.token));
    }
    return output;
  }

  const insertion = `${existingBlocks.map(({ content }) => content).join('\n\n')}\n\n`;
  const firstNewline = generated.indexOf('\n');
  return firstNewline >= 0
    ? `${generated.slice(0, firstNewline + 1)}\n${insertion}${generated.slice(firstNewline + 1)}`
    : `${generated}\n\n${insertion}`;
}

module.exports = {
  extractProtectedBlocks,
  replaceGeneratedContentPreservingProtectedSections,
};
