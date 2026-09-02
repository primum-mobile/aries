// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  clearDitherPatternCaches,
  createDitherRasterPatternTile,
  generateVoidAndClusterThresholdTile as generateDitherVoidAndClusterThresholdTile,
  getDitherPatternCacheStats,
  sampleDitherNoise,
  type DitherRasterPatternTile,
} from "../render/dither-pattern";

/**
 * Pure compiler for Aries application-surface materials.
 *
 * The public input is the daemon's closed flat contract:
 * `authoring.app.<class>.<property>`. It deliberately accepts no selectors,
 * URLs, CSS fragments, filter strings, or other executable style input.
 *
 * Texture assets are generated once per resolved recipe and retained in a
 * bounded LRU cache. The output is expressed in CSS pixels and contains no DOM
 * or device-pixel-ratio dependency, so consumers can apply it to static chrome
 * without putting texture work in animation or chart-stepping loops.
 */

export const APP_MATERIAL_OVERRIDE_PREFIX = "authoring.app." as const;
export const APP_MATERIAL_CLASS_MANIFEST_VERSION = "app-materials-v2" as const;

export const APP_MATERIAL_CLASSES = [
  "materials.global",
  "surfaces.canvas",
  "sidebar",
  "titlebar",
  "statusbar",
  "panel",
  "inspector",
  "overlay",
  "popover",
  "control",
  "dataBody",
  "dataHeader",
] as const;

export const APP_MATERIAL_SURFACE_CLASSES = [
  "surfaces.canvas",
  "sidebar",
  "titlebar",
  "statusbar",
  "panel",
  "inspector",
  "overlay",
  "popover",
  "control",
  "dataBody",
  "dataHeader",
] as const;

export const APP_MATERIAL_PATTERNS = [
  "none",
  "solid",
  "stipple",
  "bayer2",
  "bayer4",
  "bayer8",
  "noise",
  "blueNoise",
  "paper",
  "newsprint",
  "hatch",
  "crosshatch",
  "scanline",
  "atkinson",
  "floydSteinberg",
] as const;

export const APP_MATERIAL_BLEND_MODES = [
  "normal",
  "multiply",
  "screen",
  "overlay",
  "soft-light",
  "hard-light",
  "darken",
  "lighten",
] as const;

export const APP_MATERIAL_GRADIENT_TYPES = [
  "none",
  "linear",
  "radial",
] as const;

export const APP_MATERIAL_PROPERTIES = [
  "pattern",
  "backgroundColor",
  "patternColor",
  "gradientType",
  "gradientStartColor",
  "gradientEndColor",
  "gradientAngle",
  "opacity",
  "cellSize",
  "dotSize",
  "density",
  "angle",
  "seed",
  "blendMode",
  "backdropBlur",
  "backdropSaturation",
  "shadowColor",
  "shadowX",
  "shadowY",
  "shadowBlur",
] as const;

export type AppMaterialClass = (typeof APP_MATERIAL_CLASSES)[number];
export type AppMaterialSurfaceClass =
  (typeof APP_MATERIAL_SURFACE_CLASSES)[number];
export type AppMaterialPattern = (typeof APP_MATERIAL_PATTERNS)[number];
export type AppMaterialRasterPattern = Exclude<
  AppMaterialPattern,
  "none" | "solid" | "paper" | "hatch" | "crosshatch" | "scanline"
>;
export type AppMaterialRasterPatternTile = DitherRasterPatternTile;
export type AppMaterialBlendMode =
  (typeof APP_MATERIAL_BLEND_MODES)[number];
export type AppMaterialGradientType =
  (typeof APP_MATERIAL_GRADIENT_TYPES)[number];
export type AppMaterialProperty = (typeof APP_MATERIAL_PROPERTIES)[number];
export type AppMaterialColor =
  | readonly [number, number, number]
  | readonly [number, number, number, number];

export type AppMaterialRecipe = Readonly<{
  pattern: AppMaterialPattern;
  backgroundColor: AppMaterialColor;
  patternColor: AppMaterialColor;
  gradientType: AppMaterialGradientType;
  gradientStartColor: AppMaterialColor;
  gradientEndColor: AppMaterialColor;
  gradientAngle: number;
  opacity: number;
  cellSize: number;
  dotSize: number;
  density: number;
  angle: number;
  seed: number;
  blendMode: AppMaterialBlendMode;
  backdropBlur: number;
  backdropSaturation: number;
  shadowColor: AppMaterialColor;
  shadowX: number;
  shadowY: number;
  shadowBlur: number;
}>;

export type AppMaterialRecipePatch = Readonly<
  Partial<AppMaterialRecipe>
>;

export type ParsedAppMaterialOverrides = Readonly<
  Partial<Record<AppMaterialClass, AppMaterialRecipePatch>>
>;

export type ResolvedAppMaterialRecipes = Readonly<
  Record<AppMaterialClass, AppMaterialRecipe>
>;

