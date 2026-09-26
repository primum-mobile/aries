// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';
import {useEffect, useMemo, useRef} from 'react';
import type {ChartEditorProps} from './chart-editor-dialog';
import {useT} from '@/lib/i18n/i18n';
import {EDITOR_REQUEST, EDITOR_REPLY, EDITOR_CLOSED, flushEditorNotes, notifyEditorNotesChanged,
  EDITOR_WINDOW_WIDTH, EDITOR_WINDOW_MAX_HEIGHT, type EditorWindowRequest, type EditorWindowContext} from '@/lib/shell/chart-editor-window';

/** Keep workspace callbacks here; the native form calls the same daemon editor APIs. */
export function ChartEditorWindowHost(props: ChartEditorProps) {
  const latest = useRef(props);
  useEffect(() => { latest.current = props; });
  const t = useT();
  const title = t(props.editTarget?.eventOwnerDocumentId ? 'chartEvents.save' : props.editTarget?.cursorDocId ? 'editor.titleCursor' : props.editTarget ? 'editor.titleEdit' : 'editor.titleNew');
  const context = useMemo<EditorWindowContext>(() => ({id: crypto.randomUUID(), editTarget: props.editTarget ?? null}), [props.editTarget, props.open]);
  const contextRef = useRef(context);
  useEffect(() => { contextRef.current = context; }, [context]);
  const ready = useRef<Promise<void>>(Promise.resolve());
  useEffect(() => {
    let disposed = false;
    const cleanup: (() => void)[] = [];
    ready.current = (async () => {
      const {listen, emitTo} = await import('@tauri-apps/api/event');
      const stopRequest = await listen<EditorWindowRequest>(EDITOR_REQUEST, async ({payload: {id, action}}) => {
        try {
          switch (action.kind) {
            case 'flush-notes': await flushEditorNotes(); break;
            case 'notes-changed': notifyEditorNotesChanged(); break;
            case 'saved': await latest.current.onSaved(action.name, action.collection, action.recordIndex); break;
          }
          await emitTo('chart-editor', EDITOR_REPLY, {id, context: action.kind === 'context' ? contextRef.current : undefined});
        } catch (error) { await emitTo('chart-editor', EDITOR_REPLY, {id, error: String(error)}); }
      });
      if (disposed) { stopRequest(); return; }
      cleanup.push(stopRequest);
      const stopClosed = await listen(EDITOR_CLOSED, () => latest.current.onOpenChange(false));
      if (disposed) { stopClosed(); return; }
      cleanup.push(stopClosed);
    })();
    return () => {
      disposed = true;
      cleanup.forEach(stop => stop());
      void import('@tauri-apps/api/core').then(({invoke}) => invoke('hide_chart_editor_window')).catch(console.error);
    };
  }, []);
  useEffect(() => {
    if (!props.open) {
      void import('@tauri-apps/api/core').then(({invoke}) => invoke('hide_chart_editor_window')).catch(console.error);
      return;
    }
    let disposed = false;
    void ready.current.then(async () => {
      if (disposed) return;
      const probe = document.createElement('div');
      probe.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;width:min(var(--aries-dialog-viewport-width),calc(100vw - var(--aries-dialog-viewport-inset)),var(--aries-dialog-width-lg));height:min(var(--aries-dialog-viewport-height),var(--aries-dialog-content-height-workspace))';
      document.body.append(probe);
      const {height} = probe.getBoundingClientRect();
      probe.remove();
      const {invoke} = await import('@tauri-apps/api/core');
      if (!disposed) await invoke('open_chart_editor_window', {
        title, width: EDITOR_WINDOW_WIDTH, height: Math.min(height, EDITOR_WINDOW_MAX_HEIGHT), context,
      });
    }).catch(error => console.error('[chart-editor-window]', error));
    return () => { disposed = true; };
  }, [context, title, props.open]);
  return null;
}
