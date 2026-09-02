// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import { create } from "zustand";

import {
  subscribeWorkspaceEvents,
  waitForDaemonHealth,
  workspaceState,
  type DaemonDocumentSummary,
  type DaemonEvent,
  type RetainedListDisplay,
  type WorkspaceEventSubscription,
} from "@/lib/daemon/client";
import { isAbortError } from "@/lib/abort-error";
import { perfNow, recordChartPerf, recordStartupPerfOnce } from "@/lib/chart/perf";
import type { ChartRenderSnapshot } from "@/lib/chart/types";
import { normalizeOptionsStyleIdentity } from "@/lib/theme/style-state.mjs";
import {
  hasPendingWorkspaceSnapshotCommand,
  waitForWorkspaceSnapshotCommands,
} from "@/stores/workspace-command-snapshot-gate";
import {
  invalidateDocumentSnapshots,
  rememberDocumentSnapshot,
  retainDocumentSnapshots,
} from "@/lib/chart/document-snapshot-cache";

// ---------------------------------------------------------------------------
// Daemon-mirrored workspace tree (slice 3).
//
// The daemon owns the canonical workspace controller. This store is a READ
// MIRROR of the daemon's tree + active id — it never invents documents. On
// mount the app seeds it via GET /api/workspace/state and subscribes to
// /ws/events; every documents.changed / active_document.changed / session.changed
// event re-applies the daemon's authoritative state.
//
// UX-only client state (hover, inspector/notes open, sidebar width, keyboard
// scope) stays in the existing workspace-store — that is genuinely local and is
// NOT daemon-owned.
// ---------------------------------------------------------------------------

export type DaemonWorkspaceOptionsChange = {
  refreshedDocumentIds: string[];
  refreshMode: string;
  styleOnly: boolean;
  listDataChanged: boolean;
  retainedListTarget?: "aspect-list" | null;
  retainedListDataKey?: string;
  /** Content identity for every option that changes Graphic Ephemeris data,
   * labels, glyphs, or retained daemon colours. */
  ephemerisDataKey?: string;
  /** A narrow display change altered the daemon-built inspector payload even
   * though resident list/table query data remains valid. */
  inspectorDataChanged: boolean;
  langid?: number;
  schemaVersion: number;
  themeVersion: number;
  styleRevision: number;
  paletteHash: string;
  styleHash: string;
  seq: number;
};

