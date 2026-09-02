// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The chart's colour roles, as a named palette an editor can offer.
 *
 * Stage 3 of `doc/ui-specs/style-editor-swatches-and-roles.md`. Every painted
 * thing in the wheel already resolves its colour through one of the
 * `chart.color.*` tokens — `elementColorsFromPalette` and the scene's
 * `colorBinding` calls are that mapping, written as code. What was missing is
 * the same fact as *data* the interface can show: a list of roles with names,
 * so "the colour the planet glyphs use" is something to point at rather than a
 * hex to read off one control and type into another.
 *
 * This module derives that list and nothing else. It performs no write, holds
 * no React state, and decides nothing about how a chosen role is stored — the
 * roles are equally the vocabulary for a literal assignment today and for a
 * live reference later.
 */

export type ChartColorRoleGroup =
  | "structure"
  | "body"
  | "aspect"
  | "dignity"
  | "element";

export interface ChartColorRole {
  /** The `chart.color.*` token this role names. */
  readonly semanticId: string;
  readonly group: ChartColorRoleGroup;
  /** Localization key for the role's name. */
  readonly labelKey: string;
  /** Catalog label, used only until `labelKey` is translated. */
  readonly fallbackLabel: string;
  /** The colour the role carries right now, as a CSS colour string. */
  readonly value: string;
}

const CHART_COLOR_PREFIX = "chart.color.";

/**
 * Groups in offering order: the structural roles an astrologer reaches for
 * constantly come first, then the two big per-occurrence families, then the
 * two small conditional ones.
 */
export const CHART_COLOR_ROLE_GROUP_ORDER: readonly ChartColorRoleGroup[] =
  Object.freeze(["structure", "body", "aspect", "dignity", "element"]);

export const CHART_COLOR_ROLE_GROUP_LABEL_KEYS: Readonly<
  Record<ChartColorRoleGroup, string>
> = Object.freeze({
  structure: "styleLab.roleGroup.structure",
  body: "styleLab.roleGroup.body",
  aspect: "styleLab.roleGroup.aspect",
  dignity: "styleLab.roleGroup.dignity",
  element: "styleLab.roleGroup.element",
});

/**
 * Reading order inside each group.
 *
 * Deliberately not alphabetical. Bodies run in the traditional order out from
 * the Sun and aspects run Ptolemaic-first, because that is the order an
 * astrologer already holds them in; sorting Jupiter before Mars by spelling
 * would make the strip something to search rather than something to know.
 * A token missing from these lists still appears, after them, in catalog
 * order — a newly published role stays reachable without an edit here.
 */
const GROUP_MEMBER_ORDER: Readonly<Record<ChartColorRoleGroup, readonly string[]>> =
  Object.freeze({
    structure: Object.freeze([
      "background",
      "frame",
      "signs",
      "positions",
      "houses",
      "houseNumbers",
      "angles",
      "peregrine",
      "textBright",
    ]),
    body: Object.freeze([
      "body.sun",
      "body.moon",
      "body.mercury",
      "body.venus",
      "body.mars",
      "body.jupiter",
      "body.saturn",
      "body.uranus",
      "body.neptune",
      "body.pluto",
      "body.chiron",
      "body.nodes",
      "body.fortune",
    ]),
    aspect: Object.freeze([
      "aspect.conjunction",
      "aspect.sextile",
      "aspect.square",
      "aspect.trine",
      "aspect.opposition",
      "aspect.semisextile",
      "aspect.semisquare",
      "aspect.quintile",
      "aspect.sesquisquare",
      "aspect.biquintile",
      "aspect.quincunx",
      "aspect.septile",
      "aspect.parallel",
      "aspect.contraparallel",
    ]),
    dignity: Object.freeze([
      "dignity.domicile",
      "dignity.exaltation",
      "dignity.exile",
      "dignity.fall",
    ]),
    element: Object.freeze([
      "element.fire",
      "element.earth",
      "element.air",
      "element.water",
    ]),
  });

/**
 * Roles whose name the app already says elsewhere.
 *
 * A planet and an aspect are proper nouns the interface has translated for
 * other surfaces; minting a second key for the same word would mean the wheel
 * and the picker could drift apart in translation. Anything absent here takes
 * a `styleToken.<id>.label` key of its own, which is the convention the token
 * rows in this editor already read.
 */
const SHARED_LABEL_KEYS: Readonly<Record<string, string>> = Object.freeze({
  "body.sun": "astrocart.point.sun",
  "body.moon": "astrocart.point.moon",
  "body.mercury": "astrocart.point.mercury",
  "body.venus": "astrocart.point.venus",
  "body.mars": "astrocart.point.mars",
  "body.jupiter": "astrocart.point.jupiter",
  "body.saturn": "astrocart.point.saturn",
  "body.uranus": "astrocart.point.uranus",
  "body.neptune": "astrocart.point.neptune",
  "body.pluto": "astrocart.point.pluto",
  "body.chiron": "astrocart.point.chiron",
  "body.nodes": "astrocart.point.northNode",
  "body.fortune": "astrocart.point.fortune",
  "aspect.conjunction": "optmenu.conjunction",
  "aspect.sextile": "optmenu.sextile",
  "aspect.square": "optmenu.square",
  "aspect.trine": "optmenu.trine",
  "aspect.opposition": "optmenu.opposition",
  "aspect.semisextile": "optmenu.semisextile",
  "aspect.semisquare": "optmenu.semisquare",
  "aspect.quintile": "optmenu.quintile",
  "aspect.sesquisquare": "optmenu.sesquisquare",
  "aspect.biquintile": "optmenu.biquintile",
  "aspect.quincunx": "optmenu.quincunx",
  "aspect.septile": "optmenu.septile",
  "aspect.parallel": "settings.parallel",
  "aspect.contraparallel": "settings.contraparallel",
});

