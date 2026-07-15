/** Normalize both current ThemeState and the pre-style-schema cached payload. */
export function normalizeThemeState(value) {
  if (!value || typeof value !== "object") return null;
  const candidate = value;
  if (
    typeof candidate.activePreset !== "string" ||
    (candidate.mode !== "light" && candidate.mode !== "dark") ||
    typeof candidate.version !== "number" ||
    typeof candidate.paletteHash !== "string" ||
    !candidate.appTokens ||
    typeof candidate.appTokens !== "object" ||
    !candidate.chartPalette ||
    typeof candidate.chartPalette !== "object"
  ) {
    return null;
  }
  return {
    activePreset: candidate.activePreset,
    mode: candidate.mode,
    schemaVersion:
      typeof candidate.schemaVersion === "number" ? candidate.schemaVersion : 1,
    version: candidate.version,
    styleRevision:
      typeof candidate.styleRevision === "number"
        ? candidate.styleRevision
        : candidate.version,
    paletteHash: candidate.paletteHash,
    styleHash:
      typeof candidate.styleHash === "string"
        ? candidate.styleHash
        : candidate.paletteHash,
    appTokens: candidate.appTokens,
    chartPalette: candidate.chartPalette,
  };
}

/** Normalize current and legacy options.changed style identity fields. */
export function normalizeOptionsStyleIdentity(value) {
  const themeVersion = value.themeVersion ?? 0;
  const paletteHash = value.paletteHash ?? "";
  return {
    schemaVersion: value.schemaVersion ?? 1,
    themeVersion,
    styleRevision: value.styleRevision ?? themeVersion,
    paletteHash,
    styleHash: value.styleHash ?? paletteHash,
  };
}

export function styleRevisionKey(theme) {
  if (!theme) return "1:0:";
  return `${theme.schemaVersion}:${theme.styleRevision}:${theme.styleHash}`;
}
