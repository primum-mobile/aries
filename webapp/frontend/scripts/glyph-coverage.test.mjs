// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { APPLE_ONLY_GLYPHS, buildCoverageReport, fontCoverage } from "./glyph-coverage.mjs";

const FONTS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../public/fonts");

let cachedReport = null;
const coverageReport = () => (cachedReport ??= buildCoverageReport());

test("TrueType and WOFF2 cmaps parse to real coverage", () => {
  const freeSans = fontCoverage(path.join(FONTS, "FreeSans.ttf"));
  assert.ok(freeSans.has("A".codePointAt(0)));
  assert.ok(freeSans.has("é".codePointAt(0)));
  assert.ok(freeSans.has("←".codePointAt(0)));
  assert.ok(!freeSans.has("⌘".codePointAt(0)));
  assert.ok(!freeSans.has("✓".codePointAt(0)));

  const arabic = fontCoverage(path.join(FONTS, "NotoNaskhArabic-Regular.woff2"));
  assert.ok(arabic.has(0x0627), "WOFF2 cmap: Arabic alef");
  const code = fontCoverage(path.join(FONTS, "MPLUS1Code.woff2"));
  assert.ok(code.has("A".codePointAt(0)), "WOFF2 cmap: M PLUS 1 Code Latin");
  const kosugi = fontCoverage(path.join(FONTS, "KosugiAries-Regular.ttf"));
  assert.ok(kosugi.has("日".codePointAt(0)), "Kosugi Aries carries kanji");
});

test("each locale meets its own UI stack; chart glyphs count as purpose-face text", () => {
  const report = coverageReport();
  assert.deepEqual(report.locales.ja.stack.slice(0, 2), ["Kosugi Aries", "FreeSans"]);
  assert.deepEqual(report.locales["zh-Hans"].stack.slice(0, 2), ["Noto Sans SC", "FreeSans"]);
  assert.deepEqual(report.locales.en.stack.slice(0, 1), ["FreeSans"]);
  // Japanese text is in the ja stack, so kanji never fall back there.
  assert.ok(!report.locales.ja.fallback.some((row) => row.char === "日"));
  // ⚸ (Black Moon Lilith) is set in AriesMorinus, not in UI text.
  const special = report.source.special.find((row) => row.char === "⚸");
  assert.ok(special?.faces?.includes("AriesMorinus"));
  assert.ok(!report.source.fallback.some((row) => row.char === "⚸"));
});

// Windows and Linux spell modifiers out (lib/shortcut-display.ts formats the
// canonical glyph keys), so a translated string must never hardcode them.
test("no locale string hardcodes an Apple modifier glyph", () => {
  const report = coverageReport();
  const hardcoded = Object.entries(report.locales).flatMap(([locale, section]) =>
    section.fallback
      .filter((row) => APPLE_ONLY_GLYPHS.has(row.char))
      .map((row) => `${locale} ${row.char}: ${row.locations.join(", ")}`),
  );
  assert.deepEqual(hardcoded, []);
});
