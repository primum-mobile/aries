// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import Color from "colorjs.io";
import { ChevronDown, RotateCcw, Shuffle } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { useT, type TFunc } from "@/lib/i18n/i18n";
import { readRootCssColorToken } from "@/lib/css-token-value";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { StyleLabColorPicker } from "@/components/workshell/style-lab-color-picker";
import { cn } from "@/lib/utils";
import {
  type StyleLabTokenValue,
} from "@/lib/style-lab/client";
import {
  APP_MATERIAL_BLEND_MODES,
  APP_MATERIAL_CLASSES,
  APP_MATERIAL_GRADIENT_TYPES,
  APP_MATERIAL_PATTERNS,
  DEFAULT_APP_MATERIAL_RECIPE,
  appMaterialOverrideId,
  type AppMaterialClass,
  type AppMaterialGradientType,
  type AppMaterialPattern,
  type AppMaterialProperty,
} from "@/lib/theme/app-material";
import { resolveSimpleCssValue } from "@/lib/theme/app-material-runtime";
import {
  CHART_KEY_COLOR_SOURCES,
  chartKeyColor,
} from "@/lib/theme/chart-key-color";
import {
  deriveLinkedPalette,
  harmonizeToward,
  type LinkedPaletteContrastTarget,
  type LinkedPaletteHarmony,
  type LinkedPaletteSurfaceRole,
} from "@/lib/theme/linked-palette";
import { useChartStyleEditorStore } from "@/stores/chart-style-editor-store";

type AppSurfaceId =
  | "global"
  | LinkedPaletteSurfaceRole;

function surfaceIdFromMaterialClass(
  classId: AppMaterialClass,
): AppSurfaceId {
  if (classId === "materials.global") return "global";
  if (classId === "surfaces.canvas") return "canvas";
  return classId;
}

const APP_SURFACES = APP_MATERIAL_CLASSES.map(
  surfaceIdFromMaterialClass,
) as readonly AppSurfaceId[];

const MATERIAL_CLASS_BY_SURFACE = Object.freeze(Object.fromEntries(
  APP_MATERIAL_CLASSES.map((classId) => [
    surfaceIdFromMaterialClass(classId),
    classId,
  ]),
)) as Readonly<Record<AppSurfaceId, AppMaterialClass>>;

const SURFACE_COLOR_TOKEN: Readonly<Record<
  Exclude<AppSurfaceId, "global">,
  Readonly<{
    background: string;
    backgroundFallback: string;
    foreground: string;
    foregroundFallback: string;
  }>
>> = {
  canvas: {
    background: "app.color.background",
    backgroundFallback: "app.color.background",
    foreground: "app.color.textPrimary",
    foregroundFallback: "app.color.textPrimary",
  },
  sidebar: {
    background: "app.sidebar.background",
    backgroundFallback: "app.color.surface",
    foreground: "app.sidebar.foreground",
    foregroundFallback: "app.color.textPrimary",
  },
  titlebar: {
    background: "app.titlebar.background",
    backgroundFallback: "app.color.background",
    foreground: "app.titlebar.foreground",
    foregroundFallback: "app.color.textPrimary",
  },
  statusbar: {
    background: "app.statusbar.background",
    backgroundFallback: "app.color.background",
    foreground: "app.statusbar.textColor",
    foregroundFallback: "app.color.textMuted",
  },
  panel: {
    background: "app.panel.background",
    backgroundFallback: "app.color.surface",
    foreground: "app.panel.foreground",
    foregroundFallback: "app.color.textPrimary",
  },
  inspector: {
    background: "app.inspector.color.background",
    backgroundFallback: "app.panel.background",
    foreground: "app.inspector.color.source",
    foregroundFallback: "app.panel.foreground",
  },
  overlay: {
    background: "app.overlay.background",
    backgroundFallback: "app.color.surface",
    foreground: "app.overlay.foreground",
    foregroundFallback: "app.color.textPrimary",
  },
  popover: {
    background: "app.popover.background",
    backgroundFallback: "app.color.background",
    foreground: "app.popover.foreground",
    foregroundFallback: "app.color.textPrimary",
  },
  control: {
    background: "app.control.background",
    backgroundFallback: "app.color.surfaceSubtle",
    foreground: "app.control.foreground",
    foregroundFallback: "app.color.textPrimary",
  },
  dataBody: {
    background: "app.data.bodyBackground",
    backgroundFallback: "app.color.background",
    foreground: "app.data.bodyForeground",
    foregroundFallback: "app.color.textPrimary",
  },
  dataHeader: {
    background: "app.data.headerBackground",
    backgroundFallback: "app.color.surface",
    foreground: "app.data.headerForeground",
    foregroundFallback: "app.color.textPrimary",
  },
};

const CORE_PALETTE_TOKEN = {
  background: "app.color.background",
  surface: "app.color.surface",
  surfaceSubtle: "app.color.surfaceSubtle",
  accent: "app.color.interactiveAccent",
  accentForeground: "app.color.interactiveAccentForeground",
  border: "app.color.borderSubtle",
  textPrimary: "app.color.textPrimary",
  textMuted: "app.color.textMuted",
  textDim: "app.color.textDim",
} as const;

const UI_TYPEFACE_TOKEN = "app.type.familyUi";
const UI_TYPEFACE_OPTIONS: readonly {
  value: string;
  label: string;
  labelKey?: string;
}[] = [
  {
    value: "'FreeSans', ui-sans-serif, system-ui, sans-serif",
    label: "FreeSans",
  },
  {
    value: "'Kosugi Aries', 'FreeSans', ui-sans-serif, system-ui, sans-serif",
    label: "Kosugi Aries",
  },
  {
    value: "'DotGothic16', 'FreeSans', ui-sans-serif, system-ui, sans-serif",
    label: "DotGothic16",
  },
  {
    value: "system-ui, sans-serif",
    label: "System font",
    labelKey: "settings.systemFont",
  },
] as const;
const CHART_BACKGROUND_TOKEN = "chart.color.background";
const SIDEBAR_ACCENT_FOREGROUND_TOKEN =
  "app.sidebar.accentForeground";

/**
 * How far the palette anchors travel toward the chart's key colour by default.
 *
 * Material harmonises at 0.15 so a colour stays recognisably itself, and the
 * same restraint is what makes this feature safe to leave switched on: the
 * interface agrees with the chart instead of being repainted by it. Zero turns
 * the link off without removing the control.
 */
const DEFAULT_CHART_MATCH_PERCENT = 15;

function materialOverrideId(
  surface: AppSurfaceId,
  property: AppMaterialProperty,
): string {
  return appMaterialOverrideId(
    MATERIAL_CLASS_BY_SURFACE[surface],
    property,
  );
}

function colorFromValue(value: StyleLabTokenValue | undefined): Color | null {
  try {
    if (Array.isArray(value)) {
      return new Color(
        "srgb",
        [
          Number(value[0] ?? 0) / 255,
          Number(value[1] ?? 0) / 255,
          Number(value[2] ?? 0) / 255,
        ],
        value.length > 3 ? Number(value[3]) : 1,
      );
    }
    if (typeof value !== "string") return null;
    return new Color(value);
  } catch {
    return null;
  }
}

