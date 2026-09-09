const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  buildArchitectureAssets,
  validateConfig,
  createArchitecturePlan,
} = require("../scripts/project");
const { applyPlan } = require("../../tooling/xirang/engine");
const source = path.resolve(__dirname, "../..");
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xirang-sets-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const target = path.join(root, "repo");
  fs.mkdirSync(target);
  return {
    source,
    target,
    includeRuntime: false,
    runRoot: path.join(root, "runs"),
  };
}
const config = (componentSets) => ({
  schemaVersion: 1,
  applications: [
    {
      id: "web",
      stack: "react-vite",
      path: "apps/web",
      ...(componentSets === undefined ? {} : { componentSets }),
    },
  ],
});
test("TC-ARCHPLAT-014 explicit empty selection keeps baseline UI without table or optional libraries", (t) => {
  const f = fixture(t),
    built = buildArchitectureAssets({ ...f, config: config([]) });
  assert.ok(built.assets.some((a) => a.path.endsWith("/ui/button.tsx")));
  assert.ok(
    !built.assets.some((a) =>
      /data-table|form-panel|calendar\.tsx/.test(a.path),
    ),
  );
  const pkg = JSON.parse(
    built.assets.find((a) => a.path === "apps/web/package.json").content,
  );
  assert.equal(pkg.dependencies["@tanstack/react-table"], undefined);
  assert.equal(pkg.dependencies["react-hook-form"], undefined);
  assert.ok(
    !built.assets
      .find((a) => a.path.endsWith("/src/app.tsx"))
      .content.includes("DataTable"),
  );
});
test("TC-ARCHPLAT-014 default table brings multi/date filters and feedback, but forms stay opt-in", (t) => {
  const { assets } = buildArchitectureAssets({
    ...fixture(t),
    config: config(),
  });
  for (const name of [
    "data-table.tsx",
    "date-picker.tsx",
    "search-select.tsx",
    "confirm-dialog.tsx",
    "calendar.tsx",
  ])
    assert.ok(
      assets.some((a) => a.path.endsWith("/" + name)),
      name,
    );
  assert.ok(!assets.some((a) => a.path.endsWith("/form-panel.tsx")));
});
test("TC-ARCHPLAT-014 form-only and RHF selections have different dependencies", (t) => {
  const f = fixture(t);
  const forms = buildArchitectureAssets({
    ...f,
    config: config(["forms"]),
  }).assets;
  assert.ok(forms.some((a) => a.path.endsWith("/forms/form-panel.tsx")));
  assert.ok(!forms.some((a) => a.path.includes("/data-table/")));
  assert.ok(!forms.some((a) => a.path.endsWith("/forms/react-hook-form.tsx")));
  const rhf = buildArchitectureAssets({
    ...f,
    config: config(["react-hook-form"]),
  }).assets;
  assert.ok(rhf.some((a) => a.path.endsWith("/forms/react-hook-form.tsx")));
  const pkg = JSON.parse(
    rhf.find((a) => a.path === "apps/web/package.json").content,
  );
  for (const name of ["react-hook-form", "@hookform/resolvers", "zod"])
    assert.match(pkg.dependencies[name], /^\d+\.\d+\.\d+$/);
});
test("TC-ARCHPLAT-014 rejects unknown/duplicate sets, backend UI and overlapping paths", (t) => {
  const f = fixture(t);
  for (const value of [["unknown"], ["forms", "forms"], "forms", null])
    assert.throws(() => validateConfig(config(value), f), /componentSets/);
  const c = config(["forms"]);
  c.applications[0].stack = "node";
  assert.throws(() => validateConfig(c, f), /not supported/);
  const overlap = config(["forms"]);
  overlap.applications[0].components = {
    forms: "apps/web/src/components/ui/forms",
  };
  assert.throws(() => validateConfig(overlap, f), /overlap|separate/);
});
test("TC-ARCHPLAT-014 shared consumers union dependencies and infer composed directories", (t) => {
  const f = fixture(t),
    c = config(["data-table"]);
  c.applications[0].components = {
    ui: "packages/ui/src/ui",
    dataTable: "packages/ui/src/data-table",
  };
  c.applications.push({
    ...c.applications[0],
    id: "admin",
    path: "apps/admin",
    componentSets: ["react-hook-form"],
  });
  const { assets } = buildArchitectureAssets({ ...f, config: c });
  assert.equal(
    assets.filter((a) => a.path === "packages/ui/package.json").length,
    1,
  );
  const shared = JSON.parse(
    assets.find((a) => a.path === "packages/ui/package.json").content,
  );
  assert.ok(shared.dependencies["react-hook-form"]);
  assert.ok(shared.dependencies["@tanstack/react-table"]);
  assert.ok(
    assets.some((a) => a.path === "packages/ui/src/forms/form-panel.tsx"),
  );
  assert.ok(
    assets.some((a) => a.path === "packages/ui/src/selectors/date-picker.tsx"),
  );
});
test("TC-ARCHPLAT-014 adding a set preserves project examples/utils and second plan converges", (t) => {
  const f = fixture(t),
    c = config([]);
  applyPlan(createArchitecturePlan({ ...f, config: c }), {
    runRoot: f.runRoot,
  });
  const utils = path.join(f.target, "apps/web/src/lib/utils.ts");
  fs.appendFileSync(utils, "export const projectMarker = true;\n");
  const example = fs.readFileSync(
    path.join(f.target, "apps/web/src/app.tsx"),
    "utf8",
  );
  c.applications[0].componentSets = ["forms"];
  fs.writeFileSync(
    path.join(f.target, "architecture.config.json"),
    JSON.stringify(c),
  );
  applyPlan(createArchitecturePlan({ ...f, config: c }), {
    runRoot: f.runRoot,
  });
  assert.match(fs.readFileSync(utils, "utf8"), /projectMarker/);
  assert.equal(
    fs.readFileSync(path.join(f.target, "apps/web/src/app.tsx"), "utf8"),
    example,
  );
  assert.equal(createArchitecturePlan({ ...f, config: c }).changes.length, 0);
});
test("TC-ARCHPLAT-014 deselection retains installed files, dependencies and their future updates", (t) => {
  const f = fixture(t),
    c = config(["forms", "data-table"]);
  applyPlan(createArchitecturePlan({ ...f, config: c }), {
    runRoot: f.runRoot,
  });
  c.applications[0].componentSets = [];
  fs.writeFileSync(
    path.join(f.target, "architecture.config.json"),
    JSON.stringify(c),
  );
  applyPlan(createArchitecturePlan({ ...f, config: c }), {
    runRoot: f.runRoot,
  });
  const again = createArchitecturePlan({ ...f, config: c });
  assert.equal(again.changes.length, 0);
  assert.ok(
    again.entries.some((a) => a.path.endsWith("/forms/form-panel.tsx")),
  );
  const pkg = JSON.parse(
    fs.readFileSync(path.join(f.target, "apps/web/package.json")),
  );
  assert.ok(pkg.dependencies["@tanstack/react-table"]);
  assert.ok(pkg.dependencies.cmdk);
});
test("TC-ARCHPLAT-014 shared components cannot resolve their dependencies into app source", (t) => {
  const f = fixture(t),
    c = config(["forms"]);
  c.applications[0].components = {
    ui: "packages/ui/src/ui",
    forms: "packages/ui/src/forms",
    feedback: "apps/web/src/components/feedback",
  };
  assert.throws(
    () => buildArchitectureAssets({ ...f, config: c }),
    /Shared component.*app/,
  );
});
test("TC-ARCHPLAT-014 scoped table upgrade includes filters, feedback and consumer dependencies", (t) => {
  const f = fixture(t);
  const { assets } = buildArchitectureAssets({
    ...f,
    config: config(),
    scope: "architecture:table:apps/web/src/components/data-table",
  });
  for (const suffix of [
    "/data-table/data-table.tsx",
    "/selectors/date-picker.tsx",
    "/feedback/confirm-dialog.tsx",
    "/ui/calendar.tsx",
  ])
    assert.ok(assets.some((a) => a.path.endsWith(suffix)));
  assert.ok(
    JSON.parse(assets.find((a) => a.path === "apps/web/package.json").content)
      .dependencies["react-day-picker"],
  );
});
