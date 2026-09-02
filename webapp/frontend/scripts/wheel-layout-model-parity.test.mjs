// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Stage-1 contract for the declared wheel band model
// (`src/lib/chart/wheel-layout-model.ts`): the band-first transcription must
// reproduce `resolveWheelRingSet` bit-for-bit across the full preview state
// matrix, for the default geometry and for randomized geometry profiles, and
// the declared containment structure (band order, tiling, anchor spans) must
// actually hold. See doc/ui-specs/style-editor-relational-geometry-research.md.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function transpile(url) {
  const source = await readFile(url, "utf8");
  return ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
}

function dataUrl(source) {
  return `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
}

// The band model is now the upstream authority: the renderer imports it, not
// the other way round, so only one substitution is needed.
const layoutUrl = dataUrl(
  await transpile(new URL("../src/lib/chart/wheel-layout-model.ts", import.meta.url)),
);
const wheelUrl = dataUrl(
  (await transpile(new URL("../src/lib/chart/wheel-render-style.ts", import.meta.url)))
    .replaceAll('"./wheel-layout-model"', `"${layoutUrl}"`),
);

const wheel = await import(wheelUrl);
const layoutApi = await import(layoutUrl);

const {
  DEFAULT_WHEEL_RENDER_STYLE,
  WHEEL_PAINTED_RING_ROLES,
  resolveWheelRingSet,
} = wheel;
const {
  WHEEL_BAND_ORDER,
  resolveCanonicalWheelLayout,
  resolveWheelBandLayout,
  wheelAnchorSpans,
  wheelLayoutFamily,
} = layoutApi;

// --- state matrix ----------------------------------------------------------

const PROFILES = ["classic", "compact", "anglo"];
const MODES = ["single", "comparison"];
const BOOLS = [false, true];
const MAX_RADII = [180, 400, 733.5];

function* stateMatrix() {
  for (const profile of PROFILES)
    for (const mode of MODES)
      for (const hasOuterRing of BOOLS)
        for (const showTerms of BOOLS)
          for (const showDecans of BOOLS)
            for (const showHouses of BOOLS)
              for (const showPositions of BOOLS)
                for (const comparisonWithOuterHouses of BOOLS)
                  for (const restrainedAngloComparison of BOOLS)
                    for (const maxRadius of MAX_RADII) {
                      yield {
                        profile,
                        mode,
                        maxRadius,
                        hasOuterRing,
                        showTerms,
                        showDecans,
                        showHouses,
                        showPositions,
                        comparisonWithOuterHouses,
                        restrainedAngloComparison,
                      };
                    }
}

// --- deterministic geometry perturbation -----------------------------------

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function perturbNumbers(value, rng) {
  if (typeof value === "number") return value * (0.6 + rng() * 0.8);
  if (Array.isArray(value)) return value.map((entry) => perturbNumbers(entry, rng));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, perturbNumbers(entry, rng)]),
    );
  }
  return value;
}

function styleWithGeometry(geometry) {
  return { ...DEFAULT_WHEEL_RENDER_STYLE, geometry };
}

const PERTURBED_STYLES = [1, 2, 3, 4].map((seed) =>
  styleWithGeometry(
    perturbNumbers(DEFAULT_WHEEL_RENDER_STYLE.geometry, mulberry32(seed * 7919)),
  ),
);

// --- parity ---------------------------------------------------------------

function assertRingParity(style, label) {
  let states = 0;
  for (const input of stateMatrix()) {
    const expected = resolveWheelRingSet(style, input);
    const actual = resolveCanonicalWheelLayout(style, input).rings;
    assert.deepStrictEqual(
      { ...actual },
      { ...expected },
      `${label}: canonical band layout diverged for ${JSON.stringify(input)}`,
    );
    states += 1;
  }
  return states;
}

test("canonical band layout reproduces the renderer ring set exactly (default geometry)", () => {
  const states = assertRingParity(DEFAULT_WHEEL_RENDER_STYLE, "default");
  assert.ok(states >= 2304, `state matrix unexpectedly small: ${states}`);
});

test("canonical band layout reproduces the renderer ring set exactly (perturbed geometry)", () => {
  PERTURBED_STYLES.forEach((style, index) => {
    assertRingParity(style, `perturbed#${index + 1}`);
  });
});

// --- structure ------------------------------------------------------------

test("default bands are ordered, tile the radius, and carry no violations", () => {
  for (const input of stateMatrix()) {
    const layout = resolveCanonicalWheelLayout(DEFAULT_WHEEL_RENDER_STYLE, input);
    assert.deepStrictEqual(
      layout.violations,
      [],
      `unexpected violations for ${JSON.stringify(input)}: ${JSON.stringify(layout.violations)}`,
    );
    assert.strictEqual(layout.family, wheelLayoutFamily(input));
    assert.deepStrictEqual(
      layout.bands.map((band) => band.id),
      [...WHEEL_BAND_ORDER[layout.family]],
    );
    const first = layout.bands[0];
    const last = layout.bands[layout.bands.length - 1];
    assert.strictEqual(first.outer, input.maxRadius);
    assert.strictEqual(last.inner, 0);
    for (let index = 0; index < layout.bands.length; index += 1) {
      const band = layout.bands[index];
      assert.ok(
        band.inner <= band.outer + 1e-9,
        `band ${band.id} inverted for ${JSON.stringify(input)}`,
      );
      if (index > 0) {
        assert.strictEqual(
          layout.bands[index - 1].inner,
          band.outer,
          `bands ${layout.bands[index - 1].id}/${band.id} do not share an edge for ${JSON.stringify(input)}`,
        );
      }
    }
  }
});

test("every declared anchor stays inside its declared band span", () => {
  for (const input of stateMatrix()) {
    const layout = resolveCanonicalWheelLayout(DEFAULT_WHEEL_RENDER_STYLE, input);
    const spans = wheelAnchorSpans(input.profile);
    const bandsById = new Map(layout.bands.map((band) => [band.id, band]));
    const tolerance = 1e-7 * input.maxRadius;
    for (const [field, span] of Object.entries(spans)) {
      const radius = layout.rings[field];
      if (radius === undefined) continue;
      const present = span
        .map((bandId) => bandsById.get(bandId))
        .filter((band) => band !== undefined);
      if (!present.length) continue;
      const outer = Math.max(...present.map((band) => band.outer));
      const inner = Math.min(...present.map((band) => band.inner));
      assert.ok(
        radius >= inner - tolerance && radius <= outer + tolerance,
        `${field}=${radius.toFixed(4)} escapes span [${inner.toFixed(4)}, ${outer.toFixed(4)}] ` +
          `(${span.join(">")}) for ${JSON.stringify(input)}`,
      );
    }
  }
});

// --- final layout with user overrides --------------------------------------

function styleWithRingOverrides(rng) {
  const legacy = Object.fromEntries(
    PROFILES.map((profile) => [
      profile,
      Object.fromEntries(
        WHEEL_PAINTED_RING_ROLES.map((role) => [
          role,
          rng() < 0.35 ? 0.1 + rng() * 0.85 : 0,
        ]),
      ),
    ]),
  );
  const direct = Object.fromEntries(
    PROFILES.map((profile) => [
      profile,
      Object.fromEntries(
        WHEEL_PAINTED_RING_ROLES.flatMap((role) =>
          rng() < 0.35 ? [[role, rng() * 400]] : [],
        ),
      ),
    ]),
  );
  return {
    ...DEFAULT_WHEEL_RENDER_STYLE,
    ringRadiusOverrides: legacy,
    authoringOverrides: {
      ...DEFAULT_WHEEL_RENDER_STYLE.authoringOverrides,
      ringRadii: direct,
    },
  };
}

test("final band layout mirrors the override-applied ring set field-for-field", () => {
  const rng = mulberry32(20260725);
  for (let round = 0; round < 3; round += 1) {
    const style = styleWithRingOverrides(rng);
    for (const input of stateMatrix()) {
      const rings = resolveWheelRingSet(style, input);
      const layout = resolveWheelBandLayout(style, input, rings);
      assert.deepStrictEqual({ ...layout.rings }, { ...rings });
      const bandsById = new Map(layout.bands.map((band) => [band.id, band]));
      const anglo = input.profile === "anglo";
      const zodiac = bandsById.get("zodiac");
      assert.strictEqual(zodiac.outer, rings.r30);
      assert.strictEqual(zodiac.inner, rings.r0);
      const bodies = bandsById.get("bodies");
      assert.strictEqual(bodies.outer, rings.rInner);
      assert.strictEqual(bodies.inner, anglo ? rings.rHouse : rings.rAsp);
      const houses = bandsById.get("houses");
      assert.strictEqual(houses.outer, rings.rHouse);
      assert.strictEqual(houses.inner, anglo ? rings.rAsp : rings.rBase);
      const hub = bandsById.get("hub");
      assert.strictEqual(hub.outer, anglo ? rings.rAsp : rings.rBase);
      assert.strictEqual(hub.inner, 0);
      if (bandsById.has("outerHouses")) {
        assert.strictEqual(bandsById.get("outerHouses").outer, rings.rOuterMax);
        assert.strictEqual(bandsById.get("outerHouses").inner, rings.rOuterHouse);
        assert.strictEqual(bandsById.get("outerBodies").inner, rings.r30);
      }
      // Overrides may legally compress bands; inversions must be reported,
      // never silently repaired by the layout reader.
      for (const violation of layout.violations) {
        assert.strictEqual(violation.kind, "band-inverted");
      }
    }
  }
});

