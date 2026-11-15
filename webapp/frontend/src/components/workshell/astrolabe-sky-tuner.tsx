// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useT } from "@/lib/i18n/i18n";
import { ASTROLABE_SKY_DEFAULT, type AstrolabeSkyTune } from "./astrolabe-sky";

// Physical sky (astrolabe-sky.ts) in the astrolabe design tuner, development
// builds only: values are picked here and then hardcoded in
// ASTROLABE_SKY_DEFAULT. One tune for both plates; persisted like the
// ecliptic values.
const SKY_TUNE_STORAGE_KEY = "aries.designTuner.astrolabeSky";

export function readSkyTune(): AstrolabeSkyTune {
  try {
    const raw = window.localStorage.getItem(SKY_TUNE_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) as Partial<AstrolabeSkyTune> : {};
    const tune = { ...ASTROLABE_SKY_DEFAULT, ...parsed };
    return Object.values(tune).every((value) => typeof value === "number" && Number.isFinite(value))
      ? tune : ASTROLABE_SKY_DEFAULT;
  } catch {
    return ASTROLABE_SKY_DEFAULT;
  }
}

// Only values moved away from the defaults persist, so changed defaults apply.
export function writeSkyTune(tune: AstrolabeSkyTune) {
  const moved = Object.fromEntries(Object.entries(tune).filter(([key, value]) => (
    value !== ASTROLABE_SKY_DEFAULT[key as keyof AstrolabeSkyTune])));
  try {
    window.localStorage.setItem(SKY_TUNE_STORAGE_KEY, JSON.stringify(moved));
  } catch {
    /* storage is best-effort */
  }
}

const signed = (value: number) => `${value < 0 ? "−" : "+"}${Math.abs(value).toFixed(1)}`;

type SliderKey = Exclude<keyof AstrolabeSkyTune, "finerZoom">;

/** The tune with the finer-zoom switch on (the default) or explicitly off, so off persists. */
function withFinerZoom(tune: AstrolabeSkyTune, on: boolean): AstrolabeSkyTune {
  return { ...tune, finerZoom: on ? 1 : 0 };
}

export function AstrolabeSkyTuner({
  tune,
  onChange,
}: {
  tune: AstrolabeSkyTune;
  onChange: (next: AstrolabeSkyTune) => void;
}) {
  const t = useT();
  const defaults = ASTROLABE_SKY_DEFAULT;
  const slider = (key: SliderKey, label: string, min: number, max: number, step: number, shown: string) => (
    <label key={key} className="flex flex-col">
      <span className="flex justify-between">
        <span>{t(label)}</span>
        <span className="tabular-nums">{shown}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={tune[key]}
        onChange={(e) => onChange({ ...tune, [key]: Number(e.target.value) })}
        onDoubleClick={() => onChange({ ...tune, [key]: defaults[key] })}
      />
    </label>
  );
  return (
    <div className="flex flex-col gap-1 border-b border-foreground/10 pb-2">
      <span>{t("astrolabe.atmospheric")}</span>
      {slider("haze", "astrolabe.skyTuner.haze", 0, 1.5, 0.01, `${(0.25 * 24 ** tune.haze).toFixed(1)}×`)}
      {slider("ozone", "astrolabe.skyTuner.ozone", 0, 3, 0.05, `${tune.ozone.toFixed(2)}×`)}
      {slider("exposure", "astrolabe.skyTuner.exposure", -6, 3, 0.1, signed(tune.exposure))}
      {slider("diffusion", "astrolabe.skyTuner.diffusion", 0, 1, 0.01, `${Math.round(tune.diffusion * 100)}%`)}
      {slider("strength", "astrolabe.skyTuner.strength", 0, 1, 0.01, `${Math.round(tune.strength * 100)}%`)}
      <label className="flex items-center justify-between">
        <span>{t("astrolabe.skyTuner.finerZoom")}</span>
        <input
          type="checkbox"
          checked={(tune.finerZoom ?? 0) > 0}
          onChange={(e) => onChange(withFinerZoom(tune, e.target.checked))}
        />
      </label>
      <button
        type="button"
        className="rounded-[var(--aries-radius-control-compact)] ring-1 ring-foreground/20 hover:bg-accent"
        onClick={() => onChange(withFinerZoom(defaults, (tune.finerZoom ?? 0) > 0))}
      >
        {t("astrolabe.skyTuner.reset")}
      </button>
    </div>
  );
}
