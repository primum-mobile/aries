'use client';
// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { CopyPlus, RotateCcw, Save, Trash2 } from 'lucide-react';
import type { WheelComposition } from '@/lib/chart/wheel-composition';
import { createWheelCompositionWriter, enqueueWheelPresetWrite, flushWheelGeometry, waitForWheelPresetWrites } from '@/lib/daemon/wheel-preset-sync';
import type { WheelTypographyProfile } from '@/lib/chart/wheel-render-style';
import { WheelCompositionControls } from './wheel-composition-controls';
import { fetchWheelPresets, mutateWheelPreset, WheelPresetApiError, type WheelPresetMutation } from '@/lib/daemon/wheel-presets-client';
import { useT } from '@/lib/i18n/i18n';
import { useDaemonWorkspaceStore } from '@/stores/daemon-workspace-store';
import { equalChartStyleOverrides, useChartStyleEditorStore } from '@/stores/chart-style-editor-store';

let wheelPresetTransitions = 0;

/** One local gesture, then one revisioned wheel-draft patch. Theme appearance drafts never
 * receive these flat values; selecting or saving a preset remains a daemon action. */
export function WheelPresetControls({profile, surface = 'editor', beforeAction}: {
  profile: WheelTypographyProfile;
  surface?: 'editor' | 'settings';
  beforeAction?: () => Promise<void>;
}) {
  const t = useT();
  const presets = useChartStyleEditorStore(state => state.wheelPresetState);
  const geometry = useChartStyleEditorStore(state => state.geometryOverrides);
  const synced = useChartStyleEditorStore(state => state.syncedGeometryOverrides);
  const loadedProfile = useChartStyleEditorStore(state => state.geometryProfile);
  const gesture = useChartStyleEditorStore(state => state.gestureStart);
  const [pendingAction, setPendingAction] = useState<WheelPresetMutation['action'] | null>(null);
  const busy = pendingAction !== null;
  const geometryBusy = pendingAction !== null && pendingAction !== 'save';
  const [compositionPreview, setCompositionPreview] = useState<Partial<Record<WheelTypographyProfile, WheelComposition | null>>>({});
  const compositionWriters = useRef(new Map<WheelTypographyProfile, ReturnType<typeof createWheelCompositionWriter>>());
  const writeComposition = useCallback((composition: WheelComposition) => {
    if (!compositionWriters.current.has(profile)) compositionWriters.current.set(profile,
      createWheelCompositionWriter(profile, composition => setCompositionPreview(previous => ({...previous, [profile]: composition}))));
    return compositionWriters.current.get(profile)!(composition);
  }, [profile]);
  const notifiedRevision = useDaemonWorkspaceStore(state => state.lastOptionsChange?.wheelPresetRevision);
  const [failure, setFailure] = useState<'error' | 'conflict' | null>(null);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const context = useRef({profile, generation: 0});
  useLayoutEffect(() => {
    if (context.current.profile !== profile) {
      context.current = {profile, generation: context.current.generation + 1};
    }
  }, [profile]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selected = presets?.activePresets?.[profile] ?? presets?.presets.find(item => item.id === presets.selected[profile]);
  const choices = presets?.presets ?? [];
  const selectedId = selected?.id.startsWith('working.') ? `factory.${profile}` : presets?.selected[profile] ?? '';
  const listed = Boolean(selected && presets?.presets.some(item => item.id === selected.id));
  const pending = loadedProfile === profile && !equalChartStyleOverrides(geometry, synced);
  const dirty = Boolean(presets?.drafts[profile]?.dirty) || pending;
  const canOverwrite = Boolean(selected && listed && !selected.factory);
  // Settings can edit a different layout from the parked Style Lab variant.
  // Share the catalog without retargeting that editor's live geometry draft.
  const metadataOnly = useCallback(() => surface === 'settings'
    && useChartStyleEditorStore.getState().geometryProfile !== profile, [surface, profile]);

  const recordFailure = useCallback((error: unknown) => {
    setFailure(error instanceof WheelPresetApiError && error.status === 409 ? 'conflict' : 'error');
  }, []);

  const flush = useCallback(async () => {
    await flushWheelGeometry();
    setFailure(null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await flush();
      const result = await fetchWheelPresets();
      if (!cancelled) useChartStyleEditorStore.getState().acceptWheelPresets(result, profile,
        {preserveLocalChanges: true, metadataOnly: metadataOnly()});
    })().catch(error => { if (!cancelled) recordFailure(error); });
    return () => { cancelled = true; };
  }, [flush, profile, recordFailure, metadataOnly]);

  useEffect(() => {
    if (gesture || notifiedRevision == null || notifiedRevision <= (presets?.revision ?? -1)) return;
    let cancelled = false;
    void (async () => {
      // The mutation reply already contains this revision. Its broadcast can
      // arrive first; do not turn that acknowledgement into another GET.
      await waitForWheelPresetWrites();
      if (cancelled || notifiedRevision <= (useChartStyleEditorStore.getState().wheelPresetState?.revision ?? -1)) return;
      const result = await fetchWheelPresets();
      if (!cancelled) useChartStyleEditorStore.getState().acceptWheelPresets(result, profile,
        {preserveLocalChanges: true, metadataOnly: metadataOnly()});
    })().catch(error => { if (!cancelled) recordFailure(error); });
    return () => { cancelled = true; };
  }, [gesture, notifiedRevision, presets?.revision, profile, recordFailure, metadataOnly]);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (pending && !gesture && !failure) {
      timer.current = setTimeout(() => { void flush().catch(recordFailure); }, 250);
    }
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [failure, flush, geometry, gesture, pending, recordFailure, synced]);

  useEffect(() => () => {
    context.current.generation += 1;
    if (timer.current) clearTimeout(timer.current);
    void flush().catch(recordFailure);
  }, [flush, recordFailure]);

  const perform = async (action: WheelPresetMutation['action'], extras: Pick<WheelPresetMutation, 'presetId' | 'name' | 'composition'> = {}) => {
    if (gesture || busy) return;
    const generation = context.current.generation;
    const transition = action === 'select' || action === 'revert' || action === 'restore-factory' || action === 'delete';
    if (timer.current) clearTimeout(timer.current);
    setPendingAction(action);
    if (transition) {
      wheelPresetTransitions += 1;
      useChartStyleEditorStore.setState({geometryTransition: true});
    }
    try {
      await beforeAction?.();
      await flush();
      await enqueueWheelPresetWrite(async () => {
        if (beforeAction) {
          const latest = await fetchWheelPresets();
          useChartStyleEditorStore.getState().acceptWheelPresets(latest, profile, {metadataOnly: true});
        }
        const current = useChartStyleEditorStore.getState().wheelPresetState;
        if (!current || context.current.generation !== generation) return;
        const targetProfile = action === 'select' && surface === 'settings'
          ? current.presets.find(item => item.id === extras.presetId)?.layout ?? profile : profile;
        await mutateWheelPreset({action, layout: targetProfile, activateLayout: action === 'select' && surface === 'settings', baseRevision: current.revision, ...extras}).then(result => {
          const currentContext = context.current.generation === generation;
          useChartStyleEditorStore.getState().acceptWheelPresets(result, profile,
            currentContext
              ? {clearHistory: transition, preserveLocalChanges: action === 'save', metadataOnly: metadataOnly()}
              : {metadataOnly: true});
          if (!currentContext) return;
          setFailure(null);
          setNaming(false);
          setName('');
        });
      });
    } catch (error) { recordFailure(error); }
    finally {
      if (transition) {
        wheelPresetTransitions -= 1;
        useChartStyleEditorStore.setState({geometryTransition: wheelPresetTransitions > 0});
      }
      setPendingAction(null);
    }
  };
  const saveAs = (event: FormEvent) => {
    event.preventDefault();
    if (name.trim()) void perform('save', {name: name.trim()});
  };
  const buttonClass = 'inline-flex h-7 items-center gap-1 rounded-[var(--aries-radius-control-compact)] border border-[color:var(--aries-inspector-divider-color)] px-2 disabled:opacity-30';
  return <section className="mb-2 space-y-1 text-[length:var(--aries-font-size-small)]">
    <label className="flex items-center gap-2">
      <span>{t('wheelPreset.title')}</span>
      <select data-aries-surface="control" className="min-w-0 flex-1 bg-transparent" value={selectedId}
        disabled={busy || Boolean(gesture) || !presets} aria-label={t('wheelPreset.title')}
        onChange={event => void perform('select', {presetId: event.target.value})}>
        {selected && !choices.some(item => item.id === selectedId) && <option value={selected.id}>{t('wheelPreset.custom')}</option>}
        {!presets && <option value="">{t('styleLab.status.connecting')}</option>}
        {choices.filter(item => surface === 'settings' || item.layout === profile).map(item => <option key={item.id} value={item.id}>
          {item.factory ? t(`styleLab.variant.${item.layout}`)
            : item.name}{item.id === selectedId && dirty ? ' *' : ''}
        </option>)}
      </select>
    </label>
    <p className="text-[length:var(--aries-font-size-micro)] text-[color:var(--aries-inspector-muted-color)]">{t('wheelPreset.geometryScope')}</p>
    <div className="flex flex-wrap gap-1">
      <button type="button" className={buttonClass}
        disabled={busy || Boolean(gesture) || !dirty}
        onClick={() => canOverwrite
          ? void perform('save', {presetId: selected?.id})
          : setNaming(true)}>
        <Save size={12} />{t('wheelPreset.save')}
      </button>
      <button type="button" className={buttonClass} disabled={busy || !selected} onClick={() => setNaming(!naming)}>
        <CopyPlus size={12} />{t('wheelPreset.saveAs')}
      </button>
      <button type="button" className={buttonClass} disabled={busy || Boolean(gesture) || !dirty}
        onClick={() => void perform('revert')}><RotateCcw size={12} />{t('wheelPreset.revert')}</button>
      <button type="button" className={buttonClass}
        disabled={busy || Boolean(gesture) || !selected || (selected.factory && !dirty)}
        onClick={() => void perform('restore-factory')}><RotateCcw size={12} />{t('wheelPreset.restoreOriginal')}</button>
      <button type="button" className={buttonClass} disabled={busy || !selected || !listed || selected.factory}
        title={t('wheelPreset.delete')} aria-label={t('wheelPreset.delete')}
        onClick={() => void perform('delete', {presetId: selected?.id})}><Trash2 size={12} /></button>
    </div>
    {naming && <form onSubmit={saveAs} className="flex flex-wrap items-center gap-1">
      <input data-aries-surface="control" maxLength={80} className="min-w-0 flex-1 bg-transparent" value={name} onChange={event => setName(event.target.value)}
        aria-label={t('wheelPreset.name')} placeholder={t('wheelPreset.name')} />
      <button className={buttonClass} disabled={busy || !name.trim()}>{t('wheelPreset.save')}</button>
      <button type="button" className={buttonClass} onClick={() => setNaming(false)}>{t('picker.cancel')}</button>
    </form>}
    {failure && <div role="status" className="flex items-center gap-2">
      <span>{t(`wheelPreset.${failure}`)}</span>
      <button type="button" className={buttonClass} disabled={busy} onClick={() => {
        const generation = context.current.generation;
        void fetchWheelPresets().then(result => {
          const currentContext = context.current.generation === generation;
          useChartStyleEditorStore.getState().acceptWheelPresets(result, profile,
            currentContext ? {preserveLocalChanges: true, metadataOnly: metadataOnly()} : {metadataOnly: true});
          if (currentContext) setFailure(null);
        }).catch(recordFailure);
      }}>{t('wheelPreset.retry')}</button>
    </div>}
    {surface === 'settings' && presets?.drafts[profile] && <fieldset disabled={geometryBusy || Boolean(gesture) || Boolean(failure)}>
      <WheelCompositionControls profile={profile} composition={compositionPreview[profile] ?? presets.drafts[profile]!.composition}
        onChange={composition => { void writeComposition(composition).then(() => setFailure(null)).catch(recordFailure); }} />
    </fieldset>}
  </section>;
}
