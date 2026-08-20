import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const root = fileURLToPath(new URL("..", import.meta.url));

test("npm package ships only the intended files", () => {
  const output = execFileSync(npm, ["pack", "--dry-run", "--json", "--ignore-scripts"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  const parsed = JSON.parse(output) as Record<string, { files: Array<{ path: string }> }>;
  const entry = Object.values(parsed)[0];
  assert.ok(entry, "expected the package entry in npm pack output");
  const paths = entry.files.map((file) => file.path);

  // Source-native: ship src/, CHANGELOG, README, LICENSE, package.json.
  assert.ok(paths.includes("src/index.ts"), "src/index.ts must be present");
  assert.ok(paths.includes("CHANGELOG.md"), "CHANGELOG.md must be present");
  assert.ok(paths.includes("README.md"), "README.md must be present");
  assert.ok(paths.includes("LICENSE"), "LICENSE must be present");

  // Cover image is optional until a maintainer provides one.
  if (existsSync(`${root}/assets/cover.jpg`)) {
    assert.ok(paths.includes("assets/cover.jpg"), "assets/cover.jpg must be present when it exists");
  }

  // Icon must NOT ship (it's a repo-only asset for GitHub previews).
  assert.ok(!paths.includes("assets/icon.png"), "assets/icon.png must not be present");

  // Stub files must NOT ship even if the real asset is missing.
  assert.ok(!paths.includes("assets/cover.jpg.stub"), "assets/cover.jpg.stub must not be present");
  assert.ok(!paths.includes("assets/icon.png.stub"), "assets/icon.png.stub must not be present");
  assert.ok(!paths.some((path) => path.endsWith(".stub")), "no .stub files must be present");

  // Exclude development-only and infrastructure paths.
  assert.ok(!paths.some((path) => path.startsWith("test/")), "test/ must not be present");
  assert.ok(!paths.some((path) => path.startsWith(".github/")), ".github/ must not be present");
  assert.ok(!paths.some((path) => path.startsWith(".env")), ".env* must not be present");
  assert.ok(!paths.includes("dist/"), "dist/ must not be present");
  assert.ok(!paths.includes("node_modules/"), "node_modules/ must not be present");
});
