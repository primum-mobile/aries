// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import * as React from "react";

import type { ChartRenderSnapshot } from "@/lib/chart/types";

/**
 * Step-coupled live surfaces (daemon live_surface_service).
 *
 * A visible surface that should follow arrow stepping registers what it would
 * fetch. Each navigate-key request carries the registered requests for the
 * stepped document; the daemon builds them within a fixed step budget and
 * returns them inside that step's snapshot, so the surface repaints with the
 * wheel from the same response. A `deferred` or `error` result means the
 * surface uses its ordinary fetch/settle path instead.
 */
export type LiveSurfaceRequest = {
  key: string;
  kind: "table" | "inspector" | "inspector-flag";
  documentId: string;
  tableId?: string;
  /** A slimmer payload holding only what the surface reads. */
  view?: "speculum-inspector";
  regionKind?: string;
  objectId?: string;
  chartRole?: string;
  ringIndex?: number;
};

export type LiveSurfaceResult =
  | { status: "ok"; payload: unknown; ms: number }
  | { status: "deferred" }
  | { status: "error"; detail?: string };

/** Lower runs first; the daemon defers whatever exceeds its budget. */
export const LIVE_SURFACE_PRIORITY = {
  inspectorRegion: 0,
  hoverFlag: 1,
  speculum: 2,
} as const;

const MAX_LIVE_SURFACES = 8;
const registry = new Map<number, { request: LiveSurfaceRequest; priority: number }>();
let nextRegistration = 0;

/** Registered requests for one stepped document, highest priority first. */
export function liveSurfaceRequests(documentId: string): LiveSurfaceRequest[] {
  const seen = new Set<string>();
  return [...registry.values()]
    .filter(({ request }) => request.documentId === documentId)
    .sort((a, b) => a.priority - b.priority)
    .map(({ request }) => request)
    .filter((request) => !seen.has(request.key) && Boolean(seen.add(request.key)))
    .slice(0, MAX_LIVE_SURFACES);
}

/** Keep `request` registered while it is non-null and the surface is mounted. */
export function useLiveSurfaceRequest(request: LiveSurfaceRequest | null, priority: number): void {
  const requestJson = request ? JSON.stringify(request) : null;
  React.useEffect(() => {
    if (!requestJson) return;
    const registration = ++nextRegistration;
    registry.set(registration, { request: JSON.parse(requestJson) as LiveSurfaceRequest, priority });
    return () => {
      registry.delete(registration);
    };
  }, [requestJson, priority]);
}

export function liveSurfaceResult(
  chart: ChartRenderSnapshot | null | undefined,
  key: string | null,
): LiveSurfaceResult | undefined {
  return key ? chart?.liveSurfaces?.[key] : undefined;
}

/**
 * Hand each step's live payload to the surface exactly once per result object.
 * A later refresh of the same chart (options, settle) must not be answered by
 * that step payload again; callers keep their own fetch for those.
 *
 * The stepped wheel is the urgent lane. The surface update runs after that
 * paint as a transition, so rendering a table of stepped values never delays
 * the wheel or the next arrow input; a newer step simply supersedes it.
 */
export function useFreshLivePayload<T>(
  result: LiveSurfaceResult | undefined,
  onPayload: (payload: T, result: LiveSurfaceResult) => void,
): void {
  const consumedRef = React.useRef<LiveSurfaceResult | undefined>(undefined);
  const onPayloadRef = React.useRef(onPayload);
  React.useLayoutEffect(() => {
    onPayloadRef.current = onPayload;
  });
  React.useEffect(() => {
    if (result?.status !== "ok" || consumedRef.current === result) return;
    consumedRef.current = result;
    React.startTransition(() => {
      onPayloadRef.current(result.payload as T, result);
    });
  }, [result]);
}