export type DaemonWorkspaceState = {
  /** Document summaries in daemon tree order. Empty until the first seed. */
  documents: DaemonDocumentSummary[];
  activeDocumentId: string | null;
  /** WS connection status. "connecting" until the first open. */
  connection: "connecting" | "open" | "closed";
  /** Bumps whenever a session.changed carries rebuilt child ids — child
   * surfaces subscribe to this to live-refresh their charts (step C). */
  lastSessionChange: {
    docId: string | null;
    changeReason: string;
    rebuiltChildIds: string[];
    /** False when this tick exists only to repaint chart presentation. Retained
     * list/table data must not treat it as a semantic mutation. */
    listDataChanged: boolean;
    /** Monotonic counter so identical successive events still trigger. */
    seq: number;
  } | null;
  /** Latest daemon options event. ThemeProvider uses this to update root CSS
   * variables once per style identity, without polling. */
  lastOptionsChange: DaemonWorkspaceOptionsChange | null;
  /** Latest options transaction that can change retained row/query semantics.
   * Presentation-only options never publish into this slice, so resident lists
   * are not notified merely to discover that no data work is required. */
  lastRetainedDataOptionsChange: DaemonWorkspaceOptionsChange | null;
  /** Latest semantic options transaction relevant to Aspect List. */
  lastAspectListOptionsChange: DaemonWorkspaceOptionsChange | null;
  /** Daemon-owned display facets applied to retained source rows in memory. */
  retainedListDisplay: RetainedListDisplay;
  /** The snapshot a navigate POST returned for a stepped doc, pushed by the
   * navigate handler so the active surface paints from the POST result (in
   * ``step_fast`` overlay mode) instead of waiting for session.changed -> a
   * second snapshot GET. Both useActiveDocumentChart instances (wheel + status
   * bar) subscribe to this so they stay coherent. */
  steppedSnapshot: {
    docId: string;
    snapshot: ChartRenderSnapshot;
    seq: number;
  } | null;
  /** Snapshot returned by an open/activate/toggle command. This is separate
   * from steppedSnapshot so normal chart opens do not ride the time-step path. */
  commandSnapshot: {
    docId: string;
    snapshot: ChartRenderSnapshot;
    seq: number;
  } | null;

  // Internal mirror mutations (only called by the subscription manager).
  _applyState: (documents: DaemonDocumentSummary[], activeDocumentId: string | null) => void;
  _applyOpenedDocument: (payload: {
    documents: DaemonDocumentSummary[];
    documentId: string | null;
    activeDocumentId: string | null;
  }) => void;
  _applyTree: (documents: DaemonDocumentSummary[]) => void;
  _applyDocumentPatch: (patch: {
    docId: string;
    title?: string;
    dirty?: boolean;
    editDirty?: boolean;
    stepDirty?: boolean;
  }) => void;
  _applyActive: (activeDocumentId: string | null) => void;
  _applySessionChange: (change: {
    docId: string | null;
    changeReason: string;
    rebuiltChildIds: string[];
    listDataChanged?: boolean;
    displayDatetime?: string | null;
    tabSuffix?: string | null;
  }) => void;
  _applyOptionsChange: (change: {
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
    schemaVersion: number;
    themeVersion: number;
    styleRevision: number;
    paletteHash: string;
    styleHash: string;
  }) => void;
  _applyRetainedListDisplay: (display: RetainedListDisplay) => void;
  /** Push a navigate-POST snapshot for an immediate step paint (no second GET). */
  pushSteppedSnapshot: (docId: string, snapshot: ChartRenderSnapshot) => void;
  /** Push a command-return snapshot for an immediate open/activate paint. */
  pushCommandSnapshot: (docId: string, snapshot: ChartRenderSnapshot) => void;
  _setConnection: (connection: "connecting" | "open" | "closed") => void;
};

function sameDocumentSummary(a: DaemonDocumentSummary, b: DaemonDocumentSummary): boolean {
  if (a === b) return true;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

function mergeDocumentSummaries(
  current: DaemonDocumentSummary[],
  incoming: DaemonDocumentSummary[],
): DaemonDocumentSummary[] {
  if (current.length === 0) return incoming;
  const currentById = new Map(current.map((doc) => [doc.documentId, doc]));
  let changed = current.length !== incoming.length;
  const next = incoming.map((doc) => {
    const existing = currentById.get(doc.documentId);
    if (existing && sameDocumentSummary(existing, doc)) return existing;
    changed = true;
    return doc;
  });
  if (!changed) return current;
  return next;
}

function sameRetainedListDisplay(
  left: RetainedListDisplay,
  right: RetainedListDisplay,
): boolean {
  const current = left.hiddenObjectIds;
  const next = right.hiddenObjectIds;
  return (
    current.length === next.length &&
    current.every((objectId, index) => objectId === next[index])
  );
}

function isRetainedListDisplay(value: unknown): value is RetainedListDisplay {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as Partial<RetainedListDisplay>).hiddenObjectIds)
  );
}

