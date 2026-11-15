import { constrainCoordinateChart } from "./chart-coordinates";
// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import { compileFlatWheelAuthoringOverrides } from "../style-lab/wheel-authoring-adapter";
import type { WheelComposition } from "./wheel-composition";
import type { ChartRenderSnapshot } from "./types";
import { WHEEL_GEOMETRY_LEGACY_TOKENS, wheelAppearanceOverrides, wheelGeometryForLayout } from "./wheel-geometry-ownership";
import { mergeWheelPresetAppearance, wheelPresetCssValue, wheelPresetAppearanceDelta, wheelPresetAppearanceForLayout,
  wheelPresetPresentationAppearance, type WheelPresetAppearance } from './wheel-preset-appearance';
import {
  resolveWheelRenderStyleFromTokens,
  type WheelCssValueReader,
  type WheelRenderStyle,
  type WheelTypographyProfile,
} from "./wheel-render-style";

export interface WheelGeometryPresetSelection {
  id: string;
  revision: number;
  sourceThemeName?: string;
  overrides: Readonly<Record<string, unknown>>;
  appearance?: WheelPresetAppearance;
  appearanceRoles?: Readonly<Record<string, string>>;
}

export type WheelGeometryPresetSelections = Partial<
  Record<WheelTypographyProfile, WheelGeometryPresetSelection>
>;

/** A dimensions/structure reply, distinct from catalog metadata freshness. */
export interface WheelGeometryReceipt {
  presetId: string;
  revision: number;
  sourceThemeName?: string;
  overrides: Readonly<Record<string, unknown>>;
  appearance?: WheelPresetAppearance;
  appearanceRoles?: Readonly<Record<string, string>>;
  composition: WheelComposition;
}

export type WheelGeometryReceipts = Partial<Record<WheelTypographyProfile, WheelGeometryReceipt>>;

export interface WheelGeometryPreviewLayout {
  overrides: Readonly<Record<string, unknown>>;
  appearance?: WheelPresetAppearance;
  appearanceRoles?: Readonly<Record<string, string>>;
  appearanceEdits?: WheelPresetAppearance;
  composition?: WheelComposition;
  presetId?: string;
  sourceThemeName?: string;
  revision?: string | number;
  baseRevision?: number;
  dirty?: boolean;
  gestureActive?: boolean;
  pendingComposition?: boolean;
  /** A structure-only intent may arrive before this layout's editor loads. */
  dimensionsKnown?: boolean;
}

export interface WheelGeometryPresetInput {
  profile: WheelTypographyProfile;
  /** Missing only on older snapshots, which retain their original theme geometry. */
  presets?: WheelGeometryPresetSelections;
  appearanceOverrides?: Readonly<Record<string, unknown>>;
  appearanceEdits?: WheelPresetAppearance;
  readAppearanceValue?: WheelCssValueReader;
  /** A complete draft, so deleting a saved override previews its factory value. */
  preview?: WheelGeometryPreviewLayout & {
    profile: WheelTypographyProfile | null;
    layouts?: Partial<Record<WheelTypographyProfile, WheelGeometryPreviewLayout>>;
  } | null;
}

type WheelGeometryPreviewState = {
  geometryProfile: WheelTypographyProfile | null;
  geometryOverrides: Readonly<Record<string, unknown>>;
  syncedGeometryOverrides: Readonly<Record<string, unknown>>;
  /** Catalog metadata is accepted for older callers but never authorizes geometry. */
  wheelPresetState?: { revision: number; context?: {sourceThemeName: string} } | null;
  wheelGeometryReceipts?: WheelGeometryReceipts;
  pendingWheelCompositions?: Partial<Record<WheelTypographyProfile, WheelComposition>>;
  revision: number;
  gestureStart: unknown;
  resolvedOverrides?: WheelPresetAppearance;
  semanticOverrides?: WheelPresetAppearance;
  tokenMetadata?: Readonly<Record<string, {cssVar: string}>>;
  wheelAppearanceBaseline?: {profile: WheelTypographyProfile; overrides: WheelPresetAppearance} | null;
  liveAppThemePreview?: boolean;
};

