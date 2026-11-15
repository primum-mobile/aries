// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { handleChartEventsMenuAction } from "./chart-events-actions";
import { ChartEventsSubmenu } from "./chart-events-submenu";


import * as React from "react";

import { ChevronDown, ChevronRight, X } from "lucide-react";

import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { cn } from "@/lib/utils";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";

import {
  buildDocumentTree,
  flattenDocumentTree,
  localizedWorkspaceDocumentTitle,
  useWorkspaceStore,
  type WorkspaceDocument,
} from "@/stores/workspace-store";
import { applyImmediateWorkspaceCommandResult } from "@/stores/daemon-workspace-adapter";
import { runWorkspaceDocumentSnapshotCommand } from "@/stores/workspace-command-snapshot-gate";
import { findRadixSiblingLaunchParent } from "@/components/workshell/chart-launch-parent";
import { useFrameLayoutStore, type LeftSidebarSize } from "@/stores/frame-layout-store";
import { useThemeStore } from "@/stores/theme-store";
import { useMobileLayout } from "@/hooks/use-mobile-layout";
import { useT, useTFallback, type TFunc } from "@/lib/i18n/i18n";
import {
  chordAvailable,
  formatChordOffApple,
  parseAcceleratorChord,
  useAppleShortcuts,
  useShortcutModifierLabels,
  type ShortcutModifierLabels,
} from "@/lib/shortcut-display";
import type {
  SidebarAction,
  SidebarGroup as ManifestGroup,
  WorkspaceManifest,
  WorkspaceContextMenuNode,
} from "@/lib/daemon/client";
import {
  executeWorkspaceContextMenuAction,
  fetchWorkspaceDocumentContextMenu,
  setWorkspaceSidebarSectionCollapsed,
} from "@/lib/daemon/client";
import {
  setSidebarLaunchersHidden,
  useSidebarVisibilityStore,
} from "@/stores/sidebar-visibility-store";
import {
  SidebarEditBar,
  SidebarEditContent,
  SidebarHiddenNotice,
} from "./app-sidebar-edit";

const LazySortableDocumentsGroup = React.lazy(() =>
  import("./app-sidebar-sortable").then((module) => ({
    default: module.SortableDocumentsGroup,
  })),
);

const LazySortableActionsContent = React.lazy(() =>
  import("./app-sidebar-sortable").then((module) => ({
    default: module.SortableActionsContent,
  })),
);

type Props = {
  manifest: WorkspaceManifest | null;
  documents: WorkspaceDocument[];
  activeDocumentId: string | null;
  onSelect: (id: string) => void;
  onCloseDocument: (id: string) => void;
  onReorder: (docId: string, beforeId: string | null) => void;
  onSolarAverageWindowSelect: (maxBirthday: number, returnKind: ReturnAverageKind) => void;
  harmonicChartMode: "harmonic" | "varga";
};

export type ReturnAverageKind = "solar" | "lunar";
export type FlatDocumentNode = ReturnType<typeof flattenDocumentTree>[number];

function isPrimaryMouseButton(event: React.MouseEvent): boolean {
  return event.button === 0;
}

export type DropIndicatorPosition = "before" | "after";

const LEFT_SIDEBAR_BASE_PX: Record<string, number> = {
  "--aries-font-size-nav": 14,
  "--aries-font-size-nav-section": 12,
  "--aries-sidebar-row-height": 30,
  "--aries-sidebar-row-padding-x": 12,
  "--aries-sidebar-row-padding-y": 4,
  "--aries-sidebar-row-line-box": 16,
  "--aries-sidebar-section-line-box": 14,
  "--aries-sidebar-section-header-height": 20,
  "--aries-sidebar-group-padding-start": 7,
  "--aries-sidebar-group-padding-end": 5,
  "--aries-sidebar-tree-indent": 12,
  "--aries-sidebar-trailing-inset": 8,
  "--aries-sidebar-unsaved-indicator-size": 6,
  "--aries-sidebar-close-inset": 6,
  "--aries-sidebar-close-action-size": 20,
  "--aries-sidebar-action-icon-size": 12,
  "--aries-sidebar-drop-indicator-size": 2,
  "--aries-sidebar-drop-indicator-overhang": 1,
  "--aries-nav-side-margin": 12,
  "--aries-control-gap-compact": 4,
  "--aries-control-height": 32,
};

function scaledLeftSidebarStyle(
  size: LeftSidebarSize,
  appTokens: Record<string, string> | undefined,
  mobile: boolean,
): React.CSSProperties | undefined {
  if (size === "normal") return undefined;
  const scale = size === "larger" ? 15 / 13 : 17 / 13;
  const values: Record<string, string> = {};
  for (const [token, fallback] of Object.entries(LEFT_SIDEBAR_BASE_PX)) {
    const authored = appTokens?.[token];
    const base = authored && /^\d+(?:\.\d+)?px$/.test(authored)
      ? Number.parseFloat(authored)
      : fallback;
    values[token] = `${base * scale}px`;
  }
  if (mobile) {
    values["--aries-sidebar-row-height"] = `${44 * scale}px`;
    values["--aries-sidebar-close-action-size"] = `${44 * scale}px`;
    values["--aries-sidebar-close-inset"] = "0px";
  }
  values["--morinus-row-min-height"] = values["--aries-sidebar-row-height"];
  values["--morinus-row-pad-x"] = values["--aries-sidebar-row-padding-x"];
  values["--morinus-row-pad-y"] = values["--aries-sidebar-row-padding-y"];
  values["--morinus-nav-side-margin"] = values["--aries-nav-side-margin"];
  return values as React.CSSProperties;
}

function manifestGroupRenderKey(group: ManifestGroup): string {
  return [
    group.id,
    group.collapsed ? "1" : "0",
    group.actions
      .map((action) =>
        [
          action.id,
          action.enabled ? "1" : "0",
          action.hidden ? "1" : "0",
          action.shortcut ?? "",
        ].join(":"),
      )
      .join("|"),
  ].join(":");
}

function useHydrated(): boolean {
  const [hydrated, setHydrated] = React.useState(false);
  React.useEffect(() => {
    const frame = window.requestAnimationFrame(() => setHydrated(true));
    return () => window.cancelAnimationFrame(frame);
  }, []);
  return hydrated;
}

