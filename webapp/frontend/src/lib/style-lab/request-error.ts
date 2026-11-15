// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { TFunc } from "../i18n/i18n";
import { WheelPresetApiError } from "../daemon/wheel-presets-client";
import { StyleLabApiError } from "./client";

/** A locally validated failure already has a translated, user-facing message. */
export class StyleLabInputError extends Error {}

export function styleLabRequestErrorMessage(error: unknown, t: TFunc): string {
  if (error instanceof StyleLabInputError) return error.message;
  if (error instanceof StyleLabApiError || error instanceof WheelPresetApiError) {
    if (error.status === 409 || error.status === 412) return t("styleLab.status.conflictDetail");
    if (error.status === 401 || error.status === 403) return t("styleLab.status.connectionFailed");
    if (error.status === 404) return t("styleLab.status.draftUnavailable");
    return t("styleLab.status.requestError", { status: error.status });
  }
  if (error instanceof TypeError) return t("styleLab.status.connectionFailed");
  return t("styleLab.status.requestFailed");
}
