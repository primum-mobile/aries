// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import * as React from "react";

import type { DaemonWorkspaceState } from "@/stores/daemon-workspace-store";

export const STEP_SETTLE_REFRESH_MS = 220;

export type WorkspaceSessionChange = NonNullable<DaemonWorkspaceState["lastSessionChange"]>;
export type WorkspaceOptionsChange = NonNullable<DaemonWorkspaceState["lastOptionsChange"]>;

type RefreshSeqArgs = {
  documentId: string;
  parentDocumentId?: string | null;
  lastSessionChange: WorkspaceSessionChange | null;
  lastOptionsChange: WorkspaceOptionsChange | null;
  refreshOnAnySessionChange?: boolean;
  debounceStepMs?: number;
};

function nonEmpty(value: string | null | undefined): value is string {
  return typeof value === "string" && value.length > 0;
}

function sessionTouchesIds(
  change: WorkspaceSessionChange | null,
  ids: readonly string[],
  refreshOnAnySessionChange: boolean,
): boolean {
  if (!change) return false;
  if (refreshOnAnySessionChange) return true;
  if (change.docId && ids.includes(change.docId)) return true;
  return change.rebuiltChildIds.some((id) => ids.includes(id));
}

function optionsTouchIds(
  change: WorkspaceOptionsChange | null,
  ids: readonly string[],
): boolean {
  if (!change) return false;
  if (change.refreshedDocumentIds.length === 0) return true;
  return change.refreshedDocumentIds.some((id) => ids.includes(id));
}

/**
 * Secondary surfaces should not compete with chart stepping. Chart snapshots are
 * painted immediately from the navigate POST; tables/companions refresh after a
 * step burst settles, while non-step changes and options remain immediate.
 */
export function useSettledWorkspaceRefreshSeq({
  documentId,
  parentDocumentId,
  lastSessionChange,
  lastOptionsChange,
  refreshOnAnySessionChange = false,
  debounceStepMs = STEP_SETTLE_REFRESH_MS,
}: RefreshSeqArgs): number {
  const ids = React.useMemo(
    () => [documentId, parentDocumentId].filter(nonEmpty),
    [documentId, parentDocumentId],
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
  const optionsSeq = optionsTouchIds(lastOptionsChange, ids)
    ? (lastOptionsChange?.seq ?? 0)
    : 0;
  const [settledStepSeq, setSettledStepSeq] = React.useState(0);

  React.useEffect(() => {
    if (sessionStepSeq === 0) return;
    const timer = window.setTimeout(() => {
      setSettledStepSeq(sessionStepSeq);
    }, debounceStepMs);
    return () => window.clearTimeout(timer);
  }, [sessionStepSeq, debounceStepMs]);

  return immediateSessionSeq + optionsSeq + settledStepSeq;
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
