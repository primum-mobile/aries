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
    presentationCursor: candidate.presentationCursor === true,
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
    activeProfile:
      candidate.activeProfile && typeof candidate.activeProfile === "object"
        ? candidate.activeProfile
        : null,
    profileOverrides: {
      appTokens:
        candidate.profileOverrides?.appTokens &&
        typeof candidate.profileOverrides.appTokens === "object"
          ? candidate.profileOverrides.appTokens
          : {},
      chartPalette:
        candidate.profileOverrides?.chartPalette &&
        typeof candidate.profileOverrides.chartPalette === "object"
          ? candidate.profileOverrides.chartPalette
          : {},
      chartData:
        candidate.profileOverrides?.chartData &&
        typeof candidate.profileOverrides.chartData === "object"
          ? candidate.profileOverrides.chartData
          : {},
      wheelAuthoring:
        candidate.profileOverrides?.wheelAuthoring &&
        typeof candidate.profileOverrides.wheelAuthoring === "object"
          ? candidate.profileOverrides.wheelAuthoring
          : {},
      appAuthoring:
        candidate.profileOverrides?.appAuthoring &&
        typeof candidate.profileOverrides.appAuthoring === "object"
          ? candidate.profileOverrides.appAuthoring
          : {},
    },
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
