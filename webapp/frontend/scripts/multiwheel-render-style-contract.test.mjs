// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(
  new URL("../src/lib/chart/multiwheel-render-style.ts", import.meta.url),
  "utf8",
);
const canvasSource = await readFile(
  new URL("../src/components/workshell/multiwheel-chart-canvas.tsx", import.meta.url),
  "utf8",
);
const chartCanvasSource = await readFile(
  new URL("../src/components/workshell/chart-canvas.tsx", import.meta.url),
  "utf8",
);

test("multi-wheel is an independent renderer rather than another wheel family", () => {
  assert.doesNotMatch(source, /draw-chart|wheel-layout-model/);
  assert.doesNotMatch(source, /WheelLayoutFamily|WheelBandId|WheelRingSet|PROFILE_BODY/);
  assert.match(source, /export function resolveMultiwheelLayout/);
  assert.match(source, /export function drawMultiwheel/);
  assert.match(chartCanvasSource, /props\.chart\.rings\?\.length/);
  assert.match(chartCanvasSource, /<MultiwheelChartCanvas \{\.\.\.props\}/);
});

test("tri and quad layouts are solved from available radius and content", () => {
  assert.match(source, /availableForRings/);
  assert.match(source, /resolvedBandThickness = \(bodyOuter - bodyInner\) \/ ringCount/);
  assert.match(source, /angularCeiling/);
  assert.match(source, /radialCeiling/);
  assert.match(source, /spreadLongitudes/);
  assert.match(source, /minimumGap/);
});

