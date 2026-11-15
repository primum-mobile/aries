// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

// Wheel frame design tuner (Shift+Cmd+D on a chart): the wheel's largest size
// in its pane, as the rim's share of half the pane height and width
// (`WheelRimLimit`). Development builds only; release builds use the baked
// defaults. Only values moved away from the defaults persist, so changed
// defaults apply.

import { create } from "zustand";

import { WHEEL_RIM_LIMIT_DEFAULT } from "@/lib/chart/outer-glyph-lane";
import { DESIGN_TUNERS_ENABLED } from "@/stores/design-tuner-store";

export type WheelFrameTune = { height: number; width: number };

const STORAGE_KEY = "aries.designTuner.wheelFrame";

function readTune(): WheelFrameTune {
  if (!DESIGN_TUNERS_ENABLED) return { ...WHEEL_RIM_LIMIT_DEFAULT };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) as Partial<WheelFrameTune> : {};
    const tune = { ...WHEEL_RIM_LIMIT_DEFAULT, ...parsed };
    return Number.isFinite(tune.height) && Number.isFinite(tune.width) ? tune : { ...WHEEL_RIM_LIMIT_DEFAULT };
  } catch {
    return { ...WHEEL_RIM_LIMIT_DEFAULT };
  }
}

function writeTune(tune: WheelFrameTune) {
  const moved = Object.fromEntries(Object.entries(tune).filter(([key, value]) => (
    value !== WHEEL_RIM_LIMIT_DEFAULT[key as keyof WheelFrameTune])));
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(moved));
  } catch {
    /* storage is best-effort */
  }
}

type WheelFrameTuneState = {
  tune: WheelFrameTune;
  set: (next: WheelFrameTune) => void;
};

export const useWheelFrameTuneStore = create<WheelFrameTuneState>((set) => ({
  tune: typeof window === "undefined" ? { ...WHEEL_RIM_LIMIT_DEFAULT } : readTune(),
  set: (next) => {
    writeTune(next);
    set({ tune: next });
  },
}));
