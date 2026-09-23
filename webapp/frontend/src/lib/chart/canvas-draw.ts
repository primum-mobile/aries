// SPDX-FileCopyrightText: Morinus contributors
// SPDX-FileCopyrightText: 2026 Max Lange (Aries modifications)
// SPDX-License-Identifier: GPL-3.0-or-later
// Modified for Aries in 2026 by Max Lange.

/**
 * Canvas 2D implementation of the Morinus draw adapter.
 * Mirrors wxcompat.DCPILDraw's 4-method contract so drawChart() can be ported
 * without re-thinking coordinates — same call shape, identical output.
 *
 *   draw.text([x, y], "A", { fill: "#fff", font: "AriesMorinus", size: 32 });
 *   draw.line([[x1, y1], [x2, y2]], { fill: "#fff", width: 1 });
 *   draw.rectangle([[x0, y0], [x1, y1]], { fill, outline, width });
 *   draw.textsize("A", { font: "AriesMorinus", size: 32 }) -> [w, h]
 */

import { DEFAULT_MORINUS_TEXT_FONT } from "./chart-fonts";
import type { WheelFrame } from "./wheel-projection";

type Pt = [number, number];

export interface TextOpts {
  fill?: string;
  font?: string;
  size?: number; // px
  weight?: string | number;
  style?: string;
  tracking?: number; // px
  opacity?: number;
  align?: CanvasTextAlign;
  baseline?: CanvasTextBaseline;
}

export interface LineOpts {
  /** Preserve shared vector joins instead of snapping endpoints independently. */
  pixelSnap?: boolean;
  fill?: string;
  width?: number;
  dash?: number[];
  opacity?: number;
  lineCap?: CanvasLineCap;
  lineJoin?: CanvasLineJoin;
}

export interface CircleOpts extends LineOpts {
  outline?: string;
}

export interface RectOpts {
  fill?: string;
  outline?: string;
  width?: number;
}

const TEXT_SIZE_CACHE_LIMIT = 4096;
type CachedTextMetrics = {
  size: Pt;
  /** Baseline offset from the measured ink top; null when the browser omits ink bounds. */
  inkAscent: number | null;
};
const textMetricsCache = new Map<string, CachedTextMetrics>();
export type TextInkBounds = Readonly<{ x: number; y: number; w: number; h: number }>;
const textInkBoundsCache = new Map<string, TextInkBounds>();

export type CanvasDrawProfile = Record<string, { calls: number; ms: number }>;

export class CanvasDraw {
  readonly ctx: CanvasRenderingContext2D;
  readonly canvas: HTMLCanvasElement;
  private dpr = 1;
  private defaultFont = DEFAULT_MORINUS_TEXT_FONT;
  private profile: CanvasDrawProfile | null = null;

  beginProfile() {
    this.profile = {};
  }

  endProfile(): CanvasDrawProfile | null {
    const profile = this.profile;
    this.profile = null;
    return profile;
  }

  measure<T>(name: string, operation: () => T): T {
    return this.profiled(name, operation);
  }

  private profiled<T>(name: string, operation: () => T): T {
    if (!this.profile) return operation();
    const startedAt = performance.now();
    const result = operation();
    const sample = this.profile[name] ?? { calls: 0, ms: 0 };
    sample.calls += 1;
    sample.ms += performance.now() - startedAt;
    this.profile[name] = sample;
    return result;
  }

  private snap(value: number): number {
    return Math.round(value);
  }

  constructor(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("CanvasDraw: 2D context unavailable");
    this.canvas = canvas;
    this.ctx = ctx;
  }

  setDefaultFont(font?: string | null) {
    const next = font?.trim();
    this.defaultFont = next && next.length > 0 ? next : DEFAULT_MORINUS_TEXT_FONT;
  }

  resize(cssWidth: number, cssHeight: number, dprOverride?: number) {
    this.dpr = Math.max(1, dprOverride ?? (window.devicePixelRatio || 1));
    const backingWidth = Math.round(cssWidth * this.dpr);
    const backingHeight = Math.round(cssHeight * this.dpr);
    if (this.canvas.width !== backingWidth) {
      this.canvas.width = backingWidth;
    }
    if (this.canvas.height !== backingHeight) {
      this.canvas.height = backingHeight;
    }
    const styleWidth = `${cssWidth}px`;
    const styleHeight = `${cssHeight}px`;
    if (this.canvas.style.width !== styleWidth) {
      this.canvas.style.width = styleWidth;
    }
    if (this.canvas.style.height !== styleHeight) {
      this.canvas.style.height = styleHeight;
    }
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  clear() {
    const { width, height } = this.canvas;
    this.ctx.save();
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, width, height);
    this.ctx.restore();
  }

