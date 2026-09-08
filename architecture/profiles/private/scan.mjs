import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const profile = JSON.parse(fs.readFileSync(new URL('./profile.json', import.meta.url),'utf8'));
try {
  const root=process.argv[2]; if (!root || !profile.denyPatterns?.length) throw new Error('Artifact directory and non-empty denyPatterns required');
  let scanned=0; const violations=[];
  function visit(dir) { for (const entry of fs.readdirSync(dir,{withFileTypes:true})) {
    const file=path.join(dir,entry.name); if (entry.isSymbolicLink()) throw new Error('Artifact symlink rejected');
    if (entry.isDirectory()) visit(file); else if (entry.isFile()) { scanned++; const bytes=fs.readFileSync(file); for (const pattern of profile.denyPatterns) if(bytes.includes(Buffer.from(pattern))) violations.push(`${path.relative(root,file)}: ${pattern}`); }
  } }
  visit(root); if(!scanned)throw new Error('Empty artifact directory'); if(violations.length)throw new Error(violations.join('\n'));
  console.log(`SCANNED=${scanned}\nSTATUS=OK`);
} catch(error) { console.error(`STATUS=BLOCKED\nREASON=${error.message}`);process.exitCode=1; }
