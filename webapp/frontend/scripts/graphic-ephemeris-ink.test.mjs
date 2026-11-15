// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

// Ink modes: "planets" is each body's own theme colour in every theme (also
// when the theme turns the wheel's planet colours off), dignity colours only
// under "dignity", and a stored legacy "chart" seeds the default.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { build } from "esbuild";

const bundle = await build({
  stdin: {
    contents: [
      "export { ephemerisPlanetInk } from './src/lib/chart/ephemeris-ink';",
      "export { createEphemerisRenderStyle } from './src/lib/chart/ephemeris-render-style';",
    ].join("\n"),
    resolveDir: process.cwd(),
  },
  bundle: true, write: false, format: "esm", platform: "node", logLevel: "silent",
  alias: { "@": "./src" },
});
const { ephemerisPlanetInk, createEphemerisRenderStyle } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString("base64")}`
);

const base = createEphemerisRenderStyle({});
const style = createEphemerisRenderStyle({
  colors: {
    ...base.colors,
    paper: "#ffffff",
    ink: "#101010",
    muted: "#606060",
    bodies: ["#c00000", "#0000c0", "#007000", "", "", "", "", "", "", "", "", "", ""],
    dignity: { ...base.colors.dignity, domicile: "#008000", exaltation: "#806000", peregrine: "#505050" },
  },
});
const sun = { id: 0, glyph: "a", color: "#999999" };
// The Sun in Leo (sign 4) is in its domicile.
const dignityBySign = { 0: Array.from({ length: 12 }, (_, i) => (i === 4 ? "domicile" : "peregrine")) };

test("planet colours ignore the theme's planet-colour switch; dignity only in dignity mode", () => {
  for (const usePlanetColors of [true, false]) {
    const planets = { inkMode: "planets", usePlanetColors, dignityBySign };
    for (let sign = 0; sign < 12; sign++) assert.equal(ephemerisPlanetInk(sun, sign, planets, style), "#c00000");
    const dignity = { inkMode: "dignity", usePlanetColors, dignityBySign };
    assert.equal(ephemerisPlanetInk(sun, 4, dignity, style), "#008000");
    assert.equal(ephemerisPlanetInk(sun, 0, dignity, style), "#505050");
  }
});

test("a stored legacy chart ink seeds the planet-colour default", async () => {
  const view = await readFile(new URL("../src/components/workshell/graph-ephemeris-view.tsx", import.meta.url), "utf8");
  assert.match(view, /const EPHEMERIS_INK_MODES: readonly EphemerisInkMode\[\] = \["tiers", "planets", "dignity"\];/);
  assert.match(view, /const DEFAULT_EPHEMERIS_INK_MODE: EphemerisInkMode = "planets";/);
  assert.doesNotMatch(view, /\bchart: "ephem\.ink/);
});
