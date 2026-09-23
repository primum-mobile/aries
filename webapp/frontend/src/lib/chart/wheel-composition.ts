// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later
import registry from './wheel-ring-archetypes.json';
import factorySettings from './wheel-factory-v1.json';
import type { WheelTypographyProfile } from './wheel-render-style';
export const WHEEL_RING_ARCHETYPES = registry;
function freezeFactory<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freezeFactory(child);
    Object.freeze(value);
  }
  return value;
}
/** Original layout definitions; options and authoring operate on working copies. */
export const WHEEL_FACTORY_SETTINGS = freezeFactory(factorySettings);
export type WheelRingArchetypeId = keyof typeof registry;
export type WheelRingInstance = Readonly<{
  instanceId: string;
  archetypeId: WheelRingArchetypeId;
  enabled: boolean;
  chartRole: 'primary' | 'outer';
}>;
export type WheelComposition = Readonly<{
  schemaVersion: 1;
  projection: 'zodiac' | 'houses';
  rings: readonly WheelRingInstance[];
  customized?: boolean;
}>;
export type WheelCompositions = Partial<Record<WheelTypographyProfile, WheelComposition>>;
export function ringEnabled(composition: WheelComposition | undefined, kind: WheelRingArchetypeId, fallback = true): boolean {
  return composition ? composition.rings.some(ring => ring.archetypeId === kind && ring.enabled) : fallback;
}

/** Shared capability rules used only to present legal Settings actions. Python
 * repeats validation at the canonical mutation boundary. */
export function compatibleRingOrder(composition: WheelComposition): boolean {
  const rings = composition.rings.filter(r => r.enabled);
  const body = rings.findIndex(r => r.archetypeId === 'bodies');
  return rings.every((ring, index) => {
    const constraint = WHEEL_RING_ARCHETYPES[ring.archetypeId].containment;
    if (constraint === 'innermost') return index === rings.length - 1;
    if (ring.chartRole === 'outer' && rings.slice(0, index).some(r => r.chartRole === 'primary')) return false;
    if (body < 0) return true;
    return constraint === 'outside-points' || constraint === 'comparison-outside-primary' ? index < body
      : constraint === 'inside-points' ? index > body : true;
  });
}

/** A UI reorder intent. Instance identity keeps widths attached to their ring;
 * the daemon still validates the resulting composition before persisting it. */
export function moveWheelRing(composition: WheelComposition, sourceId: string, targetId: string): WheelComposition | null {
  const from = composition.rings.findIndex(ring => ring.instanceId === sourceId);
  const to = composition.rings.findIndex(ring => ring.instanceId === targetId);
  if (from < 0 || to < 0 || composition.rings[from].archetypeId === 'hub'
    || composition.rings[to].archetypeId === 'hub') return null;
  if (from === to) return composition;
  const rings = [...composition.rings];
  const [ring] = rings.splice(from, 1);
  rings.splice(to, 0, ring);
  const next = {...composition, rings};
  return compatibleRingOrder(next) ? next : null;
}
