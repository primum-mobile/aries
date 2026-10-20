// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useEffect } from "react";

import type { ShortcutEntry, WorkspaceManifest } from "@/lib/daemon/client";
import { spotlightShortcutCoolingDown } from "@/shortcuts/spotlight-cooldown";

type DispatchShortcutCommand = (commandId: string) => void;
type CommandEnabledPredicate = (commandId: string) => boolean;

export const EMBEDDED_MANIFEST_SHORTCUT_EVENT =
  "aries://embedded-manifest-shortcut";

type ParsedShortcut = {
  key: string;
  requireCommand: boolean;
  requireAlt?: boolean;
  requireShift?: boolean;
};

type ShortcutGesture = {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
};

type EmbeddedManifestShortcutDetail = Partial<ShortcutGesture> & {
  repeat?: boolean;
  code?: string;
};

/** macOS Option chords often rewrite `event.key`; match the physical letter key. */
export function keyboardGestureFromEvent(event: Pick<
  KeyboardEvent,
  "key" | "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey"
>): ShortcutGesture {
  let key = event.key.toLowerCase();
  if (event.altKey && /^Key[A-Z]$/.test(event.code)) {
    key = event.code.slice(3).toLowerCase();
  }
  return {
    key,
    metaKey: event.metaKey,
    ctrlKey: event.ctrlKey,
    altKey: event.altKey,
    shiftKey: event.shiftKey,
  };
}

export function keyboardGestureFromEmbeddedDetail(
  detail: EmbeddedManifestShortcutDetail,
): ShortcutGesture | null {
  if (typeof detail.key !== "string" || detail.key.length === 0) return null;
  let key = detail.key.toLowerCase();
  if (detail.altKey === true && typeof detail.code === "string" && /^Key[A-Z]$/.test(detail.code)) {
    key = detail.code.slice(3).toLowerCase();
  }
  return {
    key,
    metaKey: detail.metaKey === true,
    ctrlKey: detail.ctrlKey === true,
    altKey: detail.altKey === true,
    shiftKey: detail.shiftKey === true,
  };
}

function parseShortcut(row: ShortcutEntry): ParsedShortcut | null {
  const keys = row.keys.trim();
  if (/^[A-Za-z]$/.test(keys)) {
    return { key: keys.toLowerCase(), requireCommand: false };
  }
  const commandMatch = keys.match(/^⌘\s+([A-Za-z])$/u);
  if (commandMatch) {
    return { key: commandMatch[1].toLowerCase(), requireCommand: true };
  }
  const commandAltMatch = keys.match(/^⌘\s+⌥\s+([A-Za-z])$/u);
  if (commandAltMatch) {
    return {
      key: commandAltMatch[1].toLowerCase(),
      requireCommand: true,
      requireAlt: true,
    };
  }
  const commandShiftMatch = keys.match(/^⌘\s+⇧\s+([A-Za-z0-9])$/u);
  if (commandShiftMatch) {
    return {
      key: commandShiftMatch[1].toLowerCase(),
      requireCommand: true,
      requireShift: true,
    };
  }
  const altMatch = keys.match(/^⌥\s+([A-Za-z])$/u);
  if (altMatch) {
    return {
      key: altMatch[1].toLowerCase(),
      requireCommand: false,
      requireAlt: true,
    };
  }
  return null;
}

function targetAllowsShortcut(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element) return true;
  return !(
    element.tagName === "INPUT" ||
    element.tagName === "TEXTAREA" ||
    element.tagName === "SELECT" ||
    element.isContentEditable
  );
}

function chartScopeIsClear(): boolean {
  if (typeof document === "undefined") return true;
  return (
    document.querySelector(
      '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]',
    ) === null
  );
}

export function useManifestShortcutDispatch(
  manifest: WorkspaceManifest | null,
  dispatch: DispatchShortcutCommand,
  isCommandEnabled: CommandEnabledPredicate = () => true,
): void {
  useEffect(() => {
    const rows = (manifest?.shortcuts ?? [])
      .filter((row) => row.bound && row.commandId)
      .map((row) => ({ row, parsed: parseShortcut(row) }))
      .filter(
        (entry): entry is { row: ShortcutEntry; parsed: ParsedShortcut } =>
          entry.parsed !== null,
      );
    if (rows.length === 0) return;

    const dispatchGesture = (
      gesture: ShortcutGesture,
      preventDefault: () => void,
    ) => {
      if (
        !gesture.metaKey &&
        !gesture.ctrlKey &&
        !gesture.altKey &&
        spotlightShortcutCoolingDown()
      ) {
        return;
      }
      const key = gesture.key.toLowerCase();
      for (const { row, parsed } of rows) {
        if (parsed.key !== key) continue;
        const commandHeld = gesture.metaKey || gesture.ctrlKey;
        if (parsed.requireCommand !== commandHeld) continue;
        if (Boolean(parsed.requireAlt) !== gesture.altKey) continue;
        if (Boolean(parsed.requireShift) !== gesture.shiftKey) continue;
        if (
          !parsed.requireCommand &&
          !parsed.requireAlt &&
          (gesture.metaKey || gesture.ctrlKey || gesture.altKey)
        ) {
          continue;
        }
        if (parsed.requireAlt && (gesture.metaKey || gesture.ctrlKey)) {
          continue;
        }
        if (!isCommandEnabled(row.commandId ?? "")) return;
        preventDefault();
        dispatch(row.commandId ?? "");
        return;
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || !targetAllowsShortcut(event.target)) return;
      if (!chartScopeIsClear()) return;
      dispatchGesture(keyboardGestureFromEvent(event), () => event.preventDefault());
    };

    const onEmbeddedShortcut = (event: Event) => {
      const detail = (
        event as CustomEvent<EmbeddedManifestShortcutDetail>
      ).detail;
      if (detail?.repeat || !chartScopeIsClear()) return;
      const gesture = keyboardGestureFromEmbeddedDetail(detail ?? {});
      if (!gesture) return;
      dispatchGesture(gesture, () => undefined);
    };

    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener(
      EMBEDDED_MANIFEST_SHORTCUT_EVENT,
      onEmbeddedShortcut,
    );
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener(
        EMBEDDED_MANIFEST_SHORTCUT_EVENT,
        onEmbeddedShortcut,
      );
    };
  }, [manifest, dispatch, isCommandEnabled]);
}
