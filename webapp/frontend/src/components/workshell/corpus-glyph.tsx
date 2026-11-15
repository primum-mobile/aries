// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import * as React from "react";
import type { InspectorSignGlyphColors } from "@/lib/daemon/client";
import { semanticChartColor } from "@/lib/theme/semantic-color";

export const CorpusSignColorModeContext = React.createContext(false);

/** Sign identity and palette roles come from the daemon; mode follows the chart. */
export function CorpusGlyph({
  text,
  colors,
  className,
}: {
  text: string;
  colors?: InspectorSignGlyphColors | null;
  className?: string;
}) {
  const useElementColors = React.useContext(CorpusSignColorModeContext);
  const paint = colors?.[useElementColors ? "element" : "plain"];
  return (
    <span
      className={className}
      style={{
        fontFamily: "'AriesMorinus'",
        color: semanticChartColor(
          paint?.colourRole,
          paint?.colour ? `rgb(${paint.colour.join(", ")})` : undefined,
        ),
      }}
      aria-hidden
    >
      {text}
    </span>
  );
}
