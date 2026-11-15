// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import { create } from "zustand";
import { useChartEventsStore } from "./chart-events-store";

import {
  subscribeWorkspaceEvents,
  waitForDaemonHealth,
  workspaceState,
  type DaemonDocumentSummary,
  type DaemonEvent,
  type ListDataDomain,
  type RetainedListDisplay,
  type WorkspaceEventSubscription,
} from "@/lib/daemon/client";
import { isAbortError } from "@/lib/abort-error";
import { perfNow, recordChartPerf, recordStartupPerfOnce } from "@/lib/chart/perf";
import { isSettledStepEcho, isStepBurstActive, subscribeStepBurst } from "@/lib/chart/step-burst";
import type { ChartRenderSnapshot } from "@/lib/chart/types";
import { normalizeOptionsStyleIdentity } from "@/lib/theme/style-state.mjs";
import {
  hasPendingWorkspaceDocumentSnapshotCommand,
  hasPendingWorkspaceSnapshotCommand,
  waitForWorkspaceSnapshotCommands,
} from "@/stores/workspace-command-snapshot-gate";
import {
  getDocumentSnapshot,
  retainedHouseVisibility,
  setRetainedHouseVisibility,
  invalidateDocumentSnapshots,
  rememberDocumentSnapshot,
  retainDocumentSnapshots,
} from "@/lib/chart/document-snapshot-cache";

import { snapshotHouseVisibility, withHouseVisibility } from "@/lib/chart/house-visibility";
import { publishStyleDraftChange } from "@/lib/style-lab/draft-events";

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
  retainedListTarget?: "aspect-list" | "speculum" | null;
  /** The one chart input this change alters, when the daemon knows it. */
  listDataDomain?: ListDataDomain | null;
  retainedListDataKey?: string;
  /** Content key of the options the secondary progression list reads. */
  secondaryProgressionsDataKey?: string;
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
  wheelPresetRevision?: number;
  paletteHash: string;
  styleHash: string;
  /** `patchOptions` origin of the write that caused this event, if any. */
  origin?: string;
  seq: number;
};