export const useDaemonWorkspaceStore = create<DaemonWorkspaceState>()((set) => ({
  documents: [],
  activeDocumentId: null,
  connection: "connecting",
  lastSessionChange: null,
  lastOptionsChange: null,
  lastRetainedDataOptionsChange: null,
  lastAspectListOptionsChange: null,
  retainedListDisplay: { hiddenObjectIds: [] },
  steppedSnapshot: null,
  commandSnapshot: null,

  _applyState: (documents, activeDocumentId) => {
    retainDocumentSnapshots(documents.map((doc) => doc.documentId));
    set({ documents, activeDocumentId });
  },
  _applyOpenedDocument: ({ documents, documentId, activeDocumentId }) => {
    const targetId = documentId ?? activeDocumentId;
    const opened = documents.find((doc) => doc.documentId === targetId);
    if (!opened) {
      retainDocumentSnapshots(documents.map((doc) => doc.documentId));
      set({ documents, activeDocumentId });
      return;
    }
    set((state) => {
      if (state.documents.length === 0) {
        retainDocumentSnapshots(documents.map((doc) => doc.documentId));
        return { documents, activeDocumentId };
      }
      const nextActiveId = activeDocumentId ?? opened.documentId;
      const existingIndex = state.documents.findIndex((doc) => doc.documentId === opened.documentId);
      let inserted = existingIndex !== -1;
      const nextDocuments = state.documents.map((doc) => {
        if (doc.documentId === opened.documentId) {
          return { ...opened, isActive: doc.documentId === nextActiveId };
        }
        const shouldBeActive = doc.documentId === nextActiveId;
        return doc.isActive === shouldBeActive ? doc : { ...doc, isActive: shouldBeActive };
      });
      if (!inserted) {
        const fullIndex = documents.findIndex((doc) => doc.documentId === opened.documentId);
        let insertAt = nextDocuments.length;
        for (let index = fullIndex - 1; index >= 0; index -= 1) {
          const previousId = documents[index]?.documentId;
          const previousIndex = nextDocuments.findIndex((doc) => doc.documentId === previousId);
          if (previousIndex !== -1) {
            insertAt = previousIndex + 1;
            break;
          }
        }
        nextDocuments.splice(insertAt, 0, { ...opened, isActive: opened.documentId === nextActiveId });
        inserted = true;
      }
      retainDocumentSnapshots(nextDocuments.map((doc) => doc.documentId));
      return { documents: nextDocuments, activeDocumentId: nextActiveId };
    });
  },
  _applyTree: (documents) => {
    set((state) => {
      const nextDocuments = mergeDocumentSummaries(state.documents, documents);
      retainDocumentSnapshots(nextDocuments.map((doc) => doc.documentId));
      // The tree payload carries each doc's own isActive flag; trust it to keep
      // activeDocumentId coherent even if an active_document.changed was missed.
      const active = nextDocuments.find((d) => d.isActive)?.documentId ?? state.activeDocumentId;
      const stillExists = active != null && nextDocuments.some((d) => d.documentId === active);
      const activeDocumentId = stillExists ? active : (nextDocuments[0]?.documentId ?? null);
      if (nextDocuments === state.documents && activeDocumentId === state.activeDocumentId) {
        return state;
      }
      return { documents: nextDocuments, activeDocumentId };
    });
  },
  _applyDocumentPatch: (patch) =>
    set((state) => ({
      documents: state.documents.map((doc) => {
        if (doc.documentId !== patch.docId) return doc;
        const next = {
          ...doc,
          title: patch.title === undefined ? doc.title : patch.title,
          dirty: patch.dirty === undefined ? doc.dirty : patch.dirty,
          editDirty: patch.editDirty === undefined ? doc.editDirty : patch.editDirty,
          stepDirty: patch.stepDirty === undefined ? doc.stepDirty : patch.stepDirty,
        };
        return (
          next.title === doc.title &&
          next.dirty === doc.dirty &&
          next.editDirty === doc.editDirty &&
          next.stepDirty === doc.stepDirty
        )
          ? doc
          : next;
      }),
    })),
  _applyActive: (activeDocumentId) =>
    set((state) => ({
      activeDocumentId,
      documents: state.documents.map((d) => {
        const isActive = d.documentId === activeDocumentId;
        return d.isActive === isActive ? d : { ...d, isActive };
      }),
    })),
  _applySessionChange: (change) =>
    set((state) => {
      const pureSelfStep =
        change.changeReason === "step" && change.rebuiltChildIds.length === 0;
      return {
        // A pure chart self-step already paints from the navigate POST snapshot.
        // Do not rewrite the daemon document mirror just to carry the moving
        // datetime; that wakes sidebar/menu/native chrome on every arrow repeat.
        documents:
          pureSelfStep || change.docId == null
            ? state.documents
            : state.documents.map((doc) =>
                doc.documentId === change.docId
                  ? {
                      ...doc,
                      displayDatetime:
                        change.displayDatetime === undefined
                          ? doc.displayDatetime
                          : change.displayDatetime,
                      tabSuffix:
                        change.tabSuffix === undefined ? doc.tabSuffix : change.tabSuffix,
                    }
                  : doc,
              ),
        lastSessionChange: {
          docId: change.docId,
          changeReason: change.changeReason,
          rebuiltChildIds: change.rebuiltChildIds,
          listDataChanged: change.listDataChanged !== false,
          seq: (state.lastSessionChange?.seq ?? 0) + 1,
        },
      };
    }),
  _applyOptionsChange: (change) =>
    set((state) => {
      const touched = new Set(change.refreshedDocumentIds);
      const touches = (docId: string | undefined) => docId !== undefined && touched.has(docId);
      const styleOnly = change.styleOnly === true;
      const listDataChanged = change.listDataChanged !== false;
      const shouldDiscardDirectSnapshot = (docId: string | undefined) =>
        !styleOnly &&
        touches(docId) &&
        docId !== state.activeDocumentId;
      const optionsChange = {
        ...change,
        refreshMode: change.refreshMode || "recalc",
        styleOnly,
        listDataChanged,
        retainedListTarget: change.retainedListTarget ?? null,
        ephemerisDataKey: change.ephemerisDataKey,
        inspectorDataChanged: change.inspectorDataChanged === true,
        seq: (state.lastOptionsChange?.seq ?? 0) + 1,
      };
      return {
        lastOptionsChange: optionsChange,
        lastRetainedDataOptionsChange: listDataChanged && !change.retainedListTarget
          ? optionsChange
          : state.lastRetainedDataOptionsChange,
        lastAspectListOptionsChange:
          listDataChanged &&
          (!change.retainedListTarget || change.retainedListTarget === "aspect-list")
            ? optionsChange
            : state.lastAspectListOptionsChange,
        retainedListDisplay:
          isRetainedListDisplay(change.retainedListDisplay) &&
          !sameRetainedListDisplay(state.retainedListDisplay, change.retainedListDisplay)
            ? change.retainedListDisplay
            : state.retainedListDisplay,
        // Cache invalidation and presented-frame lifetime are separate. Keep
        // the active chart's exact stepped/command frame visible until the
        // canonical options refresh publishes its replacement atomically.
        // Clearing it here exposed the hook's pre-step local snapshot for one
        // paint, so H made the whole wheel jump back to its initial cursor.
        steppedSnapshot: shouldDiscardDirectSnapshot(state.steppedSnapshot?.docId)
          ? null
          : state.steppedSnapshot,
        commandSnapshot: shouldDiscardDirectSnapshot(state.commandSnapshot?.docId)
          ? null
          : state.commandSnapshot,
      };
    }),
  _applyRetainedListDisplay: (display) =>
    set((state) => {
      if (!isRetainedListDisplay(display)) return state;
      if (sameRetainedListDisplay(state.retainedListDisplay, display)) return state;
      return { retainedListDisplay: display };
    }),
  pushSteppedSnapshot: (docId, snapshot) => {
    // Normalize the partial overlay before publishing. React renders this exact
    // object directly, so remembering it in a later effect would expose the raw
    // step_fast payload for one frame and make the corner overlay strobe.
    const normalizedSnapshot = rememberDocumentSnapshot(docId, snapshot);
    set((state) => ({
      steppedSnapshot: {
        docId,
        snapshot: normalizedSnapshot,
        seq: (state.steppedSnapshot?.seq ?? 0) + 1,
      },
    }));
  },
  pushCommandSnapshot: (docId, snapshot) => {
    const normalizedSnapshot = rememberDocumentSnapshot(docId, snapshot);
    set((state) => ({
      // A later explicit command snapshot supersedes any retained step frame
      // for the same chart. This keeps the direct-paint channels ordered.
      steppedSnapshot:
        state.steppedSnapshot?.docId === docId ? null : state.steppedSnapshot,
      commandSnapshot: {
        docId,
        snapshot: normalizedSnapshot,
        seq: (state.commandSnapshot?.seq ?? 0) + 1,
      },
    }));
  },
  _setConnection: (connection) => set({ connection }),
}));

