// SPDX-FileCopyrightText: Morinus contributors
// SPDX-FileCopyrightText: 2026 Max Lange (Aries modifications)
// SPDX-License-Identifier: GPL-3.0-or-later
// Modified for Aries in 2026 by Max Lange.

import type {
  ChartRenderSnapshot,
  OuterRingMode,
  OverlayRenderMode,
  PdDirectionState,
  RenderVariant,
  SymbolicTimeReadout,
} from "@/lib/chart/types";
import {
  approxUtf8Bytes,
  chartPerfEnabled,
  perfNow,
  recordChartPerf,
  recordStartupPerfOnce,
} from "@/lib/chart/perf";
import { resolveShellHost } from "@/lib/shell-host";
import type { ChartStyleFontRef } from "@/lib/style-lab/authoring-schema";

const DEFAULT_DAEMON_URL = "http://127.0.0.1:8765";
const SAME_ORIGIN_DAEMON_URL = "same-origin";
const DAEMON_HEALTH_TIMEOUT_MS = 60_000;
const DAEMON_HEALTH_READY_CACHE_MS = 1_000;

declare global {
  interface Window {
    __ARIES_DAEMON_URL__?: string;
    __ARIES_DAEMON_TOKEN__?: string;
  }
}

function runtimeDaemonUrl(): string | null {
  if (typeof window === "undefined") return null;
  return window.__ARIES_DAEMON_URL__?.trim() || null;
}

function runtimeDaemonToken(): string | null {
  if (typeof window !== "undefined") {
    const runtime = window.__ARIES_DAEMON_TOKEN__?.trim();
    if (runtime) return runtime;
  }
  return process.env.NEXT_PUBLIC_ARIES_DAEMON_TOKEN?.trim() || null;
}

export function daemonAuthToken(): string | null {
  return runtimeDaemonToken();
}

function canUseSameOriginDaemon(): boolean {
  if (typeof window === "undefined") return true;
  const { hostname, protocol } = window.location;
  if (hostname === "tauri.localhost" || hostname.endsWith(".tauri.localhost")) {
    return false;
  }
  return protocol === "http:" || protocol === "https:";
}

export function daemonBaseUrl(): string {
  const runtimeUrl = runtimeDaemonUrl();
  if (runtimeUrl) return runtimeUrl;

  const configured = process.env.NEXT_PUBLIC_ARIES_DAEMON_URL?.trim();
  if (configured === SAME_ORIGIN_DAEMON_URL) {
    return canUseSameOriginDaemon() ? "" : DEFAULT_DAEMON_URL;
  }
  return configured || DEFAULT_DAEMON_URL;
}

export function daemonFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const token = runtimeDaemonToken();
  if (!token) return fetch(input, init);
  const headers = new Headers(init.headers);
  if (!headers.has("X-Aries-Token")) {
    headers.set("X-Aries-Token", token);
  }
  return fetch(input, { ...init, headers });
}

function abortError(): Error {
  const error = new Error("Aborted");
  error.name = "AbortError";
  return error;
}

function sleepWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? abortError());
      return;
    }
    const timer = globalThis.setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        globalThis.clearTimeout(timer);
        reject(signal.reason ?? abortError());
      },
      { once: true },
    );
  });
}

function waitForAbortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(signal.reason ?? abortError());
  return new Promise((resolve, reject) => {
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    const onAbort = () => {
      cleanup();
      reject(signal.reason ?? abortError());
    };
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        cleanup();
        if (signal.aborted) {
          reject(signal.reason ?? abortError());
          return;
        }
        resolve(value);
      },
      (err) => {
        cleanup();
        reject(err);
      },
    );
  });
}

let daemonHealthReadyAt = 0;
let daemonHealthInFlight: Promise<void> | null = null;
let daemonHasBeenReady = false;

async function pollDaemonHealth(
  signal?: AbortSignal,
  timeoutMs = DAEMON_HEALTH_TIMEOUT_MS,
): Promise<void> {
  const startedAt = Date.now();
  recordStartupPerfOnce("daemon-health-poll-start", { timeoutMs });
  let attempt = 0;
  while (true) {
    if (signal?.aborted) throw signal.reason ?? abortError();
    try {
      const response = await daemonFetch(`${daemonBaseUrl()}/health`, {
        cache: "no-store",
        signal,
      });
      if (response.ok) {
        daemonHasBeenReady = true;
        recordStartupPerfOnce("daemon-health-poll-ready", {
          attempts: attempt + 1,
          ms: Date.now() - startedAt,
        });
        return;
      }
    } catch (err) {
      if (signal?.aborted) throw err;
    }

    const elapsedMs = Date.now() - startedAt;
    if (elapsedMs >= timeoutMs) {
      throw new Error(`daemon health check timed out after ${timeoutMs}ms`);
    }
    const delayMs = Math.min(150 + attempt * 100, 1_000, timeoutMs - elapsedMs);
    await sleepWithAbort(delayMs, signal);
    attempt += 1;
  }
}

export function waitForDaemonHealth(
  signal?: AbortSignal,
  timeoutMs = DAEMON_HEALTH_TIMEOUT_MS,
): Promise<void> {
  if (signal?.aborted) return Promise.reject(signal.reason ?? abortError());
  if (timeoutMs !== DAEMON_HEALTH_TIMEOUT_MS) {
    return pollDaemonHealth(signal, timeoutMs);
  }

  const now = Date.now();
  if (daemonHealthReadyAt > 0 && now - daemonHealthReadyAt <= DAEMON_HEALTH_READY_CACHE_MS) {
    return Promise.resolve();
  }

  daemonHealthInFlight ??= pollDaemonHealth(undefined, timeoutMs)
    .then(() => {
      daemonHealthReadyAt = Date.now();
    })
    .finally(() => {
      daemonHealthInFlight = null;
    });
  return waitForAbortable(daemonHealthInFlight, signal);
}

/** Hold startup actions until the packaged daemon is actually listening.
 * Intel PyInstaller startup can be noticeably slower on old hardware; once
 * this process has reached health, routine commands keep their zero-probe path. */
export function waitForDaemonStartup(signal?: AbortSignal): Promise<void> {
  if (daemonHasBeenReady) return Promise.resolve();
  return waitForDaemonHealth(signal);
}

function daemonWebSocketUrl(): string {
  const base = daemonBaseUrl();
  let url: URL;
  if (base === "") {
    url = new URL("/ws/events", window.location.href);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  } else {
    url = new URL("/ws/events", base.replace(/^http/, "ws"));
  }
  const token = runtimeDaemonToken();
  if (token) url.searchParams.set("token", token);
  return url.toString();
}

export async function fetchChartSnapshot(
  requestKey: string,
  signal?: AbortSignal,
): Promise<ChartRenderSnapshot> {
  const startedAt = perfNow();
  const response = await daemonFetch(`${daemonBaseUrl()}/api/chart?${requestKey}`, {
    cache: "no-store",
    signal,
  });
  const headersAt = perfNow();
  if (!response.ok) {
    throw new Error(`chart request failed: ${response.status}`);
  }
  const text = await response.text();
  const bodyAt = perfNow();
  const snapshot = JSON.parse(text) as ChartRenderSnapshot;
  const parsedAt = perfNow();
  recordChartPerf("chart-legacy-snapshot", {
    requestKey,
    bytes: approxUtf8Bytes(text),
    fetchMs: headersAt - startedAt,
    bodyMs: bodyAt - headersAt,
    parseMs: parsedAt - bodyAt,
    totalMs: parsedAt - startedAt,
  });
  return snapshot;
}

export type ChartPreviewRequestOptions = Readonly<{
  variant: RenderVariant;
  houses: boolean;
  positions: boolean;
  terms: boolean;
  decans: boolean;
  aspects: boolean;
  minorAspects: boolean;
  outerRing: Exclude<OuterRingMode, "parallel_transits">;
  /** Compatibility with the rejected boolean preview contract. */
  fixedStars?: boolean;
}>;

export function chartPreviewRequestKey(
  chartRequestKey: string,
  preview: ChartPreviewRequestOptions,
): string {
  const search = new URLSearchParams(chartRequestKey);
  search.set("previewVariant", preview.variant);
  search.set("previewHouses", String(preview.houses));
  search.set("previewPositions", String(preview.positions));
  search.set("previewTerms", String(preview.terms));
  search.set("previewDecans", String(preview.decans));
  search.set("previewAspects", String(preview.aspects));
  search.set("previewMinorAspects", String(preview.minorAspects));
  search.set("previewOuterRing", preview.outerRing);
  if (preview.fixedStars != null) {
    search.set("previewFixedStars", String(preview.fixedStars));
  }
  return search.toString();
}

export function fetchChartPreviewSnapshot(
  chartRequestKey: string,
  preview: ChartPreviewRequestOptions,
  signal?: AbortSignal,
): Promise<ChartRenderSnapshot> {
  return fetchChartSnapshot(chartPreviewRequestKey(chartRequestKey, preview), signal);
}

/**
 * Render a workspace document by its daemon id — the session-truth path.
 *
 * Returns the LIVE in-memory chart the daemon holds (and has already stepped),
 * never a chart reconstructed from name+kind+when. This is the only render path
 * the skin should use for any document the workspace owns; it is what keeps the
 * skin "stupid" (it draws what the daemon sends and computes nothing).
 */
export async function fetchDocumentSnapshot(
  docId: string,
  signal?: AbortSignal,
  overlayRenderMode?: OverlayRenderMode,
): Promise<ChartRenderSnapshot> {
  const startedAt = perfNow();
  const search = new URLSearchParams();
  if (overlayRenderMode && overlayRenderMode !== "full") {
    search.set("overlayRenderMode", overlayRenderMode);
  }
  if (chartPerfEnabled()) {
    search.set("perf", "1");
  }
  const query = search.toString();
  const response = await daemonFetch(
    `${daemonBaseUrl()}/api/workspace/document/${encodeURIComponent(docId)}/snapshot${query ? `?${query}` : ""}`,
    { cache: "no-store", signal },
  );
  const headersAt = perfNow();
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new DocumentSnapshotError(response.status, detail, docId);
  }
  const text = await response.text();
  const bodyAt = perfNow();
  const snapshot = JSON.parse(text) as ChartRenderSnapshot;
  const parsedAt = perfNow();
  recordChartPerf("chart-document-snapshot", {
    docId,
    overlayRenderMode: snapshot.overlayRenderMode,
    bytes: approxUtf8Bytes(text),
    fetchMs: headersAt - startedAt,
    bodyMs: bodyAt - headersAt,
    parseMs: parsedAt - bodyAt,
    totalMs: parsedAt - startedAt,
    debugTiming: snapshot.debugTiming ?? null,
  });
  return snapshot;
}

export class DocumentSnapshotError extends Error {
  readonly status: number;
  readonly detail: string;
  readonly documentId: string;

  constructor(status: number, detail: string, documentId: string) {
    super(`document snapshot failed: ${status} ${detail}`);
    this.name = "DocumentSnapshotError";
    this.status = status;
    this.detail = detail;
    this.documentId = documentId;
  }
}

export type TemporalMapCalendar = "gregorian" | "julian";

export type TemporalMapInstant = {
  jdUt: number;
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  civilDate: string;
  civilDatetime: string;
  /** Gregorian-safe month/range loader anchor; `jdUt` remains authoritative. */
  canonicalQueryDatetime: string;
  dateLabel: string;
  datetimeLabel: string;
  ageYears: number;
  ageYearsInt: number;
  ageLabel: string;
};

export type TemporalMapContext = {
  documentId: string;
  birthJdUt: number;
  lifeEndJdUt: number;
  focusJdUt: number;
  lifeYears: number;
  tropicalYearDays: number;
  calendar: TemporalMapCalendar;
  timeBasis: "ut";
  birth: TemporalMapInstant;
  focus: TemporalMapInstant;
  lifeEnd: TemporalMapInstant;
};

export type TemporalMapFormatResult = {
  documentId: string;
  birthJdUt: number;
  calendar: TemporalMapCalendar;
  timeBasis: "ut";
  instants: TemporalMapInstant[];
};

export async function fetchTemporalMapContext(
  documentId: string,
  signal?: AbortSignal,
): Promise<TemporalMapContext> {
  const response = await daemonFetch(
    `${daemonBaseUrl()}/api/workspace/document/${encodeURIComponent(documentId)}/temporal-map/context`,
    { cache: "no-store", signal },
  );
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`temporal map context failed: ${response.status} ${detail}`);
  }
  return (await response.json()) as TemporalMapContext;
}

export async function formatTemporalMapJds(
  documentId: string,
  jds: number[],
  signal?: AbortSignal,
): Promise<TemporalMapFormatResult> {
  return workspacePost<TemporalMapFormatResult>(
    `/api/workspace/document/${encodeURIComponent(documentId)}/temporal-map/format`,
    { jds },
    signal,
  );
}

export type TemporalMapLaneSpec = {
  laneId: string;
  sourceId: string;
  spec?: Record<string, unknown>;
};

export type TemporalMapCoverageSpan = {
  startJdUt: number;
  endJdUt: number;
};

export type TemporalMapCoverageSet = {
  spans: TemporalMapCoverageSpan[];
  complete: boolean;
  authoritative: boolean;
};

export type TemporalMapLaneSnapshot = {
  laneId: string;
  sourceId: string;
  status: "unknown" | "queued" | "building" | "partial" | "ready" | "unsupported" | "error";
  complete: boolean;
  evidenceCount: number;
  truncated: boolean;
  error: string | null;
  unsupportedReason: string | null;
  evidenceCoverage: TemporalMapCoverageSet;
  concurrenceCoverage: TemporalMapCoverageSet;
  provisionalCoverage: TemporalMapCoverageSet;
};

export type TemporalMapSnapshot = {
  token: string;
  worldToken: string;
  generation: number;
  revision: number;
  documentId: string;
  minimumLanes: number;
  horizon: {
    startJdUt: number;
    endJdUt: number;
    lifeYears: number;
    timeBasis: "ut";
  };
  focusJdUt: number;
  calendar: TemporalMapCalendar;
  levels: Array<{ level: number; binDays: number }>;
  lanes: TemporalMapLaneSnapshot[];
  build: {
    running: boolean;
    pendingTasks: number;
    settled: boolean;
    cancelled: boolean;
  };
  complete: boolean;
  cancelled: boolean;
};

export type TemporalMapTileLane = {
  laneId: string;
  bins: Array<{
    index: number;
    count: number;
    planetIds: number[];
  }>;
};

export type TemporalMapTilePlanetSummary = {
  planetId: number;
  laneMask: number;
  groupCount: number;
  maxLaneCount: number;
};

export type TemporalMapTileBin = {
  index: number;
  startJdUt: number;
  endJdUt: number;
  groupCount: number;
  maxLaneCount: number;
  /** Aggregate union for compatibility; it is not one mixed-planet concurrence. */
  laneMask: number;
  planetIds: number[];
  planetSummaries: TemporalMapTilePlanetSummary[];
};

export type TemporalMapTilesResult = {
  token: string;
  generation: number;
  revision: number;
  startJdUt: number;
  endJdUt: number;
  level: number;
  binCount: number;
  binDays: number;
  lanes: TemporalMapTileLane[];
  bins: TemporalMapTileBin[];
  coverage: TemporalMapLaneSnapshot[];
  complete: boolean;
};

export type TemporalMapGroupsResult = {
  token: string;
  generation: number;
  revision: number;
  startJdUt: number;
  endJdUt: number;
  minimumLanes: number;
  groups: TemporalConcurrenceGroup[];
  total: number;
  offset: number;
  nextOffset: number | null;
  coverage: TemporalMapLaneSnapshot[];
  complete: boolean;
};

export type TemporalMapOpenResult = TemporalMapSnapshot & {
  groups: TemporalConcurrenceGroup[];
  initialTiles: {
    startJdUt: number;
    endJdUt: number;
    binCount: number;
    bins: TemporalMapTileBin[];
    complete: boolean;
  };
};

export async function openTemporalMap(
  payload: {
    documentId: string;
    lanes: TemporalMapLaneSpec[];
    minimumLanes?: number;
    viewportStartJdUt?: number;
    viewportEndJdUt?: number;
  },
  signal?: AbortSignal,
): Promise<TemporalMapOpenResult> {
  return workspacePost<TemporalMapOpenResult>("/api/temporal-map/open", payload, signal);
}

export async function fetchTemporalMapTiles(
  payload: {
    token: string;
    startJdUt: number;
    endJdUt: number;
    binCount?: number;
    level?: number;
  },
  signal?: AbortSignal,
): Promise<TemporalMapTilesResult> {
  return workspacePost<TemporalMapTilesResult>("/api/temporal-map/tiles", payload, signal);
}

export async function fetchTemporalMapGroups(
  payload: {
    token: string;
    startJdUt: number;
    endJdUt: number;
    minimumLanes?: number;
    offset?: number;
    limit?: number;
  },
  signal?: AbortSignal,
): Promise<TemporalMapGroupsResult> {
  return workspacePost<TemporalMapGroupsResult>("/api/temporal-map/groups", payload, signal);
}

export async function fetchTemporalMapProgress(
  token: string,
  signal?: AbortSignal,
): Promise<TemporalMapSnapshot> {
  const search = new URLSearchParams({ token });
  const response = await daemonFetch(
    `${daemonBaseUrl()}/api/temporal-map/progress?${search.toString()}`,
    { cache: "no-store", signal },
  );
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`temporal map progress failed: ${response.status} ${detail}`);
  }
  return (await response.json()) as TemporalMapSnapshot;
}

export async function cancelTemporalMap(
  token: string,
  signal?: AbortSignal,
): Promise<{ token?: string; cancelled: boolean }> {
  return workspacePost<{ token?: string; cancelled: boolean }>(
    "/api/temporal-map/cancel",
    { token },
    signal,
  );
}

export function isUnknownDocumentSnapshotError(error: unknown): error is DocumentSnapshotError {
  return error instanceof DocumentSnapshotError && error.status === 404;
}

export type SupplementaryBindingPayload = {
  feature_kind?: string;
  parent_source_datetime?: [number, number, number, number, number, number] | null;
  retained_state?: Record<string, unknown>;
};

export type SupplementaryRuntimePayload = {
  kind: string;
  featureKind: string;
  displayDatetime?: string | null;
  binding?: SupplementaryBindingPayload | null;
};

export type SupplementaryChartSnapshot = ChartRenderSnapshot & {
  supplementary?: SupplementaryRuntimePayload;
};

export async function fetchSupplementaryChart(
  params: { name: string; kind: string; when?: string; binding?: SupplementaryBindingPayload },
  signal?: AbortSignal,
): Promise<SupplementaryChartSnapshot> {
  const search = new URLSearchParams({ name: params.name, kind: params.kind });
  if (params.when) search.set("when", params.when);
  if (params.binding) search.set("binding", JSON.stringify(params.binding));
  const response = await daemonFetch(`${daemonBaseUrl()}/api/chart/supplementary?${search.toString()}`, {
    cache: "no-store",
    signal,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`supplementary request failed: ${response.status} ${detail}`);
  }
  return (await response.json()) as SupplementaryChartSnapshot;
}

// ---------------------------------------------------------------------------
// Inspector payload — the exact shape chartinspector.build_payload returns
// (chartinspector.py:998-1011). The daemon ships this verbatim; the React pane
// renders it without re-deriving any field. Colours are [r,g,b] arrays.
// ---------------------------------------------------------------------------
export type RGB = [number, number, number];

/** A dignity block item — either a labelled value or a mutual-reception pair. */
export type InspectorDignityItem =
  | {
      kind?: undefined;
      label: string;
      value: string;
      colour?: RGB | null;
      colour_role?: string | null;
      bold?: boolean;
    }
  | {
      kind: "triplicity_lords";
      label: string;
      flag_label?: string;
      value_text?: string;
      lords: Array<{
        planet_id: number;
        glyph: string;
        name: string;
        colour?: RGB | null;
        colour_role?: string | null;
        current?: boolean;
      }>;
    }
  | {
      kind: "mutual_reception";
      label?: string;
      left: string; // Morinus glyph char
      arrow: string;
      right: string; // Morinus glyph char
      left_colour?: RGB | null;
      left_colour_role?: string | null;
      right_colour?: RGB | null;
      right_colour_role?: string | null;
      bold?: boolean;
    };

/** An aspect-row item — prefix text + Morinus glyph + suffix text, coloured. */
export type InspectorAspectItem = {
  prefix_text: string;
  aspect_glyph: string; // Morinus glyph char
  suffix_text: string;
  aspect_colour?: RGB | null;
  aspect_colour_role?: string | null;
  full_text: string;
};

export type InspectorManzil = {
  label: string;
  index: number;
  name_ar: string;
  name_translit: string;
  gloss_key: string;
  degree_within: string;
};

export type InspectorLunarExactState =
  | "slowest"
  | "fastest"
  | "north_bending"
  | "south_bending";

export type InspectorLunarConditions = {
  increasing_in_light: boolean;
  increasing_in_latitude: boolean;
  increasing_in_number: boolean;
  swift: boolean;
  longitude_speed: number;
  longitude_acceleration: number;
  latitude: number;
  latitude_speed: number;
  elongation: number;
  exact_states: InspectorLunarExactState[];
};

export type InspectorPayload = {
  glyph: string; // Morinus glyph char (or "")
  title: string;
  motionGlyph?: string;
  motionUsesSymbolFont?: boolean;
  motionLabel?: string;
  meta: string; // role label ("", "Center chart", "Outer ring")
  accent: RGB | null;
  accentRole?: string | null;
  smart_rows: string[];
  dignity_rows?: string[];
  dignity_items?: InspectorDignityItem[];
  detail_rows?: string[];
  station_rows?: string[];
  aspect_rows?: string[];
  aspect_items?: InspectorAspectItem[];
  manzil?: InspectorManzil | null;
  lunar_conditions?: InspectorLunarConditions;
  phasis_row?: string | null;
  deferred_slots?: string[];
  rows?: string[];
  footer?: string;
  /** Daemon-owned primary-direction event state for kind=pd_event. */
  directionEvent?: PdDirectionState | null;
};

export type InspectorRegionQuery = {
  kind: string; // planet|vertex|fortune|syzygy|eclipse|angle|house|sign|secondary_ring|aspect|drishti|pd_event
  // planet SE id | "vertex" | angle key | house/sign index |
  // secondary_ring "family|longitude|label" | aspect "p1:p2:type" |
  // dṛṣṭi relation id | selected primary-direction event id
  objectId: string;
  // 'outer' for a biwheel/synastry/transit outer-ring body → resolved against
  // the comparison chart (graphchart region.chart_role, graphchart.py:2151).
  chartRole?: "primary" | "outer";
  /** Zero-based chart index for a multi-wheel body. */
  ringIndex?: number;
  // Live session document id. When set, the daemon resolves the chart from
  // session truth (the live, possibly unsaved/derived chart the wheel is
  // drawing) instead of reloading by name+source — the only path that works for
  // a chart not backed by a .jsonl collection (fpath ""). Always prefer this.
  docId?: string;
  name: string;
  hereNow?: boolean;
  supplementaryKind?: string;
  comparisonName?: string;
  viewMode?: number;
  when?: string;
  binding?: SupplementaryBindingPayload;
  deferSignals?: boolean;
};

export async function fetchInspectorPayload(
  query: InspectorRegionQuery,
  signal?: AbortSignal,
): Promise<InspectorPayload> {
  const search = new URLSearchParams({ kind: query.kind, objectId: query.objectId, name: query.name });
  if (query.docId) search.set("docId", query.docId);
  if (query.hereNow) search.set("hereNow", "true");
  if (query.chartRole) search.set("chartRole", query.chartRole);
  if (query.ringIndex != null) search.set("ringIndex", String(query.ringIndex));
  if (query.supplementaryKind) search.set("supplementaryKind", query.supplementaryKind);
  if (query.comparisonName) search.set("comparisonName", query.comparisonName);
  if (query.viewMode != null) search.set("viewMode", String(query.viewMode));
  if (query.when) search.set("when", query.when);
  if (query.binding) search.set("binding", JSON.stringify(query.binding));
  if (query.deferSignals) search.set("deferSignals", "true");
  const response = await daemonFetch(`${daemonBaseUrl()}/api/inspector?${search.toString()}`, {
    cache: "no-store",
    signal,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`inspector request failed: ${response.status} ${detail}`);
  }
  return (await response.json()) as InspectorPayload;
}

// ---------------------------------------------------------------------------
// Inspector hover-flag — the OTHER chartinspector entry point. The compact
// floating glyph card pinned to the hovered symbol, not the side pane.
// chartinspector.build_flag_payload (chartinspector.py:1148), shipped verbatim
// by GET /api/inspector/flag (server.py). wx driver:
// workspace_shell._update_hover_flag (workspace_shell.py:5307). The card renders
// this — it derives nothing. Rows are tuples (build_flag_payload) serialized as
// JSON arrays: [label, value] | [label, value, colour] | [label, "", null, spans].
// ---------------------------------------------------------------------------

/** A coloured/glyph span inside a flag row (build_flag_payload spans,
 * chartinspector.py:1193-1196 / _flag_aspect_rows :806-816). */
export type InspectorFlagSpan = {
  text: string;
  colour?: RGB | null;
  colourRole?: string | null;
  glyph?: boolean; // render in the Morinus face
};

/** One flag row, as serialized from the Python tuple. Index 0 = label, 1 =
 * value, 2 = optional [r,g,b] value colour, 3 = optional span list, 4 = the
 * stable semantic CSS role for the value colour. */
export type InspectorFlagRow =
  | [string, string]
  | [string, string, RGB | null]
  | [string, string, RGB | null, InspectorFlagSpan[]]
  | [string, string, RGB | null, InspectorFlagSpan[] | null, string | null];

/** Exact shape of chartinspector.build_flag_payload (chartinspector.py:1157). */
export type InspectorFlagPayload = {
  glyph: string; // Morinus glyph char (or "")
  title: string;
  motionGlyph?: string;
  motionUsesSymbolFont?: boolean;
  motionLabel?: string;
  accent: RGB | null;
  accentRole?: string | null;
  rows: InspectorFlagRow[];
  nextStationRow?: InspectorFlagRow | null;
  deferredSlots?: string[];
  compact?: boolean; // aspect flags set this (smaller card, accent border)
  /** Daemon-owned primary-direction event state for kind=pd_event. */
  directionEvent?: PdDirectionState | null;
};

export async function fetchInspectorFlagPayload(
  query: InspectorRegionQuery,
  signal?: AbortSignal,
): Promise<InspectorFlagPayload> {
  const search = new URLSearchParams({ kind: query.kind, objectId: query.objectId, name: query.name });
  if (query.docId) search.set("docId", query.docId);
  if (query.hereNow) search.set("hereNow", "true");
  if (query.chartRole) search.set("chartRole", query.chartRole);
  if (query.ringIndex != null) search.set("ringIndex", String(query.ringIndex));
  if (query.supplementaryKind) search.set("supplementaryKind", query.supplementaryKind);
  if (query.comparisonName) search.set("comparisonName", query.comparisonName);
  if (query.viewMode != null) search.set("viewMode", String(query.viewMode));
  if (query.when) search.set("when", query.when);
  if (query.binding) search.set("binding", JSON.stringify(query.binding));
  if (query.deferSignals) search.set("deferSignals", "true");
  const response = await daemonFetch(`${daemonBaseUrl()}/api/inspector/flag?${search.toString()}`, {
    cache: "no-store",
    signal,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`inspector flag request failed: ${response.status} ${detail}`);
  }
  return (await response.json()) as InspectorFlagPayload;
}

// ---------------------------------------------------------------------------
// Inspector Zone B — fixed Valens significations + pack alerts.
// GET /api/inspector/passages (server.py:289) · GET /api/inspector/alerts
// (server.py:325). The daemon (inspector_zone_b_service.py) reuses Zone A's
// chart identity + region-building, so the signification keys off the SAME
// region the Zone-A payload does; alerts key off the chart identity + an
// explicit lens. All source/citation/alert text passes through verbatim from CorpusDB /
// rule_engine — the skin renders it and computes/fabricates nothing. Spec:
// doc/migration/surfaces/inspector-zone-b.md.
// ---------------------------------------------------------------------------

/** A flattened CorpusDB section — inspector_zone_b_service._section_to_passage
 * (inspector_zone_b_service.py:47-80). Source label + citation are synthesised
 * by the bridge; every other field is the raw section, passed through verbatim
 * (never fabricate/mutate — memory feedback_corpus_no_hallucination.md). */
export type InspectorPassageSection = {
  source: string; // fixed "Valens, Anthologies 0.7"
  citation: string; // "Anthologies <book>.<chapter>" + Kroll/Pingree page anchors
  citation_label?: string | null; // wx QuoteTextPane-style citation line
  citation_runs?: InspectorPassageRun[];
  heading: string | null; // section heading (e.g. "[Sun]")
  book: number | null;
  book_title: string | null;
  chapter: number | null;
  chapter_title: string | null;
  kroll_page: number | null;
  pingree_page: number | null;
  tags: string[];
  text: string; // the passage prose (verbatim source, with parser markup)
  paragraphs?: InspectorPassageParagraph[];
  // Styled runs mirroring the wx desktop's corpuspane rendering: cleaned text
  // segmented into italic / bold / editorial / Morinus-glyph spans
  // (inspector_zone_b_service.py → corpus_text.styled_runs). Render these to get
  // desktop-parity formatting; fall back to `text` if absent.
  runs?: InspectorPassageRun[];
  footnotes: string[];
  editorial_notes: string[];
};

export type InspectorPassageParagraph = {
  label?: string | null;
  text: string;
  runs?: InspectorPassageRun[];
  bullet?: boolean;
};

/** One styled span of a passage's prose. `kind` selects the styling; `glyph`
 * runs carry Morinus PUA chars and must render in the 'AriesMorinus' font.
 * Mirrors corpus_text.TextRun / corpuspane._RUN_* run kinds. */
export type InspectorPassageRun = {
  kind: "normal" | "glyph" | "editorial" | "italic" | "bold";
  text: string;
};

/** GET /api/inspector/passages payload. `packId` is null when passive source
 * content is disabled; `section` is null when the active pack has no passage
 * for this target. */
export type InspectorPassagesPayload = {
  region: { kind: string; object_id: string | number | null };
  packId: string | null;
  section: InspectorPassageSection | null;
};

export type LillyRecoveryPlace = {
  role?: string;
  pid?: number;
  name?: string;
  longitude: number;
  sign: number;
  modality: "movable" | "fixed" | "common" | "unresolved";
  house: number | null;
  house_class: "angular" | "succedent" | "cadent" | "unresolved";
  speed?: number | null;
  projection_method?: string;
};

export type LillyRecoveryTimingSource = {
  rule_id?: string;
  pack?: string | null;
  cite?: string;
  grade?: "recovery" | "hope" | string;
  mode?: "body_pair" | "fixed_point" | "translation_final_leg" | string;
};

export type LillyRecoveryTimingUnit =
  | "hours" | "days" | "weeks" | "months" | "years";

export type LillyRecoveryTimingPlaceBasis =
  | "both_candidates" | "current_place" | "perfection_place";

export type LillyRecoveryTimingWitness = {
  schema: "lilly.recovery-perfection.v2" | string;
  status: "timed";
  grade: "recovery" | "hope" | string;
  event_kind: string;
  exact_jd: number;
  days: number;
  arc: number;
  angle: number;
  actor_pid: number | null;
  target_pid: number | null;
  party_pids: number[];
  applicator_pids: number[];
  actor_basis: string;
  boundary: string;
  method: string;
  participants: Array<{
    pid: number;
    name: string;
    role: string;
    is_applicator: boolean;
    closing_contribution: number;
    current: LillyRecoveryPlace;
    perfection: LillyRecoveryPlace;
    motion: Record<string, unknown>;
  }>;
  endpoint: (LillyRecoveryPlace & {
    kind: string;
    label?: string | null;
    fixed: true;
  }) | null;
  current_places: Record<string, LillyRecoveryPlace>;
  perfection_places: Record<string, LillyRecoveryPlace>;
  house_frame: string;
  unit_candidates: LillyRecoveryTimingUnit[];
  all_unit_candidates: LillyRecoveryTimingUnit[];
  unit_candidates_by_basis: Record<string, unknown>;
  unit_candidates_by_place_basis: Record<
    LillyRecoveryTimingPlaceBasis,
    LillyRecoveryTimingUnit[]
  >;
  modifiers: string[];
  symbolic: {
    arc_degrees: number;
    unit_candidates: LillyRecoveryTimingUnit[];
    all_unit_candidates: LillyRecoveryTimingUnit[];
    unit_candidates_by_basis: Record<string, unknown>;
    unit_candidates_by_place_basis: Record<
      LillyRecoveryTimingPlaceBasis,
      LillyRecoveryTimingUnit[]
    >;
    modifiers: string[];
    place_basis: LillyRecoveryTimingPlaceBasis;
    requested_place_basis: string;
    place_basis_origin: "default" | "saved_context" | "invalid_context_fallback";
    requested_unit: "unselected" | LillyRecoveryTimingUnit | string;
    unit_origin: "default" | "saved_context" | "invalid_context_fallback";
    selection: "selected" | "unselected";
    selection_reason:
      | "unit_not_selected"
      | "invalid_requested_unit"
      | "requested_unit_not_supported_by_selected_place_basis"
      | "selected_from_source_candidates"
      | string;
    selected_unit: LillyRecoveryTimingUnit | null;
    amount: number | null;
  };
  provenance: {
    doctrine: string;
    bound_event: "current_exact" | "future_perfection" | string;
    sources?: LillyRecoveryTimingSource[];
  };
  source_rule_ids?: string[];
};

