"use client";

import * as React from "react";

import type {
  GenericTablePayload,
  StripBody,
} from "@/lib/daemon/client";
import { useT } from "@/lib/i18n/i18n";

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

const FONT_SIZE = 21; // wx StripWnd default: int(21 * options.tablesize)
const BORDER = 20; // commonwnd.CommonWnd.BORDER
const BSPACE = FONT_SIZE / 5;
const Y_PLANETS_OFFS = FONT_SIZE / 2 - FONT_SIZE / 10;
const LINE_LENGTH = FONT_SIZE / 2 + FONT_SIZE / 5;
const LONG_TICK = (2 * FONT_SIZE) / 3;
const TICK_FIVE = FONT_SIZE / 2 + FONT_SIZE / 5;
const TICK_ONE = FONT_SIZE / 2 - FONT_SIZE / 10;
const TICK_STEP = (4 * FONT_SIZE) / 3;
const DEG_OFFS = FONT_SIZE / 5;
const AXIS_WIDTH = 30 * TICK_STEP;
const DEG_PX = AXIS_WIDTH / 30;
const AXIS_Y = BORDER + FONT_SIZE + Y_PLANETS_OFFS + LINE_LENGTH;
const GLYPH_TOP = BORDER;
const GLYPH_CONNECT_Y = GLYPH_TOP + FONT_SIZE + Y_PLANETS_OFFS;
const LABEL_Y = AXIS_Y + LONG_TICK + DEG_OFFS;
const STRIP_WIDTH = BORDER + AXIS_WIDTH + BORDER;
const STRIP_HEIGHT = Math.ceil(BORDER + LONG_TICK + DEG_OFFS + FONT_SIZE + AXIS_Y);

type Props = {
  payload: GenericTablePayload;
};

