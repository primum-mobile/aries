// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { Combobox } from "@base-ui/react/combobox";
import { NumberField } from "@base-ui/react/number-field";
import Color from "colorjs.io";
import {
  Check,
  ChevronDown,
  ChevronUp,
  ClipboardPaste,
  Cloud,
  CloudOff,
  Copy,
  CopyPlus,
  Download,
  LoaderCircle,
  MoveHorizontal,
  Redo2,
  RefreshCw,
  RotateCcw,
  Trash2,
  Upload,
  Undo2,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
} from "react";

import { useT, useTFallback, type TFunc } from "@/lib/i18n/i18n";
import { rootCssPixelOffset } from "@/lib/css-token-value";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { AppThemeControls } from "@/components/workshell/app-theme-controls";
import { StyleLabColorPicker } from "@/components/workshell/style-lab-color-picker";
import { applyThemePreset, type ThemeState } from "@/lib/daemon/client";
import { APP_MATERIAL_PATTERNS } from "@/lib/theme/app-material";
import {
  AUTHORING_NUMERIC_PROPERTIES,
  type AuthoringNumericPreset,
  type ChartStyleFontRef,
} from "@/lib/style-lab/authoring-schema";
import {
  WHEEL_SEMANTIC_CLASS_MANIFEST,
  isWheelSemanticClassId,
  type WheelSemanticVariant,
} from "@/lib/style-lab/semantic-class-manifest";
import {
  buildElementStylePastePatch,
  buildWheelVariantSyncPatch,
  copyElementStyle,
  isWheelAuthoringFlatProperty,
  type ElementStyleClipboard,
  type StyleTransferControl,
} from "@/lib/style-lab/style-transfer";
import {
  WHEEL_AUTHORING_OVERRIDE_PREFIX,
  wheelAuthoringOverrideId,
  type WheelAuthoringEditScope,
  type WheelAuthoringFlatProperty,
} from "@/lib/style-lab/wheel-authoring-adapter";

import {
  commitCurrentStyleLabDraft,
  createCurrentStyleLabDraft,
  createStyleLabDraftFromTheme,
  deleteStyleLabTheme,
  discardCurrentStyleLabDraft,
  fetchCurrentStyleLabDraft,
  fetchStyleLabDraftExport,
  fetchStyleLabThemeSources,
  importStyleLabTheme,
  patchCurrentStyleLabDraft,
  revertCurrentStyleLabDraft,
  saveCurrentStyleLabDraftAsTheme,
  StyleLabApiError,
  type StyleLabDraft,
  type StyleLabThemeSource,
  type StyleLabTokenValue,
} from "@/lib/style-lab/client";
import type {
  StyleSceneElement,
  StyleSceneTokenBinding,
} from "@/lib/style-lab/style-scene";
import {
  listStyleLabFonts,
  loadStoredStyleLabFonts,
  loadStyleLabFontFace,
  STYLE_FONT_ASSETS_READY_EVENT,
  type StyleLabFontAsset,
} from "@/lib/style-lab/fonts";
import { cn } from "@/lib/utils";
import {
  cloneChartStyleOverrides,
  equalChartStyleOverrides,
  useChartStyleEditorStore,
  type ChartStyleSemanticOverrides,
  type ChartStyleAuthoringEditScope,
  type ChartStyleTokenMetadata,
} from "@/stores/chart-style-editor-store";
import { useThemeStore } from "@/stores/theme-store";
import publicCatalogJson from "@/styles/style-token-public.generated.json";

const inspectorComboboxSideOffset = rootCssPixelOffset(
  "--aries-menu-popup-side-offset",
  4,
);

type PublicStyleToken = {
  semanticId: string;
  cssVar: string;
  label: string;
  description: string;
  type: "color" | "number" | "font-family";
  unit: string;
  default: string | number;
  bounds?: { min: number; max: number; step: number };
};

type PublicCatalog = {
  tokens: PublicStyleToken[];
};

type BoundControl = {
  binding: StyleSceneTokenBinding;
  token: ChartStyleTokenMetadata;
  section: "element" | "effects";
  authoringKind?:
    | "stroke-style"
    | "line-cap"
    | "line-join"
    | "fill-pattern"
    | "shadow-pattern"
    | "gradient-type"
    | "direction-source"
    | "texture-mask"
    | "font-ref";
};

const MAX_THEME_IMPORT_BYTES = 2 * 1024 * 1024;
const MAX_THEME_IMPORT_COUNT = 16;

function parseThemeExchangeFile(source: string): unknown[] {
  const trimmed = source.trim();
  if (!trimmed) throw new Error("empty theme file");
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    parsed = trimmed
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  }
  const profiles = Array.isArray(parsed) ? parsed : [parsed];
  if (
    !profiles.length
    || profiles.length > MAX_THEME_IMPORT_COUNT
    || profiles.some((profile) => profile == null || typeof profile !== "object" || Array.isArray(profile))
  ) {
    throw new Error("invalid theme exchange file");
  }
  return profiles;
}

type InspectorSection =
  | "geometry"
  | "typography"
  | "stroke"
  | "appearance"
  | "effects";

type InspectorControlGroup =
  | "default"
  | "fill"
  | "texture"
  | "mask"
  | "compositing"
  | "filters"
  | "shadow";

type InspectorChoice = Readonly<{
  id: string;
  label: string;
  fontFamily?: string;
  detail?: string;
  disabled?: boolean;
}>;

type FontChoice = InspectorChoice & Readonly<{
  cssFamily: string;
  source: "bundled" | "generic" | "local" | "packaged" | "current";
  localFont?: BrowserLocalFontData;
  asset?: StyleLabFontAsset;
}>;

type StyleSceneClassElement = StyleSceneElement & Readonly<{
  classId?: string;
}>;

type BrowserLocalFontData = {
  readonly family: string;
  readonly fullName: string;
  readonly postscriptName: string;
  readonly style: string;
};

type LocalFontWindow = Window & {
  queryLocalFonts?: () => Promise<readonly BrowserLocalFontData[]>;
};

const catalog = publicCatalogJson as PublicCatalog;
const SYNC_DEBOUNCE_MS = 180;
const POLL_INTERVAL_MS = 900;
const INSPECTOR_SECTION_ORDER: readonly InspectorSection[] = [
  "geometry",
  "typography",
  "stroke",
  "appearance",
  "effects",
];

const INSPECTOR_CONTROL_GROUP_ORDER: readonly InspectorControlGroup[] = [
  "default",
  "fill",
  "texture",
  "mask",
  "compositing",
  "filters",
  "shadow",
];

function cloneValue(value: StyleLabTokenValue): StyleLabTokenValue {
  return Array.isArray(value) ? [...value] : value;
}

function localFontLabel(font: BrowserLocalFontData, symbolRole: boolean): string {
  if (!symbolRole) return font.family.trim();
  return font.fullName.trim() || [font.family, font.style].filter(Boolean).join(" ").trim();
}

function sortedLocalFonts(
  fonts: readonly BrowserLocalFontData[],
  symbolRole: boolean,
): BrowserLocalFontData[] {
  const seen = new Set<string>();
  const result: BrowserLocalFontData[] = [];
  for (const font of fonts) {
    const label = localFontLabel(font, symbolRole);
    if (!font.family.trim() || !label) continue;
    const identity = symbolRole
      ? font.postscriptName.trim() || label
      : font.family.trim();
    const key = identity.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(font);
  }
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
  return result.sort((left, right) =>
    collator.compare(localFontLabel(left, symbolRole), localFontLabel(right, symbolRole))
  );
}

