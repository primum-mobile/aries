// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import { expect, test } from "@playwright/test";
import { editorFieldsWithPlace, editorFieldsWithTimezone, editorPlaceRequest, editorTimezoneRequest, invalidateEditorLocation } from "../src/lib/chart/editor-location";

const input = {
  tzauto: true, zt: "zone", lon: 16.3725, lat: 48.2083,
  year: 2026, month: 7, day: 1, hour: 12, minute: 0, second: 0,
  daylightSaving: false, place: "Vienna", tzid: "America/New_York",
};
const zone = { tzid: "Europe/Vienna", plus: true, zoneHour: 1, zoneMin: 0, daylightSaving: true };

test("both coordinate axes and hemisphere changes invalidate the place and its timezone", () => {
  const draft = { lonDec: "16.3725", latDec: "48.2083", place: "Vienna", tzid: "Europe/Vienna", inferPlace: false };
  for (const key of ["lonDeg", "lonMin", "lonSec", "east", "latDeg", "latMin", "latSec", "north"]) {
    const next = invalidateEditorLocation(draft, key);
    expect(next.place).toBe("");
    expect(next.tzid).toBe("");
    expect(next.inferPlace).toBe(true);
    expect(next.lonDec).toBe(key.startsWith("lon") || key === "east" ? "" : draft.lonDec);
    expect(next.latDec).toBe(key.startsWith("lat") || key === "north" ? "" : draft.latDec);
  }
  expect(invalidateEditorLocation(draft, "place")).toEqual(draft);
  expect(invalidateEditorLocation(draft, "altitude")).toBe(draft);
});

test("name inference follows only manual coordinate edits, independently of timezone mode and date", () => {
  const manual = { ...input, inferPlace: true, place: "" };
  const request = editorPlaceRequest(manual);
  expect(request).toBe(JSON.stringify({ lon: input.lon, lat: input.lat }));
  expect(editorPlaceRequest(input)).toBeNull();
  expect(editorPlaceRequest({ ...manual, tzauto: false, year: 300, bc: true })).toBe(request);
  expect(editorPlaceRequest({ ...manual, lon: -73.98 })).not.toBe(request);
  expect(editorPlaceRequest({ ...manual, lat: 91 })).toBeNull();
  expect(editorPlaceRequest({ ...manual, lon: NaN })).toBeNull();
});

test("inferred names preserve exact location and timezone, while explicit edits cancel inference", () => {
  const manual = { ...input, inferPlace: true, place: "", altitude: 123 };
  expect(editorFieldsWithPlace(manual, "Vienna")).toEqual({ ...manual, place: "Vienna", inferPlace: false });
  expect(editorFieldsWithPlace(manual, null)).toBe(manual);
  const edited = invalidateEditorLocation({
    ...manual, lonDec: String(input.lon), latDec: String(input.lat), place: "My place",
  }, "place");
  expect(edited.inferPlace).toBe(false);
  expect(editorPlaceRequest(edited)).toBeNull();
  expect(editorFieldsWithPlace(edited, "Old reply")).toBe(edited);
  const cleared = invalidateEditorLocation({ ...edited, place: "", inferPlace: true }, "place");
  expect(editorFieldsWithPlace(cleared, "Old reply")).toBe(cleared);
});

test("coordinate and civil date changes invalidate zone replies, labels and output values do not", () => {
  const request = editorTimezoneRequest(input);
  expect(editorTimezoneRequest({ ...input, place: "", tzid: "", zoneHour: 4 })).toBe(request);
  for (const change of [{ lon: -73.98 }, { lat: -48.2083 }, { month: 1 }, { hour: 1 }, { cal: "julian" }]) {
    expect(editorTimezoneRequest({ ...input, ...change })).not.toBe(request);
  }
});

test("manual, BC and non-zone clocks bypass automatic timezone requests", () => {
  for (const change of [{ tzauto: false }, { bc: true }, { zt: "lmt" }, { zt: "greenwich" }, { zt: "lat" }]) {
    expect(editorTimezoneRequest({ ...input, ...change })).toBeNull();
    const fields = { ...input, ...change };
    expect(editorFieldsWithTimezone(fields, zone)).toBe(fields);
  }
});

test("display and submit use the resolved zone without feeding its DST output back into request inputs", () => {
  const output = editorFieldsWithTimezone(input, zone);
  expect(output).toEqual({ ...input, ...zone });
  expect(input.daylightSaving).toBe(false);
  expect(output.daylightSaving).toBe(true);
  expect(editorFieldsWithTimezone(input, null)).toBe(input);
});
