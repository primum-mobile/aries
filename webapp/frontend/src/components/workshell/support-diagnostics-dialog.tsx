// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useLocale, useStartupT, useT, type TFunc } from "@/lib/i18n/i18n";
import { revealMainWindow } from "@/lib/shell/main-window";
import {
  collectDiagnostics,
  copyDiagnostics,
  fetchDaemonStartupFailure,
  installPageErrorForwarding,
  openLogsFolder,
  saveDiagnostics,
  startupFailureMessage,
  subscribeDaemonStartup,
  supportDiagnosticsAvailable,
  type DaemonStartupFailure,
} from "@/lib/shell/support-diagnostics";
import { useSupportDiagnosticsStore } from "@/stores/support-diagnostics-store";

const SUPPORT_EMAIL = "support@aries.sh";
const COPIED_FEEDBACK_MS = 2_000;

type ActionStatus =
  | { kind: "idle" }
  | { kind: "copied" }
  | { kind: "saved"; path: string }
  | { kind: "error"; message: string };

/** Copy, save and open-logs buttons shared by both dialogs. */
function DiagnosticsActions({ t, onClose }: { t: TFunc; onClose: () => void }) {
  const locale = useLocale();
  const [status, setStatus] = React.useState<ActionStatus>({ kind: "idle" });
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (status.kind !== "copied") return undefined;
    const timer = window.setTimeout(() => setStatus({ kind: "idle" }), COPIED_FEEDBACK_MS);
    return () => window.clearTimeout(timer);
  }, [status]);

  const run = React.useCallback(async (action: () => Promise<ActionStatus>) => {
    setBusy(true);
    try {
      setStatus(await action());
    } catch (error) {
      setStatus({ kind: "error", message: String(error) });
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <>
      {status.kind === "saved" ? (
        <div className="break-all text-muted-foreground">{t("supportDiagnostics.saved", { path: status.path })}</div>
      ) : null}
      {status.kind === "error" ? (
        <div role="alert" className="break-all text-destructive">
          {t("supportDiagnostics.failed", { error: status.message })}
        </div>
      ) : null}
      <DialogFooter>
        <Button variant="outline" disabled={busy} onClick={() => void run(async () => {
          await openLogsFolder();
          return { kind: "idle" };
        })}>
          {t("supportDiagnostics.openLogs")}
        </Button>
        <Button variant="outline" disabled={busy} onClick={() => void run(async () => {
          const path = await saveDiagnostics(locale);
          return path ? { kind: "saved", path } : { kind: "idle" };
        })}>
          {t("supportDiagnostics.saveDiagnostics")}
        </Button>
        <Button variant="outline" disabled={busy} onClick={() => void run(async () => {
          await copyDiagnostics(locale);
          return { kind: "copied" };
        })}>
          {status.kind === "copied" ? t("supportDiagnostics.copied") : t("supportDiagnostics.copyDiagnostics")}
        </Button>
        <Button onClick={onClose}>{t("supportDiagnostics.close")}</Button>
      </DialogFooter>
    </>
  );
}

/** Help > Diagnostics…: shows the redacted report before it is shared. */
export function SupportDiagnosticsDialog() {
  const t = useT();
  const locale = useLocale();
  const open = useSupportDiagnosticsStore((state) => state.diagnosticsOpen);
  const setOpen = useSupportDiagnosticsStore((state) => state.setDiagnosticsOpen);
  const [report, setReport] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    collectDiagnostics(locale)
      .then((text) => {
        if (cancelled) return;
        setReport(text);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [locale, open]);

  const close = React.useCallback(() => setOpen(false), [setOpen]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{t("supportDiagnostics.title")}</DialogTitle>
          <DialogDescription>{t("supportDiagnostics.description")}</DialogDescription>
        </DialogHeader>
        <div className="text-[length:var(--aries-font-size-reading)]">
          {t("supportDiagnostics.sendTo", { email: SUPPORT_EMAIL })}
        </div>
        {report ? (
          <Textarea
            readOnly
            value={report}
            aria-label={t("supportDiagnostics.previewLabel")}
            spellCheck={false}
            className="h-[40vh] resize-none whitespace-pre font-mono text-[length:var(--aries-font-size-base)] [field-sizing:fixed]"
          />
        ) : null}
        {error ? (
          <div role="alert" className="break-all text-destructive">
            {t("supportDiagnostics.failed", { error })}
          </div>
        ) : null}
        <DiagnosticsActions t={t} onClose={close} />
      </DialogContent>
    </Dialog>
  );
}

/**
 * Windows: when the native shell reports that the calculation engine could
 * not start, show why and where the logs are instead of an empty window.
 * Also forwards uncaught page errors to the shell log. Renders nothing on
 * macOS and in the browser.
 */
export function DaemonStartupFailureDialog() {
  const t = useStartupT();
  const failure = useSupportDiagnosticsStore((state) => state.startupFailure);
  const dismissed = useSupportDiagnosticsStore((state) => state.startupFailureDismissed);
  const setFailure = useSupportDiagnosticsStore((state) => state.setStartupFailure);
  const dismiss = useSupportDiagnosticsStore((state) => state.dismissStartupFailure);

  React.useEffect(() => {
    if (!supportDiagnosticsAvailable()) return undefined;
    installPageErrorForwarding();
    let stop: (() => void) | null = null;
    let cancelled = false;
    const show = (next: DaemonStartupFailure) => {
      setFailure(next);
      // The window stays hidden until the theme settles; a failed engine
      // must not leave it invisible or blank.
      void revealMainWindow().catch((error) => console.error("[daemon-startup-failure]", error));
    };
    void subscribeDaemonStartup(show, () => setFailure(null))
      .then((unsubscribe) => {
        if (cancelled) unsubscribe();
        else stop = unsubscribe;
        return fetchDaemonStartupFailure();
      })
      .then((current) => {
        if (!cancelled && current) show(current);
      })
      .catch((error) => console.error("[daemon-startup-failure]", error));
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [setFailure]);

  if (!failure) return null;
  const message = startupFailureMessage(t, failure);
  return (
    <Dialog open={!dismissed} onOpenChange={(open) => { if (!open) dismiss(); }}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{t("supportDiagnostics.startupTitle")}</DialogTitle>
          <DialogDescription>{message}</DialogDescription>
        </DialogHeader>
        <div className="space-y-[var(--aries-control-gap-compact)] text-[length:var(--aries-font-size-reading)]">
          {failure.logDir ? (
            <div className="break-all select-text">{t("supportDiagnostics.startupLogs", { path: failure.logDir })}</div>
          ) : null}
          <div>{t("supportDiagnostics.startupAsk", { email: SUPPORT_EMAIL })}</div>
        </div>
        <DiagnosticsActions t={t} onClose={dismiss} />
      </DialogContent>
    </Dialog>
  );
}
