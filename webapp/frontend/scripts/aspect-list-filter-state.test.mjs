// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";

import {
  defaultAspectListSecondaryRingIncluded,
  isAspectListRowIncluded,
  isAspectListSecondaryRingFilterId,
} from "../src/lib/aspect-list-filter-state.mjs";

const noSecondaryRing = new Set();
const fixedStars = new Set(["outer:primary:fixstar"]);
const arabicParts = new Set(["outer:primary:arabic_part"]);

test("Focus All includes every ordinary current point family", () => {
  const focused = new Set();
  assert.equal(
    isAspectListRowIncluded(
      ["planet:sun", "point:fortune"],
      focused,
      noSecondaryRing,
      false,
    ),
    true,
  );
  assert.equal(
    isAspectListRowIncluded(
      ["point:syzygy", "point:vertex"],
      focused,
      noSecondaryRing,
      false,
    ),
    true,
  );
});

test("the active secondary-ring family is admitted under its contextual toggle", () => {
  assert.equal(
    isAspectListRowIncluded(
      ["planet:sun", "outer:primary:fixstar"],
      new Set(),
      fixedStars,
      true,
    ),
    true,
  );
  assert.equal(
    isAspectListRowIncluded(
      ["planet:sun", "outer:primary:fixstar"],
      new Set(),
      fixedStars,
      false,
    ),
    false,
  );
});

test("one focused point includes every current row involving that endpoint", () => {
  const focused = new Set(["planet:sun"]);
  assert.equal(
    isAspectListRowIncluded(
      ["planet:sun", "planet:moon"],
      focused,
      noSecondaryRing,
      false,
    ),
    true,
  );
  assert.equal(
    isAspectListRowIncluded(
      ["planet:moon", "planet:mars"],
      focused,
      noSecondaryRing,
      false,
    ),
    false,
  );
});

test("multiple focused points form a union across either endpoint", () => {
  const focused = new Set(["planet:sun", "planet:mercury"]);
  assert.equal(
    isAspectListRowIncluded(
      ["planet:sun", "planet:moon"],
      focused,
      noSecondaryRing,
      false,
    ),
    true,
  );
  assert.equal(
    isAspectListRowIncluded(
      ["planet:mercury", "planet:venus"],
      focused,
      noSecondaryRing,
      false,
    ),
    true,
  );
  assert.equal(
    isAspectListRowIncluded(
      ["planet:moon", "planet:venus"],
      focused,
      noSecondaryRing,
      false,
    ),
    false,
  );
});

test("AND Focus keeps only relationships between selected endpoints", () => {
  const focused = new Set(["planet:sun", "planet:mercury", "planet:mars"]);
  assert.equal(
    isAspectListRowIncluded(
      ["planet:sun", "planet:mercury"],
      focused,
      noSecondaryRing,
      false,
      [],
      false,
      "and",
    ),
    true,
  );
  assert.equal(
    isAspectListRowIncluded(
      ["planet:sun", "planet:moon"],
      focused,
      noSecondaryRing,
      false,
      [],
      false,
      "and",
    ),
    false,
  );
});

test("AND Focus supports a grouped point endpoint", () => {
  const focused = new Set(["planet:mercury", "angles"]);
  assert.equal(
    isAspectListRowIncluded(
      ["planet:mercury", "angles"],
      focused,
      noSecondaryRing,
      false,
      [],
      false,
      "and",
    ),
    true,
  );
});

test("AND Focus treats two grouped-angle endpoints as selected", () => {
  const focused = new Set(["angles", "planet:mercury"]);
  assert.equal(
    isAspectListRowIncluded(
      ["angles"],
      focused,
      noSecondaryRing,
      false,
      [],
      false,
      "and",
      [["angles"], ["angles"]],
    ),
    true,
  );
});

test("AND falls back to involving-point behavior for a singleton", () => {
  const focused = new Set(["planet:sun"]);
  assert.equal(
    isAspectListRowIncluded(
      ["planet:sun", "planet:moon"],
      focused,
      noSecondaryRing,
      false,
      [],
      false,
      "and",
      [["planet:sun"], ["planet:moon"]],
    ),
    true,
  );
});

