// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import * as React from "react";
import { ListPlus } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { Chart, ChartFortune, ChartPlanet, ChartRenderSnapshot, ChartSyzygy, ChartVertex, PlanetId } from "@/lib/chart/types";
import type { ThemeState } from "@/lib/daemon/client";
import {
  daemonBaseUrl,
  fetchNotes,
  saveNotes,
} from "@/lib/daemon/client";
import { cn } from "@/lib/utils";
import { useT, type TFunc } from "@/lib/i18n/i18n";
import { useFrameLayoutStore } from "@/stores/frame-layout-store";
import { useThemeStore } from "@/stores/theme-store";

type Props = {
  sourceName: string;
  chart?: ChartRenderSnapshot | null;
  documentId?: string;
  scratch?: boolean;
  className?: string;
};

const NOTES_EDITOR_ASSET_VERSION = "20260722-desktop-webview-guard";

/**
 * Per-radix notes — file-backed via the daemon. Saved charts write the
 * wx-style chart-name note file; ephemeral root charts write a daemon scratch
 * note keyed by document id until the chart-save lifecycle promotes it.
 *
 * Each radix has one saved note file. For a derived doc (transit/SR/etc.) the
 * notes pane shows the *parent
 * radix's* notes — keystrokes anywhere in the tree write to the same file.
 *
 * Re-mounted per sourceName via React `key` in the parent so internal
 * fetch state starts fresh on radix switch (no stale notes flash).
 */
export function NotesPanel({ sourceName, chart = null, documentId, scratch = false, className }: Props) {
  return (
    <NotesPanelInner
      key={`${sourceName}:${documentId ?? ""}:${scratch ? "scratch" : "saved"}`}
      sourceName={sourceName}
      chart={chart}
      documentId={documentId}
      scratch={scratch}
      className={className}
    />
  );
}

