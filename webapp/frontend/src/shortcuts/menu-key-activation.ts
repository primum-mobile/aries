// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useEffect, useRef } from "react";

import { isAltGraphEvent } from "@/lib/shortcut-display";

type ActivationKeyEvent = Pick<
  KeyboardEvent,
  "key" | "repeat" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey" | "preventDefault"
> & Partial<Pick<KeyboardEvent, "getModifierState">>;

export type MenuKeyActivation = {
  keydown: (event: ActivationKeyEvent) => void;
  keyup: (event: ActivationKeyEvent) => void;
  cancel: () => void;
};

/**
 * Windows menu keys: tapping Alt on its own, or pressing F10, toggles the
 * window's menu. Alt only counts when it is pressed and released with no
 * other key or click in between, so Alt+arrow stepping, Alt+letter
 * shortcuts, Shift+Alt (layout switch) and AltGr typing never open it.
 */
export function createMenuKeyActivation(toggle: () => void): MenuKeyActivation {
  let armed = false;
  return {
    keydown(event) {
      if (event.key === "Alt") {
        if (event.repeat) return;
        armed = !event.ctrlKey && !event.metaKey && !event.shiftKey && !isAltGraphEvent(event);
        return;
      }
      armed = false;
      if (
        event.key === "F10"
        && !event.repeat
        && !event.ctrlKey
        && !event.metaKey
        && !event.shiftKey
        && !event.altKey
      ) {
        event.preventDefault();
        toggle();
      }
    },
    keyup(event) {
      if (event.key !== "Alt") return;
      const tapped = armed;
      armed = false;
      if (!tapped) return;
      event.preventDefault();
      toggle();
    },
    cancel() {
      armed = false;
    },
  };
}

/** Wire the Windows menu keys to the in-page application menu. */
export function useMenuKeyActivation(enabled: boolean, toggle: () => void): void {
  const toggleRef = useRef(toggle);
  useEffect(() => {
    toggleRef.current = toggle;
  }, [toggle]);

  useEffect(() => {
    if (!enabled) return;
    const activation = createMenuKeyActivation(() => toggleRef.current());
    const cancel = () => activation.cancel();
    window.addEventListener("keydown", activation.keydown, true);
    window.addEventListener("keyup", activation.keyup, true);
    window.addEventListener("pointerdown", cancel, true);
    window.addEventListener("wheel", cancel, { capture: true, passive: true });
    window.addEventListener("blur", cancel);
    return () => {
      window.removeEventListener("keydown", activation.keydown, true);
      window.removeEventListener("keyup", activation.keyup, true);
      window.removeEventListener("pointerdown", cancel, true);
      window.removeEventListener("wheel", cancel, true);
      window.removeEventListener("blur", cancel);
    };
  }, [enabled]);
}
