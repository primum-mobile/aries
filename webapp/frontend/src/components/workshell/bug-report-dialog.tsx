// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useState } from "react";
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
import { useT } from "@/lib/i18n/i18n";

export function BugReportDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState<"send" | "save" | null>(null);
  const [result, setResult] = useState<"sent" | "saved" | "sendError" | "saveError" | "missingEmail" | null>(null);

  async function submit(action: "send" | "save") {
    setResult(null);
    setBusy(action);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      if (action === "send") {
        await invoke("send_bug_report", { description });
        setResult("sent");
      } else if (await invoke<boolean>("save_bug_report", { description })) {
        setResult("saved");
      }
    } catch (error) {
      if (action === "save") setResult("saveError");
      else setResult(error === "bug_report_contact_missing" ? "missingEmail" : "sendError");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
      <DialogContent size="detail" showCloseButton={!busy}>
        <DialogHeader>
          <DialogTitle>{t("bugReport.title")}</DialogTitle>
          <DialogDescription>{t("bugReport.privacy")}</DialogDescription>
        </DialogHeader>
        {result !== "sent" && (
          <div className="flex flex-col gap-[var(--aries-form-field-gap)]">
            <label htmlFor="bug-report-description">{t("bugReport.description")}</label>
            <Textarea
              id="bug-report-description"
              value={description}
              maxLength={2000}
              disabled={busy !== null}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
        )}
        <div role="status" className={result ? undefined : "sr-only"}>
          {result === "sent" && t("bugReport.sent")}
          {result === "saved" && t("bugReport.saved", { email: "support@aries.sh" })}
          {result === "sendError" && t("bugReport.sendError")}
          {result === "saveError" && t("bugReport.saveError")}
          {result === "missingEmail" && t("bugReport.missingEmail")}
        </div>
        <DialogFooter>
          {result === "sent" ? (
            <Button onClick={onClose}>{t("settings.close")}</Button>
          ) : (
            <>
              <Button variant="outline" disabled={busy !== null} onClick={() => void submit("save")}>
                {t("bugReport.save")}
              </Button>
              <Button disabled={busy !== null} onClick={() => void submit("send")}>
                {busy === "send" ? t("bugReport.sending") : t("bugReport.send")}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
