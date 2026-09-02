// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Declared radial band model for the chart wheel.
 *
 * Stage 1 of `doc/ui-specs/style-editor-relational-geometry-research.md`:
 * this module states the containment structure that
 * `resolveCanonicalWheelRingSet` in `wheel-render-style.ts` encodes as inline
 * arithmetic. The wheel is an ordered stack of annular bands from the canvas
 * edge to the hub; every `WheelRingSet` radius is either a band edge or an
 * anchor that lives inside a declared band span.
 *
 * This module deliberately does NOT change any number. The canonical
 * resolvers here are band-first transcriptions of the exact renderer
 * arithmetic, and `scripts/wheel-layout-model-parity.test.mjs` proves they
 * reproduce `resolveWheelRingSet` bit-for-bit across the full state matrix,
 * including randomized geometry profiles. Until the render authority flips
 * (stage 2), any intentional change to the renderer geometry must be mirrored
 * here — the parity contract turns silent drift into a loud test failure.
 */

// Type-only: this module is the upstream geometry authority, so it must not
// take a runtime dependency on the renderer that consumes it.
import type {
  WheelGeometryInput,
  WheelRenderStyle,
  WheelRingSet,
  WheelTypographyProfile,
} from "./wheel-render-style";

/**
 * Radial bands, outer edge of the canvas to the hub. A given layout uses an
 * ordered subset of these.
 */
export type WheelBandId =
  | "margin"
  | "outerHouses"
  | "outerBodies"
  | "zodiac"
  | "terms"
  | "decans"
  | "cuspRuler"
  | "cuspLabels"
  | "bodies"
  | "aspects"
  | "houses"
  | "hub";

/** The five structurally distinct radial layouts the renderer paints. */
export type WheelLayoutFamily =
  | "classicSingle"
  | "classicComparison"
  | "angloSingle"
  | "angloComparisonNoHouses"
  | "angloComparisonWithHouses";

export interface ResolvedWheelBand {
  readonly id: WheelBandId;
  /** Outer edge radius in canvas px. */
  readonly outer: number;
  /** Inner edge radius in canvas px. Always <= outer for a valid layout. */
  readonly inner: number;
  /** False when the band's extent is gated off in this preview state. */
  readonly visible: boolean;
  /** Semantic paint classes whose occurrences live inside this band. */
  readonly contents: readonly string[];
}

export interface ResolvedWheelLayout {
  readonly family: WheelLayoutFamily;
  /** Ordered outer -> inner. */
  readonly bands: readonly ResolvedWheelBand[];
  /** The exact ring set the renderer paints from. */
  readonly rings: Readonly<WheelRingSet>;
  /**
   * Ring fields that are band edges break the band order when they violate
   * it; every entry names the band pair whose edges crossed.
   */
  readonly violations: readonly WheelLayoutViolation[];
}

export interface WheelLayoutViolation {
  readonly kind: "band-inverted" | "anchor-outside-band";
  readonly bandId: WheelBandId;
  readonly detail: string;
}

/**
 * Which contiguous band span each WheelRingSet anchor is declared to occupy.
 * Edges themselves (r30, r0, ...) are not listed; they are the band
 * boundaries. A multi-band span records an anchor that legitimately travels
 * across neighbouring bands as preview state changes.
 */
export type WheelAnchorSpan = readonly WheelBandId[];

const CLASSIC_ANCHOR_SPANS: Readonly<Record<string, WheelAnchorSpan>> =
  Object.freeze({
    rOuterLine: ["margin", "outerHouses", "outerBodies"],
    rAntis: ["margin", "outerHouses", "outerBodies"],
    rAntisLines: ["margin", "outerHouses", "outerBodies"],
    rSign: ["zodiac"],
    rASCMC: ["zodiac"],
    rArrow: ["margin", "zodiac"],
    rOuter0: ["zodiac"],
    rOuter1: ["zodiac"],
    rOuter5: ["zodiac"],
    rOuter10: ["zodiac"],
    r1: ["zodiac"],
    r5: ["zodiac"],
    r10: ["zodiac"],
    rTermsPlanet: ["terms"],
    rDecansPlanet: ["decans"],
    rPlanet: ["bodies"],
    rLLine: ["bodies"],
    rLLine2: ["bodies"],
    // Compact's position/minute/retrograde column hangs off the bodies band
    // inner edge and can sink through the aspect zone into the house band and
    // hub when subdivisions are dense; the spans state that honestly.
    rRetr: ["bodies", "aspects", "houses", "hub"],
    rPos: ["bodies", "aspects", "houses"],
    rPosDeg: ["bodies", "aspects", "houses"],
    rPosMin: ["bodies", "aspects", "houses", "hub"],
    // Compact's absolute angle/position lanes sink below the base ring when
    // subdivisions are dense and the hub is not lowered, so the lane spans
    // honestly include the hub.
    rAspAscMC: ["aspects", "houses", "hub"],
    rPosAscMC: ["aspects", "houses", "hub"],
    rPosAscMCMin: ["aspects", "houses", "hub"],
    rPosHouses: ["aspects", "houses", "hub"],
    rPosHousesMin: ["aspects", "houses", "hub"],
    rHouseName: ["houses"],
    // Comparison outer zone.
    rOuterHouseName: ["outerHouses"],
    rOuterPlanet: ["outerBodies"],
    rOuterASCMC: ["outerHouses", "outerBodies"],
    rOuterArrow: ["margin", "outerHouses", "outerBodies"],
    rOuterRetr: ["outerBodies"],
    rOuterMin: ["outerBodies", "zodiac"],
  });

const ANGLO_ANCHOR_SPANS: Readonly<Record<string, WheelAnchorSpan>> =
  Object.freeze({
    rOuterLine: ["margin", "outerHouses", "outerBodies"],
    rAntis: ["margin", "outerHouses", "outerBodies"],
    rAntisLines: ["margin", "outerHouses", "outerBodies"],
    rArrow: ["margin", "outerHouses", "outerBodies"],
    // The outer degree ruler sits in the margin when a comparison outer ring
    // exists and inside the sign band when it does not, so its span covers
    // both. All four terminals must travel together or the reattachment below
    // rebuilds the intermediate ticks between a moved and a stale end.
    rOuter0: ["margin", "outerHouses", "outerBodies", "zodiac"],
    rOuter1: ["margin", "outerHouses", "outerBodies", "zodiac"],
    rOuter5: ["margin", "outerHouses", "outerBodies", "zodiac"],
    rOuter10: ["margin", "outerHouses", "outerBodies", "zodiac"],
    rSign: ["zodiac"],
    r1: ["zodiac"],
    r5: ["zodiac"],
    r10: ["zodiac"],
    rTermsPlanet: ["terms"],
    rDecansPlanet: ["decans"],
    rCuspLabel: ["cuspLabels"],
    rPosHouses: ["cuspLabels"],
    rLLine: ["cuspLabels", "bodies"],
    rPlanet: ["bodies"],
    rRetr: ["bodies"],
    rPos: ["bodies"],
    rPosAscMC: ["bodies", "houses"],
    rHouseName: ["houses"],
    rLLine2: ["hub"],
    rAspAscMC: ["hub"],
    // Comparison outer zone. The Anglo outer house-number lane deliberately
    // sits below the outer house ring, between the outer bodies and the
    // restrained cusp endpoint.
    rOuterHouseName: ["outerHouses", "outerBodies"],
    rOuterPlanet: ["margin", "outerHouses", "outerBodies"],
    rOuterASCMC: ["margin", "outerHouses", "outerBodies"],
    rOuterArrow: ["margin", "outerHouses", "outerBodies"],
    rOuterRetr: ["margin", "outerHouses", "outerBodies"],
    rOuterMin: ["margin", "outerHouses", "outerBodies"],
  });

