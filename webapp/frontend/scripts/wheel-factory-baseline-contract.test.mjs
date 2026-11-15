// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later
// Factory preservation is checked against independently captured historical
// output, including the two cusp-based wheels missing from the older goldens.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import ts from "typescript";
import { compositionModuleUrl } from "./wheel-composition-test-loader.mjs";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const factory = JSON.parse(await readFile(
  new URL("../src/lib/chart/wheel-factory-v1.json", import.meta.url), "utf8",
));
const golden = JSON.parse(await readFile(
  new URL("./fixtures/wheel-factory-v1-golden.json", import.meta.url), "utf8",
));
const wheelSource = await readFile(
  new URL("../src/lib/chart/wheel-render-style.ts", import.meta.url), "utf8",
);

function moduleUrl(source) {
  const javascript = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText.replaceAll('"./wheel-composition"', `"${compositionModuleUrl}"`);
  return `data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`;
}

const layoutUrl = moduleUrl(await readFile(
  new URL("../src/lib/chart/wheel-layout-model.ts", import.meta.url), "utf8",
));
const wheel = await import(moduleUrl(wheelSource
  .replaceAll('"./wheel-layout-model"', `"${layoutUrl}"`)));
const { wheelLayoutFamily } = await import(layoutUrl);
const { HISTORICAL_WHEEL_FACTORY_SETTINGS: WHEEL_FACTORY_SETTINGS,
  WHEEL_FACTORY_SETTINGS: activeFactory } = await import(compositionModuleUrl);

const historicalStyle = {...wheel.DEFAULT_WHEEL_RENDER_STYLE, geometry: WHEEL_FACTORY_SETTINGS.geometry};

// Import the real daemon recipe constructor without loading Options, the app,
// or any user settings. One bounded startup read covers the entire matrix.
const activeRecipes = JSON.parse(execFileSync(process.env.PYTHON || (process.platform === "win32" ? "python" : "python3"), ["-c", `
import json
from webapp.daemon.wheel_composition import PROFILES, builtin_composition
recipes = {}
for profile in PROFILES:
    for terms in (False, True):
        for decans in (False, True):
            for houses in (False, True):
                key = '|'.join((profile, str(int(terms)), str(int(decans)), str(int(houses))))
                recipes[key] = builtin_composition(profile, terms=terms, decans=decans, houses=houses)
print(json.dumps(recipes))
`], { cwd: root, encoding: "utf8" }));
const recipes = Object.fromEntries(Object.keys(activeRecipes).map(key => {
  const [profile, terms, decans, houses] = key.split("|");
  const composition = structuredClone(WHEEL_FACTORY_SETTINGS.layouts[profile].composition);
  const flags = {terms: Boolean(Number(terms)) && !["houses", "cusps"].includes(profile),
    decans: Boolean(Number(decans)) && !["houses", "cusps"].includes(profile),
    houses: Boolean(Number(houses))};
  composition.rings = composition.rings.map(ring => ring.archetypeId in flags
    ? {...ring, enabled: flags[ring.archetypeId]} : ring);
  return [key, composition];
}));

const hash = value => createHash("sha256").update(value).digest("hex");
const orderedEntries = value => Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
function sorted(value) {
  if (Array.isArray(value)) return value.map(sorted);
  if (value && typeof value === "object") {
    return Object.fromEntries(orderedEntries(value).map(([key, child]) => [key, sorted(child)]));
  }
  return value;
}

function inputFor(key) {
  const [profile, arrangement, radius, terms, decans, houses, positions] = key.split("|");
  const policy = golden.arrangements[arrangement];
  const composition = recipes[[profile, terms, decans, houses].join("|")];
  const enabled = kind => composition.rings.some(ring => ring.archetypeId === kind && ring.enabled);
  const anglo = ["anglo", "houses", "cusps"].includes(profile);
  return {
    profile,
    mode: policy.mode,
    maxRadius: Number(radius),
    hasOuterRing: policy.hasOuterRing,
    showTerms: enabled("terms"),
    showDecans: enabled("decans"),
    showHouses: enabled("houses"),
    showPositions: Boolean(Number(positions)),
    comparisonWithOuterHouses: !anglo && policy.classicOuterHouses === "showHouses" && enabled("houses"),
    restrainedAngloComparison: anglo && policy.angloTrack === "restrained",
    composition,
  };
}