export type DaemonWorkspaceState = {
  /** Document summaries in daemon tree order. Empty until the first seed. */
  documents: DaemonDocumentSummary[];
  activeDocumentId: string | null;
  /** WS connection status. "connecting" until the first open. */
  connection: "connecting" | "open" | "closed";
  /** Bumps when a radix branch's primary-direction time moves
   * (`pd_branch.changed`); the directed speculum reads that time. */
  pdBranchRevision: number;
  /** Bumps whenever a session.changed carries rebuilt child ids — child
   * surfaces subscribe to this to live-refresh their charts (step C). */
  lastSessionChange: {
    docId: string | null;
    changeReason: string;
    rebuiltChildIds: string[];
    /** False when this tick exists only to repaint chart presentation. Retained
     * list/table data must not treat it as a semantic mutation. */
    listDataChanged: boolean;
    /** Echo of this document's own snapshot command, applied after that command
     * published its snapshot; the active chart must not refetch for it. */
    commandEcho: boolean;
    /** Late daemon echo of a completed step burst's final cursor. Surfaces
     * already refreshed on the burst's completion edge (lib/chart/step-burst). */
    stepEcho: boolean;
    /** Monotonic counter so identical successive events still trigger. */
    seq: number;
  } | null;
  /** Per-document seq of the latest session change that altered retained list
   * data. Unlike lastSessionChange it survives while no list is mounted, so a
   * remounted list keys its cache on the document's current data identity. */
  listDataRevisionByDocument: Record<string, number>;
  /** As `listDataRevisionByDocument`, plus steps that replaced the radix
   * itself (`listDataChanged: true`), for lists whose rows read the radix. A
   * step burst changes it once, on the burst's completion edge, never per step. */
  radixListDataRevisionByDocument: Record<string, number>;
  /** Fold the radix steps held during a burst into one revision (completion edge). */
  _settleRadixStepRevisions: () => void;
  /** Latest daemon options event. ThemeProvider uses this to update root CSS
   * variables once per style identity, without polling. */
  lastOptionsChange: DaemonWorkspaceOptionsChange | null;
  /** Latest options transaction that can change retained row/query semantics.
   * Presentation-only options never publish into this slice, so resident lists
   * are not notified merely to discover that no data work is required. */
  lastRetainedDataOptionsChange: DaemonWorkspaceOptionsChange | null;
  /** Latest semantic options transaction relevant to Aspect List. */
  lastAspectListOptionsChange: DaemonWorkspaceOptionsChange | null;
  /** Latest semantic options transaction relevant to the Speculum table. */
  lastSpeculumOptionsChange: DaemonWorkspaceOptionsChange | null;
  /** Retained-data changes for lists that never read houses or cusps: a
   * house-system switch leaves it untouched. */
  lastHouseFreeListOptionsChange: DaemonWorkspaceOptionsChange | null;
  /** Daemon-owned display facets applied to retained source rows in memory. */
  retainedListDisplay: RetainedListDisplay;
  /** Latest options part of the secondary progression list's data key, from
   * the options payload and every options event; null until first known. */
  secondaryProgressionsDataKey: string | null;
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

  pendingHouseToggles: number;
  confirmedHouseVisibility: boolean | null;
  houseVisibilityRevision: number;
  previewHouseToggle: (snapshot: ChartRenderSnapshot) => void;
  finishHouseToggle: (result?: { houses: boolean; wheelPresetRevision: number }) => void;
  _confirmHouseVisibility: (value: boolean, revision: number) => void;
  _paintHouseVisibility: (value: boolean, source?: ChartRenderSnapshot) => void;

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
    commandEcho?: boolean;
  }) => void;
  _applyOptionsChange: (change: {
    refreshedDocumentIds: string[];
    refreshMode?: string | null;
    styleOnly?: boolean;
    listDataChanged?: boolean;
    retainedListTarget?: "aspect-list" | "speculum" | null;
    listDataDomain?: ListDataDomain | null;
    retainedListDataKey?: string;
    secondaryProgressionsDataKey?: string;
    ephemerisDataKey?: string;
    retainedListDisplay?: RetainedListDisplay;
    inspectorDataChanged?: boolean;
    langid?: number;
    schemaVersion: number;
    themeVersion: number;
    styleRevision: number;
    wheelPresetRevision?: number;
    paletteHash: string;
    styleHash: string;
    origin?: string;
  }) => void;
  _applyRetainedListDisplay: (display: RetainedListDisplay) => void;
  _applySecondaryProgressionsDataKey: (key: string | null | undefined) => void;
  /** Push a navigate-POST snapshot for an immediate step paint (no second GET). */
  pushSteppedSnapshot: (docId: string, snapshot: ChartRenderSnapshot) => void;
  /** Commit the daemon's map-child cursor once its held-key burst has closed. */
  commitMapStepCursor: (docId: string, displayDatetime: string | null, tabSuffix: string | null) => void;
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
    left.directionGlyphColors === right.directionGlyphColors &&
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

/** Session ticks that change retained list rows: not presentation-only ticks,
 * display overlays, or cursor steps (lists follow the cursor by focus). */
function sessionChangeAltersListData(change: {
  changeReason: string;
  listDataChanged?: boolean;
}): boolean {
  return change.listDataChanged !== false
    && change.changeReason !== "display-overlay"
    && change.changeReason !== "step";
}

/** A step the daemon flags `listDataChanged: true` replaced the radix itself
 * (a stepped saved chart); ordinary cursor and derived-chart steps carry no flag. */
function sessionChangeReplacesRadix(change: { changeReason: string; listDataChanged?: boolean }): boolean {
  return change.changeReason === "step" && change.listDataChanged === true;
}

type SessionChangeIds = { docId: string | null; rebuiltChildIds: string[] };

function sessionChangeIds(change: SessionChangeIds): string[] {
  return change.docId == null ? change.rebuiltChildIds : [change.docId, ...change.rebuiltChildIds];
}

function withRevisions(revisions: Record<string, number>, ids: readonly string[], seq: number): Record<string, number> {
  if (ids.length === 0) return revisions;
  const next = { ...revisions };
  for (const id of ids) next[id] = seq;
  return next;
}

function listDataRevisionsAfterSessionChange(
  revisions: Record<string, number>,
  change: SessionChangeIds & { changeReason: string; listDataChanged?: boolean },
  seq: number,
): Record<string, number> {
  if (!sessionChangeAltersListData(change)) return revisions;
  return withRevisions(revisions, sessionChangeIds(change), seq);
}

