// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { Popover } from "@base-ui/react/popover";
import { Pipette } from "lucide-react";
import {
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type PointerEvent,
} from "react";

import { useT, useTFallback } from "@/lib/i18n/i18n";
import { rootCssPixelOffset } from "@/lib/css-token-value";
import {
  CHART_COLOR_ROLE_GROUP_LABEL_KEYS,
  CHART_COLOR_ROLE_GROUP_ORDER,
  chartColorRolesInGroup,
  type ChartColorRole,
} from "@/lib/style-lab/chart-color-roles";
import {
  sampleScreenColor,
  supportsScreenColorSampling,
} from "@/lib/shell-host";
import { cn } from "@/lib/utils";
import { useChartStyleEditorStore } from "@/stores/chart-style-editor-store";

type Hsv = Readonly<{ h: number; s: number; v: number }>;

const colorPickerSideOffset = rootCssPixelOffset(
  "--aries-menu-picker-side-offset",
  8,
);
const subscribeToScreenColorSampling = () => () => {};
const noScreenColorSampling = () => false;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function parseHex(value: string): [number, number, number] {
  const match = /^#([0-9a-f]{6})$/i.exec(value.trim());
  if (!match) return [128, 128, 128];
  const packed = Number.parseInt(match[1], 16);
  return [(packed >> 16) & 255, (packed >> 8) & 255, packed & 255];
}

function rgbToHsv([red, green, blue]: readonly number[]): Hsv {
  const r = red / 255;
  const g = green / 255;
  const b = blue / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let hue = 0;
  if (delta > 0) {
    if (max === r) hue = 60 * (((g - b) / delta) % 6);
    else if (max === g) hue = 60 * ((b - r) / delta + 2);
    else hue = 60 * ((r - g) / delta + 4);
  }
  return {
    h: hue < 0 ? hue + 360 : hue,
    s: max === 0 ? 0 : delta / max,
    v: max,
  };
}

function hsvToHex({ h, s, v }: Hsv): string {
  const hue = ((h % 360) + 360) % 360;
  const chroma = v * s;
  const section = hue / 60;
  const x = chroma * (1 - Math.abs((section % 2) - 1));
  let rgb: [number, number, number];
  if (section < 1) rgb = [chroma, x, 0];
  else if (section < 2) rgb = [x, chroma, 0];
  else if (section < 3) rgb = [0, chroma, x];
  else if (section < 4) rgb = [0, x, chroma];
  else if (section < 5) rgb = [x, 0, chroma];
  else rgb = [chroma, 0, x];
  const match = v - chroma;
  return `#${rgb.map((channel) =>
    Math.round((channel + match) * 255).toString(16).padStart(2, "0")
  ).join("")}`;
}