export function wheelAnchorSpans(
  profile: WheelTypographyProfile,
): Readonly<Record<string, WheelAnchorSpan>> {
  return profile === "anglo" ? ANGLO_ANCHOR_SPANS : CLASSIC_ANCHOR_SPANS;
}

/**
 * Smallest thickness any band may be squeezed to. This is the shipped clamp
 * gap, kept byte-identical so the floor is not silently redefined while the
 * solver around it changes.
 */
export function wheelBandFloor(maxRadius: number): number {
  return Math.max(1, maxRadius * 0.005);
}

// NOTE: this is a *structural* floor — it stops a band inverting, and 0.5% of
// the radius is ample for that. It is not enough for a band that must contain
// a symbol: a decan ring squeezed to two pixels still draws its boundaries and
// shows a glyph nobody can read. Giving glyph-bearing bands a larger minimum
// requires per-interval gaps in solveOrderedBoundaries, which currently
// assumes a uniform gap (`gap * n`), so it is a solver change rather than a
// constant change and is deliberately not folded into the ceiling work.

export interface WheelBoundarySolveOptions {
  /** Radius of the enclosing edge; no boundary may reach it. */
  readonly outerLimit: number;
  /** Radius of the innermost edge, normally the wheel centre. */
  readonly innerLimit: number;
  readonly gap: number;
  /**
   * Minimum separation per interval, when the bands do not all need the same
   * room. Index k is the space below boundary k-1 and above boundary k, so
   * index 0 is between the outer limit and the outermost boundary and index
   * `count` is between the innermost boundary and the inner limit — one more
   * entry than there are boundaries.
   *
   * A uniform structural floor is wrong for a band that has to show a glyph:
   * it lets the decan ring compress until its rulers have nowhere to sit while
   * a plain divider next to it keeps the same room it never needed. When
   * omitted, `gap` is used for every interval and the result is unchanged.
   */
  readonly gaps?: readonly number[];
  /**
   * Index of the boundary being actively dragged, if any.
   *
   * Without this the stack is order-independent and every pin holds its
   * authored radius, so a boundary driven into its neighbour simply stops.
   * That is right for resolving a stored profile, and wrong for a live drag:
   * pushing the innermost circle outward should carry the others with it.
   *
   * When present, the dragged boundary takes precedence and its neighbours
   * yield — each keeping at least `gap` from the next and never passing the
   * outer or inner limit. A neighbour is displaced only as far as it must be,
   * so an authored radius with room to spare is left where its author put it.
   */
  readonly pushIndex?: number;
}

export interface WheelBoundarySolution {
  /** Final radius per boundary, ordered outer to inner. */
  readonly resolved: readonly number[];
  /** Legal interval per boundary, for hard-stopping a live drag. */
  readonly limits: readonly Readonly<{ min: number; max: number }>[];
  /** True where an authored pin could not be honoured in full. */
  readonly blocked: readonly boolean[];
}

/**
 * Place an ordered stack of boundaries from an authored pin set.
 *
 * A pin is an explicit boundary radius the user authored; an unpinned boundary
 * keeps its canonical position and simply yields, because the wheel hub is the
 * flexible band that absorbs the residual.
 *
 * Each boundary is bounded by the *authored pins* on either side and by the
 * enclosing limits, never by a neighbour's already-solved value. That is what
 * makes the result independent of the order edits were made in: the previous
 * sequential clamp compared ring n against the clamped ring n-1, so the same
 * two edits applied in the opposite order produced a different wheel and some
 * legal configurations were unreachable.
 *
 * `limits` reports the closed-form interval each boundary may occupy, so a
 * drag can stop exactly at the wall instead of being silently repaired after
 * the fact.
 */
export function solveOrderedBoundaries(
  canonical: readonly number[],
  pins: readonly (number | undefined)[],
  options: WheelBoundarySolveOptions,
): WheelBoundarySolution {
  const count = canonical.length;
  const { outerLimit, innerLimit, gap } = options;
  const resolved: number[] = [];
  const limits: { min: number; max: number }[] = [];
  const blocked: boolean[] = [];

  // Minimum separation for each of the count+1 intervals. Falling back to the
  // uniform gap keeps every existing caller bit-identical.
  const perInterval: number[] = [];
  for (let k = 0; k <= count; k += 1) {
    const supplied = options.gaps?.[k];
    perInterval.push(
      supplied !== undefined && Number.isFinite(supplied) && supplied >= 0
        ? supplied
        : gap,
    );
  }
  // Prefix sums, so the room needed above or below any boundary is a lookup
  // rather than a loop inside the solve.
  const roomAbove: number[] = [0];
  for (let k = 0; k <= count; k += 1) roomAbove.push(roomAbove[k] + perInterval[k]);
  // Space that must exist between the outer limit and boundary `index`.
  const above = (index: number) => roomAbove[index + 1];
  // Space that must exist between boundary `index` and the inner limit.
  const below = (index: number) => roomAbove[count + 1] - roomAbove[index + 1];
  // Space that must exist between two boundaries.
  const between = (outer: number, inner: number) =>
    roomAbove[inner + 1] - roomAbove[outer + 1];

  // Room every boundary needs purely from its position in the stack, before
  // any other pin is considered.
  const structuralMax = (index: number) => outerLimit - above(index);
  const structuralMin = (index: number) => innerLimit + below(index);

  // A pin outside its own structural range is infeasible on its own terms, and
  // using it raw would poison every bound derived from it — an outermost pin
  // of 3px in a stack that structurally needs 16px would drive the boundaries
  // below it negative. Clamp each pin into its structural range first; this
  // depends only on the index and the limits, so the result stays independent
  // of edit order.
  const effectivePins = pins.map((pin, index) =>
    pin === undefined
      ? undefined
      : Math.min(structuralMax(index), Math.max(structuralMin(index), pin)),
  );

  for (let index = 0; index < count; index += 1) {
    // Ceiling: leave room for this boundary and every boundary outside it,
    // and stay inside every pin further out. Taking the minimum over *all*
    // outer pins rather than only the adjacent one is what keeps a stack of
    // three or more pins consistent.
    let maximum = structuralMax(index);
    for (let outer = 0; outer < index; outer += 1) {
      const pin = effectivePins[outer];
      if (pin !== undefined) maximum = Math.min(maximum, pin - between(outer, index));
    }
    // Structural floor: room for every boundary inside this one.
    const structuralMinimum = structuralMin(index);
    // Drag floor: additionally refuse to cross a pin further in. This is the
    // wall a live drag stops at, so a gesture can never author a conflict.
    let minimum = structuralMinimum;
    for (let inner = index + 1; inner < count; inner += 1) {
      const pin = effectivePins[inner];
      if (pin !== undefined) minimum = Math.max(minimum, pin + between(index, inner));
    }
    if (minimum > maximum) minimum = maximum;

    // An unpinned boundary is free-floating — the hub is the flexible band —
    // so it yields to pins on either side and is pushed outward to make room
    // for a pin further in. A pinned boundary instead holds its authored
    // radius against inner pins, so an over-constrained stored profile (an
    // import, or legacy data no gesture ever vetted) resolves outer-pin-first
    // rather than shoving an outer boundary further out than its author asked.
    const authored = pins[index];
    const pinned = authored !== undefined;
    const resolutionMinimum = Math.min(pinned ? structuralMinimum : minimum, maximum);
    const target = effectivePins[index] ?? canonical[index];
    const value = Math.min(maximum, Math.max(resolutionMinimum, target));
    resolved.push(value);
    limits.push({ min: minimum, max: maximum });
    // Reported against what the author actually asked for, not against the
    // structurally pre-clamped value, so a rejected pin is still flagged.
    blocked.push(pinned && Math.abs(value - authored) > 1e-9);
  }

  const pushIndex = options.pushIndex;
  if (
    pushIndex !== undefined
    && Number.isInteger(pushIndex)
    && pushIndex >= 0
    && pushIndex < count
  ) {
    // The dragged boundary answers only to the stack's structural room, not to
    // its neighbours' authored radii.
    const pushed = resolved.slice();
    const preferred = (index: number) => pins[index] ?? canonical[index];
    pushed[pushIndex] = Math.min(
      structuralMax(pushIndex),
      Math.max(structuralMin(pushIndex), preferred(pushIndex)),
    );
    // Outward: each boundary keeps its own radius unless the one inside it has
    // arrived, in which case it is carried out by exactly the gap.
    for (let index = pushIndex - 1; index >= 0; index -= 1) {
      pushed[index] = Math.min(
        structuralMax(index),
        Math.max(preferred(index), pushed[index + 1] + perInterval[index + 1]),
      );
    }
    // Inward: the mirror image.
    for (let index = pushIndex + 1; index < count; index += 1) {
      pushed[index] = Math.max(
        structuralMin(index),
        Math.min(preferred(index), pushed[index - 1] - perInterval[index]),
      );
    }
    return {
      resolved: Object.freeze(pushed),
      // The dragged boundary may travel its whole structural range, because
      // the others move out of its way.
      limits: Object.freeze(limits.map((limit, index) => index === pushIndex
        ? { min: structuralMin(index), max: structuralMax(index) }
        : limit)),
      blocked: Object.freeze(pushed.map((value, index) => {
        const authored = pins[index];
        return authored !== undefined && Math.abs(value - authored) > 1e-9;
      })),
    };
  }

  return {
    resolved: Object.freeze(resolved),
    limits: Object.freeze(limits),
    blocked: Object.freeze(blocked),
  };
}

