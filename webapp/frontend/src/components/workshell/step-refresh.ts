// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import * as React from "react";

import type { DaemonWorkspaceState } from "@/stores/daemon-workspace-store";

// Retained data is deliberately lower priority than the chart's visible step
// lane.  This window is outside ordinary native key-repeat cadence; resident
// lists still follow by viewport on every frame and only daemon recalculation
// waits for quiet.
export const STEP_SETTLE_REFRESH_MS = 320;

export type WorkspaceSessionChange = NonNullable<DaemonWorkspaceState["lastSessionChange"]>;
export type WorkspaceOptionsChange = NonNullable<DaemonWorkspaceState["lastOptionsChange"]>;

type RefreshSeqArgs = {
  documentId: string;
  parentDocumentId?: string | null;
  lastSessionChange: WorkspaceSessionChange | null;
  lastOptionsChange: WorkspaceOptionsChange | null;
  refreshOnAnySessionChange?: boolean;
  refreshOnInspectorDataChange?: boolean;
  debounceStepMs?: number;
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

function sessionTouchesIds(
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

/**
 * Secondary surfaces should not compete with chart stepping. Chart snapshots are
 * painted immediately from the navigate POST; tables/companions refresh after a
 * step burst settles, while non-step changes and options remain immediate.
 */
export function useSettledWorkspaceRefreshState({
  documentId,
  parentDocumentId,
  lastSessionChange,
  lastOptionsChange,
  refreshOnAnySessionChange = false,
  refreshOnInspectorDataChange = false,
  debounceStepMs = STEP_SETTLE_REFRESH_MS,
}: RefreshSeqArgs): WorkspaceSemanticRefreshState {
  const ids = React.useMemo(
    () => [documentId, parentDocumentId].filter(nonEmpty),
    [documentId, parentDocumentId],
  );
  const scopeKey = React.useMemo(
    () => `${refreshOnAnySessionChange ? "any" : "ids"}\u0000${ids.join("\u0000")}`,
    [ids, refreshOnAnySessionChange],
  );
  const sessionTouched = sessionTouchesIds(lastSessionChange, ids, refreshOnAnySessionChange);
  const sessionStepSeq =
    sessionTouched && lastSessionChange?.changeReason === "step"
      ? lastSessionChange.seq
      : 0;
  const immediateSessionSeq =
    sessionTouched && lastSessionChange?.changeReason !== "step"
      ? (lastSessionChange?.seq ?? 0)
      : 0;
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

  React.useEffect(() => {
    if (pendingStepSeq === 0 || pendingStepSeq <= settledStepSeq) return;
    const timer = window.setTimeout(() => {
      setSettledStep((current) => ({
        scopeKey,
        seq: current.scopeKey === scopeKey
          ? Math.max(current.seq, pendingStepSeq)
          : pendingStepSeq,
      }));
    }, debounceStepMs);
    return () => window.clearTimeout(timer);
  }, [scopeKey, pendingStepSeq, settledStepSeq, debounceStepMs]);

  return nextRefreshState;
}

export function useSettledWorkspaceRefreshSeq(args: RefreshSeqArgs): number {
  return workspaceSemanticRefreshSeq(useSettledWorkspaceRefreshState(args));
}

/**
 * Holds fast-changing per-document values, such as displayDatetime, steady
 * during step bursts. This keeps inspector/companion fetches from aborting and
 * restarting on every keystroke, then catches them up once stepping settles.
 */
export function useStepSettledValue<T>(
  value: T,
  documentId: string | null | undefined,
  lastSessionChange: WorkspaceSessionChange | null,
  debounceStepMs = STEP_SETTLE_REFRESH_MS,
): T {
  const [settledValue, setSettledValue] = React.useState(value);
  const stepSeq =
    documentId &&
    lastSessionChange?.changeReason === "step" &&
    (lastSessionChange.docId === documentId ||
      lastSessionChange.rebuiltChildIds.includes(documentId))
      ? lastSessionChange.seq
      : 0;

  React.useEffect(() => {
    const timer = window.setTimeout(() => {
      setSettledValue(value);
    }, stepSeq === 0 ? 0 : debounceStepMs);
    return () => window.clearTimeout(timer);
  }, [value, stepSeq, debounceStepMs]);

  return stepSeq === 0 ? value : settledValue;
}