function NotesPanelInner({ sourceName, chart = null, documentId, scratch = false, className }: Props) {
  const t = useT();
  const theme = useThemeStore((s) => s.theme);
  const setNotesPaneOpen = useFrameLayoutStore((s) => s.setNotesPaneOpen);
  const [notesLoading, setNotesLoading] = React.useState(true);
  const [editorReady, setEditorReady] = React.useState(false);
  const [savedAt, setSavedAt] = React.useState<Date | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [dirty, setDirty] = React.useState(false);
  const iframeRef = React.useRef<HTMLIFrameElement | null>(null);
  const contentRef = React.useRef("");
  const dirtyRef = React.useRef(false);
  const focusedRef = React.useRef(false);
  const lastSyncedRef = React.useRef("");
  const editorReadyRef = React.useRef(false);
  const noteTarget = React.useMemo(
    () => ({ documentId, scratch }),
    [documentId, scratch],
  );
  const notesBaseUrl = React.useMemo(() => daemonBaseUrl(), []);
  const notesEditorUrl = React.useMemo(
    () => `${notesBaseUrl}/Res/notes/index.html?v=${NOTES_EDITOR_ASSET_VERSION}`,
    [notesBaseUrl],
  );
  const notesEditorOrigin = React.useMemo(
    () => {
      if (typeof window === "undefined") return notesBaseUrl;
      return new URL(notesEditorUrl, window.location.href).origin;
    },
    [notesBaseUrl, notesEditorUrl],
  );
  type RawEditorEvent = Record<string, unknown>;
  const notesTheme = React.useMemo(() => notesEditorTheme(theme), [theme]);

  const markClean = React.useCallback((text: string) => {
    lastSyncedRef.current = text;
    dirtyRef.current = false;
    setDirty(false);
  }, []);

  const sendEditorMessage = React.useCallback(
    (type: string, payload: RawEditorEvent | null = null) => {
      if (!editorReadyRef.current) return;
      const frame = iframeRef.current?.contentWindow;
      if (!frame) return;
      frame.postMessage(
        payload === null ? { type } : { type, payload },
        "*",
      );
    },
    [],
  );

  const syncDocumentToEditor = React.useCallback(() => {
    if (!editorReadyRef.current) return;
    sendEditorMessage("setDocument", {
      markdown: contentRef.current,
      readonly: false,
      label: sourceName,
    });
  }, [sendEditorMessage, sourceName]);

  const insertChartInfo = React.useCallback(() => {
    if (!chart || !editorReadyRef.current) return;
    sendEditorMessage("insertMarkdown", { markdown: chartInfoMarkdown(chart, t) });
    sendEditorMessage("focusEditor");
    setError(null);
  }, [chart, sendEditorMessage, t]);

  const loadNote = React.useCallback(
    async (signal?: AbortSignal, force = false) => {
      if (!force && (dirtyRef.current || focusedRef.current)) return;
      const payload = await fetchNotes(sourceName, noteTarget, signal);
      const text = payload.content ?? "";
      contentRef.current = text;
      markClean(text);
      setNotesLoading(false);
      setError(null);
      syncDocumentToEditor();
    },
    [markClean, noteTarget, sourceName, syncDocumentToEditor],
  );

  const setEditorText = React.useCallback((text: string) => {
    contentRef.current = text;
    const nextDirty = text !== lastSyncedRef.current;
    dirtyRef.current = nextDirty;
    setDirty(nextDirty);
  }, []);

  const saveCurrent = React.useCallback(
    async (signal?: AbortSignal) => {
      const text = contentRef.current;
      if (text === lastSyncedRef.current && !dirtyRef.current) return;
      await saveNotes(sourceName, text, noteTarget, signal);
      markClean(text);
      setSavedAt(new Date());
      setError(null);
    },
      [markClean, noteTarget, sourceName],
  );

  const handleIframeLoad = React.useCallback(() => {
    editorReadyRef.current = false;
    setEditorReady(false);
    setError(null);
  }, []);

  React.useEffect(() => {
    const controller = new AbortController();
    loadNote(controller.signal, true)
      .catch((err) => {
        if ((err as { name?: string }).name === "AbortError") return;
        setError(String(err));
        setNotesLoading(false);
      });
    return () => controller.abort();
  }, [loadNote]);

  React.useEffect(() => {
    if (notesLoading) return;
    if (!dirty) return;
    const handle = window.setTimeout(() => {
      saveCurrent()
        .catch((err) => setError(String(err)));
    }, 1500);
    return () => window.clearTimeout(handle);
  }, [dirty, notesLoading, saveCurrent]);

  React.useEffect(() => {
    return () => {
      if (dirtyRef.current) {
        void saveNotes(sourceName, contentRef.current, noteTarget).catch(() => undefined);
      }
    };
  }, [noteTarget, sourceName]);

  // App-quit notes flush (DEF-003; wx onExit/_flush_notes_if_dirty,
  // morin.py:15638-15645, 11897-11903). The debounce timer can leave the last
  // <1.5 s of edits unwritten when the app is closing; the quit flow dispatches
  // `aries://flush-notes` before confirming quit, and this listener forces an
  // immediate write of the dirty sidecar buffer (saved or scratch .md — never
  // the chart file, per the notes-sidecar policy). awaitFlush lets the quit flow
  // hold for in-flight writes before tearing the daemon down.
  React.useEffect(() => {
    const onFlush = (event: Event) => {
      if (!dirtyRef.current) return;
      const writePromise = saveNotes(sourceName, contentRef.current, noteTarget)
        .then(() => markClean(contentRef.current))
        .catch(() => undefined);
      const detail = (event as CustomEvent<{ awaitFlush?: Promise<unknown>[] }>).detail;
      detail?.awaitFlush?.push(writePromise);
    };
    window.addEventListener("aries://flush-notes", onFlush as EventListener);
    return () => window.removeEventListener("aries://flush-notes", onFlush as EventListener);
  }, [markClean, noteTarget, sourceName]);

  React.useEffect(() => {
    const reloadIfClean = () => {
      if (document.visibilityState === "hidden") return;
      void loadNote(undefined, false).catch((err) => setError(String(err)));
    };
    window.addEventListener("focus", reloadIfClean);
    document.addEventListener("visibilitychange", reloadIfClean);
    return () => {
      window.removeEventListener("focus", reloadIfClean);
      document.removeEventListener("visibilitychange", reloadIfClean);
    };
  }, [loadNote]);

  const handleBlur = React.useCallback(() => {
    focusedRef.current = false;
    void saveCurrent().catch((err) => setError(String(err)));
  }, [saveCurrent]);

  const handleEditorMessage = React.useCallback(
    (event: MessageEvent<unknown>) => {
      const frameWindow = iframeRef.current?.contentWindow;
      const fromEditorFrame =
        event.source === frameWindow ||
        (event.origin === notesEditorOrigin && event.source !== window);
      if (!fromEditorFrame) return;

      const payload =
        typeof event.data === "string"
          ? (() => {
              try {
                return JSON.parse(event.data) as RawEditorEvent;
              } catch {
                return null;
              }
            })()
          : (event.data as RawEditorEvent);
      if (!payload || typeof payload !== "object") return;
      const type = String(payload.type ?? "");

      if (type === "ready") {
        editorReadyRef.current = true;
        setEditorReady(true);
        setError(null);
        sendEditorMessage("setTheme", notesTheme);
        syncDocumentToEditor();
        window.setTimeout(syncDocumentToEditor, 50);
        return;
      }

      if (type === "input") {
        const next = typeof payload.value === "string" ? payload.value : "";
        setEditorText(next);
        return;
      }

      if (type === "focus") {
        focusedRef.current = true;
        return;
      }

      if (type === "blur") {
        handleBlur();
        return;
      }

      if (type === "save") {
        void saveCurrent().catch((err) => setError(String(err)));
        return;
      }

      if (type === "close") {
        setNotesPaneOpen(false);
        return;
      }

      if (type === "ambient-key") {
        window.dispatchEvent(
          new CustomEvent("aries://notes-editor-ambient-key", {
            detail: {
              eventType: payload.eventType,
              key: payload.key,
              metaKey: payload.metaKey,
              ctrlKey: payload.ctrlKey,
              altKey: payload.altKey,
              repeat: payload.repeat,
            },
          }),
        );
        return;
      }

      if (type === "error") {
        const message = payload.message;
        setError(message ? String(message) : t("notes.editorError"));
        return;
      }
    },
    [handleBlur, notesEditorOrigin, notesTheme, saveCurrent, setEditorText, setNotesPaneOpen, sendEditorMessage, syncDocumentToEditor, t],
  );

  React.useEffect(() => {
    window.addEventListener("message", handleEditorMessage);
    return () => {
      window.removeEventListener("message", handleEditorMessage);
    };
  }, [handleEditorMessage]);

  React.useEffect(() => {
    if (!editorReady) return;
    sendEditorMessage("setTheme", notesTheme);
  }, [editorReady, notesTheme, sendEditorMessage]);

  return (
    <aside
      data-aries-surface="panel"
      className={cn(
        "flex h-full w-full min-w-0 flex-col gap-[var(--aries-notes-gap)] bg-background/95 p-[var(--aries-notes-padding)] text-[length:var(--aries-font-size-base)]",
        className,
      )}
    >
      <div className="flex min-w-0 items-center justify-between gap-[var(--aries-notes-header-gap)] px-[var(--aries-notes-gap)]">
        <span className="min-w-0 truncate text-[length:var(--aries-font-size-small)] font-medium text-foreground/70">
          {t("notes.title")} <span className="text-foreground/35">/</span> {sourceName}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          disabled={!chart || !editorReady}
          onClick={insertChartInfo}
          title={chart ? t("notes.appendChartInfo") : t("notes.noChartLoaded")}
          className="h-5 shrink-0 rounded-[var(--aries-radius-control-compact)] px-1.5 text-[length:var(--aries-font-size-section)] text-foreground/55 hover:text-foreground"
        >
          <ListPlus className="size-3" />
          {t("notes.chartInfo")}
        </Button>
        <span className="shrink-0 text-[length:var(--aries-font-size-section)] text-foreground/40">
          {error ? t("notes.statusError") : dirty ? t("notes.statusUnsaved") : savedAt ? t("notes.statusSaved", { time: timeSince(savedAt, t) }) : ""}
        </span>
      </div>
      <div className="relative -mx-1 min-h-0 flex-1 overflow-hidden border-y border-border/40 bg-background/80">
        <iframe
          ref={iframeRef}
          title={t("notes.editorTitle")}
          src={notesEditorUrl}
          onLoad={handleIframeLoad}
          className={cn(
            "h-full w-full min-w-0 border-0 bg-background/80 transition-opacity",
            notesLoading || !editorReady ? "opacity-0" : "opacity-100",
          )}
        />
        {(notesLoading || !editorReady) && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-background/80 text-[length:var(--aries-font-size-small)] text-foreground/55">
            {notesLoading ? t("notes.loadingNotes") : t("notes.loadingEditor")}
          </div>
        )}
      </div>
    </aside>
  );
}

