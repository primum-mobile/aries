// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { StyleLabTokenValue } from "./client";
import {
  WHEEL_AUTHORING_OVERRIDE_PREFIX,
  type WheelAuthoringEditScope,
  type WheelAuthoringFlatProperty,
} from "./wheel-authoring-adapter";

export type StyleTransferControl = Readonly<{
  semanticId: string;
  property: string;
  value: StyleLabTokenValue;
}>;

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
]);

const WHEEL_PROPERTIES = new Set<WheelAuthoringFlatProperty>([
  "fontRef",
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

function uniqueControlSlots(
  controls: readonly StyleTransferControl[],
): Map<string, StyleTransferControl> {
  const slots = new Map<string, StyleTransferControl | null>();
  for (const control of controls) {
    const slot = transferSlot(control);
    slots.set(slot, slots.has(slot) ? null : control);
  }
  return new Map(
    [...slots.entries()].flatMap(([slot, control]) =>
      control ? [[slot, control] as const] : []
    ),
  );
}

export function copyElementStyle(
  source: Omit<ElementStyleClipboard, "entries">,
  controls: readonly StyleTransferControl[],
): ElementStyleClipboard {
  return {
    ...source,
    entries: [...uniqueControlSlots(controls)].map(([slot, control]) => ({
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
  for (const [slot, control] of uniqueControlSlots(targetControls)) {
    const value = sourceValues.get(slot);
    if (value === undefined || sameValue(value, control.value)) continue;
    patch[control.semanticId] = cloneValue(value);
  }
  return patch;
}

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
): Record<string, StyleLabTokenValue> {
  const sourcePrefix = `${WHEEL_AUTHORING_OVERRIDE_PREFIX}${options.source}.${options.classId}.`;
  const sourceEntries = Object.entries(overrides).flatMap(([semanticId, value]) => {
    if (!semanticId.startsWith(sourcePrefix)) return [];
    const parsed = parseWheelAuthoringOverrideId(semanticId);
    return parsed ? [[parsed.property, value] as const] : [];
  });
  const patch: Record<string, StyleLabTokenValue> = {};
  for (const target of new Set(options.targets)) {
    if (target === options.source) continue;
    const allowed = options.allowedProperties[target];
    if (!allowed) continue;
    for (const [property, value] of sourceEntries) {
      if (!allowed.has(property)) continue;
      const semanticId = `${WHEEL_AUTHORING_OVERRIDE_PREFIX}${target}.${options.classId}.${property}`;
      const current = overrides[semanticId];
      if (current !== undefined && sameValue(current, value)) continue;
      patch[semanticId] = cloneValue(value);
    }
  }
  return patch;
}
