// SPDX-FileCopyrightText: Morinus contributors
// SPDX-FileCopyrightText: 2026 Max Lange (Aries modifications)
// SPDX-License-Identifier: GPL-3.0-or-later
// Modified for Aries in 2026 by Max Lange.

"use client";

import * as React from "react";

import { useStyleRevision } from "@/hooks/use-style-revision";
import {
  createStripRenderStyle,
  resolveStripRenderStyle,
  type StripRenderStyle,
} from "@/lib/chart/strip-render-style";
import type {
  GenericTablePayload,
  StripBody,
} from "@/lib/daemon/client";
import { useT } from "@/lib/i18n/i18n";
import { semanticChartColor } from "@/lib/theme/semantic-color";
import { useThemeStore } from "@/stores/theme-store";

/**
 * 30° Strip surface — structural translation of the wx StripWnd
 * (stripwnd.py:78-646). The wx surface is a single graphical 0-30° axis with
 * 1°/5° tick marks (stripwnd.py:135-153), body glyphs placed at their
 * within-sign degree (stripwnd.py:214-217), an anti-overlap algorithm
 * (arrange/doArrange/doShift, stripwnd.py:407-646) that nudges colliding
 * glyphs apart, and a colored connector line from each nudged glyph back to
 * its true axis position (stripwnd.py:218).
 *
 * The daemon emits only the semantic data (per-body within-sign degree +
 * color + glyph); this view owns pixel placement + the anti-overlap nudging.
 * Although the payload is grouped by true sign for export/table fallbacks, the
 * graphical surface merges all bodies onto the original single wx strip.
 */

type Props = {
  payload: GenericTablePayload;
};

const BOOTSTRAP_STRIP_STYLE = createStripRenderStyle({
  palette: {
    background: "var(--aries-background, #232428)",
    axis: "var(--aries-border-subtle, #2e2f32)",
    textPrimary: "var(--aries-text-primary, #ffffff)",
    textMuted: "var(--aries-text-muted, #b4b5b6)",
  },
  fontUi: "var(--aries-font-ui)",
  fontSymbols: "var(--aries-font-symbols)",
});

const EMPTY_STRIP_PROFILE_OVERRIDES: Readonly<Record<string, string>> = Object.freeze({});

