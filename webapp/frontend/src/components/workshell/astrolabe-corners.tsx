// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

// Astrolabe chart corners, typeset exactly like the wheel's corner overlays:
// top-left the real (signified) moment of the rete arc, bottom-left the
// symbolic moment (the sky turned by the arc), bottom-right the house-system
// block, top-right the nearby primary directions. The daemon formats every
// string; this module lays them out with the wheel's overlay metrics, on
// screen as DOM and in exports on the canvas.

import * as React from "react";
import { CornerLines, overlayTypographyCss } from "@/components/workshell/chart-corner-lines";
import type { CanvasDraw } from "@/lib/chart/canvas-draw";
import { morinusTextFontFromTokens } from "@/lib/chart/chart-fonts";
import { ASPECT_GLYPHS, ASP_CONJUNCTION } from "@/lib/chart/glyphs";
import { readPaletteFromTheme, readPaletteProfileOverrides } from "@/lib/chart/palette";
import type { ChartPalette } from "@/lib/chart/types";
import {
  projectWheelAuthoringStyle,
  resolveWheelOverlayMetrics,
  resolveWheelRenderStyleFromTokens,
  resolveWheelTypographyPaint,
  wheelTypographyProfileForTheme,
  type ResolvedWheelOverlayMetrics,
  type ResolvedWheelTypographyPaint,
  type WheelChartOverlayClass,
  type WheelRenderStyle,
} from "@/lib/chart/wheel-render-style";
import type { AstrolabeInformation, AstrolabePdEvent, ThemeState } from "@/lib/daemon/client";
import { useStyleRevision } from "@/hooks/use-style-revision";
import { useThemeStore } from "@/stores/theme-store";

export type AstrolabeCornerStyle = {
  wheelStyle: WheelRenderStyle;
  metrics: ResolvedWheelOverlayMetrics;
  palette: ChartPalette;
};

/** The wheel's corner typography for an astrolabe surface of `viewport` size. */
export function resolveAstrolabeCornerStyle(
  theme: ThemeState | null,
  styleRevision: string | number,
  wheelTheme: number,
  viewport: Readonly<{ width: number; height: number }>,
): AstrolabeCornerStyle {
  const palette = { ...readPaletteFromTheme(theme), ...readPaletteProfileOverrides(theme) };
  const base = resolveWheelRenderStyleFromTokens(
    (cssVar) => theme?.chartPalette?.[cssVar],
    {
      palette,
      revision: styleRevision,
      fontSymbols: '"AriesMorinus"',
      fontUi: morinusTextFontFromTokens(theme?.appTokens),
    },
  );
  const metrics = resolveWheelOverlayMetrics(base.overlays, viewport);
  const wheelStyle = projectWheelAuthoringStyle(
    base,
    metrics.chartSize / 2,
    wheelTypographyProfileForTheme(wheelTheme),
  );
  return { wheelStyle, metrics, palette };
}

function pdAspectGlyph(aspId: number): string | null {
  if (aspId === ASP_CONJUNCTION) return null;
  return ASPECT_GLYPHS[aspId] ?? null;
}

type PdRowCells = {
  key: string;
  prom: { glyph: string | null; text: string };
  aspect: string | null;
  sig: { glyph: string | null; text: string };
  codes: string;
  offset: string;
};

function pdRowCells(events: readonly AstrolabePdEvent[]): PdRowCells[] {
  return events.map((event, index) => ({
    key: `${event.prom}:${event.promasp}:${event.sig}:${event.sigasp}:${event.mundane}:${event.direct}:${index}`,
    prom: { glyph: event.promGlyph ?? null, text: event.promText || "?" },
    aspect: pdAspectGlyph(event.promasp) ?? pdAspectGlyph(event.sigasp),
    sig: { glyph: event.sigGlyph ?? null, text: event.sigText || "?" },
    codes: `${event.direct ? "D" : "C"} ${event.mundane ? "M" : "Z"}`,
    offset: `${event.offsetYears >= 0 ? "+" : ""}${event.offsetYears.toFixed(1)}y`,
  }));
}