/**
 * Semantic paint classes per band, from the wheel class manifest. This is the
 * "a sign is a bounded area with contents" statement: geometry edits to a
 * band are edits to the bounded region these classes live in.
 */
export const WHEEL_BAND_CONTENTS: Readonly<
  Record<WheelBandId, readonly string[]>
> = Object.freeze({
  margin: [
    "secondaryRing.fixedStar.label",
    "secondaryRing.asteroid.label",
    "secondaryRing.midpoint.glyph",
    "secondaryRing.antiscia.glyph",
    "secondaryRing.contraAntiscia.glyph",
    "secondaryRing.dodecatemoria.glyph",
    "secondaryRing.arabicPart.label",
    "secondaryRing.parallelTransit.glyph",
    "angles.inner.arrowhead",
  ],
  outerHouses: ["houses.outer.cusp", "houses.outer.label"],
  outerBodies: [
    "bodies.outer.glyph",
    "bodies.outer.motion",
    "bodies.outer.leader",
    "angles.outer.ray",
    "angles.outer.arrowhead",
    "angles.outer.label",
  ],
  zodiac: [
    "zodiac.signGlyph",
    "zodiac.spoke",
    "zodiac.tick.inner.10deg",
    "zodiac.tick.inner.5deg",
    "zodiac.tick.inner.1deg",
    "zodiac.tick.outer.10deg",
    "zodiac.tick.outer.5deg",
    "zodiac.tick.outer.1deg",
    "angles.inner.ray",
  ],
  terms: ["subdivisions.term.boundary", "subdivisions.term.glyph"],
  decans: ["subdivisions.decan.boundary", "subdivisions.decan.glyph"],
  cuspRuler: [
    "zodiac.tick.angloCuspRuler.10deg",
    "zodiac.tick.angloCuspRuler.5deg",
    "zodiac.tick.angloCuspRuler.1deg",
    "zodiac.tick.angloHouseCusp",
  ],
  cuspLabels: ["houses.inner.position.degree", "houses.inner.position.sign", "houses.inner.position.minute"],
  bodies: [
    "bodies.inner.glyph",
    "bodies.inner.motion",
    "bodies.inner.leader",
  ],
  aspects: [
    "aspects.primary.line",
    "aspects.primary.glyph",
    "aspects.interchart.line",
    "aspects.interchart.glyph",
    "bodies.inner.position.degree",
    "bodies.inner.position.sign",
    "bodies.inner.position.minute",
    "angles.inner.position.degree",
    "angles.inner.position.sign",
    "angles.inner.position.minute",
  ],
  houses: ["houses.inner.cusp", "houses.inner.label"],
  hub: ["canvas.background"],
});

/** Ordered band ids per layout family, outer -> inner. */
export const WHEEL_BAND_ORDER: Readonly<
  Record<WheelLayoutFamily, readonly WheelBandId[]>
> = Object.freeze({
  classicSingle: [
    "margin",
    "zodiac",
    "terms",
    "decans",
    "bodies",
    "aspects",
    "houses",
    "hub",
  ],
  classicComparison: [
    "margin",
    "outerHouses",
    "outerBodies",
    "zodiac",
    "terms",
    "decans",
    "bodies",
    "aspects",
    "houses",
    "hub",
  ],
  angloSingle: [
    "margin",
    "zodiac",
    "terms",
    "decans",
    "cuspRuler",
    "cuspLabels",
    "bodies",
    "houses",
    "hub",
  ],
  angloComparisonNoHouses: [
    "margin",
    "zodiac",
    "terms",
    "decans",
    "cuspRuler",
    "cuspLabels",
    "bodies",
    "houses",
    "hub",
  ],
  angloComparisonWithHouses: [
    "margin",
    "outerHouses",
    "outerBodies",
    "zodiac",
    "terms",
    "decans",
    "cuspRuler",
    "cuspLabels",
    "bodies",
    "houses",
    "hub",
  ],
});

export function wheelLayoutFamily(input: WheelGeometryInput): WheelLayoutFamily {
  if (input.profile === "anglo") {
    if (input.mode !== "comparison") return "angloSingle";
    return input.comparisonWithOuterHouses || input.restrainedAngloComparison
      ? "angloComparisonWithHouses"
      : "angloComparisonNoHouses";
  }
  return input.mode === "comparison" ? "classicComparison" : "classicSingle";
}

type MutableRings = { -readonly [K in keyof WheelRingSet]?: number };

interface BandEdges {
  readonly outer: number;
  readonly inner: number;
  readonly visible: boolean;
}

/**
 * The degree rulers, named independently of the circles that bound them.
 *
 * Two ids because there are two rulers. The canonical geometry drives both from
 * one `degreeTickLength`, so before this they could not be told apart, let alone
 * sized apart.
 */
export const WHEEL_RULER_IDS = Object.freeze(["zodiacOuter", "zodiacInner"] as const);

export type WheelRulerId = (typeof WHEEL_RULER_IDS)[number];

/**
 * Legal ruler depth as a share of its host band.
 *
 * The ceiling is below `1/2` because both rulers stand in the same band and a
 * band whose two rulers meet has no room left for the glyph between them. The
 * floor keeps a ruler thick enough to remain visible and grabbable.
 */
export const WHEEL_RULER_DEPTH_RANGE = Object.freeze({ min: 0.02, max: 0.45 });

