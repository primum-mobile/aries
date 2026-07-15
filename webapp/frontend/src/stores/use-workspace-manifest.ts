// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useEffect, useState } from "react";

import {
  fetchWorkspaceManifest,
  waitForDaemonHealth,
  type WorkspaceManifest,
} from "@/lib/daemon/client";
import { isAbortError, isTransientDaemonFetchError } from "@/lib/abort-error";
import { perfNow, recordStartupPerfOnce } from "@/lib/chart/perf";
import { FALLBACK_WORKSPACE_MANIFEST } from "@/lib/daemon/fallback-workspace-manifest";
import { useDaemonWorkspaceStore } from "@/stores/daemon-workspace-store";

// ---------------------------------------------------------------------------
// Workspace manifest hook — fetches the daemon-owned sidebar catalog + shortcut
// map at the workspace root. The live manifest is static for the daemon's
// lifetime, but Tauri starts the webview before the sidecar has necessarily
// bound its port. Use a daemon-generated first-paint fallback so the native
// shell/sidebar is deterministic, then replace it with the live daemon manifest
// once readiness completes.
// ---------------------------------------------------------------------------

let workspaceManifestCache: WorkspaceManifest = FALLBACK_WORKSPACE_MANIFEST;
let workspaceManifestCacheIsLive = false;
let workspaceManifestPromise: Promise<WorkspaceManifest> | null = null;
const workspaceManifestSubscribers = new Set<(m: WorkspaceManifest) => void>();

/** Re-fetch the daemon manifest and push it to every mounted hook. The manifest
 * is otherwise treated as static for the daemon's lifetime; the one thing that
 * changes it is a LANGUAGE switch, which re-localizes sidebar/menu labels
 * server-side. Call this after the language changes. */
export async function refreshWorkspaceManifest(): Promise<void> {
  try {
    const manifest = await fetchWorkspaceManifest();
    workspaceManifestCache = manifest;
    workspaceManifestCacheIsLive = true;
    workspaceManifestSubscribers.forEach((fn) => fn(manifest));
  } catch {
    // Keep the previous manifest on failure — a stale sidebar beats a blank one.
  }
}

function isPermanentManifestFailure(err: unknown): boolean {
  return err instanceof Error && /workspace manifest failed: (401|403)\b/.test(err.message);
}

function shouldRetryManifestFailure(err: unknown, attempt: number): boolean {
  if (isPermanentManifestFailure(err)) return false;
  // After /health succeeded, a browser-level fetch failure here usually means the
  // current daemon launch is inaccessible to this webview (for example raw browser
  // access to a tokenized Tauri daemon). Retry once for a daemon restart race only.
  if (isTransientDaemonFetchError(err) && attempt > 0) return false;
  return true;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function loadWorkspaceManifest(attempt = 0): Promise<WorkspaceManifest> {
  if (workspaceManifestCacheIsLive) return Promise.resolve(workspaceManifestCache);
  if (workspaceManifestPromise) return workspaceManifestPromise;

  const startedAt = perfNow();
  recordStartupPerfOnce("manifest-request-start", { attempt });
  workspaceManifestPromise = waitForDaemonHealth()
    .then(() => {
      recordStartupPerfOnce("manifest-daemon-health-ready", {
        source: "manifest",
        ms: Math.round(perfNow() - startedAt),
        attempt,
      });
      return fetchWorkspaceManifest();
    })
    .then((manifest) => {
      workspaceManifestCache = manifest;
      recordStartupPerfOnce("manifest-ready", {
        ms: Math.round(perfNow() - startedAt),
        menus: manifest.nativeMenu?.menus.length ?? 0,
        groups: manifest.groups.length,
        shortcuts: manifest.shortcuts.length,
      });
      workspaceManifestCacheIsLive = true;
      return manifest;
    })
    .catch(async (err) => {
      workspaceManifestPromise = null;
      if (!shouldRetryManifestFailure(err, attempt)) throw err;
      const delay = Math.min(500 + attempt * 250, 2_000);
      await sleep(delay);
      return loadWorkspaceManifest(attempt + 1);
    });
  return workspaceManifestPromise;
}

export function useWorkspaceManifest(): WorkspaceManifest | null {
  const [manifest, setManifest] = useState<WorkspaceManifest | null>(() => workspaceManifestCache);

  useEffect(() => {
    let cancelled = false;
    recordStartupPerfOnce("manifest-fallback-ready", {
      groups: FALLBACK_WORKSPACE_MANIFEST.groups.length,
      shortcuts: FALLBACK_WORKSPACE_MANIFEST.shortcuts.length,
    });
    void loadWorkspaceManifest()
      .then((m) => {
        if (!cancelled) {
          setManifest(m);
          recordStartupPerfOnce("manifest-live-applied", {
            groups: m.groups.length,
            shortcuts: m.shortcuts.length,
          });
        }
      })
      .catch((err) => {
        if (cancelled || isAbortError(err)) return;
        if (useDaemonWorkspaceStore.getState().connection === "open") {
          console.error("[ws-manifest]", err);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Live updates when refreshWorkspaceManifest() runs (e.g. after a language
  // switch re-localizes daemon-served sidebar/menu labels).
  useEffect(() => {
    const onUpdate = (m: WorkspaceManifest) => setManifest(m);
    workspaceManifestSubscribers.add(onUpdate);
    return () => {
      workspaceManifestSubscribers.delete(onUpdate);
    };
  }, []);

  return manifest;
}

/** The set of enabled supplementary chart dispatch ids the manifest exposes
 * (Charts-group actions that are NOT synastry/astrocartography). Derived from
 * the manifest so the skin never hardcodes the supplementary id list. */
export function supplementaryActionIds(
  manifest: WorkspaceManifest | null,
): Set<string> {
  const ids = new Set<string>();
  if (!manifest) return ids;
  for (const group of manifest.groups) {
    for (const action of group.actions) {
      if (!action.enabled) continue;
      if (
        action.id === "synastry" ||
        action.id === "astrocartography" ||
        action.id === "directions"
      )
        continue;
      // Charts-group enabled actions other than synastry/astrocart are the
      // supplementary children opened via openSupplementaryChild. The Research
      // group (workspace_model Research section: solar_average) is built by the
      // same supplementary daemon path, so its enabled launchers dispatch the
      // same way.
      if (group.id === "charts" || group.id === "research") ids.add(action.id);
    }
  }
  return ids;
}

/** All enabled action dispatch ids across top actions + every group — used to
 * decide whether a sidebar click is a launcher (vs a document activation). */
export function enabledActionIds(
  manifest: WorkspaceManifest | null,
): Set<string> {
  const ids = new Set<string>();
  if (!manifest) return ids;
  for (const action of manifest.topActions) {
    if (action.enabled) ids.add(action.id);
  }
  for (const group of manifest.groups) {
    for (const action of group.actions) {
      if (action.enabled) ids.add(action.id);
    }
  }
  return ids;
}
