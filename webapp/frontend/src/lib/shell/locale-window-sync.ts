// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

/** The daemon's options.langid crosses windows as a plain integer. Only the
 * window that owns the daemon event socket relays it; companion windows (chart
 * picker, chart editor, settings) have no socket of their own, and retained or
 * prewarmed ones would otherwise keep the language they were mounted with. */
export const LOCALE_WINDOW_STATE = "aries://locale-window-state";

export type LocaleWindowState = { langid: number };

export async function publishWindowLangId(langid: number): Promise<void> {
  const { emit } = await import("@tauri-apps/api/event");
  await emit(LOCALE_WINDOW_STATE, { langid } satisfies LocaleWindowState);
}

export async function subscribeWindowLangId(
  onLangId: (langid: number) => void,
): Promise<() => void> {
  const { listen } = await import("@tauri-apps/api/event");
  return listen<LocaleWindowState>(LOCALE_WINDOW_STATE, ({ payload }) => {
    if (typeof payload?.langid === "number") onLangId(payload.langid);
  });
}

/** One window's language bookkeeping. A pushed langid (cross-window relay,
 * settings patch response) always applies. A startup read applies only when no
 * push landed while it was in flight, so a prewarmed window that is mounting
 * while the language switches can never fall back to the old language. */
export function createWindowLangIdTracker(apply: (langid: number | null | undefined) => void) {
  let revision = 0;
  return {
    push(langid: number | null | undefined) {
      revision += 1;
      apply(langid);
    },
    beginRead() {
      const startRevision = revision;
      return {
        settle(langid: number | null | undefined) {
          if (revision === startRevision) apply(langid);
        },
      };
    },
  };
}
