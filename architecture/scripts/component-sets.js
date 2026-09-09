const fs = require("node:fs");
const path = require("node:path");
const ROOT = "architecture/components/shadcn";
const DEFAULT_SOURCE = path.resolve(__dirname, "../..");
const GROUP_KEYS = {
  "data-table": "dataTable",
  forms: "forms",
  selectors: "selectors",
  feedback: "feedback",
  advanced: "advanced",
  ui: "ui",
};
function componentCatalog(
  source = DEFAULT_SOURCE,
  readSource = (p) => fs.readFileSync(path.join(source, p), "utf8"),
) {
  return {
    definition: JSON.parse(readSource(`${ROOT}/component-sets.json`)),
    registry: JSON.parse(readSource(`${ROOT}/registry.json`)),
    versions: JSON.parse(readSource("architecture/dependencies.json")),
    readSource,
  };
}
function validateSelection(selection, source = DEFAULT_SOURCE) {
  const { definition } = componentCatalog(source);
  const value = selection === undefined ? definition.default : selection;
  if (
    !Array.isArray(value) ||
    new Set(value).size !== value.length ||
    value.some(
      (name) =>
        typeof name !== "string" || !Object.hasOwn(definition.sets, name),
    )
  )
    throw new Error(
      "componentSets must contain unique supported component set names",
    );
  return [...value];
}
function resolveItems(names, cat) {
  const index = new Map(cat.registry.items.map((item) => [item.name, item]));
  const visited = new Set(),
    active = new Set(),
    files = new Map();
  const pins = { ...cat.versions.frontend, ...cat.versions.components };
  // Preserve the established baseline utility and React packages, excluding optional table state.
  const dependencies = { ...cat.versions.frontend };
  delete dependencies["@tanstack/react-table"];
  function addDependency(name) {
    if (!pins[name])
      throw new Error(
        `Registry dependency is not pinned in architecture/dependencies.json: ${name}`,
      );
    dependencies[name] = pins[name];
  }
  function include(name) {
    if (active.has(name)) throw new Error(`Registry dependency cycle: ${name}`);
    if (visited.has(name)) return;
    const item = index.get(name);
    if (!item) throw new Error(`Registry dependency missing: ${name}`);
    active.add(name);
    for (const dep of item.registryDependencies || []) include(dep);
    for (const dep of item.dependencies || [])
      addDependency(dep.slice(0, dep.lastIndexOf("@")));
    for (const file of item.files) {
      const content = cat.readSource(`${ROOT}/${file.path}`);
      for (const [, specifier] of content.matchAll(/from ["']([^"']+)["']/g)) {
        if (specifier.startsWith(".") || specifier.startsWith("@/")) continue;
        addDependency(
          specifier.startsWith("@")
            ? specifier.split("/").slice(0, 2).join("/")
            : specifier.split("/")[0],
        );
      }
      files.set(file.path, { ...file, content });
    }
    active.delete(name);
    visited.add(name);
  }
  names.forEach(include);
  // Ensure all local component imports are included by the declared registry graph.
  for (const file of files.values())
    for (const [, group, name] of file.content.matchAll(
      /@\/components\/([a-z-]+)\/([a-z-]+)/g,
    )) {
      if (
        !files.has(`registry/${group}/${name}.tsx`) &&
        !files.has(`registry/${group}/${name}.ts`)
      )
        throw new Error(
          `Incomplete registry closure: ${file.path} imports ${group}/${name}`,
        );
    }
  return { files: [...files.values()], dependencies, names: [...visited] };
}
function resolveComponentSets(selection, cat) {
  const chosen = selection === undefined ? cat.definition.default : selection;
  const resolved = resolveItems(
    [
      ...cat.definition.baseline,
      ...chosen.flatMap((name) => cat.definition.sets[name].registry),
    ],
    cat,
  );
  const sets = Object.keys(cat.definition.sets).filter((name) =>
    cat.definition.sets[name].registry.every((item) =>
      resolved.names.includes(item),
    ),
  );
  return {
    ...resolved,
    sets,
    tests: [
      "setup.ts",
      "primitives.test.tsx",
      ...sets.flatMap((name) => cat.definition.sets[name].tests),
      ...(cat.definition.integrationTests || [])
        .filter((test) => test.requires.every((name) => sets.includes(name)))
        .map((test) => test.file),
    ],
  };
}
function fileGroup(file) {
  return GROUP_KEYS[file.path.split("/")[1]];
}
function componentOwner(kind, directory) {
  return kind === "ui"
    ? `architecture:ui:${directory}`
    : kind === "dataTable"
      ? `architecture:table:${directory}`
      : `architecture:components:${kind}:${directory}`;
}
module.exports = {
  componentCatalog,
  validateSelection,
  resolveItems,
  resolveComponentSets,
  fileGroup,
  componentOwner,
};
