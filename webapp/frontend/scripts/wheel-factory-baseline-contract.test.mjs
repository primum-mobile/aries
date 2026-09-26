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
const { WHEEL_FACTORY_SETTINGS } = await import(compositionModuleUrl);

// Import the real daemon recipe constructor without loading Options, the app,
// or any user settings. One bounded startup read covers the entire matrix.
const recipes = JSON.parse(execFileSync(process.env.PYTHON || "python3", ["-c", `
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
  assert.deepEqual(wheel.DEFAULT_WHEEL_GEOMETRY_PROFILES, factory.geometry);
  assert.ok(Object.isFrozen(wheel.DEFAULT_WHEEL_GEOMETRY_PROFILES));
  for (const [profile, geometry] of Object.entries(wheel.DEFAULT_WHEEL_GEOMETRY_PROFILES)) {
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

test("all five untouched daemon recipes preserve 960 original arrangement geometries", () => {
  assert.equal(Object.keys(golden.expected).length, 960);
  const coverage = new Map();
  for (const [key, expected] of Object.entries(golden.expected)) {
    const input = inputFor(key);
    assert.equal(input.composition.customized, false, key);
    assert.equal(input.composition.projection, input.profile === "houses" ? "houses" : "zodiac", key);
    const actual = wheel.resolveWheelRingSet(wheel.DEFAULT_WHEEL_RENDER_STYLE, input);
    if (input.profile === "anglo") {
      // The factory's numeric ring set remains the historical reference. The
      // visible Degree overlay now sits inside Signs, so only its four tick
      // terminals may differ in the composed result.
      const historical = wheel.resolveWheelRingSet(wheel.DEFAULT_WHEEL_RENDER_STYLE,
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

test("original Anglo-family transit stays open while synastry keeps its separate arrangement", () => {
  for (const profile of ["anglo", "houses", "cusps"]) {
    const singleInput = inputFor(`${profile}|single|400|0|0|1|1`);
    const transitInput = inputFor(`${profile}|transit|400|0|0|1|1`);
    const synastryInput = inputFor(`${profile}|synastry|400|0|0|1|1`);
    const single = wheel.resolveWheelRingSet(wheel.DEFAULT_WHEEL_RENDER_STYLE, singleInput);
    const transit = wheel.resolveWheelRingSet(wheel.DEFAULT_WHEEL_RENDER_STYLE, transitInput);
    const synastry = wheel.resolveWheelRingSet(wheel.DEFAULT_WHEEL_RENDER_STYLE, synastryInput);
    assert.equal(wheelLayoutFamily(transitInput), "angloComparisonNoHouses");
    assert.equal(wheelLayoutFamily(synastryInput), "angloComparisonWithHouses");
    assert.equal(transit.r30, single.r30, `${profile} transit must preserve the original radix diameter`);
    assert.equal(transit.rOuterMax, undefined, `${profile} transit has no enclosing outer circle`);
    assert.ok(transit.rOuterPlanet > transit.r30);
    assert.ok(synastry.rOuterMax > synastry.rOuterPlanet);
  }
});
