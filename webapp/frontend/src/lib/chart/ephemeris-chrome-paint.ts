// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

// Static plate layer: paper, the outer frame and band rules, the faint
// in-plot sign / declination guides, the scale table on the left (sign
// glyphs, modality degree columns or plain degrees) and the degree ruler on
// the right. Repainted only on resize, style, mode, modulus, grid or meta
// change — never per frame.

import {
  clamp,
  DECLINATION_LIMIT,
  mapEphemerisY,
  modalityDegrees,
  modalityRowStep,
  PlateRules,
  PlateText,
  SIGN_NUM,
  TickBuckets,
  type EphemerisDisplayMode,
  type EphemerisGeometry,
  type RuleLevel,
} from "./ephemeris-geometry";
import { sceneModulus } from "./ephemeris-plot-paint";
import type { EphemerisRenderStyle } from "./ephemeris-render-style";
import type { EphemerisScene, EphemerisSurface } from "./ephemeris-scene";

/** Degree-ruler tick level at `degree` (0..M, or ±30 in declination): the
 * labelled step is major, its half medium, single degrees fine; at 360° the
 * ruler keeps 5°/10° ticks and 30° majors without figures. A level is drawn
 * only while its spacing stays legible. */
export function degreeLevel(
  mode: EphemerisDisplayMode,
  modulus: number,
  degree: number,
  pxPerDegree: number,
  minSpacing: number,
): RuleLevel | null {
  const step = Math.abs(degree);
  if (mode === "declination") {
    if (step % 10 === 0) return "major";
    if (step % 5 === 0) return pxPerDegree * 5 >= minSpacing ? "medium" : null;
    return pxPerDegree >= minSpacing ? "fine" : null;
  }
  if (modulus === 360) {
    if (step % 30 === 0) return "major";
    if (step % 10 === 0) return pxPerDegree * 10 >= minSpacing ? "medium" : null;
    if (step % 5 === 0) return pxPerDegree * 5 >= minSpacing ? "fine" : null;
    return null;
  }
  const major = degreeFigureStep(modulus);
  if (step % major === 0) return "major";
  if (major === 10 && step % 5 === 0) return pxPerDegree * 5 >= minSpacing ? "medium" : null;
  return pxPerDegree >= minSpacing ? "fine" : null;
}

/** Figures on the degree ruler: every 10° at 90°, every 5° at 45°/30°; at 360° the
 * sign degrees 10 and 20 are painted separately. */
export function degreeFigureStep(modulus: number): number {
  return modulus === 90 ? 10 : 5;
}

function declinationLabel(value: number): string {
  return `${value > 0 ? "+" : ""}${value}`;
}

/** Declination scales after commit 648eb8d0's decan limbs, as on an
 * astrolabe's graduated limb: on both sides of the plot a closed band with
 * alternating filled and open 10° bars away from the plot and the 5° / 1°
 * graduations on the plot side (the bar edges mark every 10°); signed
 * figures beside the table's limb; the dashed equator through the plot,
 * marked across both limbs. Mirror-aware: the table limb sits on the
 * table's plot edge, the other on the ruler side. */