export function AstrolabeCorners({
  information,
  events,
  viewport,
}: {
  information: AstrolabeInformation;
  events: readonly AstrolabePdEvent[];
  viewport: Readonly<{ width: number; height: number }>;
}) {
  const theme = useThemeStore((s) => s.theme);
  const styleRevision = useStyleRevision();
  const resolved = React.useMemo(
    () => resolveAstrolabeCornerStyle(theme, styleRevision, information.wheelTheme, viewport),
    [information.wheelTheme, styleRevision, theme, viewport],
  );
  if (viewport.width <= 0 || viewport.height <= 0) return null;
  const { wheelStyle, metrics, palette } = resolved;
  const corner = {
    wheelStyle,
    color: palette.textDim,
    fontSize: metrics.infoFontSize,
    gap: wheelStyle.overlays.infoGap,
    lineHeight: wheelStyle.overlays.cornerLineHeight,
  };
  return (
    <>
      {information.showInformation ? (
        <>
          <CornerLines
            {...corner}
            semanticClassId="chartOverlay.information.topLeft"
            lines={information.topLeft}
            style={{ top: metrics.topEdgeInset, left: metrics.edgeInset, textAlign: "left" }}
          />
          <CornerLines
            {...corner}
            semanticClassId="chartOverlay.information.bottomLeft"
            lines={information.bottomLeft}
            style={{ bottom: metrics.edgeInset, left: metrics.edgeInset, textAlign: "left" }}
          />
        </>
      ) : null}
      {information.showHouseSystem ? (
        <CornerLines
          {...corner}
          semanticClassId="chartOverlay.houseSystem.bottomRight"
          lines={information.houseSystemLines}
          style={{ right: metrics.edgeInset, bottom: metrics.edgeInset, textAlign: "right" }}
        />
      ) : null}
      <PdEventCorner
        wheelStyle={wheelStyle}
        rows={pdRowCells(events)}
        color={palette.textDim}
        metrics={metrics}
        style={{ top: metrics.topEdgeInset, right: metrics.edgeInset }}
      />
    </>
  );
}

/** Nearby primary directions as wheel-style overlay rows in aligned columns:
 * promissor, aspect, significator, direction/mode codes, years from the arc. */
