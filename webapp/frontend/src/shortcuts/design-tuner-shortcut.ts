// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useEffect } from "react";

import { DESIGN_TUNERS_ENABLED, useDesignTunerStore } from "@/stores/design-tuner-store";

/** Shift+Cmd+D (Shift+Ctrl+D off macOS) toggles the in-frame design tuners. */
export function useDesignTunerShortcut(): void {
  useEffect(() => {
    if (!DESIGN_TUNERS_ENABLED) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || event.altKey || !event.shiftKey) return;
      if (!(event.metaKey || event.ctrlKey) || event.code !== "KeyD") return;
      event.preventDefault();
      useDesignTunerStore.getState().toggle();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
