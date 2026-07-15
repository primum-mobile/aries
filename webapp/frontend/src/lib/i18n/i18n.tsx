// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { fetchOptions } from "@/lib/daemon/client";
import { isAbortError } from "@/lib/abort-error";
import { useDaemonWorkspaceStore } from "@/stores/daemon-workspace-store";

import { codeForLangId, DEFAULT_LOCALE, type LocaleCode } from "./langs";
import { BUNDLES } from "./messages";

export type TParams = Record<string, string | number>;
export type TFunc = (key: string, params?: TParams) => string;

type I18nValue = { lang: LocaleCode; t: TFunc };

const I18nContext = createContext<I18nValue>({
  lang: DEFAULT_LOCALE,
  t: (key) => key,
});

function interpolate(message: string, params?: TParams): string {
  if (!params) return message;
  return message.replace(/\{(\w+)\}/g, (_, name: string) =>
    name in params ? String(params[name]) : `{${name}}`,
  );
}

// Dev-only pseudo-locale: accents every Latin letter and brackets the string, so
// untranslated (un-t()-wrapped) UI shows up as plain ASCII and layout overflow is
// visible. {param} slots are preserved. Mirrors scripts/i18n/i18n_tool.py pseudo.
const PSEUDO_ACCENT: Record<string, string> = {
  a: "á", e: "é", i: "í", o: "ó", u: "ú", c: "ç", n: "ñ", y: "ý", s: "š", g: "ǧ", z: "ž",
  A: "Á", E: "É", I: "Í", O: "Ó", U: "Ú", C: "Ç", N: "Ñ", Y: "Ý", S: "Š", G: "Ǧ", Z: "Ž",
};

function pseudoize(message: string): string {
  const parts = message.split(/(\{\w+\})/g); // keep {param} delimiters intact
  const mapped = parts.map((p) =>
    /^\{\w+\}$/.test(p) ? p : p.replace(/[a-zA-Z]/g, (ch) => PSEUDO_ACCENT[ch] ?? ch),
  );
  return `⟦${mapped.join("")}⟧`;
}

function pseudoActive(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (new URLSearchParams(window.location.search).get("pseudo") === "1") return true;
    return window.localStorage?.getItem("ariesPseudoLocale") === "1";
  } catch {
    return false;
  }
}

/** App-wide i18n provider. The daemon (options.langid) is the single source of
 * truth for the active language; this mirrors it by re-reading langid whenever
 * the options-change signal bumps, so a language switch re-renders every
 * useT() consumer. Lookup order: active-language bundle → English → raw key. */
export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLang] = useState<LocaleCode>(DEFAULT_LOCALE);
  // Dev-session-static: read the ?pseudo=1 flag once on mount (lazy init, not an
  // effect, so it never triggers a cascading re-render).
  const [pseudo] = useState(pseudoActive);
  const optionsSeq = useDaemonWorkspaceStore(
    (state) => state.lastOptionsChange?.seq ?? 0,
  );

  useEffect(() => {
    const controller = new AbortController();
    fetchOptions(controller.signal)
      .then((opts) => setLang(codeForLangId(opts?.languages?.langid)))
      .catch((err) => {
        if (!isAbortError(err, controller.signal)) {
          // A missing/failed options read just leaves the last known language.
        }
      });
    return () => controller.abort();
  }, [optionsSeq]);

  const t = useCallback<TFunc>(
    (key, params) => {
      const active = BUNDLES[lang];
      const fallback = BUNDLES[DEFAULT_LOCALE];
      // Pseudo mode mangles the English source so any un-t()-wrapped string stays
      // plain ASCII; a missing key (raw key returned) is left alone.
      if (pseudo) {
        const source = fallback?.[key];
        return interpolate(source === undefined ? key : pseudoize(source), params);
      }
      const message = active?.[key] ?? fallback?.[key] ?? key;
      return interpolate(message, params);
    },
    [lang, pseudo],
  );

  const value = useMemo<I18nValue>(() => ({ lang, t }), [lang, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/** Translate a key: `t("inspector.date")`, `t("x.count", { n: 3 })`. */
export function useT(): TFunc {
  return useContext(I18nContext).t;
}

/** Translate a key but fall back to a runtime-provided default when the key is
 * absent (i.e. `t(key)` returned the key unchanged). For daemon-served labels
 * that we localize by stable id on the frontend, keyed independently of the
 * daemon's own (possibly English) label text. */
export function useTFallback(): (key: string, fallback: string) => string {
  const t = useT();
  return useCallback(
    (key, fallback) => {
      const value = t(key);
      return value === key ? fallback : value;
    },
    [t],
  );
}

/** The active locale code (e.g. "fr"), for locale-aware formatting. */
export function useLocale(): LocaleCode {
  return useContext(I18nContext).lang;
}
