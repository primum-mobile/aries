// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later
"use client";

import * as React from "react";
import { createRetainedListRequests } from "./retained-list-requests";

/** A list's request owner plus its idle state. Coverage-growth effects depend on
 * `idle`, not only on the store object: work can be cancelled and the same
 * accepted rows republished, and growth must still resume. */
export function useRetainedListRequests<T>(initial: T | null) {
  const [requests] = React.useState(() => createRetainedListRequests<T>(initial));
  const idle = React.useSyncExternalStore(
    requests.subscribe,
    () => !requests.busy,
    () => !requests.busy,
  );
  return [requests, idle] as const;
}