export type AppMaterialCssVariableNames = Readonly<{
  backgroundColor: string;
  patternColor: string;
  backgroundImage: string;
  backgroundSize: string;
  backgroundRepeat: string;
  backgroundPosition: string;
  backgroundBlendMode: string;
  backdropFilter: string;
  boxShadow: string;
  forcedColorsBackgroundImage: string;
  forcedColorsBackdropFilter: string;
  forcedColorsBoxShadow: string;
  reducedTransparencyBackgroundColor: string;
  reducedTransparencyBackgroundImage: string;
  reducedTransparencyBackdropFilter: string;
  reducedTransparencyBoxShadow: string;
}>;

export type CompiledAppMaterialStyle = Readonly<{
  classId: AppMaterialClass;
  recipe: AppMaterialRecipe;
  backgroundColor: string;
  solidBackgroundColor: string;
  patternColor: string;
  backgroundImage: string;
  backgroundSize: string;
  backgroundRepeat: string;
  backgroundPosition: string;
  backgroundBlendMode: AppMaterialBlendMode;
  backdropFilter: string;
  boxShadow: string;
  customProperties: Readonly<Record<string, string>>;
}>;

export type CompiledAppMaterials = Readonly<{
  resolved: ResolvedAppMaterialRecipes;
  byClass: Readonly<Record<AppMaterialClass, CompiledAppMaterialStyle>>;
  customProperties: Readonly<Record<string, string>>;
}>;

const DEFAULT_BACKGROUND_COLOR = Object.freeze([255, 255, 255, 1]) as
  AppMaterialColor;
const DEFAULT_PATTERN_COLOR = Object.freeze([0, 0, 0, 1]) as
  AppMaterialColor;

export const DEFAULT_APP_MATERIAL_RECIPE: AppMaterialRecipe = Object.freeze({
  pattern: "none",
  backgroundColor: DEFAULT_BACKGROUND_COLOR,
  patternColor: DEFAULT_PATTERN_COLOR,
  gradientType: "none",
  gradientStartColor: DEFAULT_BACKGROUND_COLOR,
  gradientEndColor: DEFAULT_PATTERN_COLOR,
  gradientAngle: 0,
  opacity: 12,
  cellSize: 4,
  dotSize: 1,
  density: 24,
  angle: 45,
  seed: 0,
  blendMode: "normal",
  backdropBlur: 0,
  backdropSaturation: 100,
  shadowColor: Object.freeze([0, 0, 0, 0]) as AppMaterialColor,
  shadowX: 0,
  shadowY: 0,
  shadowBlur: 0,
});

const APP_MATERIAL_CLASS_SET = new Set<string>(APP_MATERIAL_CLASSES);
const APP_MATERIAL_PATTERN_SET = new Set<string>(APP_MATERIAL_PATTERNS);
const APP_MATERIAL_BLEND_MODE_SET = new Set<string>(
  APP_MATERIAL_BLEND_MODES,
);
const APP_MATERIAL_GRADIENT_TYPE_SET = new Set<string>(
  APP_MATERIAL_GRADIENT_TYPES,
);
const APP_MATERIAL_PROPERTY_SET = new Set<string>(
  APP_MATERIAL_PROPERTIES,
);

const NUMERIC_BOUNDS: Readonly<
  Record<
    Exclude<
      AppMaterialProperty,
      | "pattern"
      | "backgroundColor"
      | "patternColor"
      | "gradientType"
      | "gradientStartColor"
      | "gradientEndColor"
      | "shadowColor"
      | "blendMode"
    >,
    readonly [number, number]
  >
> = Object.freeze({
  opacity: [0, 100],
  cellSize: [0.5, 64],
  dotSize: [0.25, 32],
  density: [0, 100],
  angle: [-180, 180],
  gradientAngle: [-180, 180],
  seed: [0, 65535],
  backdropBlur: [0, 40],
  backdropSaturation: [0, 200],
  shadowX: [-64, 64],
  shadowY: [-64, 64],
  shadowBlur: [0, 80],
});

const MATERIAL_CLASS_SLUGS: Readonly<Record<AppMaterialClass, string>> =
  Object.freeze({
    "materials.global": "global",
    "surfaces.canvas": "canvas",
    sidebar: "sidebar",
    titlebar: "titlebar",
    statusbar: "statusbar",
    panel: "panel",
    inspector: "inspector",
    overlay: "overlay",
    popover: "popover",
    control: "control",
    dataBody: "data-body",
    dataHeader: "data-header",
  });

const TILE_CACHE_LIMIT = 64;
const RASTER_TILE_SCALE = 4;
const RASTER_TILE_SUPERSAMPLE = 2;
const PNG_PALETTE_SIZE = 16;

type TextureTile = Readonly<{
  backgroundImage: string;
  backgroundSize: string;
  backgroundRepeat: "repeat" | "no-repeat";
  backgroundPosition: string;
}>;

const textureTileCache = new Map<string, TextureTile>();

export class AppMaterialValidationError extends TypeError {
  readonly semanticId: string | null;

