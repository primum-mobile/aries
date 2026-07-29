// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import Color from "colorjs.io";

import {
  APP_MATERIAL_OVERRIDE_PREFIX,
  appMaterialOverrideId,
  compileFlatAppMaterialOverrides,
  type AppMaterialClass,
  type AppMaterialColor,
  type CompiledAppMaterials,
} from "@/lib/theme/app-material";

export const APP_MATERIAL_STYLE_ELEMENT_ID = "aries-app-material-theme";
export const APP_MATERIAL_PREVIEW_SCOPE_SELECTOR =
  '[data-aries-material-preview="app"]';

const REVIEWED_SCOPE_SELECTORS = new Set<string>([
  APP_MATERIAL_PREVIEW_SCOPE_SELECTOR,
]);

type SurfaceDefinition = Readonly<{
  classId: Exclude<AppMaterialClass, "materials.global">;
  surfaceId: string;
  backgroundToken: string;
  backgroundFallbackToken: string;
  foregroundToken: string;
  foregroundFallbackToken: string;
  additionalSelectors?: readonly string[];
}>;

const SURFACES: readonly SurfaceDefinition[] = [
  {
    classId: "surfaces.canvas",
    surfaceId: "canvas",
    backgroundToken: "--aries-background",
    backgroundFallbackToken: "--aries-background",
    foregroundToken: "--aries-text-primary",
    foregroundFallbackToken: "--aries-text-primary",
  },
  {
    classId: "sidebar",
    surfaceId: "sidebar",
    backgroundToken: "--aries-sidebar-background",
    backgroundFallbackToken: "--aries-surface",
    foregroundToken: "--aries-sidebar-text",
    foregroundFallbackToken: "--aries-text-primary",
  },
  {
    classId: "titlebar",
    surfaceId: "titlebar",
    backgroundToken: "--aries-titlebar-background",
    backgroundFallbackToken: "--aries-background",
    foregroundToken: "--aries-titlebar-text",
    foregroundFallbackToken: "--aries-text-primary",
  },
  {
    classId: "statusbar",
    surfaceId: "statusbar",
    backgroundToken: "--aries-statusbar-background",
    backgroundFallbackToken: "--aries-background",
    foregroundToken: "--aries-statusbar-text",
    foregroundFallbackToken: "--aries-text-muted",
  },
  {
    classId: "panel",
    surfaceId: "panel",
    backgroundToken: "--aries-panel-background",
    backgroundFallbackToken: "--aries-surface",
    foregroundToken: "--aries-panel-text",
    foregroundFallbackToken: "--aries-text-primary",
  },
  {
    classId: "inspector",
    surfaceId: "inspector",
    backgroundToken: "--aries-inspector-background",
    backgroundFallbackToken: "--aries-panel-background",
    foregroundToken: "--aries-inspector-text",
    foregroundFallbackToken: "--aries-panel-text",
  },
  {
    classId: "overlay",
    surfaceId: "overlay",
    backgroundToken: "--aries-overlay-background",
    backgroundFallbackToken: "--aries-surface",
    foregroundToken: "--aries-overlay-text",
    foregroundFallbackToken: "--aries-text-primary",
  },
  {
    classId: "popover",
    surfaceId: "popover",
    backgroundToken: "--aries-popover-background",
    backgroundFallbackToken: "--aries-background",
    foregroundToken: "--aries-popover-text",
    foregroundFallbackToken: "--aries-text-primary",
  },
  {
    classId: "control",
    surfaceId: "control",
    backgroundToken: "--aries-control-background",
    backgroundFallbackToken: "--aries-surface-subtle",
    foregroundToken: "--aries-control-text",
    foregroundFallbackToken: "--aries-text-primary",
  },
  {
    classId: "dataBody",
    surfaceId: "dataBody",
    backgroundToken: "--aries-data-body-background",
    backgroundFallbackToken: "--aries-background",
    foregroundToken: "--aries-data-body-text",
    foregroundFallbackToken: "--aries-text-primary",
    // Paint once on the row group, below the existing row hover/current fills.
    // Targeting both the group and its cells would stack translucent materials
    // and restart the texture in every cell.
    additionalSelectors: [
      ".aries-list > tbody",
      ".aries-table > tbody",
    ],
  },
  {
    classId: "dataHeader",
    surfaceId: "dataHeader",
    backgroundToken: "--aries-data-header-background",
    backgroundFallbackToken: "--aries-surface",
    foregroundToken: "--aries-data-header-text",
    foregroundFallbackToken: "--aries-text-primary",
    additionalSelectors: [
      ".aries-list > thead",
      ".aries-table > thead",
    ],
  },
];

export function resolveSimpleCssValue(
  initialValue: string | undefined,
  tokens: Readonly<Record<string, string>>,
): string | undefined {
  let value = initialValue?.trim();
  const seen = new Set<string>();
  for (let depth = 0; value && depth < 32; depth += 1) {
    const match = value.match(
      /^var\(\s*(--[-\w]+)\s*(?:,\s*([^()]+))?\)$/,
    );
    if (!match) return value;
    const referenced = match[1];
    const fallback = match[2]?.trim();
    if (!referenced || seen.has(referenced)) return fallback;
    seen.add(referenced);
    value = tokens[referenced]?.trim() || fallback;
  }
  return undefined;
}

function resolveToken(
  name: string,
  tokens: Readonly<Record<string, string>>,
): string | null {
  return resolveSimpleCssValue(tokens[name], tokens) ?? null;
}

