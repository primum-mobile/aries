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

type Pt = [number, number];

export interface TextOpts {
  fill?: string;
  font?: string;
  size?: number; // px
  weight?: string | number;
  align?: CanvasTextAlign;
  baseline?: CanvasTextBaseline;
}

export interface LineOpts {
  fill?: string;
  width?: number;
  dash?: number[];
  opacity?: number;
  lineCap?: CanvasLineCap;
  lineJoin?: CanvasLineJoin;
}

export interface RectOpts {
  fill?: string;
  outline?: string;
  width?: number;
}

const TEXT_SIZE_CACHE_LIMIT = 4096;
const textSizeCache = new Map<string, Pt>();

export class CanvasDraw {
  readonly ctx: CanvasRenderingContext2D;
  readonly canvas: HTMLCanvasElement;
  private dpr = 1;
  private defaultFont = DEFAULT_MORINUS_TEXT_FONT;

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

  resize(cssWidth: number, cssHeight: number) {
    this.dpr = Math.max(1, window.devicePixelRatio || 1);
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
    return `${weight} ${size}px ${family}`;
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
    ctx.fillText(text, this.snap(xy[0]), this.snap(xy[1]));
    ctx.restore();
  }

  textsize(text: string, opts?: TextOpts): Pt {
    const font = this.fontSpec(opts);
    const cacheKey = `${font}\n${text}`;
    const cached = textSizeCache.get(cacheKey);
    if (cached) {
      return cached;
    }
    const { ctx } = this;
    ctx.save();
    ctx.font = font;
    const metrics = ctx.measureText(text);
    const w = metrics.width;
    const h =
      (metrics.actualBoundingBoxAscent || 0) +
      (metrics.actualBoundingBoxDescent || 0) ||
      opts?.size ||
      14;
    ctx.restore();
    const size: Pt = [Math.round(w), Math.round(h)];
    if (textSizeCache.size >= TEXT_SIZE_CACHE_LIMIT) {
      textSizeCache.clear();
    }
    textSizeCache.set(cacheKey, size);
    return size;
  }

  line(xy: [Pt, Pt], opts?: LineOpts) {
    const { ctx } = this;
    ctx.save();
    ctx.strokeStyle = opts?.fill ?? "#fff";
    ctx.lineWidth = Math.max(1, Math.round(opts?.width ?? 1));
    ctx.lineCap = opts?.lineCap ?? "butt";
    ctx.lineJoin = opts?.lineJoin ?? "miter";
    if (opts?.opacity != null) ctx.globalAlpha = opts.opacity;
    if (opts?.dash) ctx.setLineDash(opts.dash);
    ctx.beginPath();
    ctx.moveTo(this.snap(xy[0][0]), this.snap(xy[0][1]));
    ctx.lineTo(this.snap(xy[1][0]), this.snap(xy[1][1]));
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
    opts?: { fill?: string; outline?: string; width?: number; opacity?: number },
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
      ctx.lineWidth = Math.max(1, Math.round(opts?.width ?? 1));
      ctx.stroke();
    }
    ctx.restore();
  }
}

/** Polar helper matching graphchart.py wheel orientation:
 *   ASC at canvas LEFT, zodiac runs clockwise (H1 below ASC, MC toward TOP).
 * The returned screen coordinates are algebraically equivalent to wx's
 * `x = cx + cos(pi + asc - lon) * r; y = cy + sin(pi + asc - lon) * r`.
 */
export function polar(
  center: Pt,
  radius: number,
  longitude: number,
  ascRotation: number,
): Pt {
  const astro = (180 + (longitude - ascRotation)) * (Math.PI / 180);
  return [
    center[0] + Math.cos(astro) * radius,
    center[1] - Math.sin(astro) * radius,
  ];
}
