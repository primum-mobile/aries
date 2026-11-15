// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import { create } from "zustand";
import { isWheelGeometryKey, wheelGeometryOverrides, wheelAppearanceOverrides } from "@/lib/chart/wheel-geometry-ownership";
import type { WheelComposition } from "@/lib/chart/wheel-composition";
import type { WheelTypographyProfile } from "@/lib/chart/wheel-render-style";
import type { WheelGeometryReceipts } from "@/lib/chart/wheel-geometry-preset";
import { wheelPresetAppearanceForLayout, wheelPresetAppearanceDelta } from '@/lib/chart/wheel-preset-appearance';
import type { ThemeState } from "@/lib/daemon/client";
import type { WheelPresetsState } from "@/lib/daemon/wheel-presets-client";

import type { StyleSceneElement } from "@/lib/style-lab/style-scene";
import { resolveStyleTokenAliases } from "@/lib/style-lab/token-alias";
import { WHEEL_AUTHORING_OVERRIDE_PREFIX, WHEEL_VINTAGE_AUTHORING_SCOPE, wheelRingRoleForClass } from "@/lib/style-lab/wheel-authoring-adapter";
import { isVintageClass } from "@/lib/chart/vintage-magazine-wheel";
import { WHEEL_SEMANTIC_CLASS_MANIFEST, getWheelSemanticClass } from "@/lib/style-lab/semantic-class-manifest";
import {
  styleLabDraftEditorOverrides,
  type StyleLabDraft,
  type StyleLabWheelBaseline,
  type StyleLabScalarValue,
  type StyleLabTokenValue,
} from "@/lib/style-lab/client";

/**
 * How many recent colours to keep.
 *
 * A swatch strip exists for speed; past roughly a dozen the scan costs more
 * than the reuse saves, and the shipping range across comparable tools is 8-12.
 */
const RECENT_COLOR_LIMIT = 10;

const RECENT_COLOR_STORAGE_KEY = "ariesStyleLabRecentColors";
const HEX_COLOR = /^#[0-9a-f]{6}$/;

/**
 * Accept only what this feature wrote: a list of lowercase six-digit hex
 * strings, deduplicated and capped. Anything else in the slot is treated as
 * absent rather than repaired, because a swatch strip is not worth a migration.
 */
export function normalizeRecentColors(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const colors: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const normalized = entry.trim().toLowerCase();
    if (!HEX_COLOR.test(normalized) || colors.includes(normalized)) continue;
    colors.push(normalized);
    if (colors.length >= RECENT_COLOR_LIMIT) break;
  }
  return colors;
}

function readStoredRecentColors(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENT_COLOR_STORAGE_KEY);
    return raw ? normalizeRecentColors(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
}

function writeStoredRecentColors(colors: readonly string[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      RECENT_COLOR_STORAGE_KEY,
      JSON.stringify(colors),
    );
  } catch {
    // Recents are a convenience, not authored work: a full or blocked storage
    // quota costs the user the strip after a restart, never an edit.
  }
}

export type ChartStyleSyncStatus =
  | "connecting"
  | "synced"
  | "saving"
  | "conflict"
  | "error";

export type ChartStyleAuthoringEditScope = "base" | "variant";
export type StyleEditorDomain = "chart" | "app";

export type ChartStyleTokenBounds = Readonly<{
  min: number;
  max: number;
  step: number;
}>;

export type ChartStyleTokenMetadata = Readonly<{
  semanticId: string;
  cssVar: string;
  label: string;
  description: string;
  type: "color" | "number" | "font-family";
  unit: string;
  defaultValue: StyleLabTokenValue;
  defaultReference?: string;
  bounds?: ChartStyleTokenBounds;
  supportsAlpha?: boolean;
}>;

export type ChartStyleSemanticOverrides = Record<string, StyleLabTokenValue>;
export type ChartStyleCssOverrides = Record<string, string>;
export type ChartStyleLabBaseTheme = Readonly<{
  sourceThemeName: string | null;
  mode: "light" | "dark";
  appTokens: Readonly<Record<string, string>>;
  chartPalette: Readonly<Record<string, string>>;
  chartData: ThemeState["profileOverrides"]["chartData"];
  appAuthoring: Readonly<Record<string, StyleLabScalarValue>>;
}>;

const HISTORY_LIMIT = 80;

function cloneValue(value: StyleLabTokenValue): StyleLabTokenValue {
  return Array.isArray(value) ? [...value] : value;
}

export function cloneChartStyleOverrides(
  overrides: Readonly<ChartStyleSemanticOverrides>,
): ChartStyleSemanticOverrides {
  return Object.fromEntries(
    Object.entries(overrides).map(([semanticId, value]) => [semanticId, cloneValue(value)]),
  );
}