function colorArray(value: StyleLabTokenValue | undefined): number[] | null {
  const parsed = colorFromValue(value);
  if (!parsed) return null;
  const srgb = parsed.to("srgb").toGamut({ space: "srgb", method: "css" });
  const channels = srgb.coords.map((channel) =>
    Math.max(0, Math.min(255, Math.round(Number(channel ?? 0) * 255)))
  );
  return srgb.alpha < 1 ? [...channels, srgb.alpha] : channels;
}

function colorHex(value: StyleLabTokenValue | undefined): string {
  const array = colorArray(value) ?? [128, 128, 128];
  return `#${array.slice(0, 3).map((channel) =>
    Math.round(Number(channel)).toString(16).padStart(2, "0")
  ).join("")}`;
}

function colorAlpha(value: StyleLabTokenValue | undefined): number {
  return colorFromValue(value)?.alpha ?? 1;
}

function withColorAlpha(
  value: StyleLabTokenValue | undefined,
  alpha: number,
): number[] | null {
  const rgb = colorArray(value);
  if (!rgb) return null;
  return [
    ...rgb.slice(0, 3),
    Math.max(0, Math.min(1, alpha)),
  ];
}

function rgbArrayFromHex(value: string): number[] {
  return colorArray(value) ?? [128, 128, 128];
}

function surfaceLabel(surface: AppSurfaceId, t: TFunc): string {
  return t(`styleLab.app.surface.${surface}`);
}

function patternLabel(pattern: AppMaterialPattern, t: TFunc): string {
  return t(`styleLab.app.pattern.${pattern}`);
}

function blendLabel(
  mode: (typeof APP_MATERIAL_BLEND_MODES)[number],
  t: TFunc,
): string {
  return t(`styleLab.app.blend.${mode}`);
}

function gradientLabel(
  type: AppMaterialGradientType,
  t: TFunc,
): string {
  return t(`styleLab.app.gradient.${type}`);
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="flex h-8 items-center border-b border-[color:var(--aries-inspector-divider-color)] px-[var(--aries-inspector-padding-x)] text-[length:var(--aries-font-size-small)] font-medium text-[color:var(--aries-inspector-title-color)]">
      {children}
    </h3>
  );
}

function MaterialGroup({
  title,
  summary,
  defaultOpen,
  enabled,
  onEnabledChange,
  children,
}: {
  title: string;
  summary?: string;
  defaultOpen: boolean;
  enabled?: boolean;
  onEnabledChange?: (enabled: boolean) => void;
  children: React.ReactNode;
}) {
  const t = useT();
  const [open, setOpen] = useState(defaultOpen);
  const previousEnabled = useRef(enabled);
  useEffect(() => {
    if (enabled && previousEnabled.current === false) setOpen(true);
    previousEnabled.current = enabled;
  }, [enabled]);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="flex h-9 items-center border-t border-[color:var(--aries-inspector-divider-color)] first:border-t-0 hover:bg-[var(--aries-navbar-hover-bg)]">
        <CollapsibleTrigger className="flex min-w-0 flex-1 items-center gap-1.5 self-stretch px-[var(--aries-inspector-padding-x)] text-left">
          <ChevronDown
            aria-hidden="true"
            size={12}
            className={cn(
              "shrink-0 text-[color:var(--aries-inspector-muted-color)] transition-transform",
              !open && "-rotate-90",
            )}
          />
          <span className="min-w-0 flex-1 truncate text-[length:var(--aries-font-size-small)] font-medium text-[color:var(--aries-inspector-title-color)]">
            {title}
          </span>
          {summary ? (
            <span className="max-w-[42%] truncate text-[length:var(--aries-font-size-micro)] text-[color:var(--aries-inspector-muted-color)]">
              {summary}
            </span>
          ) : null}
        </CollapsibleTrigger>
        {enabled != null && onEnabledChange ? (
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            aria-label={t("styleLab.group.shadowEnabled")}
            title={t("styleLab.group.shadowEnabled")}
            onClick={() => onEnabledChange(!enabled)}
            className={cn(
              "relative mr-[var(--aries-inspector-padding-x)] h-5 w-9 shrink-0 rounded-full border border-[color:var(--aries-inspector-divider-color)] transition-colors",
              enabled
                ? "bg-[var(--aries-inspector-interactive-color)]"
                : "bg-[var(--aries-inspector-background)]",
            )}
          >
            <span
              className={cn(
                "absolute top-0.5 size-3.5 rounded-full bg-[var(--aries-background)] shadow-sm transition-transform",
                enabled ? "translate-x-[1.05rem]" : "translate-x-0.5",
              )}
            />
          </button>
        ) : null}
      </div>
      <CollapsibleContent>{children}</CollapsibleContent>
    </Collapsible>
  );
}

function ControlRow({
  label,
  overridden = false,
  onReset,
  children,
}: {
  label: string;
  overridden?: boolean;
  onReset?: () => void;
  children: React.ReactNode;
}) {
  const t = useT();
  return (
    <div className="grid min-h-9 grid-cols-[minmax(0,1fr)_minmax(8.5rem,1.35fr)_1.5rem] items-center gap-1 px-[var(--aries-inspector-padding-x)] py-1 text-[length:var(--aries-font-size-micro)]">
      <span className="min-w-0 truncate text-[color:var(--aries-inspector-label-color)]">
        {label}
      </span>
      <div className="min-w-0">{children}</div>
      <button
        type="button"
        aria-label={t("styleLab.action.resetProperty")}
        title={t("styleLab.action.resetProperty")}
        disabled={!overridden || !onReset}
        onClick={onReset}
        className="inline-flex size-6 items-center justify-center rounded-[var(--aries-radius-control-compact)] text-[color:var(--aries-inspector-muted-color)] hover:bg-[var(--aries-navbar-hover-bg)] disabled:opacity-20"
      >
        <RotateCcw size={12} />
      </button>
    </div>
  );
}