export function StripView({ payload }: Props) {
  const t = useT();
  const styleRevision = useStyleRevision();
  const chartProfileOverrides = useThemeStore(
    (state) => state.theme?.profileOverrides.chartPalette ?? EMPTY_STRIP_PROFILE_OVERRIDES,
  );
  const hostRef = React.useRef<HTMLDivElement>(null);
  const [renderStyle, setRenderStyle] = React.useState<StripRenderStyle>(BOOTSTRAP_STRIP_STYLE);
  const strip = payload.strip;
  const hasBodies = Boolean(strip?.signs.length);

  // ThemeProvider applies daemon tokens in a parent layout effect. Resolve in
  // the passive phase so this snapshot cannot observe the previous revision;
  // the bootstrap style uses semantic var() references for a flash-free first paint.
  React.useEffect(() => {
    setRenderStyle(resolveStripRenderStyle(hostRef.current, {
      revision: styleRevision,
      profileOverrides: chartProfileOverrides,
    }));
  }, [chartProfileOverrides, hasBodies, styleRevision]);

  if (!strip || !strip.signs.length) {
    return (
      <div
        ref={hostRef}
        className="font-morinus-text flex h-full min-h-0 items-center justify-center p-6"
        style={{
          backgroundColor: renderStyle.palette.background,
          color: renderStyle.palette.textMuted,
          fontFamily: renderStyle.typography.fontUi,
          fontSize: renderStyle.typography.emptyFontSize,
        }}
      >
        {t("strip.noBodies")}
      </div>
    );
  }

  const bodies: StripBodyWithSign[] = strip.signs.flatMap((sign) =>
    sign.bodies.map((body, index) => ({
      ...body,
      signId: sign.signId,
      signGlyph: sign.signGlyph,
      sourceIndex: index,
    })),
  );
  const placed = arrangeBodies(bodies, renderStyle);
  const layout = renderStyle.layout;
  const palette = renderStyle.palette;
  const typography = renderStyle.typography;

  return (
    <div
      ref={hostRef}
      className="min-h-0 flex-1 overflow-auto"
      style={{
        backgroundColor: palette.background,
        padding: layout.containerPadding,
      }}
    >
      <svg
        width={layout.stripWidth}
        height={layout.stripHeight}
        viewBox={`0 0 ${layout.stripWidth} ${layout.stripHeight}`}
        className="block max-w-none shrink-0"
        role="img"
        aria-label={t("strip.ariaLabel")}
      >
        {/* axis line (stripwnd.py:127) */}
        <line
          x1={layout.border}
          y1={layout.axisY}
          x2={layout.border + layout.axisWidth}
          y2={layout.axisY}
          stroke={palette.axis}
          strokeWidth={renderStyle.strokes.axis}
        />
        {/* end caps = long ticks (stripwnd.py:129-131) */}
        <line
          x1={layout.border}
          y1={layout.axisY - layout.longTick}
          x2={layout.border}
          y2={layout.axisY + layout.longTick}
          stroke={palette.axis}
          strokeWidth={renderStyle.strokes.axis}
        />
        <line
          x1={layout.border + layout.axisWidth}
          y1={layout.axisY - layout.longTick}
          x2={layout.border + layout.axisWidth}
          y2={layout.axisY + layout.longTick}
          stroke={palette.axis}
          strokeWidth={renderStyle.strokes.axis}
        />
        {/* degree ticks: long every 5°, short otherwise (stripwnd.py:135-142) */}
        {Array.from({ length: 30 }, (_, i) => i).map((i) => {
          if (i === 0) return null;
          const x = layout.border + i * layout.degreePx;
          const len = i % 5 === 0 ? layout.fiveTick : layout.oneTick;
          return (
            <line
              key={`tick:${i}`}
              x1={x}
              y1={layout.axisY}
              x2={x}
              y2={layout.axisY + len}
              stroke={palette.axis}
              strokeWidth={renderStyle.strokes.axis}
            />
          );
        })}
        {/* degree labels at 0,5,10,...,30 (stripwnd.py:144-153) */}
        {Array.from({ length: 7 }, (_, k) => k * 5).map((deg) => (
          <text
            key={`lbl:${deg}`}
            x={layout.border + deg * layout.degreePx}
            y={layout.labelY}
            textAnchor="middle"
            dominantBaseline="hanging"
            fill={palette.textPrimary}
            style={{ fontSize: typography.fontSize, fontFamily: typography.fontUi }}
          >
            {deg}
          </text>
        ))}
        {/* bodies: nudged glyph + connector to true axis x (stripwnd.py:217-218) */}
        {placed.map((b) => {
          const trueX = layout.border + b.body.degree * layout.degreePx;
          const dispX = layout.border + b.displayDeg * layout.degreePx;
          const color = semanticChartColor(
            b.body.colorRole,
            b.body.colorHex ?? palette.textPrimary,
          ) ?? palette.textPrimary;
          return (
            <g key={b.key}>
              <line
                x1={trueX}
                y1={layout.axisY}
                x2={dispX}
                y2={layout.glyphConnectY}
                stroke={color}
                strokeWidth={renderStyle.strokes.connector}
              />
              <text
                x={dispX}
                y={layout.glyphTop}
                textAnchor="middle"
                dominantBaseline="hanging"
                fill={color}
                style={{
                  fontFamily:
                    b.body.glyphFont === "morinus"
                      ? typography.fontSymbols
                      : typography.fontUi,
                  fontSize: typography.fontSize,
                }}
              >
                <title>{`${b.body.label} ${b.body.signGlyph} ${b.body.minuteLabel}`}</title>
                {b.body.glyph}
              </text>
            </g>
          );
        })}
      </svg>
      {payload.notes?.length ? (
        <div
          className="space-y-1"
          style={{
            marginTop: layout.notesGap,
            color: palette.textMuted,
            fontFamily: typography.fontUi,
            fontSize: typography.notesFontSize,
          }}
        >
          {payload.notes.map((note, index) => (
            <div key={`${index}:${note}`}>{note}</div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

type StripBodyWithSign = StripBody & {
  signId: number;
  signGlyph: string;
  sourceIndex: number;
};

type PlacedBody = {
  key: string;
  body: StripBodyWithSign;
  displayDeg: number; // nudged within-sign degree for the glyph center
  halfWidthPx: number;
};

/**
 * Port of the wx arrange()/doArrange()/doShift() intent (stripwnd.py:407-646):
 * sort by axis position, then iteratively nudge colliding neighbours apart so
 * glyph boxes don't overlap, finally clamp to the 0-30 bounds. The connector
 * line (drawn by the caller) ties each nudged glyph back to its true degree.
 *
 * wx works in pixels; we work in degree units using the style's degree scale. The approximate
 * glyph widths keep AS/MC text from being treated like one-character symbols.
 */
function arrangeBodies(
  bodies: StripBodyWithSign[],
  style: StripRenderStyle,
): PlacedBody[] {
  const placed: PlacedBody[] = bodies
    .map((body) => ({
      key: `${body.signId}:${body.label}:${body.sourceIndex}`,
      body,
      displayDeg: body.degree,
      halfWidthPx: approximateBodyWidth(body, style) / 2,
    }))
    .sort((a, b) => a.displayDeg - b.displayDeg);

  // Forward sweep: push each colliding body rightward off its left neighbour
  // (doShift nudges the higher index forward, stripwnd.py:631-642).
  for (let pass = 0; pass < placed.length; pass += 1) {
    let shifted = false;
    for (let i = 0; i < placed.length - 1; i += 1) {
      const gap = placed[i + 1].displayDeg - placed[i].displayDeg;
      const minSpacingDeg = requiredSpacingDeg(placed[i], placed[i + 1], style);
      if (gap < minSpacingDeg) {
        const push = (minSpacingDeg - gap) / 2;
        placed[i].displayDeg -= push;
        placed[i + 1].displayDeg += push;
        shifted = true;
      }
    }
    if (!shifted) break;
  }

  // Clamp to bounds and re-resolve any collisions introduced by clamping
  // (wx "Arrange borders" left/right passes, stripwnd.py:483-579).
  const lo = 0;
  const hi = 30;
  // Left clamp + forward propagation.
  for (let i = 0; i < placed.length; i += 1) {
    if (placed[i].displayDeg < lo) placed[i].displayDeg = lo;
    if (i > 0) {
      const minSpacingDeg = requiredSpacingDeg(placed[i - 1], placed[i], style);
      if (placed[i].displayDeg - placed[i - 1].displayDeg < minSpacingDeg) {
        placed[i].displayDeg = placed[i - 1].displayDeg + minSpacingDeg;
      }
    }
  }
  // Right clamp + backward propagation.
  for (let i = placed.length - 1; i >= 0; i -= 1) {
    if (placed[i].displayDeg > hi) placed[i].displayDeg = hi;
    if (i < placed.length - 1) {
      const minSpacingDeg = requiredSpacingDeg(placed[i], placed[i + 1], style);
      if (placed[i + 1].displayDeg - placed[i].displayDeg < minSpacingDeg) {
        placed[i].displayDeg = placed[i + 1].displayDeg - minSpacingDeg;
      }
    }
  }

  return placed;
}

function approximateBodyWidth(body: StripBody, style: StripRenderStyle): number {
  const typography = style.typography;
  if (body.glyphFont === "text") {
    return Math.max(
      typography.fontSize,
      body.glyph.length * typography.fontSize * typography.textGlyphWidthScale,
    );
  }
  return typography.fontSize;
}

function requiredSpacingDeg(
  left: PlacedBody,
  right: PlacedBody,
  style: StripRenderStyle,
): number {
  return (
    left.halfWidthPx + right.halfWidthPx + style.layout.collisionGap
  ) / style.layout.degreePx;
}
