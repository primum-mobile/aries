#!/usr/bin/env node

// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const frontendRoot = resolve(scriptDir, "..");
const chartRoot = join(frontendRoot, "src/lib/chart");
const cssPath = join(frontendRoot, "src/app/globals.css");
const contractPath = join(frontendRoot, "src/styles/renderer-style-contract.generated.json");
const check = process.argv.includes("--check");
const begin = "/* BEGIN GENERATED RENDERER STYLE TOKENS */";
const end = "/* END GENERATED RENDERER STYLE TOKENS */";

function readNormalizedText(path) {
  return readFileSync(path, "utf8").replace(/\r\n?/g, "\n");
}

const rendererLabels = {
  astrocart: "Astrocartography",
  astrolabe: "Astrolabe",
  ephemeris: "Graphic Ephemeris",
  mundane: "Mundane chart",
  sphere: "Astrolog Sphere",
  square: "Square chart",
  strip: "Strip chart",
  wheel: "Chart wheel",
};

const squarePublic = new Set([
  "radiusScale",
  "symbolFontDivisor",
  "smallSymbolFontDivisor",
  "smallTextScale",
  "smallerTextScale",
  "frameOuterWidthSmall",
  "frameOuterWidthMedium",
  "frameOuterWidthLarge",
  "frameInnerWidthSmall",
  "frameInnerWidthMedium",
  "frameInnerWidthLarge",
]);

const stripPublic = new Set([
  "fontSize",
  "border",
  "longTickScale",
  "fiveTickScale",
  "oneTickScale",
  "degreeLabelOffsetScale",
  "axisStrokeWidth",
  "connectorStrokeWidth",
  "containerPadding",
  "notesGap",
]);

const astrolabeInternal = new Set([
  "innerRadiusMin",
  "signCullScale",
  "bodyCullScale",
  "collisionMarginScale",
  "collisionIterations",
  "collisionMinDelta",
  "collisionTieDelta",
  "collisionPushScale",
  "collisionMoveScale",
]);

const mundanePublic = new Set([
  "symbolMin",
  "compoundSymbolDivisor",
  "singleSymbolDivisor",
  "fontMin",
  "textDivisor",
  "smallTextDivisor",
  "hairlineWidth",
  "heavySmall",
  "heavyMedium",
  "heavyLarge",
  "tenDegreeSmall",
  "tenDegreeLarge",
  "planetLineSmall",
  "planetLineLarge",
  "ascMcMinWidth",
  "ascMcSmallWidth",
  "ascMcMediumWidth",
  "aspectWidthMin",
  "aspectWidthScale",
  "aspectOpacityBase",
  "aspectOpacityRange",
  "aspectDashThreshold",
  "aspectDashOn",
  "aspectDashOff",
  "overlaySymbolDivisor",
  "overlayCompactFontMin",
  "overlayRegularFontMin",
  "overlayCompactFontScale",
  "overlayRegularFontScale",
  "overlayCompactInsetMin",
  "overlayRegularInsetMin",
  "overlayInsetDivisor",
  "overlayTitlebarSafeTop",
  "overlayLineHeight",
]);

function isPublicMetric(renderer, key, styleModule) {
  if (renderer === "square") return squarePublic.has(key);
  if (renderer === "sphere") return true;
  if (renderer === "strip") return stripPublic.has(key);
  if (renderer === "astrolabe") return !astrolabeInternal.has(key);
  if (renderer === "mundane") return mundanePublic.has(key);
  if (renderer === "astrocart") return true;
  if (renderer === "ephemeris") return true;
  if (renderer === "wheel") {
    const internal = new Set(styleModule.WHEEL_RENDER_INTERNAL_TOKEN_KEYS ?? []);
    return !internal.has(key);
  }
  return false;
}

