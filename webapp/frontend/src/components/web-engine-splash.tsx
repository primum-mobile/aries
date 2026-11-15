// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import React from "react";

import { loadLastChartPreview } from "@/lib/chart/last-chart-preview";
import { BUNDLES } from "@/lib/i18n/messages";
import { DEFAULT_LOCALE, RELEASE_LOCALE_CODES, type LocaleCode } from "@/lib/i18n/langs";
import { useDaemonWorkspaceStore } from "@/stores/daemon-workspace-store";

// Browser (WASM) build only: covers the app while the in-browser engine
// downloads, caches and starts. Rendered into the static HTML so no app
// control is exposed before the first paint; boot.js (webapp/wasm) reports
// the engine stage through window.__ARIES_ENGINE_STAGE__ and a window event.
// When the device keeps a picture of the last chart, the splash shows it in
// place of the mark until the live chart replaces it.

type EngineStage = "starting" | "runtime" | "packages" | "engine" | "daemon" | "ready" | "error";

declare global {
  interface Window {
    __ARIES_ENGINE_STAGE__?: EngineStage;
  }
}

const STAGE_EVENT = "aries-engine-stage";
const STAGE_PROGRESS: Record<EngineStage, number> = {
  starting: 0.05,
  runtime: 0.15,
  packages: 0.45,
  engine: 0.7,
  daemon: 0.85,
  ready: 1,
  error: 1,
};
const FADE_MS = 450;

function subscribeStage(onChange: () => void): () => void {
  window.addEventListener(STAGE_EVENT, onChange);
  return () => window.removeEventListener(STAGE_EVENT, onChange);
}

function readStage(): EngineStage {
  if (document.documentElement.hasAttribute("data-aries-wasm-error")) return "error";
  return window.__ARIES_ENGINE_STAGE__ ?? "starting";
}

const serverStage = (): EngineStage => "starting";

// The daemon's language is unknown until the engine runs, so the splash
// speaks the browser's language when Aries ships it.
function browserLocale(): LocaleCode {
  const wanted = typeof navigator === "undefined" ? [] : navigator.languages ?? [navigator.language];
  for (const tag of wanted) {
    const code = String(tag || "").toLowerCase().split("-")[0];
    const match = RELEASE_LOCALE_CODES.find((candidate) => candidate === code);
    if (match) return match;
  }
  return DEFAULT_LOCALE;
}

const subscribeLocale = () => () => undefined;
const serverLocale = (): LocaleCode => DEFAULT_LOCALE;

function useSplashText(): (key: string) => string {
  const locale = React.useSyncExternalStore(subscribeLocale, browserLocale, serverLocale);
  return React.useCallback(
    (key: string) => BUNDLES[locale]?.[key] ?? BUNDLES[DEFAULT_LOCALE]?.[key] ?? key,
    [locale],
  );
}

function useLastChartPreview(): string | null {
  const [url, setUrl] = React.useState<string | null>(null);
  React.useEffect(() => {
    let created: string | null = null;
    let cancelled = false;
    void loadLastChartPreview().then((next) => {
      if (cancelled) {
        if (next) URL.revokeObjectURL(next);
        return;
      }
      created = next;
      setUrl(next);
    });
    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, []);
  return url;
}

export function WebEngineSplash() {
  const stage = React.useSyncExternalStore(subscribeStage, readStage, serverStage);
  const connected = useDaemonWorkspaceStore((state) => state.connection === "open");
  const text = useSplashText();
  const done = stage === "ready" && connected;
  const [removed, setRemoved] = React.useState(false);
  const preview = useLastChartPreview();

  React.useEffect(() => {
    if (!done) return;
    const timer = window.setTimeout(() => setRemoved(true), FADE_MS);
    return () => window.clearTimeout(timer);
  }, [done]);

  // App shortcuts listen on window; keep them from acting on a half-started
  // workspace. Browser defaults (reload, zoom) still work.
  React.useEffect(() => {
    if (done) return;
    const swallow = (event: KeyboardEvent) => event.stopImmediatePropagation();
    window.addEventListener("keydown", swallow, true);
    window.addEventListener("keyup", swallow, true);
    return () => {
      window.removeEventListener("keydown", swallow, true);
      window.removeEventListener("keyup", swallow, true);
    };
  }, [done]);

  if (removed) return null;
  const failed = stage === "error";
  return (
    <div
      className="aries-web-splash"
      data-state={done ? "leaving" : failed ? "error" : "loading"}
      role={failed ? "alert" : "status"}
      aria-busy={!done && !failed}
      aria-live="polite"
    >
      {preview && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element -- a local object URL, not an optimisable asset
        <img className="aries-web-splash__preview" src={preview} alt="" aria-hidden="true" draggable={false} />
      ) : (
        <div className="aries-web-splash__mark" aria-hidden="true" />
      )}
      <div className="aries-web-splash__label">
        {failed ? text("webEngine.failed") : text("webEngine.loading")}
      </div>
      {failed ? (
        <button type="button" className="aries-web-splash__retry" onClick={() => window.location.reload()}>
          {text("webEngine.reload")}
        </button>
      ) : (
        <div className="aries-web-splash__track" aria-hidden="true">
          <div
            className="aries-web-splash__bar"
            style={{ transform: `scaleX(${STAGE_PROGRESS[stage]})` }}
          />
        </div>
      )}
    </div>
  );
}
