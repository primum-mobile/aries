#!/usr/bin/env node

// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const frontendRoot = resolve(scriptDir, "..");
const repoRoot = resolve(frontendRoot, "../..");
const manifestPath = resolve(frontendRoot, "src/styles/style-token-public.generated.json");
const outputPath = resolve(repoRoot, "webapp/daemon/style_profile_catalog_generated.py");
const check = process.argv.includes("--check");

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const editable = manifest.tokens.filter((token) => token.handoffStatus === "editable");
const cssToSemantic = new Map(editable.map((token) => [token.cssVar, token.semanticId]));

const ALL_WHEEL_VARIANTS = Object.freeze(["classic", "compact", "anglo"]);
const NON_ANGLO_WHEEL_VARIANTS = Object.freeze(["classic", "compact"]);
const CLASSIC_WHEEL_VARIANT = Object.freeze(["classic"]);
const COMPACT_WHEEL_VARIANT = Object.freeze(["compact"]);
const ANGLO_WHEEL_VARIANT = Object.freeze(["anglo"]);
const WHEEL_LINE_PAINT_ROLES = Object.freeze([
  "majorRing",
  "minorRing",
  "outerMaximumRing",
  "outerHouseRing",
  "outerDegreeRing",
  "zodiacOuterRing",
  "innerDegreeRing",
  "zodiacInnerRing",
  "termRing",
  "cuspOuterRing",
  "innerBoundaryRing",
  "aspectBoundaryRing",
  "houseBoundaryRing",
  "baseRing",
  "degreeTick",
  "subdivision",
  "zodiacSpoke",
  "termBoundary",
  "decanBoundary",
  "houseCusp",
  "angle",
  "bodyLeader",
  "outerLeader",
  "aspect",
]);
const wheelLinePaintMetrics = (roles) =>
  roles.flatMap((role) =>
    ["WidthScale", "Pattern", "DashOn", "DashOff", "Opacity"].map(
      (suffix) => `metric.${role}${suffix}`,
    ),
  );
const COMMON_RING_ROLES = Object.freeze([
  "outerMaximumRing",
  "outerHouseRing",
  "outerDegreeRing",
  "zodiacOuterRing",
  "zodiacInnerRing",
  "termRing",
  "innerBoundaryRing",
  "houseBoundaryRing",
  "baseRing",
]);
const PAINTED_RING_ROLES = Object.freeze([
  ...COMMON_RING_ROLES,
  "innerDegreeRing",
  "cuspOuterRing",
  "aspectBoundaryRing",
]);
const GENERIC_LINE_PAINT_ROLES = Object.freeze(
  WHEEL_LINE_PAINT_ROLES.filter((role) => !PAINTED_RING_ROLES.includes(role)),
);
const paintedRingRadiusMetrics = (profile) =>
  PAINTED_RING_ROLES.map(
    (role) => `metric.${profile}${role[0].toUpperCase()}${role.slice(1)}Radius`,
  );