function tokenColor(
  primaryName: string,
  fallbackName: string,
  tokens: Readonly<Record<string, string>>,
  ultimate: AppMaterialColor,
): AppMaterialColor {
  const candidates = [
    resolveToken(primaryName, tokens),
    resolveToken(fallbackName, tokens),
  ];
  for (const value of candidates) {
    if (!value) continue;
    try {
      const srgb = new Color(value)
        .to("srgb")
        .toGamut({ space: "srgb", method: "css" });
      const channels = srgb.coords.map((channel) =>
        Math.max(0, Math.min(255, Math.round(Number(channel ?? 0) * 255)))
      ) as [number, number, number];
      return srgb.alpha < 1
        ? [channels[0], channels[1], channels[2], srgb.alpha]
        : channels;
    } catch {
      // Try the next semantic fallback. Imported authoring values themselves
      // remain strictly validated by the material compiler.
    }
  }
  return ultimate;
}

function materialOnlyOverrides(
  flatOverrides: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(flatOverrides).filter(([semanticId]) =>
      semanticId.startsWith(APP_MATERIAL_OVERRIDE_PREFIX)
    ),
  );
}

/**
 * Add solid semantic-color fallbacks only when neither global nor surface
 * material authoring supplied that property. Explicit global authoring can
 * therefore inherit cleanly, while an untouched theme keeps each surface's
 * existing semantic color rather than falling back to compiler white.
 */
export function compileThemeAppMaterials(
  flatOverrides: Readonly<Record<string, unknown>>,
  appTokens: Readonly<Record<string, string>>,
): CompiledAppMaterials {
  const enriched = materialOnlyOverrides(flatOverrides);
  const globalBackground = appMaterialOverrideId(
    "materials.global",
    "backgroundColor",
  );
  const globalPattern = appMaterialOverrideId(
    "materials.global",
    "patternColor",
  );
  for (const surface of SURFACES) {
    const backgroundId = appMaterialOverrideId(
      surface.classId,
      "backgroundColor",
    );
    if (!(backgroundId in enriched) && !(globalBackground in enriched)) {
      enriched[backgroundId] = tokenColor(
        surface.backgroundToken,
        surface.backgroundFallbackToken,
        appTokens,
        [255, 255, 255],
      );
    }
    const patternId = appMaterialOverrideId(
      surface.classId,
      "patternColor",
    );
    if (!(patternId in enriched) && !(globalPattern in enriched)) {
      enriched[patternId] = tokenColor(
        surface.foregroundToken,
        surface.foregroundFallbackToken,
        appTokens,
        [0, 0, 0],
      );
    }
  }
  return compileFlatAppMaterialOverrides(enriched);
}

function scopedSelector(
  selector: string,
  scopeSelector?: string,
): string {
  if (!scopeSelector) return selector;
  return `${scopeSelector}${selector},${scopeSelector} ${selector}`;
}

function surfaceSelector(
  surface: SurfaceDefinition,
  scopeSelector?: string,
): string {
  return [
    `[data-aries-surface="${surface.surfaceId}"]`,
    ...(surface.additionalSelectors ?? []),
  ].map((selector) => scopedSelector(selector, scopeSelector)).join(",");
}

function styleRule(
  selector: string,
  material: CompiledAppMaterials["byClass"][AppMaterialClass],
  foregroundToken: string,
): string {
  return `${selector}{--aries-material-background:${material.backgroundColor};background-color:var(--aries-material-state-background,${material.backgroundColor});background-image:${material.backgroundImage};background-size:${material.backgroundSize};background-repeat:${material.backgroundRepeat};background-position:${material.backgroundPosition};background-blend-mode:${material.backgroundBlendMode};color:var(${foregroundToken});-webkit-backdrop-filter:${material.backdropFilter};backdrop-filter:${material.backdropFilter};box-shadow:${material.boxShadow}}`;
}

/**
 * Produce a closed stylesheet from compiler-owned values and selectors. The
 * optional scope is a developer-supplied constant used by the isolated Style
 * Lab preview; no profile field can provide a selector or CSS fragment.
 */
export function appMaterialStyleSheet(
  compiled: CompiledAppMaterials,
  scopeSelector?: string,
): string {
  if (
    scopeSelector != null
    && !REVIEWED_SCOPE_SELECTORS.has(scopeSelector)
  ) {
    throw new TypeError("unreviewed app material stylesheet scope");
  }
  const rules: string[] = [];
  const fallbackRules: string[] = [];
  for (const surface of SURFACES) {
    const selector = surfaceSelector(surface, scopeSelector);
    const material = compiled.byClass[surface.classId];
    rules.push(styleRule(selector, material, surface.foregroundToken));
    fallbackRules.push(
      `${selector}{--aries-material-background:${material.solidBackgroundColor};background-color:${material.solidBackgroundColor};background-image:none;-webkit-backdrop-filter:none;backdrop-filter:none;box-shadow:none}`,
    );
  }
  return [
    rules.join(""),
    `@media (prefers-reduced-transparency:reduce){${fallbackRules.join("")}}`,
    `@media (prefers-contrast:more){${fallbackRules.join("")}}`,
    `@media (forced-colors:active){${SURFACES.map((surface) => {
      const selector = surfaceSelector(surface, scopeSelector);
      return `${selector}{--aries-material-background:Canvas;background-color:Canvas;background-image:none;color:CanvasText;-webkit-backdrop-filter:none;backdrop-filter:none;box-shadow:none}`;
    }).join("")}}`,
  ].join("");
}

export function installAppMaterialStyleSheet(
  compiled: CompiledAppMaterials,
): void {
  let element = document.getElementById(
    APP_MATERIAL_STYLE_ELEMENT_ID,
  ) as HTMLStyleElement | null;
  if (!element) {
    element = document.createElement("style");
    element.id = APP_MATERIAL_STYLE_ELEMENT_ID;
    document.head.append(element);
  }
  const css = appMaterialStyleSheet(compiled);
  if (element.textContent !== css) element.textContent = css;
}
