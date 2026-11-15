// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
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
    // +24 over the three-profile contract: one independent painted-ring radius
    // token per role for both House Wheel and Cusp Wheel; +7 runtime tokens for
    // the Astrocart navbar docked in the map toolbar row; +3 derived minor-dignity colors;
    // -2 fixed quick-options height caps now owned by available window space;
    // +7 public Astrolabe polar-plate roles (3 colors, 4 metrics);
    // -9 Astrolabe canvas info/PD-row roles now owned by DOM corner overlays.
    // +4 declarations: the phone navbar re-scopes four existing mode-hint
    // sizing tokens to 44 px touch targets (.aries-mode-hint--mobile).
    // +7 declarations: the phone launcher sheet re-scopes four sidebar row and
    // close-action tokens, and the phone title bar three header sizes, to
    // 44 px touch targets.
    // +1 runtime token (2 declarations, night/day): the native-window shadow
    // that browser floating panels carry in place of the OS window shadow.
    // +1 runtime token: --aries-inspector-text-scale (Inspector text size setting).
    // +10 runtime Graphic Ephemeris radix-layer metrics: label column, line
    // and midpoint-line widths and dash, line opacity, ring size and width,
    // label scales.
    // +11 aspect-matrix tokens for the framed-block matrix (chart dashboard
    // module 0): 3 public metrics (section gap, frame and exact widths),
    // 6 derived type/colour roles, 2 runtime (parallel strength, orb line height).
    // +3 shared chart-module line tokens (dashboard modules; the aspect-matrix
    // line tokens alias them): 2 public widths, 1 derived rule colour.
    // +1 public app token: --aries-signal (theme signal colour for eclipse paths).
    // +1 public app token: --aries-inspector-own-glyph-opacity (inspected glyph fade).
    // +6 public Astrolabe star roles: faint-star colour and opacity, bright
    // (glyph) limit, magnitude exponent and the size clamp.
    // +25 public Astrolabe zoom roles: 23 annotation metrics, zoomed house
    // ink and the conjunction cue colour; +4 star/label zoom-curve roles.
    // +11 public Astrolabe zodiac-division roles: sign share of the rete band,
    // term and decan ring widths, ruler glyph scale and minimum, polar box
    // depth and opacity, and the term/decan ring, boundary and glyph colours;
    // +2 for the bare ecliptic (zodiac off): graduation and sign glyph scale.
    // +2 for the polar rim Asc/MC label and fixed-star name scales.
    // -1 public app token: --aries-statusbar-action-size (the status-bar
    // Settings gear moved to the titlebar).
    // +7 for the astrolabe ecliptic engraving: scale ticks and weight,
    // divided band width, box and tick share.
    // +13 runtime graphic-ephemeris plate roles: plate frame, tick and minor
    // tick widths, four ruler tick lengths, tick minimum and spacing, ruler
    // label scale and gap, scale-column pad and label leader gap.
    // +7 runtime graphic-ephemeris lunation roles: line width, dash on/off,
    // disc scale, minimum, maximum and outline width; +4 eclipse corona ray
    // count, inner and outer scale, and lunar eclipse shade opacity.
    // -3 runtime graphic-ephemeris lunation line roles (width, dash on/off):
    // the plates' dotted verticals are month lines, already the grid.
    // -1 runtime graphic-ephemeris plate frame width: no plate box on screen.
    // +1 runtime graphic-ephemeris plate frame width (the paper plate is back).
    // +2 runtime graphic-ephemeris decan limb: width and bar share.
    // +6 graphic-ephemeris instrument plate (net): +32 runtime band, table,
    // gutter, ruler, font, curve-weight, guide and label roles; -26 runtime
    // roles of the old plate (decan limb, planet heads and leaders, station
    // ticks, old size divisors); public curve small/large become inner/outer
    // and the three public station-tick roles go (-3 public).
    // +3 runtime Graphic Ephemeris declination tokens: decan limb width
    // and zebra share, out-of-bounds tint opacity.
    // +3 runtime Graphic Ephemeris reading-line tokens: line width and
    // opacity, date-tag padding.
    // +2 runtime Graphic Ephemeris planet-contact tokens: aspect glyph size
    // and its paper knock-out.
    // +10 runtime Graphic Ephemeris radix tokens (net): angle line, outer
    // width, band, focus and recede, contour and reading-glyph roles.
    // +1 derived app token: --aries-sidebar-row-selected-chart (tinted fill of
    // the selected chart row in the sidebar).
    // +2 runtime Graphic Ephemeris tokens: the pinned natal line's recede
    // fade duration and its pause before the fade.
    // +1 runtime Graphic Ephemeris token: the declination turn dot's size.
    tokens: 1646,
    cssTokens: 1621,
    cssDeclarations: 1727,
    runtimeOnlyTokens: 15,
    externalTokens: 10,
    public: 1162,
    derived: 210,
    runtime: 274,
  });
  const printPalettePath = "src/lib/theme/table-print-palette.ts";
  const printRoles = [...readFileSync(join(frontendRoot, printPalettePath), "utf8")
    .matchAll(/"(--morinus-[^"]+)":/g)].map((match) => match[1]).sort();
  assert.ok(printRoles.length > 0, "the fixed paper palette must declare semantic roles");
  assert.deepEqual(
    result.inventory.tokens
      .filter((token) => token.runtimeProviderFiles?.includes(printPalettePath))
      .map((token) => token.name),
    printRoles,
    "the inventory must include every fixed print-palette provider",
  );
  assert.deepEqual(
    result.inventory.tokens
      .filter((token) => token.runtimeProviderFiles?.some((path) => path !== printPalettePath))
      .map((token) => token.name),
    [
      // Design Lab mockup overrides are owner tooling and are never recorded.
      // The sidebar text-size setting rescales the nav and sidebar row metrics at runtime (app-sidebar.tsx).
      "--aries-control-gap-compact",
      "--aries-control-height",
      "--aries-destructive",
      "--aries-font-size-nav",
      "--aries-font-size-nav-section",
      "--aries-inspector-text-scale",
      "--aries-nav-side-margin",
      "--aries-navbar-dock-bg",
      "--aries-navbar-dock-border",
      "--aries-navbar-dock-height",
      "--aries-navbar-dock-left",
      "--aries-navbar-dock-radius",
      "--aries-navbar-dock-room",
      "--aries-navbar-dock-top",
      "--aries-navbar-scale",
      "--aries-sidebar-action-icon-size",
      "--aries-sidebar-close-action-size",
      "--aries-sidebar-close-inset",
      "--aries-sidebar-drop-indicator-overhang",
      "--aries-sidebar-drop-indicator-size",
      "--aries-sidebar-group-padding-end",
      "--aries-sidebar-group-padding-start",
      "--aries-sidebar-row-height",
      "--aries-sidebar-row-line-box",
      "--aries-sidebar-row-padding-x",
      "--aries-sidebar-row-padding-y",
      "--aries-sidebar-section-header-height",
      "--aries-sidebar-section-line-box",
      "--aries-sidebar-trailing-inset",
      "--aries-sidebar-tree-indent",
      "--aries-sidebar-unsaved-indicator-size",
      "--morinus-angles",
      "--morinus-aspect-conjunction",
      "--morinus-background",
      "--morinus-body-sun",
      "--morinus-frame",
      "--morinus-houses",
      "--morinus-positions",
      "--morinus-signs",
      "--morinus-text-bright",
      "--right-pane-min-content-width",
      "--right-pane-preferred-width",
      "--right-pane-width",
      "--sidebar-width",
      "--sidebar-width-icon",
      "--skeleton-width",
    ],
  );
  assert.deepEqual(result.publicManifest.counts, {
    public: 1162,
    editable: 1162,
    blockedByCoupling: 0,
    supportingDerived: 11,
  });
  for (const name of [
    "--aries-wheel-anglo-arrow-inset",
    "--aries-wheel-anglo-arrow-maximum",
  ]) {
    const token = result.inventory.tokens.find((candidate) => candidate.name === name);
    assert.equal(token?.type, "number", name);
    assert.equal(token?.unit, "", `${name} is a normalized wheel ratio`);
  }
  assert.deepEqual(
    result.publicManifest.tokens.filter(({ handoffStatus }) => handoffStatus === "blocked-by-coupling").map(({ cssVar }) => cssVar),
    [],
  );
  assert.deepEqual(
    result.publicManifest.derivedContext.map(({ cssVar }) => cssVar),
    [
      "--aries-control-height-compact",
      "--aries-radius-2xs",
      "--aries-radius-control",
      "--aries-radius-control-compact",
      "--aries-radius-lg",
      "--aries-radius-sm",
      "--aries-radius-xl",
      "--aries-radius-xs",
      "--aries-sidebar-sash-rule",
      "--aries-titlebar-seam-rule",
      "--morinus-text-dim",
    ],
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
    ["--aries-ephem-text-font-scale", ""],
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
    assert.equal(token?.class, "public", `${name} must remain profile-editable after retained-panel wiring`);
    assert.ok(token?.consumerFiles.includes("src/app/globals.css"), `${name} must have a non-preview live consumer`);
    assert.deepEqual(token?.legacyConsumerFiles, [
      "src/components/workshell/appearance-panel.tsx",
      "src/components/workshell/style-token-bridge.tsx",
    ]);
  }
  const sectionGap = result.inventory.tokens.find(({ name }) => name === "--aries-section-gap");
  assert.ok(
    sectionGap?.consumerFiles.includes("src/components/workshell/settings-dialog.tsx"),
    "the public panel section gap must reach the reusable Settings section stack",
  );
  const headerSize = result.inventory.tokens.find(({ name }) => name === "--aries-font-size-header");
  assert.ok(
    headerSize?.consumerFiles.includes("src/components/workshell/appearance-panel.tsx"),
    "direct token uses inside the legacy editor must still count as live consumers",
  );
  for (const dependent of [
    "--aries-form-section-gap",
    "--aries-inspector-section-gap",
    "--aries-pane-title-gap",
    "--aries-sheet-content-gap",
  ]) {
    const token = result.inventory.tokens.find(({ name }) => name === dependent);
    assert.ok(
      token?.dependencies.includes("--aries-section-gap"),
      `${dependent} must inherit the global retained-panel rhythm by default`,
    );
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

test("generated manifests are stable across CRLF checkouts", () => {
  withTemporaryFrontend((temporaryRoot) => {
    const baseline = buildStyleTokenInventory(temporaryRoot);
    assert.deepEqual(baseline.errors, []);
    const cssPath = join(temporaryRoot, "src", "app", "globals.css");
    const css = readFileSync(cssPath, "utf8").replace(/\r?\n/g, "\r\n");
    writeFileSync(cssPath, css, "utf8");

    const result = buildStyleTokenInventory(temporaryRoot);
    assert.deepEqual(result.errors, []);
    assert.equal(result.rendered, baseline.rendered);
    assert.equal(result.publicRendered, baseline.publicRendered);
  });
});

test("integrity accepts CRLF generated artifacts", () => {
  withTemporaryFrontend((temporaryRoot) => {
    for (const name of ["style-token-inventory.generated.json", "style-token-public.generated.json"]) {
      const path = join(temporaryRoot, "src", "styles", name);
      const source = readFileSync(path, "utf8").replace(/\r?\n/g, "\r\n");
      writeFileSync(path, source, "utf8");
    }

    const result = spawnSync(
      process.execPath,
      [join(frontendRoot, "scripts", "style-token-integrity.mjs"), "--frontend-root", temporaryRoot],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  });
});

// Exercise the packaging CLI, including its read-only behavior, rather than
// just the inventory builder: usage metadata must not become a release gate.
test("new consumers of existing tokens do not block packaging or rewrite artifacts", () => {
  withTemporaryFrontend((root) => {
    const inventoryPath = join(root, "src/styles/style-token-inventory.generated.json");
    const before = readFileSync(inventoryPath, "utf8");
    writeFileSync(join(root, "src/components/token-consumer.tsx"),
      'export const color = "var(--aries-text-muted)";\n');
    const result = runIntegrity(root);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /usage index: source locations changed/);
    assert.equal(readFileSync(inventoryPath, "utf8"), before);
  });
});

for (const [artifact, mutate] of [
  ["style-token-inventory.generated.json", (data) => { data.tokens[0].default = "invalid"; }],
  ["style-token-public.generated.json", (data) => { data.tokens[0].label = "stale label"; }],
]) {
  test(`definition drift still blocks packaging: ${artifact}`, () => {
    withTemporaryFrontend((root) => {
      const path = join(root, "src/styles", artifact);
      const data = JSON.parse(readFileSync(path, "utf8"));
      mutate(data);
      writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
      const result = runIntegrity(root);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /drifted/);
    });
  });
}

