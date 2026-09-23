// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import { compileFlatWheelAuthoringOverrides } from "../style-lab/wheel-authoring-adapter";
import { WHEEL_GEOMETRY_LEGACY_TOKENS, wheelAppearanceOverrides, wheelGeometryForLayout } from "./wheel-geometry-ownership";
import {
  resolveWheelRenderStyleFromTokens,
  type WheelCssValueReader,
  type WheelRenderStyle,
  type WheelTypographyProfile,
} from "./wheel-render-style";

export interface WheelGeometryPresetSelection {
  id: string;
  revision: number;
  overrides: Readonly<Record<string, unknown>>;
}

export type WheelGeometryPresetSelections = Partial<
  Record<WheelTypographyProfile, WheelGeometryPresetSelection>
>;

export interface WheelGeometryPresetInput {
  profile: WheelTypographyProfile;
  /** Missing only on older snapshots, which retain their original theme geometry. */
  presets?: WheelGeometryPresetSelections;
  appearanceOverrides?: Readonly<Record<string, unknown>>;
  /** A complete draft, so deleting a saved override previews its factory value. */
  preview?: {
    profile: WheelTypographyProfile | null;
    overrides: Readonly<Record<string, unknown>>;
    revision?: string | number;
    baseRevision?: number;
    dirty?: boolean;
    gestureActive?: boolean;
  } | null;
}

type WheelGeometryPreviewState = {
  geometryProfile: WheelTypographyProfile | null;
  geometryOverrides: Readonly<Record<string, unknown>>;
  syncedGeometryOverrides: Readonly<Record<string, unknown>>;
  wheelPresetState: { revision: number } | null;
  revision: number;
  gestureStart: unknown;
};

/** Shared screen/export adapter; geometry values are validated scalar values. */
export function assembleWheelGeometryPreview(
  state: WheelGeometryPreviewState,
): NonNullable<WheelGeometryPresetInput["preview"]> {
  const local = state.geometryOverrides;
  const synced = state.syncedGeometryOverrides;
  const keys = Object.keys(local);
  const dirty = keys.length !== Object.keys(synced).length
    || keys.some(key => !Object.is(local[key], synced[key]));
  return {
    profile: state.geometryProfile,
    overrides: local,
    revision: state.revision,
    baseRevision: state.wheelPresetState?.revision ?? -1,
    dirty,
    gestureActive: state.gestureStart != null,
  };
}

const GEOMETRY_CSS_BY_KEY = new Map<string, string>();
const GEOMETRY_CSS = new Set<string>();
for (const [semanticId, cssVar] of Object.entries(WHEEL_GEOMETRY_LEGACY_TOKENS)) {
  GEOMETRY_CSS.add(cssVar);
  GEOMETRY_CSS_BY_KEY.set(semanticId, cssVar);
  GEOMETRY_CSS_BY_KEY.set(cssVar, cssVar);
}

function previewIsCurrent(input: WheelGeometryPresetInput): boolean {
  const preview = input.preview;
  return preview?.profile === input.profile && Boolean(
    preview.dirty || preview.gestureActive ||
    // Once the snapshot catches up, it is authoritative. A catalog-only
    // refresh can advance the revision of an otherwise parked editor draft.
    (preview.baseRevision ?? -1) > (input.presets?.[input.profile]?.revision ?? 0),
  );
}

function selectedGeometry(input: WheelGeometryPresetInput): Readonly<Record<string, unknown>> {
  return previewIsCurrent(input)
    // previewIsCurrent proves the matching preview exists.
    ? input.preview!.overrides
    : input.presets?.[input.profile]?.overrides ?? {};
}

/** The identical effective class map is used by paint and the editor's handles. */
export function resolveWheelPresetAuthoringOverrides(
  input: WheelGeometryPresetInput,
): Record<string, unknown> {
  const appearance = input.appearanceOverrides ?? {};
  if (input.presets === undefined) return { ...appearance };
  return {
    ...wheelAppearanceOverrides(appearance),
    ...wheelGeometryForLayout(selectedGeometry(input), input.profile),
  };
}

/**
 * Geometry belongs to the selected wheel preset. Blank geometry CSS reads use
 * the renderer's factory defaults; appearance continues to come from the theme.
 * This also removes legacy theme radii before an empty factory preset is applied.
 */
export function resolveWheelGeometryPresetStyle(
  readValue: WheelCssValueReader,
  styleInput: Omit<NonNullable<Parameters<typeof resolveWheelRenderStyleFromTokens>[1]>, "authoringOverrides">,
  input: WheelGeometryPresetInput,
): WheelRenderStyle {
  const authoringOverrides = compileFlatWheelAuthoringOverrides(
    resolveWheelPresetAuthoringOverrides(input),
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
  return resolveWheelRenderStyleFromTokens(
    cssVar => GEOMETRY_CSS.has(cssVar) ? geometryCss.get(cssVar) ?? "" : readValue(cssVar),
    {
      ...styleInput,
      revision: `${styleInput.revision ?? "base"}:geometry-${input.profile}-${selected?.id ?? "factory"}-${selected?.revision ?? 0}:draft-${previewIsCurrent(input) ? input.preview!.revision ?? "active" : "none"}`,
      authoringOverrides,
    },
  );
}