test("the prototype paints the requested visual grammar", () => {
  assert.match(source, /drawChartBand/);
  assert.match(source, /chart\.houses\.cusps/);
  assert.match(source, /drawZodiac/);
  assert.match(source, /drawTermStrip/);
  assert.match(source, /drawDecanStrip/);
  assert.match(source, /draw\.circle\(center, layout\.hubRadius/);
  assert.doesNotMatch(source, /interChartAspects|showAspects|drawAspect/);
  assert.match(canvasSource, /renderer: "multiwheel"/);
  assert.match(canvasSource, /acknowledgePaintedDocumentSnapshot/);
});

test("angle axes remain visible without house cusps and reuse Anglo paint", () => {
  assert.match(source, /function drawMultiwheelAngles/);
  assert.match(source, /drawMultiwheelAngles\(/);
  assert.match(source, /ringIndex,\s+hitRegions,\s+style,/);
  assert.match(source, /index !== 0 && index !== 3 && index !== 6 && index !== 9/);
  assert.match(source, /resolveWheelLinePaint/);
  assert.match(source, /rayWidth = layout\.frameWidth \* 1\.35/);
  assert.match(source, /opacity: 0\.72/);
  assert.match(source, /resolveMultiwheelAngleArrowLength\(band\)/);
  assert.match(source, /return clamp\(\(band\.outer - band\.inner\) \* 0\.05, 4, 7\)/);
  assert.match(source, /halfWidth = clamp\(rayWidth \* 1\.35, 1\.75, 2\.75\)/);
  assert.match(source, /resolveWheelTypographyPaint/);
  assert.match(source, /proportionalSize = clamp\(layout\.glyphSize \* 0\.68, 9, 13\)/);
  assert.match(source, /radialDepth = Math\.max\(labelWidth, labelHeight\)/);
  assert.match(source, /radius = band\.outer/);
  assert.match(source, /label\?: "AC" \| "MC"/);
  assert.match(source, /if \(!label\) return/);
  assert.doesNotMatch(source, /label: "DC"|label: "IC"/);
  assert.doesNotMatch(source, /ANGLE_GLYPHS/);
  assert.match(source, /\[chart\.angles\.asc, chart\.angles\.mc\]/);
  assert.match(source, /showAngleArrowheads !== false/);
  assert.match(canvasSource, /projectWheelAuthoringStyle\(wheelRenderStyle, layout\.maxRadius, "anglo"\)/);
});

test("body and position lanes use one measured stack at every wheel count", () => {
  assert.match(source, /function resolveMultiwheelBodyStackLanes/);
  assert.match(source, /preferredBodyGap = 3/);
  assert.match(source, /preferredPositionGap = 1/);
  assert.match(source, /Math\.min\(1, gapBudget \/ preferredGapTotal\)/);
  assert.match(source, /Math\.max\(depths\.glyph, body\.glyphMeasure\[1\]\)/);
  assert.match(source, /widest: Math\.max\(/);
  assert.match(source, /resolveMultiwheelBodyStackLanes\(band, rowDepths, layout\.houseSize\)/);
  assert.doesNotMatch(source, /glyphRadius = band\.inner \+ bandThickness/);
  assert.doesNotMatch(source, /degreeRadius = band\.inner \+ bandThickness/);
  assert.match(source, /degreeSize = clamp\(layout\.positionSize \* 1\.20, 10, 12\)/);
  assert.match(source, /signSize = clamp\(layout\.positionSize \* 1\.24, 10, 13\)/);
  assert.match(source, /minuteSize = clamp\(layout\.positionSize \* 0\.94, 8, 10\)/);
});

test("every multi-wheel body keeps a short true-longitude foot", () => {
  const layoutSource = source.slice(
    source.indexOf("export function resolveMultiwheelLayout"),
    source.indexOf("type Body ="),
  );
  assert.doesNotMatch(layoutSource, /BodyFoot|bodyFoot/);
  assert.match(source, /function resolveMultiwheelBodyFootLength/);
  assert.match(source, /style\.geometry\.anglo\.leaderInsetScale \* layout\.maxRadius/);
  assert.match(source, /function drawMultiwheelBodyFoot/);
  assert.match(source, /direction: -1 \| 1/);
  assert.match(source, /polar\(center, edgeRadius, trueLongitude, rootAsc\)/);
  assert.match(source, /polar\(center, edgeRadius \+ direction \* footLength, trueLongitude, rootAsc\)/);
  assert.match(source, /Math\.min\(7, bandLimit\)/);
  assert.match(source, /layout\.frameWidth \* 0\.55/);
  assert.match(source, /width: 1/);
  assert.match(source, /resolveWheelLinePaint\(/);
  assert.match(source, /"bodyLeader"/);
  assert.match(source, /"bodies\.inner\.leader"/);
  assert.match(source, /band\.outer,\s+-1,/);
  assert.match(source, /if \(ringIndex !== 0\)/);
  assert.match(source, /band\.inner,\s+1,/);
  assert.match(source, /body\.longitude,\s+rootAsc,/);
});

test("daemon conjunction verdicts color feet without adding an aspect web", () => {
  assert.match(source, /snapshot\.multiwheelConjunctions \?\? \[\]/);
  assert.match(source, /multiwheelEndpointKey\(conjunction\.innerRing, conjunction\.inner\)/);
  assert.match(source, /multiwheelEndpointKey\(conjunction\.outerRing, conjunction\.outer\)/);
  assert.match(source, /multiwheelHoverAspectKey\(body\.hover\)/);
  assert.match(source, /palette\.aspects\[0\] \?\? palette\.frame/);
  assert.match(source, /counterpartRing: number/);
  assert.match(source, /1 - contact\.orb \/ contact\.maxOrb/);
  assert.match(source, /proximity \* proximity \* \(3 - 2 \* proximity\)/);
  assert.doesNotMatch(source, /participantRings/);
  assert.doesNotMatch(source, /angularDistance|conjunctionOrbSetting|calculateConjunction/);
});

test("multi-wheel appearance controls remain local and collapse unused lanes", () => {
  assert.match(source, /multiwheelShowPositions !== false/);
  assert.match(source, /multiwheelShowMinutes !== false/);
  assert.match(source, /positionDepths = \[depths\.degree, depths\.sign, depths\.minute\]/);
  assert.match(source, /degree: showPositions \? degreeSize : 0/);
  assert.match(source, /minute: showMinutes \? minuteSize : 0/);
  assert.match(source, /multiwheelUseSignColors/);
  assert.match(source, /multiwheelSignColors/);
  assert.match(source, /multiwheelShowAngleLabels !== false/);
  assert.doesNotMatch(source, /multiwheelShowAngleLabels[^\n]+drawMultiwheelAngles/);
});

test("multi-wheel preserves established point glyph fonts and avoids prototype chrome", () => {
  assert.match(source, /glyphFont: "text" \| "morinus"/);
  assert.match(source, /body\.glyphFont === "text" \? fontUi : fontSymbols/);
  assert.match(source, /coincidesWithSyzygy/);
  assert.doesNotMatch(source, /`\$\{index \+ 1\} · \$\{chart\.meta\.name\}`/);
  assert.match(canvasSource, /showTerms: Boolean\(rootOptions\.showTerms/);
  assert.match(canvasSource, /showDecans: Boolean\(rootOptions\.showDecans/);
});

test("each ring gets a standard chart identity caption in a canvas corner", () => {
  assert.match(source, /export function multiwheelChartCaption/);
  assert.match(source, /chart\.meta\.titleParts\?\.\[1\]/);
  assert.match(source, /chart\.meta\.place\.trim\(\) \|\| chart\.meta\.placeCoords\.trim\(\)/);
  assert.match(source, /chart\.meta\.numericDateDisplay \?\? chart\.meta\.dateDisplay/);
  assert.match(source, /chart\.meta\.compactTimeDisplay \?\? chart\.meta\.timeDisplay/);
  assert.match(source, /chart\.meta\.timeDisplay/);
  assert.match(source, /drawMultiwheelCornerCaptions/);
  assert.match(source, /rings\.slice\(0, slots\.length\)/);
  assert.match(source, /viewport\.topBoundary \+ edgeInset/);
  assert.match(source, /rings\[0\]\?\.options\.showInformation === false/);
  assert.match(canvasSource, /width: rect\.width, height: rect\.height, topBoundary/);
});

test("corner identity reuses normal-wheel typography with a two-level hierarchy", () => {
  assert.match(source, /resolveWheelOverlayMetrics\(style\.overlays/);
  assert.match(source, /size: overlayMetrics\.infoFontSize/);
  assert.match(source, /"chartOverlay\.information\.topLeft"/);
  assert.match(source, /"chartOverlay\.information\.bottomLeft"/);
  assert.match(source, /role === "name" \? palette\.textBright : basePaint\.color/);
  assert.match(source, /Math\.max\(500, basePaint\.weight\)/);
  assert.match(source, /style\.overlays\.cornerLineHeight/);
  assert.match(source, /style\.overlays\.infoGap/);
  assert.doesNotMatch(source, /layout\.glyphSize \* 0\.82/);
  assert.doesNotMatch(source, /preferredSize \* 0\./);
  assert.match(source, /const blockHeight =/);
  assert.match(source, /slot\.vertical === "top" \? slot\.y : slot\.y - blockHeight/);
  assert.match(source, /caption\.forEach\(\(row, rowIndex\)/);
});

test("multi-wheel bodies expose ring-aware normal chart hover mechanics", () => {
  assert.match(source, /export type MultiwheelHitRegion/);
  assert.match(source, /ringIndex: number/);
  assert.match(source, /hitRegions\.push\(/);
  assert.match(source, /export function findMultiwheelHitRegion/);
  assert.match(source, /kind: "angle"/);
  assert.match(source, /shape: "line"/);
  assert.match(source, /distance <= region\.tolerance \* region\.tolerance/);
  assert.match(canvasSource, /multiwheelHitToHover/);
  assert.match(canvasSource, /kind: "angle",\s+angleId: hit\.angleId/);
  assert.match(canvasSource, /setHoveredRegion\(nextHover\)/);
  assert.match(canvasSource, /setInspectorActiveRegion\(hit \? multiwheelHitToHover\(hit\) : null\)/);
  assert.match(canvasSource, /<ChartHoverFlag anchor=\{flagAnchor\} chart=\{chart\} \/>/);
});
