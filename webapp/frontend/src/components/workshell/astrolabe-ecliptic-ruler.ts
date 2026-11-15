// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

// Ecliptic engravings for both plates where the zodiac ring is not drawn
// (always on the polar plate): a graduated scale of ticks
// hanging from the true ecliptic, or a divided band of equal boxes with 1°
// ticks inside. "Line" keeps each plate's plain ecliptic circle. The outer
// edge is always the true ecliptic; everything hangs toward its inside.
// Lengths come from the --aries-astrolabe-ecliptic-* tokens in tick steps.

import type { AstrolabeRenderStyle } from "@/lib/chart/astrolabe-render-style";

export type AstrolabeEclipticStyle = "scale" | "dividedBand" | "line";

export const ASTROLABE_ECLIPTIC_STYLES: readonly AstrolabeEclipticStyle[] = ["scale", "dividedBand", "line"];

export type EclipticEngraving =
  | { kind: "scale"; tick1: number; tick5: number; tick10: number; weight: number }
  | { kind: "dividedBand"; band: number; box: number; innerTick: number };

/** The engraving for a style, or null for the plain line. */
export function eclipticEngraving(
  style: AstrolabeEclipticStyle | undefined,
  layout: AstrolabeRenderStyle["layout"],
): EclipticEngraving | null {
  if (style === "scale") {
    return {
      kind: "scale",
      tick1: layout.eclipticScaleTick1,
      tick5: layout.eclipticScaleTick5,
      tick10: layout.eclipticScaleTick10,
      weight: layout.eclipticScaleWeight,
    };
  }
  if (style === "dividedBand") {
    // Boxes must tile a sign exactly.
    const box = Math.round(layout.eclipticBandBoxDegrees);
    return {
      kind: "dividedBand",
      band: layout.eclipticBandWidthSteps,
      box: box >= 1 && 30 % box === 0 ? box : 5,
      innerTick: layout.eclipticBandTickShare,
    };
  }
  return null;
}

/** One sample per chart-zodiac degree: the true ecliptic point and the unit
 * normal toward the inside of the ecliptic (screen px). */
export type EclipticSample = { x: number; y: number; nx: number; ny: number };

/** Depth of the engraving inward from the true ecliptic (CSS px). */
export function eclipticEngravingDepth(engraving: EclipticEngraving, tickStep: number): number {
  return (engraving.kind === "scale" ? engraving.tick10 : engraving.band) * tickStep;
}

/** Inward unit normals for a closed screen path sampled once per degree,
 * pointing to the side of `inside`. */
export function eclipticSamplesFromPath(points: Array<[number, number]>, inside: [number, number]): EclipticSample[] {
  const count = points.length;
  return points.map(([x, y], index) => {
    const [bx, by] = points[(index + count - 1) % count];
    const [ax, ay] = points[(index + 1) % count];
    const length = Math.hypot(ax - bx, ay - by) || 1;
    let nx = -(ay - by) / length;
    let ny = (ax - bx) / length;
    if (nx * (inside[0] - x) + ny * (inside[1] - y) < 0) { nx = -nx; ny = -ny; }
    return { x, y, nx, ny };
  });
}

/**
 * Engrave the scale or divided band. Sign ticks span `sign.from` (negative:
 * beyond the ecliptic, toward the outside) to `sign.to` inward, so each plate
 * can run them through its own glyph and division lanes.
 */
export function engraveEcliptic(
  ctx: CanvasRenderingContext2D,
  samples: EclipticSample[],
  engraving: EclipticEngraving,
  tickStep: number,
  strokes: { fine: number; medium: number },
  ink: string,
  sign: { from: number; to: number },
): void {
  if (samples.length !== 360) return;
  const at = (sample: EclipticSample, depth: number): [number, number] => (
    [sample.x + sample.nx * depth, sample.y + sample.ny * depth]
  );
  const hairline = Math.max(0.45, strokes.fine * 0.65);
  const stroke = (width: number, trace: () => void) => {
    ctx.beginPath();
    trace();
    ctx.lineWidth = width;
    ctx.stroke();
  };
  const tick = (sample: EclipticSample, from: number, to: number) => {
    ctx.moveTo(...at(sample, from));
    ctx.lineTo(...at(sample, to));
  };
  ctx.save();
  ctx.strokeStyle = ink;
  ctx.lineCap = "butt";
  ctx.lineJoin = "round";
  if (engraving.kind === "scale") {
    const levels: Array<[number, number, (degree: number) => boolean]> = [
      [engraving.tick1, strokes.fine * 0.8, (degree) => degree % 5 !== 0],
      [engraving.tick5, strokes.fine, (degree) => degree % 5 === 0 && degree % 10 !== 0],
      [engraving.tick10, strokes.fine * 1.2, (degree) => degree % 10 === 0 && degree % 30 !== 0],
    ];
    for (const [length, width, takes] of levels) {
      stroke(width * engraving.weight, () => {
        samples.forEach((sample, degree) => { if (takes(degree)) tick(sample, 0, length * tickStep); });
      });
    }
  } else {
    const band = engraving.band * tickStep;
    const { box, innerTick } = engraving;
    // Hairline rails: the outer one is the true ecliptic, the inner one half
    // strength so the eye still finds the exact line.
    const rail = (depth: number) => () => {
      samples.forEach((sample, degree) => (degree ? ctx.lineTo(...at(sample, depth)) : ctx.moveTo(...at(sample, depth))));
      ctx.closePath();
    };
    stroke(hairline, rail(0));
    ctx.save();
    ctx.globalAlpha = 0.5;
    stroke(hairline, rail(band));
    ctx.restore();
    stroke(strokes.fine, () => {
      samples.forEach((sample, degree) => { if (degree % box === 0 && degree % 30 !== 0) tick(sample, 0, band); });
    });
    stroke(hairline, () => {
      samples.forEach((sample, degree) => {
        if (degree % box === 0) return;
        const share = box === 10 && degree % 5 === 0 ? Math.min(0.85, innerTick * 1.6) : innerTick;
        tick(sample, 0, band * share);
      });
    });
  }
  // The scale's sign tick stands out by length only, like the limb's scale.
  stroke(engraving.kind === "scale" ? strokes.fine * 1.2 * engraving.weight : strokes.medium, () => {
    for (let degree = 0; degree < 360; degree += 30) tick(samples[degree], sign.from, sign.to);
  });
  ctx.restore();
}
