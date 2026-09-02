// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import * as React from "react";

import {
  fetchGenericTablePayload,
  patchOptions,
  workspaceUpdateTableBinding,
  type GenericTablePayload,
  type OptionsPatch,
} from "@/lib/daemon/client";
import { isAbortError } from "@/lib/abort-error";
import {
  getCachedGenericTablePayload,
  rememberGenericTablePayload,
} from "@/lib/table/payload-cache";
import type { ListFollowPolicy } from "@/lib/list-follow-policy";
import { useT, type TFunc } from "@/lib/i18n/i18n";
import { useDaemonWorkspaceStore } from "@/stores/daemon-workspace-store";
import {
  flushSidebarListPreferenceWrites,
  useWorkspaceStore,
  type TimeLordTableId,
  type VimshottariPreferences,
} from "@/stores/workspace-store";
import { TimeLordTableView } from "./time-lord-table-view";
import { buildTableExportDocument } from "./table-pdf-export";
import { TextExportActions } from "./text-export-actions";
import { useSettledWorkspaceRefreshSeq, useStepSettledValue } from "./step-refresh";
import { useTemporalConfluenceLensReporter } from "./temporal-confluence-context";
import { RetainedPaneShell } from "./retained-pane-shell";

type Props = {
  documentId: string;
  parentDocumentId?: string | null;
  tableId: TimeLordTableId;
  sourceName?: string;
  focusDatetime?: string | null;
  includeTemporal?: boolean;
  followPolicy?: ListFollowPolicy;
  onClose?: () => void;
};

const TIME_LORD_LABEL_KEYS: Record<TimeLordTableId, string> = {
  firdaria: "timelord.firdaria",
  vimshottari: "timelord.vimshottari",
  decennials: "timelord.decennials",
  triplicity_directions: "timelord.triplicityDirections",
  zodiacal_releasing: "timelord.zodiacalReleasing",
  profections_table: "timelord.profections",
};

function timeLordLabel(tableId: TimeLordTableId, t: TFunc): string {
  return t(TIME_LORD_LABEL_KEYS[tableId]);
}

const TIME_LORD_FILE_STEMS: Record<TimeLordTableId, string> = {
  firdaria: "firdaria",
  vimshottari: "vimshottari",
  decennials: "decennials",
  triplicity_directions: "triplicity_directions",
  zodiacal_releasing: "zodiacal_releasing",
  profections_table: "profections",
};