// Renderer-owned applicability contract. Keep this exhaustive: a new editable
// wheel token must be assigned from its draw-chart/wheel-render-style call site
// instead of inheriting a variant from its name.
const WHEEL_VARIANT_GROUPS = Object.freeze([
  {
    variants: ANGLO_WHEEL_VARIANT,
    tokens: [
      "metric.angleLabelScale",
      "metric.angleLabelWeight",
      "metric.angloAnglePositionScale",
      "metric.angloAspectLeaderInsetScale",
      "metric.angloAspectScale",
      "metric.angloBodyDegreeScale",
      "metric.angloBodyMinuteScale",
      "metric.angloBodySignScale",
      "metric.angloCuspLabelScale",
      "metric.angloHouseScale",
      "metric.angloInnerScale",
      "metric.angloLeaderInsetScale",
      "metric.angloOuterScale",
      "metric.angloPlanetScale",
      "metric.angloPositionInsetScale",
      "metric.angloRulerBaseScale",
      "metric.angloRulerSubdivisionScale",
      "metric.angloAnglePositionDegreeScale",
      "metric.angloAnglePositionGapScale",
      "metric.angloAnglePositionMinuteScale",
      "metric.angloAnglePositionSignScale",
      "metric.angloHousePositionDegreeScale",
      "metric.angloHousePositionGapScale",
      "metric.angloHousePositionMinuteScale",
      "metric.angloHousePositionSignScale",
      "metric.angloSignInnerScale",
      "metric.angloSignScale",
      "metric.angloStructuralStroke",
      "metric.angloSubdivisionScale",
      "metric.angloSubdivisionSector",
      "metric.angloZodiacComparisonWithHouses",
      "metric.angloZodiacSingle",
      "metric.angloZodiacWithOuter",
      "metric.aspectAngloDashOff",
      "metric.aspectAngloDashOn",
      "metric.aspectAngloThicknessDefault",
      "metric.aspectAngloThicknessMax",
      "metric.aspectAngloThicknessMin",
      "metric.aspectAngloWidth",
      "color.angleLabel",
      "color.angloBodyLeader",
      "color.angloHouseLabel",
      "color.angloOuterLeader",
      "color.angloHouseBoundaryRing",
      "color.angloBaseRing",
      "color.cuspOuterRing",
      ...paintedRingRadiusMetrics("anglo"),
      ...wheelLinePaintMetrics(["cuspOuterRing"]),
    ],
  },
  {
    variants: CLASSIC_WHEEL_VARIANT,
    tokens: [
      "metric.classicHouseSectorLength",
      "metric.classicInnerAspectAngle",
      "metric.classicInnerBase",
      "metric.classicInnerHouseName",
      "metric.classicInnerPosition",
      "metric.classicInnerPositionAngle",
      "metric.classicInnerPositionHouses",
      "metric.classicOuterScale",
      "metric.classicRetrogradeOffset",
      "metric.classicSignScale",
      "metric.classicSubdivisionScale",
      "color.aspectBoundaryRing",
      ...paintedRingRadiusMetrics("classic"),
      ...wheelLinePaintMetrics(["aspectBoundaryRing"]),
    ],
  },
  {
    variants: COMPACT_WHEEL_VARIANT,
    tokens: [
      "metric.compactBase",
      "metric.compactComparisonPositionLane0",
      "metric.compactComparisonPositionLane1",
      "metric.compactComparisonPositionLane2",
      "metric.compactHouseName",
      "metric.compactHouseSector",
      "metric.compactOuterScale",
      "metric.compactPositionInset",
      "metric.compactPositionMinuteInsetComparison",
      "metric.compactPositionMinuteInsetSingle",
      "metric.compactPositionMinuteInsetWithOuter",
      "metric.compactRetrogradeInset",
      "metric.compactSignScale",
      "metric.compactSinglePositionLane0",
      "metric.compactSinglePositionLane1",
      "metric.compactSinglePositionLane2",
      "metric.compactSubdivisionScale",
      ...paintedRingRadiusMetrics("compact"),
    ],
  },
  {
    variants: NON_ANGLO_WHEEL_VARIANTS,
    tokens: [
      "metric.ascMcStrokeBase",
      "metric.aspectClassicDashOff",
      "metric.aspectClassicDashOn",
      "metric.aspectClassicThicknessDefault",
      "metric.aspectClassicThicknessMax",
      "metric.aspectClassicThicknessMin",
      "metric.aspectClassicWidth",
      "metric.biwheelArrowLength",
      "metric.biwheelOuterAngle",
      "metric.biwheelOuterHouseSector",
      "metric.biwheelOuterLineOffset",
      "metric.biwheelOuterMax",
      "metric.biwheelOuterMinimum",
      "metric.biwheelOuterPlanetSector",
      "metric.biwheelProjectedLabel",
      "metric.biwheelRetrogradeOffset",
      "metric.biwheelZodiacInset",
      "metric.chartRingStrokeFallback",
      "metric.chartRingStrokeMax",
      "metric.chartRingStrokeMin",
      "metric.classicArrowLength",
      "metric.classicDecanSectorLength",
      "metric.classicDegreeTickLength",
      "metric.classicOuterLine",
      "metric.classicOuterProjectedLabel",
      "metric.classicOuterProjectedLine",
      "metric.classicOuterZodiac",
      "metric.classicPlanetLineLength",
      "metric.classicPlanetSectorLength",
      "metric.classicSignSectorLength",
      "metric.classicTermSectorLength",
      "metric.degreeTickStrokeLarge",
      "metric.degreeTickStrokeSmall",
      "metric.bodyPositionDegreeScale",
      "metric.bodyPositionMinuteScale",
      "metric.anglePositionDegreeScale",
      "metric.anglePositionMinuteScale",
      "metric.housePositionDegreeScale",
      "metric.housePositionMinuteScale",
      "metric.houseClassicOffsetScale",
      "metric.houseSecondOffsetScale",
      "metric.mediumStrokeBase",
      "color.bodyLeader",
      "color.houseLabel",
      "color.houseBoundaryRing",
      "color.baseRing",
      "color.innerDegreeRing",
      ...wheelLinePaintMetrics(["innerDegreeRing"]),
    ],
  },
  {
    variants: ALL_WHEEL_VARIANTS,
    tokens: [
      "font.symbols",
      "font.bodySymbols",
      "font.signSymbols",
      "font.termSymbols",
      "font.decanSymbols",
      "font.aspectSymbols",
      "font.text",
      "color.angleRay",
      "color.decanBoundary",
      "color.decanGlyph",
      "color.houseCusp",
      "color.outerLeader",
      "color.termBoundary",
      "color.termGlyph",
      "color.zodiacSpoke",
      "color.outerMaximumRing",
      "color.outerHouseRing",
      "color.outerDegreeRing",
      "color.zodiacOuterRing",
      "color.zodiacInnerRing",
      "color.termRing",
      "color.innerBoundaryRing",
      "metric.aspectGlyphOffsetScale",
      "metric.aspectGlyphScale",
      "metric.bodyScale",
      "metric.decanGlyphScale",
      "metric.dynamicBlur",
      "metric.dynamicBrightnessScale",
      "metric.dynamicContrastScale",
      "metric.dynamicGrayscaleOpacity",
      "metric.dynamicHueRotate",
      "metric.dynamicInvertOpacity",
      "metric.dynamicOpacity",
      "metric.dynamicSaturateScale",
      "metric.dynamicSepiaOpacity",
      "metric.dynamicShadowBlur",
      "color.dynamicShadowColor",
      "metric.dynamicShadowOffsetX",
      "metric.dynamicShadowOffsetY",
      "metric.geometryBlur",
      "metric.geometryBrightnessScale",
      "metric.geometryContrastScale",
      "metric.geometryGrayscaleOpacity",
      "metric.geometryHueRotate",
      "metric.geometryInvertOpacity",
      "metric.geometryOpacity",
      "metric.geometrySaturateScale",
      "metric.geometrySepiaOpacity",
      "metric.geometryShadowBlur",
      "color.geometryShadowColor",
      "metric.geometryShadowOffsetX",
      "metric.geometryShadowOffsetY",
      "metric.hairlineStroke",
      "metric.houseLabelScale",
      "metric.motionGapMin",
      "metric.motionGapScale",
      "metric.motionRadialNudgeScale",
      "metric.motionScale",
      "metric.motionTangentNudgeScale",
      "metric.outerLabelBlur",
      "metric.outerLabelBrightnessScale",
      "metric.outerLabelContrastScale",
      "metric.outerLabelEdgePadFactor",
      "metric.outerLabelGrayscaleOpacity",
      "metric.outerLabelHueRotate",
      "metric.outerLabelInvertOpacity",
      "metric.outerLabelOpacity",
      "metric.outerLabelSaturateScale",
      "metric.outerLabelScale",
      "metric.outerProjectedGlyphScale",
      "metric.outerLabelSepiaOpacity",
      "metric.outerLabelShadowBlur",
      "color.outerLabelShadowColor",
      "metric.outerLabelShadowOffsetX",
      "metric.outerLabelShadowOffsetY",
      "metric.outerMotionOffsetScale",
      "metric.outerMotionRadiusScale",
      "metric.outerOutsidePadScale",
      "metric.outerRadiusOffsetScale",
      "metric.overlayColumnGapMin",
      "metric.overlayColumnGapScale",
      "metric.overlayCompactBreakpoint",
      "metric.overlayCompactEdgeInsetMin",
      "metric.overlayCompactIconMin",
      "metric.overlayCompactIconScale",
      "metric.overlayCompactInfoFontMin",
      "metric.overlayCompactInfoFontScale",
      "metric.overlayCompactLabelMin",
      "metric.overlayCompactLabelScale",
      "metric.overlayCornerLineHeight",
      "metric.overlayEdgeInsetScale",
      "metric.overlayFontBoxScale",
      "metric.overlayGapAfterDayHourScale",
      "metric.overlayGlyphLineHeight",
      "metric.overlayGroupGapScale",
      "metric.overlayIconMin",
      "metric.overlayIconScale",
      "metric.overlayInfoFontMin",
      "metric.overlayInfoFontScale",
      "metric.overlayInfoGap",
      "metric.overlayLabelMin",
      "metric.overlayLabelScale",
      "metric.overlayMaxWidthViewportScale",
      "metric.overlayRowHeightFactor",
      "metric.overlayTitlebarSafeTop",
      "metric.surveilGlyphGapMin",
      "metric.surveilGlyphGapScale",
      "metric.surveilGlyphSizeMin",
      "metric.surveilGlyphSizeScale",
      "metric.surveilLabelGapMin",
      "metric.surveilLabelGapScale",
      "metric.surveilTickLengthMin",
      "metric.surveilTickLengthScale",
      "metric.syzygyScale",
      "metric.termGlyphScale",
      ...wheelLinePaintMetrics(GENERIC_LINE_PAINT_ROLES),
      ...wheelLinePaintMetrics(COMMON_RING_ROLES),
    ],
  },
]);

