#!/usr/bin/env node
// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

// Glyph coverage of the bundled UI fonts.
//
// Every non-ASCII character in the shipped locale catalogs, the daemon mtexts
// overlay, and the frontend source's string literals and JSX text is checked
// against the cmap of the fonts the UI text stack actually loads:
//
//   FreeSans (every UI typeface profile falls back to it) + the UI language's
//   script face (Kosugi Aries for ja, Noto Sans SC/TC/KR for zh-Hans/zh-Hant/ko)
//   + the Kosugi Numerals digit face behind `Aries UI`.
//
// A character none of those carry is drawn by whatever the OS falls back to:
// Apple fonts on macOS, Segoe UI Symbol/Emoji or a CJK system face on Windows.
// Those are the characters that look different per platform. Characters only
// AriesMorinus (or another bundled special-purpose face) carries are listed
// separately: they are fine where the text is set in that face.
//
// Usage:
//   node scripts/glyph-coverage.mjs            report
//   node scripts/glyph-coverage.mjs --json     machine-readable report
//   node scripts/glyph-coverage.mjs --strict   exit 1 when any UI character
//                                              falls back to an OS font
//
// The parser reads TrueType/OpenType and WOFF2 (Node's built-in Brotli) cmap
// formats 4, 12 and 13; no font dependency is needed.

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const FRONTEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO = path.resolve(FRONTEND, "../..");
const FONTS = path.join(FRONTEND, "public/fonts");

// ---------------------------------------------------------------- font cmap

const WOFF2_KNOWN_TAGS = [
  "cmap", "head", "hhea", "hmtx", "maxp", "name", "OS/2", "post", "cvt ",
  "fpgm", "glyf", "loca", "prep", "CFF ", "VORG", "EBDT", "EBLC", "gasp",
  "hdmx", "kern", "LTSH", "PCLT", "VDMX", "vhea", "vmtx", "BASE", "GDEF",
  "GPOS", "GSUB", "EBSC", "JSTF", "MATH", "CBDT", "CBLC", "COLR", "CPAL",
  "SVG ", "sbix", "acnt", "avar", "bdat", "bloc", "bsln", "cvar", "fdsc",
  "feat", "fmtx", "fvar", "gvar", "hsty", "just", "lcar", "mort", "morx",
  "opbd", "prop", "trak", "Zapf", "Silf", "Glat", "Gloc", "Feat", "Sill",
];

function readUIntBase128(buffer, cursor) {
  let value = 0;
  for (let index = 0; index < 5; index += 1) {
    const byte = buffer[cursor.offset];
    cursor.offset += 1;
    value = value * 128 + (byte & 0x7f);
    if ((byte & 0x80) === 0) return value;
  }
  throw new Error("invalid UIntBase128");
}

/** The raw cmap table of a TTF/OTF or WOFF2 file. */
function cmapTable(file) {
  const buffer = fs.readFileSync(file);
  const signature = buffer.toString("latin1", 0, 4);
  if (signature === "wOF2") {
    const numTables = buffer.readUInt16BE(12);
    const compressedLength = buffer.readUInt32BE(20);
    const cursor = { offset: 48 };
    let streamOffset = 0;
    let cmap = null;
    for (let index = 0; index < numTables; index += 1) {
      const flags = buffer[cursor.offset];
      cursor.offset += 1;
      let tag = WOFF2_KNOWN_TAGS[flags & 0x3f];
      if ((flags & 0x3f) === 0x3f) {
        tag = buffer.toString("latin1", cursor.offset, cursor.offset + 4);
        cursor.offset += 4;
      }
      const version = (flags >> 6) & 0x03;
      const origLength = readUIntBase128(buffer, cursor);
      const transformed = tag === "glyf" || tag === "loca" ? version === 0 : version !== 0;
      const length = transformed ? readUIntBase128(buffer, cursor) : origLength;
      if (tag === "cmap") cmap = { offset: streamOffset, length };
      streamOffset += length;
    }
    if (!cmap) throw new Error(`${file}: no cmap`);
    const stream = zlib.brotliDecompressSync(
      buffer.subarray(cursor.offset, cursor.offset + compressedLength),
    );
    return stream.subarray(cmap.offset, cmap.offset + cmap.length);
  }
  const numTables = buffer.readUInt16BE(4);
  for (let index = 0; index < numTables; index += 1) {
    const record = 12 + index * 16;
    if (buffer.toString("latin1", record, record + 4) !== "cmap") continue;
    const offset = buffer.readUInt32BE(record + 8);
    const length = buffer.readUInt32BE(record + 12);
    return buffer.subarray(offset, offset + length);
  }
  throw new Error(`${file}: no cmap`);
}