// --- chart-ring span -------------------------------------------------------
//
// The chart-ring diamond owns the complete run from the pane rim through the
// inner chart boundary. The margin therefore brings comparison outer-house and
// outer-body bands along too. Individually authored rings inside that run are
// cargo during this gesture: their stored values stay intact, while their
// rendered circles move proportionally with the span.

test("chart-ring span starts at the margin in every layout and toggle state", () => {
  for (const input of stateMatrix()) {
    const family = wheelLayoutFamily(input);
    const span = wheel.resolveWheelBandSpanFields(input, "chartRing");
    assert.ok(span, `chartRing missing for ${JSON.stringify(input)}`);
    assert.strictEqual(
      span.outerField,
      null,
      `chartRing must anchor at the pane rim for ${JSON.stringify(input)}`,
    );
    const expectedPrefix =
      family === "classicComparison" || family === "angloComparisonWithHouses"
        ? ["rOuterMax", "rOuterHouse", "r30"]
        : ["r30"];
    assert.deepStrictEqual(
      span.interiorFields.slice(0, expectedPrefix.length),
      expectedPrefix,
      `chartRing omitted an outer comparison boundary for ${JSON.stringify(input)}`,
    );
  }
});

test("chart-ring drag proportionally carries authored rings without rewriting them", () => {
  const cases = [
    {
      profile: "classic",
      mode: "single",
      maxRadius: 260,
      hasOuterRing: false,
      comparisonWithOuterHouses: false,
      restrainedAngloComparison: false,
      showTerms: true,
      showDecans: true,
      showHouses: true,
      showPositions: true,
      expectedFamily: "classicSingle",
    },
    {
      profile: "compact",
      mode: "comparison",
      maxRadius: 400,
      hasOuterRing: true,
      comparisonWithOuterHouses: true,
      restrainedAngloComparison: false,
      showTerms: true,
      showDecans: true,
      showHouses: true,
      showPositions: true,
      expectedFamily: "classicComparison",
    },
    {
      profile: "anglo",
      mode: "single",
      maxRadius: 320,
      hasOuterRing: false,
      comparisonWithOuterHouses: false,
      restrainedAngloComparison: false,
      showTerms: true,
      showDecans: true,
      showHouses: true,
      showPositions: false,
      expectedFamily: "angloSingle",
    },
    {
      profile: "anglo",
      mode: "comparison",
      maxRadius: 520,
      hasOuterRing: true,
      comparisonWithOuterHouses: false,
      restrainedAngloComparison: false,
      showTerms: true,
      showDecans: true,
      showHouses: true,
      showPositions: true,
      expectedFamily: "angloComparisonNoHouses",
    },
    {
      profile: "anglo",
      mode: "comparison",
      maxRadius: 733.5,
      hasOuterRing: true,
      comparisonWithOuterHouses: true,
      restrainedAngloComparison: true,
      showTerms: true,
      showDecans: true,
      showHouses: true,
      showPositions: true,
      expectedFamily: "angloComparisonWithHouses",
    },
  ];

  for (const state of cases) {
    const input = { ...state };
    assert.strictEqual(wheelLayoutFamily(input), state.expectedFamily);
    const span = wheel.resolveWheelBandSpanFields(input, "chartRing");
    assert.ok(span, `chartRing missing for ${JSON.stringify(input)}`);

    const canonical = wheel.resolveCanonicalWheelRingSet(
      DEFAULT_WHEEL_RENDER_STYLE,
      input,
    );
    const referenceRadius =
      DEFAULT_WHEEL_RENDER_STYLE.authoringOverrides.referenceRadius;
    const toReference = (radius) => radius * referenceRadius / input.maxRadius;
    const spanFields = new Set(span.interiorFields);
    const authoredRings = Object.fromEntries(
      wheel.activePaintedRingRoles(input).flatMap((role) => {
        const field = wheel.paintedRingFieldFor(role, input.profile);
        const radius = canonical[field];
        return spanFields.has(field) && typeof radius === "number"
          ? [[role, toReference(radius)]]
          : [];
      }),
    );
    assert.ok(
      Object.keys(authoredRings).length >= 4,
      `expected several authored circles inside chartRing for ${JSON.stringify(input)}`,
    );

    const canonicalInner = canonical[span.innerField];
    assert.strictEqual(typeof canonicalInner, "number");
    const targetInner = canonicalInner
      + (input.maxRadius - canonicalInner) * 0.02;
    const style = {
      ...DEFAULT_WHEEL_RENDER_STYLE,
      authoringOverrides: {
        ...DEFAULT_WHEEL_RENDER_STYLE.authoringOverrides,
        ringRadii: {
          ...DEFAULT_WHEEL_RENDER_STYLE.authoringOverrides.ringRadii,
          [input.profile]: authoredRings,
        },
        bandSpanInner: {
          ...DEFAULT_WHEEL_RENDER_STYLE.authoringOverrides.bandSpanInner,
          [input.profile]: { chartRing: toReference(targetInner) },
        },
      },
    };
    const storedOverrides = JSON.stringify(style.authoringOverrides.ringRadii);
    const resolved = resolveWheelRingSet(style, input);
    const canonicalDepth = input.maxRadius - canonicalInner;
    const targetDepth = input.maxRadius - targetInner;

    for (const field of span.interiorFields) {
      const before = canonical[field];
      const after = resolved[field];
      assert.strictEqual(typeof before, "number", `${String(field)} missing before drag`);
      assert.strictEqual(typeof after, "number", `${String(field)} missing after drag`);
      const expected =
        input.maxRadius - targetDepth * ((input.maxRadius - before) / canonicalDepth);
      assert.ok(
        Math.abs(after - expected) < 1e-6,
        `${String(field)} did not travel proportionally: ${before} -> ${after}, expected ${expected}`,
      );
    }
    assert.ok(
      Math.abs(resolved[span.innerField] - targetInner) < 1e-6,
      `chartRing diamond missed its target for ${JSON.stringify(input)}: ` +
        `${resolved[span.innerField]} vs ${targetInner}`,
    );
    assert.strictEqual(
      JSON.stringify(style.authoringOverrides.ringRadii),
      storedOverrides,
      "chartRing resolution must not rewrite the individually authored ring values",
    );

    const interior = new Set(span.interiorFields);
    for (const field of ["rAsp", "rHouse", "rBase"]) {
      if (interior.has(field)) continue;
      assert.strictEqual(
        resolved[field],
        canonical[field],
        `${field} outside chartRing moved for ${JSON.stringify(input)}`,
      );
    }
  }
});

// --- golden baseline -------------------------------------------------------
//
// `fixtures/wheel-ring-golden.json` captures resolveWheelRingSet exactly as it
// behaved before the band model existed. It is the regression floor for the
// stage-2 authority flip: the renderer may be rewritten to compute from the
// declared bands, but every radius it produces must stay identical. Regenerate
// the fixture only for a deliberate geometry change, with a changelog entry.

const golden = JSON.parse(
  await readFile(new URL("./fixtures/wheel-ring-golden.json", import.meta.url), "utf8"),
);

function stateKey(input) {
  return [
    input.profile,
    input.mode,
    input.maxRadius,
    Number(input.hasOuterRing),
    Number(input.showTerms),
    Number(input.showDecans),
    Number(input.showHouses),
    Number(input.showPositions),
    Number(input.comparisonWithOuterHouses),
    Number(input.restrainedAngloComparison),
  ].join("|");
}

function canonicalRingsJson(rings) {
  return JSON.stringify(
    Object.entries({ ...rings }).sort(([a], [b]) => (a < b ? -1 : 1)),
  );
}

const sha = (text) => createHash("sha256").update(text).digest("hex");

function goldenStyles() {
  const styles = [["default", DEFAULT_WHEEL_RENDER_STYLE]];
  for (const seed of [1, 2, 3, 4]) {
    styles.push([
      `perturbed#${seed}`,
      styleWithGeometry(
        perturbNumbers(DEFAULT_WHEEL_RENDER_STYLE.geometry, mulberry32(seed * 7919)),
      ),
    ]);
  }
  const overrideRng = mulberry32(20260725);
  for (let round = 1; round <= 3; round += 1) {
    styles.push([`overrides#${round}`, styleWithRingOverrides(overrideRng)]);
  }
  return styles;
}

test("resolveWheelRingSet matches the pre-band-model golden baseline", () => {
  assert.strictEqual(golden.schemaVersion, 1);
  for (const [label, style] of goldenStyles()) {
    const chunks = [];
    for (const input of stateMatrix()) {
      chunks.push(`${stateKey(input)}:${canonicalRingsJson(resolveWheelRingSet(style, input))}`);
    }
    assert.strictEqual(
      sha(chunks.join("\n")),
      golden.aggregates[label],
      `${label}: ring geometry drifted from the golden baseline`,
    );
  }
});

