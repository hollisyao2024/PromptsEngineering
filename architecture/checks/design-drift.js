// DESIGN.md <-> styles.css drift check (ADR-040). Warnings only: colours, radii and the body font
// family that DESIGN.md actually declares are compared with the effective values of styles.css.
const fs = require('node:fs');
const YAML = require('../../tooling/xirang/vendor/yaml/lib');

const ROOT_PX = 16;
const MAX_DEPTH = 32;
const warning = (app, code, reason) => ({ name: `design:${app}`, code, reason });

function readFrontMatter(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  if (lines[0].trim() !== '---') return { skip: true };
  const end = lines.findIndex((line, index) => index > 0 && /^(?:---|\.\.\.)\s*$/.test(line));
  if (end < 0) return { error: 'front matter has no closing ---' };
  const doc = YAML.parseDocument(lines.slice(1, end).join('\n'), { uniqueKeys: true, prettyErrors: false });
  if (doc.errors.length) return { error: `invalid YAML front matter: ${doc.errors[0].message.split('\n')[0]}` };
  const value = doc.toJS({ maxAliasCount: 50 });
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { error: 'front matter must be a mapping' };
  return { value };
}

// ---- CSS: comments, blocks and effective declarations ----------------------------------------
function stripComments(css) {
  let out = '', quote = '';
  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (quote) { out += ch; if (ch === '\\') out += css[++i] ?? ''; else if (ch === quote) quote = ''; continue; }
    if (ch === '"' || ch === "'") { quote = ch; out += ch; continue; }
    if (ch === '/' && css[i + 1] === '*') { const end = css.indexOf('*/', i + 2); i = end < 0 ? css.length : end + 1; out += ' '; continue; }
    out += ch;
  }
  return out;
}

function parseBlocks(css) {
  let i = 0;
  const block = () => {
    const items = []; let start = i, quote = '', depth = 0;
    for (; i < css.length; i++) {
      const ch = css[i];
      if (quote) { if (ch === '\\') i++; else if (ch === quote) quote = ''; continue; }
      if (ch === '"' || ch === "'") { quote = ch; continue; }
      if (ch === '(') depth++;
      else if (ch === ')') depth = Math.max(0, depth - 1);
      else if (depth === 0 && ch === ';') { items.push({ text: css.slice(start, i) }); start = i + 1; }
      else if (depth === 0 && ch === '{') { const prelude = css.slice(start, i).trim(); i++; items.push({ prelude, children: block() }); start = i + 1; }
      else if (depth === 0 && ch === '}') { items.push({ text: css.slice(start, i) }); return items; }
    }
    items.push({ text: css.slice(start) });
    return items;
  };
  return block();
}

function splitTop(value, separator) {
  const parts = []; let depth = 0, quote = '', start = 0;
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (quote) { if (ch === '\\') i++; else if (ch === quote) quote = ''; continue; }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (depth === 0 && ch === separator) { parts.push(value.slice(start, i)); start = i + 1; }
  }
  parts.push(value.slice(start));
  return parts;
}

function declaration(text) {
  const colon = text.indexOf(':');
  if (colon < 0) return null;
  const property = text.slice(0, colon).trim();
  let value = text.slice(colon + 1).trim();
  const important = /!\s*important\s*$/i.test(value);
  if (important) value = value.replace(/!\s*important\s*$/i, '').trim();
  return property ? { property, value, important } : null;
}

// Cascade order for same-scope declarations: important+layered > important+unlayered >
// normal+unlayered > normal+layered; within a rank the later declaration wins.
function effectiveValues(css) {
  const root = new Map(), body = new Map();
  const set = (map, decl, layered) => {
    const rank = decl.important ? (layered ? 3 : 2) : (layered ? 0 : 1);
    const current = map.get(decl.property);
    if (!current || rank >= current.rank) map.set(decl.property, { value: decl.value, rank });
  };
  const walk = (items, layered) => {
    for (const item of items) {
      if (!item.children) continue;
      const prelude = item.prelude, at = /^@([\w-]+)/.exec(prelude)?.[1]?.toLowerCase();
      if (at === 'layer') { walk(item.children, true); continue; }
      if (at === 'theme') { for (const child of item.children) { const decl = !child.children && declaration(child.text); if (decl && decl.property.startsWith('--')) set(root, decl, true); } continue; }
      if (at) continue; // @media, @supports, @container, @keyframes, @font-face, @utility ...
      const selectors = splitTop(prelude, ',').map(s => s.trim());
      const isRoot = selectors.includes(':root'), isBody = selectors.includes('body');
      if (!isRoot && !isBody) continue;
      for (const child of item.children) {
        const decl = !child.children && declaration(child.text);
        if (!decl) continue;
        if (isRoot && decl.property.startsWith('--')) set(root, decl, layered);
        if (isBody && decl.property.toLowerCase() === 'font-family') set(body, { ...decl, property: 'font-family' }, layered);
      }
    }
  };
  walk(parseBlocks(stripComments(css)), false);
  return { root, body };
}

