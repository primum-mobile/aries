// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import { expect, test } from "@playwright/test";

import enMessages from "../src/locales/en.json";
import publicCatalog from "../src/styles/style-token-public.generated.json";
import { resolveStyleTokenValue } from "../src/lib/style-lab/token-alias";
import {
  buildWheelClassTree,
  wheelClassFamilyByMember,
} from "../src/lib/style-lab/wheel-class-tree";
import { WHEEL_SEMANTIC_CLASS_IDS } from "../src/lib/style-lab/semantic-class-manifest";
import {
  buildChartColorRoles,
  chartColorRoleGroup,
  chartColorRolesInGroup,
  wheelClassPaletteRoles,
  CHART_COLOR_ROLE_GROUP_LABEL_KEYS,
  CHART_COLOR_ROLE_GROUP_ORDER,
  type ChartColorRoleToken,
} from "../src/lib/style-lab/chart-color-roles";

const messages = enMessages as Record<string, string>;

const CATALOG_COLOR_TOKENS: readonly ChartColorRoleToken[] = (
  publicCatalog as { tokens: readonly { semanticId: string; label: string; type: string }[] }
).tokens;

/** Every role resolves to the same colour, so ordering alone is under test. */
const flat = (semanticIds: readonly string[]): ChartColorRoleToken[] =>
  semanticIds.map((semanticId) => ({ semanticId, label: semanticId, type: "color" }));

test("groups a token by its path, and refuses ids that are not roles", () => {
  expect(chartColorRoleGroup("chart.color.signs")).toBe("structure");
  expect(chartColorRoleGroup("chart.color.body.mars")).toBe("body");
  expect(chartColorRoleGroup("chart.color.aspect.trine")).toBe("aspect");
  expect(chartColorRoleGroup("chart.color.dignity.fall")).toBe("dignity");
  expect(chartColorRoleGroup("chart.color.element.water")).toBe("element");
  expect(chartColorRoleGroup("app.color.background")).toBeNull();
  expect(chartColorRoleGroup("chart.stroke.frame")).toBeNull();
  expect(chartColorRoleGroup("chart.color.")).toBeNull();
  // A deeper path under an unknown family is not quietly called structural.
  expect(chartColorRoleGroup("chart.color.surveil.marker")).toBeNull();
});

test("offers every chart colour in the published catalog", () => {
  const roles = buildChartColorRoles(CATALOG_COLOR_TOKENS, () => "#123456");
  const offered = new Set(roles.map((role) => role.semanticId));
  const expected = CATALOG_COLOR_TOKENS.filter(
    (token) => token.type === "color" && chartColorRoleGroup(token.semanticId) != null,
  );
  expect(expected.length).toBeGreaterThan(40);
  for (const token of expected) {
    expect(offered.has(token.semanticId)).toBe(true);
  }
  // Nothing outside the chart palette leaks in — app tokens are a different
  // authority and would be assigned into a wheel that never uses them.
  for (const role of roles) {
    expect(role.semanticId.startsWith("chart.color.")).toBe(true);
  }
});

test("orders groups and members for reading, not for spelling", () => {
  const roles = buildChartColorRoles(CATALOG_COLOR_TOKENS, () => "#123456");
  const groupsInOrder = [...new Set(roles.map((role) => role.group))];
  expect(groupsInOrder).toEqual(
    CHART_COLOR_ROLE_GROUP_ORDER.filter((group) =>
      roles.some((role) => role.group === group)),
  );

  const bodies = chartColorRolesInGroup(roles, "body")
    .map((role) => role.semanticId);
  expect(bodies.slice(0, 5)).toEqual([
    "chart.color.body.sun",
    "chart.color.body.moon",
    "chart.color.body.mercury",
    "chart.color.body.venus",
    "chart.color.body.mars",
  ]);

  const aspects = chartColorRolesInGroup(roles, "aspect")
    .map((role) => role.semanticId);
  expect(aspects.slice(0, 5)).toEqual([
    "chart.color.aspect.conjunction",
    "chart.color.aspect.sextile",
    "chart.color.aspect.square",
    "chart.color.aspect.trine",
    "chart.color.aspect.opposition",
  ]);

  const structure = chartColorRolesInGroup(roles, "structure")
    .map((role) => role.semanticId);
  expect(structure[0]).toBe("chart.color.background");
  expect(structure).toContain("chart.color.signs");
});

test("keeps an unranked role reachable, after the ones it knows", () => {
  const roles = buildChartColorRoles(
    flat([
      "chart.color.body.chiron",
      "chart.color.body.eris",
      "chart.color.body.sun",
    ]),
    () => "#ffffff",
  );
  expect(roles.map((role) => role.semanticId)).toEqual([
    "chart.color.body.sun",
    "chart.color.body.chiron",
    "chart.color.body.eris",
  ]);
});

test("leaves out a role that resolves to no colour", () => {
  const roles = buildChartColorRoles(
    flat(["chart.color.signs", "chart.color.frame", "chart.color.angles"]),
    (semanticId) => (semanticId === "chart.color.frame" ? "  " : "#abcdef"),
  );
  expect(roles.map((role) => role.semanticId)).toEqual([
    "chart.color.signs",
    "chart.color.angles",
  ]);
});

test("ignores tokens that are not colours", () => {
  const roles = buildChartColorRoles(
    [
      { semanticId: "chart.color.signs", label: "Zodiac signs", type: "color" },
      { semanticId: "chart.color.frame", label: "Chart frame", type: "number" },
    ],
    () => "#abcdef",
  );
  expect(roles.map((role) => role.semanticId)).toEqual(["chart.color.signs"]);
});