/** Shared screen/export adapter; geometry values are validated scalar values. */
export function assembleWheelGeometryPreview(
  state: WheelGeometryPreviewState,
): NonNullable<WheelGeometryPresetInput["preview"]> {
  const layouts: Partial<Record<WheelTypographyProfile, WheelGeometryPreviewLayout>> = {};
  const profiles = new Set<WheelTypographyProfile>([
    ...Object.keys(state.wheelGeometryReceipts ?? {}) as WheelTypographyProfile[],
    ...Object.keys(state.pendingWheelCompositions ?? {}) as WheelTypographyProfile[],
    ...(state.geometryProfile ? [state.geometryProfile] : []),
  ]);
  for (const profile of profiles) {
    const receipt = state.wheelGeometryReceipts?.[profile];
    const catalog = state.wheelPresetState;
    if (receipt?.sourceThemeName && catalog?.context?.sourceThemeName
      && receipt.sourceThemeName !== catalog.context.sourceThemeName
      && catalog.revision >= receipt.revision) continue;
    const local = profile === state.geometryProfile ? state.geometryOverrides : receipt?.overrides ?? {};
    const synced = profile === state.geometryProfile ? state.syncedGeometryOverrides : local;
    const keys = Object.keys(local);
    const dirty = keys.length !== Object.keys(synced).length
      || keys.some(key => !Object.is(local[key], synced[key]));
    const pending = state.pendingWheelCompositions?.[profile];
    layouts[profile] = {
      overrides: local, appearance: receipt?.appearance, appearanceRoles: receipt?.appearanceRoles,
      composition: pending ?? receipt?.composition,
      appearanceEdits: state.liveAppThemePreview !== false && state.resolvedOverrides
        && state.wheelAppearanceBaseline?.profile === profile ? wheelPresetAppearanceDelta(
          wheelPresetAppearanceForLayout(state.semanticOverrides ?? state.resolvedOverrides, profile, state.tokenMetadata),
          state.wheelAppearanceBaseline.overrides,
          wheelPresetAppearanceForLayout(state.resolvedOverrides, profile, state.tokenMetadata)) : undefined,
      presetId: receipt?.presetId, sourceThemeName: receipt?.sourceThemeName, revision: state.revision,
      baseRevision: receipt?.revision ?? -1, dirty,
      gestureActive: profile === state.geometryProfile && state.gestureStart != null,
      pendingComposition: pending != null,
      dimensionsKnown: profile === state.geometryProfile || receipt != null,
    };
  }
  const active = state.geometryProfile ? layouts[state.geometryProfile] : undefined;
  return {
    profile: state.geometryProfile,
    overrides: state.geometryOverrides,
    ...active, layouts,
  };
}

const GEOMETRY_CSS_BY_KEY = new Map<string, string>();
const GEOMETRY_CSS = new Set<string>();
for (const [semanticId, cssVar] of Object.entries(WHEEL_GEOMETRY_LEGACY_TOKENS)) {
  GEOMETRY_CSS.add(cssVar);
  GEOMETRY_CSS_BY_KEY.set(semanticId, cssVar);
  GEOMETRY_CSS_BY_KEY.set(cssVar, cssVar);
}

function layoutPreview(input: WheelGeometryPresetInput): WheelGeometryPreviewLayout | undefined {
  return input.preview?.layouts?.[input.profile]
    ?? (input.preview?.profile === input.profile ? input.preview : undefined);
}

function previewMatchesSelection(input: WheelGeometryPresetInput): boolean {
  const preview = layoutPreview(input);
  const selected = input.presets?.[input.profile];
  if (preview?.presetId && selected && preview.presetId !== selected.id
    && selected.revision >= (preview.baseRevision ?? -1)) return false;
  if (preview?.sourceThemeName && selected?.sourceThemeName
    && preview.sourceThemeName !== selected.sourceThemeName
    && selected.revision >= (preview.baseRevision ?? -1)) return false;
  return Boolean(preview);
}

function previewIsCurrent(input: WheelGeometryPresetInput): boolean {
  if (!previewMatchesSelection(input)) return false;
  const preview = layoutPreview(input);
  return Boolean(preview && (
    preview.dirty || preview.gestureActive || preview.pendingComposition ||
    // Only an explicit geometry receipt bridges a retained chart snapshot.
    // Catalog revisions also advance for unrelated metadata transactions.
    (preview.baseRevision ?? -1) > (input.presets?.[input.profile]?.revision ?? 0)
  ));
}

