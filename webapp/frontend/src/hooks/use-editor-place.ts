// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import * as React from "react";
import { placeAt } from "@/lib/daemon/client";

/** Infer only the label: the entered point, altitude and clock remain intact. */
export function useEditorPlace(request: string | null, active: boolean): string | null {
  const [result, setResult] = React.useState<{ request: string; name: string } | null>(null);
  React.useEffect(() => {
    if (!request || !active) return;
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      const { lon, lat } = JSON.parse(request) as { lon: number; lat: number };
      void placeAt(lon, lat, "", ctrl.signal).then(
        (candidate) => { if (!ctrl.signal.aborted) setResult({ request, name: candidate.name }); },
        () => { /* Optional label lookup; save can retry on the daemon. */ },
      );
    }, 180);
    return () => { clearTimeout(timer); ctrl.abort(); };
  }, [request, active]);
  return request && result?.request === request ? result.name : null;
}
