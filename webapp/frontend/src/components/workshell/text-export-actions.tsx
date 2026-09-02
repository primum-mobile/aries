// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import * as React from "react";
import { Check, Copy, FileOutput, FileText } from "lucide-react";

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
  exportTablePdfDocument,
  type TableExportDocument,
} from "./table-pdf-export";
import {
  exportTableTextDocument,
} from "./table-text-export";
import { copyTextToClipboard } from "./text-export";

type TextExportActionsProps = {
  buildDocument: () => TableExportDocument | Promise<TableExportDocument>;
  disabled?: boolean;
  className?: string;
};

export function TextExportActions({
  buildDocument,
  disabled = false,
  className,
}: TextExportActionsProps) {
  const t = useT();
  const [copyPhase, setCopyPhase] = React.useState<"idle" | "confirmed" | "done">("idle");
  const timerRef = React.useRef<number | null>(null);

  React.useEffect(() => () => {
    if (timerRef.current != null) window.clearTimeout(timerRef.current);
  }, []);

  const copy = React.useCallback(() => {
    if (timerRef.current != null) window.clearTimeout(timerRef.current);
    setCopyPhase("confirmed");
    timerRef.current = window.setTimeout(() => {
      setCopyPhase("done");
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        setCopyPhase("idle");
      }, 250);
    }, 1100);
    void Promise.resolve(buildDocument())
      .then((document) => copyTextToClipboard(document.text))
      .catch(() => {
        if (timerRef.current != null) window.clearTimeout(timerRef.current);
        timerRef.current = null;
        setCopyPhase("idle");
      });
  }, [buildDocument]);

  const exportDocument = React.useCallback((kind: "pdf" | "txt") => {
    void Promise.resolve(buildDocument())
      .then((document) => {
        const labels = {
          title: t("textExport.dialogTitle"),
          pdfFiles: t("textExport.pdfFiles"),
          textFiles: t("textExport.textFiles"),
        };
        return kind === "pdf"
          ? exportTablePdfDocument(document, labels)
          : exportTableTextDocument(document, labels);
      })
      .catch(() => {});
  }, [buildDocument, t]);

  return (
    <div className={cn("flex shrink-0 items-center gap-[var(--aries-control-gap-compact)]", className)}>
      <PaneToolbarButton
        type="button"
        square
        appearance="ghost"
        disabled={disabled}
        onClick={copy}
        aria-label={t("textExport.copy")}
        title={t("textExport.copy")}
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
              disabled={disabled}
              aria-label={t("textExport.export")}
              title={t("textExport.export")}
              className="border-transparent hover:border-transparent"
            />
          }
        >
          <FileOutput className="size-[var(--aries-control-icon-size)]" strokeWidth={1.5} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-auto min-w-[var(--aries-menu-dropdown-min-width)]">
          <DropdownMenuItem disabled={disabled} onClick={() => exportDocument("pdf")}>
            <FileOutput />
            {t("textExport.exportPdf")}
          </DropdownMenuItem>
          <DropdownMenuItem disabled={disabled} onClick={() => exportDocument("txt")}>
            <FileText />
            {t("textExport.exportText")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
