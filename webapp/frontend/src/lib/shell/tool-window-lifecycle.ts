// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';
import {useEffect, useLayoutEffect, useRef, useState} from 'react';
import {resolveShellHost} from '@/lib/shell-host';
import {SETTINGS_WINDOW_WIDTH} from './settings-window';
import {EDITOR_WINDOW_WIDTH, EDITOR_WINDOW_MAX_HEIGHT} from './chart-editor-window';

export type ToolWindowIntent<T> = {generation: number; open: boolean; context: T | null};
export function newerToolWindowIntent<T>(current: ToolWindowIntent<T> | null, next: ToolWindowIntent<T>) {
  return !current || next.generation > current.generation ? next : current;
}

/** Native intent is retained before webview construction, so an open that
 * arrives during preparation cannot disappear before JS installs its listener. */
export function useToolWindowIntent<T>(openEvent: string, hiddenEvent = openEvent) {
  const [intent, setIntent] = useState<ToolWindowIntent<T> | null>(null);
  useEffect(() => {
    let disposed = false;
    const cleanup: (() => void)[] = [];
    const accept = (next: ToolWindowIntent<T>) => {
      if (!disposed) setIntent(current => newerToolWindowIntent(current, next));
    };
    void (async () => {
      const {listen} = await import('@tauri-apps/api/event');
      for (const event of new Set([openEvent, hiddenEvent])) {
        const stop = await listen<ToolWindowIntent<T>>(event, ({payload}) => accept(payload));
        if (disposed) { stop(); return; }
        cleanup.push(stop);
      }
      const {invoke} = await import('@tauri-apps/api/core');
      accept(await invoke<ToolWindowIntent<T>>('get_tool_window_intent'));
    })().catch(error => console.error('[tool-window-intent]', error));
    return () => { disposed = true; cleanup.forEach(stop => stop()); };
  }, [openEvent, hiddenEvent]);
  return intent;
}

/** The popup stays rendered while its OS window is hidden. Reveal only after
 * React has committed the requested content; never await rAF in a hidden webview. */
export function useRevealToolWindow(command: string, intent: ToolWindowIntent<unknown> | null, ready: boolean) {
  const shown = useRef(-1);
  useLayoutEffect(() => {
    if (!intent?.open || !ready || shown.current === intent.generation) return;
    const generation = intent.generation;
    shown.current = generation;
    void import('@tauri-apps/api/core').then(({invoke}) => invoke(command, {generation}))
      .catch(error => { shown.current = -1; console.error('[tool-window-reveal]', error); });
  }, [command, intent, ready]);
}

let prepared: Promise<void> | null = null;
export function prewarmToolWindows(settingsTitle: string, editorTitle: string) {
  if (resolveShellHost().kind !== 'tauri') return Promise.resolve();
  if (prepared) return prepared;
  prepared = (async () => {
    const {invoke} = await import('@tauri-apps/api/core');
    // Use the same CSS budgets as the live hosts, once, outside the open path.
    const measure = (width: string, height: string) => {
      const probe = document.createElement('div');
      probe.style.cssText = `position:fixed;visibility:hidden;pointer-events:none;width:min(var(--aries-dialog-viewport-width),calc(100vw - var(--aries-dialog-viewport-inset)),var(${width}));height:${height}`;
      document.body.append(probe);
      const box = probe.getBoundingClientRect();
      probe.remove();
      return {width: box.width, height: box.height};
    };
    await invoke('open_settings_window', {prewarm: true, tab: 'appearance', title: settingsTitle,
      ...measure('--aries-dialog-width-workspace', 'min(var(--aries-dialog-viewport-height),calc(var(--aries-dialog-content-height-workspace) + var(--aries-dialog-padding) + var(--aries-pane-header-padding-y) + var(--aries-font-size-large) + var(--aries-sash-rule-size)))'), width: SETTINGS_WINDOW_WIDTH});
    await import('@/components/workshell/chart-editor-dialog');
    const editorSize = measure('--aries-dialog-width-lg', 'min(var(--aries-dialog-viewport-height),var(--aries-dialog-content-height-workspace))');
    await invoke('open_chart_editor_window', {prewarm: true, context: null, title: editorTitle,
      width: EDITOR_WINDOW_WIDTH, height: Math.min(editorSize.height, EDITOR_WINDOW_MAX_HEIGHT)});
  })().catch(error => { prepared = null; throw error; });
  return prepared;
}