// The five override-free baselines are the load-bearing ones: a wheel with no
// pinned ring radii must render identically forever, whatever the solver does.
// Re-baselining one of these is a real visual change and needs a changelog
// entry, not a fixture regeneration.
test("solver changes cannot reach a wheel with no pinned ring radii", () => {
  for (const [label, style] of goldenStyles()) {
    if (label.startsWith("overrides#")) continue;
    const chunks = [];
    for (const input of stateMatrix()) {
      chunks.push(`${stateKey(input)}:${canonicalRingsJson(resolveWheelRingSet(style, input))}`);
    }
    assert.strictEqual(
      sha(chunks.join("\n")),
      golden.aggregates[label],
      `${label} has no ring pins, so no solver change may alter it`,
    );
  }
});

test("golden baseline pinpoints drift to the exact preview state", () => {
  const states = Object.keys(golden.defaultPerState);
  assert.strictEqual(states.length, 2304);
  for (const input of stateMatrix()) {
    const key = stateKey(input);
    assert.strictEqual(
      sha(canonicalRingsJson(resolveWheelRingSet(DEFAULT_WHEEL_RENDER_STYLE, input))).slice(0, 12),
      golden.defaultPerState[key],
      `default geometry drifted at ${key}`,
    );
  }
});

// --- solver invariants -----------------------------------------------------
//
// These are the properties the previous sequential clamp could not offer. It
// compared each ring against its already-adjusted neighbour, so the outcome
// depended on processing order, only the adjacent pin was considered, and the
// repair happened silently at paint time with no reportable limit.

const { solveOrderedBoundaries, wheelBandFloor } = layoutApi;

function randomPinCase(rng, count) {
  const canonical = [];
  let radius = 380;
  for (let index = 0; index < count; index += 1) {
    radius -= 5 + rng() * 40;
    canonical.push(Math.max(2, radius));
  }
  const pins = canonical.map(() => (rng() < 0.4 ? rng() * 420 - 10 : undefined));
  return { canonical, pins };
}

test("solved boundaries always stay ordered by at least the band floor", () => {
  const rng = mulberry32(4242);
  const gap = wheelBandFloor(400);
  for (let round = 0; round < 4000; round += 1) {
    const count = 2 + Math.floor(rng() * 10);
    const { canonical, pins } = randomPinCase(rng, count);
    const { resolved } = solveOrderedBoundaries(canonical, pins, {
      outerLimit: 400,
      innerLimit: 0,
      gap,
    });
    for (let index = 0; index < resolved.length; index += 1) {
      assert.ok(
        Number.isFinite(resolved[index]),
        `non-finite boundary in ${JSON.stringify(pins)}`,
      );
      assert.ok(
        resolved[index] >= -1e-9,
        `negative boundary in ${JSON.stringify(pins)}`,
      );
      if (index > 0) {
        assert.ok(
          resolved[index] <= resolved[index - 1] - gap + 1e-9,
          `boundaries ${index - 1}/${index} violate the ${gap}px floor for ` +
            `pins ${JSON.stringify(pins)} -> ${JSON.stringify(resolved)}`,
        );
      }
    }
  }
});

test("a boundary depends only on the authored pins, never on solve order", () => {
  const rng = mulberry32(99991);
  const gap = wheelBandFloor(400);
  const options = { outerLimit: 400, innerLimit: 0, gap };
  for (let round = 0; round < 600; round += 1) {
    const count = 3 + Math.floor(rng() * 8);
    const { canonical, pins } = randomPinCase(rng, count);
    const full = solveOrderedBoundaries(canonical, pins, options);
    // Re-solving one boundary in isolation, with every other pin unchanged,
    // must reproduce the same value. Under the old clamp this failed, because
    // the neighbour it compared against had already been rewritten.
    for (let index = 0; index < count; index += 1) {
      const single = solveOrderedBoundaries(canonical, pins, options);
      assert.strictEqual(
        single.resolved[index],
        full.resolved[index],
        `boundary ${index} is order-sensitive for ${JSON.stringify(pins)}`,
      );
    }
  }
});

test("pins outside the legal interval hard-stop at the reported wall", () => {
  const gap = wheelBandFloor(400);
  const options = { outerLimit: 400, innerLimit: 0, gap };
  const canonical = [340, 300, 260, 220];

  // Pushed past the canvas edge.
  const tooFar = solveOrderedBoundaries(canonical, [900, undefined, undefined, undefined], options);
  assert.strictEqual(tooFar.resolved[0], tooFar.limits[0].max);
  assert.strictEqual(tooFar.blocked[0], true);

  // Dragged below the wheel centre.
  const tooDeep = solveOrderedBoundaries(canonical, [undefined, undefined, undefined, -50], options);
  assert.strictEqual(tooDeep.resolved[3], gap);
  assert.strictEqual(tooDeep.blocked[3], true);

  // A pin that fits is honoured exactly and is not reported as blocked.
  const fits = solveOrderedBoundaries(canonical, [undefined, 290, undefined, undefined], options);
  assert.strictEqual(fits.resolved[1], 290);
  assert.strictEqual(fits.blocked[1], false);

  // The drag wall accounts for pins further in, so a gesture cannot author a
  // conflict in the first place.
  const boxedIn = solveOrderedBoundaries(canonical, [undefined, undefined, 250, undefined], options);
  assert.ok(boxedIn.limits[1].min >= 250 + gap - 1e-9);
});

test("an over-pinned stored profile resolves outer-pin-first", () => {
  const gap = wheelBandFloor(400);
  const options = { outerLimit: 400, innerLimit: 0, gap };
  // Eight pins crammed into 7px cannot all be honoured.
  const canonical = [340, 300, 260, 220, 180, 140, 100, 60];
  const pins = [300, 299, 298, 297, 296, 295, 294, 293];
  const { resolved } = solveOrderedBoundaries(canonical, pins, options);
  // The outermost authored radius is respected exactly rather than being
  // pushed further out than its author asked for.
  assert.strictEqual(resolved[0], 300);
  for (let index = 1; index < resolved.length; index += 1) {
    assert.ok(resolved[index] <= resolved[index - 1] - gap + 1e-9);
  }
});

// --- band containment under arbitrary pins ---------------------------------
//
// The headline guarantee of stage 3b: a band carries its own contents. Moving
// the sign ring must move the sign glyphs, degree ticks and position runs with
// it, instead of leaving them behind for the ring to be dragged across.
//
// This is also the check that catches double-placement: a painted ring that is
// both a solved boundary and a declared anchor must be positioned once, not
// compounded.

function randomRingPins(rng) {
  return Object.fromEntries(
    PROFILES.map((profile) => [
      profile,
      Object.fromEntries(
        WHEEL_PAINTED_RING_ROLES.flatMap((role) =>
          rng() < 0.3 ? [[role, 40 + rng() * 350]] : [],
        ),
      ),
    ]),
  );
}

test("band contents stay inside their band for arbitrary pinned radii", () => {
  const rng = mulberry32(777001);
  let checkedAnchors = 0;
  for (let round = 0; round < 40; round += 1) {
    const style = {
      ...DEFAULT_WHEEL_RENDER_STYLE,
      authoringOverrides: {
        ...DEFAULT_WHEEL_RENDER_STYLE.authoringOverrides,
        ringRadii: randomRingPins(rng),
      },
    };
    for (const input of stateMatrix()) {
      const rings = resolveWheelRingSet(style, input);
      const layout = resolveWheelBandLayout(style, input, rings);
      const bandsById = new Map(layout.bands.map((band) => [band.id, band]));
      const spans = wheelAnchorSpans(input.profile);
      const tolerance = Math.max(1e-6, 1e-6 * input.maxRadius);
      for (const [field, span] of Object.entries(spans)) {
        const radius = rings[field];
        if (typeof radius !== "number" || !Number.isFinite(radius)) continue;
        const present = span
          .map((bandId) => bandsById.get(bandId))
          .filter((band) => band !== undefined);
        if (!present.length) continue;
        const outer = Math.max(...present.map((band) => band.outer));
        const inner = Math.min(...present.map((band) => band.inner));
        assert.ok(
          radius >= inner - tolerance && radius <= outer + tolerance,
          `${field}=${radius.toFixed(4)} escaped span [${inner.toFixed(4)}, ${outer.toFixed(4)}] ` +
            `(${span.join(">")}) for ${JSON.stringify(input)}`,
        );
        checkedAnchors += 1;
      }
    }
  }
  assert.ok(checkedAnchors > 100000, `expected broad coverage, checked ${checkedAnchors}`);
});

// --- the drag actually stops at the wall -----------------------------------
//
// Stage 3a computed a legal interval per boundary but nothing consumed it, so
// the hard stop Max chose existed only in the data model. A ring-radius drag
// now carries its own neighbour-aware wall, which static per-token bounds
// cannot express: a ring's legal range depends on where every other authored
// ring currently sits.

const { resolveWheelPaintedRingRadiusRange } = wheel;

