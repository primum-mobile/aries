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
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-2xl font-semibold tracking-tight">
            {about?.brand ?? "Aries"}
          </DialogTitle>
          {about ? (
            <div className="text-sm text-muted-foreground">
              {t(about.taglineKey)}
            </div>
          ) : null}
        </DialogHeader>

        {about ? (
          <div className="space-y-4 text-sm">
            <div className="space-y-1 text-muted-foreground">
              <div>{t("about.version", { version: about.version })}</div>
              {about.buildStamp ? <div>{about.buildStamp}</div> : null}
              <div className="pt-2 text-foreground">
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

            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
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

            <section className="border-t pt-4">
              <div className="mb-3 font-medium">
                {t(about.creditsHeadingKey)}
              </div>
              {about.swissEphemerisVersion ? (
                <div className="mb-3 text-muted-foreground">
                  {t(about.swissEphemerisKey, {
                    version: about.swissEphemerisVersion,
                  })}
                </div>
              ) : null}
              <div className="mb-2 font-medium">
                {t(about.contributorsHeadingKey)}
              </div>
              <ul className="max-h-56 space-y-1.5 overflow-y-auto pr-1 text-muted-foreground">
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
          <div className="py-8 text-center text-sm text-muted-foreground">
            {t("about.loading")}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