export type LillyRecoveryTimingAggregate = {
  schema: "lilly.recovery-aggregate.v2" | string;
  state: "none" | "all_witnesses" | "unique" | "co_earliest";
  strongest_grade: "recovery" | "hope" | string | null;
  earliest_physical_exact_jd: number | null;
  selected_exact_jd: number | null;
  selected_witnesses: LillyRecoveryTimingWitness[];
  alternates: LillyRecoveryTimingWitness[];
  witnesses: LillyRecoveryTimingWitness[];
  selection_policy:
    | "all_witnesses"
    | "earliest_physical"
    | "recovery_before_hope_then_earliest"
    | string;
  requested_selection_policy: string;
  selection_policy_origin:
    | "default" | "saved_context" | "invalid_context_fallback"
    | "legacy_api_alias";
  selection_authority: "source_neutral" | "editorial";
};

/** One pack alert — rule_engine.Alert flattened (inspector_zone_b_service.py:83-92).
 * status drives the status-dot colour; glyph is a Morinus char (sign lowercase
 * / planet keyword); pack is the authoring pack id (null == legacy inline). */
export type InspectorAlert = {
  status: "good" | "caution" | "avoid" | string | null;
  glyph: string; // Morinus glyph char (or "")
  title: string;
  /** Stable localization key; `title` remains the authored fallback. */
  titleKey?: string | null;
  body: string;
  /** Stable localization key; `body` remains the authored fallback. */
  bodyKey?: string | null;
  cite: string;
  pack: string | null;
  /** Verdict, non-voting condition/finding, source note, or another authored record kind. */
  kind: string;
  ruleId: string | null;
  /** Compact recomputable proof token supplied by the semantic engine. */
  evidence: string;
  /** Computed method/timing explanation kept separate from source-facing prose. */
  technicalDetails?: string;
  /** Physical perfection clocks supplied by this exact authored rule. */
  timingWitnesses: LillyRecoveryTimingWitness[];
};

/** GET /api/inspector/alerts payload (inspector_zone_b_service.py:214-219).
 * Empty `alerts` + null lens is a valid result (no lens / lens yields nothing). */
export type InspectorAlertsPayload = {
  alerts: InspectorAlert[];
  discipline: string | null;
  theme: string | null;
  context: Record<string, unknown> | null;
  /** Deduplicated physical clocks plus the bounded saved symbolic reading. */
  recoveryTiming: LillyRecoveryTimingAggregate | null;
  /** Packs shipping rules for the discipline — the wx pack-tag gate shows a
   * card's pack id only when this is > 1 (workspace_shell.py:2660-2669). */
  packCount?: number;
};

/** Query for Zone B passages — the SAME region identity Zone A uses, plus the
 * chart identity. Mirrors the route signature (server.py:289-300). */
export type InspectorPassagesQuery = InspectorRegionQuery & {
  maxResults?: number;
};

/** Fetch passive corpus-pack content for a hovered region (Zone B B1/B2). */
export async function fetchPassages(
  query: InspectorPassagesQuery,
  signal?: AbortSignal,
): Promise<InspectorPassagesPayload> {
  const search = new URLSearchParams({ kind: query.kind, objectId: query.objectId, name: query.name });
  if (query.docId) search.set("docId", query.docId);
  if (query.hereNow) search.set("hereNow", "true");
  if (query.chartRole) search.set("chartRole", query.chartRole);
  if (query.ringIndex != null) search.set("ringIndex", String(query.ringIndex));
  if (query.supplementaryKind) search.set("supplementaryKind", query.supplementaryKind);
  if (query.comparisonName) search.set("comparisonName", query.comparisonName);
  if (query.viewMode != null) search.set("viewMode", String(query.viewMode));
  if (query.when) search.set("when", query.when);
  if (query.binding) search.set("binding", JSON.stringify(query.binding));
  if (query.maxResults != null) search.set("maxResults", String(query.maxResults));
  const response = await daemonFetch(`${daemonBaseUrl()}/api/inspector/passages?${search.toString()}`, {
    cache: "no-store",
    signal,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`passages request failed: ${response.status} ${detail}`);
  }
  return (await response.json()) as InspectorPassagesPayload;
}

/** Lens + chart identity for Zone B pack alerts. The lens (discipline/theme/
 * context) is taken as explicit params — the daemon does NOT reconstruct
 * MFrame lens-management state (server.py:325-335). */
export type InspectorAlertsQuery = {
  discipline?: string; // "elections" | "horary"
  theme?: string; // UI theme label (e.g. "Traveling")
  context?: Record<string, unknown>; // horary significator houses (optional)
  /** Live session document id — resolves the chart from session truth; the
   * only path that works for session-only charts (edited/unsaved/derived)
   * whose name-based file lookup 404s (inspector_service.resolve_chart). */
  docId?: string;
  name: string;
  source?: string;
  hereNow?: boolean;
  chartRole?: string; // "outer" → resolve the flag against the comparison chart (biwheel/synastry/transit)
  supplementaryKind?: string;
  viewMode?: number;
  when?: string;
  binding?: SupplementaryBindingPayload;
};

/** Fetch the active-lens pack alerts for a chart (Zone B B3). Omitting
 * discipline/theme returns an empty alert list (valid). */
export async function fetchAlerts(
  query: InspectorAlertsQuery,
  signal?: AbortSignal,
): Promise<InspectorAlertsPayload> {
  const search = new URLSearchParams({ name: query.name });
  if (query.discipline) search.set("discipline", query.discipline);
  if (query.theme) search.set("theme", query.theme);
  if (query.context) search.set("context", JSON.stringify(query.context));
  if (query.docId) search.set("docId", query.docId);
  if (query.source) search.set("source", query.source);
  if (query.hereNow) search.set("hereNow", "true");
  if (query.chartRole) search.set("chartRole", query.chartRole);
  if (query.supplementaryKind) search.set("supplementaryKind", query.supplementaryKind);
  if (query.viewMode != null) search.set("viewMode", String(query.viewMode));
  if (query.when) search.set("when", query.when);
  if (query.binding) search.set("binding", JSON.stringify(query.binding));
  const response = await daemonFetch(`${daemonBaseUrl()}/api/inspector/alerts?${search.toString()}`, {
    cache: "no-store",
    signal,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`alerts request failed: ${response.status} ${detail}`);
  }
  return (await response.json()) as InspectorAlertsPayload;
}

/** One theme of an interpretation discipline (GET /api/corpus/disciplines).
 * `defaultContext` contains chart/question facts only and is forwarded into
 * the lens verbatim. Scoped global-doctrine fields remain in `contextOptions`
 * solely so Settings can show the choices relevant to this theme; their values
 * live in the daemon doctrine store and never enter the lens context. */
export type CorpusDisciplineTheme = {
  label: string;
  aliases: string[];
  tooltip: string;
  defaultContext: Record<string, unknown> | null;
  contextOptions: Array<{
    key: string;
    contextKey: string;
    scope: "global_doctrine" | "question_fact";
    preferenceKey?: string;
    labelKey: string;
    options: Array<{ value: string; labelKey: string }>;
  }>;
};

/** One registered interpretation discipline (rule_engine.registered_disciplines). */
export type CorpusDiscipline = {
  slug: string;
  displayName: string;
  themes: CorpusDisciplineTheme[];
};

export type CorpusDisciplinesPayload = { disciplines: CorpusDiscipline[] };

/** Fetch the discipline/theme catalog for the inspector lens picker
 * (workspace_shell.py:2441-2454 pickers; daemon catalog, no hardcoded labels). */
export async function fetchCorpusDisciplines(
  signal?: AbortSignal,
): Promise<CorpusDisciplinesPayload> {
  const response = await daemonFetch(`${daemonBaseUrl()}/api/corpus/disciplines`, {
    cache: "no-store",
    signal,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`corpus disciplines request failed: ${response.status} ${detail}`);
  }
  return (await response.json()) as CorpusDisciplinesPayload;
}

// The catalog is gated by the active Corpus Packs filter (a theme appears only
// while some active pack ships rules for it), so it CHANGES when a pack is
// toggled. One shared in-flight fetch is cached, but the cache is invalidated
// on pack toggles via invalidateCorpusDisciplines() so the lens picker re-pulls
// the now-filtered catalog.
let corpusDisciplinesPromise: Promise<CorpusDisciplinesPayload> | null = null;
export function corpusDisciplinesCached(): Promise<CorpusDisciplinesPayload> {
  if (!corpusDisciplinesPromise) {
    corpusDisciplinesPromise = fetchCorpusDisciplines().catch((err) => {
      corpusDisciplinesPromise = null;
      throw err;
    });
  }
  return corpusDisciplinesPromise;
}
/** Drop the cached discipline/theme catalog so the next read re-fetches it.
 * Called after a Corpus Packs toggle (the catalog is pack-gated). */
export function invalidateCorpusDisciplines(): void {
  corpusDisciplinesPromise = null;
}

/** One corpus rule pack — corpus_loader.Pack manifest metadata verbatim
 * (corpus_loader.py:43-56) + the active-filter flag (rule_engine.py:91-106). */
export type CorpusPack = {
  id: string;
  name: string;
  era: string;
  short_label: string;
  disciplines: string[];
  active: boolean;
};

/** GET/POST /api/corpus/packs payload. `active_pack_ids` null == all active. */
export type CorpusPacksPayload = {
  packs: CorpusPack[];
  active_pack_ids: string[] | null;
};

export type CorpusSemanticProfileSemantics = Partial<{
  house_frame: string;
  aspect_frame: string;
  point_frame: string;
  orb_policy: string;
  point_orb_policy: string;
  dignity_frame: string;
  solar_condition_profile: string;
}>;

export type CorpusSemanticProfile = {
  id: string;
  name: string | null;
  custom: boolean;
  active: boolean;
  semantics: CorpusSemanticProfileSemantics;
};

export type CorpusDoctrineOptionDefinition = {
  key: string;
  contextKey: string;
  labelKey: string;
  options: Array<{ value: string; labelKey: string }>;
  occurrences: Array<{
    discipline: string;
    theme: string;
    contextKey: string;
    defaultValue?: unknown;
  }>;
  value?: string | null;
};

export type CorpusDoctrinePreferences = {
  preferences: Record<string, string>;
  options: CorpusDoctrineOptionDefinition[];
};

export type CorpusSemanticProfilesPayload = {
  profiles: CorpusSemanticProfile[];
  active_profile_id: string;
  doctrine: CorpusDoctrinePreferences;
};

export async function fetchCorpusSemanticProfiles(
  signal?: AbortSignal,
): Promise<CorpusSemanticProfilesPayload> {
  const response = await daemonFetch(`${daemonBaseUrl()}/api/corpus/semantics`, {
    cache: "no-store",
    signal,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`corpus semantics request failed: ${response.status} ${detail}`);
  }
  return (await response.json()) as CorpusSemanticProfilesPayload;
}

export async function setCorpusSemanticProfile(
  profileId: string,
): Promise<CorpusSemanticProfilesPayload> {
  const response = await daemonFetch(`${daemonBaseUrl()}/api/corpus/semantics/active`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ profile_id: profileId }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`corpus semantics update failed: ${response.status} ${detail}`);
  }
  return (await response.json()) as CorpusSemanticProfilesPayload;
}

/** Persist global corpus doctrine overrides. A null value clears the override
 * and restores each source/theme's authored default for that doctrine key. */
export async function patchCorpusDoctrinePreferences(
  preferences: Record<string, string | null>,
): Promise<CorpusSemanticProfilesPayload> {
  const response = await daemonFetch(`${daemonBaseUrl()}/api/corpus/semantics/doctrine`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ preferences }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`corpus doctrine update failed: ${response.status} ${detail}`);
  }
  return (await response.json()) as CorpusSemanticProfilesPayload;
}

export async function upsertCustomCorpusSemanticProfile(definition: {
  profileId: string;
  name?: string | null;
  semantics: CorpusSemanticProfileSemantics;
  activate?: boolean;
}): Promise<CorpusSemanticProfilesPayload> {
  const response = await daemonFetch(`${daemonBaseUrl()}/api/corpus/semantics/custom`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      profile_id: definition.profileId,
      name: definition.name ?? null,
      semantics: definition.semantics,
      activate: definition.activate ?? false,
    }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`custom corpus semantics update failed: ${response.status} ${detail}`);
  }
  return (await response.json()) as CorpusSemanticProfilesPayload;
}

export async function deleteCustomCorpusSemanticProfile(
  profileId: string,
): Promise<CorpusSemanticProfilesPayload> {
  const response = await daemonFetch(
    `${daemonBaseUrl()}/api/corpus/semantics/custom/${encodeURIComponent(profileId)}`,
    { method: "DELETE" },
  );
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`custom corpus semantics delete failed: ${response.status} ${detail}`);
  }
  return (await response.json()) as CorpusSemanticProfilesPayload;
}

/** List corpus rule packs (optionally scoped to a discipline, matching the wx
 * toggle strip's packs_for_discipline scope, workspace_shell.py:2472). */
export async function fetchCorpusPacks(
  discipline?: string | null,
  signal?: AbortSignal,
): Promise<CorpusPacksPayload> {
  const search = new URLSearchParams();
  if (discipline) search.set("discipline", discipline);
  const qs = search.toString();
  const response = await daemonFetch(`${daemonBaseUrl()}/api/corpus/packs${qs ? `?${qs}` : ""}`, {
    cache: "no-store",
    signal,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`corpus packs request failed: ${response.status} ${detail}`);
  }
  return (await response.json()) as CorpusPacksPayload;
}

/** Flip one pack on/off (wx _on_pack_toggled, workspace_shell.py:2558). The
 * daemon owns the preserve-others / collapse-to-all semantics + persistence. */
export async function setCorpusPackActive(
  packId: string,
  active: boolean,
  discipline?: string | null,
): Promise<CorpusPacksPayload> {
  const response = await daemonFetch(`${daemonBaseUrl()}/api/corpus/packs/active`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pack_id: packId, active, discipline: discipline ?? null }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`corpus pack toggle failed: ${response.status} ${detail}`);
  }
  return (await response.json()) as CorpusPacksPayload;
}

export type ChartListEntry = {
  index: number;
  name: string;
  date: string;
  time: string;
  place: string;
};

/** List chart entries for a .jsonl collection. `source` is a collection path
 * (from `listCollections().path`); omit it for the default Hors source. */
export async function fetchChartList(
  source?: string,
  signal?: AbortSignal,
): Promise<ChartListEntry[]> {
  const search = new URLSearchParams();
  if (source) search.set("source", source);
  const query = search.toString();
  const response = await daemonFetch(
    `${daemonBaseUrl()}/api/charts${query ? `?${query}` : ""}`,
    { cache: "no-store", signal },
  );
  if (!response.ok) {
    throw new Error(`chart list request failed: ${response.status}`);
  }
  const body = (await response.json()) as { charts: ChartListEntry[] };
  return body.charts ?? [];
}

// ---------------------------------------------------------------------------
// Chart editor (Personal Data) + JSONL collections.
// POST /api/editor/build · GET /api/editor/resolve-place · POST /api/editor/save
// · GET /api/collections. Oracle: personaldatadlg.py. Spec:
// doc/migration/surfaces/chart-editor.md (§5 daemon, §7 form layout). The daemon
// constructs charts on the canonical chartfile path; the form ships the
// personaldatadlg apply() field set verbatim — never re-derives chart math here.
// ---------------------------------------------------------------------------

/** The editor field set — personaldatadlg's apply() values, DMS + radios form. */
export type EditorFields = {
  id?: string;
  name?: string;
  male?: boolean | null;
  type?: string; // "radix" | wx enum index
  year?: number;
  month?: number;
  day?: number;
  hour?: number;
  minute?: number;
  second?: number;
  bc?: boolean;
  cal?: string; // "gregorian" | "julian"
  zt?: string; // "zone" | "greenwich" | "lmt" | "lat"
  lonDeg?: number;
  lonMin?: number;
  lonSec?: number;
  east?: boolean;
  latDeg?: number;
  latMin?: number;
  latSec?: number;
  north?: boolean;
  // Signed decimal degrees (E/N positive). When present the daemon prefers
  // these over the DMS fields, so a map/search-pick keeps full precision.
  lat?: number;
  lon?: number;
  place?: string;
  altitude?: number;
  plus?: boolean;
  zoneHour?: number;
  zoneMin?: number;
  daylightSaving?: boolean;
  tzauto?: boolean;
  tzid?: string;
  notes?: string;
};

// ---------------------------------------------------------------------------
// Editor meta — enum catalogs + canonical defaults. The daemon owns the option
// lists (mtexts.{typeList,calList,zoneList}) and the seed values
// (engine `now` + Male/Radix plus the saved Aries Default Location). The skin
// renders the form from this and never hardcodes enums or seeds from the browser
// clock. Spec: doc/migration/surfaces/chart-editor.md.
// ---------------------------------------------------------------------------

export type EditorEnumOption = { value: string; label: string };

/** Canonical editor field defaults — same shape the form holds, daemon-seeded. */
export type EditorDefaults = {
  name: string;
  male: boolean;
  type: string;
  bc: boolean;
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  lonDeg: number;
  lonMin: number;
  lonSec: number;
  east: boolean;
  latDeg: number;
  latMin: number;
  latSec: number;
  north: boolean;
  // Authoritative signed decimals from the saved Default Location or a loaded
  // record; preserved verbatim on edit + save.
  lat?: number;
  lon?: number;
  place: string;
  cal: string;
  zt: string;
  plus: boolean;
  zoneHour: number;
  zoneMin: number;
  daylightSaving: boolean;
  tzauto: boolean;
  tzid: string;
  altitude: number;
  notes: string;
};

export type EditorMeta = {
  chartTypes: EditorEnumOption[];
  calendars: EditorEnumOption[];
  zoneTypes: EditorEnumOption[];
  calendarAutoPolicy: {
    cutover: { year: number; month: number; day: number };
    before: string;
    from: string;
  };
  defaults: EditorDefaults;
};

/** Fetch the editor enum catalogs + canonical defaults (daemon-owned). */
export async function fetchEditorMeta(signal?: AbortSignal): Promise<EditorMeta> {
  const response = await daemonFetch(`${daemonBaseUrl()}/api/editor/meta`, {
    cache: "no-store",
    signal,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`editor meta failed: ${response.status} ${detail}`);
  }
  return (await response.json()) as EditorMeta;
}

/** A loaded existing chart in the editor's form-field shape (the same set
 * `EditorDefaults` carries) PLUS its record `id` — so the editor prefills the
 * form and a save overwrites by id rather than creating a duplicate. Returned
 * by GET /api/editor/load (editor_service.record_to_editor_fields). */
export type EditorRecord = EditorDefaults & {
  id: string;
  /** True/False/None — None means "no gender" (preserved from the record). */
  male: boolean | null;
};

export type EditorLoadResult = { fields: EditorRecord; collection: string };

/** Load an existing chart record (by name within a collection) into the editor's
 * form-field shape + its record id. `source` is a collection .jsonl path (the
 * radix doc's fpath); omit it for the default Hors source. The daemon resolves
 * the record the same way the open path does (export_chart_json.load_chart:
 * first record whose `name` matches), then maps it to form fields via the
 * canonical chartfile reversers — the skin never re-parses the record. */
export async function fetchEditorRecord(
  name: string,
  source?: string,
  signal?: AbortSignal,
): Promise<EditorLoadResult> {
  const search = new URLSearchParams({ name });
  if (source) search.set("source", source);
  const response = await daemonFetch(`${daemonBaseUrl()}/api/editor/load?${search.toString()}`, {
    cache: "no-store",
    signal,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`editor load failed: ${response.status} ${detail}`);
  }
  return (await response.json()) as EditorLoadResult;
}

/** Load an OPEN radix document's current live chart into the editor form. This
 * is the dirty-safe path: it reads daemon session truth, not stale JSONL. */
export async function fetchEditorRadixSeed(
  docId: string,
  signal?: AbortSignal,
): Promise<EditorLoadResult> {
  const search = new URLSearchParams({ docId });
  const response = await daemonFetch(`${daemonBaseUrl()}/api/editor/radix-seed?${search.toString()}`, {
    cache: "no-store",
    signal,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`editor radix seed failed: ${response.status} ${detail}`);
  }
  return (await response.json()) as EditorLoadResult;
}

export type EditorBuildResult = {
  record: Record<string, unknown>;
  snapshot: ChartRenderSnapshot;
};

/** Construct a chart from editor fields on the canonical path and return its
 * export snapshot (live preview, no save). */
export async function editorBuild(
  fields: EditorFields,
  signal?: AbortSignal,
): Promise<EditorBuildResult> {
  const response = await daemonFetch(`${daemonBaseUrl()}/api/editor/build`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({ fields }),
    signal,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`editor build failed: ${response.status} ${detail}`);
  }
  return (await response.json()) as EditorBuildResult;
}

/**
 * A place candidate already in editor-form-field shape. The daemon performs the
 * deg/min split + sign→E/W·N/S + name cap(20) + altitude clamp(≥0) + GMT offset
 * split that personaldatadlg._applyGeoPlace does (personaldatadlg.py:644), so the
 * skin only assigns these fields onto the form. `label`/`countryName` are
 * display-only for the picker list.
 */
export type PlaceCandidate = {
  name: string; // persisted place value (≤20)
  lonDeg: number;
  lonMin: number;
  lonSec: number;
  east: boolean;
  latDeg: number;
  latMin: number;
  latSec: number;
  north: boolean;
  // Geonames' native signed decimals — the authoritative full-precision value
  // a pick forwards, so a search-pick matches a map-pick to six decimals.
  lat: number;
  lon: number;
  altitude: number; // ≥0
  plus: boolean;
  zoneHour: number;
  zoneMin: number;
  daylightSaving?: boolean;
  tzid: string;
  label: string; // display-only (full place name)
  countryCode: string;
  countryName: string;
};

/** City candidates (already form-shaped) for a typed query (>= 3 chars) — the
 * dialog's place search (personaldatadlg.py:606). */
export async function resolvePlace(
  query: string,
  signal?: AbortSignal,
): Promise<PlaceCandidate[]> {
  const search = new URLSearchParams({ q: query });
  const response = await daemonFetch(`${daemonBaseUrl()}/api/editor/resolve-place?${search.toString()}`, {
    cache: "no-store",
    signal,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`resolve-place failed: ${response.status} ${detail}`);
  }
  const body = (await response.json()) as { candidates: PlaceCandidate[] };
  return body.candidates ?? [];
}

export type EditorSaveResult = {
  ok: boolean;
  id: string;
  collection: string;
  recordIndex: number | null;
};

/** Upsert a chart (editor fields, matched by id) into a .jsonl collection via
 * the canonical chartfile writer. `collection` defaults to the Hors source. */
export async function editorSave(
  params: { collection?: string | null; record: EditorFields },
  signal?: AbortSignal,
): Promise<EditorSaveResult> {
  const response = await daemonFetch(`${daemonBaseUrl()}/api/editor/save`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({ collection: params.collection ?? null, record: params.record }),
    signal,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`editor save failed: ${response.status} ${detail}`);
  }
  return (await response.json()) as EditorSaveResult;
}

// Session-cursor edit lane (morin.py:14821-14872). When `onData` would edit a
// transit/SR/return/progression child's STEPPING ANCHOR rather than a stored
// radix, the editor seeds from the cursor and writes back to the cursor chart
// (re-derived through the canonical Binding -> Deriver -> Chart path) — it does
// NOT save a .jsonl record. Spec: doc/migration/wiring/chart-editor.md §4.

/** Cursor-editor seed: the editor's form fields seeded from a document's live
 * stepping cursor, plus the lock-type flag + the stepping-anchor hint. For a
 * non-cursor document the daemon returns `{usesSessionCursor:false}` and the
 * skin takes the stored-radix CREATE/EDIT path. */
export type EditorCursorSeed = {
  usesSessionCursor: boolean;
  fields?: EditorRecord;
  lockChartType?: boolean;
  timeContextHint?: string;
};

/** Ask the daemon whether editing `docId` edits its session cursor, and if so
 * the seed fields + lock/hint (GET /api/editor/cursor-seed). */
export async function fetchEditorCursorSeed(
  docId: string,
  signal?: AbortSignal,
): Promise<EditorCursorSeed> {
  const search = new URLSearchParams({ docId });
  const response = await daemonFetch(`${daemonBaseUrl()}/api/editor/cursor-seed?${search.toString()}`, {
    cache: "no-store",
    signal,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`cursor-seed failed: ${response.status} ${detail}`);
  }
  return (await response.json()) as EditorCursorSeed;
}

/** Apply edited fields back to a document's session-cursor chart
 * (POST /api/editor/apply-cursor). The daemon re-derives the cursor chart and
 * broadcasts session.changed + documents.changed; no .jsonl write happens. */
export async function editorApply(
  docId: string,
  fields: EditorFields,
  signal?: AbortSignal,
): Promise<{ ok: boolean; saved: boolean; name: string }> {
  const response = await daemonFetch(`${daemonBaseUrl()}/api/editor/apply`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({ docId, fields }),
    signal,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`editor apply failed: ${response.status} ${detail}`);
  }
  return (await response.json()) as { ok: boolean; saved: boolean; name: string };
}

export async function editorApplyCursor(
  docId: string,
  fields: EditorFields,
  signal?: AbortSignal,
): Promise<{ ok: boolean; docId: string }> {
  const response = await daemonFetch(`${daemonBaseUrl()}/api/editor/apply-cursor`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({ docId, fields }),
    signal,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`apply-cursor failed: ${response.status} ${detail}`);
  }
  return (await response.json()) as { ok: boolean; docId: string };
}

export type ChartCollection = {
  path: string;
  name: string;
  count: number;
  isDefault: boolean;
};

export type ChartPickerRow = {
  key: string;
  source: string;
  recordIndex: number;
  chartId: string;
  name: string;
  date: string;
  time: string;
  type: string;
  place: string;
  gender: string;
  collection: string;
  modified: string;
  lastOpened: string;
  recentRank: number;
};

export type ChartPickerRowsPayload = {
  directory: string;
  columns: string[];
  defaultSort: { column: keyof ChartPickerRow; ascending: boolean };
  rows: ChartPickerRow[];
};

export type ImportKind = "hor_folder" | "jsonl" | "sfcht" | "aaf";
export type ExportKind = "auto" | "png" | "pdf";

export type ImportSummary = {
  ok: boolean;
  kind: ImportKind;
  selectedPaths: string[];
  destinationCollectionPath: string;
  destinationCollectionName: string;
  importedCount: number;
  skippedDuplicateCount: number;
  skippedDuplicates: string[];
  errors: { path: string; message: string }[];
  filesConsidered: number;
};

export type ExportSummary = {
  ok: boolean;
  kind: Exclude<ExportKind, "auto">;
  path: string;
  bytes: number;
  documentId: string;
};

export type StartupChartRef = {
  label?: string;
  path?: string;
  chart_id?: string;
  chart_name?: string;
  chart_date?: string;
  chart_time?: string;
  chart_place?: string;
  compound_kind?: string;
  participants?: StartupChartRef[];
  composite_variant?: string;
};

export type StartupRestoreState = {
  startupRef: StartupChartRef | string;
  restoreOpenCharts: {
    enabled: boolean;
    refs: StartupChartRef[];
    activeRef: StartupChartRef;
  };
  canSetStartup: boolean;
};

export async function fetchChartPickerRows(
  signal?: AbortSignal,
): Promise<ChartPickerRowsPayload> {
  await waitForDaemonStartup(signal);
  const startedAt = perfNow();
  const response = await daemonFetch(`${daemonBaseUrl()}/api/chart-picker/rows`, {
    cache: "no-store",
    signal,
  });
  const headersAt = perfNow();
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`chart picker rows failed: ${response.status} ${detail}`);
  }
  const text = await response.text();
  const bodyAt = perfNow();
  const payload = JSON.parse(text) as ChartPickerRowsPayload;
  const parsedAt = perfNow();
  recordChartPerf("chart-picker-rows", {
    rows: payload.rows.length,
    bytes: approxUtf8Bytes(text),
    fetchMs: headersAt - startedAt,
    bodyMs: bodyAt - headersAt,
    parseMs: parsedAt - bodyAt,
    totalMs: parsedAt - startedAt,
  });
  return payload;
}

export type ChartPickerChoice = {
  value: string;
  label: string;
};

export type ChartPickerSearchCatalog = {
  objects: ChartPickerChoice[];
  signs: ChartPickerChoice[];
  houses: ChartPickerChoice[];
  motions: ChartPickerChoice[];
  aspects: ChartPickerChoice[];
  defaultStationWindowDays: number;
};

export type ChartPickerPlacementClause = {
  objectIds: string[];
  signIndices: string[];
  degree: string;
  degreeOrb: string;
  houseNumbers: string[];
  motion: string;
};

export type ChartPickerAspectClause = {
  objectAIds: string[];
  aspectType: string;
  objectBIds: string[];
  orb: string;
};

export type ChartPickerSearchPayload = {
  stationWindowDays: string;
  placements: ChartPickerPlacementClause[];
  aspects: ChartPickerAspectClause[];
};

export type ChartPickerSearchRow = {
  key: string;
  source: string;
  recordIndex: number;
  name: string;
  date: string;
  time: string;
  type: string;
  collection: string;
  place: string;
  matches: string;
  matchRuns?: ChartPickerMatchRun[][];
  matchSortValue?: number | null;
};

export type ChartPickerMatchRun = {
  kind: "text" | "glyph";
  text: string;
  title?: string;
  color?: string;
  colorRole?: string | null;
};

export type ChartPickerSearchResult = {
  summary: {
    scanned: number;
    matched: number;
    errors: number;
    truncated: boolean;
  };
  columns: string[];
  rows: ChartPickerSearchRow[];
};

export async function fetchChartPickerSearchCatalog(
  signal?: AbortSignal,
): Promise<ChartPickerSearchCatalog> {
  const response = await daemonFetch(`${daemonBaseUrl()}/api/chart-picker/search-catalog`, {
    cache: "no-store",
    signal,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`chart picker search catalog failed: ${response.status} ${detail}`);
  }
  return (await response.json()) as ChartPickerSearchCatalog;
}

export async function searchChartPickerRows(
  payload: ChartPickerSearchPayload,
  signal?: AbortSignal,
): Promise<ChartPickerSearchResult> {
  return workspacePost<ChartPickerSearchResult>(
    "/api/chart-picker/search",
    payload,
    signal,
  );
}

export async function renameChartPickerRow(
  row: Pick<ChartPickerRow, "source" | "recordIndex">,
  name: string,
  signal?: AbortSignal,
): Promise<{ ok: boolean; rows: ChartPickerRow[] }> {
  return workspacePost<{ ok: boolean; rows: ChartPickerRow[] }>(
    "/api/chart-picker/rename",
    { source: row.source, recordIndex: row.recordIndex, name },
    signal,
  );
}

export async function deleteChartPickerRows(
  rows: Pick<ChartPickerRow, "source" | "recordIndex">[],
  signal?: AbortSignal,
): Promise<{ ok: boolean; deleted: number; rows: ChartPickerRow[] }> {
  return workspacePost<{ ok: boolean; deleted: number; rows: ChartPickerRow[] }>(
    "/api/chart-picker/delete",
    { rows },
    signal,
  );
}

export async function moveChartPickerRows(
  rows: Pick<ChartPickerRow, "source" | "recordIndex">[],
  destination: string,
  signal?: AbortSignal,
): Promise<{ ok: boolean; moved: number; rows: ChartPickerRow[] }> {
  return workspacePost<{ ok: boolean; moved: number; rows: ChartPickerRow[] }>(
    "/api/chart-picker/move",
    { rows, destination },
    signal,
  );
}

export async function moveChartPickerRowsToNewCollection(
  rows: Pick<ChartPickerRow, "source" | "recordIndex">[],
  name: string,
  signal?: AbortSignal,
): Promise<{
  ok: boolean;
  moved: number;
  rows: ChartPickerRow[];
  collection: ChartCollection;
}> {
  return workspacePost(
    "/api/chart-picker/collections/move-to-new",
    { rows, name },
    signal,
  );
}

export async function createChartPickerCollection(
  name: string,
  signal?: AbortSignal,
): Promise<{
  ok: boolean;
  rows: ChartPickerRow[];
  collection: ChartCollection;
}> {
  return workspacePost(
    "/api/chart-picker/collections/create",
    { name },
    signal,
  );
}

export async function renameChartPickerCollection(
  source: string,
  name: string,
  signal?: AbortSignal,
): Promise<{
  ok: boolean;
  source: string;
  destination: string;
  rows: ChartPickerRow[];
  collection: ChartCollection;
}> {
  return workspacePost(
    "/api/chart-picker/collections/rename",
    { source, name },
    signal,
  );
}

export type UploadedImportFile = {
  name: string;
  dataBase64: string;
  relativePath?: string;
};

/** File -> Import route. Tauri supplies path strings; browser shells supply
 * selected file bytes. The daemon owns all HOR/JSONL/SFcht/AAF reading,
 * duplicate checks, conversion, and writes. */
export async function importCharts(
  params: {
    kind: ImportKind;
    paths: string[];
    files?: UploadedImportFile[];
    text?: string;
    collection?: string;
  },
  signal?: AbortSignal,
): Promise<ImportSummary> {
  return workspacePost<ImportSummary>("/api/io/import", params, signal);
}

/** File -> Export route. Tauri supplies the save path only; the daemon resolves
 * active session chart truth and writes PNG/PDF server-side. */
export async function exportActiveChart(
  params: { kind: ExportKind; path: string; documentId?: string },
  signal?: AbortSignal,
): Promise<ExportSummary> {
  return workspacePost<ExportSummary>("/api/io/export", params, signal);
}