function cssUnit(renderer, key, styleModule) {
  if (
    renderer === "wheel"
    && Object.hasOwn(styleModule.WHEEL_RENDER_TOKEN_UNIT_OVERRIDES ?? {}, key)
  ) {
    return styleModule.WHEEL_RENDER_TOKEN_UNIT_OVERRIDES[key];
  }
  if (key === "innerFramePixelAdjustment") return "px";
  if (/Pattern$/.test(key)) return "";
  if (/HueRotate/.test(key)) return "deg";
  if (
    /(Scale|Divisor|Opacity|Fill|Iterations|Threshold|Range|Factor|Ratio|Weight|Adjustment|Spacing)/.test(key) ||
    /LineHeight/.test(key)
  ) return "";
  return "px";
}

function humanize(value) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .replace(/^./, (character) => character.toUpperCase());
}

function semanticId(renderer, key, palette, font) {
  return `renderer.${renderer}.${font ? "font" : palette ? "color" : "metric"}.${key}`;
}

function numericBounds(renderer, key, fallback) {
  const value = Number(fallback);
  if (/Pattern$/.test(key)) return { min: 0, max: 3, step: 1 };
  if (/HueRotate/.test(key)) return { min: -360, max: 360, step: 1 };
  if (/ShadowOffset/.test(key)) return { min: -64, max: 64, step: 0.5 };
  if (/Blur$/.test(key)) return { min: 0, max: 64, step: 0.5 };
  if (key === "angleLabelWeight") return { min: 1, max: 1000, step: 1 };
  if (renderer === "wheel" && key === "overlayCompactBreakpoint") {
    return { min: 240, max: 800, step: 10 };
  }
  if (renderer === "wheel" && key === "overlayMaxWidthViewportScale") {
    return { min: 0.2, max: 1, step: 0.01 };
  }
  if (renderer === "wheel" && /^overlay(?:Info|CompactInfo|Icon|CompactIcon|Label|CompactLabel).*Min$/.test(key)) {
    return { min: 6, max: 48, step: 0.5 };
  }
  if (renderer === "wheel" && /^overlay(?:ColumnGapMin|CompactEdgeInsetMin|TitlebarSafeTop|InfoGap)$/.test(key)) {
    return { min: 0, max: 48, step: 0.5 };
  }
  if (renderer === "wheel" && /^overlay(?:Corner|Glyph)LineHeight$/.test(key)) {
    return { min: 0.5, max: 2, step: 0.01 };
  }
  if (renderer === "wheel" && /^overlay.*(?:Scale|Factor)$/.test(key)) {
    const allowZero = /(?:Gap|Inset)/.test(key);
    return { min: allowZero ? 0 : 0.1, max: 2, step: 0.01 };
  }
  if (key === "radiusScale" && renderer === "sphere") return { min: 0.25, max: 0.55, step: 0.01 };
  if (key === "radiusScale" && renderer === "square") return { min: 0.72, max: 0.96, step: 0.01 };
  if (key === "capricornFill") return { min: 0.1, max: 1, step: 0.01 };
  if (/Opacity|Fill/.test(key)) return { min: 0, max: 1, step: 0.01 };
  if (/Size/.test(key) && !/Scale/.test(key)) {
    return {
      min: Math.max(1, Math.floor(value * 0.4 * 10) / 10),
      max: Math.max(8, Math.ceil(value * 2)),
      step: Number.isInteger(value) ? 0.5 : 0.1,
    };
  }
  if (/Iterations/.test(key)) return { min: 1, max: Math.max(100, Math.ceil(value * 2)), step: 1 };
  if (/Divisor/.test(key)) {
    return {
      min: Math.max(1, Math.floor(value * 0.5)),
      max: Math.max(2, Math.ceil(value * 2)),
      step: Number.isInteger(value) ? 1 : 0.1,
    };
  }
  if (/Scale|Threshold|Range|LineHeight/.test(key)) {
    const max = Math.max(1, Math.ceil(value * 3 * 100) / 100);
    const minimum = /Scale|LineHeight/.test(key) ? Math.max(0.001, value * 0.25) : 0;
    return { min: minimum, max, step: 0.01 };
  }
  if (/Stroke|Width|Dash|Thickness/.test(key)) {
    return { min: 0.25, max: Math.max(8, Math.ceil(value * 4)), step: 0.25 };
  }
  if (/Font|Symbol|Radius/.test(key)) {
    return {
      min: Math.max(0.5, Math.floor(value * 0.4 * 2) / 2),
      max: Math.max(8, Math.ceil(value * 2)),
      step: 0.5,
    };
  }
  return {
    min: 0,
    max: Math.max(16, Math.ceil(value * 4)),
    step: Number.isInteger(value) ? 1 : 0.01,
  };
}

