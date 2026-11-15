// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import { expect, test } from "@playwright/test";

import { createMenuKeyActivation } from "../src/shortcuts/menu-key-activation";

type Init = {
  key: string;
  repeat?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  altGraph?: boolean;
};

function key({ altGraph = false, ...init }: Init) {
  const event = {
    repeat: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    prevented: false,
    getModifierState: (modifier: string) => modifier === "AltGraph" && altGraph,
    preventDefault() {
      event.prevented = true;
    },
    ...init,
  };
  return event;
}

function harness() {
  let toggles = 0;
  const activation = createMenuKeyActivation(() => {
    toggles += 1;
  });
  return { activation, toggles: () => toggles };
}

test("a lone Alt tap toggles the menu and claims the keyup", () => {
  const { activation, toggles } = harness();
  activation.keydown(key({ key: "Alt", altKey: true }));
  activation.keydown(key({ key: "Alt", altKey: true, repeat: true }));
  const up = key({ key: "Alt" });
  activation.keyup(up);
  expect(toggles()).toBe(1);
  expect(up.prevented).toBe(true);
  // The next tap closes it again.
  activation.keydown(key({ key: "Alt", altKey: true }));
  activation.keyup(key({ key: "Alt" }));
  expect(toggles()).toBe(2);
});

test("Alt used as a modifier never opens the menu", () => {
  const { activation, toggles } = harness();
  // Alt+← minute stepping.
  activation.keydown(key({ key: "Alt", altKey: true }));
  activation.keydown(key({ key: "ArrowLeft", altKey: true }));
  activation.keyup(key({ key: "Alt" }));
  // Shift+Alt switches the keyboard layout.
  activation.keydown(key({ key: "Shift", shiftKey: true }));
  activation.keydown(key({ key: "Alt", altKey: true, shiftKey: true }));
  activation.keyup(key({ key: "Alt", shiftKey: true }));
  // Alt+click.
  activation.keydown(key({ key: "Alt", altKey: true }));
  activation.cancel();
  activation.keyup(key({ key: "Alt" }));
  expect(toggles()).toBe(0);
});

test("AltGr typing never opens the menu", () => {
  const { activation, toggles } = harness();
  // Windows sends a synthetic Ctrl, then AltGraph, then the character.
  activation.keydown(key({ key: "Control", ctrlKey: true }));
  activation.keydown(key({ key: "AltGraph", ctrlKey: true, altKey: true, altGraph: true }));
  activation.keydown(key({ key: "@", ctrlKey: true, altKey: true, altGraph: true }));
  activation.keyup(key({ key: "AltGraph" }));
  // Some layouts report the key as "Alt" with the AltGraph modifier state.
  activation.keydown(key({ key: "Alt", altKey: true, altGraph: true }));
  activation.keyup(key({ key: "Alt" }));
  expect(toggles()).toBe(0);
});

test("F10 toggles the menu; modified F10 does not", () => {
  const { activation, toggles } = harness();
  const f10 = key({ key: "F10" });
  activation.keydown(f10);
  expect(toggles()).toBe(1);
  expect(f10.prevented).toBe(true);
  activation.keydown(key({ key: "F10", shiftKey: true }));
  activation.keydown(key({ key: "F10", ctrlKey: true }));
  activation.keydown(key({ key: "F10", repeat: true }));
  expect(toggles()).toBe(1);
});
