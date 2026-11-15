// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useT } from "@/lib/i18n/i18n";
import { resolveShellHost } from "@/lib/shell-host";

/**
 * Vanilla mode runs the desktop app as a fresh install (native side:
 * src-tauri/src/vanilla.rs). The undocumented ⌥⇧⌘V (Ctrl+Alt+Shift+V) asks to
 * restart into it, or out of it; the titlebar marker does the same while it
 * is on. The restart goes through the normal quit flow.
 */
type VanillaState = { active: boolean; confirming: boolean };

let state: VanillaState = { active: false, confirming: false };
const listeners = new Set<() => void>();
const SERVER_STATE: VanillaState = { active: false, confirming: false };

function update(next: Partial<VanillaState>) {
  state = { ...state, ...next };
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useVanillaMode(): VanillaState {
  return React.useSyncExternalStore(subscribe, () => state, () => SERVER_STATE);
}

export function requestVanillaToggle() {
  update({ confirming: true });
}

function isToggleShortcut(event: KeyboardEvent) {
  return !event.repeat && event.code === "KeyV" && event.altKey && event.shiftKey
    && (event.metaKey || event.ctrlKey);
}

export function VanillaModeController() {
  const t = useT();
  const { active, confirming } = useVanillaMode();

  React.useEffect(() => {
    let cancelled = false;
    void resolveShellHost().vanillaMode().then((value) => {
      if (!cancelled) update({ active: value });
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isToggleShortcut(event) || resolveShellHost().kind !== "tauri") return;
      event.preventDefault();
      event.stopPropagation();
      requestVanillaToggle();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);

  const restart = () => {
    update({ confirming: false });
    void resolveShellHost().restartVanillaMode(!active);
  };

  return (
    <Dialog open={confirming} onOpenChange={(open) => { if (!open) update({ confirming: false }); }}>
      <DialogContent size="md" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{t(active ? "vanilla.leaveTitle" : "vanilla.enterTitle")}</DialogTitle>
          <DialogDescription>
            {t(active ? "vanilla.leaveDescription" : "vanilla.enterDescription")}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => update({ confirming: false })}>
            {t("vanilla.cancel")}
          </Button>
          <Button type="button" onClick={restart}>
            {t("vanilla.restart")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
