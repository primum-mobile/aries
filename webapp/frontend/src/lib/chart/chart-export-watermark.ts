// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import { DEFAULT_MORINUS_TEXT_FONT } from "./chart-fonts";
import type { PngWatermarkStyle } from "@/lib/daemon/client";

export async function preparePngWatermark(style: PngWatermarkStyle): Promise<void> {
  if (style === "kosugi") await document.fonts.load('32px "Kosugi"');
}

// Explicitly requested flame branding, independent of astrological body colors.
const FLAME_COLORS = { ember: "#8f2014", red: "#e13b16", orange: "#ff861f", core: "#fff0a3" };
const MONOCHROME_FLAME_COLORS = { ember: "#262626", red: "#595959", orange: "#929292", core: "#eeeeee" };

/** Export-only header; specialized canvases reserve this space above their content. */
export function pngWatermarkHeaderHeight(width: number, style: PngWatermarkStyle): number {
  return width * (style === "flame" ? 0.065 : 0.045);
}

export function drawPngWatermark(
  context: CanvasRenderingContext2D,
  width: number,
  label: string,
  options: {
    x?: number; y?: number; size?: number; font?: string; maxWidth?: number;
    monochrome: boolean; style: PngWatermarkStyle; color: string;
  },
): void {
  let size = options.size ?? width * 0.027;
  const colors = options.monochrome ? MONOCHROME_FLAME_COLORS : FLAME_COLORS;
  context.save();
  context.globalAlpha = 1;
  context.filter = "none";
  context.shadowBlur = 0;
  context.shadowOffsetX = 0;
  context.shadowOffsetY = 0;
  const font = options.style === "kosugi" ? '"Kosugi"' : options.font ?? DEFAULT_MORINUS_TEXT_FONT;
  const weight = options.style === "kosugi" ? "normal" : "bold";
  const setFont = () => {
    context.font = `${weight} ${size}px ${font}`;
    if ("letterSpacing" in context) {
      context.letterSpacing = `${options.style === "kosugi" ? size * 0.045 : 0}px`;
    }
  };
  setFont();
  const maxWidth = options.maxWidth ?? width - 2 * (options.x ?? width * 0.04);
  const measuredWidth = context.measureText(label).width;
  if (measuredWidth > maxWidth) {
    size *= maxWidth / measuredWidth;
    setFont();
  }
  if (options.style === "kosugi") {
    context.textAlign = "left";
    context.textBaseline = "alphabetic";
    context.fillStyle = options.color;
    // Shape the complete custom text so combining marks and joined scripts survive.
    const textWidth = context.measureText(label).width;
    const x = options.x ?? (width - textWidth) / 2;
    const y = (options.y ?? size * 0.25) + context.measureText(label).actualBoundingBoxAscent;
    context.fillText(label, x, y);
    context.restore();
    return;
  }
  context.textAlign = "left";
  context.textBaseline = "alphabetic";
  const textMetrics = context.measureText(label);
  const textWidth = textMetrics.width;
  const x = options.x ?? (width - textWidth) / 2;
  const y = options.y ?? size * 0.2;
  const textY = y + size * 1.4;
  const flameBase = textY - textMetrics.actualBoundingBoxAscent + size * 0.08;
  const fire = context.createLinearGradient(0, y, 0, flameBase);
  fire.addColorStop(0, colors.red);
  fire.addColorStop(0.55, colors.orange);
  fire.addColorStop(1, colors.core);
  context.fillStyle = fire;
  context.shadowColor = colors.orange;
  context.shadowBlur = size * 0.06;
  // Fixed, asymmetric flame tongues: deterministic PNG paint, no animation work.
  const heights = [0.5, 0.85, 0.6, 1, 0.65, 0.8, 0.55, 0.95, 0.7, 0.5, 0.8];
  const step = textWidth / heights.length;
  heights.forEach((height, index) => {
    const center = x + step * (index + 0.5);
    const base = flameBase;
    const tip = base - size * height * 0.58;
    context.beginPath();
    context.moveTo(center - step * 0.7, base);
    context.bezierCurveTo(center - step, base - size * 0.25,
      center + step * 0.35, tip + size * 0.2, center + step * 0.1, tip);
    context.bezierCurveTo(center + step, tip + size * 0.2,
      center + step * 0.25, base - size * 0.1, center + step * 0.7, base);
    context.closePath();
    context.fill();
  });
  // Keep glow out of the letter counters: solid dark ink with a crisp light rim
  // stays readable on both paper and dark chart backgrounds.
  context.shadowBlur = 0;
  context.shadowOffsetX = 0;
  context.shadowOffsetY = 0;
  context.fillStyle = colors.ember;
  context.strokeStyle = colors.core;
  context.lineWidth = size * 0.065;
  context.lineJoin = "round";
  context.strokeText(label, x, textY);
  context.fillText(label, x, textY);
  context.restore();
}