const wheelVariantApplicabilityById = new Map();
for (const group of WHEEL_VARIANT_GROUPS) {
  for (const token of group.tokens) {
    const semanticId = `renderer.wheel.${token}`;
    if (wheelVariantApplicabilityById.has(semanticId)) {
      throw new Error(`duplicate wheel variant applicability rule: ${semanticId}`);
    }
    wheelVariantApplicabilityById.set(semanticId, group.variants);
  }
}

const editableWheelTokenIds = new Set(
  editable
    .map((token) => token.semanticId)
    .filter((semanticId) => semanticId.startsWith("renderer.wheel.")),
);
for (const semanticId of wheelVariantApplicabilityById.keys()) {
  if (!editableWheelTokenIds.has(semanticId)) {
    throw new Error(`stale renderer-owned wheel variant applicability rule: ${semanticId}`);
  }
}

function wheelVariantApplicability(semanticId) {
  if (!semanticId.startsWith("renderer.wheel.")) return null;
  const variants = wheelVariantApplicabilityById.get(semanticId);
  if (!variants) {
    throw new Error(`missing renderer-owned wheel variant applicability rule: ${semanticId}`);
  }
  return variants;
}

const tokens = Object.fromEntries(
  editable
    .map((token) => [
      token.semanticId,
      {
        cssVar: token.cssVar,
        scope: token.scope,
        type: token.type,
        unit: token.unit,
        default: token.default,
        bounds: token.bounds ?? null,
        label: token.label,
        description: token.description,
        tier: token.tier,
        affectedSurfaces: token.affectedSurfaces ?? [],
        safetyNotes: token.safetyNotes ?? [],
        variantApplicability: wheelVariantApplicability(token.semanticId),
      },
    ])
    .sort(([left], [right]) => left.localeCompare(right)),
);

