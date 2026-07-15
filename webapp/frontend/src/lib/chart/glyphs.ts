/**
 * Morinus.ttf glyph codepoint mapping.
 * Extracted verbatim from common.py:368–393 — every string here is rendered
 * with font-family: 'AriesMorinus' (the private web alias for bundled Morinus.ttf).
 */

export const SE_SUN = 0;
export const SE_MOON = 1;
export const SE_MERCURY = 2;
export const SE_VENUS = 3;
export const SE_MARS = 4;
export const SE_JUPITER = 5;
export const SE_SATURN = 6;
export const SE_URANUS = 7;
export const SE_NEPTUNE = 8;
export const SE_PLUTO = 9;
export const SE_MEAN_NODE = 10;
export const SE_TRUE_NODE = 11;
export const SE_CHIRON = 15;

export const PLANETS_ORDER = [
  SE_SUN, SE_MOON, SE_MERCURY, SE_VENUS, SE_MARS, SE_JUPITER,
  SE_SATURN, SE_URANUS, SE_NEPTUNE, SE_PLUTO, SE_MEAN_NODE, SE_TRUE_NODE,
] as const;

// common.py:393 (self.Planets), vector order used by option bool arrays.
export const PLANET_GLYPH_SEQUENCE = [
  "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L",
] as const;

// common.py:393 (self.Planets)
export const PLANET_GLYPHS: Record<number, string> = {
  [SE_SUN]: "A",
  [SE_MOON]: "B",
  [SE_MERCURY]: "C",
  [SE_VENUS]: "D",
  [SE_MARS]: "E",
  [SE_JUPITER]: "F",
  [SE_SATURN]: "G",
  [SE_URANUS]: "H",
  [SE_NEPTUNE]: "I",
  [SE_PLUTO]: "J",
  [SE_MEAN_NODE]: "K",
  [SE_TRUE_NODE]: "L",
  [SE_CHIRON]: "}",
};

// Uranus/Pluto variant RULE logic moved daemon-side: the snapshot now ships a
// resolved glyph CHAR per body (ChartPlanet.glyph, from
// common.common.get_planet_glyph). PLANET_GLYPHS above is retained only as the
// raw Morinus codepoint reference table.
// common.py:377 (Vertex), :381 (fortune), :382 (retr).
export const VERTEX_GLYPH = "!";
export const FORTUNE_GLYPH = "4";
export const RETROGRADE_GLYPH = "Z";

// common.py:CHART_ANGLE_GLYPHS; Morinus angle glyph slots. Do not index these
// through planet arrays: IC is the "2" angle slot, not a body id fallback.
export type AngleGlyphId = "asc" | "dsc" | "mc" | "ic";
export const ANGLE_GLYPHS: Record<AngleGlyphId, string> = {
  asc: "0",
  dsc: "3",
  mc: "1",
  ic: "2",
};

// primdirs.py:52 — the Lot of Fortune point id in the PrimDir id namespace.
// wx renders it with common.common.fortune (primdirslistwnd.py:2314-2315,2281,2381).
export const PRIMDIR_LOF = 24;

// common.py:370–371 — 0 = Aries through 11 = Pisces (Signs1 / Signs2).
export const SIGN_GLYPHS_1 = ["a","b","c","d","e","f","g","h","i","j","k","l"] as const;
export const SIGN_GLYPHS_2 = ["m","n","o","p","q","r","s","t","u","v","w","x"] as const;

// common.py:368 — aspect index aligns with chart.Chart aspect constants.
// Index 11 ('[') is the SEPTILE slot — a custom glyph in Morinus.ttf added
// alongside the September aspect work; all 14 entries use the Morinus face
// (common.py:369 `AspectFontRole = ('morinus',) * len(self.Aspects)`).
export const ASPECT_GLYPHS = [
  "M", "N", "O", "P", "Q", "R", "S", "T", "U", "V", "W", "[", "X", "Y",
] as const;

// Aspect indices (chart.py:458–471)
export const ASP_CONJUNCTION = 0;
export const ASP_SEMISEXTILE = 1;
export const ASP_SEMISQUARE = 2;
export const ASP_SEXTILE = 3;
export const ASP_QUINTILE = 4;
export const ASP_SQUARE = 5;
export const ASP_TRINE = 6;
export const ASP_SESQUIQUADRATE = 7;
export const ASP_BIQUINTILE = 8;
export const ASP_QUINCUNX = 9;
export const ASP_OPPOSITION = 10;
export const ASP_SEPTILE = 11;
export const ASP_PARALLEL = 12;
export const ASP_CONTRAPARALLEL = 13;
// chart.py:473-475 — synthetic PD aspect ids with no Morinus glyph slot. The
// renderer treats these as wordless: RAPTPAR/RAPTCONTRAPAR mark a rapt-parallel
// twin, MIDPOINT marks a midpoint twin (two adjacent body glyphs).
export const ASP_RAPTPARALLEL = 14;
export const ASP_RAPTCONTRAPARALLEL = 15;
export const ASP_MIDPOINT = 16;

// common.py:374–375 — morinus house glyph set (Housenames) vs. plain numerals (Housenames2)
export const HOUSE_GLYPHS_ROMAN = ["I","2","3","IV","5","6","VII","8","9","X","11","12"] as const;
export const HOUSE_GLYPHS_ARABIC = ["1","2","3","4","5","6","7","8","9","10","11","12"] as const;

export function signGlyph(signIndex: number, variant: 1 | 2 = 1): string {
  const table = variant === 2 ? SIGN_GLYPHS_2 : SIGN_GLYPHS_1;
  return table[((signIndex % 12) + 12) % 12];
}

export function aspectGlyph(aspectType: number): string {
  return ASPECT_GLYPHS[aspectType] ?? "";
}
