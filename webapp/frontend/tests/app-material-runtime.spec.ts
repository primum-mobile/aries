// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import { expect, test } from "@playwright/test";

import {
  APP_MATERIAL_PREVIEW_SCOPE_SELECTOR,
  appMaterialStyleSheet,
  compileThemeAppMaterials,
  resolveSimpleCssValue,
} from "../src/lib/theme/app-material-runtime";

const TOKENS = {
  "--aries-background": "rgb(246 244 237)",
  "--aries-text-primary": "rgb(30 34 38)",
  "--aries-text-muted": "rgb(80 84 88)",
  "--aries-surface": "rgb(235 232 222)",
  "--aries-surface-subtle": "rgb(224 220 208)",
  "--aries-sidebar-background": "var(--aries-surface)",
  "--aries-sidebar-text": "var(--aries-text-primary)",
  "--aries-titlebar-background": "var(--aries-background)",
  "--aries-titlebar-text": "var(--aries-text-primary)",
  "--aries-statusbar-background": "var(--aries-background)",
  "--aries-panel-background": "var(--aries-surface)",
  "--aries-panel-text": "var(--aries-text-primary)",
  "--aries-overlay-background": "var(--aries-surface)",
  "--aries-overlay-text": "var(--aries-text-primary)",
  "--aries-popover-background": "var(--aries-background)",
  "--aries-popover-text": "var(--aries-text-primary)",
  "--aries-control-background": "var(--aries-surface-subtle)",
  "--aries-control-text": "var(--aries-text-primary)",
  "--aries-data-body-background": "var(--aries-background)",
  "--aries-data-body-text": "var(--aries-text-primary)",
  "--aries-data-header-background": "var(--aries-surface)",
  "--aries-data-header-text": "var(--aries-text-primary)",
} as const;

test("untouched app materials retain every semantic surface color", () => {
  const compiled = compileThemeAppMaterials({}, TOKENS);
  expect(compiled.byClass["surfaces.canvas"].backgroundColor)
    .toBe("rgb(246 244 237 / 1)");
  expect(compiled.byClass.sidebar.backgroundColor)
    .toBe("rgb(235 232 222 / 1)");
  expect(compiled.byClass.control.backgroundColor)
    .toBe("rgb(224 220 208 / 1)");
  expect(compiled.byClass.dataHeader.backgroundColor)
    .toBe("rgb(235 232 222 / 1)");
});

test("simple CSS variable chains resolve against live token overrides safely", () => {
  const tokens = {
    "--surface": "var(--base)",
    "--base": "rgb(12 34 56)",
    "--cycle-a": "var(--cycle-b)",
    "--cycle-b": "var(--cycle-a, #abcdef)",
  };
  expect(resolveSimpleCssValue("var(--surface)", tokens))
    .toBe("rgb(12 34 56)");
  expect(resolveSimpleCssValue("var(--cycle-a)", tokens)).toBe("#abcdef");
  expect(resolveSimpleCssValue("calc(1px + var(--base))", tokens))
    .toBe("calc(1px + var(--base))");
});

test("unresolved color-mix surface values use the reviewed semantic fallback", () => {
  const compiled = compileThemeAppMaterials({}, {
    ...TOKENS,
    "--aries-inspector-background":
      "color-mix(in srgb, var(--aries-background) 75%, transparent)",
  });
  expect(compiled.byClass.inspector.backgroundColor)
    .toBe("rgb(235 232 222 / 1)");
});

test("global material colors inherit unless a surface explicitly overrides", () => {
  const compiled = compileThemeAppMaterials({
    "authoring.app.materials.global.backgroundColor": [238, 234, 222],
    "authoring.app.materials.global.patternColor": [35, 39, 43],
    "authoring.app.materials.global.pattern": "paper",
    "authoring.app.sidebar.backgroundColor": [220, 224, 214],
  }, TOKENS);
  expect(compiled.byClass.panel.backgroundColor)
    .toBe("rgb(238 234 222 / 1)");
  expect(compiled.byClass.sidebar.backgroundColor)
    .toBe("rgb(220 224 214 / 1)");
  expect(compiled.byClass.panel.recipe.pattern).toBe("paper");
});

test("runtime stylesheet covers retained surfaces and one table row-group layer", () => {
  const css = appMaterialStyleSheet(
    compileThemeAppMaterials({
      "authoring.app.materials.global.pattern": "blueNoise",
      "authoring.app.materials.global.density": 22,
      "authoring.app.materials.global.seed": 91,
    }, TOKENS),
  );
  expect(css).toContain('[data-aries-surface="canvas"]');
  expect(css).toContain('[data-aries-surface="popover"]');
  expect(css).toContain(".aries-list > thead");
  expect(css).toContain(".aries-list > tbody");
  expect(css).toContain(".aries-table > thead");
  expect(css).toContain(".aries-table > tbody");
  expect(css).not.toContain(".aries-list-head");
  expect(css).not.toContain(".aries-list-cell");
  expect(css).not.toContain(".aries-table-head-cell");
  expect(css).not.toContain(".aries-table-cell");
  expect(css).not.toContain(".aries-table-row");
  expect(css).toContain("--aries-material-background:");
  expect(css).toContain(
    "background-color:var(--aries-material-state-background,",
  );
  expect(css).toContain("@media (prefers-reduced-transparency:reduce)");
  expect(css).toContain("@media (prefers-contrast:more)");
  expect(css).toContain("@media (forced-colors:active)");
  expect(css).toContain("background-image:none");
});

test("runtime stylesheet accepts only the reviewed preview scope", () => {
  const compiled = compileThemeAppMaterials({}, TOKENS);
  expect(
    appMaterialStyleSheet(
      compiled,
      APP_MATERIAL_PREVIEW_SCOPE_SELECTOR,
    ),
  ).toContain(APP_MATERIAL_PREVIEW_SCOPE_SELECTOR);
  expect(() =>
    appMaterialStyleSheet(
      compiled,
      'body{}@import url("https://example.invalid");x',
    )
  ).toThrow("unreviewed app material stylesheet scope");
});
