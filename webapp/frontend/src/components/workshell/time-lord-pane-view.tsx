// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import * as React from "react";
import { Copy, Download, FileText, X } from "lucide-react";

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
      <PaneShell title={label} sourceName={sourceName} onClose={onClose}>
        <div className="flex flex-1 items-center justify-center p-6 text-[length:var(--aries-font-size-base)] text-[color:var(--aries-text-muted)]">
          {error}
        </div>
      </PaneShell>
    );
  }

  if (!payload) {
    return (
      <PaneShell title={label} sourceName={sourceName} onClose={onClose}>
        <div className="flex flex-1 items-center justify-center p-6 text-[length:var(--aries-font-size-base)] text-[color:var(--aries-text-muted)]">
          {t("timelord.loadingNamed", { name: label })}
        </div>
      </PaneShell>
    );
  }

  if (payload.unavailable) {
    return (
      <PaneShell title={title} sourceName={sourceName} onClose={onClose}>
        <div className="flex flex-1 items-center justify-center p-6 text-center text-[length:var(--aries-font-size-base)] text-[color:var(--aries-text-muted)]">
          {payload.notes?.[0] ?? t("timelord.unavailableNamed", { name: title })}
        </div>
      </PaneShell>
    );
  }

  return (
    <PaneShell
      title={title}
      sourceName={sourceName}
      onClose={onClose}
      toolbar={
        <>
          <button
            type="button"
            className="inline-flex h-6 items-center gap-1 rounded border border-[color:var(--aries-border-subtle)] px-1.5 text-[length:var(--aries-font-size-small)] text-[color:var(--aries-text-primary)] hover:bg-[color:var(--aries-surface-subtle)]"
            onClick={() => {
              const text = tableToTsv(payload, payload.rows);
              void navigator.clipboard?.writeText(text).catch(() => {
                downloadText(`${fileStem}.tsv`, text, "text/tab-separated-values");
              });
            }}
            title={t("timelord.copyRows")}
          >
            <Copy className="size-3.5" />
          </button>
          <button
            type="button"
            className="inline-flex h-6 items-center gap-1 rounded border border-[color:var(--aries-border-subtle)] px-1.5 text-[length:var(--aries-font-size-small)] text-[color:var(--aries-text-primary)] hover:bg-[color:var(--aries-surface-subtle)]"
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
            <Download className="size-3.5" />
          </button>
          <button
            type="button"
            className="inline-flex h-6 items-center gap-1 rounded border border-[color:var(--aries-border-subtle)] px-1.5 text-[length:var(--aries-font-size-small)] text-[color:var(--aries-text-primary)] hover:bg-[color:var(--aries-surface-subtle)]"
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
            <FileText className="size-3.5" />
          </button>
          <button
            type="button"
            className="inline-flex h-6 items-center gap-1 rounded border border-[color:var(--aries-border-subtle)] px-1.5 text-[length:var(--aries-font-size-small)] text-[color:var(--aries-text-primary)] hover:bg-[color:var(--aries-surface-subtle)]"
            onClick={() =>
              void exportTablePayloadPdf(payload, payload.rows, {
                fileStem,
                title,
              }).catch(() => {})
            }
            title={t("timelord.exportPdf")}
          >
            <Download className="size-3.5" />
            PDF
          </button>
        </>
      }
    >
      <TimeLordTableView
        documentId={documentId}
        payload={payload}
        onBindingChange={updateBinding}
        onOptionsChange={updateOptions}
      />
    </PaneShell>
  );
}

function PaneShell({
  title,
  sourceName,
  onClose,
  toolbar,
  children,
}: {
  title: string;
  sourceName?: string;
  onClose?: () => void;
  toolbar?: React.ReactNode;
  children: React.ReactNode;
}) {
  const t = useT();
  return (
    <div className="font-morinus-text flex h-full min-h-0 flex-col bg-background">
      <div className="flex shrink-0 items-center gap-2 border-b border-[color:var(--aries-border-subtle)] bg-[color:var(--aries-surface)] px-3 py-2">
        <div className="min-w-0 truncate text-[length:var(--aries-font-size-small)] font-medium text-[color:var(--aries-text-primary)]">
          {title}
          {sourceName ? (
            <span className="ml-1 font-normal text-[color:var(--aries-text-muted)]">{sourceName}</span>
          ) : null}
        </div>
        <div className="ml-auto flex items-center gap-1">
          {toolbar}
          {onClose ? (
            <button
              type="button"
              className="inline-flex size-6 items-center justify-center rounded hover:bg-accent/40"
              onClick={onClose}
              aria-label={t("timelord.closeNamed", { name: title })}
            >
              <X className="size-4" />
            </button>
          ) : null}
        </div>
      </div>
      {children}
    </div>
  );
}