class Unresolved extends Error {}
function expandVars(value, root, seen = [], depth = 0) {
  if (depth > MAX_DEPTH) throw new Unresolved('var() nesting too deep');
  let out = '', i = 0;
  for (;;) {
    const match = /var\(/i.exec(value.slice(i));
    if (!match) return out + value.slice(i);
    const open = i + match.index + match[0].length;
    let level = 1, j = open;
    for (; j < value.length && level; j++) { if (value[j] === '(') level++; else if (value[j] === ')') level--; }
    if (level) throw new Unresolved(`unbalanced var() in ${value}`);
    const inner = value.slice(open, j - 1), comma = splitTop(inner, ',');
    const name = comma[0].trim(), fallback = comma.length > 1 ? comma.slice(1).join(',').trim() : undefined;
    let replacement;
    if (seen.includes(name)) throw new Unresolved(`var() cycle ${[...seen, name].join(' -> ')}`);
    if (root.has(name)) replacement = expandVars(root.get(name).value, root, [...seen, name], depth + 1);
    else if (fallback !== undefined) replacement = expandVars(fallback, root, seen, depth + 1);
    else throw new Unresolved(`${name} is not defined`);
    out += value.slice(i, i + match.index) + replacement;
    i = j;
  }
}

// ---- Values ------------------------------------------------------------------------------------
function parseLength(input) {
  if (typeof input === 'number') return Number.isFinite(input) ? input : null;
  if (typeof input !== 'string') return null;
  const tokens = input.toLowerCase().replace(/calc\(/g, '(').match(/-?(?:\d+\.?\d*|\.\d+)(?:px|rem|[a-z%]+)?|[()+\-*/]|\S/g) || [];
  let pos = 0;
  const peek = () => tokens[pos];
  const factor = () => {
    const token = tokens[pos++];
    if (token === '(') { const value = expr(); if (tokens[pos++] !== ')') throw new Error('paren'); return value; }
    if (token === '-') { const value = factor(); return { n: -value.n, unit: value.unit }; }
    const match = /^(-?(?:\d+\.?\d*|\.\d+))([a-z%]*)$/.exec(token || '');
    if (!match) throw new Error('token');
    const n = Number(match[1]);
    if (match[2] === 'px') return { n, unit: 'px' };
    if (match[2] === 'rem') return { n: n * ROOT_PX, unit: 'px' };
    if (match[2] === '') return { n, unit: '' };
    throw new Error('unit');
  };
  const term = () => {
    let left = factor();
    while (peek() === '*' || peek() === '/') {
      const op = tokens[pos++], right = factor();
      if (op === '*') { if (left.unit && right.unit) throw new Error('unit'); left = { n: left.n * right.n, unit: left.unit || right.unit }; }
      else { if (right.unit || right.n === 0) throw new Error('unit'); left = { n: left.n / right.n, unit: left.unit }; }
    }
    return left;
  };
  const expr = () => {
    let left = term();
    while (peek() === '+' || peek() === '-') {
      const op = tokens[pos++], right = term();
      const unit = left.unit || right.unit;
      if (left.unit !== right.unit && !(left.n === 0 || right.n === 0)) throw new Error('unit');
      left = { n: op === '+' ? left.n + right.n : left.n - right.n, unit };
    }
    return left;
  };
  try {
    const value = expr();
    if (pos !== tokens.length || (value.unit === '' && value.n !== 0)) return null;
    return Math.round(value.n * 1000) / 1000;
  } catch { return null; }
}

const clamp01 = x => Math.min(1, Math.max(0, x));
const toByte = x => Math.round(clamp01(x) * 255);
function channelList(args) {
  const [main, alpha] = splitTop(args, '/');
  const parts = main.includes(',') ? main.split(',') : main.trim().split(/\s+/);
  let a = 1, rest = parts.map(p => p.trim());
  if (alpha !== undefined) a = alphaValue(alpha.trim());
  else if (rest.length === 4) a = alphaValue(rest.pop());
  return rest.length === 3 && Number.isFinite(a) ? { parts: rest, a } : null;
}
function alphaValue(text) { return text.endsWith('%') ? Number(text.slice(0, -1)) / 100 : Number(text); }
function num(text, percentScale) {
  if (text === 'none') return 0;
  if (text.endsWith('%')) return Number(text.slice(0, -1)) / 100 * percentScale;
  return Number(text.replace(/deg$/, ''));
}
function linearToSrgb(x) { return x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055; }

function parseColor(input) {
  if (typeof input !== 'string') return null;
  const value = input.trim().toLowerCase();
  const named = { white: '#ffffff', black: '#000000', transparent: '#00000000' };
  if (named[value]) return parseColor(named[value]);
  let m = /^#([0-9a-f]{3,8})$/.exec(value);
  if (m) {
    let hex = m[1];
    if (hex.length === 3 || hex.length === 4) hex = [...hex].map(c => c + c).join('');
    if (hex.length !== 6 && hex.length !== 8) return null;
    const byte = k => parseInt(hex.slice(k, k + 2), 16);
    return { r: byte(0), g: byte(2), b: byte(4), a: hex.length === 8 ? byte(6) / 255 : 1 };
  }
  m = /^([a-z]+)\((.*)\)$/.exec(value);
  if (!m) return null;
  const list = channelList(m[2]);
  if (!list) return null;
  const [x, y, z] = list.parts, a = clamp01(list.a);
  let rgb;
  if (m[1] === 'rgb' || m[1] === 'rgba') rgb = [x, y, z].map(p => (p.endsWith('%') ? num(p, 255) : Number(p)));
  else if (m[1] === 'hsl' || m[1] === 'hsla') {
    const h = ((num(x, 360) % 360) + 360) % 360 / 360, s = clamp01(num(y, 1)), l = clamp01(num(z, 1));
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    const hue = t => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
    rgb = [hue(h + 1 / 3), hue(h), hue(h - 1 / 3)].map(v => v * 255);
  } else if (m[1] === 'oklch') {
    const L = num(x, 1), C = num(y, 0.4), H = num(z, 360) * Math.PI / 180;
    const A = C * Math.cos(H), B = C * Math.sin(H);
    const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
    const mm = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
    const s = (L - 0.0894841775 * A - 1.2914855480 * B) ** 3;
    rgb = [
      4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * mm + 1.7076147010 * s,
    ].map(v => linearToSrgb(clamp01(v)) * 255);
  } else return null;
  if (rgb.some(v => !Number.isFinite(v))) return null;
  const [r, g, b] = rgb.map(v => toByte(v / 255));
  return { r, g, b, a };
}
const hex = c => '#' + [c.r, c.g, c.b].map(n => n.toString(16).padStart(2, '0')).join('') + (c.a < 1 ? Math.round(c.a * 255).toString(16).padStart(2, '0') : '');
const sameColor = (a, b) => Math.abs(a.r - b.r) <= 1 && Math.abs(a.g - b.g) <= 1 && Math.abs(a.b - b.b) <= 1 && Math.abs(a.a - b.a) <= 0.01;

function fontList(value) {
  return splitTop(value, ',').map(part => part.trim().replace(/^(["'])(.*)\1$/, '$2').replace(/\s+/g, ' ').toLowerCase()).filter(Boolean);
}

// DESIGN.md token references such as "{colors.primary}" resolve inside the front matter.
function designValue(design, value, seen = []) {
  const m = typeof value === 'string' && /^\{([\w.-]+)\}$/.exec(value.trim());
  if (!m) return value;
  if (seen.includes(m[1]) || seen.length > MAX_DEPTH) return undefined;
  const target = m[1].split('.').reduce((node, key) => (node && typeof node === 'object' ? node[key] : undefined), design);
  return designValue(design, target, [...seen, m[1]]);
}

// ---- Check -------------------------------------------------------------------------------------
function compareApp(app, design, css) {
  const warnings = [], warn = (code, reason) => warnings.push(warning(app.id, code, reason));
  const { root, body } = effectiveValues(css);
  const resolve = (name, expression) => {
    try { return { value: expandVars(expression, root, name ? [name] : []).trim() }; }
    catch (error) { if (error instanceof Unresolved) return { error: error.message }; throw error; }
  };
  const cssToken = (name, label) => {
    if (!root.has(name)) { warn('DESIGN_DRIFT_TOKEN_MISSING', `${label}: styles.css does not define ${name}`); return null; }
    const result = resolve(name, root.get(name).value);
    if (result.error) { warn('DESIGN_DRIFT_UNSUPPORTED_VALUE', `${label}: cannot resolve ${name}: ${result.error}`); return null; }
    return result.value;
  };
  const section = key => (design[key] && typeof design[key] === 'object' && !Array.isArray(design[key]) ? design[key] : {});

  for (const [key, raw] of Object.entries(section('colors'))) {
    const label = `colors.${key}`, expected = parseColor(designValue(design, raw));
    if (!expected) { warn('DESIGN_DRIFT_UNSUPPORTED_VALUE', `${label}: unsupported DESIGN.md colour ${JSON.stringify(raw)}`); continue; }
    const value = cssToken(`--${key}`, label);
    if (value === null) continue;
    const actual = parseColor(value);
    if (!actual) warn('DESIGN_DRIFT_UNSUPPORTED_VALUE', `${label}: unsupported styles.css colour --${key}: ${value}`);
    else if (!sameColor(expected, actual)) warn('DESIGN_DRIFT_COLOR', `${label}: DESIGN.md ${hex(expected)} != styles.css --${key} ${hex(actual)} (${value})`);
  }
  for (const [key, raw] of Object.entries(section('rounded'))) {
    const label = `rounded.${key}`, expected = parseLength(designValue(design, raw));
    if (expected === null) { warn('DESIGN_DRIFT_UNSUPPORTED_VALUE', `${label}: unsupported DESIGN.md length ${JSON.stringify(raw)}`); continue; }
    const value = cssToken(`--radius-${key}`, label);
    if (value === null) continue;
    const actual = parseLength(value);
    if (actual === null) warn('DESIGN_DRIFT_UNSUPPORTED_VALUE', `${label}: unsupported styles.css length --radius-${key}: ${value}`);
    else if (Math.abs(expected - actual) > 0.01) warn('DESIGN_DRIFT_RADIUS', `${label}: DESIGN.md ${expected}px != styles.css --radius-${key} ${actual}px`);
  }
  const typography = section('typography'), rawFont = typography.body && typeof typography.body === 'object' ? typography.body.fontFamily : undefined;
  if (rawFont !== undefined) {
    const label = 'typography.body.fontFamily', font = designValue(design, rawFont);
    if (typeof font !== 'string') warn('DESIGN_DRIFT_UNSUPPORTED_VALUE', `${label}: unsupported DESIGN.md value ${JSON.stringify(rawFont)}`);
    else if (!body.has('font-family')) warn('DESIGN_DRIFT_TOKEN_MISSING', `${label}: styles.css body has no font-family`);
    else {
      const result = resolve(null, body.get('font-family').value);
      if (result.error) warn('DESIGN_DRIFT_UNSUPPORTED_VALUE', `${label}: cannot resolve body font-family: ${result.error}`);
      else if (fontList(font).join(',') !== fontList(result.value).join(',')) warn('DESIGN_DRIFT_FONT_FAMILY', `${label}: DESIGN.md ${fontList(font).join(', ')} != styles.css body ${fontList(result.value).join(', ')}`);
    }
  }
  return warnings;
}

// apps: [{ id, stylesPath }] with absolute stylesPath; designPath is the absolute root DESIGN.md, or
// designError is set instead when the caller rejected that path (the file is then never read).
function checkDesignDrift({ designPath, designError, apps }) {
  const checks = [], warnings = [];
  if (!apps.length || (!designError && !fs.existsSync(designPath))) return { checks, warnings };
  let front;
  if (designError) front = { error: `cannot be read: ${designError}` };
  else try { front = readFrontMatter(fs.readFileSync(designPath, 'utf8')); }
  catch (error) { front = { error: `cannot be read: ${error.code || error.message}` }; }
  if (front.skip) return { checks, warnings };
  for (const app of apps) {
    checks.push(`design:${app.id}`);
    if (front.error) { warnings.push(warning(app.id, 'DESIGN_DRIFT_INVALID_DESIGN', `DESIGN.md ${front.error}`)); continue; }
    if (!fs.existsSync(app.stylesPath)) { warnings.push(warning(app.id, 'DESIGN_DRIFT_STYLES_MISSING', `${app.styles} not found`)); continue; }
    try { warnings.push(...compareApp(app, front.value, fs.readFileSync(app.stylesPath, 'utf8'))); }
    catch (error) { warnings.push(warning(app.id, 'DESIGN_DRIFT_CHECK_ERROR', `design drift check failed: ${error.message}`)); }
  }
  return { checks, warnings };
}

module.exports = { checkDesignDrift, parseColor, parseLength, effectiveValues };