export function StripView({ payload }: Props) {
  const t = useT();
  const strip = payload.strip;
  if (!strip || !strip.signs.length) {
    return (
      <div className="font-morinus-text flex h-full min-h-0 items-center justify-center bg-background p-6 text-[length:var(--aries-font-size-base)] text-[color:var(--aries-text-muted)]">
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
  const placed = arrangeBodies(bodies);

  return (
    <div className="min-h-0 flex-1 overflow-auto bg-background p-4">
      <svg
        width={STRIP_WIDTH}
        height={STRIP_HEIGHT}
        viewBox={`0 0 ${STRIP_WIDTH} ${STRIP_HEIGHT}`}
        className="block max-w-none shrink-0"
        role="img"
        aria-label={t("strip.ariaLabel")}
      >
        {/* axis line (stripwnd.py:127) */}
        <line
          x1={BORDER}
          y1={AXIS_Y}
          x2={BORDER + AXIS_WIDTH}
          y2={AXIS_Y}
          stroke="var(--aries-border-subtle)"
          strokeWidth={1}
        />
        {/* end caps = long ticks (stripwnd.py:129-131) */}
        <line
          x1={BORDER}
          y1={AXIS_Y - LONG_TICK}
          x2={BORDER}
          y2={AXIS_Y + LONG_TICK}
          stroke="var(--aries-border-subtle)"
          strokeWidth={1}
        />
        <line
          x1={BORDER + AXIS_WIDTH}
          y1={AXIS_Y - LONG_TICK}
          x2={BORDER + AXIS_WIDTH}
          y2={AXIS_Y + LONG_TICK}
          stroke="var(--aries-border-subtle)"
          strokeWidth={1}
        />
        {/* degree ticks: long every 5°, short otherwise (stripwnd.py:135-142) */}
        {Array.from({ length: 30 }, (_, i) => i).map((i) => {
          if (i === 0) return null;
          const x = BORDER + i * DEG_PX;
          const len = i % 5 === 0 ? TICK_FIVE : TICK_ONE;
          return (
            <line
              key={`tick:${i}`}
              x1={x}
              y1={AXIS_Y}
              x2={x}
              y2={AXIS_Y + len}
              stroke="var(--aries-border-subtle)"
              strokeWidth={1}
            />
          );
        })}
        {/* degree labels at 0,5,10,...,30 (stripwnd.py:144-153) */}
        {Array.from({ length: 7 }, (_, k) => k * 5).map((deg) => (
          <text
            key={`lbl:${deg}`}
            x={BORDER + deg * DEG_PX}
            y={LABEL_Y}
            textAnchor="middle"
            dominantBaseline="hanging"
            className="fill-[color:var(--aries-text-primary)]"
            style={{ fontSize: FONT_SIZE, fontFamily: "var(--aries-font-ui)" }}
          >
            {deg}
          </text>
        ))}
        {/* bodies: nudged glyph + connector to true axis x (stripwnd.py:217-218) */}
        {placed.map((b) => {
          const trueX = BORDER + b.body.degree * DEG_PX;
          const dispX = BORDER + b.displayDeg * DEG_PX;
          const color = b.body.colorHex ?? "var(--aries-text-primary)";
          return (
            <g key={b.key}>
              <line
                x1={trueX}
                y1={AXIS_Y}
                x2={dispX}
                y2={GLYPH_CONNECT_Y}
                stroke={color}
                strokeWidth={1}
              />
              <text
                x={dispX}
                y={GLYPH_TOP}
                textAnchor="middle"
                dominantBaseline="hanging"
                fill={color}
                style={{
                  fontFamily:
                    b.body.glyphFont === "morinus" ? "'AriesMorinus'" : "var(--aries-font-ui)",
                  fontSize: FONT_SIZE,
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
        <div className="mt-3 space-y-1 text-[length:var(--aries-font-size-small)] text-[color:var(--aries-text-muted)]">
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
 * wx works in pixels; we work in degree units (1° = DEG_PX). The approximate
 * glyph widths keep AS/MC text from being treated like one-character symbols.
 */
function arrangeBodies(bodies: StripBodyWithSign[]): PlacedBody[] {
  const placed: PlacedBody[] = bodies
    .map((body) => ({
      key: `${body.signId}:${body.label}:${body.sourceIndex}`,
      body,
      displayDeg: body.degree,
      halfWidthPx: approximateBodyWidth(body) / 2,
    }))
    .sort((a, b) => a.displayDeg - b.displayDeg);

  // Forward sweep: push each colliding body rightward off its left neighbour
  // (doShift nudges the higher index forward, stripwnd.py:631-642).
  for (let pass = 0; pass < placed.length; pass += 1) {
    let shifted = false;
    for (let i = 0; i < placed.length - 1; i += 1) {
      const gap = placed[i + 1].displayDeg - placed[i].displayDeg;
      const minSpacingDeg = requiredSpacingDeg(placed[i], placed[i + 1]);
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
      const minSpacingDeg = requiredSpacingDeg(placed[i - 1], placed[i]);
      if (placed[i].displayDeg - placed[i - 1].displayDeg < minSpacingDeg) {
        placed[i].displayDeg = placed[i - 1].displayDeg + minSpacingDeg;
      }
    }
  }
  // Right clamp + backward propagation.
  for (let i = placed.length - 1; i >= 0; i -= 1) {
    if (placed[i].displayDeg > hi) placed[i].displayDeg = hi;
    if (i < placed.length - 1) {
      const minSpacingDeg = requiredSpacingDeg(placed[i], placed[i + 1]);
      if (placed[i + 1].displayDeg - placed[i].displayDeg < minSpacingDeg) {
        placed[i].displayDeg = placed[i + 1].displayDeg - minSpacingDeg;
      }
    }
  }

  return placed;
}

function approximateBodyWidth(body: StripBody): number {
  if (body.glyphFont === "text") {
    return Math.max(FONT_SIZE, body.glyph.length * FONT_SIZE * 0.62);
  }
  return FONT_SIZE;
}

function requiredSpacingDeg(left: PlacedBody, right: PlacedBody): number {
  return (left.halfWidthPx + right.halfWidthPx + BSPACE) / DEG_PX;
}
