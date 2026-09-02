// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const moduleUrl = new URL(
  "../src/lib/chart/pd-ring-presentation.ts",
  import.meta.url,
);
const source = await readFile(moduleUrl, "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const presentation = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
);

const comparisonChart = {};

function snapshot(pdInChartFrame) {
  return {
    comparisonChart,
    document: { pdInChartFrame },
  };
}

test("fixed radix keeps source roles and ordinary inner/outer tracks", () => {
  const result = presentation.resolvePdRingPresentation(snapshot("fixed-radix"));
  assert.deepEqual(result.primaryBodies, {
    sourceRole: "primary",
    track: "inner",
  });
  assert.deepEqual(result.comparisonBodies, {
    sourceRole: "outer",
    track: "outer",
  });
  assert.equal(result.frameworkSourceRole, "primary");
  assert.equal(result.showComparisonHouses, true);
  assert.equal(result.showComparisonAxes, true);
});

test("traditional converse swaps only radial tracks", () => {
  const result = presentation.resolvePdRingPresentation(
    snapshot("traditional-converse"),
  );
  assert.deepEqual(result.primaryBodies, {
    sourceRole: "primary",
    track: "outer",
  });
  assert.deepEqual(result.comparisonBodies, {
    sourceRole: "outer",
    track: "inner",
  });
  assert.equal(result.frameworkSourceRole, "primary");
  assert.equal(result.showComparisonHouses, false);
  assert.equal(result.showComparisonAxes, false);
});

test("traditional frame is inert without a comparison source", () => {
  const result = presentation.resolvePdRingPresentation({
    comparisonChart: null,
    document: { pdInChartFrame: "traditional-converse" },
  });
  assert.equal(result.traditionalConverse, false);
  assert.equal(result.primaryBodies.track, "inner");
  assert.equal(result.comparisonBodies.track, "outer");
});

test("Classic, Compact and Anglo resolve identical source roles at profile radii", () => {
  const profileRadii = {
    classic: { inner: 218, outer: 334 },
    compact: { inner: 242, outer: 326 },
    anglo: { inner: 185, outer: 350 },
  };
  const result = presentation.resolvePdRingPresentation(
    snapshot("traditional-converse"),
  );
  for (const [profile, radii] of Object.entries(profileRadii)) {
    assert.equal(
      presentation.resolveBodyTrackRadius(result.primaryBodies, radii),
      radii.outer,
      `${profile} radix bodies use the outer track`,
    );
    assert.equal(
      presentation.resolveBodyTrackRadius(result.comparisonBodies, radii),
      radii.inner,
      `${profile} directed significators use the inner track`,
    );
    assert.equal(result.primaryBodies.sourceRole, "primary");
    assert.equal(result.comparisonBodies.sourceRole, "outer");
  }
});

test("traditional Anglo bodies collide against the fixed radix framework", () => {
  const primaryChart = {
    angles: { asc: 251.303, mc: 163.781 },
    houses: { cusps: [251.303, 285.1, 319.8, 343.781] },
  };
  const comparisonChart = {
    angles: { asc: 218.958, mc: 131.522 },
    houses: { cusps: [218.958, 251.6, 285.2, 311.522] },
  };
  const ring = presentation.resolvePdRingPresentation(
    snapshot("traditional-converse"),
  );
  const plan = presentation.resolveComparisonBodyLayoutPlan(
    ring,
    primaryChart,
    comparisonChart,
    {
      anglo: true,
      primaryShowsHouses: true,
      primaryShowsCusplessAscMcLabels: true,
      showOuterHouseCusps: false,
      restrainedAngloComparison: true,
    },
  );

  assert.equal(plan.bodyChart, comparisonChart, "moving bodies keep directed positions");
  assert.equal(plan.frameworkChart, primaryChart, "fixed labels and obstacles use radix axes");
  assert.equal(plan.frameworkChart.angles.asc, 251.303);
  assert.notEqual(plan.frameworkChart.angles.asc, comparisonChart.angles.asc);
  assert.deepEqual(plan.frameworkChart.houses.cusps, primaryChart.houses.cusps);
  assert.equal(plan.includeAngles, true);
  assert.equal(plan.includePositionStacks, true);
  assert.equal(plan.includeSharedAngles, false);
  assert.equal(plan.includeHouseCuspRays, true);

  const changedSymbolicAxes = {
    ...comparisonChart,
    angles: { asc: 19, mc: 287 },
    houses: { cusps: [19, 57, 98, 107] },
  };
  const changedPlan = presentation.resolveComparisonBodyLayoutPlan(
    ring,
    primaryChart,
    changedSymbolicAxes,
    {
      anglo: true,
      primaryShowsHouses: true,
      primaryShowsCusplessAscMcLabels: true,
      showOuterHouseCusps: false,
      restrainedAngloComparison: true,
    },
  );
  assert.equal(changedPlan.bodyChart, changedSymbolicAxes);
  assert.equal(changedPlan.frameworkChart, primaryChart);
  assert.equal(changedPlan.frameworkChart.angles.asc, plan.frameworkChart.angles.asc);
});

test("traditional Anglo houses-off layout includes only enabled cuspless angles", () => {
  const ring = presentation.resolvePdRingPresentation(
    snapshot("traditional-converse"),
  );
  const enabled = presentation.resolveComparisonBodyLayoutPlan(
    ring,
    {},
    {},
    {
      anglo: true,
      primaryShowsHouses: false,
      primaryShowsCusplessAscMcLabels: true,
      showOuterHouseCusps: false,
      restrainedAngloComparison: true,
    },
  );
  assert.equal(enabled.includeAngles, true);
  assert.equal(enabled.includeSharedAngles, true);
  assert.equal(enabled.includeHouseCuspRays, false);

  const disabled = presentation.resolveComparisonBodyLayoutPlan(
    ring,
    {},
    {},
    {
      anglo: true,
      primaryShowsHouses: false,
      primaryShowsCusplessAscMcLabels: false,
      showOuterHouseCusps: false,
      restrainedAngloComparison: true,
    },
  );
  assert.equal(disabled.includeAngles, false);
  assert.equal(disabled.includeSharedAngles, false);
});

test("paint and hit testing share the resolver and preserve source-role hits", async () => {
  const drawSource = await readFile(
    new URL("../src/lib/chart/draw-chart.ts", import.meta.url),
    "utf8",
  );
  assert.ok(
    drawSource.match(/resolvePdRingPresentation\(snapshot\)/g)?.length >= 2,
    "paint and computeHitRegions must both resolve the same presentation",
  );
  assert.match(
    drawSource,
    /chartRole: "outer",[\s\S]{0,300}leaderSegments:/,
    "comparison hits keep daemon source role even on the inner track",
  );
  assert.match(
    drawSource,
    /comparisonChart && ringPresentation\.showComparisonAxes/,
    "comparison axes and their hits are presentation-gated",
  );
  assert.match(
    drawSource,
    /comparisonChart\s*&& ringPresentation\.showComparisonAxes\s*&& !isAngloWheel\(comparisonChart\)/,
    "traditional mode exposes no comparison-arrowhead style targets",
  );
  assert.ok(
    drawSource.match(/resolveComparisonBodyLayoutPlan\(/g)?.length >= 2,
    "paint and hit testing resolve one mixed body/framework contract",
  );
  assert.ok(
    drawSource.match(/directedBodyLayoutForHits\?\.bodyShifts/g)?.length >= 1,
    "hit regions reuse the traditional body layout solved for paint/framework routing",
  );
});
