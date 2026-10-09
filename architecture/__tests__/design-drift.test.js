const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { checkProject } = require('../checks/project-check');
const { parseColor, parseLength } = require('../checks/design-drift');
const { runArchitectureCheck } = require('../../infra/scripts/shared/architecture-check');

const source = path.resolve(__dirname, '../..');
const tokens = fs.readFileSync(path.join(source, 'architecture/components/shadcn/tokens.css'), 'utf8');
const skeleton = fs.readFileSync(path.join(source, 'docs/data/templates/prd/DESIGN-TEMPLATE.md'), 'utf8');
const webConfig = (extra = []) => ({ schemaVersion: 1, applications: [{ id: 'web', stack: 'react-vite', path: 'apps/web' }, ...extra], datastores: [], modules: [] });

function fixture(t, { design, styles, apps } = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'xirang-design-drift-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const app of apps || ['apps/web']) fs.mkdirSync(path.join(root, app, 'src'), { recursive: true });
  if (design !== undefined) fs.writeFileSync(path.join(root, 'DESIGN.md'), design);
  if (styles !== undefined) fs.writeFileSync(path.join(root, 'apps/web/src/styles.css'), styles);
  return root;
}
const check = (target, config = webConfig(), options = { syntax: false }) => checkProject(target, config, { source, ...options });
const front = body => `---\nversion: alpha\nname: "fixture"\n${body}---\n## Overview\ntext\n`;
const codes = result => result.warnings.map(w => w.code).sort();

// A downstream-shaped sheet: the generated tokens first, then a second unlayered :root that redefines
// most names in hex, a .dark and @media override that must be ignored, and an unlayered body font stack
// that overrides the @layer base one.
const downstreamStyles = `${tokens}
/* project palette */
:root {
  --background: #f3f6fa; --foreground: #172b4d;
  --card: #fff; --primary: #1765d1; --primary-foreground: #fff;
  --border: #dce4ee; --ring: #3984e8; --destructive: #c03438; --radius: .75rem;
  --success-surface: #e9f6ee; --brand: var(--primary);
}
.dark { --primary: #000000; }
@media (prefers-color-scheme: dark) { :root { --background: #000000; } }
body {font-family: -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif; font-size:14px;}
`;
const downstreamDesign = front(`colors:
  background: "#f3f6fa"
  foreground: "#172b4d"
  card: "#ffffff"
  popover-foreground: "#172B4D"
  primary: "#1765d1"
  brand: "{colors.primary}"
  primary-foreground: "rgb(255 255 255)"
  destructive: "#c03438"
  border: "#dce4ee"
  ring: "#3984e8"
  success-surface: "#e9f6ee"
typography:
  body:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif'
rounded:
  sm: 8px
  md: 10px
  lg: 0.75rem
`);

test('AC1-AC3 the shipped DESIGN.md skeleton and shadcn tokens.css produce no drift warnings', t => {
  const result = check(fixture(t, { design: skeleton, styles: tokens }));
  assert.equal(result.status, 'OK', JSON.stringify(result.failures));
  assert.deepEqual(result.warnings, []);
  assert.ok(result.checks.includes('design:web'));
});

test('AC5 effective values follow later-wins, unlayered-over-@layer and var() expansion; .dark and @media are skipped', t => {
  const result = check(fixture(t, { design: downstreamDesign, styles: downstreamStyles }));
  assert.deepEqual(result.warnings, []);
  assert.equal(result.status, 'OK');
});

test('AC5 an earlier unlayered declaration beats a later layered one', t => {
  const styles = ':root { --primary: #111111; }\n@layer base { :root { --primary: #222222; } }\n';
  assert.deepEqual(check(fixture(t, { design: front('colors:\n  primary: "#111111"\n'), styles })).warnings, []);
  const drift = check(fixture(t, { design: front('colors:\n  primary: "#222222"\n'), styles }));
  assert.deepEqual(codes(drift), ['DESIGN_DRIFT_COLOR']);
  assert.match(drift.warnings[0].reason, /colors\.primary/);
  assert.match(drift.warnings[0].reason, /#111111/);
});

test('AC1-AC4 colour, radius, font and missing-token drift are warnings only', t => {
  const design = downstreamDesign
    .replace('primary: "#1765d1"', 'primary: "#123456"')
    .replace('md: 10px', 'md: 9px\n  xl: 16px')
    .replace('"PingFang SC", sans-serif\'', 'sans-serif\'')
    .replace('  success-surface', '  missing-token: "#000000"\n  success-surface');
  const result = check(fixture(t, { design, styles: downstreamStyles }));
  assert.equal(result.status, 'OK');
  assert.deepEqual(result.failures, []);
  // brand references {colors.primary}, so it drifts together with primary.
  assert.deepEqual(codes(result), ['DESIGN_DRIFT_COLOR', 'DESIGN_DRIFT_COLOR', 'DESIGN_DRIFT_FONT_FAMILY', 'DESIGN_DRIFT_RADIUS', 'DESIGN_DRIFT_TOKEN_MISSING', 'DESIGN_DRIFT_TOKEN_MISSING']);
  for (const warning of result.warnings) assert.equal(warning.name, 'design:web');
  const reasons = result.warnings.map(w => w.reason).join('\n');
  for (const needle of ['colors.primary', 'rounded.md', 'rounded.xl', 'colors.missing-token', '--missing-token', 'typography.body.fontFamily']) assert.ok(reasons.includes(needle), needle);
});

test('AC4 values that cannot be resolved or parsed become warnings instead of errors', t => {
  const styles = ':root { --primary: color-mix(in srgb, red, blue); --ring: var(--nope); --a: var(--b); --b: var(--a); --radius-sm: 1em; }\n';
  const design = front('colors:\n  primary: "#ff0000"\n  ring: "#ff0000"\n  a: "#ff0000"\n  border: 12\nrounded:\n  sm: 4px\n');
  const result = check(fixture(t, { design, styles }));
  assert.equal(result.status, 'OK');
  assert.deepEqual(codes(result), Array(5).fill('DESIGN_DRIFT_UNSUPPORTED_VALUE'));
});

test('AC5 the check is skipped without DESIGN.md, without front matter, or for non-shadcn applications', t => {
  for (const design of [undefined, '# Design\nno front matter\n']) {
    const result = check(fixture(t, { design, styles: tokens }));
    assert.deepEqual(result.warnings, []);
    assert.equal(result.checks.includes('design:web'), false);
  }
  const apiOnly = { schemaVersion: 1, applications: [{ id: 'api', stack: 'node', path: 'apps/api' }], datastores: [], modules: [] };
  const result = check(fixture(t, { design: front('colors:\n  primary: "#000000"\n'), apps: ['apps/api'] }), apiOnly);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.checks.some(name => name.startsWith('design:')), false);
});

