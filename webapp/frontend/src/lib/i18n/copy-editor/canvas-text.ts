// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

// Dev-only: make text painted on <canvas> selectable in copy mode. While
// recording, every fillText/strokeText remembers its string, font, alignment and
// full transform per canvas, so a click can be mapped back through the
// transform (rotated wheel labels included) to the string drawn there.
// Recording is off unless copy mode is on, so ordinary dev and perf runs pay
// only one boolean check per call; turning it on asks charts to repaint once.

import { COPY_EDITOR_REPAINT_EVENT } from "./copy-store";

type Box = { left: number; right: number; top: number; bottom: number };

type CanvasText = {
  text: string;
  x: number;
  y: number;
  maxWidth: number | undefined;
  matrix: DOMMatrix;
  font: string;
  align: CanvasTextAlign;
  baseline: CanvasTextBaseline;
  letterSpacing: string;
  // Lazily computed on first lookup.
  box?: Box;
  inverse?: DOMMatrix;
};

type CanvasRecord = { width: number; height: number; items: CanvasText[] };

const MAX_ITEMS_PER_CANVAS = 8000;
const HIT_PAD = 3; // canvas px of slack around a glyph run

// One shared state per page: a hot reload re-runs this module, but the context
// must be patched once and the patched methods must keep reading the same flag.
type RecorderState = { records: Map<HTMLCanvasElement, CanvasRecord>; recording: boolean; installed: boolean };
const state: RecorderState = ((globalThis as { __ariesCopyCanvasText?: RecorderState }).__ariesCopyCanvasText ??= {
  records: new Map(),
  recording: false,
  installed: false,
});
const records = state.records;
let measureCtx: CanvasRenderingContext2D | null = null;

function recordFor(canvas: HTMLCanvasElement): CanvasRecord {
  let record = records.get(canvas);
  // A width/height assignment wipes the bitmap without a clearRect.
  if (record && (record.width !== canvas.width || record.height !== canvas.height)) record = undefined;
  if (!record) {
    record = { width: canvas.width, height: canvas.height, items: [] };
    records.set(canvas, record);
  }
  return record;
}