function PdEventCorner({
  wheelStyle,
  rows,
  color,
  metrics,
  style,
}: {
  wheelStyle: WheelRenderStyle;
  rows: readonly PdRowCells[];
  color: string;
  metrics: ResolvedWheelOverlayMetrics;
  style: React.CSSProperties;
}) {
  const { labelSize, iconSize, lineHeight, columnGap } = metrics;
  if (!rows.length || labelSize <= 0 || iconSize <= 0) return null;
  const rowBox: React.CSSProperties = {
    height: lineHeight,
    lineHeight: `${lineHeight}px`,
    display: "flex",
    alignItems: "center",
  };
  const glyphCss = overlayTypographyCss(wheelStyle, "chartOverlay.events.signal.glyph", {
    font: wheelStyle.typography.families.symbols,
    size: iconSize,
    color,
  });
  const labelCss = overlayTypographyCss(wheelStyle, "chartOverlay.events.signal.label", {
    font: wheelStyle.typography.families.ui,
    size: labelSize,
    color,
  });
  const trailingCss = overlayTypographyCss(wheelStyle, "chartOverlay.events.signal.trailing", {
    font: wheelStyle.typography.families.ui,
    size: labelSize,
    color,
  });
  const point = (cell: { glyph: string | null; text: string }, key: string) => (
    <div key={key} className="justify-self-center whitespace-nowrap" style={rowBox}>
      {cell.glyph ? (
        <span
          className="font-symbols leading-none"
          data-aries-style-class="chartOverlay.events.signal.glyph"
          style={{ ...glyphCss, lineHeight: wheelStyle.overlays.glyphLineHeight }}
        >
          {cell.glyph}
        </span>
      ) : (
        <span data-aries-style-class="chartOverlay.events.signal.label" style={labelCss}>{cell.text}</span>
      )}
    </div>
  );
  return (
    <div className="pointer-events-none absolute z-10 select-none font-ui" style={style}>
      <div
        className="grid items-center justify-end"
        style={{ gridTemplateColumns: "repeat(5, max-content)", columnGap }}
      >
        {rows.map((row) => (
          <React.Fragment key={row.key}>
            {point(row.prom, `${row.key}:prom`)}
            {point({ glyph: row.aspect, text: "" }, `${row.key}:asp`)}
            {point(row.sig, `${row.key}:sig`)}
            <div
              className="justify-self-start whitespace-nowrap"
              data-aries-style-class="chartOverlay.events.signal.label"
              style={{ ...rowBox, ...labelCss }}
            >
              {row.codes}
            </div>
            <div
              className="justify-self-end whitespace-nowrap tabular-nums"
              data-aries-style-class="chartOverlay.events.signal.trailing"
              style={{ ...rowBox, ...trailingCss }}
            >
              {row.offset}
            </div>
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

function paintOf(
  wheelStyle: WheelRenderStyle,
  classId: WheelChartOverlayClass,
  defaults: Readonly<{ font: string; size: number; color: string }>,
): ResolvedWheelTypographyPaint {
  return resolveWheelTypographyPaint(
    wheelStyle,
    wheelStyle.authoringTargetProfile,
    classId,
    wheelStyle.authoringTargetRadius,
    defaults,
  );
}

function textOptions(paint: ResolvedWheelTypographyPaint, align: CanvasTextAlign) {
  return {
    fill: paint.color,
    font: paint.font,
    size: paint.size,
    weight: paint.weight,
    style: paint.style,
    tracking: paint.tracking,
    opacity: paint.opacity,
    align,
  };
}

/** Paint the same corners onto an export canvas of `width` × `height`.
 * Returns where a PNG watermark goes: under the top-left block, as the wheel. */
export function paintAstrolabeCorners(
  draw: CanvasDraw,
  information: AstrolabeInformation,
  events: readonly AstrolabePdEvent[],
  cornerStyle: AstrolabeCornerStyle,
  width: number,
  height: number,
  includeOverlays: boolean,
): { watermarkY: number; watermarkWidth: number; watermarkPaint: ResolvedWheelTypographyPaint } {
  const { wheelStyle, metrics, palette } = cornerStyle;
  const overlays = wheelStyle.overlays;
  const info = (classId: WheelChartOverlayClass) => paintOf(wheelStyle, classId, {
    font: wheelStyle.typography.families.ui,
    size: metrics.infoFontSize,
    color: palette.textDim,
  });
  const blockHeight = (lines: readonly string[], paint: ResolvedWheelTypographyPaint) =>
    lines.length * paint.size * overlays.cornerLineHeight
    + Math.max(0, lines.length - 1) * overlays.infoGap;
  const lines = (
    block: readonly string[],
    paint: ResolvedWheelTypographyPaint,
    x: number,
    y: number,
    align: CanvasTextAlign,
  ) => {
    const row = paint.size * overlays.cornerLineHeight;
    block.forEach((line, index) => {
      draw.text([x, y + index * (row + overlays.infoGap)], line, textOptions(paint, align));
    });
  };

  const topPaint = info("chartOverlay.information.topLeft");
  let watermarkY = metrics.topEdgeInset;
  let watermarkWidth = width - 2 * metrics.edgeInset;
  if (!includeOverlays) return { watermarkY, watermarkWidth, watermarkPaint: topPaint };

  if (information.showInformation) {
    const top = information.topLeft;
    lines(top, topPaint, metrics.edgeInset, metrics.topEdgeInset, "left");
    if (top.length) {
      watermarkWidth = Math.max(topPaint.size, ...top.map((line) =>
        draw.textsize(line, textOptions(topPaint, "left"))[0]));
      watermarkY += blockHeight(top, topPaint) + topPaint.size * 0.3;
    }
    const bottomPaint = info("chartOverlay.information.bottomLeft");
    const bottom = information.bottomLeft;
    lines(bottom, bottomPaint, metrics.edgeInset, height - metrics.edgeInset - blockHeight(bottom, bottomPaint), "left");
  }
  if (information.showHouseSystem) {
    const paint = info("chartOverlay.houseSystem.bottomRight");
    const block = information.houseSystemLines;
    lines(block, paint, width - metrics.edgeInset, height - metrics.edgeInset - blockHeight(block, paint), "right");
  }

  const rows = pdRowCells(events);
  if (rows.length) {
    const glyphPaint = paintOf(wheelStyle, "chartOverlay.events.signal.glyph", {
      font: wheelStyle.typography.families.symbols,
      size: metrics.iconSize,
      color: palette.textDim,
    });
    const labelPaint = paintOf(wheelStyle, "chartOverlay.events.signal.label", {
      font: wheelStyle.typography.families.ui,
      size: metrics.labelSize,
      color: palette.textDim,
    });
    const trailingPaint = paintOf(wheelStyle, "chartOverlay.events.signal.trailing", {
      font: wheelStyle.typography.families.ui,
      size: metrics.labelSize,
      color: palette.textDim,
    });
    type Cell = { text: string; paint: ResolvedWheelTypographyPaint; align: "center" | "left" | "right" };
    const point = (cell: { glyph: string | null; text: string }): Cell => (
      cell.glyph ? { text: cell.glyph, paint: glyphPaint, align: "center" } : { text: cell.text, paint: labelPaint, align: "center" }
    );
    const grid: Cell[][] = rows.map((row) => [
      point(row.prom),
      { text: row.aspect ?? "", paint: glyphPaint, align: "center" },
      point(row.sig),
      { text: row.codes, paint: labelPaint, align: "left" },
      { text: row.offset, paint: trailingPaint, align: "right" },
    ]);
    const widths = [0, 1, 2, 3, 4].map((column) => Math.max(0, ...grid.map((row) =>
      row[column].text ? draw.textsize(row[column].text, textOptions(row[column].paint, "left"))[0] : 0)));
    const total = widths.reduce((sum, value) => sum + value, 0) + metrics.columnGap * 4;
    let rowTop = metrics.topEdgeInset;
    for (const row of grid) {
      let x = width - metrics.edgeInset - total;
      row.forEach((cell, column) => {
        if (cell.text) {
          const anchor = cell.align === "center" ? x + widths[column] / 2
            : cell.align === "right" ? x + widths[column] : x;
          draw.text([anchor, rowTop + metrics.lineHeight / 2], cell.text, {
            ...textOptions(cell.paint, cell.align),
            baseline: "middle",
          });
        }
        x += widths[column] + metrics.columnGap;
      });
      rowTop += metrics.lineHeight;
    }
  }
  return { watermarkY, watermarkWidth, watermarkPaint: topPaint };
}
