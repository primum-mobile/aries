// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import * as React from "react";
import { KeyRound, LoaderCircle, Monitor, RefreshCw, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLocale, useT } from "@/lib/i18n/i18n";
import {
  activateLicense,
  deactivateLicense,
  fetchLicenseStatus,
  listLicenseDevices,
  refreshLicense,
  revokeLicenseDevice,
  type LicenseDevice,
  type LicenseDevices,
  type LicenseState,
  type LicenseStatus,
} from "@/lib/licensing/client";
import { useLicenseStateStore } from "@/stores/license-state-store";

const ACTIVE_STATES = new Set<LicenseState>(["active", "grace"]);

function errorKey(error: unknown): string {
  const code = String(error);
  if (code.includes("seat_limit_reached")) return "license.seatLimit";
  if (
    code.includes("provider_unavailable") ||
    code.includes("license_server_unavailable") ||
    code.includes("license_server_unconfigured")
  ) {
    return "license.serverUnavailable";
  }
  if (code.includes("license_not_found") || code.includes("license_inactive")) {
    return "license.invalidKey";
  }
  return "license.genericError";
}

function statusKey(state: LicenseState): string {
  return `license.status${state[0].toUpperCase()}${state.slice(1)}`;
}

function platformKey(platform: string): string {
  if (platform === "darwin") return "license.platformDarwin";
  if (platform === "windows") return "license.platformWindows";
  return "license.platformLinux";
}