function unquoteFontFamily(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (typeof parsed === "string") return parsed;
  } catch {
    // CSS family lists and variables are not JSON strings.
  }
  const primary = trimmed.startsWith("var(") ? trimmed : (trimmed.split(",", 1)[0] ?? trimmed);
  return primary.trim().replace(/^['"]|['"]$/g, "");
}

function quoteFontFamily(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  if (/^(?:var\(|ui-|serif$|sans-serif$|monospace$|cursive$|fantasy$|system-ui$)/.test(trimmed)) {
    return trimmed;
  }
  return JSON.stringify(trimmed);
}

function styleClassId(element: StyleSceneElement): string {
  return (element as StyleSceneClassElement).classId?.trim() || element.id;
}

function isManifestPlaceholderElement(element: StyleSceneElement): boolean {
  return element.stateTags.includes("manifest-placeholder");
}

function isEditableManifestPlaceholder(element: StyleSceneElement): boolean {
  return isManifestPlaceholderElement(element)
    && element.stateTags.includes("manifest-editable");
}

function styleElementProfile(element: StyleSceneElement): "classic" | "compact" | "anglo" {
  const profile = element.stateTags
    .find((tag) => tag.startsWith("profile:"))
    ?.slice("profile:".length);
  return profile === "compact" || profile === "anglo" ? profile : "classic";
}

function styleElementEditScope(
  element: StyleSceneElement,
  editScope: ChartStyleAuthoringEditScope,
): WheelAuthoringEditScope {
  return editScope === "base" ? "base" : styleElementProfile(element);
}

function authoringNumberControl(
  element: StyleSceneElement,
  editScope: ChartStyleAuthoringEditScope,
  property: WheelAuthoringFlatProperty,
  bindingProperty: StyleSceneTokenBinding["property"],
  preset: AuthoringNumericPreset,
  value: number,
): BoundControl {
  const definition = AUTHORING_NUMERIC_PROPERTIES[preset];
  const semanticId = wheelAuthoringOverrideId(
    styleElementEditScope(element, editScope),
    styleClassId(element),
    property,
  );
  return {
    binding: {
      semanticId,
      cssVar: "",
      property: bindingProperty,
      value,
    },
    token: {
      semanticId,
      cssVar: "",
      label: property,
      description: property,
      type: "number",
      unit: definition.editorUnit === "px" ? "chart-px" : definition.editorUnit,
      defaultValue: value,
      bounds: {
        min: definition.hardBounds.min,
        max: definition.hardBounds.max,
        step: definition.step,
      },
    },
    section: "element",
  };
}

function authoringColorControl(
  element: StyleSceneElement,
  editScope: ChartStyleAuthoringEditScope,
  property:
    | "color"
    | "backgroundColor"
    | "patternColor"
    | "gradientStartColor"
    | "gradientEndColor"
    | "shadowColor",
  value: string,
): BoundControl {
  const semanticId = wheelAuthoringOverrideId(
    styleElementEditScope(element, editScope),
    styleClassId(element),
    property,
  );
  return {
    binding: {
      semanticId,
      cssVar: "",
      property: "color",
      value,
    },
    token: {
      semanticId,
      cssVar: "",
      label: property,
      description: property,
      type: "color",
      unit: "",
      defaultValue: value,
      supportsAlpha: true,
    },
    section: "element",
  };
}

function authoringFontControl(
  element: StyleSceneElement,
  editScope: ChartStyleAuthoringEditScope,
  fontRef: ChartStyleFontRef,
): BoundControl {
  const semanticId = wheelAuthoringOverrideId(
    styleElementEditScope(element, editScope),
    styleClassId(element),
    "fontRef",
  );
  return {
    binding: {
      semanticId,
      cssVar: "",
      property: "font-family",
    },
    token: {
      semanticId,
      cssVar: "",
      label: "fontRef",
      description: "fontRef",
      type: "font-family",
      unit: "",
      defaultValue: fontRef,
    },
    section: "element",
    authoringKind: "font-ref",
  };
}

function authoringSelectControl(
  element: StyleSceneElement,
  editScope: ChartStyleAuthoringEditScope,
  property:
    | "gradientType"
    | "gradientDirection"
    | "textureMask"
    | "maskDirection"
    | "lineCap"
    | "lineJoin",
  value: string,
  authoringKind: NonNullable<BoundControl["authoringKind"]>,
): BoundControl {
  const semanticId = wheelAuthoringOverrideId(
    styleElementEditScope(element, editScope),
    styleClassId(element),
    property,
  );
  return {
    binding: {
      semanticId,
      cssVar: "",
      property: "effect",
      value,
    },
    token: {
      semanticId,
      cssVar: "",
      label: property,
      description: property,
      type: "font-family",
      unit: "",
      defaultValue: value,
    },
    section: "element",
    authoringKind,
  };
}

function colorFromValue(value: StyleLabTokenValue | string | number): Color | null {
  try {
    if (Array.isArray(value)) {
      return new Color(
        "srgb",
        [Number(value[0]) / 255, Number(value[1]) / 255, Number(value[2]) / 255],
        value.length > 3 ? Number(value[3]) : 1,
      );
    }
    return new Color(String(value));
  } catch {
    return null;
  }
}

function colorArray(value: StyleLabTokenValue | string | number): number[] | null {
  const parsed = colorFromValue(value);
  if (!parsed) return null;
  const srgb = parsed.to("srgb").toGamut();
  const rgb = srgb.coords.map((channel) =>
    Math.max(0, Math.min(255, Math.round(Number(channel ?? 0) * 255))),
  );
  return srgb.alpha < 1 ? [...rgb, srgb.alpha] : rgb;
}

function colorHex(value: StyleLabTokenValue | string | number): string {
  const parsed = colorFromValue(value);
  if (!parsed) return "#808080";
  const srgb = parsed.to("srgb").toGamut();
  return `#${srgb.coords
    .map((channel) =>
      Math.max(0, Math.min(255, Math.round(Number(channel ?? 0) * 255)))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

function colorAlpha(value: StyleLabTokenValue | string | number): number {
  return colorFromValue(value)?.alpha ?? 1;
}

function withColorAlpha(
  value: StyleLabTokenValue | string | number,
  alpha: number,
): number[] | null {
  const rgb = colorArray(value);
  if (!rgb) return null;
  return [...rgb.slice(0, 3), Math.max(0, Math.min(1, alpha))];
}

function catalogDefault(token: PublicStyleToken): StyleLabTokenValue {
  if (token.type === "number") {
    const number = typeof token.default === "number"
      ? token.default
      : Number.parseFloat(token.default);
    return Number.isFinite(number) ? number : (token.bounds?.min ?? 0);
  }
  if (token.type === "color") {
    return colorArray(token.default) ?? [128, 128, 128];
  }
  return String(token.default);
}

const TOKEN_METADATA: readonly ChartStyleTokenMetadata[] = catalog.tokens.map((token) => ({
  semanticId: token.semanticId,
  cssVar: token.cssVar,
  label: token.label,
  description: token.description,
  type: token.type,
  unit: token.unit,
  defaultValue: catalogDefault(token),
  bounds: token.bounds,
  // Every editable chart colour can be serialized as RGBA. Opacity is a
  // standard colour property in the element inspector, not a token-specific
  // capability inferred from the factory default's notation.
  supportsAlpha: token.type === "color",
}));

function syncDelta(
  previous: Readonly<ChartStyleSemanticOverrides>,
  next: Readonly<ChartStyleSemanticOverrides>,
): Record<string, StyleLabTokenValue | null> {
  const result: Record<string, StyleLabTokenValue | null> = {};
  for (const semanticId of new Set([...Object.keys(previous), ...Object.keys(next)])) {
    if (JSON.stringify(previous[semanticId]) === JSON.stringify(next[semanticId])) continue;
    result[semanticId] = next[semanticId] == null ? null : cloneValue(next[semanticId]);
  }
  return result;
}

function persistedStyleOverrides(
  overrides: Readonly<ChartStyleSemanticOverrides>,
): ChartStyleSemanticOverrides {
  return cloneChartStyleOverrides(overrides);
}

function isLayerEffect(token: ChartStyleTokenMetadata): boolean {
  return token.cssVar.includes("-effect-") ||
    /^renderer\.wheel\.metric\.(?:geometry|dynamic|outerLabel)(?:Opacity|Blur|Brightness|Contrast|Saturate|Hue|Grayscale|Invert|Sepia|Shadow)/.test(token.semanticId);
}

const MATERIAL_PROPERTY_ORDER = [
  "backgroundColor",
  "gradientType",
  "gradientDirection",
  "gradientStartColor",
  "gradientEndColor",
  "gradientAngle",
  "fillPattern",
  "patternColor",
  "cellSize",
  "dotSize",
  "density",
  "angle",
  "seed",
  "textureMask",
  "maskDirection",
  "maskAmount",
  "maskAngle",
  "shadowPattern",
  "shadowColor",
  "shadowX",
  "shadowY",
  "shadowBlur",
  "opacity",
] as const;

function propertyOrder(element: StyleSceneElement, control: BoundControl): number {
  const { property } = control.binding;
  const id = control.token.semanticId.toLowerCase();
  if (control.section === "effects") {
    if (/\.\w+opacity$/.test(id) && !/(grayscale|invert|sepia)opacity$/.test(id)) return 200;
    if (/blur$/.test(id) && !/shadowblur$/.test(id)) return 210;
    if (/brightnessscale$/.test(id)) return 220;
    if (/contrastscale$/.test(id)) return 230;
    if (/saturatescale$/.test(id)) return 240;
    if (/huerotate$/.test(id)) return 250;
    if (/grayscaleopacity$/.test(id)) return 260;
    if (/invertopacity$/.test(id)) return 270;
    if (/sepiaopacity$/.test(id)) return 280;
    if (/shadowcolor$/.test(id)) return 290;
    if (/shadowoffsetx$/.test(id)) return 300;
    if (/shadowoffsety$/.test(id)) return 310;
    if (/shadowblur$/.test(id)) return 320;
    return 330;
  }
  if (element.primitive === "surface") {
    const materialProperty = control.token.semanticId.slice(
      control.token.semanticId.lastIndexOf(".") + 1,
    );
    const materialIndex = MATERIAL_PROPERTY_ORDER.indexOf(
      materialProperty as (typeof MATERIAL_PROPERTY_ORDER)[number],
    );
    if (materialIndex >= 0) return 100 + materialIndex * 10;
  }
  const sectionOffset = 0;
  const strokedPrimitive = element.primitive === "line" || element.primitive === "circle";
  if (element.primitive === "text") {
    if (property === "font-size") return sectionOffset;
    if (property === "font-weight") return sectionOffset + 10;
    if (property === "font-family") return sectionOffset + 20;
    if (property === "color") return sectionOffset + 30;
    if (id.includes("opacity")) return sectionOffset + 40;
  }
  if (strokedPrimitive && property === "stroke-width") return sectionOffset;
  if (property === "radius") return sectionOffset + 10;
  if (property === "offset") return sectionOffset + 20;
  if (property === "spacing") return sectionOffset + 30;
  if (property === "stroke-width") return sectionOffset + 40;
  if (property === "stroke-dash") return sectionOffset + 50;
  if (control.authoringKind === "line-cap") return sectionOffset + 60;
  if (control.authoringKind === "line-join") return sectionOffset + 70;
  if (property === "font-family") return sectionOffset + 55;
  if (property === "font-size") return sectionOffset + 60;
  if (property === "font-weight") return sectionOffset + 70;
  if (property === "color") return sectionOffset + 80;
  if (id.includes("opacity")) return sectionOffset + 90;
  return sectionOffset + 100;
}

function layerEffectKey(element: StyleSceneElement): string | null {
  const classId = styleClassId(element);
  if (classId === "layers.geometry") return "geometry";
  if (classId === "layers.dynamic") return "dynamic";
  if (classId === "layers.outerLabel") return "outerLabel";
  return null;
}

function controlsForElement(
  element: StyleSceneElement | null,
  metadata: Readonly<Record<string, ChartStyleTokenMetadata>>,
  editScope: ChartStyleAuthoringEditScope,
): BoundControl[] {
  if (!element) return [];
  const seen = new Set<string>();
  const controls: BoundControl[] = [];
  const authoring = element.authoringDefaults;
  if (authoring?.radiusPx != null) {
    controls.push(authoringNumberControl(element, editScope, "radius", "radius", "radius", authoring.radiusPx));
  }
  if (authoring?.fontRef != null) {
    controls.push(authoringFontControl(element, editScope, authoring.fontRef));
  }
  if (authoring?.fontSizePx != null) {
    controls.push(authoringNumberControl(element, editScope, "fontSize", "font-size", "glyphSize", authoring.fontSizePx));
  }
  if (authoring?.trackingPx != null) {
    controls.push(authoringNumberControl(
      element,
      editScope,
      "tracking",
      "spacing",
      "tracking",
      authoring.trackingPx,
    ));
  }
  if (authoring?.color != null) {
    controls.push(authoringColorControl(
      element,
      editScope,
      "color",
      authoring.color,
    ));
  }
  if (authoring?.strokeWidthPx != null) {
    controls.push(authoringNumberControl(
      element,
      editScope,
      "strokeWidth",
      "stroke-width",
      "strokeWidth",
      authoring.strokeWidthPx,
    ));
  }
  if (authoring?.strokeStyle != null) {
    const semanticId = wheelAuthoringOverrideId(
      styleElementEditScope(element, editScope),
      styleClassId(element),
      "strokeStyle",
    );
    controls.push({
      binding: {
        semanticId,
        cssVar: "",
        property: "stroke-dash",
        value: authoring.strokeStyle,
      },
      token: {
        semanticId,
        cssVar: "",
        label: "strokeStyle",
        description: "strokeStyle",
        type: "font-family",
        unit: "",
        defaultValue: authoring.strokeStyle,
      },
      section: "element",
      authoringKind: "stroke-style",
    });
  }
  if (authoring?.lineCap != null) {
    controls.push(authoringSelectControl(
      element,
      editScope,
      "lineCap",
      authoring.lineCap,
      "line-cap",
    ));
  }
  if (authoring?.lineJoin != null) {
    controls.push(authoringSelectControl(
      element,
      editScope,
      "lineJoin",
      authoring.lineJoin,
      "line-join",
    ));
  }
  if (authoring?.fillPattern != null) {
    const semanticId = wheelAuthoringOverrideId(
      styleElementEditScope(element, editScope),
      styleClassId(element),
      "fillPattern",
    );
    controls.push({
      binding: {
        semanticId,
        cssVar: "",
        property: "effect",
        value: authoring.fillPattern,
      },
      token: {
        semanticId,
        cssVar: "",
        label: "fillPattern",
        description: "fillPattern",
        type: "font-family",
        unit: "",
        defaultValue: authoring.fillPattern,
      },
      section: "element",
      authoringKind: "fill-pattern",
    });
  }
  if (authoring?.shadowPattern != null) {
    const semanticId = wheelAuthoringOverrideId(
      styleElementEditScope(element, editScope),
      styleClassId(element),
      "shadowPattern",
    );
    controls.push({
      binding: {
        semanticId,
        cssVar: "",
        property: "effect",
        value: authoring.shadowPattern,
      },
      token: {
        semanticId,
        cssVar: "",
        label: "shadowPattern",
        description: "shadowPattern",
        type: "font-family",
        unit: "",
        defaultValue: authoring.shadowPattern,
      },
      section: "element",
      authoringKind: "shadow-pattern",
    });
  }
  if (authoring?.cellSizePx != null) {
    controls.push(authoringNumberControl(
      element,
      editScope,
      "cellSize",
      "spacing",
      "patternCell",
      authoring.cellSizePx,
    ));
  }
  if (authoring?.dotSizePx != null) {
    controls.push(authoringNumberControl(
      element,
      editScope,
      "dotSize",
      "spacing",
      "patternDot",
      authoring.dotSizePx,
    ));
  }
  if (authoring?.densityPercent != null) {
    controls.push(authoringNumberControl(
      element,
      editScope,
      "density",
      "opacity",
      "patternDensity",
      authoring.densityPercent,
    ));
  }
  if (authoring?.angleDegrees != null) {
    controls.push(authoringNumberControl(
      element,
      editScope,
      "angle",
      "effect",
      "patternAngle",
      authoring.angleDegrees,
    ));
  }
  if (authoring?.seed != null) {
    controls.push(authoringNumberControl(
      element,
      editScope,
      "seed",
      "effect",
      "patternSeed",
      authoring.seed,
    ));
  }
  if (authoring?.backgroundColor != null) {
    controls.push(authoringColorControl(
      element,
      editScope,
      "backgroundColor",
      authoring.backgroundColor,
    ));
  }
  if (authoring?.patternColor != null) {
    controls.push(authoringColorControl(
      element,
      editScope,
      "patternColor",
      authoring.patternColor,
    ));
  }
  if (authoring?.gradientType != null) {
    controls.push(authoringSelectControl(
      element,
      editScope,
      "gradientType",
      authoring.gradientType,
      "gradient-type",
    ));
  }
  if (authoring?.gradientDirection != null) {
    controls.push(authoringSelectControl(
      element,
      editScope,
      "gradientDirection",
      authoring.gradientDirection,
      "direction-source",
    ));
  }
  if (authoring?.gradientStartColor != null) {
    controls.push(authoringColorControl(
      element,
      editScope,
      "gradientStartColor",
      authoring.gradientStartColor,
    ));
  }
  if (authoring?.gradientEndColor != null) {
    controls.push(authoringColorControl(
      element,
      editScope,
      "gradientEndColor",
      authoring.gradientEndColor,
    ));
  }
  if (authoring?.gradientAngleDegrees != null) {
    controls.push(authoringNumberControl(
      element,
      editScope,
      "gradientAngle",
      "effect",
      "patternAngle",
      authoring.gradientAngleDegrees,
    ));
  }
  if (authoring?.textureMask != null) {
    controls.push(authoringSelectControl(
      element,
      editScope,
      "textureMask",
      authoring.textureMask,
      "texture-mask",
    ));
  }
  if (authoring?.maskDirection != null) {
    controls.push(authoringSelectControl(
      element,
      editScope,
      "maskDirection",
      authoring.maskDirection,
      "direction-source",
    ));
  }
  if (authoring?.maskAngleDegrees != null) {
    controls.push(authoringNumberControl(
      element,
      editScope,
      "maskAngle",
      "effect",
      "patternAngle",
      authoring.maskAngleDegrees,
    ));
  }
  if (authoring?.maskAmountPercent != null) {
    controls.push(authoringNumberControl(
      element,
      editScope,
      "maskAmount",
      "effect",
      "patternDensity",
      authoring.maskAmountPercent,
    ));
  }
  if (authoring?.shadowColor != null) {
    controls.push(authoringColorControl(
      element,
      editScope,
      "shadowColor",
      authoring.shadowColor,
    ));
  }
  if (authoring?.shadowXpx != null) {
    controls.push(authoringNumberControl(
      element,
      editScope,
      "shadowX",
      "offset",
      "shadowOffset",
      authoring.shadowXpx,
    ));
  }
  if (authoring?.shadowYpx != null) {
    controls.push(authoringNumberControl(
      element,
      editScope,
      "shadowY",
      "offset",
      "shadowOffset",
      authoring.shadowYpx,
    ));
  }
  if (authoring?.shadowBlurPx != null) {
    controls.push(authoringNumberControl(
      element,
      editScope,
      "shadowBlur",
      "effect",
      "blur",
      authoring.shadowBlurPx,
    ));
  }
  if (authoring?.dashOnPx != null || authoring?.strokeStyle != null) {
    controls.push(authoringNumberControl(
      element,
      editScope,
      "dashLength",
      "stroke-dash",
      "dashLength",
      authoring.dashOnPx ?? 4,
    ));
  }
  if (authoring?.dashOffPx != null || authoring?.strokeStyle != null) {
    controls.push(authoringNumberControl(
      element,
      editScope,
      "dashGap",
      "stroke-dash",
      "dashLength",
      authoring.dashOffPx ?? 4,
    ));
  }
  if (authoring?.opacityPercent != null) {
    controls.push(authoringNumberControl(
      element,
      editScope,
      "opacity",
      "opacity",
      "opacity",
      authoring.opacityPercent,
    ));
  }
  for (const binding of element.tokenBindings) {
    if (seen.has(binding.semanticId)) continue;
    const token = metadata[binding.semanticId];
    if (!token || isLayerEffect(token)) continue;
    // Ratios and multipliers are renderer implementation details. The profile-v2
    // authoring projection supplies the corresponding px-valued controls.
    if (binding.property === "stroke-width" && binding.semanticId.endsWith("WidthScale")) {
      continue;
    }
    if (
      binding.property === "font-size" &&
      !token.unit &&
      /(?:Scale|Ratio)$/.test(binding.semanticId)
    ) {
      continue;
    }
    if (
      authoring?.radiusPx != null && binding.property === "radius"
      || authoring?.strokeWidthPx != null && binding.property === "stroke-width"
      || authoring?.strokeStyle != null && binding.property === "stroke-dash"
      || authoring?.opacityPercent != null && binding.property === "opacity"
      || authoring?.fontSizePx != null && binding.property === "font-size"
    ) continue;
    seen.add(binding.semanticId);
    controls.push({ binding, token, section: "element" });
  }
  const effectKey = layerEffectKey(element);
  if (effectKey) {
    for (const token of Object.values(metadata)) {
      if (
        seen.has(token.semanticId) ||
        !isLayerEffect(token) ||
        !token.semanticId.startsWith(`renderer.wheel.`) ||
        !token.semanticId.includes(`.${effectKey}`)
      ) continue;
      seen.add(token.semanticId);
      controls.push({
        binding: {
          semanticId: token.semanticId,
          cssVar: token.cssVar,
          property: token.type === "color"
            ? "color"
            : token.semanticId.endsWith("Opacity")
              ? "opacity"
              : "effect",
        },
        token,
        section: "effects",
      });
    }
  }
  return controls.sort((left, right) =>
    propertyOrder(element, left) - propertyOrder(element, right),
  );
}

function IconButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="grid size-7 shrink-0 place-items-center rounded-[var(--aries-radius-control-compact)] text-[color:var(--aries-inspector-interactive-color)] hover:bg-[var(--aries-navbar-hover-bg)] hover:text-[color:var(--aries-inspector-title-color)] disabled:cursor-default disabled:opacity-30"
    >
      {children}
    </button>
  );
}

function currentValue(
  control: BoundControl,
  overrides: Readonly<ChartStyleSemanticOverrides>,
): StyleLabTokenValue {
  if (Object.hasOwn(overrides, control.token.semanticId)) {
    return overrides[control.token.semanticId];
  }
  if (control.binding.value != null) return control.binding.value;
  return control.token.defaultValue;
}

function controlLabel(
  control: BoundControl,
  t: TFunc,
  tf: (key: string, fallback: string) => string,
): string {
  const semanticId = control.token.semanticId;
  if (semanticId.endsWith(".fillPattern")) return t("styleLab.control.fillPattern");
  if (semanticId.endsWith(".shadowPattern")) return t("styleLab.control.shadowPattern");
  if (semanticId.endsWith(".backgroundColor")) return t("styleLab.control.fillBackgroundColor");
  if (semanticId.endsWith(".patternColor")) return t("styleLab.control.fillPatternColor");
  if (semanticId.endsWith(".gradientType")) return t("styleLab.control.gradientType");
  if (semanticId.endsWith(".gradientDirection")) return t("styleLab.control.gradientDirection");
  if (semanticId.endsWith(".gradientStartColor")) return t("styleLab.control.gradientStartColor");
  if (semanticId.endsWith(".gradientEndColor")) return t("styleLab.control.gradientEndColor");
  if (semanticId.endsWith(".gradientAngle")) return t("styleLab.control.gradientAngle");
  if (semanticId.endsWith(".textureMask")) return t("styleLab.control.textureMask");
  if (semanticId.endsWith(".maskDirection")) return t("styleLab.control.maskDirection");
  if (semanticId.endsWith(".maskAngle")) return t("styleLab.control.maskAngle");
  if (semanticId.endsWith(".maskAmount")) return t("styleLab.control.maskAmount");
  if (semanticId.endsWith(".shadowColor")) return t("styleLab.control.shadowColor");
  if (semanticId.endsWith(".shadowX")) return t("styleLab.control.shadowOffsetX");
  if (semanticId.endsWith(".shadowY")) return t("styleLab.control.shadowOffsetY");
  if (semanticId.endsWith(".shadowBlur")) return t("styleLab.control.shadowBlur");
  if (semanticId.endsWith(".cellSize")) return t("styleLab.control.patternCell");
  if (semanticId.endsWith(".dotSize")) return t("styleLab.control.patternDot");
  if (semanticId.endsWith(".density")) return t("styleLab.app.material.density");
  if (semanticId.endsWith(".angle")) return t("styleLab.app.material.angle");
  if (semanticId.endsWith(".seed")) return t("styleLab.app.material.seed");
  if (semanticId.endsWith("Pattern")) return t("styleLab.control.strokeStyle");
  if (semanticId.endsWith("DashOn")) return t("styleLab.control.dashLength");
  if (semanticId.endsWith("DashOff")) return t("styleLab.control.dashGap");
  if (semanticId.endsWith("ShadowColor")) return t("styleLab.control.shadowColor");
  if (semanticId.endsWith("ShadowOffsetX")) return t("styleLab.control.shadowOffsetX");
  if (semanticId.endsWith("ShadowOffsetY")) return t("styleLab.control.shadowOffsetY");
  if (semanticId.endsWith("ShadowBlur")) return t("styleLab.control.shadowBlur");
  if (semanticId.endsWith("Blur")) return t("styleLab.control.blur");
  if (semanticId.endsWith("BrightnessScale")) return t("styleLab.control.brightness");
  if (semanticId.endsWith("ContrastScale")) return t("styleLab.control.contrast");
  if (semanticId.endsWith("SaturateScale")) return t("styleLab.control.saturation");
  if (semanticId.endsWith("HueRotate")) return t("styleLab.control.hue");
  if (semanticId.endsWith("GrayscaleOpacity")) return t("styleLab.control.grayscale");
  if (semanticId.endsWith("InvertOpacity")) return t("styleLab.control.invert");
  if (semanticId.endsWith("SepiaOpacity")) return t("styleLab.control.sepia");
  if (control.binding.property === "stroke-width") return t("quickopt.lineThickness");
  if (control.binding.property === "radius") return t("styleLab.control.radius");
  if (control.binding.property === "offset") return t("styleLab.control.offset");
  if (control.binding.property === "spacing") return t("styleLab.control.spacing");
  if (control.binding.property === "font-family") return t("styleLab.control.fontFamily");
  if (control.binding.property === "font-size") return t("styleLab.control.size");
  if (control.binding.property === "font-weight") return t("styleLab.control.weight");
  if (control.binding.property === "color") return t("styleLab.control.color");
  if (control.token.semanticId.toLowerCase().includes("opacity")) {
    return t("styleLab.control.alpha");
  }
  return tf(`styleToken.${control.token.semanticId}.label`, control.token.label);
}

function patternControlFor(
  control: BoundControl,
  controls: readonly BoundControl[],
): BoundControl | null {
  if (
    control.token.semanticId.startsWith(WHEEL_AUTHORING_OVERRIDE_PREFIX)
    && (control.token.semanticId.endsWith(".dashLength")
      || control.token.semanticId.endsWith(".dashGap"))
  ) {
    const suffix = control.token.semanticId.endsWith(".dashLength")
      ? ".dashLength"
      : ".dashGap";
    const semanticId = `${control.token.semanticId.slice(0, -suffix.length)}.strokeStyle`;
    return controls.find((candidate) => candidate.token.semanticId === semanticId) ?? null;
  }
  const suffix = control.token.semanticId.endsWith("DashOn")
    ? "DashOn"
    : control.token.semanticId.endsWith("DashOff")
      ? "DashOff"
      : null;
  if (!suffix) return null;
  const semanticId = `${control.token.semanticId.slice(0, -suffix.length)}Pattern`;
  return controls.find((candidate) => candidate.token.semanticId === semanticId) ?? null;
}

function visibleControlsForElement(
  element: StyleSceneElement,
  controls: readonly BoundControl[],
  overrides: Readonly<ChartStyleSemanticOverrides>,
): BoundControl[] {
  return controls.filter((control) => {
    const patternControl = patternControlFor(control, controls);
    if (patternControl) {
      const patternValue = currentValue(patternControl, overrides);
      if (typeof patternValue === "string") {
        return control.token.semanticId.endsWith(".dashLength")
          ? patternValue === "dashed"
          : patternValue === "dashed" || patternValue === "dotted";
      }
      const pattern = Number(patternValue);
      return control.token.semanticId.endsWith("DashOn") ? pattern === 2 : pattern === 2 || pattern === 3;
    }

    if (element.primitive !== "surface") return true;
    const property = control.token.semanticId.slice(
      control.token.semanticId.lastIndexOf(".") + 1,
    );
    const valueFor = (suffix: string): StyleLabTokenValue | null => {
      const candidate = controls.find((item) =>
        item.token.semanticId.endsWith(`.${suffix}`)
      );
      return candidate ? currentValue(candidate, overrides) : null;
    };
    const fillPattern = String(valueFor("fillPattern") ?? "none");
    const shadowPattern = String(valueFor("shadowPattern") ?? "none");
    const gradientType = String(valueFor("gradientType") ?? "none");
    const gradientDirection = String(valueFor("gradientDirection") ?? "fixed");
    const textureMask = String(valueFor("textureMask") ?? "none");
    const hasDetailedTexture = (
      (fillPattern !== "none" && fillPattern !== "solid")
      || (shadowPattern !== "none" && shadowPattern !== "solid")
    );

    if (
      property === "gradientDirection"
      || property === "gradientStartColor"
      || property === "gradientEndColor"
    ) {
      return gradientType !== "none";
    }
    if (property === "gradientAngle") {
      return gradientType !== "none" && gradientDirection !== "sun";
    }
    if (property === "patternColor") return fillPattern !== "none";
    if (
      property === "cellSize"
      || property === "dotSize"
      || property === "density"
      || property === "seed"
    ) {
      return hasDetailedTexture;
    }
    if (property === "angle") {
      return (
        fillPattern === "hatch"
        || fillPattern === "crosshatch"
        || fillPattern === "scanline"
        || shadowPattern === "hatch"
        || shadowPattern === "crosshatch"
        || shadowPattern === "scanline"
      );
    }
    if (
      property === "maskDirection"
      || property === "maskAngle"
      || property === "maskAmount"
    ) {
      return textureMask !== "none";
    }
    if (
      property === "shadowColor"
      || property === "shadowX"
      || property === "shadowY"
      || property === "shadowBlur"
    ) {
      return shadowPattern !== "none";
    }
    return true;
  });
}

function inspectorControlGroupFor(
  element: StyleSceneElement,
  section: InspectorSection,
  control: BoundControl,
): InspectorControlGroup {
  const semanticId = control.token.semanticId;
  const property = semanticId.slice(semanticId.lastIndexOf(".") + 1);
  if (section === "effects") {
    if (/shadow(?:color|offsetx|offsety|blur)$/i.test(semanticId)) return "shadow";
    if (/opacity$/i.test(semanticId) && !/(grayscale|invert|sepia)opacity$/i.test(semanticId)) {
      return "compositing";
    }
    return "filters";
  }
  if (element.primitive !== "surface" || section !== "appearance") return "default";
  if (
    property === "backgroundColor"
    || property === "gradientType"
    || property === "gradientDirection"
    || property === "gradientStartColor"
    || property === "gradientEndColor"
    || property === "gradientAngle"
  ) {
    return "fill";
  }
  if (
    property === "fillPattern"
    || property === "patternColor"
    || property === "cellSize"
    || property === "dotSize"
    || property === "density"
    || property === "angle"
    || property === "seed"
  ) {
    return "texture";
  }
  if (
    property === "textureMask"
    || property === "maskDirection"
    || property === "maskAngle"
    || property === "maskAmount"
  ) {
    return "mask";
  }
  if (
    property === "shadowPattern"
    || property === "shadowColor"
    || property === "shadowX"
    || property === "shadowY"
    || property === "shadowBlur"
  ) {
    return "shadow";
  }
  if (property === "opacity") return "compositing";
  return "default";
}

function inspectorControlGroupLabel(
  group: InspectorControlGroup,
  t: TFunc,
): string {
  if (group === "fill") return t("styleLab.group.fill");
  if (group === "texture") return t("styleLab.group.texture");
  if (group === "mask") return t("styleLab.group.mask");
  if (group === "compositing") return t("styleLab.group.compositing");
  if (group === "filters") return t("styleLab.group.filters");
  if (group === "shadow") return t("styleLab.group.shadow");
  return "";
}

function controlWithSuffix(
  controls: readonly BoundControl[],
  suffix: string,
): BoundControl | null {
  return controls.find((control) =>
    control.token.semanticId.endsWith(`.${suffix}`)
    || control.token.semanticId.endsWith(suffix)
  ) ?? null;
}

function inspectorControlGroupSummary(
  group: InspectorControlGroup,
  controls: readonly BoundControl[],
  overrides: Readonly<ChartStyleSemanticOverrides>,
  t: TFunc,
): string | null {
  if (group === "texture" || group === "shadow") {
    const control = controlWithSuffix(
      controls,
      group === "texture" ? "fillPattern" : "shadowPattern",
    );
    if (!control) return null;
    const pattern = String(currentValue(control, overrides));
    return pattern === "none"
      ? t("styleLab.group.off")
      : t(`styleLab.app.pattern.${pattern}`);
  }
  if (group === "mask") {
    const control = controlWithSuffix(controls, "textureMask");
    if (!control) return null;
    return String(currentValue(control, overrides)) === "none"
      ? t("styleLab.group.off")
      : t("styleLab.control.maskCrescent");
  }
  return null;
}

function InspectorPropertyGroup({
  title,
  summary,
  defaultOpen,
  children,
}: {
  title: string;
  summary?: string | null;
  defaultOpen: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger
        className="group flex h-8 w-full items-center gap-1.5 border-t border-[color:var(--aries-inspector-divider-color)] px-[var(--aries-inspector-padding-x)] text-left first:border-t-0 hover:bg-[var(--aries-navbar-hover-bg)]"
      >
        <ChevronDown
          aria-hidden="true"
          size={12}
          className={cn(
            "shrink-0 text-[color:var(--aries-inspector-muted-color)] transition-transform",
            !open && "-rotate-90",
          )}
        />
        <span className="min-w-0 flex-1 truncate text-[length:var(--aries-font-size-micro)] font-medium text-[color:var(--aries-inspector-title-color)]">
          {title}
        </span>
        {summary ? (
          <span className="max-w-[45%] truncate text-[length:var(--aries-font-size-micro)] text-[color:var(--aries-inspector-muted-color)]">
            {summary}
          </span>
        ) : null}
      </CollapsibleTrigger>
      <CollapsibleContent>{children}</CollapsibleContent>
    </Collapsible>
  );
}

function inspectorSectionFor(
  element: StyleSceneElement,
  control: BoundControl,
): InspectorSection {
  if (control.section === "effects") return "effects";
  const { property } = control.binding;
  if (property === "radius" || property === "offset" || property === "spacing") {
    return "geometry";
  }
  if (
    property === "font-family" ||
    property === "font-size" ||
    property === "font-weight" ||
    (property === "color" && element.primitive === "text")
  ) {
    return "typography";
  }
  if (
    property === "stroke-width" ||
    property === "stroke-dash" ||
    (property === "color" && (element.primitive === "line" || element.primitive === "circle"))
  ) {
    return "stroke";
  }
  return "appearance";
}

function inspectorSectionLabel(section: InspectorSection, t: TFunc): string {
  if (section === "geometry") return t("styleLab.inspector.geometry");
  if (section === "typography") return t("styleLab.inspector.typography");
  if (section === "stroke") return t("styleLab.inspector.stroke");
  if (section === "effects") return t("styleLab.inspector.effects");
  return t("styleLab.inspector.appearance");
}

function PropertyReset({
  label,
  overridden,
  onReset,
}: {
  label: string;
  overridden: boolean;
  onReset: () => void;
}) {
  const t = useT();
  return (
    <button
      type="button"
      aria-label={t("appearance.resetToken", { label })}
      title={t("appearance.resetToken", { label })}
      disabled={!overridden}
      onClick={onReset}
      className="grid size-5 place-items-center rounded-[var(--aries-radius-control-compact)] text-[color:var(--aries-inspector-interactive-color)] opacity-0 transition-opacity hover:bg-[var(--aries-navbar-hover-bg)] focus-visible:opacity-100 group-hover:opacity-100 disabled:pointer-events-none disabled:opacity-0"
    >
      <RotateCcw size={11} />
    </button>
  );
}

function PropertyLabel({ label, overridden }: { label: string; overridden: boolean }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <span
        aria-hidden="true"
        className={cn(
          "size-1.5 shrink-0 rounded-full bg-[var(--aries-inspector-interactive-color)]",
          !overridden && "opacity-0",
        )}
      />
      <span className="truncate text-[length:var(--aries-font-size-small)] text-[color:var(--aries-inspector-label-color)]">
        {label}
      </span>
    </span>
  );
}

function PropertyRow({
  label,
  overridden,
  onReset,
  children,
  className,
}: {
  label: string;
  overridden: boolean;
  onReset: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "group grid min-h-8 grid-cols-[minmax(0,104px)_minmax(0,1fr)_20px] items-center gap-2 px-[var(--aries-inspector-padding-x)] hover:bg-[var(--aries-navbar-hover-bg)] focus-within:bg-[var(--aries-navbar-hover-bg)]",
        className,
      )}
    >
      <PropertyLabel label={label} overridden={overridden} />
      <div className="min-w-0">{children}</div>
      <PropertyReset label={label} overridden={overridden} onReset={onReset} />
    </div>
  );
}

function InspectorCombobox({
  value,
  options,
  label,
  placeholder,
  emptyLabel,
  loading = false,
  footer,
  onOpenChange,
  onValueChange,
}: {
  value: string | null;
  options: readonly InspectorChoice[];
  label: string;
  placeholder: string;
  emptyLabel: string;
  loading?: boolean;
  footer?: ReactNode;
  onOpenChange?: (open: boolean) => void;
  onValueChange: (value: string) => void;
}) {
  const selected = options.find((option) => option.id === value) ?? null;
  return (
    <Combobox.Root
      items={options}
      value={selected}
      itemToStringLabel={(option) => option.label}
      isItemEqualToValue={(option, selectedOption) => option.id === selectedOption.id}
      autoHighlight
      onOpenChange={(open) => onOpenChange?.(open)}
      onValueChange={(option) => {
        if (option) onValueChange(option.id);
      }}
    >
      <Combobox.InputGroup className="flex h-7 min-w-0 items-center rounded-[var(--aries-radius-control-compact)] border border-[color:var(--aries-inspector-divider-color)] bg-[var(--aries-inspector-background)] focus-within:border-[color:var(--aries-inspector-interactive-color)]">
        <Combobox.Input
          aria-label={label}
          placeholder={placeholder}
          className="h-full min-w-0 flex-1 bg-transparent px-2 text-[length:var(--aries-font-size-small)] text-[color:var(--aries-inspector-value-color)] outline-none"
          style={selected?.fontFamily ? { fontFamily: selected.fontFamily } : undefined}
        />
        {loading ? <LoaderCircle size={12} className="mr-1 animate-spin text-[color:var(--aries-inspector-muted-color)]" /> : null}
        <Combobox.Trigger
          aria-label={label}
          className="grid size-6 shrink-0 place-items-center text-[color:var(--aries-inspector-muted-color)] hover:text-[color:var(--aries-inspector-title-color)]"
        >
          <ChevronDown size={12} />
        </Combobox.Trigger>
      </Combobox.InputGroup>
      <Combobox.Portal>
        <Combobox.Positioner
          side="bottom"
          align="start"
          sideOffset={inspectorComboboxSideOffset}
          className="z-[120] w-[var(--anchor-width)]"
        >
          <Combobox.Popup
            data-aries-surface="popover"
            className="max-h-[min(18rem,var(--available-height))] min-w-[12rem] overflow-hidden rounded-[var(--aries-radius-popover)] border border-[color:var(--aries-inspector-divider-color)] bg-[var(--aries-inspector-background)] text-[color:var(--aries-inspector-value-color)] shadow-xl outline-none"
          >
            <Combobox.List className="max-h-64 overflow-y-auto p-1">
              {(option: InspectorChoice, index: number) => (
                <Combobox.Item
                  key={option.id}
                  value={option}
                  index={index}
                  disabled={option.disabled}
                  className={cn(
                    "flex cursor-default items-center gap-2 rounded-[var(--aries-radius-control-compact)] px-2 text-[length:var(--aries-font-size-small)] outline-none data-[highlighted]:bg-[var(--aries-navbar-hover-bg)] data-[selected]:text-[color:var(--aries-inspector-title-color)] data-[disabled]:opacity-55",
                    option.detail ? "min-h-10 py-1" : "h-7",
                  )}
                  style={option.fontFamily ? { fontFamily: option.fontFamily } : undefined}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{option.label}</span>
                    {option.detail ? (
                      <span className="block truncate text-[length:var(--aries-font-size-micro)] text-[color:var(--aries-inspector-muted-color)]">
                        {option.detail}
                      </span>
                    ) : null}
                  </span>
                  <Combobox.ItemIndicator className="text-[color:var(--aries-inspector-interactive-color)]">
                    <Check size={12} />
                  </Combobox.ItemIndicator>
                </Combobox.Item>
              )}
            </Combobox.List>
            <Combobox.Empty className="px-3 py-2 text-[length:var(--aries-font-size-small)] text-[color:var(--aries-inspector-muted-color)]">
              {emptyLabel}
            </Combobox.Empty>
            {footer ? (
              <div className="border-t border-[color:var(--aries-inspector-divider-color)] px-3 py-2 text-[length:var(--aries-font-size-micro)] text-[color:var(--aries-inspector-muted-color)]">
                {footer}
              </div>
            ) : null}
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  );
}

function PatternControl({
  control,
  value,
  overridden,
}: {
  control: BoundControl;
  value: StyleLabTokenValue;
  overridden: boolean;
}) {
  const t = useT();
  const tf = useTFallback();
  const beginGesture = useChartStyleEditorStore((state) => state.beginGesture);
  const setOverride = useChartStyleEditorStore((state) => state.setOverride);
  const endGesture = useChartStyleEditorStore((state) => state.endGesture);
  const cancelGesture = useChartStyleEditorStore((state) => state.cancelGesture);
  const resetProperty = useChartStyleEditorStore((state) => state.resetProperty);
  const label = controlLabel(control, t, tf);
  const pattern = Number.isFinite(Number(value)) ? Number(value) : 0;
  const options = [
    [0, t("styleLab.control.patternDefault")],
    [1, t("styleLab.control.patternSolid")],
    [2, t("styleLab.control.patternDashed")],
    [3, t("styleLab.control.patternDotted")],
  ] as const;

  return (
    <PropertyRow
      label={label}
      overridden={overridden}
      onReset={() => resetProperty(control.token.semanticId)}
    >
      <select
        data-aries-control-appearance="local"
        value={pattern}
        aria-label={label}
        className="h-7 w-full rounded-[var(--aries-radius-control-compact)] border border-[color:var(--aries-inspector-divider-color)] bg-[var(--aries-inspector-background)] px-2 text-[length:var(--aries-font-size-small)] text-[color:var(--aries-inspector-value-color)] outline-none focus:border-[color:var(--aries-inspector-interactive-color)]"
        onFocus={beginGesture}
        onChange={(event) => setOverride(control.token.semanticId, Number(event.currentTarget.value))}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          event.preventDefault();
          cancelGesture();
          event.currentTarget.blur();
        }}
        onBlur={endGesture}
      >
        {options.map(([option, optionLabel]) => (
          <option key={option} value={option}>{optionLabel}</option>
        ))}
      </select>
    </PropertyRow>
  );
}

function StrokeStyleControl({
  control,
  value,
  overridden,
}: {
  control: BoundControl;
  value: StyleLabTokenValue;
  overridden: boolean;
}) {
  const t = useT();
  const beginGesture = useChartStyleEditorStore((state) => state.beginGesture);
  const setOverride = useChartStyleEditorStore((state) => state.setOverride);
  const endGesture = useChartStyleEditorStore((state) => state.endGesture);
  const resetProperty = useChartStyleEditorStore((state) => state.resetProperty);
  const label = t("styleLab.control.strokeStyle");
  return (
    <PropertyRow
      label={label}
      overridden={overridden}
      onReset={() => resetProperty(control.token.semanticId)}
    >
      <select
        data-aries-control-appearance="local"
        value={String(value)}
        aria-label={label}
        className="h-7 w-full rounded-[var(--aries-radius-control-compact)] border border-[color:var(--aries-inspector-divider-color)] bg-[var(--aries-inspector-background)] px-2 text-[length:var(--aries-font-size-small)] text-[color:var(--aries-inspector-value-color)] outline-none focus:border-[color:var(--aries-inspector-interactive-color)]"
        onFocus={beginGesture}
        onChange={(event) => setOverride(control.token.semanticId, event.currentTarget.value)}
        onBlur={endGesture}
      >
        <option value="solid">{t("styleLab.control.patternSolid")}</option>
        <option value="dashed">{t("styleLab.control.patternDashed")}</option>
        <option value="dotted">{t("styleLab.control.patternDotted")}</option>
      </select>
    </PropertyRow>
  );
}

function LineEndpointControl({
  control,
  value,
  overridden,
}: {
  control: BoundControl;
  value: StyleLabTokenValue;
  overridden: boolean;
}) {
  const t = useT();
  const beginGesture = useChartStyleEditorStore((state) => state.beginGesture);
  const setOverride = useChartStyleEditorStore((state) => state.setOverride);
  const endGesture = useChartStyleEditorStore((state) => state.endGesture);
  const cancelGesture = useChartStyleEditorStore((state) => state.cancelGesture);
  const resetProperty = useChartStyleEditorStore((state) => state.resetProperty);
  const isCap = control.authoringKind === "line-cap";
  const label = isCap
    ? t("styleLab.control.lineCap")
    : t("styleLab.control.lineJoin");
  const options = isCap
    ? [
        ["butt", t("styleLab.control.lineCapButt")],
        ["round", t("styleLab.control.lineCapRound")],
        ["square", t("styleLab.control.lineCapSquare")],
      ]
    : [
        ["bevel", t("styleLab.control.lineJoinBevel")],
        ["round", t("styleLab.control.lineJoinRound")],
        ["miter", t("styleLab.control.lineJoinMiter")],
      ];
  return (
    <PropertyRow
      label={label}
      overridden={overridden}
      onReset={() => resetProperty(control.token.semanticId)}
    >
      <select
        data-aries-control-appearance="local"
        value={String(value)}
        aria-label={label}
        className="h-7 w-full rounded-[var(--aries-radius-control-compact)] border border-[color:var(--aries-inspector-divider-color)] bg-[var(--aries-inspector-background)] px-2 text-[length:var(--aries-font-size-small)] text-[color:var(--aries-inspector-value-color)] outline-none focus:border-[color:var(--aries-inspector-interactive-color)]"
        onFocus={beginGesture}
        onChange={(event) => setOverride(
          control.token.semanticId,
          event.currentTarget.value,
        )}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          event.preventDefault();
          cancelGesture();
          event.currentTarget.blur();
        }}
        onBlur={endGesture}
      >
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>{optionLabel}</option>
        ))}
      </select>
    </PropertyRow>
  );
}

function FillPatternControl({
  control,
  value,
  overridden,
  siblingControls,
  overrides,
}: {
  control: BoundControl;
  value: StyleLabTokenValue;
  overridden: boolean;
  siblingControls: readonly BoundControl[];
  overrides: Readonly<ChartStyleSemanticOverrides>;
}) {
  const t = useT();
  const beginGesture = useChartStyleEditorStore((state) => state.beginGesture);
  const setOverride = useChartStyleEditorStore((state) => state.setOverride);
  const endGesture = useChartStyleEditorStore((state) => state.endGesture);
  const resetProperty = useChartStyleEditorStore((state) => state.resetProperty);
  const label = control.authoringKind === "shadow-pattern"
    ? t("styleLab.control.shadowPattern")
    : t("styleLab.control.fillPattern");
  return (
    <PropertyRow
      label={label}
      overridden={overridden}
      onReset={() => resetProperty(control.token.semanticId)}
    >
      <select
        data-aries-control-appearance="local"
        value={String(value)}
        aria-label={label}
        className="h-7 w-full rounded-[var(--aries-radius-control-compact)] border border-[color:var(--aries-inspector-divider-color)] bg-[var(--aries-inspector-background)] px-2 text-[length:var(--aries-font-size-small)] text-[color:var(--aries-inspector-value-color)] outline-none focus:border-[color:var(--aries-inspector-interactive-color)]"
        onFocus={beginGesture}
        onChange={(event) => {
          const next = event.currentTarget.value;
          setOverride(control.token.semanticId, next);
          if (
            control.authoringKind !== "shadow-pattern"
            || String(value) !== "none"
            || next === "none"
          ) {
            return;
          }
          const shadowColor = controlWithSuffix(siblingControls, "shadowColor");
          const shadowX = controlWithSuffix(siblingControls, "shadowX");
          const shadowY = controlWithSuffix(siblingControls, "shadowY");
          const shadowBlur = controlWithSuffix(siblingControls, "shadowBlur");
          if (
            shadowColor
            && colorAlpha(currentValue(shadowColor, overrides)) <= 0
          ) {
            setOverride(shadowColor.token.semanticId, [0, 0, 0, 0.22]);
          }
          const x = shadowX ? Number(currentValue(shadowX, overrides)) : 0;
          const y = shadowY ? Number(currentValue(shadowY, overrides)) : 0;
          const blur = shadowBlur ? Number(currentValue(shadowBlur, overrides)) : 0;
          if (x === 0 && y === 0 && blur === 0) {
            if (shadowY) setOverride(shadowY.token.semanticId, 4);
            if (shadowBlur) setOverride(shadowBlur.token.semanticId, 8);
          }
        }}
        onBlur={endGesture}
      >
        {APP_MATERIAL_PATTERNS.map((pattern) => (
          <option key={pattern} value={pattern}>
            {t(`styleLab.app.pattern.${pattern}`)}
          </option>
        ))}
      </select>
    </PropertyRow>
  );
}

function MaterialModeControl({
  control,
  value,
  overridden,
}: {
  control: BoundControl;
  value: StyleLabTokenValue;
  overridden: boolean;
}) {
  const t = useT();
  const tf = useTFallback();
  const beginGesture = useChartStyleEditorStore((state) => state.beginGesture);
  const setOverride = useChartStyleEditorStore((state) => state.setOverride);
  const endGesture = useChartStyleEditorStore((state) => state.endGesture);
  const resetProperty = useChartStyleEditorStore((state) => state.resetProperty);
  const label = controlLabel(control, t, tf);
  const options =
    control.authoringKind === "gradient-type"
      ? [
          ["none", t("styleLab.control.gradientNone")],
          ["linear", t("styleLab.control.gradientLinear")],
          ["radial", t("styleLab.control.gradientRadial")],
        ]
      : control.authoringKind === "texture-mask"
        ? [
            ["none", t("styleLab.control.maskNone")],
            ["crescent", t("styleLab.control.maskCrescent")],
          ]
        : [
            ["fixed", t("styleLab.control.directionFixed")],
            ["sun", t("styleLab.control.directionSun")],
          ];
  return (
    <PropertyRow
      label={label}
      overridden={overridden}
      onReset={() => resetProperty(control.token.semanticId)}
    >
      <select
        data-aries-control-appearance="local"
        value={String(value)}
        aria-label={label}
        className="h-7 w-full rounded-[var(--aries-radius-control-compact)] border border-[color:var(--aries-inspector-divider-color)] bg-[var(--aries-inspector-background)] px-2 text-[length:var(--aries-font-size-small)] text-[color:var(--aries-inspector-value-color)] outline-none focus:border-[color:var(--aries-inspector-interactive-color)]"
        onFocus={beginGesture}
        onChange={(event) => setOverride(control.token.semanticId, event.currentTarget.value)}
        onBlur={endGesture}
      >
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>{optionLabel}</option>
        ))}
      </select>
    </PropertyRow>
  );
}

function fractionDigits(step: number): number {
  if (!Number.isFinite(step) || step >= 1) return 0;
  const text = step.toFixed(6).replace(/0+$/, "");
  return Math.min(6, text.includes(".") ? text.length - text.indexOf(".") - 1 : 0);
}

function NumberStepperButtons({
  label,
  step,
  unit,
}: {
  label: string;
  step: number;
  unit: string;
}) {
  const stepText = step.toFixed(fractionDigits(step));
  const suffix = unit ? ` ${unit}` : "";
  const incrementLabel = `${label} +${stepText}${suffix}`;
  const decrementLabel = `${label} −${stepText}${suffix}`;
  const buttonClassName =
    "grid min-h-0 flex-1 cursor-default place-items-center text-[color:var(--aries-inspector-muted-color)] hover:bg-[var(--aries-navbar-hover-bg)] hover:text-[color:var(--aries-inspector-title-color)] active:bg-[var(--aries-inspector-divider-color)] data-[disabled]:pointer-events-none data-[disabled]:opacity-30";

  return (
    <span className="flex h-full w-4 shrink-0 flex-col border-l border-[color:var(--aries-inspector-divider-color)]">
      <NumberField.Increment
        type="button"
        aria-label={incrementLabel}
        title={incrementLabel}
        className={cn(buttonClassName, "border-b border-[color:var(--aries-inspector-divider-color)]")}
      >
        <ChevronUp aria-hidden="true" size={8} strokeWidth={2.5} />
      </NumberField.Increment>
      <NumberField.Decrement
        type="button"
        aria-label={decrementLabel}
        title={decrementLabel}
        className={buttonClassName}
      >
        <ChevronDown aria-hidden="true" size={8} strokeWidth={2.5} />
      </NumberField.Decrement>
    </span>
  );
}

function numericPresentation(control: BoundControl): Readonly<{
  factor: number;
  unit: string;
}> {
  const semanticId = control.token.semanticId;
  const normalizedPercent = !control.token.unit && (
    control.binding.property === "opacity" ||
    /(?:Opacity|BrightnessScale|ContrastScale|SaturateScale)$/.test(semanticId)
  );
  if (normalizedPercent) return { factor: 100, unit: "%" };
  if (control.token.unit === "chart-px") return { factor: 1, unit: "px" };
  if (control.token.unit === "deg") return { factor: 1, unit: "°" };
  return { factor: 1, unit: control.token.unit };
}

function NumberControl({
  control,
  value,
  overridden,
}: {
  control: BoundControl;
  value: StyleLabTokenValue;
  overridden: boolean;
}) {
  const t = useT();
  const tf = useTFallback();
  const beginGesture = useChartStyleEditorStore((state) => state.beginGesture);
  const setOverride = useChartStyleEditorStore((state) => state.setOverride);
  const endGesture = useChartStyleEditorStore((state) => state.endGesture);
  const cancelGesture = useChartStyleEditorStore((state) => state.cancelGesture);
  const resetProperty = useChartStyleEditorStore((state) => state.resetProperty);
  const radiusControl = control.binding.property === "radius";
  const [radiusMode, setRadiusMode] = useState<"radius" | "diameter">("radius");
  const label = radiusControl ? t("styleLab.control.size") : controlLabel(control, t, tf);
  const bounds = control.token.bounds;
  const fallback = Number(control.token.defaultValue);
  const number = Number.isFinite(Number(value)) ? Number(value) : fallback;
  const presentation = numericPresentation(control);
  const radiusFactor = radiusControl && radiusMode === "diameter" ? 2 : 1;
  const displayFactor = presentation.factor * radiusFactor;
  const displayValue = number * displayFactor;
  const displayStep = (bounds?.step ?? 1) * displayFactor;
  const displaySmallStep = Math.max(displayStep / 10, 0.001);
  const min = bounds ? bounds.min * displayFactor : undefined;
  const max = bounds ? bounds.max * displayFactor : undefined;
  const precision = fractionDigits(displaySmallStep);
  const update = (next: number | null) => {
    if (next == null || !Number.isFinite(next)) return;
    beginGesture();
    setOverride(control.token.semanticId, next / displayFactor);
  };
  const derivedMode = radiusMode === "radius" ? "diameter" : "radius";
  const derivedValue = radiusMode === "radius" ? number * 2 : number;

  return (
    <NumberField.Root
      value={displayValue}
      min={min}
      max={max}
      step={displayStep}
      smallStep={displaySmallStep}
      largeStep={displayStep * 10}
      allowWheelScrub={false}
      format={{ maximumFractionDigits: precision }}
      onValueChange={update}
      onValueCommitted={() => endGesture()}
      className={cn(
        "group grid min-h-8 grid-cols-[minmax(0,104px)_minmax(0,1fr)_20px] items-center gap-x-2 px-[var(--aries-inspector-padding-x)] hover:bg-[var(--aries-navbar-hover-bg)] focus-within:bg-[var(--aries-navbar-hover-bg)]",
        radiusControl && "py-0.5",
      )}
    >
      <NumberField.ScrubArea
        pixelSensitivity={3}
        className="cursor-ew-resize select-none"
        title={t("styleLab.control.exactValue")}
      >
        <PropertyLabel label={label} overridden={overridden} />
        <NumberField.ScrubAreaCursor className="grid size-6 place-items-center rounded-full border border-[color:var(--aries-inspector-divider-color)] bg-[var(--aries-inspector-background)] text-[color:var(--aries-inspector-interactive-color)] shadow-lg">
          <MoveHorizontal size={13} />
        </NumberField.ScrubAreaCursor>
      </NumberField.ScrubArea>
      <div className={cn("flex min-w-0 items-center gap-1", radiusControl && "grid grid-cols-[4.75rem_minmax(0,1fr)]") }>
        {radiusControl ? (
          <select
            data-aries-control-appearance="local"
            value={radiusMode}
            aria-label={t("styleLab.control.size")}
            className="h-7 min-w-0 rounded-[var(--aries-radius-control-compact)] border border-[color:var(--aries-inspector-divider-color)] bg-[var(--aries-inspector-background)] px-1 text-[length:var(--aries-font-size-micro)] text-[color:var(--aries-inspector-value-color)] outline-none focus:border-[color:var(--aries-inspector-interactive-color)]"
            onChange={(event) => setRadiusMode(event.currentTarget.value as "radius" | "diameter")}
          >
            <option value="radius">{t("styleLab.control.radius")}</option>
            <option value="diameter">{t("styleLab.control.diameter")}</option>
          </select>
        ) : null}
        <NumberField.Group className="flex h-7 min-w-0 items-center overflow-hidden rounded-[var(--aries-radius-control-compact)] border border-[color:var(--aries-inspector-divider-color)] bg-[var(--aries-inspector-background)] focus-within:border-[color:var(--aries-inspector-interactive-color)]">
          <NumberField.Input
            aria-label={`${label}${presentation.unit ? ` (${presentation.unit})` : ""}`}
            className="h-full min-w-0 flex-1 bg-transparent px-2 text-right text-[length:var(--aries-font-size-small)] tabular-nums text-[color:var(--aries-inspector-value-color)] outline-none"
            onKeyDown={(event) => {
              if (event.key !== "Escape") return;
              event.preventDefault();
              const input = event.currentTarget;
              cancelGesture();
              window.requestAnimationFrame(() => input.blur());
            }}
          />
          {presentation.unit ? (
            <span className="shrink-0 pr-2 text-[length:var(--aries-font-size-micro)] text-[color:var(--aries-inspector-muted-color)]">
              {presentation.unit}
            </span>
          ) : null}
          <NumberStepperButtons
            label={label}
            step={displayStep}
            unit={presentation.unit}
          />
        </NumberField.Group>
      </div>
      <PropertyReset
        label={label}
        overridden={overridden}
        onReset={() => resetProperty(control.token.semanticId)}
      />
      {radiusControl ? (
        <div className="col-start-2 col-end-3 pb-1 text-right text-[length:var(--aries-font-size-micro)] text-[color:var(--aries-inspector-muted-color)]">
          {t(`styleLab.control.${derivedMode}`)}: {derivedValue.toFixed(precision)} {presentation.unit}
        </div>
      ) : null}
    </NumberField.Root>
  );
}

function ColorControl({
  control,
  value,
  overridden,
}: {
  control: BoundControl;
  value: StyleLabTokenValue;
  overridden: boolean;
}) {
  const t = useT();
  const tf = useTFallback();
  const beginGesture = useChartStyleEditorStore((state) => state.beginGesture);
  const setOverride = useChartStyleEditorStore((state) => state.setOverride);
  const endGesture = useChartStyleEditorStore((state) => state.endGesture);
  const cancelGesture = useChartStyleEditorStore((state) => state.cancelGesture);
  const resetProperty = useChartStyleEditorStore((state) => state.resetProperty);
  const label = controlLabel(control, t, tf);
  const hex = colorHex(value);
  const alpha = colorAlpha(value);
  const [typedColor, setTypedColor] = useState<string | null>(null);
  const changeColor = (next: string) => {
    const parsed = colorArray(next);
    if (!parsed) return;
    setOverride(
      control.token.semanticId,
      control.token.supportsAlpha ? [...parsed.slice(0, 3), alpha] : parsed.slice(0, 3),
    );
  };
  const changeAlpha = (next: number) => {
    const parsed = withColorAlpha(value, next);
    if (parsed) setOverride(control.token.semanticId, parsed);
  };
  const commitTypedColor = (next: string) => {
    if (colorFromValue(next)) changeColor(next);
  };

  return (
    <PropertyRow
      label={label}
      overridden={overridden}
      onReset={() => resetProperty(control.token.semanticId)}
    >
      <div className="flex min-w-0 items-center gap-1">
        <StyleLabColorPicker
          value={hex}
          label={t("styleLab.control.colorPicker")}
          onChange={changeColor}
          onGestureStart={beginGesture}
          onGestureEnd={endGesture}
        />
        <input
          data-aries-control-appearance="local"
          value={typedColor ?? hex.toUpperCase()}
          aria-label={t("styleLab.control.colorValue")}
          className="h-7 min-w-0 flex-1 rounded-[var(--aries-radius-control-compact)] border border-[color:var(--aries-inspector-divider-color)] bg-[var(--aries-inspector-background)] px-1.5 font-mono text-[length:var(--aries-font-size-micro)] outline-none focus:border-[color:var(--aries-inspector-interactive-color)]"
          onFocus={() => {
            beginGesture();
            setTypedColor(hex.toUpperCase());
          }}
          onChange={(event) => {
            const next = event.currentTarget.value;
            setTypedColor(next);
            if (colorFromValue(next)) changeColor(next);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
            if (event.key === "Escape") {
              setTypedColor(null);
              cancelGesture();
              event.preventDefault();
            }
          }}
          onBlur={(event) => {
            commitTypedColor(event.currentTarget.value);
            setTypedColor(null);
            endGesture();
          }}
        />
        {control.token.supportsAlpha ? (
          <NumberField.Root
            value={Math.round(alpha * 100)}
            min={0}
            max={100}
            step={1}
            smallStep={0.1}
            largeStep={10}
            format={{ maximumFractionDigits: 1 }}
            allowWheelScrub={false}
            onValueChange={(next) => {
              if (next == null || !Number.isFinite(next)) return;
              beginGesture();
              changeAlpha(next / 100);
            }}
            onValueCommitted={() => endGesture()}
          >
            <NumberField.Group className="flex h-7 w-[4.5rem] min-w-0 items-center overflow-hidden rounded-[var(--aries-radius-control-compact)] border border-[color:var(--aries-inspector-divider-color)] bg-[var(--aries-inspector-background)] focus-within:border-[color:var(--aries-inspector-interactive-color)]">
              <NumberField.Input
                aria-label={t("styleLab.control.alpha")}
                className="h-full min-w-0 flex-1 bg-transparent pl-1 text-right text-[length:var(--aries-font-size-micro)] tabular-nums outline-none"
                onKeyDown={(event) => {
                  if (event.key !== "Escape") return;
                  event.preventDefault();
                  const input = event.currentTarget;
                  cancelGesture();
                  window.requestAnimationFrame(() => input.blur());
                }}
              />
              <span className="pr-1 text-[length:var(--aries-font-size-micro)] text-[color:var(--aries-inspector-muted-color)]">%</span>
              <NumberStepperButtons
                label={t("styleLab.control.alpha")}
                step={1}
                unit="%"
              />
            </NumberField.Group>
          </NumberField.Root>
        ) : null}
      </div>
    </PropertyRow>
  );
}

function FontControl({
  control,
  value,
  overridden,
}: {
  control: BoundControl;
  value: StyleLabTokenValue;
  overridden: boolean;
}) {
  const t = useT();
  const tf = useTFallback();
  const beginGesture = useChartStyleEditorStore((state) => state.beginGesture);
  const setOverride = useChartStyleEditorStore((state) => state.setOverride);
  const endGesture = useChartStyleEditorStore((state) => state.endGesture);
  const resetProperty = useChartStyleEditorStore((state) => state.resetProperty);
  const label = controlLabel(control, t, tf);
  const loadedRef = useRef(false);
  const [loadingFonts, setLoadingFonts] = useState(false);
  const [localFontError, setLocalFontError] = useState(false);
  const [localFonts, setLocalFonts] = useState<BrowserLocalFontData[]>([]);
  const [packagedFonts, setPackagedFonts] = useState<StyleLabFontAsset[]>([]);
  const currentFontRef = (
    value != null
    && typeof value === "object"
    && !Array.isArray(value)
    && (value as ChartStyleFontRef).role != null
  )
    ? value as ChartStyleFontRef
    : null;
  const symbolRole = currentFontRef?.role === "symbols"
    || (
      currentFontRef == null
      && control.token.semanticId.toLowerCase().includes("symbol")
    );
  const currentCssFamily = currentFontRef?.cssFamily ?? String(value);

  const loadFonts = async () => {
    if (loadedRef.current || loadingFonts) return;
    setLoadingFonts(true);
    setLocalFontError(false);
    const fontWindow = window as LocalFontWindow;
    // The permission-gated call starts synchronously from the combobox-open
    // gesture. No separate "Installed fonts" button is needed.
    const localRequest = !symbolRole && typeof fontWindow.queryLocalFonts === "function"
      ? fontWindow.queryLocalFonts()
      : Promise.resolve<readonly BrowserLocalFontData[]>([]);
    const packagedRequest = listStyleLabFonts();
    const [localResult, packagedResult] = await Promise.allSettled([
      localRequest,
      packagedRequest,
    ]);
    if (localResult.status === "fulfilled") {
      setLocalFonts(sortedLocalFonts(localResult.value, false));
      loadedRef.current = true;
    } else {
      setLocalFontError(true);
    }
    if (packagedResult.status === "fulfilled") {
      setPackagedFonts(packagedResult.value);
    }
    setLoadingFonts(false);
  };

  const choices = useMemo<FontChoice[]>(() => {
    const result: FontChoice[] = symbolRole
      ? [{
          id: "bundled:aries-morinus",
          label: "AriesMorinus",
          cssFamily: quoteFontFamily("AriesMorinus"),
          fontFamily: "var(--aries-font-symbols)",
          source: "bundled",
        }]
      : [
          {
            id: "bundled:free-sans",
            label: "FreeSans",
            cssFamily: quoteFontFamily("FreeSans"),
            fontFamily: "FreeSans",
            source: "bundled",
          },
          { id: "generic:system-ui", label: "system-ui", cssFamily: "system-ui", fontFamily: "system-ui", source: "generic" },
          { id: "generic:sans-serif", label: "sans-serif", cssFamily: "sans-serif", fontFamily: "sans-serif", source: "generic" },
          { id: "generic:serif", label: "serif", cssFamily: "serif", fontFamily: "serif", source: "generic" },
          { id: "generic:monospace", label: "monospace", cssFamily: "monospace", fontFamily: "monospace", source: "generic" },
        ];
    for (const asset of packagedFonts) {
      if (asset.role && asset.role !== (symbolRole ? "symbols" : "text")) continue;
      result.push({
        id: `packaged:${asset.id}`,
        label: asset.family,
        cssFamily: quoteFontFamily(asset.cssFamily || asset.family),
        fontFamily: asset.cssFamily || asset.family,
        source: "packaged",
        asset,
      });
    }
    if (!symbolRole) {
      for (const font of localFonts) {
        result.push({
          id: `local:${font.postscriptName || font.family}`,
          label: font.family.trim(),
          cssFamily: quoteFontFamily(font.family),
          fontFamily: font.family,
          source: "local",
          localFont: font,
        });
      }
    }
    const normalizedCurrent = unquoteFontFamily(currentCssFamily).toLocaleLowerCase();
    if (!result.some((choice) =>
      unquoteFontFamily(choice.cssFamily).toLocaleLowerCase() === normalizedCurrent
    )) {
      result.unshift({
        id: "current",
        label: unquoteFontFamily(currentCssFamily),
        cssFamily: currentCssFamily,
        fontFamily: currentCssFamily,
        source: "current",
      });
    }
    const seen = new Set<string>();
    return result.filter((choice) => {
      const key = `${choice.source}:${choice.label}`.toLocaleLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [currentCssFamily, localFonts, packagedFonts, symbolRole]);

  const selectedChoice = choices.find((choice) =>
    unquoteFontFamily(choice.cssFamily).toLocaleLowerCase() ===
      unquoteFontFamily(currentCssFamily).toLocaleLowerCase()
  ) ?? choices[0] ?? null;

  const chooseFont = (choiceId: string) => {
    const choice = choices.find((candidate) => candidate.id === choiceId);
    if (!choice) return;
    const commit = (cssFamily: string) => {
      const nextValue: StyleLabTokenValue = control.authoringKind === "font-ref"
        ? {
            role: symbolRole ? "symbols" : "text",
            source: choice.asset
              ? "asset"
              : choice.localFont
                ? "local"
                : choice.source === "bundled"
                  ? "bundled"
                  : choice.source === "current" && currentFontRef
                    ? currentFontRef.source
                    : "generic",
            family: [
              choice.asset?.family
                ?? choice.localFont?.family
                ?? unquoteFontFamily(cssFamily),
            ],
            cssFamily,
            style:
              choice.localFont?.style
              ?? choice.asset?.subfamily
              ?? currentFontRef?.style
              ?? "normal",
            weight: currentFontRef?.weight ?? 400,
            ...(choice.localFont?.postscriptName
              ? { postscriptName: choice.localFont.postscriptName }
              : {}),
            ...(choice.asset ? { assetId: choice.asset.id } : {}),
            ...(choice.asset?.axes?.length
              ? {
                  variationAxes: Object.fromEntries(
                    choice.asset.axes.map((axis) => [axis.tag, axis.default]),
                  ),
                }
              : {}),
          }
        : cssFamily;
      beginGesture();
      setOverride(control.token.semanticId, nextValue);
      endGesture();
    };
    if (choice.asset) {
      setLoadingFonts(true);
      void loadStyleLabFontFace(choice.asset)
        .then((cssFamily) => {
          commit(cssFamily);
          document.dispatchEvent(new Event(STYLE_FONT_ASSETS_READY_EVENT));
        })
        .finally(() => setLoadingFonts(false));
      return;
    }
    if (choice.localFont?.postscriptName && typeof FontFace !== "undefined") {
      const face = new FontFace(
        choice.localFont.family,
        `local(${JSON.stringify(choice.localFont.postscriptName)})`,
      );
      void face.load().then((loaded) => document.fonts.add(loaded)).catch(() => undefined);
    }
    commit(choice.cssFamily);
  };

  return (
    <PropertyRow
      label={label}
      overridden={overridden}
      onReset={() => resetProperty(control.token.semanticId)}
    >
      <InspectorCombobox
        value={selectedChoice?.id ?? null}
        options={choices}
        label={t("styleLab.control.fontFamily")}
        placeholder={t("styleLab.control.fontFamily")}
        emptyLabel={t("picker.noSearchResults")}
        loading={loadingFonts}
        footer={localFontError ? t("styleLab.control.installedFontsFailed") : undefined}
        onOpenChange={(open) => {
          if (open) void loadFonts();
        }}
        onValueChange={chooseFont}
      />
    </PropertyRow>
  );
}

function PropertyControl({
  control,
  overrides,
  siblingControls,
}: {
  control: BoundControl;
  overrides: Readonly<ChartStyleSemanticOverrides>;
  siblingControls: readonly BoundControl[];
}) {
  const overridden = Object.hasOwn(overrides, control.token.semanticId);
  const value = currentValue(control, overrides);
  if (control.authoringKind === "stroke-style") {
    return <StrokeStyleControl control={control} value={value} overridden={overridden} />;
  }
  if (
    control.authoringKind === "line-cap"
    || control.authoringKind === "line-join"
  ) {
    return <LineEndpointControl control={control} value={value} overridden={overridden} />;
  }
  if (
    control.authoringKind === "fill-pattern"
    || control.authoringKind === "shadow-pattern"
  ) {
    return (
      <FillPatternControl
        control={control}
        value={value}
        overridden={overridden}
        siblingControls={siblingControls}
        overrides={overrides}
      />
    );
  }
  if (
    control.authoringKind === "gradient-type"
    || control.authoringKind === "direction-source"
    || control.authoringKind === "texture-mask"
  ) {
    return <MaterialModeControl control={control} value={value} overridden={overridden} />;
  }
  if (control.token.type === "color") {
    return <ColorControl control={control} value={value} overridden={overridden} />;
  }
  if (control.token.semanticId.endsWith("Pattern")) {
    return <PatternControl control={control} value={value} overridden={overridden} />;
  }
  if (control.token.type === "number") {
    return <NumberControl control={control} value={value} overridden={overridden} />;
  }
  return <FontControl control={control} value={value} overridden={overridden} />;
}

function DeleteThemeDialog({
  source,
  busy,
  onCancel,
  onConfirm,
}: {
  source: StyleLabThemeSource;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const t = useT();
  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="style-lab-delete-theme-title"
      aria-describedby="style-lab-delete-theme-description"
      className="fixed inset-0 z-50 flex items-center justify-center bg-[color:var(--aries-overlay-scrim)] px-[var(--aries-form-section-gap)]"
    >
      <div
        data-aries-surface="overlay"
        className="w-full max-w-[var(--aries-dialog-width-confirm)] rounded-[var(--aries-radius-dialog)] border border-[color:var(--aries-inspector-divider-color)] bg-[var(--aries-background)] p-[var(--aries-dialog-padding)] shadow-xl"
      >
        <div
          id="style-lab-delete-theme-title"
          className="mb-[var(--aries-dialog-header-gap)] text-[length:var(--aries-font-size-large)] font-medium text-[color:var(--aries-inspector-title-color)]"
        >
          {t("styleLab.delete.title", { name: source.label })}
        </div>
        <p
          id="style-lab-delete-theme-description"
          className="text-[length:var(--aries-font-size-reading)] leading-[var(--aries-font-line-height-reading)] text-[color:var(--aries-inspector-muted-color)]"
        >
          {t("styleLab.delete.body")}
        </p>
        <div className="mt-[var(--aries-dialog-gap)] flex justify-end gap-[var(--aries-dialog-footer-gap)]">
          <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
            {t("picker.cancel")}
          </Button>
          <Button type="button" variant="destructive" onClick={onConfirm} disabled={busy}>
            {t("picker.delete")}
          </Button>
        </div>
      </div>
    </div>
  );
}

function SyncWheelStylesDialog({
  classLabel,
  source,
  targets,
  busy,
  onCancel,
  onConfirm,
}: {
  classLabel: string;
  source: WheelSemanticVariant;
  targets: readonly WheelSemanticVariant[];
  busy: boolean;
  onCancel: () => void;
  onConfirm: (targets: readonly WheelSemanticVariant[]) => void;
}) {
  const t = useT();
  const [selectedTargets, setSelectedTargets] = useState<Set<WheelSemanticVariant>>(
    () => new Set(targets),
  );
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="style-lab-sync-title"
      aria-describedby="style-lab-sync-description"
      className="fixed inset-0 z-50 flex items-center justify-center bg-[color:var(--aries-overlay-scrim)] px-[var(--aries-form-section-gap)]"
    >
      <div
        data-aries-surface="overlay"
        className="w-full max-w-[var(--aries-dialog-width-confirm)] rounded-[var(--aries-radius-dialog)] border border-[color:var(--aries-inspector-divider-color)] bg-[var(--aries-background)] p-[var(--aries-dialog-padding)] shadow-xl"
      >
        <div
          id="style-lab-sync-title"
          className="mb-[var(--aries-dialog-header-gap)] text-[length:var(--aries-font-size-large)] font-medium text-[color:var(--aries-inspector-title-color)]"
        >
          {t("styleLab.sync.title", { name: classLabel })}
        </div>
        <p
          id="style-lab-sync-description"
          className="text-[length:var(--aries-font-size-reading)] leading-[var(--aries-font-line-height-reading)] text-[color:var(--aries-inspector-muted-color)]"
        >
          {t("styleLab.sync.description", {
            source: t(`styleLab.variant.${source}`),
          })}
        </p>
        <fieldset className="mt-[var(--aries-form-field-gap)] space-y-1">
          <legend className="mb-1 text-[length:var(--aries-font-size-small)] font-medium text-[color:var(--aries-inspector-title-color)]">
            {t("styleLab.sync.targets")}
          </legend>
          {targets.map((target) => (
            <label
              key={target}
              className="flex min-h-8 items-center gap-2 rounded-[var(--aries-radius-control-compact)] px-2 text-[length:var(--aries-font-size-small)] text-[color:var(--aries-inspector-value-color)] hover:bg-[var(--aries-navbar-hover-bg)]"
            >
              <input
                type="checkbox"
                checked={selectedTargets.has(target)}
                disabled={busy}
                onChange={(event) => {
                  setSelectedTargets((current) => {
                    const next = new Set(current);
                    if (event.currentTarget.checked) next.add(target);
                    else next.delete(target);
                    return next;
                  });
                }}
              />
              {t(`styleLab.variant.${target}`)}
            </label>
          ))}
        </fieldset>
        <div className="mt-[var(--aries-dialog-gap)] flex justify-end gap-[var(--aries-dialog-footer-gap)]">
          <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
            {t("picker.cancel")}
          </Button>
          <Button
            type="button"
            onClick={() => onConfirm([...selectedTargets])}
            disabled={busy || !selectedTargets.size}
          >
            {t("styleLab.sync.apply")}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function ChartStylePanel({
  onClose,
  applyThemeToApp = false,
}: {
  onClose?: () => void;
  applyThemeToApp?: boolean;
}) {
  const t = useT();
  const selectedElement = useChartStyleEditorStore((state) => state.selectedElement);
  const sceneElements = useChartStyleEditorStore((state) => state.sceneElements);
  const semanticOverrides = useChartStyleEditorStore((state) => state.semanticOverrides);
  const syncedOverrides = useChartStyleEditorStore((state) => state.syncedOverrides);
  const tokenMetadata = useChartStyleEditorStore((state) => state.tokenMetadata);
  const revision = useChartStyleEditorStore((state) => state.revision);
  const undoStack = useChartStyleEditorStore((state) => state.undoStack);
  const redoStack = useChartStyleEditorStore((state) => state.redoStack);
  const syncStatus = useChartStyleEditorStore((state) => state.syncStatus);
  const syncDetail = useChartStyleEditorStore((state) => state.syncDetail);
  const remoteRevision = useChartStyleEditorStore((state) => state.remoteRevision);
  const remoteSourceThemeName = useChartStyleEditorStore(
    (state) => state.remoteSourceThemeName,
  );
  const remoteModifiedFromBaseline = useChartStyleEditorStore(
    (state) => state.remoteModifiedFromBaseline,
  );
  const authoringEditScope = useChartStyleEditorStore((state) => state.authoringEditScope);
  const editorDomain = useChartStyleEditorStore((state) => state.editorDomain);
  const setActive = useChartStyleEditorStore((state) => state.setActive);
  const setLiveAppThemePreview = useChartStyleEditorStore(
    (state) => state.setLiveAppThemePreview,
  );
  const setTokenMetadata = useChartStyleEditorStore((state) => state.setTokenMetadata);
  const setSyncStatus = useChartStyleEditorStore((state) => state.setSyncStatus);
  const acceptRemoteDraft = useChartStyleEditorStore((state) => state.acceptRemoteDraft);
  const setStyleLabBaseTheme = useChartStyleEditorStore((state) => state.setStyleLabBaseTheme);
  const selectElement = useChartStyleEditorStore((state) => state.selectElement);
  const setAuthoringEditScope = useChartStyleEditorStore((state) => state.setAuthoringEditScope);
  const setEditorDomain = useChartStyleEditorStore((state) => state.setEditorDomain);
  const applyOverrides = useChartStyleEditorStore((state) => state.applyOverrides);
  const undo = useChartStyleEditorStore((state) => state.undo);
  const redo = useChartStyleEditorStore((state) => state.redo);
  const [themeSources, setThemeSources] = useState<readonly StyleLabThemeSource[]>([]);
  const [saveAsOpen, setSaveAsOpen] = useState(false);
  const [newThemeName, setNewThemeName] = useState("");
  const [deleteThemeSource, setDeleteThemeSource] = useState<StyleLabThemeSource | null>(null);
  const [elementClipboard, setElementClipboard] = useState<ElementStyleClipboard | null>(null);
  const [syncDialogOpen, setSyncDialogOpen] = useState(false);
  const [transferNotice, setTransferNotice] = useState<string | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);

  const initializedRef = useRef(false);
  const remoteAvailableRef = useRef(true);
  const syncInFlightRef = useRef(false);
  const syncTimerRef = useRef<number | null>(null);
  const flushSyncRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    setTokenMetadata(TOKEN_METADATA);
  }, [setTokenMetadata]);

  useEffect(() => {
    const controller = new AbortController();
    void loadStoredStyleLabFonts(controller.signal)
      .then(() => {
        if (!controller.signal.aborted) {
          document.dispatchEvent(new Event(STYLE_FONT_ASSETS_READY_EVENT));
        }
      })
      .catch(() => {
        // Keep the inspector usable if the daemon is restarting; the next
        // upload or profile/theme refresh will retry the asset load.
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    setActive(true);
    setLiveAppThemePreview(applyThemeToApp);
    return () => {
      setLiveAppThemePreview(false);
      setActive(false);
    };
  }, [applyThemeToApp, setActive, setLiveAppThemePreview]);

  useEffect(() => {
    if (!transferNotice) return;
    const timer = window.setTimeout(() => setTransferNotice(null), 5000);
    return () => window.clearTimeout(timer);
  }, [transferNotice]);

  const flushSync = useCallback(() => {
    if (!initializedRef.current || !remoteAvailableRef.current) return;
    if (syncInFlightRef.current) {
      syncTimerRef.current = window.setTimeout(() => flushSyncRef.current(), 80);
      return;
    }
    const state = useChartStyleEditorStore.getState();
    if (state.gestureStart) {
      syncTimerRef.current = window.setTimeout(() => flushSyncRef.current(), 80);
      return;
    }
    const desired = cloneChartStyleOverrides(persistedStyleOverrides(state.semanticOverrides));
    const delta = syncDelta(state.syncedOverrides, desired);
    if (!Object.keys(delta).length) {
      state.setSyncStatus("synced");
      return;
    }
    syncInFlightRef.current = true;
    state.setSyncStatus("saving");
    let retryDelay: number | null = 80;
    void patchCurrentStyleLabDraft(
      { baseRevision: state.remoteRevision, overrides: delta },
      state.remoteEtag,
    )
      .then((draft) => {
        useChartStyleEditorStore.getState().markSynced(draft, desired);
      })
      .catch((error: unknown) => {
        const current = useChartStyleEditorStore.getState();
        if (error instanceof StyleLabApiError && (error.status === 409 || error.status === 412)) {
          retryDelay = null;
          current.setSyncStatus("conflict", t("styleLab.status.conflictDetail"));
          return;
        }
        retryDelay = error instanceof StyleLabApiError
          && error.status >= 400
          && error.status < 500
          ? null
          : POLL_INTERVAL_MS;
        current.setSyncStatus("error", error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        syncInFlightRef.current = false;
        const current = useChartStyleEditorStore.getState();
        if (
          retryDelay != null &&
          !equalChartStyleOverrides(current.syncedOverrides, current.semanticOverrides)
        ) {
          syncTimerRef.current = window.setTimeout(
            () => flushSyncRef.current(),
            retryDelay,
          );
        }
      });
  }, [t]);

  useEffect(() => {
    flushSyncRef.current = flushSync;
  }, [flushSync]);

  useEffect(() => {
    const controller = new AbortController();
    const loadDraft = async (): Promise<{
      draft: StyleLabDraft;
      sources: readonly StyleLabThemeSource[];
    }> => {
      const sources = await fetchStyleLabThemeSources(controller.signal);
      let draft: StyleLabDraft | null = null;
      try {
        draft = await fetchCurrentStyleLabDraft(controller.signal);
      } catch (error) {
        if (!(error instanceof StyleLabApiError && error.status === 404)) throw error;
      }
      const legacyDraftIsEmpty = draft != null
        && !draft.sourceThemeName
        && !Object.keys(draft.overrides ?? {}).length
        && !Object.keys(draft.authoringOverrides ?? {}).length
        && !Object.keys(draft.appAuthoringOverrides ?? {}).length;
      if (draft == null || legacyDraftIsEmpty) {
        const source = sources.find((candidate) => candidate.selected)
          ?? sources.find((candidate) => candidate.name === "Daylight")
          ?? sources[0];
        if (source) {
          draft = await createStyleLabDraftFromTheme(source.name, controller.signal);
        }
      }
      if (draft == null) {
        draft = await createCurrentStyleLabDraft(
          t("styleLab.draft.workingName"),
          controller.signal,
        );
      }
      return { draft, sources };
    };
    setSyncStatus("connecting");
    void loadDraft()
      .then(({ draft, sources }) => {
        if (controller.signal.aborted) return;
        setThemeSources(sources);
        acceptRemoteDraft(draft, { clearHistory: true });
        const source = sources.find(
          (candidate) => candidate.name === draft.sourceThemeName,
        );
        if (source) {
          setStyleLabBaseTheme({
            sourceThemeName: source.name,
            mode: source.mode,
            appTokens: source.appTokens,
            chartPalette: source.chartPalette,
            appAuthoring: source.appAuthoring,
          });
        }
        initializedRef.current = true;
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        initializedRef.current = true;
        remoteAvailableRef.current = false;
        setSyncStatus("local", error instanceof Error ? error.message : String(error));
      });
    return () => controller.abort();
  }, [acceptRemoteDraft, setStyleLabBaseTheme, setSyncStatus, t]);

  useEffect(() => {
    const source = themeSources.find(
      (candidate) => candidate.name === remoteSourceThemeName,
    );
    if (!source) return;
    setStyleLabBaseTheme({
      sourceThemeName: source.name,
      mode: source.mode,
      appTokens: source.appTokens,
      chartPalette: source.chartPalette,
      appAuthoring: source.appAuthoring,
    });
  }, [remoteSourceThemeName, setStyleLabBaseTheme, themeSources]);

  useEffect(() => {
    if (!initializedRef.current || !remoteAvailableRef.current) return;
    if (syncTimerRef.current != null) window.clearTimeout(syncTimerRef.current);
    syncTimerRef.current = window.setTimeout(() => flushSyncRef.current(), SYNC_DEBOUNCE_MS);
    return () => {
      if (syncTimerRef.current != null) window.clearTimeout(syncTimerRef.current);
    };
  }, [revision, semanticOverrides]);

  useEffect(() => {
    let cancelled = false;
    let polling = false;
    const poll = async () => {
      if (
        cancelled ||
        polling ||
        !initializedRef.current ||
        !remoteAvailableRef.current ||
        syncInFlightRef.current
      ) return;
      polling = true;
      try {
        const draft = await fetchCurrentStyleLabDraft();
        if (cancelled) return;
        const state = useChartStyleEditorStore.getState();
        const switchedDraft = draft.id !== state.remoteDraftId;
        if (!switchedDraft && draft.revision <= (state.remoteRevision ?? -1)) return;
        state.acceptRemoteDraft(draft, {
          preserveLocalChanges: !switchedDraft,
          clearHistory: switchedDraft,
        });
      } catch {
        // Keep the current chart paint stable through a transient daemon restart.
      } finally {
        polling = false;
      }
    };
    const interval = window.setInterval(() => void poll(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => () => {
    if (syncTimerRef.current != null) window.clearTimeout(syncTimerRef.current);
  }, []);

  const save = useCallback(() => {
    const state = useChartStyleEditorStore.getState();
    if (
      syncInFlightRef.current ||
      !equalChartStyleOverrides(state.syncedOverrides, state.semanticOverrides)
    ) {
      flushSyncRef.current();
      return;
    }
    state.setSyncStatus("saving");
    void commitCurrentStyleLabDraft({
      baseRevision: state.remoteRevision ?? undefined,
      activate: false,
    })
      .then(async (draft) => {
        acceptRemoteDraft(draft);
        try {
          const sources = await fetchStyleLabThemeSources();
          setThemeSources(sources);
          const source = sources.find(
            (candidate) => candidate.name === draft.sourceThemeName,
          );
          if (source) {
            setStyleLabBaseTheme({
              sourceThemeName: source.name,
              mode: source.mode,
              appTokens: source.appTokens,
              chartPalette: source.chartPalette,
              appAuthoring: source.appAuthoring,
            });
          }
        } catch {
          // The in-place save succeeded. Retain the current preview until the
          // source catalogue reconnects.
        }
        setSyncStatus("synced", t("styleLab.status.committed"));
      })
      .catch((error: unknown) => {
        setSyncStatus("error", error instanceof Error ? error.message : String(error));
      });
  }, [acceptRemoteDraft, setStyleLabBaseTheme, setSyncStatus, t]);

  const saveAsTheme = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = newThemeName.trim();
    if (!name) return;
    const state = useChartStyleEditorStore.getState();
    if (syncInFlightRef.current || state.remoteRevision == null) return;
    const desired = cloneChartStyleOverrides(
      persistedStyleOverrides(state.semanticOverrides),
    );
    const delta = syncDelta(state.syncedOverrides, desired);
    if (syncTimerRef.current != null) {
      window.clearTimeout(syncTimerRef.current);
      syncTimerRef.current = null;
    }
    syncInFlightRef.current = true;
    state.setSyncStatus("saving");
    void saveCurrentStyleLabDraftAsTheme(name, {
      baseRevision: state.remoteRevision ?? undefined,
      overrides: delta,
    })
      .then(async (draft) => {
        acceptRemoteDraft(draft, { clearHistory: true });
        try {
          const sources = await fetchStyleLabThemeSources();
          setThemeSources(sources);
          const source = sources.find(
            (candidate) => candidate.name === draft.sourceThemeName,
          );
          if (source) {
            setStyleLabBaseTheme({
              sourceThemeName: source.name,
              mode: source.mode,
              appTokens: source.appTokens,
              chartPalette: source.chartPalette,
              appAuthoring: source.appAuthoring,
            });
          }
        } catch {
          // The theme itself is already saved; the retained source list will
          // refresh on the next Style Lab connection if the daemon restarted.
        }
        setSaveAsOpen(false);
        setNewThemeName("");
        setSyncStatus("synced", t("styleLab.status.themeSaved", { name }));
      })
      .catch((error: unknown) => {
        setSyncStatus("error", error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        syncInFlightRef.current = false;
      });
  }, [
    acceptRemoteDraft,
    newThemeName,
    setStyleLabBaseTheme,
    setSyncStatus,
    t,
  ]);

  const deleteSavedTheme = useCallback(() => {
    const target = deleteThemeSource;
    if (!target?.deletable || !target.profileId) return;
    const state = useChartStyleEditorStore.getState();
    if (
      syncInFlightRef.current
      || state.syncStatus !== "synced"
      || target.name !== state.remoteSourceThemeName
      || !equalChartStyleOverrides(
        state.syncedOverrides,
        persistedStyleOverrides(state.semanticOverrides),
      )
    ) return;
    if (syncTimerRef.current != null) {
      window.clearTimeout(syncTimerRef.current);
      syncTimerRef.current = null;
    }
    syncInFlightRef.current = true;
    state.setSyncStatus("saving");
    void deleteStyleLabTheme(target.profileId)
      .then(async () => {
        try {
          await discardCurrentStyleLabDraft({
            baseRevision: state.remoteRevision ?? undefined,
            etag: state.remoteEtag,
          });
        } catch {
          // The saved theme is already gone. A stale in-memory draft is safe
          // and will be superseded by the fallback source below.
        }
        const sources = await fetchStyleLabThemeSources();
        const fallback = sources.find((candidate) => candidate.selected)
          ?? sources.find((candidate) => candidate.name === "Daylight")
          ?? sources[0];
        const draft = fallback
          ? await createStyleLabDraftFromTheme(fallback.name)
          : await createCurrentStyleLabDraft(t("styleLab.draft.workingName"));
        setThemeSources(sources);
        acceptRemoteDraft(draft, { clearHistory: true });
        if (fallback) {
          setStyleLabBaseTheme({
            sourceThemeName: fallback.name,
            mode: fallback.mode,
            appTokens: fallback.appTokens,
            chartPalette: fallback.chartPalette,
            appAuthoring: fallback.appAuthoring,
          });
        }
        setDeleteThemeSource(null);
        setSaveAsOpen(false);
        setNewThemeName("");
        setSyncStatus(
          "synced",
          t("styleLab.status.themeDeleted", { name: target.label }),
        );
      })
      .catch((error: unknown) => {
        setSyncStatus("error", error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        syncInFlightRef.current = false;
      });
  }, [
    acceptRemoteDraft,
    deleteThemeSource,
    setStyleLabBaseTheme,
    setSyncStatus,
    t,
  ]);

  const revertWorkingDraft = useCallback(() => {
    const state = useChartStyleEditorStore.getState();
    if (
      syncInFlightRef.current
      || state.syncStatus !== "synced"
      || !equalChartStyleOverrides(state.syncedOverrides, state.semanticOverrides)
    ) return;
    state.setSyncStatus("saving");
    const source = themeSources.find(
      (candidate) => candidate.name === state.remoteSourceThemeName,
    );
    const factoryDefault = !state.remoteModifiedFromBaseline
      && source?.system === true
      && source.factoryModified === true;
    void revertCurrentStyleLabDraft({
      baseRevision: state.remoteRevision ?? undefined,
      factoryDefault,
    })
      .then(async (draft) => {
        acceptRemoteDraft(draft, { clearHistory: true });
        if (factoryDefault) {
          try {
            const sources = await fetchStyleLabThemeSources();
            setThemeSources(sources);
            const restored = sources.find(
              (candidate) => candidate.name === draft.sourceThemeName,
            );
            if (restored) {
              setStyleLabBaseTheme({
                sourceThemeName: restored.name,
                mode: restored.mode,
                appTokens: restored.appTokens,
                chartPalette: restored.chartPalette,
                appAuthoring: restored.appAuthoring,
              });
            }
          } catch {
            // The factory profile is already restored; the catalogue will
            // refresh on the next retained connection.
          }
        }
        setSyncStatus("synced", t("styleLab.status.reverted"));
      })
      .catch((error: unknown) => {
        setSyncStatus("error", error instanceof Error ? error.message : String(error));
      });
  }, [
    acceptRemoteDraft,
    setStyleLabBaseTheme,
    setSyncStatus,
    t,
    themeSources,
  ]);

  const importThemeFile = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    if (syncInFlightRef.current) {
      input.value = "";
      return;
    }
    if (syncTimerRef.current != null) {
      window.clearTimeout(syncTimerRef.current);
      syncTimerRef.current = null;
    }
    syncInFlightRef.current = true;
    const run = async () => {
      if (file.size > MAX_THEME_IMPORT_BYTES) {
        throw new Error(t("styleLab.import.tooLarge"));
      }
      let profiles: unknown[];
      try {
        profiles = parseThemeExchangeFile(await file.text());
      } catch {
        throw new Error(t("styleLab.import.invalidFile"));
      }
      useChartStyleEditorStore.getState().setSyncStatus("saving");
      let importedDraft: StyleLabDraft | null = null;
      for (const profile of profiles) {
        importedDraft = await importStyleLabTheme(profile);
      }
      if (!importedDraft) throw new Error(t("styleLab.import.invalidFile"));
      acceptRemoteDraft(importedDraft, { clearHistory: true });
      const sources = await fetchStyleLabThemeSources();
      setThemeSources(sources);
      const source = sources.find(
        (candidate) => candidate.name === importedDraft?.sourceThemeName,
      );
      if (source) {
        let appliedThemeState: ThemeState | null = null;
        if (applyThemeToApp) {
          const options = await applyThemePreset(source.name);
          appliedThemeState = options.themeState;
        }
        setStyleLabBaseTheme({
          sourceThemeName: source.name,
          mode: source.mode,
          appTokens: source.appTokens,
          chartPalette: source.chartPalette,
          appAuthoring: source.appAuthoring,
        });
        if (appliedThemeState) {
          useThemeStore.getState().applyThemeState(appliedThemeState);
        }
        if (applyThemeToApp) {
          setThemeSources((current) => current.map((candidate) => ({
            ...candidate,
            selected: candidate.name === source.name,
          })));
        }
      }
      setSyncStatus(
        "synced",
        profiles.length === 1
          ? t("styleLab.status.themeImported", { name: importedDraft.name ?? file.name })
          : t("styleLab.status.themesImported", { count: profiles.length }),
      );
    };
    void run()
      .catch((error: unknown) => {
        setSyncStatus("error", error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        syncInFlightRef.current = false;
        input.value = "";
      });
  }, [
    acceptRemoteDraft,
    applyThemeToApp,
    setStyleLabBaseTheme,
    setSyncStatus,
    t,
  ]);

  const exportProfile = useCallback(() => {
    setSyncStatus("saving");
    void fetchStyleLabDraftExport()
      .then((profile) => {
        const blob = new Blob(
          [`${JSON.stringify(profile, null, 2)}\n`],
          { type: "application/json" },
        );
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = `${profile.id}.aries-theme.json`;
        anchor.click();
        URL.revokeObjectURL(url);
        setSyncStatus("synced");
      })
      .catch((error: unknown) => {
        setSyncStatus("error", error instanceof Error ? error.message : String(error));
      });
  }, [setSyncStatus]);

  const selectThemeSource = useCallback((sourceThemeName: string) => {
    const source = themeSources.find((candidate) => candidate.name === sourceThemeName);
    if (!source) return;
    const state = useChartStyleEditorStore.getState();
    if (
      syncInFlightRef.current
      || state.syncStatus !== "synced"
      || !equalChartStyleOverrides(
        state.syncedOverrides,
        persistedStyleOverrides(state.semanticOverrides),
      )
    ) return;
    state.setSyncStatus("connecting");
    void (async () => {
      const draft = await createStyleLabDraftFromTheme(source.name);
      let appliedThemeState: ThemeState | null = null;
      if (applyThemeToApp) {
        const options = await applyThemePreset(source.name);
        appliedThemeState = options.themeState;
      }
      setStyleLabBaseTheme({
        sourceThemeName: source.name,
        mode: source.mode,
        appTokens: source.appTokens,
        chartPalette: source.chartPalette,
        appAuthoring: source.appAuthoring,
      });
      useChartStyleEditorStore.getState().acceptRemoteDraft(
        draft,
        { clearHistory: true },
      );
      if (appliedThemeState) {
        useThemeStore.getState().applyThemeState(appliedThemeState);
      }
      if (applyThemeToApp) {
        setThemeSources((current) => current.map((candidate) => ({
          ...candidate,
          selected: candidate.name === source.name,
        })));
      }
    })()
      .then(() => {
        useChartStyleEditorStore.getState().setSyncStatus("synced");
      })
      .catch((error: unknown) => {
        useChartStyleEditorStore.getState().setSyncStatus(
          "error",
          error instanceof Error ? error.message : String(error),
        );
      });
  }, [applyThemeToApp, setStyleLabBaseTheme, themeSources]);

  const controls = useMemo(
    () => controlsForElement(selectedElement, tokenMetadata, authoringEditScope),
    [authoringEditScope, selectedElement, tokenMetadata],
  );
  const transferControls = useMemo<StyleTransferControl[]>(
    () => controls.map((control) => ({
      semanticId: control.token.semanticId,
      property: control.binding.property,
      value: currentValue(control, semanticOverrides),
    })),
    [controls, semanticOverrides],
  );
  const visibleControls = useMemo(
    () => selectedElement
      ? visibleControlsForElement(selectedElement, controls, semanticOverrides)
      : [],
    [controls, selectedElement, semanticOverrides],
  );
  const selectedClassId = selectedElement
    && isWheelSemanticClassId(styleClassId(selectedElement))
    ? styleClassId(selectedElement)
    : null;
  const selectedClassDefinition = selectedClassId
    ? WHEEL_SEMANTIC_CLASS_MANIFEST.find((definition) => definition.id === selectedClassId) ?? null
    : null;
  const selectedClassLabel = selectedClassDefinition
    ? t(selectedClassDefinition.labelKey)
    : selectedElement
      ? t(selectedElement.labelKey)
      : "";
  const sourceVariant = selectedElement ? styleElementProfile(selectedElement) : "classic";
  const syncTargetVariants = selectedClassDefinition
    ? selectedClassDefinition.applicability.variants.filter(
      (variant) => variant !== sourceVariant,
    )
    : [];
  const sourceVariantOverrideCount = selectedClassId
    ? Object.keys(semanticOverrides).filter((semanticId) =>
      semanticId.startsWith(
        `${WHEEL_AUTHORING_OVERRIDE_PREFIX}${sourceVariant}.${selectedClassId}.`,
      )
    ).length
    : 0;
  const classElements = useMemo(() => {
    const byClass = new Map<string, StyleSceneElement>();
    for (const element of sceneElements) {
      const classId = styleClassId(element);
      // Scene-only hierarchy/group nodes are navigation scaffolding, not
      // authoring classes. The exhaustive semantic manifest is the sole class
      // switcher authority.
      if (!isWheelSemanticClassId(classId)) continue;
      const current = byClass.get(classId);
      if (
        !current
        || isManifestPlaceholderElement(current) && !isManifestPlaceholderElement(element)
        || current.hitGeometry == null && element.hitGeometry != null
      ) {
        byClass.set(classId, element);
      }
    }
    if (selectedElement && isWheelSemanticClassId(styleClassId(selectedElement))) {
      const classId = styleClassId(selectedElement);
      const current = byClass.get(classId);
      if (
        !current
        || !isManifestPlaceholderElement(selectedElement)
        || isManifestPlaceholderElement(current)
      ) {
        byClass.set(classId, selectedElement);
      }
    }
    return byClass;
  }, [sceneElements, selectedElement]);
  const classChoices = useMemo<InspectorChoice[]>(() => {
    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
    return WHEEL_SEMANTIC_CLASS_MANIFEST
      .map((definition): InspectorChoice => {
        const element = classElements.get(definition.id);
        const placeholder = element
          ? isManifestPlaceholderElement(element)
          : false;
        const available = element != null
          && (!placeholder || isEditableManifestPlaceholder(element));
        return {
          id: definition.id,
          label: t(definition.labelKey),
          disabled: !available,
          ...(placeholder && available ? {
            detail: [
              t("styleLab.class.hiddenEditable"),
              t("styleLab.class.revealState", {
                state: definition.applicability.previewStateId,
              }),
            ].join(" · "),
          } : !available ? {
            detail: [
              t("styleLab.class.notApplicable"),
              t("styleLab.class.revealState", {
                state: definition.applicability.previewStateId,
              }),
            ].join(" · "),
          } : {}),
        };
      })
      .sort((left, right) => {
        if (left.disabled !== right.disabled) return left.disabled ? 1 : -1;
        return collator.compare(left.label, right.label);
      });
  }, [classElements, t]);
  const controlsBySection = useMemo(() => {
    const result = new Map<InspectorSection, BoundControl[]>();
    if (!selectedElement) return result;
    for (const control of visibleControls) {
      const section = inspectorSectionFor(selectedElement, control);
      const sectionControls = result.get(section) ?? [];
      sectionControls.push(control);
      result.set(section, sectionControls);
    }
    return result;
  }, [selectedElement, visibleControls]);
  const controlGroupsBySection = useMemo(() => {
    const result = new Map<
      InspectorSection,
      Map<InspectorControlGroup, BoundControl[]>
    >();
    if (!selectedElement) return result;
    for (const [section, sectionControls] of controlsBySection) {
      const groups = new Map<InspectorControlGroup, BoundControl[]>();
      for (const control of sectionControls) {
        const group = inspectorControlGroupFor(selectedElement, section, control);
        groups.set(group, [...(groups.get(group) ?? []), control]);
      }
      result.set(section, groups);
    }
    return result;
  }, [controlsBySection, selectedElement]);
  const copySelectedElementStyle = useCallback(() => {
    if (!selectedElement || !selectedClassId || !selectedClassLabel) return;
    const clipboard = copyElementStyle(
      {
        sourceClassId: selectedClassId,
        sourceLabel: selectedClassLabel,
        sourceProfile: sourceVariant,
      },
      transferControls,
    );
    if (!clipboard.entries.length) {
      setTransferNotice(t("styleLab.transfer.noCompatibleProperties"));
      return;
    }
    setElementClipboard(clipboard);
    setTransferNotice(t("styleLab.transfer.copied", { name: selectedClassLabel }));
  }, [
    selectedClassId,
    selectedClassLabel,
    selectedElement,
    sourceVariant,
    t,
    transferControls,
  ]);
  const pasteSelectedElementStyle = useCallback(() => {
    if (!elementClipboard || !selectedElement) return;
    const patch = buildElementStylePastePatch(elementClipboard, transferControls);
    const count = Object.keys(patch).length;
    if (!count) {
      setTransferNotice(t("styleLab.transfer.alreadyMatched"));
      return;
    }
    applyOverrides(patch);
    setTransferNotice(t("styleLab.transfer.pasted", {
      count,
      name: elementClipboard.sourceLabel,
    }));
  }, [applyOverrides, elementClipboard, selectedElement, t, transferControls]);
  const syncSelectedElementStyle = useCallback((
    targets: readonly WheelSemanticVariant[],
  ) => {
    if (!selectedClassDefinition || !selectedClassId) return;
    const allowedProperties = Object.fromEntries(
      targets.map((target) => {
        const capabilities = selectedClassDefinition.variantCapabilities?.[target]
          ?? selectedClassDefinition.capabilities;
        return [
          target,
          new Set(capabilities.filter(isWheelAuthoringFlatProperty)),
        ] as const;
      }),
    );
    const patch = buildWheelVariantSyncPatch(semanticOverrides, {
      classId: selectedClassId,
      source: sourceVariant,
      targets,
      allowedProperties,
    });
    const count = Object.keys(patch).length;
    setSyncDialogOpen(false);
    if (!count) {
      setTransferNotice(t("styleLab.transfer.alreadyMatched"));
      return;
    }
    applyOverrides(patch);
    setTransferNotice(t("styleLab.transfer.synced", {
      count,
      targetCount: targets.length,
    }));
  }, [
    applyOverrides,
    selectedClassDefinition,
    selectedClassId,
    semanticOverrides,
    sourceVariant,
    t,
  ]);
  const pending = !equalChartStyleOverrides(
    syncedOverrides,
    persistedStyleOverrides(semanticOverrides),
  );
  const canSave = syncStatus === "synced" && !pending;
  const canSaveAs = syncStatus !== "connecting"
    && syncStatus !== "saving"
    && remoteRevision != null;
  const selectedThemeSource = themeSources.find(
    (source) => source.name === remoteSourceThemeName,
  ) ?? null;
  const canRevert = canSave && (
    remoteModifiedFromBaseline
    || (
      selectedThemeSource?.system === true
      && selectedThemeSource.factoryModified === true
    )
  );
  const canSwitchTheme = canSave;
  const canDeleteTheme = canSave
    && selectedThemeSource?.deletable === true
    && Boolean(selectedThemeSource.profileId);
  const canCopyElement = editorDomain === "chart"
    && Boolean(selectedElement)
    && transferControls.length > 0;
  const canPasteElement = canCopyElement && Boolean(elementClipboard);
  const canSyncElement = canCopyElement
    && authoringEditScope === "variant"
    && sourceVariantOverrideCount > 0
    && syncTargetVariants.length > 0;
  const syncIcon = syncStatus === "saving" || syncStatus === "connecting"
    ? <LoaderCircle size={13} className="animate-spin" />
    : syncStatus === "synced"
      ? <Cloud size={13} />
      : <CloudOff size={13} />;

  return (
    <aside
      data-aries-surface="inspector"
      className="flex h-full w-full min-w-0 flex-col bg-[var(--aries-inspector-background)] text-[color:var(--aries-inspector-value-color)]"
    >
      <header className="shrink-0 border-b border-[color:var(--aries-inspector-divider-color)] p-2">
        <div className="mb-2 flex min-w-0 items-center gap-1">
          <select
            data-aries-control-appearance="local"
            aria-label={t("quickopt.themePresets")}
            title={t("quickopt.themePresets")}
            value={remoteSourceThemeName ?? ""}
            disabled={!canSwitchTheme || !themeSources.length}
            className="h-8 min-w-0 flex-1 rounded-[var(--aries-radius-control-compact)] border border-[color:var(--aries-inspector-divider-color)] bg-[var(--aries-inspector-background)] px-2 text-[length:var(--aries-font-size-small)] text-[color:var(--aries-inspector-value-color)] outline-none focus:border-[color:var(--aries-inspector-interactive-color)] disabled:opacity-50"
            onChange={(event) => {
              setDeleteThemeSource(null);
              selectThemeSource(event.currentTarget.value);
            }}
          >
            <option value="" disabled>{t("quickopt.themePresets")}</option>
            {themeSources.map((source) => (
              <option key={source.name} value={source.name}>{source.label}</option>
            ))}
          </select>
          <IconButton
            label={t("styleLab.action.deleteTheme")}
            disabled={!canDeleteTheme}
            onClick={() => setDeleteThemeSource(selectedThemeSource)}
          >
            <Trash2 size={14} />
          </IconButton>
        </div>
        <div
          className="mb-2 grid grid-cols-2 rounded-[var(--aries-radius-control-compact)] border border-[color:var(--aries-inspector-divider-color)] p-0.5"
          role="group"
          aria-label={t("styleLab.domain.label")}
        >
          {(["chart", "app"] as const).map((domain) => (
            <button
              key={domain}
              type="button"
              aria-pressed={editorDomain === domain}
              onClick={() => setEditorDomain(domain)}
              className={cn(
                "h-7 rounded-[var(--aries-radius-control-compact)] text-[length:var(--aries-font-size-small)]",
                editorDomain === domain
                  ? "bg-[var(--aries-accent)] text-[color:var(--aries-accent-foreground)]"
                  : "text-[color:var(--aries-inspector-muted-color)] hover:bg-[var(--aries-navbar-hover-bg)]",
              )}
            >
              {t(`styleLab.domain.${domain}`)}
            </button>
          ))}
        </div>
        <div className="flex min-w-0 items-center gap-1">
          {editorDomain === "chart" ? (
            <>
              <div className="mr-1 min-w-0 flex-1">
                <InspectorCombobox
                  value={selectedElement && isWheelSemanticClassId(styleClassId(selectedElement))
                    ? styleClassId(selectedElement)
                    : null}
                  options={classChoices}
                  label={t("styleLab.element.title")}
                  placeholder={t("styleLab.element.title")}
                  emptyLabel={t("picker.noSearchResults")}
                  onValueChange={(classId) => {
                    const element = classElements.get(classId);
                    if (element) {
                      setSyncDialogOpen(false);
                      selectElement(element);
                    }
                  }}
                />
              </div>
              <select
                data-aries-control-appearance="local"
                aria-label={t("styleLab.authoringScope.label")}
                title={t("styleLab.authoringScope.label")}
                value={authoringEditScope}
                className="h-7 w-[7.25rem] min-w-0 rounded-[var(--aries-radius-control-compact)] border border-[color:var(--aries-inspector-divider-color)] bg-[var(--aries-inspector-background)] px-1 text-[length:var(--aries-font-size-micro)] text-[color:var(--aries-inspector-value-color)] outline-none focus:border-[color:var(--aries-inspector-interactive-color)]"
                onChange={(event) => {
                  setSyncDialogOpen(false);
                  setAuthoringEditScope(
                    event.currentTarget.value as ChartStyleAuthoringEditScope,
                  );
                }}
              >
                <option value="base">{t("styleLab.authoringScope.shared")}</option>
                <option value="variant">{t("styleLab.authoringScope.variant")}</option>
              </select>
            </>
          ) : (
            <div className="mr-1 min-w-0 flex-1 truncate text-[length:var(--aries-font-size-micro)] text-[color:var(--aries-inspector-muted-color)]">
              {t("styleLab.app.editorDescription")}
            </div>
          )}
          <IconButton label={t("styleLab.action.undo")} disabled={!undoStack.length} onClick={undo}>
            <Undo2 size={14} />
          </IconButton>
          <IconButton label={t("styleLab.action.redo")} disabled={!redoStack.length} onClick={redo}>
            <Redo2 size={14} />
          </IconButton>
          {onClose ? (
            <IconButton label={t("inspector.closeInspector")} onClick={onClose}>
              <X size={15} />
            </IconButton>
          ) : null}
        </div>
        {editorDomain === "chart" ? (
          <div className="mt-2 flex min-w-0 items-center gap-1">
            <button
              type="button"
              disabled={!canCopyElement}
              onClick={copySelectedElementStyle}
              className="inline-flex h-7 shrink-0 items-center gap-1 rounded-[var(--aries-radius-control-compact)] border border-[color:var(--aries-inspector-divider-color)] px-2 text-[length:var(--aries-font-size-micro)] text-[color:var(--aries-inspector-title-color)] hover:bg-[var(--aries-navbar-hover-bg)] disabled:cursor-default disabled:opacity-30"
              title={t("styleLab.action.copyElement")}
            >
              <Copy size={12} />
              {t("styleLab.action.copyElement")}
            </button>
            <button
              type="button"
              disabled={!canPasteElement}
              onClick={pasteSelectedElementStyle}
              className="inline-flex h-7 shrink-0 items-center gap-1 rounded-[var(--aries-radius-control-compact)] border border-[color:var(--aries-inspector-divider-color)] px-2 text-[length:var(--aries-font-size-micro)] text-[color:var(--aries-inspector-title-color)] hover:bg-[var(--aries-navbar-hover-bg)] disabled:cursor-default disabled:opacity-30"
              title={elementClipboard
                ? t("styleLab.transfer.pasteFrom", { name: elementClipboard.sourceLabel })
                : t("styleLab.action.pasteElement")}
            >
              <ClipboardPaste size={12} />
              {t("styleLab.action.pasteElement")}
            </button>
            <button
              type="button"
              disabled={!canSyncElement}
              onClick={() => setSyncDialogOpen(true)}
              className="inline-flex h-7 shrink-0 items-center gap-1 rounded-[var(--aries-radius-control-compact)] border border-[color:var(--aries-inspector-divider-color)] px-2 text-[length:var(--aries-font-size-micro)] text-[color:var(--aries-inspector-title-color)] hover:bg-[var(--aries-navbar-hover-bg)] disabled:cursor-default disabled:opacity-30"
              title={authoringEditScope === "base"
                ? t("styleLab.sync.sharedAlready")
                : sourceVariantOverrideCount === 0
                  ? t("styleLab.sync.noOverrides", {
                    source: t(`styleLab.variant.${sourceVariant}`),
                  })
                  : t("styleLab.action.syncElement")}
            >
              <RefreshCw size={12} />
              {t("styleLab.action.syncElement")}
            </button>
            <span
              aria-live="polite"
              className="min-w-0 flex-1 truncate pl-1 text-[length:var(--aries-font-size-micro)] text-[color:var(--aries-inspector-muted-color)]"
            >
              {transferNotice}
            </span>
          </div>
        ) : null}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {editorDomain === "app" ? (
          <AppThemeControls key={remoteSourceThemeName ?? "base"} />
        ) : !selectedElement || !visibleControls.length ? (
          <div className="px-[var(--aries-inspector-padding-x)] py-6 text-[length:var(--aries-font-size-small)] leading-relaxed text-[color:var(--aries-inspector-muted-color)]">
            {t("styleLab.scene.description")}
          </div>
        ) : (
          INSPECTOR_SECTION_ORDER.map((section) => {
            const sectionControls = controlsBySection.get(section);
            const sectionGroups = controlGroupsBySection.get(section);
            if (!sectionControls?.length) return null;
            return (
              <section
                key={section}
                className="border-t border-[color:var(--aries-inspector-divider-color)] py-1 first:border-t-0"
              >
                <h3 className="flex h-7 items-center px-[var(--aries-inspector-padding-x)] text-[length:var(--aries-font-size-small)] font-medium text-[color:var(--aries-inspector-title-color)]">
                  {inspectorSectionLabel(section, t)}
                </h3>
                {sectionGroups && (
                  sectionGroups.size > 1
                  || !sectionGroups.has("default")
                ) ? (
                  INSPECTOR_CONTROL_GROUP_ORDER.map((group) => {
                    const groupControls = sectionGroups.get(group);
                    if (!groupControls?.length) return null;
                    if (group === "default") {
                      return groupControls.map((control) => (
                        <PropertyControl
                          key={control.token.semanticId}
                          control={control}
                          overrides={semanticOverrides}
                          siblingControls={controls}
                        />
                      ));
                    }
                    const summary = inspectorControlGroupSummary(
                      group,
                      groupControls,
                      semanticOverrides,
                      t,
                    );
                    const defaultOpen = (
                      group === "fill"
                      || group === "compositing"
                      || (
                        (group === "texture" || group === "mask" || group === "shadow")
                        && summary !== t("styleLab.group.off")
                      )
                    );
                    return (
                      <InspectorPropertyGroup
                        key={`${selectedElement.id}:${section}:${group}`}
                        title={inspectorControlGroupLabel(group, t)}
                        summary={summary}
                        defaultOpen={defaultOpen}
                      >
                        {groupControls.map((control) => (
                          <PropertyControl
                            key={control.token.semanticId}
                            control={control}
                            overrides={semanticOverrides}
                            siblingControls={controls}
                          />
                        ))}
                      </InspectorPropertyGroup>
                    );
                  })
                ) : (
                  sectionControls.map((control) => (
                    <PropertyControl
                      key={control.token.semanticId}
                      control={control}
                      overrides={semanticOverrides}
                      siblingControls={controls}
                    />
                  ))
                )}
              </section>
            );
          })
        )}
      </div>
      {saveAsOpen ? (
        <form
          className="shrink-0 border-t border-[color:var(--aries-inspector-divider-color)] p-2"
          onSubmit={saveAsTheme}
        >
          <label
            htmlFor="style-lab-new-theme-name"
            className="mb-1 block text-[length:var(--aries-font-size-micro)] text-[color:var(--aries-inspector-muted-color)]"
          >
            {t("styleLab.saveAs.name")}
          </label>
          <input
            data-aries-control-appearance="local"
            id="style-lab-new-theme-name"
            autoFocus
            maxLength={80}
            value={newThemeName}
            placeholder={t("styleLab.saveAs.placeholder")}
            className="h-8 w-full rounded-[var(--aries-radius-control-compact)] border border-[color:var(--aries-inspector-divider-color)] bg-[var(--aries-inspector-background)] px-2 text-[length:var(--aries-font-size-small)] text-[color:var(--aries-inspector-value-color)] outline-none focus:border-[color:var(--aries-inspector-interactive-color)]"
            onChange={(event) => setNewThemeName(event.currentTarget.value)}
          />
          <div className="mt-2 flex justify-end gap-1">
            <button
              type="button"
              className="inline-flex h-7 items-center rounded-[var(--aries-radius-control-compact)] px-2 text-[length:var(--aries-font-size-small)] text-[color:var(--aries-inspector-muted-color)] hover:bg-[var(--aries-navbar-hover-bg)]"
              onClick={() => {
                setSaveAsOpen(false);
                setNewThemeName("");
              }}
            >
              {t("styleLab.saveAs.cancel")}
            </button>
            <button
              type="submit"
              disabled={!canSaveAs || !newThemeName.trim()}
              className="inline-flex h-7 items-center rounded-[var(--aries-radius-control-compact)] border border-[color:var(--aries-inspector-divider-color)] px-2 text-[length:var(--aries-font-size-small)] text-[color:var(--aries-inspector-title-color)] hover:bg-[var(--aries-navbar-hover-bg)] disabled:cursor-default disabled:opacity-30"
            >
              {t("styleLab.saveAs.save")}
            </button>
          </div>
        </form>
      ) : null}
      <footer className="flex h-11 shrink-0 items-center gap-1 border-t border-[color:var(--aries-inspector-divider-color)] px-2">
        <input
          ref={importInputRef}
          type="file"
          accept=".json,.jsonl,.aries-chart-style.json,application/json,application/x-ndjson"
          className="hidden"
          onChange={importThemeFile}
        />
        <div
          className={cn(
            "flex size-7 shrink-0 items-center justify-center",
            syncStatus === "synced"
              ? "text-[color:var(--aries-inspector-interactive-color)]"
              : syncStatus === "error" || syncStatus === "conflict"
                ? "text-[color:var(--aries-validation-error)]"
                : "text-[color:var(--aries-inspector-muted-color)]",
          )}
          title={[t(`styleLab.status.${syncStatus}`), syncDetail].filter(Boolean).join(": ")}
        >
          {syncIcon}
        </div>
        <div className="min-w-0 flex-1 truncate text-[length:var(--aries-font-size-micro)] text-[color:var(--aries-inspector-muted-color)]">
          {(syncStatus === "error" || syncStatus === "conflict") && syncDetail
            ? syncDetail
            : t(`styleLab.status.${syncStatus}`)}
        </div>
        <IconButton
          label={t("styleLab.action.revert")}
          disabled={!canRevert}
          onClick={revertWorkingDraft}
        >
          <RotateCcw size={14} />
        </IconButton>
        <IconButton
          label={t("styleLab.action.import")}
          disabled={!canSave}
          onClick={() => importInputRef.current?.click()}
        >
          <Upload size={14} />
        </IconButton>
        <IconButton
          label={t("styleLab.action.export")}
          disabled={!canSave}
          onClick={exportProfile}
        >
          <Download size={14} />
        </IconButton>
        <IconButton
          label={t("styleLab.action.saveAsTheme")}
          disabled={!canSaveAs}
          onClick={() => setSaveAsOpen((open) => !open)}
        >
          <CopyPlus size={14} />
        </IconButton>
        <button
          type="button"
          disabled={!canSave}
          onClick={save}
          className="ml-1 inline-flex h-7 shrink-0 items-center gap-1 rounded-[var(--aries-radius-control-compact)] border border-[color:var(--aries-inspector-divider-color)] px-2 text-[length:var(--aries-font-size-small)] text-[color:var(--aries-inspector-title-color)] hover:bg-[var(--aries-navbar-hover-bg)] disabled:cursor-default disabled:opacity-30"
        >
          <Check size={13} />
          {t("styleLab.action.commit")}
        </button>
      </footer>
      {deleteThemeSource ? (
        <DeleteThemeDialog
          source={deleteThemeSource}
          busy={syncStatus === "saving"}
          onCancel={() => setDeleteThemeSource(null)}
          onConfirm={deleteSavedTheme}
        />
      ) : null}
      {syncDialogOpen && selectedClassDefinition ? (
        <SyncWheelStylesDialog
          classLabel={selectedClassLabel}
          source={sourceVariant}
          targets={syncTargetVariants}
          busy={syncStatus === "saving"}
          onCancel={() => setSyncDialogOpen(false)}
          onConfirm={syncSelectedElementStyle}
        />
      ) : null}
    </aside>
  );
}
