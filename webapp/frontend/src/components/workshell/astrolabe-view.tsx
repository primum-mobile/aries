// SPDX-FileCopyrightText: Morinus contributors
// SPDX-FileCopyrightText: 2026 Max Lange (Aries modifications)
// SPDX-License-Identifier: GPL-3.0-or-later
// Modified for Aries in 2026 by Max Lange.

"use client";

import * as React from "react";

import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { CanvasDraw } from "@/lib/chart/canvas-draw";
import {
  registerChartExportRenderer,
  renderCanvasChartExport,
} from "@/lib/chart/chart-export-registry";
import {
  resolveAstrolabeRenderStyle,
  resolveAstrolabeStrokeWidths,
  type AstrolabeRenderStyle,
} from "@/lib/chart/astrolabe-render-style";
import { morinusTextFontFromTokens } from "@/lib/chart/chart-fonts";
import { awaitFonts } from "@/lib/chart/draw-chart";
import { resolveChartPaintTarget } from "@/lib/chart/outer-glyph-lane";
import { useStyleRevision } from "@/hooks/use-style-revision";
import { ASPECT_GLYPHS, ASP_CONJUNCTION } from "@/lib/chart/glyphs";
import {
  fetchAstrolabe,
  fetchAstrolabeViewState,
  storeAstrolabeViewState,
  type AstrolabeCircle,
  type AstrolabeGeometry,
  type AstrolabeLine,
  type AstrolabePdEvent,
  type AstrolabeViewState,
} from "@/lib/daemon/client";
import { useDaemonWorkspaceStore } from "@/stores/daemon-workspace-store";
import { useChartStyleEditorStore } from "@/stores/chart-style-editor-store";
import { useThemeStore } from "@/stores/theme-store";
import { useT } from "@/lib/i18n/i18n";
import { createResolvedSemanticChartColorResolver } from "@/lib/theme/semantic-color";

// ---------------------------------------------------------------------------
// Planispheric astrolabe — the daemon-owned view-only surface (launcherKind
// "astrolabe"). Faithful to the desktop AstrolabeChart (astrolabechart.py).
//
// DEFAULT = atmospheric view: a filled plate with a sun-altitude-driven sky
// (above horizon) and darkened ground (below), the eccentric ecliptic + sign
// glyphs, projected body spheres (filled above / hollow below the horizon),
// the Equator/Horizon/Ecliptic text labels, the Arc/Age info label and the
// PD-exact overlay. Schematic view is the non-default alternate (no sky fill).
//
// Four OPTIONAL plate-lattice layers (almucantars, azimuth arcs, unequal-hour
// lines, bright-star pointers) are OFF by default; they are explicit webapp-only
// features driven LIVE from the daemon projection (proj.almucantar /
// proj.azimuth_arc), never part of the desktop default surface.
//
// PARADIGM: the daemon (astrolabe_service via astrolabe_projection) owns ALL
// projection geometry AND the engine reads (sky colour, per-sign colour, PD
// list, info-label strings). This view only maps the normalized R_eq=1
// projection space to canvas pixels and draws. The rete arc steps forward only
// and SNAPS to real primary-direction events (geo.pd.snapArcs); nothing
// astrological is computed in TypeScript.
// Oracle: astrolabechart.py drawChart / _draw_atmospheric / _draw_* .
// ---------------------------------------------------------------------------

type LayerToggles = {
  atmospheric: boolean;
  regioHouses: boolean;
  zodiacWheel: boolean;
  almucantars: boolean;
  azimuths: boolean;
  hourLines: boolean;
  stars: boolean;
};

const DEFAULT_TOGGLES: LayerToggles = {
  atmospheric: true, // desktop default (astrolabe_atmospheric=True, morin.py:19259)
  regioHouses: true,
  zodiacWheel: true,
  almucantars: false, // webapp-only lattice — OFF by default
  azimuths: false, // webapp-only lattice — OFF by default
  hourLines: false, // webapp-only synthesis (no wx equivalent) — OFF by default
  stars: false, // bright-star pointers — OFF by default
};

const DEFAULT_VIEW_STATE: AstrolabeViewState = {
  deltaDeg: 0,
  ...DEFAULT_TOGGLES,
};

type Layout = {
  cx: number; // NCP screen x
  cy: number; // NCP screen y
  scale: number; // px per R_eq unit
};

function mapPoint(layout: Layout, x: number, y: number): [number, number] {
  // Projection space: NCP=(0,0), +y down, units of R_eq -> screen pixels.
  return [layout.cx + x * layout.scale, layout.cy + y * layout.scale];
}

function astrolabeTitlebarTopBoundary(hostRect: DOMRect): number {
  const titlebar = document.querySelector<HTMLElement>(
    "[data-aries-titlebar-backplate]",
  );
  if (!titlebar) return 0;
  const titlebarRect = titlebar.getBoundingClientRect();
  if (
    titlebarRect.width <= 0
    || titlebarRect.height <= 0
    || titlebarRect.left >= hostRect.right
    || titlebarRect.right <= hostRect.left
    || titlebarRect.bottom <= hostRect.top
    || titlebarRect.top >= hostRect.bottom
  ) {
    return 0;
  }
  return Math.min(
    hostRect.height,
    Math.max(0, titlebarRect.bottom - hostRect.top),
  );
}

function drawCircle(
  draw: CanvasDraw,
  layout: Layout,
  c: AstrolabeCircle,
  color: string,
  width: number,
  dash?: number[],
) {
  const [sx, sy] = mapPoint(layout, c.cx, c.cy);
  const r = c.r * layout.scale;
  if (!Number.isFinite(r) || r <= 0 || r > 1e5) return;
  const activeDash = dash?.some((value) => value > 0) ? dash : undefined;
  if (activeDash) draw.ctx.setLineDash(activeDash);
  draw.circle([sx, sy], r, { outline: color, width });
  if (activeDash) draw.ctx.setLineDash([]);
}

