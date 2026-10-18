// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import * as React from "react";
import { ListPlus } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { Chart, ChartFortune, ChartPlanet, ChartRenderSnapshot, ChartSyzygy, ChartVertex, PlanetId } from "@/lib/chart/types";
import {
  fetchNotes,
  saveNotes,
} from "@/lib/daemon/client";
import { cn } from "@/lib/utils";
import { useT, type TFunc } from "@/lib/i18n/i18n";
import { useFrameLayoutStore } from "@/stores/frame-layout-store";

type Props = {
  sourceName: string;
  chart?: ChartRenderSnapshot | null;
  documentId?: string;
  scratch?: boolean;
  eventId?: string;
  recordId?: string;
  className?: string;
};

/**
 * Per-radix notes — file-backed via the daemon. Saved charts write the
 * shared chart-ID Markdown file; ephemeral root charts write a daemon scratch
 * note keyed by document id until the chart-save lifecycle promotes it.
 *
 * The Milkdown iframe editor is not used in the desktop shell: WKWebView does
 * not reliably deliver iframe postMessage to the React host. Editing uses the
 * same native textarea surface as chart event notes.
 */
export function NotesPanel({ sourceName, chart = null, documentId, scratch = false, eventId, recordId, className }: Props) {
  return (
    <NotesPanelInner
      key={eventId ? `${recordId}:${eventId}` : `${sourceName}:${documentId ?? ""}:${scratch ? "scratch" : "saved"}`}
      sourceName={sourceName}
      chart={chart}
      documentId={documentId}
      scratch={scratch}
      eventId={eventId}
      recordId={recordId}
      className={className}
    />
  );
}

