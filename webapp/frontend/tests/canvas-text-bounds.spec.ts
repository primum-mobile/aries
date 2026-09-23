// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import { expect, test } from "@playwright/test";

import { CanvasDraw } from "../src/lib/chart/canvas-draw";

test("ink-top painting matches the bounds reported by textsize", () => {
  const painted: Array<{ x: number; y: number; baseline: CanvasTextBaseline }> = [];
  const context = {
    font: "",
    fillStyle: "",
    textAlign: "left" as CanvasTextAlign,
    textBaseline: "top" as CanvasTextBaseline,
    globalAlpha: 1,
    save() {},
    restore() {},
    measureText() {
      return {
        width: 20,
        actualBoundingBoxAscent: 7,
        actualBoundingBoxDescent: 3,
      } as TextMetrics;
    },
    fillText(_text: string, x: number, y: number) {
      painted.push({ x, y, baseline: this.textBaseline });
    },
  };
  const canvas = {
    getContext: () => context,
  } as unknown as HTMLCanvasElement;
  const draw = new CanvasDraw(canvas);

  expect(draw.textsize("20°", { size: 16 })).toEqual([20, 10]);
  draw.textAtInkTop([11, 31], "20°", { size: 16 });

  expect(painted).toEqual([{ x: 11, y: 38, baseline: "alphabetic" }]);
});

test("centred ink boxes have symmetric upper and lower wheel gutters", () => {
  const inkHeight = 10;
  const upperAnchor = 20;
  const lowerAnchor = 80;
  const upperBand = { outer: 10, inner: 30 };
  const lowerBand = { inner: 70, outer: 90 };

  const upperInk = { top: upperAnchor - inkHeight / 2, bottom: upperAnchor + inkHeight / 2 };
  const lowerInk = { top: lowerAnchor - inkHeight / 2, bottom: lowerAnchor + inkHeight / 2 };

  expect(upperInk.top - upperBand.outer).toBe(upperBand.inner - upperInk.bottom);
  expect(lowerInk.top - lowerBand.inner).toBe(lowerBand.outer - lowerInk.bottom);
});

test("glyph collision bounds include the ink offset from the painted em origin", () => {
  let painted: { x: number; y: number } | undefined;
  const context = {
    font: "", textAlign: "left", textBaseline: "top", fillStyle: "",
    save() {}, restore() {},
    measureText() {
      return { width: 20, actualBoundingBoxLeft: -1, actualBoundingBoxRight: 19,
        actualBoundingBoxAscent: this.textBaseline === "top" ? -2 : 18,
        actualBoundingBoxDescent: this.textBaseline === "top" ? 22 : 2 } as TextMetrics;
    },
    fillText(_text: string, x: number, y: number) { painted = { x, y }; },
  };
  const draw = new CanvasDraw({ getContext: () => context } as unknown as HTMLCanvasElement);
  const opts = { font: "TestGlyphInk", size: 20 };
  const ink = draw.textbounds("A", opts);
  draw.text([30, 40], "A", opts);
  expect({ x: painted!.x + ink.x, y: painted!.y + ink.y, w: ink.w, h: ink.h })
    .toEqual({ x: 31, y: 42, w: 18, h: 20 });
  expect(draw.textbounds("A", opts)).toEqual(ink);
});