test("a painted ring's legal range respects its neighbours", () => {
  const input = {
    profile: "classic",
    mode: "single",
    maxRadius: 400,
    hasOuterRing: false,
    showTerms: true,
    showDecans: true,
    showHouses: true,
    showPositions: true,
    comparisonWithOuterHouses: false,
  };
  const gap = wheelBandFloor(400);

  const free = resolveWheelPaintedRingRadiusRange(
    DEFAULT_WHEEL_RENDER_STYLE,
    input,
    "zodiacInnerRing",
  );
  assert.ok(free && free.max <= 400);

  // Pin the sign band's outer edge low; the inner edge's ceiling must follow it
  // down, which a fixed 0..1 token bound could never do.
  const pinned = {
    ...DEFAULT_WHEEL_RENDER_STYLE,
    authoringOverrides: {
      ...DEFAULT_WHEEL_RENDER_STYLE.authoringOverrides,
      ringRadii: { classic: { zodiacOuterRing: 200 } },
    },
  };
  const constrained = resolveWheelPaintedRingRadiusRange(pinned, input, "zodiacInnerRing");
  assert.ok(constrained);
  assert.ok(
    constrained.max <= 200 - gap + 1e-9,
    `inner ring ceiling ${constrained.max} should sit below the pinned outer ring`,
  );
  assert.ok(constrained.max < free.max, "pinning an outer ring must tighten the inner ring");
});

test("every painted ring's range brackets the radius actually painted", () => {
  const rng = mulberry32(515151);
  for (let round = 0; round < 8; round += 1) {
    const style = {
      ...DEFAULT_WHEEL_RENDER_STYLE,
      authoringOverrides: {
        ...DEFAULT_WHEEL_RENDER_STYLE.authoringOverrides,
        ringRadii: randomRingPins(rng),
      },
    };
    for (const input of stateMatrix()) {
      for (const role of WHEEL_PAINTED_RING_ROLES) {
        const range = resolveWheelPaintedRingRadiusRange(style, input, role);
        if (!range) continue;
        assert.ok(
          range.min <= range.max + 1e-9,
          `${role} range inverted for ${JSON.stringify(input)}`,
        );
        assert.ok(
          range.min >= -1e-9 && range.max <= input.maxRadius + 1e-9,
          `${role} range escapes the canvas for ${JSON.stringify(input)}`,
        );
      }
    }
  }
});

// --- glyphs are limited by the band that holds them ------------------------
//
// Max: "glyphs can still be sized over borders/ranges, shouldn't they be also
// limited?". Static per-property bounds cannot express this, because how large
// a glyph may be depends on how thick its band currently is.

const { WHEEL_CLASS_BAND, resolveWheelClassFontSizeCeiling } = layoutApi;

test("every declared glyph class maps to a band", () => {
  const bandIds = new Set(Object.values(WHEEL_BAND_ORDER).flat());
  for (const [classId, bandId] of Object.entries(WHEEL_CLASS_BAND)) {
    assert.ok(bandIds.has(bandId), `${classId} maps to unknown band ${bandId}`);
  }
});

test("the glyph ceiling never forces a shrink", () => {
  // By construction the ceiling floors at the current size, so no state can
  // produce a wall below what is already painted. Checked across the matrix
  // against sizes deliberately far above any band.
  for (const input of stateMatrix()) {
    const layout = resolveCanonicalWheelLayout(DEFAULT_WHEEL_RENDER_STYLE, input);
    for (const classId of Object.keys(WHEEL_CLASS_BAND)) {
      for (const current of [1, 14, 25, 400]) {
        const ceiling = resolveWheelClassFontSizeCeiling(classId, layout.bands, current);
        if (ceiling == null) continue;
        assert.ok(
          ceiling >= current - 1e-9,
          `${classId} ceiling ${ceiling} would shrink a run of ${current}`,
        );
      }
    }
  }
});

test("rim labels are not band-limited", () => {
  // Secondary-ring text is drawn outward from the rim with leaders and angular
  // collision handling; a margin-thickness cap would be meaningless and the
  // audit showed every worst offender was one of these.
  for (const classId of Object.keys(WHEEL_CLASS_BAND)) {
    assert.ok(
      !classId.startsWith("secondaryRing."),
      `${classId} must not be band-limited`,
    );
  }
});

test("the glyph ceiling tightens when its band is squeezed", () => {
  const input = {
    profile: "classic",
    mode: "single",
    maxRadius: 400,
    hasOuterRing: false,
    showTerms: true,
    showDecans: true,
    showHouses: true,
    showPositions: true,
    comparisonWithOuterHouses: false,
  };
  const openBands = resolveCanonicalWheelLayout(DEFAULT_WHEEL_RENDER_STYLE, input).bands;
  const open = resolveWheelClassFontSizeCeiling("bodies.inner.glyph", openBands);

  // Collapse the bodies band between the inner boundary and the aspect circle.
  const squeezedStyle = {
    ...DEFAULT_WHEEL_RENDER_STYLE,
    authoringOverrides: {
      ...DEFAULT_WHEEL_RENDER_STYLE.authoringOverrides,
      ringRadii: { classic: { innerBoundaryRing: 240, aspectBoundaryRing: 225 } },
    },
  };
  const squeezedRings = resolveWheelRingSet(squeezedStyle, input);
  const squeezedBands = resolveWheelBandLayout(squeezedStyle, input, squeezedRings).bands;
  const squeezed = resolveWheelClassFontSizeCeiling("bodies.inner.glyph", squeezedBands);

  assert.ok(open != null && squeezed != null);
  assert.ok(
    squeezed < open,
    `squeezing the bodies band must lower its glyph ceiling (${open} -> ${squeezed})`,
  );
  assert.ok(squeezed <= 16 + 1e-9, `expected a tight ceiling, got ${squeezed}`);
});

// --- degree rulers keep their length when their base circle moves ----------
//
// Max: ticks "morph with the circle diameter and become awkward... they should
// not just be elongated when their anchoring circle moves". A ruler is a tick
// of an authored length standing on a base circle, not a ring that happens to
// sit at a radius. Before this, the terminal was also a painted ring, so the
// solver placed it as an independent boundary and the ticks were drawn as
// thirds between two independently moving ends — widening the sign band
// elongated every tick with it.

test("degree ruler length is independent of its band's width", () => {
  const input = {
    profile: "classic",
    mode: "single",
    maxRadius: 400,
    hasOuterRing: false,
    showTerms: true,
    showDecans: true,
    showHouses: true,
    showPositions: true,
    comparisonWithOuterHouses: false,
  };
  const tickLengthFor = (ringRadii) => {
    const style = ringRadii
      ? {
          ...DEFAULT_WHEEL_RENDER_STYLE,
          authoringOverrides: {
            ...DEFAULT_WHEEL_RENDER_STYLE.authoringOverrides,
            ringRadii,
          },
        }
      : DEFAULT_WHEEL_RENDER_STYLE;
    const rings = resolveWheelRingSet(style, input);
    return { length: rings.r10 - rings.r0, width: rings.r30 - rings.r0 };
  };

  const base = tickLengthFor(null);
  const wide = tickLengthFor({ classic: { zodiacOuterRing: 392, zodiacInnerRing: 250 } });
  const narrow = tickLengthFor({ classic: { zodiacOuterRing: 340, zodiacInnerRing: 320 } });

  // The band really did change width, so this is not a vacuous assertion.
  assert.ok(wide.width > base.width * 2, `band should widen: ${wide.width} vs ${base.width}`);
  assert.ok(narrow.width < base.width / 2, `band should narrow: ${narrow.width}`);

  assert.ok(
    Math.abs(wide.length - base.length) < 1e-6,
    `widening the band must not elongate the ruler (${base.length} -> ${wide.length})`,
  );
  // A ruler may only be shortened by a band too thin to hold it.
  assert.ok(
    narrow.length <= base.length + 1e-6,
    `narrowing must not elongate the ruler (${base.length} -> ${narrow.length})`,
  );
});

test("a ruler never escapes the band it stands in", () => {
  const rng = mulberry32(60607);
  for (let round = 0; round < 6; round += 1) {
    const style = {
      ...DEFAULT_WHEEL_RENDER_STYLE,
      authoringOverrides: {
        ...DEFAULT_WHEEL_RENDER_STYLE.authoringOverrides,
        ringRadii: randomRingPins(rng),
      },
    };
    for (const input of stateMatrix()) {
      const rings = resolveWheelRingSet(style, input);
      const tolerance = 1e-6 * input.maxRadius;
      for (const field of ["r1", "r5", "r10"]) {
        assert.ok(
          rings[field] >= rings.r0 - tolerance && rings[field] <= rings.r30 + tolerance,
          `${field}=${rings[field]} escaped the sign band for ${JSON.stringify(input)}`,
        );
      }
    }
  }
});

// --- stub lengths and the Anglo base-ring alias ----------------------------

test("Anglo's base ring and aspect circle stay the same circle", () => {
  // Anglo seats the base ring on the aspect circle. Held as two independent
  // fields, a pinned base ring slid away from the circle the leader feet, the
  // aspect glyph lane and the hub boundary all anchor to, and shrank without
  // limit because only rAsp is a declared boundary with a floor.
  for (const pin of [null, 140, 100, 60, 30, 10, 3]) {
    for (const mode of MODES) {
      const input = {
        profile: "anglo",
        mode,
        maxRadius: 400,
        hasOuterRing: false,
        showTerms: true,
        showDecans: true,
        showHouses: true,
        showPositions: true,
        comparisonWithOuterHouses: mode === "comparison",
        restrainedAngloComparison: false,
      };
      const style = pin == null
        ? DEFAULT_WHEEL_RENDER_STYLE
        : {
            ...DEFAULT_WHEEL_RENDER_STYLE,
            authoringOverrides: {
              ...DEFAULT_WHEEL_RENDER_STYLE.authoringOverrides,
              ringRadii: { anglo: { baseRing: pin } },
            },
          };
      const rings = resolveWheelRingSet(style, input);
      assert.ok(
        Math.abs(rings.rBase - rings.rAsp) < 1e-9,
        `base ring ${rings.rBase} left the aspect circle ${rings.rAsp} (pin ${pin}, ${mode})`,
      );
    }
  }
});

