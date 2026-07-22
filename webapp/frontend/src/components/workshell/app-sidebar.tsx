// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

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
} from "@/components/ui/sidebar";

import {
  buildDocumentTree,
  flattenDocumentTree,
  localizedWorkspaceDocumentTitle,
  useWorkspaceStore,
  type WorkspaceDocument,
} from "@/stores/workspace-store";
import { applyImmediateWorkspaceCommandResult } from "@/stores/daemon-workspace-adapter";
import { findChartLaunchParent } from "@/components/workshell/chart-launch-parent";
import { useFrameLayoutStore } from "@/stores/frame-layout-store";
import { useT, useTFallback, type TFunc } from "@/lib/i18n/i18n";
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
};

export type ReturnAverageKind = "solar" | "lunar";
export type FlatDocumentNode = ReturnType<typeof flattenDocumentTree>[number];

function isPrimaryMouseButton(event: React.MouseEvent): boolean {
  return event.button === 0;
}

export type DropIndicatorPosition = "before" | "after";

function manifestGroupRenderKey(group: ManifestGroup): string {
  return [
    group.id,
    group.collapsed ? "1" : "0",
    group.actions
      .map((action) =>
        [action.id, action.enabled ? "1" : "0", action.shortcut ?? ""].join(":"),
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
}: Props) {
  const dragReady = useHydrated();
  const openEclipsesPane = useWorkspaceStore((s) => s.openEclipsesPane);
  const setInspectorOpen = useFrameLayoutStore((s) => s.setInspectorOpen);
  const setNotesPaneOpen = useFrameLayoutStore((s) => s.setNotesPaneOpen);
  const handleSelect = React.useCallback(
    (id: string) => {
      if (id === "table:eclipses") {
        const launchParent = findChartLaunchParent(documents, activeDocumentId);
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
    [activeDocumentId, documents, onSelect, openEclipsesPane, setInspectorOpen, setNotesPaneOpen],
  );

  return (
    <Sidebar collapsible="offcanvas" className="border-r-0">
      {/* No sidebar header — the global UnifiedTitleBar spans the top across the
          sidebar + content, and content is inset below it (globals.css), so the
          first nav row sits directly under the title bar. */}
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
        {(manifest?.groups ?? []).map((group) => (
          <ActionsGroup
            key={manifestGroupRenderKey(group)}
            groupId={group.id}
            label={group.label}
            collapsed={group.collapsed}
            actions={group.actions}
            activeDocumentId={activeDocumentId}
            dragReady={dragReady}
            onSelect={handleSelect}
            onSolarAverageWindowSelect={onSolarAverageWindowSelect}
          />
        ))}
      </SidebarContent>
    </Sidebar>
  );
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
      try {
        const result = await executeWorkspaceContextMenuAction(actionId, payload);
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
  if (!Array.isArray(value.documents)) return false;
  if (isRecord(value.snapshot)) return true;
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
}: {
  groupId: string;
  label: string;
  collapsed: boolean;
  actions: ManifestGroup["actions"];
  activeDocumentId: string | null;
  dragReady: boolean;
  onSelect: (id: string) => void;
  onSolarAverageWindowSelect: (maxBirthday: number, returnKind: ReturnAverageKind) => void;
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
                  orderedActions={orderedActions}
                  activeDocumentId={activeDocumentId}
                  onSelect={onSelect}
                  onSolarAverageWindowSelect={onSolarAverageWindowSelect}
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
              />
            </React.Suspense>
          ) : (
            <StaticActionsContent
              orderedActions={orderedActions}
              activeDocumentId={activeDocumentId}
              onSelect={onSelect}
              onSolarAverageWindowSelect={onSolarAverageWindowSelect}
            />
          )}
        </SidebarGroupContent>
      ) : null}
    </SidebarGroup>
  );
}

function StaticActionsContent({
  orderedActions,
  activeDocumentId,
  onSelect,
  onSolarAverageWindowSelect,
}: {
  orderedActions: SidebarAction[];
  activeDocumentId: string | null;
  onSelect: (id: string) => void;
  onSolarAverageWindowSelect: (maxBirthday: number, returnKind: ReturnAverageKind) => void;
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
            {action.id === "solar-average" && action.enabled ? (
              <SolarAverageLauncherContextMenu onSelectWindow={onSolarAverageWindowSelect}>
                {row}
              </SolarAverageLauncherContextMenu>
            ) : (
              row
            )}
          </SidebarMenuItem>
        );
      })}
    </SidebarMenu>
  );
}

export function SolarAverageLauncherContextMenu({
  children,
  onSelectWindow,
}: {
  children: React.ReactElement;
  onSelectWindow: (maxBirthday: number, returnKind: ReturnAverageKind) => void;
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
      </ContextMenuContent>
    </ContextMenu>
  );
}