/**
 * Legal tick length as a share of the ruler band the tick stands in.
 *
 * The ceiling is above the full band on purpose. Measured, the shipped anglo
 * cusp ruler already overflows its own band — with terms and decans shown the
 * 10-degree tick is 167% of it and the 5-degree tick is exactly 100% — which is
 * the overlap the ticks were reported for. A ceiling of 1 would put the default
 * out of range and make the control unable to return to it, so the range
 * reaches past the band and the band is a guide rather than a wall.
 */
export const WHEEL_TICK_LENGTH_RANGE = Object.freeze({ min: 0.02, max: 2 });

/**
 * How long one tick group is, in px, given the ruler band it stands in.
 *
 * The third quantity in the same story as `resolveWheelRulerDepth`: a tick used
 * to be a fraction of the *whole wheel* (`r30 * 0.018`), so it had no idea how
 * much room its own ruler had and did not move when that room changed. As a
 * share of its band, "the band makes the ticks smaller" is automatic.
 *
 * Unauthored returns the caller's canonical length by identity, so default
 * wheels stay bit-exact.
 */
export function resolveWheelTickLength(
  style: WheelRenderStyle,
  profile: WheelTypographyProfile,
  classId: string,
  hostBand: number,
  canonicalHostBand: number,
  canonicalLength: number,
): number {
  if (!(hostBand > 0)) return canonicalLength;
  const authored = style.authoringOverrides.tickLength?.[profile]?.[classId];
  if (Number.isFinite(authored)) {
    return hostBand * Math.min(
      WHEEL_TICK_LENGTH_RANGE.max,
      Math.max(WHEEL_TICK_LENGTH_RANGE.min, authored as number),
    );
  }
  // Unauthored still follows the band, keeping whatever proportion of it the
  // design shipped. This is the same rule the band-seated glyphs already use,
  // and applying it here is what stops a tick standing 17px deep in a band 1.8px
  // thick — nine times its own band, straight through its neighbours.
  //
  // The proportion is preserved rather than capped at the band edge because the
  // shipped cusp ticks overflow their band by design (167% of it), so capping
  // would redraw every Anglo chart. At canonical thickness the ratio is exactly
  // 1 and the canonical length is returned unchanged.
  if (!(canonicalHostBand > 0)) return canonicalLength;
  return canonicalLength * (hostBand / canonicalHostBand);
}

/**
 * A ruler's depth in px, given the band that hosts it and the depth the
 * canonical geometry would give it.
 *
 * The canonical depth is passed in rather than recomputed so the unauthored
 * path returns the caller's own expression *by identity* — same float, same
 * accumulation order, bit-exact. Recomputing it here as
 * `3 * degreeTickLength * maxRadius` would be arithmetically equal in most
 * cases and unequal in exactly the ones the parity contract pins.
 *
 * `hostThickness` is null for a ruler that is not a sub-band of any band, which
 * measurement says is a real case: with an outer ring, anglo's outer ruler sits
 * at 376–385.6 px while its zodiac band is 332.2–358, so the ruler is outside
 * the band entirely and a band fraction would be meaningless. Such a ruler
 * keeps its canonical depth and ignores authoring rather than inventing a host.
 */
export function resolveWheelRulerDepth(
  style: WheelRenderStyle,
  profile: WheelTypographyProfile,
  rulerId: WheelRulerId,
  hostThickness: number | null,
  canonicalDepth: number,
): number {
  if (hostThickness === null || !(hostThickness > 0)) return canonicalDepth;
  const authored = style.authoringOverrides.rulerDepth?.[profile]?.[rulerId];
  if (!Number.isFinite(authored)) return canonicalDepth;
  const fraction = Math.min(
    WHEEL_RULER_DEPTH_RANGE.max,
    Math.max(WHEEL_RULER_DEPTH_RANGE.min, authored as number),
  );
  return hostThickness * fraction;
}

/**
 * Where a ruler's far circle sits, given the circle it stands on.
 *
 * Callers hand in the radius the canonical geometry produced, and an unauthored
 * ruler gets that value back *unchanged* — not recomputed from a depth. The
 * difference matters: the canonical terminals are sequential accumulations
 * (`((r30 - t) - t) - t`), and rebuilding one as `base - (base - terminal)`
 * is arithmetically the same and bit-wise not, which is exactly what the parity
 * contract pins.
 *
 * `sign` is -1 for a ruler hanging inward from its base and +1 for one standing
 * outward, because the two directions do not round alike either.
 */
export function resolveWheelRulerTerminal(
  style: WheelRenderStyle,
  profile: WheelTypographyProfile,
  rulerId: WheelRulerId,
  hostThickness: number | null,
  base: number,
  sign: 1 | -1,
  canonicalTerminal: number,
): number {
  if (hostThickness === null || !(hostThickness > 0)) return canonicalTerminal;
  const authored = style.authoringOverrides.rulerDepth?.[profile]?.[rulerId];
  if (!Number.isFinite(authored)) return canonicalTerminal;
  const depth = resolveWheelRulerDepth(
    style,
    profile,
    rulerId,
    hostThickness,
    Math.abs(canonicalTerminal - base),
  );
  return base + sign * depth;
}

/**
 * The share of its host band a ruler currently occupies, authored or not.
 *
 * The inspector needs one number to show whether or not the ruler has been
 * authored, so the canonical depth is reported in the same units as an authored
 * one instead of leaving the control blank until first touched.
 */
export function resolveWheelRulerDepthFraction(
  style: WheelRenderStyle,
  profile: WheelTypographyProfile,
  rulerId: WheelRulerId,
  hostThickness: number | null,
  canonicalDepth: number,
): number | null {
  if (hostThickness === null || !(hostThickness > 0)) return null;
  return resolveWheelRulerDepth(style, profile, rulerId, hostThickness, canonicalDepth) /
    hostThickness;
}


function interiorThird(from: number, to: number): readonly [number, number] {
  const third = (to - from) / 3;
  return [from + third, from + third * 2];
}

/**
 * Canonical classic/compact layout as a band walk. Transcribed from
 * `resolveClassicBaseRings` and the classic/compact branches of
 * `resolveCanonicalWheelRingSet`; the parity contract keeps it exact.
 */