function addFormat4(table, offset, covered) {
  const segCount = table.readUInt16BE(offset + 6) / 2;
  const endCodes = offset + 14;
  const startCodes = endCodes + segCount * 2 + 2;
  const idDeltas = startCodes + segCount * 2;
  const idRangeOffsets = idDeltas + segCount * 2;
  for (let segment = 0; segment < segCount; segment += 1) {
    const end = table.readUInt16BE(endCodes + segment * 2);
    const start = table.readUInt16BE(startCodes + segment * 2);
    const delta = table.readUInt16BE(idDeltas + segment * 2);
    const rangeAddress = idRangeOffsets + segment * 2;
    const rangeOffset = table.readUInt16BE(rangeAddress);
    for (let code = start; code <= end && code !== 0xffff; code += 1) {
      let glyph;
      if (rangeOffset === 0) {
        glyph = (code + delta) & 0xffff;
      } else {
        const glyphAddress = rangeAddress + rangeOffset + (code - start) * 2;
        glyph = glyphAddress + 2 <= table.length ? table.readUInt16BE(glyphAddress) : 0;
        if (glyph !== 0) glyph = (glyph + delta) & 0xffff;
      }
      if (glyph !== 0) covered.add(code);
    }
  }
}

function addFormat12(table, offset, covered, manyToOne) {
  const groups = table.readUInt32BE(offset + 12);
  for (let group = 0; group < groups; group += 1) {
    const record = offset + 16 + group * 12;
    const start = table.readUInt32BE(record);
    const end = table.readUInt32BE(record + 4);
    const startGlyph = table.readUInt32BE(record + 8);
    for (let code = start; code <= end; code += 1) {
      const glyph = manyToOne ? startGlyph : startGlyph + (code - start);
      if (glyph !== 0) covered.add(code);
    }
  }
}

/** Unicode code points a font maps to a real glyph. */
export function fontCoverage(file) {
  const table = cmapTable(file);
  const covered = new Set();
  const numTables = table.readUInt16BE(2);
  let symbolEncoding = false;
  for (let index = 0; index < numTables; index += 1) {
    const record = 4 + index * 8;
    const platform = table.readUInt16BE(record);
    const encoding = table.readUInt16BE(record + 2);
    const offset = table.readUInt32BE(record + 4);
    const unicode = platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10));
    const symbol = platform === 3 && encoding === 0;
    if (!unicode && !symbol) continue;
    symbolEncoding ||= symbol;
    const format = table.readUInt16BE(offset);
    if (format === 4) addFormat4(table, offset, covered);
    else if (format === 12) addFormat12(table, offset, covered, false);
    else if (format === 13) addFormat12(table, offset, covered, true);
  }
  if (symbolEncoding) {
    // Browsers map U+0020–U+00FF onto a symbol font's U+F020–U+F0FF.
    for (let code = 0x20; code <= 0xff; code += 1) {
      if (covered.has(0xf000 + code)) covered.add(code);
    }
  }
  return covered;
}

// ------------------------------------------------------------- font stacks

const UI_FACES = [
  { name: "FreeSans", file: "FreeSans.ttf" },
  // `Aries UI` digits; the face only claims its unicode-range.
  { name: "Kosugi Numerals", file: "KosugiNumerals-Regular.ttf", range: [[0x30, 0x39], [0xb0, 0xb0], [0x2032, 0x2033]] },
];

const LANGUAGE_FACES = {
  ja: { name: "Kosugi Aries", file: "KosugiAries-Regular.ttf" },
  "zh-Hans": { name: "Noto Sans SC", file: "NotoSansSC-Regular.ttf" },
  "zh-Hant": { name: "Noto Sans TC", file: "NotoSansTC-Regular.ttf" },
  ko: { name: "Noto Sans KR", file: "NotoSansKR-Regular.ttf" },
};

