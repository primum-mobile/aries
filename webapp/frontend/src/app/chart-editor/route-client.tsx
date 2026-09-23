// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';
import {useCallback, useState} from 'react';
import {ChartEditorSurface} from '@/components/workshell/chart-editor-dialog';
import {ThemeProvider} from '@/components/workshell/theme-provider';
import {EDITOR_CONTEXT, requestEditorWindowAction, type EditorWindowContext} from '@/lib/shell/chart-editor-window';
import {useToolWindowIntent, useRevealToolWindow} from '@/lib/shell/tool-window-lifecycle';
const host = {
  beforeLoad: () => requestEditorWindowAction({kind: 'flush-notes'}),
  notesChanged: () => requestEditorWindowAction({kind: 'notes-changed'}),
};
const report = (error: unknown) => console.error('[chart-editor-window]', error);

export function ChartEditorRouteClient() {
  const intent = useToolWindowIntent<EditorWindowContext>(EDITOR_CONTEXT, 'aries://chart-editor-hidden');
  const [retained, setRetained] = useState<EditorWindowContext>();
  const [readyGeneration, setReadyGeneration] = useState(-1);
  const open = intent?.open ?? false;
  if (intent?.context && intent.context !== retained) setRetained(intent.context);
  const context = intent?.context ?? retained;
  const onReady = useCallback(() => setReadyGeneration(intent?.generation ?? -1), [intent?.generation]);
  useRevealToolWindow('show_chart_editor_window', intent, readyGeneration === intent?.generation);
  const onOpenChange = useCallback((next: boolean) => {
    if (!next) void import('@tauri-apps/api/core').then(({invoke}) => invoke('hide_chart_editor_window')).catch(report);
  }, []);
  const onSaved = useCallback(async (name: string, collection: string, recordIndex: number | null) => {
    await requestEditorWindowAction({kind: 'saved', name, collection, recordIndex});
  }, []);
  return <ThemeProvider>{context && <ChartEditorSurface key={context.id} open={open} nativeWindow
    editTarget={context.editTarget} onSaved={onSaved} onOpenChange={onOpenChange} onReady={onReady} host={host} />}</ThemeProvider>;
}
