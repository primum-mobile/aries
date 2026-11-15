// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { InspectorSpeculumPrecision } from "../daemon/client";

/** Only angular values are compacted. Time notation is opt-in for right ascension. */
export function formatTableAngleText(
  text: string,
  precision: InspectorSpeculumPrecision,
  rightAscension = false,
  omission = "",
): string {
  if (precision === "seconds") return text;
  if (rightAscension && /^\s?\d{1,2}:\d{2}(?::\d{2})?$/.test(text)) {
    return precision === "minutes"
      ? text.replace(/^(\s?\d{1,2}:\d{2}):\d{2}$/, `$1${omission}`)
      : text.replace(/^(\s?\d{1,2}):\d{2}(?::\d{2})?$/, omission ? `$1:${omission}` : "$1");
  }
  return precision === "minutes"
    ? text.replace(/(°\s*\d{1,2}\s*['′’])\s*\d{1,2}\s*["″]/g, `$1${omission}`)
    : text.replace(/°\s*\d{1,2}\s*['′’](?:\s*\d{1,2}\s*["″])?/g, `°${omission}`);
}

export function formatTableDegrees(value: number, precision: InspectorSpeculumPrecision): string {
  const totalSeconds = Math.round(Math.abs(value) * 3600);
  const degrees = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const seconds = totalSeconds % 60;
  const whole = `${value < 0 ? "−" : ""}${degrees}°`;
  if (precision === "degrees") return whole;
  const withMinutes = `${whole}${String(minutes).padStart(2, "0")}′`;
  return precision === "minutes" ? withMinutes : `${withMinutes}${String(seconds).padStart(2, "0")}″`;
}