export type ExportBytesSummary = {
  ok: boolean;
  kind: ExportKind;
  filename: string;
  mimeType: string;
  bytes: number;
  dataBase64: string;
  documentId?: string;
};

export async function exportActiveChartBytes(
  params: { kind: ExportKind; filename?: string; documentId?: string },
  signal?: AbortSignal,
): Promise<ExportBytesSummary> {
  return workspacePost<ExportBytesSummary>("/api/io/export-bytes", params, signal);
}

export type RenderedChartExportParams = {
  kind: "pdf" | "png";
  pngBase64: string;
  width: number;
  height: number;
  title?: string;
  documentId?: string;
};

export async function exportRenderedChart(
  params: RenderedChartExportParams & { path: string },
  signal?: AbortSignal,
): Promise<ExportSummary> {
  return workspacePost<ExportSummary>("/api/io/export-rendered", params, signal);
}

export async function exportRenderedChartBytes(
  params: RenderedChartExportParams & { filename?: string },
  signal?: AbortSignal,
): Promise<ExportBytesSummary> {
  return workspacePost<ExportBytesSummary>("/api/io/export-rendered-bytes", params, signal);
}

export type TextExportSummary = {
  ok: boolean;
  kind: string;
  path: string;
  bytes: number;
};

export async function exportTextFile(
  params: { path: string; text: string; extension?: string },
  signal?: AbortSignal,
): Promise<TextExportSummary> {
  return workspacePost<TextExportSummary>("/api/io/export-text", params, signal);
}

export type TableExportSummary = {
  ok: boolean;
  kind: "pdf";
  path: string;
  bytes: number;
};

export type TablePdfColumn = {
  /** Stable semantic column identity, used for hierarchy-aware layouts. */
  id?: string;
  label: string;
  align?: string;
  width?: number;
  glyph?: boolean;
  color?: string | null;
};

export type TablePdfRow = {
  cells: GenericTableCell[];
  emphasis?: string;
  current?: boolean;
  level?: number;
  kind?: "body" | "group" | "subordinate" | string;
};

export type TablePdfSection = {
  title?: string;
  columns: TablePdfColumn[];
  rows: TablePdfRow[];
};

/** Structured PDF-only representation. Clipboard/TXT never pass through this
 * renderer; they use the independent plain-text snapshot. */
export type TablePdfDocument = {
  profile?: "standard" | "symbolic" | "time-lord" | "directions" | "circumambulation" | "matrix" | "strip" | string;
  headerLines?: string[];
  columns?: TablePdfColumn[];
  rows?: TablePdfRow[];
  sections?: TablePdfSection[];
  matrix?: AspectMatrixPayload;
  strip?: StripPayload;
};

/** Render the structured table snapshot as a clean, selectable PDF. */
export async function exportTablePdf(
  params: {
    path: string;
    title: string;
    document: TablePdfDocument;
  },
  signal?: AbortSignal,
): Promise<TableExportSummary> {
  const response = await daemonFetch(`${daemonBaseUrl()}/api/table/export`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
    signal,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`table export failed: ${response.status} ${detail}`);
  }
  return (await response.json()) as TableExportSummary;
}

export type TableExportBytesSummary = {
  ok: boolean;
  kind: "pdf";
  filename: string;
  mimeType: string;
  bytes: number;
  dataBase64: string;
};

export async function exportTablePdfBytes(
  params: {
    filename?: string;
    title: string;
    document: TablePdfDocument;
  },
  signal?: AbortSignal,
): Promise<TableExportBytesSummary> {
  const response = await daemonFetch(`${daemonBaseUrl()}/api/table/export-bytes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
    signal,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`table export failed: ${response.status} ${detail}`);
  }
  return (await response.json()) as TableExportBytesSummary;
}

export function decodeBase64Bytes(dataBase64: string): Uint8Array {
  const binary = atob(dataBase64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export type IoSaveResult = {
  ok: boolean;
  documentId: string;
  activeDocumentId: string | null;
  path: string;
  rebound: boolean;
  documents: DaemonDocumentSummary[];
  snapshot?: ChartRenderSnapshot;
};

/** File > Save Horoscope / Save As (DEF-007 core). Omit `path` to upsert into
 * the document's bound collection; pass `path`/`collection` for Save As, which
 * creates a fresh record id and rebinds the live document to that copy. */
export async function ioSaveChart(
  params: { documentId: string; path?: string; collection?: string; name?: string },
  signal?: AbortSignal,
): Promise<IoSaveResult> {
  return workspacePost<IoSaveResult>("/api/io/save", params, signal);
}

export type QuitPreflightPrompt = {
  documentId: string;
  label: string;
  path: string;
};

export type QuitPreflightResult = {
  needsPrompt: boolean;
  promptWorthyIds: string[];
  prompts: QuitPreflightPrompt[];
};

/** App-quit guard (policy-chart-lifecycle §3; wx _confirm_discard_or_save_all_
 * dirty_sessions, morin.py:12146-12172). Returns the BOUND+DIRTY radix documents
 * the Save/Discard/Cancel modal must confirm before close. Non-destructive — the
 * native CloseRequested intercept (lib.rs) holds the close; this only reports. */
export async function quitPreflight(
  signal?: AbortSignal,
): Promise<QuitPreflightResult> {
  const response = await daemonFetch(`${daemonBaseUrl()}/api/workspace/quit-preflight`, {
    cache: "no-store",
    signal,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`quit preflight failed: ${response.status} ${detail}`);
  }
  return (await response.json()) as QuitPreflightResult;
}

export async function fetchStartupRestoreState(
  signal?: AbortSignal,
): Promise<StartupRestoreState> {
  const response = await daemonFetch(`${daemonBaseUrl()}/api/io/startup`, {
    cache: "no-store",
    signal,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`startup state failed: ${response.status} ${detail}`);
  }
  return (await response.json()) as StartupRestoreState;
}

export type AppSplashPayload = {
  title: string;
  subtitle: string;
  infoLines: string[];
  supportUrl: string;
  supportText: string;
};

export async function fetchAppSplash(signal?: AbortSignal): Promise<AppSplashPayload> {
  const response = await daemonFetch(`${daemonBaseUrl()}/api/app/splash`, {
    cache: "no-store",
    signal,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`app splash failed: ${response.status} ${detail}`);
  }
  return (await response.json()) as AppSplashPayload;
}

export async function setCurrentAsStartupChart(
  signal?: AbortSignal,
): Promise<{ ok: boolean; startupRef: StartupChartRef; state: StartupRestoreState }> {
  return workspacePost("/api/io/startup/set-current", {}, signal);
}

export async function clearStartupChart(
  signal?: AbortSignal,
): Promise<{ ok: boolean; startupRef: ""; state: StartupRestoreState }> {
  return workspacePost("/api/io/startup/clear", {}, signal);
}

export async function loadStartupOrRestoreCharts(
  signal?: AbortSignal,
): Promise<WorkspaceOpenResult & { ok: boolean; mode: string }> {
  return workspacePost("/api/io/startup/load", {}, signal);
}

export async function setRestoreOpenCharts(
  enabled: boolean,
  signal?: AbortSignal,
): Promise<{ ok: boolean; state: StartupRestoreState }> {
  return workspacePost("/api/io/restore-open", { enabled }, signal);
}

export async function saveRestoreOpenCharts(
  signal?: AbortSignal,
): Promise<{ ok: boolean; state: StartupRestoreState }> {
  return workspacePost("/api/io/restore-open/save", {}, signal);
}

export type RecentChartItem = {
  id: string;
  label: string;
  path: string;
  chartId: string;
  sourceName: string;
  compound: boolean;
  unsaved?: boolean;
  lastOpened: string;
};

/** File > Recent Charts MRU (morin.py:15716-15738). The daemon owns labels,
 * ordering, and the 12-entry menu cap (refs[:12], morin.py:15734); the skin
 * renders the list verbatim into the native submenu. */
export async function fetchRecentCharts(signal?: AbortSignal): Promise<RecentChartItem[]> {
  const response = await daemonFetch(`${daemonBaseUrl()}/api/io/recent-charts`, {
    cache: "no-store",
    signal,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`recent charts failed: ${response.status} ${detail}`);
  }
  const payload = (await response.json()) as { items: RecentChartItem[] };
  return payload.items ?? [];
}

/** Reopen a Recent Charts entry through the canonical workspace open door
 * (morin.py:15740-15778). Stale paths are removed daemon-side and reject with
 * a toast-able detail (wx FileHistory removal, morin.py:15710-15714). */
export async function openRecentChart(
  params: { id?: string; path: string; chartId?: string; label?: string },
  signal?: AbortSignal,
): Promise<WorkspaceOpenResult & { ok: boolean }> {
  return workspacePost("/api/io/recent-charts/open", params, signal);
}

/** The .jsonl chart collections (default Hors + siblings), each with a count. */
export async function listCollections(signal?: AbortSignal): Promise<ChartCollection[]> {
  const response = await daemonFetch(`${daemonBaseUrl()}/api/collections`, { cache: "no-store", signal });
  if (!response.ok) {
    throw new Error(`collections request failed: ${response.status}`);
  }
  const body = (await response.json()) as { collections: ChartCollection[] };
  return body.collections ?? [];
}

// ---------------------------------------------------------------------------
// Primary Directions list + Directions-to-Solar-Revolution.
// GET /api/directions?name&range&direction · GET /api/directions/annual?name&year.
// Oracle: primdirslistwnd.py (6-column DC table). Daemon: directions_service.py.
// Spec: doc/migration/surfaces/primary-directions.md. The daemon ships rendered
// text cells (mz/prom/dc/sig/arc/date) PLUS raw engine ids and daemon-resolved
// prom/sig glyphs in `fields`; React only maps aspect ids client-side.
// ---------------------------------------------------------------------------

/** Raw engine point/aspect ids for one direction — the PrimDir id namespace
 * (primdirs.py:33-69). 0-11 = planets, 12-15 = ASC/DESC/MC/IC, then HC/LoF/etc.
 * Planet/LoF glyphs are resolved daemon-side from live symbol settings. */
export type TemporalActivationWindow = {
  startJdUt: number;
  endJdUt: number;
  endExclusive: true;
};

export type TemporalActivation = {
  activationId: string;
  pointId: string;
  planetId: number | null;
  role: string;
  basis: "exact" | "period" | "station-state" | "orb" | string;
  windows: TemporalActivationWindow[];
  colorHex?: string;
  colorRole?: string;
};

/** Additive evidence carried by a canonical row; never a replacement row. */
export type TemporalRowMeta = {
  rowId: string;
  /** Canonical row instant used to materialize this row when its activation
   * window (for example an aspect orb) is focused elsewhere in time. */
  rowAnchorJdUt?: number;
  activations: TemporalActivation[];
  relationship?: Record<string, unknown>;
  unsupportedReason?: string;
};

export type TemporalConcurrenceParticipant = {
  laneId: string;
  sourceId: string;
  rowId: string;
  activationId: string;
  pointId: string;
  planetId: number;
  role: string;
  basis: string;
  rowAnchorJdUt?: number;
  rowAnchorDatetime?: string | null;
};

export type TemporalConcurrenceGroup = {
  groupId: string;
  planetId: number;
  colorHex?: string;
  colorRole?: string;
  startJdUt: number;
  endJdUt: number;
  focusJdUt: number;
  focusDatetime: string | null;
  laneCount: number;
  participants: TemporalConcurrenceParticipant[];
};

export type TemporalConcurrenceResult = {
  groups: TemporalConcurrenceGroup[];
  minimumLanes: number;
  laneCount: number;
};

export async function resolveTemporalConcurrence(
  lanes: Array<{
    laneId: string;
    sourceId: string;
    rows: TemporalRowMeta[];
  }>,
  signal?: AbortSignal,
): Promise<TemporalConcurrenceResult> {
  return workspacePost<TemporalConcurrenceResult>(
    "/api/temporal-concurrence/resolve",
    { lanes, minimumLanes: 2 },
    signal,
  );
}

export type DirectionRowFields = {
  mundane: boolean;
  direct: boolean;
  prom: number;
  prom2: number;
  promasp: number;
  promaspOffset?: number;
  sigPoint: number;
  sigasp: number;
  sigaspOffset?: number;
  parallelaxis: number;
  arc: number;
  jd: number;
  promGlyph?: string | null;
  prom2Glyph?: string | null;
  sigGlyph?: string | null;
  promParts?: DirectionCellPart[];
  sigParts?: DirectionCellPart[];
  promAspectGlyph?: string | null;
  sigAspectGlyph?: string | null;
  promColor?: string | null;
  prom2Color?: string | null;
  sigColor?: string | null;
  promAspectColor?: string | null;
  sigAspectColor?: string | null;
  promColorRole?: string | null;
  prom2ColorRole?: string | null;
  sigColorRole?: string | null;
  promAspectColorRole?: string | null;
  sigAspectColorRole?: string | null;
  promSource?: "natal_radix" | string | null;
  promSourceMarker?: string | null;
  promSourceBodyId?: number | null;
};

export type DirectionCellPart = {
  text: string;
  glyph?: boolean;
  exportText?: string;
  exportSymbolText?: string;
  color?: string | null;
  colorRole?: string | null;
  marker?: "natal" | string;
};

/** One PD row — the six rendered cells + raw ids + a stable signature. */
export type DirectionRow = {
  mz: string;
  prom: string;
  dc: string;
  sig: string;
  sessionLabel: string;
  arc: number;
  date: string;
  displayDate?: string | null;
  age: number | null;
  fields: DirectionRowFields;
  signature: (number | boolean)[];
  temporal?: TemporalRowMeta;
};

export type DirectionCustomSignificator = {
  id: string;
  label: string;
  longitude: number;
  latitude?: number;
  only?: boolean;
  display_glyph?: string;
  display_marker?: string;
  display_segments?: Record<string, unknown>[];
  display_planet_id?: number;
};

export type CircumambulationSignificatorItem = {
  id: string;
  group: string;
  label: string;
  glyph?: string;
  marker?: string;
  customSignificator?: DirectionCustomSignificator | null;
};

export type DirectionsMeta = {
  title: string;
  columns: string[]; // [MZ, Prom, DC, Sig, Arc, Date] — wx labels verbatim
  system: string;
  key: string;
  subprimarydir: number;
  rangeMode: number;
  direction: number;
  htype: number;
  returnKind?: "solar" | "lunar" | string;
  returnDatetime?: string | null;
  returnLabel?: string | null;
  solarRevolutionYear?: number;
  solarRevolutionDatetime?: string | null;
  solarRevolutionLabel?: string;
  startAge?: number;
  endAge?: number;
  windowed?: boolean;
  listGlyphColors?: boolean;
  showNatalPromissors?: boolean;
  customSignificator?: DirectionCustomSignificator | null;
  temporalCoverage?: {
    startJdUt: number;
    endJdUt: number;
    authoritative: boolean;
  };
};

export type DirectionsAgeSeek = "exact" | "next" | "previous";

export type DirectionsPayload = {
  name: string;
  meta: DirectionsMeta;
  directions: DirectionRow[];
};

function appendCustomSignificatorQuery(
  search: URLSearchParams,
  customSignificator?: DirectionCustomSignificator | null,
) {
  if (!customSignificator) return;
  search.set("customSignificator", JSON.stringify(customSignificator));
}

function appendOptionsPreviewQuery(
  search: URLSearchParams,
  optionsPreview?: OptionsPatch | null,
) {
  if (!optionsPreview) return;
  search.set("optionsPreview", JSON.stringify(optionsPreview));
}

/** The standard Primary Directions list for a radix. range/direction default to
 * the bare list (All ages, Direct). */
export async function fetchDirections(
  name: string,
  params: {
    range?: number;
    direction?: number;
    source?: string;
    documentId?: string;
    startAge?: number;
    endAge?: number;
    seek?: DirectionsAgeSeek;
    customSignificator?: DirectionCustomSignificator | null;
    optionsPreview?: OptionsPatch | null;
    includeTemporal?: boolean;
  } = {},
  signal?: AbortSignal,
): Promise<DirectionsPayload> {
  const search = new URLSearchParams({ name });
  if (params.range != null) search.set("range", String(params.range));
  if (params.direction != null) search.set("direction", String(params.direction));
  if (params.startAge != null) search.set("startAge", String(params.startAge));
  if (params.endAge != null) search.set("endAge", String(params.endAge));
  if (params.seek) search.set("seek", params.seek);
  if (params.source) search.set("source", params.source);
  if (params.documentId) search.set("documentId", params.documentId);
  if (params.includeTemporal) search.set("includeTemporal", "true");
  appendCustomSignificatorQuery(search, params.customSignificator);
  appendOptionsPreviewQuery(search, params.optionsPreview);
  const response = await daemonFetch(`${daemonBaseUrl()}/api/directions?${search.toString()}`, {
    cache: "no-store",
    signal,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`directions request failed: ${response.status} ${detail}`);
  }
  return (await response.json()) as DirectionsPayload;
}

/** Directions to a solar/lunar revolution (annual/monthly mode). Uses a live
 * return document when documentId names one, otherwise builds around the focus
 * date and runs the PD pipeline over it (calcTimeRev). */
export async function fetchAnnualDirections(
  name: string,
  params: {
    year?: number;
    returnKind?: "solar" | "lunar";
    referenceDatetime?: string;
    range?: number;
    direction?: number;
    source?: string;
    documentId?: string;
    customSignificator?: DirectionCustomSignificator | null;
    optionsPreview?: OptionsPatch | null;
    includeTemporal?: boolean;
  } = {},
  signal?: AbortSignal,
): Promise<DirectionsPayload> {
  const search = new URLSearchParams({ name });
  if (params.year != null) search.set("year", String(params.year));
  if (params.returnKind) search.set("kind", params.returnKind);
  if (params.referenceDatetime) search.set("referenceDatetime", params.referenceDatetime);
  if (params.range != null) search.set("range", String(params.range));
  if (params.direction != null) search.set("direction", String(params.direction));
  if (params.source) search.set("source", params.source);
  if (params.documentId) search.set("documentId", params.documentId);
  if (params.includeTemporal) search.set("includeTemporal", "true");
  appendCustomSignificatorQuery(search, params.customSignificator);
  appendOptionsPreviewQuery(search, params.optionsPreview);
  const response = await daemonFetch(`${daemonBaseUrl()}/api/directions/annual?${search.toString()}`, {
    cache: "no-store",
    signal,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`annual directions request failed: ${response.status} ${detail}`);
  }
  return (await response.json()) as DirectionsPayload;
}

// ---------------------------------------------------------------------------
// Secondary / minor / tertiary directions list (secdirframe.py popup).
// GET /api/directions/secondary?name&startAge&endAge&method.
// Daemon: directions_service.SecondaryDirectionsService over the wx-free
// engine.secondary_directions search.
// ---------------------------------------------------------------------------
export type SecondaryDirectionRow = {
  age: number | null;
  date: string;
  displayDate?: string | null;
  time: string;
  motionCode?: string | null;
  isStation?: boolean;
  isIngress?: boolean;
  stationCode?: string | null;
  prom: string;
  sig: string;
  aspect: string;
  sessionLabel: string;
  fields: {
    promPlanet: number | null;
    sigPlanet: number | null;
    aspectIndex: number | null;
    promGlyph?: string | null;
    sigGlyph?: string | null;
    aspectGlyph?: string | null;
    promExportSymbolText?: string | null;
    sigExportSymbolText?: string | null;
    aspectExportSymbolText?: string | null;
    promColor?: string | null;
    sigColor?: string | null;
    aspectColor?: string | null;
    promColorRole?: string | null;
    sigColorRole?: string | null;
    aspectColorRole?: string | null;
  };
  eventDatetime: string | null;
  jd: number | null;
  temporal?: TemporalRowMeta;
};

export type SecondaryDirectionsPayload = {
  name: string;
  meta: {
    title: string;
    method: string;
    direction?: string;
    directionModes?: string[];
    conversionKey?: string;
    startAge: number;
    endAge: number;
    totalStartAge?: number;
    totalEndAge?: number | null;
    referenceAge?: number | null;
    windowed?: boolean;
    windowYears?: number;
    hasPrevious?: boolean;
    hasNext?: boolean;
    ranges: number[][];
    truncated: boolean;
    columns: string[];
    filterPlanets?: Array<{ id: number; label: string; glyph?: string | null }>;
    temporalCoverage?: {
      startJdUt: number;
      endJdUt: number;
      authoritative: boolean;
    };
  };
  directions: SecondaryDirectionRow[];
};

export async function fetchSecondaryDirections(
  name: string,
  params: {
    startAge?: number;
    endAge?: number;
    method?: string;
    direction?: string;
    source?: string;
    documentId?: string;
    referenceDatetime?: string;
    includeTemporal?: boolean;
  } = {},
  signal?: AbortSignal,
): Promise<SecondaryDirectionsPayload> {
  const search = new URLSearchParams({ name });
  if (params.startAge != null) search.set("startAge", String(params.startAge));
  if (params.endAge != null) search.set("endAge", String(params.endAge));
  if (params.method) search.set("method", params.method);
  if (params.direction) search.set("direction", params.direction);
  if (params.source) search.set("source", params.source);
  if (params.documentId) search.set("documentId", params.documentId);
  if (params.referenceDatetime) search.set("referenceDatetime", params.referenceDatetime);
  if (params.includeTemporal) search.set("includeTemporal", "true");
  const response = await daemonFetch(`${daemonBaseUrl()}/api/directions/secondary?${search.toString()}`, {
    cache: "no-store",
    signal,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`secondary directions failed: ${response.status} ${detail}`);
  }
  return (await response.json()) as SecondaryDirectionsPayload;
}

// ---------------------------------------------------------------------------
// Circumambulations through the bounds (circumambulationframe.py popup).
// GET /api/directions/circumambulation?name&useExactOa&maxAge.
// ---------------------------------------------------------------------------
export type CircumambulationRow = {
  signIndex: number | null;
  signGlyph?: string | null;
  signExportSymbolText?: string | null;
  signColor?: string | null;
  signColorRole?: string | null;
  degreeText?: string | null;
  termRulerPid: number | null;
  termRulerGlyph?: string | null;
  termRulerExportSymbolText?: string | null;
  termRulerColor?: string | null;
  termRulerColorRole?: string | null;
  dateStart: string | null;
  dateEnd: string | null;
  displayDateStart?: string | null;
  displayDateEnd?: string | null;
  ageStart: number | null;
  ageEnd: number | null;
  deltaOa: number | null;
  eventDatetime: string | null;
  sessionLabel: string;
  participating: CircumambulationParticipator[];
  temporal?: TemporalRowMeta;
};

// One participating-planet hit inside a term period. The wx CircumWnd.set_data
// (circumambulationframe.py:746-774) emits each of these as its own table row,
// with the Participator cell = aspect glyph + planet glyph and its own date/age.
export type CircumambulationParticipator = {
  planetId?: number | null;
  planet: string | null;
  planetExportSymbolText?: string | null;
  source?: "return" | "natal_radix" | string | null;
  sourceMarker?: string | null;
  planetGlyph?: string | null;
  planetColor?: string | null;
  planetColorRole?: string | null;
  degreeText?: string | null;
  degreeSignIndex?: number | null;
  degreeSignGlyph?: string | null;
  degreeSignExportSymbolText?: string | null;
  degreeSignColor?: string | null;
  degreeSignColorRole?: string | null;
  aspectGlyph?: string | null;
  aspectExportText?: string | null;
  aspectExportSymbolText?: string | null;
  aspectColor?: string | null;
  aspectColorRole?: string | null;
  aspectDegree?: number | null;
  date: string | null;
  displayDate?: string | null;
  eventDatetime?: string | null;
  sessionLabel: string;
  age: number | null;
  temporal?: TemporalRowMeta;
};

export type CircumambulationPayload = {
  name: string;
  meta: {
    title: string;
    useExactOa: boolean;
    maxAge: number;
    columns: string[];
    mode?: "radix" | "sr" | "lr" | string;
    returnKind?: string;
    returnDatetime?: string | null;
    returnLabel?: string | null;
    solarRevolutionYear?: number | null;
    ageOffset?: number;
    listGlyphColors?: boolean;
    showNatalPromissors?: boolean;
    promissorProfile?: number;
    promissorProfileName?: "follow_pd" | "traditional" | string;
    promissorCapabilities?: Record<string, string>;
    customSignificator?: DirectionCustomSignificator | null;
    significators?: CircumambulationSignificatorItem[];
    temporalCoverage?: {
      startJdUt: number;
      endJdUt: number;
      authoritative: boolean;
    };
  };
  directions: CircumambulationRow[];
};

export async function fetchCircumambulations(
  name: string,
  params: {
    useExactOa?: boolean;
    maxAge?: number;
    source?: string;
    documentId?: string;
    mode?: "radix" | "sr" | "lr";
    year?: number;
    returnKind?: "solar" | "lunar";
    referenceDatetime?: string;
    customSignificator?: DirectionCustomSignificator | null;
    promissorProfile?: number;
    includeTemporal?: boolean;
  } = {},
  signal?: AbortSignal,
): Promise<CircumambulationPayload> {
  const search = new URLSearchParams({ name });
  if (params.useExactOa != null) search.set("useExactOa", String(params.useExactOa));
  if (params.maxAge != null) search.set("maxAge", String(params.maxAge));
  if (params.mode) search.set("mode", params.mode);
  if (params.year != null) search.set("year", String(params.year));
  if (params.returnKind) search.set("kind", params.returnKind);
  if (params.referenceDatetime) search.set("referenceDatetime", params.referenceDatetime);
  if (params.source) search.set("source", params.source);
  if (params.documentId) search.set("documentId", params.documentId);
  if (params.includeTemporal) search.set("includeTemporal", "true");
  if (params.promissorProfile != null) search.set("promissorProfile", String(params.promissorProfile));
  appendCustomSignificatorQuery(search, params.customSignificator);
  const response = await daemonFetch(`${daemonBaseUrl()}/api/directions/circumambulation?${search.toString()}`, {
    cache: "no-store",
    signal,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`circumambulations failed: ${response.status} ${detail}`);
  }
  return (await response.json()) as CircumambulationPayload;
}

// ---------------------------------------------------------------------------
// Timed-chart context-menu action — opens a REAL child chart (Solar Revolution
// / Transit / Chart) for a direction-list event date.
// POST /api/directions/timed-chart. Oracle: commonwnd.add_timed_chart_menu_actions.
// ---------------------------------------------------------------------------
export type TimedChartAction = "solar" | "transits" | "chart";
export type TimedChartSourceContext = {
  sourceTechnique: string;
  symbolicWhenIso: string;
  symbolicEventJd: number | null;
};
export type EclipseChartMomentMode = "exact_conjunction" | "eclipse_maximum";

export async function openDirectionsTimedChart(
  directionsDocumentId: string,
  action: TimedChartAction,
  whenIso: string,
  eventJd?: number | null,
  timeContext?: Record<string, unknown> | null,
  sessionLabel?: string | null,
  showRadix?: boolean,
  sourceContext?: TimedChartSourceContext | null,
): Promise<WorkspaceOpenResult> {
  const response = await daemonFetch(`${daemonBaseUrl()}/api/directions/timed-chart`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      directionsDocumentId,
      action,
      whenIso,
      eventJd,
      timeContext: timeContext ?? null,
      sessionLabel: sessionLabel ?? null,
      ...(showRadix === undefined ? {} : { showRadix }),
      ...(sourceContext ?? {}),
    }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`timed-chart action failed: ${response.status} ${detail}`);
  }
  return (await response.json()) as WorkspaceOpenResult;
}

export async function fetchTimedChartShowRadixDefault(
  signal?: AbortSignal,
): Promise<{ showRadix: boolean }> {
  const response = await daemonFetch(
    `${daemonBaseUrl()}/api/options/timed-chart-show-radix-default`,
    { cache: "no-store", signal },
  );
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`timed-chart show-radix default failed: ${response.status} ${detail}`);
  }
  return (await response.json()) as { showRadix: boolean };
}

export async function setEclipseChartMoment(
  mode: EclipseChartMomentMode,
  signal?: AbortSignal,
): Promise<{ eclipseChartMoment: EclipseChartMomentMode }> {
  return workspacePost<{ eclipseChartMoment: EclipseChartMomentMode }>(
    "/api/eclipses/chart-moment",
    { mode },
    signal,
  );
}

/** Open a Primary-Directions row as a retained PD-in-Chart session. Celestial
 * uses the zodiacal compound wheel; terrestrial uses the legacy mundane-position
 * comparison while retaining the same chart cursor and step contract. */
export async function openDirectionsPdInChart(
  directionsDocumentId: string,
  arc: number,
  options?: {
    mode?: "celestial" | "terrestrial";
    direct?: boolean;
    eventJd?: number | null;
    whenIso?: string | null;
    sessionLabel?: string | null;
    directionEvent?: DirectionRowFields | null;
  },
  signal?: AbortSignal,
): Promise<WorkspaceOpenResult> {
  return workspacePost<WorkspaceOpenResult>(
    "/api/directions/pd-in-chart",
    {
      directionsDocumentId,
      arc,
      mode: options?.mode ?? "celestial",
      direct: options?.direct ?? true,
      eventJd: options?.eventJd ?? null,
      whenIso: options?.whenIso ?? null,
      sessionLabel: options?.sessionLabel ?? null,
      directionEvent: options?.directionEvent ?? null,
    },
    signal,
  );
}

/** Open/Step Secondary Chart from the secondary/minor/tertiary directions row
 * menu. The daemon resolves the view-only directions document back to its radix
 * parent, then opens a real secondary progression child at the selected row time
 * (matching secdirframe.py, where Minor/Tertiary still call SECONDARY here). */
export async function openDirectionsSecondaryChart(
  directionsDocumentId: string,
  whenIso: string,
  sessionLabel?: string | null,
  signal?: AbortSignal,
): Promise<WorkspaceOpenResult> {
  return workspacePost<WorkspaceOpenResult>(
    "/api/directions/secondary-chart",
    { directionsDocumentId, whenIso, sessionLabel: sessionLabel ?? null },
    signal,
  );
}

// ---------------------------------------------------------------------------
// Search — view-only/right-pane surface backed by the existing Python
// searchbackend engine. React owns only form state + rendering.
// ---------------------------------------------------------------------------

export type TransitSearchObject = {
  id: string;
  label: string;
  family: string;
  sourceType: string;
  longitude: number | null;
  longitudeText: string;
  planetIndex: number | null;
  canPromittor: boolean;
  canSignificator: boolean;
  glyph: string;
  glyphFont: "morinus" | "text";
  displayMarker: string;
  displaySegments: TransitSearchObjectSegment[];
  fixedstarCode?: string | null;
};

export type TransitSearchObjectSegment = {
  text: string;
  kind: "text" | "planet" | "glyph";
  seId?: number;
};

export type TransitSearchAspect = {
  id: string;
  label: string;
  glyph: string;
  chartAspect: number;
  bothSides: boolean;
};

export type TransitSearchTechnique = {
  id: string;
  label: string;
};

export type TransitSearchPresets = {
  aspects: {
    all: string[];
    standard: string[];
    major: string[];
    clear: string[];
  };
  techniques: {
    standard: string[];
  };
  promittors: {
    all: string[];
    standard: string[];
    planets: string[];
    core7: string[];
    clear: string[];
  };
  significators: {
    standard: string[];
    builtins: string[];
    planets: string[];
    fixedStars: string[];
    clear: string[];
  };
};

export type TransitSearchDefaults = {
  fromDate: string;
  toDate: string;
  workbenchFromDate: string | null;
  workbenchToDate: string | null;
  techniques: string[];
  promittorIds: string[];
  significatorIds: string[];
  aspects: string[];
  includeSignChanges: boolean;
  promittorMotion: TransitSearchMotionFilter;
  significatorMotion: TransitSearchMotionFilter;
  moonPhase: MoonPhaseFilter;
  lunationOrb: number;
  partFilter: string;
  defaultOffsetMonths: number;
  defaultRangeMonths: number;
  lifetimeYears: number;
  limit: number;
  hasSavedState: boolean;
};

export type TransitSearchMotionFilter = "" | "rx" | "d";
export type MoonPhaseFilter = "" | "waxing" | "waning";
export type EventTimeDisplayMeta = {
  basis: "default_location" | string;
  zoneId: string;
  offsetsMinutes: number[];
  columnLabel: string;
};

export type TransitSearchCatalog = {
  title: string;
  sourceName: string;
  lifetimeFrom?: string | null;
  lifetimeTo?: string | null;
  dateConvention: string;
  meanNode: boolean;
  initialSignificatorId: string | null;
  initialSignificatorLabel: string;
  initialSignificatorGlyph: string;
  initialSignificatorGlyphFont: "morinus" | "text";
  objects: TransitSearchObject[];
  techniques: TransitSearchTechnique[];
  promittorIds: string[];
  significatorIds: string[];
  builtinSignificatorIds: string[];
  partIds: string[];
  aspects: TransitSearchAspect[];
  presets: TransitSearchPresets;
  defaults: TransitSearchDefaults;
  timeDisplay: EventTimeDisplayMeta;
};

export type TransitSearchDisplay = {
  lon_text?: string;
  motion_marker?: string;
  dignity_code?: string;
  state_suffix?: string;
  glyph_color_css?: string | null;
  glyph_color_role?: string | null;
  sign_color?: string | null;
  sign_color_role?: string | null;
  [key: string]: unknown;
};

export type TransitSearchRow = {
  key: string;
  technique: string;
  techniqueLabel: string;
  aspect: string;
  aspectLabel: string;
  aspectGlyph: string;
  eventGlyph: string;
  eventGlyphFont: "morinus" | "text";
  promittorId: string;
  promittorLabel: string;
  promittorGlyph: string;
  promittorGlyphFont: "morinus" | "text";
  promittorMarker: string;
  promittorSegments: TransitSearchObjectSegment[];
  significatorId: string;
  significatorLabel: string;
  significatorGlyph: string;
  significatorGlyphFont: "morinus" | "text";
  significatorMarker: string;
  significatorSegments: TransitSearchObjectSegment[];
  eventDate: string;
  eventTime: string;
  // Raw UTC event ints [y,m,d,h,m,s] round-tripped to /api/search/export so the
  // Python brains format clipboard/ICS text from the exact SearchResult fields.
  eventTuple: number[];
  displayDate: string;
  displayTime: string;
  displayDatetime: string;
  displayUtcOffsetMinutes: number;
  openDatetime: string;
  eventJd: number | null;
  canOpenChart: boolean;
  canExportTime: boolean;
  canExportIcs: boolean;
  notes: string;
  primaryMode: string;
  primaryDirection: string;
  metadata: Record<string, unknown>;
  promDisplay: TransitSearchDisplay;
  sigDisplay: TransitSearchDisplay;
  isSignChange: boolean;
  temporal?: TemporalRowMeta;
};

export type TransitSearchRequest = {
  documentId: string;
  fromDate: string;
  toDate: string;
  techniques: string[];
  promittorIds: string[];
  significatorIds: string[];
  aspects: string[];
  includeSignChanges: boolean;
  includeTemporal?: boolean;
  includeOrbTemporal?: boolean;
  partFilter?: string;
  progressionMethod?: number | null;
  objectMotionFilters?: Record<string, string>;
  promittorMotion?: TransitSearchMotionFilter;
  significatorMotion?: TransitSearchMotionFilter;
  moonPhase?: MoonPhaseFilter;
  lunationOrb?: number;
  limit?: number;
  persistSettings?: boolean;
  ownerScope?: string;
  ownerGeneration?: number;
  cursorDirection?: "around" | "previous" | "next" | null;
  cursorRowBudget?: number | null;
  cursorAnchorDate?: string | null;
  cursorRangeFrom?: string | null;
  cursorRangeTo?: string | null;
};

export type TransitSearchContextRequest = TransitSearchRequest & {
  significatorId?: string | null;
  chartRole?: "primary" | "outer" | null;
  customPoints?: Record<string, unknown>[];
};

export type TransitSearchResult = {
  rows: TransitSearchRow[];
  truncated: boolean;
  summary: string;
  timeDisplay: EventTimeDisplayMeta;
};

export type TransitSearchCursorState = {
  direction: "around" | "previous" | "next";
  rowBudget: number;
  rowCount: number;
  newRows: number;
  beforeBudget: number;
  afterBudget: number;
  beforeCount: number;
  afterCount: number;
  seedFrom: string;
  seedTo: string;
  anchorDate: string;
  rangeFrom: string;
  rangeTo: string;
  coverageFrom: string;
  coverageTo: string;
  coverageStartJdUt: number;
  coverageEndJdUt: number;
  windowsScanned: number;
  leafWindowsScanned: number;
  exhaustedPrevious: boolean;
  exhaustedNext: boolean;
  exhausted: boolean;
  satisfied: boolean;
  elapsedMs: number;
};

export type TransitSearchProgressResult = TransitSearchResult & {
  sessionId: string;
  revision: number;
  complete: boolean;
  cancelled?: boolean;
  phase: string;
  error?: string;
  cursor?: TransitSearchCursorState;
};

export async function fetchTransitSearchCatalog(
  documentId: string,
  signal?: AbortSignal,
): Promise<TransitSearchCatalog> {
  const search = new URLSearchParams({ documentId });
  const response = await daemonFetch(`${daemonBaseUrl()}/api/search/catalog?${search.toString()}`, {
    cache: "no-store",
    signal,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`transit search catalog failed: ${response.status} ${detail}`);
  }
  return (await response.json()) as TransitSearchCatalog;
}

export async function runTransitSearch(
  params: TransitSearchRequest,
  signal?: AbortSignal,
): Promise<TransitSearchResult> {
  return workspacePost<TransitSearchResult>(
    "/api/search/transits",
    {
      documentId: params.documentId,
      fromDate: params.fromDate,
      toDate: params.toDate,
      techniques: params.techniques,
      promittorIds: params.promittorIds,
      significatorIds: params.significatorIds,
      aspects: params.aspects,
      includeSignChanges: params.includeSignChanges,
      includeTemporal: (params.includeTemporal ?? false) || (params.includeOrbTemporal ?? false),
      includeOrbTemporal: params.includeOrbTemporal ?? false,
      partFilter: params.partFilter ?? "",
      progressionMethod: params.progressionMethod ?? null,
      objectMotionFilters: params.objectMotionFilters ?? {},
      promittorMotion: params.promittorMotion ?? "",
      significatorMotion: params.significatorMotion ?? "",
      moonPhase: params.moonPhase ?? "",
      lunationOrb: params.lunationOrb ?? 3,
      limit: params.limit ?? 500,
      persistSettings: params.persistSettings ?? true,
    },
    signal,
  );
}

export async function startTransitSearch(
  params: TransitSearchRequest,
  signal?: AbortSignal,
): Promise<TransitSearchProgressResult> {
  return workspacePost<TransitSearchProgressResult>(
    "/api/search/start",
    {
      ...transitSearchRequestBody(params),
      ownerGeneration: params.ownerGeneration ?? nextTransitSearchOwnerGeneration(),
    },
    signal,
  );
}

export async function saveTransitSearchSettings(
  params: TransitSearchRequest,
  signal?: AbortSignal,
): Promise<{ ok: boolean }> {
  return workspacePost(
    "/api/search/settings",
    transitSearchRequestBody(params),
    signal,
  );
}

export async function fetchTransitSearchContextCatalog(
  params: {
    documentId: string;
    significatorId?: string | null;
    chartRole?: "primary" | "outer" | null;
    customPoints?: Record<string, unknown>[];
  },
  signal?: AbortSignal,
): Promise<TransitSearchCatalog> {
  return workspacePost<TransitSearchCatalog>(
    "/api/search/context/catalog",
    {
      documentId: params.documentId,
      significatorId: params.significatorId ?? null,
      chartRole: params.chartRole ?? null,
      customPoints: params.customPoints ?? [],
    },
    signal,
  );
}

export async function runTransitSearchContext(
  params: TransitSearchContextRequest,
  signal?: AbortSignal,
): Promise<TransitSearchResult> {
  return workspacePost<TransitSearchResult>(
    "/api/search/context/transits",
    transitSearchContextRequestBody(params),
    signal,
  );
}

export async function startTransitSearchContext(
  params: TransitSearchContextRequest,
  signal?: AbortSignal,
): Promise<TransitSearchProgressResult> {
  return workspacePost<TransitSearchProgressResult>(
    "/api/search/context/start",
    {
      ...transitSearchContextRequestBody(params),
      ownerGeneration: params.ownerGeneration ?? nextTransitSearchOwnerGeneration(),
    },
    signal,
  );
}

export async function saveTransitSearchContextSettings(
  params: TransitSearchContextRequest,
  signal?: AbortSignal,
): Promise<{ ok: boolean }> {
  return workspacePost(
    "/api/search/context/settings",
    transitSearchContextRequestBody(params),
    signal,
  );
}

/** Clipboard/ICS text for selected Search rows. POST /api/search/export —
 * the daemon formats via searchbackend.build_clipboard_text / build_ics
 * (searchwnd.py:3733-3756); the skin never assembles these strings. */
export async function exportSearchRows(
  rows: TransitSearchRow[],
  kind: "clipboard" | "ics",
  signal?: AbortSignal,
): Promise<{ text: string; filename?: string }> {
  return workspacePost(
    "/api/search/export",
    {
      kind,
      rows: rows.map((row) => ({
        technique: row.technique,
        aspect: row.aspect,
        promittorId: row.promittorId,
        significatorId: row.significatorId,
        promittorLabel: row.promittorLabel,
        significatorLabel: row.significatorLabel,
        eventDate: row.eventDate,
        eventTime: row.eventTime,
        eventTuple: row.eventTuple,
        notes: row.notes,
      })),
    },
    signal,
  );
}

export async function updateSearchDefaultRange(
  params: { documentId: string; offsetMonths: number; rangeMonths: number; lifetimeYears: number },
  signal?: AbortSignal,
): Promise<{
  defaultOffsetMonths: number;
  defaultRangeMonths: number;
  lifetimeYears: number;
  fromDate: string;
  toDate: string;
  lifetimeFrom: string | null;
  lifetimeTo: string | null;
}> {
  return workspacePost(
    "/api/search/default-range",
    {
      documentId: params.documentId,
      offsetMonths: params.offsetMonths,
      rangeMonths: params.rangeMonths,
      lifetimeYears: params.lifetimeYears,
    },
    signal,
  );
}

export async function updateSearchContextDefaultRange(
  params: {
    documentId: string;
    significatorId?: string | null;
    chartRole?: "primary" | "outer" | null;
    customPoints?: Record<string, unknown>[];
    offsetMonths: number;
    rangeMonths: number;
    lifetimeYears: number;
  },
  signal?: AbortSignal,
): Promise<{
  defaultOffsetMonths: number;
  defaultRangeMonths: number;
  lifetimeYears: number;
  fromDate: string;
  toDate: string;
  lifetimeFrom: string | null;
  lifetimeTo: string | null;
}> {
  return workspacePost(
    "/api/search/context/default-range",
    {
      documentId: params.documentId,
      significatorId: params.significatorId ?? null,
      chartRole: params.chartRole ?? null,
      customPoints: params.customPoints ?? [],
      offsetMonths: params.offsetMonths,
      rangeMonths: params.rangeMonths,
      lifetimeYears: params.lifetimeYears,
    },
    signal,
  );
}

export async function fetchTransitSearchProgress(
  sessionId: string,
  signal?: AbortSignal,
  options?: {
    afterRevision?: number;
    waitMs?: number;
  },
): Promise<TransitSearchProgressResult> {
  const search = new URLSearchParams({ sessionId });
  if (options?.afterRevision !== undefined) {
    search.set("afterRevision", String(options.afterRevision));
  }
  if (options?.waitMs !== undefined) {
    search.set("waitMs", String(options.waitMs));
  }
  const response = await daemonFetch(`${daemonBaseUrl()}/api/search/progress?${search.toString()}`, {
    cache: "no-store",
    signal,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`transit search progress failed: ${response.status} ${detail}`);
  }
  return (await response.json()) as TransitSearchProgressResult;
}

export async function followTransitSearchProgress(
  initial: TransitSearchProgressResult,
  signal: AbortSignal | undefined,
  onProgress: (result: TransitSearchProgressResult) => void,
  options?: { waitMs?: number },
): Promise<TransitSearchProgressResult> {
  let current = initial;
  onProgress(current);
  while (!signal?.aborted && !current.complete) {
    const next = await fetchTransitSearchProgress(current.sessionId, signal, {
      afterRevision: current.revision,
      waitMs: options?.waitMs ?? 25_000,
    });
    if (next.revision === current.revision && !next.complete) continue;
    current = next;
    onProgress(current);
  }
  if (signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }
  return current;
}

export async function cancelTransitSearch(sessionId: string): Promise<{ cancelled: boolean }> {
  return workspacePost("/api/search/cancel", { sessionId });
}

function transitSearchRequestBody(params: TransitSearchRequest) {
  return {
    documentId: params.documentId,
    fromDate: params.fromDate,
    toDate: params.toDate,
    techniques: params.techniques,
    promittorIds: params.promittorIds,
    significatorIds: params.significatorIds,
    aspects: params.aspects,
    includeSignChanges: params.includeSignChanges,
    includeTemporal: (params.includeTemporal ?? false) || (params.includeOrbTemporal ?? false),
    includeOrbTemporal: params.includeOrbTemporal ?? false,
    partFilter: params.partFilter ?? "",
    progressionMethod: params.progressionMethod ?? null,
    objectMotionFilters: params.objectMotionFilters ?? {},
    promittorMotion: params.promittorMotion ?? "",
    significatorMotion: params.significatorMotion ?? "",
    moonPhase: params.moonPhase ?? "",
    lunationOrb: params.lunationOrb ?? 3,
    limit: params.limit ?? 500,
    persistSettings: params.persistSettings ?? true,
    ownerScope: params.ownerScope ?? "search",
    cursorDirection: params.cursorDirection ?? null,
    cursorRowBudget: params.cursorRowBudget ?? null,
    cursorAnchorDate: params.cursorAnchorDate ?? null,
    cursorRangeFrom: params.cursorRangeFrom ?? null,
    cursorRangeTo: params.cursorRangeTo ?? null,
  };
}

function transitSearchContextRequestBody(params: TransitSearchContextRequest) {
  return {
    ...transitSearchRequestBody(params),
    significatorId: params.significatorId ?? null,
    chartRole: params.chartRole ?? null,
    customPoints: params.customPoints ?? [],
  };
}

let transitSearchOwnerGeneration = Date.now() * 1000;

function nextTransitSearchOwnerGeneration(): number {
  transitSearchOwnerGeneration = Math.max(
    transitSearchOwnerGeneration + 1,
    Date.now() * 1000,
  );
  return transitSearchOwnerGeneration;
}

// ---------------------------------------------------------------------------
// Planispheric astrolabe geometry — the daemon-owned view-only surface
// (launcherKind "astrolabe"). The daemon (astrolabe_service via
// astrolabe_projection) computes the full projection geometry in normalized
// R_eq=1 space; AstrolabeView draws it on Canvas2D. Oracle: astrolabechart.py.
// ---------------------------------------------------------------------------

export type AstrolabeCircle = { cx: number; cy: number; r: number };
export type AstrolabeLine = { x1: number; y1: number; x2: number; y2: number };

export type AstrolabePoint = { x: number; y: number };

/** One nearby PD-exact overlay event. The daemon resolves prom/sig glyphs from
 * the live options object; React only maps aspect ids. astrolabechart.py:1120-1163. */
export type AstrolabePdEvent = {
  prom: number;
  prom2: number;
  promasp: number;
  sig: number;
  sigasp: number;
  promGlyph?: string | null;
  prom2Glyph?: string | null;
  sigGlyph?: string | null;
  mundane: boolean;
  direct: boolean;
  arc: number;
  promText: string;
  sigText: string;
  offsetYears: number;
};

export type AstrolabeGeometry = {
  name: string;
  lat: number;
  lon: number;
  obliquity: number;
  ramc: number;
  delta: number;
  eramc: number;
  yearsPerDegree: number;
  center: { horizonOffset: number };
  radii: { equator: number; cancer: number; capricorn: number };
  tympan: {
    horizon: AstrolabeCircle;
    equator: AstrolabeCircle;
    tropicCancer: AstrolabeCircle;
    tropicCapricorn: AstrolabeCircle;
    meridian: AstrolabeLine;
    horizonAxis: AstrolabeLine;
    regioHouses: AstrolabeCircle[];
    almucantars: Array<AstrolabeCircle & { alt: number }>;
    azimuths: Array<AstrolabeCircle & { az: number }>;
    hourLines: Array<AstrolabeCircle & { hour: number }>;
  };
  rete: {
    ecliptic: AstrolabeCircle;
    signBoundaries: Array<{ sign: number; x: number; y: number; color: string; colorRole?: string | null }>;
    signGlyphLabels: Array<{ sign: number; glyph: string; x: number; y: number; color: string; colorRole?: string | null }>;
    stars: Array<{ name: string; nom: string; ra: number; decl: number; x: number; y: number }>;
  };
  bodies: Array<{
    id: number;
    glyph: string;
    color: string;
    colorRole?: string | null;
    ra: number;
    decl: number;
    lon: number;
    sphere: { x: number; y: number };
    ecliptic: { x: number; y: number };
    above: boolean;
    isSun: boolean;
  }>;
  // Atmospheric view (DEFAULT): filled plate with sun-altitude-driven sky/ground.
  atmospheric: { sunAltitude: number; sky: string; ground: string };
  // Equator / Horizon / Ecliptic text anchors (astrolabechart.py:1007-1032).
  circleLabels: {
    equator: AstrolabePoint & { color: string };
    horizon: AstrolabePoint & { color: string };
    ecliptic: AstrolabePoint & { color: string };
  };
  // Graduated zodiac band: 360 tick anchors (with level) + 12 glyph anchors.
  zodiacBand: {
    ecliptic: AstrolabeCircle;
    ticks: Array<AstrolabePoint & { deg: number; level: number }>;
    glyphs: Array<{ sign: number; glyph: string; x: number; y: number; color: string; colorRole?: string | null }>;
  };
  // Info label strings (Arc d°m's" + Age N yrs) computed in the engine.
  infoLabel: { arc: string; age: string; deltaDeg: number; ageYears: number };
  // PD stepper: arc-sorted snap targets + nearby-event overlay rows.
  pd: { snapArcs: number[]; nearbyEvents: AstrolabePdEvent[] };
};

export type AstrolabeViewState = {
  deltaDeg: number;
  atmospheric: boolean;
  regioHouses: boolean;
  zodiacWheel: boolean;
  almucantars: boolean;
  azimuths: boolean;
  hourLines: boolean;
  stars: boolean;
};

/** Planispheric astrolabe geometry for a radix. `delta` rotates the rete (the
 * primary-directions arc, degrees of RA); defaults to 0 (the radix moment). */
export async function fetchAstrolabe(
  name: string,
  params: { delta?: number; source?: string; documentId?: string } = {},
  signal?: AbortSignal,
): Promise<AstrolabeGeometry> {
  const search = new URLSearchParams({ name });
  if (params.delta != null) search.set("delta", String(params.delta));
  if (params.source) search.set("source", params.source);
  if (params.documentId) search.set("documentId", params.documentId);
  const response = await daemonFetch(`${daemonBaseUrl()}/api/astrolabe?${search.toString()}`, {
    cache: "no-store",
    signal,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`astrolabe request failed: ${response.status} ${detail}`);
  }
  return (await response.json()) as AstrolabeGeometry;
}

export async function fetchAstrolabeViewState(
  documentId: string,
  signal?: AbortSignal,
): Promise<AstrolabeViewState> {
  const response = await daemonFetch(
    `${daemonBaseUrl()}/api/workspace/document/${encodeURIComponent(documentId)}/astrolabe/view-state`,
    { cache: "no-store", signal },
  );
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`astrolabe view state failed: ${response.status} ${detail}`);
  }
  return ((await response.json()) as { state: AstrolabeViewState }).state;
}

export async function storeAstrolabeViewState(
  documentId: string,
  state: AstrolabeViewState,
  signal?: AbortSignal,
): Promise<void> {
  await workspacePost<{ ok: boolean }>(
    `/api/workspace/document/${encodeURIComponent(documentId)}/astrolabe/view-state`,
    { state },
    signal,
  );
}

// ---------------------------------------------------------------------------
// Square Chart (medieval square diagram) data — daemon-owned view-only surface
// (launcherKind "square_chart"). The daemon (square_chart_service) computes
// house membership + per-planet display; the view draws the square. House
// membership is the engine's (houses.getHousePos). Oracle: squarechart.py.
// ---------------------------------------------------------------------------

export type SquareChartPlanet = {
  id: number;
  glyph: string;
  color: string;
  colorRole?: string | null;
  sign: number;
  signGlyph: string;
  deg: number;
  min: number;
  /** R(etrograde) / S(tationary) / "" */
  motion: string;
  isLof: boolean;
  isVertex: boolean;
};

export type SquareChartColors = {
  background: string;
  frame: string;
  texts: string;
  positions: string;
  signs: string;
};

export type SquareChartDayHourLine = {
  glyph: string;
  label: string;
};

export type SquareChartData = {
  name: string;
  houseSystem: string;
  info: string[];
  dayHour: SquareChartDayHourLine[];
  colors: SquareChartColors;
  cusps: Array<{ house: number; sign: number; signGlyph: string; deg: number; min: number }>;
  houses: Array<{ house: number; planets: SquareChartPlanet[] }>;
};

export async function fetchSquareChart(
  name: string,
  params: { source?: string; documentId?: string } = {},
  signal?: AbortSignal,
): Promise<SquareChartData> {
  const search = new URLSearchParams({ name });
  if (params.source) search.set("source", params.source);
  if (params.documentId) search.set("documentId", params.documentId);
  const response = await daemonFetch(`${daemonBaseUrl()}/api/square-chart?${search.toString()}`, {
    cache: "no-store",
    signal,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`square chart request failed: ${response.status} ${detail}`);
  }
  return (await response.json()) as SquareChartData;
}

// ---------------------------------------------------------------------------
// Mundane Chart (planets by mundane position) data — daemon-owned view-only
// surface (launcherKind "mundane_chart"). The daemon (mundane_chart_service)
// computes the mundane positions (the Placidian PMP, not zodiacal longitude),
// the equal mundane house spokes and the ASC/IC/Desc/MC axes, all in mundane
// degrees (0 at the ASC). Oracle: mundanechart.py.
// ---------------------------------------------------------------------------

export type MundaneChartBody = {
  id: number;
  glyph: string;
  color: string;
  colorRole?: string | null;
  /** Mundane longitude in degrees, 0 at the ASC. */
  mundane: number;
  motion: string;
  posDeg: number;
  posMin: number;
  isLof: boolean;
  hoverFlag?: InspectorFlagPayload | null;
};

export type MundaneChartColors = {
  background: string;
  frame: string;
  ascmc: string;
  houses: string;
  houseNumbers: string;
  positions: string;
};

export type MundaneChartOverlay = {
  showInformation: boolean;
  showHouseSystem: boolean;
  topLeft: string[];
  bottomLeft: string[];
  houseSystemLines: string[];
};

export type MundaneChartAspect = {
  fromMundane: number;
  toMundane: number;
  scope?: "within" | "comparison" | "at" | string;
  transitMundane?: number;
  radixMundane?: number;
  aspect: string;
  aspectGlyph: string;
  aspectFont: "morinus" | "text" | string;
  orbArcmin: number;
  maxOrbArcmin: number;
  color: string;
  colorRole?: string | null;
  hoverFlag?: InspectorFlagPayload | null;
};

export type MundaneChartData = {
  name: string;
  showHouses: boolean;
  positions: boolean;
  compound?: boolean;
  ascLongitude: number;
  ascmcSize: number;
  colors: MundaneChartColors;
  bodies: MundaneChartBody[];
  secondaryBodies?: MundaneChartBody[] | null;
  houses: Array<{ house: number; name: string; mundane: number; nameMundane: number }>;
  angles: Array<{ name: string; mundane: number; arrow: boolean }>;
  aspects?: MundaneChartAspect[];
  overlay?: MundaneChartOverlay | null;
};

export async function fetchMundaneChart(
  name: string,
  params: { source?: string; documentId?: string } = {},
  signal?: AbortSignal,
): Promise<MundaneChartData> {
  const search = new URLSearchParams({ name });
  if (params.source) search.set("source", params.source);
  if (params.documentId) search.set("documentId", params.documentId);
  const response = await daemonFetch(`${daemonBaseUrl()}/api/mundane-chart?${search.toString()}`, {
    cache: "no-store",
    signal,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`mundane chart request failed: ${response.status} ${detail}`);
  }
  return (await response.json()) as MundaneChartData;
}

// ---------------------------------------------------------------------------
// Astrolog-style chart sphere geometry — daemon-owned view-only surface
// (launcherKind "astrolog_sphere"). The daemon computes the projection from the
// live Aries chart and options; React only scales/draws the returned points.
// ---------------------------------------------------------------------------

export type AstrologSpherePoint = { x: number; y: number; z: number; front: boolean };

export type AstrologSpherePolyline = {
  id: string;
  label: string;
  kind: string;
  color: string;
  colorRole?: string | null;
  width: number;
  dash: number[];
  points: AstrologSpherePoint[];
};

export type AstrologSphereGlyphAnchor = {
  glyph: string;
  color?: string;
  colorRole?: string | null;
  lon?: number;
  point: AstrologSpherePoint;
};

export type AstrologSphereGeometry = {
  name: string;
  lat: number;
  lon: number;
  obliquity: number;
  ramc: number;
  rotation: number;
  tilt: number;
  houseSystem: { code: string; engineCode: string; label: string };
  mode: string;
  reference: AstrologSpherePolyline[];
  signBoundaries: AstrologSpherePolyline[];
  decanBoundaries: AstrologSpherePolyline[];
  houses: AstrologSpherePolyline[];
  signLabels: Array<AstrologSphereGlyphAnchor & { sign: number; color: string }>;
  houseLabels: Array<AstrologSphereGlyphAnchor & { house: number }>;
  decanLabels: Array<AstrologSphereGlyphAnchor & { sign: number; decan: number; planetId: number }>;
  boundTicks: AstrologSpherePolyline[];
  boundLabels: Array<AstrologSphereGlyphAnchor & { sign: number; bound: number; planetId: number; size: number }>;
  bodies: Array<AstrologSphereGlyphAnchor & {
    id: number;
    color: string;
    ra: number;
    decl: number;
    lon: number;
    eclipticPoint: AstrologSpherePoint;
    front: boolean;
    isSun: boolean;
  }>;
  colors: { bodyFallback: string };
};

export async function fetchAstrologSphere(
  name: string,
  params: { source?: string; documentId?: string; rotation?: number; tilt?: number } = {},
  signal?: AbortSignal,
): Promise<AstrologSphereGeometry> {
  const search = new URLSearchParams({ name });
  if (params.source) search.set("source", params.source);
  if (params.documentId) search.set("documentId", params.documentId);
  if (params.rotation != null) search.set("rotation", String(params.rotation));
  if (params.tilt != null) search.set("tilt", String(params.tilt));
  const response = await daemonFetch(`${daemonBaseUrl()}/api/astrolog-sphere?${search.toString()}`, {
    cache: "no-store",
    signal,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`astrolog sphere request failed: ${response.status} ${detail}`);
  }
  return (await response.json()) as AstrologSphereGeometry;
}

export async function fetchNotes(
  radix: string,
  optionsOrSignal?: { documentId?: string; scratch?: boolean } | AbortSignal,
  signal?: AbortSignal,
): Promise<{ radix: string; content: string; path: string; scratch: boolean; exists: boolean }> {
  const options = optionsOrSignal instanceof AbortSignal ? undefined : optionsOrSignal;
  const requestSignal = optionsOrSignal instanceof AbortSignal ? optionsOrSignal : signal;
  const search = new URLSearchParams({ radix });
  if (options?.documentId) search.set("documentId", options.documentId);
  if (options?.scratch) search.set("scratch", "true");
  const response = await daemonFetch(`${daemonBaseUrl()}/api/notes?${search.toString()}`, {
    cache: "no-store",
    signal: requestSignal,
  });
  if (!response.ok) {
    throw new Error(`notes fetch failed: ${response.status}`);
  }
  return (await response.json()) as {
    radix: string;
    content: string;
    path: string;
    scratch: boolean;
    exists: boolean;
  };
}

export async function saveNotes(
  radix: string,
  content: string,
  optionsOrSignal?: { documentId?: string; scratch?: boolean } | AbortSignal,
  signal?: AbortSignal,
): Promise<{ ok: boolean; radix: string; path: string; scratch: boolean }> {
  const options = optionsOrSignal instanceof AbortSignal ? undefined : optionsOrSignal;
  const requestSignal = optionsOrSignal instanceof AbortSignal ? optionsOrSignal : signal;
  const response = await daemonFetch(`${daemonBaseUrl()}/api/notes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      radix,
      content,
      documentId: options?.documentId,
      scratch: options?.scratch ?? false,
    }),
    signal: requestSignal,
  });
  if (!response.ok) {
    throw new Error(`notes save failed: ${response.status}`);
  }
  return (await response.json()) as { ok: boolean; radix: string; path: string; scratch: boolean };
}