function AppSidebarComponent({
  manifest,
  documents,
  activeDocumentId,
  onSelect,
  onCloseDocument,
  onReorder,
  onSolarAverageWindowSelect,
  harmonicChartMode,
}: Props) {
  const dragReady = useHydrated();
  const openEclipsesPane = useWorkspaceStore((s) => s.openEclipsesPane);
  const setInspectorOpen = useFrameLayoutStore((s) => s.setInspectorOpen);
  const setNotesPaneOpen = useFrameLayoutStore((s) => s.setNotesPaneOpen);
  // Phone: every launcher choice closes the launcher sheet, so the chart,
  // table or pane it opened is what the user sees next.
  const mobile = useMobileLayout();
  const { setOpenMobile } = useSidebar();
  const closeLauncher = React.useCallback(() => {
    if (mobile) setOpenMobile(false);
  }, [mobile, setOpenMobile]);
  const handleSolarAverageWindowSelect = React.useCallback(
    (maxBirthday: number, returnKind: ReturnAverageKind) => {
      closeLauncher();
      onSolarAverageWindowSelect(maxBirthday, returnKind);
    },
    [closeLauncher, onSolarAverageWindowSelect],
  );
  const handleSelect = React.useCallback(
    (id: string) => {
      closeLauncher();
      if (id === "table:eclipses") {
        const launchParent = findRadixSiblingLaunchParent(documents, activeDocumentId);
        if (launchParent) {
          openEclipsesPane({
            documentId: launchParent.id,
            sourceName: launchParent.sourceName,
          });
          setInspectorOpen(false);
          setNotesPaneOpen(false);
          return;
        }
      }
      onSelect(id);
    },
    [activeDocumentId, closeLauncher, documents, onSelect, openEclipsesPane, setInspectorOpen, setNotesPaneOpen],
  );

  const editing = useSidebarVisibilityStore((s) => s.editing);
  const leftSidebarSize = useFrameLayoutStore((s) => s.leftSidebarSize);
  const appTokens = useThemeStore((s) => s.theme?.appTokens);

  return (
    <Sidebar collapsible="offcanvas" className="border-r-0">
      <ContextMenu>
        <ContextMenuTrigger
          className="flex size-full min-h-0 flex-col"
          style={scaledLeftSidebarStyle(leftSidebarSize, appTokens, mobile)}
        >
          {/* No sidebar header — the global UnifiedTitleBar spans the top across the
              sidebar + content, and content is inset below it (globals.css), so the
              first nav row sits directly under the title bar. */}
          {editing ? <SidebarEditBar /> : null}
          <div className="shrink-0 px-[var(--morinus-nav-side-margin)]">
            <TopActionsGroup
              actions={manifest?.topActions ?? []}
              activeDocumentId={activeDocumentId}
              onSelect={handleSelect}
            />
          </div>
          <div
            aria-hidden="true"
            className="h-px shrink-0 bg-[color:var(--aries-sidebar-section-rule)]"
          />
          <SidebarContent className="gap-0 px-[var(--morinus-nav-side-margin)]">
            <DocumentsGroup
              documents={documents}
              activeDocumentId={activeDocumentId}
              dragReady={dragReady}
              onSelect={handleSelect}
              onClose={onCloseDocument}
              onReorder={onReorder}
            />
            {editing ? (
              <SidebarEditContent groups={manifest?.groups ?? []} />
            ) : (
              (manifest?.groups ?? []).map((group) => (
                <ActionsGroup
                  key={manifestGroupRenderKey(group)}
                  groupId={group.id}
                  label={group.label}
                  collapsed={group.collapsed}
                  // Hidden launchers are gone in normal use; a section with
                  // nothing left loses its header too (ActionsGroup returns null).
                  actions={group.actions.filter((action) => !action.hidden)}
                  activeDocumentId={activeDocumentId}
                  dragReady={dragReady}
                  onSelect={handleSelect}
                  onSolarAverageWindowSelect={handleSolarAverageWindowSelect}
                  harmonicChartMode={harmonicChartMode}
                />
              ))
            )}
          </SidebarContent>
          {editing ? null : <SidebarHiddenNotice />}
        </ContextMenuTrigger>
        <ContextMenuContent align="start" className="min-w-44">
          <LeftSidebarSizeChoices />
        </ContextMenuContent>
      </ContextMenu>
    </Sidebar>
  );
}

function LeftSidebarSizeChoices({ submenu = false }: { submenu?: boolean }) {
  const t = useT();
  const size = useFrameLayoutStore((s) => s.leftSidebarSize);
  const setSize = useFrameLayoutStore((s) => s.setLeftSidebarSize);
  const choices = (
    <ContextMenuRadioGroup value={size} onValueChange={(value) => setSize(value as LeftSidebarSize)}>
      <ContextMenuRadioItem value="normal">{t("inspector.textSize.normal")}</ContextMenuRadioItem>
      <ContextMenuRadioItem value="larger">{t("inspector.textSize.larger")}</ContextMenuRadioItem>
      <ContextMenuRadioItem value="extra-large">{t("inspector.textSize.extraLarge")}</ContextMenuRadioItem>
    </ContextMenuRadioGroup>
  );
  return submenu ? (
    <>
      <ContextMenuSeparator />
      <ContextMenuSub>
        <ContextMenuSubTrigger>{t("sidebar.textSize")}</ContextMenuSubTrigger>
        <ContextMenuSubContent className="min-w-44">{choices}</ContextMenuSubContent>
      </ContextMenuSub>
    </>
  ) : choices;
}

// Time stepping changes the active chart snapshot, not the workspace tree or
// launcher manifest. Keep this retained chrome out of the chart-frame render
// path unless one of its own inputs actually changes.
export const AppSidebar = React.memo(AppSidebarComponent);