// Bundled faces with a narrower job: chart glyphs, Arabic lot names and the
// dignity face. Text set in them is fine; the UI stack never reaches them.
const PURPOSE_FACES = [
  { name: "AriesMorinus", file: "Morinus.ttf" },
  { name: "TraditionalMorinus", file: "TraditionalMorinus.ttf" },
  { name: "AriesArabicAcademic", file: "NotoNaskhArabic-Regular.woff2" },
  { name: "AriesDignityFace", file: "AriesDignityFace.woff2" },
];

// Optional Settings typefaces. They lead the stack only when chosen, so they
// never rescue the default stack; the report names them for information.
const OPTIONAL_UI_FACES = [
  { name: "DotGothic16", file: "DotGothic16-Regular.ttf" },
  { name: "M PLUS 1 Code", file: "MPLUS1Code.woff2" },
];

const coverageCache = new Map();
function faceCovers(face, code) {
  if (face.range && !face.range.some(([low, high]) => code >= low && code <= high)) return false;
  if (!coverageCache.has(face.file)) {
    coverageCache.set(face.file, fontCoverage(path.join(FONTS, face.file)));
  }
  return coverageCache.get(face.file).has(code);
}

// Modifier glyphs shown only on Apple platforms; Windows and Linux spell the
// modifiers out (lib/shortcut-display.ts), so their OS fallback is the Apple
// system font the glyphs were drawn for.
export const APPLE_ONLY_GLYPHS = new Set(["⌘", "⌥", "⇧", "⌃"]);

// ------------------------------------------------------------ text sources

function isUiCharacter(code) {
  if (code < 0x80) return false;
  // Format controls and variation selectors never need a glyph of their own.
  if (code >= 0x200b && code <= 0x200f) return false;
  if (code >= 0x2028 && code <= 0x202e) return false;
  if (code >= 0x2060 && code <= 0x206f) return false;
  if (code >= 0xfe00 && code <= 0xfe0f) return false;
  if (code === 0xfeff || code === 0xad) return false;
  return true;
}

function collectFromText(text, location, sink) {
  for (const character of text) {
    const code = character.codePointAt(0);
    if (!isUiCharacter(code)) continue;
    const entry = sink.get(code) ?? { code, locations: new Set() };
    entry.locations.add(location);
    sink.set(code, entry);
  }
}

function localeSources() {
  const directory = path.join(FRONTEND, "src/locales");
  return fs.readdirSync(directory)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => {
      const locale = name.replace(/\.json$/, "");
      const catalog = JSON.parse(fs.readFileSync(path.join(directory, name), "utf8"));
      const characters = new Map();
      for (const [key, value] of Object.entries(catalog)) {
        if (typeof value === "string") collectFromText(value, `${name}:${key}`, characters);
      }
      return { locale, characters };
    });
}

function overlaySources(locales) {
  const file = path.join(REPO, "scripts/i18n/mtexts_overlay.json");
  if (!fs.existsSync(file)) return new Map();
  const overlay = JSON.parse(fs.readFileSync(file, "utf8"));
  const byLocale = new Map(locales.map((locale) => [locale, new Map()]));
  for (const [key, row] of Object.entries(overlay)) {
    if (!row || typeof row !== "object") continue;
    for (const [locale, value] of Object.entries(row)) {
      if (typeof value !== "string" || !byLocale.has(locale)) continue;
      collectFromText(value, `mtexts_overlay.json:${key}[${locale}]`, byLocale.get(locale));
    }
  }
  return byLocale;
}

function sourceFiles(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...sourceFiles(full));
    else if (/\.(tsx?|mjs)$/.test(entry.name) && !/\.d\.ts$/.test(entry.name)) files.push(full);
  }
  return files;
}

/** String literals, template text and JSX text: never comments. Design-lab
 * mockups are not shipped and are skipped. */