  fillBackground(color: string) {
    const { ctx } = this;
    ctx.save();
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, this.canvas.width / this.dpr, this.canvas.height / this.dpr);
    ctx.restore();
  }

  private fontSpec(opts?: TextOpts): string {
    const size = Math.max(1, Math.round(opts?.size ?? 14));
    const family = opts?.font ?? this.defaultFont;
    const weight = opts?.weight ?? 400;
    const requestedStyle = opts?.style?.trim().toLowerCase();
    const style = requestedStyle === "italic" || requestedStyle?.startsWith("oblique")
      ? requestedStyle
      : "normal";
    return `${style} ${weight} ${size}px ${family}`;
  }

  private applyFont(opts?: TextOpts) {
    this.ctx.font = this.fontSpec(opts);
  }

  text(xy: Pt, text: string, opts?: TextOpts) {
    const { ctx } = this;
    ctx.save();
    this.applyFont(opts);
    ctx.fillStyle = opts?.fill ?? "#fff";
    ctx.textAlign = opts?.align ?? "left";
    ctx.textBaseline = opts?.baseline ?? "top";
    if (opts?.opacity != null) {
      ctx.globalAlpha = Math.min(1, Math.max(0, opts.opacity));
    }
    const tracking = Number.isFinite(opts?.tracking)
      ? Number(opts?.tracking)
      : 0;
    if (tracking === 0) {
      ctx.fillText(text, this.snap(xy[0]), this.snap(xy[1]));
    } else {
      const glyphs = Array.from(text);
      if (glyphs.length < 2) {
        ctx.fillText(text, this.snap(xy[0]), this.snap(xy[1]));
      } else {
        const widths = glyphs.map((glyph) => ctx.measureText(glyph).width);
        const totalWidth = widths.reduce((sum, width) => sum + width, 0)
          + tracking * (glyphs.length - 1);
        let cursor = xy[0];
        if (ctx.textAlign === "center") cursor -= totalWidth / 2;
        else if (ctx.textAlign === "right" || ctx.textAlign === "end") {
          cursor -= totalWidth;
        }
        ctx.textAlign = "left";
        for (let index = 0; index < glyphs.length; index += 1) {
          ctx.fillText(glyphs[index], this.snap(cursor), this.snap(xy[1]));
          cursor += widths[index] + tracking;
        }
      }
    }
    ctx.restore();
  }

  private textMetrics(text: string, opts?: TextOpts): CachedTextMetrics {
    const font = this.fontSpec(opts);
    const tracking = Number.isFinite(opts?.tracking)
      ? Number(opts?.tracking)
      : 0;
    const cacheKey = `${font}\n${tracking}\n${text}`;
    const cached = textMetricsCache.get(cacheKey);
    if (cached) {
      return cached;
    }
    const { ctx } = this;
    ctx.save();
    ctx.font = font;
    const metrics = ctx.measureText(text);
    const glyphs = Array.from(text);
    const w = tracking === 0 || glyphs.length < 2
      ? metrics.width
      : Math.max(
          0,
          glyphs.reduce(
            (width, glyph) => width + ctx.measureText(glyph).width,
            0,
          ) + (glyphs.length - 1) * tracking,
        );
    const ascent = Number(metrics.actualBoundingBoxAscent);
    const descent = Number(metrics.actualBoundingBoxDescent);
    const hasInkBounds = Number.isFinite(ascent)
      && Number.isFinite(descent)
      && ascent + descent > 0;
    const h = hasInkBounds ? ascent + descent : opts?.size || 14;
    ctx.restore();
    const result: CachedTextMetrics = {
      size: [Math.round(w), Math.round(h)],
      inkAscent: hasInkBounds ? ascent : null,
    };
    if (textMetricsCache.size >= TEXT_SIZE_CACHE_LIMIT) {
      textMetricsCache.clear();
    }
    textMetricsCache.set(cacheKey, result);
    return result;
  }

  textsize(text: string, opts?: TextOpts): Pt {
    return this.textMetrics(text, opts).size;
  }

  /** Actual painted ink relative to text()'s origin, including em-box offsets. */
  textbounds(text: string, opts?: TextOpts): TextInkBounds {
    const font = this.fontSpec(opts);
    const baseline = opts?.baseline ?? "top";
    const tracking = opts?.tracking ?? 0;
    const key = JSON.stringify([font, baseline, tracking, text]);
    const cached = textInkBoundsCache.get(key);
    if (cached) return cached;
    const { ctx } = this;
    ctx.save();
    ctx.font = font;
    ctx.textAlign = "left";
    ctx.textBaseline = baseline;
    const metrics = ctx.measureText(text);
    const bounds = {
      x: -metrics.actualBoundingBoxLeft,
      y: -metrics.actualBoundingBoxAscent,
      w: metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight
        + Math.max(0, Array.from(text).length - 1) * tracking,
      h: metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent,
    };
    ctx.restore();
    if (textInkBoundsCache.size >= TEXT_SIZE_CACHE_LIMIT) textInkBoundsCache.clear();
    textInkBoundsCache.set(key, bounds);
    return bounds;
  }

  /**
   * Paint text into a box whose y coordinate is the measured ink top.
   *
   * `textsize()` reports actual ink height, while Canvas's `top` baseline is
   * based on the font em box. Using the latter to paint a box laid out with the
   * former shifts every supposedly centred label downward. On a wheel that
   * becomes an inward shift above the centre and an outward shift below it.
   */
  textAtInkTop(xy: Pt, text: string, opts?: TextOpts) {
    const { inkAscent } = this.textMetrics(text, opts);
    if (inkAscent == null) {
      this.text(xy, text, opts);
      return;
    }
    this.text([xy[0], xy[1] + inkAscent], text, {
      ...opts,
      baseline: "alphabetic",
    });
  }

  line(xy: [Pt, Pt, ...Pt[]], opts?: LineOpts) {
    const { ctx } = this;
    ctx.save();
    ctx.strokeStyle = opts?.fill ?? "#fff";
    ctx.lineWidth = Math.max(0.25, opts?.width ?? 1);
    ctx.lineCap = opts?.lineCap ?? "butt";
    ctx.lineJoin = opts?.lineJoin ?? "miter";
    if (opts?.opacity != null) ctx.globalAlpha = opts.opacity;
    if (opts?.dash) ctx.setLineDash(opts.dash);
    ctx.beginPath();
    const snap = opts?.pixelSnap !== false;
    ctx.moveTo(snap ? this.snap(xy[0][0]) : xy[0][0], snap ? this.snap(xy[0][1]) : xy[0][1]);
    for (let index = 1; index < xy.length; index += 1) {
      ctx.lineTo(snap ? this.snap(xy[index][0]) : xy[index][0], snap ? this.snap(xy[index][1]) : xy[index][1]);
    }
    ctx.stroke();
    ctx.restore();
  }

  rectangle(xy: [Pt, Pt], opts?: RectOpts) {
    const { ctx } = this;
    const [[x0, y0], [x1, y1]] = xy;
    const w = x1 - x0;
    const h = y1 - y0;
    ctx.save();
    if (opts?.fill) {
      ctx.fillStyle = opts.fill;
      ctx.fillRect(x0, y0, w, h);
    }
    if (opts?.outline) {
      ctx.strokeStyle = opts.outline;
      ctx.lineWidth = opts.width ?? 1;
      ctx.strokeRect(x0, y0, w, h);
    }
    ctx.restore();
  }

  // Convenience helpers (Canvas-specific; adapter extension, not PIL)
  circle(
    center: Pt,
    radius: number,
    opts?: CircleOpts,
  ) {
    const { ctx } = this;
    ctx.save();
    if (opts?.opacity != null) ctx.globalAlpha = opts.opacity;
    ctx.beginPath();
    ctx.arc(this.snap(center[0]), this.snap(center[1]), this.snap(radius), 0, Math.PI * 2);
    if (opts?.fill) {
      ctx.fillStyle = opts.fill;
      ctx.fill();
    }
    if (opts?.outline) {
      ctx.strokeStyle = opts.outline;
      ctx.lineWidth = Math.max(0.25, opts?.width ?? 1);
      ctx.lineCap = opts.lineCap ?? "butt";
      ctx.lineJoin = opts.lineJoin ?? "miter";
      if (opts.dash) ctx.setLineDash(opts.dash);
      ctx.stroke();
    }
    ctx.restore();
  }
}

/** Polar helper matching graphchart.py wheel orientation:
 *   ASC at canvas LEFT, zodiac runs clockwise (H1 below ASC, MC toward TOP).
 * The returned screen coordinates are algebraically equivalent to wx's
 * `x = cx + cos(pi + asc - lon) * r; y = cy + sin(pi + asc - lon) * r`.
 *
 * The rotation argument may be a bare longitude (the zodiac-fixed wheel every
 * caller used before projections existed) or a `WheelFrame`, which additionally
 * carries the angular model — see `wheel-projection.ts`.
 */
export function polar(
  center: Pt,
  radius: number,
  longitude: number,
  ascRotation: number | WheelFrame,
): Pt {
  const rotation = typeof ascRotation === "number" ? ascRotation : ascRotation.rotation;
  const drawn = typeof ascRotation === "number"
    ? longitude
    : ascRotation.projection.project(longitude);
  const astro = (180 + (drawn - rotation)) * (Math.PI / 180);
  return [
    center[0] + Math.cos(astro) * radius,
    center[1] - Math.sin(astro) * radius,
  ];
}