function NotesPanelInner({ sourceName, chart = null, documentId, scratch = false, eventId, recordId, className }: Props) {
  const t = useT();
  const setNotesPaneOpen = useFrameLayoutStore((s) => s.setNotesPaneOpen);
  const [notesLoading, setNotesLoading] = React.useState(true);
  const [noteText, setNoteText] = React.useState("");
  const [savedAt, setSavedAt] = React.useState<Date | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [dirty, setDirty] = React.useState(false);
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);
  const contentRef = React.useRef("");
  const dirtyRef = React.useRef(false);
  const focusedRef = React.useRef(false);
  const lastSyncedRef = React.useRef("");
  const mountedRef = React.useRef(true);
  const saveQueueRef = React.useRef<Promise<void>>(Promise.resolve());
  const noteTarget = React.useMemo(
    () => ({ documentId, scratch, eventId, recordId }),
    [documentId, scratch, eventId, recordId],
  );
  const savedTargetRef = React.useRef(noteTarget);
  const revisionRef = React.useRef<string | undefined>(undefined);

  const markClean = React.useCallback((text: string) => {
    lastSyncedRef.current = text;
    dirtyRef.current = false;
    if (mountedRef.current) {
      setDirty(false);
      setNoteText(text);
    }
    contentRef.current = text;
  }, []);

  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const applyNoteText = React.useCallback((text: string) => {
    contentRef.current = text;
    const nextDirty = text !== lastSyncedRef.current;
    dirtyRef.current = nextDirty;
    setDirty(nextDirty);
    setNoteText(text);
  }, []);

  const loadNote = React.useCallback(
    async (signal?: AbortSignal, force = false) => {
      if (!force && (dirtyRef.current || focusedRef.current)) return;
      const payload = await fetchNotes(sourceName, noteTarget, signal);
      if (!force && (dirtyRef.current || focusedRef.current)) return;
      savedTargetRef.current = { ...noteTarget, recordId: payload.recordId ?? noteTarget.recordId };
      revisionRef.current = payload.revision;
      const text = payload.content ?? "";
      markClean(text);
      setNotesLoading(false);
      setError(null);
    },
    [markClean, noteTarget, sourceName],
  );

  const saveCurrent = React.useCallback(() => {
    const flushLatest = async () => {
      let wrote = false;
      while (dirtyRef.current || contentRef.current !== lastSyncedRef.current) {
        const text = contentRef.current;
        if (text === lastSyncedRef.current) {
          dirtyRef.current = false;
          if (mountedRef.current) setDirty(false);
          break;
        }

        const saved = await saveNotes(sourceName, text, { ...savedTargetRef.current, revision: revisionRef.current });
        revisionRef.current = saved.revision;
        lastSyncedRef.current = text;
        wrote = true;

        const hasNewerText = contentRef.current !== text;
        dirtyRef.current = hasNewerText;
        if (mountedRef.current) setDirty(hasNewerText);
      }

      if (wrote && mountedRef.current) {
        setSavedAt(new Date());
        setError(null);
      }
    };

    const queued = saveQueueRef.current
      .catch(() => undefined)
      .then(flushLatest);
    saveQueueRef.current = queued;
    return queued;
  }, [sourceName]);

  const insertChartInfo = React.useCallback(() => {
    if (!chart) return;
    const next = `${contentRef.current}${chartInfoMarkdown(chart, t)}`;
    applyNoteText(next);
    setError(null);
    textareaRef.current?.focus();
  }, [applyNoteText, chart, t]);

  React.useEffect(() => {
    const controller = new AbortController();
    loadNote(controller.signal)
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
        void saveCurrent().catch(() => undefined);
      }
    };
  }, [saveCurrent]);

  React.useEffect(() => {
    const onFlush = (event: Event) => {
      if (!dirtyRef.current) return;
      const writePromise = saveCurrent().catch(() => undefined);
      const detail = (event as CustomEvent<{ awaitFlush?: Promise<unknown>[] }>).detail;
      detail?.awaitFlush?.push(writePromise);
    };
    window.addEventListener("aries://flush-notes", onFlush as EventListener);
    return () => window.removeEventListener("aries://flush-notes", onFlush as EventListener);
  }, [saveCurrent]);

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

  React.useEffect(() => {
    const reloadCanonicalMarkdown = () => {
      void loadNote(undefined, true).catch((err) => setError(String(err)));
    };
    window.addEventListener("aries://notes-changed", reloadCanonicalMarkdown);
    return () => window.removeEventListener("aries://notes-changed", reloadCanonicalMarkdown);
  }, [loadNote]);

  const handleBlur = React.useCallback(() => {
    focusedRef.current = false;
    void saveCurrent().catch((err) => setError(String(err)));
  }, [saveCurrent]);

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
          disabled={!chart || notesLoading}
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
      {error?.startsWith("NoteConflict:") && (
        <p role="alert" className="text-[length:var(--aries-font-size-small)] text-destructive">
          {t("notes.externalConflict")}
        </p>
      )}
      <div className="relative -mx-1 min-h-0 flex-1 overflow-hidden border-y border-border/40 bg-background/80">
        {notesLoading ? (
          <div className="flex h-full items-center justify-center text-[length:var(--aries-font-size-small)] text-foreground/55">
            {t("notes.loadingNotes")}
          </div>
        ) : (
          <textarea
            ref={textareaRef}
            value={noteText}
            aria-label={t("notes.editorTitle")}
            placeholder={t("editor.notesPlaceholder")}
            data-aries-control-appearance="local"
            className="block h-full w-full min-h-0 resize-none appearance-none overflow-y-auto whitespace-pre-wrap [overflow-wrap:anywhere] border-0 bg-background/80 p-[var(--aries-notes-gap)] text-[length:var(--aries-font-size-base)] text-foreground shadow-none outline-none field-sizing-fixed placeholder:text-foreground/40"
            onChange={(event) => applyNoteText(event.target.value)}
            onFocus={() => {
              focusedRef.current = true;
            }}
            onBlur={handleBlur}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === "Escape") {
                event.preventDefault();
                setNotesPaneOpen(false);
              }
              window.dispatchEvent(
                new CustomEvent("aries://notes-editor-ambient-key", {
                  detail: {
                    eventType: event.type,
                    key: event.key,
                    metaKey: event.metaKey,
                    ctrlKey: event.ctrlKey,
                    altKey: event.altKey,
                    repeat: event.repeat,
                  },
                }),
              );
            }}
          />
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
