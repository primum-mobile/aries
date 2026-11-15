// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { WHEEL_RIM_LIMIT_DEFAULT } from "@/lib/chart/outer-glyph-lane";
import { useT } from "@/lib/i18n/i18n";
import { useWheelFrameTuneStore, type WheelFrameTune } from "@/stores/wheel-frame-tune-store";

/**
 * Wheel frame design tuner (development builds, Shift+Cmd+D): the wheel's
 * largest size in its pane. Values are picked here and then baked into
 * WHEEL_RIM_LIMIT_DEFAULT; double-click a slider for its default.
 */
export function WheelFrameTuner() {
  const t = useT();
  const tune = useWheelFrameTuneStore((state) => state.tune);
  const setTune = useWheelFrameTuneStore((state) => state.set);
  const slider = (key: keyof WheelFrameTune, label: string) => (
    <label className="flex flex-col">
      <span className="flex justify-between gap-2">
        <span>{t(label)}</span>
        <span className="tabular-nums">{tune[key].toFixed(3)}</span>
      </span>
      <input
        type="range"
        min={0.7}
        max={1}
        step={0.001}
        value={tune[key]}
        onChange={(e) => setTune({ ...tune, [key]: Number(e.target.value) })}
        onDoubleClick={() => setTune({ ...tune, [key]: WHEEL_RIM_LIMIT_DEFAULT[key] })}
      />
    </label>
  );
  return (
    <div
      className="absolute right-[var(--aries-control-padding-x)] bottom-[var(--aries-control-padding-x)] z-20 flex w-72 flex-col gap-1 rounded-[var(--aries-radius-popover)] bg-[var(--aries-popover-background)] p-2 font-mono text-[length:var(--aries-font-size-small)] text-[color:var(--aries-popover-text)] shadow-md ring-1 ring-foreground/10"
      onPointerDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
    >
      <span>{t("chart.frameTuner.title")}</span>
      {slider("height", "chart.frameTuner.height")}
      {slider("width", "chart.frameTuner.width")}
      <button
        type="button"
        className="rounded-[var(--aries-radius-control-compact)] ring-1 ring-foreground/20 hover:bg-accent"
        onClick={() => setTune({ ...WHEEL_RIM_LIMIT_DEFAULT })}
      >
        {t("chart.frameTuner.reset")}
      </button>
    </div>
  );
}
