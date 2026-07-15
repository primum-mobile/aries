// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { LicenseManagementPanel } from "@/components/workshell/license-management-panel";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useT } from "@/lib/i18n/i18n";
import { useLicenseDialogStore } from "@/stores/license-dialog-store";

export function LicenseDialog() {
  const t = useT();
  const open = useLicenseDialogStore((state) => state.open);
  const setOpen = useLicenseDialogStore((state) => state.setOpen);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[88vh] w-[min(94vw,560px)] max-w-none overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("license.title")}</DialogTitle>
          <DialogDescription>{t("license.dialogDescription")}</DialogDescription>
        </DialogHeader>
        <LicenseManagementPanel
          onStatusChange={(status) => {
            if (status.required && status.state !== "active" && status.state !== "grace") {
              setOpen(false);
            }
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
