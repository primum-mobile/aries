// SPDX-FileCopyrightText: Morinus contributors
// SPDX-FileCopyrightText: 2026 Max Lange (Aries modifications)
// SPDX-License-Identifier: GPL-3.0-or-later
// Modified for Aries in 2026 by Max Lange.

"use client";

import { regionObjectId } from "@/lib/inspector-region-identity";

import * as React from "react";
import { createPortal } from "react-dom";
import { InspectorValueSpans } from "./inspector-value-spans";

import {
  fetchInspectorFlagPayload,
  type InspectorFlagPayload,
  type InspectorFlagRow,
  type InspectorFlagSpan,
  type InspectorRegionQuery,
  type RGB,
  type SupplementaryBindingPayload,
} from "@/lib/daemon/client";
import type { ChartRenderSnapshot } from "@/lib/chart/types";
import {
  LIVE_SURFACE_PRIORITY,
  liveSurfaceResult,
  useFreshLivePayload,
  useLiveSurfaceRequest,
} from "@/lib/live-surfaces";
import { useStyleRevision } from "@/hooks/use-style-revision";
import { useLocale } from "@/lib/i18n/i18n";
import { semanticChartColor } from "@/lib/theme/semantic-color";
import { useDaemonWorkspaceView } from "@/stores/daemon-workspace-adapter";
import { useDaemonWorkspaceStore } from "@/stores/daemon-workspace-store";
import { useThemeStore } from "@/stores/theme-store";
import type { HoverRegion } from "@/stores/workspace-store";

// Show delay — port of workspace_shell._CHART_HOVER_FLAG_SHOW_DELAY_MS = 500
// (workspace_shell.py:646). The wx driver arms a one-shot timer on hover-enter
// and only paints the flag once it fires; rapid pass-through never flashes it.
const SHOW_DELAY_MS = 500;
const STARTUP_RETRY_DELAYS_MS = [160, 320, 640];

/** A symbol the pointer is hovering, plus its pixel anchor on the canvas (the
 * region geometric centre — port of workspace_shell._hover_flag_anchor_for_region,
 * workspace_shell.py:5262, which anchors the flag to the region centre). */
export type FlagAnchor = {
  region: HoverRegion;
  x: number; // viewport px (hit region centre)
  y: number;
  token: number;
};


function rgbCss(rgb: RGB | null | undefined): string | undefined {
  if (!rgb || rgb.length !== 3) return undefined;
  return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
}

function rgbaCss(rgb: RGB | null | undefined, alpha: number): string | undefined {
  if (!rgb || rgb.length !== 3) return undefined;
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
}

function semanticAlphaColor(
  role: string | null | undefined,
  fallback: RGB | null | undefined,
  alpha: number,
): string | undefined {
  const semantic = semanticChartColor(role, rgbCss(fallback));
  if (!semantic?.startsWith("var(")) return rgbaCss(fallback, alpha);
  return `color-mix(in srgb, ${semantic} ${alpha * 100}%, transparent)`;
}

function flagIdentityKey(parts: {
  kind: string | null;
  objectId: string | null;
  token: number;
  docId?: string;
  chartRole?: string;
  ringIndex?: number;
  sourceName: string;
  hereNow: boolean;
  supplementaryKind?: string;
  comparisonName?: string | null;
  viewMode?: number | null;
}): string | null {
  if (!parts.kind || parts.objectId == null) return null;
  return JSON.stringify([
    parts.kind,
    parts.objectId,
    parts.token,
    parts.docId ?? "",
    parts.chartRole ?? "",
    parts.ringIndex ?? "",
    parts.sourceName,
    parts.hereNow,
    parts.supplementaryKind ?? "",
    parts.comparisonName ?? "",
    parts.viewMode ?? "",
  ]);
}

function optionsChangeRefreshesHoverInspector(
  change: {
    styleOnly: boolean;
    listDataChanged: boolean;
    inspectorDataChanged: boolean;
  } | null,
): boolean {
  return Boolean(
    change &&
      (change.inspectorDataChanged === true ||
        (!change.styleOnly && change.listDataChanged !== false)),
  );
}

