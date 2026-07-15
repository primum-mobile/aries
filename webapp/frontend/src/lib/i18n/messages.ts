// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { LocaleCode } from "./langs";

import en from "@/locales/en.json";
import hu from "@/locales/hu.json";
import it from "@/locales/it.json";
import fr from "@/locales/fr.json";
import ru from "@/locales/ru.json";
import es from "@/locales/es.json";
import zhHans from "@/locales/zh-Hans.json";
import zhHant from "@/locales/zh-Hant.json";
import ko from "@/locales/ko.json";
import de from "@/locales/de.json";

export type MessageBundle = Record<string, string>;

// Registry of locale bundles. `en` is the authoritative key set and the runtime
// fallback; other languages hold only the keys translated so far and fall back
// to `en` per-key. Corpus-sourced keys are (re)generated from mtexts by
// scripts/i18n/export_locales.py; React-only strings are authored in the JSON.
export const BUNDLES: Partial<Record<LocaleCode, MessageBundle>> = {
  en: en as MessageBundle,
  hu: hu as MessageBundle,
  it: it as MessageBundle,
  fr: fr as MessageBundle,
  ru: ru as MessageBundle,
  es: es as MessageBundle,
  "zh-Hans": zhHans as MessageBundle,
  "zh-Hant": zhHant as MessageBundle,
  ko: ko as MessageBundle,
  de: de as MessageBundle,
};
