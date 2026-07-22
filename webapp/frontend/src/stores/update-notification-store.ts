// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import { create } from "zustand";

import type { LicensedUpdate } from "@/lib/licensing/client";

const NOTIFIED_VERSION_KEY = "aries.update.notified-version";

function previewUpdate(): LicensedUpdate | null {
  if (process.env.NODE_ENV === "production" || process.env.NEXT_PUBLIC_ARIES_UPDATE_PREVIEW !== "1") {
    return null;
  }
  return {
    version: "1.0.0-beta.preview",
    notes: "A preview of the retained Aries update notification and What’s new flow.",
  };
}

type UpdateNotificationState = {
  deferred: LicensedUpdate | null;
  offerRequested: boolean;
  wasNotified: (version: string) => boolean;
  markNotified: (version: string) => void;
  defer: (update: LicensedUpdate) => void;
  requestOffer: () => void;
  dismissOffer: () => void;
  clear: () => void;
};

function storedNotifiedVersion(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(NOTIFIED_VERSION_KEY);
}

export const useUpdateNotificationStore = create<UpdateNotificationState>((set) => ({
  deferred: previewUpdate(),
  offerRequested: false,
  wasNotified: (version) => storedNotifiedVersion() === version,
  markNotified: (version) => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(NOTIFIED_VERSION_KEY, version);
    }
  },
  defer: (update) => set({ deferred: update }),
  requestOffer: () => set({ offerRequested: true }),
  dismissOffer: () => set({ offerRequested: false }),
  clear: () => set({ deferred: null, offerRequested: false }),
}));