function drawLine(
  draw: CanvasDraw,
  layout: Layout,
  ln: AstrolabeLine,
  color: string,
  width: number,
  dash?: number[],
) {
  const activeDash = dash?.some((value) => value > 0) ? dash : undefined;
  draw.line([mapPoint(layout, ln.x1, ln.y1), mapPoint(layout, ln.x2, ln.y2)], {
    fill: color,
    width,
    dash: activeDash,
  });
}

/** Atmospheric plate fill: ground over the whole Capricorn disk, sky over the
 * intersection of the horizon circle and the Capricorn disk (the visible sky).
 * The daemon owns the projected horizon and the sun-altitude colour ramp; the
 * renderer preserves those atmospheric colours instead of theme-tokenizing
 * physical daylight. */
function drawAtmosphericPlate(
  draw: CanvasDraw,
  layout: Layout,
  geo: AstrolabeGeometry,
  style: AstrolabeRenderStyle,
) {
  const ctx = draw.ctx;
  const [cx, cy] = mapPoint(layout, geo.tympan.tropicCapricorn.cx, geo.tympan.tropicCapricorn.cy);
  const rCap = geo.radii.capricorn * layout.scale;
  const [hcx, hcy] = mapPoint(layout, geo.tympan.horizon.cx, geo.tympan.horizon.cy);
  const hRad = geo.tympan.horizon.r * layout.scale;

  // Ground = the daemon's darkened sky, filling the whole plate.
  ctx.save();
  ctx.globalAlpha = style.effects.atmosphericFillOpacity;
  ctx.beginPath();
  ctx.arc(cx, cy, rCap, 0, Math.PI * 2);
  ctx.fillStyle = geo.atmospheric.ground;
  ctx.fill();
  ctx.restore();

  // Sky = intersection of the horizon disk and the Capricorn disk.
  ctx.save();
  ctx.globalAlpha = style.effects.atmosphericFillOpacity;
  ctx.beginPath();
  ctx.arc(cx, cy, rCap, 0, Math.PI * 2);
  ctx.clip();
  ctx.beginPath();
  if (Number.isFinite(hRad) && hRad < 1e6) {
    ctx.arc(hcx, hcy, hRad, 0, Math.PI * 2);
  }
  ctx.fillStyle = geo.atmospheric.sky;
  ctx.fill();
  ctx.restore();
}

/** The mater's raised limb: the Capricorn plate is the inner rule and its 360°
 * scale projects outward to a separate rim. This keeps the usable plate clear
 * for projected bodies. Batched paths keep the decorative precision cheap. */
