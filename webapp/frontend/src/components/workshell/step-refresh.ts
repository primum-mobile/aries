// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import * as React from "react";

import { useStepBurst } from "@/lib/chart/step-burst";
import { useDaemonWorkspaceStore, type DaemonWorkspaceState } from "@/stores/daemon-workspace-store";

// Retained data is deliberately lower priority than the chart's visible step
// lane. Resident lists still follow by viewport on every frame; daemon
// recalculation waits for the step burst's completion edge (release + drain,
// lib/chart/step-burst.ts), never for a quiet-window timer.

export type WorkspaceSessionChange = NonNullable<DaemonWorkspaceState["lastSessionChange"]>;
export type WorkspaceOptionsChange = NonNullable<DaemonWorkspaceState["lastOptionsChange"]>;

type RefreshSeqArgs = {
  documentId: string;
  parentDocumentId?: string | null;
  comparisonDocumentId?: string | null;
  relatedDocumentIds?: readonly string[];
  lastSessionChange: WorkspaceSessionChange | null;
  lastOptionsChange: WorkspaceOptionsChange | null;
  refreshOnAnySessionChange?: boolean;
  refreshOnInspectorDataChange?: boolean;
};

export type WorkspaceSemanticRefreshState = Readonly<{
  scopeKey: string;
  immediateSessionSeq: number;
  optionsSeq: number;
  pendingStepSeq: number;
  settledStepSeq: number;
}>;

export type WorkspaceSemanticRefreshInput = Readonly<{
  scopeKey: string;
  immediateSessionSeq: number;
  optionsSeq: number;
  stepSeq: number;
  settledStepSeq: number;
}>;

function emptySemanticRefreshState(scopeKey: string): WorkspaceSemanticRefreshState {
  return {
    scopeKey,
    immediateSessionSeq: 0,
    optionsSeq: 0,
    pendingStepSeq: 0,
    settledStepSeq: 0,
  };
}

/**
 * Retains only semantic refresh cursors. The workspace stores expose the latest
 * event on each channel, so a renderer-only event may replace an earlier
 * semantic event. Treating the latest raw event as the refresh key would then
 * make the key fall back to zero and refresh retained surfaces anyway.
 */
export function advanceWorkspaceSemanticRefreshState(
  current: WorkspaceSemanticRefreshState,
  input: WorkspaceSemanticRefreshInput,
): WorkspaceSemanticRefreshState {
  const scoped = current.scopeKey === input.scopeKey
    ? current
    : emptySemanticRefreshState(input.scopeKey);
  const next: WorkspaceSemanticRefreshState = {
    scopeKey: input.scopeKey,
    immediateSessionSeq: Math.max(
      scoped.immediateSessionSeq,
      input.immediateSessionSeq,
    ),
    optionsSeq: Math.max(scoped.optionsSeq, input.optionsSeq),
    pendingStepSeq: Math.max(scoped.pendingStepSeq, input.stepSeq),
    settledStepSeq: Math.max(scoped.settledStepSeq, input.settledStepSeq),
  };
  return (
    next.immediateSessionSeq === scoped.immediateSessionSeq &&
    next.optionsSeq === scoped.optionsSeq &&
    next.pendingStepSeq === scoped.pendingStepSeq &&
    next.settledStepSeq === scoped.settledStepSeq
  )
    ? scoped
    : next;
}

export function workspaceSemanticRefreshSeq(
  state: WorkspaceSemanticRefreshState,
): number {
  return (
    Math.max(state.immediateSessionSeq, state.settledStepSeq) +
    state.optionsSeq
  );
}

function nonEmpty(value: string | null | undefined): value is string {
  return typeof value === "string" && value.length > 0;
}

export function sessionTouchesIds(
  change: WorkspaceSessionChange | null,
  ids: readonly string[],
  refreshOnAnySessionChange: boolean,
): boolean {
  if (!change || change.listDataChanged === false) return false;
  if (refreshOnAnySessionChange) return true;
  if (change.docId && ids.includes(change.docId)) return true;
  return change.rebuiltChildIds.some((id) => ids.includes(id));
}

export function optionsTouchIds(
  change: WorkspaceOptionsChange | null,
  ids: readonly string[],
  refreshOnInspectorDataChange: boolean,
): boolean {
  if (
    !change ||
    change.styleOnly === true ||
    (
      change.listDataChanged === false &&
      !(refreshOnInspectorDataChange && change.inspectorDataChanged)
    )
  ) {
    return false;
  }
  if (change.refreshedDocumentIds.length === 0) return true;
  return change.refreshedDocumentIds.some((id) => ids.includes(id));
}

/** Already classified by the daemon store; never restart at zero on remount. */
export function useRetainedListOptionsRevision(): number {
  return useDaemonWorkspaceStore((state) => state.lastRetainedDataOptionsChange?.seq ?? 0);
}

/** For a list whose rows never read houses or cusps: a house-system switch is
 * not a new revision, so the list neither refetches nor moves. */
