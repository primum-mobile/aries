// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

// Graphic Ephemeris hover flag glyph colours. The flag is the plate's detail
// view: its sign and aspect glyphs take the app's chart colours (the lists'
// semantic roles, daemon meta.hoverGlyphColors). Planet glyphs follow the
// view's "hover line colours" choice: the app's chart colour (dignity or
// individual colour, as the lists paint them), or the colour of the curve
// they sit on (ephemeris-ink). Natal marks take the list colour
// (ephemeris-radix radixPointColors); the radix lines are one ink.

import type { EphemerisHoverGlyphColors } from "@/lib/daemon/client";
import { semanticChartColor } from "@/lib/theme/semantic-color";
import type { EphemerisHoverInfo } from "./ephemeris-hit-test";
import type { EphemerisInk } from "./ephemeris-ink";

export type EphemerisHoverGlyphPaint = Readonly<{
  planet?: string;
  sign?: string;
  aspect?: string;
  /** The other body of a planet contact. */
  contactPlanet?: string;
  /** Per part of the natal mark (ephemeris-radix radixPointParts). */
  point: readonly (string | undefined)[];
}>;

export type EphemerisHoverGlyphSources = Readonly<{
  /** Planets in their curve's colour. */
  lineColors: boolean;
  app: EphemerisHoverGlyphColors | null | undefined;
  inks: ReadonlyMap<number, EphemerisInk> | null;
}>;

function appColor(colors: readonly string[] | undefined, roles: readonly (string | null)[] | undefined, index: number | undefined) {
  if (index == null || !colors) return undefined;
  return semanticChartColor(roles?.[index] ?? null, colors[index] || null);
}

function sign12(sign: number | undefined): number | undefined {
  return sign == null || !Number.isFinite(sign) ? undefined : ((Math.trunc(sign) % 12) + 12) % 12;
}

function planetColor(planetId: number | undefined, sign: number | undefined, sources: EphemerisHoverGlyphSources) {
  const index = sign12(sign);
  if (planetId == null || index == null) return undefined;
  const app = sources.app?.planets[String(planetId)];
  const appValue = app ? appColor(app.bySign, app.roleBySign, index) : undefined;
  if (!sources.lineColors) return appValue;
  return sources.inks?.get(planetId)?.bySign[index] ?? appValue;
}

export function ephemerisHoverGlyphPaint(
  info: EphemerisHoverInfo,
  sources: EphemerisHoverGlyphSources,
): EphemerisHoverGlyphPaint {
  const app = sources.app;
  const contact = info.contact;
  return Object.freeze({
    planet: planetColor(info.planetId, info.planetSign, sources),
    sign: appColor(app?.signs.colors, app?.signs.roles, sign12(info.signIndex)),
    aspect: appColor(app?.aspects.colors, app?.aspects.roles, contact?.aspectIndex),
    contactPlanet: contact?.planetId != null
      ? planetColor(contact.planetId, contact.planetSign, sources)
      : undefined,
    point: Object.freeze(
      (contact?.point ?? []).map((part) => {
        if (contact?.planetId != null) return part.font === "morinus" ? planetColor(contact.planetId, contact.planetSign, sources) : undefined;
        if (part.color == null && part.colorRole == null) return undefined;
        return semanticChartColor(part.colorRole ?? null, part.color ?? null);
      }),
    ),
  });
}