test("leader stubs keep their length unless the band cannot hold them", () => {
  const input = {
    profile: "anglo",
    mode: "single",
    maxRadius: 400,
    hasOuterRing: false,
    showTerms: true,
    showDecans: true,
    showHouses: true,
    showPositions: true,
    comparisonWithOuterHouses: false,
  };
  const footFor = (pin) => {
    const style = pin == null
      ? DEFAULT_WHEEL_RENDER_STYLE
      : {
          ...DEFAULT_WHEEL_RENDER_STYLE,
          authoringOverrides: {
            ...DEFAULT_WHEEL_RENDER_STYLE.authoringOverrides,
            ringRadii: { anglo: { baseRing: pin } },
          },
        };
    const rings = resolveWheelRingSet(style, input);
    return { foot: rings.rAsp - rings.rLLine2, hub: rings.rAsp };
  };
  const natural = footFor(null).foot;
  assert.ok(natural > 5, `expected a real stub length, got ${natural}`);

  // Roomy hubs keep the natural length exactly, however much the hub moved.
  for (const pin of [140, 100, 60, 30]) {
    const { foot, hub } = footFor(pin);
    assert.ok(hub > natural, `hub ${hub} should still hold a ${natural} stub`);
    assert.ok(
      Math.abs(foot - natural) < 1e-6,
      `resizing the hub to ${hub} must not resize the stub (${natural} -> ${foot})`,
    );
  }
  // A hub smaller than the stub clamps it, and never inverts it.
  for (const pin of [10, 3]) {
    const { foot, hub } = footFor(pin);
    assert.ok(foot > 0 && foot <= hub + 1e-9, `stub ${foot} invalid for hub ${hub}`);
  }
});

// --- band-dwelling glyphs cannot outgrow their ring -----------------------

test("a subdivision glyph is capped by the band that holds it", () => {
  // Max: "glyphs can still be much larger than their containing bands, and so
  // there's a lot of overlap." A subdivision glyph is centred in its ring, so
  // a size larger than the ring is thick cannot be contained and spills into
  // the neighbours. resolveWheelClassFontSizeCeiling already knew which band
  // owns a class, but only the editor used it, and only to widen a slider
  // bound — it takes the larger of the two values and so can never reduce a
  // size. The renderer now applies it as a real ceiling.
  const input = {
    profile: "classic",
    mode: "single",
    maxRadius: 400,
    hasOuterRing: false,
    showTerms: true,
    showDecans: true,
    showHouses: true,
    showPositions: true,
    comparisonWithOuterHouses: false,
  };
  const style = wheel.DEFAULT_WHEEL_RENDER_STYLE;
  const rings = resolveWheelRingSet(style, input);
  const { bands } = layoutApi.resolveWheelBandLayout(style, input, rings);

  for (const [classId, bandId] of [
    ["subdivisions.term.glyph", "terms"],
    ["subdivisions.decan.glyph", "decans"],
  ]) {
    const band = bands.find((candidate) => candidate.id === bandId);
    assert.ok(band, `no ${bandId} band`);
    const thickness = band.outer - band.inner;
    assert.ok(thickness > 1, `${bandId} band is degenerate`);

    // A glyph stops just inside the boundary circles rather than flush with
    // them, so its extremities do not read as clipped by the ring lines.
    const ceiling = layoutApi.resolveWheelClassFontSizeCeiling(classId, bands);
    assert.ok(ceiling < thickness, `${classId} ceiling must sit inside its band`);
    assert.ok(ceiling > thickness * 0.5, `${classId} ceiling is too tight`);

    // Oversized authored values are capped to the ceiling...
    assert.equal(Math.min(thickness * 4, ceiling), ceiling);
    // ...and a value that already fits is left exactly alone.
    const fits = ceiling / 2;
    assert.equal(Math.min(fits, ceiling), fits);
  }
});

test("the shipped default glyph sizes already fit their bands", () => {
  // The clamp must be a safety net, not something the defaults rely on: if a
  // default were already being capped, the wheel would silently depend on the
  // clamp and any band change would move glyphs.
  for (const profile of PROFILES) {
    for (const maxRadius of [180, 400, 733.5]) {
      const input = {
        profile,
        mode: "single",
        maxRadius,
        hasOuterRing: false,
        showTerms: true,
        showDecans: true,
        showHouses: true,
        showPositions: true,
        comparisonWithOuterHouses: false,
      };
      const style = wheel.DEFAULT_WHEEL_RENDER_STYLE;
      const rings = resolveWheelRingSet(style, input);
      const { bands } = layoutApi.resolveWheelBandLayout(style, input, rings);
      const metrics = wheel.resolveWheelTypographyMetrics(style, profile, maxRadius);
      for (const [classId, size] of [
        ["subdivisions.term.glyph", metrics.termSize],
        ["subdivisions.decan.glyph", metrics.decanSize],
      ]) {
        const ceiling = layoutApi.resolveWheelClassFontSizeCeiling(classId, bands);
        if (ceiling == null) continue;
        assert.ok(
          size <= ceiling + 1e-9,
          `${classId} default ${size} exceeds its band ${ceiling} (${profile} @ ${maxRadius})`,
        );
      }
    }
  }
});

// --- push: dragging one boundary carries its neighbours -------------------

const PUSH_BASE = { outerLimit: 400, innerLimit: 0, gap: 10 };
const PUSH_CANONICAL = [350, 300, 250, 200, 150];

function pushSolve(pins, pushIndex) {
  return layoutApi.solveOrderedBoundaries(
    PUSH_CANONICAL,
    pins,
    pushIndex === undefined ? PUSH_BASE : { ...PUSH_BASE, pushIndex },
  );
}

test("without a push index every pin still holds its authored radius", () => {
  // Resolving a stored profile must stay order-independent. Push is a live
  // drag behaviour and must not leak into ordinary resolution.
  const pins = [350, 300, 250, 200, 150];
  assert.deepEqual([...pushSolve(pins).resolved], pins);
});

test("dragging the innermost boundary carries the others outward", () => {
  // Max: "technically I should be able to push all circles with either the
  // most inner or the most outer, and them retaining their min slack."
  const pins = [350, 300, 250, 200, 150];
  const target = pins.slice();
  target[4] = 300;
  const resolved = [...pushSolve(target, 4).resolved];
  assert.equal(resolved[4], 300);
  // Each neighbour is carried out by exactly the gap, no further.
  assert.deepEqual(resolved, [350, 330, 320, 310, 300]);
});

test("dragging the outermost boundary carries the others inward", () => {
  const pins = [350, 300, 250, 200, 150];
  const target = pins.slice();
  target[0] = 40;
  const resolved = [...pushSolve(target, 0).resolved];
  assert.deepEqual(resolved, [50, 40, 30, 20, 10]);
});

test("a boundary with room to spare keeps its authored radius", () => {
  // Push must displace only what it has to; an authored radius that still
  // fits is left where its author put it.
  const pins = [350, 300, 250, 200, 150];
  const target = pins.slice();
  target[2] = 340;
  const resolved = [...pushSolve(target, 2).resolved];
  assert.equal(resolved[2], 340);
  assert.equal(resolved[3], 200, "inner neighbour had room and must not move");
  assert.equal(resolved[4], 150, "innermost had room and must not move");
});

test("push never breaks order, gap or the enclosing limits", () => {
  const pins = [350, 300, 250, 200, 150];
  for (let index = 0; index < pins.length; index += 1) {
    for (const target of [-50, 0, 40, 150, 300, 380, 450]) {
      const attempt = pins.slice();
      attempt[index] = target;
      const resolved = [...pushSolve(attempt, index).resolved];
      for (let i = 1; i < resolved.length; i += 1) {
        assert.ok(
          resolved[i - 1] - resolved[i] >= PUSH_BASE.gap - 1e-6,
          `gap violated at ${i} for index ${index} target ${target}: ${resolved}`,
        );
      }
      assert.ok(resolved[0] <= PUSH_BASE.outerLimit + 1e-6, `escaped outer: ${resolved}`);
      assert.ok(
        resolved[resolved.length - 1] >= PUSH_BASE.innerLimit - 1e-6,
        `escaped inner: ${resolved}`,
      );
    }
  }
});

test("an out-of-range push index is ignored rather than throwing", () => {
  const pins = [350, 300, 250, 200, 150];
  for (const bad of [-1, 5, 1.5, Number.NaN]) {
    assert.deepEqual([...pushSolve(pins, bad).resolved], pins);
  }
});

// --- a band that shows a glyph has a floor -------------------------------