export function TimeLordPaneView({
  documentId,
  parentDocumentId,
  tableId,
  sourceName,
  focusDatetime,
  includeTemporal = false,
  onClose,
}: Props) {
  const t = useT();
  const cacheTableId = includeTemporal ? `${tableId}:temporal` : tableId;
  const [payload, setPayload] = React.useState<GenericTablePayload | null>(() =>
    getCachedGenericTablePayload(cacheTableId, documentId),
  );
  const [error, setError] = React.useState<string | null>(null);
  const requestSeqRef = React.useRef(0);
  const setVimshottariPreferences = useWorkspaceStore(
    (state) => state.setVimshottariPreferences,
  );
  const lastSessionChange = useDaemonWorkspaceStore((s) => s.lastSessionChange);
  const lastOptionsChange = useDaemonWorkspaceStore((s) => s.lastRetainedDataOptionsChange);
  const settledFocusDatetime = useStepSettledValue(
    focusDatetime ?? null,
    parentDocumentId ?? documentId,
    lastSessionChange,
  );
  const refreshSeq = useSettledWorkspaceRefreshSeq({
    documentId,
    parentDocumentId,
    lastSessionChange,
    lastOptionsChange,
  });
  const reportTemporalLens = useTemporalConfluenceLensReporter();
  React.useEffect(() => {
    if (!payload) return;
    const capabilities = recordValue(payload?.capabilities);
    reportTemporalLens({ binding: temporalTimeLordBinding(capabilities.bindings) });
  }, [payload, reportTemporalLens]);

  const refreshPayload = React.useCallback(
    async (signal?: AbortSignal) => {
      const next = await fetchGenericTablePayload(
        tableId,
        documentId,
        signal,
        settledFocusDatetime,
        includeTemporal,
      );
      rememberGenericTablePayload(cacheTableId, documentId, next);
      setPayload(next);
      setError(null);
      return next;
    },
    [cacheTableId, documentId, includeTemporal, settledFocusDatetime, tableId],
  );

  React.useEffect(() => {
    const controller = new AbortController();
    const requestSeq = requestSeqRef.current + 1;
    requestSeqRef.current = requestSeq;
    fetchGenericTablePayload(
      tableId,
      documentId,
      controller.signal,
      settledFocusDatetime,
      includeTemporal,
    )
      .then((next) => {
        if (requestSeq !== requestSeqRef.current) return;
        rememberGenericTablePayload(cacheTableId, documentId, next);
        setPayload(next);
        setError(null);
      })
      .catch((err) => {
        if (isAbortError(err, controller.signal)) return;
        if (requestSeq !== requestSeqRef.current) return;
        setError(err instanceof Error ? err.message : String(err));
      });
    return () => controller.abort();
  }, [cacheTableId, documentId, includeTemporal, refreshSeq, settledFocusDatetime, tableId]);

  const updateBinding = React.useCallback(
    async (binding: Record<string, unknown>) => {
      await workspaceUpdateTableBinding(documentId, binding, tableId);
      await refreshPayload();
    },
    [documentId, refreshPayload, tableId],
  );

  const updateOptions = React.useCallback(
    async (patch: OptionsPatch) => {
      await patchOptions(patch);
      await refreshPayload();
    },
    [refreshPayload],
  );

  const updateVimshottariPreferences = React.useCallback(
    async (patch: Partial<VimshottariPreferences>) => {
      setVimshottariPreferences(patch);
      await flushSidebarListPreferenceWrites();
    },
    [setVimshottariPreferences],
  );

  const label = timeLordLabel(tableId, t);
  const title = tableId === "vimshottari" ? label : payload?.title || label;
  const fileStem = TIME_LORD_FILE_STEMS[tableId];

  if (error && !payload) {
    return (
      <RetainedPaneShell
        title={label}
        sourceName={sourceName}
        closeLabel={t("timelord.closeNamed", { name: label })}
        onClose={onClose}
        closePosition="leading"
      >
        <div className="flex flex-1 items-center justify-center p-6 text-[length:var(--aries-font-size-base)] text-[color:var(--aries-text-muted)]">
          {error}
        </div>
      </RetainedPaneShell>
    );
  }

  if (!payload) {
    return (
      <RetainedPaneShell
        title={label}
        sourceName={sourceName}
        closeLabel={t("timelord.closeNamed", { name: label })}
        onClose={onClose}
        closePosition="leading"
      >
        <div className="flex flex-1 items-center justify-center p-6 text-[length:var(--aries-font-size-base)] text-[color:var(--aries-text-muted)]">
          {t("timelord.loadingNamed", { name: label })}
        </div>
      </RetainedPaneShell>
    );
  }

  if (payload.unavailable) {
    return (
      <RetainedPaneShell
        title={title}
        sourceName={sourceName}
        closeLabel={t("timelord.closeNamed", { name: title })}
        onClose={onClose}
        closePosition="leading"
      >
        <div className="flex flex-1 items-center justify-center p-6 text-center text-[length:var(--aries-font-size-base)] text-[color:var(--aries-text-muted)]">
          {payload.notes?.[0] ?? t("timelord.unavailableNamed", { name: title })}
        </div>
      </RetainedPaneShell>
    );
  }

  return (
    <RetainedPaneShell
      title={title}
      sourceName={sourceName}
      closeLabel={t("timelord.closeNamed", { name: title })}
      onClose={onClose}
      closePosition="leading"
      toolbar={
        <TextExportActions
          buildDocument={() =>
            buildTableExportDocument(payload, payload.rows, { fileStem, title })
          }
        />
      }
    >
      <TimeLordTableView
        documentId={documentId}
        payload={payload}
        onBindingChange={updateBinding}
        onOptionsChange={updateOptions}
        onVimshottariPreferencesChange={updateVimshottariPreferences}
      />
    </RetainedPaneShell>
  );
}

function recordValue(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function temporalTimeLordBinding(value: unknown): Record<string, unknown> {
  const binding = { ...recordValue(value) };
  for (const disclosureKey of (
    ["drill_l2_start", "drill_row_id", "expanded_l2_starts", "expanded_row_ids"] as const
  )) {
    delete binding[disclosureKey];
  }
  return binding;
}