  constructor(message: string, semanticId: string | null = null) {
    super(message);
    this.name = "AppMaterialValidationError";
    this.semanticId = semanticId;
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return (
    value != null
    && typeof value === "object"
    && !Array.isArray(value)
  );
}

function formatNumber(value: number, precision = 4): string {
  if (Object.is(value, -0)) return "0";
  const fixed = value.toFixed(precision);
  return fixed.replace(/\.?0+$/, "");
}

function colorChannels(value: AppMaterialColor): readonly [
  number,
  number,
  number,
  number,
] {
  return [
    value[0],
    value[1],
    value[2],
    value.length === 4 ? value[3] : 1,
  ];
}

function colorCss(value: AppMaterialColor, opacityScale = 1): string {
  const [red, green, blue, alpha] = colorChannels(value);
  return `rgb(${red} ${green} ${blue} / ${formatNumber(
    Math.max(0, Math.min(1, alpha * opacityScale)),
    6,
  )})`;
}

function colorHex(value: AppMaterialColor): string {
  return `#${value
    .slice(0, 3)
    .map((channel) => channel.toString(16).padStart(2, "0"))
    .join("")}`;
}

function parseColor(
  semanticId: string,
  value: unknown,
): AppMaterialColor {
  if (!Array.isArray(value) || (value.length !== 3 && value.length !== 4)) {
    throw new AppMaterialValidationError(
      `${semanticId} must be an RGB or RGBA array`,
      semanticId,
    );
  }
  const channels = value.slice(0, 3);
  if (
    channels.some(
      (channel) =>
        typeof channel !== "number"
        || !Number.isInteger(channel)
        || channel < 0
        || channel > 255,
    )
  ) {
    throw new AppMaterialValidationError(
      `${semanticId} RGB channels must be integers from 0 to 255`,
      semanticId,
    );
  }
  if (value.length === 4) {
    const alpha = value[3];
    if (
      typeof alpha !== "number"
      || !Number.isFinite(alpha)
      || alpha < 0
      || alpha > 1
    ) {
      throw new AppMaterialValidationError(
        `${semanticId} alpha must be a number from 0 to 1`,
        semanticId,
      );
    }
  }
  return Object.freeze([...value]) as AppMaterialColor;
}

function parseNumber(
  semanticId: string,
  property: keyof typeof NUMERIC_BOUNDS,
  value: unknown,
): number {
  if (
    typeof value !== "number"
    || !Number.isFinite(value)
    || (property === "seed" && !Number.isInteger(value))
  ) {
    throw new AppMaterialValidationError(
      `${semanticId} must be ${
        property === "seed" ? "an integer" : "a finite number"
      }`,
      semanticId,
    );
  }
  const [minimum, maximum] = NUMERIC_BOUNDS[property];
  if (value < minimum || value > maximum) {
    throw new AppMaterialValidationError(
      `${semanticId} must be between ${minimum} and ${maximum}`,
      semanticId,
    );
  }
  return value;
}

function parsePropertyValue(
  semanticId: string,
  property: AppMaterialProperty,
  value: unknown,
): AppMaterialRecipe[AppMaterialProperty] {
  if (
    property === "backgroundColor"
    || property === "patternColor"
    || property === "gradientStartColor"
    || property === "gradientEndColor"
    || property === "shadowColor"
  ) {
    return parseColor(semanticId, value);
  }
  if (property === "pattern") {
    if (typeof value !== "string" || !APP_MATERIAL_PATTERN_SET.has(value)) {
      throw new AppMaterialValidationError(
        `${semanticId} has an unsupported material pattern`,
        semanticId,
      );
    }
    return value as AppMaterialPattern;
  }
  if (property === "blendMode") {
    if (
      typeof value !== "string"
      || !APP_MATERIAL_BLEND_MODE_SET.has(value)
    ) {
      throw new AppMaterialValidationError(
        `${semanticId} has an unsupported blend mode`,
        semanticId,
      );
    }
    return value as AppMaterialBlendMode;
  }
  if (property === "gradientType") {
    if (
      typeof value !== "string"
      || !APP_MATERIAL_GRADIENT_TYPE_SET.has(value)
    ) {
      throw new AppMaterialValidationError(
        `${semanticId} has an unsupported gradient type`,
        semanticId,
      );
    }
    return value as AppMaterialGradientType;
  }
  return parseNumber(semanticId, property, value);
}

export function appMaterialOverrideId(
  classId: AppMaterialClass,
  property: AppMaterialProperty,
): string {
  return `${APP_MATERIAL_OVERRIDE_PREFIX}${classId}.${property}`;
}

function splitAppMaterialOverrideId(
  semanticId: string,
): readonly [AppMaterialClass, AppMaterialProperty] {
  if (!semanticId.startsWith(APP_MATERIAL_OVERRIDE_PREFIX)) {
    throw new AppMaterialValidationError(
      `app material override must start with ${APP_MATERIAL_OVERRIDE_PREFIX}`,
      semanticId,
    );
  }
  const remainder = semanticId.slice(APP_MATERIAL_OVERRIDE_PREFIX.length);
  const separator = remainder.lastIndexOf(".");
  if (separator <= 0 || separator === remainder.length - 1) {
    throw new AppMaterialValidationError(
      `invalid app material override id: ${semanticId}`,
      semanticId,
    );
  }
  const classId = remainder.slice(0, separator);
  const property = remainder.slice(separator + 1);
  if (!APP_MATERIAL_CLASS_SET.has(classId)) {
    throw new AppMaterialValidationError(
      `unknown app material class: ${classId}`,
      semanticId,
    );
  }
  if (!APP_MATERIAL_PROPERTY_SET.has(property)) {
    throw new AppMaterialValidationError(
      `unknown app material property: ${property}`,
      semanticId,
    );
  }
  return [
    classId as AppMaterialClass,
    property as AppMaterialProperty,
  ];
}

/** Parse and freeze the daemon's closed appAuthoringOverrides map. */
export function parseFlatAppMaterialOverrides(
  value: unknown,
): ParsedAppMaterialOverrides {
  if (!isRecord(value)) {
    throw new AppMaterialValidationError(
      "app material overrides must be an object",
    );
  }
  if (
    Object.keys(value).length
    > APP_MATERIAL_CLASSES.length * APP_MATERIAL_PROPERTIES.length
  ) {
    throw new AppMaterialValidationError("too many app material overrides");
  }
  const mutable: Partial<
    Record<AppMaterialClass, Partial<AppMaterialRecipe>>
  > = {};
  for (const [semanticId, rawValue] of Object.entries(value)) {
    const [classId, property] = splitAppMaterialOverrideId(semanticId);
    const patch = mutable[classId] ?? {};
    (
      patch as Record<AppMaterialProperty, AppMaterialRecipe[AppMaterialProperty]>
    )[property] = parsePropertyValue(semanticId, property, rawValue);
    mutable[classId] = patch;
  }
  const parsed: Partial<Record<AppMaterialClass, AppMaterialRecipePatch>> = {};
  for (const classId of APP_MATERIAL_CLASSES) {
    const patch = mutable[classId];
    if (patch) parsed[classId] = Object.freeze({ ...patch });
  }
  return Object.freeze(parsed);
}

/**
 * Resolve materials.global once, then inherit every one of its properties into
 * each semantic surface before applying that surface's sparse overrides.
 */
export function resolveAppMaterialRecipes(
  flatOverrides: unknown,
): ResolvedAppMaterialRecipes {
  const parsed = parseFlatAppMaterialOverrides(flatOverrides);
  const global = Object.freeze({
    ...DEFAULT_APP_MATERIAL_RECIPE,
    ...(parsed["materials.global"] ?? {}),
  }) as AppMaterialRecipe;
  const resolved = {} as Record<AppMaterialClass, AppMaterialRecipe>;
  resolved["materials.global"] = global;
  for (const classId of APP_MATERIAL_SURFACE_CLASSES) {
    resolved[classId] = Object.freeze({
      ...global,
      ...(parsed[classId] ?? {}),
    }) as AppMaterialRecipe;
  }
  return Object.freeze(resolved);
}

function boundedCacheGet<T>(cache: Map<string, T>, key: string): T | null {
  const existing = cache.get(key);
  if (existing == null) return null;
  cache.delete(key);
  cache.set(key, existing);
  return existing;
}

function boundedCacheSet<T>(
  cache: Map<string, T>,
  key: string,
  value: T,
  limit: number,
): void {
  if (cache.has(key)) cache.delete(key);
  cache.set(key, value);
  while (cache.size > limit) {
    const oldest = cache.keys().next().value as string | undefined;
    if (oldest == null) break;
    cache.delete(oldest);
  }
}

/** Return a defensive rank copy suitable for tests, export, or diagnostics. */
export function generateVoidAndClusterThresholdTile(
  seed: number,
  side = 32,
): Uint16Array {
  try {
    return generateDitherVoidAndClusterThresholdTile(seed, side);
  } catch (error) {
    throw new AppMaterialValidationError(
      error instanceof Error ? error.message : "invalid blue-noise recipe",
    );
  }
}

/** Compile one raster material into the shared renderer-neutral binary tile. */
export function createAppMaterialRasterPatternTile(
  pattern: AppMaterialRasterPattern,
  density: number,
  seed: number,
): AppMaterialRasterPatternTile {
  return createDitherRasterPatternTile(pattern, density, seed);
}

/** Stable seeded sample shared by paper-grain paint implementations. */
export function sampleAppMaterialNoise(
  x: number,
  y: number,
  seed: number,
): number {
  return sampleDitherNoise(x, y, seed);
}

function svgDataImage(svg: string): string {
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function adler32(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (const byte of bytes) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

function uint32Bytes(value: number): Uint8Array {
  return Uint8Array.of(
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  );
}

function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const joined = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    joined.set(part, offset);
    offset += part.length;
  }
  return joined;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = Uint8Array.from(
    Array.from(type, (character) => character.charCodeAt(0)),
  );
  const body = concatBytes([typeBytes, data]);
  return concatBytes([
    uint32Bytes(data.length),
    body,
    uint32Bytes(crc32(body)),
  ]);
}

function storedZlib(bytes: Uint8Array): Uint8Array {
  const blocks: Uint8Array[] = [Uint8Array.of(0x78, 0x01)];
  for (let offset = 0; offset < bytes.length;) {
    const length = Math.min(0xffff, bytes.length - offset);
    const final = offset + length === bytes.length;
    blocks.push(Uint8Array.of(
      final ? 0x01 : 0x00,
      length & 0xff,
      (length >>> 8) & 0xff,
      (~length) & 0xff,
      ((~length) >>> 8) & 0xff,
    ));
    blocks.push(bytes.subarray(offset, offset + length));
    offset += length;
  }
  blocks.push(uint32Bytes(adler32(bytes)));
  return concatBytes(blocks);
}

const BASE64_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function base64Bytes(bytes: Uint8Array): string {
  let encoded = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0;
    const second = bytes[index + 1] ?? 0;
    const third = bytes[index + 2] ?? 0;
    const value = (first << 16) | (second << 8) | third;
    encoded += BASE64_ALPHABET[(value >>> 18) & 63];
    encoded += BASE64_ALPHABET[(value >>> 12) & 63];
    encoded += index + 1 < bytes.length
      ? BASE64_ALPHABET[(value >>> 6) & 63]
      : "=";
    encoded += index + 2 < bytes.length
      ? BASE64_ALPHABET[value & 63]
      : "=";
  }
  return encoded;
}

