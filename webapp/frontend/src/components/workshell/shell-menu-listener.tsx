// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useEffect } from "react";

import {
  resolveShellHost,
  type ShellMenuCheckedState,
  type ShellMenuEnabledState,
  type ShellMenuLabelState,
} from "@/lib/shell-host";
import { safeShellUnlisten } from "@/lib/shell/unlisten";

export type AriesMenuCommand = string;
export type {
  ShellMenuCheckedState,
  ShellMenuEnabledState,
  ShellMenuLabelState,
} from "@/lib/shell-host";

type Props = {
  onCommand: (command: AriesMenuCommand) => void;
};

export async function syncShellMenuEnablement(
  states: ShellMenuEnabledState[],
): Promise<void> {
  if (states.length === 0) return;
  try {
    await resolveShellHost().syncMenuEnablement(states);
  } catch {
    // Hosts without menu state support can ignore enablement sync.
  }
}

/** Sync shell check-menu states (Charts > Elections / Horary lens themes) —
 * the wx twin is _refresh_pack_lens_menu_checks (morin.py:18963-18977). */
export async function syncShellMenuChecked(
  states: ShellMenuCheckedState[],
): Promise<void> {
  if (states.length === 0) return;
  try {
    await resolveShellHost().syncMenuChecked(states);
  } catch {
    // Hosts without menu state support can ignore check-state sync.
  }
}

/** Push fresh native menu-bar labels after a live language change — the menu is
 * built localized at startup, so this only fires when the language switches. */
export async function syncShellMenuLabels(
  labels: ShellMenuLabelState[],
): Promise<void> {
  if (labels.length === 0) return;
  try {
    await resolveShellHost().syncMenuLabels(labels);
  } catch {
    // Hosts without a native menu can ignore label sync.
  }
}

export function ShellMenuListener({ onCommand }: Props) {
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let cancelled = false;

    void resolveShellHost()
      .listenMenuCommands(onCommand)
      .then((stop) => {
        if (cancelled) {
          safeShellUnlisten(stop);
          return;
        }
        unlisten = stop;
      })
      .catch(() => {
        // Hosts without shell menu events can ignore this listener.
      });

    return () => {
      cancelled = true;
      safeShellUnlisten(unlisten);
    };
  }, [onCommand]);

  return null;
}
