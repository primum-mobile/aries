// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import type React from "react";
import { useCallback, useState } from "react";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuCheckboxItem,
  ContextMenuItem,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  executeWorkspaceContextMenuAction,
  fetchDocumentSnapshot,
  fetchWorkspaceContextMenu,
  workspaceSynastryComposite,
  type DirectionCustomSignificator,
  type WorkspaceContextMenuNode,
} from "@/lib/daemon/client";
import type { ChartRenderSnapshot } from "@/lib/chart/types";
import { useDaemonWorkspaceView } from "@/stores/daemon-workspace-adapter";
import { useDaemonWorkspaceStore } from "@/stores/daemon-workspace-store";
import { useWorkspaceStore, type WorkspaceDocument } from "@/stores/workspace-store";
import { useFrameLayoutStore } from "@/stores/frame-layout-store";
import { useSurveilStore } from "@/stores/surveil-store";
import { useT, useTFallback } from "@/lib/i18n/i18n";

type ChartContextMenuProps = {
  chart: ChartRenderSnapshot;
  children: React.ReactElement;
};

export function ChartContextMenu({ chart, children }: ChartContextMenuProps) {
  const t = useT();
  const { activeDocument, documents } = useDaemonWorkspaceView();
  const activeDocumentId = activeDocument?.id ?? null;
  const hoveredRegion = useWorkspaceStore((s) => s.hoveredRegion);
  const openTransitSearchPane = useWorkspaceStore((s) => s.openTransitSearchPane);
  const openDirectionsPane = useWorkspaceStore((s) => s.openDirectionsPane);
  const showRadix = useWorkspaceStore((s) => s.timedChartShowRadix);
  const setShowRadix = useWorkspaceStore((s) => s.setTimedChartShowRadix);
  const pushSteppedSnapshot = useDaemonWorkspaceStore((s) => s.pushSteppedSnapshot);
  const pushCommandSnapshot = useDaemonWorkspaceStore((s) => s.pushCommandSnapshot);
  const setInspectorOpen = useFrameLayoutStore((s) => s.setInspectorOpen);
  const setNotesPaneOpen = useFrameLayoutStore((s) => s.setNotesPaneOpen);
  const openSurveilStudies = useSurveilStore((s) => s.openStudiesDialog);
  const [items, setItems] = useState<WorkspaceContextMenuNode[] | null>(null);
  const isRelationshipChart =
    activeDocument?.supplementaryFeatureKind === "synastry" || Boolean(activeDocument?.compoundKind);
  const showRadixMenuItem =
    Boolean(chart.comparisonChart) &&
    workspaceDocumentDepth(activeDocument, documents) >= 2 &&
    !isRelationshipChart;
  const showRadixChecked = Boolean(chart.document?.showRadixComparison ?? showRadix);

  const refresh = useCallback(
    (signal?: AbortSignal) => {
      return fetchWorkspaceContextMenu(
        { docId: activeDocumentId, region: hoveredRegion },
        signal,
      ).then((payload) => {
        setItems(payload.items);
        return payload;
      });
    },
    [activeDocumentId, hoveredRegion],
  );

  const setShowRadixComparison = useCallback(
    async (checked: boolean) => {
      setShowRadix(checked);
      if (!activeDocumentId) return;
      try {
        const result = await executeWorkspaceContextMenuAction(
          "workspace.set_show_radix_comparison",
          { documentId: activeDocumentId, showRadix: checked },
        );
        const returnedShowRadix =
          typeof result.showRadix === "boolean" ? result.showRadix : checked;
        if (returnedShowRadix !== checked) {
          setShowRadix(returnedShowRadix);
        }
        const documentId =
          typeof result.documentId === "string" && result.documentId
            ? result.documentId
            : activeDocumentId;
        const returnedSnapshot = isPlainRecord(result.snapshot)
          ? (result.snapshot as unknown as ChartRenderSnapshot)
          : null;
        if (returnedSnapshot) {
          pushCommandSnapshot(documentId, returnedSnapshot);
        }
      } catch (err) {
        setShowRadix(!checked);
        console.error("[show-radix-comparison]", err);
      }
    },
    [activeDocumentId, pushCommandSnapshot, setShowRadix],
  );

  const runAction = useCallback(
    async (actionId?: string, payload?: Record<string, unknown>) => {
      if (!actionId) return;
      if (actionId === "surveil.open_studies") {
        // The daemon owns the study store; this item only opens the management
        // dialog (which then drives the CRUD routes). No chart refresh here.
        openSurveilStudies();
        return;
      }
      if (
        actionId === "workspace.show_transit_search_pane" ||
        actionId === "workspace.open_transit_search"
      ) {
        const documentId =
          typeof payload?.documentId === "string" && payload.documentId
            ? payload.documentId
            : activeDocumentId;
        if (!documentId) return;
        const customPoints = Array.isArray(payload?.customPoints)
          ? payload.customPoints.filter(isPlainRecord).map((point) => ({ ...point }))
          : [];
        openTransitSearchPane({
          documentId,
          significatorId:
            typeof payload?.significatorId === "string"
              ? payload.significatorId
              : null,
          chartRole:
            payload?.chartRole === "outer" || payload?.chartRole === "primary"
              ? payload.chartRole
              : null,
          customPoints,
          label: typeof payload?.label === "string" ? payload.label : undefined,
          glyph: typeof payload?.glyph === "string" ? payload.glyph : undefined,
        });
        setInspectorOpen(false);
        setNotesPaneOpen(false);
        return;
      }
      try {
        if (
          actionId === "workspace.show_primary_directions_to_point" ||
          actionId === "workspace.open_primary_directions_to_point"
        ) {
          const documentId =
            typeof payload?.documentId === "string" && payload.documentId
              ? payload.documentId
              : activeDocumentId;
          if (!documentId || !activeDocument) return;
          const customSignificator = directionCustomSignificatorFromPayload(
            payload?.customSignificator,
          );
          openDirectionsPane({
            documentId,
            cursorDocumentId: documentId,
            sourceName:
              activeDocument.sourceName ||
              activeDocument.title.replace(/\s*\*$/, ""),
            source: activeDocument.fpath,
            focusDatetime:
              activeDocument.symbolicTime?.signifiedDatetime ??
              activeDocument.displayDatetime ??
              undefined,
            initialTab: "primary",
            customSignificator,
          });
          setInspectorOpen(false);
          setNotesPaneOpen(false);
          return;
        }
        if (actionId === "workspace.toggle_synastry_composite") {
          const documentId =
            typeof payload?.documentId === "string" && payload.documentId
              ? payload.documentId
              : activeDocumentId;
          if (!documentId) return;
          const variant =
            payload?.variant === "midpoint" ||
            payload?.variant === "davison" ||
            payload?.variant === "synastry"
              ? payload.variant
              : null;
          const res = await workspaceSynastryComposite(documentId, variant);
          if (res.snapshot) pushSteppedSnapshot(documentId, res.snapshot);
          await refresh();
          return;
        }
        const documentId =
          typeof payload?.documentId === "string" && payload.documentId
            ? payload.documentId
            : activeDocumentId;
        if (documentId) {
          const result = await executeWorkspaceContextMenuAction(actionId, payload);
          const resultDocumentId =
            typeof result.documentId === "string" && result.documentId
              ? result.documentId
              : documentId;
          const returnedSnapshot = isPlainRecord(result.snapshot)
            ? (result.snapshot as unknown as ChartRenderSnapshot)
            : null;
          if (returnedSnapshot) {
            pushCommandSnapshot(resultDocumentId, returnedSnapshot);
          } else {
            const snapshot = await fetchDocumentSnapshot(resultDocumentId);
            pushSteppedSnapshot(resultDocumentId, snapshot);
          }
        } else {
          await executeWorkspaceContextMenuAction(actionId, payload);
        }
        await refresh();
      } catch (err) {
        console.error("[chart-context-action]", err);
      }
    },
    [
      activeDocumentId,
      activeDocument,
      openDirectionsPane,
      openTransitSearchPane,
      openSurveilStudies,
      pushCommandSnapshot,
      pushSteppedSnapshot,
      refresh,
      setInspectorOpen,
      setNotesPaneOpen,
    ],
  );

  return (
    <ContextMenu
      onOpenChange={(open) => {
        if (!open) return;
        const controller = new AbortController();
        void refresh(controller.signal).catch((err) => {
          if ((err as { name?: string }).name === "AbortError") return;
          console.error("[chart-context-menu]", err);
          setItems([]);
        });
      }}
    >
      <ContextMenuTrigger render={children} />
      <ContextMenuContent
        align="start"
        className="min-w-[var(--aries-menu-context-min-width)]"
      >
        {showRadixMenuItem ? (
          <>
            <ContextMenuCheckboxItem
              checked={showRadixChecked}
              closeOnClick={false}
              onCheckedChange={(checked) => {
                void setShowRadixComparison(Boolean(checked));
              }}
            >
              {t("chartmenu.showRadix")}
            </ContextMenuCheckboxItem>
            <ContextMenuSeparator />
          </>
        ) : null}
        {items === null ? (
          <ContextMenuItem disabled>{t("chartmenu.loading")}</ContextMenuItem>
        ) : (
          <MenuNodes items={items} onAction={runAction} />
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function workspaceDocumentDepth(
  document: WorkspaceDocument | null,
  documents: WorkspaceDocument[],
): number {
  if (!document) return -1;
  const byId = new Map(documents.map((doc) => [doc.id, doc]));
  const seen = new Set([document.id]);
  let depth = 0;
  let parentId = document.parentDocumentId;
  while (parentId) {
    if (seen.has(parentId)) break;
    seen.add(parentId);
    const parent = byId.get(parentId);
    if (!parent) break;
    depth += 1;
    parentId = parent.parentDocumentId;
  }
  return depth;
}

function directionCustomSignificatorFromPayload(
  value: unknown,
): DirectionCustomSignificator | null {
  if (!isPlainRecord(value)) return null;
  const longitude = Number(value.longitude);
  if (!Number.isFinite(longitude)) return null;
  const latitude = Number(value.latitude ?? 0);
  const out: DirectionCustomSignificator = {
    id: typeof value.id === "string" && value.id ? value.id : "custom:context",
    label: typeof value.label === "string" && value.label ? value.label : "Point",
    longitude,
    latitude: Number.isFinite(latitude) ? latitude : 0,
    only: value.only !== false,
  };
  if (typeof value.display_glyph === "string" && value.display_glyph) {
    out.display_glyph = value.display_glyph;
  }
  if (typeof value.display_marker === "string" && value.display_marker) {
    out.display_marker = value.display_marker;
  }
  if (Array.isArray(value.display_segments)) {
    out.display_segments = value.display_segments.filter(isPlainRecord);
  }
  const displayPlanetId = Number(value.display_planet_id);
  if (Number.isFinite(displayPlanetId)) {
    out.display_planet_id = displayPlanetId;
  }
  return out;
}

function MenuNodes({
  items,
  onAction,
}: {
  items: WorkspaceContextMenuNode[];
  onAction: (actionId?: string, payload?: Record<string, unknown>) => void;
}) {
  return (
    <>
      {items.map((item, index) => (
        <MenuNode
          key={`${item.type}-${"label" in item ? item.label : index}-${index}`}
          item={item}
          onAction={onAction}
        />
      ))}
    </>
  );
}

function MenuNode({
  item,
  onAction,
}: {
  item: WorkspaceContextMenuNode;
  onAction: (actionId?: string, payload?: Record<string, unknown>) => void;
}) {
  const tf = useTFallback();
  // Prefer the daemon-emitted stable labelKey (rendered from the shared catalog);
  // fall back to the daemon's English label (dynamic labels have no key).
  const label = (node: { label: string; labelKey?: string }) =>
    node.labelKey ? tf(node.labelKey, node.label) : node.label;

  if (item.type === "separator") {
    return <ContextMenuSeparator />;
  }

  if (item.type === "submenu") {
    return (
      <ContextMenuSub>
        <ContextMenuSubTrigger disabled={item.disabled}>{label(item)}</ContextMenuSubTrigger>
        <ContextMenuSubContent className="min-w-[var(--aries-menu-context-submenu-min-width)]">
          <MenuNodes items={item.children} onAction={onAction} />
        </ContextMenuSubContent>
      </ContextMenuSub>
    );
  }

  if (item.type === "radioGroup") {
    const radios = item.children.filter(
      (child): child is Extract<WorkspaceContextMenuNode, { type: "radio" }> =>
        child.type === "radio",
    );
    const byValue = new Map(radios.map((radio) => [radio.value, radio]));
    return (
      <ContextMenuRadioGroup
        value={item.value}
        onValueChange={(value) => {
          const selected = byValue.get(value);
          // A greyed radio must not act. base-ui blocks the item's own click,
          // but the group's change handler still fires for it, which let a
          // disabled choice be stored and then reported back as selected.
          if (selected && !selected.disabled) onAction(selected.actionId, selected.payload);
        }}
      >
        {radios.map((radio) => (
          <ContextMenuRadioItem
            key={`${radio.value}-${radio.label}`}
            value={radio.value}
            disabled={radio.disabled}
          >
            {label(radio)}
          </ContextMenuRadioItem>
        ))}
      </ContextMenuRadioGroup>
    );
  }

  if (item.type === "checkbox") {
    return (
      <ContextMenuCheckboxItem
        checked={item.checked}
        disabled={item.disabled}
        inset={item.inset}
        style={item.inset ? {
          paddingInlineStart: "calc(var(--aries-menu-item-padding-x) + 14px)",
        } : undefined}
        closeOnClick={false}
        onCheckedChange={() => onAction(item.actionId, item.payload)}
      >
        {label(item)}
      </ContextMenuCheckboxItem>
    );
  }

  if (item.type === "item") {
    return (
      <ContextMenuItem
        disabled={item.disabled}
        onClick={() => onAction(item.actionId, item.payload)}
      >
        {label(item)}
      </ContextMenuItem>
    );
  }

  return null;
}