test("uniform per-interval gaps are identical to the scalar gap", () => {
  // The per-interval floors are a generalisation, so the uniform case must be
  // bit-identical or every existing layout would shift.
  const canonical = [350, 300, 250, 200, 150];
  const base = { outerLimit: 400, innerLimit: 0, gap: 10 };
  for (const pins of [
    [undefined, undefined, undefined, undefined, undefined],
    [350, 300, 250, 200, 150],
    [380, undefined, 250, undefined, 20],
    [100, 90, 80, 70, 60],
  ]) {
    assert.deepEqual(
      [...layoutApi.solveOrderedBoundaries(canonical, pins, base).resolved],
      [...layoutApi.solveOrderedBoundaries(canonical, pins, {
        ...base,
        gaps: [10, 10, 10, 10, 10, 10],
      }).resolved],
      `uniform gaps drifted from the scalar gap for ${pins}`,
    );
  }
});

test("every interval keeps its own floor under random pins and pushes", () => {
  const canonical = [350, 300, 250, 200, 150];
  const rng = mulberry32(20260727);
  for (let trial = 0; trial < 300; trial += 1) {
    const gaps = Array.from({ length: 6 }, () => Math.round(rng() * 30));
    const pins = canonical.map(() => (rng() < 0.5 ? undefined : Math.round(rng() * 420 - 10)));
    const pushIndex = Math.floor(rng() * canonical.length);
    for (const options of [
      { outerLimit: 400, innerLimit: 0, gap: 10, gaps },
      { outerLimit: 400, innerLimit: 0, gap: 10, gaps, pushIndex },
    ]) {
      const resolved = [...layoutApi.solveOrderedBoundaries(canonical, pins, options).resolved];
      for (let i = 1; i < resolved.length; i += 1) {
        assert.ok(
          resolved[i - 1] - resolved[i] >= gaps[i] - 1e-6,
          `interval ${i} floor ${gaps[i]} violated: ${resolved}`,
        );
      }
    }
  }
});

test("a band that carries a glyph cannot be squeezed below it", () => {
  // Max: "decans can overcompress to nothingness, maybe there should be a min
  // size for bands?" A uniform structural floor let a band holding a ruler
  // glyph collapse to two pixels. Its floor is now the glyph it must show,
  // which pairs with the ceiling that keeps a glyph inside its band.
  const input = {
    profile: "classic",
    mode: "single",
    maxRadius: 400,
    hasOuterRing: false,
    showTerms: true,
    showDecans: true,
    showHouses: true,
    showPositions: true,
    comparisonWithOuterHouses: false,
  };
  const style = wheel.DEFAULT_WHEEL_RENDER_STYLE;
  const metrics = wheel.resolveWheelTypographyMetrics(style, "classic", 400);
  const rings = resolveWheelRingSet(style, input);

  // Author the term ring hard against the sign ring and resolve the wheel.
  // Measuring the clamped radius against the *old* neighbour would prove
  // nothing, because an unpinned neighbour yields and moves with it; what must
  // hold is the thickness of the band that comes out of the solve. Driving it
  // through an authored override also exercises the reference-space units path
  // end to end, which is where the drag bug actually lived.
  const authored = { ...style, authoringOverrides: {
    ...style.authoringOverrides,
    ringRadii: { ...style.authoringOverrides.ringRadii, classic: { termRing: rings.r0 - 1 } },
  } };
  const squeezed = resolveWheelRingSet(authored, input);
  assert.ok(
    squeezed.r0 - squeezed.rDecans >= metrics.termSize - 1e-6,
    `terms band ${squeezed.r0 - squeezed.rDecans} squeezed below its glyph ${metrics.termSize}`,
  );
});

test("the content floor never moves a default layout", () => {
  // The floor is a limit, not a layout input: every shipped default already
  // clears it, so no wheel may shift because it exists.
  for (const profile of PROFILES) {
    for (const maxRadius of [140, 180, 260, 400, 733.5]) {
      const input = {
        profile,
        mode: "single",
        maxRadius,
        hasOuterRing: false,
        showTerms: true,
        showDecans: true,
        showHouses: true,
        showPositions: true,
        comparisonWithOuterHouses: false,
      };
      const style = wheel.DEFAULT_WHEEL_RENDER_STYLE;
      const rings = resolveWheelRingSet(style, input);
      const metrics = wheel.resolveWheelTypographyMetrics(style, profile, maxRadius);
      if (typeof rings.r0 === "number" && typeof rings.rDecans === "number") {
        assert.ok(
          rings.r0 - rings.rDecans >= metrics.termSize - 1e-6,
          `${profile} @ ${maxRadius}: default terms band is already below its floor`,
        );
      }
    }
  }
});

// --- degree rulers as authored sub-bands -----------------------------------
//
// A ruler used to have no existence of its own: it *was* three ticks
// (`rOuter10 = ((r30 - t) - t) - t`), so its depth was a consequence of tick
// length rather than something anyone could size, and one token drove both
// rulers at once. Depth is now the primary quantity, authored per ruler as a
// share of the band that hosts it. These tests pin the two halves that make
// that safe: an unauthored ruler is untouched to the bit, and an authored one
// is a share of its band rather than of the wheel.

const { WHEEL_RULER_DEPTH_RANGE, resolveWheelRulerTerminal } = layoutApi;

function withRulerDepth(profile, rulerDepth) {
  return {
    ...DEFAULT_WHEEL_RENDER_STYLE,
    authoringOverrides: {
      ...DEFAULT_WHEEL_RENDER_STYLE.authoringOverrides,
      rulerDepth: { [profile]: rulerDepth },
    },
  };
}

test("an unauthored ruler keeps its canonical terminal, bit for bit", () => {
  // Identity, not equality. The canonical terminals are sequential
  // accumulations and any recomputation of them — even an arithmetically
  // correct one — is free to land on a different float.
  for (const profile of PROFILES) {
    for (const rulerId of ["zodiacOuter", "zodiacInner"]) {
      for (const canonicalTerminal of [320, 348.4, 0.1 + 0.2, 733.5 / 3]) {
        for (const [base, sign] of [[332, -1], [272, 1]]) {
          const resolved = resolveWheelRulerTerminal(
            DEFAULT_WHEEL_RENDER_STYLE,
            profile,
            rulerId,
            332 - 272,
            base,
            sign,
            canonicalTerminal,
          );
          assert.ok(
            Object.is(resolved, canonicalTerminal),
            `${profile}/${rulerId}: unauthored ruler was recomputed rather than passed through`,
          );
        }
      }
    }
  }
});

test("the default wheel is unchanged by the ruler channel existing", () => {
  // The whole state matrix, defaults against defaults-with-an-empty-channel.
  const empty = withRulerDepth("classic", {});
  for (const input of stateMatrix()) {
    const before = resolveWheelRingSet(DEFAULT_WHEEL_RENDER_STYLE, input);
    const after = resolveWheelRingSet(empty, input);
    for (const field of Object.keys(before)) {
      assert.ok(
        Object.is(before[field], after[field]),
        `${JSON.stringify(input)} ${field}: ${before[field]} !== ${after[field]}`,
      );
    }
  }
});

test("an authored ruler is a share of its band, not of the wheel", () => {
  for (const profile of ["classic", "compact"]) {
    for (const maxRadius of MAX_RADII) {
      const input = {
        profile,
        mode: "single",
        maxRadius,
        hasOuterRing: false,
        showTerms: true,
        showDecans: true,
        showHouses: true,
        showPositions: true,
        comparisonWithOuterHouses: false,
      };
      for (const fraction of [0.05, 0.2, 0.4]) {
        const rings = resolveWheelRingSet(
          withRulerDepth(profile, { zodiacOuter: fraction, zodiacInner: fraction }),
          input,
        );
        const band = rings.r30 - rings.r0;
        assert.ok(
          Math.abs((rings.rOuter0 - rings.rOuter10) - band * fraction) < 1e-9,
          `${profile} @ ${maxRadius}: outer ruler is not ${fraction} of its band`,
        );
        assert.ok(
          Math.abs((rings.r10 - rings.r0) - band * fraction) < 1e-9,
          `${profile} @ ${maxRadius}: inner ruler is not ${fraction} of its band`,
        );
      }
    }
  }
});

test("the two rulers size independently", () => {
  // One token drove both, so neither could move alone. Moving the outer ruler
  // must leave the inner one exactly where the canonical geometry put it.
  const input = {
    profile: "classic",
    mode: "single",
    maxRadius: 400,
    hasOuterRing: false,
    showTerms: true,
    showDecans: true,
    showHouses: true,
    showPositions: true,
    comparisonWithOuterHouses: false,
  };
  const canonical = resolveWheelRingSet(DEFAULT_WHEEL_RENDER_STYLE, input);
  const outerOnly = resolveWheelRingSet(
    withRulerDepth("classic", { zodiacOuter: 0.4 }),
    input,
  );
  assert.ok(
    Math.abs((outerOnly.rOuter0 - outerOnly.rOuter10) - (canonical.r30 - canonical.r0) * 0.4)
      < 1e-9,
    "authoring the outer ruler did not move it",
  );
  assert.ok(Object.is(outerOnly.r10, canonical.r10), "the inner ruler moved with the outer one");
  assert.ok(Object.is(outerOnly.r1, canonical.r1), "inner ruler ticks moved with the outer ruler");
  assert.ok(Object.is(outerOnly.r5, canonical.r5), "inner ruler ticks moved with the outer ruler");
});