const relations = [];
for (const relation of manifest.relationalConstraints ?? []) {
  const names = relation.kind === "minimum-sum"
    ? [relation.target, ...(relation.terms ?? []).map((term) => term.token)]
    : relation.tokens ?? [];
  if (!names.every((name) => cssToSemantic.has(name))) continue;
  if (relation.kind === "ascending") {
    relations.push({
      id: relation.id,
      kind: relation.kind,
      tokens: relation.tokens.map((name) => cssToSemantic.get(name)),
    });
  } else if (relation.kind === "minimum-sum") {
    relations.push({
      id: relation.id,
      kind: relation.kind,
      target: cssToSemantic.get(relation.target),
      terms: relation.terms.map((term) => ({
        token: cssToSemantic.get(term.token),
        multiplier: term.multiplier,
      })),
    });
  }
}

const legacy = Object.fromEntries(
  editable
    .filter((token) => token.legacyMigration?.id)
    .map((token) => [token.legacyMigration.id, token.semanticId])
    .sort(([left], [right]) => left.localeCompare(right)),
);

const data = {
  tokenSchemaVersion: manifest.schemaVersion,
  tokens,
  relations,
  legacy,
};
const serialized = JSON.stringify(data, null, 2);
const rendered = `# Copyright (C) 2026 Max Lange\n` +
  `# SPDX-License-Identifier: AGPL-3.0-or-later\n` +
  `# Generated by webapp/frontend/scripts/generate-style-profile-catalog.mjs.\n` +
  `# Do not edit by hand; semantic ids are the durable profile authority.\n` +
  `from __future__ import annotations\n\n` +
  `import json\n\n` +
  `_CATALOG = json.loads(r'''${serialized}''')\n\n` +
  `TOKEN_SCHEMA_VERSION = _CATALOG["tokenSchemaVersion"]\n` +
  `STYLE_PROFILE_TOKENS = _CATALOG["tokens"]\n` +
  `STYLE_PROFILE_RELATIONS = _CATALOG["relations"]\n` +
  `LEGACY_STYLE_TOKEN_IDS = _CATALOG["legacy"]\n`;

if (check) {
  let current = null;
  try {
    current = readFileSync(outputPath, "utf8");
  } catch {
    // Report the same actionable drift error for a missing artifact.
  }
  if (current !== rendered) {
    console.error("style profile catalog drifted; run npm run style-profile-catalog");
    process.exit(1);
  }
  console.log(`Style profile catalog: PASS (${editable.length} editable semantic tokens, ${Object.keys(legacy).length} legacy mappings)`);
} else {
  writeFileSync(outputPath, rendered, "utf8");
  console.log(`Wrote ${outputPath}`);
}
