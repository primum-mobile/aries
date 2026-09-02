// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import { expect, test } from "@playwright/test";

import {
  automaticCalendarForDate,
  calendarAfterDateChange,
} from "../src/lib/chart/calendar-auto";

const policy = {
  cutover: { year: 1582, month: 10, day: 15 },
  before: "julian",
  from: "gregorian",
};

test("calendar auto-selection follows the conventional reform boundary", () => {
  expect(
    automaticCalendarForDate(
      { bc: false, year: "1582", month: "10", day: "4" },
      policy,
    ),
  ).toBe("julian");
  expect(
    automaticCalendarForDate(
      { bc: false, year: "1582", month: "10", day: "15" },
      policy,
    ),
  ).toBe("gregorian");
});

test("BC dates are Julian and incomplete dates do not force a calendar", () => {
  expect(
    automaticCalendarForDate(
      { bc: true, year: "1200", month: "6", day: "7" },
      policy,
    ),
  ).toBe("julian");
  expect(
    automaticCalendarForDate(
      { bc: false, year: "", month: "6", day: "7" },
      policy,
    ),
  ).toBeNull();
});

test("a manual calendar choice survives later date edits", () => {
  expect(
    calendarAfterDateChange(
      { bc: false, year: "1700", month: "1", day: "1" },
      policy,
      "julian",
      true,
    ),
  ).toBe("julian");
});