export function LicenseManagementPanel({
  onStatusChange,
}: {
  onStatusChange?: (status: LicenseStatus) => void;
} = {}) {
  const t = useT();
  const locale = useLocale();
  const status = useLicenseStateStore((state) => state.status);
  const setStatus = useLicenseStateStore((state) => state.setStatus);
  const [devices, setDevices] = React.useState<LicenseDevices | null>(null);
  const [licenseKey, setLicenseKey] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>("load");

  const dateFormatter = React.useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }),
    [locale],
  );

  const loadDevices = React.useCallback(async (key?: string) => {
    const next = await listLicenseDevices(key);
    setDevices(next);
    return next;
  }, []);

  React.useEffect(() => {
    let active = true;
    fetchLicenseStatus()
      .then(async (next) => {
        if (!active) return;
        setStatus(next);
        if (ACTIVE_STATES.has(next.state)) {
          const listed = await listLicenseDevices();
          if (active) setDevices(listed);
        } else {
          setDevices(null);
        }
      })
      .catch((err) => {
        if (active) setError(errorKey(err));
      })
      .finally(() => {
        if (active) setBusy(null);
      });
    return () => {
      active = false;
    };
  }, [setStatus]);

  const activate = async () => {
    const key = licenseKey.trim();
    if (!key) return;
    setBusy("activate");
    setError(null);
    try {
      const next = await activateLicense(key);
      setStatus(next);
      onStatusChange?.(next);
      setLicenseKey("");
      await loadDevices();
    } catch (err) {
      const keyForError = errorKey(err);
      setError(keyForError);
      if (keyForError === "license.seatLimit") {
        try {
          await loadDevices(key);
        } catch {
          // The original seat-limit message remains the useful action state.
        }
      }
    } finally {
      setBusy(null);
    }
  };

  const refresh = async () => {
    setBusy("refresh");
    setError(null);
    try {
      const next = await refreshLicense();
      setStatus(next);
      onStatusChange?.(next);
      await loadDevices();
    } catch (err) {
      setError(errorKey(err));
    } finally {
      setBusy(null);
    }
  };

  const deactivateCurrent = async () => {
    setBusy("deactivate");
    setError(null);
    try {
      const next = await deactivateLicense();
      setStatus(next);
      onStatusChange?.(next);
      setDevices(null);
    } catch (err) {
      setError(errorKey(err));
    } finally {
      setBusy(null);
    }
  };

  const removeDevice = async (device: LicenseDevice) => {
    setBusy(device.activationId);
    setError(null);
    try {
      const next = await revokeLicenseDevice(
        device.activationId,
        ACTIVE_STATES.has(status?.state ?? "unlicensed") ? undefined : licenseKey.trim(),
      );
      setDevices(next);
      if (next.revokedCurrent) {
        const nextStatus = await fetchLicenseStatus();
        setStatus(nextStatus);
        onStatusChange?.(nextStatus);
        setDevices(null);
      }
    } catch (err) {
      setError(errorKey(err));
    } finally {
      setBusy(null);
    }
  };

  const active = status ? ACTIVE_STATES.has(status.state) : false;
  const showKeyEntry = status !== null && !active;

  return (
    <section className="border-t pt-3" aria-labelledby="aries-license-heading">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <KeyRound className="size-4 text-foreground/65" aria-hidden />
          <h3 id="aries-license-heading" className="text-[13px] font-medium">
            {t("license.title")}
          </h3>
          {status ? (
            <span data-ui-pill className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-foreground/65">
              {t(statusKey(status.state))}
            </span>
          ) : null}
        </div>
        {active ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            disabled={busy !== null}
            aria-label={t("license.refresh")}
            onClick={() => void refresh()}
          >
            <RefreshCw className={busy === "refresh" ? "animate-spin" : ""} />
          </Button>
        ) : null}
      </div>

      {busy === "load" && status === null ? (
        <div className="flex items-center gap-2 py-4 text-xs text-muted-foreground">
          <LoaderCircle className="size-3.5 animate-spin" aria-hidden />
          {t("license.loading")}
        </div>
      ) : null}

      {error ? (
        <div className="mt-2 rounded-md bg-destructive/10 px-2.5 py-2 text-xs text-destructive" role="alert">
          {t(error)}
        </div>
      ) : null}

      {showKeyEntry ? (
        <div className="mt-3 space-y-2">
          <label htmlFor="aries-license-key" className="text-xs font-medium text-foreground/75">
            {t("license.keyLabel")}
          </label>
          <div className="flex gap-2">
            <Input
              id="aries-license-key"
              type="password"
              value={licenseKey}
              autoComplete="off"
              spellCheck={false}
              placeholder={t("license.keyPlaceholder")}
              disabled={busy !== null}
              onChange={(event) => setLicenseKey(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void activate();
              }}
            />
            <Button
              type="button"
              size="sm"
              disabled={busy !== null || !licenseKey.trim()}
              onClick={() => void activate()}
            >
              {busy === "activate" ? t("license.activating") : t("license.activate")}
            </Button>
          </div>
        </div>
      ) : null}

      {devices ? (
        <div className="mt-3 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-foreground/75">{t("license.devices")}</span>
            <span className="text-muted-foreground">
              {t("license.deviceCount", { count: devices.devices.length, seats: devices.seats })}
            </span>
          </div>
          <div className="divide-y divide-border/40 overflow-hidden rounded-md border border-border/50">
            {devices.devices.map((device) => (
              <div key={device.activationId} className="flex items-center gap-2.5 px-2.5 py-2">
                <Monitor className="size-4 shrink-0 text-foreground/45" aria-hidden />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-xs">
                    <span className="truncate font-medium">{device.deviceName}</span>
                    {device.current ? (
                      <span data-ui-pill className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[9px] text-foreground/60">
                        {t("license.currentDevice")}
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-0.5 text-[10px] text-muted-foreground">
                    {t(platformKey(device.platform))} · {t("license.lastSeen", {
                      date: dateFormatter.format(new Date(device.lastSeenAt)),
                    })}
                  </div>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  disabled={busy !== null}
                  onClick={() => void removeDevice(device)}
                >
                  {busy === device.activationId ? (
                    <LoaderCircle className="animate-spin" aria-hidden />
                  ) : (
                    <Trash2 aria-hidden />
                  )}
                  {t("license.removeDevice")}
                </Button>
              </div>
            ))}
          </div>
          <p className="text-[10px] leading-relaxed text-muted-foreground">
            {t("license.offlineNotice")}
          </p>
        </div>
      ) : null}

      {active ? (
        <div className="mt-3">
          <Button
            type="button"
            variant="outline"
            size="xs"
            disabled={busy !== null}
            onClick={() => void deactivateCurrent()}
          >
            {t("license.deactivateThisDevice")}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