export async function discardScratchNotes(
  radix: string,
  documentId: string,
  signal?: AbortSignal,
): Promise<{ ok: boolean; radix: string; path: string; removed: boolean }> {
  const response = await daemonFetch(`${daemonBaseUrl()}/api/notes/scratch/discard`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ radix, documentId }),
    signal,
  });
  if (!response.ok) {
    throw new Error(`notes scratch discard failed: ${response.status}`);
  }
  return (await response.json()) as { ok: boolean; radix: string; path: string; removed: boolean };
}

export async function commitScratchNotes(
  radix: string,
  documentId: string,
  signal?: AbortSignal,
): Promise<{ ok: boolean; radix: string; committed: boolean; path: string }> {
  const response = await daemonFetch(`${daemonBaseUrl()}/api/notes/scratch/commit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ radix, documentId }),
    signal,
  });
  if (!response.ok) {
    throw new Error(`notes scratch commit failed: ${response.status}`);
  }
  return (await response.json()) as { ok: boolean; radix: string; committed: boolean; path: string };
}

// ---------------------------------------------------------------------------
// Options / Appearance — GET/POST /api/options + POST /api/options/theme.
// The daemon ships ONE canonical options object (chart_service.options); a patch
// mutates it and re-renders every open chart. Group shapes are verbatim from
// options_service.get_options (options_service.py:162). Spec:
// doc/migration/surfaces/settings.md + options.md.
// ---------------------------------------------------------------------------

export type OptionsColors = {
  // Chrome + glyph slots — RGB [r,g,b]. Order/keys: options_service _COLOR_RGB_FIELDS.
  clrbackground: RGB | null;
  clrsidebar: RGB | null;
  clrsidebartext: RGB | null;
  clrtable: RGB | null;
  clrtexts: RGB | null;
  clrappbackground: RGB | null;
  clrapptexts: RGB | null;
  clrframe: RGB | null;
  clrsigns: RGB | null;
  clrAscMC: RGB | null;
  clrhouses: RGB | null;
  clrhousenumbers: RGB | null;
  clrpositions: RGB | null;
  clrperegrin: RGB | null;
  clrdomicil: RGB | null;
  clrexil: RGB | null;
  clrexal: RGB | null;
  clrcasus: RGB | null;
  clrsignelementfire: RGB | null;
  clrsignelementearth: RGB | null;
  clrsignelementair: RGB | null;
  clrsignelementwater: RGB | null;
  clrindividual: (RGB | null)[]; // 13, SE-id order
  clraspect: (RGB | null)[]; // 12, aspect-index order
  useplanetcolors: boolean;
  usezodiacelementcolors: boolean;
  follow_os_theme: boolean;
};

export type OptionsDisplay = {
  houses: boolean;
  showouterhouselines: boolean;
  housesystem: boolean;
  topocentric: boolean;
  morin_antiscia: boolean;
  showvertex: boolean;
  showaspectstovertex: boolean;
  // Aspect drawing master + sub-toggles (appearance1dlg).
  aspects: boolean;
  symbols: boolean;
  traditionalaspects: boolean;
  showaspectstoasc: boolean;
  showaspectstomc: boolean;
  showaspectstodsc: boolean;
  showaspectstoic: boolean;
  // Body show-toggles.
  showchiron: boolean;
  shownodes: boolean;
  aspectstonodes: boolean;
  showlof: boolean;
  showaspectstolof: boolean;
  showlofouterring: boolean;
  showprenatalsyzygy: boolean;
  showprenataleclipse: boolean;
  // Header.
  planetarydayhour: boolean;
  information: boolean;
  showradixnameincanvas: boolean;
  showseconds: boolean;
  dateconvention: string;
  // Aesthetic / chrome.
  show_help_chip: boolean;
  /** Hidden presentation aid; deliberately has no Settings control. */
  presentation_cursor: boolean;
  showkeyprompts: boolean; // master key-prompt toggle (options.py:129)
  // Dignity ring display.
  showterms: boolean;
  showdecans: boolean;
  showanglearrowheads: boolean;
  showcusplessascmclabels: boolean;
  multiwheel_show_positions: boolean;
  multiwheel_show_minutes: boolean;
  multiwheel_sign_colors: boolean;
  multiwheel_show_angle_labels: boolean;
  showfixstars: number;
  // --- Appearance-menu parity adds (appearance1dlg control delta) ---
  extendedradixstations: boolean; // "Modern Planets" (options.py:144)
  aspect_flag_show_parties: boolean; // planets in aspect hover flag (options.py:152)
  aspect_thickness_mode: boolean; // orb via line thickness (options.py:400)
  aspect_opacity_mode: boolean; // orb via line opacity
  showfixstarsnodes: boolean; // FixStars→Nodes (options.py:161)
  showfixstarshcs: boolean; // FixStars→intermediate cusps (options.py:162)
  showfixstarslof: boolean; // FixStars→Lot of Fortune (options.py:163)
  exclusive_aspects_on_click: boolean; // options.py:149
  exclusive_aspects_on_click_show_minor: boolean; // options.py:150
  exclusive_aspects_on_click_traditional: boolean; // options.py:151
  positions: boolean; // show positions (options.py:116)
  intables: boolean; // show in tables (options.py:117)
  usetradfixstarnamespdlist: boolean; // trad fixstar names in PD list (options.py:168)
  theme: number; // wheel LAYOUT 0/1/2 (catalog.themeLayouts — DISTINCT from colour theme)
  anglo_dense_label_layout: "leader-columns" | "routed-cusps" | "sign-locked";
  phasismode: number; // Phasis enum 0/1/2/3 (catalog.phasisModes)
  solarconditionmode: number; // solar-condition doctrine/profile (catalog.solarConditionModes)
  showcazimi: boolean; // show Cazimi rows in radix overlay
  cazimimode: number; // Cazimi enum 0/1/2 (catalog.cazimiModes)
  synodicmode: number; // planetary-return Shift+Arrow event filter (catalog.synodicModes)
  showeclipseoverlay: boolean; // show nearby eclipse rows in radix overlay
  astrocart_show_ecliptic: boolean;
  astrocart_show_equator: boolean;
  astrocart_show_asc_circle: boolean;
  astrocart_show_mc_circle: boolean;
  astrocart_show_house_lines: boolean;
  astrocart_show_zodiac_lines: boolean;
  astrocart_show_country_labels: boolean;
  // Fixed-length bool vectors — per-index labels/glyphs come from the catalog.
  transcendental: boolean[]; // 3: U/N/P (catalog.transcendentalLabels)
  aspect: boolean[]; // 12: per-aspect draw toggle (catalog.aspectLabels)
  // Numeric sliders (catalog.sliders carries label/min/max/step/kind).
  ascmcsize: number;
  chartringthickness: number;
  // Enum string + font profile.
  keyprompts_style: string; // catalog.keypromptStyles
  fontfamily: string; // catalog.fontProfiles[].value
};

export type PdfChartColorMode = "monochrome" | "colored-details";
export type PdfChartRasterPreset = "clean" | "atkinson" | "blue-noise" | "newsprint";
export type PngChartAppearance = "screen" | PdfChartColorMode;

export type OptionsExport = {
  pngChartAppearance: PngChartAppearance;
  pngIncludeOverlays: boolean;
  pngChartAppearanceChoices: { value: PngChartAppearance; labelKey: string }[];
  pdfChartColorMode: PdfChartColorMode;
  pdfChartRasterPreset: PdfChartRasterPreset;
  pdfIncludeOverlays: boolean;
  listExportAspectSymbols: boolean;
  pdfChartColorModeChoices: { value: PdfChartColorMode; label: string }[];
  pdfChartRasterPresetChoices: { value: PdfChartRasterPreset; labelKey: string }[];
};

export type HouseSystemEntry = { code: string; label: string; labelKey?: string };
export type OptionsHouseSystem = {
  hsys: string;
  housesystem: boolean;
  available: HouseSystemEntry[];
};

export type AyanamshaEntry = { index: number; label: string };
export type OptionsAyanamsha = { ayanamsha: number; available: AyanamshaEntry[] };

export type OptionsOrbs = {
  orbis: number[][]; // 11 planets × 12 aspects
  orbisplanetspar: number[][]; // 11 × 2 (parallel, contraparallel)
  orbisH: number[]; // 12 house-aspect orbs
  orbisAscMC: number[]; // 12 Asc/MC aspect orbs
  orbisparH: number[]; // 2: house parallel/contraparallel
  orbisparAscMC: number[]; // 2: Asc/MC parallel/contraparallel
  orbiscuspH: number;
  orbiscuspAscMC: number;
  exact: number;
  fixstarsOrbAll: number; // single "all stars" fixed-star conjunction orb
};

// Essential-dignities grid: options.dignities[planet][type][sign] = bool, over
// 10 planets (Sun..Pluto) x 2 types (Domicile/Exaltation) x 12 signs.
// (dignitiesdlg.py:21,137,249-254.)
export type DignityGrid = boolean[][][];
// Terms grid: options.terms[set][sign][position] = [planetCode, degrees], over
// 2 sets (Egyptian/Ptolemaic) x 12 signs x 5 positions. planetCode is the term-
// ruler value (Mercury=2..Saturn=6); degrees span sums to 30 per sign.
// (termsdlg.py:90,111-116,184-185.)
export type TermsGrid = [number, number][][][];

export type OptionsDignities = {
  showterms: boolean;
  dignitylabelcolors: boolean;
  selterm: number;
  dignityscores: number[]; // 5: domicil, exaltation, triplicity, term, face
  // Big nested grids — edited by the DignitiesTab grid editors and sent back
  // whole (backend setattr passthrough). See settings.md DEF-011.
  dignities: DignityGrid;
  terms: TermsGrid;
};

// Supported astrology glyph variants for Uranus and Pluto.
export type OptionsSymbols = {
  uranus: boolean;
  pluto: number;
};

export type ThemePreset = {
  name: string; // stable id (selection key) — never translated
  label?: string; // localized display label from the daemon (falls back to name)
  mode: "system" | "custom" | "dark" | "light";
  selected?: boolean;
  chrome: Record<string, [number, number, number]>;
};

export type ThemeState = {
  activePreset: string;
  mode: "light" | "dark";
  presentationCursor?: boolean;
  schemaVersion: number;
  version: number;
  styleRevision: number;
  paletteHash: string;
  styleHash: string;
  appTokens: Record<string, string>;
  chartPalette: Record<string, string>;
  activeProfile: StyleProfileSummary | null;
  profileOverrides: {
    appTokens: Record<string, string>;
    chartPalette: Record<string, string>;
    wheelAuthoring: Record<
      string,
      number | string | readonly number[] | ChartStyleFontRef
    >;
    appAuthoring: Record<string, number | string | readonly number[]>;
    chartData: {
      planets?: string[];
      aspects?: string[];
      signColors?: string[];
    };
  };
};

export type StyleProfileScope = "app" | "chart" | "combined";
export type StyleProfileValue = number | string | [number, number, number] | [number, number, number, number];
export type StyleProfileAuthoringValue =
  | StyleProfileValue
  | readonly number[]
  | ChartStyleFontRef;

export type StyleProfileSummary = {
  id: string;
  name: string;
  scope: StyleProfileScope;
  basePresetId: string | null;
  contentHash: string;
};

export type StyleProfile = StyleProfileSummary & {
  kind: "aries.style-profile";
  profileSchemaVersion: 1;
  tokenSchemaVersion: number;
  overrides: Record<string, StyleProfileValue>;
  authoringOverrides?: Record<string, StyleProfileAuthoringValue>;
  appAuthoringOverrides?: Record<string, StyleProfileValue>;
};

export type StyleProfileInput = Omit<StyleProfile, "contentHash">;

export type StyleProfilesPayload = {
  profileSchemaVersion: number;
  tokenSchemaVersion: number;
  activeProfileId: string | null;
  profiles: StyleProfile[];
  loadError: string | null;
  profileErrors: Record<string, string>;
};

export type StyleProfileMutationResult = {
  styleProfiles: StyleProfilesPayload;
  activeProfile: StyleProfile | null;
  profile?: StyleProfile;
  themeState: ThemeState;
  refreshedDocumentIds: string[];
  refreshMode: "display-overlay" | null;
};

// Lunar Mansions (manazil) zodiac mode — mansionsdlg.MansionsDlg. `manazil_zodiac`
// is a string in manazil.ZODIAC_MODES (options.py:318). Choices come from
// catalog.mansionZodiacModes.
export type OptionsLunarMansions = {
  manazil_zodiac: string;
  show_manzil_in_inspector: boolean;
};

// Speculum column-visibility settings — appearance2dlg.Appearance2Dlg. The two
// speculum rows are bool maps keyed by the planets.Planet column index (as a
// string), plus the per-row dodecatemorion flags and the global In-Time toggle.
// The column index→label oracle is catalog.speculumPlacidianCols / RegiomontanCols.
export type SpeculumSpeedDisplayMode = "words" | "percent" | "daily";

export type OptionsSpeculum = {
  placidian: Record<string, boolean>;
  regiomontan: Record<string, boolean>;
  placidianDodec: boolean;
  regiomontanDodec: boolean;
  intime: boolean;
  speedMode: SpeculumSpeedDisplayMode;
};

// Default Location — the saved "Here-and-Now" place. Keys are the options.py
// def* attributes verbatim (options_service _DEFLOC_*_FIELDS); the daemon reads
// them into this group and chart_service._build_here_now_chart constructs the
// current-moment chart from them. The settings tab edits these via /api/options.
export type OptionsDefaultLocation = {
  deflocname: string;
  defloctzid: string;
  defloclondeg: number;
  defloclonmin: number;
  defloclon: number | null;
  defloclatdeg: number;
  defloclatmin: number;
  defloclat: number | null;
  deflocalt: number;
  defloczhour: number;
  defloczminute: number;
  defloceast: boolean;
  deflocnorth: boolean;
  deflocplus: boolean;
  deflocdst: boolean;
  defloctzauto: boolean;
};

// Step conjunction sound alerts (stepalertsdlg.StepAlertsDlg). The vectors align
// to catalog.stepAlertBodies and catalog.stepAlertAngles; ChartSession/chartalerts
// own the actual trigger and sound playback.
export type OptionsStepAlerts = {
  stepalerts_enabled: boolean;
  stepalerts_promplanets: boolean[];
  stepalerts_sigplanets: boolean[];
  stepalerts_sigangles: boolean[];
};

// Chart-Almuten scoring weights (almutenchartdlg.AlmutenChartDlg). All four
// vectors are fixed-length: dignityscores[5], housescores[12], sunphases[3],
// dayhourscores[2]. dignityscores is also surfaced read-only in the dignities
// group; here it is the editable owner (the two wx dialogs share it).
export type OptionsAlmutens = {
  oneruler: boolean;
  usedaynightorb: boolean;
  dignityscores: number[];
  useaccidental: boolean;
  housescores: number[];
  sunphases: number[];
  dayhourscores: number[];
  useexaltationmercury: boolean;
};

// Annual-profections mode flags (profdlgopts.ProfDlgOpts + profectionswnd radio,
// options_service._read_profections). Shares the Time Lords settings tab with
// Firdaria. wholeSign selects profection-chart motion (by sign vs continuous);
// time-lord sign calculation is independent.
export type OptionsProfections = {
  wholeSign: boolean;
  zodiacal: boolean;
  useZodProjs: boolean;
  solarReturnSnap: boolean;
};

// Firdaria nocturnal order (firdariadlg.FirdariaDlg). True = Bonatus.
export type OptionsFirdaria = { isfirbonatti: boolean };

// Eclipse chart-moment radio (morin._set_eclipse_chart_moment_mode). One of the
// ECLIPSE_CHART_MOMENT_* string enums.
export type OptionsEclipses = {
  eclipse_chart_moment: string;
  prenatal_eclipse_mode: "solar_only" | "solar_and_lunar";
};

// One Swiss-Ephemeris fixed-star catalog row (fixstarsdlg.FixStarCatalog,
// fixstarsdlg.py:16-114). `code` is the catalog nomenclature (the
// options.fixstars key); lon/lat are pre-formatted display strings, lonValue/
// latValue the raw degrees for sorting. Empty `code` rows can't be selected.
export type FixedStarCatalogRow = {
  index: number;
  name: string;
  code: string;
  lon: string;
  lat: string;
  lonValue: number;
  latValue: number;
};

// Fixed-stars which-stars picker (fixstarsdlg.FixStarsDlg). The active set is the
// KEY set of options.fixstars (the per-star orbs are edited in the Orbs tab);
// selectedCodes carries those keys. aliasMap maps code -> display name. The skin
// renders a searchable checkbox list capped at maxSelected (200).
export type OptionsFixedStars = {
  catalog: FixedStarCatalogRow[];
  selectedCodes: string[];
  aliasMap: Record<string, string>;
  useIndianFixstarNames: boolean;
  maxSelected: number;
  defaultCodes: string[];
};

// Relationship-chart settings (compositeoptsdlg + synastry launcher radio).
export type OptionsRelationshipCharts = {
  composite_method: number; // 0=ASC midpoint, 1=ref place, 2=geo midpoint
  synastry_opens_composite_first: boolean;
};

// Language selection (langsdlg.LanguagesDlg). The daemon owns langid; chart and
// React localization both mirror it live. `available` is the bundled language
// list (mtexts.langtexts), value == langid.
export type OptionsLanguages = {
  langid: number;
  available: EnumChoice[];
};

// Supplementary quick-chart options (quickchartsoptdlg.QuickChartsOptDlg).
// progressed_angle_method / progression_day_type are the secondary-progression
// CALC options (posfordate enums); the rest are launcher/list behaviours
// persisted to the same quickcharts.opt file. Choice labels come from
// catalog.progressionAngleMethods / progressionDayTypes / quickchartsAnchorModes
// / secondaryLaunchModes / atReclickModes.
export type OptionsQuickCharts = {
  quickcharts_prompt: boolean;
  quickcharts_anchor_to_radix: number; // 0=Auto, 1=Parent
  timed_chart_show_radix_default: boolean;
  event_table_time_basis: "default_location" | "ut" | string;
  subcharts_open_compound_default: boolean;
  multiwheel_open_at_three: boolean;
  /** Concentric chart rings, 2..4. See webapp/daemon/chart_rings.py. */
  chart_ring_count: number;
  /** Zodiac band placement once rings stack. Ignored below three rings. */
  chart_ring_zodiac: "rim" | "centre";
  secondary_progression_launch_mode: number; // progression/transit launcher: 0=Chart, 1=Table, 2=Both
  aspectlist_prebirth_secondary_converse: boolean;
  at_reclick_behavior: string; // focus_only | focus_and_snap_now | new_tab
  progressed_angle_method: number; // posfordate.ANGLE_METHOD_NAMES key
  progression_day_type: number; // posfordate.PROGRESSION_DAY_TYPE_NAMES key
  harmonic_chart_mode: "harmonic" | "varga"; // default for newly opened division charts
  varga_drishti_mode: "off" | "parashari" | "jaimini";
  varga_node_special_drishti: boolean;
};

export type OptionsRevolutions = {
  revolutions_solaryearmode: number;
  revolutions_solarlocationmode: number;
  revolutions_lunarlocationmode: number;
  revolutions_planetslocationmode: number;
  revolutions_lunarparentmode: number;
  revolutions_solarreturnmode: string;
  revolutions_lunarreturnmode: string;
  revsidereal_marr_solar: boolean;
  revsidereal_marr_lunar: boolean;
  revsidereal_marr_planet: boolean;
};

/** One stored Arabic part (options.arabicparts row) as the daemon reads it
 * through the arabicparts.ArabicParts slot helpers
 * (options_service._read_planets_points). `formula` is the rendered display
 * string (the wx dialog's Formula column). */
/** One refdeg slot as the daemon stores it (arabicpartsdlg.py parts_refdeg
 * shapes): a DE absolute degree (int), a legacy lot-name reference (string),
 * or an embedded formula [a, b, c, subRefdeg]. Opaque to the skin — values
 * round-trip to the Python brain untouched. */
export type ArabicRefSlot = number | string | unknown[];

export type ArabicPartMeta = {
  index: number;
  name: string;
  formula: string;
  diurnal: boolean;
  active: boolean;
  gendered: boolean;
  hasFemaleFormula: boolean;
  hasNocturnalFormula: boolean;
  /** Raw calculator state (A/B/C integer codes + refdeg triplet) so the
   * editor can prefill without re-deriving anything. */
  codes: number[];
  refdeg: ArabicRefSlot[];
  femaleCodes: number[] | null;
  femaleRefdeg: ArabicRefSlot[] | null;
  nocturnalCodes: number[] | null;
  nocturnalRefdeg: ArabicRefSlot[] | null;
  nocturnalFormula: string | null;
  /** Embedded-formula pack other lots' RE pickers reference this row by
   * (arabicpartsdlg.py:1453-1457). Opaque. */
  embed: unknown[];
};

/** Full lot-formula editor state (options_service._build_part_from_fields /
 * preview_arabic_part). The Python brain owns all validation + formatting. */
export type ArabicPartSpec = {
  name: string;
  codes: number[];
  refdeg: ArabicRefSlot[];
  diurnal: boolean;
  gendered: boolean;
  femaleCodes?: number[] | null;
  femaleRefdeg?: ArabicRefSlot[] | null;
  nocturnalCodes?: number[] | null;
  nocturnalRefdeg?: ArabicRefSlot[] | null;
  active?: boolean;
};

/** Options > Planets/Points remainder (Nodes / Fortuna / Syzygy / Arabic
 * Parts) — options_service._read_planets_points. meannode is the bool
 * morin.onNodes writes (true=Mean Node). */
export type OptionsPlanetsPoints = {
  meannode: boolean;
  lotoffortune: number; // 0..2 (chart.py LFMOONSUN/LFDSUNMOON/LFDMOONSUN)
  syzmoon: number; // 0..2 (options.Options MOON/ABOVEHOR/ABOVEHORNATAL)
  arabicpartsref: number; // 0..11 (mtexts.partsreftxts)
  daynightorbdeg: number; // 0..6
  daynightorbmin: number; // 0..59
  parts: ArabicPartMeta[];
};

// ---------------------------------------------------------------------------
// Field-metadata catalog — the daemon-owned option-field oracle
// (options_service._read_catalog). The skin renders generic controls from this;
// it must not hardcode field lists, labels, enum choices or glyph chars. Glyph
// strings are Morinus.ttf chars (render with font-family: "AriesMorinus").
// ---------------------------------------------------------------------------

export type ColorFieldMeta = {
  attr: keyof OptionsColors;
  label: string;
  group: "chrome" | "chart" | "element" | "dignity";
};
export type IndividualColorMeta = { index: number; label: string; glyph: string };
export type EnumChoice = { value: number; label: string };
export type LocalizedEnumChoice = EnumChoice & { labelKey: string };
export type LocalizedDescribedEnumChoice = LocalizedEnumChoice & {
  descriptionKey: string;
};
export type StringEnumChoice = { value: string; label: string };
export type BoolEnumChoice = { value: boolean; label: string };
// A speculum column's metadata (options_service _SPECULUM_*_COLS): `idx` is the
// planets.Planet column index (the key in OptionsSpeculum.placidian/regiomontan),
// `label` is the mtexts caption the wx dialog used.
export type SpeculumColMeta = { idx: number; label: string };

/** A default-location field's metadata (options_service _DEFLOC_FIELD_CATALOG).
 * `kind` selects the generic control; `sign` fields carry the radio pair labels.
 * `attr` is the options.py def* key the value/patch is stored under. */
export type DefaultLocationFieldMeta = {
  attr: keyof OptionsDefaultLocation;
  label: string;
  kind: "name" | "int" | "sign" | "bool" | "text";
  min?: number;
  max?: number;
  positive?: string;
  negative?: string;
};

export type GlyphLabelMeta = { label: string; glyph: string };
export type StepAlertBodyMeta = { id: number; label: string; glyph: string };
export type StepAlertAngleMeta = { value: string; label: string };

/** A numeric-slider field's metadata (options_service _SLIDER_CATALOG). `kind`
 * selects int vs float coercion; the skin renders one generic slider per entry. */
export type SliderFieldMeta = {
  attr: keyof OptionsDisplay;
  label: string;
  min: number;
  max: number;
  step: number;
  kind: "int" | "float";
};

export type FontProfileMeta = {
  value: string;
  label: string;
  labelKey?: string;
};

/** A glyph-variant choice (symbolsdlg). `value` is the options.py value the
 * patch stores (bool for uranus/signs, int 0..3 for pluto); `glyph` is the
 * Morinus.ttf char that variant renders (render with font-family: "AriesMorinus"). */
export type SymbolVariantMeta = { value: boolean | number; glyph: string };

export type OptionsCatalog = {
  colorFields: ColorFieldMeta[];
  individualColors: IndividualColorMeta[];
  aspectLabels: string[]; // 12, engine order
  aspectGlyphs: string[]; // 12, Morinus chars aligned to aspectLabels
  fixstarsModes: EnumChoice[]; // showfixstars enum
  phasisModes: EnumChoice[]; // Phasis enum (options.Options.PHASIS_MODE_*)
  solarConditionModes: LocalizedDescribedEnumChoice[]; // combustion doctrine/profile choices
  cazimiModes: EnumChoice[]; // Cazimi enum (options.Options.CAZIMI_MODE_*)
  synodicModes: EnumChoice[]; // Synodic cycle event filter
  themeLayouts: EnumChoice[]; // wheel layout choice (theme 0/1/2)
  angloDenseLabelLayouts: StringEnumChoice[];
  mansionZodiacModes: StringEnumChoice[]; // manazil_zodiac choices (str values)
  speculumPlacidianCols: SpeculumColMeta[]; // Placidian speculum column oracle
  speculumRegiomontanCols: SpeculumColMeta[]; // Regiomontan speculum column oracle
  speculumSpeedModes: StringEnumChoice[]; // compact Inspector Speed display
  orbTargets: EnumChoice[]; // 0..10 planets/Nodes (Houses appended by skin)
  dignityScoreLabels: string[]; // 5, dignityscores order
  termSets: EnumChoice[]; // selterm choices (Egyptian/Ptolemaic)
  dignityPlanets: string[]; // 10 planet row labels (Sun..Pluto) for the grid
  dignityTypes: string[]; // 2 dignity-type columns (Domicile/Exaltation)
  termPlanets: EnumChoice[]; // term-ruler combo choices (Mercury=2..Saturn=6)
  symbolUranus: SymbolVariantMeta[]; // uranus glyph variants
  symbolPluto: SymbolVariantMeta[]; // standard Pluto glyph variants (2/3)
  defaultLocationFields: DefaultLocationFieldMeta[]; // saved-location field oracle
  transcendentalLabels: GlyphLabelMeta[]; // 3: U/N/P, aligned to display.transcendental
  stepAlertBodies: StepAlertBodyMeta[]; // aligned to stepAlerts body vectors
  stepAlertAngles: StepAlertAngleMeta[]; // aligned to stepAlerts angle vector
  sliders: SliderFieldMeta[]; // numeric-slider field oracle
  keypromptStyles: string[]; // accepted keyprompts_style enum values
  dateConventions: StringEnumChoice[]; // YYYY-MM-DD or DD.MM.YYYY
  fontProfiles: FontProfileMeta[]; // fontfamily enum
  // QuickChartsOptDlg choice catalogs (quickchartsoptdlg.py; posfordate.py)
  progressionAngleMethods: EnumChoice[]; // progressed_angle_method enum
  progressionDayTypes: EnumChoice[]; // progression_day_type enum
  quickchartsAnchorModes: EnumChoice[]; // quickcharts_anchor_to_radix enum
  secondaryLaunchModes: EnumChoice[]; // secondary_progression_launch_mode enum
  atReclickModes: StringEnumChoice[]; // at_reclick_behavior enum
  eventTableTimeModes: StringEnumChoice[]; // event_table_time_basis choices
  // Planets/Points choice catalogs (mtexts labels; options_service)
  nodeModes: EnumChoice[]; // meannode as 1=Mean / 0=True
  fortunaModes: (EnumChoice & { sublabel: string })[]; // lotoffortune 0..2
  syzygyModes: EnumChoice[]; // syzmoon 0..2
  arabicPartsRefs: EnumChoice[]; // arabicpartsref 0..11
  // Lot-formula calculator catalogs (options_service._arabic_part_terms —
  // mtexts.partstxts/conv, the wx A/B/C combo oracle). kind marks tokens that
  // unlock the inline RE/DE sub-controls.
  arabicPartTerms: { value: number; label: string; kind: "" | "RE" | "DE" }[];
  zodiacSigns: string[]; // 12 DE sign-picker labels
  lotOfFortuneName: string; // synthetic LoF row title / RE row-0 label
  // Relationship / eclipse / firdaria / almuten dialog choice catalogs
  // (options_service._read_catalog; compositeoptsdlg / firdariadlg / eclipse radio).
  compositeMethods: EnumChoice[]; // composite_method 0..2 (ASC method)
  compositeMCNote: string; // CompositeMCShortArc note
  compositeASCLabel: string; // CompositeASCLabel heading
  relationshipLauncherModes: BoolEnumChoice[]; // synastry_opens_composite_first
  eclipseModes: StringEnumChoice[]; // eclipse_chart_moment string enum
  firdariaModes: BoolEnumChoice[]; // isfirbonatti (True=Bonatus)
  almutenDignityLabels: string[]; // 5 dignity weight row labels
};

/** Live PrimDirs settings (the desktop PrimDirsLiveFrame, no OK/Cancel).
 * Every PrimDirsPanel control (primarydirsdlg.py fill()/check()) round-trips
 * here; the daemon owns all option logic, this is the raw payload shape. */
export type OptionsPrimaryDirections = {
  // House system + sub-mode
  primarydir: number;
  pddefaultdirection: number;
  subprimarydir: number;
  // Latitude (Use SZ) + doctrine flags
  subzodiacal: number;
  bianchini: boolean;
  morin_excentric: boolean;
  morin_antiscia: boolean;
  // Zodiacal options
  zodpromsigasps: boolean[]; // [aspectsOfProms->sigs, proms->aspectsOfSigs]
  ascmchcsasproms: boolean;
  pdcusppromissors: boolean;
  // Promissor grid
  promplanets: boolean[]; // 12: Sun..S.Node
  pdantiscia: boolean;
  pdmorinpromittorset: boolean; // Morin AG22 closed promittor set filter
  pdmidpoints: boolean;
  pdterms: boolean;
  pdfixstars: boolean;
  // Per-star PD selection (fixstarspddlg sub-dialog, option pdfixstarssel).
  // Parallel-bool list keyed by pdFixStarCatalog ordinal.
  pdfixstarssel: boolean[];
  pdFixStarCatalog: { ordinal: number; code: string; name: string }[];
  pdFixStarMaxSelected: number; // FixStarPDSelectionModel.MAX_SELECTED (200)
  pdsecmotion: boolean;
  pdsecmotioniter: number; // 0..2 (smiterList)
  pdpromchiron: boolean;
  pdpromarabicparts: boolean;
  pdpromarabicpartname: string;
  promlof: boolean; // pdlof[0]
  // Aspect grid
  pdaspects: boolean[]; // 12: Conjunction..Septile
  pdparallels: boolean[]; // 2: Parallel, RaptParallel
  // Significator grid
  sigangles: boolean[]; // 4: Asc, Dsc, MC, IC
  sighouses: boolean;
  sigplanets: boolean[]; // 12: Sun..S.Node
  siglof: boolean; // pdlof[1]
  pdsyzygy: boolean;
  pdsigchiron: boolean;
  pdsigvertex: boolean;
  pdsigarabicparts: boolean;
  pdsigarabicpartname: string;
  // Circumambulation method
  pdcircumoa: number; // 0=Ascensional Times, 1=Use PD Settings
  pdcircumprommode: number; // 0=Follow PD promissors/aspects, 1=Traditional classical set
  // Revolutions / annual / list view
  pdrevsunyearmode: number; // 0=365.242, 1=360
  pdrevannualmode: number; // legacy persisted field; annual PD now always uses Primary settings
  pdrevshownatalpromissors: boolean; // include natal radix promissors in return Directions/Circumambulations lists
  pdlistmode: number; // 0=Paged, 1=Continuous
  pdlistglyphcolors: boolean; // colored Morinus glyph rows in direction lists
  // PDs-in-Chart (pdsinchartdlgopts / pdsinchartterrdlgopts)
  pdincharttyp: 0 | 1; // 0=From the Planets, 1=Ecliptic Feet
  pdinchartterrsecmotion: boolean; // terrestrial chart secondary motion
  pdinchartreverse: boolean; // converse frame: true=fixed radix/outer promissors move; false=outer promissors fixed/inner significators move
  // Keys block
  pdkeydyn: boolean; // true=Dynamic, false=Static
  pdkeyd: number; // dynamic preset index (typeListDyn)
  pdkeys: number; // static preset index (typeListStat)
  pdkeydeg: number;
  pdkeymin: number;
  pdkeysec: number;
  pdkeycoeff: number; // read-only derived
  useregressive: boolean;
  // Customer points (primarydirsdlg.py customer-point blocks; daemon payload
  // already ships these from options_service._primary_directions_payload).
  pdcustomer: boolean;
  pdcustomerlon: number[]; // [deg, min, sec]
  pdcustomerlat: number[]; // [deg, min, sec]
  pdcustomersouthern: boolean;
  pdcustomer2: boolean;
  pdcustomer2lon: number[]; // [deg, min, sec]
  pdcustomer2lat: number[]; // [deg, min, sec]
  pdcustomer2southern: boolean;
  // Active Arabic-part names (promissor/significator picker source)
  arabicPartNames: string[];
};

export type SettingsRegistryTab = {
  id: string;
  labelKey: string;
  menuCommands: string[];
};

export type MirroredSettingDefinition = {
  id: string;
  group: "display";
  field: keyof OptionsDisplay;
  kind: "boolean";
  label: string;
  labelKey: string;
};

export type MirroredSettingsSection = {
  id: string;
  tabId: string;
  menuId: string;
  label: string;
  labelKey: string;
  settings: MirroredSettingDefinition[];
};

export type CorpusSemanticFieldDefinition = {
  key: keyof CorpusSemanticProfileSemantics;
  labelKey: string;
  options: Array<{ value: string; labelKey: string }>;
};

export type SettingsRegistry = {
  version: number;
  tabs: SettingsRegistryTab[];
  mirroredSections: MirroredSettingsSection[];
  themePresets: Array<{ name: string; mtextKey?: string }>;
  corpusSemanticFields: CorpusSemanticFieldDefinition[];
};

export type SidebarListPreferencesPayload = {
  schemaVersion: 2;
  aspectList: {
    mode: "primary" | "outer" | "outerToPrimary" | "primaryToOuter" | null;
    maxOrb: number;
    sortBy: "body" | "orb" | "exact";
    sortDirection: "asc" | "desc";
    focusedFilterIds: string[];
    focusMatchMode: "or" | "and";
    rxFocusEnabled: boolean;
    secondaryRingEnabledByMode: Record<string, boolean>;
    filterDrawerOpen: boolean;
  };
  transitList: {
    selectedPromittorId: string | null;
    promittorDrawerOpen: boolean;
    direction: "direct" | "converse" | "both";
  };
  synodicList: {
    ingressPlanetIds: number[];
    synodicPlanetIds: number[];
    lunarCycleIds: string[];
    ingressDrawerOpen: boolean;
    synodicDrawerOpen: boolean;
    lunarDrawerOpen: boolean;
  };
  secondaryProgressions: {
    planetIds: number[] | null;
    aspectIds: number[];
    filterDrawerOpen: boolean;
  };
  vimshottari: {
    anchor: "moon" | "ascendant";
    startStar: "janma" | "kshema" | "utpanna" | "adhana";
    yearDays: 365.25 | 360;
    ayanamsha: "follow_chart" | number;
  };
};

export type SidebarListPreferencesPatch = {
  aspectList?: Partial<SidebarListPreferencesPayload["aspectList"]>;
  transitList?: Partial<SidebarListPreferencesPayload["transitList"]>;
  synodicList?: Partial<SidebarListPreferencesPayload["synodicList"]>;
  secondaryProgressions?: Partial<SidebarListPreferencesPayload["secondaryProgressions"]>;
  vimshottari?: Partial<SidebarListPreferencesPayload["vimshottari"]>;
};

export type RetainedListDisplay = {
  /** Canonical semantic object ids excluded only from resident row projections. */
  hiddenObjectIds: string[];
};

export type OptionsAspectList = {
  /** False keeps derived/non-body outer points conjunction-only in Aspect List. */
  showAspectsForDerivedPoints: boolean;
  /** Destination used by the primary perfected-aspect date link. */
  perfectionLinkMode: "transits" | "secondary";
};

export type OptionsPayload = {
  colors: OptionsColors;
  display: OptionsDisplay;
  aspectList: OptionsAspectList;
  houseSystem: OptionsHouseSystem;
  ayanamsha: OptionsAyanamsha;
  orbs: OptionsOrbs;
  dignities: OptionsDignities;
  symbols: OptionsSymbols;
  lunarMansions: OptionsLunarMansions;
  speculum: OptionsSpeculum;
  defaultLocation: OptionsDefaultLocation;
  export: OptionsExport;
  primaryDirections: OptionsPrimaryDirections;
  revolutions: OptionsRevolutions;
  quickCharts: OptionsQuickCharts;
  stepAlerts: OptionsStepAlerts;
  profections: OptionsProfections;
  almutens: OptionsAlmutens;
  firdaria: OptionsFirdaria;
  eclipses: OptionsEclipses;
  fixedStars: OptionsFixedStars;
  relationshipCharts: OptionsRelationshipCharts;
  languages: OptionsLanguages;
  planetsPoints: OptionsPlanetsPoints;
  retainedListDataKey: string;
  retainedListDisplay: RetainedListDisplay;
  themePresets: ThemePreset[];
  themeState: ThemeState;
  catalog: OptionsCatalog;
  settingsRegistry: SettingsRegistry;
};

export type RevolutionLocationPredicate = {
  kind: "solar-revolution" | "lunar-revolution" | "planetary-return";
  planetType?: number | null;
  optionAttr: string;
  locationMode: "natal" | "ask";
  locationModeValue: number;
  shouldPrompt: boolean;
};

/** Grouped partial patch — mirrors GET shape, e.g. {houseSystem:{hsys:"R"}}. */
export type OptionsPatch = {
  colors?: Partial<Record<string, unknown>>;
  display?: Partial<OptionsDisplay>;
  aspectList?: Partial<OptionsAspectList>;
  houseSystem?: { hsys?: string; housesystem?: boolean };
  ayanamsha?: { ayanamsha?: number };
  orbs?: Partial<OptionsOrbs>;
  dignities?: Partial<Pick<
    OptionsDignities,
    "showterms" | "dignitylabelcolors" | "selterm" | "dignityscores" | "dignities" | "terms"
  >>;
  symbols?: Partial<OptionsSymbols>;
  lunarMansions?: Partial<OptionsLunarMansions>;
  speculum?: Partial<OptionsSpeculum>;
  defaultLocation?: Partial<OptionsDefaultLocation>;
  export?: Partial<OptionsExport>;
  primaryDirections?: Partial<OptionsPrimaryDirections>;
  revolutions?: Partial<OptionsRevolutions>;
  quickCharts?: Partial<OptionsQuickCharts>;
  stepAlerts?: Partial<OptionsStepAlerts>;
  /** Chart-Almuten scoring weights (options_service._apply_almutens —
   * almutenchartdlg.AlmutenChartDlg.check, almutenchartdlg.py:369-415). */
  almutens?: Partial<OptionsAlmutens>;
  /** Firdaria nocturnal order (options_service._apply_firdaria —
   * firdariadlg.FirdariaDlg.check, firdariadlg.py:81-85). */
  firdaria?: Partial<OptionsFirdaria>;
  /** Eclipse chart-moment radio (options_service._apply_eclipses —
   * morin._set_eclipse_chart_moment_mode, morin.py:958-976). */
  eclipses?: Partial<OptionsEclipses>;
  /** Fixed-stars which-stars picker (options_service._apply_fixed_stars —
   * fixstarsdlg.FixStarsDlg.check, fixstarsdlg.py:501-549). selectedCodes
   * becomes the options.fixstars key set (retained codes keep their orb, new
   * codes get def_fixstarsorb). useIndianFixstarNames changes only display
   * vocabulary; it never changes star identity or rebuilds charts. */
  fixedStars?: {
    selectedCodes?: string[];
    useIndianFixstarNames?: boolean;
  };
  /** Relationship-chart settings (options_service._apply_relationship_charts —
   * compositeoptsdlg + onRelChartsLauncherToggle, morin.py:20167-20228). */
  relationshipCharts?: Partial<OptionsRelationshipCharts>;
  /** Language selection (options_service._apply_languages — langsdlg). */
  languages?: Partial<Pick<OptionsLanguages, "langid">>;
  /** Annual-profections mode flags (options_service._apply_profections —
   * options.zodprof / usezodprojsprof via saveProfections, the persistent
   * write wx ProfectionsWnd._apply_profections_options performed,
   * profectionswnd.py:256-270). */
  profections?: {
    zodiacal?: boolean;
    useZodProjs?: boolean;
    wholeSign?: boolean;
    solarReturnSnap?: boolean;
  };
  /** Planets/Points group (options_service._apply_planets_points). Besides the
   * scalar fields, `partsActive` toggles stored parts' Active slots and
   * `removeIndex` deletes one part (which also invalidates options.topicals —
   * morin.py:19950-19953). */
  planetsPoints?: Partial<
    Pick<
      OptionsPlanetsPoints,
      | "meannode"
      | "lotoffortune"
      | "syzmoon"
      | "arabicpartsref"
      | "daynightorbdeg"
      | "daynightorbmin"
    >
  > & {
    partsActive?: { index: number; active: boolean }[];
    removeIndex?: number;
    /** Lot-formula calculator intents (options_service._apply_planets_points):
     * addPart appends one row (wx OnAdd), updatePart rewrites one row by index
     * (wx OnModify/_onLiveEdit), removeAll deletes every user part keeping the
     * synthetic LoF (wx OnRemoveAll). */
    addPart?: ArabicPartSpec;
    updatePart?: ArabicPartSpec & { index: number };
    removeAll?: boolean;
  };
};

/** Parse + format a candidate lot formula in the Python brain — the wx
 * calculator's live Formula column (POST /api/options/arabic-parts/preview).
 * Never assembled in TypeScript. */
export async function previewArabicPart(
  spec: Omit<ArabicPartSpec, "name"> & { name?: string },
  signal?: AbortSignal,
): Promise<{ formulaText: string; femaleFormulaText: string | null; nocturnalFormulaText: string | null }> {
  const response = await daemonFetch(`${daemonBaseUrl()}/api/options/arabic-parts/preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(spec),
    signal,
  });
  if (!response.ok) {
    throw new Error(await response.text().catch(() => `preview failed: ${response.status}`));
  }
  return (await response.json()) as {
    formulaText: string;
    femaleFormulaText: string | null;
    nocturnalFormulaText: string | null;
  };
}

