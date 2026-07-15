// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { styleRevisionKey } from "@/lib/theme/style-state.mjs";
import { useThemeStore } from "@/stores/theme-store";

/** Stable daemon-owned identity for style-only renderer invalidation. */
export function useStyleRevision(): string {
  return useThemeStore((state) => styleRevisionKey(state.theme));
}