function rasterMaskAlpha(
  mask: Uint8Array,
  side: number,
  recipe: AppMaterialRecipe,
  shape: "circle" | "square",
): Float64Array {
  const rasterSide = side * RASTER_TILE_SCALE;
  const sampleScale = RASTER_TILE_SCALE * RASTER_TILE_SUPERSAMPLE;
  const sampleSide = side * sampleScale;
  const coverage = new Uint16Array(sampleSide * sampleSide);
  const dot = recipe.dotSize / recipe.cellSize;
  const halfDot = dot / 2;
  const wrap = (value: number) => (
    (value % sampleSide + sampleSide) % sampleSide
  );
  for (let index = 0; index < mask.length; index += 1) {
    if (!mask[index]) continue;
    const centerX = (index % side) + 0.5;
    const centerY = Math.floor(index / side) + 0.5;
    const minX = Math.ceil((centerX - halfDot) * sampleScale - 0.5);
    const maxX = Math.floor((centerX + halfDot) * sampleScale - 0.5);
    const minY = Math.ceil((centerY - halfDot) * sampleScale - 0.5);
    const maxY = Math.floor((centerY + halfDot) * sampleScale - 0.5);
    for (let sampleY = minY; sampleY <= maxY; sampleY += 1) {
      const y = (sampleY + 0.5) / sampleScale;
      const dy = y - centerY;
      for (let sampleX = minX; sampleX <= maxX; sampleX += 1) {
        const x = (sampleX + 0.5) / sampleScale;
        const dx = x - centerX;
        if (
          shape === "circle"
          && dx * dx + dy * dy > halfDot * halfDot
        ) {
          continue;
        }
        coverage[wrap(sampleY) * sampleSide + wrap(sampleX)] += 1;
      }
    }
  }
  const baseAlpha =
    colorChannels(recipe.patternColor)[3] * (recipe.opacity / 100);
  const alpha = new Float64Array(rasterSide * rasterSide);
  const samplesPerPixel =
    RASTER_TILE_SUPERSAMPLE * RASTER_TILE_SUPERSAMPLE;
  for (let y = 0; y < rasterSide; y += 1) {
    for (let x = 0; x < rasterSide; x += 1) {
      let sum = 0;
      for (
        let sampleY = 0;
        sampleY < RASTER_TILE_SUPERSAMPLE;
        sampleY += 1
      ) {
        for (
          let sampleX = 0;
          sampleX < RASTER_TILE_SUPERSAMPLE;
          sampleX += 1
        ) {
          const count = coverage[
            (y * RASTER_TILE_SUPERSAMPLE + sampleY) * sampleSide
              + x * RASTER_TILE_SUPERSAMPLE
              + sampleX
          ];
          sum += count === 0 ? 0 : 1 - (1 - baseAlpha) ** count;
        }
      }
      alpha[y * rasterSide + x] = sum / samplesPerPixel;
    }
  }
  return alpha;
}

