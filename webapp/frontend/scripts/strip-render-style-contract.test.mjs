// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const styleSource = await readFile(
  new URL("../src/lib/chart/strip-render-style.ts", import.meta.url),
  "utf8",
);
const styleJavascript = ts.transpileModule(styleSource, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const {
  DEFAULT_STRIP_RENDER_PALETTE,
  DEFAULT_STRIP_RENDER_TOKENS,
  STRIP_RENDER_BASE_PALETTE_ROLES,
  STRIP_RENDER_PALETTE_SPECS,
  STRIP_RETAINED_APP_PALETTE_ROLES,
  STRIP_RENDER_TOKEN_SPECS,
  createStripRenderStyle,
  resolveStripRenderPalette,
  resolveStripRenderStyle,
  resolveStripRenderTokens,
} = await import(
  `data:text/javascript;base64,${Buffer.from(styleJavascript).toString("base64")}`
);

const EXPECTED_DEFAULTS = {
  fontSize: 21,
  emptyFontSize: 12,
  notesFontSize: 11,
  border: 20,
  collisionGapScale: 0.2,
  planetOffsetScale: 0.4,
  connectorLengthScale: 0.7,
  longTickScale: 2 / 3,
  fiveTickScale: 0.7,
  oneTickScale: 0.4,
  tickStepScale: 4 / 3,
  degreeLabelOffsetScale: 0.2,
  textGlyphWidthScale: 0.62,
  axisStrokeWidth: 1,
  connectorStrokeWidth: 1,
  containerPadding: 16,
  notesGap: 12,
};

test("the schema-v1 defaults preserve all 17 established Strip inputs", () => {
  assert.equal(Object.keys(STRIP_RENDER_TOKEN_SPECS).length, 17);
  assert.equal(new Set(Object.values(STRIP_RENDER_TOKEN_SPECS).map(([name]) => name)).size, 17);
  assert.deepEqual(DEFAULT_STRIP_RENDER_TOKENS, EXPECTED_DEFAULTS);
  assert.ok(Object.isFrozen(STRIP_RENDER_TOKEN_SPECS));
  assert.ok(Object.values(STRIP_RENDER_TOKEN_SPECS).every(Object.isFrozen));
  assert.deepEqual(DEFAULT_STRIP_RENDER_PALETTE, {
    background: "#232428",
    axis: "#2e2f32",
    textPrimary: "#ffffff",
    textMuted: "#b4b5b6",
  });
  assert.deepEqual(STRIP_RENDER_PALETTE_SPECS, {
    background: ["--aries-strip-background", "#232428"],
    axis: ["--aries-strip-axis", "#2e2f32"],
    textPrimary: ["--aries-strip-text-primary", "#ffffff"],
    textMuted: ["--aries-strip-text-muted", "#b4b5b6"],
  });
  assert.ok(Object.isFrozen(STRIP_RENDER_PALETTE_SPECS));
  assert.ok(Object.values(STRIP_RENDER_PALETTE_SPECS).every(Object.isFrozen));

  const style = createStripRenderStyle();
  assert.equal(style.schemaVersion, 1);
  assert.ok(Object.isFrozen(style));
  assert.ok(Object.isFrozen(style.palette));
  assert.ok(Object.isFrozen(style.typography));
  assert.ok(Object.isFrozen(style.strokes));
  assert.ok(Object.isFrozen(style.layout));
  assert.equal("tokens" in style, false);
});

test("Strip palette authority preserves profile, retained-app, Strip, and hard-fallback precedence", () => {
  assert.deepEqual(STRIP_RETAINED_APP_PALETTE_ROLES, {
    background: "--aries-background",
    axis: "--aries-border-subtle",
    textPrimary: "--aries-text-primary",
    textMuted: "--aries-text-muted",
  });
  const retainedAppValues = new Map([
    ["--aries-background", "retained-app-background"],
    ["--aries-border-subtle", "retained-app-border"],
    ["--aries-text-primary", "retained-app-primary"],
    ["--aries-text-muted", "retained-app-muted"],
    ["--aries-strip-background", "lower-priority-strip-background"],
    ["--aries-strip-axis", "lower-priority-strip-axis"],
    ["--aries-strip-text-primary", "lower-priority-strip-primary"],
    ["--aries-strip-text-muted", "lower-priority-strip-muted"],
  ]);
  const requested = [];
  const readRetainedApp = (name) => {
    requested.push(name);
    return retainedAppValues.get(name) ?? "";
  };
  const inactive = resolveStripRenderPalette((name) => {
    return readRetainedApp(name);
  });
  assert.deepEqual(inactive, {
    background: "retained-app-background",
    axis: "retained-app-border",
    textPrimary: "retained-app-primary",
    textMuted: "retained-app-muted",
  });
  assert.deepEqual(new Set(requested), new Set(Object.values(STRIP_RETAINED_APP_PALETTE_ROLES)));

  const genericChartProfile = {
    "--morinus-background": "profile-chart-background",
    "--morinus-frame": "profile-chart-axis",
    "--morinus-text-bright": "profile-chart-primary",
    "--morinus-text-dim": "profile-chart-muted",
  };
  assert.deepEqual(
    resolveStripRenderPalette(readRetainedApp, genericChartProfile),
    {
      background: "profile-chart-background",
      axis: "profile-chart-axis",
      textPrimary: "profile-chart-primary",
      textMuted: "profile-chart-muted",
    },
  );
  assert.deepEqual(STRIP_RENDER_BASE_PALETTE_ROLES, {
    background: "--morinus-background",
    axis: "--morinus-frame",
    textPrimary: "--morinus-text-bright",
    textMuted: "--morinus-text-dim",
  });

  const explicitStripProfile = {
    ...genericChartProfile,
    "--aries-strip-background": "profile-strip-background",
    "--aries-strip-axis": "profile-strip-axis",
  };
  assert.deepEqual(
    resolveStripRenderPalette(readRetainedApp, explicitStripProfile),
    {
      background: "profile-strip-background",
      axis: "profile-strip-axis",
      textPrimary: "profile-chart-primary",
      textMuted: "profile-chart-muted",
    },
  );

  const stripFallbackValues = new Map([
    ["--aries-strip-background", "strip-background"],
    ["--aries-strip-axis", "strip-axis"],
    ["--aries-strip-text-primary", "strip-primary"],
    ["--aries-strip-text-muted", "strip-muted"],
  ]);
  assert.deepEqual(
    resolveStripRenderPalette((name) => stripFallbackValues.get(name) ?? ""),
    {
      background: "strip-background",
      axis: "strip-axis",
      textPrimary: "strip-primary",
      textMuted: "strip-muted",
    },
  );
  assert.deepEqual(resolveStripRenderPalette(() => "", {}), DEFAULT_STRIP_RENDER_PALETTE);
  assert.deepEqual(resolveStripRenderPalette(readRetainedApp, {}), inactive);
});

test("derived default layout preserves the original 30-degree SVG geometry", () => {
  const style = createStripRenderStyle();
  assert.deepEqual(style.layout, {
    border: 20,
    collisionGap: 4.2,
    planetOffset: 8.4,
    connectorLength: 14.7,
    longTick: 14,
    fiveTick: 14.7,
    oneTick: 8.4,
    tickStep: 28,
    degreeLabelOffset: 4.2,
    axisWidth: 840,
    degreePx: 28,
    axisY: 64.1,
    glyphTop: 20,
    glyphConnectY: 49.4,
    labelY: 82.3,
    stripWidth: 880,
    stripHeight: 124,
    containerPadding: 16,
    notesGap: 12,
  });
  assert.deepEqual(style.strokes, { axis: 1, connector: 1 });
  assert.equal(style.typography.fontSize, 21);
  assert.equal(style.typography.textGlyphWidthScale, 0.62);
});

test("numeric CSS resolution accepts units and rejects unsafe zero divisors", () => {
  const values = new Map([
    ["--aries-strip-font-size", "24px"],
    ["--aries-strip-axis-stroke-width", "0"],
    ["--aries-strip-tick-step-scale", "0"],
    ["--aries-strip-border", "invalid"],
  ]);
  const tokens = resolveStripRenderTokens((name) => values.get(name) ?? "");
  assert.equal(tokens.fontSize, 24);
  assert.equal(tokens.axisStrokeWidth, 0);
  assert.equal(tokens.tickStepScale, EXPECTED_DEFAULTS.tickStepScale);
  assert.equal(tokens.border, EXPECTED_DEFAULTS.border);
  assert.ok(Object.isFrozen(tokens));
});

test("host resolution reads live semantic paint and metrics exactly once", () => {
  const originalWindow = globalThis.window;
  let computedReads = 0;
  const values = new Map([
    ["--aries-strip-background", "live-background"],
    ["--aries-strip-axis", "live-axis"],
    ["--aries-strip-text-primary", "live-primary"],
    ["--aries-strip-text-muted", "live-muted"],
    ["--aries-font-ui", "Live UI"],
    ["--aries-font-symbols", "Live Symbols"],
    ["--aries-strip-font-size", "23px"],
  ]);
  globalThis.window = {
    getComputedStyle: () => {
      computedReads += 1;
      return { getPropertyValue: (name) => values.get(name) ?? "" };
    },
  };
  try {
    const style = resolveStripRenderStyle({}, { revision: "live-2" });
    assert.equal(computedReads, 1);
    assert.equal(style.revision, "live-2");
    assert.deepEqual(style.palette, {
      background: "live-background",
      axis: "live-axis",
      textPrimary: "live-primary",
      textMuted: "live-muted",
    });
    assert.equal(style.typography.fontUi, "Live UI");
    assert.equal(style.typography.fontSymbols, "Live Symbols");
    assert.equal(style.typography.fontSize, 23);

    const active = resolveStripRenderStyle({}, {
      revision: "active-profile",
      profileOverrides: {
        "--morinus-background": "active-chart-background",
        "--morinus-frame": "active-chart-axis",
        "--morinus-text-bright": "active-chart-primary",
      },
    });
    assert.deepEqual(active.palette, {
      background: "active-chart-background",
      axis: "active-chart-axis",
      textPrimary: "active-chart-primary",
      textMuted: "live-muted",
    });
    const deactivated = resolveStripRenderStyle({}, { revision: "deactivated-profile" });
    assert.deepEqual(deactivated.palette, style.palette);
    assert.equal(computedReads, 3);
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

test("one Strip style drives SVG paint, layout, collision, and body-title presentation", async () => {
  const source = await readFile(
    new URL("../src/components/workshell/strip-view.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /useStyleRevision\(\)/);
  assert.match(source, /theme\?\.profileOverrides\.chartPalette/);
  assert.match(source, /profileOverrides: chartProfileOverrides/);
  assert.equal((source.match(/resolveStripRenderStyle\(/g) ?? []).length, 1);
  assert.match(source, /arrangeBodies\(bodies, renderStyle\)/);
  assert.match(source, /requiredSpacingDeg\(placed\[i\], placed\[i \+ 1\], style\)/);
  assert.match(source, /stroke=\{palette\.axis\}/);
  assert.match(source, /fill=\{palette\.textPrimary\}/);
  assert.match(source, /semanticChartColor\([\s\S]*?b\.body\.colorRole,[\s\S]*?b\.body\.colorHex \?\? palette\.textPrimary/);
  assert.match(source, /<title>\{`\$\{b\.body\.label\} \$\{b\.body\.signGlyph\} \$\{b\.body\.minuteLabel\}`\}<\/title>/);
  const componentBody = source.slice(source.indexOf("export function StripView"));
  assert.match(source, /const BOOTSTRAP_STRIP_STYLE = createStripRenderStyle/);
  assert.equal((source.match(/var\(--aries-/g) ?? []).length, 6);
  assert.doesNotMatch(componentBody, /var\(--aries-/);
  for (const appRole of [
    "--aries-background",
    "--aries-border-subtle",
    "--aries-text-primary",
    "--aries-text-muted",
  ]) {
    assert.ok(styleSource.includes(`"${appRole}"`));
    assert.ok(source.includes(`var(${appRole},`));
  }
  assert.doesNotMatch(source, /const FONT_SIZE|const BORDER|const DEG_PX|const STRIP_WIDTH/);
});