function sameValue(
  left: StyleLabTokenValue | undefined,
  right: StyleLabTokenValue | undefined,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function equalChartStyleOverrides(
  left: Readonly<ChartStyleSemanticOverrides>,
  right: Readonly<ChartStyleSemanticOverrides>,
): boolean {
  const semanticIds = new Set([...Object.keys(left), ...Object.keys(right)]);
  return [...semanticIds].every((semanticId) => sameValue(left[semanticId], right[semanticId]));
}

function formatCssValue(value: StyleLabTokenValue, unit: string): string {
  if (Array.isArray(value)) {
    const red = Number(value[0] ?? 0);
    const green = Number(value[1] ?? 0);
    const blue = Number(value[2] ?? 0);
    if (value.length > 3) {
      return `rgb(${red} ${green} ${blue} / ${Math.max(0, Math.min(1, Number(value[3]))) * 100}%)`;
    }
    return `rgb(${red} ${green} ${blue})`;
  }
  return typeof value === "number" ? `${value}${unit}` : String(value);
}

function buildCssOverrides(
  overrides: Readonly<ChartStyleSemanticOverrides>,
  metadata: Readonly<Record<string, ChartStyleTokenMetadata>>,
): ChartStyleCssOverrides {
  const cssOverrides: ChartStyleCssOverrides = {};
  for (const [semanticId, value] of Object.entries(overrides)) {
    const token = metadata[semanticId];
    if (!token) continue;
    cssOverrides[token.cssVar] = formatCssValue(value, token.unit);
  }
  return cssOverrides;
}

/**
 * What a token is worth with no override on it: the theme being edited, else
 * the factory value. This is the floor a reference resolves against, and it is
 * why following a role keeps working when the role itself is untouched — the
 * role need not be overridden to be followable.
 */
export function createChartStyleTokenBaseReader(
  metadata: Readonly<Record<string, ChartStyleTokenMetadata>>,
  baseTheme: ChartStyleLabBaseTheme,
): (semanticId: string) => StyleLabTokenValue | null {
  const semanticIdByCssVar = new Map(
    Object.values(metadata).map((token) => [token.cssVar, token.semanticId]),
  );
  const cssVarAlias = /^var\(\s*(--[A-Za-z0-9_-]+)\s*\)$/;
  const read = (semanticId: string, seen: ReadonlySet<string>): StyleLabTokenValue | null => {
    const token = metadata[semanticId];
    if (!token) return null;
    const themed = baseTheme.chartPalette[token.cssVar]
      ?? baseTheme.appTokens[token.cssVar];
    const cssAlias = typeof themed === "string"
      ? cssVarAlias.exec(themed.trim())?.[1]
      : undefined;
    const reference = cssAlias
      ? semanticIdByCssVar.get(cssAlias)
      : themed == null
        ? token.defaultReference
        : undefined;
    if (reference && !seen.has(reference)) {
      return read(reference, new Set([...seen, semanticId]));
    }
    return themed ?? token.defaultValue ?? null;
  };
  return (semanticId) => read(semanticId, new Set());
}

/**
 * The three override maps that must always agree.
 *
 * `semanticOverrides` is what the user authored and may hold references;
 * `resolvedOverrides` is the same map with every reference followed, and is
 * what everything that paints reads. Deriving them together is what keeps a
 * reference from ever reaching a renderer.
 */
function overrideState(
  semanticOverrides: ChartStyleSemanticOverrides,
  metadata: Readonly<Record<string, ChartStyleTokenMetadata>>,
  baseTheme: ChartStyleLabBaseTheme,
): {
  semanticOverrides: ChartStyleSemanticOverrides;
  resolvedOverrides: ChartStyleSemanticOverrides;
  cssOverrides: ChartStyleCssOverrides;
  geometryOverrides: ChartStyleSemanticOverrides;
} {
  const resolvedOverrides = resolveStyleTokenAliases(
    semanticOverrides,
    createChartStyleTokenBaseReader(metadata, baseTheme),
  );
  return {
    semanticOverrides,
    resolvedOverrides,
    geometryOverrides: wheelGeometryOverrides(resolvedOverrides),
    cssOverrides: buildCssOverrides(resolvedOverrides, metadata),
  };
}

function metadataIndex(tokens: readonly ChartStyleTokenMetadata[]) {
  return Object.fromEntries(tokens.map((token) => [token.semanticId, token]));
}

function boundsIndex(tokens: readonly ChartStyleTokenMetadata[]) {
  return Object.fromEntries(
    tokens.flatMap((token) => token.bounds ? [[token.semanticId, token.bounds] as const] : []),
  );
}

export type ChartStyleEditorState = {
  active: boolean;
  liveAppThemePreview: boolean;
  hoveredElement: StyleSceneElement | null;
  selectedElement: StyleSceneElement | null;
  /**
   * Class ids edited together as one family, when a family row is selected.
   *
   * A family row stands for a reading that is read as one thing — a position's
   * degree, sign and minute — and editing it must move all of them. The
   * selected element remains one of the members, so every control keeps its
   * existing shape and value; only the write fans out.
   */
  selectedFamily: readonly string[] | null;
  sceneElements: readonly StyleSceneElement[];
  activePropertyId: string | null;
  authoringEditScope: ChartStyleAuthoringEditScope;
  editorDomain: StyleEditorDomain;

  /**
   * Colours recently applied to any element, most recent first.
   *
   * Adobe's convention: the colours you actually used stay within reach so the
   * next element can be given the same one without re-picking it. Held in the
   * editor store rather than the picker because it must survive selecting a
   * different element — it is a bridge between elements, not state of one
   * control.
   *
   * Deduplicated: a swatch set holding the same colour twice is a slower swatch
   * set, and React Aria's ColorSwatchPicker makes the same guarantee.
   *
   * Persisted locally, so the strip survives a restart the way Adobe's and
   * Figma's do. It is local chrome rather than authored state: the daemon still
   * owns every colour a theme actually carries.
   */
  recentColors: readonly string[];

  /** What the user authored. May hold references; never read to paint. */
  semanticOverrides: ChartStyleSemanticOverrides;
  /**
   * `semanticOverrides` with every reference followed to a literal.
   *
   * Everything downstream of the editor reads this — the wheel, the app theme
   * preview, the CSS layer — so a reference is never something a renderer has
   * to understand. Identical to `semanticOverrides` when nothing follows
   * anything, which is the ordinary case.
   */
  resolvedOverrides: ChartStyleSemanticOverrides;
  cssOverrides: ChartStyleCssOverrides;
  syncedOverrides: ChartStyleSemanticOverrides;
  /** Complete independent wheel draft, including an intentionally empty map. */
  geometryOverrides: ChartStyleSemanticOverrides;
  geometryProfile: WheelTypographyProfile | null;
  geometryTransition: boolean;
  syncedGeometryOverrides: ChartStyleSemanticOverrides;
  wheelPresetState: WheelPresetsState | null;
  wheelGeometryReceipts: WheelGeometryReceipts;
  wheelAppearanceBaseline: {profile: WheelTypographyProfile; overrides: Record<string, unknown>} | null;
  themeWheelBaseline: StyleLabWheelBaseline | null;
  pendingWheelCompositions: Partial<Record<WheelTypographyProfile, WheelComposition>>;
  acceptWheelPresets: (presets: WheelPresetsState, profile: WheelTypographyProfile,
    options?: {preserveLocalChanges?: boolean; clearHistory?: boolean; metadataOnly?: boolean; acknowledgeGeometry?: boolean;
      appearanceBaseline?: Record<string, unknown>}) => void;
  clearWheelGeometryContext: () => void;
  markWheelGeometrySynced: (presets: WheelPresetsState, profile: WheelTypographyProfile,
    sent: ChartStyleSemanticOverrides) => void;
  tokenMetadata: Record<string, ChartStyleTokenMetadata>;
  tokenBounds: Record<string, ChartStyleTokenBounds>;
  revision: number;
  undoStack: ChartStyleSemanticOverrides[];
  redoStack: ChartStyleSemanticOverrides[];
  gestureStart: ChartStyleSemanticOverrides | null;
  /**
   * Who opened the gesture in flight.
   *
   * One slot with no owner let a canvas drag silently join a focused text
   * field's transaction: the drag's commit then closed the field's, so the
   * field's Escape had nothing to restore. A gesture belongs to the surface
   * that opened it, and only that surface may close it.
   */
  gestureOwner: string | null;

  syncStatus: ChartStyleSyncStatus;
  syncDetail: string | null;
  remoteRevision: number | null;
  remoteEtag: string | null;
  remoteDraftId: string | null;
  remoteSourceThemeName: string | null;
  remoteModifiedFromBaseline: boolean;
  styleLabBaseTheme: ChartStyleLabBaseTheme;

  setActive: (active: boolean) => void;
  setLiveAppThemePreview: (active: boolean) => void;
  setHoveredElement: (element: StyleSceneElement | null) => void;
  selectElement: (element: StyleSceneElement | null) => void;
  /** Select a family, represented by one of its members. */
  selectFamily: (
    element: StyleSceneElement | null,
    classIds: readonly string[] | null,
  ) => void;
  setSceneElements: (elements: readonly StyleSceneElement[]) => void;
  setActiveProperty: (semanticId: string | null) => void;
  setAuthoringEditScope: (scope: ChartStyleAuthoringEditScope) => void;
  setEditorDomain: (domain: StyleEditorDomain) => void;
  rememberRecentColor: (color: string) => void;
  clearSelection: () => void;
  setTokenMetadata: (tokens: readonly ChartStyleTokenMetadata[]) => void;

  beginGesture: (ownerId: string) => void;
  setOverride: (semanticId: string, value: StyleLabTokenValue, radiusTarget?: 'degree' | 'cuspLabels') => void;
  /**
   * Write one explicit value per family member in a single step.
   *
   * `setOverride` fans a family edit out by repeating the same value, which is
   * right for a colour and wrong for a size: the parts of a reading are sized
   * in proportion to each other, and flattening them to one number destroys
   * the relationship the family exists to preserve. The caller computes the
   * per-member values because only it knows what each member is worth now.
   */
  setFamilyOverrides: (
    values: Readonly<Record<string, StyleLabTokenValue>>,
    activeSemanticId: string,
  ) => void;
  endGesture: (ownerId: string) => void;
  cancelGesture: (ownerId: string) => void;
  /** Restore sparse authoring at the pointer origin while the gesture stays open. */
  restoreGestureProperty: (semanticId: string, ownerId: string) => void;
  resetProperty: (semanticId: string) => void;
  resetProperties: (semanticIds: readonly string[]) => void;
  applyOverrides: (
    patch: Readonly<Record<string, StyleLabTokenValue | null>>,
  ) => void;
  resetAll: () => void;
  undo: () => void;
  redo: () => void;

  replaceOverrides: (
    overrides: Readonly<ChartStyleSemanticOverrides>,
    options?: Readonly<{ clearHistory?: boolean }>,
  ) => void;
  setSyncedOverrides: (overrides: Readonly<ChartStyleSemanticOverrides>) => void;
  acceptRemoteDraft: (
    draft: StyleLabDraft,
    options?: Readonly<{ preserveLocalChanges?: boolean; clearHistory?: boolean }>,
  ) => void;
  setSyncStatus: (status: ChartStyleSyncStatus, detail?: string | null) => void;
  setRemoteDraftMeta: (
    revision: number | null,
    etag: string | null,
    draftId?: string | null,
  ) => void;
  setStyleLabBaseTheme: (theme: ChartStyleLabBaseTheme) => void;
  markSynced: (draft: StyleLabDraft, overrides?: Readonly<ChartStyleSemanticOverrides>) => void;
};

function capabilitiesOf(definition: (typeof WHEEL_SEMANTIC_CLASS_MANIFEST)[number]): readonly string[] {
  return [...definition.capabilities, ...Object.values(definition.variantCapabilities ?? {}).flat()];
}

/** Properties the class manifest governs; anything else (radius recipes, band widths) it does not. */
const MANIFEST_PROPERTIES = new Set(WHEEL_SEMANTIC_CLASS_MANIFEST.flatMap(capabilitiesOf));

function classSupportsProperty(classId: string, property: string): boolean {
  const definition = getWheelSemanticClass(classId);
  if (!definition || !MANIFEST_PROPERTIES.has(property)) return true;
  return capabilitiesOf(definition).includes(property);
}

/**
 * Retarget one authoring override id onto every class in a family.
 *
 * Authoring ids are `authoring.wheel.<scope>.<classId>.<property>`, so the
 * family write is the same id with its class segment swapped. An id that is not
 * an authoring override — a raw design token, say — has no class to swap and is
 * returned untouched, which is what keeps non-class controls unaffected.
 */
export function expandFamilyOverrideIds(
  semanticId: string,
  family: readonly string[] | null,
): readonly string[] {
  if (!family || family.length < 2) return [semanticId];
  if (!semanticId.startsWith(WHEEL_AUTHORING_OVERRIDE_PREFIX)) return [semanticId];
  const body = semanticId.slice(WHEEL_AUTHORING_OVERRIDE_PREFIX.length);
  const scopeCut = body.indexOf(".");
  if (scopeCut <= 0) return [semanticId];
  const propertyCut = body.lastIndexOf(".");
  if (propertyCut <= scopeCut) return [semanticId];
  const scope = body.slice(0, scopeCut);
  const classId = body.slice(scopeCut + 1, propertyCut);
  const property = body.slice(propertyCut + 1);
  if (!family.includes(classId)) return [semanticId];
  // The Vintage wheel's scope holds only the classes its port paints, and a
  // member that has no such property (a ray's font size) is left alone: the
  // daemon would refuse it.
  const members = (scope === WHEEL_VINTAGE_AUTHORING_SCOPE ? family.filter(isVintageClass) : family)
    .filter((member) => member === classId || classSupportsProperty(member, property));
  return members.map(
    (member) => `${WHEEL_AUTHORING_OVERRIDE_PREFIX}${scope}.${member}.${property}`,
  );
}

/** Shape belongs to the selected preset even when appearance scope is shared. */
export function geometryEditId(id: string, profile: WheelTypographyProfile | null): string {
  return profile && isWheelGeometryKey(id)
    ? id.replace(/^authoring\.wheel\.(?:base|variant)\./, `authoring.wheel.${profile}.`)
    : id;
}

const RADIUS_EDIT = /^authoring\.wheel\.(classic|compact|anglo|houses|cusps)\.(rings\..+)\.radius$/;
const RADIUS_INTENT = /\.(?:canvas\.chart\.(?:radiusPriority|outerDegreeBinding|recipeVersion)|rings\..+\.(?:recipeRadius|radiusAuthored))$/;

function radiusUnchanged(overrides: ChartStyleSemanticOverrides, id: string, value: StyleLabTokenValue) {
  if (!sameValue(overrides[id], value)) return false;
  const match = RADIUS_EDIT.exec(id);
  if (!match) return true;
  return overrides[id.replace(/\.radius$/, '.radiusAuthored')] === true
    || (overrides[`authoring.wheel.${match[1]}.canvas.chart.recipeVersion`] !== 1
      && overrides[`authoring.wheel.${match[1]}.canvas.chart.radiusPriority`] === wheelRingRoleForClass(match[2]));
}

function captureRadiusRecipe(overrides: ChartStyleSemanticOverrides,
  before: ChartStyleSemanticOverrides, profile: string) {
  const versionId = `authoring.wheel.${profile}.canvas.chart.recipeVersion`;
  if (overrides[versionId] === 1) return;
  const priorPriority = before[`authoring.wheel.${profile}.canvas.chart.radiusPriority`];
  for (const [id, value] of Object.entries(before)) {
    const match = RADIUS_EDIT.exec(id);
    if (match?.[1] !== profile || typeof value !== 'number') continue;
    const role = wheelRingRoleForClass(match[2]);
    if (!role) continue;
    if (role === priorPriority) {
      overrides[id.replace(/\.radius$/, '.radiusAuthored')] = true;
    } else overrides[id.replace(/\.radius$/, '.recipeRadius')] = value;
  }
  overrides[versionId] = 1;
}

/** Restoring a sparse origin also restores the entire first-conversion basis.
 * Other explicit edits in the same gesture keep their own captured basis. */
function restoreRadiusRecipeOrigin(overrides: ChartStyleSemanticOverrides,
  origin: ChartStyleSemanticOverrides, profile: string) {
  const prefix = `authoring.wheel.${profile}.`;
  const radiusIds = new Set([...Object.keys(overrides), ...Object.keys(origin)]
    .filter(id => id.startsWith(prefix) && (RADIUS_EDIT.test(id) || id.endsWith('.radiusAuthored'))));
  if ([...radiusIds].some(id => !sameValue(overrides[id], origin[id]))) return;
  for (const id of Object.keys(overrides)) {
    if (id.startsWith(prefix) && RADIUS_INTENT.test(id)) delete overrides[id];
  }
  for (const [id, value] of Object.entries(origin)) {
    if (id.startsWith(prefix) && RADIUS_INTENT.test(id)) overrides[id] = cloneValue(value);
  }
}

function editRadiusRecipe(overrides: ChartStyleSemanticOverrides, ids: readonly string[],
  before: ChartStyleSemanticOverrides, reset: boolean) {
  for (const id of ids) {
    const match = RADIUS_EDIT.exec(id);
    if (!match || !wheelRingRoleForClass(match[2])) continue;
    const recipeId = id.replace(/\.radius$/, '.recipeRadius');
    const authoredId = id.replace(/\.radius$/, '.radiusAuthored');
    const legacyLive = before[`authoring.wheel.${match[1]}.canvas.chart.recipeVersion`] !== 1
      && before[`authoring.wheel.${match[1]}.canvas.chart.radiusPriority`] === wheelRingRoleForClass(match[2]);
    if (reset) {
      if (before[authoredId] === true || legacyLive) {
        captureRadiusRecipe(overrides, before, match[1]);
        if (typeof overrides[recipeId] === 'number') overrides[id] = overrides[recipeId];
        else delete overrides[id];
      } else delete overrides[recipeId];
      delete overrides[authoredId];
      continue;
    }
    captureRadiusRecipe(overrides, before, match[1]);
    if (typeof overrides[id] === 'number') overrides[authoredId] = true;
  }
}

function radiusPriorityEdit(overrides: ChartStyleSemanticOverrides, changedIds: readonly string[],
  radiusTarget?: 'degree' | 'cuspLabels',
  scene?: Pick<ChartStyleEditorState, 'sceneElements' | 'geometryProfile' | 'semanticOverrides'>,
  authoredIds: readonly string[] = changedIds, reset = false): void {
  editRadiusRecipe(overrides, changedIds, scene?.semanticOverrides ?? {}, reset);
  for (const id of changedIds) {
    const match = RADIUS_EDIT.exec(id);
    const role = match ? wheelRingRoleForClass(match[2]) : undefined;
    if (!match || !role) continue;
    const priorityId = `authoring.wheel.${match[1]}.canvas.chart.radiusPriority`;
    if (reset || overrides[id] === undefined) {
      if (overrides[priorityId] === role) delete overrides[priorityId];
    } else overrides[priorityId] = role;
    if (role === 'outerDegreeRing') {
      const bindingId = `authoring.wheel.${match[1]}.canvas.chart.outerDegreeBinding`;
      if (reset || overrides[id] === undefined) delete overrides[bindingId];
      else {
        const authoredTarget = authoredIds.includes(bindingId)
          && (overrides[bindingId] === 'degree' || overrides[bindingId] === 'cuspLabels')
          ? overrides[bindingId] : undefined;
        const sceneTarget = scene?.geometryProfile === match[1]
          ? scene.sceneElements.find(element => element.classId === match[2])
              ?.tokenBindings.find(binding => binding.property === 'radius' && binding.radiusTarget)?.radiusTarget
          : undefined;
        const target = radiusTarget ?? authoredTarget ?? sceneTarget;
        if (target) overrides[bindingId] = target;
      }
    }
  }
}

function wheelGeometryReceipt(presets: WheelPresetsState, profile: WheelTypographyProfile) {
  const draft = presets.drafts[profile];
  const preset = presets.activePresets?.[profile] ?? presets.presets.find(item => item.id === presets.selected[profile]);
  const presetId = draft?.sourcePresetId ?? presets.selected[profile];
  const composition = draft?.composition ?? preset?.composition;
  return presetId && composition ? {presetId, revision: presets.revision,
    sourceThemeName: presets.context?.sourceThemeName,
    overrides: cloneChartStyleOverrides(draft?.overrides ?? preset?.overrides ?? {}),
    appearance: draft?.appearance ?? preset?.appearance,
    appearanceRoles: draft?.appearanceRoles ?? preset?.appearanceRoles, composition} : undefined;
}

export function wheelPresetAppearanceEdits(state: Pick<ChartStyleEditorState,
  'semanticOverrides' | 'resolvedOverrides' | 'tokenMetadata' | 'wheelAppearanceBaseline'>,
  profile: WheelTypographyProfile) {
  const baseline = state.wheelAppearanceBaseline;
  return baseline?.profile === profile ? wheelPresetAppearanceDelta(
    wheelPresetAppearanceForLayout(state.semanticOverrides, profile, state.tokenMetadata), baseline.overrides,
    wheelPresetAppearanceForLayout(state.resolvedOverrides, profile, state.tokenMetadata)) : {};
}

function wheelGeometryReply(state: Pick<ChartStyleEditorState, 'wheelPresetState' | 'wheelGeometryReceipts'>,
  presets: WheelPresetsState, profile: WheelTypographyProfile, acknowledge: boolean) {
  const wheelPresetState = !state.wheelPresetState || presets.revision >= state.wheelPresetState.revision
    ? presets : state.wheelPresetState;
  const staleContext = wheelPresetState.revision > presets.revision && (
    wheelPresetState.selected[profile] !== presets.selected[profile]
    || (wheelPresetState.context && presets.context
      && wheelPresetState.context.sourceThemeName !== presets.context.sourceThemeName));
  const candidate = acknowledge && !staleContext ? wheelGeometryReceipt(presets, profile) : undefined;
  const previous = state.wheelGeometryReceipts[profile];
  const receipt = candidate && (!previous || candidate.revision >= previous.revision) ? candidate : undefined;
  return {wheelPresetState, receipt, wheelGeometryReceipts: receipt
    ? {...state.wheelGeometryReceipts, [profile]: receipt} : state.wheelGeometryReceipts};
}

/** Theme dirtiness compares saved values, never preset ids/revisions or whether
 * a separately saved public geometry has a dirty draft of its own. */
export function themeWheelModified(state: Pick<ChartStyleEditorState,
  'themeWheelBaseline' | 'wheelPresetState' | 'geometryProfile' | 'geometryOverrides' | 'pendingWheelCompositions'>): boolean {
  const baseline = state.themeWheelBaseline;
  const current = state.wheelPresetState;
  if (!baseline || !current) return false;
  const profiles: WheelTypographyProfile[] = ['classic', 'compact', 'anglo', 'houses', 'cusps'];
  if (baseline.geometry?.layout && current.display
    && profiles[current.display.theme] !== baseline.geometry.layout) return true;
  for (const profile of profiles) {
    const design = baseline.geometry?.designs[profile];
    const draft = current.drafts[profile];
    if (!draft) continue;
    const composition = state.pendingWheelCompositions[profile] ?? draft.composition;
    if (design) {
      if (!equalChartStyleOverrides(draft.appearance ?? {}, design.appearance ?? {})) return true;
      const overrides = state.geometryProfile === profile ? state.geometryOverrides : draft.overrides;
      if (!equalChartStyleOverrides(overrides, design.overrides)) return true;
      if (composition.projection !== design.composition.projection
        || composition.rings.length !== design.composition.rings.length) return true;
      for (let index = 0; index < composition.rings.length; index++) {
        const ring = composition.rings[index];
        const saved = design.composition.rings[index];
        // `customized` and revision metadata are not visual changes.
        if (ring.instanceId !== saved.instanceId || ring.archetypeId !== saved.archetypeId
          || ring.chartRole !== saved.chartRole) return true;
        const enabled = baseline.visibility?.[profile]?.[ring.archetypeId] ?? saved.enabled;
        if (ring.enabled !== enabled) return true;
      }
    } else if (baseline.visibility?.[profile]) {
      if (composition.rings.some(ring => baseline.visibility?.[profile]?.[ring.archetypeId] != null
        && ring.enabled !== baseline.visibility[profile]![ring.archetypeId])) return true;
    }
  }
  return false;
}

/**
 * One property edit, as the store applies it: geometry retargeting, family
 * expansion and ring-priority carry included. Pure, so a canvas drag can paint
 * exactly what the edit will become without writing the store on every move.
 */
export function applyOverrideEdit(
  state: ChartStyleEditorState,
  semanticId: string,
  value: StyleLabTokenValue,
  radiusTarget?: 'degree' | 'cuspLabels',
): ChartStyleEditorState | Partial<ChartStyleEditorState> {
  semanticId = geometryEditId(semanticId, state.geometryProfile);
  // With a family selected the same edit is written to every member, so a
  // reading that is read as one thing moves as one thing. The ids differ only
  // in their class segment, so the write is a straight retarget; anything
  // that is not an addressable class id is left alone.
  const targets = expandFamilyOverrideIds(semanticId, state.selectedFamily);
  if (targets.length > 1) {
    const semanticOverrides = { ...state.semanticOverrides };
    const changedIds: string[] = [];
    for (const target of targets) {
      if (radiusUnchanged(state.semanticOverrides, target, value)) continue;
      semanticOverrides[target] = cloneValue(value);
      changedIds.push(target);
    }
    if (!changedIds.length) return state;
    radiusPriorityEdit(semanticOverrides, changedIds, radiusTarget, state);
    return {
      ...overrideState(semanticOverrides, state.tokenMetadata, state.styleLabBaseTheme),
      revision: state.revision + 1,
      activePropertyId: semanticId,
    };
  }
  if (radiusUnchanged(state.semanticOverrides, semanticId, value)) return state;
  const semanticOverrides = {
    ...state.semanticOverrides,
    [semanticId]: cloneValue(value),
  };
  radiusPriorityEdit(semanticOverrides, [semanticId], radiusTarget, state);
  return {
    ...overrideState(semanticOverrides, state.tokenMetadata, state.styleLabBaseTheme),
    revision: state.revision + 1,
    activePropertyId: semanticId,
  };
}

export const useChartStyleEditorStore = create<ChartStyleEditorState>()((set, get) => ({
  active: false,
  liveAppThemePreview: false,
  hoveredElement: null,
  selectedElement: null,
  selectedFamily: null,
  sceneElements: [],
  activePropertyId: null,
  authoringEditScope: "variant",
  editorDomain: "chart",

  recentColors: readStoredRecentColors(),

  semanticOverrides: {},
  resolvedOverrides: {},
  cssOverrides: {},
  syncedOverrides: {},
  geometryOverrides: {},
  geometryProfile: null,
  geometryTransition: false,
  syncedGeometryOverrides: {},
  wheelPresetState: null,
  wheelGeometryReceipts: {},
  wheelAppearanceBaseline: null,
  themeWheelBaseline: null,
  pendingWheelCompositions: {},
  tokenMetadata: {},
  tokenBounds: {},
  revision: 0,
  undoStack: [],
  redoStack: [],
  gestureStart: null,
  gestureOwner: null,

  syncStatus: "connecting",
  syncDetail: null,
  remoteRevision: null,
  remoteEtag: null,
  remoteDraftId: null,
  remoteSourceThemeName: null,
  remoteModifiedFromBaseline: false,
  styleLabBaseTheme: {
    sourceThemeName: null,
    mode: "dark",
    appTokens: {},
    chartPalette: {},
    chartData: {},
    appAuthoring: {},
  },

  setActive: (active) => set((state) => ({
    active,
    hoveredElement: active ? state.hoveredElement : null,
    selectedElement: active ? state.selectedElement : null,
    selectedFamily: active ? state.selectedFamily : null,
    sceneElements: active ? state.sceneElements : [],
    activePropertyId: active ? state.activePropertyId : null,
    gestureStart: active ? state.gestureStart : null,
    gestureOwner: active ? state.gestureOwner : null,
  })),
  setLiveAppThemePreview: (liveAppThemePreview) => set({ liveAppThemePreview }),
  setHoveredElement: (hoveredElement) => set({ hoveredElement }),
  selectElement: (selectedElement) => {
    const defaultBinding = selectedElement && (
      selectedElement.primitive === "line" || selectedElement.primitive === "circle"
    )
      ? selectedElement.tokenBindings.find((binding) => binding.property === "stroke-width") ??
        selectedElement.tokenBindings[0]
      : selectedElement?.tokenBindings[0];
    set({
      selectedElement,
      selectedFamily: null,
      activePropertyId: defaultBinding?.semanticId ?? null,
    });
  },
  selectFamily: (selectedElement, classIds) => set({
    selectedElement,
    selectedFamily: classIds && classIds.length > 1 ? classIds : null,
    activePropertyId: selectedElement?.tokenBindings[0]?.semanticId ?? null,
  }),
  setSceneElements: (sceneElements) => set((state) => {
    const selectedElement = state.selectedElement
      ? sceneElements.find((element) => element.id === state.selectedElement?.id) ?? null
      : null;
    const hoveredElement = state.hoveredElement
      ? sceneElements.find((element) => element.id === state.hoveredElement?.id) ?? null
      : null;
    return { sceneElements, selectedElement, hoveredElement };
  }),
  setActiveProperty: (activePropertyId) => set({ activePropertyId }),
  setAuthoringEditScope: (authoringEditScope) => set((state) => (
    state.authoringEditScope === authoringEditScope
      ? state
      : { authoringEditScope, revision: state.revision + 1 }
  )),
  setEditorDomain: (editorDomain) => set({ editorDomain }),
  // Move-to-front, deduplicated, capped. Recorded when a colour is *committed*
  // to an element, never mid-drag, so the strip holds colours that were chosen
  // rather than every hue the pointer crossed on the way.
  rememberRecentColor: (color) => set((state) => {
    const normalized = color.trim().toLowerCase();
    if (!HEX_COLOR.test(normalized)) return state;
    if (state.recentColors[0] === normalized) return state;
    const rest = state.recentColors.filter((entry) => entry !== normalized);
    const recentColors = [normalized, ...rest].slice(0, RECENT_COLOR_LIMIT);
    // Persisted on change and read once at load: recents outlive a relaunch,
    // as they do in every tool the strip is modelled on.
    writeStoredRecentColors(recentColors);
    return { recentColors };
  }),
  clearSelection: () => set({ selectedElement: null, activePropertyId: null }),
  setTokenMetadata: (tokens) => set((state) => {
    const tokenMetadata = metadataIndex(tokens);
    return {
      tokenMetadata,
      tokenBounds: boundsIndex(tokens),
      ...overrideState(state.semanticOverrides, tokenMetadata, state.styleLabBaseTheme),
    };
  }),

  // A second opener does not nest: the first owner keeps the transaction, so a
  // drag that starts over a focused field cannot take it over.
  beginGesture: (ownerId) => set((state) => (
    state.gestureStart
      ? state
      : {
        gestureStart: cloneChartStyleOverrides(state.semanticOverrides),
        gestureOwner: ownerId,
      }
  )),
  setOverride: (semanticId, value, radiusTarget) => set((state) => applyOverrideEdit(state, semanticId, value, radiusTarget)),
  setFamilyOverrides: (values, activeSemanticId) => set((state) => {
    const semanticOverrides = { ...state.semanticOverrides };
    const changedIds: string[] = [];
    for (const [sourceId, value] of Object.entries(values)) {
      const semanticId = geometryEditId(sourceId, state.geometryProfile);
      if (radiusUnchanged(state.semanticOverrides, semanticId, value)) continue;
      semanticOverrides[semanticId] = cloneValue(value);
      changedIds.push(semanticId);
    }
    if (!changedIds.length) return state;
    radiusPriorityEdit(semanticOverrides, changedIds, undefined, state,
      Object.keys(values).map(id => geometryEditId(id, state.geometryProfile)));
    return {
      ...overrideState(semanticOverrides, state.tokenMetadata, state.styleLabBaseTheme),
      revision: state.revision + 1,
      activePropertyId: activeSemanticId,
    };
  }),
  endGesture: (ownerId) => set((state) => {
    if (!state.gestureStart || state.gestureOwner !== ownerId) return state;
    if (equalChartStyleOverrides(state.gestureStart, state.semanticOverrides)) {
      return { gestureStart: null, gestureOwner: null };
    }
    return {
      undoStack: [...state.undoStack.slice(-(HISTORY_LIMIT - 1)), state.gestureStart],
      redoStack: [],
      gestureStart: null,
      gestureOwner: null,
    };
  }),
  cancelGesture: (ownerId) => set((state) => {
    if (!state.gestureStart || state.gestureOwner !== ownerId) return state;
    const semanticOverrides = cloneChartStyleOverrides(state.gestureStart);
    return {
      ...overrideState(semanticOverrides, state.tokenMetadata, state.styleLabBaseTheme),
      gestureStart: null,
      gestureOwner: null,
      revision: state.revision + 1,
    };
  }),
  restoreGestureProperty: (semanticId, ownerId) => set((state) => {
    if (!state.gestureStart || state.gestureOwner !== ownerId) return state;
    semanticId = geometryEditId(semanticId, state.geometryProfile);
    const semanticOverrides = cloneChartStyleOverrides(state.semanticOverrides);
    const restore = (id: string) => {
      const value = state.gestureStart![id];
      if (value === undefined) delete semanticOverrides[id];
      else semanticOverrides[id] = cloneValue(value);
    };
    restore(semanticId);
    const match = RADIUS_EDIT.exec(semanticId);
    if (match) {
      restore(semanticId.replace(/\.radius$/, '.radiusAuthored'));
      const priorityId = `authoring.wheel.${match[1]}.canvas.chart.radiusPriority`;
      if (semanticOverrides[priorityId] === wheelRingRoleForClass(match[2])) restore(priorityId);
      restoreRadiusRecipeOrigin(semanticOverrides, state.gestureStart, match[1]);
    }
    if (match && wheelRingRoleForClass(match[2]) === 'outerDegreeRing') {
      restore(`authoring.wheel.${match[1]}.canvas.chart.outerDegreeBinding`);
    }
    if (equalChartStyleOverrides(semanticOverrides, state.semanticOverrides)) return state;
    return {...overrideState(semanticOverrides, state.tokenMetadata, state.styleLabBaseTheme), revision: state.revision + 1};
  }),
  resetProperty: (semanticId) => set((state) => {
    semanticId = geometryEditId(semanticId, state.geometryProfile);
    if (!Object.hasOwn(state.semanticOverrides, semanticId)) return state;
    const before = cloneChartStyleOverrides(state.semanticOverrides);
    const semanticOverrides = cloneChartStyleOverrides(state.semanticOverrides);
    delete semanticOverrides[semanticId];
    radiusPriorityEdit(semanticOverrides, [semanticId], undefined, state, undefined, true);
    return {
      ...overrideState(semanticOverrides, state.tokenMetadata, state.styleLabBaseTheme),
      undoStack: [...state.undoStack.slice(-(HISTORY_LIMIT - 1)), before],
      redoStack: [],
      gestureStart: null,
      gestureOwner: null,
      revision: state.revision + 1,
      activePropertyId: semanticId,
    };
  }),
  resetProperties: (semanticIds) => set((state) => {
    const resetIds = [...new Set(semanticIds.map(id => geometryEditId(id, state.geometryProfile)))].filter((semanticId) =>
      Object.hasOwn(state.semanticOverrides, semanticId)
    );
    if (!resetIds.length) return state;
    const before = cloneChartStyleOverrides(state.semanticOverrides);
    const semanticOverrides = cloneChartStyleOverrides(state.semanticOverrides);
    for (const semanticId of resetIds) delete semanticOverrides[semanticId];
    radiusPriorityEdit(semanticOverrides, resetIds, undefined, state, undefined, true);
    return {
      ...overrideState(semanticOverrides, state.tokenMetadata, state.styleLabBaseTheme),
      undoStack: [...state.undoStack.slice(-(HISTORY_LIMIT - 1)), before],
      redoStack: [],
      gestureStart: null,
      gestureOwner: null,
      revision: state.revision + 1,
      activePropertyId: resetIds[0] ?? state.activePropertyId,
    };
  }),
  applyOverrides: (patch) => set((state) => {
    const semanticOverrides = cloneChartStyleOverrides(state.semanticOverrides);
    const changedIds: string[] = [];
    const resetIds: string[] = [];
    for (const [sourceId, value] of Object.entries(patch)) {
      const semanticId = geometryEditId(sourceId, state.geometryProfile);
      if (value === null) {
        if (!Object.hasOwn(semanticOverrides, semanticId)) continue;
        delete semanticOverrides[semanticId];
        resetIds.push(semanticId);
      } else {
        if (radiusUnchanged(state.semanticOverrides, semanticId, value)) continue;
        semanticOverrides[semanticId] = cloneValue(value);
      }
      changedIds.push(semanticId);
    }
    if (!changedIds.length) return state;
    radiusPriorityEdit(semanticOverrides, changedIds.filter(id => !resetIds.includes(id)), undefined, state,
      Object.keys(patch).map(id => geometryEditId(id, state.geometryProfile)));
    radiusPriorityEdit(semanticOverrides, resetIds, undefined, state, undefined, true);
    return {
      ...overrideState(semanticOverrides, state.tokenMetadata, state.styleLabBaseTheme),
      undoStack: [
        ...state.undoStack.slice(-(HISTORY_LIMIT - 1)),
        cloneChartStyleOverrides(state.semanticOverrides),
      ],
      redoStack: [],
      gestureStart: null,
      gestureOwner: null,
      revision: state.revision + 1,
      activePropertyId: changedIds[0] ?? state.activePropertyId,
    };
  }),
  resetAll: () => set((state) => {
    if (!Object.keys(state.semanticOverrides).length) return state;
    return {
      ...overrideState(wheelGeometryOverrides(state.semanticOverrides), state.tokenMetadata, state.styleLabBaseTheme),
      undoStack: [
        ...state.undoStack.slice(-(HISTORY_LIMIT - 1)),
        cloneChartStyleOverrides(state.semanticOverrides),
      ],
      redoStack: [],
      gestureStart: null,
      gestureOwner: null,
      revision: state.revision + 1,
    };
  }),
  undo: () => set((state) => {
    const previous = state.undoStack.at(-1);
    if (!previous) return state;
    const semanticOverrides = cloneChartStyleOverrides(previous);
    return {
      ...overrideState(semanticOverrides, state.tokenMetadata, state.styleLabBaseTheme),
      undoStack: state.undoStack.slice(0, -1),
      redoStack: [
        ...state.redoStack.slice(-(HISTORY_LIMIT - 1)),
        cloneChartStyleOverrides(state.semanticOverrides),
      ],
      gestureStart: null,
      gestureOwner: null,
      revision: state.revision + 1,
    };
  }),
  redo: () => set((state) => {
    const next = state.redoStack.at(-1);
    if (!next) return state;
    const semanticOverrides = cloneChartStyleOverrides(next);
    return {
      ...overrideState(semanticOverrides, state.tokenMetadata, state.styleLabBaseTheme),
      undoStack: [
        ...state.undoStack.slice(-(HISTORY_LIMIT - 1)),
        cloneChartStyleOverrides(state.semanticOverrides),
      ],
      redoStack: state.redoStack.slice(0, -1),
      gestureStart: null,
      gestureOwner: null,
      revision: state.revision + 1,
    };
  }),

  replaceOverrides: (overrides, options) => set((state) => {
    const semanticOverrides = cloneChartStyleOverrides(overrides);
    return {
      ...overrideState(semanticOverrides, state.tokenMetadata, state.styleLabBaseTheme),
      revision: state.revision + 1,
      gestureStart: null,
      gestureOwner: null,
      ...(options?.clearHistory ? { undoStack: [], redoStack: [] } : {}),
    };
  }),
  setSyncedOverrides: (syncedOverrides) => set({
    syncedOverrides: cloneChartStyleOverrides(wheelAppearanceOverrides(syncedOverrides)),
  }),
  acceptRemoteDraft: (draft, options) => set((state) => {
    const remote = cloneChartStyleOverrides(wheelAppearanceOverrides(styleLabDraftEditorOverrides(draft)));
    let semanticOverrides = {...remote, ...wheelGeometryOverrides(state.semanticOverrides)};
    let gestureStart: ChartStyleSemanticOverrides | null = null;
    if (options?.preserveLocalChanges) {
      const rebase = (local: ChartStyleSemanticOverrides): ChartStyleSemanticOverrides => {
        const merged = {...cloneChartStyleOverrides(remote), ...wheelGeometryOverrides(local)};
        for (const semanticId of new Set([...Object.keys(state.syncedOverrides), ...Object.keys(local)])) {
          if (isWheelGeometryKey(semanticId) || sameValue(state.syncedOverrides[semanticId], local[semanticId])) continue;
          const value = local[semanticId];
          if (value === undefined) delete merged[semanticId];
          else merged[semanticId] = cloneValue(value);
        }
        return merged;
      };
      semanticOverrides = rebase(state.semanticOverrides);
      // A revision refresh is not the end of a live numeric/colour gesture.
      // Rebase its origin too, so Escape/Undo keep unrelated remote edits.
      if (!options.clearHistory && state.gestureStart
        && (state.remoteDraftId === draft.id || state.remoteDraftId == null)) {
        gestureStart = rebase(state.gestureStart);
      }
    }
    const resolved = overrideState(semanticOverrides, state.tokenMetadata, state.styleLabBaseTheme);
    return {
      ...resolved,
      ...(state.wheelAppearanceBaseline && state.remoteDraftId !== draft.id ? {
        wheelAppearanceBaseline: {profile: state.wheelAppearanceBaseline.profile,
          overrides: wheelPresetAppearanceForLayout(resolved.semanticOverrides, state.wheelAppearanceBaseline.profile, state.tokenMetadata)},
      } : {}),
      syncedOverrides: remote,
      remoteRevision: draft.revision,
      remoteEtag: draft.etag ?? null,
      remoteDraftId: draft.id,
      remoteSourceThemeName: draft.sourceThemeName ?? null,
      remoteModifiedFromBaseline: Boolean(draft.modifiedFromBaseline),
      themeWheelBaseline: draft.wheelBaseline ?? null,
      syncStatus: equalChartStyleOverrides(remote, wheelAppearanceOverrides(semanticOverrides)) ? "synced" : "saving",
      syncDetail: null,
      revision: state.revision + 1,
      gestureStart,
      gestureOwner: gestureStart ? state.gestureOwner : null,
      ...(options?.clearHistory ? { undoStack: [], redoStack: [] } : {}),
    };
  }),
  acceptWheelPresets: (presets, profile, options) => set((state) => {
    const {wheelPresetState, wheelGeometryReceipts, receipt} = wheelGeometryReply(state, presets, profile,
      options?.acknowledgeGeometry ?? !options?.metadataOnly);
    if (options?.metadataOnly || !receipt) {
      return {wheelPresetState, wheelGeometryReceipts};
    }
    const draft = presets.drafts[profile];
    const preset = presets.activePresets?.[profile] ?? presets.presets.find(item => item.id === presets.selected[profile]);
    const previousPreset = state.wheelPresetState?.activePresets?.[profile]
      ?? state.wheelPresetState?.presets.find(item => item.id === state.wheelPresetState?.selected[profile]);
    const replaced = state.wheelPresetState?.selected[profile] !== presets.selected[profile]
      || (presets.selected[profile]?.startsWith('working.') && !equalChartStyleOverrides(previousPreset?.overrides ?? {}, preset?.overrides ?? {}));
    const remote = cloneChartStyleOverrides(draft?.overrides ?? preset?.overrides ?? {});
    let geometry = remote;
    if (options?.preserveLocalChanges && !replaced && state.geometryProfile === profile) {
      geometry = {...remote};
      for (const id of new Set([...Object.keys(state.syncedGeometryOverrides), ...Object.keys(state.geometryOverrides)])) {
        if (sameValue(state.syncedGeometryOverrides[id], state.geometryOverrides[id])) continue;
        const value = state.geometryOverrides[id];
        if (value === undefined) delete geometry[id];
        else geometry[id] = cloneValue(value);
      }
    }
    const history = options?.clearHistory || replaced || state.geometryProfile !== profile
      ? {undoStack: [], redoStack: [], gestureStart: null, gestureOwner: null} : {};
    const appearanceChanged = Object.keys(wheelPresetAppearanceDelta(
      state.wheelGeometryReceipts[profile]?.appearance ?? {}, receipt.appearance ?? {})).length > 0;
    const appearanceBaseline = options?.appearanceBaseline || options?.clearHistory || replaced || appearanceChanged
      || state.wheelAppearanceBaseline?.profile !== profile
      ? {wheelAppearanceBaseline: {profile,
        overrides: options?.appearanceBaseline ?? wheelPresetAppearanceForLayout(state.semanticOverrides, profile, state.tokenMetadata)}} : {};
    // A ring toggle/order acknowledgement changes composition metadata only.
    // Keep semantic maps stable instead of rebuilding and waking every editor row.
    if (state.geometryProfile === profile && equalChartStyleOverrides(geometry, state.geometryOverrides)) {
      return {wheelPresetState, wheelGeometryReceipts, ...history, ...appearanceBaseline,
        syncedGeometryOverrides: equalChartStyleOverrides(remote, state.syncedGeometryOverrides)
          ? state.syncedGeometryOverrides : remote};
    }
    return {
      ...overrideState({...wheelAppearanceOverrides(state.semanticOverrides), ...geometry}, state.tokenMetadata, state.styleLabBaseTheme),
      geometryProfile: profile, syncedGeometryOverrides: remote, wheelPresetState, wheelGeometryReceipts,
      revision: state.revision + 1, ...history, ...appearanceBaseline,
    };
  }),
  clearWheelGeometryContext: () => set({wheelGeometryReceipts: {}, pendingWheelCompositions: {}, wheelAppearanceBaseline: null}),
  markWheelGeometrySynced: (presets, profile, sent) => set((state) => {
    const {wheelPresetState, wheelGeometryReceipts, receipt} = wheelGeometryReply(state, presets, profile, true);
    return {wheelPresetState, wheelGeometryReceipts,
      ...(receipt && state.geometryProfile === profile ? {syncedGeometryOverrides: cloneChartStyleOverrides(sent)} : {})};
  }),
  setSyncStatus: (syncStatus, syncDetail = null) => set({ syncStatus, syncDetail }),
  setRemoteDraftMeta: (remoteRevision, remoteEtag, remoteDraftId) => set((state) => ({
    remoteRevision,
    remoteEtag,
    remoteDraftId: remoteDraftId === undefined ? state.remoteDraftId : remoteDraftId,
  })),
  // A new base theme changes what every reference resolves to, so the derived
  // maps are rebuilt with it. Without this a token following a role would keep
  // painting the previous theme's colour until the next unrelated edit.
  setStyleLabBaseTheme: (theme) => set((state) => {
    const styleLabBaseTheme = {...theme,
      appTokens: wheelAppearanceOverrides(theme.appTokens),
      chartPalette: wheelAppearanceOverrides(theme.chartPalette)};
    return {styleLabBaseTheme,
      ...overrideState(state.semanticOverrides, state.tokenMetadata, styleLabBaseTheme)};
  }),
  markSynced: (draft, overrides) => {
    const desired = cloneChartStyleOverrides(wheelAppearanceOverrides(overrides ?? get().semanticOverrides));
    set({
      syncedOverrides: desired,
      remoteRevision: draft.revision,
      remoteEtag: draft.etag ?? null,
      remoteDraftId: draft.id,
      remoteSourceThemeName: draft.sourceThemeName ?? null,
      remoteModifiedFromBaseline: Boolean(draft.modifiedFromBaseline),
      themeWheelBaseline: draft.wheelBaseline ?? null,
      syncStatus: "synced",
      syncDetail: null,
    });
  },
}));

export function chartStyleCssValue(cssVar: string): string | undefined {
  return useChartStyleEditorStore.getState().cssOverrides[cssVar];
}
