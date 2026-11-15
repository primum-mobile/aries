// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { StyleLabTokenValue } from "./client";
import { isWheelGeometryKey } from "@/lib/chart/wheel-geometry-ownership";
import {
  WHEEL_AUTHORING_OVERRIDE_PREFIX,
  type WheelAuthoringEditScope,
  type WheelAuthoringFlatProperty,
} from "./wheel-authoring-adapter";

export type StyleTransferControl = Readonly<{
  semanticId: string;
  property: string;
  /** Token value type; a colour only ever travels as RGB(A) or a role alias. */
  kind?: "color" | "number" | "font-family";
  value: StyleLabTokenValue;
}>;

function writableColor(value: StyleLabTokenValue): boolean {
  if (typeof value === "string") return /^\{[^{}]+\}$/.test(value);
  return Array.isArray(value) && (value.length === 3 || value.length === 4)
    && value.slice(0, 3).every((channel) => Number.isInteger(channel) && channel >= 0 && channel <= 255);
}

export type ElementStyleClipboard = Readonly<{
  sourceClassId: string;
  sourceLabel: string;
  sourceProfile: Exclude<WheelAuthoringEditScope, "base">;
  entries: readonly Readonly<{
    slot: string;
    value: StyleLabTokenValue;
  }>[];
}>;

export type ParsedWheelAuthoringOverride = Readonly<{
  scope: WheelAuthoringEditScope;
  classId: string;
  property: WheelAuthoringFlatProperty;
}>;

const WHEEL_SCOPES = new Set<WheelAuthoringEditScope>([
  "base",
  "classic",
  "compact",
  "anglo",
  "houses",
  "cusps",
]);

const WHEEL_PROPERTIES = new Set<WheelAuthoringFlatProperty>([
  "fontRef",
  "fontWeight",
  "fontStyle",
  "fontSize",
  "tracking",
  "color",
  "strokeWidth",
  "strokeStyle",
  "dashLength",
  "dashGap",
  "fillPattern",
  "shadowPattern",
  "cellSize",
  "dotSize",
  "backgroundColor",
  "patternColor",
  "gradientType",
  "gradientDirection",
  "gradientStartColor",
  "gradientEndColor",
  "gradientAngle",
  "textureMask",
  "maskDirection",
  "maskAngle",
  "maskAmount",
  "shadowColor",
  "shadowX",
  "shadowY",
  "shadowBlur",
  "density",
  "angle",
  "seed",
  "opacity",
  "lineCap",
  "lineJoin",
  "radius",
]);

export function isWheelAuthoringFlatProperty(
  value: string,
): value is WheelAuthoringFlatProperty {
  return WHEEL_PROPERTIES.has(value as WheelAuthoringFlatProperty);
}

function cloneValue(value: StyleLabTokenValue): StyleLabTokenValue {
  return Array.isArray(value) ? [...value] : value;
}

function sameValue(left: StyleLabTokenValue, right: StyleLabTokenValue): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function parseWheelAuthoringOverrideId(
  semanticId: string,
): ParsedWheelAuthoringOverride | null {
  if (!semanticId.startsWith(WHEEL_AUTHORING_OVERRIDE_PREFIX)) return null;
  const remainder = semanticId.slice(WHEEL_AUTHORING_OVERRIDE_PREFIX.length);
  const scopeSeparator = remainder.indexOf(".");
  const propertySeparator = remainder.lastIndexOf(".");
  if (scopeSeparator <= 0 || propertySeparator <= scopeSeparator + 1) return null;
  const scope = remainder.slice(0, scopeSeparator) as WheelAuthoringEditScope;
  const classId = remainder.slice(scopeSeparator + 1, propertySeparator);
  const property = remainder.slice(propertySeparator + 1) as WheelAuthoringFlatProperty;
  if (!WHEEL_SCOPES.has(scope) || !classId || !WHEEL_PROPERTIES.has(property)) return null;
  return { scope, classId, property };
}

function transferSlot(control: StyleTransferControl): string {
  const authoring = parseWheelAuthoringOverrideId(control.semanticId);
  if (authoring) return `authoring:${authoring.property}`;

  const layerEffect = control.semanticId.match(
    /^renderer\.wheel\.metric\.(?:geometry|dynamic|outerLabel)(.+)$/,
  );
  if (layerEffect?.[1]) return `layer-effect:${layerEffect[1].toLocaleLowerCase()}`;

  return `binding:${control.property}`;
}

/**
 * Controls grouped by what they mean. Size and position (geometry) never
 * travel: copying a band's look must not move or resize the target. A generic
 * binding slot shared by unrelated tokens is ambiguous and dropped; an
 * authoring property shown twice (a band and its fill class) is one slot.
 */
