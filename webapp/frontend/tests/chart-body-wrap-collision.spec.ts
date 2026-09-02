// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import { expect, test } from "@playwright/test";

import { computeHitRegions } from "../src/lib/chart/draw-chart";
import type { Chart, ChartRenderSnapshot } from "../src/lib/chart/types";
import { DEFAULT_WHEEL_RENDER_STYLE } from "../src/lib/chart/wheel-render-style";

const planet = (
  id: Chart["planets"][number]["id"],
  seId: number,
  longitude: number,
): Chart["planets"][number] => ({
  id,
  seId,
  longitude,
  latitude: 0,
  speed: 1,
  glyph: id.slice(0, 1).toUpperCase(),
  degText: String(Math.floor(longitude % 30)),
  minText: "00",
});

test("Anglo collision layout keeps the Pisces-Aries wrap pair separated", () => {
  const chart = {
    meta: {
      name: "wrap collision",
      kind: "radix",
      datetime: "1583-02-23T08:28:46Z",
      dateDisplay: "23.February.1583",
      timeDisplay: "08:28:46",
      place: "Villefranche-sur-Saône",
      placeCoords: "04°43'E, 45°59'N",
      latitude: 45.98,
      longitude: 4.72,
      obliquity: 23.5,
      buildStamp: "",
      age: "",
    },
    planets: [
      planet("uranus", 7, 323),
      planet("venus", 3, 327),
      planet("mercury", 2, 330),
      planet("sun", 0, 334),
      planet("jupiter", 5, 334.2),
      planet("saturn", 6, 342),
      planet("moon", 1, 346),
      planet("pluto", 9, 4),
      planet("chiron", 15, 11),
      // Forces the fixed-cusp settling phase that previously reran only the
      // linear neighbors and forgot the final↔first circular pair.
      planet("mars", 4, 100),
    ],
    angles: { asc: 357, dsc: 177, mc: 270, ic: 90, armc: 270, vertex: 0 },
    houses: {
      system: "R",
      cusps: [357, 30, 60, 90, 100, 150, 177, 210, 240, 270, 300, 330],
    },
    aspects: [],
    options: {
      uranus: true,
      pluto: 0,
      signVariant: 1,
      theme: 2,
      showHouses: true,
      showPositions: true,
      showAspects: false,
      showTerms: false,
      showDecans: false,
    },
  } satisfies Chart;
  const snapshot = {
    primaryChart: chart,
    displayDatetime: chart.meta.datetime,
    renderVariant: "round-anglo",
    overlayRenderMode: "full",
    outerRingMode: "none",
  } satisfies ChartRenderSnapshot;

  const regions = computeHitRegions(snapshot, {
    width: 1000,
    height: 1000,
    renderStyle: DEFAULT_WHEEL_RENDER_STYLE,
    textsize: (_text, options) => {
      const size = Number(options?.size ?? 14);
      return [size * 1.7, size * 1.25];
    },
  });
  const moon = regions.find((region) => region.kind === "planet" && region.planetId === "moon");
  const pluto = regions.find((region) => region.kind === "planet" && region.planetId === "pluto");
  expect(moon).toBeDefined();
  expect(pluto).toBeDefined();
  const overlaps =
    moon!.left! < pluto!.left! + pluto!.width! &&
    moon!.left! + moon!.width! > pluto!.left! &&
    moon!.top! < pluto!.top! + pluto!.height! &&
    moon!.top! + moon!.height! > pluto!.top!;
  expect(overlaps).toBe(false);
});