function useHoverSemanticOptionsSeq(): number {
  const lastOptionsChange = useDaemonWorkspaceStore((state) => state.lastOptionsChange);
  const [seq, setSeq] = React.useState(() =>
    optionsChangeRefreshesHoverInspector(lastOptionsChange)
      ? (lastOptionsChange?.seq ?? 0)
      : 0,
  );

  React.useEffect(() => {
    if (!lastOptionsChange || !optionsChangeRefreshesHoverInspector(lastOptionsChange)) {
      return;
    }
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setSeq(lastOptionsChange.seq);
    });
    return () => {
      cancelled = true;
    };
  }, [lastOptionsChange]);

  return seq;
}

function retainDeferredFlagSlots(
  current: InspectorFlagPayload | null,
  next: InspectorFlagPayload,
): InspectorFlagPayload {
  let retained = next;
  if (next.deferredSlots?.includes("void-course") && current?.voidCourseRow) {
    retained = {
      ...retained,
      voidCourseRow: current.voidCourseRow,
      rows: [...retained.rows, current.voidCourseRow],
    };
  }
  if (next.deferredSlots?.includes("stations") && current?.nextStationRow) {
    retained = {
      ...retained,
      nextStationRow: current.nextStationRow,
      rows: [...retained.rows, current.nextStationRow],
    };
  }
  return retained;
}

/**
 * The compact floating glyph card pinned to the hovered chart symbol. This is
 * the OTHER inspector entry point (chartinspector.build_flag_payload,
 * chartinspector.py:1148) — distinct from the side pane (build_payload). The wx
 * surface is the on-chart overlay window driven by
 * workspace_shell._update_hover_flag / _apply_hover_flag / _clear_hover_flag
 * (workspace_shell.py:5300-5340): hover-enter → fetch + show (after the delay),
 * move → reposition, leave → clear. We render the daemon JSON verbatim; nothing
 * about the card's content is computed here.
 */
