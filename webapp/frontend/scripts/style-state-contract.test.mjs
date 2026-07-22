import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  normalizeOptionsStyleIdentity,
  normalizeThemeState,
  styleRevisionKey,
} from "../src/lib/theme/style-state.mjs";

const frontendRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const legacyTheme = {
  activePreset: "Midnight",
  mode: "dark",
  version: 7,
  paletteHash: "legacy-hash",
  appTokens: { "--aries-background": "rgb(35 36 40)" },
  chartPalette: { "--morinus-frame": "rgb(220 220 221)" },
};

test("legacy cached ThemeState receives compatible style identity", () => {
  const normalized = normalizeThemeState(legacyTheme);
  assert.ok(normalized);
  assert.equal(normalized.schemaVersion, 1);
  assert.equal(normalized.styleRevision, 7);
  assert.equal(normalized.styleHash, "legacy-hash");
  assert.equal(styleRevisionKey(normalized), "1:7:legacy-hash");
  assert.equal(normalized.activeProfile, null);
  assert.deepEqual(normalized.profileOverrides, { appTokens: {}, chartPalette: {}, chartData: {} });
});

test("current ThemeState preserves explicit style identity", () => {
  const normalized = normalizeThemeState({
    ...legacyTheme,
    schemaVersion: 2,
    styleRevision: 11,
    styleHash: "style-hash",
    chartPalette: {
      "--morinus-background": "rgb(8 9 10)",
      "--morinus-text-bright": "rgb(240 241 242)",
    },
    activeProfile: {
      id: "studio",
      name: "Studio",
      scope: "combined",
      basePresetId: "Midnight",
      contentHash: "profile-hash",
    },
    profileOverrides: {
      appTokens: { "--aries-surface": "rgb(12 13 14)" },
      chartPalette: { "--morinus-frame": "rgb(210 211 212)" },
      chartData: { aspects: ["rgb(1 2 3)"] },
    },
  });
  assert.ok(normalized);
  assert.equal(styleRevisionKey(normalized), "2:11:style-hash");
  assert.deepEqual(normalized.chartPalette, {
    "--morinus-background": "rgb(8 9 10)",
    "--morinus-text-bright": "rgb(240 241 242)",
  });
  assert.equal(normalized.activeProfile.id, "studio");
  assert.deepEqual(normalized.profileOverrides.chartPalette, {
    "--morinus-frame": "rgb(210 211 212)",
  });
  assert.deepEqual(normalized.profileOverrides.chartData, {
    aspects: ["rgb(1 2 3)"],
  });
});

test("legacy options.changed event receives compatible style identity", () => {
  assert.deepEqual(
    normalizeOptionsStyleIdentity({
      themeVersion: 9,
      paletteHash: "event-hash",
    }),
    {
      schemaVersion: 1,
      themeVersion: 9,
      styleRevision: 9,
      paletteHash: "event-hash",
      styleHash: "event-hash",
    },
  );
});

test("invalid cached ThemeState is rejected", () => {
  assert.equal(normalizeThemeState({ mode: "dark" }), null);
});

test("the programmatic chart focus anchor never paints a native WKWebView outline", () => {
  const source = readFileSync(
    resolve(frontendRoot, "src/components/workshell/workspace-content.tsx"),
    "utf8",
  );
  const anchorIndex = source.indexOf('data-workspace-focus-anchor=""');
  assert.notEqual(anchorIndex, -1, "workspace focus anchor is missing");
  const tagStart = source.lastIndexOf("<div", anchorIndex);
  const tagEnd = source.indexOf(">", anchorIndex);
  const anchorTag = source.slice(tagStart, tagEnd);
  assert.match(anchorTag, /className="[^"]*\boutline-none\b[^"]*"/);
  assert.match(source, /chartPaneElement\.focus\(\{ preventScroll: true \}\)/);
});
