#!/usr/bin/env node
const path = require("node:path");
const {
  read,
  safePath,
  json,
  atomicWrite,
} = require("../../tooling/xirang/engine");
const { componentCatalog, resolveItems } = require("./component-sets");
function buildRegistry(source = path.resolve(__dirname, "../..")) {
  const cat = componentCatalog(source),
    root = path.join(source, "architecture/components/shadcn");
  return cat.registry.items.map((item) => {
    const { files, dependencies } = resolveItems([item.name], cat);
    files.push({
      path: "utils.ts",
      type: "registry:lib",
      target: "@lib/utils.ts",
      content: 'export { cn } from "cn";\n',
    });
    files.push({
      path: "SHADCN-LICENSE",
      type: "registry:file",
      target: "~/SHADCN-LICENSE",
      content: read(root, "LICENSE"),
    });
    return {
      $schema: "https://ui.shadcn.com/schema/registry-item.json",
      name: item.name,
      type: item.type,
      title: item.title,
      dependencies: Object.entries(dependencies)
        .map(([name, version]) => `${name}@${version}`)
        .sort(),
      files,
    };
  });
}
if (require.main === module)
  try {
    if (!process.argv[2])
      throw new Error(
        "Explicit output directory required (use container tmp/artifacts)",
      );
    const out = path.resolve(process.argv[2]),
      items = buildRegistry();
    for (const item of items)
      atomicWrite(safePath(out, `${item.name}.json`), json(item));
    console.log(`STATUS=OK\nREGISTRY_ITEMS=${items.length}`);
  } catch (error) {
    console.error(`STATUS=BLOCKED\nREASON=${error.message}`);
    process.exitCode = 1;
  }
module.exports = { buildRegistry };
