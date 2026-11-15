// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";



import type React from "react";
import { setSideBySideView } from "./side-by-side-charts";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";

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
  type WorkspaceContextMenuTrailingToggle,
  type WorkspaceOpenResult,
} from "@/lib/daemon/client";
import type { ChartRenderSnapshot } from "@/lib/chart/types";
import { createContextMenuRefresh } from "@/lib/context-menu-refresh";
import { runImmediateWorkspaceCommand, useDaemonWorkspaceView } from "@/stores/daemon-workspace-adapter";
import { useDaemonWorkspaceStore } from "@/stores/daemon-workspace-store";
import { runWorkspaceDocumentSnapshotCommand } from "@/stores/workspace-command-snapshot-gate";
import { useWorkspaceStore, type HoverRegion, type WorkspaceDocument } from "@/stores/workspace-store";
import { useFrameLayoutStore } from "@/stores/frame-layout-store";
import { useSurveilStore } from "@/stores/surveil-store";
import { useT, useTFallback } from "@/lib/i18n/i18n";
import { DashboardAppearanceMenu } from "./dashboard-appearance-menu";

type ChartContextMenuProps = {
  chart: ChartRenderSnapshot;
  children: React.ReactElement;
  dashboardAtPoint?: (clientX: number, clientY: number) => boolean;
  regionAtPoint?: (clientX: number, clientY: number) => HoverRegion | null;
};