function TopActionsGroup({
  actions,
  activeDocumentId,
  onSelect,
}: {
  actions: SidebarAction[];
  activeDocumentId: string | null;
  onSelect: (id: string) => void;
}) {
  const tLabel = useTFallback();
  if (actions.length === 0) return null;
  return (
    <SidebarGroup className="px-0 pb-[var(--aries-control-gap-compact)] pt-0">
      <SidebarGroupContent>
        <SidebarMenu className="gap-0">
          {actions.map((action) => (
            <SidebarMenuItem key={action.id}>
              <NavRow
                actionId={action.id}
                label={tLabel(`sidebar.action.${action.id}`, action.label)}
                shortcut={action.shortcut}
                isActive={action.id === activeDocumentId}
                disabled={!action.enabled}
                onClick={action.enabled ? () => onSelect(action.id) : undefined}
              />
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

function DocumentsGroup({
  documents,
  activeDocumentId,
  dragReady,
  onSelect,
  onClose,
  onReorder,
}: {
  documents: WorkspaceDocument[];
  activeDocumentId: string | null;
  dragReady: boolean;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onReorder: (docId: string, beforeId: string | null) => void;
}) {
  const tree = React.useMemo(() => buildDocumentTree(documents), [documents]);
  const flat = React.useMemo(() => flattenDocumentTree(tree), [tree]);
  if (tree.length === 0) return null;
  if (!dragReady) {
    return (
      <StaticDocumentsGroup
        flat={flat}
        activeDocumentId={activeDocumentId}
        onSelect={onSelect}
        onClose={onClose}
      />
    );
  }
  return (
    <React.Suspense
      fallback={
        <StaticDocumentsGroup
          flat={flat}
          activeDocumentId={activeDocumentId}
          onSelect={onSelect}
          onClose={onClose}
        />
      }
    >
      <LazySortableDocumentsGroup
        documents={documents}
        flat={flat}
        activeDocumentId={activeDocumentId}
        onSelect={onSelect}
        onClose={onClose}
        onReorder={onReorder}
      />
    </React.Suspense>
  );
}

function StaticDocumentsGroup({
  flat,
  activeDocumentId,
  onSelect,
  onClose,
}: {
  flat: FlatDocumentNode[];
  activeDocumentId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
}) {
  const t = useT();
  return (
    <SidebarGroup className="px-0 pb-0 pt-[var(--aries-control-padding-y)]">
      <SidebarGroupContent>
        <SidebarMenu className="gap-0">
          {flat.map(({ node, depth }) => {
            const dirty = node.doc.dirty === true;
            return (
              <SidebarMenuItem key={node.doc.id}>
                <DocumentRowContextMenu docId={node.doc.id}>
                  <NavRow
                    label={documentRowLabel(node.doc, dirty, t)}
                    isActive={node.doc.id === activeDocumentId}
                    documentRow
                    depth={depth}
                    dirty={dirty}
                    onClick={() => onSelect(node.doc.id)}
                    onClose={() => onClose(node.doc.id)}
                  />
                </DocumentRowContextMenu>
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

export type DragPreviewKind = "synastry" | "transit" | "attach";

export function documentRowLabel(
  doc: WorkspaceDocument,
  dirty?: boolean,
  t?: TFunc,
): string {
  // The adapter strips the daemon's raw "*" from doc.title, so render the wx
  // dirty star from the canonical dirty flag before the runtime suffix.
  const localizedTitle = localizedWorkspaceDocumentTitle(doc, t);
  const titleWithDirty = dirty ? `${localizedTitle} *` : localizedTitle;
  // Horary/here-now rows use the wx parenthesized format
  // (morin._horary_workspace_tab_title: "Here and Now (Fri 2026-06-12 16:00:09)");
  // everything else keeps the bullet runtime suffix.
  if (!doc.tabSuffix) return titleWithDirty;
  return doc.isHorary
    ? `${titleWithDirty} (${doc.tabSuffix})`
    : `${titleWithDirty} • ${doc.tabSuffix}`;
}

export function DocumentRowContextMenu({
  docId,
  children,
}: {
  docId: string;
  children: React.ReactElement;
}) {
  const [items, setItems] = React.useState<WorkspaceContextMenuNode[] | null>(null);
  const tf = useTFallback();

  const refresh = React.useCallback(
    (signal?: AbortSignal) => {
      return fetchWorkspaceDocumentContextMenu(docId, signal).then((payload) => {
        setItems(payload.items);
        return payload;
      });
    },
    [docId],
  );

  const runAction = React.useCallback(
    async (actionId?: string, payload?: Record<string, unknown>) => {
      if (!actionId) return;
      if (await handleChartEventsMenuAction(actionId, payload)) return;
      try {
        const isHarmonicProjectionAction =
          actionId === "workspace.set_harmonic_projection_mode" ||
          actionId === "workspace.set_harmonic_number";
        const commandResult = isHarmonicProjectionAction
          ? await runWorkspaceDocumentSnapshotCommand(
              docId,
              () => executeWorkspaceContextMenuAction(actionId, payload),
            )
          : {
              result: await executeWorkspaceContextMenuAction(actionId, payload),
              isLatest: true,
            };
        if (!commandResult.isLatest) return;
        const result = commandResult.result;
        if (isImmediateWorkspaceActionResult(result)) {
          const immediateResult =
            result as Parameters<typeof applyImmediateWorkspaceCommandResult>[0];
          const openedDocumentId = openedDocumentIdForContextAction(actionId, immediateResult);
          const resultActiveDocumentId = activeDocumentIdFromContextActionResult(immediateResult);
          applyImmediateWorkspaceCommandResult(
            openedDocumentId
              ? { ...immediateResult, activeDocumentId: openedDocumentId }
              : immediateResult,
            openedDocumentId ?? docId,
          );
          if (openedDocumentId || (resultActiveDocumentId && resultActiveDocumentId !== docId)) {
            return;
          }
        }
        await refresh();
      } catch (err) {
        console.error("[document-context-action]", err);
      }
    },
    [docId, refresh],
  );

  return (
    <ContextMenu
      onOpenChange={(open) => {
        if (!open) return;
        const controller = new AbortController();
        void refresh(controller.signal).catch((err) => {
          if ((err as { name?: string }).name === "AbortError") return;
          console.error("[document-context-menu]", err);
          setItems([]);
        });
      }}
    >
      <ContextMenuTrigger className="block w-full">{children}</ContextMenuTrigger>
      <ContextMenuContent align="start" className="min-w-52">
        {items === null ? (
          <ContextMenuItem disabled>{tf("sidebar.contextMenuLoading", "Loading...")}</ContextMenuItem>
        ) : (
          <DocumentMenuNodes items={items} onAction={runAction} />
        )}
        <LeftSidebarSizeChoices submenu />
      </ContextMenuContent>
    </ContextMenu>
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isImmediateWorkspaceActionResult(
  value: Record<string, unknown>,
): boolean {
  if (isRecord(value.snapshot)) return true;
  if (!Array.isArray(value.documents)) return false;
  return typeof value.activeDocumentId === "string" && value.activeDocumentId.length > 0;
}

function openedDocumentIdForContextAction(
  actionId: string,
  result: { documentId?: string | null },
): string | null {
  if (!actionId.startsWith("workspace.open_")) return null;
  const documentId = result.documentId;
  return typeof documentId === "string" && documentId.length > 0 ? documentId : null;
}

function activeDocumentIdFromContextActionResult(
  result: { activeDocumentId?: string | null },
): string | null {
  const activeDocumentId = result.activeDocumentId;
  return typeof activeDocumentId === "string" && activeDocumentId.length > 0
    ? activeDocumentId
    : null;
}

function DocumentMenuNodes({
  items,
  onAction,
}: {
  items: WorkspaceContextMenuNode[];
  onAction: (actionId?: string, payload?: Record<string, unknown>) => void;
}) {
  return (
    <>
      {items.map((item, index) => (
        <DocumentMenuNode
          key={`${item.type}-${"label" in item ? item.label : index}-${index}`}
          item={item}
          onAction={onAction}
        />
      ))}
    </>
  );
}

function DocumentMenuNode({
  item,
  onAction,
}: {
  item: WorkspaceContextMenuNode;
  onAction: (actionId?: string, payload?: Record<string, unknown>) => void;
}) {
  const tf = useTFallback();
  const label = (node: { label: string; labelKey?: string }) =>
    node.labelKey ? tf(node.labelKey, node.label) : node.label;

  if (item.type === "separator") {
    return <ContextMenuSeparator />;
  }
  if (item.type === "submenu") {
    if (item.eventsDocumentId) {
      return <ChartEventsSubmenu documentId={item.eventsDocumentId} count={item.eventCount ?? 0} onAction={onAction} />;
    }
    return (
      <ContextMenuSub>
        <ContextMenuSubTrigger disabled={item.disabled}>{label(item)}</ContextMenuSubTrigger>
        <ContextMenuSubContent className="min-w-48">
          <DocumentMenuNodes items={item.children} onAction={onAction} />
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
          if (selected) onAction(selected.actionId, selected.payload);
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

function ActionsGroup({
  groupId,
  label,
  collapsed,
  actions,
  activeDocumentId,
  dragReady,
  onSelect,
  onSolarAverageWindowSelect,
  harmonicChartMode,
}: {
  groupId: string;
  label: string;
  collapsed: boolean;
  actions: ManifestGroup["actions"];
  activeDocumentId: string | null;
  dragReady: boolean;
  onSelect: (id: string) => void;
  onSolarAverageWindowSelect: (maxBirthday: number, returnKind: ReturnAverageKind) => void;
  harmonicChartMode: "harmonic" | "varga";
}) {
  const tLabel = useTFallback();
  const [isCollapsed, setIsCollapsed] = React.useState(collapsed);
  const [orderedActions, setOrderedActions] = React.useState<SidebarAction[]>(actions);
  const sortableActions = orderedActions.filter((action) => action.id !== "transit-search");
  const sortableIds = sortableActions.map((action) => action.id);

  const toggleCollapsed = React.useCallback(() => {
    const next = !isCollapsed;
    setIsCollapsed(next);
    void setWorkspaceSidebarSectionCollapsed(label, next).catch((err) => {
      console.error("[sidebar-section-collapse]", err);
      setIsCollapsed(!next);
    });
  }, [isCollapsed, label]);

  if (actions.length === 0) return null;
  return (
    <SidebarGroup className="px-0 pb-[var(--aries-sidebar-group-padding-end)] pt-[var(--aries-sidebar-group-padding-start)]">
      <SidebarGroupLabel className="h-[var(--aries-sidebar-section-header-height)] px-0">
        <button
          type="button"
          data-aries-sidebar-group-id={groupId}
          className="flex h-[var(--aries-sidebar-section-header-height)] w-full items-center gap-[var(--aries-control-gap-compact)] rounded-[var(--morinus-row-radius)] px-[var(--morinus-row-pad-x)] text-left text-[length:var(--aries-font-size-nav-section)] font-normal leading-none text-[color:var(--aries-text-dim)] transition-colors duration-75 hover:bg-[color:var(--aries-sidebar-row-soft)] hover:text-sidebar-foreground"
          aria-expanded={!isCollapsed}
          onClick={toggleCollapsed}
        >
          {isCollapsed ? (
            <ChevronRight className="size-[var(--aries-sidebar-action-icon-size)] shrink-0" />
          ) : (
            <ChevronDown className="size-[var(--aries-sidebar-action-icon-size)] shrink-0" />
          )}
          <span className="block h-[var(--aries-sidebar-section-line-box)] min-w-0 truncate leading-[var(--aries-sidebar-section-line-box)]">
            {tLabel(`sidebar.group.${groupId}`, label)}
          </span>
        </button>
      </SidebarGroupLabel>
      {!isCollapsed ? (
        <SidebarGroupContent>
          {dragReady ? (
            <React.Suspense
              fallback={
                <StaticActionsContent
                  sectionLabel={label}
                  orderedActions={orderedActions}
                  activeDocumentId={activeDocumentId}
                  onSelect={onSelect}
                  onSolarAverageWindowSelect={onSolarAverageWindowSelect}
                  harmonicChartMode={harmonicChartMode}
                />
              }
            >
              <LazySortableActionsContent
                groupId={groupId}
                label={label}
                orderedActions={orderedActions}
                setOrderedActions={setOrderedActions}
                sortableIds={sortableIds}
                activeDocumentId={activeDocumentId}
                onSelect={onSelect}
                onSolarAverageWindowSelect={onSolarAverageWindowSelect}
                harmonicChartMode={harmonicChartMode}
              />
            </React.Suspense>
          ) : (
            <StaticActionsContent
              sectionLabel={label}
              orderedActions={orderedActions}
              activeDocumentId={activeDocumentId}
              onSelect={onSelect}
              onSolarAverageWindowSelect={onSolarAverageWindowSelect}
              harmonicChartMode={harmonicChartMode}
            />
          )}
        </SidebarGroupContent>
      ) : null}
    </SidebarGroup>
  );
}

function StaticActionsContent({
  sectionLabel,
  orderedActions,
  activeDocumentId,
  onSelect,
  onSolarAverageWindowSelect,
  harmonicChartMode,
}: {
  sectionLabel: string;
  orderedActions: SidebarAction[];
  activeDocumentId: string | null;
  onSelect: (id: string) => void;
  onSolarAverageWindowSelect: (maxBirthday: number, returnKind: ReturnAverageKind) => void;
  harmonicChartMode: "harmonic" | "varga";
}) {
  const tLabel = useTFallback();
  return (
    <SidebarMenu className="gap-0">
      {orderedActions.map((action) => {
        const row = (
          <NavRow
            actionId={action.id}
            label={tLabel(`sidebar.action.${action.id}`, action.label)}
            shortcut={action.shortcut}
            isActive={action.id === activeDocumentId}
            disabled={!action.enabled}
            onClick={action.enabled ? () => onSelect(action.id) : undefined}
          />
        );
        return (
          <SidebarMenuItem key={action.id}>
            <LauncherRowMenu
              sectionLabel={sectionLabel}
              action={action}
              onSelect={onSelect}
              onSolarAverageWindowSelect={onSolarAverageWindowSelect}
              harmonicChartMode={harmonicChartMode}
            >
              {row}
            </LauncherRowMenu>
          </SidebarMenuItem>
        );
      })}
    </SidebarMenu>
  );
}

/** Right-click menu for one section launcher. Harmonic chart and Average
 * Returns keep their own options on top; every launcher ends with the
 * Hide · Edit Sidebar… group (design A2). */
export function LauncherRowMenu({
  sectionLabel,
  action,
  onSelect,
  onSolarAverageWindowSelect,
  harmonicChartMode,
  children,
}: {
  sectionLabel: string;
  action: SidebarAction;
  onSelect: (id: string) => void;
  onSolarAverageWindowSelect: (maxBirthday: number, returnKind: ReturnAverageKind) => void;
  harmonicChartMode: "harmonic" | "varga";
  children: React.ReactElement;
}) {
  const visibility = <LauncherVisibilityItems sectionLabel={sectionLabel} actionId={action.id} />;
  if (action.id === "solar-average" && action.enabled) {
    return (
      <SolarAverageLauncherContextMenu
        onSelectWindow={onSolarAverageWindowSelect}
        trailingItems={visibility}
      >
        {children}
      </SolarAverageLauncherContextMenu>
    );
  }
  if (action.id === "harmonic" && action.enabled) {
    return (
      <HarmonicLauncherContextMenu
        initialMode={harmonicChartMode}
        onSelectNumber={(mode, number) => onSelect(`harmonic:${mode}:${number}`)}
        trailingItems={visibility}
      >
        {children}
      </HarmonicLauncherContextMenu>
    );
  }
  return (
    <PlainLauncherContextMenu
      enabled={action.enabled}
      onOpen={() => onSelect(action.id)}
      trailingItems={visibility}
    >
      {children}
    </PlainLauncherContextMenu>
  );
}

function PlainLauncherContextMenu({
  enabled,
  onOpen,
  trailingItems,
  children,
}: {
  enabled: boolean;
  onOpen: () => void;
  trailingItems: React.ReactNode;
  children: React.ReactElement;
}) {
  const tf = useTFallback();
  return (
    <ContextMenu>
      <ContextMenuTrigger className="block w-full">{children}</ContextMenuTrigger>
      <ContextMenuContent align="start" className="min-w-40">
        <ContextMenuItem disabled={!enabled} onClick={onOpen}>
          {tf("sidebar.openLauncher", "Open")}
        </ContextMenuItem>
        {trailingItems}
        <LeftSidebarSizeChoices submenu />
      </ContextMenuContent>
    </ContextMenu>
  );
}

function LauncherVisibilityItems({
  sectionLabel,
  actionId,
}: {
  sectionLabel: string;
  actionId: string;
}) {
  const tf = useTFallback();
  const setEditing = useSidebarVisibilityStore((s) => s.setEditing);
  const setSidebarOpen = useFrameLayoutStore((s) => s.setSidebarOpen);
  return (
    <>
      <ContextMenuSeparator />
      <ContextMenuItem
        onClick={() => void setSidebarLaunchersHidden(sectionLabel, [actionId], true, { notice: true })}
      >
        {tf("sidebar.hideLauncher", "Hide")}
      </ContextMenuItem>
      <ContextMenuItem
        onClick={() => {
          setSidebarOpen(true);
          setEditing(true);
        }}
      >
        {tf("sidebar.editSidebar", "Edit Sidebar…")}
      </ContextMenuItem>
    </>
  );
}

export function SolarAverageLauncherContextMenu({
  children,
  onSelectWindow,
  trailingItems,
}: {
  children: React.ReactElement;
  onSelectWindow: (maxBirthday: number, returnKind: ReturnAverageKind) => void;
  trailingItems?: React.ReactNode;
}) {
  const tf = useTFallback();
  const chooseWindow = React.useCallback(
    (returnKind: ReturnAverageKind, value: string) => {
      const maxBirthday = Number.parseInt(value, 10);
      if (!Number.isFinite(maxBirthday) || maxBirthday < 0) return;
      onSelectWindow(maxBirthday, returnKind);
    },
    [onSelectWindow],
  );
  const chooseCustom = React.useCallback(
    (returnKind: ReturnAverageKind, label: string) => {
      const raw = globalThis.prompt?.(
        tf("sidebar.enterEndingAge", "Enter the ending age for {label}:").replace("{label}", label),
        "84",
      );
      if (raw == null) return;
      chooseWindow(returnKind, raw);
    },
    [chooseWindow, tf],
  );

  const renderWindowGroup = (returnKind: ReturnAverageKind, label: string) => (
    <ContextMenuSub key={returnKind}>
      <ContextMenuSubTrigger>{label}</ContextMenuSubTrigger>
      <ContextMenuSubContent className="min-w-44">
        {[28, 56, 84].map((age) => (
          <ContextMenuItem key={age} onClick={() => chooseWindow(returnKind, String(age))}>
            {tf("sidebar.openAverageWindow", "Open {label} 0-{age}")
              .replace("{label}", label)
              .replace("{age}", String(age))}
          </ContextMenuItem>
        ))}
        <ContextMenuSeparator />
        <ContextMenuItem onClick={() => chooseCustom(returnKind, label)}>
          {tf("sidebar.openCustom", "Open Custom...")}
        </ContextMenuItem>
      </ContextMenuSubContent>
    </ContextMenuSub>
  );

  return (
    <ContextMenu>
      <ContextMenuTrigger className="block w-full">{children}</ContextMenuTrigger>
      <ContextMenuContent align="start" className="min-w-44">
        {renderWindowGroup("solar", tf("sidebar.solarAverage", "Solar Average"))}
        {renderWindowGroup("lunar", tf("sidebar.lunarAverage", "Lunar Average"))}
        {trailingItems}
        <LeftSidebarSizeChoices submenu />
      </ContextMenuContent>
    </ContextMenu>
  );
}

export function HarmonicLauncherContextMenu({
  children,
  initialMode,
  onSelectNumber,
  trailingItems,
}: {
  children: React.ReactElement;
  initialMode: "harmonic" | "varga";
  onSelectNumber: (mode: "harmonic" | "varga", number: number) => void;
  trailingItems?: React.ReactNode;
}) {
  const t = useT();
  const [modeChoice, setModeChoice] = React.useState<{
    initialMode: "harmonic" | "varga";
    mode: "harmonic" | "varga";
  } | null>(null);
  const mode = modeChoice?.initialMode === initialMode
    ? modeChoice.mode
    : initialMode;
  const numbers = mode === "varga"
    ? [1, 2, 3, 4, 7, 9, 10, 12, 16, 20, 24, 27, 30, 40, 45, 60]
    : [2, 3, 4, 5, 6, 7, 8, 9, 12];
  return (
    <ContextMenu>
      <ContextMenuTrigger className="block w-full">{children}</ContextMenuTrigger>
      <ContextMenuContent align="start" className="min-w-36">
        <ContextMenuRadioGroup
          value={mode}
          onValueChange={(value) => setModeChoice({
            initialMode,
            mode: value as "harmonic" | "varga",
          })}
        >
          <ContextMenuRadioItem value="harmonic" closeOnClick={false}>
            {t("chartmenu.harmonicChart")}
          </ContextMenuRadioItem>
          <ContextMenuRadioItem value="varga" closeOnClick={false}>
            {t("chartmenu.vargas")}
          </ContextMenuRadioItem>
        </ContextMenuRadioGroup>
        <ContextMenuSeparator />
        {numbers.map((number) => (
          <ContextMenuItem
            key={number}
            onClick={() => onSelectNumber(mode, number)}
          >
            {number}
          </ContextMenuItem>
        ))}
        {trailingItems}
        <LeftSidebarSizeChoices submenu />
      </ContextMenuContent>
    </ContextMenu>
  );
}

type NavRowProps = {
  label: string;
  actionId?: string;
  shortcut?: string | null;
  isActive?: boolean;
  /** Open chart/tab row: its active fill is the tinted selected-chart token. */
  documentRow?: boolean;
  depth?: number;
  dirty?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  onMouseDownActivate?: () => void;
  onClose?: () => void;
  dragAttributes?: React.HTMLAttributes<HTMLButtonElement>;
  dragListeners?: React.HTMLAttributes<HTMLButtonElement>;
  // Drag-over conversion preview (wx _draw_synastry_preview / _draw_transit_preview
  // / _draw_attach_preview). Shown on the hovered target row mid-drag.
  preview?: { kind: DragPreviewKind; sourceLabel: string } | null;
  dropIndicator?: DropIndicatorPosition | null;
  previewTargetLabel?: string;
};

export function NavRow({
  label,
  actionId,
  shortcut,
  isActive,
  documentRow,
  depth = 0,
  dirty,
  disabled,
  onClick,
  onMouseDownActivate,
  onClose,
  dragAttributes,
  dragListeners,
  preview,
  dropIndicator,
  previewTargetLabel,
}: NavRowProps) {
  const tf = useTFallback();
  const shortcutHint = shortcut?.trim();
  const appleShortcuts = useAppleShortcuts();
  const modifierLabels = useShortcutModifierLabels();
  const shortcutChords = shortcutHint
    ? shortcutDisplayChords(shortcutHint, appleShortcuts, modifierLabels)
    : [];
  const shortcutDisplay = shortcutChords.map((chord) => chord.join("")).join("/");
  // Phones have no keyboard to use the hint with.
  const mobile = useMobileLayout();
  const showShortcutHint = shortcutChords.length > 0 && !disabled && !onClose && !mobile;
  const shortcutOverlayWidth = showShortcutHint
    ? shortcutDisplayWidth(shortcutChords, appleShortcuts)
    : null;
  const shortcutMaskImage = shortcutOverlayWidth
    ? shortcutFadeMask(shortcutOverlayWidth)
    : undefined;
  const ariaKeyShortcuts = disabled || shortcutChords.length === 0
    ? undefined
    : normalizeAriaKeyShortcuts(shortcut, appleShortcuts);
  // The shortcut is hover/focus information, not a permanent layout column.
  // Give the idle label the full row; CSS fades only the part beneath the
  // overlaid hint while it is visible. Document close buttons remain reserved.
  const trailingSlotWidth = onClose ? "var(--aries-sidebar-close-action-size)" : null;
  const pointerActivatedRef = React.useRef(false);
  const clearPointerActivated = React.useCallback(() => {
    window.setTimeout(() => {
      pointerActivatedRef.current = false;
    }, 700);
  }, []);
  const handleMouseDown = React.useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      if (!onMouseDownActivate || disabled || !isPrimaryMouseButton(event)) return;
      pointerActivatedRef.current = true;
      onMouseDownActivate();
      clearPointerActivated();
    },
    [clearPointerActivated, disabled, onMouseDownActivate],
  );
  const handleClick = React.useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      if (pointerActivatedRef.current && event.detail > 0) {
        pointerActivatedRef.current = false;
        return;
      }
      onClick?.();
    },
    [onClick],
  );

  return (
    <div
      className={cn(
        "group/navrow relative",
        showShortcutHint && "aries-sidebar-navrow--shortcut",
      )}
    >
      <SidebarMenuButton
        data-aries-sidebar-action-id={actionId}
        isActive={isActive}
        onClick={handleClick}
        onMouseDown={handleMouseDown}
        aria-disabled={disabled || undefined}
        aria-keyshortcuts={ariaKeyShortcuts}
        {...dragAttributes}
        {...dragListeners}
        className={cn(
          "h-[var(--morinus-row-min-height)] rounded-[var(--morinus-row-radius)]",
          "py-[var(--morinus-row-pad-y)]",
          "text-[length:var(--aries-font-size-nav)] font-normal leading-none",
          "min-w-0 justify-start text-sidebar-foreground",
          // Only a live drag handle owns touch; a disabled sortable scrolls.
          dragListeners && "touch-none",
          "transition-colors duration-75",
          "hover:bg-[color:var(--aries-sidebar-row-hover)] hover:text-sidebar-accent-foreground",
          documentRow
            ? "data-active:bg-[color:var(--aries-sidebar-row-selected-chart)]"
            : "data-[active=true]:bg-[color:var(--aries-sidebar-row-active)]",
          "data-[active=true]:text-sidebar-accent-foreground data-[active=true]:font-normal",
          // Not-yet-built launchers (manifest enabled:false): greyed, inert.
          disabled &&
            "cursor-default text-sidebar-foreground/35 hover:bg-transparent hover:text-sidebar-foreground/35",
        )}
        style={{
          paddingLeft: sidebarRowPaddingLeft(depth),
          paddingRight: trailingSlotWidth
            ? `calc(var(--morinus-row-pad-x) + ${trailingSlotWidth})`
            : "var(--morinus-row-pad-x)",
        }}
      >
        <span className="aries-sidebar-navrow-text relative block h-[var(--aries-sidebar-row-line-box)] min-w-0 flex-1 leading-[var(--aries-sidebar-row-line-box)]">
          <span className="aries-sidebar-navrow-label block h-full truncate leading-[var(--aries-sidebar-row-line-box)]">
            {label}
          </span>
          {showShortcutHint ? (
            <span
              aria-hidden="true"
              className="aries-sidebar-navrow-label-faded pointer-events-none absolute inset-0 block h-full overflow-hidden whitespace-nowrap [text-overflow:clip] opacity-0 leading-[var(--aries-sidebar-row-line-box)]"
              style={{
                WebkitMaskImage: shortcutMaskImage,
                maskImage: shortcutMaskImage,
              }}
            >
              {label}
            </span>
          ) : null}
        </span>
      </SidebarMenuButton>
      {dropIndicator ? (
        <span
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute left-0 right-0 z-30 rounded-full bg-[color:var(--aries-sidebar-drop-indicator)]",
          )}
          style={{
            height: "var(--aries-sidebar-drop-indicator-size)",
            ...(dropIndicator === "before"
              ? { top: "calc(0px - var(--aries-sidebar-drop-indicator-overhang))" }
              : { bottom: "calc(0px - var(--aries-sidebar-drop-indicator-overhang))" }),
          }}
        />
      ) : null}
      {showShortcutHint ? (
        <span
          aria-hidden="true"
          className="aries-sidebar-shortcut-hint pointer-events-none absolute right-[var(--aries-sidebar-trailing-inset)] top-1/2 h-[var(--aries-sidebar-row-line-box)] -translate-y-1/2 whitespace-nowrap text-right text-[length:var(--aries-font-size-nav)] leading-[var(--aries-sidebar-row-line-box)] text-sidebar-foreground/38 opacity-0 transition-opacity duration-75"
          // Spelled-out chords ("Strg+Umschalt+S") grow leftwards rather than
          // overflowing the row edge.
          style={{
            width: shortcutOverlayWidth ?? undefined,
            minWidth: appleShortcuts ? undefined : "max-content",
          }}
        >
          {shortcutDisplay}
        </span>
      ) : null}
      {/* Dirty marker — amber dot on unsaved-changes docs (daemon dirty flag).
          Hidden on hover so the close (×) takes its slot. Mirrors the wx title
          "*" suffix; here the dot is the quiet, content-forward signal. */}
      {dirty ? (
        <span
          aria-label={tf("sidebar.unsavedChanges", "Unsaved changes")}
          className="aries-sidebar-unsaved-dot pointer-events-none absolute right-[var(--aries-sidebar-trailing-inset)] top-1/2 size-[var(--aries-sidebar-unsaved-indicator-size)] -translate-y-1/2 rounded-full bg-[color:var(--aries-unsaved-indicator)] transition-opacity group-hover/navrow:opacity-0"
        />
      ) : null}
      {onClose ? (
        <button
          type="button"
          aria-label={tf("sidebar.closeLabel", "Close {label}").replace("{label}", label)}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          className="aries-sidebar-close-action absolute right-[var(--aries-sidebar-close-inset)] top-1/2 flex size-[var(--aries-sidebar-close-action-size)] -translate-y-1/2 items-center justify-center rounded-[var(--aries-radius-control-compact)] text-sidebar-foreground/40 opacity-0 transition hover:bg-sidebar-foreground/10 hover:text-sidebar-foreground group-hover/navrow:opacity-100"
        >
          <X className="size-[var(--aries-sidebar-action-icon-size)]" />
        </button>
      ) : null}
      {preview ? (
        // Every chart-on-chart preview keeps the receiving parent visible:
        // left = target, right = source (or the literal Transit conversion).
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 flex overflow-hidden rounded-[var(--morinus-row-radius)] border border-sidebar-foreground/40 bg-sidebar text-[length:var(--aries-font-size-nav)] leading-[var(--aries-sidebar-row-line-box)]"
        >
          <span className="flex flex-1 items-center truncate bg-[color:var(--aries-sidebar-row-hover)] px-[var(--morinus-row-pad-x)] text-sidebar-foreground">
            <span className="block h-[var(--aries-sidebar-row-line-box)] min-w-0 truncate leading-[var(--aries-sidebar-row-line-box)]">
              {previewTargetLabel ?? label}
            </span>
          </span>
          <span className="flex flex-1 items-center truncate border-l border-sidebar-foreground/40 bg-[color:var(--aries-sidebar-row-strong)] px-[var(--morinus-row-pad-x)] text-sidebar-foreground">
            <span className="block h-[var(--aries-sidebar-row-line-box)] min-w-0 truncate leading-[var(--aries-sidebar-row-line-box)]">
              {preview.kind === "transit" ? tf("sidebar.transitPreview", "Transit") : preview.sourceLabel}
            </span>
          </span>
        </span>
      ) : null}
    </div>
  );
}

function sidebarRowPaddingLeft(depth: number): string {
  const safeDepth = Math.max(0, Math.floor(depth));
  if (safeDepth === 0) return "var(--morinus-row-pad-x)";
  return `calc(var(--morinus-row-pad-x)${" + var(--aries-sidebar-tree-indent)".repeat(safeDepth)})`;
}

function shortcutDisplayChords(
  shortcut: string,
  apple: boolean,
  labels: ShortcutModifierLabels,
): string[][] {
  return shortcut
    .split("/")
    .map((chord) => chord.trim())
    .filter(Boolean)
    .map((chord) => shortcutDisplayChord(chord, apple, labels))
    .filter((chord) => chord.length > 0);
}

function shortcutDisplayChord(
  chord: string,
  apple: boolean,
  labels: ShortcutModifierLabels,
): string[] {
  const rawParts = chord
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean);
  if (rawParts.length === 0) return [];
  if (!apple) {
    // Windows/Linux: localized modifier names ("Ctrl+O"); reserved chords
    // (AltGr, Redo) are not offered there.
    const parsed = parseAcceleratorChord(chord);
    if (!parsed) return rawParts;
    return chordAvailable(parsed, false) ? [formatChordOffApple(parsed, labels)] : [];
  }

  const primaryKey = rawParts[rawParts.length - 1] ?? "";
  const ctrlIsMacCommand = isCommandStyleShortcut(primaryKey);
  return rawParts
    .map((part, index) =>
      shortcutDisplayKey(part, index < rawParts.length - 1, ctrlIsMacCommand),
    )
    .filter(Boolean);
}

function shortcutDisplayKey(
  rawKey: string,
  isModifierPosition: boolean,
  ctrlIsMacCommand: boolean,
): string {
  const normalized = rawKey.toLowerCase();
  if (normalized === "cmd" || normalized === "command" || normalized === "meta") {
    return "⌘";
  }
  if (normalized === "cmdorctrl" || normalized === "ctrlorcmd") {
    return "⌘";
  }
  if (normalized === "ctrl" || normalized === "control") {
    return ctrlIsMacCommand ? "⌘" : "⌃";
  }
  if (normalized === "alt" || normalized === "option" || normalized === "opt") {
    return "⌥";
  }
  if (normalized === "shift") {
    return "⇧";
  }
  if (normalized === "esc" || normalized === "escape") {
    return "Esc";
  }
  if (normalized === "space" || normalized === "spacebar") {
    return "Space";
  }
  if (normalized === "comma") {
    return ",";
  }
  if (normalized === "period") {
    return ".";
  }
  if (normalized === "plus") {
    return "+";
  }
  if (normalized === "minus") {
    return "-";
  }
  return isModifierPosition ? rawKey : rawKey.toUpperCase();
}

function isCommandStyleShortcut(primaryKey: string): boolean {
  const normalized = primaryKey.trim().toLowerCase();
  if (/^f\d{1,2}$/.test(normalized)) return false;
  if (/^\d$/.test(normalized)) return false;
  return true;
}

function shortcutDisplayWidth(chords: string[][], apple: boolean): string {
  const widest = Math.max(...chords.map((chord) => chord.join("").length));
  if (apple) return `${Math.min(3.4, Math.max(1.75, widest * 0.52 + 0.5)).toFixed(2)}rem`;
  // Windows/Linux spell modifiers out ("Ctrl+Shift+S"); size the label fade
  // in the row's own em so it clears the whole hint at every text size.
  return `${Math.max(2, widest * 0.58 + 0.4).toFixed(2)}em`;
}

function shortcutFadeMask(shortcutWidth: string): string {
  return `linear-gradient(to right, #000 0, #000 calc(100% - ${shortcutWidth} - var(--aries-control-gap-compact)), transparent calc(100% - ${shortcutWidth} + var(--aries-control-gap-compact)))`;
}

function normalizeAriaKeyShortcuts(
  shortcut: string | null | undefined,
  apple: boolean,
): string | undefined {
  const normalized = shortcut
    ?.trim()
    .split("/")
    .map((chord) => chord.trim())
    .filter(Boolean)
    // Chords the platform does not offer (AltGr, Redo) are not announced.
    .filter((chord) => apple || chordAvailable(parseAcceleratorChord(chord), false))
    .map((chord) =>
      chord
        .split("+")
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part) => normalizeAriaShortcutKey(part, apple))
        .join("+"),
    )
    .filter(Boolean)
    .join(" ");
  return normalized || undefined;
}

function normalizeAriaShortcutKey(rawKey: string, apple: boolean): string {
  const normalized = rawKey.toLowerCase();
  if (normalized === "cmdorctrl" || normalized === "ctrlorcmd") {
    return apple ? "Meta" : "Control";
  }
  if (normalized === "cmd" || normalized === "command" || normalized === "meta") {
    return "Meta";
  }
  if (normalized === "ctrl" || normalized === "control") {
    return "Control";
  }
  if (normalized === "alt" || normalized === "option" || normalized === "opt") {
    return "Alt";
  }
  if (normalized === "shift") {
    return "Shift";
  }
  if (normalized === "esc" || normalized === "escape") {
    return "Escape";
  }
  if (normalized === "space" || normalized === "spacebar") {
    return "Space";
  }
  if (normalized === "comma") {
    return ",";
  }
  if (normalized === "period") {
    return ".";
  }
  if (normalized === "plus") {
    return "+";
  }
  if (normalized === "minus") {
    return "-";
  }
  return rawKey.length === 1 ? rawKey.toUpperCase() : rawKey;
}
