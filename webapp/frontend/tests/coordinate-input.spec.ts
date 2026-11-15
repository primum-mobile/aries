// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import { expect, test } from "@playwright/test";
import { formatCoordinate, parseCoordinate } from "../src/lib/coordinate-input";

test("manual coordinates accept decimal, compact and degree-minute forms", () => {
  expect(parseCoordinate("52.524", "lat")).toBeCloseTo(52.524);
  expect(parseCoordinate("-13.41", "lon")).toBeCloseTo(-13.41);
  expect(parseCoordinate("−13,41", "lon")).toBeCloseTo(-13.41);
  expect(parseCoordinate("52n31", "lat")).toBeCloseTo(52 + 31 / 60);
  expect(parseCoordinate("52°31′N", "lat")).toBeCloseTo(52 + 31 / 60);
  expect(parseCoordinate("33 52 S", "lat")).toBeCloseTo(-(33 + 52 / 60));
  expect(parseCoordinate("13e24", "lon")).toBeCloseTo(13.4);
  expect(parseCoordinate("74 0 36 w", "lon")).toBeCloseTo(-(74 + 36 / 3600));
});

test("manual coordinates reject other axes, ranges and malformed text", () => {
  for (const [text, axis] of [["52n31", "lon"], ["13e24", "lat"], ["91", "lat"], ["181", "lon"], ["52 61", "lat"], ["-52n", "lat"], ["abc", "lat"], ["", "lon"], ["1 2 3 4", "lat"]] as const) {
    expect(parseCoordinate(text, axis), `${text} ${axis}`).toBeNull();
  }
});

test("formatting round-trips and shows seconds only when present", () => {
  expect(formatCoordinate(52 + 31 / 60, "lat")).toBe("52°31′N");
  expect(formatCoordinate(13.41053, "lon")).toBe("13°24′38″E");
  expect(formatCoordinate(-0.1, "lon")).toBe("0°06′W");
  expect(formatCoordinate(-(33 + 52 / 60), "lat")).toBe("33°52′S");
  expect(formatCoordinate(59.99999, "lat")).toBe("60°00′N");
  for (const v of [52.52437, -13.41053, -33.8688]) {
    expect(parseCoordinate(formatCoordinate(v, "lat"), "lat")).toBeCloseTo(v, 3);
  }
});