test("versioned factory geometry is the preserved pre-composition authority", () => {
  assert.equal(factory.schemaVersion, 1);
  assert.equal(factory.factoryVersion, golden.factoryVersion);
  assert.equal(factory.sourceCommit, golden.sourceCommit);
  assert.deepEqual(golden.profiles, ["classic", "compact", "anglo", "houses", "cusps"]);
  assert.deepEqual(Object.keys(factory.geometry), [...golden.profiles, "biwheel"]);
  assert.equal(hash(JSON.stringify(sorted(factory.geometry))), golden.geometrySha256);
  assert.equal(hash(JSON.stringify(sorted(factory.layouts))), golden.layoutsSha256);
  assert.deepEqual(WHEEL_FACTORY_SETTINGS, factory);
  assert.deepEqual(historicalStyle.geometry, factory.geometry);
  assert.ok(Object.isFrozen(wheel.DEFAULT_WHEEL_GEOMETRY_PROFILES));
  for (const [profile, geometry] of Object.entries(historicalStyle.geometry)) {
    assert.equal(geometry, WHEEL_FACTORY_SETTINGS.geometry[profile], `${profile} must consume the shared factory authority`);
    assert.ok(Object.isFrozen(geometry));
  }
});

test("factory definitions preserve each original identity, projection and arrangement", () => {
  for (const [index, profile] of golden.profiles.entries()) {
    const definition = WHEEL_FACTORY_SETTINGS.layouts[profile];
    assert.equal(definition.id, `original-${profile}-v1`);
    assert.equal(definition.optionValue, index);
    assert.equal(definition.geometryProfile, profile);
    assert.equal(definition.projection, profile === "houses" ? "houses" : "zodiac");
    assert.deepEqual(definition.composition, recipes[`${profile}|0|0|1`]);
    assert.deepEqual(definition.arrangements, {
      single: "single",
      auxiliary: "external-overlay",
      transit: ["classic", "compact"].includes(profile) ? "enclosed" : "open",
      synastry: "enclosed",
    });
    assert.ok(Object.isFrozen(definition));
    assert.ok(Object.isFrozen(definition.composition.rings));
  }
});

test("all five historical recipes preserve 960 original arrangement geometries", () => {
  assert.equal(Object.keys(golden.expected).length, 960);
  const coverage = new Map();
  for (const [key, expected] of Object.entries(golden.expected)) {
    const input = inputFor(key);
    assert.equal(input.composition.customized, false, key);
    assert.equal(input.composition.projection, input.profile === "houses" ? "houses" : "zodiac", key);
    const actual = wheel.resolveWheelRingSet(historicalStyle, input);
    if (input.profile === "anglo") {
      // The factory's numeric ring set remains the historical reference. The
      // visible Degree overlay now sits inside Signs, so only its four tick
      // terminals may differ in the composed result.
      const historical = wheel.resolveWheelRingSet(historicalStyle,
        {...input, composition: undefined});
      assert.equal(hash(JSON.stringify(orderedEntries(historical))), expected, `Factory drift: ${key}`);
      const degreeFields = new Set(["rOuter0", "rOuter1", "rOuter5", "rOuter10"]);
      assert.deepEqual(orderedEntries(actual).filter(([field]) => !degreeFields.has(field)),
        orderedEntries(historical).filter(([field]) => !degreeFields.has(field)),
        `Non-degree factory drift: ${key}`);
    } else assert.equal(hash(JSON.stringify(orderedEntries(actual))), expected, `Factory drift: ${key}`);
    const [profile, arrangement] = key.split("|");
    coverage.set(`${profile}|${arrangement}`, (coverage.get(`${profile}|${arrangement}`) ?? 0) + 1);
  }
  assert.equal(coverage.size, 20);
  for (const count of coverage.values()) assert.equal(count, 48);
});

test("active daemon recipes follow version 2 defaults and retain historical geometry", () => {
  assert.equal(activeFactory.factoryVersion, 2);
  for (const profile of golden.profiles) {
    assert.deepEqual(activeRecipes[`${profile}|0|0|1`], activeFactory.layouts[profile].composition);
  }
  assert.equal(activeRecipes["anglo|0|0|1"].rings.find(ring => ring.archetypeId === "degree").enabled, false);
  for (const key of Object.keys(golden.expected)) {
    const input = inputFor(key);
    const [profile, , , terms, decans, houses] = key.split("|");
    const active = {...input, composition: activeRecipes[[profile, terms, decans, houses].join("|")]};
    const actual = wheel.resolveWheelRingSet(historicalStyle, active);
    // The v2 Anglo factory deliberately disables the hosted Degree instrument.
    // That visibility choice leaves every other factory radius unchanged.
    const expected = wheel.resolveWheelRingSet(historicalStyle,
      profile === "anglo" ? {...input, composition: undefined} : input);
    assert.deepEqual(actual, expected, `Active recipe geometry drift: ${key}`);
  }
});

