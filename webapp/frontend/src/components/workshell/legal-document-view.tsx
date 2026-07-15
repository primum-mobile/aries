// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import * as React from "react";
import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n/i18n";
import {
  readBundledLegalDocument,
  type LegalDocumentKind,
} from "@/lib/legal-documents";
import { LIST_BUTTON_PROPS, LIST_PANE_CLASSES } from "@/lib/list-tokens";

export function LegalDocumentView({
  document,
  onClose,
}: {
  document: LegalDocumentKind;
  onClose: () => void;
}) {
  const t = useT();
  const [text, setText] = React.useState<string | null>(null);
  const [readFailed, setReadFailed] = React.useState(false);
  const titleKey = document === "notices"
    ? "about.link.notices"
    : "about.link.license";

  React.useEffect(() => {
    let cancelled = false;
    readBundledLegalDocument(document)
      .then((value) => {
        if (!cancelled) setText(value);
      })
      .catch((error) => {
        if (!cancelled) setReadFailed(true);
        console.error("[legal-document]", error);
      });
    return () => {
      cancelled = true;
    };
  }, [document]);

  return (
    <section className={LIST_PANE_CLASSES.root} aria-label={t(titleKey)}>
      <header className={LIST_PANE_CLASSES.compactHeader}>
        <h1 className={LIST_PANE_CLASSES.title}>{t(titleKey)}</h1>
        <Button
          type="button"
          {...LIST_BUTTON_PROPS.icon}
          onClick={onClose}
          aria-label={t("about.closeLegalDocument")}
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
      </header>

      <div className={`${LIST_PANE_CLASSES.scroller} px-4 py-3`}>
        {readFailed ? (
          <div className={LIST_PANE_CLASSES.error}>
            {t("about.legalReadError")}
          </div>
        ) : text ? (
          <pre className="whitespace-pre-wrap break-words pb-4 font-mono text-[11px] leading-5 text-muted-foreground">
            {text}
          </pre>
        ) : (
          <div className={LIST_PANE_CLASSES.loading}>
            {t("about.loading")}
          </div>
        )}
      </div>
    </section>
  );
}