function AppColorRow({
  label,
  value,
  overridden,
  preserveAlpha = false,
  onChange,
  onReset,
  onGestureStart,
  onGestureEnd,
  onGestureCancel,
}: {
  label: string;
  value: StyleLabTokenValue;
  overridden: boolean;
  preserveAlpha?: boolean;
  onChange: (value: StyleLabTokenValue) => void;
  onReset: () => void;
  onGestureStart: () => void;
  onGestureEnd: () => void;
  onGestureCancel: () => void;
}) {
  const t = useT();
  const hex = colorHex(value);
  const alpha = colorAlpha(value);
  const [typedColor, setTypedColor] = useState<string | null>(null);
  const changeColor = (next: string) => {
    const parsed = colorArray(next);
    if (!parsed) return;
    onChange(
      preserveAlpha
        ? [...parsed.slice(0, 3), alpha]
        : parsed.slice(0, 3),
    );
  };

  return (
    <ControlRow
      label={label}
      overridden={overridden}
      onReset={onReset}
    >
      <div className="flex min-w-0 items-center gap-1">
        <StyleLabColorPicker
          value={hex}
          label={t("styleLab.control.colorPicker")}
          onChange={changeColor}
          onGestureStart={onGestureStart}
          onGestureEnd={onGestureEnd}
        />
        <input
          data-aries-control-appearance="local"
          value={typedColor ?? hex.toUpperCase()}
          aria-label={t("styleLab.control.colorValue")}
          className="h-[var(--aries-control-height-small)] min-w-0 flex-1 rounded-[var(--aries-radius-control-compact)] border border-[color:var(--aries-inspector-divider-color)] bg-[var(--aries-inspector-background)] px-[var(--aries-control-gap)] font-mono text-[length:var(--aries-font-size-micro)] outline-none focus:border-[color:var(--aries-inspector-interactive-color)]"
          onFocus={() => {
            onGestureStart();
            setTypedColor(hex.toUpperCase());
          }}
          onChange={(event) => {
            const next = event.currentTarget.value;
            setTypedColor(next);
            if (colorFromValue(next)) changeColor(next);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
            if (event.key === "Escape") {
              setTypedColor(null);
              onGestureCancel();
              event.preventDefault();
            }
          }}
          onBlur={(event) => {
            if (colorFromValue(event.currentTarget.value)) {
              changeColor(event.currentTarget.value);
            }
            setTypedColor(null);
            onGestureEnd();
          }}
        />
      </div>
    </ControlRow>
  );
}

function NumberRow({
  label,
  value,
  min,
  max,
  step,
  unit,
  disabled = false,
  overridden,
  onChange,
  onReset,
  onGestureStart,
  onGestureEnd,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  disabled?: boolean;
  overridden: boolean;
  onChange: (value: number) => void;
  onReset: () => void;
  // Optional because not every number here is an authored token: the linked
  // palette's own settings are local to this panel and outside undo.
  onGestureStart?: () => void;
  onGestureEnd?: () => void;
}) {
  return (
    <ControlRow
      label={label}
      overridden={overridden}
      onReset={onReset}
    >
      <div className="grid grid-cols-[minmax(3rem,1fr)_4.8rem] items-center gap-1">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          aria-label={label}
          onPointerDown={onGestureStart}
          onPointerUp={onGestureEnd}
          onPointerCancel={onGestureEnd}
          onKeyDown={onGestureStart}
          onKeyUp={onGestureEnd}
          onBlur={onGestureEnd}
          onChange={(event) => onChange(Number(event.currentTarget.value))}
          className="min-w-0 accent-[var(--aries-inspector-interactive-color)] disabled:opacity-40"
        />
        <label className="flex h-7 items-center rounded-[var(--aries-radius-control-compact)] border border-[color:var(--aries-inspector-divider-color)] px-1">
          <input
            data-aries-control-appearance="local"
            type="number"
            min={min}
            max={max}
            step={step}
            value={value}
            disabled={disabled}
            aria-label={label}
            onFocus={onGestureStart}
            onBlur={onGestureEnd}
            onChange={(event) => {
              const next = Number(event.currentTarget.value);
              if (Number.isFinite(next)) onChange(Math.min(max, Math.max(min, next)));
            }}
            className="min-w-0 flex-1 bg-transparent text-right outline-none disabled:opacity-40"
          />
          <span className="ml-0.5 text-[color:var(--aries-inspector-muted-color)]">
            {unit}
          </span>
        </label>
      </div>
    </ControlRow>
  );
}

const APP_THEME_GESTURE_OWNER = "app-theme" as const;