function drawGraduatedLimb(
  draw: CanvasDraw,
  cx: number,
  cy: number,
  plateR: number,
  tickStep: number,
  color: string,
  fineWidth: number,
  mediumWidth: number,
  mainWidth: number,
  innerDash?: readonly number[],
) {
  const outerR = plateR + tickStep * 3;
  draw.circle([cx, cy], outerR, { outline: color, width: fineWidth });
  const dash = innerDash?.some((value) => value > 0) ? [...innerDash] : undefined;
  if (dash) draw.ctx.setLineDash(dash);
  draw.circle([cx, cy], plateR, { outline: color, width: mainWidth });
  if (dash) draw.ctx.setLineDash([]);

  const ctx = draw.ctx;
  const paintTicks = (modulo: number, length: number, width: number) => {
    ctx.save();
    ctx.beginPath();
    for (let degree = 0; degree < 360; degree++) {
      if (degree % modulo !== 0) continue;
      if (modulo === 1 && degree % 5 === 0) continue;
      if (modulo === 5 && degree % 10 === 0) continue;
      const angle = (degree - 90) * Math.PI / 180;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      ctx.moveTo(cx + cos * plateR, cy + sin * plateR);
      ctx.lineTo(cx + cos * (plateR + length), cy + sin * (plateR + length));
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.stroke();
    ctx.restore();
  };
  paintTicks(1, tickStep, fineWidth);
  paintTicks(5, tickStep * 2, fineWidth);
  paintTicks(10, tickStep * 3, mediumWidth);
}

function pdAspectGlyph(aspId: number): string | null {
  if (aspId === ASP_CONJUNCTION) return null;
  return ASPECT_GLYPHS[aspId] ?? null;
}

function render(
  canvas: HTMLCanvasElement,
  geo: AstrolabeGeometry,
  toggles: LayerToggles,
  cssW: number,
  cssH: number,
  style: AstrolabeRenderStyle,
  t: ReturnType<typeof useT>,
  paintTopBoundary = 0,
) {
  const resolveColor = createResolvedSemanticChartColorResolver();
  const draw = new CanvasDraw(canvas);
  draw.setDefaultFont(style.typography.fontUi);
  draw.resize(cssW, cssH);
  draw.fillBackground(style.palette.background);
  const colors = style.palette;
  const dashes = style.strokes.dashes;

  // Use the same permanent-centre/available-frame target as the main wheel.
  // The full Astrolabe envelope stays clear of the titlebar while app panes
  // resize around it, rather than deriving a second positioning convention.
  const target = resolveChartPaintTarget(cssW, cssH, 1, paintTopBoundary, true);
  const size = target.side;
  if (size <= 0) return;

  // Fit the Capricorn disk (the outer plate boundary) into the viewport with
  // NCP at the centre (atmospheric layout — astrolabechart.py:142-153).
  // wx sizes so r_capricorn = CAPRICORN_FILL * maxradius, maxradius = min(w,h)/2
  // (astrolabechart.py:62,135,144-147). chartRpx / maxRadiusPx are the SAME two
  // bases every wx font/sphere/band divisor is taken from — keep them, do NOT
  // re-key proportions to `size` (that inflates everything ~2x).
  const rCap = geo.radii.capricorn || 1.5;
  const maxRadiusPx = size / 2; // wx self.maxradius
  const chartRpx = style.layout.capricornFill * maxRadiusPx; // wx self._chart_r (= r_capricorn, px)
  const scale = chartRpx / rCap;
  const layout: Layout = { cx: cssW / 2, cy: target.centerY, scale };

  const { fine: w1, medium: w2, main: wMain } = resolveAstrolabeStrokeWidths(style, size);
  const schematicDash = <T extends readonly number[]>(dash: T): number[] | undefined => (
    toggles.atmospheric ? undefined : [...dash]
  );

  // === ATMOSPHERIC PLATE FILL (default) ===
  if (toggles.atmospheric) drawAtmosphericPlate(draw, layout, geo, style);

  // Clip everything to the Capricorn disk so projected circles do not overflow.
  draw.ctx.save();
  draw.ctx.beginPath();
  const [capx, capy] = mapPoint(layout, geo.tympan.tropicCapricorn.cx, geo.tympan.tropicCapricorn.cy);
  draw.ctx.arc(capx, capy, rCap * scale, 0, Math.PI * 2);
  draw.ctx.clip();

  // === TYMPAN (fixed plate) ===
  drawCircle(draw, layout, geo.tympan.tropicCancer, colors.tropic, w1, schematicDash(dashes.tropic));
  drawCircle(draw, layout, geo.tympan.equator, colors.equator, w1, schematicDash(dashes.equator));

  // Optional lattice layers — driven live from the daemon, off by default.
  if (toggles.almucantars) {
    for (const a of geo.tympan.almucantars) {
      drawCircle(draw, layout, a, colors.almucantar, a.alt % 20 === 0 ? w2 : w1);
    }
  }
  if (toggles.azimuths) {
    for (const az of geo.tympan.azimuths) {
      drawCircle(draw, layout, az, colors.azimuth, Math.abs(az.az) % 60 === 0 ? w2 : w1);
    }
  }
  if (toggles.hourLines) {
    for (const hl of geo.tympan.hourLines) drawCircle(draw, layout, hl, colors.hour, w1);
  }

  // Regiomontanus intermediate house circles.
  if (toggles.regioHouses) {
    for (const rh of geo.tympan.regioHouses) {
      drawCircle(draw, layout, rh, colors.regio, w1, schematicDash(dashes.regio));
    }
  }

  // Meridian + Asc/Dsc axis (through NCP and horizon centre).
  drawLine(draw, layout, geo.tympan.meridian, colors.meridian, w1, schematicDash(dashes.meridian));
  drawLine(draw, layout, geo.tympan.horizonAxis, colors.meridian, w1, schematicDash(dashes.meridian));

  // Horizon — the prominent blue circle.
  drawCircle(draw, layout, geo.tympan.horizon, colors.horizon, wMain);

  // === RETE (rotating: ecliptic + sign ticks / zodiac band + stars) ===
  const ecl = geo.rete.ecliptic;
  drawCircle(draw, layout, ecl, colors.ecliptic, w2);
  const [eclScrX, eclScrY] = mapPoint(layout, ecl.cx, ecl.cy);

  // Graduated zodiac band — 1/5/10/30° radial ticks from the ecliptic inward,
  // toward the band's inner radius (astrolabechart._draw_zodiac_wheel_band,
  // astrolabechart.py:613-680).
  // Band width / tick step are fractions of maxradius in wx (ZODIAC_SECTOR_LEN /
  // ZODIAC_TICK_LEN, astrolabechart.py:105-106,621-622), NOT of the ecliptic radius.
  const bandWidth = maxRadiusPx * style.layout.bandWidthScale;
  const tickStep = maxRadiusPx * style.layout.tickStepScale;
  const outerR = ecl.r * scale;
  const innerR = Math.max(style.layout.innerRadiusMin, outerR - bandWidth);
  const r5 = Math.max(innerR, outerR - tickStep * 2);
  const r10 = Math.max(innerR, outerR - tickStep * 3);
  const r1 = Math.max(innerR, outerR - tickStep);
  if (toggles.zodiacWheel) {
    draw.circle([eclScrX, eclScrY], innerR, { outline: colors.ecliptic, width: w1 });
    for (const t of geo.zodiacBand.ticks) {
      const [tx, ty] = mapPoint(layout, t.x, t.y);
      let dx = tx - eclScrX;
      let dy = ty - eclScrY;
      const d = Math.hypot(dx, dy);
      if (d < 1e-6) continue;
      dx /= d;
      dy /= d;
      const target = t.level === 30 ? innerR : t.level === 10 ? r10 : t.level === 5 ? r5 : r1;
      const ww = t.level === 30 ? w2 : w1;
      draw.line([[tx, ty], [eclScrX + dx * target, eclScrY + dy * target]], {
        fill: colors.ecliptic,
        width: ww,
      });
    }
  }

  // Bright-star pointers (optional) — small dots on the rete.
  if (toggles.stars) {
    const starR = Math.max(style.markers.starRadiusMin, size / style.markers.starRadiusDivisor);
    for (const st of geo.rete.stars) {
      const [px, py] = mapPoint(layout, st.x, st.y);
      draw.circle([px, py], starR, { fill: colors.star });
    }
  }

  draw.ctx.restore(); // end Capricorn clip

  // === SIGN GLYPHS — placed just inside the zodiac band, per-sign colour ===
  // wx fntSigns = chart_r / SIGN_GLYPH_DIV(22) (astrolabechart.py:66,179).
  const signGlyphSize = chartRpx / style.typography.signFontDivisor;
  const signCull = chartRpx * style.layout.signCullScale; // wx margin (astrolabechart.py:667,676)
  const glyphR = outerR - bandWidth / 2;
  if (toggles.zodiacWheel) {
    for (const g of geo.zodiacBand.glyphs) {
      const [mx, my] = mapPoint(layout, g.x, g.y);
      const dx = mx - eclScrX;
      const dy = my - eclScrY;
      const d = Math.hypot(dx, dy);
      if (d < 1e-6) continue;
      const gx = eclScrX + (dx / d) * glyphR;
      const gy = eclScrY + (dy / d) * glyphR;
      if (Math.hypot(gx - layout.cx, gy - layout.cy) > chartRpx + signCull) continue;
      draw.text([gx, gy], g.glyph, {
        font: style.typography.fontSymbols,
        size: signGlyphSize,
        fill: resolveColor(g.colorRole, g.color) ?? g.color,
        align: "center",
        baseline: "middle",
      });
    }
  }

  // === BODIES — sphere at true RA/Dec, dotted connector to ecliptic foot,
  // Morinus glyph label (astrolabechart.py:911-982). ===
  // wx: sphere_r = chart_r/PLANET_SPHERE_DIV(160), fntPlanets = chart_r/PLANET_GLYPH_DIV(16),
  // label_pad = sphere_r + chart_r*PLANET_LABEL_PAD/1000 (astrolabechart.py:65,109-110,178,686,711).
  const sphereR = Math.max(
    style.markers.sphereRadiusMin,
    chartRpx / style.markers.sphereRadiusDivisor,
  );
  const glyphSize = chartRpx / style.typography.planetFontDivisor;
  const labelPad = sphereR + chartRpx * style.layout.bodyLabelPadScale;
  const viewportClearance = Math.max(wMain * 2, glyphSize * 0.45);
  const limbClearance = Math.max(wMain * 2, glyphSize * 0.12);
  const bodyLabelTop = Math.max(paintTopBoundary, 0) + viewportClearance;
  const bodyLabelBottom = Math.max(bodyLabelTop, cssH - viewportClearance);

  type Item = {
    gx: number; gy: number; sx: number; sy: number; ex: number; ey: number;
    glyph: string; color: string; tw: number; th: number; above: boolean; isSun: boolean;
  };
  const clampBodyLabel = (item: Item) => {
    const minX = viewportClearance;
    const maxX = Math.max(minX, cssW - viewportClearance - item.tw);
    const minY = bodyLabelTop;
    const maxY = Math.max(minY, bodyLabelBottom - item.th);
    item.gx = Math.min(maxX, Math.max(minX, item.gx));
    item.gy = Math.min(maxY, Math.max(minY, item.gy));

    // Keep the complete glyph rectangle inside the Capricorn plate. The limb
    // now owns the exterior annulus, so collision pushes cannot send labels
    // back through the engraved ruler or into the titlebar above it.
    const labelCx = item.gx + item.tw / 2;
    const labelCy = item.gy + item.th / 2;
    const fromCentreX = labelCx - layout.cx;
    const fromCentreY = labelCy - layout.cy;
    const centreDistance = Math.hypot(fromCentreX, fromCentreY);
    const maxCentreDistance = Math.max(
      0,
      chartRpx - limbClearance - Math.hypot(item.tw, item.th) / 2,
    );
    if (centreDistance > maxCentreDistance && centreDistance > 1e-6) {
      item.gx = layout.cx + fromCentreX / centreDistance * maxCentreDistance - item.tw / 2;
      item.gy = layout.cy + fromCentreY / centreDistance * maxCentreDistance - item.th / 2;
    }
  };
  const items: Item[] = [];
  for (const b of geo.bodies) {
    const [sx, sy] = mapPoint(layout, b.sphere.x, b.sphere.y);
    if (Math.hypot(sx - layout.cx, sy - layout.cy) > rCap * scale * style.layout.bodyCullScale) continue;
    const [ex, ey] = mapPoint(layout, b.ecliptic.x, b.ecliptic.y);
    const [tw] = draw.textsize(b.glyph, { font: style.typography.fontSymbols, size: glyphSize });
    const th = glyphSize;
    const radialDistance = Math.hypot(sx - layout.cx, sy - layout.cy);
    const ux = radialDistance > 1e-6 ? (sx - layout.cx) / radialDistance : 1;
    const uy = radialDistance > 1e-6 ? (sy - layout.cy) / radialDistance : 0;
    const labelDistance = labelPad + Math.max(tw, th) * 0.45;
    const labelHalfDiagonal = Math.hypot(tw, th) / 2;
    const outwardCrossesLimb = (
      radialDistance + labelDistance + labelHalfDiagonal
      > chartRpx - limbClearance
    );
    const labelDirection = outwardCrossesLimb ? -1 : 1;
    const labelCx = sx + ux * labelDistance * labelDirection;
    const labelCy = sy + uy * labelDistance * labelDirection;
    const item: Item = {
      gx: labelCx - tw / 2, gy: labelCy - th / 2, sx, sy, ex, ey,
      glyph: b.glyph,
      color: resolveColor(b.colorRole, b.color) ?? b.color,
      tw,
      th,
      above: b.above,
      isSun: b.isSun,
    };
    clampBodyLabel(item);
    items.push(item);
  }
  const pushMargin = items.length ? items[0].th * style.collision.marginScale : 0;
  for (let iter = 0; iter < style.collision.iterations; iter++) {
    let moved = false;
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const si = items[i];
        const sj = items[j];
        const ox = Math.min(si.gx + si.tw, sj.gx + sj.tw) - Math.max(si.gx, sj.gx);
        const oy = Math.min(si.gy + si.th, sj.gy + sj.th) - Math.max(si.gy, sj.gy);
        if (ox > -pushMargin && oy > -pushMargin) {
          let dy = sj.gy - si.gy;
          if (Math.abs(dy) < style.collision.minDelta) dy = style.collision.tieDelta;
          const push = ((si.th + sj.th) / 2 + pushMargin) * style.collision.pushScale;
          if (dy > 0) {
            si.gy -= push * style.collision.moveScale;
            sj.gy += push * style.collision.moveScale;
          } else {
            si.gy += push * style.collision.moveScale;
            sj.gy -= push * style.collision.moveScale;
          }
          clampBodyLabel(si);
          clampBodyLabel(sj);
          moved = true;
        }
      }
    }
    if (!moved) break;
  }

  for (const it of items) {
    // Dotted connector from sphere to its zodiacal-degree foot.
    draw.line([[it.sx, it.sy], [it.ex, it.ey]], {
      fill: it.color,
      width: w1,
      dash: [...dashes.connector],
      opacity: style.strokes.connectorOpacity,
    });
    // Sphere — filled (above horizon / Sun) or hollow (below horizon).
    const r = it.isSun ? sphereR * style.markers.sunSphereScale : sphereR;
    if (it.isSun) {
      draw.circle([it.sx, it.sy], r, {
        fill: colors.sunFill,
        outline: colors.ecliptic,
        width: style.strokes.sphereOutlineWidth,
      });
    } else if (it.above) {
      draw.circle([it.sx, it.sy], r, {
        fill: it.color,
        outline: it.color,
        width: style.strokes.sphereOutlineWidth,
      });
    } else {
      draw.circle([it.sx, it.sy], r, {
        outline: it.color,
        width: style.strokes.sphereOutlineWidth,
      });
    }
    draw.text([it.gx, it.gy], it.glyph, {
      font: style.typography.fontSymbols,
      size: glyphSize,
      fill: it.color,
      align: "left",
      baseline: "top",
    });
  }

  // === CIRCLE TEXT LABELS (Equator / Horizon / Ecliptic) ===
  // wx fntLabel = chart_r / LABEL_TEXT_DIV(36) (astrolabechart.py:69,181).
  const labelSize = chartRpx / style.typography.circleLabelFontDivisor;
  const labels: Array<[string, { x: number; y: number }, string]> = [
    [t("astrolabe.equator"), geo.circleLabels.equator, colors.equatorLabel],
    [t("astrolabe.horizon"), geo.circleLabels.horizon, colors.horizon],
    [t("astrolabe.ecliptic"), geo.circleLabels.ecliptic, colors.ecliptic],
  ];
  for (const [txt, anchor, color] of labels) {
    const [lx, ly] = mapPoint(layout, anchor.x, anchor.y);
    draw.text([
      lx + style.layout.circleLabelOffsetX,
      ly + style.layout.circleLabelOffsetY,
    ], txt, {
      size: labelSize,
      fill: color,
      align: "left",
      baseline: "top",
    });
  }

  // === CARDINAL LABELS (S top / N bottom / E left / W right) ===
  // wx places these on the CAPRICORN boundary, centred on the NCP — NOT on the
  // horizon circle (whose radius balloons past the plate at mid-latitudes).
  // pad = chart_r*0.06, fntCardinal = chart_r/CARDINAL_DIV(22) (astrolabechart.py:67,182,774-787).
  const ncx = layout.cx;
  const ncy = layout.cy;
  const capPad = chartRpx * style.layout.cardinalPadScale;
  const limbOuterR = chartRpx + tickStep * 3;
  const cardinalSize = chartRpx / style.typography.cardinalFontDivisor;
  const cardinals: Array<[string, number, number]> = [
    [t("astrolabe.cardinalS"), ncx, ncy - limbOuterR - capPad],
    [t("astrolabe.cardinalN"), ncx, ncy + limbOuterR + capPad],
    [t("astrolabe.cardinalE"), ncx - limbOuterR - capPad, ncy],
    [t("astrolabe.cardinalW"), ncx + limbOuterR + capPad, ncy],
  ];
  for (const [lbl, x, y] of cardinals) {
    draw.text([x, y], lbl, {
      size: cardinalSize,
      fill: colors.cardinal,
      align: "center",
      baseline: "middle",
    });
  }

  // The mater/limb is the visual frame: a solid boundary, inner rule, and
  // fixed one-degree scale. Schematic mode retains its dotted construction
  // treatment; the default atmospheric presentation reads as engraved metal.
  drawGraduatedLimb(
    draw,
    layout.cx,
    layout.cy,
    chartRpx,
    tickStep,
    colors.capricorn,
    w1,
    w2,
    wMain,
    schematicDash(dashes.capricorn),
  );
  draw.circle([layout.cx, layout.cy], Math.max(style.markers.sphereRadiusMin, wMain * 1.5), {
    fill: colors.background,
    outline: colors.capricorn,
    width: w1,
  });

  // === INFO LABEL (top-left): Arc d°m's" + Age N yrs (daemon strings) ===
  // wx fntBigText = (maxradius/16)*0.75 (astrolabechart.py:183).
  const infoSize = (maxRadiusPx / style.typography.infoFontDivisor) * style.typography.infoFontScale;
  const infoX = cssW / style.layout.infoInsetDivisor;
  const infoY = cssH / style.layout.infoInsetDivisor;
  const infoClr = toggles.atmospheric ? colors.infoAtmospheric : colors.infoSchematic;
  draw.text([infoX, infoY], geo.infoLabel.arc, { size: infoSize, fill: infoClr, align: "left", baseline: "top" });
  draw.text([infoX, infoY + infoSize * style.layout.infoLineHeightScale], geo.infoLabel.age, {
    size: infoSize,
    fill: infoClr,
    align: "left",
    baseline: "top",
  });

  // === PD-EXACT OVERLAY (top-right): nearby directed events ===
  const ev = geo.pd.nearbyEvents;
  if (ev.length) {
    // wx overlay fonts: icon = chart_r/SIGN_GLYPH_DIV(22), text = chart_r/LABEL_TEXT_DIV(36)
    // (astrolabechart.py:186-189); one row size splits the difference.
    const rowSize = chartRpx / style.typography.pdRowFontDivisor;
    const xR = cssW - cssW / style.layout.infoInsetDivisor;
    let y = cssH / style.layout.infoInsetDivisor;
    const rowH = rowSize * style.layout.pdRowHeightScale;
    for (const e of ev) {
      drawPdOverlayRow(draw, e, xR, y, rowSize, infoClr, style);
      y += rowH;
    }
  }
}

