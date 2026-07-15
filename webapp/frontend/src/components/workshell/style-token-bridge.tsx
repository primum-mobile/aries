// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useEffect } from "react";

import {
  formatStyleTokenValue,
  STYLE_TOKENS,
} from "@/styles/style-tokens";
import { useStyleStore } from "@/stores/style-store";
import { useThemeStore } from "@/stores/theme-store";

export function StyleTokenBridge() {
  const values = useStyleStore((state) => state.values);
  const theme = useThemeStore((state) => state.theme);

  useEffect(() => {
    const root = document.documentElement;
    for (const token of STYLE_TOKENS) {
      if (Object.prototype.hasOwnProperty.call(values, token.id)) {
        root.style.setProperty(
          token.cssVar,
          formatStyleTokenValue(token, values[token.id]!),
        );
        continue;
      }

      // This bridge is a transient design-preview adapter. It is deliberately
      // not mounted by the app shell and never persists its own style truth.
      const themeValue =
        theme?.appTokens[token.cssVar] ?? theme?.chartPalette[token.cssVar];
      if (themeValue) {
        root.style.setProperty(token.cssVar, themeValue);
      } else {
        root.style.removeProperty(token.cssVar);
      }
    }
  }, [theme, values]);

  return null;
}
