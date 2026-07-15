// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

export const DEFAULT_MORINUS_TEXT_FONT =
  "'FreeSans', ui-sans-serif, system-ui, sans-serif";

export function morinusTextFontFromTokens(
  appTokens?: Record<string, string> | null,
): string {
  const font = (
    appTokens?.["--aries-font-ui"] ?? appTokens?.["--morinus-font-text"]
  )?.trim();
  return font && font.length > 0 ? font : DEFAULT_MORINUS_TEXT_FONT;
}