/** One right-aligned PD-exact overlay row: prom (asp) sig  D/C  M/Z  +Ny.
 * Mirrors AstrolabeChart._draw_pd_overlay (astrolabechart.py:1199-1299). */
function drawPdOverlayRow(
  draw: CanvasDraw,
  e: AstrolabePdEvent,
  xRight: number,
  y: number,
  size: number,
  clr: string,
  style: AstrolabeRenderStyle,
) {
  const promGlyph = e.promGlyph ?? null;
  const sigGlyph = e.sigGlyph ?? null;
  const aspGlyph = pdAspectGlyph(e.promasp) ?? pdAspectGlyph(e.sigasp);
  const dirMarker = e.direct ? "D" : "C";
  const modeMarker = e.mundane ? "M" : "Z";
  const offset = `${e.offsetYears >= 0 ? "+" : ""}${e.offsetYears.toFixed(1)}y`;

  // Build the row tokens right-to-left so the column stays right-aligned.
  const gap = size * style.layout.pdTokenGapScale;
  let x = xRight;

  const drawTok = (txt: string, morinus: boolean) => {
    const opts = morinus
      ? { font: style.typography.fontSymbols, size, fill: clr, align: "right" as const, baseline: "top" as const }
      : { size, fill: clr, align: "right" as const, baseline: "top" as const };
    const [tw] = draw.textsize(txt, opts);
    draw.text([x, y], txt, opts);
    x -= tw + gap;
  };

  drawTok(offset, false);
  drawTok(modeMarker, false);
  drawTok(dirMarker, false);
  // Significator: glyph if planet/LoF, else daemon text label.
  if (sigGlyph != null) drawTok(sigGlyph, true);
  else drawTok(e.sigText || "?", false);
  if (aspGlyph != null) drawTok(aspGlyph, true);
  // Promissor.
  if (promGlyph != null) drawTok(promGlyph, true);
  else drawTok(e.promText || "?", false);
}

