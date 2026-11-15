// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

// Native license commands reject with stable codes (licensing.rs,
// license_network.rs, the license server's `detail`). Each code maps to one
// localized message that tells the user what to do next.
const LICENSE_ERROR_KEYS = [
  ["seat_limit_reached", "license.seatLimit"],
  ["license_clock_invalid", "license.clockWrong"],
  ["system_clock_invalid", "license.clockWrong"],
  ["license_tls_untrusted", "license.tlsUntrusted"],
  ["license_proxy_auth_required", "license.proxyError"],
  ["license_proxy_unavailable", "license.proxyError"],
  ["license_credential_unavailable", "license.credentialStore"],
  ["license_secure_storage_unsupported", "license.credentialStore"],
  ["activation_required", "license.reactivate"],
  ["activation_invalid", "license.reactivate"],
  ["provider_unavailable", "license.serverUnavailable"],
  ["license_server_unavailable", "license.serverUnavailable"],
  ["license_server_unconfigured", "license.serverUnavailable"],
  ["license_not_found", "license.invalidKey"],
  ["license_inactive", "license.invalidKey"],
  ["wrong_product", "license.invalidKey"],
];

export function licenseErrorKey(error) {
  const code = String(error);
  for (const [needle, key] of LICENSE_ERROR_KEYS) {
    if (code.includes(needle)) return key;
  }
  return "license.genericError";
}