/** Export text byte-compatible with the wx OnExport JSON file — serialized by
 * Python (GET /api/options/arabic-parts/export). */
export async function exportArabicParts(): Promise<string> {
  const response = await daemonFetch(`${daemonBaseUrl()}/api/options/arabic-parts/export`, {
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`arabic-parts export failed: ${response.status}`);
  }
  return await response.text();
}

/** Append parts from a JSON export with wx OnImport semantics (duplicates/
 * invalid skipped, name refs resolved server-side). Returns the refreshed
 * options payload plus imported/skipped/unresolved counts. */
export async function importArabicParts(
  parts: unknown[],
): Promise<OptionsPayload & { imported: number; skipped: number; unresolved: number }> {
  const response = await daemonFetch(`${daemonBaseUrl()}/api/options/arabic-parts/import`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ parts }),
  });
  if (!response.ok) {
    throw new Error(await response.text().catch(() => `import failed: ${response.status}`));
  }
  return (await response.json()) as OptionsPayload & {
    imported: number;
    skipped: number;
    unresolved: number;
  };
}

export async function fetchOptions(signal?: AbortSignal): Promise<OptionsPayload> {
  const response = await daemonFetch(`${daemonBaseUrl()}/api/options`, { cache: "no-store", signal });
  if (!response.ok) {
    throw new Error(`options fetch failed: ${response.status}`);
  }
  return (await response.json()) as OptionsPayload;
}