function selectedGeometry(input: WheelGeometryPresetInput): Readonly<Record<string, unknown>> {
  return previewIsCurrent(input) && layoutPreview(input)?.dimensionsKnown !== false
    // previewIsCurrent proves the matching preview exists.
    ? layoutPreview(input)!.overrides
    : input.presets?.[input.profile]?.overrides ?? {};
}

function selectedAppearance(input: WheelGeometryPresetInput): WheelPresetAppearance {
  const usePreview = previewIsCurrent(input) && layoutPreview(input)?.dimensionsKnown !== false;
  const saved = usePreview
    ? layoutPreview(input)?.appearance ?? {}
    : input.presets?.[input.profile]?.appearance;
  const roles = usePreview ? layoutPreview(input)?.appearanceRoles : input.presets?.[input.profile]?.appearanceRoles;
  const edits = input.appearanceEdits ?? (previewMatchesSelection(input) ? layoutPreview(input)?.appearanceEdits : undefined);
  const appearance = mergeWheelPresetAppearance(saved ?? {}, edits);
  for (const [key, value] of Object.entries(appearance)) {
    if (typeof value !== 'string') continue;
    const target = /^\{([^{}]+)\}$/.exec(value)?.[1];
    if (!target) continue;
    const resolved = input.appearanceOverrides?.[target]
      ?? (roles?.[target] ? input.readAppearanceValue?.(roles[target]) : undefined);
    if (resolved != null && resolved !== '') appearance[key] = resolved;
    else delete appearance[key];
  }
  return appearance;
}

/** Paint, handles, hits and export choose structure with the dimensions above. */
export function resolveWheelPresetComposition(
  input: WheelGeometryPresetInput,
  snapshotComposition: WheelComposition | undefined,
): WheelComposition | undefined {
  return previewIsCurrent(input)
    ? layoutPreview(input)?.composition ?? snapshotComposition : snapshotComposition;
}

/** Project the shared structure preview without replacing calculation data. */
export function resolveWheelPresetSnapshot(
  snapshot: ChartRenderSnapshot,
  input: WheelGeometryPresetInput,
): ChartRenderSnapshot {
  const previous = snapshot.primaryChart.options.wheelComposition;
  const composition = resolveWheelPresetComposition(input, previous);
  const unchanged = composition === previous || Boolean(composition && previous
    && composition.projection === previous.projection
    && composition.customized === previous.customized
    && composition.rings.length === previous.rings.length
    && composition.rings.every((ring, index) => {
      const other = previous.rings[index];
      return ring.instanceId === other.instanceId && ring.archetypeId === other.archetypeId
        && ring.chartRole === other.chartRole && ring.enabled === other.enabled;
    }));
  const resolved = unchanged ? snapshot : {...snapshot, primaryChart: {...snapshot.primaryChart,
    options: {...snapshot.primaryChart.options, wheelComposition: composition}}};
  return resolved.primaryChart.coordinateFrame ? {...resolved,
    primaryChart: constrainCoordinateChart(resolved.primaryChart)} : resolved;
}

/**
 * A factory presentation's own renderer values (Theorem's stroke, type and
 * tick-length tiers). They define the design, so they sit above the theme's
 * appearance for the classes they name; every other class keeps the theme.
 */
function presentationAppearance(input: WheelGeometryPresetInput): Readonly<Record<string, unknown>> {
  return wheelPresetPresentationAppearance(input.profile, selectedGeometry(input)['wheel.presentation']);
}

/** The identical effective class map is used by paint and the editor's handles. */
export function resolveWheelPresetAuthoringOverrides(
  input: WheelGeometryPresetInput,
): Record<string, unknown> {
  const appearance = input.appearanceOverrides ?? {};
  if (input.presets === undefined) return { ...appearance };
  return {
    ...wheelAppearanceOverrides(appearance),
    ...presentationAppearance(input),
    ...selectedAppearance(input),
    ...wheelGeometryForLayout(selectedGeometry(input), input.profile),
  };
}