function indexedPng(
  width: number,
  height: number,
  rgb: readonly [number, number, number],
  alpha: Float64Array,
): Uint8Array {
  const maximumAlpha = alpha.reduce(
    (maximum, value) => Math.max(maximum, value),
    0,
  );
  const palette = new Uint8Array(PNG_PALETTE_SIZE * 3);
  const transparency = new Uint8Array(PNG_PALETTE_SIZE);
  for (let index = 0; index < PNG_PALETTE_SIZE; index += 1) {
    palette[index * 3] = rgb[0];
    palette[index * 3 + 1] = rgb[1];
    palette[index * 3 + 2] = rgb[2];
    transparency[index] = Math.round(
      maximumAlpha * 255 * index / (PNG_PALETTE_SIZE - 1),
    );
  }
  const rowBytes = Math.ceil(width / 2);
  const scanlines = new Uint8Array((rowBytes + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * (rowBytes + 1) + 1;
    for (let x = 0; x < width; x += 1) {
      const value = maximumAlpha <= 0
        ? 0
        : Math.round(
            alpha[y * width + x]
              / maximumAlpha
              * (PNG_PALETTE_SIZE - 1),
          );
      const byteOffset = rowOffset + Math.floor(x / 2);
      scanlines[byteOffset] |= x % 2 === 0 ? value << 4 : value;
    }
  }
  const ihdr = concatBytes([
    uint32Bytes(width),
    uint32Bytes(height),
    Uint8Array.of(4, 3, 0, 0, 0),
  ]);
  return concatBytes([
    Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10),
    pngChunk("IHDR", ihdr),
    pngChunk("PLTE", palette),
    pngChunk("tRNS", transparency),
    pngChunk("IDAT", storedZlib(scanlines)),
    pngChunk("IEND", new Uint8Array()),
  ]);
}

