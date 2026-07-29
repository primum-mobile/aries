// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import * as React from "react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { fetchAbout, type AboutPayload } from "@/lib/daemon/client";
import { useT } from "@/lib/i18n/i18n";
import { useHelpAboutStore } from "@/stores/help-about-store";
import { useWorkspaceStore } from "@/stores/workspace-store";

/** Compact product facts and project credits. */
export function AboutDialog() {
  const t = useT();
  const open = useHelpAboutStore((s) => s.aboutOpen);
  const setOpen = useHelpAboutStore((s) => s.setAboutOpen);
  const openLegalDocumentPane = useWorkspaceStore(
    (s) => s.openLegalDocumentPane,
  );
  const [about, setAbout] = React.useState<AboutPayload | null>(null);

  React.useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    fetchAbout(controller.signal)
      .then(setAbout)
      .catch((err) => {
        if (!controller.signal.aborted) console.error("[about]", err);
      });
    return () => controller.abort();
  }, [open]);

  const showLegalDocument = React.useCallback(
    (document: "license" | "notices") => {
      openLegalDocumentPane(document);
      setOpen(false);
    },
    [openLegalDocumentPane, setOpen],
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent size="detail">
        <DialogHeader>
          <DialogTitle className="font-semibold tracking-tight">
            {about?.brand ?? "Aries"}
          </DialogTitle>
          {about ? (
            <div className="text-[length:var(--aries-font-size-reading)] text-muted-foreground">
              {t(about.taglineKey)}
            </div>
          ) : null}
        </DialogHeader>

        {about ? (
          <div className="space-y-[var(--aries-dialog-gap)] text-[length:var(--aries-font-size-reading)]">
            <div className="space-y-[var(--aries-control-gap-compact)] text-muted-foreground">
              <div>{t("about.version", { version: about.version })}</div>
              {about.buildStamp ? <div>{about.buildStamp}</div> : null}
              <div className="pt-[var(--aries-form-field-gap)] text-foreground">
                {t(about.copyrightKey, {
                  year: about.copyrightYear,
                  name: about.primaryAuthor,
                })}
              </div>
              <div>{t("about.licenseNotice")}</div>
              <a
                href={`mailto:${about.primaryContact}`}
                className="inline-block text-primary underline underline-offset-2"
              >
                {about.primaryContact}
              </a>
            </div>

            <div className="flex flex-wrap gap-x-[var(--aries-dialog-gap)] gap-y-[var(--aries-control-gap-compact)] text-[length:var(--aries-font-size-reading)]">
              <a
                href={about.websiteUrl}
                target="_blank"
                rel="noreferrer"
                className="text-primary underline underline-offset-2"
              >
                {t("about.link.website")}
              </a>
              <a
                href={about.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="text-primary underline underline-offset-2"
              >
                {t("about.link.source")}
              </a>
              <button
                type="button"
                onClick={() => showLegalDocument("license")}
                className="text-primary underline underline-offset-2"
              >
                {t("about.link.license")}
              </button>
              <button
                type="button"
                onClick={() => showLegalDocument("notices")}
                className="text-primary underline underline-offset-2"
              >
                {t("about.link.notices")}
              </button>
            </div>

            <section className="border-t pt-[var(--aries-dialog-section-padding-y)]">
              <div className="mb-[var(--aries-form-row-gap)] font-medium">
                {t(about.creditsHeadingKey)}
              </div>
              {about.swissEphemerisVersion ? (
                <div className="mb-[var(--aries-form-row-gap)] text-muted-foreground">
                  {t(about.swissEphemerisKey, {
                    version: about.swissEphemerisVersion,
                  })}
                </div>
              ) : null}
              <div className="mb-[var(--aries-form-field-gap)] font-medium">
                {t(about.contributorsHeadingKey)}
              </div>
              <ul className="max-h-[var(--aries-dialog-list-max-height)] space-y-[var(--aries-control-gap)] overflow-y-auto pr-[var(--aries-control-gap-compact)] text-muted-foreground">
                {about.legacyContributors.map((contributor) => (
                  <li key={contributor.name} className="leading-snug">
                    <span className="font-medium text-foreground">
                      {contributor.name}
                    </span>
                    <span> · {t(contributor.contributionKey)}</span>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        ) : (
          <div className="py-[var(--aries-pane-state-padding)] text-center text-[length:var(--aries-font-size-reading)] text-muted-foreground">
            {t("about.loading")}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