/** The group a `chart.color.*` token belongs to, or null when it is not one. */
export function chartColorRoleGroup(semanticId: string): ChartColorRoleGroup | null {
  if (!semanticId.startsWith(CHART_COLOR_PREFIX)) return null;
  const path = semanticId.slice(CHART_COLOR_PREFIX.length);
  if (path.length === 0) return null;
  if (path.startsWith("body.")) return "body";
  if (path.startsWith("aspect.")) return "aspect";
  if (path.startsWith("dignity.")) return "dignity";
  if (path.startsWith("element.")) return "element";
  // A structural role is a single segment: `chart.color.signs`. Anything
  // deeper belongs to a family this function does not know, and guessing
  // "structure" for it would put a stranger among the roles the wheel is
  // actually built from.
  return path.includes(".") ? null : "structure";
}

function roleLabelKey(path: string): string {
  return SHARED_LABEL_KEYS[path] ?? `styleToken.chart.color.${path}.label`;
}

export interface ChartColorRoleToken {
  readonly semanticId: string;
  readonly label: string;
  readonly type: string;
}

/**
 * The offerable roles, grouped and ordered.
 *
 * `readValue` answers what a role carries right now — an override the user has
 * made, else what the applied theme paints. A role that resolves to nothing is
 * left out rather than shown as a blank chip, because an unresolvable swatch
 * would assign an empty colour if clicked.
 */
export function buildChartColorRoles(
  tokens: Iterable<ChartColorRoleToken>,
  readValue: (semanticId: string) => string | null | undefined,
): readonly ChartColorRole[] {
  const byGroup = new Map<ChartColorRoleGroup, ChartColorRole[]>();
  for (const token of tokens) {
    if (token.type !== "color") continue;
    const group = chartColorRoleGroup(token.semanticId);
    if (!group) continue;
    const value = readValue(token.semanticId)?.trim();
    if (!value) continue;
    const path = token.semanticId.slice(CHART_COLOR_PREFIX.length);
    const entry: ChartColorRole = Object.freeze({
      semanticId: token.semanticId,
      group,
      labelKey: roleLabelKey(path),
      fallbackLabel: token.label,
      value,
    });
    const bucket = byGroup.get(group);
    if (bucket) bucket.push(entry);
    else byGroup.set(group, [entry]);
  }

  const ordered: ChartColorRole[] = [];
  for (const group of CHART_COLOR_ROLE_GROUP_ORDER) {
    const bucket = byGroup.get(group);
    if (!bucket) continue;
    const rank = GROUP_MEMBER_ORDER[group];
    const indexOf = (role: ChartColorRole) => {
      const position = rank.indexOf(role.semanticId.slice(CHART_COLOR_PREFIX.length));
      return position < 0 ? rank.length : position;
    };
    bucket.sort((left, right) => {
      const delta = indexOf(left) - indexOf(right);
      return delta === 0 ? 0 : delta;
    });
    ordered.push(...bucket);
  }
  return Object.freeze(ordered);
}

/** The roles of one group, in offering order. */
export function chartColorRolesInGroup(
  roles: readonly ChartColorRole[],
  group: ChartColorRoleGroup,
): readonly ChartColorRole[] {
  return roles.filter((role) => role.group === group);
}

/**
 * The palette roles a class actually paints through.
 *
 * Some classes have no colour of their own. A body glyph is the clearest case:
 * the scene picks its colour per occurrence, from that planet's own role when
 * individual body colours are on and from its dignity role — domicile,
 * exaltation, exile, fall, else peregrine — when they are not. One class fans
 * out to roughly eighteen roles depending on which planet it is and what
 * condition it is in.
 *
 * Writing a class colour replaces that whole rule with one value, which is why
 * a class like this must be edited through its roles instead. The list is the
 * union of what the scene itself binds, so it cannot drift from what paints;
 * the cost is that it names only the roles this chart currently reaches, which
 * is also the honest answer to "what does this class paint through here".
 */
export function wheelClassPaletteRoles<Element extends {
  readonly tokenBindings: readonly {
    readonly semanticId: string;
    readonly property: string;
  }[];
}>(
  classId: string,
  elements: Iterable<Element>,
  classIdOf: (element: Element) => string | null,
): readonly string[] {
  const roles: string[] = [];
  for (const element of elements) {
    if (classIdOf(element) !== classId) continue;
    for (const binding of element.tokenBindings) {
      if (binding.property !== "color") continue;
      if (chartColorRoleGroup(binding.semanticId) == null) continue;
      if (roles.includes(binding.semanticId)) continue;
      roles.push(binding.semanticId);
    }
  }
  return Object.freeze(roles);
}
