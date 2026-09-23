'use client';
// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later
import { useT } from '@/lib/i18n/i18n';
import { useCallback, useRef, useState } from 'react';
import { WHEEL_RING_ARCHETYPES, type WheelComposition } from '@/lib/chart/wheel-composition';
import { createWheelCompositionWriter } from '@/lib/daemon/wheel-preset-sync';
import { WheelPresetApiError } from '@/lib/daemon/wheel-presets-client';
import type { WheelTypographyProfile } from '@/lib/chart/wheel-render-style';
import { useChartStyleEditorStore } from '@/stores/chart-style-editor-store';
import { WheelCompositionControls } from './wheel-composition-controls';

/** Settings and the editor share the same composition writer and ring list.
 * Width gestures remain in the canonical editor geometry transaction. */
export function WheelCompositionInspector({profile}: {profile: WheelTypographyProfile}) {
  const t = useT();
  const composition = useChartStyleEditorStore(state => state.wheelPresetState?.drafts[profile]?.composition);
  const ready = useChartStyleEditorStore(state => state.geometryProfile === profile && !state.geometryTransition);
  const values = useChartStyleEditorStore(state => state.semanticOverrides);
  const setOverride = useChartStyleEditorStore(state => state.setOverride);
  const resetProperty = useChartStyleEditorStore(state => state.resetProperty);
  const beginGesture = useChartStyleEditorStore(state => state.beginGesture);
  const endGesture = useChartStyleEditorStore(state => state.endGesture);
  const elements = useChartStyleEditorStore(state => state.sceneElements);
  const selectedElementId = useChartStyleEditorStore(state => state.selectedElement?.id);
  const selectElement = useChartStyleEditorStore(state => state.selectElement);
  const [previews, setPreviews] = useState<Partial<Record<WheelTypographyProfile, WheelComposition | null>>>({});
  const [failure, setFailure] = useState<'error' | 'conflict' | null>(null);
  const writers = useRef(new Map<WheelTypographyProfile, ReturnType<typeof createWheelCompositionWriter>>());
  const writeComposition = useCallback((next: WheelComposition) => {
    if (!writers.current.has(profile)) writers.current.set(profile, createWheelCompositionWriter(profile,
      preview => setPreviews(previous => ({...previous, [profile]: preview}))));
    void writers.current.get(profile)!(next).then(() => setFailure(null)).catch(error => {
      setFailure(error instanceof WheelPresetApiError && error.status === 409 ? 'conflict' : 'error');
    });
  }, [profile]);
  if (!composition) return null;
  return <fieldset disabled={!ready}>
    <WheelCompositionControls profile={profile} composition={previews[profile] ?? composition}
      onChange={writeComposition}
      selectedRingId={selectedElementId?.startsWith('wheel.composition.') ? selectedElementId.slice('wheel.composition.'.length) : undefined}
      onSelectRing={ring => {
        const element = elements.find(item => item.id === `wheel.composition.${ring.instanceId}`);
        if (element) selectElement(element);
      }}
      renderRingControls={ring => {
        const spec = WHEEL_RING_ARCHETYPES[ring.archetypeId];
        const id = `authoring.wheel.${profile}.canvas.ring.${ring.instanceId}.bandWidth`;
        const value = values[id];
        const element = elements.find(item => item.id === `wheel.composition.${ring.instanceId}`);
        const resolved = element?.authoringDefaults?.bandWidthPx;
        const binding = element?.handles.find(handle => handle.binding?.semanticId === id)?.binding;
        const minimum = binding?.min ?? spec.minWidth;
        const maximum = binding?.max ?? 400;
        return <input data-aries-surface="control" type="number" min={minimum} max={maximum} step={1}
          className="w-14 bg-transparent" aria-label={t('wheelComposition.width')} title={t(spec.labelKey)}
          disabled={!ready || !ring.enabled || !binding}
          placeholder={t('wheelComposition.automatic')}
          onFocus={() => beginGesture('wheel-width')}
          onBlur={() => endGesture('wheel-width')}
          value={typeof value === 'number' ? Math.min(maximum, Math.max(minimum, value)) : resolved != null ? Math.round(resolved * 10) / 10 : ''}
          onChange={event => {
            if (event.target.value === '') resetProperty(id);
            else setOverride(id, Math.min(maximum, Math.max(minimum, Number(event.target.value))));
          }} />;
      }} />
    {failure && <p role="status">{t(`wheelPreset.${failure}`)}</p>}
  </fieldset>;
}
