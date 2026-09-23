// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import * as React from "react";
import { Check, Copy, FileOutput, FileText, LoaderCircle } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useT } from "@/lib/i18n/i18n";
import { cn } from "@/lib/utils";
import { PaneToolbarButton } from "./list-controls";
import {
  exportPreparedTableDocument,
  type TableExportDocument,
} from "./table-pdf-export";
import { copyTextToClipboard } from "./text-export";

type TextExportActionsProps = {
  buildDocument: () => TableExportDocument | Promise<TableExportDocument>;
  disabled?: boolean;
  className?: string;
  scopeLabel?: string;
  fileStem?: string;
  onError?: (error: unknown) => void;
};

export function TextExportActions({
  buildDocument,
  disabled = false,
  className,
  scopeLabel,
  fileStem,
  onError,
}: TextExportActionsProps) {
  const t = useT();
  const [copyPhase, setCopyPhase] = React.useState<"idle" | "confirmed" | "done">("idle");
  const timerRef = React.useRef<number | null>(null);
  const pendingRef = React.useRef(false);
  const [pending, setPending] = React.useState(false);

  React.useEffect(() => () => {
    if (timerRef.current != null) window.clearTimeout(timerRef.current);
  }, []);

  const copy = React.useCallback(() => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    if (timerRef.current != null) window.clearTimeout(timerRef.current);
    void Promise.resolve().then(buildDocument)
      .then((document) => copyTextToClipboard(document.text))
      .then(() => {
        setCopyPhase("confirmed");
        timerRef.current = window.setTimeout(() => {
          setCopyPhase("done");
          timerRef.current = window.setTimeout(() => {
            timerRef.current = null;
            setCopyPhase("idle");
          }, 250);
        }, 1100);
      })
      .catch((error: unknown) => {
        console.error("[table-copy]", error);
        if (timerRef.current != null) window.clearTimeout(timerRef.current);
        timerRef.current = null;
        setCopyPhase("idle");
        onError?.(error);
      })
      .finally(() => {
        pendingRef.current = false;
        setPending(false);
      });
  }, [buildDocument, onError]);

  const exportDocument = React.useCallback((kind: "pdf" | "txt") => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    void exportPreparedTableDocument(buildDocument, kind, {
      title: t("textExport.dialogTitle"),
      pdfFiles: t("textExport.pdfFiles"),
      textFiles: t("textExport.textFiles"),
    }, fileStem)
      .catch((error: unknown) => {
        console.error("[table-export]", error);
        onError?.(error);
      })
      .finally(() => {
        pendingRef.current = false;
        setPending(false);
      });
  }, [buildDocument, fileStem, onError, t]);

  const unavailable = disabled || pending;
  const copyLabel = [t("textExport.copy"), scopeLabel].filter(Boolean).join(" · ");
  const exportLabel = [t("textExport.export"), scopeLabel].filter(Boolean).join(" · ");
  const ExportIcon = pending ? LoaderCircle : FileOutput;

  return (
    <div aria-busy={pending} className={cn("flex shrink-0 items-center gap-[var(--aries-control-gap-compact)]", className)}>
      <PaneToolbarButton
        type="button"
        square
        appearance="ghost"
        disabled={unavailable}
        onClick={copy}
        aria-label={copyLabel}
        title={copyLabel}
        data-table-copy-feedback={copyPhase}
        className="border-transparent hover:border-transparent"
      >
        <span
          className={cn(
            "flex size-[var(--aries-control-icon-size)] items-center justify-center transition-[opacity,color] duration-[var(--aries-motion-shell-duration)] ease-[var(--aries-motion-shell-ease)]",
            copyPhase === "done" && "opacity-0",
          )}
        >
          {copyPhase === "idle" ? (
            <Copy className="size-[var(--aries-control-icon-size)]" strokeWidth={1.5} />
          ) : (
            <Check className="size-[var(--aries-control-icon-size)]" strokeWidth={1.5} />
          )}
        </span>
      </PaneToolbarButton>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <PaneToolbarButton
              type="button"
              square
              appearance="ghost"
              disabled={unavailable}
              aria-label={exportLabel}
              title={exportLabel}
              className="border-transparent hover:border-transparent"
            />
          }
        >
          <ExportIcon className={cn("size-[var(--aries-control-icon-size)]", pending && "animate-spin")} strokeWidth={1.5} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-auto min-w-[var(--aries-menu-dropdown-min-width)]">
          <DropdownMenuItem disabled={unavailable} onClick={() => exportDocument("pdf")}>
            <FileOutput />
            {t("textExport.exportPdf")}
          </DropdownMenuItem>
          <DropdownMenuItem disabled={unavailable} onClick={() => exportDocument("txt")}>
            <FileText />
            {t("textExport.exportText")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
