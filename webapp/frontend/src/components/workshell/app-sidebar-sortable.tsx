// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import * as React from "react";
import { createPortal } from "react-dom";

import {
  closestCenter,
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  type SortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import {
  applyImmediateWorkspaceCommandResult,
} from "@/stores/daemon-workspace-adapter";
import type {
  SidebarAction,
  WorkspaceDragConversionAction,
  WorkspaceMoveIntent,
} from "@/lib/daemon/client";
import {
  setWorkspaceSidebarActionOrder,
  workspaceApplyDragConversion,
  workspaceApplyMoveIntent,
  workspaceDragContext,
  workspacePreviewMoveIntent,
} from "@/lib/daemon/client";
import { useT, useTFallback } from "@/lib/i18n/i18n";
import { useMobileLayout } from "@/hooks/use-mobile-layout";
import { useChartEventsStore } from "@/stores/chart-events-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { executeWorkspaceContextMenuAction } from "@/lib/daemon/client";
import type { WorkspaceDocument } from "@/stores/workspace-store";
import {
  DocumentRowContextMenu,
  LauncherRowMenu,
  NavRow,
  documentRowLabel,
  type DropIndicatorPosition,
  type FlatDocumentNode,
  type ReturnAverageKind,
} from "./app-sidebar";
import { chartEventDropAction, documentPairSupportsDirectAttach, dragPointInside } from "./workspace-tab-drag";
import { captureSidebarTabDragPreview, SidebarTabDragPreview } from "./sidebar-tab-drag-preview";

type DragDropGeometry = {
  overId: string;
  beforeId: string | null;
  rootBeforeId: string | null;
  preferAttach: boolean;
  attachEligible: boolean;
  staticList: boolean;
};

type DropIndicator = {
  id: string;
  position: DropIndicatorPosition;
};

type DragPreviewKind = "synastry" | "transit" | "attach";

// While a conversion/attach preview is active, the drop is a synastry/transit/
// nest onto the hovered row, not a reorder, so the receiving rows stay put.
const NO_REORDER_SORTING_STRATEGY: SortingStrategy = () => null;

export function SortableDocumentsGroup({
  documents,
  flat,
  activeDocumentId,
  onSelect,
  onClose,
  onReorder,
}: {
  documents: WorkspaceDocument[];
  flat: FlatDocumentNode[];
  activeDocumentId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onReorder: (docId: string, beforeId: string | null) => void;
}) {
  const sortableIds = React.useMemo(() => flat.map((f) => f.node.doc.id), [flat]);
  const [dragContext, setDragContext] =
    React.useState<Awaited<ReturnType<typeof workspaceDragContext>>["context"] | null>(null);
  const [activeDragId, setActiveDragId] = React.useState<string | null>(null);
  const dragModifierActionRef = React.useRef<WorkspaceDragConversionAction | null>(null);
  const activeDragIdRef = React.useRef<string | null>(null);
  const dropGeometryRef = React.useRef<DragDropGeometry | null>(null);
  const [dragPreview, setDragPreview] = React.useState<
    { overId: string; kind: DragPreviewKind; sourceLabel: string } | null
  >(null);
  const [dropIndicator, setDropIndicator] = React.useState<DropIndicator | null>(null);
  const [staticDragList, setStaticDragList] = React.useState(false);
  const dragOriginRef = React.useRef<{ x: number; y: number } | null>(null);
  const sidebarContentRef = React.useRef<Element | null>(null);
  const [tabDragSnapshot, setTabDragSnapshot] = React.useState<HTMLElement | null>(null);
  const notifyEventDrop = React.useCallback((over: boolean) => {
    window.dispatchEvent(new CustomEvent("aries:chart-event-drag", { detail: { over } }));
  }, []);
  const eventDropAt = React.useCallback((activeId: string, delta: { x: number; y: number }) => {
    if (dragModifierActionRef.current) return null;
    const source = documents.find((doc) => doc.id === activeId);
    const paneId = useWorkspaceStore.getState().chartEventsPane?.documentId;
    const target = documents.find((doc) => doc.id === paneId);
    const origin = dragOriginRef.current;
    const actionId = chartEventDropAction(source, target, documents);
    if (!actionId || !target || !origin) return null;
    const pane = [...document.querySelectorAll("[data-aries-chart-events-drop]")]
      .find((element) => element.getAttribute("data-aries-chart-events-drop") === paneId);
    if (!pane) return null;
    return dragPointInside(origin, delta, pane.getBoundingClientRect())
      ? { documentId: target.id, actionId } : null;
  }, [documents]);
  const pointerInSidebar = React.useCallback((delta: { x: number; y: number }) => {
    const origin = dragOriginRef.current;
    const sidebar = sidebarContentRef.current;
    if (!origin || !sidebar) return false;
    return dragPointInside(origin, delta, sidebar.getBoundingClientRect());
  }, []);
  void onReorder;
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  const refreshPreview = React.useCallback(() => {
    const activeId = activeDragIdRef.current;
    const geometry = dropGeometryRef.current;
    if (!activeId || !geometry || geometry.overId === activeId) {
      setDragPreview(null);
      setDropIndicator(null);
      setStaticDragList(false);
      return;
    }
    const action = dragModifierActionRef.current;
    const kind: DragPreviewKind | null = action ?? (geometry.attachEligible ? "attach" : null);
    setStaticDragList(Boolean(kind) || geometry.staticList);
    if (!kind) {
      setDragPreview(null);
      return;
    }
    const sourceDoc = documents.find((d) => d.id === activeId);
    setDragPreview({ overId: geometry.overId, kind, sourceLabel: sourceDoc?.title ?? "" });
    setDropIndicator(null);
  }, [documents]);

  const setDragModifierAction = React.useCallback(
    (action: WorkspaceDragConversionAction | null) => {
      dragModifierActionRef.current = action;
      refreshPreview();
    },
    [refreshPreview],
  );

  const updateOverFromEvent = React.useCallback(
    (event: DragMoveEvent) => {
      const over = event.over;
      const activeId = activeDragIdRef.current;
      if (!over || !activeId) {
        dropGeometryRef.current = null;
        setDropIndicator(null);
        refreshPreview();
        return;
      }
      const geometry = dropGeometryFromEvent(documents, activeId, event, dragContext);
      dropGeometryRef.current = geometry;
      const action = dragModifierActionRef.current;
      const previewKind: DragPreviewKind | null =
        geometry == null ? null : action ?? (geometry.attachEligible ? "attach" : null);
      setDropIndicator(previewKind ? null : dropIndicatorFromEvent(activeId, event));
      refreshPreview();
    },
    [documents, dragContext, refreshPreview],
  );

  const clearDragState = React.useCallback(() => {
    dragOriginRef.current = null;
    sidebarContentRef.current = null;
    notifyEventDrop(false);
    activeDragIdRef.current = null;
    dropGeometryRef.current = null;
    dragModifierActionRef.current = null;
    setDragContext(null);
    setActiveDragId(null);
    setTabDragSnapshot(null);
    setDragPreview(null);
    setDropIndicator(null);
    setStaticDragList(false);
  }, [notifyEventDrop]);

  React.useEffect(() => {
    if (!activeDragId) return;
    const handleModifierKey = (event: KeyboardEvent) => {
      setDragModifierAction(modifierActionFromFlags(event.shiftKey, event.altKey));
    };
    window.addEventListener("keydown", handleModifierKey);
    window.addEventListener("keyup", handleModifierKey);
    return () => {
      window.removeEventListener("keydown", handleModifierKey);
      window.removeEventListener("keyup", handleModifierKey);
    };
  }, [activeDragId, setDragModifierAction]);

  const handleDragStart = (event: DragStartEvent) => {
    const target = event.activatorEvent.target;
    const row = target instanceof Element
      ? target.closest('[data-sidebar="menu-item"]')
        ?.querySelector<HTMLElement>('[data-sidebar="menu-button"]')?.parentElement
      : null;
    setTabDragSnapshot(row ? captureSidebarTabDragPreview(row) : null);
    const activeId = String(event.active.id);
    activeDragIdRef.current = activeId;
    dropGeometryRef.current = null;
    setActiveDragId(activeId);
    const pointer = event.activatorEvent as MouseEvent;
    dragOriginRef.current = typeof pointer.clientX === "number" ? { x: pointer.clientX, y: pointer.clientY } : null;
    sidebarContentRef.current = document.querySelector(`[data-sidebar="content"]`);
    setDragModifierAction(modifierActionFromEvent(event.activatorEvent));
    void workspaceDragContext(activeId)
      .then((payload) => setDragContext(payload.context))
      .catch((err) => {
        console.error("[ws-drag-context]", err);
        setDragContext(null);
      });
  };

  const handleDragMove = (event: DragMoveEvent) => {
    const action = modifierActionFromEvent(event.activatorEvent);
    if (action) dragModifierActionRef.current = action;
    const eventTarget = eventDropAt(String(event.active.id), event.delta);
    notifyEventDrop(Boolean(eventTarget));
    if (eventTarget) {
      dropGeometryRef.current = null;
      setDropIndicator(null);
      setDragPreview(null);
      setStaticDragList(true);
    } else if (pointerInSidebar(event.delta)) updateOverFromEvent(event);
    else {
      dropGeometryRef.current = null;
      setDropIndicator(null);
      setDragPreview(null);
      setStaticDragList(true);
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active } = event;
    const conversionAction = dragModifierActionRef.current;
    const activeId = String(active.id);
    const eventTarget = eventDropAt(activeId, event.delta);
    const endedInSidebar = pointerInSidebar(event.delta);
    const geometry =
      dropGeometryRef.current ?? dropGeometryFromEvent(documents, activeId, event, dragContext);
    clearDragState();
    if (eventTarget) {
      const ownerId = eventTarget.documentId;
      const payload = eventTarget.actionId === "workspace.save_event" ? {
        documentId: activeId, ownerDocumentId: ownerId,
      } : {
        sourceDocumentId: activeId, targetDocumentId: ownerId, eventId: crypto.randomUUID(),
      };
      const saveDrop = async () => {
        if (eventTarget.actionId === "workspace.copy_saved_chart_event") {
          // The copied note comes from its sidecar. Finish any active note
          // editor's pending write before the daemon reads that file.
          const awaitFlush: Promise<unknown>[] = [];
          window.dispatchEvent(new CustomEvent("aries://flush-notes", { detail: { awaitFlush } }));
          await Promise.all(awaitFlush);
        }
        return executeWorkspaceContextMenuAction(eventTarget.actionId, payload);
      };
      void saveDrop().then((result) => {
        // A newly added event opens into inline rename, like the menu's Add event.
        const renameEventId = eventTarget.actionId === "workspace.save_event" && result?.eventId ? String(result.eventId) : null;
        useChartEventsStore.getState().patch(ownerId, { error: null, renameEventId });
        useChartEventsStore.getState().invalidate([ownerId]);
      }).catch((err) => {
        console.error("[chart-event-drop]", err);
        useChartEventsStore.getState().patch(ownerId, { error: "chartEvents.saveError" });
      });
      return;
    }
    if (!endedInSidebar) return;
    if (!geometry || activeId === geometry.overId) return;
    const overId = geometry.overId;
    if (dragContext && !dragContext.ordered_ids.includes(overId)) return;

    const activeDoc = documents.find((d) => d.id === activeId);
    const overDoc = documents.find((d) => d.id === overId);
    if (!activeDoc || !overDoc) return;

    if (conversionAction) {
      void workspaceApplyDragConversion(conversionAction, activeId, overId).catch((err) => {
        console.error("[ws-drag-conversion]", err);
      });
      return;
    }

    void workspacePreviewMoveIntent({
      sourceDocumentId: activeId,
      targetDocumentId: overId,
      beforeId: geometry.beforeId,
      rootBeforeId: geometry.rootBeforeId,
      preferAttach: geometry.preferAttach,
    })
      .then((preview) => applyPreviewedMoveIntent(activeId, preview.intent))
      .catch((err) => {
        console.error("[ws-preview-move]", err);
      });
  };

  return (
    <SidebarGroup className="px-0 pb-0 pt-[var(--aries-control-padding-y)]">
      <SidebarGroupContent>
        <DndContext
          id="aries-sidebar-documents"
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragMove={handleDragMove}
          onDragEnd={handleDragEnd}
          onDragCancel={clearDragState}
        >
          <SortableContext
            items={sortableIds}
            strategy={staticDragList ? NO_REORDER_SORTING_STRATEGY : verticalListSortingStrategy}
          >
            <SidebarMenu className="gap-0">
              {flat.map(({ node, depth }) => (
                <SortableDocItem
                  key={node.doc.id}
                  doc={node.doc}
                  depth={depth}
                  isActive={node.doc.id === activeDocumentId}
                  dirty={node.doc.dirty === true}
                  onSelect={() => onSelect(node.doc.id)}
                  onClose={() => onClose(node.doc.id)}
                  preview={
                    dragPreview && dragPreview.overId === node.doc.id
                      ? { kind: dragPreview.kind, sourceLabel: dragPreview.sourceLabel }
                      : null
                  }
                  dropIndicator={
                    dropIndicator && dropIndicator.id === node.doc.id
                      ? dropIndicator.position
                      : null
                  }
                />
              ))}
            </SidebarMenu>
          </SortableContext>
          {typeof document !== "undefined" && createPortal(
            <DragOverlay dropAnimation={null}>
              {tabDragSnapshot ? <SidebarTabDragPreview snapshot={tabDragSnapshot} /> : null}
            </DragOverlay>, document.body)}
        </DndContext>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

export function SortableActionsContent({
  groupId,
  label,
  orderedActions,
  setOrderedActions,
  sortableIds,
  activeDocumentId,
  onSelect,
  onSolarAverageWindowSelect,
  harmonicChartMode,
}: {
  groupId: string;
  label: string;
  orderedActions: SidebarAction[];
  setOrderedActions: React.Dispatch<React.SetStateAction<SidebarAction[]>>;
  sortableIds: string[];
  activeDocumentId: string | null;
  onSelect: (id: string) => void;
  onSolarAverageWindowSelect: (maxBirthday: number, returnKind: ReturnAverageKind) => void;
  harmonicChartMode: "harmonic" | "varga";
}) {
  const tLabel = useTFallback();
  const [dropIndicator, setDropIndicator] = React.useState<DropIndicator | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const handleDragEnd = React.useCallback(
    (event: DragEndEvent) => {
      setDropIndicator(null);
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const activeId = String(active.id);
      const overId = String(over.id);
      const activeIndex = orderedActions.findIndex((action) => action.id === activeId);
      const overIndex = orderedActions.findIndex((action) => action.id === overId);
      if (activeIndex === -1 || overIndex === -1) return;
      if (!sortableIds.includes(activeId) || !sortableIds.includes(overId)) return;
      const previous = orderedActions;
      const next = arrayMove(orderedActions, activeIndex, overIndex);
      const finalIndex = next.findIndex((action) => action.id === activeId);
      const beforeId = finalIndex < next.length - 1 ? next[finalIndex + 1].id : null;
      setOrderedActions(next);
      void setWorkspaceSidebarActionOrder(label, activeId, beforeId).catch((err) => {
        console.error("[sidebar-action-order]", err);
        setOrderedActions(previous);
      });
    },
    [label, orderedActions, setOrderedActions, sortableIds],
  );

  const handleDragMove = React.useCallback(
    (event: DragMoveEvent) => {
      const activeId = String(event.active.id);
      if (!sortableIds.includes(activeId)) {
        setDropIndicator(null);
        return;
      }
      setDropIndicator(dropIndicatorFromEvent(activeId, event));
    },
    [sortableIds],
  );

  const clearDragIndicator = React.useCallback(() => {
    setDropIndicator(null);
  }, []);

  return (
    <DndContext
      id={`aries-sidebar-actions-${groupId}`}
      sensors={sensors}
      onDragMove={handleDragMove}
      onDragEnd={handleDragEnd}
      onDragCancel={clearDragIndicator}
    >
      <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
        <SidebarMenu className="gap-0">
          {orderedActions.map((action) =>
            action.id === "transit-search" ? (
              <SidebarMenuItem key={action.id}>
                <LauncherRowMenu
                  sectionLabel={label}
                  action={action}
                  onSelect={onSelect}
                  onSolarAverageWindowSelect={onSolarAverageWindowSelect}
                  harmonicChartMode={harmonicChartMode}
                >
                  <NavRow
                    label={tLabel(`sidebar.action.${action.id}`, action.label)}
                    shortcut={action.shortcut}
                    isActive={action.id === activeDocumentId}
                    disabled={!action.enabled}
                    onClick={action.enabled ? () => onSelect(action.id) : undefined}
                  />
                </LauncherRowMenu>
              </SidebarMenuItem>
            ) : (
              <SortableActionItem
                key={action.id}
                sectionLabel={label}
                action={action}
                isActive={action.id === activeDocumentId}
                dropIndicator={
                  dropIndicator && dropIndicator.id === action.id
                    ? dropIndicator.position
                    : null
                }
                onSelect={onSelect}
                onSolarAverageWindowSelect={onSolarAverageWindowSelect}
                harmonicChartMode={harmonicChartMode}
              />
            ),
          )}
        </SidebarMenu>
      </SortableContext>
    </DndContext>
  );
}

function modifierActionFromFlags(
  shiftKey?: boolean,
  altKey?: boolean,
): WorkspaceDragConversionAction | null {
  if (shiftKey) return "transit";
  if (altKey) return "synastry";
  return null;
}

function modifierActionFromEvent(
  event: Event | null | undefined,
): WorkspaceDragConversionAction | null {
  if (!event) return null;
  const modifiers = event as Partial<Pick<MouseEvent, "shiftKey" | "altKey">>;
  return modifierActionFromFlags(Boolean(modifiers.shiftKey), Boolean(modifiers.altKey));
}

function siblingBeforeId(
  documents: WorkspaceDocument[],
  activeId: string,
  overId: string,
): string | null {
  const activeDoc = documents.find((d) => d.id === activeId);
  const overDoc = documents.find((d) => d.id === overId);
  if (!activeDoc || !overDoc) return null;
  if (activeDoc.parentDocumentId !== overDoc.parentDocumentId) return null;
  const siblings = documents
    .filter((d) => d.parentDocumentId === activeDoc.parentDocumentId)
    .map((d) => d.id);
  const fromIndex = siblings.indexOf(activeId);
  const overIndex = siblings.indexOf(overId);
  if (fromIndex === -1 || overIndex === -1) return null;
  const reordered = arrayMove(siblings, fromIndex, overIndex);
  const finalIndex = reordered.indexOf(activeId);
  return finalIndex < reordered.length - 1 ? reordered[finalIndex + 1] : null;
}

function dropGeometryFromEvent(
  documents: WorkspaceDocument[],
  activeId: string,
  event: DragMoveEvent | DragEndEvent,
  dragContext: Awaited<ReturnType<typeof workspaceDragContext>>["context"] | null,
): DragDropGeometry | null {
  const over = event.over;
  if (!over) return null;
  const overId = String(over.id);
  const activeDoc = documents.find((d) => d.id === activeId);
  const overDoc = documents.find((d) => d.id === overId);
  const crossParent =
    activeDoc != null &&
    overDoc != null &&
    activeDoc.parentDocumentId !== overDoc.parentDocumentId;
  const rootChartPair =
    activeDoc?.parentDocumentId === null &&
    overDoc?.parentDocumentId === null;
  const attachTargetIds = dragContext?.attach_target_ids;
  const attachAllowed =
    attachTargetIds == null || attachTargetIds.includes(overId);
  const attachEligible =
    documentPairSupportsDirectAttach(activeDoc, overDoc) &&
    attachAllowed &&
    (rootChartPair ? dropPrefersRootAttach(event) : dropPrefersAttach(event));

  return {
    overId,
    beforeId: siblingBeforeId(documents, activeId, overId),
    rootBeforeId: rootBeforeIdForDrop(documents, overId, event),
    preferAttach: attachEligible,
    attachEligible,
    staticList: Boolean(crossParent),
  };
}

function rootBeforeIdForDrop(
  documents: WorkspaceDocument[],
  overId: string,
  event: DragMoveEvent | DragEndEvent,
): string | null {
  const roots = documents.filter((doc) => doc.parentDocumentId === null).map((doc) => doc.id);
  const overRootId = rootIdForDocument(documents, overId);
  const overIndex = overRootId == null ? -1 : roots.indexOf(overRootId);
  if (overIndex === -1) return null;
  if (overRootId !== overId) {
    return roots[overIndex + 1] ?? null;
  }
  const pointerY = dragCenterY(event);
  if (pointerY == null || !event.over?.rect) return overId;
  const nextRoot = roots[overIndex + 1] ?? null;
  const midY = event.over.rect.top + event.over.rect.height / 2;
  return pointerY < midY ? overId : nextRoot;
}

function rootIdForDocument(
  documents: WorkspaceDocument[],
  documentId: string,
): string | null {
  const byId = new Map(documents.map((doc) => [doc.id, doc]));
  let current = byId.get(documentId) ?? null;
  const seen = new Set<string>();
  while (current?.parentDocumentId) {
    if (seen.has(current.id)) return current.id;
    seen.add(current.id);
    const parent = byId.get(current.parentDocumentId);
    if (!parent) break;
    current = parent;
  }
  return current?.id ?? null;
}

function dragCenterY(event: DragMoveEvent | DragEndEvent): number | null {
  const rect =
    event.active.rect.current.translated ??
    event.active.rect.current.initial ??
    event.over?.rect ??
    null;
  if (!rect) return null;
  return rect.top + rect.height / 2;
}

function dropIndicatorFromEvent(
  activeId: string,
  event: DragMoveEvent | DragEndEvent,
): DropIndicator | null {
  const over = event.over;
  if (!over) return null;
  const overId = String(over.id);
  if (overId === activeId) return null;
  const y = dragCenterY(event);
  const rect = over.rect;
  if (y == null || !rect) return { id: overId, position: "before" };
  const midY = rect.top + rect.height / 2;
  return { id: overId, position: y < midY ? "before" : "after" };
}

function dropPrefersAttach(event: DragMoveEvent | DragEndEvent): boolean {
  const y = dragCenterY(event);
  const rect = event.over?.rect;
  if (y == null || !rect) return true;
  const edgeBand = 2;
  return y >= rect.top + edgeBand && y < rect.top + rect.height - edgeBand;
}

function dropPrefersRootAttach(event: DragMoveEvent | DragEndEvent): boolean {
  const y = dragCenterY(event);
  const rect = event.over?.rect;
  if (y == null || !rect) return true;
  const edgeBand = rect.height * 0.22;
  return y >= rect.top + edgeBand && y < rect.top + rect.height - edgeBand;
}

function applyPreviewedMoveIntent(
  sourceDocumentId: string,
  intent: WorkspaceMoveIntent | null,
) {
  if (!intent) return;
  void workspaceApplyMoveIntent(sourceDocumentId, intent)
    .then((result) => applyImmediateWorkspaceCommandResult(result, sourceDocumentId))
    .catch((err) => console.error("[ws-apply-move]", err));
}

function SortableDocItem({
  doc,
  depth,
  isActive,
  dirty,
  onSelect,
  onClose,
  preview,
  dropIndicator,
}: {
  doc: WorkspaceDocument;
  depth: number;
  isActive: boolean;
  dirty?: boolean;
  onSelect: () => void;
  onClose?: () => void;
  preview?: { kind: DragPreviewKind; sourceLabel: string } | null;
  dropIndicator?: DropIndicatorPosition | null;
}) {
  const t = useT();
  // Phone: a finger drag on a row must scroll the launcher, not reorder it.
  // The row's long press stays with its context menu.
  const mobile = useMobileLayout();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: doc.id, disabled: mobile });
  const label = documentRowLabel(doc, dirty, t);
  const freezeDragSource = isDragging;
  const style: React.CSSProperties = {
    transform: freezeDragSource ? undefined : CSS.Transform.toString(transform),
    transition: freezeDragSource ? undefined : transition,
    opacity: isDragging ? "var(--aries-sidebar-drag-opacity)" : 1,
    zIndex: isDragging ? 10 : undefined,
  };

  return (
    <SidebarMenuItem ref={setNodeRef} style={style}>
      <DocumentRowContextMenu docId={doc.id}>
        <NavRow
          label={label}
          isActive={isActive}
          documentRow
          depth={depth}
          dirty={dirty}
          onClick={onSelect}
          onClose={onClose}
          dragAttributes={mobile ? undefined : attributes}
          dragListeners={mobile ? undefined : listeners}
          preview={isDragging ? null : preview}
          dropIndicator={isDragging ? null : dropIndicator}
          previewTargetLabel={doc.title}
        />
      </DocumentRowContextMenu>
    </SidebarMenuItem>
  );
}

function SortableActionItem({
  sectionLabel,
  action,
  isActive,
  dropIndicator,
  onSelect,
  onSolarAverageWindowSelect,
  harmonicChartMode,
}: {
  sectionLabel: string;
  action: SidebarAction;
  isActive: boolean;
  dropIndicator?: DropIndicatorPosition | null;
  onSelect: (id: string) => void;
  onSolarAverageWindowSelect: (maxBirthday: number, returnKind: ReturnAverageKind) => void;
  harmonicChartMode: "harmonic" | "varga";
}) {
  const tLabel = useTFallback();
  const mobile = useMobileLayout();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: action.id, disabled: mobile || !action.enabled });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? "var(--aries-sidebar-drag-opacity)" : 1,
    zIndex: isDragging ? 10 : undefined,
  };
  const row = (
    <NavRow
      actionId={action.id}
      label={tLabel(`sidebar.action.${action.id}`, action.label)}
      shortcut={action.shortcut}
      isActive={isActive}
      disabled={!action.enabled}
      onClick={action.enabled ? () => onSelect(action.id) : undefined}
      dragAttributes={mobile ? undefined : attributes}
      dragListeners={mobile ? undefined : listeners}
      dropIndicator={isDragging ? null : dropIndicator}
    />
  );
  return (
    <SidebarMenuItem ref={setNodeRef} style={style}>
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
}