export function AstrolabeView({
  sourceName,
  source,
  documentId,
}: {
  sourceName: string;
  source?: string;
  documentId?: string;
}) {
  const wrapRef = React.useRef<HTMLDivElement>(null);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const [geo, setGeo] = React.useState<AstrolabeGeometry | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [delta, setDelta] = React.useState(DEFAULT_VIEW_STATE.deltaDeg);
  const [fontsReadyFor, setFontsReadyFor] = React.useState<string | null>(null);
  const [toggles, setToggles] = React.useState<LayerToggles>(DEFAULT_TOGGLES);
  const deltaRef = React.useRef(DEFAULT_VIEW_STATE.deltaDeg);
  const togglesRef = React.useRef<LayerToggles>(DEFAULT_TOGGLES);
  const persistQueueRef = React.useRef<Promise<void>>(Promise.resolve());
  const t = useT();
  const theme = useThemeStore((s) => s.theme);
  const styleRevision = useStyleRevision();
  const liveStylePreviewRevision = useChartStyleEditorStore((state) => (
    state.liveAppThemePreview ? `live:${state.revision}` : "live:off"
  ));
  const paintRevision = `${styleRevision}:${liveStylePreviewRevision}`;
  const sessionRefreshSeq = useDaemonWorkspaceStore((state) => {
    const change = state.lastSessionChange;
    if (!documentId || !change) return 0;
    return change.docId === documentId || change.rebuiltChildIds.includes(documentId)
      ? change.seq
      : 0;
  });
  const geometryRevision = String(sessionRefreshSeq);
  const chartTextFont = morinusTextFontFromTokens(theme?.appTokens);
  const chartSymbolFont =
    theme?.appTokens?.["--aries-font-symbols"]?.trim() || '"AriesMorinus"';
  const chartFontKey = `${chartTextFont}\u0000${chartSymbolFont}`;
  const fontsReady = fontsReadyFor === chartFontKey;

  React.useEffect(() => {
    let cancelled = false;
    void awaitFonts(chartTextFont, chartSymbolFont).then(() => {
      if (!cancelled) setFontsReadyFor(chartFontKey);
    });
    return () => {
      cancelled = true;
    };
  }, [chartFontKey, chartSymbolFont, chartTextFont]);

  // View state belongs to the radix in the daemon. Restore it without blanking
  // the retained plate; display gestures still paint locally before the quiet
  // persistence request completes.
  React.useEffect(() => {
    if (!documentId) return;
    const controller = new AbortController();
    void fetchAstrolabeViewState(documentId, controller.signal)
      .then((state) => {
        if (controller.signal.aborted) return;
        const nextToggles: LayerToggles = {
          atmospheric: state.atmospheric,
          regioHouses: state.regioHouses,
          zodiacWheel: state.zodiacWheel,
          almucantars: state.almucantars,
          azimuths: state.azimuths,
          hourLines: state.hourLines,
          stars: state.stars,
        };
        const nextDelta = Math.max(0, state.deltaDeg);
        togglesRef.current = nextToggles;
        deltaRef.current = nextDelta;
        setToggles(nextToggles);
        setDelta(nextDelta);
      })
      .catch((err) => {
        if ((err as { name?: string }).name === "AbortError") return;
        console.error("[astrolabe-view-state]", err);
      });
    return () => controller.abort();
  }, [documentId]);

  const persistViewState = React.useCallback((
    nextToggles: LayerToggles = togglesRef.current,
    nextDelta: number = deltaRef.current,
  ) => {
    if (!documentId) return;
    const state: AstrolabeViewState = { deltaDeg: nextDelta, ...nextToggles };
    persistQueueRef.current = persistQueueRef.current
      .catch(() => undefined)
      .then(() => storeAstrolabeViewState(documentId, state))
      .catch((err) => {
        console.error("[astrolabe-view-state]", err);
      });
  }, [documentId]);

  // Geometry fetch — COALESCING, mirroring the desktop drag model
  // (_on_drag → apply_delta → drawBkg, morin.py:19414-19431) where wx natively
  // coalesces repaints. A rete drag fires many 0.25° deltas; aborting+restarting
  // a request per step starved the repaint (the canvas only updated when one
  // slipped through). Instead keep ONE request in flight and, on completion,
  // immediately re-fetch the LATEST delta if it moved on — intermediate steps
  // are skipped, so the canvas tracks the cursor at daemon speed (~17 ms).
  const inflightRef = React.useRef(false);
  const wantDeltaRef = React.useRef(0);
  const wantRevisionRef = React.useRef(geometryRevision);
  const doneDeltaRef = React.useRef<number | null>(null);
  const doneRevisionRef = React.useRef<string | null>(null);

  const pumpFetch = React.useCallback(() => {
    if (inflightRef.current) return;
    inflightRef.current = true;
    void (async () => {
      try {
        while (
          doneDeltaRef.current !== wantDeltaRef.current ||
          doneRevisionRef.current !== wantRevisionRef.current
        ) {
          const d = wantDeltaRef.current;
          const revision = wantRevisionRef.current;
          const g = await fetchAstrolabe(sourceName, { delta: d, source, documentId });
          doneDeltaRef.current = d;
          doneRevisionRef.current = revision;
          if (revision !== wantRevisionRef.current) continue;
          setGeo(g);
          setError(null);
        }
      } catch (err) {
        console.error("[astrolabe]", err);
        setError(String((err as Error).message ?? err));
      } finally {
        inflightRef.current = false;
      }
    })();
  }, [sourceName, source, documentId]);

  // New source → invalidate the fetched-arc cache so the next pump refetches
  // even if the arc value is unchanged (mutating a ref, not setState).
  React.useEffect(() => {
    doneDeltaRef.current = null;
    doneRevisionRef.current = null;
  }, [sourceName, source, documentId]);

  // Arc or session changed → retain the current plate while the daemon supplies
  // the latest geometry. Style-only changes repaint the retained geometry below.
  React.useEffect(() => {
    wantDeltaRef.current = delta;
    wantRevisionRef.current = geometryRevision;
    pumpFetch();
  }, [delta, geometryRevision, pumpFetch]);

  // Draw on geometry / size / font / toggle change.
  React.useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas || !geo || !fontsReady) return;

    const paint = () => {
      const rect = wrap.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const renderStyle = resolveAstrolabeRenderStyle(wrap, {
        revision: paintRevision,
        fontUi: chartTextFont,
        fontSymbols: chartSymbolFont,
      });
      render(
        canvas,
        geo,
        toggles,
        rect.width,
        rect.height,
        renderStyle,
        t,
        astrolabeTitlebarTopBoundary(rect),
      );
    };
    let resizeFrame = 0;
    const schedulePaint = () => {
      window.cancelAnimationFrame(resizeFrame);
      resizeFrame = window.requestAnimationFrame(paint);
    };
    paint();
    const ro = new ResizeObserver(schedulePaint);
    ro.observe(wrap);
    return () => {
      window.cancelAnimationFrame(resizeFrame);
      ro.disconnect();
    };
  }, [chartSymbolFont, chartTextFont, geo, fontsReady, toggles, t, paintRevision]);

  React.useEffect(() => {
    if (!documentId || !geo || !canvasRef.current) return;
    return registerChartExportRenderer(documentId, (request) => {
      const canvas = canvasRef.current;
      if (!canvas) throw new Error("visible astrolabe renderer unavailable");
      return renderCanvasChartExport(canvas, request);
    });
  }, [documentId, geo]);

  const toggle = React.useCallback((key: keyof LayerToggles) => {
    const current = togglesRef.current;
    const next = { ...current, [key]: !current[key] };
    togglesRef.current = next;
    setToggles(next);
    persistViewState(next);
  }, [persistViewState]);

  // === RETE ROTATION — drag the canvas, matching the wx _install_astrolabe_drag
  // model (morin.py:19406-19431): full viewport width = 360°, forward-only
  // (clamp ≥ 0). There is NO slider in the desktop app. ===
  const dragRef = React.useRef<{ startX: number; startDelta: number; w: number } | null>(null);

  const onPointerDown = React.useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (e.button !== 0) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        /* capture is best-effort */
      }
      dragRef.current = {
        startX: e.clientX,
        startDelta: deltaRef.current,
        w: canvas.clientWidth || 1,
      };
    },
    [],
  );

  const onPointerMove = React.useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const ds = dragRef.current;
    if (!ds) return;
    const degPerPx = 360 / (ds.w || 1);
    const next = ds.startDelta + (e.clientX - ds.startX) * degPerPx;
    // Quantise to 0.25° to bound the daemon refetch rate; clamp forward-only.
    const clamped = Math.max(0, Math.round(next * 4) / 4);
    deltaRef.current = clamped;
    setDelta(clamped);
  }, []);

  const endDrag = React.useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (canvas?.hasPointerCapture?.(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    if (dragRef.current) persistViewState(togglesRef.current, deltaRef.current);
    dragRef.current = null;
  }, [persistViewState]);

  // === KEYBOARD STEPPING — mirrors _AstrolabeStepper.handle_navigation_key
  // (morin.py:19335-19394): ←/→ step time (1yr / Shift 1mo / Alt 1wk) via the
  // active PD key, ↑/↓ jump to the prev/next PD event, Space resets to 0°. ===
  const onKeyDown = React.useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (!geo) return;
      const ypd = geo.yearsPerDegree > 0 ? geo.yearsPerDegree : 1;
      const snap = geo.pd.snapArcs;
      let next = deltaRef.current;
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        let yrs = e.altKey ? 7 / 365.2425 : e.shiftKey ? 1 / 12 : 1;
        if (e.key === "ArrowLeft") yrs = -yrs;
        const step = yrs / ypd;
        next = Math.max(0, next + step);
      } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        const forward = e.key === "ArrowUp";
        if (forward) {
          for (const arc of snap) {
            if (arc > next + 0.001) {
              next = arc;
              break;
            }
          }
        } else {
          next = 0;
          for (let i = snap.length - 1; i >= 0; i--) {
            if (snap[i] < deltaRef.current - 0.001) {
              next = snap[i];
              break;
            }
          }
        }
      } else if (e.key === " " || e.code === "Space") {
        next = 0;
      } else {
        return;
      }
      deltaRef.current = next;
      setDelta(next);
      persistViewState(togglesRef.current, next);
      e.preventDefault();
      e.stopPropagation();
    },
    [geo, persistViewState],
  );

  return (
    <div className="font-morinus-text relative flex h-full w-full min-w-0 flex-1 min-h-0 flex-col overflow-hidden bg-background">
      <ContextMenu>
        <ContextMenuTrigger
          render={(
            <div
              ref={wrapRef}
              tabIndex={0}
              onKeyDown={onKeyDown}
              className="relative h-full w-full min-w-0 flex-1 min-h-0 overflow-hidden outline-none"
            >
              <canvas
                ref={canvasRef}
                onPointerDown={(e) => {
                  wrapRef.current?.focus();
                  onPointerDown(e);
                }}
                onPointerMove={onPointerMove}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                className="block h-full w-full cursor-grab touch-none active:cursor-grabbing"
              />
              {error ? (
                <div className="absolute inset-0 flex items-center justify-center text-[length:var(--aries-font-size-base)] text-destructive">
                  {t("astrolabe.failed", { error })}
                </div>
              ) : !geo ? (
                <div className="absolute inset-0 flex items-center justify-center text-[length:var(--aries-font-size-base)] text-muted-foreground">
                  {t("astrolabe.loading")}
                </div>
              ) : null}
            </div>
          )}
        />
        <AstrolabeViewMenu toggles={toggles} onToggle={toggle} />
      </ContextMenu>
    </div>
  );
}

