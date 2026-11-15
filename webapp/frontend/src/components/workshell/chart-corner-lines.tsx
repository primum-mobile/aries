// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

// Chart-corner text blocks shared by every chart surface (wheel, astrolabe):
// one typography contract, the wheel's semantic overlay classes.

import * as React from "react";
import {
  resolveWheelTypographyPaint,
  type WheelChartOverlayClass,
  type WheelRenderStyle,
} from "@/lib/chart/wheel-render-style";

export function overlayTypographyCss(
  wheelStyle: WheelRenderStyle,
  classId: WheelChartOverlayClass,
  defaults: Readonly<{
    font: string;
    size: number;
    color: string;
  }>,
): React.CSSProperties {
  const paint = resolveWheelTypographyPaint(
    wheelStyle,
    wheelStyle.authoringTargetProfile,
    classId,
    wheelStyle.authoringTargetRadius,
    defaults,
  );
  return {
    color: paint.color,
    fontFamily: paint.font,
    fontSize: paint.size,
    fontWeight: paint.weight,
    fontStyle: paint.style,
    letterSpacing: paint.tracking,
    opacity: paint.opacity,
  };
}

export function CornerLines({
  semanticClassId,
  wheelStyle,
  lines,
  color,
  fontSize,
  gap,
  lineHeight,
  style,
  inFlow = false,
  corner,
}: {
  /** Phone: a block in the chart facts flow instead of a pinned corner. */
  inFlow?: boolean;
  /** Pinned corner; the chart dashboard layout reads its box. */
  corner?: "topLeft" | "bottomLeft" | "bottomRight";
  semanticClassId: WheelChartOverlayClass;
  wheelStyle: WheelRenderStyle;
  lines: string[];
  color: string;
  fontSize: number;
  gap: number;
  lineHeight: number;
  style: React.CSSProperties;
}) {
  if (!lines.length || fontSize <= 0) {
    return null;
  }

  return (
    <div
      data-aries-chart-corner={inFlow ? undefined : corner}
      className={inFlow
        ? "pointer-events-none select-none font-ui"
        // Corner text sits over the chart, outer-ring labels included (same
        // z as the outer-label canvas, later in the DOM).
        : "pointer-events-none absolute z-[41] select-none font-ui"}
      style={{
        ...style,
        ...overlayTypographyCss(wheelStyle, semanticClassId, {
          font: wheelStyle.typography.families.ui,
          size: fontSize,
          color,
        }),
        lineHeight,
      }}
    >
      <div className="flex flex-col" style={{ gap }}>
        {lines.map((line, index) => (
          <div
            key={`${index}-${line}`}
            data-aries-style-class={semanticClassId}
          >
            {line}
          </div>
        ))}
      </div>
    </div>
  );
}
