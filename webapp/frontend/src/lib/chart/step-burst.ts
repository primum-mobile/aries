// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import * as React from "react";

/**
 * The chart step burst, as seen by every surface other than the wheel.
 *
 * home-client owns the envelope: a burst is active from its first step until
 * every held step key is released AND the step queue has drained. That is the
 * one completion edge. Retained lists, tables and Inspector sections wait for
 * it instead of inferring "the user stopped" from a quiet-window timer, which
 * both misfired between slow taps (refetching into the next step) and added
 * a fixed delay after a real release.
 *
 * The wheel, hover flag and focused Inspector object stay live per step
 * through the step snapshot (lib/live-surfaces.ts); they never wait for this.
 */
export type StepBurstState = Readonly<{
  active: boolean;
  /** Bumps on every completion edge. */
  idleSeq: number;
}>;

let state: StepBurstState = { active: false, idleSeq: 0 };
const listeners = new Set<() => void>();
// Final cursor of every document stepped since the last completion edge, then
// of the completed burst. The daemon's trailing `session.changed` for that
// final step can arrive after the edge; it carries nothing new for surfaces
// that already refreshed on the edge.
let burstCursors = new Map<string, string | null>();
let settledCursors = new Map<string, string | null>();

function publish(next: StepBurstState): void {
  state = next;
  for (const listener of listeners) listener();
}

export function beginStepBurst(): void {
  if (state.active) return;
  burstCursors = new Map();
  publish({ active: true, idleSeq: state.idleSeq });
}

export function noteStepBurstCursor(documentId: string, displayDatetime: string | null): void {
  burstCursors.set(documentId, displayDatetime);
}

export function endStepBurst(): void {
  if (!state.active) return;
  settledCursors = burstCursors;
  burstCursors = new Map();
  publish({ active: false, idleSeq: state.idleSeq + 1 });
}

export function isStepBurstActive(): boolean {
  return state.active;
}

/** True for the late daemon echo of a completed burst's final cursor. */
export function isSettledStepEcho(documentId: string | null, displayDatetime: string | null | undefined): boolean {
  if (state.active || documentId == null || displayDatetime === undefined) return false;
  return settledCursors.has(documentId) && settledCursors.get(documentId) === displayDatetime;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Outside React: hear every burst start and completion edge. */
export const subscribeStepBurst = subscribe;

function snapshot(): StepBurstState {
  return state;
}

export function useStepBurst(): StepBurstState {
  return React.useSyncExternalStore(subscribe, snapshot, snapshot);
}