function resolveClassicFamilyLayout(
  style: WheelRenderStyle,
  input: WheelGeometryInput,
): { edges: Partial<Record<WheelBandId, BandEdges>>; rings: MutableRings } {
  const { maxRadius } = input;
  const classic = style.geometry.classic;
  const compact = style.geometry.compact;
  const biwheel = style.geometry.biwheel;
  const comparison = input.mode === "comparison";
  const isCompact = input.profile === "compact";
  const rings: MutableRings = {};
  const edges: Partial<Record<WheelBandId, BandEdges>> = {};

  // --- Outer zone -------------------------------------------------------
  let r30: number;
  if (comparison) {
    const outerHouseSector = input.showHouses
      ? biwheel.outerHouseSector * maxRadius
      : 0;
    const rOuterMax = maxRadius * biwheel.outerMax;
    const rOuterHouse = rOuterMax - outerHouseSector;
    r30 = rOuterHouse - biwheel.zodiacInset * maxRadius;
    edges.margin = { outer: maxRadius, inner: rOuterMax, visible: true };
    edges.outerHouses = {
      outer: rOuterMax,
      inner: rOuterHouse,
      visible: input.showHouses,
    };
    edges.outerBodies = { outer: rOuterHouse, inner: r30, visible: true };

    rings.rOuterMax = rOuterMax;
    rings.rOuterHouse = rOuterHouse;
    rings.rOuterHouseName = rOuterMax - outerHouseSector / 2;
    rings.rOuterPlanet = r30 + (biwheel.outerPlanetSector / 2) * maxRadius;
    rings.rOuterASCMC = maxRadius * biwheel.outerAngle;
    rings.rOuterArrow = rings.rOuterASCMC + biwheel.arrowLength * maxRadius;
    rings.rOuterLine = r30 + biwheel.outerLineOffset * maxRadius;
    rings.rAntis = maxRadius * biwheel.projectedLabel;
    rings.rAntisLines = rings.rOuterLine;
    rings.rOuterRetr = rings.rOuterLine + biwheel.retrogradeOffset * maxRadius;
    rings.rOuterMin = maxRadius * biwheel.outerMinimum;
  } else {
    r30 = maxRadius * classic.outer.zodiac;
    edges.margin = { outer: maxRadius, inner: r30, visible: true };
    rings.rOuterLine = maxRadius * classic.outer.line;
    rings.rAntis = maxRadius * classic.outer.projectedLabel;
    rings.rAntisLines = maxRadius * classic.outer.projectedLine;
  }

  // --- Zodiac band ------------------------------------------------------
  const degreeTick = classic.degreeTickLength * maxRadius;
  const r0 = r30 - classic.signSectorLength * maxRadius;
  edges.zodiac = { outer: r30, inner: r0, visible: true };
  rings.r30 = r30;
  rings.r0 = r0;
  rings.rSign = r30 - (classic.signSectorLength / 2) * maxRadius;
  rings.rASCMC = rings.rSign;
  rings.rArrow = rings.rSign + classic.arrowLength * maxRadius;
  // Degree-ruler ticks stay attached to their terminal circles; interior
  // radii are exact thirds (`applyPaintedRingRadiusOverrides` repair pass).
  // Terminal radii keep the renderer's sequential accumulation so the parity
  // contract stays bit-exact.
  //
  // Both rulers are sub-bands of the zodiac band here, so both may be authored
  // as a share of it. Unauthored, each keeps the sequential accumulation
  // verbatim — including its direction, since `((r30 - t) - t) - t` and
  // `((r0 + t) + t) + t` do not round alike.
  const zodiacBand = r30 - r0;
  rings.rOuter0 = r30;
  rings.rOuter10 = resolveWheelRulerTerminal(
    style,
    input.profile,
    "zodiacOuter",
    zodiacBand,
    r30,
    -1,
    ((r30 - degreeTick) - degreeTick) - degreeTick,
  );
  [rings.rOuter1, rings.rOuter5] = interiorThird(rings.rOuter0, rings.rOuter10);
  rings.r10 = resolveWheelRulerTerminal(
    style,
    input.profile,
    "zodiacInner",
    zodiacBand,
    r0,
    1,
    ((r0 + degreeTick) + degreeTick) + degreeTick,
  );
  [rings.r1, rings.r5] = interiorThird(r0, rings.r10);

  // --- Subdivision bands ------------------------------------------------
  const termSector = (input.showTerms ? classic.termSectorLength : 0) * maxRadius;
  const decanSector = (input.showDecans ? classic.decanSectorLength : 0) * maxRadius;
  const rDecans = r0 - termSector;
  const rInner = rDecans - decanSector;
  edges.terms = { outer: r0, inner: rDecans, visible: input.showTerms };
  edges.decans = { outer: rDecans, inner: rInner, visible: input.showDecans };
  rings.rTerms = r0;
  rings.rTermsPlanet = r0 - termSector / 2;
  rings.rDecans = rDecans;
  rings.rDecansPlanet = rInner + decanSector / 2;
  rings.rInner = rInner;

  // --- Bodies band ------------------------------------------------------
  // Compact narrows the bodies band to its position inset in single mode
  // only; comparison layouts keep the classic planet sector.
  const bodiesSector = isCompact && !comparison
    ? compact.positionInset * maxRadius
    : classic.planetSectorLength * maxRadius;
  const rAsp = rInner - bodiesSector;
  edges.bodies = { outer: rInner, inner: rAsp, visible: true };
  rings.rAsp = rAsp;
  rings.rPlanet = rInner - (classic.planetSectorLength / 2) * maxRadius;
  rings.rLLine = rInner - classic.planetLineLength * maxRadius;
  rings.rLLine2 = rAsp + classic.planetLineLength * maxRadius;
  rings.rRetr = rings.rLLine2 + classic.retrogradeOffset * maxRadius;

  // --- Position lanes (aspect zone) ------------------------------------
  const density = Number(input.showTerms) + Number(input.showDecans);
  if (isCompact) {
    const laneTable = comparison
      ? compact.positionLaneComparison
      : compact.positionLaneSingle;
    const lane = laneTable[density] * maxRadius;
    const minuteInset = comparison
      ? compact.positionMinuteInsetComparison
      : input.hasOuterRing
        ? compact.positionMinuteInsetWithOuter
        : compact.positionMinuteInsetSingle;
    const rPosDeg = rInner - compact.positionInset * maxRadius;
    const rPosMin = rPosDeg - minuteInset * maxRadius;
    const laneMinute = compact.positionMinuteInsetComparison * maxRadius;
    rings.rPos = rPosDeg;
    rings.rPosDeg = rPosDeg;
    rings.rPosMin = rPosMin;
    rings.rRetr = rPosMin - compact.retrogradeInset * maxRadius;
    rings.rAspAscMC = lane;
    rings.rPosAscMC = lane;
    rings.rPosAscMCMin = lane - laneMinute;
    rings.rPosHouses = lane;
    rings.rPosHousesMin = lane - laneMinute;
  } else {
    const laneTable = comparison
      ? classic.comparisonPositionLanes
      : classic.singlePositionLanes;
    const lane = laneTable[density];
    rings.rPos = maxRadius * lane.position;
    rings.rAspAscMC = maxRadius * lane.aspectAngle;
    rings.rPosAscMC = maxRadius * lane.positionAngle;
    rings.rPosHouses = maxRadius * lane.positionHouses;
    if (!comparison) {
      // The single-classic renderer sums the leader and retrograde insets
      // before scaling; keep the identical rounding order.
      rings.rRetr =
        rInner -
        classic.planetSectorLength * maxRadius +
        (classic.planetLineLength + classic.retrogradeOffset) * maxRadius;
    }
  }

  // --- House band and hub ----------------------------------------------
  let rBase: number;
  let rHouse: number;
  if (isCompact) {
    const offsets = input.showPositions
      ? compact.densityOffsetWithPositions
      : compact.densityOffsetWithoutPositions;
    const densityOffset =
      maxRadius * offsets[density + Number(input.hasOuterRing)];
    rBase = maxRadius * compact.base - densityOffset;
    rHouse = rBase + compact.houseSector * maxRadius;
    rings.rHouseName = maxRadius * compact.houseName - densityOffset;
  } else {
    rBase = maxRadius * classic.inner.base;
    rHouse = rBase + classic.houseSectorLength * maxRadius;
    rings.rHouseName = maxRadius * classic.inner.houseName;
  }
  edges.aspects = { outer: rAsp, inner: rHouse, visible: true };
  edges.houses = { outer: rHouse, inner: rBase, visible: input.showHouses };
  edges.hub = { outer: rBase, inner: 0, visible: true };
  rings.rBase = rBase;
  rings.rHouse = rHouse;

  return { edges, rings };
}

/**
 * Canonical Anglo layout as a band walk. Transcribed from
 * `resolveAngloRings` and the Anglo branches of
 * `resolveCanonicalWheelRingSet`; the parity contract keeps it exact.
 */