function paintDeclinationLimbs(
  ctx: CanvasRenderingContext2D,
  dpr: number,
  geo: EphemerisGeometry,
  style: EphemerisRenderStyle,
  equator: boolean,
): void {
  const colors = style.colors;
  const strokes = style.strokes;
  const frame = new PlateRules(ctx, colors.frame, dpr);
  const text = new PlateText(ctx, style.typography.fontUi, 1);
  const yOf = (value: number) => mapEphemerisY(geo, "declination", value);
  const tableDir = geo.mirrored ? -1 : 1; // frame side -> plot side
  const limbs = [
    { inner: geo.tableInner, dir: -tableDir },
    { inner: geo.rulerInner, dir: geo.rulerDir },
  ];
  const limb = geo.limbWidth;
  const barWidth = limb * clamp(style.layout.limbBarShare, 0, 1);
  const tickRoom = Math.max(0, limb - barWidth);
  const snap = (v: number) => Math.round(v * dpr) / dpr;
  if (limb > 0 && barWidth > 0) {
    ctx.save();
    ctx.fillStyle = colors.frame;
    for (const side of limbs) {
      const outer = side.inner + side.dir * limb;
      const barNear = outer - side.dir * barWidth;
      const left = snap(Math.min(outer, barNear));
      const right = snap(Math.max(outer, barNear));
      for (let from = -DECLINATION_LIMIT, k = 0; from < DECLINATION_LIMIT; from += 10, k++) {
        if (k % 2 !== 0) continue;
        const y0 = snap(yOf(from));
        const y1 = snap(yOf(from + 10));
        ctx.fillRect(left, Math.min(y0, y1), right - left, Math.abs(y1 - y0));
      }
    }
    ctx.restore();
    for (const side of limbs) {
      const outer = side.inner + side.dir * limb;
      frame.vertical(outer - side.dir * barWidth, geo.yTop, geo.yBottom, strokes.minorTickWidth);
      frame.vertical(outer, geo.yTop, geo.yBottom, geo.frameW);
    }
  }
  if (tickRoom > 0) {
    const pxPerDegree = geo.plotHeight / (2 * DECLINATION_LIMIT);
    const ticks = new TickBuckets(style);
    for (let degree = -DECLINATION_LIMIT; degree <= DECLINATION_LIMIT; degree++) {
      if (degree % 10 === 0) continue;
      const level = degreeLevel("declination", 360, degree, pxPerDegree, style.ruler.tickMinSpacing);
      if (!level) continue;
      const length = degree % 5 === 0 ? tickRoom : tickRoom / 2;
      const y = yOf(degree);
      for (const side of limbs) {
        const tip = side.inner + side.dir * length;
        ticks.add(level, [Math.min(side.inner, tip), Math.max(side.inner, tip), y]);
      }
    }
    ticks.stroke(frame, "horizontal");
  }
  // Figures, signed, aligned against the table's limb; the ±30 end figures
  // hang inside the plot edge instead of straddling the frame rule.
  const figureX = geo.tableInner - tableDir * (limb + geo.spaceSize * 2);
  const align = tableDir > 0 ? "right" : "left";
  for (let decl = -DECLINATION_LIMIT; decl <= DECLINATION_LIMIT; decl += 10) {
    const edge = Math.abs(decl) === DECLINATION_LIMIT;
    const y = edge ? yOf(decl) + (decl > 0 ? geo.spaceSize : -geo.spaceSize) : yOf(decl);
    const baseline = edge ? (decl > 0 ? "top" : "bottom") : "middle";
    text.draw(figureX, y, declinationLabel(decl), { size: geo.tableFontPx, fill: colors.ink, align, baseline });
  }
  if (equator) {
    const y = yOf(0);
    frame.horizontal(geo.xOrig, geo.plotRight, y, strokes.gridLineWidth, [strokes.gridDashOn, strokes.gridDashOff]);
    for (const side of limbs) {
      const outer = side.inner + side.dir * limb;
      frame.horizontal(Math.min(side.inner, outer), Math.max(side.inner, outer), y, geo.frameW);
    }
  }
}

