// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

// Every native license error code maps to an actionable message that exists
// in every shipped locale.

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { licenseErrorKey } from "../src/lib/licensing/errors.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const expected = {
  seat_limit_reached: "license.seatLimit",
  license_clock_invalid: "license.clockWrong",
  system_clock_invalid: "license.clockWrong",
  license_tls_untrusted: "license.tlsUntrusted",
  license_proxy_auth_required: "license.proxyError",
  license_proxy_unavailable: "license.proxyError",
  license_credential_unavailable: "license.credentialStore",
  activation_required: "license.reactivate",
  activation_invalid: "license.reactivate",
  license_server_unavailable: "license.serverUnavailable",
  provider_unavailable: "license.serverUnavailable",
  license_not_found: "license.invalidKey",
  license_inactive: "license.invalidKey",
  wrong_product: "license.invalidKey",
  license_request_rejected: "license.genericError",
  "something unexpected": "license.genericError",
};

for (const [code, key] of Object.entries(expected)) {
  assert.equal(licenseErrorKey(code), key, code);
  // Tauri may wrap the rejection; substring matching keeps the mapping.
  assert.equal(licenseErrorKey(new Error(code)), key, `Error(${code})`);
}

const keys = new Set(Object.values(expected));
const localeDir = join(root, "src", "locales");
for (const file of readdirSync(localeDir).filter((name) => name.endsWith(".json"))) {
  const catalog = JSON.parse(readFileSync(join(localeDir, file), "utf8"));
  for (const key of keys) {
    assert.ok(typeof catalog[key] === "string" && catalog[key].trim(), `${file}: ${key}`);
  }
}

console.log("license error keys: ok");
