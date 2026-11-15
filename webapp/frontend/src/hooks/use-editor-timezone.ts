// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import * as React from "react";
import { resolveEditorTimezone, type EditorTimezone } from "@/lib/daemon/client";

/** Keep replies scoped to the exact location/date, including across hide/show. */
export function useEditorTimezone(request: string | null, active: boolean) {
  const [result, setResult] = React.useState<{
    request: string;
    zone: EditorTimezone | null;
    error: unknown;
  } | null>(null);
  React.useEffect(() => {
    if (!request || !active) return;
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      void resolveEditorTimezone(JSON.parse(request), ctrl.signal).then(
        (zone) => { if (!ctrl.signal.aborted) setResult({ request, zone, error: null }); },
        (error: unknown) => { if (!ctrl.signal.aborted) setResult({ request, zone: null, error }); },
      );
    }, 180);
    return () => { clearTimeout(timer); ctrl.abort(); };
  }, [request, active]);
  const current = request && result?.request === request ? result : null;
  return {
    zone: current?.zone ?? null,
    error: current?.error ?? null,
    pending: Boolean(request && !current),
  };
}