function resolveAngloFamilyLayout(
  style: WheelRenderStyle,
  input: WheelGeometryInput,
): { edges: Partial<Record<WheelBandId, BandEdges>>; rings: MutableRings } {
  const { maxRadius } = input;
  const anglo = style.geometry.anglo;
  const comparison = input.mode === "comparison";
  const withHouses =
    comparison &&
    (input.comparisonWithOuterHouses || Boolean(input.restrainedAngloComparison));
  const hasOuterRing = comparison ? true : input.hasOuterRing;
  const zodiacRatio = withHouses
    ? anglo.zodiacComparisonWithHouses
    : comparison || input.hasOuterRing
      ? anglo.zodiacWithOuter
      : anglo.zodiacSingle;
  const rings: MutableRings = {};
  const edges: Partial<Record<WheelBandId, BandEdges>> = {};

  // --- Zodiac band ------------------------------------------------------
  const r30 = maxRadius * zodiacRatio;
  const subdivisionSector = r30 * anglo.subdivisionSector;
  const termSector = input.showTerms ? subdivisionSector : 0;
  const decanSector = input.showDecans ? subdivisionSector : 0;
  const subdivisionInset = (termSector + decanSector) / 2;
  const r0 = r30 * anglo.signInnerScale + subdivisionInset;
  edges.zodiac = { outer: r30, inner: r0, visible: true };
  rings.r30 = r30;
  rings.r0 = r0;
  rings.rSign = (r30 + r0) / 2;
  rings.rASCMC = r30;
  rings.rArrow = Math.min(
    maxRadius * anglo.arrowMaximum,
    r30 + anglo.arrowInset * maxRadius,
  );
  // The inner ruler is a sub-band of the zodiac band. The outer one is too when
  // there is no outer ring; with one it stands on the outer ring, measurably
  // outside the zodiac band (376–385.6 px against a 332.2–358 band at maxRadius
  // 400) and inside the margin — so the margin is its host. Anglo draws only
  // this ruler (`!isAngloWheel` gates the inner one), so leaving it hostless
  // left the whole profile with no sizable ruler at all.
  const zodiacBand = r30 - r0;
  const marginBand = maxRadius - r30;
  rings.r10 = resolveWheelRulerTerminal(
    style,
    input.profile,
    "zodiacInner",
    zodiacBand,
    r0,
    1,
    r0 + anglo.degreeTickLength * 3 * maxRadius,
  );
  [rings.r1, rings.r5] = interiorThird(r0, rings.r10);
  rings.rOuter0 = hasOuterRing ? maxRadius * anglo.outerSingle.degree0 : r30;
  rings.rOuter10 = resolveWheelRulerTerminal(
    style,
    input.profile,
    "zodiacOuter",
    hasOuterRing ? marginBand : zodiacBand,
    rings.rOuter0,
    -1,
    hasOuterRing
      ? maxRadius * anglo.outerSingle.degree10
      : r30 - anglo.degreeTickLength * 3 * maxRadius,
  );
  [rings.rOuter1, rings.rOuter5] = interiorThird(rings.rOuter0, rings.rOuter10);

  // --- Outer zone -------------------------------------------------------
  rings.rOuterLine = hasOuterRing
    ? maxRadius * anglo.outerSingle.line
    : r30 + anglo.noOuterLineOffset * maxRadius;
  rings.rAntis = maxRadius * anglo.outerSingle.projectedLabel;
  rings.rAntisLines = rings.rOuterLine;
  edges.margin = { outer: maxRadius, inner: r30, visible: true };

  // --- Subdivision and cusp-ruler bands --------------------------------
  const rDecans = r0 - termSector;
  const rCuspOuter = rDecans - decanSector;
  const subdivisionCount = Number(input.showTerms) + Number(input.showDecans);
  const rulerSector =
    r30 * (anglo.rulerBaseScale - anglo.rulerSubdivisionScale * subdivisionCount);
  const rCuspLabelOuter = rCuspOuter - rulerSector;
  edges.terms = { outer: r0, inner: rDecans, visible: input.showTerms };
  edges.decans = { outer: rDecans, inner: rCuspOuter, visible: input.showDecans };
  edges.cuspRuler = { outer: rCuspOuter, inner: rCuspLabelOuter, visible: true };
  rings.rTerms = r0;
  rings.rTermsPlanet = r0 - termSector / 2;
  rings.rDecans = rDecans;
  rings.rDecansPlanet = rDecans - decanSector / 2;
  rings.rCuspOuter = rCuspOuter;
  rings.rCuspLabelOuter = rCuspLabelOuter;

  // --- Cusp labels, bodies, houses, hub --------------------------------
  const rInner = r30 * anglo.innerScale - subdivisionInset;
  const rPlanet = r30 * anglo.planetScale - subdivisionInset;
  const rAsp = r30 * anglo.aspectScale - subdivisionInset;
  const rHouse = r30 * anglo.houseScale - subdivisionInset;
  edges.cuspLabels = { outer: rCuspLabelOuter, inner: rInner, visible: true };
  edges.bodies = { outer: rInner, inner: rHouse, visible: true };
  edges.houses = { outer: rHouse, inner: rAsp, visible: input.showHouses };
  edges.hub = { outer: rAsp, inner: 0, visible: true };
  rings.rCuspLabel = r30 * anglo.cuspLabelScale - subdivisionInset;
  rings.rInner = rInner;
  rings.rPlanet = rPlanet;
  rings.rAsp = rAsp;
  rings.rHouse = rHouse;
  rings.rBase = rAsp;
  rings.rHouseName = (rAsp + rHouse) / 2;
  rings.rLLine = rInner - anglo.leaderInsetScale * r30;
  rings.rLLine2 = rAsp - anglo.aspectLeaderInsetScale * r30;
  rings.rRetr = rPlanet - anglo.retrogradeInsetScale * r30;
  rings.rPos = rPlanet - anglo.positionInsetScale * r30;
  rings.rAspAscMC = rAsp;
  rings.rPosAscMC = r30 * anglo.anglePositionScale;
  rings.rPosHouses = rings.rCuspLabel;

  // --- Comparison outer overlays ---------------------------------------
  if (withHouses) {
    const outer = anglo.comparisonWithHouses;
    const rOuterMax = maxRadius * outer.max;
    const rOuterHouse = maxRadius * outer.house;
    edges.margin = { outer: maxRadius, inner: rOuterMax, visible: true };
    edges.outerHouses = { outer: rOuterMax, inner: rOuterHouse, visible: true };
    edges.outerBodies = { outer: rOuterHouse, inner: r30, visible: true };
    rings.rOuter0 = maxRadius * outer.degree0;
    rings.rOuter10 = maxRadius * outer.degree10;
    [rings.rOuter1, rings.rOuter5] = interiorThird(rings.rOuter0, rings.rOuter10);
    rings.rOuterMax = rOuterMax;
    rings.rOuterHouse = rOuterHouse;
    rings.rOuterHouseName = maxRadius * outer.houseName;
    rings.rOuterPlanet = maxRadius * outer.planet;
    rings.rOuterASCMC = rOuterMax;
    rings.rOuterArrow = rOuterMax;
    rings.rOuterLine = maxRadius * outer.line;
    rings.rAntis = maxRadius * outer.projectedLabel;
    rings.rAntisLines = maxRadius * outer.line;
    rings.rOuterRetr = maxRadius * outer.retrograde;
    rings.rOuterMin = rOuterHouse;
  } else if (comparison) {
    const outer = anglo.comparisonNoHouses;
    rings.rOuterPlanet = maxRadius * outer.planet;
    rings.rOuterASCMC = maxRadius * outer.angle;
    rings.rOuterArrow = maxRadius * outer.arrow;
    rings.rOuterRetr = maxRadius * outer.retrograde;
    rings.rOuterMin = maxRadius * outer.minute;
  }

  return { edges, rings };
}