function maskPng(
  mask: Uint8Array,
  side: number,
  recipe: AppMaterialRecipe,
  shape: "circle" | "square",
): string {
  const rasterSide = side * RASTER_TILE_SCALE;
  const channels = colorChannels(recipe.patternColor);
  const png = indexedPng(
    rasterSide,
    rasterSide,
    [channels[0], channels[1], channels[2]],
    rasterMaskAlpha(mask, side, recipe, shape),
  );
  return `url("data:image/png;base64,${base64Bytes(png)}")`;
}

function paperSvg(recipe: AppMaterialRecipe): string {
  const side = 24;
  const dot = recipe.dotSize / recipe.cellSize;
  const baseOpacity =
    colorChannels(recipe.patternColor)[3] * (recipe.opacity / 100);
  const elements: string[] = [];
  for (let y = 0; y < side; y += 1) {
    for (let x = 0; x < side; x += 1) {
      const presence = sampleDitherNoise(x, y, recipe.seed);
      if (presence * 100 >= recipe.density) continue;
      const fine = sampleDitherNoise(
        x * 3 + 7,
        y * 5 + 11,
        recipe.seed ^ 0x4f31,
      );
      const coarse = sampleDitherNoise(
        Math.floor(x / 4),
        Math.floor(y / 4),
        recipe.seed ^ 0x7123,
      );
      const opacity = baseOpacity * (0.15 + fine * 0.55 + coarse * 0.3);
      elements.push(
        `<circle cx="${formatNumber(x + 0.5)}" cy="${formatNumber(
          y + 0.5,
        )}" r="${formatNumber(dot * (0.2 + fine * 0.3))}" fill-opacity="${formatNumber(
          Math.max(0, Math.min(1, opacity)),
          6,
        )}"/>`,
      );
    }
  }
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${side} ${side}">`,
    `<g fill="${colorHex(recipe.patternColor)}">${elements.join("")}</g>`,
    "</svg>",
  ].join("");
}

function recipeCacheKey(recipe: AppMaterialRecipe): string {
  const directionalAngle =
    recipe.pattern === "hatch"
    || recipe.pattern === "crosshatch"
    || recipe.pattern === "scanline"
      ? recipe.angle
      : 0;
  return [
    recipe.pattern,
    recipe.patternColor.join(","),
    recipe.opacity,
    recipe.cellSize,
    recipe.dotSize,
    recipe.density,
    directionalAngle,
    recipe.seed,
  ].join("\u0000");
}

function rasterTile(
  recipe: AppMaterialRecipe,
  mask: Uint8Array,
  side: number,
  shape: "circle" | "square",
): TextureTile {
  return Object.freeze({
    // WKWebView repeatedly re-composited the former hundreds-of-vector-nodes
    // SVG tile while retained surfaces changed. A small deterministic indexed
    // PNG keeps the same seeded screen and alpha recipe as one bitmap layer.
    backgroundImage: maskPng(mask, side, recipe, shape),
    backgroundSize: `${formatNumber(
      side * recipe.cellSize,
    )}px ${formatNumber(side * recipe.cellSize)}px`,
    backgroundRepeat: "repeat",
    backgroundPosition: "0px 0px",
  });
}

function lineTextureTile(recipe: AppMaterialRecipe): TextureTile {
  if (recipe.density <= 0 || recipe.opacity <= 0) {
    return Object.freeze({
      backgroundImage: "none",
      backgroundSize: "auto",
      backgroundRepeat: "repeat",
      backgroundPosition: "0px 0px",
    });
  }
  const period = Math.max(
    recipe.dotSize,
    recipe.cellSize * (100 / recipe.density),
  );
  const lineWidth = Math.min(period, recipe.dotSize);
  const lineColor = colorCss(
    recipe.patternColor,
    recipe.opacity / 100,
  );
  const gradient = (angle: number) =>
    `repeating-linear-gradient(${formatNumber(angle)}deg, ${lineColor} 0px, ${lineColor} ${formatNumber(
      lineWidth,
    )}px, transparent ${formatNumber(lineWidth)}px, transparent ${formatNumber(
      period,
    )}px)`;
  const angles =
    recipe.pattern === "crosshatch"
      ? [recipe.angle, recipe.angle + 90]
      : recipe.pattern === "scanline"
        ? [recipe.angle + 90]
        : [recipe.angle];
  return Object.freeze({
    backgroundImage: angles.map(gradient).join(", "),
    backgroundSize: "auto",
    backgroundRepeat: "repeat",
    backgroundPosition: "0px 0px",
  });
}