test('AC4 invalid front matter and a missing styles.css each produce one warning', t => {
  assert.deepEqual(codes(check(fixture(t, { design: '---\ncolors: [unclosed\n---\n', styles: tokens }))), ['DESIGN_DRIFT_INVALID_DESIGN']);
  assert.deepEqual(codes(check(fixture(t, { design: '---\ncolors:\n  primary: "#000000"\n', styles: tokens }))), ['DESIGN_DRIFT_INVALID_DESIGN']);
  assert.deepEqual(codes(check(fixture(t, { design: skeleton }))), ['DESIGN_DRIFT_STYLES_MISSING']);
});

test('AC4 the design check runs even when the TypeScript syntax gate blocks the application', t => {
  const target = fixture(t, { design: front('colors:\n  primary: "#123456"\n'), styles: tokens });
  const result = check(target, webConfig(), {});
  assert.equal(result.status, 'BLOCKED');
  assert.match(result.failures.map(f => f.reason).join('\n'), /TypeScript dependency missing/);
  assert.deepEqual(codes(result), ['DESIGN_DRIFT_COLOR']);
});

test('colour normalisation matches published conversions', () => {
  const hex = value => { const c = parseColor(value); return '#' + [c.r, c.g, c.b].map(n => n.toString(16).padStart(2, '0')).join(''); };
  // oklch(.30 .08 260) -> #142c55 is the official @google/design.md export recorded in ADR-037.
  assert.equal(hex('oklch(.30 .08 260)'), '#142c55');
  assert.equal(hex('oklch(1 0 0)'), '#ffffff');
  assert.equal(hex('oklch(0% 0 0)'), '#000000');
  assert.equal(hex('hsl(0 100% 50%)'), '#ff0000');
  assert.equal(hex('hsl(120, 100%, 25%)'), '#008000');
  assert.equal(hex('#abc'), '#aabbcc');
  assert.equal(hex('rgb(18, 52, 86)'), '#123456');
  assert.equal(parseColor('rgb(255 0 0 / 50%)').a, 0.5);
  assert.equal(parseColor('#ff000080').a, 128 / 255);
  assert.equal(parseColor('color-mix(in srgb, red, blue)'), null);
});

test('length evaluation expands rem and calc arithmetic', () => {
  assert.equal(parseLength('.625rem'), 10);
  assert.equal(parseLength('calc(.625rem - 4px)'), 6);
  assert.equal(parseLength('calc((1rem + 4px) / 2)'), 10);
  assert.equal(parseLength('calc(2 * 3px)'), 6);
  assert.equal(parseLength('0'), 0);
  assert.equal(parseLength('1em'), null);
  assert.equal(parseLength('calc(1px * 2px)'), null);
});

test('workflow gate prints architecture warnings without changing the result', t => {
  const target = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'xirang-design-gate-')));
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));
  fs.writeFileSync(path.join(target, 'architecture.config.json'), '{}\n');
  fs.mkdirSync(path.join(target, 'architecture/checks'), { recursive: true });
  const checker = path.join(target, 'architecture/checks/project-check.js');
  const write = result => { fs.writeFileSync(checker, `exports.checkProject = () => (${JSON.stringify(result)});\n`); delete require.cache[checker]; };
  const lines = [], warn = line => lines.push(line);
  write({ status: 'OK', checks: [], failures: [], warnings: [{ name: 'design:web', code: 'DESIGN_DRIFT_COLOR', reason: 'colors.primary: a|b\nnext' }] });
  assert.equal(runArchitectureCheck(target, { warn }).status, 'OK');
  assert.deepEqual(lines, ['ARCHITECTURE_WARNING=design:web|DESIGN_DRIFT_COLOR|colors.primary: a|b next']);
  lines.length = 0;
  write({ status: 'OK', checks: [], failures: [] });
  assert.equal(runArchitectureCheck(target, { warn }).status, 'OK');
  assert.deepEqual(lines, []);
  write({ status: 'BLOCKED', checks: [], failures: [{ name: 'web', reason: 'boom' }], warnings: [{ name: 'design:web', code: 'DESIGN_DRIFT_RADIUS', reason: 'r' }] });
  assert.throws(() => runArchitectureCheck(target, { warn }), /Architecture check failed: web: boom/);
  assert.deepEqual(lines, ['ARCHITECTURE_WARNING=design:web|DESIGN_DRIFT_RADIUS|r']);
});
