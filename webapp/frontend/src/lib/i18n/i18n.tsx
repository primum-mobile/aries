// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import React, {
  createContext,
  lazy,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { fetchOptions, waitForDaemonHealth } from "@/lib/daemon/client";
import { isAbortError } from "@/lib/abort-error";
import { resolveShellHost } from "@/lib/shell-host";
import {
  createWindowLangIdTracker,
  publishWindowLangId,
  subscribeWindowLangId,
} from "@/lib/shell/locale-window-sync";
import { safeShellUnlisten, type ShellUnlisten } from "@/lib/shell/unlisten";
import { useDaemonWorkspaceStore } from "@/stores/daemon-workspace-store";

import {
  COPY_EDITOR_ENABLED,
  copyOverride,
  recordRendered,
  useCopyOverrideRevision,
} from "./copy-editor/copy-store";
import { codeForLangId, DEFAULT_LOCALE, RELEASE_LOCALE_CODES, type LocaleCode } from "./langs";
import { BUNDLES } from "./messages";

// Dev-only in-app copy editor (⌘⇧L); production builds compile both away.
const CopyEditor = COPY_EDITOR_ENABLED ? lazy(() => import("./copy-editor/copy-editor")) : null;
const useCopyRevision = COPY_EDITOR_ENABLED ? useCopyOverrideRevision : () => 0;

export type TParams = Record<string, string | number>;
export type TFunc = (key: string, params?: TParams) => string;

type I18nValue = {
  lang: LocaleCode;
  t: TFunc;
  syncLangId: (langid: number | null | undefined) => void;
};