function createTextureTile(recipe: AppMaterialRecipe): TextureTile {
  if (recipe.pattern === "none" || recipe.opacity <= 0) {
    return Object.freeze({
      backgroundImage: "none",
      backgroundSize: "auto",
      backgroundRepeat: "repeat",
      backgroundPosition: "0px 0px",
    });
  }
  if (recipe.pattern === "solid") {
    const color = colorCss(recipe.patternColor, recipe.opacity / 100);
    return Object.freeze({
      backgroundImage: `linear-gradient(${color}, ${color})`,
      backgroundSize: "auto",
      backgroundRepeat: "no-repeat",
      backgroundPosition: "0px 0px",
    });
  }
  if (
    recipe.pattern === "hatch"
    || recipe.pattern === "crosshatch"
    || recipe.pattern === "scanline"
  ) {
    return lineTextureTile(recipe);
  }
  if (recipe.density <= 0) {
    return Object.freeze({
      backgroundImage: "none",
      backgroundSize: "auto",
      backgroundRepeat: "repeat",
      backgroundPosition: "0px 0px",
    });
  }
  if (recipe.pattern === "paper") {
    const side = 24;
    return Object.freeze({
      backgroundImage: svgDataImage(paperSvg(recipe)),
      backgroundSize: `${formatNumber(
        side * recipe.cellSize,
      )}px ${formatNumber(side * recipe.cellSize)}px`,
      backgroundRepeat: "repeat",
      backgroundPosition: "0px 0px",
    });
  }
  if (
    recipe.pattern === "stipple"
    || recipe.pattern === "bayer2"
    || recipe.pattern === "bayer4"
    || recipe.pattern === "bayer8"
    || recipe.pattern === "noise"
    || recipe.pattern === "blueNoise"
    || recipe.pattern === "newsprint"
    || recipe.pattern === "atkinson"
    || recipe.pattern === "floydSteinberg"
  ) {
    const tile = createAppMaterialRasterPatternTile(
      recipe.pattern,
      recipe.density,
      recipe.seed,
    );
    return rasterTile(
      recipe,
      tile.mask,
      tile.side,
      tile.shape,
    );
  }
  return Object.freeze({
    backgroundImage: "none",
    backgroundSize: "auto",
    backgroundRepeat: "repeat",
    backgroundPosition: "0px 0px",
  });
}

function textureTile(recipe: AppMaterialRecipe): TextureTile {
  const key = recipeCacheKey(recipe);
  const existing = boundedCacheGet(textureTileCache, key);
  if (existing) return existing;
  const generated = createTextureTile(recipe);
  boundedCacheSet(textureTileCache, key, generated, TILE_CACHE_LIMIT);
  return generated;
}

export function appMaterialCssVariableNames(
  classId: AppMaterialClass,
): AppMaterialCssVariableNames {
  const prefix = `--aries-material-${MATERIAL_CLASS_SLUGS[classId]}`;
  return Object.freeze({
    backgroundColor: `${prefix}-background-color`,
    patternColor: `${prefix}-pattern-color`,
    backgroundImage: `${prefix}-background-image`,
    backgroundSize: `${prefix}-background-size`,
    backgroundRepeat: `${prefix}-background-repeat`,
    backgroundPosition: `${prefix}-background-position`,
    backgroundBlendMode: `${prefix}-background-blend-mode`,
    backdropFilter: `${prefix}-backdrop-filter`,
    boxShadow: `${prefix}-box-shadow`,
    forcedColorsBackgroundImage:
      `${prefix}-forced-colors-background-image`,
    forcedColorsBackdropFilter:
      `${prefix}-forced-colors-backdrop-filter`,
    forcedColorsBoxShadow:
      `${prefix}-forced-colors-box-shadow`,
    reducedTransparencyBackgroundColor:
      `${prefix}-reduced-transparency-background-color`,
    reducedTransparencyBackgroundImage:
      `${prefix}-reduced-transparency-background-image`,
    reducedTransparencyBackdropFilter:
      `${prefix}-reduced-transparency-backdrop-filter`,
    reducedTransparencyBoxShadow:
      `${prefix}-reduced-transparency-box-shadow`,
  });
}

