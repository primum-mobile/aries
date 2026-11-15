// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

// Runs once when the Next server starts. Under `next dev` (every `make run`
// smoke) it starts the in-app copy editor's local save helper; the static
// export and production builds never start it. Node-only code stays in its own
// module so the Edge compile of this file never sees Node APIs.
export async function register(): Promise<void> {
  if (process.env.NODE_ENV !== "development" || process.env.NEXT_RUNTIME !== "nodejs") return;
  await import("./instrumentation-node");
}