function remember(ctx: CanvasRenderingContext2D, text: unknown, x: number, y: number, maxWidth?: number) {
  const canvas = ctx.canvas;
  if (!(canvas instanceof HTMLCanvasElement) || typeof text !== "string" || !text.trim()) return;
  const record = recordFor(canvas);
  if (record.items.length >= MAX_ITEMS_PER_CANVAS) record.items.splice(0, record.items.length / 2);
  record.items.push({
    text,
    x,
    y,
    maxWidth,
    matrix: ctx.getTransform(),
    font: ctx.font,
    align: ctx.textAlign,
    baseline: ctx.textBaseline,
    letterSpacing: (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing ?? "0px",
  });
}

/** A clearRect covering the whole bitmap starts a new frame for that canvas. */
function forgetIfCleared(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  const canvas = ctx.canvas;
  if (!(canvas instanceof HTMLCanvasElement) || !records.has(canvas)) return;
  const m = ctx.getTransform();
  const corners = [new DOMPoint(x, y), new DOMPoint(x + w, y + h)].map((p) => m.transformPoint(p));
  const [a, b] = corners;
  const covers =
    Math.min(a.x, b.x) <= 0.5 && Math.min(a.y, b.y) <= 0.5 &&
    Math.max(a.x, b.x) >= canvas.width - 0.5 && Math.max(a.y, b.y) >= canvas.height - 0.5;
  if (covers) records.delete(canvas);
}

/** Patch the 2D context once; a no-op until recording is switched on. */
export function installCanvasTextRecorder(): void {
  if (state.installed || typeof CanvasRenderingContext2D === "undefined") return;
  state.installed = true;
  const proto = CanvasRenderingContext2D.prototype;
  const { fillText, strokeText, clearRect } = proto;
  proto.fillText = function (this: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth?: number) {
    if (state.recording) remember(this, text, x, y, maxWidth);
    return maxWidth === undefined ? fillText.call(this, text, x, y) : fillText.call(this, text, x, y, maxWidth);
  };
  proto.strokeText = function (this: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth?: number) {
    if (state.recording) remember(this, text, x, y, maxWidth);
    return maxWidth === undefined ? strokeText.call(this, text, x, y) : strokeText.call(this, text, x, y, maxWidth);
  };
  proto.clearRect = function (this: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
    if (state.recording) forgetIfCleared(this, x, y, w, h);
    return clearRect.call(this, x, y, w, h);
  };
}

export function setCanvasTextRecording(on: boolean): void {
  if (on === state.recording) return;
  state.recording = on;
  records.clear();
  // Charts repaint every layer so text already on screen gets recorded.
  if (on) window.dispatchEvent(new Event(COPY_EDITOR_REPAINT_EVENT));
}

function boxOf(item: CanvasText): Box {
  if (item.box) return item.box;
  measureCtx ??= document.createElement("canvas").getContext("2d");
  const ctx = measureCtx!;
  ctx.font = item.font;
  ctx.textAlign = item.align;
  ctx.textBaseline = item.baseline;
  (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = item.letterSpacing;
  const m = ctx.measureText(item.text);
  const squeeze = item.maxWidth !== undefined && m.width > item.maxWidth ? item.maxWidth / m.width : 1;
  // actualBoundingBox* are relative to (x, y) under the item's own align/baseline.
  item.box = {
    left: item.x - m.actualBoundingBoxLeft * squeeze - HIT_PAD,
    right: item.x + m.actualBoundingBoxRight * squeeze + HIT_PAD,
    top: item.y - m.actualBoundingBoxAscent - HIT_PAD,
    bottom: item.y + m.actualBoundingBoxDescent + HIT_PAD,
  };
  return item.box;
}

function contains(item: CanvasText, px: number, py: number): boolean {
  item.inverse ??= item.matrix.inverse();
  const local = item.inverse.transformPoint(new DOMPoint(px, py));
  const box = boxOf(item);
  return local.x >= box.left && local.x <= box.right && local.y >= box.top && local.y <= box.bottom;
}

/**
 * Same run: drawn consecutively in one font, either on one baseline under one
 * transform (tracked or word-by-word text) or glyph by glyph (curved labels,
 * each character under its own rotation).
 */
function sameRun(a: CanvasText, b: CanvasText): boolean {
  if (a.font !== b.font) return false;
  if ([...a.text].length <= 2 && [...b.text].length <= 2) return true;
  const ma = a.matrix, mb = b.matrix;
  return a.y === b.y && ma.a === mb.a && ma.b === mb.b && ma.c === mb.c &&
    ma.d === mb.d && ma.e === mb.e && ma.f === mb.f;
}

function clientRect(canvas: HTMLCanvasElement, rect: DOMRect, items: CanvasText[]): DOMRect {
  const sx = rect.width / canvas.width, sy = rect.height / canvas.height;
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (const item of items) {
    const box = boxOf(item);
    for (const [x, y] of [[box.left, box.top], [box.right, box.top], [box.left, box.bottom], [box.right, box.bottom]]) {
      const p = item.matrix.transformPoint(new DOMPoint(x, y));
      left = Math.min(left, p.x); right = Math.max(right, p.x);
      top = Math.min(top, p.y); bottom = Math.max(bottom, p.y);
    }
  }
  return new DOMRect(rect.left + left * sx, rect.top + top * sy, (right - left) * sx, (bottom - top) * sy);
}

export type CanvasTextHit = { text: string; rect: DOMRect };

const MAX_RUN = 80;

/**
 * Candidate strings under a client point, topmost canvas first: the string
 * drawn there, then the run it belongs to (joined with and without spaces) for
 * text painted one glyph or word at a time.
 */
export function canvasTextsAt(clientX: number, clientY: number): CanvasTextHit[] {
  const hits: CanvasTextHit[] = [];
  const canvases = [...records.keys()].filter((canvas) => canvas.isConnected).reverse();
  for (const canvas of canvases) {
    const record = records.get(canvas)!;
    if (record.width !== canvas.width || record.height !== canvas.height) continue;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) continue;
    if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) continue;
    const px = ((clientX - rect.left) * canvas.width) / rect.width;
    const py = ((clientY - rect.top) * canvas.height) / rect.height;
    const { items } = record;
    // Latest paint wins where labels overlap.
    for (let i = items.length - 1; i >= 0; i -= 1) {
      const item = items[i];
      if (!contains(item, px, py)) continue;
      hits.push({ text: item.text, rect: clientRect(canvas, rect, [item]) });
      let start = i, end = i;
      while (start > 0 && i - start < MAX_RUN && sameRun(items[start - 1], item)) start -= 1;
      while (end < items.length - 1 && end - i < MAX_RUN && sameRun(items[end + 1], item)) end += 1;
      if (end > start) {
        const run = items.slice(start, end + 1);
        const runRect = clientRect(canvas, rect, run);
        for (const text of new Set([run.map((r) => r.text).join(""), run.map((r) => r.text).join(" ")])) {
          hits.push({ text, rect: runRect });
        }
      }
      break;
    }
  }
  return hits;
}
