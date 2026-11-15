// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import {
  dispatchAstrolabeDisplayCommand,
  registerAstrolabeDisplayCommands,
} from "../src/lib/chart/astrolabe-display-commands.mjs";

test("display shortcuts reach only the selected retained Astrolabe", () => {
  const first = [], second = [];
  const unregisterFirst = registerAstrolabeDisplayCommands("first", (command) => first.push(command));
  const unregisterSecond = registerAstrolabeDisplayCommands("second", (command) => second.push(command));
  try {
    assert.equal(dispatchAstrolabeDisplayCommand("second", "toggle-houses"), true);
    assert.equal(dispatchAstrolabeDisplayCommand("second", "toggle-aspects"), true);
    assert.equal(dispatchAstrolabeDisplayCommand("first", "toggle-minor-aspects"), true);
    assert.deepEqual(first, ["toggle-minor-aspects"]);
    assert.deepEqual(second, ["toggle-houses", "toggle-aspects"]);
    assert.equal(dispatchAstrolabeDisplayCommand("second", "transits"), false);
    assert.equal(dispatchAstrolabeDisplayCommand("second", "table:aspect_list"), false);
    assert.deepEqual(second, ["toggle-houses", "toggle-aspects"]);
  } finally {
    unregisterFirst();
    unregisterSecond();
  }
});

test("unmounted display commands stay owned by the Astrolabe without source-chart fallthrough", () => {
  for (const command of ["toggle-houses", "toggle-aspects", "toggle-minor-aspects"]) {
    assert.equal(dispatchAstrolabeDisplayCommand("unmounted", command), true);
  }
  assert.equal(dispatchAstrolabeDisplayCommand("unmounted", "directions"), false);
});

test("stale cleanup cannot disconnect a replacement view", () => {
  const first = registerAstrolabeDisplayCommands("replacement", () => assert.fail("stale view"));
  const received = [];
  const second = registerAstrolabeDisplayCommands("replacement", (command) => received.push(command));
  first();
  dispatchAstrolabeDisplayCommand("replacement", "toggle-houses");
  assert.deepEqual(received, ["toggle-houses"]);
  second();
  dispatchAstrolabeDisplayCommand("replacement", "toggle-houses");
  assert.deepEqual(received, ["toggle-houses"]);
});