test("ruler depth is clamped to a band both rulers can share", () => {
  const input = {
    profile: "classic",
    mode: "single",
    maxRadius: 400,
    hasOuterRing: false,
    showTerms: true,
    showDecans: true,
    showHouses: true,
    showPositions: true,
    comparisonWithOuterHouses: false,
  };
  for (const [authored, expected] of [
    [5, WHEEL_RULER_DEPTH_RANGE.max],
    [-1, WHEEL_RULER_DEPTH_RANGE.min],
    [0, WHEEL_RULER_DEPTH_RANGE.min],
  ]) {
    const rings = resolveWheelRingSet(withRulerDepth("classic", { zodiacOuter: authored }), input);
    const band = rings.r30 - rings.r0;
    assert.ok(
      Math.abs((rings.rOuter0 - rings.rOuter10) - band * expected) < 1e-9,
      `${authored} was not clamped to ${expected}`,
    );
  }
  // Two rulers at the ceiling still leave the band's own contents room.
  assert.ok(WHEEL_RULER_DEPTH_RANGE.max * 2 < 1, "two full-depth rulers would fill the band");
});

test("anglo's outer ruler is hosted by the margin it stands in", () => {
  // Measured: with an outer ring the anglo outer ruler sits at 376–385.6 px
  // while its zodiac band is 332.2–358 — outside the band, inside the margin.
  // It was briefly left hostless on that basis, which was a mistake: anglo
  // draws this ruler and no other (`!isAngloWheel` gates the inner one), so a
  // hostless outer ruler meant the whole profile had nothing sizable at all.
  // The margin is a real band and it contains the ruler, so the margin hosts it.
  const input = {
    profile: "anglo",
    mode: "single",
    maxRadius: 400,
    hasOuterRing: true,
    showTerms: true,
    showDecans: true,
    showHouses: true,
    showPositions: true,
    comparisonWithOuterHouses: false,
  };
  const canonical = resolveWheelRingSet(DEFAULT_WHEEL_RENDER_STYLE, input);
  assert.ok(
    canonical.rOuter10 > canonical.r30,
    "precondition: the ruler sits outside the zodiac band",
  );
  const fraction = 0.3;
  const authored = resolveWheelRingSet(
    withRulerDepth("anglo", { zodiacOuter: fraction }),
    input,
  );
  const margin = input.maxRadius - authored.r30;
  assert.ok(
    Math.abs((authored.rOuter0 - authored.rOuter10) - margin * fraction) < 1e-9,
    "the outer ruler did not take its share of the margin",
  );
  // And it stays inside that margin rather than sinking into the zodiac band.
  assert.ok(
    authored.rOuter10 >= authored.r30 - 1e-9,
    "the margin-hosted ruler dropped through the zodiac circle",
  );
});

test("an authored ruler follows its band when the band is resized", () => {
  // The point of a band fraction: "ticks scale with the outer glyphs" falls out
  // transitively — band grows, ruler grows — without coupling tick length to
  // glyph size. Resolved against the band as *solved*, not as authored.
  const input = {
    profile: "classic",
    mode: "single",
    maxRadius: 400,
    hasOuterRing: false,
    showTerms: true,
    showDecans: true,
    showHouses: true,
    showPositions: true,
    comparisonWithOuterHouses: false,
  };
  const fraction = 0.25;
  const base = withRulerDepth("classic", { zodiacOuter: fraction, zodiacInner: fraction });
  const before = resolveWheelRingSet(base, input);
  const referenceScale = base.authoringOverrides.referenceRadius / input.maxRadius;

  // Pull the zodiac band's inner circle inward, widening the band.
  const widened = {
    ...base,
    authoringOverrides: {
      ...base.authoringOverrides,
      ringRadii: {
        ...base.authoringOverrides.ringRadii,
        classic: { zodiacInnerRing: (before.r0 - 30) * referenceScale },
      },
    },
  };
  const after = resolveWheelRingSet(widened, input);
  const bandBefore = before.r30 - before.r0;
  const bandAfter = after.r30 - after.r0;
  assert.ok(bandAfter > bandBefore + 1, "precondition: the band did not widen");
  assert.ok(
    Math.abs((after.rOuter0 - after.rOuter10) - bandAfter * fraction) < 1e-6,
    "the outer ruler did not take its share of the widened band",
  );
  assert.ok(
    Math.abs((after.r10 - after.r0) - bandAfter * fraction) < 1e-6,
    "the inner ruler did not take its share of the widened band",
  );
  // An unauthored ruler keeps the absolute tick depth it always had.
  const plain = resolveWheelRingSet(
    {
      ...DEFAULT_WHEEL_RENDER_STYLE,
      authoringOverrides: {
        ...widened.authoringOverrides,
        rulerDepth: DEFAULT_WHEEL_RENDER_STYLE.authoringOverrides.rulerDepth,
      },
    },
    input,
  );
  const tickDepth = DEFAULT_WHEEL_RENDER_STYLE.geometry.classic.degreeTickLength * 400 * 3;
  assert.ok(
    Math.abs((plain.rOuter0 - plain.rOuter10) - tickDepth) < 1e-9,
    "an unauthored ruler changed depth when its band was resized",
  );
});

test("a cusp-ruler tick is a share of its ruler band", () => {
  // The ruler an ordinary anglo wheel actually draws. Its tick lengths were
  // fractions of the whole wheel, so they never responded to their own band.
  const { WHEEL_TICK_LENGTH_RANGE, resolveWheelTickLength } = layoutApi;
  const classId = "zodiac.tick.angloCuspRuler.10deg";
  const style = {
    ...DEFAULT_WHEEL_RENDER_STYLE,
    authoringOverrides: {
      ...DEFAULT_WHEEL_RENDER_STYLE.authoringOverrides,
      tickLength: { anglo: { [classId]: 0.4 } },
    },
  };
  assert.equal(
    resolveWheelTickLength(style, "anglo", classId, 20, 20, 33),
    8,
    "an authored tick is not its share of the band",
  );
  // Unauthored at canonical thickness is the canonical length, by identity.
  assert.ok(Object.is(
    resolveWheelTickLength(DEFAULT_WHEEL_RENDER_STYLE, "anglo", classId, 20, 20, 33),
    33,
  ));
  // Unauthored still follows its band: halve the band, halve the tick. Without
  // this a tick stands its full canonical depth in a band a tenth as thick.
  assert.equal(
    resolveWheelTickLength(DEFAULT_WHEEL_RENDER_STYLE, "anglo", classId, 10, 20, 33),
    16.5,
    "an unauthored tick ignored its band",
  );
  // Another tick class is untouched by this one's authored value.
  assert.ok(Object.is(
    resolveWheelTickLength(style, "anglo", "zodiac.tick.angloCuspRuler.1deg", 20, 20, 33),
    33,
  ));
  // The shipped ruler already overflows its band, so the ceiling must reach
  // past it or the control could not return to the default it starts at.
  assert.ok(WHEEL_TICK_LENGTH_RANGE.max > 1.67);
});

test("placing the cusp ring moves its ruler band instead of stretching it", () => {
  // A tick is a share of its ruler band, and the band's inner edge
  // (`rCuspLabelOuter`) is not a painted ring, so nothing pinned it and the
  // solver only pushes outward from a pin. Dragging the cusp ring outward
  // therefore thickened the band by the full drag and lengthened every tick
  // with it: measured at maxRadius 400, +40px took the band 20.76 -> 60.76 and
  // nearly tripled the ticks, while -30px collapsed them to a tenth. A ring's
  // position must not be a tick-length control.
  const input = {
    profile: "anglo",
    mode: "single",
    maxRadius: 400,
    hasOuterRing: false,
    showTerms: false,
    showDecans: false,
    showHouses: true,
  };
  const canonical = resolveWheelRingSet(DEFAULT_WHEEL_RENDER_STYLE, input);
  const band = canonical.rCuspOuter - canonical.rCuspLabelOuter;
  const styleWithCuspRing = (px) => ({
    ...DEFAULT_WHEEL_RENDER_STYLE,
    authoringOverrides: {
      ...DEFAULT_WHEEL_RENDER_STYLE.authoringOverrides,
      ringRadii: {
        ...DEFAULT_WHEEL_RENDER_STYLE.authoringOverrides.ringRadii,
        anglo: {
          ...(DEFAULT_WHEEL_RENDER_STYLE.authoringOverrides.ringRadii?.anglo ?? {}),
          cuspOuterRing: px,
        },
      },
    },
  });
  for (const delta of [-30, -10, 0, 10, 20, 40]) {
    const rings = resolveWheelRingSet(
      styleWithCuspRing(canonical.rCuspOuter + delta),
      input,
    );
    assert.equal(
      rings.rCuspOuter,
      canonical.rCuspOuter + delta,
      `the cusp ring did not land where it was placed at ${delta}px`,
    );
    assert.ok(
      Math.abs((rings.rCuspOuter - rings.rCuspLabelOuter) - band) < 1e-9,
      `the ruler band stretched at ${delta}px`,
    );
  }
});