function assembleLayout(
  family: WheelLayoutFamily,
  edges: Partial<Record<WheelBandId, BandEdges>>,
  rings: MutableRings,
): ResolvedWheelLayout {
  const order = WHEEL_BAND_ORDER[family];
  const violations: WheelLayoutViolation[] = [];
  const bands = order.map((id) => {
    const edge = edges[id];
    if (!edge) {
      violations.push({
        kind: "band-inverted",
        bandId: id,
        detail: `band ${id} missing from resolved ${family} layout`,
      });
      return Object.freeze({
        id,
        outer: 0,
        inner: 0,
        visible: false,
        contents: WHEEL_BAND_CONTENTS[id],
      });
    }
    if (edge.inner > edge.outer + 1e-9) {
      violations.push({
        kind: "band-inverted",
        bandId: id,
        detail: `band ${id} inner edge ${edge.inner.toFixed(3)} exceeds outer edge ${edge.outer.toFixed(3)}`,
      });
    }
    return Object.freeze({
      id,
      outer: edge.outer,
      inner: edge.inner,
      visible: edge.visible,
      contents: WHEEL_BAND_CONTENTS[id],
    });
  });
  return Object.freeze({
    family,
    bands: Object.freeze(bands),
    rings: Object.freeze(rings) as Readonly<WheelRingSet>,
    violations: Object.freeze(violations),
  });
}

/**
 * Resolve the canonical band layout: the declared structure with the exact
 * default renderer arithmetic and no user ring overrides applied. The parity
 * contract asserts `rings` equals `resolveWheelRingSet` for override-free
 * styles across the full preview state matrix.
 */
export function resolveCanonicalWheelLayout(
  style: WheelRenderStyle,
  input: WheelGeometryInput,
): ResolvedWheelLayout {
  const family = wheelLayoutFamily(input);
  const { edges, rings } =
    input.profile === "anglo"
      ? resolveAngloFamilyLayout(style, input)
      : resolveClassicFamilyLayout(style, input);
  return assembleLayout(family, edges, rings);
}

/**
 * Read a resolved `WheelRingSet` — after user ring-radius overrides and any
 * safety repair the renderer applied — back into the declared band structure.
 * The caller supplies the rings so this module stays free of a runtime
 * dependency on the renderer. Band inversions introduced by override
 * application are reported as violations instead of being hidden.
 */
export function resolveWheelBandLayout(
  style: WheelRenderStyle,
  input: WheelGeometryInput,
  rings: Readonly<WheelRingSet>,
): ResolvedWheelLayout {
  const family = wheelLayoutFamily(input);
  const canonical =
    input.profile === "anglo"
      ? resolveAngloFamilyLayout(style, input)
      : resolveClassicFamilyLayout(style, input);

  // Bands and boundaries interleave exactly: n bands are separated by n-1
  // authored boundaries, bounded by the canvas edge outside and the centre
  // inside. Reading edges from that one declared sequence keeps every band's
  // outer and inner edge on the same footing; the previous per-band fixups
  // silently fell back to the *canonical* edge for any band they missed, which
  // paired a canonical outer with a solved inner and inverted the band.
  const order = WHEEL_BAND_ORDER[family];
  const boundaries = WHEEL_BAND_BOUNDARY_FIELDS[family];
  const edges: Partial<Record<WheelBandId, BandEdges>> = {};
  for (let index = 0; index < order.length; index += 1) {
    const id = order[index];
    const canonicalEdge = canonical.edges[id];
    if (!canonicalEdge) continue;
    const outerField = index > 0 ? boundaries[index - 1] : null;
    const innerField = index < boundaries.length ? boundaries[index] : null;
    const outer = outerField === null
      ? input.maxRadius
      : rings[outerField] ?? canonicalEdge.outer;
    const inner = innerField === null ? 0 : rings[innerField] ?? canonicalEdge.inner;
    edges[id] = { outer, inner, visible: canonicalEdge.visible };
  }
  const layout = assembleLayout(family, edges, { ...rings });
  return layout;
}

/**
 * Reposition band-relative anchors after the band edges have moved.
 *
 * Every non-edge radius — body glyph lanes, position runs, house-number lanes,
 * leader insets — is declared to live inside a band span. Historically those
 * were absolute fractions of `maxRadius`, so moving a band left its own
 * contents behind: the sign ring could be dragged straight across the glyphs
 * it is supposed to contain. Here each anchor keeps its *proportional* place
 * inside its span, so the contents travel with the band that holds them.
 *
 * The mapping is deliberately identity-preserving. When the solved edges equal
 * the canonical edges the interpolation returns the canonical radius exactly,
 * so a wheel with no pinned boundaries is untouched to the last bit.
 */
/**
 * Anchors that are a fixed stub length off an edge, not a position within a
 * band: leader feet, the retrograde marker offset and the angle arrow.
 *
 * These keep their distance from the edge they stand on. Ratio-mapping them
 * makes them grow and shrink with the band, which is the same defect as a
 * degree ruler stretching when its base circle moves — an Anglo leader foot
 * shrank from 10.7px to 5.9px purely because the hub was resized, with ample
 * room for its natural length.
 */
const OFFSET_ANCHORS: ReadonlySet<string> = new Set([
  "rLLine",
  "rLLine2",
  "rRetr",
  "rArrow",
]);

