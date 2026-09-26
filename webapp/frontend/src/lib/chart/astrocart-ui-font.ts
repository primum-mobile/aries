// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

// The Astrocart map iframe lives on the daemon origin. It renders its chrome in
// the app's live UI font, so the host resolves that font and hands over the
// bytes of every face the stack names (bundled @font-face rules and uploaded
// Style Lab fonts); generic/system families resolve inside the iframe itself.

import { styleLabFontBlob } from "@/lib/style-lab/fonts";

export type AstrocartUiFontFace = {
  family: string;
  weight: string;
  style: string;
  unicodeRange: string;
  data: ArrayBuffer;
};

/** The app's resolved UI font stack (`--aries-font-ui`), or null off-DOM. */
export function appUiFontStack(): string | null {
  if (typeof document === "undefined") return null;
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue("--aries-font-ui")
    .trim();
  return value || null;
}

function unquote(value: string): string {
  return value.trim().replace(/^(['"])(.*)\1$/, "$2").trim();
}

/** Family names of a CSS font stack, in order, without quotes. */
export function fontStackFamilies(stack: string): string[] {
  const families: string[] = [];
  let current = "";
  let quote: string | null = null;
  for (const char of stack) {
    if (quote) {
      if (char === quote) quote = null;
      current += char;
    } else if (char === "'" || char === '"') {
      quote = char;
      current += char;
    } else if (char === ",") {
      if (current.trim()) families.push(unquote(current));
      current = "";
    } else {
      current += char;
    }
  }
  if (current.trim()) families.push(unquote(current));
  return families;
}

const fontBytesByUrl = new Map<string, Promise<ArrayBuffer>>();

function fontBytes(url: string): Promise<ArrayBuffer> {
  let pending = fontBytesByUrl.get(url);
  if (!pending) {
    pending = fetch(url).then((response) => {
      if (!response.ok) throw new Error(`font fetch failed (${response.status})`);
      return response.arrayBuffer();
    });
    pending.catch(() => fontBytesByUrl.delete(url));
    fontBytesByUrl.set(url, pending);
  }
  return pending;
}

function firstFontUrl(src: string, base: string): string | null {
  const match = /url\(\s*(['"]?)([^'")]+)\1\s*\)/.exec(src);
  if (!match) return null;
  try {
    return new URL(match[2], base).href;
  } catch {
    return null;
  }
}

/** Every loadable face the stack names, with its bytes. */
export async function collectUiFontFaces(stack: string): Promise<AstrocartUiFontFace[]> {
  const families = fontStackFamilies(stack);
  const wanted = new Set(families.map((family) => family.toLowerCase()));
  const pending: Array<Promise<AstrocartUiFontFace | null>> = [];
  const coveredFamilies = new Set<string>();
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue;
    }
    for (const rule of Array.from(rules)) {
      if (!(rule instanceof CSSFontFaceRule)) continue;
      const family = unquote(rule.style.getPropertyValue("font-family"));
      if (!wanted.has(family.toLowerCase())) continue;
      const url = firstFontUrl(
        rule.style.getPropertyValue("src"),
        sheet.href ?? document.baseURI,
      );
      if (!url) continue;
      coveredFamilies.add(family.toLowerCase());
      const descriptors = {
        family,
        weight: rule.style.getPropertyValue("font-weight").trim() || "normal",
        style: rule.style.getPropertyValue("font-style").trim() || "normal",
        unicodeRange: rule.style.getPropertyValue("unicode-range").trim() || "U+0-10FFFF",
      };
      pending.push(fontBytes(url).then(
        (data) => ({ ...descriptors, data }),
        () => null,
      ));
    }
  }
  for (const family of families) {
    if (coveredFamilies.has(family.toLowerCase())) continue;
    const blob = styleLabFontBlob(family);
    if (!blob) continue;
    pending.push(blob.arrayBuffer().then(
      (data) => ({ family, weight: "normal", style: "normal", unicodeRange: "U+0-10FFFF", data }),
      () => null,
    ));
  }
  return (await Promise.all(pending)).filter(
    (face): face is AstrocartUiFontFace => face != null,
  );
}