function timeSince(d: Date, t: TFunc): string {
  const seconds = Math.floor((Date.now() - d.getTime()) / 1000);
  if (seconds < 5) return t("notes.justNow");
  if (seconds < 60) return t("notes.secondsAgo", { seconds });
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return t("notes.minutesAgo", { minutes });
  return d.toLocaleTimeString();
}

function notesEditorTheme(theme: ThemeState | null): Record<string, string | boolean> {
  const app = theme?.appTokens ?? {};
  const chart = theme?.chartPalette ?? {};
  const get = (tokens: Record<string, string>, key: string, fallback = "") => tokens[key] || fallback;
  const background = get(app, "--aries-background", get(app, "--background", "rgb(35 36 40)"));
  const surface = get(app, "--aries-surface", get(app, "--card", "rgb(29 30 33)"));
  const raised = get(app, "--aries-surface-subtle", get(app, "--muted", "rgb(45 46 49)"));
  const text = get(app, "--aries-text-primary", get(app, "--foreground", "rgb(220 220 221)"));
  const muted = get(app, "--aries-text-dim", get(app, "--muted-foreground", "rgb(153 154 156)"));
  const border = get(app, "--aries-border-subtle", get(app, "--border", "rgb(46 47 50)"));
  const accent = get(chart, "--morinus-angles", get(app, "--aries-text-muted", muted));

  return {
    dark: theme?.mode !== "light",
    background,
    surface,
    raised,
    text,
    muted,
    border,
    accent,
    selection: `color-mix(in srgb, ${accent} 28%, transparent)`,
    "font-sans": get(app, "--aries-font-ui", get(app, "--font-ui", "FreeSans, ui-sans-serif, system-ui, sans-serif")),
  };
}