function sourceCharacters() {
  const characters = new Map();
  const root = path.join(FRONTEND, "src");
  for (const file of sourceFiles(root)) {
    const relative = path.relative(FRONTEND, file);
    if (relative.startsWith(path.join("src", "design-lab"))) continue;
    const text = fs.readFileSync(file, "utf8");
    if (!/[^\x00-\x7f]/.test(text)) continue;
    const source = ts.createSourceFile(
      file,
      text,
      ts.ScriptTarget.Latest,
      false,
      file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const visit = (node) => {
      if (
        ts.isStringLiteral(node)
        || ts.isNoSubstitutionTemplateLiteral(node)
        || ts.isTemplateHead(node)
        || ts.isTemplateMiddle(node)
        || ts.isTemplateTail(node)
        || ts.isJsxText(node)
      ) {
        const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
        collectFromText(node.text, `${relative}:${line}`, characters);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return characters;
}

// ----------------------------------------------------------------- report

function hex(code) {
  return `U+${code.toString(16).toUpperCase().padStart(4, "0")}`;
}

function classify(characters, uiFaces) {
  const fallback = [];
  const special = [];
  for (const entry of [...characters.values()].sort((a, b) => a.code - b.code)) {
    if (uiFaces.some((face) => faceCovers(face, entry.code))) continue;
    const purpose = PURPOSE_FACES.filter((face) => faceCovers(face, entry.code)).map((face) => face.name);
    const optional = OPTIONAL_UI_FACES.filter((face) => faceCovers(face, entry.code)).map((face) => face.name);
    const row = {
      char: String.fromCodePoint(entry.code),
      code: hex(entry.code),
      locations: [...entry.locations],
      ...(purpose.length ? { faces: purpose } : {}),
      ...(optional.length ? { optionalFaces: optional } : {}),
    };
    (purpose.length ? special : fallback).push(row);
  }
  return { fallback, special };
}

/** Coverage of every UI text source against its stack. */
export function buildCoverageReport() {
  const locales = localeSources();
  const overlay = overlaySources(locales.map(({ locale }) => locale));
  const report = { locales: {}, source: null };

  for (const { locale, characters } of locales) {
    for (const [code, entry] of overlay.get(locale) ?? []) {
      const merged = characters.get(code) ?? { code, locations: new Set() };
      entry.locations.forEach((location) => merged.locations.add(location));
      characters.set(code, merged);
    }
    const languageFace = LANGUAGE_FACES[locale];
    const faces = languageFace ? [languageFace, ...UI_FACES] : UI_FACES;
    report.locales[locale] = {
      stack: faces.map((face) => face.name),
      ...classify(characters, faces),
    };
  }
  // Source literals are language-neutral: they meet the plain FreeSans stack.
  report.source = { stack: UI_FACES.map((face) => face.name), ...classify(sourceCharacters(), UI_FACES) };
  return report;
}

function main() {
  const args = new Set(process.argv.slice(2));
  const report = buildCoverageReport();
  const sections = { ...report.locales, source: report.source };
  const fallbackCount = Object.values(sections)
    .reduce((total, section) => total + section.fallback.length, 0);

  if (args.has("--json")) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    // One line per character: which sections reach it, and where.
    const group = (kind) => {
      const rows = new Map();
      for (const [name, section] of Object.entries(sections)) {
        for (const row of section[kind]) {
          const merged = rows.get(row.code) ?? { ...row, sections: [], locations: new Set() };
          merged.sections.push(name);
          row.locations.forEach((location) => merged.locations.add(location.replace(/^[\w-]+\.json:/, "")));
          rows.set(row.code, merged);
        }
      }
      return [...rows.values()].sort((a, b) => a.code.localeCompare(b.code));
    };
    const print = (row, note) => {
      const where = [...row.locations];
      const samples = where.slice(0, 3).join(", ") + (where.length > 3 ? `, +${where.length - 3}` : "");
      console.log(`  ${row.char}  ${row.code}  [${row.sections.join(" ")}]${note ? `  ${note}` : ""}`);
      console.log(`      ${samples}`);
    };
    console.log("UI stacks:");
    for (const [name, section] of Object.entries(sections)) {
      console.log(`  ${name.padEnd(8)} ${section.stack.join(" + ")}`);
    }
    const fallback = group("fallback");
    console.log(`\nFalls back to an OS font (${fallback.length}):`);
    for (const row of fallback) {
      const notes = [
        row.optionalFaces ? `also in ${row.optionalFaces.join(", ")}` : "",
        APPLE_ONLY_GLYPHS.has(row.char) ? "Apple-only shortcut glyph" : "",
      ].filter(Boolean);
      print(row, notes.length ? `(${notes.join("; ")})` : "");
    }
    const special = group("special");
    console.log(`\nOnly in a purpose face (${special.length}), fine where set in that face:`);
    for (const row of special) print(row, `(${row.faces.join(", ")})`);
    console.log(
      fallbackCount === 0
        ? "\nEvery UI character is in a bundled UI font."
        : `\n${fallback.length} characters fall back to OS fonts somewhere.`,
    );
  }
  if (args.has("--strict") && fallbackCount > 0) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