test("undefined live tokens fail both checking and generation without overwriting artifacts", () => {
  withTemporaryFrontend((root) => {
    const paths = ["style-token-inventory.generated.json", "style-token-public.generated.json"]
      .map((name) => join(root, "src/styles", name));
    const before = paths.map((path) => readFileSync(path, "utf8"));
    writeFileSync(join(root, "src/components/token-consumer.tsx"),
      'export const color = "var(--missing-packaging-token)";\n');
    for (const args of [[], ["--write-inventory"]]) {
      const result = runIntegrity(root, args);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /undefined style token --missing-packaging-token/);
      assert.deepEqual(paths.map((path) => readFileSync(path, "utf8")), before);
    }
  });
});

function runIntegrity(root, args = []) {
  return spawnSync(process.execPath,
    [join(frontendRoot, "scripts/style-token-integrity.mjs"), "--frontend-root", root, ...args],
    { encoding: "utf8" });
}

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
    normalizeTreeNewlines(join(temporaryRoot, "src"));
    run(temporaryRoot);
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

function normalizeTreeNewlines(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      normalizeTreeNewlines(path);
    } else if (/\.(?:css|json|[cm]?[jt]sx?)$/.test(entry.name)) {
      const source = readFileSync(path, "utf8");
      writeFileSync(path, source.replace(/\r\n?/g, "\n"), "utf8");
    }
  }
}
