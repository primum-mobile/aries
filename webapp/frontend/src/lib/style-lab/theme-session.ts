// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

// Edits paint live and are written to the daemon's working copy as you go (so
// a crash loses nothing, and each theme keeps its unsaved edits); Save writes
// the working copy into the theme. The draft's baseline is the last saved
// theme, which is what "Revert to saved" returns to.

import {
  commitCurrentStyleLabDraft,
  patchCurrentStyleLabDraft,
  waitForStyleDraftWrites,
  type StyleLabDraft,
  type StyleLabTokenValue,
} from "@/lib/style-lab/client";
import { refreshStyleDraftForSave } from "@/lib/style-lab/prepare-save";
import { wheelAppearanceOverrides } from "@/lib/chart/wheel-geometry-ownership";
import { enqueueWheelPresetWrite, flushWheelGeometry } from "@/lib/daemon/wheel-preset-sync";
import { checkedStyleLabSaveContext } from "@/lib/daemon/wheel-theme-transition";
import {
  cloneChartStyleOverrides,
  themeWheelModified,
  useChartStyleEditorStore,
  type ChartStyleSemanticOverrides,
} from "@/stores/chart-style-editor-store";

export function persistedStyleOverrides(
  overrides: Readonly<ChartStyleSemanticOverrides>,
): ChartStyleSemanticOverrides {
  return cloneChartStyleOverrides(wheelAppearanceOverrides(overrides));
}

export function syncDelta(
  previous: Readonly<ChartStyleSemanticOverrides>,
  next: Readonly<ChartStyleSemanticOverrides>,
): Record<string, StyleLabTokenValue | null> {
  const result: Record<string, StyleLabTokenValue | null> = {};
  for (const semanticId of new Set([...Object.keys(previous), ...Object.keys(next)])) {
    if (JSON.stringify(previous[semanticId]) === JSON.stringify(next[semanticId])) continue;
    const value = next[semanticId];
    result[semanticId] = value == null ? null : Array.isArray(value) ? [...value] : value;
  }
  return result;
}

/** A refusal of an intermediate value must not undo or block a newer edit. */
export function styleLabPatchIsSuperseded(
  patch: Readonly<Record<string, StyleLabTokenValue | null>>,
  current: Readonly<ChartStyleSemanticOverrides>,
): boolean {
  return Object.entries(patch).some(([id, value]) =>
    JSON.stringify(value) !== JSON.stringify(current[id] ?? null)
  );
}

let saving: Promise<StyleLabDraft | null> | null = null;

/** Write the working copy into its theme. Resolves to null when nothing changed. */
export function saveWorkingTheme(conflictMessage: string): Promise<StyleLabDraft | null> {
  saving ??= save(conflictMessage).finally(() => {
    saving = null;
  });
  return saving;
}

async function save(conflictMessage: string): Promise<StyleLabDraft | null> {
  if (useChartStyleEditorStore.getState().remoteRevision == null) return null;
  await waitForStyleDraftWrites();
  await flushWheelGeometry();
  const draft = await enqueueWheelPresetWrite(async () => {
    const current = await refreshStyleDraftForSave(conflictMessage);
    const desired = persistedStyleOverrides(current.semanticOverrides);
    const delta = syncDelta(current.syncedOverrides, desired);
    if (!Object.keys(delta).length && !current.remoteModifiedFromBaseline && !themeWheelModified(current)) {
      return null;
    }
    let revision = current.remoteRevision!;
    if (Object.keys(delta).length) {
      const patched = await patchCurrentStyleLabDraft(
        { draftId: current.remoteDraftId ?? undefined, baseRevision: revision, overrides: delta },
        current.remoteEtag,
      );
      useChartStyleEditorStore.getState().markSynced(patched, desired);
      revision = patched.revision;
    }
    return commitCurrentStyleLabDraft({ baseRevision: revision, activate: false,
      ...await checkedStyleLabSaveContext(conflictMessage) });
  });
  if (draft) useChartStyleEditorStore.getState().acceptRemoteDraft(draft, { preserveLocalChanges: true });
  return draft;
}
