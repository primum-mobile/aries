// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import * as React from "react";

import { useT } from "@/lib/i18n/i18n";
import {
  readBundledLegalDocument,
  type LegalDocumentKind,
} from "@/lib/legal-documents";
import { LIST_PANE_CLASSES } from "@/lib/list-tokens";

import { RetainedPaneShell } from "./retained-pane-shell";

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
    <RetainedPaneShell
      title={t(titleKey)}
      closeLabel={t("about.closeLegalDocument")}
      onClose={onClose}
      closeAppearance="list"
      wrapHeader
      titleSize="large"
      titleWeight="semibold"
      headerDensity="compact"
    >
      <div
        className={`${LIST_PANE_CLASSES.scroller} px-[var(--aries-panel-padding-x)] py-[var(--aries-panel-padding-y)]`}
      >
        {readFailed ? (
          <div className={LIST_PANE_CLASSES.error}>
            {t("about.legalReadError")}
          </div>
        ) : text ? (
          <pre className="whitespace-pre-wrap break-words pb-[var(--aries-pane-content-padding)] font-mono text-[length:var(--aries-font-size-small)] leading-[var(--aries-font-line-height-reading)] text-muted-foreground">
            {text}
          </pre>
        ) : (
          <div className={LIST_PANE_CLASSES.loading}>
            {t("about.loading")}
          </div>
        )}
      </div>
    </RetainedPaneShell>
  );
}
