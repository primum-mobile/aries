// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later
"use client";

import * as React from "react";
import { fetchGenericTablePayload, type GenericTablePayload } from "@/lib/daemon/client";
import { getCachedGenericTablePayload, rememberGenericTablePayload } from "./payload-cache";
import { createRetainedListRequests } from "./retained-list-requests";

/** Effects and binding/option commands use the same replacement lane. */
export function useRetainedTablePayload(
  tableId: string,
  documentId: string,
  refreshSeq: number,
  focusDatetime?: string | null,
  includeTemporal = false,
) {
  const cacheId = includeTemporal ? `${tableId}:temporal` : tableId;
  const [payload, setPayload] = React.useState<GenericTablePayload | null>(
    () => getCachedGenericTablePayload(cacheId, documentId),
  );
  const [error, setError] = React.useState<string | null>(null);
  // Old callbacks keep their old owner, so an awaited command cannot revive a
  // request belonging to a closed pane or a different chart/table.
  const [requests] = React.useState(() => createRetainedListRequests<GenericTablePayload>());
  const refresh = React.useCallback(async (before?: () => Promise<unknown>) => {
    const request = requests.replace();
    try {
      if (before) await before();
      if (!request.current()) return null;
      const next = await fetchGenericTablePayload(
        tableId, documentId, request.signal, focusDatetime, includeTemporal,
      );
      if (!request.publish(next)) return null;
      rememberGenericTablePayload(cacheId, documentId, next);
      setPayload(next);
      setError(null);
      return next;
    } catch (err) {
      if (request.current()) setError(err instanceof Error ? err.message : String(err));
      return null;
    } finally {
      request.finish();
    }
  }, [cacheId, documentId, focusDatetime, includeTemporal, requests, tableId]);
  React.useEffect(() => {
    let active = true;
    queueMicrotask(() => { if (active) void refresh(); });
    return () => { active = false; requests.cancel(); };
  }, [refresh, refreshSeq, requests]);
  return { payload, error, refresh };
}
