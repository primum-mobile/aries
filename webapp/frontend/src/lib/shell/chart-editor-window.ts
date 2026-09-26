// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later
import type {EditTarget} from '@/components/workshell/chart-editor-dialog';
import {safeShellUnlisten} from './unlisten';

export const EDITOR_REQUEST = 'aries://chart-editor-request';
export const EDITOR_REPLY = 'aries://chart-editor-reply';
export const EDITOR_CONTEXT = 'aries://chart-editor-context';
export const EDITOR_CLOSED = 'aries://chart-editor-closed';
export const EDITOR_WINDOW_WIDTH = 640;
export const EDITOR_WINDOW_MAX_HEIGHT = 540;
export type EditorWindowContext = {id: string; editTarget: EditTarget | null};
export type EditorWindowAction =
  | {kind: 'context'}
  | {kind: 'flush-notes'}
  | {kind: 'notes-changed'}
  | {kind: 'saved'; name: string; collection: string; recordIndex: number | null};
export type EditorWindowRequest = {id: string; action: EditorWindowAction};
type EditorWindowReply = {id: string; context?: EditorWindowContext; error?: string};

export async function requestEditorWindowAction(action: EditorWindowAction): Promise<EditorWindowContext | undefined> {
  const {listen, emitTo} = await import('@tauri-apps/api/event');
  const id = crypto.randomUUID();
  let stop: (() => void) | undefined;
  let done = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('Chart editor host did not respond')), 30_000);
      void listen<EditorWindowReply>(EDITOR_REPLY, ({payload}) => {
        if (payload.id !== id) return;
        if (payload.error) reject(new Error(payload.error));
        else resolve(payload.context);
      }).then(unlisten => {
        if (done) { safeShellUnlisten(unlisten); return; }
        stop = unlisten;
        return emitTo('main', EDITOR_REQUEST, {id, action} satisfies EditorWindowRequest);
      }).catch(reject);
    });
  } finally { done = true; clearTimeout(timer); safeShellUnlisten(stop); }
}

export async function flushEditorNotes() {
  const awaitFlush: Promise<unknown>[] = [];
  window.dispatchEvent(new CustomEvent('aries://flush-notes', {detail: {awaitFlush}}));
  if (awaitFlush.length) await Promise.allSettled(awaitFlush);
}
export function notifyEditorNotesChanged() {
  window.dispatchEvent(new CustomEvent('aries://notes-changed'));
}
