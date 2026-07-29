// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  navigateGraphicEphemeris,
  registerGraphicEphemerisNavigator,
} from "../src/lib/chart/graphic-ephemeris-navigation.mjs";

test("routes active-document arrow intents without requiring plot focus", () => {
  const received = [];
  const unregister = registerGraphicEphemerisNavigator("ephemeris-1", (key) => {
    received.push(key);
  });

  assert.equal(navigateGraphicEphemeris("ephemeris-1", "left"), true);
  assert.equal(navigateGraphicEphemeris("ephemeris-1", "up"), true);
  assert.deepEqual(received, ["left", "up"]);

  unregister();
  assert.equal(navigateGraphicEphemeris("ephemeris-1", "right"), false);
});

test("stale cleanup cannot remove a replacement navigator", () => {
  const received = [];
  const unregisterFirst = registerGraphicEphemerisNavigator(
    "ephemeris-1",
    () => received.push("first"),
  );
  const unregisterSecond = registerGraphicEphemerisNavigator(
    "ephemeris-1",
    () => received.push("second"),
  );

  unregisterFirst();
  assert.equal(navigateGraphicEphemeris("ephemeris-1", "down"), true);
  assert.deepEqual(received, ["second"]);

  unregisterSecond();
});

test("global arrows and burst completion stay wired to the mounted ephemeris", async () => {
  const [homeSource, ephemerisSource] = await Promise.all([
    readFile(
      new URL("../src/components/workshell/home-client.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL(
        "../src/components/workshell/graph-ephemeris-view.tsx",
        import.meta.url,
      ),
      "utf8",
    ),
  ]);

  assert.match(
    homeSource,
    /activeDocument\?\.kind === "ephemeris"[\s\S]*navigateGraphicEphemeris\(/,
  );
  assert.match(ephemerisSource, /registerGraphicEphemerisNavigator\(/);
  assert.match(
    ephemerisSource,
    /heldNavigationKeysRef\.current\.size > 0[\s\S]*deferredNavigationTailRef\.current = runPostPaintTail/,
  );
  assert.match(
    ephemerisSource,
    /pendingAnchorPersistenceRef\.current = next/,
  );
});