export function ChartHoverFlag({
  anchor,
  chart,
}: {
  anchor: FlagAnchor | null;
  chart: ChartRenderSnapshot;
}) {
  const locale = useLocale();
  const styleRevision = useStyleRevision();
  const semanticOptionsSeq = useHoverSemanticOptionsSeq();
  const appTokens = useThemeStore((state) => state.theme?.appTokens);
  const { activeDocument: activeDoc } = useDaemonWorkspaceView();
  const [payloadState, setPayloadState] = React.useState<{
    identityKey: string;
    payload: InspectorFlagPayload;
  } | null>(null);
  const payloadRef = React.useRef<InspectorFlagPayload | null>(null);
  const retryCountsRef = React.useRef(new Map<string, number>());
  const [retryTick, setRetryTick] = React.useState(0);
  const cardRef = React.useRef<HTMLDivElement | null>(null);
  const [cardSize, setCardSize] = React.useState({ width: 0, height: 0 });
  const [viewportSize, setViewportSize] = React.useState({ width: 0, height: 0 });
  const flagGeometry = React.useMemo(() => {
    const rootStyle =
      typeof document === "undefined"
        ? null
        : window.getComputedStyle(document.documentElement);
    const value = (name: string) => {
      const parsed = Number.parseFloat(
        appTokens?.[name] ?? rootStyle?.getPropertyValue(name) ?? "",
      );
      return Number.isFinite(parsed) ? parsed : 0;
    };
    return {
      viewportMargin: value("--aries-inspector-hover-flag-viewport-margin"),
      anchorGapX: value("--aries-inspector-hover-flag-anchor-gap-x"),
      anchorGapY: value("--aries-inspector-hover-flag-anchor-gap-y"),
      compactMinWidth: value("--aries-inspector-hover-flag-compact-min-width"),
      minWidth: value("--aries-inspector-hover-flag-min-width"),
      compactMinHeight: value("--aries-inspector-hover-flag-compact-min-height"),
      minHeight: value("--aries-inspector-hover-flag-min-height"),
      accentBorderOpacity: value(
        "--aries-inspector-hover-flag-accent-border-opacity",
      ),
    };
  }, [appTokens]);

  const region = anchor?.region ?? null;
  const objectId = region ? regionObjectId(region) : null;
  const kind = region?.kind ?? null;
  const chartRole = region && "chartRole" in region ? region.chartRole : undefined;
  const ringIndex = region && "ringIndex" in region ? region.ringIndex : undefined;
  const snapshotDoc = chart.document ?? null;
  const docId = snapshotDoc?.documentId ?? activeDoc?.id ?? undefined;
  const sourceName = activeDoc && activeDoc.id === docId
    ? activeDoc.sourceName
    : chart.primaryChart.meta.name || activeDoc?.sourceName || "Morinus";
  const hereNow = snapshotDoc ? false : activeDoc?.kind === "here-now";
  const supplementaryKind = snapshotDoc ? undefined : activeDoc?.supplementaryFeatureKind;
  const comparisonName = snapshotDoc?.comparisonName ?? activeDoc?.comparisonSourceName;
  const viewMode = snapshotDoc?.viewMode ?? chart.document?.viewMode;
  const deferSignals = chart.overlayRenderMode === "step_fast";
  const when = snapshotDoc?.displayDatetime ?? activeDoc?.displayDatetime ?? null;
  const binding = (snapshotDoc?.binding ?? activeDoc?.supplementaryBinding) as
    | SupplementaryBindingPayload
    | undefined;
  const bindingKey = React.useMemo(() => JSON.stringify(binding ?? null), [binding]);
  const identityKey = `${flagIdentityKey({
    kind,
    objectId,
    token: anchor?.token ?? 0,
    docId,
    chartRole,
    ringIndex,
    sourceName,
    hereNow,
    supplementaryKind,
    comparisonName,
    viewMode,
  })}:${locale}:${snapshotDoc?.chartPresentation?.coordinateMode ?? "zodiacal"}:${snapshotDoc?.chartPresentation?.revision ?? 0}`;

  const canFetch = Boolean(region && kind && objectId != null && (docId || sourceName));
  const payload = payloadState?.identityKey === identityKey ? payloadState.payload : null;

  React.useEffect(() => {
    payloadRef.current = payload;
  }, [payload]);

  // A showing flag follows arrow stepping from the step snapshot itself
  // (live_surface_service) instead of refetching after each stepped paint.
  const liveKey = payload && canFetch && docId && kind && objectId != null
    ? `flag:${JSON.stringify([docId, kind, objectId, chartRole ?? "primary", ringIndex ?? null])}`
    : null;
  useLiveSurfaceRequest(
    liveKey && docId && kind && objectId != null
      ? { key: liveKey, kind: "inspector-flag", documentId: docId, regionKind: kind, objectId: String(objectId), chartRole, ringIndex }
      : null,
    LIVE_SURFACE_PRIORITY.hoverFlag,
  );
  const liveResult = liveSurfaceResult(chart, liveKey);
  const liveShownRef = React.useRef<{ result: unknown; identityKey: string } | null>(null);
  useFreshLivePayload<InspectorFlagPayload>(liveResult, (livePayload, result) => {
    liveShownRef.current = { result, identityKey };
    setPayloadState((current) => ({
      identityKey,
      payload: retainDeferredFlagSlots(
        current?.identityKey === identityKey ? current.payload : null,
        livePayload,
      ),
    }));
  });
  const requestedRefreshRef = React.useRef({ retryTick, semanticOptionsSeq });

  // Mirror the wx show/clear lifecycle: arm a one-shot delay on hover-enter,
  // fetch the flag payload, then show. Once visible, a same-identity live chart
  // mutation (keyboard stepping) refetches immediately and keeps the old payload
  // painted until the daemon returns the new degrees. The supplementary binding
  // intentionally stays out of identityKey: return/progression stepping mutates
  // it on every keypress, but the hovered object is still the same flag.
  React.useEffect(() => {
    if (!canFetch || !kind || objectId == null || !identityKey) return;
    const requested = requestedRefreshRef.current;
    const refreshRequested =
      requested.retryTick !== retryTick || requested.semanticOptionsSeq !== semanticOptionsSeq;
    requestedRefreshRef.current = { retryTick, semanticOptionsSeq };
    // This step's own flag is already shown; only a semantic refresh refetches.
    const liveShown = liveShownRef.current;
    if (
      !refreshRequested &&
      liveShown?.result === liveResult &&
      liveShown?.identityKey === identityKey
    ) {
      return;
    }
    const controller = new AbortController();
    let retryTimer: number | null = null;
    const query: InspectorRegionQuery = {
      kind,
      objectId,
      docId,
      // 'outer' for a biwheel outer-ring body → daemon resolves it against the
      // comparison chart (graphchart region.chart_role, graphchart.py:2151).
      chartRole,
      ringIndex,
      name: sourceName,
      hereNow,
      supplementaryKind:
        supplementaryKind && supplementaryKind !== "synastry" ? supplementaryKind : undefined,
      comparisonName: comparisonName ?? undefined,
      viewMode,
      when: when ?? undefined,
      binding,
      deferSignals,
    };
    const retryCount = retryCountsRef.current.get(identityKey) ?? 0;
    const delay = payloadRef.current ? 0 : retryCount > 0 ? 0 : SHOW_DELAY_MS;
    const timer = window.setTimeout(() => {
      fetchInspectorFlagPayload(query, controller.signal)
        .then((nextPayload) => {
          retryCountsRef.current.delete(identityKey);
          setPayloadState((current) => ({
            identityKey,
            payload: retainDeferredFlagSlots(
              current?.identityKey === identityKey ? current.payload : null,
              nextPayload,
            ),
          }));
        })
        .catch((err) => {
          if ((err as { name?: string }).name === "AbortError") return;
          const message = err instanceof Error ? err.message : "";
          const retryable =
            message.startsWith("inspector flag request failed: 404") ||
            message.startsWith("inspector flag request failed: 503") ||
            message.includes("Failed to fetch");
          if (retryable) {
            const nextRetry = retryCount + 1;
            const retryDelay = STARTUP_RETRY_DELAYS_MS[retryCount];
            if (retryDelay != null) {
              retryCountsRef.current.set(identityKey, nextRetry);
              retryTimer = window.setTimeout(() => {
                setRetryTick((tick) => tick + 1);
              }, retryDelay);
              return;
            }
            if (message.startsWith("inspector flag request failed: 404")) {
              retryCountsRef.current.delete(identityKey);
              setPayloadState((current) =>
                current?.identityKey === identityKey ? null : current,
              );
              return;
            }
          }
          console.error("[inspector:flag]", err);
        });
    }, delay);
    return () => {
      window.clearTimeout(timer);
      if (retryTimer != null) window.clearTimeout(retryTimer);
      controller.abort();
    };
  }, [canFetch, kind, objectId, docId, chartRole, ringIndex, sourceName, hereNow, supplementaryKind, comparisonName, viewMode, when, binding, bindingKey, deferSignals, identityKey, retryTick, semanticOptionsSeq, liveResult]);

  React.useEffect(() => {
    const updateViewport = () => {
      setViewportSize({ width: window.innerWidth, height: window.innerHeight });
    };
    updateViewport();
    window.addEventListener("resize", updateViewport);
    return () => window.removeEventListener("resize", updateViewport);
  }, []);

  React.useLayoutEffect(() => {
    if (!payload || !cardRef.current) return;
    const rect = cardRef.current.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      setCardSize({ width: rect.width, height: rect.height });
    }
  }, [payload, anchor?.x, anchor?.y, styleRevision]);

  if (!anchor || !canFetch || !payload) return null;
  const title = (payload.title ?? "").trim();
  const glyph = (payload.glyph ?? "").trim();
  const rows = payload.rows ?? [];
  const hasRowLabels = rows.some((row) => String(row[0] ?? "").trim().length > 0);
  if (!title && rows.length === 0) return null;

  const compact = Boolean(payload.compact);
  const accentBorder = semanticAlphaColor(
    payload.accentRole,
    payload.accent,
    flagGeometry.accentBorderOpacity,
  );
  const portalTarget = typeof document === "undefined" ? null : document.body;
  if (!portalTarget) return null;

  const viewportWidth =
    viewportSize.width || (typeof window !== "undefined" ? window.innerWidth : 0);
  const viewportHeight =
    viewportSize.height || (typeof window !== "undefined" ? window.innerHeight : 0);
  const margin = flagGeometry.viewportMargin;
  const xGap = flagGeometry.anchorGapX;
  const yGap = flagGeometry.anchorGapY;
  const cardWidth = Math.max(
    cardSize.width,
    compact ? flagGeometry.compactMinWidth : flagGeometry.minWidth,
  );
  const cardHeight = Math.max(
    cardSize.height,
    compact ? flagGeometry.compactMinHeight : flagGeometry.minHeight,
  );
  let left = anchor.x + xGap;
  let top = anchor.y - cardHeight - yGap;

  if (viewportWidth > 0 && left + cardWidth + margin > viewportWidth) {
    left = anchor.x - cardWidth - xGap;
  }
  if (left < margin) {
    left = Math.max(margin, viewportWidth > 0 ? viewportWidth - cardWidth - margin : margin);
  }
  if (top < margin) {
    top = anchor.y + yGap;
  }
  if (viewportHeight > 0 && top + cardHeight + margin > viewportHeight) {
    top = Math.max(margin, viewportHeight - cardHeight - margin);
  }
  const rowContent = rows.length > 0 ? (
    <div
      className="grid items-baseline gap-x-[var(--aries-inspector-section-gap)] gap-y-[var(--aries-inspector-row-gap)]"
      style={{
        gridTemplateColumns: hasRowLabels ? "auto 1fr" : "1fr",
        fontSize: compact
          ? "var(--aries-font-size-section)"
          : "var(--aries-font-size-small)",
        marginTop: payload.signGlyph
          ? undefined
          : compact
            ? "var(--aries-control-gap-compact)"
            : "var(--aries-control-gap)",
      }}
    >
      {rows.map((row, idx) => (
        <FlagRow key={idx} row={row} showLabel={hasRowLabels} />
      ))}
    </div>
  ) : null;

  // Anchor the card near the symbol centre, like the wx overlay, but render it
  // fixed at the document body level. That keeps it above panes/inspectors and
  // outside any clipped chart stacking context; pointer-events:none prevents it
  // from stealing hover.
  return createPortal(
    <div
      className="pointer-events-none fixed"
      style={{
        left,
        top,
        zIndex: 2147483647,
      }}
    >
      <div
        ref={cardRef}
        className="rounded-[var(--aries-radius-md)] border bg-background/95"
        style={{
          borderColor: accentBorder ?? "var(--border)",
          paddingInline: compact
            ? "calc(var(--aries-control-padding-x) * 7 / 10)"
            : "calc(var(--aries-control-padding-x) * 9 / 10)",
          paddingBlock: compact
            ? "var(--aries-control-padding-y)"
            : "var(--aries-control-gap)",
          minWidth: compact
            ? undefined
            : "var(--aries-inspector-hover-flag-content-min-width)",
          maxWidth:
            "min(var(--aries-dialog-width-xs), calc(100vw - var(--aries-inspector-hover-flag-viewport-margin) - var(--aries-inspector-hover-flag-viewport-margin)))",
          boxShadow: "var(--aries-inspector-hover-flag-shadow)",
          backdropFilter:
            "blur(var(--aries-inspector-hover-flag-backdrop-blur))",
          WebkitBackdropFilter:
            "blur(var(--aries-inspector-hover-flag-backdrop-blur))",
        }}
      >
        <div
          className={payload.signGlyph
            ? "grid grid-cols-[max-content_minmax(0,1fr)] items-center"
            : payload.titleSpans?.length
            ? "flex flex-wrap items-baseline"
            : "flex items-baseline whitespace-nowrap"}
          style={{
            columnGap: payload.signGlyph
              ? "var(--aries-control-gap)"
              : compact
              ? "var(--aries-control-gap-compact)"
              : "var(--aries-inspector-section-gap)",
            rowGap: payload.signGlyph ? "var(--aries-control-gap-compact)" : undefined,
          }}
        >
          {payload.signGlyph || glyph ? (
            <span
              style={{
                fontSize: compact || payload.signGlyph
                  ? "var(--aries-font-size-large)"
                  : "var(--aries-font-size-dialog-title)",
              }}
              className="inline-flex shrink-0 items-center gap-[var(--aries-control-gap-compact)] font-symbols leading-none text-foreground/90"
            >
              {payload.signGlyph ? (
                <span
                  style={{ color: semanticChartColor(payload.signColourRole, null) }}
                  aria-label={payload.signLabel}
                  title={payload.signLabel}
                >
                  {payload.signGlyph}
                </span>
              ) : null}
              {glyph ? (
                <span style={{
                  color: compact || payload.signGlyph
                    ? semanticChartColor(payload.accentRole, rgbCss(payload.accent))
                    : undefined,
                }}>
                  {glyph}
                </span>
              ) : null}
            </span>
          ) : null}
          <span
            className="min-w-0 font-semibold leading-tight text-foreground/90"
            aria-label={payload.titleLabel}
            title={payload.titleLabel}
            style={{
              fontSize: compact
                ? "var(--aries-font-size-small)"
                : "var(--aries-font-size-reading)",
            }}
          >
            {payload.titleSpans?.length ? <InspectorValueSpans spans={payload.titleSpans} /> : title}
          </span>
          {payload.motionGlyph ? (
            <span
              className="shrink-0 leading-none text-foreground/70"
              style={{
                color: semanticChartColor(payload.accentRole, rgbCss(payload.accent)),
                fontFamily:
                  payload.motionUsesSymbolFont
                    ? "var(--aries-font-symbols)"
                    : undefined,
                fontSize: compact
                  ? "var(--aries-font-size-section)"
                  : "var(--aries-font-size-base)",
              }}
              aria-label={payload.motionLabel || undefined}
              title={payload.motionLabel || undefined}
            >
              {payload.motionGlyph}
            </span>
          ) : null}
          {payload.signGlyph && rowContent ? (
            <div className="col-start-2 min-w-0">{rowContent}</div>
          ) : null}
        </div>
        {!payload.signGlyph ? rowContent : null}
      </div>
    </div>,
    portalTarget,
  );
}