// ---------------------------------------------------------------------------
// Subscription manager — singleton. Syncs the mirror on connect and keeps it in
// sync. Reference-counted so multiple mounts share one socket; the React hook
// below drives ref counts.
// ---------------------------------------------------------------------------

let subscription: WorkspaceEventSubscription | null = null;
let refCount = 0;
type SyncReason = "initial" | "socket-open" | "daemon-ready" | "stale-document";

let syncing: { controller: AbortController; reason: SyncReason } | null = null;
let syncInFlight: Promise<void> | null = null;
let syncGeneration = 0;
let deferredTree: DaemonDocumentSummary[] | null = null;
let deferredActive: string | null | undefined;
let deferredWorkspaceEventFlushScheduled = false;

function scheduleDeferredWorkspaceEventFlush(): void {
  if (deferredWorkspaceEventFlushScheduled) return;
  deferredWorkspaceEventFlushScheduled = true;
  void waitForWorkspaceSnapshotCommands().then(() => {
    deferredWorkspaceEventFlushScheduled = false;
    const store = useDaemonWorkspaceStore.getState();
    const tree = deferredTree;
    const active = deferredActive;
    deferredTree = null;
    deferredActive = undefined;
    if (tree) {
      store._applyTree(tree);
    }
    if (active !== undefined) {
      store._applyActive(active);
    }
  });
}