export function StyleLabColorPicker({
  value,
  label,
  onChange,
  onGestureStart,
  onGestureEnd,
  className,
  roles,
  followedRoleId,
  onSelectRole,
}: {
  value: string;
  label: string;
  onChange: (value: string) => void;
  onGestureStart?: () => void;
  onGestureEnd?: () => void;
  className?: string;
  /**
   * The chart's named colour roles, offered as swatches. Values must already
   * be `#rrggbb`, which the picker's own field understands and can compare
   * against the current colour without a parser.
   */
  roles?: readonly ChartColorRole[];
  /**
   * The role this control follows, if it follows one.
   *
   * Following is a stronger fact than matching, and it decides the selection on
   * its own: several roles can share a colour, and lighting all of them up
   * would say the control matched each when it is tied to exactly one.
   */
  followedRoleId?: string | null;
  /**
   * Called instead of `onChange` when a role swatch is picked, so a caller that
   * can record the reference does, and one that cannot still gets the colour.
   */
  onSelectRole?: (role: ChartColorRole) => void;
}) {
  const t = useT();
  const tf = useTFallback();
  const recentColors = useChartStyleEditorStore((state) => state.recentColors);
  const rememberRecentColor = useChartStyleEditorStore(
    (state) => state.rememberRecentColor,
  );
  const [hsv, setHsv] = useState<Hsv>(() => rgbToHsv(parseHex(value)));
  const [syncedValue, setSyncedValue] = useState(value);
  const [samplingScreen, setSamplingScreen] = useState(false);
  const gestureActive = useRef(false);
  const fieldRef = useRef<HTMLDivElement | null>(null);

  // Screen sampling availability is a platform fact that never changes after
  // load, so it is read as an external snapshot rather than synchronised into
  // state by an effect. The server snapshot is false because neither the
  // native sampler nor EyeDropper exists during prerender.
  const canSampleScreen = useSyncExternalStore(
    subscribeToScreenColorSampling,
    supportsScreenColorSampling,
    noScreenColorSampling,
  );

  // Adopt an externally changed colour during render instead of in an effect,
  // which avoids the extra commit an effect-driven sync would cause. Hue is
  // preserved when the incoming colour is achromatic, because grey carries no
  // hue of its own and resetting it would make the picker jump.
  if (value !== syncedValue) {
    setSyncedValue(value);
    const incoming = rgbToHsv(parseHex(value));
    setHsv((current) => ({
      ...incoming,
      h: incoming.s < 0.0001 ? current.h : incoming.h,
    }));
  }

  const begin = () => {
    if (gestureActive.current) return;
    gestureActive.current = true;
    onGestureStart?.();
  };
  const end = () => {
    if (!gestureActive.current) return;
    gestureActive.current = false;
    rememberRecentColor(value);
    onGestureEnd?.();
  };
  const update = (next: Hsv) => {
    const normalized = {
      h: ((next.h % 360) + 360) % 360,
      s: clamp01(next.s),
      v: clamp01(next.v),
    };
    setHsv(normalized);
    onChange(hsvToHex(normalized));
  };
  const updateFromPointer = (event: PointerEvent<HTMLDivElement>) => {
    const bounds = fieldRef.current?.getBoundingClientRect();
    if (!bounds || bounds.width <= 0 || bounds.height <= 0) return;
    update({
      h: hsv.h,
      s: (event.clientX - bounds.left) / bounds.width,
      v: 1 - (event.clientY - bounds.top) / bounds.height,
    });
  };
  const nudgeField = (event: KeyboardEvent<HTMLDivElement>) => {
    const amount = event.shiftKey ? 0.1 : 0.01;
    let next = hsv;
    if (event.key === "ArrowLeft") next = { ...hsv, s: hsv.s - amount };
    else if (event.key === "ArrowRight") next = { ...hsv, s: hsv.s + amount };
    else if (event.key === "ArrowUp") next = { ...hsv, v: hsv.v + amount };
    else if (event.key === "ArrowDown") next = { ...hsv, v: hsv.v - amount };
    else return;
    event.preventDefault();
    begin();
    update(next);
  };
  const hueColor = hsvToHex({ h: hsv.h, s: 1, v: 1 });
  const sampleFromScreen = async () => {
    if (!canSampleScreen || samplingScreen) return;
    setSamplingScreen(true);
    try {
      const sampled = await sampleScreenColor();
      if (!sampled) return;
      begin();
      update(rgbToHsv(parseHex(sampled)));
      end();
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        console.error("Style Lab screen color sampling failed", error);
      }
    } finally {
      setSamplingScreen(false);
    }
  };

  return (
    <Popover.Root
      onOpenChange={(open) => {
        if (!open) end();
      }}
    >
      <Popover.Trigger
        aria-label={label}
        title={label}
        className={cn(
          "relative size-6 shrink-0 overflow-hidden rounded-[var(--aries-radius-control-compact)] border border-[color:var(--aries-inspector-divider-color)] outline-none focus-visible:border-[color:var(--aries-inspector-interactive-color)]",
          className,
        )}
      >
        <span className="absolute inset-0" style={{ background: value }} />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner
          side="left"
          align="start"
          sideOffset={colorPickerSideOffset}
          className="z-[120]"
        >
          <Popover.Popup
            data-aries-surface="popover"
            className="w-56 rounded-[var(--aries-radius-popover)] border border-[color:var(--aries-inspector-divider-color)] bg-[var(--aries-popover-background)] p-3 text-[color:var(--aries-popover-text)] shadow-xl outline-none"
          >
            <div
              ref={fieldRef}
              role="slider"
              tabIndex={0}
              aria-label={`${t("styleLab.control.saturation")} / ${t("styleLab.control.brightness")}`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(hsv.s * 100)}
              aria-valuetext={`${Math.round(hsv.s * 100)}%, ${Math.round(hsv.v * 100)}%`}
              className="relative h-36 w-full touch-none overflow-hidden rounded-[var(--aries-radius-control-compact)] outline-none ring-offset-1 focus-visible:ring-1 focus-visible:ring-[color:var(--aries-inspector-interactive-color)]"
              style={{
                background: [
                  "linear-gradient(to top, #000, transparent)",
                  "linear-gradient(to right, #fff, transparent)",
                  hueColor,
                ].join(","),
              }}
              onPointerDown={(event) => {
                begin();
                event.currentTarget.setPointerCapture(event.pointerId);
                updateFromPointer(event);
              }}
              onPointerMove={(event) => {
                if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                  updateFromPointer(event);
                }
              }}
              onPointerUp={(event) => {
                updateFromPointer(event);
                event.currentTarget.releasePointerCapture(event.pointerId);
                end();
              }}
              onPointerCancel={end}
              onLostPointerCapture={end}
              onKeyDown={nudgeField}
              onKeyUp={end}
              onBlur={end}
            >
              <span
                aria-hidden="true"
                className="pointer-events-none absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgb(0_0_0/0.65)]"
                style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%` }}
              />
            </div>
            <label className="mt-3 grid grid-cols-[3.5rem_1fr] items-center gap-2 text-[length:var(--aries-font-size-micro)]">
              <span>{t("styleLab.control.hue")}</span>
              <input
                type="range"
                min={0}
                max={359}
                step={1}
                value={Math.round(hsv.h)}
                aria-label={t("styleLab.control.hue")}
                onPointerDown={begin}
                onPointerUp={end}
                onPointerCancel={end}
                onFocus={begin}
                onBlur={end}
                onChange={(event) => update({ ...hsv, h: Number(event.currentTarget.value) })}
                className="h-3 w-full cursor-pointer appearance-none rounded-full border border-[color:var(--aries-inspector-divider-color)] bg-[linear-gradient(to_right,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)] [&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:bg-transparent [&::-webkit-slider-thumb]:shadow-[0_0_0_1px_rgb(0_0_0/0.65)]"
              />
            </label>
            {recentColors.length > 0 ? (
              <div
                role="listbox"
                aria-label={t("styleLab.control.recentColors")}
                aria-orientation="horizontal"
                className="mt-3 flex flex-wrap items-center gap-1"
              >
                {recentColors.map((recent) => (
                  <button
                    key={recent}
                    type="button"
                    role="option"
                    aria-selected={recent === value.toLowerCase()}
                    // The hex is the accessible name. A colour has no better
                    // one, and inventing names for arbitrary user colours would
                    // be guesswork a screen reader could not verify.
                    aria-label={recent.toUpperCase()}
                    title={recent.toUpperCase()}
                    onClick={() => {
                      setHsv(rgbToHsv(parseHex(recent)));
                      onChange(recent);
                      rememberRecentColor(recent);
                    }}
                    style={{ backgroundColor: recent }}
                    className={cn(
                      "size-5 shrink-0 rounded-[var(--aries-radius-control-compact)] border transition-shadow focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--aries-inspector-interactive-color)]",
                      recent === value.toLowerCase()
                        ? "border-[color:var(--aries-inspector-interactive-color)] ring-1 ring-[color:var(--aries-inspector-interactive-color)]"
                        : "border-[color:var(--aries-inspector-divider-color)]",
                    )}
                  />
                ))}
              </div>
            ) : null}
            {roles && roles.length > 0 ? (
              <div className="mt-3 max-h-40 overflow-y-auto">
                {CHART_COLOR_ROLE_GROUP_ORDER.map((group) => {
                  const groupRoles = chartColorRolesInGroup(roles, group);
                  if (groupRoles.length === 0) return null;
                  const groupLabel = t(CHART_COLOR_ROLE_GROUP_LABEL_KEYS[group]);
                  return (
                    <div key={group} className="mb-2 last:mb-0">
                      <div className="mb-1 text-[length:var(--aries-font-size-micro)] opacity-60">
                        {groupLabel}
                      </div>
                      <div
                        role="listbox"
                        aria-label={groupLabel}
                        aria-orientation="horizontal"
                        className="flex flex-wrap items-center gap-1"
                      >
                        {groupRoles.map((role) => {
                          // A role is named, so unlike a recent colour it has a
                          // real accessible name and does not need its hex read
                          // out as one.
                          const roleLabel = tf(role.labelKey, role.fallbackLabel);
                          const selected = followedRoleId != null
                            ? role.semanticId === followedRoleId
                            : role.value.toLowerCase() === value.toLowerCase();
                          return (
                            <button
                              key={role.semanticId}
                              type="button"
                              role="option"
                              aria-selected={selected}
                              aria-label={roleLabel}
                              title={roleLabel}
                              onClick={() => {
                                setHsv(rgbToHsv(parseHex(role.value)));
                                if (onSelectRole) onSelectRole(role);
                                else onChange(role.value);
                              }}
                              style={{ backgroundColor: role.value }}
                              className={cn(
                                "size-5 shrink-0 rounded-[var(--aries-radius-control-compact)] border transition-shadow focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--aries-inspector-interactive-color)]",
                                selected
                                  ? "border-[color:var(--aries-inspector-interactive-color)] ring-1 ring-[color:var(--aries-inspector-interactive-color)]"
                                  : "border-[color:var(--aries-inspector-divider-color)]",
                              )}
                            />
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : null}
            <div className="mt-3 flex items-center gap-2">
              <span
                aria-hidden="true"
                className="size-6 rounded-[var(--aries-radius-control-compact)] border border-[color:var(--aries-inspector-divider-color)]"
                style={{ background: value }}
              />
              <span className="min-w-0 flex-1 font-mono text-[length:var(--aries-font-size-small)]">
                {value.toUpperCase()}
              </span>
              <button
                type="button"
                aria-label={t("styleLab.action.sampleColor")}
                title={t("styleLab.action.sampleColor")}
                aria-busy={samplingScreen}
                disabled={!canSampleScreen || samplingScreen}
                onClick={() => void sampleFromScreen()}
                className="grid size-7 shrink-0 place-items-center rounded-[var(--aries-radius-control-compact)] border border-[color:var(--aries-inspector-divider-color)] text-[color:var(--aries-popover-text)] transition-colors hover:border-[color:var(--aries-inspector-interactive-color)] hover:text-[color:var(--aries-inspector-interactive-color)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--aries-inspector-interactive-color)] disabled:cursor-default disabled:opacity-40"
              >
                <Pipette aria-hidden="true" size={15} strokeWidth={1.7} />
              </button>
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
