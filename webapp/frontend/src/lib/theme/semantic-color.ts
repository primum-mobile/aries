// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

const SEMANTIC_CHART_COLOR_ROLE = /^--morinus-[a-z0-9-]+$/;

export function semanticChartColor(
  role: string | null | undefined,
  fallback: string | null | undefined,
): string | undefined {
  if (role && SEMANTIC_CHART_COLOR_ROLE.test(role)) {
    return fallback ? `var(${role}, ${fallback})` : `var(${role})`;
  }
  return fallback || undefined;
}

function portableRgbColor(value: string): string {
  const match = value.trim().match(
    /^rgba?\(\s*([0-9.]+)(?:\s*,\s*|\s+)([0-9.]+)(?:\s*,\s*|\s+)([0-9.]+)(?:\s*(?:\/|,)\s*[0-9.]+)?\s*\)$/i,
  );
  if (!match) return value.trim();
  return `#${match.slice(1, 4)
    .map((channel) => Math.max(0, Math.min(255, Math.round(Number(channel)))).toString(16).padStart(2, "0"))
    .join("")}`;
}

/** Resolve a semantic role at the moment a non-DOM renderer (PDF, clipboard,
 * etc.) snapshots it. Live rows can keep a CSS var reference; exported data
 * needs the active profile's concrete colour instead of the stale daemon
 * fallback retained when the rows were fetched. */
export function resolvedSemanticChartColor(
  role: string | null | undefined,
  fallback: string | null | undefined,
): string | undefined {
  if (!role || !SEMANTIC_CHART_COLOR_ROLE.test(role) || typeof window === "undefined") {
    return fallback ? portableRgbColor(fallback) : undefined;
  }
  const root = typeof document === "undefined" ? null : document.documentElement;
  const resolved = root ? window.getComputedStyle(root).getPropertyValue(role).trim() : "";
  const value = resolved || fallback;
  return value ? portableRgbColor(value) : undefined;
}

/** Snapshot root chart roles once for a Canvas/PDF paint and resolve any
 * number of retained payload literals without repeated computed-style reads. */
export function createResolvedSemanticChartColorResolver(): (
  role: string | null | undefined,
  fallback: string | null | undefined,
) => string | undefined {
  const root = typeof document === "undefined" ? null : document.documentElement;
  const computed = root && typeof window !== "undefined"
    ? window.getComputedStyle(root)
    : null;
  return (role, fallback) => {
    if (!role || !SEMANTIC_CHART_COLOR_ROLE.test(role)) {
      return fallback ? portableRgbColor(fallback) : undefined;
    }
    const resolved = computed?.getPropertyValue(role).trim() ?? "";
    const value = resolved || fallback;
    return value ? portableRgbColor(value) : undefined;
  };
}