export function paintEphemerisChrome(
  surface: EphemerisSurface,
  geo: EphemerisGeometry,
  scene: EphemerisScene,
  style: EphemerisRenderStyle,
): void {
  const { ctx, dpr } = surface;
  const colors = style.colors;
  const strokes = style.strokes;
  const ruler = style.ruler;
  const mode = scene.mode;
  const modulus = sceneModulus(scene);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = colors.paper;
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.restore();
  if (geo.w < style.layout.minCanvasWidth || geo.h < style.layout.minCanvasHeight) return;

  const frame = new PlateRules(ctx, colors.frame, dpr);
  const rules = new PlateRules(ctx, colors.rule, dpr);
  const muted = new PlateRules(ctx, colors.muted, dpr);
  const text = new PlateText(ctx, style.typography.fontUi, 1);
  const hair = strokes.hairlineWidth;
  const yOf = (value: number) => mapEphemerisY(geo, mode, value, modulus);
  const guides = (paint: () => void) => {
    ctx.save();
    ctx.globalAlpha = strokes.guideOpacity;
    paint();
    ctx.restore();
  };

  // === Plate: one outer frame; band rules for the header, the plot's top and
  // bottom (frame weight) and the time axis; interior hairlines ===
  frame.rect(geo.outer, geo.outer, geo.plateRight, geo.plateBottom, strokes.plateFrameWidth);
  rules.horizontal(geo.outer, geo.plateRight, geo.headerBottom, hair);
  frame.horizontal(geo.outer, geo.plateRight, geo.yTop, geo.frameW);
  frame.horizontal(geo.outer, geo.plateRight, geo.yBottom, geo.frameW);
  rules.horizontal(geo.outer, geo.plateRight, geo.rulerY, hair);
  rules.vertical(geo.tableInner, geo.yTop, geo.yBottom, hair);
  rules.vertical(geo.xOrig, geo.yTop, geo.rulerY, hair);
  rules.vertical(geo.plotRight, geo.yTop, geo.rulerY, hair);

  // === Faint in-plot guides: sign rules at 360° and the declination grid,
  // only with Show grid (harmonic moduli keep the plot clear) ===
  const equator = mode === "declination" && (scene.showEquator ?? true);
  if (mode === "declination") {
    if (scene.showGrid) {
      guides(() => {
        for (const decl of [20, 10, 0, -10, -20]) {
          if (decl !== 0 || !equator) rules.horizontal(geo.xOrig, geo.plotRight, yOf(decl), hair);
        }
      });
    }
  } else if (scene.showGrid && modulus === 360) {
    guides(() => {
      for (let i = 1; i < SIGN_NUM; i++) rules.horizontal(geo.xOrig, geo.plotRight, yOf(i * 30), hair);
    });
  }

  // === Scale table (left; right when mirrored) ===
  const tableX = (geo.tableLeft + geo.tableRight) / 2;
  const tableText = { size: geo.tableFontPx, fill: colors.ink, align: "center", baseline: "middle" } as const;
  if (mode === "declination") {
    paintDeclinationLimbs(ctx, dpr, geo, style, equator);
  } else if (modulus === 360) {
    guides(() => {
      for (let i = 1; i < SIGN_NUM; i++) rules.horizontal(geo.tableLeft, geo.tableRight, yOf(i * 30), hair);
    });
    for (let i = 0; i < SIGN_NUM; i++) {
      text.draw(tableX, yOf(i * 30 + 15), scene.signGlyphs[i] ?? "", {
        font: style.typography.fontSymbols,
        size: geo.signFontPx,
        fill: colors.signs,
        align: "center",
        baseline: "middle",
      });
    }
  } else if (modulus === 30) {
    const step = modalityRowStep(30, geo.plotHeight, geo.tableFontPx);
    for (let d = 0; d < 30; d += step) text.draw(tableX, yOf(d + step / 2), String(d), tableText);
  } else {
    // 90° / 45°: cardinal, fixed and mutable columns, headed by the four
    // signs of each modality in the top wrap band; each row names the sign
    // degree that folds onto that plotted degree.
    const columnWidth = (geo.tableRight - geo.tableLeft) / 3;
    const columnX = (q: number) => geo.tableLeft + columnWidth * (q + 0.5);
    guides(() => {
      rules.vertical(geo.tableLeft + columnWidth, geo.yTop, geo.yBottom, hair);
      rules.vertical(geo.tableLeft + 2 * columnWidth, geo.yTop, geo.yBottom, hair);
    });
    const glyph = geo.modalityGlyphPx;
    const lowerRow = geo.yTop - geo.spaceSize - glyph / 2;
    const upperRow = lowerRow - glyph - geo.spaceSize * 0.5;
    const signs = (i: number) => scene.signGlyphs[i] ?? "";
    for (let q = 0; q < 3; q++) {
      const paint = { font: style.typography.fontSymbols, size: glyph, fill: colors.signs, align: "center", baseline: "middle" } as const;
      text.draw(columnX(q), upperRow, signs(q) + signs(q + 3), paint);
      text.draw(columnX(q), lowerRow, signs(q + 6) + signs(q + 9), paint);
    }
    const step = modalityRowStep(modulus, geo.plotHeight, geo.tableFontPx);
    for (let d = 0; d < modulus; d += step) {
      const row = modalityDegrees(d, modulus);
      const y = yOf(d + step / 2);
      for (let q = 0; q < 3; q++) {
        if (row[q].length) text.draw(columnX(q), y, String(row[q][0]), tableText);
      }
    }
  }

  // === Degree ruler (right; left when mirrored), hugging the plot; in
  // declination the second decan limb stands there instead ===
  if (mode === "declination") return;
  const lo = 0;
  const hi = modulus;
  const pxPerDegree = geo.plotHeight / (hi - lo);
  const ticks = new TickBuckets(style);
  const lengthOf: Record<RuleLevel, number> = { major: geo.tickMajor, medium: geo.tickMedium, minor: geo.tickMinor, fine: geo.tickFine };
  for (let degree = lo; degree <= hi; degree++) {
    const level = degreeLevel(mode, modulus, degree, pxPerDegree, ruler.tickMinSpacing);
    if (!level) continue;
    const y = degree === hi && mode === "longitude" ? geo.yBottom : yOf(degree);
    const tip = geo.rulerInner + geo.rulerDir * lengthOf[level];
    ticks.add(level, [Math.min(geo.rulerInner, tip), Math.max(geo.rulerInner, tip), y]);
  }
  ticks.stroke(muted, "horizontal");
  if (mode === "longitude") {
    const x = geo.rulerInner + geo.rulerDir * (geo.tickMajor + geo.spaceSize);
    const align = geo.rulerDir > 0 ? "left" : "right";
    const figurePaint = { size: geo.rulerFontPx, fill: colors.muted, align, baseline: "middle" } as const;
    if (modulus === 360) {
      // Degree within the sign at each sign's 10° and 20°, when they fit.
      if (pxPerDegree * 10 >= geo.rulerFontPx * 1.2) {
        for (let degree = 10; degree < 360; degree += 10) {
          if (degree % 30 !== 0) text.draw(x, yOf(degree), String(degree % 30), figurePaint);
        }
      }
    } else {
      const figure = degreeFigureStep(modulus);
      for (let degree = figure; degree < modulus; degree += figure) text.draw(x, yOf(degree), String(degree), figurePaint);
    }
  }
}