export async function fetchSidebarListPreferences(
  signal?: AbortSignal,
): Promise<SidebarListPreferencesPayload> {
  const response = await daemonFetch(
    `${daemonBaseUrl()}/api/options/sidebar-list-preferences`,
    { cache: "no-store", signal },
  );
  if (!response.ok) {
    throw new Error(`sidebar list preferences fetch failed: ${response.status}`);
  }
  return (await response.json()) as SidebarListPreferencesPayload;
}

export async function patchSidebarListPreferences(
  patch: SidebarListPreferencesPatch,
  signal?: AbortSignal,
): Promise<SidebarListPreferencesPayload> {
  const response = await daemonFetch(
    `${daemonBaseUrl()}/api/options/sidebar-list-preferences`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify(patch),
      signal,
    },
  );
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `sidebar list preferences patch failed: ${response.status} ${detail}`,
    );
  }
  return (await response.json()) as SidebarListPreferencesPayload;
}

export async function fetchThemeState(signal?: AbortSignal): Promise<ThemeState> {
  const response = await daemonFetch(`${daemonBaseUrl()}/api/options/theme-state`, {
    cache: "no-store",
    signal,
  });
  if (!response.ok) {
    throw new Error(`theme state fetch failed: ${response.status}`);
  }
  return (await response.json()) as ThemeState;
}

export async function fetchStyleProfiles(signal?: AbortSignal): Promise<StyleProfilesPayload> {
  const response = await daemonFetch(`${daemonBaseUrl()}/api/options/style-profiles`, {
    cache: "no-store",
    signal,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`style profiles fetch failed: ${response.status} ${detail}`);
  }
  return (await response.json()) as StyleProfilesPayload;
}

export async function saveStyleProfile(
  profile: StyleProfileInput,
  activate = false,
  signal?: AbortSignal,
): Promise<StyleProfileMutationResult> {
  const response = await daemonFetch(`${daemonBaseUrl()}/api/options/style-profiles`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({ profile, activate }),
    signal,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`style profile save failed: ${response.status} ${detail}`);
  }
  return (await response.json()) as StyleProfileMutationResult;
}

export async function importStyleProfile(
  profile: StyleProfileInput,
  activate = false,
  signal?: AbortSignal,
): Promise<StyleProfileMutationResult> {
  const response = await daemonFetch(`${daemonBaseUrl()}/api/options/style-profiles/import`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({ profile, activate }),
    signal,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`style profile import failed: ${response.status} ${detail}`);
  }
  return (await response.json()) as StyleProfileMutationResult;
}

export async function activateStyleProfile(
  profileId: string | null,
  signal?: AbortSignal,
): Promise<StyleProfileMutationResult> {
  const response = await daemonFetch(`${daemonBaseUrl()}/api/options/style-profiles/activate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({ profileId }),
    signal,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`style profile activation failed: ${response.status} ${detail}`);
  }
  return (await response.json()) as StyleProfileMutationResult;
}

export async function deleteStyleProfile(
  profileId: string,
  signal?: AbortSignal,
): Promise<StyleProfileMutationResult> {
  const response = await daemonFetch(
    `${daemonBaseUrl()}/api/options/style-profiles/${encodeURIComponent(profileId)}`,
    { method: "DELETE", cache: "no-store", signal },
  );
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`style profile delete failed: ${response.status} ${detail}`);
  }
  return (await response.json()) as StyleProfileMutationResult;
}

export async function fetchStyleProfileExport(
  profileId: string,
  signal?: AbortSignal,
): Promise<StyleProfile> {
  const response = await daemonFetch(
    `${daemonBaseUrl()}/api/options/style-profiles/${encodeURIComponent(profileId)}/export`,
    { cache: "no-store", signal },
  );
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`style profile export failed: ${response.status} ${detail}`);
  }
  return (await response.json()) as StyleProfile;
}

export async function migrateLegacyStyleTokens(
  values: Record<string, unknown>,
  activate = true,
  signal?: AbortSignal,
): Promise<StyleProfileMutationResult & {
  migration: {
    sourceHash: string;
    profile: StyleProfile | null;
    rejected: string[];
    alreadyMigrated: boolean;
  };
}> {
  const response = await daemonFetch(`${daemonBaseUrl()}/api/options/style-profiles/migrate-legacy`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({ values, activate }),
    signal,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`legacy style migration failed: ${response.status} ${detail}`);
  }
  return (await response.json()) as StyleProfileMutationResult & {
    migration: {
      sourceHash: string;
      profile: StyleProfile | null;
      rejected: string[];
      alreadyMigrated: boolean;
    };
  };
}

export type QuickchartsPromptPredicate = {
  shouldPrompt: boolean;
};

export type ProgressionLaunchPredicate = {
  mode: 0 | 1 | 2;
};

/** Saved quick-chart prompt predicate (morin._should_prompt_quickcharts,
 * morin.py:11607 reading options.quickcharts_prompt). Gates the profections
 * source-datetime prompt; React never infers it locally. */
export async function fetchQuickchartsPromptPredicate(
  signal?: AbortSignal,
): Promise<QuickchartsPromptPredicate> {
  const response = await daemonFetch(
    `${daemonBaseUrl()}/api/options/quickcharts-prompt-predicate`,
    { cache: "no-store", signal },
  );
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`quickcharts prompt predicate failed: ${response.status} ${detail}`);
  }
  return (await response.json()) as QuickchartsPromptPredicate;
}

/** Saved Chart/Table/Both launcher mode.
 * Source is morin._secondary_progression_launch_mode (morin.py:11620). The
 * webapp reuses the same setting for Transits so chart/list recall behaves like
 * list-capable progressions. */
export async function fetchProgressionLaunchPredicate(
  signal?: AbortSignal,
): Promise<ProgressionLaunchPredicate> {
  const response = await daemonFetch(
    `${daemonBaseUrl()}/api/options/progression-launch-predicate`,
    { cache: "no-store", signal },
  );
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`progression launch predicate failed: ${response.status} ${detail}`);
  }
  return (await response.json()) as ProgressionLaunchPredicate;
}

export async function fetchRevolutionLocationPredicate(
  kind: RevolutionLocationPredicate["kind"],
  planetType?: number | null,
  signal?: AbortSignal,
): Promise<RevolutionLocationPredicate> {
  const search = new URLSearchParams({ kind });
  if (planetType != null) search.set("planetType", String(planetType));
  const response = await daemonFetch(
    `${daemonBaseUrl()}/api/options/revolution-location-predicate?${search.toString()}`,
    { cache: "no-store", signal },
  );
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`revolution location predicate failed: ${response.status} ${detail}`);
  }
  return (await response.json()) as RevolutionLocationPredicate;
}

/** Apply a grouped partial patch; the daemon re-renders every open chart and
 * broadcasts options.changed. Returns the resulting full options payload. */
export async function patchOptions(
  patch: OptionsPatch,
  signal?: AbortSignal,
): Promise<OptionsPayload> {
  const response = await daemonFetch(`${daemonBaseUrl()}/api/options`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify(patch),
    signal,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`options patch failed: ${response.status} ${detail}`);
  }
  return (await response.json()) as OptionsPayload;
}

/** Write an exact map-selected location into the saved default-location options.
 * Mirrors morin._astrocart_set_default_location (morin.py:16664): the Python
 * brain reverse-resolves the place name + timezone for the clicked lon/lat,
 * writes/persists the same defloc* group (signed decimals plus synchronized
 * legacy degree/minute fields) the Default Location tab patches, and
 * broadcasts options.changed. Returns the resolved place name + the new
 * defaultLocation group so the settings tab can reconcile without a refetch. */
export async function setDefaultLocationFromMap(
  lon: number,
  lat: number,
  placeName: string,
  signal?: AbortSignal,
): Promise<{ placeName: string; defaultLocation: OptionsDefaultLocation }> {
  const response = await daemonFetch(`${daemonBaseUrl()}/api/options/default-location/from-map`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({ lon, lat, placeName }),
    signal,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`set default location failed: ${response.status} ${detail}`);
  }
  return (await response.json()) as {
    placeName: string;
    defaultLocation: OptionsDefaultLocation;
  };
}

/** Apply a colorsdlg palette preset by name; writes chart/body/aspect colors and
 * the OS-follow flag, then re-renders open charts. */
export async function applyThemePreset(
  name: string,
  signal?: AbortSignal,
): Promise<OptionsPayload> {
  const response = await daemonFetch(`${daemonBaseUrl()}/api/options/theme`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({ name }),
    signal,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`theme preset failed: ${response.status} ${detail}`);
  }
  return (await response.json()) as OptionsPayload;
}

/** Restore colorsdlg's factory default color table and re-render open charts. */
export async function resetColorDefaults(signal?: AbortSignal): Promise<OptionsPayload> {
  const response = await daemonFetch(`${daemonBaseUrl()}/api/options/colors/defaults`, {
    method: "POST",
    cache: "no-store",
    signal,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`color defaults failed: ${response.status} ${detail}`);
  }
  return (await response.json()) as OptionsPayload;
}

/** Restore Default — reset EVERY option to factory defaults and delete the
 * persisted user pickles (morin.onReload, morin.py:21034), then re-render. */
export async function resetAllDefaults(signal?: AbortSignal): Promise<OptionsPayload> {
  const response = await daemonFetch(`${daemonBaseUrl()}/api/options/defaults`, {
    method: "POST",
    cache: "no-store",
    signal,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`restore defaults failed: ${response.status} ${detail}`);
  }
  return (await response.json()) as OptionsPayload;
}

/** Advance the radix secondary-view overlay one step (Ctrl+G). Headless analogue
 * of morin.onCycleNatalSecondaryRing — the daemon cycles options.showfixstars and
 * re-renders open charts. Returns the full options payload (+ the new mode). */
export async function cycleSecondaryView(
  signal?: AbortSignal,
): Promise<OptionsPayload & { showfixstars: number }> {
  const response = await daemonFetch(`${daemonBaseUrl()}/api/options/cycle-secondary`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    signal,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`cycle secondary failed: ${response.status} ${detail}`);
  }
  return (await response.json()) as OptionsPayload & { showfixstars: number };
}

/** Toggle the "Houses" appearance option (H). Headless analogue of
 * morin.onToggleHouses — the daemon flips options.houses, re-renders open
 * charts, and broadcasts options.changed. Returns the options payload (+ the
 * new value). */
export async function toggleHouses(
  signal?: AbortSignal,
): Promise<OptionsPayload & { houses: boolean }> {
  const response = await daemonFetch(`${daemonBaseUrl()}/api/options/toggle-houses`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    signal,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`toggle houses failed: ${response.status} ${detail}`);
  }
  return (await response.json()) as OptionsPayload & { houses: boolean };
}

/** Toggle the Appearance Aspects master flag (A). The daemon preserves dependent
 * aspect interaction prefs and refreshes only the visible draw layer. */
export async function toggleAspects(
  signal?: AbortSignal,
): Promise<OptionsPayload & { aspects: boolean }> {
  const response = await daemonFetch(`${daemonBaseUrl()}/api/options/toggle-aspects`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    signal,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`toggle aspects failed: ${response.status} ${detail}`);
  }
  return (await response.json()) as OptionsPayload & { aspects: boolean };
}

/** Toggle the Appearance minor-aspect draw flags as one group (M). The daemon
 * flips semisextile, semisquare, quintile, sesquisquare, biquintile, quincunx,
 * and septile, then refreshes open charts. */
export async function toggleMinorAspects(
  signal?: AbortSignal,
): Promise<OptionsPayload & { minorAspects: boolean }> {
  const response = await daemonFetch(`${daemonBaseUrl()}/api/options/toggle-minor-aspects`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    signal,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`toggle minor aspects failed: ${response.status} ${detail}`);
  }
  return (await response.json()) as OptionsPayload & { minorAspects: boolean };
}

// ---------------------------------------------------------------------------
// Workspace commands — the daemon owns ONE WorkspaceSessionController (slice 2).
// React mirrors the daemon's tree; mutations are commands, not local Zustand
// writes. Spec: doc/migration/surfaces/workspace-daemon.md.
//
// The daemon's per-document summary (workspace_service._document_summary) is the
// canonical document identity. Every field below is verbatim from that payload
// — never re-derived client-side.
// ---------------------------------------------------------------------------

export type DaemonDocumentSummary = {
  documentId: string;
  kind: string; // always "chart" today (the controller has one doc kind)
  title: string; // includes the dirty "*" suffix from the controller
  // Stable semantic title key when the daemon can provide one (table.<id>;
  // supplementary.*). The frontend renders the active locale and uses `title`
  // only as the data-bearing/backward-compatible fallback.
  titleKey?: string | null;
  subtitle: string; // chart name — the radix sourceName for root + derived
  sourceName: string; // daemon session label: chart name, comparison source, or scratch title
  path: string;
  parentDocumentId: string | null;
  indentLevel: number;
  featureKind: string | null; // engine feature kind (e.g. "solar_return")
  launcherKind: string | null; // launch route (e.g. "synastry", "astrocart")
  chartVisualMode?: "zodiac" | "mdo" | "mundane" | "ascensional_transits" | string;
  comparisonName: string | null; // synastry partner / astrocart source name
  compoundKind?: string | null; // synastry/composite session kind, daemon-owned
  compositeVariant?: string | null; // midpoint | davison when compoundKind is composite
  dirty: boolean;
  editDirty: boolean;
  stepDirty: boolean;
  fpath: string;
  displayDatetime: string | null;
  symbolicTime?: SymbolicTimeReadout | null;
  tabSuffix: string | null;
  /** wx horary tab format: "Name (Wkdy date time)" (morin.py:4734). */
  isHorary?: boolean;
  /** Saved horary lens mirrored on the chart (chrt.interpretation) — adopted
   * into inspectorLens on activation (morin.py:9073-9083; round-trip
   * chartfile.py:82-163/276-282). Horary docs only. */
  interpretation?: InspectorLensPayload | null;
  isActive: boolean;
  searchInitialSignificatorId: string | null;
  searchInitialLabel: string;
  searchInitialGlyph: string;
  directionsCustomSignificator?: DirectionCustomSignificator | null;
  directionsDefaultDirection?: number | null;
  tableId: string | null;
  tableBinding?: Record<string, unknown> | null;
  // Solar-eclipse path overlay carried by astrocart docs opened via
  // "Show Eclipse Path on Map" (morin.py:16211-16227 wx twin).
  eclipseEvent?: { jdUt: number; retflag: number } | null;
  ascensionalEventJd?: number | null;
  ascensionalEventPlace?: Record<string, unknown> | null;
  ascensionalFilterToActiveMoment?: boolean | null;
  ascensionalApplyPrecession?: boolean | null;
  // RUNTIME session gate keyed by skin dispatch id (workspace_service
  // ._enabled_actions, the wx-free twin of morin._workspace_navigation_state).
  // True == this launcher is allowed for THIS session right now (has_chart /
  // return availability / composite gate). The skin greys/omits a launcher from the
  // active document's map; it never recomputes has_chart in TS.
  enabledActions: Record<string, boolean>;
};

export type WorkspaceStatePayload = {
  documents: DaemonDocumentSummary[];
  activeDocumentId: string | null;
  snapshot?: ChartRenderSnapshot;
};

// ---------------------------------------------------------------------------
// Workspace manifest — the sidebar launcher catalog + keyboard-shortcut map.
// The daemon (manifest_service) sources both from the canonical wx-free
// structures (workspace_model.DEFAULT_SECTIONS/DEFAULT_TOP_ACTIONS +
// shortcut_registry). The skin renders the sidebar and the shortcuts overlay
// from this — it owns NEITHER catalog ("stupid skin"). Action `id`s are the
// exact dispatch ids home-client.handleSelect handles (new/open/now/synastry/
// astrocartography + supplementary public kinds); not-yet-built tabs come back
// `enabled: false` so the skin can grey/omit them.
// ---------------------------------------------------------------------------

/** A body the planetary-return launcher can target (daemon-owned: mirrors
 * revolutions.Revolutions.PLANETARY_SPECS — Mercury/Venus/Mars/Jupiter/Saturn).
 * planetType is the int the open route threads to the planetary-return adapter. */
export type PlanetaryReturnBody = {
  planetType: number;
  label: string;
};

export type SidebarAction = {
  id: string; // skin dispatch id (or canonical id for enabled:false actions)
  label: string;
  enabled: boolean;
  shortcut?: string;
  // planetary-return only: the bodies to offer in a body-picker before opening.
  bodies?: PlanetaryReturnBody[];
};

export type SidebarGroup = {
  id: string;
  label: string;
  collapsed: boolean;
  actions: SidebarAction[];
};

export type ShortcutEntry = {
  /** Display chord/glyph(s) for the key, e.g. "T", "⌘ F", "⇧ + ← / →". */
  keys: string;
  label: string;
  /** Desktop overlay section title (TIME STEP / CHART MODES / VIEW / WORKSPACE),
   * sourced from shortcut_registry.SHORTCUT_HELP_GROUPS — NOT an invented scope. */
  group: string;
  /** Skin dispatch id when this row maps to a launcher (CHART MODES rows). */
  commandId?: string;
  /** Stable frontend catalog key for retained/native shortcuts whose handler
   * does not have a command id. */
  labelKey?: string;
  /** True when the web skin actually binds this key today; false rows are
   * reference-only (desktop accelerators / not-yet-wired quick keys) so the
   * overlay can grey them instead of advertising dead keys. */
  bound: boolean;
  /** Bound but deliberately absent from Help and public shortcut lists. */
  hidden?: boolean;
};

export type NativeMenuNode =
  | { type: "separator" }
  | {
      type: "item" | "check";
      id: string;
      label: string;
      // Stable i18n key (Options submenu); the frontend translates it from the
      // shared catalog when relabeling the native menu. Absent = use label.
      labelKey?: string;
      enabled?: boolean;
      checked?: boolean;
      accelerator?: string;
      status?: string;
      runtimeEnablement?: "active-chart";
      runtimeActionId?: string;
      source?: string;
      deferredTo?: string;
    }
  | {
      type: "submenu";
      id: string;
      label: string;
      labelKey?: string;
      enabled?: boolean;
      status?: string;
      runtimeEnablement?: "active-chart";
      runtimeActionId?: string;
      source?: string;
      deferredTo?: string;
      children: NativeMenuNode[];
    };

export type NativeMenuManifest = {
  version: number;
  source: string;
  menus: NativeMenuNode[];
};

export type WorkspaceManifest = {
  groups: SidebarGroup[];
  topActions: SidebarAction[];
  shortcuts: ShortcutEntry[];
  nativeMenu?: NativeMenuManifest;
  settingsRegistry?: SettingsRegistry;
};

export type WorkspaceContextMenuNode =
  | { type: "separator" }
  | {
      type: "item";
      label: string;
      // Stable i18n key for static labels — the frontend renders t(labelKey)
      // and falls back to `label`. Dynamic labels (chart names) omit it.
      labelKey?: string;
      disabled?: boolean;
      actionId?: string;
      payload?: Record<string, unknown>;
    }
  | {
      type: "checkbox";
      label: string;
      labelKey?: string;
      checked: boolean;
      inset?: boolean;
      disabled?: boolean;
      actionId?: string;
      payload?: Record<string, unknown>;
    }
  | {
      type: "radioGroup";
      value: string;
      children: WorkspaceContextMenuNode[];
    }
  | {
      type: "radio";
      label: string;
      labelKey?: string;
      value: string;
      disabled?: boolean;
      actionId?: string;
      payload?: Record<string, unknown>;
    }
  | {
      type: "submenu";
      label: string;
      labelKey?: string;
      disabled?: boolean;
      children: WorkspaceContextMenuNode[];
    };

export type WorkspaceContextMenuPayload = {
  items: WorkspaceContextMenuNode[];
  // The daemon's normalized view of the clicked hit-test region (the region
  // CHANNEL — workspace_service._normalize_region). Echoed so the skin can
  // confirm the right-click region survived to the menu builder; the skin holds
  // no meaning, it only forwards this descriptor and renders the returned items.
  region?: Record<string, unknown> | null;
};

/** Fetch the daemon-owned sidebar catalog + shortcut map (manifest_service). */
export async function fetchWorkspaceManifest(
  signal?: AbortSignal,
): Promise<WorkspaceManifest> {
  const response = await daemonFetch(`${daemonBaseUrl()}/api/workspace/manifest`, {
    cache: "no-store",
    signal,
  });
  if (!response.ok) {
    throw new Error(`workspace manifest failed: ${response.status}`);
  }
  return (await response.json()) as WorkspaceManifest;
}

export async function setWorkspaceSidebarSectionCollapsed(
  sectionLabel: string,
  collapsed: boolean,
  signal?: AbortSignal,
): Promise<WorkspaceManifest> {
  const response = await daemonFetch(`${daemonBaseUrl()}/api/workspace/sidebar-section-collapsed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    signal,
    body: JSON.stringify({ sectionLabel, collapsed }),
  });
  if (response.status === 404) {
    // Older already-running daemons do not have this persistence endpoint yet.
    // Keep the caller's optimistic UI state and refresh whatever manifest the
    // daemon can currently provide; a daemon restart restores persistence.
    return fetchWorkspaceManifest(signal);
  }
  if (!response.ok) {
    throw new Error(`sidebar section collapse failed: ${response.status}`);
  }
  return (await response.json()) as WorkspaceManifest;
}

export async function setWorkspaceSidebarActionOrder(
  sectionLabel: string,
  actionId: string,
  beforeId: string | null,
  signal?: AbortSignal,
): Promise<WorkspaceManifest> {
  const response = await daemonFetch(`${daemonBaseUrl()}/api/workspace/sidebar-action-order`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    signal,
    body: JSON.stringify({ sectionLabel, actionId, beforeId }),
  });
  if (response.status === 404) {
    // See setWorkspaceSidebarSectionCollapsed: this avoids reverting local
    // drag state while a stale daemon from before the route addition is alive.
    return fetchWorkspaceManifest(signal);
  }
  if (!response.ok) {
    throw new Error(`sidebar action order failed: ${response.status}`);
  }
  return (await response.json()) as WorkspaceManifest;
}

export async function fetchWorkspaceContextMenu(
  params: { docId?: string | null; region?: unknown | null },
  signal?: AbortSignal,
): Promise<WorkspaceContextMenuPayload> {
  return workspacePost<WorkspaceContextMenuPayload>(
    "/api/workspace/context-menu",
    { docId: params.docId ?? null, region: params.region ?? null },
    signal,
  );
}

export async function fetchWorkspaceDocumentContextMenu(
  docId: string,
  signal?: AbortSignal,
): Promise<WorkspaceContextMenuPayload> {
  return workspacePost<WorkspaceContextMenuPayload>(
    "/api/workspace/document-context-menu",
    { docId },
    signal,
  );
}

export async function executeWorkspaceContextMenuAction(
  actionId: string,
  payload?: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  return workspacePost<Record<string, unknown>>(
    "/api/workspace/context-menu/action",
    { actionId, payload: payload ?? {} },
    signal,
  );
}

// --- Surveil studies (daemon surveil_service store; morin.py:1208-1834) ------
// The mark TOGGLE + active-study CLEAR ride the chart context-menu action route
// (surveil.toggle_mark / surveil.clear_study). These functions own the studies
// MANAGEMENT surface (the wx onSurveilStudies dialog meaning): list/create/
// activate studies, per-mark enable/remove, clear, and Open-Radix.

export type SurveilStudySummary = {
  name: string;
  count: number;
  enabledCount: number;
};

export type SurveilStudiesPayload = {
  activeStudy: string;
  studies: SurveilStudySummary[];
};

export type SurveilMarkRow = {
  id: string;
  longitude: number;
  label: string;
  displayLabel: string;
  glyph: string;
  glyphFont: "morinus" | "text";
  sourceName: string;
  sourceRef: Record<string, unknown>;
  enabled: boolean;
  openable: boolean;
};

export type SurveilMarksPayload = {
  study: string;
  marks: SurveilMarkRow[];
};

export async function fetchSurveilStudies(
  signal?: AbortSignal,
): Promise<SurveilStudiesPayload> {
  const response = await daemonFetch(`${daemonBaseUrl()}/api/surveil/studies`, {
    cache: "no-store",
    signal,
  });
  if (!response.ok) {
    throw new Error(`surveil studies failed: ${response.status}`);
  }
  return (await response.json()) as SurveilStudiesPayload;
}

export async function fetchSurveilMarks(
  study?: string,
  signal?: AbortSignal,
): Promise<SurveilMarksPayload> {
  const query = study ? `?study=${encodeURIComponent(study)}` : "";
  const response = await daemonFetch(`${daemonBaseUrl()}/api/surveil/marks${query}`, {
    cache: "no-store",
    signal,
  });
  if (!response.ok) {
    throw new Error(`surveil marks failed: ${response.status}`);
  }
  return (await response.json()) as SurveilMarksPayload;
}

export async function surveilCreateStudy(
  name: string,
  signal?: AbortSignal,
): Promise<{ ok: boolean; error?: string }> {
  return workspacePost("/api/surveil/studies/create", { name }, signal);
}

export async function surveilSetActiveStudy(
  name: string,
  signal?: AbortSignal,
): Promise<{ ok: boolean; error?: string }> {
  return workspacePost("/api/surveil/studies/activate", { name }, signal);
}

export async function surveilSetMarkEnabled(
  study: string,
  markId: string,
  enabled: boolean,
  signal?: AbortSignal,
): Promise<{ ok: boolean; error?: string }> {
  return workspacePost(
    "/api/surveil/marks/enabled",
    { study, markId, enabled },
    signal,
  );
}

export async function surveilRemoveMark(
  study: string,
  markId: string,
  signal?: AbortSignal,
): Promise<{ ok: boolean; changed?: boolean }> {
  return workspacePost("/api/surveil/marks/remove", { study, markId }, signal);
}

export async function surveilClearStudy(
  name: string,
  signal?: AbortSignal,
): Promise<{ ok: boolean; changed?: boolean }> {
  return workspacePost("/api/surveil/studies/clear", { name }, signal);
}

export async function surveilOpenSource(
  sourceRef: Record<string, unknown> | null,
  sourceName: string,
  signal?: AbortSignal,
): Promise<{ ok: boolean; error?: string; activeDocumentId?: string | null }> {
  return workspacePost(
    "/api/surveil/open-source",
    { sourceRef: sourceRef ?? {}, sourceName },
    signal,
  );
}

export type WorkspaceOpenResult = {
  documentId: string | null;
  activeDocumentId?: string | null;
  documents: DaemonDocumentSummary[];
  reused?: boolean;
  reclickBehavior?: string;
  chartVisualMode?: "zodiac" | "mdo" | "mundane" | "ascensional_transits" | string;
  snapshot?: ChartRenderSnapshot;
};

export type WorkspaceCloseResult = {
  closedIds: string[];
  cascaded: boolean;
  /** Dirty + file-backed + owns-radix docs the React modal must confirm before
   * the close finalizes (morin.py:11529-11551 predicate, computed daemon-side). */
  promptWorthyIds: string[];
  nextActiveId: string | null;
  activeDocumentId?: string | null;
  snapshotInvalidatedIds?: string[];
  documents: DaemonDocumentSummary[];
  snapshot?: ChartRenderSnapshot;
};

export type WorkspaceNavigateResult = {
  documentId: string;
  stepped: boolean;
  displayDatetime: string | null;
  documents: DaemonDocumentSummary[];
  /** The freshly-rendered chart for the stepped doc, attached to the POST
   * response so the skin paints from THIS result instead of waiting for
   * session.changed -> a second snapshot GET. ``step_fast`` is a live visible
   * wheel frame; it still repaints geometry, bodies, outer labels, and hover
   * regions from the stepped snapshot. Absent when the step didn't move the
   * cursor or the doc has no chart session. */
  snapshot?: ChartRenderSnapshot;
};

export type GenericTableCellRun = {
  text: string;
  glyph?: boolean;
  /** Localized semantic text for the canonical plain-text export. Morinus glyph bytes
   * remain presentation-only and must never leak into a text file. */
  exportText?: string;
  /** Unicode aspect mark or compact fallback for symbolic list exports. */
  exportSymbolText?: string;
  /** Stable planet id when the run is a planet-identity glyph
   * (midpointswnd.py pair cells color p1/p2 independently). */
  planet?: number;
  /** Daemon-resolved CSS color for this run (wx useplanetcolors/dignity palette). */
  color?: string;
  /** Stable chart-palette CSS role; `color` remains the literal fallback. */
  colorRole?: string | null;
};