// Radix steps held while a step burst runs, folded in on its completion edge,
// and the documents that edge settled: the daemon's trailing echo of the
// burst's final step then carries nothing new.
let heldRadixStepRevisions: Record<string, number> = {};
let settledRadixStepDocuments = new Set<string>();

function radixListDataRevisionsAfterSessionChange(
  revisions: Record<string, number>,
  change: SessionChangeIds & { changeReason: string; listDataChanged?: boolean; displayDatetime?: string | null },
  seq: number,
): Record<string, number> {
  const ids = sessionChangeIds(change);
  if (sessionChangeAltersListData(change)) {
    for (const id of ids) settledRadixStepDocuments.delete(id);
    return withRevisions(revisions, ids, seq);
  }
  if (!sessionChangeReplacesRadix(change)) return revisions;
  if (isStepBurstActive()) {
    for (const id of ids) heldRadixStepRevisions[id] = seq;
    return revisions;
  }
  if (
    isSettledStepEcho(change.docId, change.displayDatetime) &&
    ids.every((id) => settledRadixStepDocuments.has(id))
  ) {
    for (const id of ids) settledRadixStepDocuments.delete(id);
    return revisions;
  }
  return withRevisions(revisions, ids, seq);
}

export const useDaemonWorkspaceStore = create<DaemonWorkspaceState>()((set, get) => ({
  documents: [],
  activeDocumentId: null,
  connection: "connecting",
  lastSessionChange: null,
  pdBranchRevision: 0,
  listDataRevisionByDocument: {},
  radixListDataRevisionByDocument: {},
  _settleRadixStepRevisions: () => {
    const held = heldRadixStepRevisions;
    const ids = Object.keys(held);
    if (ids.length === 0) return;
    heldRadixStepRevisions = {};
    settledRadixStepDocuments = new Set(ids);
    set((state) => ({
      radixListDataRevisionByDocument: { ...state.radixListDataRevisionByDocument, ...held },
    }));
  },
  lastOptionsChange: null,
  pendingHouseToggles: 0,
  confirmedHouseVisibility: null,
  houseVisibilityRevision: -1,
  _paintHouseVisibility: (value, source) => {
    setRetainedHouseVisibility(value);
    set((state) => {
      const update = (entry: typeof state.commandSnapshot) => {
        if (!entry) return entry;
        const snapshot = withHouseVisibility(entry.snapshot, value);
        return snapshot === entry.snapshot ? entry : { ...entry, snapshot, seq: entry.seq + 1 };
      };
      const steppedSnapshot = update(state.steppedSnapshot);
      let commandSnapshot = update(state.commandSnapshot);
      if (steppedSnapshot?.docId !== state.activeDocumentId && commandSnapshot?.docId !== state.activeDocumentId && state.activeDocumentId) {
        const snapshot = source ?? getDocumentSnapshot(state.activeDocumentId);
        if (snapshot) commandSnapshot = {
          docId: state.activeDocumentId, snapshot: withHouseVisibility(snapshot, value), seq: 1,
        };
      }
      return { steppedSnapshot, commandSnapshot };
    });
  },
  previewHouseToggle: (snapshot) => {
    const initial = snapshotHouseVisibility(snapshot);
    const value = !(retainedHouseVisibility() ?? initial);
    set((state) => ({
      pendingHouseToggles: state.pendingHouseToggles + 1,
      confirmedHouseVisibility: state.confirmedHouseVisibility ?? initial,
    }));
    get()._paintHouseVisibility(value, snapshot);
  },
  _confirmHouseVisibility: (value, revision) => {
    const state = get();
    if (revision < state.houseVisibilityRevision) return;
    set({ confirmedHouseVisibility: value, houseVisibilityRevision: revision });
    if (state.pendingHouseToggles === 0) get()._paintHouseVisibility(value);
  },
  finishHouseToggle: (result) => {
    if (result) get()._confirmHouseVisibility(result.houses, result.wheelPresetRevision);
    set((state) => ({ pendingHouseToggles: Math.max(0, state.pendingHouseToggles - 1) }));
    const state = get();
    if (state.pendingHouseToggles === 0 && state.confirmedHouseVisibility !== null) {
      state._paintHouseVisibility(state.confirmedHouseVisibility);
    }
  },
  lastRetainedDataOptionsChange: null,
  lastAspectListOptionsChange: null,
  lastSpeculumOptionsChange: null,
  lastHouseFreeListOptionsChange: null,
  retainedListDisplay: { hiddenObjectIds: [] },
  secondaryProgressionsDataKey: null,
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
      const seq = (state.lastSessionChange?.seq ?? 0) + 1;
      return {
        listDataRevisionByDocument: listDataRevisionsAfterSessionChange(
          state.listDataRevisionByDocument,
          change,
          seq,
        ),
        radixListDataRevisionByDocument: radixListDataRevisionsAfterSessionChange(
          state.radixListDataRevisionByDocument,
          change,
          seq,
        ),
        // A pure chart self-step already paints from the navigate POST snapshot.
        // Do not rewrite the daemon document mirror just to carry the moving
        // datetime; that wakes sidebar/menu/native chrome on every arrow repeat.
        // A presentation-only tick carries neither field; keep the mirror's
        // identity so sidebar and chrome do not re-render for it.
        documents:
          pureSelfStep || change.docId == null
            || !state.documents.some((doc) => doc.documentId === change.docId
              && ((change.displayDatetime !== undefined && change.displayDatetime !== doc.displayDatetime)
                || (change.tabSuffix !== undefined && change.tabSuffix !== doc.tabSuffix)))
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
          commandEcho: change.commandEcho === true,
          stepEcho: change.changeReason === "step"
            && isSettledStepEcho(change.docId, change.displayDatetime),
          seq,
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
        listDataDomain: change.listDataDomain ?? null,
        ephemerisDataKey: change.ephemerisDataKey,
        inspectorDataChanged: change.inspectorDataChanged === true,
        seq: (state.lastOptionsChange?.seq ?? 0) + 1,
      };
      return {
        lastOptionsChange: optionsChange,
        // Style edits repaint retained rows; they never become a data revision.
        lastRetainedDataOptionsChange: listDataChanged && !styleOnly && !change.retainedListTarget
          ? optionsChange
          : state.lastRetainedDataOptionsChange,
        lastHouseFreeListOptionsChange:
          listDataChanged && !styleOnly && !change.retainedListTarget && change.listDataDomain !== "houses"
            ? optionsChange
            : state.lastHouseFreeListOptionsChange,
        lastAspectListOptionsChange:
          listDataChanged &&
          (!change.retainedListTarget || change.retainedListTarget === "aspect-list")
            ? optionsChange
            : state.lastAspectListOptionsChange,
        lastSpeculumOptionsChange:
          listDataChanged &&
          (!change.retainedListTarget || change.retainedListTarget === "speculum")
            ? optionsChange
            : state.lastSpeculumOptionsChange,
        secondaryProgressionsDataKey:
          typeof change.secondaryProgressionsDataKey === "string"
            ? change.secondaryProgressionsDataKey
            : state.secondaryProgressionsDataKey,
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
  _applySecondaryProgressionsDataKey: (key) =>
    set((state) =>
      typeof key === "string" && key !== state.secondaryProgressionsDataKey
        ? { secondaryProgressionsDataKey: key }
        : state),
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
  commitMapStepCursor: (docId, displayDatetime, tabSuffix) => {
    invalidateDocumentSnapshots([docId]);
    set((state) => {
      if (!state.documents.some((doc) => doc.documentId === docId)) return state;
      return {
        documents: state.documents.map((doc) => doc.documentId === docId
          ? { ...doc, displayDatetime, tabSuffix }
          : doc),
        steppedSnapshot: state.steppedSnapshot?.docId === docId ? null : state.steppedSnapshot,
        commandSnapshot: state.commandSnapshot?.docId === docId ? null : state.commandSnapshot,
      };
    });
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
// One radix-list revision per step burst, on its completion edge.
subscribeStepBurst(() => {
  if (!isStepBurstActive()) useDaemonWorkspaceStore.getState()._settleRadixStepRevisions();
});

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
let deferredSessionEchoes: Parameters<DaemonWorkspaceState["_applySessionChange"]>[0][] = [];
let deferredWorkspaceEventFlushScheduled = false;

function scheduleDeferredWorkspaceEventFlush(): void {
  if (deferredWorkspaceEventFlushScheduled) return;
  deferredWorkspaceEventFlushScheduled = true;
  void waitForWorkspaceSnapshotCommands().then(() => {
    deferredWorkspaceEventFlushScheduled = false;
    const store = useDaemonWorkspaceStore.getState();
    const tree = deferredTree;
    const active = deferredActive;
    const echoes = deferredSessionEchoes;
    deferredTree = null;
    deferredActive = undefined;
    deferredSessionEchoes = [];
    if (tree) {
      store._applyTree(tree);
    }
    if (active !== undefined) {
      store._applyActive(active);
    }
    for (const echo of echoes) store._applySessionChange(echo);
  });
}

function handleEvent(event: DaemonEvent): void {
  const store = useDaemonWorkspaceStore.getState();
  switch (event.type) {
    case "chart.event-tags.changed":
      useChartEventsStore.getState().applyTagCatalog(event.tagCatalog, event.catalogVersion);
      break;
    case "style.draft.changed":
      publishStyleDraftChange({ draftId: event.draftId ?? null, revision: event.revision ?? null });
      break;
    case "chart.events.changed":
      useChartEventsStore.getState().invalidate(event.documentIds);
      break;
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
    case "pd_branch.changed":
      // A radix branch's PD time moved: followers re-derived in the daemon.
      invalidateDocumentSnapshots(event.pdChartIds);
      useDaemonWorkspaceStore.setState((state) => ({ pdBranchRevision: state.pdBranchRevision + 1 }));
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
      {
        const change = {
          docId: event.docId,
          changeReason: event.changeReason,
          rebuiltChildIds: event.rebuiltChildIds ?? [],
          listDataChanged: event.listDataChanged,
          displayDatetime: event.displayDatetime,
          tabSuffix: event.tabSuffix,
        };
        // A display-only command on this document returns its own snapshot.
        // Apply its echo after that paint, never as competing main-thread work.
        if (event.changeReason === "display-overlay" && change.rebuiltChildIds.length === 0
          && event.docId && hasPendingWorkspaceDocumentSnapshotCommand(event.docId)) {
          deferredSessionEchoes.push({ ...change, commandEcho: true });
          scheduleDeferredWorkspaceEventFlush();
          break;
        }
        store._applySessionChange(change);
      }
      break;
    case "options.changed":
      {
        const refreshedIds = event.refreshedDocumentIds ?? [];
        const refreshMode = event.refreshMode || "recalc";
        const housesOnly = typeof event.houseVisibility === "boolean";
        if (housesOnly) {
          store._confirmHouseVisibility(event.houseVisibility!, event.wheelPresetRevision ?? 0);
        } else if (store.pendingHouseToggles === 0 && !event.styleOnly) {
          setRetainedHouseVisibility(null);
          useDaemonWorkspaceStore.setState({ confirmedHouseVisibility: null });
        }
        // A typed visibility delta projects existing geometry. Keep the normal
        // options notification for settings/specialist surfaces, without making
        // wheel consumers invalidate, fetch or rebuild retained snapshots.
        const styleOnly = event.styleOnly === true || housesOnly;
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
          listDataDomain: event.listDataDomain,
          retainedListDataKey: event.retainedListDataKey,
          secondaryProgressionsDataKey: event.secondaryProgressionsDataKey,
          ephemerisDataKey: event.ephemerisDataKey,
          retainedListDisplay: event.retainedListDisplay,
          inspectorDataChanged,
          langid: event.langid,
          wheelPresetRevision: event.wheelPresetRevision,
          origin: event.origin,
          ...styleIdentity,
        });
        // A semantic settings change re-rendered every open chart. Profile-only
        // events update root CSS and resident renderer styles; synthesizing a
        // session tick for them would defeat the paint-only contract and force
        // snapshots/data geometry to refetch. For real option changes, bump the
        // active-doc tick only when that document is actually in the touched set.
        const specialistActive = housesOnly && store.documents.some(doc =>
          doc.documentId === store.activeDocumentId
          && ["square_chart", "mundane_chart", "astrolabe", "astrolog_sphere"].includes(doc.launcherKind ?? ""));
        if ((!styleOnly || specialistActive) && touchedIds.length > 0) {
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
          publishStyleDraftChange(null);
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