test("every offered role and group heading has an English name", () => {
  for (const group of CHART_COLOR_ROLE_GROUP_ORDER) {
    expect(messages[CHART_COLOR_ROLE_GROUP_LABEL_KEYS[group]]).toBeTruthy();
  }
  const roles = buildChartColorRoles(CATALOG_COLOR_TOKENS, () => "#123456");
  const unnamed = roles
    .filter((role) => !messages[role.labelKey])
    .map((role) => `${role.semanticId} -> ${role.labelKey}`);
  expect(unnamed).toEqual([]);
});

type SceneStub = {
  classId: string;
  tokenBindings: { semanticId: string; property: string }[];
};

const classIdOf = (element: SceneStub) => element.classId;

test("a class paints through every role its occurrences bind", () => {
  // One glyph class, three planets, two of them carrying a dignity as well:
  // exactly the shape that made a flat class colour destroy dignity colouring.
  const elements: SceneStub[] = [
    {
      classId: "bodies.inner.glyph",
      tokenBindings: [
        { semanticId: "chart.color.body.sun", property: "color" },
        { semanticId: "chart.color.dignity.domicile", property: "color" },
      ],
    },
    {
      classId: "bodies.inner.glyph",
      tokenBindings: [
        { semanticId: "chart.color.body.mars", property: "color" },
        { semanticId: "chart.color.dignity.fall", property: "color" },
      ],
    },
    {
      classId: "bodies.inner.glyph",
      tokenBindings: [{ semanticId: "chart.color.body.sun", property: "color" }],
    },
    {
      classId: "zodiac.signGlyph",
      tokenBindings: [{ semanticId: "chart.color.signs", property: "color" }],
    },
  ];
  expect(wheelClassPaletteRoles("bodies.inner.glyph", elements, classIdOf)).toEqual([
    "chart.color.body.sun",
    "chart.color.dignity.domicile",
    "chart.color.body.mars",
    "chart.color.dignity.fall",
  ]);
  expect(wheelClassPaletteRoles("zodiac.signGlyph", elements, classIdOf))
    .toEqual(["chart.color.signs"]);
});

test("only colour bindings that name a chart role are collected", () => {
  const elements: SceneStub[] = [{
    classId: "bodies.inner.glyph",
    tokenBindings: [
      { semanticId: "chart.color.body.sun", property: "color" },
      { semanticId: "chart.color.body.moon", property: "font-size" },
      { semanticId: "app.color.background", property: "color" },
      { semanticId: "renderer.wheel.color.baseRing", property: "color" },
    ],
  }];
  expect(wheelClassPaletteRoles("bodies.inner.glyph", elements, classIdOf))
    .toEqual(["chart.color.body.sun"]);
});

test("a class with no occurrences in this chart paints through nothing", () => {
  expect(wheelClassPaletteRoles("bodies.inner.glyph", [], classIdOf)).toEqual([]);
});

test("every family member resolves to the reading it belongs to", () => {
  const byMember = wheelClassFamilyByMember(
    buildWheelClassTree(WHEEL_SEMANTIC_CLASS_IDS),
  );
  // The case that started this: a house cusp's degree, sign and minute are one
  // reading, and clicking any of them must reach the same three.
  const houseParts = [
    "houses.inner.position.degree",
    "houses.inner.position.sign",
    "houses.inner.position.minute",
  ];
  for (const part of houseParts) {
    expect(byMember.get(part)).toEqual(houseParts);
  }
  // A class that stands alone is in no family, so a click on it selects it.
  expect(byMember.get("zodiac.signGlyph")).toBeUndefined();
  expect(byMember.get("canvas.background")).toBeUndefined();

  // Every member of a family points at a list that contains it, and every
  // family has more than one part — a family of one is just a class.
  for (const [member, family] of byMember) {
    expect(family).toContain(member);
    expect(family.length).toBeGreaterThan(1);
  }
});

test("a role that follows another role keeps its swatch", () => {
  // The failure this pins: picking a role for a role stores a reference, and
  // reading that reference as a colour fails. The role then vanished from the
  // list — taking with it the very row the user had just used.
  const base: Record<string, string> = {
    "chart.color.signs": "#d7d7d9",
    "chart.color.body.sun": "#ffcc00",
    "chart.color.body.mars": "#ff0000",
  };
  const overrides = { "chart.color.body.sun": "{chart.color.signs}" };
  const roles = buildChartColorRoles(
    flat(["chart.color.signs", "chart.color.body.sun", "chart.color.body.mars"]),
    (semanticId) => {
      const value = resolveStyleTokenValue(
        semanticId,
        overrides,
        (id) => base[id] ?? null,
      );
      return typeof value === "string" ? value : null;
    },
  );
  expect(roles.map((role) => role.semanticId)).toEqual([
    "chart.color.signs",
    "chart.color.body.sun",
    "chart.color.body.mars",
  ]);
  const sun = roles.find((role) => role.semanticId === "chart.color.body.sun");
  expect(sun?.value).toBe("#d7d7d9");
});

test("a chart-wide container is not a reading", () => {
  const byMember = wheelClassFamilyByMember(
    buildWheelClassTree(WHEEL_SEMANTIC_CLASS_IDS),
  );
  // Twelve rings share a bag; they are not one thing. Treating the bag as a
  // family made a click on the term ring reach for every ring in the wheel,
  // so changing one ring's opacity repainted all of them.
  for (const alone of [
    "rings.term",
    "rings.zodiacOuter",
    "rings.base",
    "fills.chartField",
    "fills.zodiacBand",
    "layers.geometry",
  ]) {
    expect(byMember.get(alone)).toBeUndefined();
  }
  // The genuine readings are untouched by that rule.
  expect(byMember.get("houses.inner.position.degree")).toHaveLength(3);
  expect(byMember.get("subdivisions.term.glyph")).toHaveLength(2);
});
