// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

// Map a point on screen to the catalog keys whose rendered text is there.
// React renders each translated JSX expression as its own text node, so the node under
// the pointer is usually an exact hit; attributes cover tooltips/aria/placeholders.

import { canvasTextsAt } from "./canvas-text";
import { renderedEntries, renderedKeys } from "./copy-store";

const TEXT_ATTRS = ["title", "aria-label", "placeholder", "alt", "aria-description"];
const MAX_TEXT = 400;
const ANCESTORS = 4;

/** keys is empty for text painted without the catalog (daemon/engine text, numbers). */
export type CopyHit = { keys: string[]; rect: DOMRect; text?: string };

function textNodeAt(x: number, y: number): Text | null {
  const doc = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node } | null;
  };
  const node = doc.caretPositionFromPoint?.(x, y)?.offsetNode
    ?? document.caretRangeFromPoint?.(x, y)?.startContainer;
  return node instanceof Text ? node : null;
}

function textRect(node: Text): DOMRect {
  const range = document.createRange();
  range.selectNodeContents(node);
  return range.getBoundingClientRect();
}

function elementTexts(element: Element): string[] {
  const texts = TEXT_ATTRS.map((name) => element.getAttribute(name) ?? "");
  const content = element.textContent ?? "";
  if (content.length <= MAX_TEXT) texts.push(content);
  return texts.filter((text) => text.trim());
}

function unique(keys: string[]): string[] {
  return [...new Set(keys)];
}

/** Canvas text under the point: the first candidate with keys, else the drawn text. */
function canvasHitAt(x: number, y: number): CopyHit | null {
  const candidates = canvasTextsAt(x, y);
  for (const { text, rect } of candidates) {
    const keys = renderedKeys(text);
    if (keys.length) return { keys, rect, text };
  }
  const [first] = candidates;
  return first ? { keys: [], rect: first.rect, text: first.text } : null;
}

/** Exact matches only — cheap enough for every pointer move. */
export function exactHitAt(x: number, y: number, target: Element): CopyHit | null {
  const node = textNodeAt(x, y);
  if (node && target.contains(node)) {
    const keys = renderedKeys(node.nodeValue ?? "");
    if (keys.length) return { keys, rect: textRect(node) };
  }
  // Chart text sits on stacked canvases; check it before the host element's
  // own text (which may hold unrelated overlay captions).
  const painted = canvasHitAt(x, y);
  if (painted) return painted;
  let element: Element | null = target;
  for (let depth = 0; element && depth < ANCESTORS; depth += 1, element = element.parentElement) {
    const keys = unique(elementTexts(element).flatMap(renderedKeys));
    if (keys.length) return { keys, rect: element.getBoundingClientRect() };
  }
  return null;
}

function templatePattern(template: string): RegExp | null {
  if (!/\{\w+\}/.test(template)) return null;
  const source = template
    .split(/\{\w+\}/)
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s*"))
    .join("[\\s\\S]+?");
  return new RegExp(source);
}

/**
 * Exact matches first; then text assembled from several nodes (renderTemplate
 * slots, a value glued to a label): the longest rendered string or template the
 * element's text contains.
 */
export function hitAt(x: number, y: number, target: Element): CopyHit | null {
  const exact = exactHitAt(x, y, target);
  if (exact) return exact;
  let element: Element | null = target;
  for (let depth = 0; element && depth < ANCESTORS; depth += 1, element = element.parentElement) {
    const content = (element.textContent ?? "").replace(/\s+/g, " ").trim();
    if (!content || content.length > MAX_TEXT) continue;
    let best: { keys: string[]; score: number } | null = null;
    for (const [text, keys] of renderedEntries()) {
      if (text.length < 2 || (best && text.length <= best.score)) continue;
      const matches = content.includes(text) || (templatePattern(text)?.test(content) ?? false);
      if (matches) best = { keys: [...keys], score: text.length };
    }
    if (best) return { keys: best.keys, rect: element.getBoundingClientRect() };
  }
  return null;
}
