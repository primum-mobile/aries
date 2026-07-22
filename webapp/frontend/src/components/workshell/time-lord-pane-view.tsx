// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import * as React from "react";
import { Copy, Download, FileText } from "lucide-react";

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
import type { TimeLordTableId } from "@/stores/workspace-store";
import { TimeLordTableView } from "./time-lord-table-view";
import { downloadText, tableToAlignedText, tableToTsv } from "./generic-table-view";
import { exportTablePayloadPdf } from "./table-pdf-export";
import { exportTextContent } from "./text-export";
import { useSettledWorkspaceRefreshSeq } from "./step-refresh";
import { RetainedPaneShell } from "./retained-pane-shell";
import { PaneToolbarButton } from "./list-controls";

type Props = {
  documentId: string;
  parentDocumentId?: string | null;
  tableId: TimeLordTableId;
  sourceName?: string;
  followPolicy?: ListFollowPolicy;
  onClose?: () => void;
};

const TIME_LORD_LABEL_KEYS: Record<TimeLordTableId, string> = {
  firdaria: "timelord.firdaria",
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
  decennials: "decennials",
  triplicity_directions: "triplicity_directions",
  zodiacal_releasing: "zodiacal_releasing",
  profections_table: "profections",
};

export function TimeLordPaneView({ documentId, parentDocumentId, tableId, sourceName, onClose }: Props) {
  const t = useT();
  const [payload, setPayload] = React.useState<GenericTablePayload | null>(() =>
    getCachedGenericTablePayload(tableId, documentId),
  );
  const [error, setError] = React.useState<string | null>(null);
  const requestSeqRef = React.useRef(0);
  const lastSessionChange = useDaemonWorkspaceStore((s) => s.lastSessionChange);
  const lastOptionsChange = useDaemonWorkspaceStore((s) => s.lastOptionsChange);
  const refreshSeq = useSettledWorkspaceRefreshSeq({
    documentId,
    parentDocumentId,
    lastSessionChange,
    lastOptionsChange,
  });

  const refreshPayload = React.useCallback(
    async (signal?: AbortSignal) => {
      const next = await fetchGenericTablePayload(tableId, documentId, signal);
      rememberGenericTablePayload(tableId, documentId, next);
      setPayload(next);
      setError(null);
      return next;
    },
    [documentId, tableId],
  );

  React.useEffect(() => {
    const controller = new AbortController();
    const requestSeq = requestSeqRef.current + 1;
    requestSeqRef.current = requestSeq;
    fetchGenericTablePayload(tableId, documentId, controller.signal)
      .then((next) => {
        if (requestSeq !== requestSeqRef.current) return;
        rememberGenericTablePayload(tableId, documentId, next);
        setPayload(next);
        setError(null);
      })
      .catch((err) => {
        if (isAbortError(err, controller.signal)) return;
        if (requestSeq !== requestSeqRef.current) return;
        setError(err instanceof Error ? err.message : String(err));
      });
    return () => controller.abort();
  }, [documentId, refreshSeq, tableId]);

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

  const label = timeLordLabel(tableId, t);
  const title = payload?.title || label;
  const fileStem = TIME_LORD_FILE_STEMS[tableId];

  if (error && !payload) {
    return (
      <RetainedPaneShell
        title={label}
        sourceName={sourceName}
        closeLabel={t("timelord.closeNamed", { name: label })}
        onClose={onClose}
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
      toolbar={
        <>
          <PaneToolbarButton
            type="button"
            onClick={() => {
              const text = tableToTsv(payload, payload.rows);
              void navigator.clipboard?.writeText(text).catch(() => {
                downloadText(`${fileStem}.tsv`, text, "text/tab-separated-values");
              });
            }}
            title={t("timelord.copyRows")}
          >
            <Copy />
          </PaneToolbarButton>
          <PaneToolbarButton
            type="button"
            onClick={() =>
              void exportTextContent({
                filename: fileStem,
                extension: "tsv",
                mimeType: "text/tab-separated-values;charset=utf-8",
                text: tableToTsv(payload, payload.rows),
                title: t("timelord.exportTsvDialog"),
                filters: [{ name: t("timelord.tsvFiles"), extensions: ["tsv"] }],
              }).catch(() => {})
            }
            title={t("timelord.exportTsv")}
          >
            <Download />
          </PaneToolbarButton>
          <PaneToolbarButton
            type="button"
            onClick={() =>
              void exportTextContent({
                filename: fileStem,
                extension: "txt",
                text: tableToAlignedText(payload, payload.rows, { title }),
                title: t("timelord.exportTextDialog"),
                filters: [{ name: t("timelord.textFiles"), extensions: ["txt"] }],
              }).catch(() => {})
            }
            title={t("timelord.exportText")}
          >
            <FileText />
          </PaneToolbarButton>
          <PaneToolbarButton
            type="button"
            onClick={() =>
              void exportTablePayloadPdf(payload, payload.rows, {
                fileStem,
                title,
              }).catch(() => {})
            }
            title={t("timelord.exportPdf")}
          >
            <Download />
            PDF
          </PaneToolbarButton>
        </>
      }
    >
      <TimeLordTableView
        documentId={documentId}
        payload={payload}
        onBindingChange={updateBinding}
        onOptionsChange={updateOptions}
      />
    </RetainedPaneShell>
  );
}