function handleEvent(event: DaemonEvent): void {
  const store = useDaemonWorkspaceStore.getState();
  switch (event.type) {
    case "daemon.ready":
      recordStartupPerfOnce("daemon-ws-ready-event");
      // The socket (re)connected — resync to recover any missed deltas.
      void syncState("daemon-ready");
      break;
    case "documents.changed":
      if (hasPendingWorkspaceSnapshotCommand()) {
        deferredTree = event.tree;
        scheduleDeferredWorkspaceEventFlush();
        break;
      }
      store._applyTree(event.tree);
      break;
    case "document.changed":
      store._applyDocumentPatch({
        docId: event.docId,
        title: event.title,
        dirty: event.dirty,
        editDirty: event.editDirty,
        stepDirty: event.stepDirty,
      });
      break;
    case "active_document.changed":
      if (hasPendingWorkspaceSnapshotCommand()) {
        deferredActive = event.docId;
        scheduleDeferredWorkspaceEventFlush();
        break;
      }
      store._applyActive(event.docId);
      break;
    case "session.changed":
      if (event.changeReason === "step" && (event.rebuiltChildIds?.length ?? 0) === 0) {
        recordChartPerf("chart-step-session-change", {
          docId: event.docId,
          displayDatetime: event.displayDatetime ?? null,
        });
      }
      store._applySessionChange({
        docId: event.docId,
        changeReason: event.changeReason,
        rebuiltChildIds: event.rebuiltChildIds ?? [],
        listDataChanged: event.listDataChanged,
        displayDatetime: event.displayDatetime,
        tabSuffix: event.tabSuffix,
      });
      break;
    case "options.changed":
      {
        const refreshedIds = event.refreshedDocumentIds ?? [];
        const refreshMode = event.refreshMode || "recalc";
        const styleOnly = event.styleOnly === true;
        const listDataChanged = event.listDataChanged !== false;
        const inspectorDataChanged = event.inspectorDataChanged === true;
        const styleIdentity = normalizeOptionsStyleIdentity(event);
        // Empty historically meant "broadcast-only, assume every chart". A
        // targeted PD projection refresh is different: with no open PD chart,
        // empty means exactly no document changed and must not invalidate the
        // retained Directions list or synthesize a session change for it.
        const targetedEmptyRefresh =
          refreshMode === "pd-in-chart" ||
          refreshMode === "retained-data" ||
          refreshMode === "inspector-data";
        const touchedIds =
          refreshedIds.length > 0 || targetedEmptyRefresh
            ? refreshedIds
            : store.documents.map((doc) => doc.documentId);
        if (!styleOnly) invalidateDocumentSnapshots(touchedIds);
        store._applyOptionsChange({
          refreshedDocumentIds: touchedIds,
          refreshMode,
          styleOnly,
          listDataChanged,
          retainedListTarget: event.retainedListTarget,
          retainedListDataKey: event.retainedListDataKey,
          ephemerisDataKey: event.ephemerisDataKey,
          retainedListDisplay: event.retainedListDisplay,
          inspectorDataChanged,
          langid: event.langid,
          ...styleIdentity,
        });
        // A semantic settings change re-rendered every open chart. Profile-only
        // events update root CSS and resident renderer styles; synthesizing a
        // session tick for them would defeat the paint-only contract and force
        // snapshots/data geometry to refetch. For real option changes, bump the
        // active-doc tick only when that document is actually in the touched set.
        if (!styleOnly && touchedIds.length > 0) {
          const activeTouched =
            store.activeDocumentId != null && touchedIds.includes(store.activeDocumentId);
          store._applySessionChange({
            docId: activeTouched ? store.activeDocumentId : null,
            changeReason: refreshMode === "display-overlay" ? "display-overlay" : "options",
            rebuiltChildIds: touchedIds,
            // lastOptionsChange is the one retained-data authority for this
            // transaction. This companion tick only wakes chart/session
            // consumers and must not launch a duplicate list request.
            listDataChanged: false,
          });
        }
      }
      break;
    default:
      break;
  }
}