test("original Anglo-family transit stays open while synastry keeps its separate arrangement", () => {
  for (const profile of ["anglo", "houses", "cusps"]) {
    const singleInput = inputFor(`${profile}|single|400|0|0|1|1`);
    const transitInput = inputFor(`${profile}|transit|400|0|0|1|1`);
    const synastryInput = inputFor(`${profile}|synastry|400|0|0|1|1`);
    const single = wheel.resolveWheelRingSet(historicalStyle, singleInput);
    const transit = wheel.resolveWheelRingSet(historicalStyle, transitInput);
    const synastry = wheel.resolveWheelRingSet(historicalStyle, synastryInput);
    assert.equal(wheelLayoutFamily(transitInput), "angloComparisonNoHouses");
    assert.equal(wheelLayoutFamily(synastryInput), "angloComparisonWithHouses");
    assert.equal(transit.r30, single.r30, `${profile} transit must preserve the original radix diameter`);
    assert.equal(transit.rOuterMax, undefined, `${profile} transit has no enclosing outer circle`);
    assert.ok(transit.rOuterPlanet > transit.r30);
    assert.ok(synastry.rOuterMax > synastry.rOuterPlanet);
  }
});

// Source-derived checks for the deliberately new Morinus factory. The v1
// historical hashes above stay untouched and continue guarding that version.
test("Morinus v2 restores bare single geometry and retains outer/comparison allocations", () => {
  const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
  for (const profile of ["classic", "compact"]) {
    for (const radius of [180, 300, 400]) {
      for (const terms of [false, true]) for (const decans of [false, true]) {
        const density = Number(terms) + Number(decans);
        for (const positions of [false, true]) {
          const input = {profile, mode: "single", maxRadius: radius, hasOuterRing: false,
            showTerms: terms, showDecans: decans, showHouses: true, showPositions: positions};
          const rings = wheel.resolveWheelRingSet(wheel.DEFAULT_WHEEL_RENDER_STYLE, input);
          close(rings.r30 / radius, .96);
          close(rings.r0 / radius, .80);
          close(rings.rInner / radius, .80 - density * .08);
          close(rings.rPlanet / radius, .71 - density * .08);
          close(rings.rASCMC / radius, .88);
          close(rings.rArrow / radius, .92);
          const base = profile === "classic" ? .13 : .24 - (positions ? [0, .02, .08][density] : 0);
          close(rings.rBase / radius, base);
          close((rings.rHouse - rings.rBase) / radius, .08);
          if (profile === "compact") close(rings.rPosAscMC / radius, [.42, .38, .30][density]);
          else close(rings.rPos / radius, [.55, .48, .40][density]);
          const typography = wheel.resolveWheelTypographyMetrics(wheel.DEFAULT_WHEEL_RENDER_STYLE, profile, radius, input);
          close(typography.bodySize, radius / 12);
          close(typography.signSize, radius / 12);
          for (const mode of ["single", "comparison"]) {
            const outerInput = {...input, mode, hasOuterRing: true};
            assert.deepEqual(wheel.resolveWheelRingSet(wheel.DEFAULT_WHEEL_RENDER_STYLE, outerInput),
              wheel.resolveWheelRingSet(historicalStyle, outerInput));
          }
        }
      }
    }
  }
});

test("Morinus strokes reproduce the 400/600 px thresholds and configurable angle pens", () => {
  for (const [size, ring, medium, angle] of [[400, 1, 1, 2], [401, 2, 1, 3], [600, 2, 1, 3], [601, 3, 2, 5], [1000, 3, 2, 5]]) {
    assert.equal(wheel.resolveMorinusStroke(size, 3, "ring"), ring);
    assert.equal(wheel.resolveMorinusStroke(size, 2, "medium"), medium);
    assert.equal(wheel.resolveMorinusStroke(size, 5, "angle"), angle);
    assert.equal(wheel.resolveMorinusStroke(size, 1, "angle"), 1);
  }
});

// graphchart2.py counts each subdivision plus the outer/comparison layer.
// Only position readouts require the ordinary hub reductions. The exceptional
// no-readout reduction applies when all three extra bands are present.
test("Morinus center and house ring resizing follows subdivision density and position visibility", () => {
  const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
  for (const mode of ["single", "comparison"]) {
    for (const outer of mode === "comparison" ? [true] : [false, true]) {
      for (const terms of [false, true]) for (const decans of [false, true]) {
        for (const positions of [false, true]) for (const houses of [false, true]) {
          const density = Number(terms) + Number(decans) + Number(outer);
          const offset = positions ? [0, .02, .08, .12][density] : density === 3 ? .05 : 0;
          for (const radius of [180, 400, 733.5]) for (const profile of ["classic", "compact"]) {
            const input = {profile, mode, maxRadius: radius, hasOuterRing: outer,
              showTerms: terms, showDecans: decans, showHouses: houses, showPositions: positions};
            const rings = wheel.resolveWheelRingSet(wheel.DEFAULT_WHEEL_RENDER_STYLE, input);
            const bare = mode === "single" && !outer;
            const base = profile === "compact" ? .24 - offset : bare ? .13 : .11;
            const houseWidth = bare ? .08 : .06;
            close(rings.rBase / radius, base);
            close(rings.rHouse / radius, base + houseWidth);
            close(rings.rHouseName / radius, base + houseWidth / 2);
            close((rings.r0 - rings.rInner) / radius, (Number(terms) + Number(decans)) * .08);
          }
        }
      }
    }
  }
});
