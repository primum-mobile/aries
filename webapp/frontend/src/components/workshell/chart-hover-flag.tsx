"use client";

import * as React from "react";
import { createPortal } from "react-dom";

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
import { useLocale } from "@/lib/i18n/i18n";
import { useDaemonWorkspaceView } from "@/stores/daemon-workspace-adapter";
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

/** Region → the object_id the daemon flag route expects. Identical mapping to
 * inspector-panel.regionObjectId (inspector-panel.tsx:144) — same /api/inspector
 * region contract, reused by /api/inspector/flag. */
function regionObjectId(region: HoverRegion): string | null {
  if (region.kind === "planet") return String(region.seId);
  // Vertex object id = the CHART_OBJECT_VERTEX SE id (common.py:42 =
  // SE_CHIRON+1). The daemon routes kind='vertex' to the same planet-region
  // builder with this index, which build_flag_payload resolves to 'Vertex'.
  if (region.kind === "vertex") return "vertex";
  if (region.kind === "fortune") return "fortune";
  if (region.kind === "syzygy") return "syzygy";
  if (region.kind === "angle") return region.angleId;
  if (region.kind === "house") return String(region.houseIndex);
  if (region.kind === "sign") return String(region.signIndex);
  if (region.kind === "secondary_ring") {
    return `${region.family}|${region.longitude}|${region.label}`;
  }
  if (region.kind === "aspect") {
    if (region.scope === "interchart") {
      return `interchart:${region.p1}:${region.p2}:${region.aspectType}`;
    }
    return `${region.p1}:${region.p2}:${region.aspectType}`;
  }
  return null;
}

function rgbCss(rgb: RGB | null | undefined): string | undefined {
  if (!rgb || rgb.length !== 3) return undefined;
  return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
}

function rgbaCss(rgb: RGB | null | undefined, alpha: number): string | undefined {
  if (!rgb || rgb.length !== 3) return undefined;
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
}