export function remapWheelAnchorsToBands(
  profile: WheelTypographyProfile,
  canonicalBands: readonly ResolvedWheelBand[],
  solvedBands: readonly ResolvedWheelBand[],
  rings: Readonly<WheelRingSet>,
  /**
   * Fields the boundary solver already placed. A painted ring such as the
   * inner degree terminal is both a solved boundary and a declared anchor;
   * remapping it a second time would compound the two placements and push it
   * clean out of its own band.
   */
  solvedFields: ReadonlySet<string> = new Set(),
): Readonly<WheelRingSet> {
  const canonicalById = new Map(canonicalBands.map((band) => [band.id, band]));
  const solvedById = new Map(solvedBands.map((band) => [band.id, band]));
  const spans = wheelAnchorSpans(profile);
  const next = { ...rings } as Record<string, number | undefined>;

  for (const [field, span] of Object.entries(spans)) {
    if (solvedFields.has(field)) continue;
    const value = next[field];
    if (typeof value !== "number" || !Number.isFinite(value)) continue;

    // Map inside the band the anchor *actually* occupies in this state, not
    // the union of every band its declared span allows.
    //
    // A span has to be wide enough to cover every preview state, because an
    // absolute lane genuinely moves between bands as subdivision density
    // changes. Mapping against that union is what made Classic and Compact
    // feel loose while Anglo felt right: Anglo's wide spans are all outer-zone
    // labels, whereas Classic's widest spans are exactly the visible inner
    // content — position runs and retrograde markers spanning bodies through
    // hub. Against a four-band envelope an anchor barely tracks its own band.
    let canonicalOuter = Number.NaN;
    let canonicalInner = Number.NaN;
    let solvedOuter = Number.NaN;
    let solvedInner = Number.NaN;
    let unionCanonicalOuter = -Infinity;
    let unionCanonicalInner = Infinity;
    let unionSolvedOuter = -Infinity;
    let unionSolvedInner = Infinity;
    for (const bandId of span) {
      const canonicalBand = canonicalById.get(bandId);
      const solvedBand = solvedById.get(bandId);
      if (!canonicalBand || !solvedBand) continue;
      unionCanonicalOuter = Math.max(unionCanonicalOuter, canonicalBand.outer);
      unionCanonicalInner = Math.min(unionCanonicalInner, canonicalBand.inner);
      unionSolvedOuter = Math.max(unionSolvedOuter, solvedBand.outer);
      unionSolvedInner = Math.min(unionSolvedInner, solvedBand.inner);
      // Prefer the first band with real thickness that contains the value.
      // Bands are ordered outer to inner, so a value sitting exactly on a
      // shared edge is attributed to the outer band, matching how the renderer
      // treats a lane seated on a boundary.
      const containsValue = value <= canonicalBand.outer + 1e-9
        && value >= canonicalBand.inner - 1e-9;
      if (containsValue && !Number.isFinite(canonicalOuter)
        && canonicalBand.outer - canonicalBand.inner > 1e-9) {
        canonicalOuter = canonicalBand.outer;
        canonicalInner = canonicalBand.inner;
        solvedOuter = solvedBand.outer;
        solvedInner = solvedBand.inner;
      }
    }
    // No containing band with thickness — a fully collapsed span, or an anchor
    // outside every band in its span. Fall back to the union so the value
    // still travels rather than being stranded.
    if (!Number.isFinite(canonicalOuter)) {
      if (!Number.isFinite(unionCanonicalOuter)) continue;
      canonicalOuter = unionCanonicalOuter;
      canonicalInner = unionCanonicalInner;
      solvedOuter = unionSolvedOuter;
      solvedInner = unionSolvedInner;
    }

    const canonicalThickness = canonicalOuter - canonicalInner;
    // A span with no canonical thickness carries no proportion to preserve;
    // pin such an anchor to the solved outer edge rather than dividing by zero.
    if (canonicalThickness <= 1e-9) {
      next[field] = solvedOuter;
      continue;
    }
    if (OFFSET_ANCHORS.has(field)) {
      // Keep the stub's length off whichever edge it stands on, and clamp it
      // into the solved band so a squeezed band cannot push it outside.
      const fromOuter = canonicalOuter - value;
      const fromInner = value - canonicalInner;
      const target = fromOuter <= fromInner
        ? solvedOuter - fromOuter
        : solvedInner + fromInner;
      next[field] = Math.min(solvedOuter, Math.max(solvedInner, target));
      continue;
    }
    const ratio = (value - canonicalInner) / canonicalThickness;
    next[field] = solvedInner + ratio * (solvedOuter - solvedInner);
  }

  return Object.freeze(next) as Readonly<WheelRingSet>;
}

/**
 * Ring fields that carry a band boundary, per layout family, ordered outer to
 * inner. The canvas edge and the hub centre are omitted because they are
 * constants, not authored radii.
 *
 * A boundary exists whether or not a circle is stroked on it. `zodiacInnerRing`
 * for instance is only a *painted* ring when terms or decans are shown, but the
 * sign band always has an inner edge, and if the solver does not place it a
 * pinned outer edge can be dragged straight past it and invert the band.
 */
export const WHEEL_BAND_BOUNDARY_FIELDS: Readonly<
  Record<WheelLayoutFamily, readonly (keyof WheelRingSet)[]>
> = Object.freeze({
  classicSingle: ["r30", "r0", "rDecans", "rInner", "rAsp", "rHouse", "rBase"],
  classicComparison: [
    "rOuterMax",
    "rOuterHouse",
    "r30",
    "r0",
    "rDecans",
    "rInner",
    "rAsp",
    "rHouse",
    "rBase",
  ],
  angloSingle: [
    "r30",
    "r0",
    "rDecans",
    "rCuspOuter",
    "rCuspLabelOuter",
    "rInner",
    "rHouse",
    "rAsp",
  ],
  angloComparisonNoHouses: [
    "r30",
    "r0",
    "rDecans",
    "rCuspOuter",
    "rCuspLabelOuter",
    "rInner",
    "rHouse",
    "rAsp",
  ],
  angloComparisonWithHouses: [
    "rOuterMax",
    "rOuterHouse",
    "r30",
    "r0",
    "rDecans",
    "rCuspOuter",
    "rCuspLabelOuter",
    "rInner",
    "rHouse",
    "rAsp",
  ],
});

/**
 * The band each semantic paint class lives in, inverted from
 * `WHEEL_BAND_CONTENTS`. A class listed under more than one band resolves to
 * the first, which is the outermost, matching how the contents lists are
 * ordered.
 */
export const WHEEL_CLASS_BAND: Readonly<Record<string, WheelBandId>> =
  Object.freeze(
    Object.entries(WHEEL_BAND_CONTENTS).reduce<Record<string, WheelBandId>>(
      (accumulator, [bandId, classes]) => {
        for (const classId of classes) {
          // Secondary-ring text is placed outward from the rim with leaders and
          // angular collision handling, so it is not seated in a radial band
          // and a thickness ceiling would be meaningless for it.
          if (classId.startsWith("secondaryRing.")) continue;
          if (!(classId in accumulator)) accumulator[classId] = bandId as WheelBandId;
        }
        return accumulator;
      },
      {},
    ),
  );

/**
 * Largest size a seated text run may be dragged to, in the canvas px the bands
 * are measured in.
 *
 * The band that holds a run is the natural limit — an em box of size `F` fits
 * when `F` does not exceed the band's thickness. But auditing every shipped
 * default across the preview matrix found 1,132 of 14,784 class/state pairs
 * already above that line, worst 2.59x on Compact position runs at a small
 * wheel, so a bare thickness cap would shrink wheels Aries ships today.
 *
 * The ceiling is therefore the band thickness or the run's current size,
 * whichever is larger. Where the band has room it binds and stops a glyph
 * being dragged over its boundary; where the shipped design already overflows,
 * the current size binds and the run simply cannot grow further. By
 * construction this never forces a shrink.
 *
 * Rim labels are excluded by `WHEEL_CLASS_BAND` rather than here: fixed-star,
 * asteroid, midpoint, antiscia and other secondary-ring text is drawn outward
 * from the rim with leader lines and angular collision handling, so its size
 * is governed by angular spacing, not by the thickness of the margin it
 * crosses. Every one of the worst offenders in that audit was such a label.
 *
 * Returns null when the class has no declared band or the band has collapsed,
 * leaving only the class's static bounds.
 */
/**
 * Fraction of its band a glyph may occupy before it touches the boundary
 * circles drawn at the band's edges.
 *
 * A glyph capped at exactly the band thickness fills the ring edge to edge, so
 * its extremities sit on the boundary lines and read as clipped. Leaving a
 * little air keeps the cap visually inside the ring rather than flush with it.
 */
const BAND_GLYPH_INSET = 0.88;

export function resolveWheelClassFontSizeCeiling(
  classId: string,
  bands: readonly ResolvedWheelBand[],
  currentSize?: number,
): number | null {
  const bandId = WHEEL_CLASS_BAND[classId];
  if (!bandId) return null;
  const band = bands.find((candidate) => candidate.id === bandId);
  if (!band) return null;
  const thickness = (band.outer - band.inner) * BAND_GLYPH_INSET;
  if (!(thickness > 1e-9)) return null;
  return currentSize != null && Number.isFinite(currentSize)
    ? Math.max(thickness, currentSize)
    : thickness;
}