function AstrolabeViewMenu({
  toggles,
  onToggle,
}: {
  toggles: LayerToggles;
  onToggle: (key: keyof LayerToggles) => void;
}) {
  const t = useT();
  const primaryItems: Array<[keyof LayerToggles, string]> = [
    ["atmospheric", t("astrolabe.atmospheric")],
    ["regioHouses", t("astrolabe.regioHouses")],
    ["zodiacWheel", t("astrolabe.zodiacWheel")],
  ];
  const detailItems: Array<[keyof LayerToggles, string]> = [
    ["almucantars", t("astrolabe.almucantars")],
    ["azimuths", t("astrolabe.azimuths")],
    ["hourLines", t("astrolabe.hourLines")],
    ["stars", t("astrolabe.stars")],
  ];
  return (
    <ContextMenuContent className="min-w-[var(--aries-menu-context-min-width)]">
      <ContextMenuGroup>
        <ContextMenuLabel>{t("astrolabe.viewSettings")}</ContextMenuLabel>
        {primaryItems.map(([key, label]) => (
          <ContextMenuCheckboxItem
            key={key}
            checked={toggles[key]}
            closeOnClick={false}
            onCheckedChange={() => onToggle(key)}
          >
            {label}
          </ContextMenuCheckboxItem>
        ))}
      </ContextMenuGroup>
      <ContextMenuSeparator />
      <ContextMenuGroup>
        {detailItems.map(([key, label]) => (
          <ContextMenuCheckboxItem
            key={key}
            checked={toggles[key]}
            closeOnClick={false}
            onCheckedChange={() => onToggle(key)}
          >
            {label}
          </ContextMenuCheckboxItem>
        ))}
      </ContextMenuGroup>
    </ContextMenuContent>
  );
}
