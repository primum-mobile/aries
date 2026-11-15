// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { InspectorFlagSpan } from "@/lib/daemon/client";
import { semanticChartColor } from "@/lib/theme/semantic-color";

/** Daemon-authored value runs shared by the inspector and chart hover cards. */
export function InspectorValueSpans({ spans }: { spans: InspectorFlagSpan[] }) {
  const groups: InspectorFlagSpan[][] = [];
  for (const span of spans) {
    const previous = groups[groups.length - 1];
    if (span.wrapGroup !== undefined && previous?.[0].wrapGroup === span.wrapGroup) {
      previous.push(span);
    } else {
      groups.push([span]);
    }
  }
  return groups.map((group, index) => (
    <span key={index} className={group[0].wrapGroup !== undefined ? "whitespace-nowrap" : undefined}>
      {group.map((span, spanIndex) => <ValueSpan key={spanIndex} span={span} />)}
    </span>
  ));
}

function ValueSpan({ span }: { span: InspectorFlagSpan }) {
  return (
    <span
      className={span.bold ? "font-semibold" : undefined}
      style={{
        color: semanticChartColor(
          span.colourRole,
          span.colour ? `rgb(${span.colour.join(", ")})` : undefined,
        ),
        fontFamily: span.glyph ? "var(--aries-font-symbols)" : undefined,
      }}
    >
      {span.text}
    </span>
  );
}