/**
 * Geometry belongs to the selected wheel preset. Blank geometry CSS reads use
 * the renderer's factory defaults. Saved wheel paint overlays the theme, with
 * subsequent live editor edits above it; old presets retain theme appearance.
 * This also removes legacy theme radii before an empty factory preset is applied.
 */
export function resolveWheelGeometryPresetStyle(
  readValue: WheelCssValueReader,
  styleInput: Omit<NonNullable<Parameters<typeof resolveWheelRenderStyleFromTokens>[1]>, "authoringOverrides">,
  input: WheelGeometryPresetInput,
): WheelRenderStyle {
  const appearanceInput = input.readAppearanceValue ? input : {...input, readAppearanceValue: readValue};
  const authoringOverrides = compileFlatWheelAuthoringOverrides(
    resolveWheelPresetAuthoringOverrides(appearanceInput),
  );
  if (input.presets === undefined) {
    return resolveWheelRenderStyleFromTokens(readValue, { ...styleInput, authoringOverrides });
  }
  const geometryCss = new Map<string, string>();
  for (const [key, value] of Object.entries(selectedGeometry(input))) {
    const cssVar = GEOMETRY_CSS_BY_KEY.get(key);
    if (cssVar && (typeof value === "string" || typeof value === "number")) {
      geometryCss.set(cssVar, String(value));
    }
  }
  const selected = input.presets[input.profile];
  const appearance = selectedAppearance(appearanceInput);
  const savedSymbols = wheelPresetCssValue(appearance['--aries-wheel-font-symbols']);
  // Catalog-only transactions (including H) advance persistence revisions.
  // Canvas identity follows the selected values, so identical geometry does
  // not dirty every retained layer when that receipt arrives.
  const geometryIdentity = JSON.stringify(Object.entries({...selectedGeometry(input), ...appearance})
    .sort(([left], [right]) => left.localeCompare(right)));
  const resolved = resolveWheelRenderStyleFromTokens(
    cssVar => GEOMETRY_CSS.has(cssVar) ? geometryCss.get(cssVar) ?? ""
      : wheelPresetCssValue(appearance[cssVar]) ?? readValue(cssVar),
    {
      ...styleInput,
      fontUi: wheelPresetCssValue(appearance['--aries-wheel-font-text']) ?? styleInput.fontUi,
      fontSymbols: savedSymbols ?? styleInput.fontSymbols,
      fontBodySymbols: wheelPresetCssValue(appearance['--aries-wheel-font-body-symbols']) ?? savedSymbols ?? styleInput.fontBodySymbols,
      fontSignSymbols: wheelPresetCssValue(appearance['--aries-wheel-font-sign-symbols']) ?? savedSymbols ?? styleInput.fontSignSymbols,
      fontTermSymbols: wheelPresetCssValue(appearance['--aries-wheel-font-term-symbols']) ?? savedSymbols ?? styleInput.fontTermSymbols,
      fontDecanSymbols: wheelPresetCssValue(appearance['--aries-wheel-font-decan-symbols']) ?? savedSymbols ?? styleInput.fontDecanSymbols,
      fontAspectSymbols: wheelPresetCssValue(appearance['--aries-wheel-font-aspect-symbols']) ?? savedSymbols ?? styleInput.fontAspectSymbols,
      revision: `${styleInput.revision ?? "base"}:geometry-${input.profile}-${previewIsCurrent(input) ? layoutPreview(input)?.presetId ?? selected?.id ?? "factory" : selected?.id ?? "factory"}-${geometryIdentity}:draft-${previewIsCurrent(input) ? layoutPreview(input)!.revision ?? "active" : "none"}`,
      authoringOverrides,
    },
  );
  // Vintage magazine paints through its own port of the measured mock-up
  // (vintage-magazine-wheel.ts); the cusp layout supplies only the circle size.
  if (input.profile === "cusps" && selectedGeometry(input)["wheel.presentation"] === "vintage-magazine") {
    return Object.freeze({ ...resolved, presentation: "vintage-magazine" as const });
  }
  return input.profile === "compact" && selectedGeometry(input)["wheel.presentation"] === "traditional-morinus"
    ? Object.freeze({ ...resolved, strokes: Object.freeze({...resolved.strokes, ascMcDefaultBase: 3}), presentation: "traditional-morinus" as const })
    : resolved;
}