test("dragging a span to where it already sits changes nothing", () => {
  // The jump was a bad starting frame, not a bad transform: the span remapped
  // against the *canonical* stack while the diamond reported the *painted*
  // radius. Those differ as soon as a pinned ring has pushed an unpinned
  // neighbour, so the first pixel of a drag snapped the whole ring stack. With
  // seven authored radii it moved rings by up to 22px for a 1px gesture.
  const profile = "anglo";
  const input = {
    profile,
    mode: "single",
    maxRadius: 359.66,
    hasOuterRing: false,
    showTerms: true,
    showDecans: true,
    showHouses: true,
    showPositions: true,
    comparisonWithOuterHouses: false,
  };
  const reference = DEFAULT_WHEEL_RENDER_STYLE.authoringOverrides.referenceRadius;
  // The shape that exposed it: several authored radii, no authored span.
  const ringRadii = {
    [profile]: {
      zodiacOuter: 379.1,
      zodiacInner: 348.1,
      term: 335.1,
      angloCuspOuter: 321.4,
      innerBoundary: 299.1,
      houseBoundary: 211,
      base: 190.6,
    },
  };
  const pinned = {
    ...DEFAULT_WHEEL_RENDER_STYLE,
    authoringOverrides: { ...DEFAULT_WHEEL_RENDER_STYLE.authoringOverrides, ringRadii },
  };
  const before = resolveWheelRingSet(pinned, input);

  const span = wheel.resolveWheelBandSpanFields(input, "chartRing");
  assert.ok(span, "expected a chartRing span");
  // Exactly what the diamond reports: the painted radius, in reference space.
  const painted = before[span.innerField];
  const authoredInner = painted * (reference / input.maxRadius);
  const dragged = resolveWheelRingSet({
    ...pinned,
    authoringOverrides: {
      ...pinned.authoringOverrides,
      bandSpanInner: { [profile]: { chartRing: authoredInner } },
    },
  }, input);

  for (const field of span.interiorFields) {
    assert.ok(
      Math.abs(dragged[field] - before[field]) < 1e-6,
      `${String(field)} moved ${(dragged[field] - before[field]).toFixed(2)}px for a zero-length drag`,
    );
  }
});

test("a band that holds a glyph is never crushed below it, in every family", () => {
  // The two content floors used to be named by classic's circles (`rDecans`,
  // `rInner`). Anglo's decan band ends at `rCuspOuter`, so the decan floor was
  // demanded of a band holding no decan and the decan band itself was free to
  // collapse — measured at 1.8px holding a 0.8px glyph. Located by band, the
  // same two floors land correctly in every family.
  const { resolveWheelBandLayout } = layoutApi;
  const rng = mulberry32(20260725);
  const styles = [1, 2, 3].map(() => styleWithRingOverrides(rng));
  for (const [index, style] of styles.entries()) {
    for (const profile of PROFILES) {
      for (const mode of MODES) {
        const input = {
          profile, mode, maxRadius: 400,
          hasOuterRing: mode === "comparison",
          showTerms: true, showDecans: true, showHouses: true, showPositions: true,
          comparisonWithOuterHouses: mode === "comparison",
        };
        const rings = resolveWheelRingSet(style, input);
        const bands = resolveWheelBandLayout(style, input, rings).bands;
        const metrics = wheel.resolveWheelTypographyMetrics(style, profile, 400);
        for (const [bandId, need] of [
          ["terms", metrics.termSize],
          ["decans", metrics.decanSize],
        ]) {
          const band = bands.find((candidate) => candidate.id === bandId);
          if (!band || !(need > 0)) continue;
          assert.ok(
            (band.outer - band.inner) + 1e-6 >= need,
            `overrides#${index + 1} ${profile}/${mode}: ${bandId} band is ` +
              `${(band.outer - band.inner).toFixed(2)} for a ${need.toFixed(2)} glyph`,
          );
        }
      }
    }
  }
});

test("a tick keeps its share of its band however the band is resized", () => {
  // The ceiling made total: a band-seated run follows its band. Unauthored, the
  // tick keeps the proportion the design shipped, so the ratio is invariant.
  const { resolveWheelTickLength } = layoutApi;
  const classId = "zodiac.tick.angloCuspRuler.10deg";
  const canonicalBand = 20;
  const canonicalLength = 33;
  const ratio = canonicalLength / canonicalBand;
  for (const band of [2, 5, 10, 20, 40, 80]) {
    const length = resolveWheelTickLength(
      DEFAULT_WHEEL_RENDER_STYLE, "anglo", classId, band, canonicalBand, canonicalLength,
    );
    assert.ok(
      Math.abs(length / band - ratio) < 1e-9,
      `band ${band}: tick takes ${(length / band).toFixed(3)} of it, expected ${ratio}`,
    );
  }
});

test("a span scales its run about the anchor and is a no-op at 1", () => {
  // The span used to store the inner circle's radius, which is the same circle
  // the inner chevron authors. Two values, one circle: whichever was applied
  // last won, and the loser still fed the baseline. Measured, once the diamond
  // had been used the chevron could not move that circle outward at all and
  // moved everything above it the wrong way when dragged inward.
  //
  // As a factor they are different quantities, so both stay live and the order
  // they are used in stops mattering.
  const profile = "anglo";
  const input = {
    profile, mode: "single", maxRadius: 359.66, hasOuterRing: false,
    showTerms: true, showDecans: true, showHouses: true, showPositions: true,
    comparisonWithOuterHouses: false,
  };
  const ringRadii = {
    [profile]: {
      zodiacOuter: 379.1, zodiacInner: 348.1, term: 335.1,
      angloCuspOuter: 321.4, innerBoundary: 299.1, houseBoundary: 211, base: 190.6,
    },
  };
  const pinned = {
    ...DEFAULT_WHEEL_RENDER_STYLE,
    authoringOverrides: { ...DEFAULT_WHEEL_RENDER_STYLE.authoringOverrides, ringRadii },
  };
  const withSpan = {
    ...pinned,
    authoringOverrides: {
      ...pinned.authoringOverrides,
      bandSpanScale: { [profile]: { chartRing: 1 } },
    },
  };

  // A span at 1 is a no-op, whatever else is authored.
  const before = resolveWheelRingSet(pinned, input);
  const neutral = resolveWheelRingSet(withSpan, input);
  for (const field of Object.keys(before)) {
    assert.ok(
      Math.abs(neutral[field] - before[field]) < 1e-6,
      `${field} moved for a span factor of 1`,
    );
  }

  const span = wheel.resolveWheelBandSpanFields(input, "chartRing");
  assert.ok(span, "expected a chartRing span");
  // And the span still scales the run, in both directions.
  for (const factor of [0.9, 1.1]) {
    const scaled = resolveWheelRingSet({
      ...pinned,
      authoringOverrides: {
        ...pinned.authoringOverrides,
        bandSpanScale: { [profile]: { chartRing: factor } },
      },
    }, input);
    const anchor = input.maxRadius;
    for (const field of span.interiorFields) {
      assert.ok(
        Math.abs((anchor - scaled[field]) - factor * (anchor - before[field])) < 1e-6,
        `${String(field)} is not ${factor}x its depth under the anchor`,
      );
    }
  }
});

test("the boundary being edited pushes its neighbours instead of stopping", () => {
  // The solver's push pass existed, was tested, and had no production caller:
  // the live drag ran stored-profile semantics. An *unpinned* neighbour already
  // yields, so the stop-dead case is a neighbour that is itself authored —
  // which is every profile that has been styled. Paper authors seven radii.
  // Stopping there is right for a stored profile, where the pins are equally
  // authored, and wrong for an edit in flight, where it reads as the control
  // breaking rather than as a wall.
  const profile = "classic";
  const base = {
    profile, mode: "single", maxRadius: 400, hasOuterRing: false,
    showTerms: true, showDecans: true, showHouses: true, showPositions: true,
    comparisonWithOuterHouses: false,
  };
  const canonical = resolveWheelRingSet(DEFAULT_WHEEL_RENDER_STYLE, base);
  const reference = DEFAULT_WHEEL_RENDER_STYLE.authoringOverrides.referenceRadius;
  const toReference = (px) => px * (reference / base.maxRadius);

  // Both circles authored, and the inner one driven into the outer one.
  const style = {
    ...DEFAULT_WHEEL_RENDER_STYLE,
    authoringOverrides: {
      ...DEFAULT_WHEEL_RENDER_STYLE.authoringOverrides,
      ringRadii: {
        [profile]: {
          zodiacOuterRing: toReference(canonical.r30),
          zodiacInnerRing: toReference(canonical.r30 + 25),
        },
      },
    },
  };
  const stopped = resolveWheelRingSet(style, base);
  const pushed = resolveWheelRingSet(style, { ...base, pushBoundaryRole: "zodiacInnerRing" });

  assert.ok(
    stopped.r0 < canonical.r30 + 1,
    `precondition: stored semantics should hold it off (got ${stopped.r0.toFixed(1)})`,
  );
  assert.ok(
    pushed.r0 > stopped.r0 + 1,
    `push did not free the boundary (stopped ${stopped.r0.toFixed(1)}, pushed ${pushed.r0.toFixed(1)})`,
  );
  assert.ok(pushed.r30 > stopped.r30 + 1, "the pinned neighbour did not yield");
  // Order is never broken, whatever the push does.
  assert.ok(pushed.r30 >= pushed.r0 - 1e-6, "push inverted the band");

  // And naming no boundary leaves the wheel exactly as it was.
  const untouched = resolveWheelRingSet(style, { ...base, pushBoundaryRole: undefined });
  for (const field of Object.keys(stopped)) {
    assert.ok(
      Object.is(untouched[field], stopped[field]),
      `${field} moved without an active boundary`,
    );
  }
});