test("Rx also narrows an AND relationship", () => {
  const focused = new Set(["planet:sun", "planet:mercury"]);
  assert.equal(
    isAspectListRowIncluded(
      ["planet:sun", "planet:mercury"],
      focused,
      noSecondaryRing,
      false,
      ["", ""],
      true,
      "and",
      [["planet:sun"], ["planet:mercury"]],
    ),
    false,
  );
  assert.equal(
    isAspectListRowIncluded(
      ["planet:sun", "planet:mercury"],
      focused,
      noSecondaryRing,
      false,
      ["", "R"],
      true,
      "and",
      [["planet:sun"], ["planet:mercury"]],
    ),
    true,
  );
});

test("Rx includes rows with an R, SR, or SD endpoint", () => {
  for (const marker of ["R", "SR", "SD"]) {
    assert.equal(
      isAspectListRowIncluded(
        ["planet:sun", "planet:moon"],
        new Set(),
        noSecondaryRing,
        false,
        ["", marker],
        true,
      ),
      true,
    );
  }
  assert.equal(
    isAspectListRowIncluded(
      ["planet:sun", "planet:moon"],
      new Set(),
      noSecondaryRing,
      false,
      ["S", ""],
      true,
    ),
    false,
  );
});

test("Rx narrows named point Focus instead of widening it", () => {
  const focused = new Set(["planet:sun"]);
  assert.equal(
    isAspectListRowIncluded(
      ["planet:sun", "planet:moon"],
      focused,
      noSecondaryRing,
      false,
      ["", ""],
      true,
    ),
    false,
  );
  assert.equal(
    isAspectListRowIncluded(
      ["planet:venus", "planet:mars"],
      focused,
      noSecondaryRing,
      false,
      ["R", ""],
      true,
    ),
    false,
  );
  assert.equal(
    isAspectListRowIncluded(
      ["planet:sun", "planet:mars"],
      focused,
      noSecondaryRing,
      false,
      ["", "R"],
      true,
    ),
    true,
  );
  assert.equal(
    isAspectListRowIncluded(
      ["planet:venus", "planet:mars"],
      focused,
      noSecondaryRing,
      false,
      ["S", ""],
      true,
    ),
    false,
  );
});

test("Rx cannot bypass the active secondary-ring gate", () => {
  assert.equal(
    isAspectListRowIncluded(
      ["planet:sun", "outer:primary:arabic_part"],
      new Set(),
      arabicParts,
      false,
      ["R", ""],
      true,
    ),
    false,
  );
});

test("endpoint order does not change a focus match", () => {
  const focused = new Set(["planet:sun"]);
  assert.equal(
    isAspectListRowIncluded(
      ["planet:moon", "planet:sun"],
      focused,
      noSecondaryRing,
      false,
    ),
    true,
  );
});

test("inactive secondary-ring families never leak into the visible projection", () => {
  const focused = new Set(["planet:sun"]);
  assert.equal(
    isAspectListRowIncluded(
      ["planet:sun", "outer:primary:arabic_part"],
      focused,
      fixedStars,
      true,
    ),
    false,
  );
});

test("the same secondary-ring family on the sending role cannot leak through", () => {
  assert.equal(
    isAspectListRowIncluded(
      ["planet:mars", "outer:primary:arabic_part"],
      new Set(),
      arabicParts,
      true,
    ),
    true,
  );
  assert.equal(
    isAspectListRowIncluded(
      ["planet:mars", "outer:outer:arabic_part"],
      new Set(),
      arabicParts,
      true,
    ),
    false,
  );
});

test("Focus remains an ordinary endpoint union after the ring gate", () => {
  const focused = new Set(["planet:sun"]);
  assert.equal(
    isAspectListRowIncluded(
      ["planet:sun", "outer:primary:arabic_part"],
      focused,
      arabicParts,
      false,
    ),
    false,
  );
  assert.equal(
    isAspectListRowIncluded(
      ["planet:sun", "outer:primary:arabic_part"],
      focused,
      arabicParts,
      true,
    ),
    true,
  );
  assert.equal(
    isAspectListRowIncluded(
      ["planet:sun", "outer:primary:arabic_part"],
      new Set(["planet:moon"]),
      arabicParts,
      true,
    ),
    false,
  );
});

test("Arabic Parts default off while other secondary-ring modes default on", () => {
  assert.equal(defaultAspectListSecondaryRingIncluded("arabic_parts"), false);
  assert.equal(defaultAspectListSecondaryRingIncluded("fixstars"), true);
  assert.equal(defaultAspectListSecondaryRingIncluded("hybrid_hits"), true);
  assert.equal(isAspectListSecondaryRingFilterId("outer:outer:midpoint"), true);
  assert.equal(isAspectListSecondaryRingFilterId("point:vertex"), false);
});
