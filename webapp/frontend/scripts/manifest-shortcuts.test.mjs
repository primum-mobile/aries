// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";

function keyboardGestureFromEvent(event) {
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

assert.equal(
  keyboardGestureFromEvent({
    key: "´",
    code: "KeyE",
    metaKey: false,
    ctrlKey: false,
    altKey: true,
    shiftKey: false,
  }).key,
  "e",
);

assert.equal(
  keyboardGestureFromEvent({
    key: "®",
    code: "KeyR",
    metaKey: false,
    ctrlKey: false,
    altKey: true,
    shiftKey: false,
  }).key,
  "r",
);

console.log("manifest-shortcuts.test.mjs: ok");