export function ChartContextMenu({ chart, children, dashboardAtPoint, regionAtPoint }: ChartContextMenuProps) {
  const t = useT();
  const { activeDocument: focusedDocument, documents } = useDaemonWorkspaceView();
  const activeDocumentId = chart.document?.documentId ?? focusedDocument?.id ?? null;
  const activeDocument = documents.find(doc => doc.id === activeDocumentId) ?? null;
  const globalRegion = useWorkspaceStore((s) => s.hoveredRegion);
  const hoveredRegion = globalRegion?.viewDocumentId && globalRegion.viewDocumentId !== activeDocumentId
    ? null : globalRegion;
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
  const [menuOpen, setMenuOpen] = useState(false);
  const [dashboardMenu, setDashboardMenu] = useState(false);
  const [clickedRegion, setClickedRegion] = useState<HoverRegion | null>(null);
  const menuRegion = menuOpen ? clickedRegion : hoveredRegion;
  const optionsSeq = useDaemonWorkspaceStore((s) => s.lastOptionsChange?.seq ?? 0);
  const isRelationshipChart =
    activeDocument?.supplementaryFeatureKind === "synastry" || Boolean(activeDocument?.compoundKind);
  const showRadixMenuItem =
    Boolean(chart.comparisonChart) &&
    workspaceDocumentDepth(activeDocument, documents) >= 2 &&
    !isRelationshipChart;
  const showRadixChecked = Boolean(chart.document?.showRadixComparison ?? showRadix);

  const menuRefresh = useMemo(
    () => createContextMenuRefresh(
      (signal) => fetchWorkspaceContextMenu(
        { docId: activeDocumentId, region: menuRegion }, signal,
      ),
      (payload) => setItems(payload.items),
    ),
    [activeDocumentId, menuRegion, setItems],
  );
  const refresh = menuRefresh.refresh;
  useEffect(() => {
    menuRefresh.activate();
    return () => menuRefresh.dispose();
  }, [menuRefresh]);
  useEffect(() => {
    if (!menuOpen || dashboardMenu) return;
    const controller = new AbortController();
    void refresh(controller.signal).catch((err) => {
      if ((err as { name?: string }).name === "AbortError") return;
      console.error("[chart-context-menu]", err);
      setItems((current) => current ?? []);
    });
    return () => controller.abort();
  }, [menuOpen, dashboardMenu, optionsSeq, refresh]);

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
      if (actionId === "workspace.set_side_by_side") {
        try {
          await setSideBySideView(payload ?? {});
          await refresh();
        } catch {
          window.alert(t("chartview.failed"));
        }
        return;
      }
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
        if (actionId.startsWith("options.")) {
          menuRefresh.cancel();
          await executeWorkspaceContextMenuAction(actionId, payload);
          // options.changed owns chart invalidation. A second snapshot GET
          // here can race that refresh and restore an older asteroid ring.
          await refresh();
          return;
        }
        if (actionId === "workspace.open_supplementary" || actionId === "workspace.open_ascensional_view") {
          // Hold activation events until the returned child snapshot is cached.
          // Otherwise a reused child's old split layout can remount the canvas
          // before the authoritative open response replaces it.
          await runImmediateWorkspaceCommand(
            executeWorkspaceContextMenuAction(actionId, payload) as Promise<WorkspaceOpenResult>,
          );
          return;
        }
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
          const isHarmonicProjectionAction =
            actionId === "workspace.set_harmonic_projection_mode" ||
            actionId === "workspace.set_harmonic_number" ||
            actionId === "workspace.set_chart_presentation";
          const commandResult = isHarmonicProjectionAction
            ? await runWorkspaceDocumentSnapshotCommand(
                documentId,
                () => executeWorkspaceContextMenuAction(actionId, payload),
              )
            : {
                result: await executeWorkspaceContextMenuAction(actionId, payload),
                isLatest: true,
              };
          if (!commandResult.isLatest) return;
          const result = commandResult.result;
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
        if ((err as { name?: string }).name === "AbortError") return;
        console.error("[chart-context-action]", err);
      }
    },
    [
      t,
      activeDocumentId,
      activeDocument,
      openDirectionsPane,
      openTransitSearchPane,
      openSurveilStudies,
      pushCommandSnapshot,
      pushSteppedSnapshot,
      menuRefresh,
      refresh,
      setInspectorOpen,
      setNotesPaneOpen,
    ],
  );

  return (
    <ContextMenu onOpenChange={setMenuOpen}>
      <ContextMenuTrigger render={children} onContextMenuCapture={(event) => {
        setDashboardMenu(Boolean(chart.dashboard?.enabled && dashboardAtPoint?.(event.clientX, event.clientY)));
        setClickedRegion(regionAtPoint?.(event.clientX, event.clientY) ?? null);
      }} />
      <ContextMenuContent
        align="start"
        className="min-w-[var(--aries-menu-context-min-width)]"
      >
        {dashboardMenu && chart.dashboard ? (
          <DashboardAppearanceMenu dashboard={chart.dashboard} />
        ) : (
          <>
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
          </>
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
        {radios.map((radio) => {
          const choice = (
            <ContextMenuRadioItem
              value={radio.value}
              disabled={radio.disabled}
            >
              {label(radio)}
            </ContextMenuRadioItem>
          );
          return radio.trailingToggle ? (
            <div key={`${radio.value}-${radio.label}`} className="relative" data-asteroid-menu-row data-context-menu-toggle-row>
              {choice}
              <InlineMenuToggle toggle={radio.trailingToggle} onAction={onAction} />
            </div>
          ) : <Fragment key={`${radio.value}-${radio.label}`}>{choice}</Fragment>;
        })}
      </ContextMenuRadioGroup>
    );
  }

  if (item.type === "checkbox") {
    const choice = (
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
    return item.trailingToggle ? (
      <div className="relative" data-context-menu-toggle-row>
        {choice}
        <InlineMenuToggle toggle={item.trailingToggle} onAction={onAction} />
      </div>
    ) : choice;
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

function InlineMenuToggle({
  toggle,
  onAction,
}: {
  toggle: WorkspaceContextMenuTrailingToggle;
  onAction: (actionId?: string, payload?: Record<string, unknown>) => void;
}) {
  const t = useT();
  return (
    <button
      type="button"
      data-context-menu-inline-toggle
      aria-pressed={toggle.checked}
      aria-label={t(toggle.labelKey)}
      className={`absolute top-1/2 -translate-y-1/2 rounded-[var(--aries-radius-menu-item)] px-1.5 py-0.5 text-[length:var(--aries-font-size-small)] leading-none hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground focus-visible:outline-none ${toggle.checked ? "font-semibold text-foreground" : "text-muted-foreground"}`}
      style={{ right: "calc(var(--aries-menu-indicator-inset) + var(--aries-menu-icon-size) + 20px)" }}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        onAction(toggle.actionId, toggle.payload);
      }}
    >
      {t(toggle.compactLabelKey)}
    </button>
  );
}