function shouldReplaceSync(nextReason: SyncReason): boolean {
  return syncing?.reason === "initial" && nextReason !== "initial";
}

async function syncState(reason: SyncReason): Promise<void> {
  if (syncInFlight) {
    if (!shouldReplaceSync(reason)) return syncInFlight;
    syncing?.controller.abort();
    syncing = null;
    syncInFlight = null;
  }

  const controller = new AbortController();
  syncing = { controller, reason };
  const generation = ++syncGeneration;
  const startedAt = perfNow();
  recordStartupPerfOnce("workspace-state-request-start");
  const run = (async () => {
    try {
      await waitForDaemonHealth(controller.signal);
      recordStartupPerfOnce("workspace-daemon-health-ready", {
        source: "workspace-state",
        ms: Math.round(perfNow() - startedAt),
      });
      const payload = await workspaceState(controller.signal);
      if (controller.signal.aborted) return;
      recordStartupPerfOnce("workspace-state-ready", {
        ms: Math.round(perfNow() - startedAt),
        documents: payload.documents.length,
        activeDocumentId: payload.activeDocumentId,
      });
      useDaemonWorkspaceStore.getState()._applyState(payload.documents, payload.activeDocumentId);
      recordStartupPerfOnce("workspace-state-applied", {
        documents: payload.documents.length,
        activeDocumentId: payload.activeDocumentId,
      });
      if (!payload.activeDocumentId) {
        recordStartupPerfOnce("workspace-empty-ready", {
          documents: payload.documents.length,
        });
      }
    } catch (err) {
      if (isAbortError(err, controller.signal)) return;
      if (useDaemonWorkspaceStore.getState().connection === "open") {
        console.error("[workspace-seed]", err);
      }
    } finally {
      if (syncing?.controller === controller) syncing = null;
      if (syncGeneration === generation) syncInFlight = null;
    }
  })();
  syncInFlight = run;
  return run;
}

/** Reconcile a stale client document id after a daemon restart or restore race. */
export function reconcileDaemonWorkspace(): Promise<void> {
  return syncState("stale-document");
}

/** Start (or join) the singleton daemon subscription. Returns a release fn. */
export function acquireDaemonWorkspace(): () => void {
  refCount += 1;
  if (refCount === 1) {
    void syncState("initial");
    subscription = subscribeWorkspaceEvents({
      onEvent: handleEvent,
      onStatus: (status) => {
        useDaemonWorkspaceStore.getState()._setConnection(status);
        if (status === "open") {
          recordStartupPerfOnce("workspace-ws-open");
          // Resync on every (re)open to recover missed events.
          void syncState("socket-open");
        }
      },
    });
  }
  return () => {
    refCount -= 1;
    if (refCount <= 0) {
      refCount = 0;
      subscription?.close();
      subscription = null;
      syncing?.controller.abort();
      syncing = null;
      syncInFlight = null;
    }
  };
}
