// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

export type LicenseState =
  | "unconfigured"
  | "unlicensed"
  | "active"
  | "grace"
  | "expired"
  | "invalid";

export type LicenseStatus = {
  configured: boolean;
  required: boolean;
  state: LicenseState;
  activationId?: string | null;
  provider?: string | null;
  seats?: number | null;
  leaseExpiresAt?: string | null;
  refreshAfter?: string | null;
};

export type LicensedUpdate = {
  version: string;
  notes: string;
  pub_date?: string | null;
};

export type UpdateInstallEvent =
  | { event: "started"; data: { contentLength?: number | null } }
  | { event: "progress"; data: { chunkLength: number; downloaded: number } }
  | { event: "finished" }
  | { event: "installed" };

export type LicenseDevice = {
  activationId: string;
  platform: string;
  arch: string;
  activatedAt: string;
  current: boolean;
};

export type LicenseDevices = {
  seats: number;
  devices: LicenseDevice[];
  revokedCurrent: boolean;
};

async function nativeInvoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(command, args);
}

export function fetchLicenseStatus(): Promise<LicenseStatus> {
  return nativeInvoke<LicenseStatus>("license_status");
}

export function activateLicense(licenseKey: string): Promise<LicenseStatus> {
  return nativeInvoke<LicenseStatus>("license_activate", { licenseKey });
}

export function refreshLicense(): Promise<LicenseStatus> {
  return nativeInvoke<LicenseStatus>("license_refresh");
}

export function deactivateLicense(): Promise<LicenseStatus> {
  return nativeInvoke<LicenseStatus>("license_deactivate");
}

export function listLicenseDevices(licenseKey?: string): Promise<LicenseDevices> {
  return nativeInvoke<LicenseDevices>("license_list_devices", {
    licenseKey: licenseKey ?? null,
  });
}

export function revokeLicenseDevice(
  activationId: string,
  licenseKey?: string,
): Promise<LicenseDevices> {
  return nativeInvoke<LicenseDevices>("license_revoke_device", {
    activationId,
    licenseKey: licenseKey ?? null,
  });
}

export function checkLicensedUpdate(channel: "stable" | "beta" = "stable") {
  return nativeInvoke<LicensedUpdate | null>("license_check_update", { channel });
}

export async function installLicensedUpdate(
  onEvent: (event: UpdateInstallEvent) => void,
): Promise<void> {
  const { Channel, invoke } = await import("@tauri-apps/api/core");
  const progress = new Channel<UpdateInstallEvent>();
  progress.onmessage = onEvent;
  await invoke("license_install_update", { onEvent: progress });
}