export type GenericTableCell = {
  text?: string;
  glyph?: string;
  runs?: GenericTableCellRun[];
  /** Localized semantic text for the canonical plain-text export. */
  exportText?: string;
  /** Unicode aspect mark or compact fallback for symbolic list exports. */
  exportSymbolText?: string;
  align?: "left" | "center" | "right" | string;
  /** Optional daemon-owned primitive sort key for cells whose display is
   * glyph-rich or localized (longitude, RA, declination, etc.). */
  sortValue?: string | number | null;
  /** Stable planet id when the cell is a planet-identity glyph. */
  planet?: number;
  /** Daemon-resolved CSS color (wx useplanetcolors/dignity palette). */
  color?: string;
  /** Stable chart-palette CSS role; `color` remains the literal fallback. */
  colorRole?: string | null;
  /** "strong" renders bold; mirrors wx bold-row/bold-cell semantics. */
  emphasis?: string;
  /** Named text face for script-specific scholarly data. */
  fontRole?: "arabic" | string;
  dir?: "rtl" | "ltr" | "auto";
};

export type GenericTableColumn = {
  id: string;
  label: string;
  /** Localized semantic header used when label is a Morinus glyph. */
  exportLabel?: string;
  /** Unicode aspect mark or compact fallback for a symbolic header. */
  exportSymbolLabel?: string;
  align?: "left" | "center" | "right" | string;
  kind?: "text" | "glyph" | string;
  /** Render the header label in the Morinus glyph font (profections body /
   * fortune headers, profectionswnd.py:383-395). */
  headerGlyph?: boolean;
  /** Relative wx column width (profectiontable.get_column_width: Age=3, rest=7). */
  widthFactor?: number;
  /** Daemon-resolved header colour (profectiontable.get_body_header_color). */
  colorHex?: string | null;
  /** Stable chart-palette CSS role; `colorHex` remains the literal fallback. */
  colorRole?: string | null;
};

export type GenericTableRow = {
  id: string;
  cells: GenericTableCell[];
  current?: boolean;
  meta?: Record<string, unknown>;
  /** "strong" renders the whole row bold (wx bold-row predicates). */
  emphasis?: string;
  temporal?: TemporalRowMeta;
};

/** Axis entry for matrix-shaped tables (aspectswnd.py planet/angle/house headers). */
export type AspectMatrixAxisEntry = {
  id: string;
  planet?: number;
  glyph?: string;
  glyphFont?: "morinus" | "text" | string;
  label?: string;
  color?: string;
  colorRole?: string | null;
};

/** One matrix square: aspect glyph + orb + applying/exact/parallel marks
 * (aspectswnd.py:265-457). Orb is always present; glyph only when shown. */
export type AspectMatrixCell = {
  orb: string;
  aspectType?: number;
  glyph?: string;
  glyphFont?: "morinus" | "text" | string;
  color?: string;
  colorRole?: string | null;
  applying?: boolean;
  exact?: boolean;
  parallel?: "parallel" | "contraparallel";
};

export type AspectMatrixPayload = {
  planets: AspectMatrixAxisEntry[];
  ascmc: AspectMatrixAxisEntry[];
  /** Empty when the wx houses section is option-gated off (aspectswnd.py:394). */
  houses: AspectMatrixAxisEntry[];
  cells: Record<string, AspectMatrixCell>;
  /** "fixedStar" selects the flat star x (angle/planet/house) layout
   * (fixstarsaspectswnd.py:184-841): text star-name rows on the left rail and
   * a single flat glyph-header column axis instead of the triangle layout. */
  kind?: "fixedStar" | string;
  /** Fixed-star row axis (star name labels); present when kind="fixedStar".
   * Cells are keyed "row:<r>:col:<c>". */
  rows?: AspectMatrixAxisEntry[];
  /** Fixed-star flat column axis (angles, planets, Lot of Fortune, houses);
   * present when kind="fixedStar". */
  cols?: AspectMatrixAxisEntry[];
};

export type AspectListMode =
  | "primary"
  | "outer"
  | "outerToPrimary"
  | "primaryToOuter";

export type AspectListPhase = "exact" | "applying" | "separating" | "none";

export type AspectListEndpoint = {
  key: string;
  role: "primary" | "outer";
  objectType: "planet" | "angle" | "fortune" | "vertex" | "syzygy" | "outerPoint";
  planetId?: number | null;
  sortOrder: number;
  glyph: string;
  glyphFont: "morinus" | "text" | string;
  name: string;
  /** Search-compatible semantic qualifier for projected point families. */
  displayMarker?: string;
  /** Canonical body state at this chart snapshot: R/S/SR/SD. */
  motionMarker?: string;
  /** Search-compatible composite glyph run, used by midpoint endpoints. */
  displaySegments?: TransitSearchObjectSegment[];
  color?: string | null;
  colorRole?: string | null;
  longitude?: number;
  filterIds: string[];
};

export type AspectListRow = {
  id: string;
  /** Calculation trajectory identity. Retained patch refreshes reuse an exact
   * date only when this remains byte-for-byte identical. */
  trajectoryKey: string;
  left: AspectListEndpoint;
  aspect: {
    type: number;
    glyph: string;
    glyphFont: "morinus" | "text" | string;
    name: string;
    color?: string | null;
    colorRole?: string | null;
  };
  right: AspectListEndpoint;
  orb: number;
  orbFormatted: string;
  phase: AspectListPhase;
  /** Calculation-side agency hint. Same-chart rows put this endpoint first;
   * comparison rows preserve the selected chart-role order instead. */
  actorSide?: "left" | "right" | null;
  movingRole?: "outer" | null;
  filterIds: string[];
};

export type AspectListFilter = {
  id: string;
  label: string;
  glyph: string;
  glyphFont: "morinus" | "text" | string;
  group: "planets" | "points";
};

export type AspectListPayload = {
  rows: AspectListRow[];
  filters: AspectListFilter[];
  modes: Array<{ id: AspectListMode; label: string }>;
  activeMode: AspectListMode;
  hasOuter: boolean;
  activeSecondaryRing: {
    id: string;
    label: string;
    role: "primary" | "outer";
    filterIds: string[];
  } | null;
  contextKey: string;
  /** Motion-timeline cursor used to validate retained exact roots. */
  perfectionAnchorJd: number;
  retainedListDataKey: string;
};

export type AspectListPerfection = {
  rowId: string;
  status: "ready" | "unavailable";
  reason?: string;
  exactJd?: number;
  exactDatetime?: string;
  exactDate?: string;
  exactTime?: string;
};

export type AspectListPerfectionsPayload = {
  contextKey: string;
  activeMode: AspectListMode;
  rows: AspectListPerfection[];
  truncated?: boolean;
  batchLimit?: number;
};

export type AspectListPerfectionAction = "exact" | "secondary" | TimedChartAction;

/** One stacked panel of a multi-section table (channel 4 of the custom-table
 * contract: midpoints, almutens, positions, misc, munpos, phasis). Same
 * column/row/cell schema as the flat payload. */
export type GenericTableSection = {
  id: string;
  title?: string;
  columns: GenericTableColumn[];
  rows: GenericTableRow[];
};

export type GenericTablePayload = {
  tableId: string;
  title: string;
  sourceName: string;
  columns: GenericTableColumn[];
  rows: GenericTableRow[];
  notes?: string[];
  capabilities?: Record<string, unknown>;
  source?: string;
  cellEncoding?: string;
  unavailable?: boolean;
  /** Structured matrix layout when capabilities.matrix is true. */
  matrix?: AspectMatrixPayload;
  /** Stacked panel layout when capabilities.sections is true; flat
   * columns/rows remain a compatibility projection, while copy/TXT and PDF
   * export preserve the section boundaries. */
  sections?: GenericTableSection[];
  /** Graphical 0-30 longitude-strip layout when capabilities.strip is true
   * (wx StripWnd, stripwnd.py:78-646). The daemon emits semantic data only —
   * each body's within-sign degree + color + glyph — and the StripView owns
   * pixel placement + anti-overlap. */
  strip?: StripPayload;
};

/** capabilities.strip: bodies grouped by occupied sign for export/fallbacks,
 * each carrying its within-sign degree (0-30), resolved per-body color, glyph
 * + font role. The graphical StripView merges all groups onto the wx-style
 * single 0-30 overlay axis. */
export type StripPayload = {
  signs: StripSign[];
};

export type StripSign = {
  signId: number;
  signGlyph: string;
  bodies: StripBody[];
};

export type SynodicEventType = "station" | "cazimi" | "ingress" | "lunation" | "eclipse" | string;

export type SynodicPlanetItem = {
  id: number;
  objectId: string;
  label: string;
  glyph: string;
  eventGroups?: Array<"ingress" | "synodic">;
  color?: string | null;
  colorRole?: string | null;
  enabled: boolean;
};

export type SynodicLunarItem = {
  id: "draconic" | "anomalistic" | string;
  label: string;
  glyph?: string;
  marker?: string;
  enabled: boolean;
};

export type SynodicSignPayload = {
  index: number;
  glyph: string;
  label: string;
  color?: string | null;
  colorRole?: string | null;
};

export type SynodicCycleRow = {
  key: string;
  eventType: SynodicEventType;
  eventLabel: string;
  eventGlyph?: string;
  eventGlyphFont?: "morinus" | "text";
  detailLabel: string;
  sessionLabel: string;
  planetId: number;
  planetObjectId: string;
  planetLabel: string;
  planetGlyph: string;
  planetColor?: string | null;
  planetColorRole?: string | null;
  filterGroup?: "ingress" | "synodic" | "lunar" | string;
  filterId?: string | number | null;
  eventDate: string;
  eventTime: string;
  displayDate: string;
  displayTime: string;
  displayDatetime: string;
  displayUtcOffsetMinutes: number;
  openDatetime: string;
  eventJd: number | null;
  canOpenChart: boolean;
  sign?: SynodicSignPayload | null;
  longitudeText?: string;
  motionMarker?: string;
  metadata?: Record<string, unknown>;
  temporal?: TemporalRowMeta;
};

export type SynodicCyclePayload = {
  tableId: "synodic_cycles" | string;
  name: string;
  meta: {
    title: string;
    fromDate: string;
    toDate: string;
    coverageStartJdUt: number;
    coverageEndJdUt: number;
    focusDatetime: string;
    currentDatetime: string;
    birthDatetime: string;
    columns: string[];
    planetItems: SynodicPlanetItem[];
    lunarItems: SynodicLunarItem[];
    activePlanetIds: number[];
    activeIngressPlanetIds: number[];
    activeSynodicPlanetIds: number[];
    activeLunarCycleIds: string[];
    eventTypes: Record<string, boolean>;
    timeDisplay: EventTimeDisplayMeta;
  };
  rows: SynodicCycleRow[];
  summary: string;
  truncated: boolean;
  cursor?: TransitSearchCursorState;
};

export type StripBody = {
  glyph: string;
  glyphFont: "morinus" | "text";
  label: string;
  degree: number;
  minuteLabel: string;
  colorHex?: string;
  colorRole?: string | null;
};

/** capabilities.almutenTopical: the topic selector for the topical almuten
 * (wx AlmutenTopicalsFrame.namescb over almutens.topicals.names,
 * almutentopicalsframe.py:21-27). The skin posts {topic} to switch topics. */
export type AlmutenTopicalCapability = {
  topic: number;
  topics: { id: number; label: string }[];
};

