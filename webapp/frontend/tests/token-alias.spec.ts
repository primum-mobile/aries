// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import { expect, test } from "@playwright/test";

import {
  resolveStyleTokenAliases,
  resolveStyleTokenValue,
  styleTokenAliasTarget,
  styleTokenAliasValue,
} from "../src/lib/style-lab/token-alias";
import {
  scaledFamilyTargets,
  type FamilyNumericBaseline,
} from "../src/lib/style-lab/family-scaling";

const base: Record<string, number[]> = {
  "chart.color.signs": [200, 100, 50],
  "chart.color.frame": [10, 20, 30],
  "chart.color.background": [0, 0, 0],
};
const readBase = (semanticId: string) => base[semanticId] ?? null;

test("tells a reference from a literal", () => {
  expect(styleTokenAliasTarget("{chart.color.signs}")).toBe("chart.color.signs");
  expect(styleTokenAliasTarget("  {chart.color.signs}  ")).toBe("chart.color.signs");
  expect(styleTokenAliasTarget(styleTokenAliasValue("a.b.c"))).toBe("a.b.c");
  // Literals of every shape a token value can take.
  expect(styleTokenAliasTarget([200, 100, 50])).toBeNull();
  expect(styleTokenAliasTarget(12)).toBeNull();
  expect(styleTokenAliasTarget("rgb(1 2 3)")).toBeNull();
  expect(styleTokenAliasTarget("#ff0000")).toBeNull();
  expect(styleTokenAliasTarget("{}")).toBeNull();
  expect(styleTokenAliasTarget("{a} {b}")).toBeNull();
});

test("a reference lands on the followed token's value", () => {
  const overrides = { "chart.color.frame": "{chart.color.signs}" };
  expect(resolveStyleTokenValue("chart.color.frame", overrides, readBase))
    .toEqual([200, 100, 50]);
});

test("a reference follows the followed token's own override", () => {
  const overrides = {
    "chart.color.frame": "{chart.color.signs}",
    "chart.color.signs": [9, 9, 9],
  };
  expect(resolveStyleTokenValue("chart.color.frame", overrides, readBase))
    .toEqual([9, 9, 9]);
});

test("a chain resolves to the value at its end", () => {
  const overrides = {
    "chart.color.frame": "{chart.color.background}",
    "chart.color.background": "{chart.color.signs}",
  };
  const resolved = resolveStyleTokenAliases(overrides, readBase);
  expect(resolved["chart.color.frame"]).toEqual([200, 100, 50]);
  expect(resolved["chart.color.background"]).toEqual([200, 100, 50]);
});

test("a cycle paints rather than blanking the chart", () => {
  const overrides = {
    "chart.color.frame": "{chart.color.signs}",
    "chart.color.signs": "{chart.color.frame}",
  };
  const resolved = resolveStyleTokenAliases(overrides, readBase);
  // Each one is cut at the revisit and resolved from the theme underneath, so
  // an authoring mistake costs the reference, not the wheel.
  expect(resolved["chart.color.frame"]).toEqual([10, 20, 30]);
  expect(resolved["chart.color.signs"]).toEqual([200, 100, 50]);
  expect(resolveStyleTokenValue("chart.color.frame", overrides, readBase))
    .toEqual([10, 20, 30]);
});

test("a reference is never handed on unresolved", () => {
  const resolved = resolveStyleTokenAliases(
    { "chart.color.frame": "{chart.color.unknown}" },
    readBase,
  );
  expect(Object.hasOwn(resolved, "chart.color.frame")).toBe(false);
  for (const value of Object.values(resolved)) {
    expect(styleTokenAliasTarget(value)).toBeNull();
  }
});

test("a map with no references keeps its identity", () => {
  const overrides = { "chart.color.frame": [1, 2, 3] };
  expect(resolveStyleTokenAliases(overrides, readBase)).toBe(overrides);
});

const baseline = (
  value: number,
  bounds?: { min: number; max: number; step: number },
): FamilyNumericBaseline => ({ value, bounds });

test("a family size edit scales its members and keeps their proportions", () => {
  const targets = scaledFamilyTargets(
    {
      degree: baseline(20),
      sign: baseline(10),
      minute: baseline(5),
    },
    "degree",
    30,
  );
  expect(targets).toEqual({ degree: 30, sign: 15, minute: 7.5 });
  // The relationship the family exists to hold is what survives the edit.
  expect(targets!.degree / targets!.sign).toBeCloseTo(20 / 10, 10);
  expect(targets!.sign / targets!.minute).toBeCloseTo(10 / 5, 10);
});

test("the edited control lands on exactly the value asked for", () => {
  const targets = scaledFamilyTargets(
    { degree: baseline(3), sign: baseline(7) },
    "degree",
    3.7,
  );
  expect(targets!.degree).toBe(3.7);
});

test("a member is clamped by its own limits, not the anchor's", () => {
  const targets = scaledFamilyTargets(
    {
      degree: baseline(10, { min: 0, max: 100, step: 1 }),
      sign: baseline(8, { min: 0, max: 12, step: 1 }),
    },
    "degree",
    40,
  );
  expect(targets!.degree).toBe(40);
  expect(targets!.sign).toBe(12);
});

test("nothing to scale against falls back to the shared write", () => {
  expect(scaledFamilyTargets({ sign: baseline(4) }, "degree", 8)).toBeNull();
  expect(scaledFamilyTargets({ degree: baseline(0) }, "degree", 8)).toBeNull();
  expect(
    scaledFamilyTargets({ degree: baseline(Number.NaN) }, "degree", 8),
  ).toBeNull();
});
