// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import * as React from "react";

/** Render a translated template whose `{slot}`s are React nodes, so each
 * locale keeps its own word order around styled pieces (glyphs, coloured
 * names) instead of the code gluing translated fragments together. */
export function renderTemplate(
  template: string,
  slots: Record<string, React.ReactNode>,
): React.ReactNode {
  return template.split(/(\{\w+\})/g).map((part, index) => {
    const slot = /^\{(\w+)\}$/.exec(part)?.[1];
    if (slot !== undefined && slot in slots) {
      return <React.Fragment key={index}>{slots[slot]}</React.Fragment>;
    }
    return part ? <React.Fragment key={index}>{part}</React.Fragment> : null;
  });
}