export function useHouseFreeListOptionsRevision(): number {
  return useDaemonWorkspaceStore((state) => state.lastHouseFreeListOptionsChange?.seq ?? 0);
}

/** Durable semantic revisions survive batched events and unmounted panes.
 * Cursor steps and display-only changes are deliberately excluded by the store.
 */
export function useRetainedListRevision(ids: readonly (string | null | undefined)[], any = false): number {
  return useDaemonWorkspaceStore((state) => {
    const revisions = state.listDataRevisionByDocument;
    return Math.max(0, ...(any ? Object.values(revisions) : ids.map((id) => id ? revisions[id] ?? 0 : 0)));
  });
}

/** For lists whose rows read the radix itself: the durable revision plus steps
 * that replaced the radix. The store changes it once per step burst, on its
 * completion edge, so no subscriber re-renders per step. */
export function useRadixListRevision(ids: readonly (string | null | undefined)[]): number {
  return useDaemonWorkspaceStore((state) => {
    const revisions = state.radixListDataRevisionByDocument;
    return Math.max(0, ...ids.map((id) => id ? revisions[id] ?? 0 : 0));
  });
}

/**
 * Secondary surfaces should not compete with chart stepping. Chart snapshots are
 * painted immediately from the navigate POST; tables/companions refresh once on
 * the step burst's completion edge, while non-step changes and options remain
 * immediate.
 */
export function useSettledWorkspaceRefreshState({
  documentId,
  parentDocumentId,
  comparisonDocumentId,
  relatedDocumentIds,
  lastSessionChange,
  lastOptionsChange,
  refreshOnAnySessionChange = false,
  refreshOnInspectorDataChange = false,
}: RefreshSeqArgs): WorkspaceSemanticRefreshState {
  const ids = React.useMemo(
    () => [...new Set([documentId, parentDocumentId, comparisonDocumentId, ...(relatedDocumentIds ?? [])].filter(nonEmpty))],
    [documentId, parentDocumentId, comparisonDocumentId, relatedDocumentIds],
  );
  const scopeKey = React.useMemo(
    () => `${refreshOnAnySessionChange ? "any" : "ids"}\u0000${ids.join("\u0000")}`,
    [ids, refreshOnAnySessionChange],
  );
  const sessionTouched = sessionTouchesIds(lastSessionChange, ids, refreshOnAnySessionChange);
  const sessionStepSeq =
    sessionTouched && lastSessionChange?.changeReason === "step"
      && !lastSessionChange.stepEcho
      ? lastSessionChange.seq
      : 0;
  const durableSessionSeq = useRetainedListRevision(ids, refreshOnAnySessionChange);
  const immediateSessionSeq = Math.max(durableSessionSeq,
    sessionTouched && lastSessionChange?.changeReason !== "step"
      ? (lastSessionChange?.seq ?? 0)
      : 0);
  const optionsSeq = optionsTouchIds(
    lastOptionsChange,
    ids,
    refreshOnInspectorDataChange,
  )
    ? (lastOptionsChange?.seq ?? 0)
    : 0;
  const [settledStep, setSettledStep] = React.useState({
    scopeKey,
    seq: 0,
  });
  const settledStepSeq = settledStep.scopeKey === scopeKey ? settledStep.seq : 0;
  const refreshInput: WorkspaceSemanticRefreshInput = {
    scopeKey,
    immediateSessionSeq,
    optionsSeq,
    stepSeq: sessionStepSeq,
    settledStepSeq,
  };
  const [refreshState, setRefreshState] = React.useState<WorkspaceSemanticRefreshState>(
    () => advanceWorkspaceSemanticRefreshState(
      emptySemanticRefreshState(scopeKey),
      refreshInput,
    ),
  );
  const nextRefreshState = advanceWorkspaceSemanticRefreshState(
    refreshState,
    refreshInput,
  );
  if (nextRefreshState !== refreshState) {
    setRefreshState(nextRefreshState);
  }
  const pendingStepSeq = nextRefreshState.pendingStepSeq;
  const { active: stepBurstActive } = useStepBurst();
  // Settle on the burst's completion edge, in the same render that sees it.
  if (!stepBurstActive && pendingStepSeq > settledStepSeq) {
    setSettledStep({ scopeKey, seq: pendingStepSeq });
  }

  return nextRefreshState;
}

export function useSettledWorkspaceRefreshSeq(args: RefreshSeqArgs): number {
  return workspaceSemanticRefreshSeq(useSettledWorkspaceRefreshState(args));
}

/**
 * Holds fast-changing values, such as displayDatetime, steady while a step
 * burst is active. This keeps inspector/companion fetches from aborting and
 * restarting on every keystroke, then catches them up on the completion edge.
 */
export function useStepSettledValue<T>(value: T): T {
  const { active } = useStepBurst();
  const [settledValue, setSettledValue] = React.useState(value);
  if (!active && !Object.is(settledValue, value)) setSettledValue(value);
  return active ? settledValue : value;
}