/** One flag row: a label column + a value (plain text, coloured text, or a span
 * run of glyph/text segments). Renders the tuple shape verbatim — no derivation.
 * Tuple layout: [label, value] | [label, value, colour] | [label, "", null, spans]. */
function FlagRow({ row, showLabel }: { row: InspectorFlagRow; showLabel: boolean }) {
  const label = String(row[0] ?? "");
  const value = String(row[1] ?? "");
  const colour = row.length >= 3 ? (row[2] as RGB | null) : null;
  const spans = row.length >= 4 ? (row[3] as InspectorFlagSpan[]) : null;
  const colourRole = row.length >= 5 ? (row[4] as string | null) : null;

  // Two cells of the parent grid: label (col 1) + value (col 2). Returning a
  // fragment — not a wrapping flex — is what lets the grid share the label
  // column width across every row so the values line up.
  return (
    <>
      {showLabel ? (
        <span className="whitespace-nowrap leading-tight text-foreground/45">
          {label}
        </span>
      ) : null}
      {spans && spans.length > 0 ? (
        <span className={spans.some((span) => span.wrapGroup !== undefined)
          ? "min-w-0 whitespace-normal leading-tight text-foreground/85"
          : "whitespace-nowrap leading-tight text-foreground/85"}>
          <InspectorValueSpans spans={spans} />
        </span>
      ) : (
        <span
          className="whitespace-pre leading-tight text-foreground/85"
          style={{ color: semanticChartColor(colourRole, rgbCss(colour)) }}
        >
          {value}
        </span>
      )}
    </>
  );
}
