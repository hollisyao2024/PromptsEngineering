import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
const schemaFile = fileURLToPath(new URL('./contract.json', import.meta.url)), output = fileURLToPath(new URL('./generated.ts', import.meta.url));
export function generate(schema) {
  if (schema.type !== 'object' || !/^[A-Z][A-Za-z0-9]*$/.test(schema.title) || schema.additionalProperties !== false) throw new Error('Supported contract: named closed object schema');
  for (const key of Object.keys(schema)) if (!['$schema','title','type','properties','required','additionalProperties','description'].includes(key)) throw new Error(`Unsupported schema keyword: ${key}`);
  if (!schema.properties || typeof schema.properties !== 'object' || !Array.isArray(schema.required)) throw new Error('properties and required must be explicit');
  const types = { string: 'string', number: 'number', integer: 'number', boolean: 'boolean' };
  for (const key of schema.required) if (!(key in schema.properties)) throw new Error(`Unknown required property: ${key}`);
  const fields = Object.entries(schema.properties).map(([key, value]) => {
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(key) || !types[value.type] || Object.keys(value).some(k => !['type','description'].includes(k))) throw new Error(`Unsupported property: ${key}`);
    return `  ${key}${schema.required.includes(key) ? '' : '?'}: ${types[value.type]};`;
  });
  return `// Generated from contract.json; run node generate.mjs.\nexport interface ${schema.title} {\n${fields.join('\n')}\n}\n`;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
const content = generate(JSON.parse(fs.readFileSync(schemaFile, 'utf8')));
if (process.argv.includes('--check')) {
  if (!fs.existsSync(output) || fs.readFileSync(output, 'utf8') !== content) { console.error('STATUS=BLOCKED\nREASON=Contract generation drift'); process.exitCode=1; }
  else console.log('STATUS=OK');
} else { fs.writeFileSync(output, content); console.log('STATUS=GENERATED'); }
}