export function AppThemeControls() {
  const t = useT();
  const semanticOverrides = useChartStyleEditorStore((state) => state.semanticOverrides);
  const cssOverrides = useChartStyleEditorStore((state) => state.cssOverrides);
  const tokenMetadata = useChartStyleEditorStore((state) => state.tokenMetadata);
  const baseTheme = useChartStyleEditorStore((state) => state.styleLabBaseTheme);
  const beginGesture = useChartStyleEditorStore((state) => state.beginGesture);
  const setOverride = useChartStyleEditorStore((state) => state.setOverride);
  const endGesture = useChartStyleEditorStore((state) => state.endGesture);
  const cancelGesture = useChartStyleEditorStore((state) => state.cancelGesture);
  const resetProperty = useChartStyleEditorStore((state) => state.resetProperty);
  const resetProperties = useChartStyleEditorStore((state) => state.resetProperties);
  const [surface, setSurface] = useState<AppSurfaceId>("canvas");
  const [harmony, setHarmony] = useState<LinkedPaletteHarmony>("source");
  const [contrastTarget, setContrastTarget] =
    useState<LinkedPaletteContrastTarget>("aa");
  const [chartMatchPercent, setChartMatchPercent] = useState(
    DEFAULT_CHART_MATCH_PERCENT,
  );
  const liveAppTokens = useMemo(
    () => ({
      ...baseTheme.appTokens,
      ...baseTheme.chartPalette,
      ...cssOverrides,
    }),
    [baseTheme.appTokens, baseTheme.chartPalette, cssOverrides],
  );

  const scalarValue = (semanticId: string, fallback: string): StyleLabTokenValue => {
    const authored = semanticOverrides[semanticId];
    if (authored != null) return authored;
    const cssVar = tokenMetadata[semanticId]?.cssVar;
    const resolved = resolveSimpleCssValue(
      cssVar ? liveAppTokens[cssVar] : undefined,
      liveAppTokens,
    );
    return resolved ?? fallback;
  };

  const resolvedColorTokenValue = (
    semanticId: string,
  ): StyleLabTokenValue | null => {
    const authored = semanticOverrides[semanticId];
    if (authored != null && colorFromValue(authored)) return authored;
    const cssVar = tokenMetadata[semanticId]?.cssVar;
    const resolved = resolveSimpleCssValue(
      cssVar ? liveAppTokens[cssVar] : undefined,
      liveAppTokens,
    );
    return resolved && colorFromValue(resolved) ? resolved : null;
  };

  const surfaceColorValue = (
    target: Exclude<AppSurfaceId, "global">,
    property: "background" | "foreground",
  ): StyleLabTokenValue => {
    const tokens = SURFACE_COLOR_TOKEN[target];
    const primary = property === "background"
      ? tokens.background
      : tokens.foreground;
    const fallback = property === "background"
      ? tokens.backgroundFallback
      : tokens.foregroundFallback;
    return (
      resolvedColorTokenValue(primary)
      ?? resolvedColorTokenValue(fallback)
      ?? (property === "background" ? "#ffffff" : "#000000")
    );
  };

  const currentCanvas = colorHex(
    Object.hasOwn(semanticOverrides, CHART_BACKGROUND_TOKEN)
      ? semanticOverrides[CHART_BACKGROUND_TOKEN]
      : scalarValue(CORE_PALETTE_TOKEN.background, "#f4f2ed"),
  );
  const currentAccent = colorHex(
    scalarValue(CORE_PALETTE_TOKEN.accent, "#1d63a8"),
  );
  const currentTypeface = String(
    scalarValue(
      UI_TYPEFACE_TOKEN,
      baseTheme.appTokens["--aries-font-ui"]
        ?? "'FreeSans', ui-sans-serif, system-ui, sans-serif",
    ),
  );
  const typefaceOptions = UI_TYPEFACE_OPTIONS.some(
    (option) => option.value === currentTypeface,
  )
    ? UI_TYPEFACE_OPTIONS
    : [{ value: currentTypeface, label: currentTypeface }, ...UI_TYPEFACE_OPTIONS];
  const linkedPaletteSourceKey = JSON.stringify([
    baseTheme.sourceThemeName,
    currentCanvas,
    currentAccent,
  ]);
  const [storedPaletteAnchors, setStoredPaletteAnchors] = useState(() => ({
    sourceKey: linkedPaletteSourceKey,
    canvas: currentCanvas,
    accent: currentAccent,
  }));
  const paletteAnchors = storedPaletteAnchors.sourceKey === linkedPaletteSourceKey
    ? storedPaletteAnchors
    : {
        sourceKey: linkedPaletteSourceKey,
        canvas: currentCanvas,
        accent: currentAccent,
      };
  if (paletteAnchors !== storedPaletteAnchors) {
    setStoredPaletteAnchors(paletteAnchors);
  }
  const canvasAnchor = paletteAnchors.canvas;
  const accentAnchor = paletteAnchors.accent;
  const setCanvasAnchor = (canvas: string) => {
    setStoredPaletteAnchors({ ...paletteAnchors, canvas });
  };
  const setAccentAnchor = (accent: string) => {
    setStoredPaletteAnchors({ ...paletteAnchors, accent });
  };

  // The one colour that stands for how the chart looks. An unsaved edit counts
  // first, then the document falls back to what the wheel is actually painted
  // with — a theme carries chart colours through the applied stylesheet whether
  // or not this editor has loaded its source.
  const chartKey = chartKeyColor(
    CHART_KEY_COLOR_SOURCES.map(({ semanticId, cssVar }) => {
      const authored = resolvedColorTokenValue(semanticId);
      return authored == null ? readRootCssColorToken(cssVar) : colorHex(authored);
    }),
  );
  const matchAmount = chartKey ? chartMatchPercent / 100 : 0;

  // Harmonisation moves the *anchors*, not the derived palette: hue is the only
  // thing it touches, and deriveLinkedPalette then re-enforces every contrast
  // contract on the result, so agreeing with the chart can never cost legibility.
  const linkedPalette = useMemo(
    () => {
      const source = chartKey && matchAmount > 0 ? chartKey : null;
      return deriveLinkedPalette({
        canvas: source
          ? harmonizeToward(canvasAnchor, source, matchAmount)
          : canvasAnchor,
        accent: source
          ? harmonizeToward(accentAnchor, source, matchAmount)
          : accentAnchor,
        harmony,
        contrastTarget,
        mode: baseTheme.mode,
      });
    },
    [
      accentAnchor,
      baseTheme.mode,
      canvasAnchor,
      chartKey,
      contrastTarget,
      harmony,
      matchAmount,
    ],
  );

  const inheritedMaterialValue = (
    target: AppSurfaceId,
    property: AppMaterialProperty,
  ): StyleLabTokenValue => {
    const surfaceId = materialOverrideId(target, property);
    if (semanticOverrides[surfaceId] != null) return semanticOverrides[surfaceId];
    if (target !== "global") {
      const globalId = materialOverrideId("global", property);
      if (semanticOverrides[globalId] != null) return semanticOverrides[globalId];
    }
    if (property === "backgroundColor" && target !== "global") {
      return surfaceColorValue(target, "background");
    }
    if (property === "patternColor" && target !== "global") {
      return surfaceColorValue(target, "foreground");
    }
    if (property === "gradientStartColor" && target !== "global") {
      return surfaceColorValue(target, "background");
    }
    if (property === "gradientEndColor" && target !== "global") {
      return surfaceColorValue(target, "foreground");
    }
    return DEFAULT_APP_MATERIAL_RECIPE[property];
  };

  const updateMaterial = (
    property: AppMaterialProperty,
    value: StyleLabTokenValue,
  ) => {
    setOverride(materialOverrideId(surface, property), value);
    if (property === "backgroundColor" && surface !== "global") {
      setOverride(SURFACE_COLOR_TOKEN[surface].background, value);
    }
  };

  const setMaterial = (
    property: AppMaterialProperty,
    value: StyleLabTokenValue,
  ) => {
    beginGesture(APP_THEME_GESTURE_OWNER);
    updateMaterial(property, value);
    endGesture(APP_THEME_GESTURE_OWNER);
  };

  const resetSurfaceBackground = () => {
    const semanticIds = [materialOverrideId(surface, "backgroundColor")];
    if (surface !== "global") {
      semanticIds.push(SURFACE_COLOR_TOKEN[surface].background);
    }
    resetProperties(semanticIds);
  };

  const applyLinkedPalette = () => {
    beginGesture(APP_THEME_GESTURE_OWNER);
    setOverride(
      CHART_BACKGROUND_TOKEN,
      rgbArrayFromHex(colorHex(linkedPalette.background)),
    );
    setOverride(
      SIDEBAR_ACCENT_FOREGROUND_TOKEN,
      rgbArrayFromHex(colorHex(linkedPalette.accentForeground)),
    );
    const core = {
      [CORE_PALETTE_TOKEN.background]: linkedPalette.background,
      [CORE_PALETTE_TOKEN.surface]: linkedPalette.surface,
      [CORE_PALETTE_TOKEN.surfaceSubtle]: linkedPalette.surfaceSubtle,
      [CORE_PALETTE_TOKEN.accent]: linkedPalette.accent,
      [CORE_PALETTE_TOKEN.accentForeground]:
        linkedPalette.accentForeground,
      [CORE_PALETTE_TOKEN.border]: linkedPalette.border,
      [CORE_PALETTE_TOKEN.textPrimary]: linkedPalette.textPrimary,
      [CORE_PALETTE_TOKEN.textMuted]: linkedPalette.textMuted,
      [CORE_PALETTE_TOKEN.textDim]: linkedPalette.textDim,
    };
    for (const [semanticId, color] of Object.entries(core)) {
      setOverride(semanticId, rgbArrayFromHex(colorHex(color)));
    }
    for (const [role, pair] of Object.entries(linkedPalette.surfaces) as [
      LinkedPaletteSurfaceRole,
      { background: string; foreground: string },
    ][]) {
      const tokens = SURFACE_COLOR_TOKEN[role];
      const background = rgbArrayFromHex(colorHex(pair.background));
      const foreground = rgbArrayFromHex(colorHex(pair.foreground));
      setOverride(tokens.background, background);
      setOverride(tokens.foreground, foreground);
      setOverride(materialOverrideId(role, "backgroundColor"), background);
      setOverride(materialOverrideId(role, "patternColor"), foreground);
      setOverride(materialOverrideId(role, "gradientStartColor"), background);
      setOverride(
        materialOverrideId(role, "gradientEndColor"),
        rgbArrayFromHex(colorHex(
          role === "canvas" ? linkedPalette.surface : linkedPalette.surfaceSubtle,
        )),
      );
    }
    endGesture(APP_THEME_GESTURE_OWNER);
  };

  const backgroundValue = inheritedMaterialValue(surface, "backgroundColor");
  const patternColorValue = inheritedMaterialValue(surface, "patternColor");
  const gradientStartValue = inheritedMaterialValue(surface, "gradientStartColor");
  const gradientEndValue = inheritedMaterialValue(surface, "gradientEndColor");
  const shadowColorValue = inheritedMaterialValue(surface, "shadowColor");
  const shadowAlpha = colorAlpha(shadowColorValue);
  const shadowEnabled = shadowAlpha > 0;
  const rememberedShadowAlpha = useRef<Partial<Record<AppSurfaceId, number>>>({});
  useEffect(() => {
    if (shadowAlpha > 0) rememberedShadowAlpha.current[surface] = shadowAlpha;
  }, [shadowAlpha, surface]);
  const currentGradientType = String(
    inheritedMaterialValue(surface, "gradientType"),
  ) as AppMaterialGradientType;
  const foregroundId = surface === "global"
    ? null
    : SURFACE_COLOR_TOKEN[surface].foreground;
  const foregroundValue = surface === "global"
    ? null
    : surfaceColorValue(surface, "foreground");
  const currentPattern = String(
    inheritedMaterialValue(surface, "pattern"),
  ) as AppMaterialPattern;
  const angleEnabled = (
    currentPattern === "hatch"
    || currentPattern === "crosshatch"
    || currentPattern === "scanline"
  );
  const textureDetailsVisible = (
    currentPattern !== "none"
    && currentPattern !== "solid"
  );
  const textureSeedVisible = (
    currentPattern === "stipple"
    || currentPattern === "bayer2"
    || currentPattern === "bayer4"
    || currentPattern === "bayer8"
    || currentPattern === "noise"
    || currentPattern === "blueNoise"
    || currentPattern === "paper"
    || currentPattern === "newsprint"
    || currentPattern === "atkinson"
    || currentPattern === "floydSteinberg"
  );
  const shadowXValue = Number(inheritedMaterialValue(surface, "shadowX"));
  const shadowYValue = Number(inheritedMaterialValue(surface, "shadowY"));
  const shadowBlurValue = Number(inheritedMaterialValue(surface, "shadowBlur"));
  const setShadowEnabled = (next: boolean) => {
    beginGesture(APP_THEME_GESTURE_OWNER);
    const nextColor = withColorAlpha(
      shadowColorValue,
      next ? (rememberedShadowAlpha.current[surface] ?? 0.22) : 0,
    );
    if (nextColor) updateMaterial("shadowColor", nextColor);
    if (
      next
      && shadowXValue === 0
      && shadowYValue === 0
      && shadowBlurValue === 0
    ) {
      setOverride(materialOverrideId(surface, "shadowY"), 4);
      setOverride(materialOverrideId(surface, "shadowBlur"), 12);
    }
    endGesture(APP_THEME_GESTURE_OWNER);
  };
  const backgroundOverrideIds = [
    materialOverrideId(surface, "backgroundColor"),
    ...(surface === "global"
      ? []
      : [SURFACE_COLOR_TOKEN[surface].background]),
  ];

  return (
    <div className="pb-3">
      <section className="border-b border-[color:var(--aries-inspector-divider-color)] pb-2">
        <SectionTitle>{t("settings.typeface")}</SectionTitle>
        <ControlRow
          label={t("styleLab.control.fontFamily")}
          overridden={Object.hasOwn(semanticOverrides, UI_TYPEFACE_TOKEN)}
          onReset={() => resetProperty(UI_TYPEFACE_TOKEN)}
        >
          <select
            data-aries-control-appearance="local"
            value={currentTypeface}
            aria-label={t("styleLab.control.fontFamily")}
            style={{ fontFamily: currentTypeface }}
            onChange={(event) => {
              beginGesture(APP_THEME_GESTURE_OWNER);
              setOverride(UI_TYPEFACE_TOKEN, event.currentTarget.value);
              endGesture(APP_THEME_GESTURE_OWNER);
            }}
            className="h-[var(--aries-control-height-small)] w-full rounded-[var(--aries-radius-control-compact)] border border-[color:var(--aries-inspector-divider-color)] bg-[var(--aries-inspector-background)] px-[var(--aries-control-gap-compact)] outline-none"
          >
            {typefaceOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.labelKey ? t(option.labelKey) : option.label}
              </option>
            ))}
          </select>
        </ControlRow>
      </section>

      <section className="border-b border-[color:var(--aries-inspector-divider-color)] pb-2">
        <SectionTitle>{t("styleLab.app.linkedPalette.title")}</SectionTitle>
        <p className="px-[var(--aries-inspector-padding-x)] py-2 text-[length:var(--aries-font-size-micro)] leading-relaxed text-[color:var(--aries-inspector-muted-color)]">
          {t("styleLab.app.linkedPalette.description")}
        </p>
        <ControlRow label={t("styleLab.app.linkedPalette.canvas")}>
          <StyleLabColorPicker
            value={canvasAnchor}
            label={t("styleLab.app.linkedPalette.canvas")}
            onChange={setCanvasAnchor}
            className="size-7"
          />
        </ControlRow>
        <ControlRow label={t("styleLab.app.linkedPalette.accent")}>
          <StyleLabColorPicker
            value={accentAnchor}
            label={t("styleLab.app.linkedPalette.accent")}
            onChange={setAccentAnchor}
            className="size-7"
          />
        </ControlRow>
        <ControlRow label={t("styleLab.app.linkedPalette.chartKey")}>
          <div className="flex min-w-0 items-center gap-1">
            <span
              aria-hidden="true"
              className="size-6 shrink-0 rounded-[var(--aries-radius-control-compact)] border border-[color:var(--aries-inspector-divider-color)]"
              style={chartKey ? { background: chartKey } : undefined}
            />
            <span
              className={cn(
                "min-w-0 flex-1 truncate text-[length:var(--aries-font-size-micro)]",
                chartKey
                  ? "font-mono"
                  : "text-[color:var(--aries-inspector-muted-color)]",
              )}
            >
              {chartKey
                ? chartKey.toUpperCase()
                : t("styleLab.app.linkedPalette.chartKeyNone")}
            </span>
          </div>
        </ControlRow>
        <NumberRow
          label={t("styleLab.app.linkedPalette.matchToChart")}
          value={chartMatchPercent}
          min={0}
          max={100}
          step={1}
          unit="%"
          disabled={!chartKey}
          overridden={chartMatchPercent !== DEFAULT_CHART_MATCH_PERCENT}
          onChange={setChartMatchPercent}
          onReset={() => setChartMatchPercent(DEFAULT_CHART_MATCH_PERCENT)}
        />
        <ControlRow label={t("styleLab.app.linkedPalette.harmony")}>
          <select
            data-aries-control-appearance="local"
            value={harmony}
            aria-label={t("styleLab.app.linkedPalette.harmony")}
            onChange={(event) =>
              setHarmony(event.currentTarget.value as LinkedPaletteHarmony)
            }
            className="h-[var(--aries-control-height-small)] w-full rounded-[var(--aries-radius-control-compact)] border border-[color:var(--aries-inspector-divider-color)] bg-[var(--aries-inspector-background)] px-[var(--aries-control-gap-compact)] outline-none"
          >
            {(["source", "complementary", "analogous", "splitComplementary", "triadic"] as const)
              .map((value) => (
                <option key={value} value={value}>
                  {t(`styleLab.app.harmony.${value}`)}
                </option>
              ))}
          </select>
        </ControlRow>
        <ControlRow label={t("styleLab.app.linkedPalette.contrast")}>
          <select
            data-aries-control-appearance="local"
            value={contrastTarget}
            aria-label={t("styleLab.app.linkedPalette.contrast")}
            onChange={(event) =>
              setContrastTarget(event.currentTarget.value as LinkedPaletteContrastTarget)
            }
            className="h-[var(--aries-control-height-small)] w-full rounded-[var(--aries-radius-control-compact)] border border-[color:var(--aries-inspector-divider-color)] bg-[var(--aries-inspector-background)] px-[var(--aries-control-gap-compact)] outline-none"
          >
            <option value="aa">
              {t("styleLab.app.contrast.primaryTextAa")}
            </option>
            <option value="aaa">
              {t("styleLab.app.contrast.primaryTextAaa")}
            </option>
          </select>
        </ControlRow>
        <div className="flex items-center justify-between gap-2 px-[var(--aries-inspector-padding-x)] pt-2">
          <span className="text-[length:var(--aries-font-size-micro)] text-[color:var(--aries-inspector-muted-color)]">
            {t("styleLab.app.linkedPalette.primaryTextMinimum", {
              ratio: linkedPalette.contrastReport.primaryMinimum.toFixed(1),
            })}
          </span>
          <button
            type="button"
            onClick={applyLinkedPalette}
            className="inline-flex h-7 items-center gap-1 rounded-[var(--aries-radius-control-compact)] border border-[color:var(--aries-inspector-divider-color)] px-2 text-[length:var(--aries-font-size-small)] text-[color:var(--aries-inspector-title-color)] hover:bg-[var(--aries-navbar-hover-bg)]"
          >
            <Shuffle size={12} />
            {t("styleLab.app.linkedPalette.apply")}
          </button>
        </div>
      </section>

      <section>
        <SectionTitle>{t("styleLab.app.material.title")}</SectionTitle>
        <div className="px-[var(--aries-inspector-padding-x)] py-2">
          <select
            data-aries-control-appearance="local"
            value={surface}
            aria-label={t("styleLab.app.surface.label")}
            onChange={(event) => setSurface(event.currentTarget.value as AppSurfaceId)}
            className="h-[var(--aries-control-height)] w-full rounded-[var(--aries-radius-control-compact)] border border-[color:var(--aries-inspector-divider-color)] bg-[var(--aries-inspector-background)] px-[var(--aries-control-padding-x-compact)] text-[length:var(--aries-font-size-small)] outline-none"
          >
            {APP_SURFACES.map((value) => (
              <option key={value} value={value}>{surfaceLabel(value, t)}</option>
            ))}
          </select>
          <p className="pt-2 text-[length:var(--aries-font-size-micro)] leading-relaxed text-[color:var(--aries-inspector-muted-color)]">
            {surface === "global"
              ? t("styleLab.app.material.globalDescription")
              : t("styleLab.app.material.surfaceDescription")}
          </p>
        </div>

        <MaterialGroup
          key={`${surface}:fill`}
          title={t("styleLab.group.fill")}
          summary={currentGradientType === "none"
            ? undefined
            : gradientLabel(currentGradientType, t)}
          defaultOpen
        >
          <AppColorRow
            label={t("styleLab.app.material.backgroundColor")}
            value={backgroundValue}
            overridden={backgroundOverrideIds.some((semanticId) =>
              Object.hasOwn(semanticOverrides, semanticId)
            )}
            onReset={resetSurfaceBackground}
            preserveAlpha
            onChange={(value) => updateMaterial("backgroundColor", value)}
            onGestureStart={() => beginGesture(APP_THEME_GESTURE_OWNER)}
            onGestureEnd={() => endGesture(APP_THEME_GESTURE_OWNER)}
            onGestureCancel={() => cancelGesture(APP_THEME_GESTURE_OWNER)}
          />
          <NumberRow
            label={t("styleLab.app.material.backgroundAlpha")}
            value={Math.round(colorAlpha(backgroundValue) * 100)}
            min={0}
            max={100}
            step={1}
            unit="%"
            overridden={backgroundOverrideIds.some((semanticId) =>
              Object.hasOwn(semanticOverrides, semanticId)
            )}
            onChange={(value) => {
              const next = withColorAlpha(backgroundValue, value / 100);
              if (next) updateMaterial("backgroundColor", next);
            }}
            onReset={resetSurfaceBackground}
            onGestureStart={() => beginGesture(APP_THEME_GESTURE_OWNER)}
            onGestureEnd={() => endGesture(APP_THEME_GESTURE_OWNER)}
          />
          {foregroundId && foregroundValue ? (
            <AppColorRow
              label={t("styleLab.app.material.foregroundColor")}
              value={foregroundValue}
              overridden={Object.hasOwn(semanticOverrides, foregroundId)}
              onReset={() => resetProperty(foregroundId)}
              onChange={(value) => setOverride(foregroundId, value)}
              onGestureStart={() => beginGesture(APP_THEME_GESTURE_OWNER)}
              onGestureEnd={() => endGesture(APP_THEME_GESTURE_OWNER)}
              onGestureCancel={() => cancelGesture(APP_THEME_GESTURE_OWNER)}
            />
          ) : null}
          <ControlRow
            label={t("styleLab.app.material.gradientType")}
            overridden={Object.hasOwn(
              semanticOverrides,
              materialOverrideId(surface, "gradientType"),
            )}
            onReset={() => resetProperty(materialOverrideId(surface, "gradientType"))}
          >
            <select
              data-aries-control-appearance="local"
              value={currentGradientType}
              aria-label={t("styleLab.app.material.gradientType")}
              onChange={(event) => setMaterial("gradientType", event.currentTarget.value)}
              className="h-[var(--aries-control-height-small)] w-full rounded-[var(--aries-radius-control-compact)] border border-[color:var(--aries-inspector-divider-color)] bg-[var(--aries-inspector-background)] px-[var(--aries-control-gap-compact)] outline-none"
            >
              {APP_MATERIAL_GRADIENT_TYPES.map((value) => (
                <option key={value} value={value}>{gradientLabel(value, t)}</option>
              ))}
            </select>
          </ControlRow>
          {currentGradientType !== "none" ? (
            <>
              <AppColorRow
                label={t("styleLab.app.material.gradientStartColor")}
                value={gradientStartValue}
                overridden={Object.hasOwn(
                  semanticOverrides,
                  materialOverrideId(surface, "gradientStartColor"),
                )}
                onReset={() => resetProperty(materialOverrideId(surface, "gradientStartColor"))}
                preserveAlpha
                onChange={(value) => updateMaterial("gradientStartColor", value)}
                onGestureStart={() => beginGesture(APP_THEME_GESTURE_OWNER)}
                onGestureEnd={() => endGesture(APP_THEME_GESTURE_OWNER)}
                onGestureCancel={() => cancelGesture(APP_THEME_GESTURE_OWNER)}
              />
              <AppColorRow
                label={t("styleLab.app.material.gradientEndColor")}
                value={gradientEndValue}
                overridden={Object.hasOwn(
                  semanticOverrides,
                  materialOverrideId(surface, "gradientEndColor"),
                )}
                onReset={() => resetProperty(materialOverrideId(surface, "gradientEndColor"))}
                preserveAlpha
                onChange={(value) => updateMaterial("gradientEndColor", value)}
                onGestureStart={() => beginGesture(APP_THEME_GESTURE_OWNER)}
                onGestureEnd={() => endGesture(APP_THEME_GESTURE_OWNER)}
                onGestureCancel={() => cancelGesture(APP_THEME_GESTURE_OWNER)}
              />
              <NumberRow
                label={t("styleLab.app.material.gradientAngle")}
                value={Number(inheritedMaterialValue(surface, "gradientAngle"))}
                min={-180}
                max={180}
                step={1}
                unit="°"
                overridden={Object.hasOwn(
                  semanticOverrides,
                  materialOverrideId(surface, "gradientAngle"),
                )}
                onChange={(value) =>
                  setOverride(materialOverrideId(surface, "gradientAngle"), value)
                }
                onReset={() => resetProperty(materialOverrideId(surface, "gradientAngle"))}
                onGestureStart={() => beginGesture(APP_THEME_GESTURE_OWNER)}
                onGestureEnd={() => endGesture(APP_THEME_GESTURE_OWNER)}
              />
            </>
          ) : null}
        </MaterialGroup>
        <MaterialGroup
          key={`${surface}:texture`}
          title={t("styleLab.group.texture")}
          summary={currentPattern === "none"
            ? t("styleLab.group.off")
            : patternLabel(currentPattern, t)}
          defaultOpen={currentPattern !== "none"}
        >
          <ControlRow
            label={t("styleLab.app.material.pattern")}
            overridden={Object.hasOwn(semanticOverrides, materialOverrideId(surface, "pattern"))}
            onReset={() => resetProperty(materialOverrideId(surface, "pattern"))}
          >
            <select
              data-aries-control-appearance="local"
              value={currentPattern}
              aria-label={t("styleLab.app.material.pattern")}
              onChange={(event) => setMaterial("pattern", event.currentTarget.value)}
              className="h-[var(--aries-control-height-small)] w-full rounded-[var(--aries-radius-control-compact)] border border-[color:var(--aries-inspector-divider-color)] bg-[var(--aries-inspector-background)] px-[var(--aries-control-gap-compact)] outline-none"
            >
              {APP_MATERIAL_PATTERNS.map((value) => (
                <option key={value} value={value}>{patternLabel(value, t)}</option>
              ))}
            </select>
          </ControlRow>
          {currentPattern !== "none" ? (
            <>
              <AppColorRow
                label={t("styleLab.app.material.patternColor")}
                value={patternColorValue}
                overridden={Object.hasOwn(
                  semanticOverrides,
                  materialOverrideId(surface, "patternColor"),
                )}
                onReset={() => resetProperty(materialOverrideId(surface, "patternColor"))}
                preserveAlpha
                onChange={(value) => updateMaterial("patternColor", value)}
                onGestureStart={() => beginGesture(APP_THEME_GESTURE_OWNER)}
                onGestureEnd={() => endGesture(APP_THEME_GESTURE_OWNER)}
                onGestureCancel={() => cancelGesture(APP_THEME_GESTURE_OWNER)}
              />
              <NumberRow
                label={t("styleLab.app.material.opacity")}
                value={Number(inheritedMaterialValue(surface, "opacity"))}
                min={0}
                max={100}
                step={1}
                unit="%"
                overridden={Object.hasOwn(
                  semanticOverrides,
                  materialOverrideId(surface, "opacity"),
                )}
                onChange={(value) =>
                  setOverride(materialOverrideId(surface, "opacity"), value)
                }
                onReset={() => resetProperty(materialOverrideId(surface, "opacity"))}
                onGestureStart={() => beginGesture(APP_THEME_GESTURE_OWNER)}
                onGestureEnd={() => endGesture(APP_THEME_GESTURE_OWNER)}
              />
            </>
          ) : null}
          {textureDetailsVisible ? (
            <>
              <NumberRow
                label={t("styleLab.app.material.density")}
                value={Number(inheritedMaterialValue(surface, "density"))}
                min={0}
                max={100}
                step={1}
                unit="%"
                overridden={Object.hasOwn(semanticOverrides, materialOverrideId(surface, "density"))}
                onChange={(value) => setOverride(materialOverrideId(surface, "density"), value)}
                onReset={() => resetProperty(materialOverrideId(surface, "density"))}
                onGestureStart={() => beginGesture(APP_THEME_GESTURE_OWNER)}
                onGestureEnd={() => endGesture(APP_THEME_GESTURE_OWNER)}
              />
              <NumberRow
                label={t("styleLab.app.material.cellSize")}
                value={Number(inheritedMaterialValue(surface, "cellSize"))}
                min={0.5}
                max={64}
                step={0.5}
                unit="px"
                overridden={Object.hasOwn(semanticOverrides, materialOverrideId(surface, "cellSize"))}
                onChange={(value) => setOverride(materialOverrideId(surface, "cellSize"), value)}
                onReset={() => resetProperty(materialOverrideId(surface, "cellSize"))}
                onGestureStart={() => beginGesture(APP_THEME_GESTURE_OWNER)}
                onGestureEnd={() => endGesture(APP_THEME_GESTURE_OWNER)}
              />
              <NumberRow
                label={t("styleLab.app.material.dotSize")}
                value={Number(inheritedMaterialValue(surface, "dotSize"))}
                min={0.25}
                max={32}
                step={0.25}
                unit="px"
                overridden={Object.hasOwn(semanticOverrides, materialOverrideId(surface, "dotSize"))}
                onChange={(value) => setOverride(materialOverrideId(surface, "dotSize"), value)}
                onReset={() => resetProperty(materialOverrideId(surface, "dotSize"))}
                onGestureStart={() => beginGesture(APP_THEME_GESTURE_OWNER)}
                onGestureEnd={() => endGesture(APP_THEME_GESTURE_OWNER)}
              />
              {angleEnabled ? (
                <NumberRow
                  label={t("styleLab.app.material.angle")}
                  value={Number(inheritedMaterialValue(surface, "angle"))}
                  min={-180}
                  max={180}
                  step={1}
                  unit="°"
                  overridden={Object.hasOwn(semanticOverrides, materialOverrideId(surface, "angle"))}
                  onChange={(value) => setOverride(materialOverrideId(surface, "angle"), value)}
                  onReset={() => resetProperty(materialOverrideId(surface, "angle"))}
                  onGestureStart={() => beginGesture(APP_THEME_GESTURE_OWNER)}
                  onGestureEnd={() => endGesture(APP_THEME_GESTURE_OWNER)}
                />
              ) : null}
              {textureSeedVisible ? (
                <NumberRow
                  label={t("styleLab.app.material.seed")}
                  value={Number(inheritedMaterialValue(surface, "seed"))}
                  min={0}
                  max={65535}
                  step={1}
                  unit=""
                  overridden={Object.hasOwn(semanticOverrides, materialOverrideId(surface, "seed"))}
                  onChange={(value) =>
                    setOverride(materialOverrideId(surface, "seed"), Math.round(value))
                  }
                  onReset={() => resetProperty(materialOverrideId(surface, "seed"))}
                  onGestureStart={() => beginGesture(APP_THEME_GESTURE_OWNER)}
                  onGestureEnd={() => endGesture(APP_THEME_GESTURE_OWNER)}
                />
              ) : null}
            </>
          ) : null}
        </MaterialGroup>
        <MaterialGroup
          key={`${surface}:compositing`}
          title={t("styleLab.group.compositing")}
          defaultOpen={false}
        >
          <ControlRow
            label={t("styleLab.app.material.blendMode")}
            overridden={Object.hasOwn(
              semanticOverrides,
              materialOverrideId(surface, "blendMode"),
            )}
            onReset={() => resetProperty(materialOverrideId(surface, "blendMode"))}
          >
            <select
              data-aries-control-appearance="local"
              value={String(inheritedMaterialValue(surface, "blendMode"))}
              aria-label={t("styleLab.app.material.blendMode")}
              onChange={(event) => setMaterial("blendMode", event.currentTarget.value)}
              className="h-[var(--aries-control-height-small)] w-full rounded-[var(--aries-radius-control-compact)] border border-[color:var(--aries-inspector-divider-color)] bg-[var(--aries-inspector-background)] px-[var(--aries-control-gap-compact)] outline-none"
            >
              {APP_MATERIAL_BLEND_MODES.map((value) => (
                <option key={value} value={value}>{blendLabel(value, t)}</option>
              ))}
            </select>
          </ControlRow>
          <NumberRow
            label={t("styleLab.app.material.backdropBlur")}
            value={Number(inheritedMaterialValue(surface, "backdropBlur"))}
            min={0}
            max={40}
            step={0.5}
            unit="px"
            overridden={Object.hasOwn(
              semanticOverrides,
              materialOverrideId(surface, "backdropBlur"),
            )}
            onChange={(value) =>
              setOverride(materialOverrideId(surface, "backdropBlur"), value)
            }
            onReset={() => resetProperty(materialOverrideId(surface, "backdropBlur"))}
            onGestureStart={() => beginGesture(APP_THEME_GESTURE_OWNER)}
            onGestureEnd={() => endGesture(APP_THEME_GESTURE_OWNER)}
          />
          <NumberRow
            label={t("styleLab.app.material.backdropSaturation")}
            value={Number(inheritedMaterialValue(surface, "backdropSaturation"))}
            min={0}
            max={200}
            step={1}
            unit="%"
            overridden={Object.hasOwn(
              semanticOverrides,
              materialOverrideId(surface, "backdropSaturation"),
            )}
            onChange={(value) => setOverride(
              materialOverrideId(surface, "backdropSaturation"),
              value,
            )}
            onReset={() => resetProperty(materialOverrideId(surface, "backdropSaturation"))}
            onGestureStart={() => beginGesture(APP_THEME_GESTURE_OWNER)}
            onGestureEnd={() => endGesture(APP_THEME_GESTURE_OWNER)}
          />
        </MaterialGroup>
        <MaterialGroup
          key={`${surface}:shadow`}
          title={t("styleLab.group.shadow")}
          summary={shadowEnabled
            ? `${shadowXValue}px, ${shadowYValue}px · ${shadowBlurValue}px`
            : t("styleLab.group.off")}
          defaultOpen={shadowEnabled}
          enabled={shadowEnabled}
          onEnabledChange={setShadowEnabled}
        >
          {shadowEnabled ? (
            <>
              <AppColorRow
                label={t("styleLab.control.shadowColor")}
                value={shadowColorValue}
                overridden={Object.hasOwn(
                  semanticOverrides,
                  materialOverrideId(surface, "shadowColor"),
                )}
                onReset={() => resetProperty(materialOverrideId(surface, "shadowColor"))}
                preserveAlpha
                onChange={(value) => updateMaterial("shadowColor", value)}
                onGestureStart={() => beginGesture(APP_THEME_GESTURE_OWNER)}
                onGestureEnd={() => endGesture(APP_THEME_GESTURE_OWNER)}
                onGestureCancel={() => cancelGesture(APP_THEME_GESTURE_OWNER)}
              />
              <NumberRow
                label={t("styleLab.group.shadowOpacity")}
                value={Math.round(shadowAlpha * 100)}
                min={0}
                max={100}
                step={1}
                unit="%"
                overridden={Object.hasOwn(
                  semanticOverrides,
                  materialOverrideId(surface, "shadowColor"),
                )}
                onChange={(value) => {
                  const next = withColorAlpha(shadowColorValue, value / 100);
                  if (next) updateMaterial("shadowColor", next);
                }}
                onReset={() => resetProperty(materialOverrideId(surface, "shadowColor"))}
                onGestureStart={() => beginGesture(APP_THEME_GESTURE_OWNER)}
                onGestureEnd={() => endGesture(APP_THEME_GESTURE_OWNER)}
              />
              <NumberRow
                label={t("styleLab.control.shadowOffsetX")}
                value={shadowXValue}
                min={-64}
                max={64}
                step={0.5}
                unit="px"
                overridden={Object.hasOwn(
                  semanticOverrides,
                  materialOverrideId(surface, "shadowX"),
                )}
                onChange={(value) => setOverride(materialOverrideId(surface, "shadowX"), value)}
                onReset={() => resetProperty(materialOverrideId(surface, "shadowX"))}
                onGestureStart={() => beginGesture(APP_THEME_GESTURE_OWNER)}
                onGestureEnd={() => endGesture(APP_THEME_GESTURE_OWNER)}
              />
              <NumberRow
                label={t("styleLab.control.shadowOffsetY")}
                value={shadowYValue}
                min={-64}
                max={64}
                step={0.5}
                unit="px"
                overridden={Object.hasOwn(
                  semanticOverrides,
                  materialOverrideId(surface, "shadowY"),
                )}
                onChange={(value) => setOverride(materialOverrideId(surface, "shadowY"), value)}
                onReset={() => resetProperty(materialOverrideId(surface, "shadowY"))}
                onGestureStart={() => beginGesture(APP_THEME_GESTURE_OWNER)}
                onGestureEnd={() => endGesture(APP_THEME_GESTURE_OWNER)}
              />
              <NumberRow
                label={t("styleLab.control.shadowBlur")}
                value={shadowBlurValue}
                min={0}
                max={80}
                step={0.5}
                unit="px"
                overridden={Object.hasOwn(
                  semanticOverrides,
                  materialOverrideId(surface, "shadowBlur"),
                )}
                onChange={(value) => setOverride(materialOverrideId(surface, "shadowBlur"), value)}
                onReset={() => resetProperty(materialOverrideId(surface, "shadowBlur"))}
                onGestureStart={() => beginGesture(APP_THEME_GESTURE_OWNER)}
                onGestureEnd={() => endGesture(APP_THEME_GESTURE_OWNER)}
              />
            </>
          ) : null}
        </MaterialGroup>
      </section>
    </div>
  );
}