function flagIdentityKey(parts: {
  kind: string | null;
  objectId: string | null;
  token: number;
  docId?: string;
  chartRole?: string;
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
    parts.sourceName,
    parts.hereNow,
    parts.supplementaryKind ?? "",
    parts.comparisonName ?? "",
    parts.viewMode ?? "",
  ]);
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
  const { activeDocument: activeDoc } = useDaemonWorkspaceView();
  const [payloadState, setPayloadState] = React.useState<{
    identityKey: string;
    payload: InspectorFlagPayload;
  } | null>(null);
  const payloadRef = React.useRef<InspectorFlagPayload | null>(null);
  const retryCountsRef = React.useRef(new Map<string, number>());
  const [retryTick, setRetryTick] = React.useState(0);
  const cardRef = React.useRef<HTMLDivElement | null>(null);
  const [cardSize, setCardSize] = React.useState({ width: 180, height: 96 });
  const [viewportSize, setViewportSize] = React.useState({ width: 0, height: 0 });

  const region = anchor?.region ?? null;
  const objectId = region ? regionObjectId(region) : null;
  const kind = region?.kind ?? null;
  const chartRole = region && "chartRole" in region ? region.chartRole : undefined;
  const snapshotDoc = chart.document ?? null;
  const docId = snapshotDoc?.documentId ?? activeDoc?.id ?? undefined;
  const sourceName = activeDoc && activeDoc.id === docId
    ? activeDoc.sourceName
    : chart.primaryChart.meta.name || activeDoc?.sourceName || "Morinus";
  const hereNow = snapshotDoc ? false : activeDoc?.kind === "here-now";
  const supplementaryKind = snapshotDoc ? undefined : activeDoc?.supplementaryFeatureKind;
  const comparisonName = snapshotDoc?.comparisonName ?? activeDoc?.comparisonSourceName;
  const viewMode = snapshotDoc?.viewMode ?? chart.document?.viewMode;
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
    sourceName,
    hereNow,
    supplementaryKind,
    comparisonName,
    viewMode,
  })}:${locale}`;

  const canFetch = Boolean(region && kind && objectId != null && (docId || sourceName));
  const payload = payloadState?.identityKey === identityKey ? payloadState.payload : null;

  React.useEffect(() => {
    payloadRef.current = payload;
  }, [payload]);

  // Mirror the wx show/clear lifecycle: arm a one-shot delay on hover-enter,
  // fetch the flag payload, then show. Once visible, a same-identity live chart
  // mutation (keyboard stepping) refetches immediately and keeps the old payload
  // painted until the daemon returns the new degrees. The supplementary binding
  // intentionally stays out of identityKey: return/progression stepping mutates
  // it on every keypress, but the hovered object is still the same flag.
  React.useEffect(() => {
    if (!canFetch || !kind || objectId == null || !identityKey) return;
    const controller = new AbortController();
    let retryTimer: number | null = null;
    const query: InspectorRegionQuery = {
      kind,
      objectId,
      docId,
      // 'outer' for a biwheel outer-ring body → daemon resolves it against the
      // comparison chart (graphchart region.chart_role, graphchart.py:2151).
      chartRole,
      name: sourceName,
      hereNow,
      supplementaryKind:
        supplementaryKind && supplementaryKind !== "synastry" ? supplementaryKind : undefined,
      comparisonName: comparisonName ?? undefined,
      viewMode,
      when: when ?? undefined,
      binding,
    };
    const retryCount = retryCountsRef.current.get(identityKey) ?? 0;
    const delay = payloadRef.current ? 0 : retryCount > 0 ? 0 : SHOW_DELAY_MS;
    const timer = window.setTimeout(() => {
      fetchInspectorFlagPayload(query, controller.signal)
        .then((nextPayload) => {
          retryCountsRef.current.delete(identityKey);
          setPayloadState({ identityKey, payload: nextPayload });
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
            if (message.startsWith("inspector flag request failed: 404")) return;
          }
          console.error("[inspector:flag]", err);
        });
    }, delay);
    return () => {
      window.clearTimeout(timer);
      if (retryTimer != null) window.clearTimeout(retryTimer);
      controller.abort();
    };
  }, [canFetch, kind, objectId, docId, chartRole, sourceName, hereNow, supplementaryKind, comparisonName, viewMode, when, binding, bindingKey, identityKey, retryTick]);

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
  }, [payload, anchor?.x, anchor?.y]);

  if (!anchor || !canFetch || !payload) return null;
  const title = (payload.title ?? "").trim();
  const glyph = (payload.glyph ?? "").trim();
  const rows = payload.rows ?? [];
  if (!title && rows.length === 0) return null;

  const compact = Boolean(payload.compact);
  const accentBorder = rgbaCss(payload.accent, 0.55);
  const portalTarget = typeof document === "undefined" ? null : document.body;
  if (!portalTarget) return null;

  const viewportWidth =
    viewportSize.width || (typeof window !== "undefined" ? window.innerWidth : 0);
  const viewportHeight =
    viewportSize.height || (typeof window !== "undefined" ? window.innerHeight : 0);
  const margin = 8;
  const xGap = 12;
  const yGap = 10;
  const cardWidth = Math.max(cardSize.width, compact ? 120 : 180);
  const cardHeight = Math.max(cardSize.height, compact ? 56 : 96);
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
        className="rounded-md border bg-background/95 shadow-md backdrop-blur-sm"
        style={{
          borderColor: accentBorder ?? "var(--border)",
          paddingInline: compact ? 7 : 9,
          paddingBlock: compact ? 4 : 6,
          minWidth: compact ? undefined : 96,
          maxWidth: "min(360px, calc(100vw - 16px))",
        }}
      >
        <div
          className="flex items-baseline whitespace-nowrap"
          style={{ gap: compact ? 4 : 8 }}
        >
          {glyph ? (
            <span
              style={{
                color: compact ? rgbCss(payload.accent) : undefined,
                fontFamily: '"AriesMorinus"',
                fontSize: compact ? 14 : 16,
              }}
              className="leading-none text-foreground/90"
            >
              {glyph}
            </span>
          ) : null}
          <span
            className="font-semibold leading-tight text-foreground/90"
            style={{ fontSize: compact ? 11 : 13 }}
          >
            {title}
          </span>
        </div>
        {rows.length > 0 ? (
          // One shared grid (not per-row flex) so every value sits in a single
          // column whose left edge is the widest label — mirroring wx's constant
          // value_x = pad_x + label_w + LABEL_GAP (workspace_shell.py:5550).
          // Empty-label rows (aspect continuations, dignity-status flags) still
          // indent to that column instead of collapsing to the left margin.
          <div
            className="grid items-baseline gap-x-2 gap-y-[2px]"
            style={{
              gridTemplateColumns: "auto 1fr",
              fontSize: compact ? 10 : 11,
              marginTop: compact ? 4 : 6,
            }}
          >
            {rows.map((row, idx) => (
              <FlagRow key={idx} row={row} />
            ))}
          </div>
        ) : null}
      </div>
    </div>,
    portalTarget,
  );
}

/** One flag row: a label column + a value (plain text, coloured text, or a span
 * run of glyph/text segments). Renders the tuple shape verbatim — no derivation.
 * Tuple layout: [label, value] | [label, value, colour] | [label, "", null, spans]. */
function FlagRow({ row }: { row: InspectorFlagRow }) {
  const label = String(row[0] ?? "");
  const value = String(row[1] ?? "");
  const colour = row.length >= 3 ? (row[2] as RGB | null) : null;
  const spans = row.length >= 4 ? (row[3] as InspectorFlagSpan[]) : null;

  // Two cells of the parent grid: label (col 1) + value (col 2). Returning a
  // fragment — not a wrapping flex — is what lets the grid share the label
  // column width across every row so the values line up.
  return (
    <>
      <span className="whitespace-nowrap leading-tight text-foreground/45">
        {label}
      </span>
      {spans && spans.length > 0 ? (
        <span className="whitespace-nowrap leading-tight text-foreground/85">
          {spans.map((span, i) => (
            <span
              key={i}
              style={{
                color: rgbCss(span.colour),
                fontFamily: span.glyph ? '"AriesMorinus"' : undefined,
              }}
            >
              {span.text}
            </span>
          ))}
        </span>
      ) : (
        <span
          className="whitespace-nowrap leading-tight text-foreground/85"
          style={{ color: rgbCss(colour) }}
        >
          {value}
        </span>
      )}
    </>
  );
}
