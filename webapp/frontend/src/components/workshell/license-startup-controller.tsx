// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import * as React from "react";
import { Download, LoaderCircle } from "lucide-react";

import { LicenseManagementPanel } from "@/components/workshell/license-management-panel";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useT } from "@/lib/i18n/i18n";
import {
  checkLicensedUpdate,
  fetchLicenseStatus,
  installLicensedUpdate,
  refreshLicense,
  type LicensedUpdate,
  type LicenseStatus,
  type UpdateInstallEvent,
} from "@/lib/licensing/client";
import { useLicenseStateStore } from "@/stores/license-state-store";

const ACTIVE_STATES = new Set(["active", "grace"]);

type UpdatePhase = "available" | "installing" | "installed" | "failed";

function isNativeAries(): boolean {
  if (typeof window === "undefined") return false;
  return (window as Window & { __ARIES_TAURI_RUNTIME__?: boolean }).__ARIES_TAURI_RUNTIME__ === true;
}

export function LicenseStartupController() {
  const t = useT();
  const status = useLicenseStateStore((state) => state.status);
  const setStatus = useLicenseStateStore((state) => state.setStatus);
  const [updateOffer, setUpdateOffer] = React.useState<{
    info: LicensedUpdate;
    statusIdentity: string;
  } | null>(null);
  const [updatePhase, setUpdatePhase] = React.useState<UpdatePhase>("available");
  const [downloaded, setDownloaded] = React.useState(0);
  const [contentLength, setContentLength] = React.useState<number | null>(null);
  const updateCheckedFor = React.useRef<string | null>(null);
  const licenseActive = Boolean(
    status?.required && ACTIVE_STATES.has(status.state),
  );
  const statusIdentity = status
    ? [status.state, status.activationId ?? "", status.leaseExpiresAt ?? ""].join(":")
    : "unknown";
  const update =
    licenseActive && updateOffer?.statusIdentity === statusIdentity
      ? updateOffer.info
      : null;

  React.useEffect(() => {
    if (!isNativeAries()) return;
    let active = true;
    fetchLicenseStatus()
      .then(async (next) => {
        let resolved = next;
        if (
          next.required &&
          (next.state === "grace" || next.state === "expired" || next.state === "invalid")
        ) {
          try {
            resolved = await refreshLicense();
          } catch {
            // An authoritative server rejection clears the local lease in the
            // native layer; an offline failure deliberately leaves grace intact.
            resolved = await fetchLicenseStatus().catch(() => next);
          }
        }
        if (active) setStatus(resolved);
      })
      .catch((error) => {
        console.error("[license-startup]", error);
      });
    return () => {
      active = false;
    };
  }, [setStatus]);

  React.useEffect(() => {
    if (
      !licenseActive ||
      updateCheckedFor.current === statusIdentity
    ) {
      return;
    }
    updateCheckedFor.current = statusIdentity;
    let active = true;
    const timer = window.setTimeout(() => {
      checkLicensedUpdate()
        .then((next) => {
          if (!active || !next) return;
          setUpdateOffer({ info: next, statusIdentity });
          setUpdatePhase("available");
        })
        .catch((error) => {
          // Startup update discovery is intentionally quiet when offline.
          console.warn("[license-update-check]", error);
        });
    }, 1_500);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [licenseActive, statusIdentity]);

  const handleLicenseStatus = React.useCallback((next: LicenseStatus) => {
    setStatus(next);
  }, [setStatus]);

  const handleInstallEvent = React.useCallback((event: UpdateInstallEvent) => {
    if (event.event === "started") {
      setContentLength(event.data.contentLength ?? null);
      setDownloaded(0);
      return;
    }
    if (event.event === "progress") {
      setDownloaded(event.data.downloaded);
      return;
    }
    if (event.event === "installed") {
      setUpdatePhase("installed");
    }
  }, []);

  const installUpdate = React.useCallback(async () => {
    setUpdatePhase("installing");
    setDownloaded(0);
    setContentLength(null);
    try {
      await installLicensedUpdate(handleInstallEvent);
      setUpdatePhase("installed");
    } catch (error) {
      console.error("[license-update-install]", error);
      setUpdatePhase("failed");
      try {
        const next = await checkLicensedUpdate();
        if (next) setUpdateOffer({ info: next, statusIdentity });
      } catch {
        // The next retry will surface the existing localized failure state.
      }
    }
  }, [handleInstallEvent, statusIdentity]);

  const licenseGateOpen = Boolean(status?.required && !licenseActive);
  const progress =
    contentLength && contentLength > 0
      ? Math.min(100, Math.round((downloaded / contentLength) * 100))
      : null;

  return (
    <>
      <Dialog open={licenseGateOpen}>
        <DialogContent showCloseButton={false} className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("license.startupTitle")}</DialogTitle>
            <DialogDescription>{t("license.startupDescription")}</DialogDescription>
          </DialogHeader>
          <LicenseManagementPanel onStatusChange={handleLicenseStatus} />
        </DialogContent>
      </Dialog>

      <Dialog
        open={update !== null}
        onOpenChange={(open) => {
          if (!open && updatePhase !== "installing") setUpdateOffer(null);
        }}
      >
        <DialogContent showCloseButton={false} className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {updatePhase === "installed"
                ? t("license.updateInstalledTitle")
                : t("license.updateAvailableTitle", { version: update?.version ?? "" })}
            </DialogTitle>
            <DialogDescription>
              {updatePhase === "installed"
                ? t("license.updateInstalledDescription")
                : t("license.updateAvailableDescription")}
            </DialogDescription>
          </DialogHeader>

          {update?.notes && updatePhase !== "installed" ? (
            <div className="space-y-1.5">
              <div className="text-xs font-medium text-foreground/75">
                {t("license.updateReleaseNotes")}
              </div>
              <div className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded-md bg-muted/45 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
                {update.notes}
              </div>
            </div>
          ) : null}

          {updatePhase === "installing" ? (
            <div className="space-y-2" aria-live="polite">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <LoaderCircle className="size-3.5 animate-spin" aria-hidden />
                {progress === null
                  ? t("license.updateDownloading")
                  : t("license.updateProgress", { percent: progress })}
              </div>
              <div
                className="h-1.5 overflow-hidden rounded-full bg-muted"
                role="progressbar"
                aria-label={t("license.updateDownloading")}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={progress ?? undefined}
              >
                <div
                  className="h-full rounded-full bg-primary transition-[width]"
                  style={{ width: progress === null ? "12%" : `${progress}%` }}
                />
              </div>
            </div>
          ) : null}

          {updatePhase === "failed" ? (
            <div className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive" role="alert">
              {t("license.updateFailed")}
            </div>
          ) : null}

          <DialogFooter>
            {updatePhase === "installed" ? (
              <Button type="button" onClick={() => setUpdateOffer(null)}>
                {t("license.updateClose")}
              </Button>
            ) : (
              <>
                <Button
                  type="button"
                  variant="outline"
                  disabled={updatePhase === "installing"}
                  onClick={() => setUpdateOffer(null)}
                >
                  {t("license.updateLater")}
                </Button>
                <Button
                  type="button"
                  disabled={updatePhase === "installing"}
                  onClick={() => void installUpdate()}
                >
                  {updatePhase === "installing" ? (
                    <LoaderCircle className="animate-spin" aria-hidden />
                  ) : (
                    <Download aria-hidden />
                  )}
                  {updatePhase === "installing"
                    ? t("license.updateInstalling")
                    : t("license.updateDownloadInstall")}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