function publicMetadata({ renderer, key, fallback, palette, font, file, bounds }) {
  const rendererLabel = rendererLabels[renderer] ?? humanize(renderer);
  const role = humanize(key).toLowerCase();
  const metadata = {
    semanticId: semanticId(renderer, key, palette, font),
    label: `${rendererLabel} ${role}`,
    description: font
      ? `${rendererLabel} ${role} font family resolved for the complete renderer paint.`
      : palette
        ? `${rendererLabel} ${role} color resolved once for the complete renderer paint.`
        : `${rendererLabel} ${role} design metric shared by every dependent paint and geometry path.`,
    tier: palette ? "renderer-palette" : "renderer-metric",
    scope: "chart",
    effectiveAuthority: "daemon-style-profile",
    editTarget: `daemon style profile ${semanticId(renderer, key, palette, font)}; fallback webapp/frontend/src/lib/chart/${file}`,
    affectedSurfaces: [rendererLabel],
    inheritanceMode: "profile-overrides-css-fallback",
    handoffStatus: "editable",
    safetyNotes: [
      font
        ? `Use daemon-validated font assets and verify ${rendererLabel} glyph coverage.`
        : palette
          ? `Review ${rendererLabel} foreground/background contrast after changing this role.`
          : `Keep the recorded safe bounds and run the ${rendererLabel} renderer parity tests.`,
    ],
  };
  if (!palette && !font) metadata.bounds = bounds ?? numericBounds(renderer, key, fallback);
  return metadata;
}

function astrocartBounds(styleModule, key, fallback) {
  const inferred = numericBounds("astrocart", key, fallback);
  let field = key.startsWith("map")
    ? key.slice(3, 4).toLowerCase() + key.slice(4)
    : key.startsWith("chrome")
      ? key.slice(6, 7).toLowerCase() + key.slice(7)
      : key;
  if (field === "paranLineOpacity") field = "paranOpacity";

  let exact = styleModule.ASTROCART_RENDERER_NUMBER_BOUNDS?.[field]
    ?? styleModule.ASTROCART_CHROME_NUMBER_BOUNDS?.[field];
  if (!exact && field.endsWith("LineWidthScale")) {
    exact = styleModule.ASTROCART_POINT_LINE_WIDTH_SCALE_BOUNDS;
  }
  if (!exact && field.endsWith("LineOpacity")) {
    exact = styleModule.ASTROCART_POINT_LINE_OPACITY_BOUNDS;
  }
  if (!Array.isArray(exact) || exact.length !== 2) return inferred;
  return { ...inferred, min: Number(exact[0]), max: Number(exact[1]) };
}

function rendererBounds(styleModule, renderer, key, fallback) {
  if (renderer === "astrocart") return astrocartBounds(styleModule, key, fallback);
  if (renderer === "wheel" && styleModule.WHEEL_RENDER_TOKEN_RANGES instanceof Map) {
    const exact = styleModule.WHEEL_RENDER_TOKEN_RANGES.get(key);
    if (Array.isArray(exact) && exact.length === 2) {
      const minimum = Number(exact[0]);
      const maximum = Number(exact[1]);
      return {
        min: minimum,
        max: maximum,
        step: /Pattern$/.test(key) ? 1 : maximum - minimum <= 1 ? 0.001 : 0.01,
      };
    }
  }
  return undefined;
}

function formatCssValue(renderer, key, value, styleModule) {
  if (typeof value === "string") return value;
  return `${String(value)}${cssUnit(renderer, key, styleModule)}`;
}

