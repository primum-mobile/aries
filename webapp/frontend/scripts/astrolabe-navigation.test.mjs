// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";

import {
  navigateAstrolabe,
  registerAstrolabeNavigator,
} from "../src/lib/chart/astrolabe-navigation.mjs";

test("routes navbar steps with modifiers to the open Astrolabe view", () => {
  const received = [];
  const unregister = registerAstrolabeNavigator("astrolabe-1", (key, modifiers) => {
    received.push([key, modifiers]);
    return true;
  });
  assert.equal(navigateAstrolabe("astrolabe-1", "right", { shift: true }), true);
  assert.equal(navigateAstrolabe("astrolabe-1", "up"), true);
  assert.equal(navigateAstrolabe("astrolabe-1", "space"), true);
  assert.deepEqual(received, [["right", { shift: true }], ["up", {}], ["space", {}]]);
  assert.equal(navigateAstrolabe("other", "left"), false);
  unregister();
  assert.equal(navigateAstrolabe("astrolabe-1", "left"), false);
});

test("a stale unregister keeps the replacement view's navigator", () => {
  const first = registerAstrolabeNavigator("astrolabe-2", () => true);
  let replaced = 0;
  registerAstrolabeNavigator("astrolabe-2", () => { replaced += 1; return true; });
  first();
  assert.equal(navigateAstrolabe("astrolabe-2", "left"), true);
  assert.equal(replaced, 1);
});
