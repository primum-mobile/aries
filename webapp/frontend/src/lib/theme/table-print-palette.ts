// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

/** Fixed paper palette: traditional semantic hues, darkened for small text
 * on white. These are export roles, never values from the active theme.
 * Neutral and unclassified marks print black. */
export const TABLE_PRINT_COLORS: Readonly<Record<string, string>> = Object.freeze({
  "--morinus-dignity-domicil": "#288246",
  "--morinus-dignity-exal": "#805b13",
  "--morinus-dignity-exil": "#c83232",
  "--morinus-dignity-casus": "#a05050",
  "--morinus-element-fire": "#a63e2e",
  "--morinus-element-earth": "#526c2e",
  "--morinus-element-air": "#3368a8",
  "--morinus-element-water": "#26747a",
  "--morinus-body-sun": "#806900",
  "--morinus-body-moon": "#006887",
  "--morinus-body-mercury": "#6e22b4",
  "--morinus-body-venus": "#008000",
  "--morinus-body-mars": "#b22222",
  "--morinus-body-jupiter": "#0000cc",
  "--morinus-body-saturn": "#000000",
  "--morinus-body-uranus": "#000080",
  "--morinus-body-neptune": "#000080",
  "--morinus-body-pluto": "#000080",
  "--morinus-body-nodes": "#8b3626",
  "--morinus-body-fortune": "#9a3868",
  "--morinus-body-chiron": "#800080",
  "--morinus-aspect-conjunction": "#9c0082",
  "--morinus-aspect-semisextile": "#006c6c",
  "--morinus-aspect-semisquare": "#9c0082",
  "--morinus-aspect-sextile": "#006b40",
  "--morinus-aspect-quintile": "#716a00",
  "--morinus-aspect-square": "#9c0082",
  "--morinus-aspect-trine": "#006b40",
  "--morinus-aspect-sesquisquare": "#9c0082",
  "--morinus-aspect-biquintile": "#994900",
  "--morinus-aspect-quincunx": "#0000bb",
  "--morinus-aspect-opposition": "#9c0082",
  "--morinus-aspect-septile": "#6e22b4",
});

export function tablePrintColor(role: string | null | undefined): string {
  return (role && TABLE_PRINT_COLORS[role]) || "#000000";
}
