// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

// Keep the inherited mtexts langid positions. Only release languages map to a
// frontend catalog; a saved legacy id resolves to English.
export const RELEASE_LOCALE_CODES = ["en", "fr", "es", "it", "de"] as const;
export type LocaleCode = (typeof RELEASE_LOCALE_CODES)[number];

export const LANGID_TO_CODE: readonly (LocaleCode | null)[] = [
  "en", // 0 English
  null, // 1 Magyar
  "it", // 2 Italiano
  "fr", // 3 Français
  null, // 4 Русский
  "es", // 5 Español
  null, // 6 简体中文
  null, // 7 繁体中文
  null, // 8 한국어
  "de", // 9 Deutsch
];

export const DEFAULT_LOCALE: LocaleCode = "en";

export function codeForLangId(langid: number | null | undefined): LocaleCode {
  if (typeof langid !== "number" || langid < 0 || langid >= LANGID_TO_CODE.length) {
    return DEFAULT_LOCALE;
  }
  return LANGID_TO_CODE[langid] ?? DEFAULT_LOCALE;
}
