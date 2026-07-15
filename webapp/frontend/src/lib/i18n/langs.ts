// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

// Locale codes indexed by the daemon's langid (mtexts.langs order — English,
// Magyar, Italiano, Français, Русский, Español, Simplified/Traditional Chinese,
// Korean). The daemon is the source of truth for the active language; the
// frontend mirrors it by langid, never by browser locale.
export const LANGID_TO_CODE = [
  "en", // 0 English
  "hu", // 1 Magyar
  "it", // 2 Italiano
  "fr", // 3 Français
  "ru", // 4 Русский
  "es", // 5 Español
  "zh-Hans", // 6 简体中文
  "zh-Hant", // 7 繁体中文
  "ko", // 8 한국어
  "de", // 9 Deutsch
] as const;

export type LocaleCode = (typeof LANGID_TO_CODE)[number];

export const DEFAULT_LOCALE: LocaleCode = "en";

export function codeForLangId(langid: number | null | undefined): LocaleCode {
  if (typeof langid !== "number" || langid < 0 || langid >= LANGID_TO_CODE.length) {
    return DEFAULT_LOCALE;
  }
  return LANGID_TO_CODE[langid];
}