function compileResolvedRecipe(
  classId: AppMaterialClass,
  recipe: AppMaterialRecipe,
): CompiledAppMaterialStyle {
  const tile = textureTile(recipe);
  const variableNames = appMaterialCssVariableNames(classId);
  const backgroundColor = colorCss(recipe.backgroundColor);
  const solidBackgroundColor = colorCss([
    recipe.backgroundColor[0],
    recipe.backgroundColor[1],
    recipe.backgroundColor[2],
  ]);
  const patternColor = colorCss(
    recipe.patternColor,
    recipe.opacity / 100,
  );
  const gradientImage = recipe.gradientType === "none"
    ? "none"
    : recipe.gradientType === "linear"
      ? `linear-gradient(${formatNumber(recipe.gradientAngle)}deg, ${colorCss(
          recipe.gradientStartColor,
        )}, ${colorCss(recipe.gradientEndColor)})`
      : `radial-gradient(circle at ${formatNumber(
          50 + Math.cos(recipe.gradientAngle * Math.PI / 180) * 18,
        )}% ${formatNumber(
          50 + Math.sin(recipe.gradientAngle * Math.PI / 180) * 18,
        )}%, ${colorCss(recipe.gradientStartColor)}, ${colorCss(
          recipe.gradientEndColor,
        )})`;
  const backgroundImage = [
    tile.backgroundImage,
    gradientImage,
  ].filter((value) => value !== "none").join(", ") || "none";
  const backgroundSize = gradientImage === "none"
    ? tile.backgroundSize
    : tile.backgroundImage === "none"
      ? "cover"
      : `${tile.backgroundSize}, cover`;
  const backgroundRepeat = gradientImage === "none"
    ? tile.backgroundRepeat
    : tile.backgroundImage === "none"
      ? "no-repeat"
      : `${tile.backgroundRepeat}, no-repeat`;
  const backgroundPosition = gradientImage === "none"
    ? tile.backgroundPosition
    : tile.backgroundImage === "none"
      ? "center"
      : `${tile.backgroundPosition}, center`;
  const backdropFilter =
    recipe.backdropBlur === 0 && recipe.backdropSaturation === 100
      ? "none"
      : `blur(${formatNumber(
          recipe.backdropBlur,
        )}px) saturate(${formatNumber(recipe.backdropSaturation)}%)`;
  const boxShadow =
    colorChannels(recipe.shadowColor)[3] === 0
      ? "none"
      : `${formatNumber(recipe.shadowX)}px ${formatNumber(
          recipe.shadowY,
        )}px ${formatNumber(recipe.shadowBlur)}px ${colorCss(
          recipe.shadowColor,
        )}`;
  const customProperties = Object.freeze({
    [variableNames.backgroundColor]: backgroundColor,
    [variableNames.patternColor]: patternColor,
    [variableNames.backgroundImage]: backgroundImage,
    [variableNames.backgroundSize]: backgroundSize,
    [variableNames.backgroundRepeat]: backgroundRepeat,
    [variableNames.backgroundPosition]: backgroundPosition,
    [variableNames.backgroundBlendMode]: recipe.blendMode,
    [variableNames.backdropFilter]: backdropFilter,
    [variableNames.boxShadow]: boxShadow,
    [variableNames.forcedColorsBackgroundImage]: "none",
    [variableNames.forcedColorsBackdropFilter]: "none",
    [variableNames.forcedColorsBoxShadow]: "none",
    [variableNames.reducedTransparencyBackgroundColor]: solidBackgroundColor,
    [variableNames.reducedTransparencyBackgroundImage]: "none",
    [variableNames.reducedTransparencyBackdropFilter]: "none",
    [variableNames.reducedTransparencyBoxShadow]: "none",
  });
  return Object.freeze({
    classId,
    recipe,
    backgroundColor,
    solidBackgroundColor,
    patternColor,
    backgroundImage,
    backgroundSize,
    backgroundRepeat,
    backgroundPosition,
    backgroundBlendMode: recipe.blendMode,
    backdropFilter,
    boxShadow,
    customProperties,
  });
}

/**
 * Compile every global-resolved surface into safe values consumable as:
 *
 * background-color: var(--aries-material-<surface>-background-color);
 * background-image: var(--aries-material-<surface>-background-image);
 * background-size/repeat/position/blend-mode: corresponding variables;
 * backdrop-filter and -webkit-backdrop-filter: the backdrop-filter variable.
 *
 * In `forced-colors: active`, switch image/filter to the exported
 * `forced-colors-*` variables. In `prefers-reduced-transparency: reduce`,
 * switch color/image/filter to the `reduced-transparency-*` variables.
 */
export function compileFlatAppMaterialOverrides(
  flatOverrides: unknown,
): CompiledAppMaterials {
  const resolved = resolveAppMaterialRecipes(flatOverrides);
  const byClass = {} as Record<AppMaterialClass, CompiledAppMaterialStyle>;
  const customProperties: Record<string, string> = {};
  for (const classId of APP_MATERIAL_CLASSES) {
    const compiled = compileResolvedRecipe(classId, resolved[classId]);
    byClass[classId] = compiled;
    Object.assign(customProperties, compiled.customProperties);
  }
  return Object.freeze({
    resolved,
    byClass: Object.freeze(byClass),
    customProperties: Object.freeze(customProperties),
  });
}

export function clearAppMaterialCaches(): void {
  textureTileCache.clear();
  clearDitherPatternCaches();
}

export function getAppMaterialCacheStats(): Readonly<{
  textureTiles: number;
  blueNoiseThresholdTiles: number;
  textureTileLimit: number;
  blueNoiseThresholdTileLimit: number;
}> {
  const ditherStats = getDitherPatternCacheStats();
  return Object.freeze({
    textureTiles: textureTileCache.size,
    blueNoiseThresholdTiles: ditherStats.blueNoiseThresholdTiles,
    textureTileLimit: TILE_CACHE_LIMIT,
    blueNoiseThresholdTileLimit:
      ditherStats.blueNoiseThresholdTileLimit,
  });
}