/**
 * Transpile one module to a `data:` URL, recursively inlining its relative
 * imports.
 *
 * A `data:` URL has no base, so a relative specifier inside it cannot resolve —
 * `wheel-render-style.ts` importing `./wheel-layout-model` crashed this script
 * outright. Each dependency is therefore turned into its own `data:` URL and
 * substituted for the specifier before the importer is encoded. Resolving the
 * whole graph rather than one known filename keeps this working the next time a
 * style module grows an import.
 *
 * `seen` memoizes by resolved path so a diamond dependency is transpiled once
 * and both importers share the module instance, and so a cycle terminates.
 */
function moduleDataUrl(path, seen = new Map()) {
  const resolved = resolve(path);
  const cached = seen.get(resolved);
  if (cached) return cached;
  let javascript = ts.transpileModule(readNormalizedText(resolved), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  // Placeholder first, so a cycle resolves to this entry instead of recursing.
  seen.set(resolved, "");
  for (const specifier of relativeSpecifiers(javascript)) {
    const dependency = resolveRelativeModule(dirname(resolved), specifier);
    if (!dependency) continue;
    javascript = javascript.replaceAll(
      `"${specifier}"`,
      `"${moduleDataUrl(dependency, seen)}"`,
    );
    javascript = javascript.replaceAll(
      `'${specifier}'`,
      `'${moduleDataUrl(dependency, seen)}'`,
    );
  }
  const url = `data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`;
  seen.set(resolved, url);
  return url;
}

/** Every distinct relative specifier surviving transpilation, longest first. */
function relativeSpecifiers(javascript) {
  const found = new Set();
  for (const match of javascript.matchAll(/from\s*["'](\.[^"']*)["']/g)) {
    found.add(match[1]);
  }
  for (const match of javascript.matchAll(/import\s*\(\s*["'](\.[^"']*)["']\s*\)/g)) {
    found.add(match[1]);
  }
  // Longest first, so `./a-b` is never partially rewritten by `./a`.
  return [...found].sort((a, b) => b.length - a.length);
}

/** The TypeScript source behind an extensionless relative specifier. */
function resolveRelativeModule(fromDir, specifier) {
  const base = resolve(fromDir, specifier);
  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.mjs`,
    `${base}.js`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
  ]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return undefined;
}

async function loadStyleModule(path) {
  return import(moduleDataUrl(path));
}

const cssSource = readNormalizedText(cssPath);
const start = cssSource.indexOf(begin);
const finish = cssSource.indexOf(end);
if (start < 0 || finish < start) throw new Error("globals.css renderer token markers are missing");
const withoutGenerated = cssSource.slice(0, start) + cssSource.slice(finish + end.length);
const existingCssVars = new Set(
  [...withoutGenerated.matchAll(/^\s*(--[a-zA-Z_][a-zA-Z0-9_-]*)\s*:/gm)].map((match) => match[1]),
);

const declarations = [];
const publicTokens = {};
const rendererTokens = new Map();
const sourceFiles = readdirSync(chartRoot)
  .filter((name) => (
    name.endsWith("-render-style.ts") || name === "astrocart-style.ts"
  ))
  .sort();

for (const file of sourceFiles) {
  const styleModule = await loadStyleModule(join(chartRoot, file));
  for (const [exportName, specs] of Object.entries(styleModule)) {
    if (
      !exportName.endsWith("_RENDER_TOKEN_SPECS") &&
      !exportName.endsWith("_RENDER_PALETTE_SPECS") &&
      !exportName.endsWith("_RENDER_FONT_SPECS")
    ) continue;
    const palette = exportName.endsWith("_RENDER_PALETTE_SPECS");
    const font = exportName.endsWith("_RENDER_FONT_SPECS");
    for (const [key, spec] of Object.entries(specs)) {
      if (!Array.isArray(spec) || spec.length < 2 || typeof spec[0] !== "string") continue;
      const [cssVar, fallback] = spec;
      const match = /^--aries-([a-z0-9]+)-/.exec(cssVar);
      if (!match || existingCssVars.has(cssVar)) continue;
      const renderer = match[1];
      declarations.push({
        cssVar,
        value: formatCssValue(renderer, key, fallback, styleModule),
      });
      if (!rendererTokens.has(renderer)) rendererTokens.set(renderer, []);
      rendererTokens.get(renderer).push(cssVar);
      if (palette || font || isPublicMetric(renderer, key, styleModule)) {
        const bounds = !palette && !font
          ? rendererBounds(styleModule, renderer, key, fallback)
          : undefined;
        publicTokens[cssVar] = publicMetadata({ renderer, key, fallback, palette, font, file, bounds });
      }
    }
  }
}

declarations.sort((left, right) => left.cssVar.localeCompare(right.cssVar));
const cssBlock = `${begin}\n:root {\n${declarations.map(({ cssVar, value }) => `  ${cssVar}: ${value};`).join("\n")}\n}\n${end}`;
const renderedCss = cssSource.slice(0, start) + cssBlock + cssSource.slice(finish + end.length);

const families = [...rendererTokens.keys()].sort().map((renderer) => ({
  id: `renderer.${renderer}`,
  match: [`--aries-${renderer}-*`],
  defaults: {
    class: "runtime",
    role: "renderer-style",
    owner: `${renderer}-renderer`,
    provider: "css-declaration",
    scope: "renderer",
    type: "infer",
    unit: "infer",
  },
}));

const overrides = [...rendererTokens.entries()]
  .map(([renderer, names]) => ({
    match: names.filter((name) => publicTokens[name]).sort(),
    set: { class: "public", provider: "css-declaration" },
    renderer,
  }))
  .filter(({ match }) => match.length)
  .map(({ match, set }) => ({ match, set }));

const relationalConstraints = [];
const publicNames = new Set(Object.keys(publicTokens));
for (const [renderer, names] of rendererTokens) {
  for (const name of names) {
    if (!name.endsWith("-min") || !publicNames.has(name)) continue;
    const maximum = `${name.slice(0, -4)}-max`;
    if (!publicNames.has(maximum)) continue;
    relationalConstraints.push({
      id: `renderer.${renderer}.${name.slice(`--aries-${renderer}-`.length, -4)}.range`,
      kind: "ascending",
      tokens: [name, maximum],
      description: `${rendererLabels[renderer] ?? renderer} minimum does not exceed its maximum.`,
    });
  }
}
for (const [id, tokens] of [
  ["renderer.square.frame-outer-width.order", ["--aries-square-frame-outer-width-small", "--aries-square-frame-outer-width-medium", "--aries-square-frame-outer-width-large"]],
  ["renderer.square.frame-inner-width.order", ["--aries-square-frame-inner-width-small", "--aries-square-frame-inner-width-medium", "--aries-square-frame-inner-width-large"]],
  ["renderer.mundane.heavy-width.order", ["--aries-mundane-heavy-small", "--aries-mundane-heavy-medium", "--aries-mundane-heavy-large"]],
  ["renderer.wheel.degree-tick-stroke.order", ["--aries-wheel-degree-tick-stroke-small", "--aries-wheel-degree-tick-stroke-large"]],
  ["renderer.wheel.chart-ring-stroke.order", ["--aries-wheel-chart-ring-stroke-min", "--aries-wheel-chart-ring-stroke-fallback", "--aries-wheel-chart-ring-stroke-max"]],
  ["renderer.wheel.aspect-classic-thickness.order", ["--aries-wheel-aspect-classic-thickness-min", "--aries-wheel-aspect-classic-thickness-default", "--aries-wheel-aspect-classic-thickness-max"]],
  ["renderer.wheel.aspect-anglo-thickness.order", ["--aries-wheel-aspect-anglo-thickness-min", "--aries-wheel-aspect-anglo-thickness-default", "--aries-wheel-aspect-anglo-thickness-max"]],
]) {
  if (tokens.every((name) => publicNames.has(name))) {
    relationalConstraints.push({ id, kind: "ascending", tokens, description: "Responsive renderer strokes grow monotonically." });
  }
}

// Canonical normalized wheel inputs remain coherent before they reach the
// renderer. These are intentionally expressed through the profile service's
// existing ascending relation so browser and agent patches share one gate.
for (const [id, tokens] of [
  ["renderer.wheel.classic.outer-line.order", ["--aries-wheel-classic-outer-zodiac", "--aries-wheel-classic-outer-line", "--aries-wheel-classic-outer-projected-label"]],
  ["renderer.wheel.classic.projected-line.order", ["--aries-wheel-classic-outer-zodiac", "--aries-wheel-classic-outer-projected-line", "--aries-wheel-classic-outer-projected-label"]],
  ["renderer.wheel.classic.inner-label.order", ["--aries-wheel-classic-inner-base", "--aries-wheel-classic-inner-house-name", "--aries-wheel-classic-inner-position-houses", "--aries-wheel-classic-inner-position-angle", "--aries-wheel-classic-inner-aspect-angle", "--aries-wheel-classic-inner-position"]],
  ["renderer.wheel.compact.single-lanes.order", ["--aries-wheel-compact-single-position-lane-2", "--aries-wheel-compact-single-position-lane-1", "--aries-wheel-compact-single-position-lane-0"]],
  ["renderer.wheel.compact.comparison-lanes.order", ["--aries-wheel-compact-comparison-position-lane-2", "--aries-wheel-compact-comparison-position-lane-1", "--aries-wheel-compact-comparison-position-lane-0"]],
  ["renderer.wheel.compact.house-label.order", ["--aries-wheel-compact-base", "--aries-wheel-compact-house-name"]],
  ["renderer.wheel.anglo.radial-order", ["--aries-wheel-anglo-aspect-scale", "--aries-wheel-anglo-house-scale", "--aries-wheel-anglo-planet-scale", "--aries-wheel-anglo-inner-scale", "--aries-wheel-anglo-cusp-label-scale", "--aries-wheel-anglo-sign-inner-scale"]],
  ["renderer.wheel.anglo.angle-position.order", ["--aries-wheel-anglo-aspect-scale", "--aries-wheel-anglo-angle-position-scale", "--aries-wheel-anglo-planet-scale"]],
  ["renderer.wheel.biwheel.outer-order", ["--aries-wheel-biwheel-outer-minimum", "--aries-wheel-biwheel-projected-label", "--aries-wheel-biwheel-outer-max"]],
  ["renderer.wheel.biwheel.angle-order", ["--aries-wheel-biwheel-outer-angle", "--aries-wheel-biwheel-outer-max"]],
]) {
  if (tokens.every((name) => publicNames.has(name))) {
    relationalConstraints.push({
      id,
      kind: "ascending",
      tokens,
      description: "Canonical wheel radii remain ordered for paint, labels, and hit geometry.",
    });
  }
}

const extension = {
  schemaVersion: 1,
  generatedFrom: sourceFiles.map((file) => `src/lib/chart/${file}`),
  families,
  overrides,
  publicTokens: Object.fromEntries(Object.entries(publicTokens).sort(([left], [right]) => left.localeCompare(right))),
  relationalConstraints,
  contrastPairs: [],
  authoringExclusions: [],
};
const renderedContract = JSON.stringify(extension, null, 2) + "\n";

if (check) {
  const currentContract = readNormalizedText(contractPath);
  if (renderedCss !== cssSource || currentContract !== renderedContract) {
    console.error("renderer style contract drifted; run npm run renderer-style-contract");
    process.exit(1);
  }
  console.log(`Renderer style contract: PASS (${declarations.length} declarations, ${Object.keys(publicTokens).length} public roles)`);
} else {
  writeFileSync(cssPath, renderedCss, "utf8");
  writeFileSync(contractPath, renderedContract, "utf8");
  console.log(`Renderer style contract: wrote ${declarations.length} declarations and ${Object.keys(publicTokens).length} public roles`);
}