async function workspacePost<T>(
  path: string,
  body: unknown,
  signal?: AbortSignal,
  transport: "http" | "native-preferred" = "http",
): Promise<T> {
  if (!daemonHasBeenReady) {
    await waitForDaemonStartup(signal);
  }
  const startedAt = perfNow();
  const perfEnabled = chartPerfEnabled();
  const query = perfEnabled && path.startsWith("/api/workspace/") ? "?perf=1" : "";
  const encodedBody = JSON.stringify(body);
  if (transport === "native-preferred" && !signal) {
    const nativeResponse = await resolveShellHost().requestDaemon(
      "POST",
      `${path}${query}`,
      encodedBody,
    );
    if (nativeResponse) {
      const bodyAt = perfNow();
      if (nativeResponse.status < 200 || nativeResponse.status >= 300) {
        throw new Error(`${path} failed: ${nativeResponse.status} ${nativeResponse.body}`);
      }
      const result = JSON.parse(nativeResponse.body) as T;
      const parsedAt = perfNow();
      if (perfEnabled && path.startsWith("/api/workspace/")) {
        const debugTiming =
          result && typeof result === "object" && "debugTiming" in result
            ? (result as { debugTiming?: unknown }).debugTiming ?? null
            : null;
        recordChartPerf("workspace-command", {
          path,
          transport: nativeResponse.transport,
          bytes: nativeResponse.contentLength,
          fetchMs: bodyAt - startedAt,
          bodyMs: 0,
          parseMs: parsedAt - bodyAt,
          totalMs: parsedAt - startedAt,
          debugTiming,
        });
      }
      return result;
    }
  }

  const response = await daemonFetch(`${daemonBaseUrl()}${path}${query}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: encodedBody,
    signal,
  });
  const headersAt = perfNow();
  const contentLength = Number.parseInt(response.headers.get("content-length") ?? "", 10);
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`${path} failed: ${response.status} ${detail}`);
  }
  const text = await response.text();
  const bodyAt = perfNow();
  const result = JSON.parse(text) as T;
  const parsedAt = perfNow();
  if (perfEnabled && path.startsWith("/api/workspace/")) {
    const debugTiming =
      result && typeof result === "object" && "debugTiming" in result
        ? (result as { debugTiming?: unknown }).debugTiming ?? null
        : null;
    recordChartPerf("workspace-command", {
      path,
      transport: "web-fetch",
      // Uvicorn supplies the exact encoded response size. Using it avoids a
      // second response-sized TextEncoder allocation on every measured step;
      // retain the fallback for proxy/chunked transports without the header.
      bytes: Number.isFinite(contentLength) ? contentLength : approxUtf8Bytes(text),
      fetchMs: headersAt - startedAt,
      bodyMs: bodyAt - headersAt,
      parseMs: parsedAt - bodyAt,
      totalMs: parsedAt - startedAt,
      debugTiming,
    });
  }
  return result;
}

export type SpotlightActionId = "current" | "radix" | "horary" | "transit";

export type SpotlightPreviewAction = {
  id: SpotlightActionId;
  label: string;
};

export type SpotlightParsedDateTime = {
  day: number | null;
  month: number | null;
  year: number | null;
  hour: number | null;
  minute: number | null;
  second: number | null;
  calendar: "gregorian" | "julian" | null;
  locationQuery: string;
  hasDate: boolean;
  hasTime: boolean;
};

export type SpotlightChartMatch = {
  source: string;
  recordIndex: number | null;
  name: string;
  collection: string;
};

export type SpotlightPreview = {
  kind: "none" | "datetime" | "chart";
  primary: string;
  secondary: string;
  parsed: SpotlightParsedDateTime | null;
  chart?: SpotlightChartMatch;
  actions: SpotlightPreviewAction[];
  defaultAction: "open-chart" | SpotlightActionId | null;
  canConfirm: boolean;
};

export async function spotlightPreview(
  text: string,
  signal?: AbortSignal,
): Promise<SpotlightPreview> {
  return workspacePost<SpotlightPreview>("/api/spotlight/preview", { text }, signal);
}

export async function spotlightExecute(
  text: string,
  action: "default" | "open-chart" | SpotlightActionId = "default",
  signal?: AbortSignal,
): Promise<WorkspaceOpenResult> {
  return workspacePost<WorkspaceOpenResult>(
    "/api/spotlight/execute",
    { text, action },
    signal,
  );
}

export async function workspaceState(signal?: AbortSignal): Promise<WorkspaceStatePayload> {
  const response = await daemonFetch(`${daemonBaseUrl()}/api/workspace/state`, {
    cache: "no-store",
    signal,
  });
  if (!response.ok) {
    throw new Error(`workspace state failed: ${response.status}`);
  }
  return (await response.json()) as WorkspaceStatePayload;
}

export async function workspaceOpen(
  params: {
    kind?: string;
    sourceName?: string;
    source?: string;
    recordIndex?: number | null;
    parentDocumentId?: string | null;
    featureKind?: string | null;
    comparisonName?: string | null;
    when?: string | null;
    planetType?: number | null;
    binding?: SupplementaryBindingPayload | null;
    reuseExisting?: boolean;
  },
  signal?: AbortSignal,
): Promise<WorkspaceOpenResult> {
  return workspacePost<WorkspaceOpenResult>(
    "/api/workspace/open",
    {
      kind: params.kind ?? "chart",
      sourceName: params.sourceName ?? "Morinus",
      source: params.source ?? null,
      recordIndex: params.recordIndex ?? null,
      parentDocumentId: params.parentDocumentId ?? null,
      featureKind: params.featureKind ?? null,
      comparisonName: params.comparisonName ?? null,
      when: params.when ?? null,
      planetType: params.planetType ?? null,
      binding: params.binding ?? null,
      reuseExisting: params.reuseExisting ?? false,
    },
    signal,
  );
}

/**
 * Open a synastry comparison as a root-level COMPOUND relationship document.
 * The parentRadixId selects the center chart, but the daemon owns the document
 * lifecycle + renders the center+partner biwheel by document id — no client
 * overlay. Returns the standard open result.
 */
export async function workspaceOpenSynastry(
  parentRadixId: string,
  comparisonName: string,
  comparisonSource?: string | null,
  comparisonRecordIndex?: number | null,
  signal?: AbortSignal,
): Promise<WorkspaceOpenResult> {
  return workspacePost<WorkspaceOpenResult>(
    "/api/workspace/open-synastry",
    {
      parentRadixId,
      comparisonName,
      comparisonSource: comparisonSource ?? null,
      comparisonRecordIndex: comparisonRecordIndex ?? null,
    },
    signal,
  );
}

/** Open two stored charts atomically as one root-level synastry document. */
export async function workspaceOpenSynastryPair(
  centerName: string,
  comparisonName: string,
  centerSource?: string | null,
  centerRecordIndex?: number | null,
  comparisonSource?: string | null,
  comparisonRecordIndex?: number | null,
  signal?: AbortSignal,
): Promise<WorkspaceOpenResult> {
  return workspacePost<WorkspaceOpenResult>(
    "/api/workspace/open-synastry-pair",
    {
      centerName,
      centerSource: centerSource ?? null,
      centerRecordIndex: centerRecordIndex ?? null,
      comparisonName,
      comparisonSource: comparisonSource ?? null,
      comparisonRecordIndex: comparisonRecordIndex ?? null,
    },
    signal,
  );
}

/**
 * Open astrocartography as a REAL view-only child document under the parent
 * radix (workspace_service.open_astrocart). The doc carries NO chart session;
 * the map is fetched from /api/astrocart by the iframe surface.
 */
export async function workspaceOpenAstrocart(
  parentRadixId: string,
  // Optional solar-eclipse path overlay request — the wx twin is
  // morin.show_eclipse_path_on_map (morin.py:16211-16227) passing the eclipse
  // event into AstrocartPanel.set_eclipse_event.
  eclipse?: { jdUt: number; retflag: number } | null,
  signal?: AbortSignal,
): Promise<WorkspaceOpenResult> {
  return workspacePost<WorkspaceOpenResult>(
    "/api/workspace/open-astrocart",
    {
      parentRadixId,
      eclipseJd: eclipse?.jdUt ?? null,
      eclipseRetflag: eclipse?.retflag ?? null,
    },
    signal,
  );
}

export type AstrocartViewState = {
  zoom?: number;
  center?: { lng?: number; lat?: number };
  bearing?: number;
  pitch?: number;
  projection?: string;
  lineModes?: AstrocartLineMode[];
  overlays?: {
    parans?: boolean;
    asterisms?: boolean;
    aspects?: boolean;
    zeniths?: boolean;
    localSpaceOppositions?: boolean;
    layers?: {
      natal?: boolean;
      transit?: boolean;
      progression?: boolean;
    };
    filters?: {
      points?: string[] | null;
      kinds?: string[] | null;
      aspects?: string[] | null;
      techniques?: string[] | null;
    };
  };
  legend?: {
    collapsed?: boolean;
    userSet?: boolean;
  };
};

export type AstrocartViewStateScope = "camera" | "global" | "all";

export type AstrocartLineMode =
  | "standard"
  | "geodetic_greenwich"
  | "geodetic_giza"
  | "local_space";

export type AstrocartCoordinateSystem = "in_mundo" | "zodiacal";

export type AstrocartAngleKind = "MC" | "IC" | "ASC" | "DSC";

export type AstrocartCapability = {
  labelKey?: string;
  status: "supported" | "unsupported";
  reason?: string;
  reasonKey?: string;
};

export type AstrocartPointRecord = {
  semanticId: string;
  family: string;
  label: string;
  labelKey?: string;
  defaultSelected: boolean;
  capabilities: Record<string, AstrocartCapability | undefined>;
  point?: {
    id?: string;
    label?: string;
    kind?: string;
    bodyId?: number;
    starName?: string;
    color?: string;
  };
};

export type AstrocartPointFamily = {
  family: string;
  labelKey: string;
  status: "supported" | "unsupported";
  activeOuterRing?: boolean;
  reason?: string;
  reasonKey?: string;
};

export type AstrocartAspectDefinition = {
  id: string;
  labelKey: string;
  angleDeg: number;
  enabled: boolean;
};

export type AstrocartDynamicTechnique =
  | "transit"
  | "secondary_progression"
  | "minor_progression"
  | "tertiary_progression"
  | "solar_arc";

export type AstrocartDynamicLayer = {
  technique: AstrocartDynamicTechnique;
  labelKey?: string;
  cursorIso: string | null;
  movingActorIds: string[];
  enabled: boolean;
};

export type AstrocartMapSpec = {
  schema: "aries.astrocart-map-spec";
  schemaVersion: number;
  coordinateSystem: AstrocartCoordinateSystem;
  staticAngleLinePointIds: string[];
  selectedAngleKinds: AstrocartAngleKind[];
  paran: {
    enabled: boolean;
    participantIds: string[];
  };
  zenithEnabled: boolean;
  aspects: {
    definitions: AstrocartAspectDefinition[];
    actorIds: string[];
    targetAngleKinds: AstrocartAngleKind[];
  };
  localSpace: {
    oppositionEnabled: boolean;
  };
  dynamicLayers: AstrocartDynamicLayer[];
};

export type AstrocartConfigurationPayload = {
  schema: "aries.astrocart-map-spec";
  schemaVersion: number;
  spec: AstrocartMapSpec;
  defaultSpec: AstrocartMapSpec;
  catalog: {
    points: AstrocartPointRecord[];
    families: AstrocartPointFamily[];
    capabilityMatrix?: Record<string, Record<string, AstrocartCapability>>;
  };
  aspects: AstrocartAspectDefinition[];
  dynamicTechniques: Array<{
    id: AstrocartDynamicTechnique;
    labelKey: string;
  }>;
  coordinateSystems: AstrocartCoordinateSystem[];
  angleKinds: AstrocartAngleKind[];
  specKey: string;
  specRevision: string;
  cacheKey: string;
  modeSpecKeys: Record<AstrocartLineMode, string>;
};

export async function fetchAstrocartConfiguration(
  astrocartDocumentId: string,
  signal?: AbortSignal,
): Promise<AstrocartConfigurationPayload> {
  const response = await daemonFetch(
    `${daemonBaseUrl()}/api/workspace/document/${encodeURIComponent(astrocartDocumentId)}/astrocart/spec`,
    { cache: "no-store", signal },
  );
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`astrocart configuration failed: ${response.status} ${detail}`);
  }
  return response.json() as Promise<AstrocartConfigurationPayload>;
}

export async function storeAstrocartConfiguration(
  astrocartDocumentId: string,
  spec: AstrocartMapSpec,
  signal?: AbortSignal,
): Promise<AstrocartConfigurationPayload> {
  return workspacePost<AstrocartConfigurationPayload>(
    `/api/workspace/document/${encodeURIComponent(astrocartDocumentId)}/astrocart/spec`,
    { spec },
    signal,
  );
}

export type AstrocartPdfPageFormat = "A4" | "A3";

export type AstrocartPdfSelection = {
  pointIds: string[];
  lineKinds: string[];
  layerKinds: Array<"natal" | "transit" | "progression">;
  aspectIds: string[];
  includeZenith: boolean;
};

export type AstrocartPrintAtlasPage = {
  dataUrl: string;
  width: number;
  height: number;
  role: "overview" | "detail";
  projection: "globe" | "mercator";
  center: [number, number];
  zoom: number;
  bearing: number;
  pitch: number;
  containsAstrology: true;
  sheetId?: string;
  title?: string;
  bounds?: [[number, number], [number, number]];
  scaleKm?: number;
  neighbors?: {
    north?: string | null;
    east?: string | null;
    south?: string | null;
    west?: string | null;
  };
};

export type AstrocartPrintAtlas = {
  pages: AstrocartPrintAtlasPage[];
  attribution: string;
};

export type AstrocartPdfExportOptions = {
  mode?: AstrocartLineMode;
  modes?: AstrocartLineMode[];
  expectedSpecKey?: string;
  selection: AstrocartPdfSelection;
  pageFormat: AstrocartPdfPageFormat;
  locale: string;
  title: string;
  subtitle: string;
  chartDate: string;
  selectionSummary: string;
  localizedLabels: Record<string, unknown>;
  atlas: AstrocartPrintAtlas;
};

export type AstrocartPdfExportSummary = {
  ok: boolean;
  schema: string;
  schemaVersion: number;
  kind: "pdf";
  mimeType: "application/pdf";
  bytes: number;
  filename: string;
  documentId: string;
  sourceName: string;
  precision: "precise";
  modes: AstrocartLineMode[];
  specKey: string;
  selection: AstrocartPdfSelection;
  featureCount: number;
  atlasBytes: number;
  atlasPageCount: number;
  renderMs: number;
  path?: string;
};

export async function exportAstrocartPdf(
  astrocartDocumentId: string,
  params: AstrocartPdfExportOptions & { path: string; filename?: string },
  signal?: AbortSignal,
): Promise<AstrocartPdfExportSummary> {
  return workspacePost<AstrocartPdfExportSummary>(
    `/api/workspace/document/${encodeURIComponent(astrocartDocumentId)}/astrocart/export`,
    params,
    signal,
  );
}

export async function exportAstrocartPdfBytes(
  astrocartDocumentId: string,
  params: AstrocartPdfExportOptions & { filename: string },
  signal?: AbortSignal,
): Promise<AstrocartPdfExportSummary & { dataBase64: string }> {
  return workspacePost<AstrocartPdfExportSummary & { dataBase64: string }>(
    `/api/workspace/document/${encodeURIComponent(astrocartDocumentId)}/astrocart/export-bytes`,
    params,
    signal,
  );
}

export type AstrocartBasemapMeta = {
  hasLocalTiles: boolean;
  tilesUrl: string | null;
  installing: boolean;
};

export async function fetchAstrocartBasemap(signal?: AbortSignal): Promise<AstrocartBasemapMeta> {
  const baseUrl = daemonBaseUrl();
  const response = await daemonFetch(`${baseUrl}/api/astrocart/basemap`, {
    cache: "no-store",
    signal,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`astrocart basemap failed: ${response.status} ${detail}`);
  }
  const payload = (await response.json()) as Partial<AstrocartBasemapMeta>;
  const rawTilesUrl = typeof payload.tilesUrl === "string" && payload.tilesUrl.length > 0
    ? payload.tilesUrl
    : null;
  const tilesBaseUrl = baseUrl || (typeof window !== "undefined" ? window.location.origin : "http://127.0.0.1");
  return {
    hasLocalTiles: payload.hasLocalTiles === true,
    tilesUrl: rawTilesUrl ? new URL(rawTilesUrl, `${tilesBaseUrl.replace(/\/$/, "")}/`).toString() : null,
    installing: payload.installing === true,
  };
}

export async function fetchAstrocartViewState(
  astrocartDocumentId: string,
  signal?: AbortSignal,
): Promise<AstrocartViewState | null> {
  const response = await daemonFetch(
    `${daemonBaseUrl()}/api/workspace/document/${encodeURIComponent(astrocartDocumentId)}/astrocart/view-state`,
    { cache: "no-store", signal },
  );
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`astrocart view state failed: ${response.status} ${detail}`);
  }
  const payload = (await response.json()) as { state?: AstrocartViewState | null };
  return payload.state && Object.keys(payload.state).length > 0 ? payload.state : null;
}

export async function storeAstrocartViewState(
  astrocartDocumentId: string,
  state: AstrocartViewState,
  scope: AstrocartViewStateScope = "all",
  signal?: AbortSignal,
): Promise<void> {
  await workspacePost<{ ok: boolean }>(
    `/api/workspace/document/${encodeURIComponent(astrocartDocumentId)}/astrocart/view-state`,
    { state, scope },
    signal,
  );
}

/**
 * Open the Primary Directions list as a REAL view-only child document under the
 * parent chart (workspace_service.open_directions). The doc carries NO chart
 * session; the list is fetched from /api/directions (+ /api/directions/annual)
 * by the DirectionsView surface. Row-launched charts nest under this owning
 * chart while the daemon keeps branch-radix identity separately.
 */
export async function workspaceOpenDirections(
  parentRadixId: string,
  customSignificator?: DirectionCustomSignificator | null,
  signal?: AbortSignal,
): Promise<WorkspaceOpenResult> {
  return workspacePost<WorkspaceOpenResult>(
    "/api/workspace/open-directions",
    { parentRadixId, customSignificator: customSignificator ?? null },
    signal,
  );
}

export type WorkspaceRectifyRadixTimeResult = WorkspaceOpenResult & {
  ok: boolean;
  deltaSeconds: number;
  birthDatetime?: string;
  displayDatetime?: string | null;
};

/** Rectification nudge from the directions panes. The daemon resolves a
 * direction/list document back to its owning radix, applies the signed second
 * delta, rebuilds the radix in place, marks it dirty, and broadcasts updates. */
export async function workspaceRectifyRadixTime(
  docId: string,
  deltaSeconds: number,
  signal?: AbortSignal,
): Promise<WorkspaceRectifyRadixTimeResult> {
  return workspacePost<WorkspaceRectifyRadixTimeResult>(
    "/api/workspace/rectify-radix-time",
    { docId, deltaSeconds },
    signal,
  );
}

/** Right-click "here" actions on the astrocartography map. The clicked lon/lat
 * is acted on by one of four actions, mirroring the wx #acg-menu
 * (morin.on_astrocart_here_request). relocation/solar_return/transit open a new
 * child document under the radix; set_pob mutates the radix birthplace in place
 * (so documentId == the radix doc, already active). */
export type AstrocartHereAction =
  | "relocation"
  | "solar_return"
  | "transit"
  | "set_pob";

export async function workspaceAstrocartHere(
  astrocartDocumentId: string,
  action: AstrocartHereAction,
  lon: number,
  lat: number,
  placeName: string,
  signal?: AbortSignal,
): Promise<WorkspaceOpenResult & { placeName?: string }> {
  return workspacePost<WorkspaceOpenResult & { placeName?: string }>(
    "/api/workspace/astrocart-here",
    { astrocartDocumentId, action, lon, lat, placeName },
    signal,
  );
}

/**
 * Open the planispheric astrolabe as a REAL view-only child document under the
 * parent radix (workspace_service.open_astrolabe). The doc carries NO chart
 * session; the geometry is fetched from /api/astrolabe by the AstrolabeView
 * surface. Mirrors workspaceOpenAstrocart / workspaceOpenDirections.
 */
export async function workspaceOpenAstrolabe(
  parentRadixId: string,
  signal?: AbortSignal,
): Promise<WorkspaceOpenResult> {
  return workspacePost<WorkspaceOpenResult>(
    "/api/workspace/open-astrolabe",
    { parentRadixId },
    signal,
  );
}

/**
 * Open the Astrolog-style sphere as a REAL view-only child document under the
 * parent radix. The doc carries NO chart session; AstrologSphereView fetches
 * /api/astrolog-sphere itself.
 */
export async function workspaceOpenAstrologSphere(
  parentRadixId: string,
  signal?: AbortSignal,
): Promise<WorkspaceOpenResult> {
  return workspacePost<WorkspaceOpenResult>(
    "/api/workspace/open-astrolog-sphere",
    { parentRadixId },
    signal,
  );
}

/**
 * Open the Square Chart as a REAL view-only child document under the parent
 * radix (workspace_service.open_square_chart; wx twin SquareChartWnd). The doc
 * carries NO chart session; SquareChartView fetches /api/square-chart itself.
 */
export async function workspaceOpenSquareChart(
  parentRadixId: string,
  signal?: AbortSignal,
): Promise<WorkspaceOpenResult> {
  return workspacePost<WorkspaceOpenResult>(
    "/api/workspace/open-square-chart",
    { parentRadixId },
    signal,
  );
}

/**
 * Open the Mundane Chart as a REAL view-only child document under the parent
 * radix (workspace_service.open_mundane_chart; wx twin MundaneWnd). The doc
 * carries NO chart session; MundaneChartView fetches /api/mundane-chart itself.
 */
export async function workspaceOpenMundaneChart(
  parentRadixId: string,
  signal?: AbortSignal,
): Promise<WorkspaceOpenResult> {
  return workspacePost<WorkspaceOpenResult>(
    "/api/workspace/open-mundane-chart",
    { parentRadixId },
    signal,
  );
}

/**
 * Open the Graphic Ephemeris as a REAL view-only child document under the
 * parent radix (workspace_service.open_ephemeris; wx twin
 * morin._workspace_table_ephemeris, morin.py:16180-16195). The doc carries NO
 * chart session; GraphEphemerisView fetches /api/ephemeris curves itself.
 */
export async function workspaceOpenEphemeris(
  parentRadixId: string,
  signal?: AbortSignal,
): Promise<WorkspaceOpenResult> {
  return workspacePost<WorkspaceOpenResult>(
    "/api/workspace/open-ephemeris",
    { parentRadixId },
    signal,
  );
}

// --- Graphic Ephemeris (launcherKind "ephemeris") -------------------------
// The daemon (ephemeris_service via ephemcalc.EphemCalc) computes one sample
// per day for 12 anchored months plus refined station events; the view only
// renders. Oracle: graphephemwnd.py / graphephemframe.py.

export type EphemerisStation = {
  planet: number;
  jd: number;
  dayOffset: number;
  value: number;
  /** SR/SD (longitude stations), DN/DS (declination extrema), EQ (equator crossing). */
  code: string;
  date: string;
};

export type EphemerisSignEvent = {
  planet: number;
  jd: number;
  dayOffset: number;
  /** Boundary longitude in displayed zodiac degrees: 0, 30, ... 330. */
  value: number;
  targetSign: number;
  fromSign: number;
  toSign: number;
  /** Sign to draw: entered sign for direct motion, left sign for retrograde motion. */
  eventSign: number;
  retrograde: boolean;
  date: string;
};

export type EphemerisOutOfBoundsMarker = {
  planet: number;
  dayOffset: number;
  value: number;
};

export type EphemerisPlanetSeries = {
  id: number;
  /** Morinus glyph char for the planet (render in font-family "AriesMorinus"). */
  glyph: string;
  label: string;
  color: string;
  defaultVisible: { longitude: boolean; declination: boolean };
  longitude: number[];
  declination: number[];
};

export type EphemerisColors = {
  background: string;
  frame: string;
  texts: string;
  grid: string;
  signs: string;
};

export type EphemerisPayload = {
  year: number;
  startMonth: number;
  /** JD UT of <startMonth> 1, 00:00 Greenwich — the x-axis origin. */
  startJd: number | null;
  days: number;
  monthOffsets: number[];
  monthLabels: string[];
  /** 12 Morinus sign glyph chars (options.signs variant). */
  signGlyphs: string[];
  signNames: string[];
  colors: EphemerisColors;
  planets: EphemerisPlanetSeries[];
  /** One glyph anchor at the furthest declination of each OOB excursion. */
  outOfBounds: EphemerisOutOfBoundsMarker[];
  stations: { longitude: EphemerisStation[]; declination: EphemerisStation[] };
  signEvents: EphemerisSignEvent[];
};

export type EphemerisStationsPayload = {
  year: number;
  startMonth: number;
  stations: { longitude: EphemerisStation[]; declination: EphemerisStation[] };
  signEvents: EphemerisSignEvent[];
};

type EphemerisFetchOptions = {
  signal?: AbortSignal;
  includeStations?: boolean;
};

function isAbortSignal(options: AbortSignal | EphemerisFetchOptions): options is AbortSignal {
  return (
    typeof (options as AbortSignal).aborted === "boolean" &&
    typeof (options as AbortSignal).addEventListener === "function"
  );
}

function normalizeEphemerisFetchOptions(
  options?: AbortSignal | EphemerisFetchOptions,
): EphemerisFetchOptions {
  if (!options) return {};
  if (isAbortSignal(options)) {
    return { signal: options };
  }
  return options;
}

export async function fetchGraphicEphemeris(
  year: number,
  startMonth: number,
  options?: AbortSignal | EphemerisFetchOptions,
): Promise<EphemerisPayload> {
  const fetchOptions = normalizeEphemerisFetchOptions(options);
  const includeStations = fetchOptions.includeStations ?? false;
  const response = await daemonFetch(
    `${daemonBaseUrl()}/api/ephemeris?year=${year}&startMonth=${startMonth}&includeStations=${includeStations ? "true" : "false"}`,
    { signal: fetchOptions.signal },
  );
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`ephemeris request failed: ${response.status} ${detail}`);
  }
  return (await response.json()) as EphemerisPayload;
}

export async function fetchGraphicEphemerisStations(
  year: number,
  startMonth: number,
  signal?: AbortSignal,
): Promise<EphemerisStationsPayload> {
  const response = await daemonFetch(
    `${daemonBaseUrl()}/api/ephemeris/stations?year=${year}&startMonth=${startMonth}`,
    { signal },
  );
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`ephemeris station request failed: ${response.status} ${detail}`);
  }
  return (await response.json()) as EphemerisStationsPayload;
}

/** Per-radix ephemeris view state (year/start_month/display_mode/
 * visible_planets/show_grid — morin.py:5364-5426 twin). */
export type EphemerisViewState = {
  year?: number;
  start_month?: number;
  show_grid?: boolean;
  show_event_glyphs?: boolean;
  display_mode?: "longitude" | "declination";
  visible_planets?: Record<string, boolean>;
};

export async function fetchEphemerisViewState(
  documentId: string,
  signal?: AbortSignal,
): Promise<EphemerisViewState> {
  const response = await daemonFetch(
    `${daemonBaseUrl()}/api/workspace/document/${documentId}/ephemeris-state`,
    { signal },
  );
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`ephemeris state request failed: ${response.status} ${detail}`);
  }
  return ((await response.json()) as { state: EphemerisViewState }).state ?? {};
}

export async function storeEphemerisViewState(
  documentId: string,
  state: EphemerisViewState,
): Promise<void> {
  const response = await daemonFetch(
    `${daemonBaseUrl()}/api/workspace/document/${documentId}/ephemeris-state`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state }),
    },
  );
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`ephemeris state store failed: ${response.status} ${detail}`);
  }
}

/**
 * Open a generic embedded Morinus table as a REAL view-only child document.
 * The document carries no chart session; GenericTableView fetches
 * /api/tables/{tableId}?documentId=<doc> and renders daemon-owned rows.
 */
export async function workspaceOpenTable(
  parentRadixId: string,
  tableId: string,
  binding?: Record<string, unknown> | null,
  signal?: AbortSignal,
): Promise<WorkspaceOpenResult> {
  return workspacePost<WorkspaceOpenResult>(
    "/api/workspace/open-table",
    { parentRadixId, tableId, binding: binding ?? null },
    signal,
  );
}

export async function workspaceOpenAscensionalTransits(
  parentRadixId: string,
  sourceDocumentId?: string | null,
  signal?: AbortSignal,
): Promise<WorkspaceOpenResult> {
  return workspacePost<WorkspaceOpenResult>(
    "/api/workspace/open-ascensional-transits",
    { parentRadixId, sourceDocumentId: sourceDocumentId ?? null },
    signal,
  );
}

export type WorkspaceAscensionalEventPlaceResult = {
  documentId: string;
  displayDatetime: string | null;
  ascensionalEventJd?: number | null;
  ascensionalEventPlace?: Record<string, unknown> | null;
  documents: DaemonDocumentSummary[];
  snapshot?: ChartRenderSnapshot;
};

export async function workspaceUpdateAscensionalEventPlace(
  documentId: string,
  place: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<WorkspaceAscensionalEventPlaceResult> {
  return workspacePost(
    "/api/workspace/ascensional-event-place",
    { documentId, place },
    signal,
  );
}

export async function workspaceUpdateAscensionalEventPlaceFromMap(
  documentId: string,
  lon: number,
  lat: number,
  placeName: string,
  signal?: AbortSignal,
): Promise<WorkspaceAscensionalEventPlaceResult> {
  return workspacePost(
    "/api/workspace/ascensional-event-place/from-map",
    { documentId, lon, lat, placeName },
    signal,
  );
}

export async function workspaceUpdateTableBinding(
  documentId: string,
  binding: Record<string, unknown> | null,
  // A chart-owning document hosting a right-pane table (the ZR pane) names the
  // table it is binding; plain table documents omit it.
  tableId?: string | null,
  signal?: AbortSignal,
): Promise<{ documentId: string; tableId: string; binding: Record<string, unknown>; documents: DaemonDocumentSummary[] }> {
  return workspacePost(
    "/api/workspace/table-binding",
    { documentId, binding: binding ?? null, tableId: tableId ?? null },
    signal,
  );
}

export async function fetchGenericTablePayload(
  tableId: string,
  documentId: string,
  signal?: AbortSignal,
  focusDatetime?: string | null,
  includeTemporal = false,
): Promise<GenericTablePayload> {
  const search = new URLSearchParams({ documentId });
  if (focusDatetime) search.set("focusDatetime", focusDatetime);
  if (includeTemporal) search.set("includeTemporal", "true");
  const response = await daemonFetch(
    `${daemonBaseUrl()}/api/tables/${encodeURIComponent(tableId)}?${search.toString()}`,
    { cache: "no-store", signal },
  );
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`table payload failed: ${response.status} ${detail}`);
  }
  return (await response.json()) as GenericTablePayload;
}

export async function fetchEclipseTableRange(
  documentId: string,
  fromYear: number,
  toYear: number,
  signal?: AbortSignal,
): Promise<GenericTablePayload> {
  const search = new URLSearchParams({
    documentId,
    fromYear: String(Math.trunc(fromYear)),
    toYear: String(Math.trunc(toYear)),
  });
  const response = await daemonFetch(
    `${daemonBaseUrl()}/api/tables/eclipses?${search.toString()}`,
    { cache: "no-store", signal },
  );
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`eclipse table range failed: ${response.status} ${detail}`);
  }
  return (await response.json()) as GenericTablePayload;
}

export async function fetchAspectList(
  documentId: string,
  mode?: AspectListMode | null,
  signal?: AbortSignal,
): Promise<AspectListPayload> {
  const search = new URLSearchParams({ documentId });
  if (mode) search.set("mode", mode);
  const response = await daemonFetch(
    `${daemonBaseUrl()}/api/aspect-list?${search.toString()}`,
    { cache: "no-store", signal },
  );
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`aspect list failed: ${response.status} ${detail}`);
  }
  return (await response.json()) as AspectListPayload;
}

export async function fetchAspectListPerfections(
  documentId: string,
  mode: AspectListMode,
  maxOrb: number,
  contextKey: string,
  signal?: AbortSignal,
  rowIds?: readonly string[],
): Promise<AspectListPerfectionsPayload> {
  const search = new URLSearchParams({
    documentId,
    mode,
    maxOrb: String(maxOrb),
    contextKey,
  });
  for (const rowId of rowIds ?? []) search.append("rowIds", rowId);
  const response = await daemonFetch(
    `${daemonBaseUrl()}/api/aspect-list/perfections?${search.toString()}`,
    { cache: "no-store", signal },
  );
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new AspectListPerfectionRequestError(response.status, detail);
  }
  return (await response.json()) as AspectListPerfectionsPayload;
}

export class AspectListPerfectionRequestError extends Error {
  readonly status: number;
  readonly detail: string;

  constructor(status: number, detail: string) {
    super(`aspect perfection list failed: ${status} ${detail}`);
    this.name = "AspectListPerfectionRequestError";
    this.status = status;
    this.detail = detail;
  }
}

export function isAspectListPerfectionContextChangedError(
  error: unknown,
): error is AspectListPerfectionRequestError {
  return error instanceof AspectListPerfectionRequestError && error.status === 409;
}

export async function openAspectListPerfection(
  documentId: string,
  mode: AspectListMode,
  rowId: string,
  contextKey: string,
  action: AspectListPerfectionAction = "exact",
  showRadix?: boolean,
): Promise<WorkspaceOpenResult> {
  const response = await daemonFetch(`${daemonBaseUrl()}/api/aspect-list/open-perfection`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      documentId,
      mode,
      rowId,
      contextKey,
      action,
      ...(showRadix === undefined ? {} : { showRadix }),
    }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`aspect perfection open failed: ${response.status} ${detail}`);
  }
  return (await response.json()) as WorkspaceOpenResult;
}

export async function fetchSynodicCycles(
  params: {
    documentId: string;
    fromDate?: string;
    toDate?: string;
    planetIds?: number[];
    ingressPlanetIds?: number[];
    synodicPlanetIds?: number[];
    lunarCycleIds?: string[];
    includeStations?: boolean;
    includeCazimis?: boolean;
    includeIngresses?: boolean;
    includeTemporal?: boolean;
    cursorDirection?: "around" | "previous" | "next";
    cursorRowBudget?: number;
    cursorAnchorDate?: string;
  },
  signal?: AbortSignal,
): Promise<SynodicCyclePayload> {
  const search = new URLSearchParams({ documentId: params.documentId });
  if (params.fromDate) search.set("fromDate", params.fromDate);
  if (params.toDate) search.set("toDate", params.toDate);
  if (params.planetIds) search.set("planetIds", params.planetIds.length ? params.planetIds.join(",") : "__none__");
  if (params.ingressPlanetIds) search.set("ingressPlanetIds", params.ingressPlanetIds.length ? params.ingressPlanetIds.join(",") : "__none__");
  if (params.synodicPlanetIds) search.set("synodicPlanetIds", params.synodicPlanetIds.length ? params.synodicPlanetIds.join(",") : "__none__");
  if (params.lunarCycleIds) search.set("lunarCycleIds", params.lunarCycleIds.length ? params.lunarCycleIds.join(",") : "__none__");
  if (params.includeStations === false) search.set("includeStations", "false");
  if (params.includeCazimis === false) search.set("includeCazimis", "false");
  if (params.includeIngresses === false) search.set("includeIngresses", "false");
  if (params.includeTemporal === true) search.set("includeTemporal", "true");
  if (params.cursorDirection) search.set("cursorDirection", params.cursorDirection);
  if (params.cursorRowBudget) search.set("cursorRowBudget", String(params.cursorRowBudget));
  if (params.cursorAnchorDate) search.set("cursorAnchorDate", params.cursorAnchorDate);
  const response = await daemonFetch(
    `${daemonBaseUrl()}/api/synodic/list?${search.toString()}`,
    { cache: "no-store", signal },
  );
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`synodic cycles failed: ${response.status} ${detail}`);
  }
  return (await response.json()) as SynodicCyclePayload;
}

export type AscensionalListRow =
  | { kind: "section"; title: string }
  | {
      kind: "data";
      transitGlyph: string;
      transitFont: "morinus" | "text" | string;
      aspectGlyph: string;
      aspectFont: "morinus" | "text" | string;
      radixGlyph: string;
      radixFont: "morinus" | "text" | string;
      radixExtra: string;
      orbText: string;
      statusText: string;
      dim: boolean;
      pair?: Record<string, unknown> | null;
    };

export type AscensionalPointPayload = {
  kind: "planet" | "cusp" | "angle" | "lof" | "node" | string;
  idx: number;
  label: string;
  ra: number | null;
  decl: number | null;
  lon: number | null;
  lat: number | null;
  mdo: number | null;
  quadrant: number | null;
  aboveHorizon: boolean;
  fixedInFrame: boolean;
  pmp: number | null;
};

export type AscensionalPairPayload = {
  transit: AscensionalPointPayload;
  radix: AscensionalPointPayload;
  aspect: string;
  aspectGlyph: string;
  aspectFont: "morinus" | "text" | string;
  orbArcmin: number;
  orbText: string;
  dim: boolean;
  statusText: string;
};

export type AscensionalSnapshotPayload = {
  kind: "ascensional_transits";
  radix: {
    name: string;
    recordIndex?: number | null;
    jd: number;
    datetime: Record<string, unknown>;
    place: Record<string, unknown>;
  };
  event: {
    jd: number;
    datetime: {
      isoUtc?: string;
      year?: number;
      month?: number;
      day?: number;
      hour?: number;
      minute?: number;
      second?: number;
    };
    source: string;
    place: Record<string, unknown>;
    ramc: number;
    ramcUncorrected: number;
    precessionCorrectionArcmin: number;
    applyPrecession: boolean;
    direction: string;
  };
  points: {
    radix: AscensionalPointPayload[];
    transit: AscensionalPointPayload[];
  };
  atPairs: AscensionalPairPayload[];
  activeEclipticAspects: {
    transitId: number;
    transitLabel: string;
    transitGlyph: string;
    radixId: number;
    radixLabel: string;
    radixGlyph: string;
    aspectDeg: number;
    orbArcmin: number;
    orbText: string;
  }[];
  twoTransitRule: {
    isActiveMoment: boolean;
    activeTransitBodyIds: number[];
    aspectOrbFastArcmin: number;
    aspectOrbSlowArcmin: number;
    aspectMultiplesDeg: number[];
  };
  list: {
    rows: AscensionalListRow[];
    meta: Record<string, unknown>;
    filterToActiveMoment: boolean;
  };
  meta: Record<string, unknown>;
};

export async function fetchAscensionalSnapshot(
  params: {
    documentId?: string | null;
    sourceName: string;
    eventJd?: number | null;
    place?: Record<string, unknown> | null;
    filterToActiveMoment?: boolean;
    applyPrecession?: boolean;
  },
  signal?: AbortSignal,
): Promise<AscensionalSnapshotPayload> {
  const search = new URLSearchParams();
  search.set("name", params.sourceName);
  if (params.documentId) search.set("documentId", params.documentId);
  if (params.eventJd != null) search.set("eventJd", String(params.eventJd));
  if (params.place != null) search.set("place", JSON.stringify(params.place));
  search.set("filterToActiveMoment", String(params.filterToActiveMoment ?? true));
  search.set("applyPrecession", String(params.applyPrecession ?? true));
  const response = await daemonFetch(
    `${daemonBaseUrl()}/api/ascensional/snapshot?${search.toString()}`,
    { cache: "no-store", signal },
  );
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`ascensional snapshot failed: ${response.status} ${detail}`);
  }
  return (await response.json()) as AscensionalSnapshotPayload;
}

/**
 * Open the transit search engine as a REAL view-only child document under the
 * active/reference chart. The search calculation remains Python-owned.
 */
export async function workspaceOpenTransitSearch(
  parentDocumentId: string,
  signal?: AbortSignal,
): Promise<WorkspaceOpenResult> {
  return workspacePost<WorkspaceOpenResult>(
    "/api/workspace/open-transit-search",
    { parentDocumentId },
    signal,
  );
}

/**
 * Open "Here and Now" as a REAL self-anchored root document
 * (workspace_service.open_here_now) — a current-moment chart with its own
 * daemon cursor, stepped + rendered by document id like any radix. `when` is an
 * optional ISO anchor; the daemon defaults to engine `now`.
 */
export async function workspaceOpenHereNow(
  when?: string,
  signal?: AbortSignal,
): Promise<WorkspaceOpenResult> {
  return workspacePost<WorkspaceOpenResult>(
    "/api/workspace/open-here-now",
    { when: when ?? null },
    signal,
  );
}

/**
 * No-chart fallback for a Charts > Elections / Horary theme pick — opens the
 * wx here-and-now TRANSIT 'Election Base' (morin.py:19082-19101) or HORARY
 * (morin.py:19005-19029) chart as a real self-anchored daemon document. The
 * lens itself stays client presentation state (inspectorLens).
 */
export async function workspaceOpenLensHereNow(
  discipline: string,
  theme?: string,
  signal?: AbortSignal,
): Promise<WorkspaceOpenResult> {
  return workspacePost<WorkspaceOpenResult>(
    "/api/workspace/open-lens-here-now",
    { discipline, theme: theme ?? null },
    signal,
  );
}

/** The interpretation lens as persisted on a horary chart
 * (`chrt.interpretation`, chartfile schema field). Same shape as the store's
 * inspectorLens. */
export type InspectorLensPayload = {
  discipline: string;
  theme: string;
  context?: Record<string, unknown> | null;
};

/**
 * Mirror the skin's interpretation lens onto a horary document's chart so Save
 * persists the question (wx morin._mirror_lens_to_horary_session,
 * morin.py:9062-9071). The daemon no-ops for non-horary documents; a null lens
 * clears the saved slot.
 */
export async function workspaceMirrorLens(
  docId: string,
  lens: InspectorLensPayload | null,
  signal?: AbortSignal,
): Promise<{ ok: boolean; mirrored: boolean }> {
  return workspacePost<{ ok: boolean; mirrored: boolean }>(
    "/api/workspace/lens-mirror",
    { documentId: docId, lens },
    signal,
  );
}

export async function workspaceActivate(
  docId: string,
  signal?: AbortSignal,
): Promise<WorkspaceStatePayload> {
  return workspacePost<WorkspaceStatePayload>("/api/workspace/activate", { docId }, signal);
}

export async function workspaceClose(
  docId: string,
  cascade = true,
  signal?: AbortSignal,
): Promise<WorkspaceCloseResult> {
  return workspacePost<WorkspaceCloseResult>(
    "/api/workspace/close",
    { docId, cascade },
    signal,
  );
}

/** Non-destructive close check. Returns `promptWorthyIds` (the dirty +
 * file-backed + owns-radix predicate, computed daemon-side) WITHOUT closing.
 * The skin shows the discard modal from this, then calls `workspaceClose` to
 * finalize — it never recomputes the predicate. */
export async function workspaceClosePreflight(
  docId: string,
  cascade = true,
  signal?: AbortSignal,
): Promise<WorkspaceCloseResult> {
  return workspacePost<WorkspaceCloseResult>(
    "/api/workspace/close-preflight",
    { docId, cascade },
    signal,
  );
}

export type WorkspaceMoveResult = {
  moved: boolean;
  activeDocumentId: string | null;
  documents: DaemonDocumentSummary[];
  snapshotInvalidatedIds?: string[];
  snapshot?: ChartRenderSnapshot;
};

export type WorkspaceMoveIntent = {
  kind: "reorder" | "detach" | "attach";
  target_document_id: string | null;
  before_document_id: string | null;
  indicator_scope: "siblings" | "roots" | null;
};

export type WorkspaceDragContextResult = {
  documentId: string;
  context: {
    ordered_ids: string[];
    sibling_ids: string[];
    root_ids: string[];
    hover_target_ids: string[];
    attach_target_ids: string[];
  };
  documents: DaemonDocumentSummary[];
};

export type WorkspacePreviewMoveIntentResult = {
  sourceDocumentId: string;
  targetDocumentId: string | null;
  intent: WorkspaceMoveIntent | null;
  documents: DaemonDocumentSummary[];
};

export type WorkspaceApplyMoveIntentResult = {
  applied: boolean;
  sourceDocumentId: string;
  intent: WorkspaceMoveIntent | null;
  affectedDocumentIds: string[];
  activeDocumentId: string | null;
  documents: DaemonDocumentSummary[];
  snapshotInvalidatedIds?: string[];
  snapshot?: ChartRenderSnapshot;
};

export type WorkspaceDragConversionAction = "synastry" | "transit";

export type WorkspaceApplyDragConversionResult = {
  applied: boolean;
  action: WorkspaceDragConversionAction;
  sourceDocumentId: string;
  targetDocumentId: string;
  documentId: string | null;
  affectedDocumentIds: string[];
  activeDocumentId: string | null;
  documents: DaemonDocumentSummary[];
};

/**
 * Reorder a sibling document (sidebar DnD). The daemon's controller is
 * SIBLING-ONLY: a move whose target has a different parent is rejected and the
 * tree is left unchanged. `beforeId` is the sibling the dragged doc is dropped
 * before; null moves it to the end of the sibling group. The daemon broadcasts
 * documents.changed with the new order, so the skin never mutates its mirror.
 */
export async function workspaceMove(
  docId: string,
  beforeId: string | null,
  signal?: AbortSignal,
): Promise<WorkspaceMoveResult> {
  return workspacePost<WorkspaceMoveResult>(
    "/api/workspace/move",
    { docId, beforeId },
    signal,
  );
}

export async function workspaceDragContext(
  docId: string,
  signal?: AbortSignal,
): Promise<WorkspaceDragContextResult> {
  return workspacePost<WorkspaceDragContextResult>(
    "/api/workspace/drag-context",
    { docId },
    signal,
  );
}

export async function workspacePreviewMoveIntent(
  params: {
    sourceDocumentId: string;
    targetDocumentId?: string | null;
    beforeId?: string | null;
    rootBeforeId?: string | null;
    preferAttach?: boolean;
  },
  signal?: AbortSignal,
): Promise<WorkspacePreviewMoveIntentResult> {
  return workspacePost<WorkspacePreviewMoveIntentResult>(
    "/api/workspace/preview-move-intent",
    {
      sourceDocumentId: params.sourceDocumentId,
      targetDocumentId: params.targetDocumentId ?? null,
      beforeId: params.beforeId ?? null,
      rootBeforeId: params.rootBeforeId ?? null,
      preferAttach: params.preferAttach ?? false,
    },
    signal,
  );
}

export async function workspaceApplyMoveIntent(
  sourceDocumentId: string,
  moveIntent: WorkspaceMoveIntent | null,
  signal?: AbortSignal,
): Promise<WorkspaceApplyMoveIntentResult> {
  return workspacePost<WorkspaceApplyMoveIntentResult>(
    "/api/workspace/apply-move-intent",
    { sourceDocumentId, moveIntent },
    signal,
  );
}

export async function workspaceApplyDragConversion(
  action: WorkspaceDragConversionAction,
  sourceDocumentId: string,
  targetDocumentId: string,
  signal?: AbortSignal,
): Promise<WorkspaceApplyDragConversionResult> {
  return workspacePost<WorkspaceApplyDragConversionResult>(
    "/api/workspace/apply-drag-conversion",
    { action, sourceDocumentId, targetDocumentId },
    signal,
  );
}

export async function workspaceNavigate(
  params: { docId: string; unit?: string; delta?: number },
  signal?: AbortSignal,
): Promise<WorkspaceNavigateResult> {
  return workspacePost<WorkspaceNavigateResult>(
    "/api/workspace/navigate",
    { docId: params.docId, unit: params.unit ?? "day", delta: params.delta ?? 1 },
    signal,
    "native-preferred",
  );
}

export type WorkspaceNavigateKeyResult = {
  documentId: string;
  stepped: boolean;
  appliedSteps?: number;
  displayDatetime: string | null;
  documents?: DaemonDocumentSummary[];
  /** The freshly-rendered chart for the stepped doc (``step_fast`` overlay mode),
   * attached so the skin paints from the POST result and skips the second
   * snapshot GET. See WorkspaceNavigateResult.snapshot. */
  snapshot?: ChartRenderSnapshot;
};

/**
 * Canonical arrow-key navigation — forwards the raw keypress + modifiers to the
 * daemon, which delegates to ChartSession._navigate_intrinsically (transit/root:
 * day/hour/minute/week/lunar-phase chosen server-side) or the year/cycle stepper
 * for return/progression children. NO unit logic lives in JS — the session's
 * per-kind navigation_units + modifiers decide the unit on the Python side.
 * `key` is one of left|right|up|down|space. Spec:
 * doc/migration/surfaces/arrow-stepping.md.
 */
export async function workspaceNavigateKey(
  docId: string,
  key: string,
  shift: boolean,
  alt: boolean,
  repeat = 1,
  signal?: AbortSignal,
): Promise<WorkspaceNavigateKeyResult> {
  return workspacePost<WorkspaceNavigateKeyResult>(
    "/api/workspace/navigate-key",
    { docId, key, shift, alt, repeat },
    signal,
    "native-preferred",
  );
}

export type WorkspaceToggleComparisonResult = {
  documentId: string;
  toggled: boolean;
  /** New ChartSession.view_mode: 0 = singleton (CHART), 1 = comparison (COMPOUND). */
  viewMode: number;
  documents: DaemonDocumentSummary[];
  /** Full re-rendered chart for the toggled doc (the ring structure changed, so
   * the daemon renders overlayRenderMode "full"). Absent if the toggle was a
   * no-op (e.g. a plain radix with nothing to compare). */
  snapshot?: ChartRenderSnapshot;
};

export type WorkspaceSynastryCompositeResult = {
  documentId: string;
  compoundKind: string | null;
  compositeVariant: string | null;
  viewMode: number;
  documents: DaemonDocumentSummary[];
  snapshot?: ChartRenderSnapshot;
};

/**
 * Toggle comparison (biwheel) <-> singleton view for a document — the wx-free
 * twin of the TAB key (keyboard_layers TAB -> toggleComparisonView). The daemon
 * flips cs.view_mode and returns the new viewMode + a full re-rendered snapshot.
 */
export async function workspaceToggleComparison(
  docId: string,
  signal?: AbortSignal,
): Promise<WorkspaceToggleComparisonResult> {
  return workspacePost<WorkspaceToggleComparisonResult>(
    "/api/workspace/toggle-comparison",
    { docId },
    signal,
  );
}

/**
 * Switch a synastry document to midpoint/Davison composite or back to synastry.
 * The daemon owns the composite build/cache; React only forwards the intent.
 */
export async function workspaceSynastryComposite(
  docId: string,
  variant?: "midpoint" | "davison" | "synastry" | null,
  signal?: AbortSignal,
): Promise<WorkspaceSynastryCompositeResult> {
  return workspacePost<WorkspaceSynastryCompositeResult>(
    "/api/workspace/synastry-composite",
    { docId, variant: variant ?? null },
    signal,
  );
}

// ---------------------------------------------------------------------------
// WS event stream — /ws/events. The controller broadcasts semantic events
// (daemon.ready / documents.changed / document.changed / active_document.changed / session.changed)
// to every connected client. The shapes below are verbatim from
// workspace_service._on_controller_event + server.websocket_events.
// ---------------------------------------------------------------------------

export type DaemonEvent =
  | { type: "daemon.ready" }
  | { type: "documents.changed"; tree: DaemonDocumentSummary[] }
  | {
      type: "document.changed";
      docId: string;
      title?: string;
      dirty?: boolean;
      editDirty?: boolean;
      stepDirty?: boolean;
    }
  | { type: "active_document.changed"; docId: string | null }
  | {
      type: "session.changed";
      docId: string | null;
      changeReason: string;
      isActive: boolean;
      rebuiltChildIds: string[];
      displayDatetime: string | null;
      tabSuffix: string | null;
      listDataChanged?: boolean;
    }
  | {
      type: "options.changed";
      refreshedDocumentIds: string[];
      refreshMode?: string | null;
      styleOnly?: boolean;
      listDataChanged?: boolean;
      retainedListTarget?: "aspect-list" | null;
      retainedListDataKey?: string;
      ephemerisDataKey?: string;
      retainedListDisplay?: RetainedListDisplay;
      inspectorDataChanged?: boolean;
      langid?: number;
      schemaVersion?: number;
      themeVersion: number;
      styleRevision?: number;
      paletteHash: string;
      styleHash?: string;
    };

export type WorkspaceEventSubscription = { close: () => void };

/**
 * Reconnecting WebSocket subscription to /ws/events. Calls `onEvent` for every
 * decoded daemon event and `onStatus` on connect/disconnect. Returns a handle
 * whose `close()` tears down the socket and cancels any pending reconnect.
 *
 * Reconnection uses a capped backoff so a daemon restart re-syncs the client
 * without a reload. Callers should re-seed via `workspaceState()` on each
 * (re)connect to recover any events missed while the socket was down.
 */
export function subscribeWorkspaceEvents(handlers: {
  onEvent: (event: DaemonEvent) => void;
  onStatus?: (status: "open" | "closed") => void;
}): WorkspaceEventSubscription {
  const wsUrl = daemonWebSocketUrl();
  let socket: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let attempt = 0;
  let disposed = false;

  const connect = () => {
    if (disposed) return;
    void waitForDaemonHealth()
      .then(() => {
        if (disposed) return;
        let ws: WebSocket;
        try {
          ws = new WebSocket(wsUrl);
        } catch {
          scheduleReconnect();
          return;
        }
        socket = ws;
        ws.onopen = () => {
          attempt = 0;
          handlers.onStatus?.("open");
        };
        ws.onmessage = (ev) => {
          let parsed: DaemonEvent;
          try {
            parsed = JSON.parse(ev.data as string) as DaemonEvent;
          } catch {
            return;
          }
          handlers.onEvent(parsed);
        };
        ws.onclose = () => {
          handlers.onStatus?.("closed");
          if (socket === ws) socket = null;
          scheduleReconnect();
        };
        ws.onerror = () => {
          // onclose follows; let it drive the reconnect.
          try {
            ws.close();
          } catch {
            /* noop */
          }
        };
      })
      .catch(() => {
        scheduleReconnect();
      });
  };

  const scheduleReconnect = () => {
    if (disposed || reconnectTimer) return;
    attempt += 1;
    const delay = Math.min(500 * 2 ** (attempt - 1), 5000);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  };

  connect();

  return {
    close: () => {
      disposed = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (socket) {
        try {
          socket.onclose = null;
          socket.close();
        } catch {
          /* noop */
        }
        socket = null;
      }
    },
  };
}

// ── About (Help menu) ───────────────────────────────────────────────────────
// Product identity, release metadata, and attribution are daemon-owned. The
// current Help manual is native React content backed by the workspace manifest.

export type AboutLegacyContributor = {
  name: string;
  contributionKey: string;
};

export type AboutPayload = {
  brand: string;
  version: string;
  buildStamp?: string | null;
  primaryAuthor: string;
  primaryContact: string;
  copyrightYear: number;
  taglineKey: string;
  copyrightKey: string;
  swissEphemerisKey: string;
  swissEphemerisVersion: string;
  websiteUrl: string;
  sourceUrl: string;
  licenseUrl: string;
  noticesUrl: string;
  creditsHeadingKey: string;
  licenseNameKey: string;
  contributorsHeadingKey: string;
  legacyContributors: AboutLegacyContributor[];
};

export async function fetchAbout(signal?: AbortSignal): Promise<AboutPayload> {
  const response = await daemonFetch(`${daemonBaseUrl()}/api/about`, {
    cache: "no-store",
    signal,
  });
  if (!response.ok) {
    throw new Error(`about request failed: ${response.status}`);
  }
  return (await response.json()) as AboutPayload;
}