const PLANET_ORDER: PlanetId[] = [
  "sun",
  "moon",
  "mercury",
  "venus",
  "mars",
  "jupiter",
  "saturn",
  "uranus",
  "neptune",
  "pluto",
  "nnode",
  "snode",
  "chiron",
];

const PLANET_LABEL_KEYS: Record<PlanetId, string> = {
  sun: "notes.planetSun",
  moon: "notes.planetMoon",
  mercury: "notes.planetMercury",
  venus: "notes.planetVenus",
  mars: "notes.planetMars",
  jupiter: "notes.planetJupiter",
  saturn: "notes.planetSaturn",
  uranus: "notes.planetUranus",
  neptune: "notes.planetNeptune",
  pluto: "notes.planetPluto",
  nnode: "notes.planetNnode",
  snode: "notes.planetSnode",
  chiron: "notes.planetChiron",
};

function chartInfoMarkdown(snapshot: ChartRenderSnapshot, t: TFunc): string {
  const chart = snapshot.primaryChart;
  const lines: string[] = [];

  const angles = angleRows(chart, t);
  if (angles.length > 0) {
    lines.push(`### ${t("notes.headingAngles")}`, "", ...angles, "");
  }

  lines.push(`### ${t("notes.headingPlanets")}`, "");
  for (const planet of orderedPlanets(chart.planets)) {
    lines.push(rundownBullet(t(PLANET_LABEL_KEYS[planet.id]), planet.longitude, t, planet.house, planet.motion));
    lines.push(`  - ${t("notes.notesLabel")}`);
    lines.push("");
  }

  const points = pointRows(chart, t);
  if (points.length > 0) {
    lines.push(`### ${t("notes.headingPoints")}`, "", ...points, "");
  }

  return `\n\n${lines.join("\n").trimEnd()}\n\n`;
}

function angleRows(chart: Chart, t: TFunc): string[] {
  return [
    rundownBullet(t("notes.ascendant"), chart.angles.asc, t, 1),
    rundownBullet(t("notes.midheaven"), chart.angles.mc, t, 10),
  ];
}

function pointRows(chart: Chart, t: TFunc): string[] {
  const rows: string[] = [];
  if (chart.fortune) rows.push(rundownBullet(t("notes.lotOfFortune"), chart.fortune.longitude, t, pointHouse(chart.fortune)));
  if (chart.vertex) rows.push(rundownBullet(t("notes.vertex"), chart.vertex.longitude, t, chart.vertex.house));
  if (chart.syzygy) {
    rows.push(rundownBullet(chart.syzygy.label ?? t("notes.prenatalSyzygy"), chart.syzygy.longitude, t, chart.syzygy.house));
  }
  return rows;
}

function orderedPlanets(planets: ChartPlanet[]): ChartPlanet[] {
  const byId = new Map(planets.map((planet) => [planet.id, planet]));
  return PLANET_ORDER.flatMap((id) => {
    const planet = byId.get(id);
    return planet ? [planet] : [];
  });
}

function rundownBullet(label: string, longitude: number, t: TFunc, house?: number, motion?: string): string {
  const parts = [zodiacPosition(longitude, t)];
  if (house != null) parts.push(t("notes.house", { house }));
  if (motion) parts.push(motion);
  return `- **${label}** - ${parts.join(", ")}`;
}

function zodiacPosition(longitude: number, t: TFunc): string {
  const normalized = ((longitude % 360) + 360) % 360;
  const rawSignIndex = Math.floor(normalized / 30);
  const roundedSecondsInSign = Math.round((normalized - rawSignIndex * 30) * 3600);
  const signCarry = Math.floor(roundedSecondsInSign / (30 * 3600));
  const signIndex = (rawSignIndex + signCarry) % 12;
  const secondsInSign = roundedSecondsInSign % (30 * 3600);
  const degrees = Math.floor(secondsInSign / 3600);
  const minutes = Math.floor((secondsInSign % 3600) / 60);
  const seconds = secondsInSign % 60;
  return `${t(`notes.sign${signIndex}`)} ${degrees}°${pad2(minutes)}'${pad2(seconds)}"`;
}

function pointHouse(point: ChartFortune | ChartVertex | ChartSyzygy): number | undefined {
  return "house" in point ? point.house : undefined;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}