const I18nContext = createContext<I18nValue>({
  lang: DEFAULT_LOCALE,
  t: (key) => key,
  syncLangId: () => undefined,
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
 * truth for the active language. Every authoritative report of it — an options
 * event, a settings patch response, the startup read, or the socket owner's
 * cross-window relay — replaces the active language, so a language switch
 * re-renders every useT() consumer in every window, including retained and
 * prewarmed companions. Lookup order: active-language bundle → English → raw key. */
export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLang] = useState<LocaleCode>(DEFAULT_LOCALE);
  // Dev-session-static: read the ?pseudo=1 flag once on mount (lazy init, not an
  // effect, so it never triggers a cascading re-render).
  const [pseudo] = useState(pseudoActive);
  const optionsChange = useDaemonWorkspaceStore((state) => state.lastOptionsChange);
  const daemonConnection = useDaemonWorkspaceStore((state) => state.connection);
  // A pushed language always wins over a slower startup read.
  const [tracker] = useState(() =>
    createWindowLangIdTracker((langid) => setLang(codeForLangId(langid))),
  );
  const syncLangId = tracker.push;

  // Adopt a changed options-event language while rendering that event, so the
  // switch lands in the same commit with no stale-language frame. Keyed by the
  // langid value: routine display events carry the same id and cost nothing.
  const optionsLangId = typeof optionsChange?.langid === "number" ? optionsChange.langid : null;
  const [adoptedOptionsLangId, setAdoptedOptionsLangId] = useState<number | null>(null);
  if (optionsLangId !== null && optionsLangId !== adoptedOptionsLangId) {
    setAdoptedOptionsLangId(optionsLangId);
    setLang(codeForLangId(optionsLangId));
  }

  useEffect(() => {
    // Only the window that owns the daemon event socket relays the language;
    // companions have no socket and would otherwise keep their mount language.
    if (optionsLangId === null || daemonConnection !== "open") return;
    if (resolveShellHost().kind !== "tauri") return;
    void publishWindowLangId(optionsLangId).catch((error) => {
      console.warn("[locale-window-sync]", error);
    });
  }, [daemonConnection, optionsLangId]);

  useEffect(() => {
    // The options event already carries langid. Read the full options payload
    // only for startup/reconnect recovery, never once more for every event.
    // Companion windows subscribe to the relay before that read, so a switch
    // made while the window is mounting or hidden cannot be missed.
    if (daemonConnection === "closed") return;

    const controller = new AbortController();
    let stopRelay: ShellUnlisten | null = null;
    const subscribed =
      resolveShellHost().kind === "tauri"
        ? subscribeWindowLangId(syncLangId)
            .then((stop) => {
              if (controller.signal.aborted) safeShellUnlisten(stop);
              else stopRelay = stop;
            })
            .catch((error) => console.warn("[locale-window-sync]", error))
        : Promise.resolve();
    void subscribed
      .then(() => {
        const read = tracker.beginRead();
        const startOptionsSeq = useDaemonWorkspaceStore.getState().lastOptionsChange?.seq ?? 0;
        return waitForDaemonHealth(controller.signal)
          .then(() => fetchOptions(controller.signal))
          .then((opts) => {
            // An options event that landed meanwhile is newer than this read.
            if ((useDaemonWorkspaceStore.getState().lastOptionsChange?.seq ?? 0) !== startOptionsSeq) return;
            read.settle(opts?.languages?.langid);
          });
      })
      .catch((err) => {
        if (!isAbortError(err, controller.signal)) {
          // Keep the last known language. A socket reopen or later options
          // event retries the canonical read without requiring a workspace reset.
        }
      });
    return () => {
      controller.abort();
      safeShellUnlisten(stopRelay);
    };
  }, [daemonConnection, syncLangId, tracker]);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const copyRevision = useCopyRevision();
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
      if (!COPY_EDITOR_ENABLED) return interpolate(active?.[key] ?? fallback?.[key] ?? key, params);
      // Dev: a copy edit saved this session shows wherever English shows, and
      // every rendered string is indexed so a click can find its key.
      const translated = lang === DEFAULT_LOCALE ? undefined : active?.[key];
      const message = translated ?? copyOverride(key) ?? fallback?.[key] ?? key;
      const text = interpolate(message, params);
      recordRendered(text, key);
      return text;
    },
    // copyRevision re-creates t (and so re-renders consumers) after a saved edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lang, pseudo, copyRevision],
  );

  const value = useMemo<I18nValue>(() => ({ lang, t, syncLangId }), [lang, syncLangId, t]);
  return (
    <I18nContext.Provider value={value}>
      {children}
      {CopyEditor ? (
        <Suspense fallback={null}>
          <CopyEditor />
        </Suspense>
      ) : null}
    </I18nContext.Provider>
  );
}

/** Translate a key: `t("inspector.date")`, `t("x.count", { n: 3 })`. */
export function useT(): TFunc {
  return useContext(I18nContext).t;
}

/** The first OS/browser language Aries ships, else English. */
export function systemLocale(languages: readonly string[]): LocaleCode {
  for (const tag of languages) {
    const lower = tag.toLowerCase();
    const match = RELEASE_LOCALE_CODES.find(
      (code) => lower === code.toLowerCase() || lower.startsWith(`${code.toLowerCase()}-`),
    );
    if (match) return match;
  }
  return DEFAULT_LOCALE;
}

/** `t` for surfaces shown before the daemon could report the saved language
 * (an engine that failed to start): the active language once known,
 * otherwise the system language. */
export function useStartupT(): TFunc {
  const { lang, t } = useContext(I18nContext);
  return useMemo<TFunc>(() => {
    if (lang !== DEFAULT_LOCALE || typeof navigator === "undefined") return t;
    const locale = systemLocale(navigator.languages ?? [navigator.language]);
    if (locale === DEFAULT_LOCALE) return t;
    return (key, params) => {
      const message = BUNDLES[locale]?.[key];
      return message === undefined ? t(key, params) : interpolate(message, params);
    };
  }, [lang, t]);
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

/** Apply a langid from an authoritative options response immediately. */
export function useSyncLocale(): (langid: number | null | undefined) => void {
  return useContext(I18nContext).syncLangId;
}
