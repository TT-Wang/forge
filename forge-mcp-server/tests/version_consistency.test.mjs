// v0.7.0: lock-step assertion between Server constructor version and
// package.json version. Without this, the Server-version-stale bug
// (which has been independently re-introduced in v0.5.0, v0.6.0, and
// v0.6.1) silently regresses on every release. Reading from package.json
// at module load (FORGE_VERSION constant in index.mjs) is the fix;
// this test ensures the constant stays linked.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoDir = join(__dirname, "..");
const pkg = JSON.parse(readFileSync(join(repoDir, "package.json"), "utf-8"));

test("Server constructor version matches package.json version", () => {
  const index = readFileSync(join(repoDir, "index.mjs"), "utf-8");

  // The Server constructor must reference FORGE_VERSION (not a string literal).
  const constructorMatch = index.match(
    /new\s+Server\s*\(\s*\{\s*name:\s*"forge"\s*,\s*version:\s*([A-Z_]+)\s*\}/
  );
  assert.ok(
    constructorMatch,
    "Server constructor must use a constant identifier for version (not a string literal). " +
      "Hardcoded version strings drift from package.json across releases."
  );

  assert.equal(
    constructorMatch[1],
    "FORGE_VERSION",
    "Server constructor must reference the FORGE_VERSION constant defined at module top."
  );

  // The FORGE_VERSION constant must be derived from package.json.
  assert.ok(
    /const\s+FORGE_VERSION\s*=\s*PACKAGE_JSON\.version/.test(index),
    "FORGE_VERSION must be read from PACKAGE_JSON.version (the package.json read at module load)."
  );

  // Sanity: package.json version is a non-empty semver-ish string.
  assert.match(
    pkg.version,
    /^\d+\.\d+\.\d+/,
    `package.json version "${pkg.version}" must be semver-shaped (X.Y.Z[...])`
  );
});

test("Plugin manifest versions stay in lock-step with package.json", () => {
  // The 4-manifest rule (memem-derived convention, applies to forge too):
  // any version bump must update all of: package.json (this), .claude-plugin/plugin.json,
  // .claude-plugin/marketplace.json (if present). Failures here are easy to forget
  // because the manifests are not imported by the JS code — they're read at install time.
  const pluginManifestPath = join(repoDir, "..", ".claude-plugin", "plugin.json");
  const marketplaceManifestPath = join(
    repoDir,
    "..",
    ".claude-plugin",
    "marketplace.json"
  );

  // plugin.json must exist and match.
  const pluginManifest = JSON.parse(readFileSync(pluginManifestPath, "utf-8"));
  assert.equal(
    pluginManifest.version,
    pkg.version,
    `.claude-plugin/plugin.json version "${pluginManifest.version}" must equal package.json version "${pkg.version}". ` +
      "When bumping versions, update BOTH files in the same commit."
  );

  // marketplace.json is optional but if present must match.
  let marketplaceManifest = null;
  try {
    marketplaceManifest = JSON.parse(readFileSync(marketplaceManifestPath, "utf-8"));
  } catch {
    /* not present in all forge installs — fine */
  }
  if (marketplaceManifest?.plugins?.[0]?.version) {
    assert.equal(
      marketplaceManifest.plugins[0].version,
      pkg.version,
      `.claude-plugin/marketplace.json plugins[0].version "${marketplaceManifest.plugins[0].version}" must equal package.json version "${pkg.version}".`
    );
  }
});
