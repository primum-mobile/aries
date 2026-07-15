import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { buildStyleTokenInventory } from "./style-token-contract.mjs";

const frontendRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("the checked-in style contract resolves one provider graph", () => {
  const result = buildStyleTokenInventory(frontendRoot);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.inventory.counts, {
    tokens: 340,
    cssTokens: 329,
    cssDeclarations: 394,
    runtimeOnlyTokens: 7,
    externalTokens: 4,
    public: 64,
    derived: 141,
    runtime: 135,
  });
  assert.deepEqual(
    result.inventory.tokens.filter((token) => token.runtimeProviderFiles).map((token) => token.name),
    [
      "--aries-navbar-scale",
      "--right-pane-min-content-width",
      "--right-pane-preferred-width",
      "--right-pane-width",
      "--sidebar-width",
      "--sidebar-width-icon",
      "--skeleton-width",
    ],
  );
  assert.deepEqual(result.publicManifest.counts, {
    public: 64,
    editable: 62,
    blockedByCoupling: 2,
    supportingDerived: 3,
  });
  assert.deepEqual(
    result.publicManifest.tokens.filter(({ handoffStatus }) => handoffStatus === "blocked-by-coupling").map(({ cssVar }) => cssVar),
    ["--aries-background", "--aries-text-primary"],
  );
  assert.deepEqual(
    result.publicManifest.derivedContext.map(({ cssVar }) => cssVar),
    ["--aries-radius-lg", "--aries-radius-sm", "--aries-radius-xs"],
  );
  assert.ok(result.publicManifest.authoringExclusions.some(({ id }) => id === "shell-motion"));
  for (const token of result.publicManifest.tokens) {
    assert.ok(token.description.length > 12, `${token.cssVar} needs an authoring description`);
    assert.ok(token.editTarget.includes("webapp/"), `${token.cssVar} needs an exact edit target`);
    assert.ok(token.affectedSurfaces.length > 0, `${token.cssVar} needs affected surfaces`);
  }
  for (const [name, unit] of [
    ["--aries-ephem-frame-small-max", "px"],
    ["--aries-ephem-frame-medium-max", "px"],
    ["--aries-ephem-text-font-divisor", ""],
    ["--aries-table-cell-x", "px"],
    ["--aries-table-cell-y", "px"],
    ["--aries-table-font-size", "px"],
    ["--aries-table-header-height", "px"],
    ["--aries-table-row-height", "px"],
  ]) {
    const token = result.inventory.tokens.find((entry) => entry.name === name);
    assert.equal(token?.type, "number", `${name} must remain numeric`);
    assert.equal(token?.unit, unit, `${name} must preserve its unit`);
  }
  for (const name of [
    "--aries-ambient-spotlight-hover",
    "--aries-sidebar-row-active",
    "--aries-sidebar-row-hover",
    "--aries-sidebar-row-soft",
    "--aries-sidebar-row-strong",
  ]) {
    const token = result.inventory.tokens.find((entry) => entry.name === name);
    assert.equal(token?.type, "color", `${name} must remain a color`);
    assert.equal(token?.unit, "", `${name} must not carry a numeric unit`);
  }
  for (const name of [
    "--aries-panel-padding-x",
    "--aries-panel-padding-y",
    "--aries-section-gap",
  ]) {
    const token = result.inventory.tokens.find((entry) => entry.name === name);
    assert.equal(token?.class, "runtime", `${name} is migration-only until Wave 2 wiring`);
    assert.deepEqual(token?.consumerFiles, [], `${name} must not count legacy preview iterators as live consumers`);
    assert.deepEqual(token?.legacyConsumerFiles, [
      "src/components/workshell/appearance-panel.tsx",
      "src/components/workshell/style-token-bridge.tsx",
    ]);
  }
  const uiScale = result.inventory.tokens.find(({ name }) => name === "--aries-ui-scale");
  assert.equal(uiScale?.class, "runtime", "UI scale remains migration/runtime until it scales the complete system");
  assert.deepEqual(uiScale?.consumerFiles, ["src/app/globals.css"]);
  for (const name of ["--anchor-width", "--available-height", "--transform-origin", "--spacing"]) {
    const token = result.inventory.tokens.find((entry) => entry.name === name);
    assert.equal(token?.class, "runtime");
    assert.match(token?.provider ?? "", /^external-/);
  }
  for (const token of result.inventory.tokens.filter(({ family }) => family.startsWith("platform."))) {
    assert.equal(token.class, "derived", `${token.name} must be a non-public platform projection`);
    assert.ok(token.dependencies.length > 0, `${token.name} must point outward`);
  }
  const compatibilityAlias = /var\(\s*(--(?!aries-|morinus-)[a-z0-9-]+)/g;
  for (const token of result.inventory.tokens.filter(({ name }) => name.startsWith("--aries-"))) {
    for (const declaration of token.declarations) {
      assert.equal(
        [...declaration.value.matchAll(compatibilityAlias)].length,
        0,
        `${token.name} must derive from canonical Aries/Morinus tokens`,
      );
    }
  }
});

test("a derived-token cycle is rejected", () => {
  withTemporaryFrontend((temporaryRoot) => {
    const cssPath = join(temporaryRoot, "src", "app", "globals.css");
    const css = readFileSync(cssPath, "utf8").replace(
      "--aries-focus-ring: var(--aries-text-muted);",
      "--aries-focus-ring: var(--aries-focus-ring);",
    );
    writeFileSync(cssPath, css, "utf8");
    const result = buildStyleTokenInventory(temporaryRoot);
    assert.ok(result.errors.some(({ message }) => message.includes("dependency cycle")));
  });
});

