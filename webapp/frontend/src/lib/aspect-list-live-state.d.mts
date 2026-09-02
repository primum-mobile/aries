export type AspectListCursorTracker = {
  documentId: string;
  focusDatetime: string | null;
  sessionSeq: number;
  pendingStepSeq: number;
  pendingStepAt: number;
};

export type AspectListCursorTrackerInput = {
  documentId: string;
  focusDatetime: string | null;
  sessionSeq: number;
  sessionChangeReason: string | null;
  now: number;
  handoffMs?: number;
};

export const ASPECT_LIST_CURSOR_FALLBACK_DELAY_MS: number;
export const ASPECT_LIST_PERFECTION_IDLE_MS: number;
export const ASPECT_LIST_PERFECTION_BATCH_SIZE: number;
export const ASPECT_LIST_PERFECTION_BATCH_LIMIT: number;
export const ASPECT_LIST_PERFECTION_CONCURRENCY: number;

export function aspectListRequestedMode<TMode extends string>(
  preferredMode: TMode | null,
  comparisonVisible: boolean | undefined,
): TMode | "primary" | null;

export function aspectListDefaultMode(
  comparisonVisible: boolean | undefined,
): "outerToPrimary" | "primary" | null;

export function aspectListVirtualWindow(input: {
  currentViewport: {
    scrollTop: number;
    height: number;
  };
  presentedWorldIdentity: string | null;
  worldIdentity: string;
  initialScrollTop: number;
  rowCount: number;
  rowHeight: number;
  overscanRows: number;
}): {
  scrollTop: number;
  height: number;
  start: number;
  end: number;
};

export function selectRetainedAspectListPayloadState<TPayload>(input: {
  storedState: {
    documentId: string;
    worldIdentity: string;
    payload: TPayload;
    queryIdentity: string | null;
    actionIdentity: string | null;
  } | null;
  cachedPayload: TPayload | null;
  documentId: string;
  worldIdentity: string;
  queryIdentity: string;
  actionIdentity: string;
}): {
  documentId: string;
  worldIdentity: string;
  payload: TPayload;
  queryIdentity: string | null;
  actionIdentity: string | null;
} | null;

export function nextAspectListPerfectionBatches(input: {
  priorityRowIds: readonly string[];
  backgroundRowIds: readonly string[];
  resolvedRowIds: ReadonlySet<string>;
  pendingRowIds: ReadonlySet<string>;
  failedRowIds: ReadonlySet<string>;
  availableSlots: number;
  batchSize?: number;
}): string[][];

export function advanceAspectListCursorTracker(
  tracker: AspectListCursorTracker,
  input: AspectListCursorTrackerInput,
): {
  tracker: AspectListCursorTracker;
  scheduleFallback: boolean;
};

export function aspectListQueryIdentity(input: {
  documentId: string;
  mode: string | null;
  refreshSeq: number;
  cursorFallbackSeq: number;
  contextRevisionSeq: number;
  retrySeq: number;
}): string;

export function aspectListRetainedWorldIdentity(input: {
  documentId: string;
  mode: string | null;
  contextRevision: string | null;
  focusDatetime: string | null;
  sessionMutationSeq: number;
  retainedListDataKey: string | null;
}): string;

export function isAspectListPayloadCurrent(
  payloadState: {
    documentId: string;
    queryIdentity: string | null;
    actionIdentity: string | null;
  } | null,
  documentId: string,
  queryIdentity: string,
  actionIdentity: string,
): boolean;

export function shouldDeferAspectListRefresh(input: {
  pendingStepSeq: number;
  settledStepSeq: number;
}): boolean;

export function aspectListPerfectionLedgerKey<
  TRow extends { trajectoryKey: string },
>(documentId: string, mode: string, row: TRow): string;

export function retainAspectListPerfectionsFromLedger<
  TRow extends { id: string; trajectoryKey: string; phase: string },
  TPerfection extends {
    status: "ready" | "unavailable";
    reason?: string;
    exactJd?: number;
  },
>(input: {
  documentId: string;
  mode: string;
  rows: readonly TRow[];
  ledger: ReadonlyMap<string, TPerfection>;
  nextAnchorJd: number;
}): Map<string, TPerfection>;

export function retainMatchingAspectListPerfections<
  TRow extends { id: string; trajectoryKey: string; phase: string },
  TPerfection extends {
    status: "ready" | "unavailable";
    reason?: string;
    exactJd?: number;
  },
>(input: {
  previousRows: readonly TRow[];
  nextRows: readonly TRow[];
  previousByRow: ReadonlyMap<string, TPerfection>;
  nextAnchorJd: number;
}): Map<string, TPerfection>;