type NavRowProps = {
  label: string;
  actionId?: string;
  shortcut?: string | null;
  isActive?: boolean;
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
  const shortcutChords = shortcutHint ? shortcutDisplayChords(shortcutHint) : [];
  const shortcutDisplay = shortcutChords.map((chord) => chord.join("")).join("/");
  const showShortcutHint = shortcutChords.length > 0 && !disabled && !onClose;
  const shortcutSlotWidth = showShortcutHint
    ? shortcutDisplayWidth(shortcutChords)
    : null;
  const trailingSlotWidth = showShortcutHint
    ? shortcutSlotWidth
    : onClose
      ? "var(--aries-sidebar-close-action-size)"
      : null;
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
    <div className="group/navrow relative">
      <SidebarMenuButton
        data-aries-sidebar-action-id={actionId}
        isActive={isActive}
        onClick={handleClick}
        onMouseDown={handleMouseDown}
        aria-disabled={disabled || undefined}
        {...dragAttributes}
        {...dragListeners}
        className={cn(
          "h-[var(--morinus-row-min-height)] rounded-[var(--morinus-row-radius)]",
          "py-[var(--morinus-row-pad-y)]",
          "text-[length:var(--aries-font-size-nav)] font-normal leading-none",
          "min-w-0 justify-start text-sidebar-foreground touch-none",
          "transition-colors duration-75",
          "hover:bg-[color:var(--aries-sidebar-row-hover)] hover:text-sidebar-accent-foreground",
          "data-[active=true]:bg-[color:var(--aries-sidebar-row-active)] data-[active=true]:text-sidebar-accent-foreground data-[active=true]:font-normal",
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
        <span className="block h-[var(--aries-sidebar-row-line-box)] min-w-0 flex-1 truncate leading-[var(--aries-sidebar-row-line-box)]">
          {label}
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
          className="pointer-events-none absolute right-[var(--aries-sidebar-trailing-inset)] top-1/2 h-[var(--aries-sidebar-row-line-box)] -translate-y-1/2 whitespace-nowrap text-right text-[length:var(--aries-font-size-nav)] leading-[var(--aries-sidebar-row-line-box)] text-sidebar-foreground/38 opacity-0 transition-opacity group-focus-within/navrow:opacity-100 group-hover/navrow:opacity-100"
          style={{ width: trailingSlotWidth ?? undefined }}
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
          className="pointer-events-none absolute right-[var(--aries-sidebar-trailing-inset)] top-1/2 size-[var(--aries-sidebar-unsaved-indicator-size)] -translate-y-1/2 rounded-full bg-[color:var(--aries-unsaved-indicator)] transition-opacity group-hover/navrow:opacity-0"
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
          className="absolute right-[var(--aries-sidebar-close-inset)] top-1/2 flex size-[var(--aries-sidebar-close-action-size)] -translate-y-1/2 items-center justify-center rounded-[var(--aries-radius-control-compact)] text-sidebar-foreground/40 opacity-0 transition hover:bg-sidebar-foreground/10 hover:text-sidebar-foreground group-hover/navrow:opacity-100"
        >
          <X className="size-[var(--aries-sidebar-action-icon-size)]" />
        </button>
      ) : null}
      {preview ? (
        preview.kind === "attach" ? (
          // wx _draw_attach_preview — accent border on the nest target.
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 rounded-[var(--morinus-row-radius)] bg-[color:var(--aries-sidebar-row-soft)] ring-2 ring-inset ring-[color:var(--aries-accent)]"
          />
        ) : (
          // wx _draw_synastry_preview / _draw_transit_preview — bisected
          // two-name cell: left = target, right = source (synastry) or
          // literal "Transit" (transit), split by a divider.
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
        )
      ) : null}
    </div>
  );
}

function sidebarRowPaddingLeft(depth: number): string {
  const safeDepth = Math.max(0, Math.floor(depth));
  if (safeDepth === 0) return "var(--morinus-row-pad-x)";
  return `calc(var(--morinus-row-pad-x)${" + var(--aries-sidebar-tree-indent)".repeat(safeDepth)})`;
}

function shortcutDisplayChords(shortcut: string): string[][] {
  return shortcut
    .split("/")
    .map((chord) => chord.trim())
    .filter(Boolean)
    .map(shortcutDisplayChord)
    .filter((chord) => chord.length > 0);
}

function shortcutDisplayChord(chord: string): string[] {
  const rawParts = chord
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean);
  if (rawParts.length === 0) return [];

  const primaryKey = rawParts[rawParts.length - 1] ?? "";
  const ctrlIsMacCommand = isCommandStyleShortcut(primaryKey);
  return rawParts
    .map((part, index) => shortcutDisplayKey(part, index < rawParts.length - 1, ctrlIsMacCommand))
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

function shortcutDisplayWidth(chords: string[][]): string {
  const widest = Math.max(
    ...chords.map((chord) => chord.join("").length),
  );
  return `${Math.min(3.4, Math.max(1.75, widest * 0.52 + 0.5)).toFixed(2)}rem`;
}