test("a runtime-only token without its React provider is rejected", () => {
  withTemporaryFrontend((temporaryRoot) => {
    const providerPath = join(
      temporaryRoot,
      "src",
      "components",
      "workshell",
      "workspace-content.tsx",
    );
    const source = readFileSync(providerPath, "utf8").replace(
      '"--aries-navbar-scale": navbarScale.toFixed(3)',
      '"--removed-navbar-scale": navbarScale.toFixed(3)',
    );
    writeFileSync(providerPath, source, "utf8");
    const result = buildStyleTokenInventory(temporaryRoot);
    assert.ok(result.errors.some(({ message }) => message.includes("lacks its concrete React provider")));
  });
});

test("an unclassified Base UI or Tailwind shorthand token is rejected", () => {
  withTemporaryFrontend((temporaryRoot) => {
    const sourcePath = join(temporaryRoot, "src", "components", "ui", "context-menu.tsx");
    const source = readFileSync(sourcePath, "utf8").replace(
      "max-h-(--available-height)",
      "max-h-(--missing-floating-height)",
    );
    writeFileSync(sourcePath, source, "utf8");
    const result = buildStyleTokenInventory(temporaryRoot);
    assert.ok(result.errors.some(({ message }) => message.includes("undefined style token --missing-floating-height")));
  });
});

test("platform aliases cannot cycle inward", () => {
  withTemporaryFrontend((temporaryRoot) => {
    const cssPath = join(temporaryRoot, "src", "app", "globals.css");
    const css = readFileSync(cssPath, "utf8").replace(
      "--background: var(--aries-background);",
      "--background: var(--background);",
    );
    writeFileSync(cssPath, css, "utf8");
    const result = buildStyleTokenInventory(temporaryRoot);
    assert.ok(result.errors.some(({ message }) => message.includes("dependency cycle")));
  });
});

test("app tokens cannot derive from Morinus palette tokens", () => {
  withTemporaryFrontend((temporaryRoot) => {
    const cssPath = join(temporaryRoot, "src", "app", "globals.css");
    const css = readFileSync(cssPath, "utf8").replace(
      "var(--aries-border-strong) 64%",
      "var(--morinus-frame) 64%",
    );
    writeFileSync(cssPath, css, "utf8");
    const result = buildStyleTokenInventory(temporaryRoot);
    assert.ok(result.errors.some(({ message }) => message.includes("crosses from app styling into Morinus styling")));
  });
});

test("every public token requires complete authored metadata", () => {
  withTemporaryFrontend((temporaryRoot) => {
    const contractPath = join(temporaryRoot, "src", "styles", "style-token-contract.json");
    const contract = JSON.parse(readFileSync(contractPath, "utf8"));
    delete contract.publicTokens["--aries-destructive"].description;
    writeFileSync(contractPath, `${JSON.stringify(contract, null, 2)}\n`, "utf8");
    const result = buildStyleTokenInventory(temporaryRoot);
    assert.ok(result.errors.some(({ message }) => message.includes("--aries-destructive public metadata is missing description")));
  });
});

test("relational defaults reject an inverted radius scale", () => {
  withTemporaryFrontend((temporaryRoot) => {
    const cssPath = join(temporaryRoot, "src", "app", "globals.css");
    const css = readFileSync(cssPath, "utf8").replace(
      "--aries-radius-xs: calc(var(--aries-radius-md) / 3);",
      "--aries-radius-xs: calc(var(--aries-radius-md) * 1.5);",
    );
    writeFileSync(cssPath, css, "utf8");
    const result = buildStyleTokenInventory(temporaryRoot);
    assert.ok(result.errors.some(({ message }) => message.includes("app.radius.order requires")));
  });
});

test("legacy editor defaults must match the recursively resolved root fallback", () => {
  withTemporaryFrontend((temporaryRoot) => {
    const legacyPath = join(temporaryRoot, "src", "styles", "style-tokens.ts");
    const source = readFileSync(legacyPath, "utf8").replace(
      "defaultValue: 12,\n    min: 10,",
      "defaultValue: 13,\n    min: 10,",
    );
    writeFileSync(legacyPath, source, "utf8");
    const result = buildStyleTokenInventory(temporaryRoot);
    assert.ok(result.errors.some(({ message }) => message.includes("differs from canonical")));
  });
});

test("the StyleTokenId union remains one-to-one with the frozen legacy map", () => {
  withTemporaryFrontend((temporaryRoot) => {
    const legacyPath = join(temporaryRoot, "src", "styles", "style-tokens.ts");
    const source = readFileSync(legacyPath, "utf8").replace(
      '| "fontSizeReading"',
      '| "fontSizeBase"',
    );
    writeFileSync(legacyPath, source, "utf8");
    const result = buildStyleTokenInventory(temporaryRoot);
    assert.ok(result.errors.some(({ message }) => message.includes("duplicate StyleTokenId")));
    assert.ok(result.errors.some(({ message }) => message.includes("is absent from StyleTokenId")));
  });
});

function withTemporaryFrontend(run) {
  const temporaryRoot = mkdtempSync(join(tmpdir(), "aries-style-contract-"));
  try {
    cpSync(join(frontendRoot, "src"), join(temporaryRoot, "src"), { recursive: true });
    run(temporaryRoot);
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}