function transferSlots(
  controls: readonly StyleTransferControl[],
): Map<string, StyleTransferControl[]> {
  const slots = new Map<string, StyleTransferControl[]>();
  for (const control of controls) {
    if (isWheelGeometryKey(control.semanticId)) continue;
    const slot = transferSlot(control);
    slots.set(slot, [...(slots.get(slot) ?? []), control]);
  }
  for (const [slot, members] of slots) {
    if (!slot.startsWith("authoring:") && members.length > 1) slots.delete(slot);
  }
  return slots;
}

export function copyElementStyle(
  source: Omit<ElementStyleClipboard, "entries">,
  controls: readonly StyleTransferControl[],
): ElementStyleClipboard {
  return {
    ...source,
    entries: [...transferSlots(controls)].map(([slot, [control]]) => ({
      slot,
      value: cloneValue(control.value),
    })),
  };
}

export function buildElementStylePastePatch(
  clipboard: ElementStyleClipboard,
  targetControls: readonly StyleTransferControl[],
): Record<string, StyleLabTokenValue> {
  const sourceValues = new Map(clipboard.entries.map((entry) => [entry.slot, entry.value]));
  const patch: Record<string, StyleLabTokenValue> = {};
  for (const [slot, controls] of transferSlots(targetControls)) {
    const value = sourceValues.get(slot);
    if (value === undefined) continue;
    for (const control of controls) {
      // A value the target cannot store is never sent: one bad key would
      // reject the whole write.
      if (control.kind === "color" && !writableColor(value)) continue;
      if (control.kind === "number" && (typeof value !== "number" || !Number.isFinite(value))) continue;
      if (!sameValue(value, control.value)) patch[control.semanticId] = cloneValue(value);
    }
  }
  return patch;
}

/**
 * Give each target wheel style the source style's look for one class. The
 * look is what the source paints: its own per-style edit, else the edit shared
 * by all wheel styles, else the factory value. A target that already shows
 * that value is left alone; a target whose own edit masks it gets the value,
 * or loses its edit (null) when the source shows the factory value.
 */
export function buildWheelVariantSyncPatch(
  overrides: Readonly<Record<string, StyleLabTokenValue>>,
  options: Readonly<{
    classId: string;
    source: Exclude<WheelAuthoringEditScope, "base">;
    targets: readonly Exclude<WheelAuthoringEditScope, "base">[];
    allowedProperties: Readonly<
      Partial<
        Record<
          Exclude<WheelAuthoringEditScope, "base">,
          ReadonlySet<WheelAuthoringFlatProperty>
        >
      >
    >;
  }>,
): Record<string, StyleLabTokenValue | null> {
  const classProperties = (scope: WheelAuthoringEditScope) => {
    const prefix = `${WHEEL_AUTHORING_OVERRIDE_PREFIX}${scope}.${options.classId}.`;
    return new Map(Object.entries(overrides).flatMap(([semanticId, value]) => {
      if (!semanticId.startsWith(prefix)) return [];
      const parsed = parseWheelAuthoringOverrideId(semanticId);
      return parsed ? [[parsed.property, value] as const] : [];
    }));
  };
  const shared = classProperties("base");
  const source = classProperties(options.source);
  const patch: Record<string, StyleLabTokenValue | null> = {};
  for (const target of new Set(options.targets)) {
    if (target === options.source) continue;
    const allowed = options.allowedProperties[target];
    if (!allowed) continue;
    const own = classProperties(target);
    for (const property of new Set([...shared.keys(), ...source.keys(), ...own.keys()])) {
      if (!allowed.has(property)) continue;
      const desired = source.get(property) ?? shared.get(property);
      const shown = own.get(property) ?? shared.get(property);
      if (desired === undefined ? shown === undefined : shown !== undefined && sameValue(shown, desired)) continue;
      const semanticId = `${WHEEL_AUTHORING_OVERRIDE_PREFIX}${target}.${options.classId}.${property}`;
      // With no shared edit, dropping the target's own edit shows the factory
      // value, which is what the source shows.
      patch[semanticId] = desired === undefined ? null : cloneValue(desired);
    }
  }
  return patch;
}

export type WheelClassSyncScope = Readonly<{
  classId: string;
  targets: readonly Exclude<WheelAuthoringEditScope, "base">[];
  allowedProperties: Readonly<
    Partial<
      Record<
        Exclude<WheelAuthoringEditScope, "base">,
        ReadonlySet<WheelAuthoringFlatProperty>
      >
    >
  >;
}>;

/** Sync every class at once: the whole wheel's look onto the other wheel styles. */
export function buildWholeWheelSyncPatch(
  overrides: Readonly<Record<string, StyleLabTokenValue>>,
  source: Exclude<WheelAuthoringEditScope, "base">,
  classes: readonly WheelClassSyncScope[],
): Record<string, StyleLabTokenValue | null> {
  return Object.assign({}, ...classes.map((scope) => buildWheelVariantSyncPatch(overrides, {
    ...scope,
    source,
  })));
}
