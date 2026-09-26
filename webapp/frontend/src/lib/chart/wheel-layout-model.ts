import { ringEnabled, WHEEL_RING_ARCHETYPES, WHEEL_FACTORY_SETTINGS, type WheelRingArchetypeId } from "./wheel-composition";
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
  WheelLinePaintRole,
  WheelAuthoringFillClass,
} from "./wheel-render-style";

/** Paint and editor share the semantic ownership of each resolved band. */
export const WHEEL_BAND_FILL_CLASSES: Partial<Record<WheelRingArchetypeId, WheelAuthoringFillClass>> = {
  zodiac: "fills.zodiacBand", terms: "fills.termBand", decans: "fills.decanBand",
  bodies: "fills.glyphField", houses: "fills.houseField",
  cuspRuler: "fills.cuspDegreeBand", cuspLabels: "fills.cuspDegreeBand",
  hub: "fills.centerField",
};
export const WHEEL_BAND_BOUNDARY_ROLES: Record<WheelRingArchetypeId, WheelLinePaintRole> = {
  zodiac: "zodiacOuterRing", degree: "innerDegreeRing", terms: "termRing",
  decans: "zodiacInnerRing", cuspRuler: "cuspOuterRing", cuspLabels: "outerDegreeRing",
  bodies: "innerBoundaryRing", houses: "houseBoundaryRing", hub: "baseRing",
  aspects: "aspectBoundaryRing", outerHouses: "outerHouseRing", outerBodies: "outerMaximumRing",
};

/**
 * Radial bands, outer edge of the canvas to the hub. A given layout uses an
 * ordered subset of these.
 */
export type WheelBandId =
  | "degree"
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
  readonly instanceId?: string;
  /** Open external track; does not consume or enclose the primary radial stack. */
  readonly overlay?: boolean;
  /** Annotation space outside the enclosure; never consumes primary stack width. */
  readonly floating?: boolean;
  /** Outer edge radius in canvas px. */
  readonly outer: number;
  /** Inner edge radius in canvas px. Always <= outer for a valid layout. */
  readonly inner: number;
  /** False when the band's extent is gated off in this preview state. */
  readonly visible: boolean;
  /** Semantic paint classes whose occurrences live inside this band. */
  readonly contents: readonly string[];
  /** Effective width limits in rendered pixels, shared by solver and editor. */
  readonly widthBounds?: Readonly<{ min: number; max: number }>;
}

/** Adjacent parts of one painted surface share a single material extent.
 * Separated/reordered parts remain separate: never fill an intervening band.
 */
export function resolveWheelBandFillRegions(bands: readonly ResolvedWheelBand[]) {
  const regions: {classId: WheelAuthoringFillClass; outer: number; inner: number}[] = [];
  for (const band of bands) {
    if (band.id === "margin" || !band.visible || band.overlay || band.outer <= band.inner) continue;
    const classId = WHEEL_BAND_FILL_CLASSES[band.id];
    if (!classId) continue;
    const previous = regions[regions.length - 1];
    if (previous?.classId === classId && Math.abs(previous.inner - band.outer) < 1e-9) {
      previous.inner = band.inner;
    } else regions.push({classId, outer: band.outer, inner: band.inner});
  }
  return regions;
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

/** External cusp annotations need space, but no enclosing rim. Open comparison
 * tracks do not enclose the primary stack. Paint and editor use this same rule. */
export function wheelBandOuterBoundaryRole(
  band: ResolvedWheelBand,
  bands: readonly ResolvedWheelBand[],
): WheelLinePaintRole | null {
  if (band.id === "margin" || !band.visible || band.overlay || band.floating) return null;
  if (band.id === "cuspLabels" && bands.find(item => item.id !== "margin"
    && item.visible && !item.overlay && item.outer > item.inner) === band) return null;
  return WHEEL_BAND_BOUNDARY_ROLES[band.id];
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

/** The Anglo quadrant plus both no-zodiac cusp-band wheels. */
function isAngloFamilyProfile(profile: WheelTypographyProfile): boolean {
  return profile === "anglo" || isCuspBandProfile(profile);
}

function isCuspBandProfile(profile: WheelTypographyProfile): boolean {
  return profile === "houses" || profile === "cusps";
}

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

const HOUSES_ANCHOR_SPANS: Readonly<Record<string, WheelAnchorSpan>> =
  Object.freeze({
    ...ANGLO_ANCHOR_SPANS,
    // The House Wheel paints no zodiac, term, decan or cusp-ruler bands. Their
    // collapsed structural slots and the Anglo cusp-label slot form one visible
    // cusp band between r30 and rInner, and the run is centred in that whole
    // painted interval rather than inherited from the Anglo ruler layout.
    rCuspLabel: ["zodiac", "terms", "decans", "cuspRuler", "cuspLabels"],
    rPosHouses: ["zodiac", "terms", "decans", "cuspRuler", "cuspLabels"],
  });

export function wheelAnchorSpans(
  profile: WheelTypographyProfile,
): Readonly<Record<string, WheelAnchorSpan>> {
  return isCuspBandProfile(profile)
    ? HOUSES_ANCHOR_SPANS
    : isAngloFamilyProfile(profile)
      ? ANGLO_ANCHOR_SPANS
      : CLASSIC_ANCHOR_SPANS;
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
  degree: ["zodiac.tick.inner.1deg", "zodiac.tick.inner.5deg", "zodiac.tick.inner.10deg"],
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
    "bodies.outer.position",
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
  if (isAngloFamilyProfile(input.profile)) {
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
  const anglo = input.profile === "houses"
    ? style.geometry.houses
    : input.profile === "cusps"
      ? style.geometry.cusps
      : style.geometry.anglo;
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
  // Both cusp-band wheels share this resolver: each profile is this stack with
  // the zodiac band removed (signInnerScale 1) and every interior ratio already
  // carrying the depth that band gave up. Angular normalization is deliberately
  // outside the radial model.
  const cuspBandOnly = isCuspBandProfile(input.profile);
  const rings: MutableRings = {};
  const edges: Partial<Record<WheelBandId, BandEdges>> = {};

  // --- Zodiac band ------------------------------------------------------
  const r30 = maxRadius * zodiacRatio;
  const subdivisionSector = r30 * anglo.subdivisionSector;
  const termSector = !cuspBandOnly && input.showTerms ? subdivisionSector : 0;
  const decanSector = !cuspBandOnly && input.showDecans ? subdivisionSector : 0;
  const subdivisionInset = (termSector + decanSector) / 2;
  const r0 = cuspBandOnly ? r30 : r30 * anglo.signInnerScale + subdivisionInset;
  edges.zodiac = { outer: r30, inner: r0, visible: !cuspBandOnly };
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
  rings.r10 = cuspBandOnly ? r0 : resolveWheelRulerTerminal(
    style,
    input.profile,
    "zodiacInner",
    zodiacBand,
    r0,
    1,
    r0 + anglo.degreeTickLength * 3 * maxRadius,
  );
  [rings.r1, rings.r5] = interiorThird(r0, rings.r10);
  rings.rOuter0 = hasOuterRing && !cuspBandOnly
    ? maxRadius * anglo.outerSingle.degree0
    : r30;
  rings.rOuter10 = cuspBandOnly ? rings.rOuter0 : resolveWheelRulerTerminal(
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
  const subdivisionCount = cuspBandOnly
    ? 0
    : Number(input.showTerms) + Number(input.showDecans);
  const rulerSector =
    r30 * (anglo.rulerBaseScale - anglo.rulerSubdivisionScale * subdivisionCount);
  const rCuspLabelOuter = rCuspOuter - rulerSector;
  edges.terms = { outer: r0, inner: rDecans, visible: !cuspBandOnly && input.showTerms };
  edges.decans = {
    outer: rDecans,
    inner: rCuspOuter,
    visible: !cuspBandOnly && input.showDecans,
  };
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
  rings.rCuspLabel = cuspBandOnly
    ? (r30 + rInner) / 2
    : r30 * anglo.cuspLabelScale - subdivisionInset;
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
    isAngloFamilyProfile(input.profile)
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
  const resolved = COMPOSED_LAYOUTS.get(rings) ?? ORIGINAL_WIDTH_LAYOUTS.get(rings);
  if (resolved) return resolved;
  const family = wheelLayoutFamily(input);
  const canonical =
    isAngloFamilyProfile(input.profile)
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
  return usesOriginalWheelTopology(input) ? originalAuthoringBands(style, input, layout) : layout;
}

/** Secondary tracks reserve their own space beyond the actual primary rim.
 * Absolute primary-radius edits must not consume the comparison recipe's
 * clearance. Grow outward and let the common paint-envelope fitter fit the
 * complete wheel; never shrink the primary design or its glyphs to make room.
 */
export function reserveWheelSecondarySpace(
  style: WheelRenderStyle, input: WheelGeometryInput,
  canonical: Readonly<WheelRingSet>, rings: Readonly<WheelRingSet>,
  glyphClearance: number,
): Readonly<WheelRingSet> {
  if (!input.hasOuterRing && input.mode !== "comparison") return rings;
  const glyphField = rings.rOuterPlanet != null ? "rOuterPlanet" : "rAntis";
  // A topology may deliberately omit the outer body track. Do not resurrect
  // its fallback anchors. Untouched recipes retain their historical geometry.
  if (input.composition && !input.composition.rings.some(ring => ring.archetypeId === "outerBodies" && ring.enabled)) return rings;
  if ((!input.composition || usesOriginalWheelTopology(input))
    && rings.r30 === canonical.r30 && rings[glyphField] === canonical[glyphField]) return rings;
  const layout = resolveWheelBandLayout(style, input, rings);
  const rim = Math.max(rings.r30, ...layout.bands.filter(band =>
    band.id !== "margin" && !band.id.startsWith("outer") && band.visible && !band.overlay && !band.floating,
  ).map(band => band.outer));
  if (rings[glyphField]! - rim >= glyphClearance - 1e-9) return rings;
  const naturalClearance = Math.max(0, canonical[glyphField]! - canonical.r30);
  const clearance = Math.max(naturalClearance, glyphClearance);
  const fields = ["rOuterPlanet", "rOuterRetr", "rOuterMin", "rOuterHouseName",
    "rOuterMax", "rOuterHouse", "rOuterASCMC", "rOuterArrow", "rOuterLine",
    "rAntis", "rAntisLines"] as const;
  const next = {...rings} as MutableRings;
  let changed = false;
  for (const field of fields) {
    const value = rings[field], original = canonical[field];
    if (value == null || original == null || original < canonical.r30) continue;
    const offset = original - canonical.r30;
    const minimum = rim + offset + Math.max(0, clearance - naturalClearance);
    if (value < minimum - 1e-9) { next[field] = minimum; changed = true; }
  }
  if (!changed) return rings;
  // Only the uncomposed comparison ruler belongs to the external framework.
  // Composed rulers resolve from their own band or sign-hosted overlay.
  if (!input.composition) {
    for (const field of ["rOuter0", "rOuter1", "rOuter5", "rOuter10"] as const) {
      if (canonical[field] > canonical.r30) {
        next[field] = Math.max(rings[field], rim + canonical[field] - canonical.r30);
      }
    }
  }
  const result = Object.freeze(next) as Readonly<WheelRingSet>;
  const bands = layout.bands.map(band => {
    if (band.id === "outerBodies") return {...band, inner: rim,
      outer: band.overlay ? rim + 2 * (result[glyphField]! - rim) : result.rOuterHouse ?? result.rOuterMax!,
    };
    if (band.id === "outerHouses") return {...band,
      inner: band.overlay ? rim : result.rOuterHouse!,
      outer: result.rOuterMax ?? result.rOuterASCMC!,
    };
    if (band.id === "margin") {
      const inner = result.rOuterMax ?? rim;
      return {...band, inner, outer: Math.max(input.maxRadius, inner,
        ...fields.map(field => result[field] ?? 0)) + glyphClearance};
    }
    if (band.id === "degree" && band.overlay && !input.composition) return {...band,
      outer: isAngloFamilyProfile(input.profile) ? result.rOuter0 : result.r10,
      inner: isAngloFamilyProfile(input.profile) ? result.rOuter10 : result.r0};
    return band;
  });
  const target = input.composition && usesOriginalWheelTopology(input)
    ? ORIGINAL_WIDTH_LAYOUTS : COMPOSED_LAYOUTS;
  target.set(result, {...layout, rings: result, bands});
  return result;
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


// A solved RingSet carries one shared band artifact for paint, editor and hits.
// Weak ownership avoids global cache retention across document lifetimes.
const COMPOSED_LAYOUTS = new WeakMap<Readonly<WheelRingSet>, ResolvedWheelLayout>();
// Width authoring does not change an original design's paint recipe. Keep the
// resolved editing artifact separate from the structural-reflow paint mode.
const ORIGINAL_WIDTH_LAYOUTS = new WeakMap<Readonly<WheelRingSet>, ResolvedWheelLayout>();
const OUTER_ATTACHMENT_RADII = new WeakMap<Readonly<WheelRingSet>, number>();
export function composedWheelLayout(rings: Readonly<WheelRingSet>): ResolvedWheelLayout | undefined {
  return COMPOSED_LAYOUTS.get(rings);
}

/** Open annotations occupy local label boxes, not an enclosing circle. */
export function wheelOpenCuspLabelBand(rings: Readonly<WheelRingSet>): ResolvedWheelBand | undefined {
  const layout = COMPOSED_LAYOUTS.get(rings);
  const zodiac = layout?.bands.find(band => band.id === "zodiac" && band.visible && band.outer > band.inner);
  if (!layout || !zodiac) return undefined;
  return layout.bands.find(band => band.id === "cuspLabels" && band.visible
    && band.outer > band.inner && band.inner >= zodiac.outer - 1e-7
    && wheelBandOuterBoundaryRole(band, layout.bands) == null);
}

export function wheelExteriorCuspTickRadii(rings: Readonly<WheelRingSet>, preferred: number): readonly [number, number] | undefined {
  const band = wheelOpenCuspLabelBand(rings);
  if (!band) return undefined;
  const rim = wheelOuterAttachmentRadius(rings);
  return [rim, rim + Math.min(preferred / 4, (band.outer - band.inner) / 8)];
}

/** Leaders attach to the enclosing primary boundary. The cusp annotation
 * band does not create another attachment boundary outside the visible rim. */
export function wheelOuterAttachmentRadius(rings: Readonly<WheelRingSet>): number {
  const cached = OUTER_ATTACHMENT_RADII.get(rings);
  if (cached != null) return cached;
  const layout = COMPOSED_LAYOUTS.get(rings) ?? ORIGINAL_WIDTH_LAYOUTS.get(rings);
  if (!layout) return rings.r30;
  const radius = Math.max(rings.r30, ...layout.bands.filter(band => band.visible
    && !band.overlay && !band.floating && band.id !== "margin" && !band.id.startsWith("outer")
    && wheelBandOuterBoundaryRole(band, layout.bands) != null)
    .map(band => band.outer));
  OUTER_ATTACHMENT_RADII.set(rings, radius);
  return radius;
}

/** Explicit ring visibility wins over the original renderer's mode gates. */
export function wheelHasOuterDegreeRuler(input: Pick<WheelGeometryInput,
  "profile" | "composition" | "hasOuterRing" | "comparisonWithOuterHouses">): boolean {
  if (!ringEnabled(input.composition, "degree")) return false;
  const anglo = isAngloFamilyProfile(input.profile);
  if (anglo && input.composition) return true;
  return input.hasOuterRing && (!anglo || input.comparisonWithOuterHouses);
}

/** The ruler points inward above Signs and outward below Signs. */
function wheelTicksAtSigns(
  composition: WheelGeometryInput["composition"], kind: "degree" | "cuspRuler", outer: number, inner: number,
): Readonly<{base: number; tip: number}> {
  const instrument = composition?.rings.findIndex(ring => ring.archetypeId === kind);
  const zodiac = composition?.rings.findIndex(ring => ring.archetypeId === "zodiac");
  return instrument != null && zodiac != null && instrument > zodiac
    ? {base: inner, tip: outer}
    : {base: outer, tip: inner};
}

export function wheelDegreeTickEnds(
  composition: WheelGeometryInput["composition"], outer: number, inner: number,
): Readonly<{base: number; tip: number}> {
  return wheelTicksAtSigns(composition, "degree", outer, inner);
}

/** A Cusp ruler touching Signs uses the sign band's adjoining edge. */
export function wheelCuspRulerTickEnds(
  composition: WheelGeometryInput["composition"], band: ResolvedWheelBand,
): Readonly<{base: number; tip: number}> {
  return band.overlay ? wheelTicksAtSigns(composition, "cuspRuler", band.outer, band.inner)
    : {base: band.outer, tip: band.inner};
}

function usesOriginalWheelTopology(input: WheelGeometryInput): boolean {
  const composition = input.composition;
  if (!composition) return false;
  const original = WHEEL_FACTORY_SETTINGS.layouts[input.profile].composition;
  // Rulers and cusp annotations are optional instruments of the original
  // layout. Hiding/removing one must not select a different packing and paint
  // recipe for every remaining band. Reordering or adding instruments still
  // requires the general composition solver.
  const optional = (kind: string) => kind === "degree" || kind === "cuspRuler" || kind === "cuspLabels";
  const retained = original.rings.filter(source => !optional(source.archetypeId)
    || composition.rings.some(ring => ring.archetypeId === source.archetypeId && ring.enabled));
  const activeOrder = composition.rings.filter(ring => !optional(ring.archetypeId) || ring.enabled);
  if (composition.projection !== original.projection || activeOrder.length !== retained.length) return false;
  return activeOrder.every((ring, index) => {
    const source = retained[index];
    if (ring.archetypeId !== source.archetypeId || ring.chartRole !== source.chartRole) return false;
    if (optional(ring.archetypeId) && source.enabled) return true;
    if (ring.chartRole === "outer" && (input.mode !== "comparison"
      || (ring.archetypeId === "outerHouses" && !(input.showOuterHouses ?? input.comparisonWithOuterHouses)))) return true;
    const enabled = ring.archetypeId === "terms" ? input.showTerms && !isCuspBandProfile(input.profile)
      : ring.archetypeId === "decans" ? input.showDecans && !isCuspBandProfile(input.profile)
      : ring.archetypeId === "houses" ? input.showHouses : source.enabled;
    return ring.enabled === enabled;
  });
}

/** Describe the visible original bands without splitting a hosted ruler out of
 * its sign band, or retaining the invisible Anglo ruler slot in Cusp/House. */
function originalAuthoringBands(style: WheelRenderStyle, input: WheelGeometryInput, layout: ResolvedWheelLayout): ResolvedWheelLayout {
  const rings = layout.rings;
  const bands: ResolvedWheelBand[] = layout.bands.map(band => {
    const instance = input.composition?.rings.find(ring => ring.archetypeId === band.id);
    const adjusted = isCuspBandProfile(input.profile) && band.id === "cuspLabels"
      ? {...band, outer: rings.r30}
      : isCuspBandProfile(input.profile) && band.id === "cuspRuler"
        ? {...band, outer: rings.r30, inner: rings.r30, visible: false} : band;
    const visible = adjusted.visible && (!input.composition || Boolean(instance?.enabled) || band.id === "margin");
    return {...adjusted, visible, instanceId: instance?.instanceId};
  });
  const addOverlay = (id: WheelRingArchetypeId, outer: number, inner: number, visible: boolean) => {
    const instance = input.composition?.rings.find(ring => ring.archetypeId === id);
    if (!instance?.enabled || !visible || outer <= inner) return;
    bands.push({id, instanceId: instance.instanceId, outer, inner, visible: true,
      overlay: true, contents: WHEEL_RING_ARCHETYPES[id].paintClasses});
  };
  const outerRuler = isAngloFamilyProfile(input.profile);
  const attachedAnglo = input.profile === "anglo" && wheelHasOuterDegreeRuler(input);
  const signWidth = rings.r30 - rings.r0;
  const attachedDepth = attachedAnglo ? Math.min(signWidth * WHEEL_RULER_DEPTH_RANGE.max,
    resolveWheelRulerDepth(style, input.profile, "zodiacOuter", signWidth,
      Math.abs(rings.rOuter0 - rings.rOuter10))) : 0;
  addOverlay("degree", attachedAnglo ? rings.r0 + attachedDepth : outerRuler ? rings.rOuter0 : rings.r10,
    attachedAnglo ? rings.r0 : outerRuler ? rings.rOuter10 : rings.r0,
    !outerRuler || wheelHasOuterDegreeRuler(input));
  if (layout.family === "angloComparisonNoHouses" || (input.hasOuterRing && input.mode !== "comparison")) {
    const center = rings.rOuterPlanet ?? rings.rAntis ?? rings.r30;
    addOverlay("outerBodies", 2 * center - rings.r30, rings.r30, true);
    addOverlay("outerHouses", rings.rOuterASCMC ?? rings.rOuterArrow ?? rings.r30, rings.r30,
      input.mode === "comparison" && Boolean(input.showOuterHouses));
  }
  return {...layout, bands};
}

/** Resize an allocated stack. Unedited bands retain their widths; extra
 * width consumes the hub, then stops. Only jointly oversized imported edits
 * share the available growth, never the unedited bands. */
function resizeWheelBandStack(style: WheelRenderStyle, input: WheelGeometryInput,
  stack: readonly ResolvedWheelBand[], carriedWidths: Readonly<Record<string, number>> = {}): ResolvedWheelBand[] {
  const scale = input.maxRadius / style.authoringOverrides.referenceRadius;
  const widths = style.authoringOverrides.ringWidths?.[input.profile] ?? {};
  const hub = stack.find(band => band.id === "hub")!;
  const hubMinimum = Math.min(hub.outer, WHEEL_RING_ARCHETYPES.hub.minWidth * scale);
  const minimum = (band: ResolvedWheelBand) => band.id === "margin" ? band.outer - band.inner
    : Math.min(band.outer - band.inner, WHEEL_RING_ARCHETYPES[band.id].minWidth * scale);
  // Authored radii can leave depth in an invisible subdivision slot. Give that
  // depth to Signs, keeping the inner bands and the wheel's outer edge fixed.
  // The saved radii remain untouched, so showing the subdivisions restores
  // their original widths.
  const zodiac = stack.find(band => band.id === "zodiac" && band.visible);
  const reclaimed = zodiac ? stack.reduce((total, band) =>
    total + ((!band.visible && (band.id === "terms" || band.id === "decans"))
      ? band.outer - band.inner : 0), 0) : 0;
  const pinnedAngloCusp = input.profile === "anglo"
    && style.authoringOverrides.ringRadii.anglo?.cuspOuterRing !== undefined
    && (!input.showTerms || !input.showDecans);
  const fullCuspWidth = pinnedAngloCusp
    ? resolveCanonicalWheelLayout(style, {...input, showTerms: true, showDecans: true})
      .bands.find(band => band.id === "cuspRuler")! : undefined;
  const pinnedCuspLabels = pinnedAngloCusp
    && style.authoringOverrides.ringRadii.anglo?.innerBoundaryRing !== undefined
    ? ((style.authoringOverrides.ringRadii.anglo.cuspOuterRing!
      - style.authoringOverrides.ringRadii.anglo.innerBoundaryRing!) * scale
      - (fullCuspWidth!.outer - fullCuspWidth!.inner)) : undefined;
  const desired = stack.map(band => {
    const old = band.outer - band.inner;
    const requested = band.instanceId ? widths[band.instanceId] : undefined;
    if (!band.visible && (band.id === "terms" || band.id === "decans"
      || band.id === "cuspRuler" || band.id === "cuspLabels")) return 0;
    if (band === zodiac) return (requested == null ? old
      : Math.max(minimum(band), requested * scale)) + reclaimed;
    // Anglo's automatic ruler width grows as subdivision density falls. A
    // pinned cusp boundary instead keeps the ruler's saved full-density width;
    // the newly free depth belongs to Signs rather than a blank ruler band.
    if (band.id === "cuspRuler" && pinnedAngloCusp && requested == null)
      return Math.max(minimum(band), fullCuspWidth!.outer - fullCuspWidth!.inner);
    if (band.id === "cuspLabels" && pinnedCuspLabels !== undefined && requested == null)
      return Math.max(minimum(band), pinnedCuspLabels);
    return band.id === "hub" || !band.visible || requested == null ? old
      : Math.max(minimum(band), requested * scale + (band.instanceId ? carriedWidths[band.instanceId] ?? 0 : 0));
  });
  let growth = 0, released = 0;
  stack.forEach((band, index) => {
    const delta = desired[index] - (band.outer - band.inner);
    growth += Math.max(0, delta);
    released += Math.max(0, -delta);
  });
  const capacity = Math.max(0, hub.outer - hubMinimum) + released;
  const growthShare = growth > capacity ? capacity / growth : 1;
  let edge = stack[0]?.outer ?? input.maxRadius;
  const solved = stack.map((band, index): ResolvedWheelBand => {
    const old = band.outer - band.inner;
    const delta = desired[index] - old;
    const used = old + (delta > 0 ? delta * growthShare : delta);
    const outer = edge;
    const inner = band.id === "hub" ? 0 : Math.max(0, outer - used);
    edge = inner;
    return {...band, outer, inner};
  });
  const remaining = Math.max(0, solved.find(band => band.id === "hub")!.outer - hubMinimum);
  return solved.map((band, index) => ({...band,
    widthBounds: {min: minimum(stack[index]), max: band.outer - band.inner + remaining}}));
}

/** Open tracks attach to the rim. Their widths move their own content, without
 * enclosing or taking space from the primary wheel or the other outer role. */
function resizeOpenWheelTrack(style: WheelRenderStyle, input: WheelGeometryInput,
  band: ResolvedWheelBand, legacy: Readonly<WheelRingSet>,
  next: {-readonly [K in keyof WheelRingSet]: WheelRingSet[K]}): ResolvedWheelBand {
  const scale = input.maxRadius / style.authoringOverrides.referenceRadius;
  const oldWidth = band.outer - band.inner;
  const minimum = Math.min(oldWidth, WHEEL_RING_ARCHETYPES[band.id as WheelRingArchetypeId].minWidth * scale);
  const maximum = Math.max(oldWidth, minimum, input.maxRadius - band.inner);
  const requested = band.instanceId ? style.authoringOverrides.ringWidths?.[input.profile]?.[band.instanceId] : undefined;
  const width = requested == null ? oldWidth : Math.min(maximum, Math.max(minimum, requested * scale));
  if (Math.abs(width - oldWidth) > 1e-9 && oldWidth > 0) {
    const fields = band.id === "outerBodies"
      ? ["rOuterPlanet", "rOuterRetr", "rOuterLine", "rAntis", "rAntisLines"] as const
      : ["rOuterASCMC", "rOuterArrow", "rOuterHouseName"] as const;
    for (const field of fields) {
      const value = legacy[field];
      if (value != null) next[field] = band.inner + (value - band.inner) * width / oldWidth;
    }
  }
  return {...band, outer: band.inner + width, widthBounds: {min: minimum, max: maximum}};
}

function resizeOriginalWheelBands(style: WheelRenderStyle, input: WheelGeometryInput,
  legacy: Readonly<WheelRingSet>): Readonly<WheelRingSet> {
  const source = resolveWheelBandLayout(style, input, legacy);
  const scale = input.maxRadius / style.authoringOverrides.referenceRadius;
  const widths = style.authoringOverrides.ringWidths?.[input.profile] ?? {};
  const stack = source.bands.filter(band => !band.overlay);
  const solved = resizeWheelBandStack(style, input, stack);
  const mapRadius = (value: number) => {
    const index = stack.findIndex(band => band.outer > band.inner && value <= band.outer + 1e-9 && value >= band.inner - 1e-9);
    if (index < 0) return value;
    const from = stack[index], to = solved[index];
    if (Math.abs(from.outer - to.outer) < 1e-9 && Math.abs(from.inner - to.inner) < 1e-9) return value;
    return to.inner + (value - from.inner) * (to.outer - to.inner) / (from.outer - from.inner);
  };
  const next = {...legacy} as {-readonly [K in keyof WheelRingSet]: WheelRingSet[K]};
  for (const field of Object.keys(legacy) as (keyof WheelRingSet)[]) {
    const value = legacy[field];
    if (value == null) continue;
    // Open transit tracks are outside the primary stack even when one of their
    // label anchors happens to fall inside its radial span.
    if ((source.family === "angloComparisonNoHouses" || (input.hasOuterRing && input.mode !== "comparison"))
      && (field.startsWith("rOuter") || field.startsWith("rAntis"))) continue;
    next[field] = mapRadius(value);
    if (OFFSET_ANCHORS.has(field)) {
      const index = stack.findIndex(band => band.outer > band.inner && value <= band.outer && value >= band.inner);
      if (index < 0) continue;
      const from = stack[index], to = solved[index];
      if (Math.abs(from.outer - to.outer) < 1e-9 && Math.abs(from.inner - to.inner) < 1e-9) continue;
      const fromOuter = from.outer - value, fromInner = value - from.inner;
      next[field] = Math.min(to.outer, Math.max(to.inner, fromOuter <= fromInner ? to.outer - fromOuter : to.inner + fromInner));
    }
  }
  const bands = [...solved];
  for (const overlay of source.bands.filter(band => band.overlay)) {
    if (overlay.id.startsWith("outer")) {
      bands.push(resizeOpenWheelTrack(style, input, overlay, legacy, next));
      continue;
    }
    const requested = overlay.instanceId ? widths[overlay.instanceId] : undefined;
    let outer = mapRadius(overlay.outer), inner = mapRadius(overlay.inner);
    const attachedAnglo = overlay.id === "degree" && input.profile === "anglo"
      && wheelHasOuterDegreeRuler(input);
    const max = overlay.id === "degree"
      ? attachedAnglo ? (next.r30 - next.r0) * WHEEL_RULER_DEPTH_RANGE.max
        : isAngloFamilyProfile(input.profile) ? next.rOuter0 - (next.rOuter0 > next.r30 ? next.r30 : next.r0) : next.r30 - next.r0
      : outer - inner;
    const min = Math.min(outer - inner, WHEEL_RING_ARCHETYPES[overlay.id as WheelRingArchetypeId].minWidth * scale);
    if ((requested != null || attachedAnglo) && overlay.id === "degree") {
      const depth = Math.max(min, Math.min(Math.max(min, max), requested == null ? outer - inner : requested * scale));
      if (attachedAnglo) {
        next.rOuter0 = next.r0 + depth;
        next.rOuter10 = next.r0;
        [next.rOuter1, next.rOuter5] = interiorThird(next.rOuter0, next.rOuter10);
        outer = next.rOuter0; inner = next.rOuter10;
      } else if (isAngloFamilyProfile(input.profile)) {
        next.rOuter10 = next.rOuter0 - depth;
        [next.rOuter1, next.rOuter5] = interiorThird(next.rOuter0, next.rOuter10);
        outer = next.rOuter0; inner = next.rOuter10;
      } else {
        next.r10 = next.r0 + depth;
        [next.r1, next.r5] = interiorThird(next.r0, next.r10);
        outer = next.r10; inner = next.r0;
      }
    }
    bands.push({...overlay, outer, inner, widthBounds: {min, max: Math.max(min, max)}});
  }
  const result = Object.freeze(next);
  ORIGINAL_WIDTH_LAYOUTS.set(result, {...source, bands, rings: result});
  return result;
}

/** Compile stable semantic instances to contiguous bands. Legacy profiles are
 * sampled once per solve into widths, never treated as independent live pins. */
export function composeWheelBands(
  style: WheelRenderStyle,
  input: WheelGeometryInput,
  legacy: Readonly<WheelRingSet>,
): Readonly<WheelRingSet> {
  const composition = input.composition;
  if (!composition) return legacy;
  if (usesOriginalWheelTopology(input)) return resizeOriginalWheelBands(style, input, legacy);
  const source = resolveWheelBandLayout(style, input, legacy);
  const sourceById = new Map(source.bands.map(b => [b.id, b]));
  const scale = input.maxRadius / style.authoringOverrides.referenceRadius;
  const active = composition.rings.filter(ring => ring.enabled
    && (ring.chartRole !== "outer" || input.mode === "comparison"
      || (input.hasOuterRing && ring.archetypeId === "outerBodies"))
    && (ring.archetypeId !== "outerHouses" || (input.showOuterHouses ?? input.comparisonWithOuterHouses)));
  const sourceFrame = sourceById.get("margin")!;
  const openOuterTracks = source.family === "angloComparisonNoHouses"
    || (input.hasOuterRing && input.mode !== "comparison");
  const outerLimit = sourceFrame.inner;
  const frame = sourceFrame;
  const primary = active.filter(ring => ring.chartRole !== "outer");
  const hasClosedOuterBands = input.mode === "comparison" && !openOuterTracks
    && active.some(ring => ring.chartRole === "outer");
  const floatingCusp = !hasClosedOuterBands && primary[0]?.archetypeId === "cuspLabels"
    && primary.some(ring => ring.archetypeId === "zodiac") ? primary[0] : undefined;
  const zodiacIndex = primary.findIndex(ring => ring.archetypeId === "zodiac");
  const degreeIndex = primary.findIndex(ring => ring.archetypeId === "degree");
  const cuspRulerIndex = primary.findIndex(ring => ring.archetypeId === "cuspRuler");
  const hostedDegree = zodiacIndex >= 0 && Math.abs(degreeIndex - zodiacIndex) === 1
    ? primary[degreeIndex] : undefined;
  const hostedCuspRuler = zodiacIndex >= 0 && Math.abs(cuspRulerIndex - zodiacIndex) === 1
    ? primary[cuspRulerIndex] : undefined;
  // When Degree moves to the outside of Signs, Cusp ruler can occupy the
  // inside of Signs. Keep its former space with the annotations so the chart
  // points do not jump outward and the combined cusp lane does not collapse.
  const originalCuspWidth = Math.max(0, (sourceById.get("cuspRuler")?.outer ?? 0)
    - (sourceById.get("cuspRuler")?.inner ?? 0));
  const cuspWidthOverride = hostedCuspRuler
    ? style.authoringOverrides.ringWidths?.[input.profile]?.[hostedCuspRuler.instanceId] : undefined;
  const cuspAnnotationCarry = hostedCuspRuler && degreeIndex >= 0 && degreeIndex < zodiacIndex
    ? cuspWidthOverride == null ? originalCuspWidth
      : Math.max(Math.min(originalCuspWidth, WHEEL_RING_ARCHETYPES.cuspRuler.minWidth * scale),
        cuspWidthOverride * scale) : 0;
  const stacked = (openOuterTracks ? primary : active).filter(ring => ring !== floatingCusp
    && ring !== hostedDegree && ring !== hostedCuspRuler);
  const minimum = (kind: WheelRingArchetypeId) => WHEEL_RING_ARCHETYPES[kind].minWidth * scale;
  const entries = stacked.map(ring => {
    const old = sourceById.get(ring.archetypeId);
    let priorWidth = old && old.outer - old.inner > 0 ? old.outer - old.inner : undefined;
    if (ring.archetypeId === "cuspLabels" && isCuspBandProfile(input.profile)) {
      priorWidth = legacy.r30 - legacy.rInner;
    }
    if (ring.archetypeId === "cuspLabels" && priorWidth != null) {
      priorWidth += cuspAnnotationCarry;
    }
    // Sample the recipe's hosted ruler once. Its current visibility must not
    // change the sign band's preferred width (and then compress every band).
    if (ring.archetypeId === "zodiac" && priorWidth != null
      && degreeIndex >= 0 && !hostedDegree) {
      priorWidth = Math.max(minimum("zodiac"), priorWidth - Math.abs(legacy.r10 - legacy.r0));
    }
    if (ring.archetypeId === "degree") priorWidth = Math.abs(legacy.r10 - legacy.r0) || undefined;
    const width = priorWidth ?? WHEEL_RING_ARCHETYPES[ring.archetypeId].preferredWidth * scale;
    return { ring, width: ring.archetypeId === "hub" ? minimum("hub") : Math.max(minimum(ring.archetypeId), width) };
  });
  const minimumTotal = entries.reduce((sum, e) => sum + minimum(e.ring.archetypeId), 0);
  const preferredTotal = entries.reduce((sum, e) => sum + e.width, 0);
  const available = Math.max(0, outerLimit - minimumTotal);
  const extra = Math.max(0, preferredTotal - minimumTotal);
  const compression = extra > available ? available / extra : 1;
  let edge = outerLimit;
  const bands: ResolvedWheelBand[] = [frame];
  for (const {ring, width} of entries) {
    const min = minimum(ring.archetypeId);
    const used = min + (width - min) * compression;
    const inner = ring.archetypeId === "hub" ? 0 : Math.max(0, edge - used);
    bands.push({id: ring.archetypeId, instanceId: ring.instanceId,
      outer: edge, inner, visible: true, contents: WHEEL_RING_ARCHETYPES[ring.archetypeId].paintClasses});
    edge = inner;
  }
  // Fit the new topology once, then use the same width budget as originals.
  // A numeric width edit must not trigger another global packing/compression.
  const annotation = stacked.find(ring => ring.archetypeId === "cuspLabels");
  bands.splice(0, bands.length, ...resizeWheelBandStack(style, input, bands,
    annotation && cuspAnnotationCarry ? {[annotation.instanceId]: cuspAnnotationCarry} : {}));
  for (const instrument of [hostedDegree, hostedCuspRuler]) {
    if (!instrument) continue;
    const kind = instrument.archetypeId as "degree" | "cuspRuler";
    const zodiac = bands.find(band => band.id === "zodiac")!;
    const hostWidth = zodiac.outer - zodiac.inner;
    const maximum = hostWidth * WHEEL_RULER_DEPTH_RANGE.max;
    const minDepth = Math.min(maximum, minimum(kind));
    const source = sourceById.get(kind);
    const natural = kind === "degree" ? Math.abs(legacy.r10 - legacy.r0)
      : source && source.outer > source.inner ? source.outer - source.inner
        : WHEEL_RING_ARCHETYPES.cuspRuler.preferredWidth * scale;
    const requested = style.authoringOverrides.ringWidths?.[input.profile]?.[instrument.instanceId];
    const depth = Math.min(maximum, Math.max(minDepth, requested == null ? natural : requested * scale));
    const index = kind === "degree" ? degreeIndex : cuspRulerIndex;
    const outside = index < zodiacIndex;
    bands.push({id: kind, instanceId: instrument.instanceId, overlay: true,
      outer: outside ? zodiac.outer : zodiac.inner + depth,
      inner: outside ? zodiac.outer - depth : zodiac.inner,
      visible: true, contents: WHEEL_RING_ARCHETYPES[kind].paintClasses,
      widthBounds: {min: minDepth, max: maximum}});
  }
  if (floatingCusp) {
    const old = sourceById.get("cuspLabels");
    const min = minimum("cuspLabels");
    const natural = old && old.outer > old.inner ? old.outer - old.inner
      : WHEEL_RING_ARCHETYPES.cuspLabels.preferredWidth * scale;
    const max = Math.max(natural, min, input.maxRadius - outerLimit);
    const authored = style.authoringOverrides.ringWidths?.[input.profile]?.[floatingCusp.instanceId];
    const width = Math.min(max, Math.max(Math.min(min, natural), authored == null ? natural : authored * scale));
    bands.splice(1, 0, {id: "cuspLabels", instanceId: floatingCusp.instanceId, floating: true,
      inner: outerLimit, outer: outerLimit + width, visible: true,
      contents: WHEEL_RING_ARCHETYPES.cuspLabels.paintClasses, widthBounds: {min: Math.min(min, natural), max}});
  }
  const exteriorOffset = outerLimit - legacy.r30;
  if (openOuterTracks) {
    for (const ring of active.filter(item => item.chartRole === "outer")) {
      const body = ring.archetypeId === "outerBodies";
      const center = (legacy.rOuterPlanet ?? legacy.rAntis ?? legacy.r30) + exteriorOffset;
      bands.push({id: ring.archetypeId, instanceId: ring.instanceId, overlay: true,
        inner: outerLimit,
        outer: body ? 2 * center - outerLimit : (legacy.rOuterASCMC ?? legacy.rOuterArrow ?? legacy.r30) + exteriorOffset,
        visible: true, contents: WHEEL_RING_ARCHETYPES[ring.archetypeId].paintClasses});
    }
  }
  // Missing bands are zero depth and have no paint or hit regions. Supply
  // collapsed slots solely for the legacy numeric adapter's optional fields.
  const byId = new Map(bands.map(b => [b.id, b]));
  const band = (id: WheelBandId) => byId.get(id) ?? { outer: edge, inner: edge };
  const next = {...remapWheelAnchorsToBands(input.profile, source.bands, bands, legacy)} as
    {-readonly [K in keyof WheelRingSet]: WheelRingSet[K]};
  const zodiac = band("zodiac"), terms = band("terms"), decans = band("decans");
  const primaryOuter = bands.find(item => item.id !== "margin" && !item.floating
    && WHEEL_RING_ARCHETYPES[item.id].chartRole === "primary")!.outer;
  next.r30 = byId.has("zodiac") ? zodiac.outer : primaryOuter;
  next.r0 = byId.has("zodiac") ? zodiac.inner : primaryOuter;
  next.rSign = (zodiac.outer + zodiac.inner) / 2;
  next.rASCMC = primaryOuter;
  next.rArrow = Math.min(input.maxRadius, primaryOuter + Math.max(0, legacy.rArrow - legacy.r30));
  next.rTerms = terms.outer; next.rTermsInner = terms.inner;
  next.rTermsPlanet = (terms.outer + terms.inner) / 2;
  next.rDecans = decans.outer; next.rDecansInner = decans.inner;
  next.rDecansPlanet = (decans.outer + decans.inner) / 2;
  const ruler = band("degree");
  next.rDegreeOuter = ruler.outer; next.rDegreeInner = ruler.inner;
  next.rOuter0 = ruler.outer; next.rOuter10 = ruler.inner;
  next.rOuter1 = ruler.outer - (ruler.outer - ruler.inner) / 3;
  next.rOuter5 = ruler.outer - (ruler.outer - ruler.inner) * 2 / 3;
  next.r10 = ruler.outer; next.r1 = ruler.inner + (ruler.outer - ruler.inner) / 3;
  next.r5 = ruler.inner + (ruler.outer - ruler.inner) * 2 / 3;
  const cuspRuler = band("cuspRuler"), labels = band("cuspLabels");
  next.rCuspOuter = byId.has("cuspRuler") && !hostedCuspRuler ? cuspRuler.outer
    : byId.has("cuspLabels") ? labels.outer : band("bodies").outer;
  next.rCuspRulerInner = byId.has("cuspRuler") && !hostedCuspRuler ? cuspRuler.inner : next.rCuspOuter;
  next.rCuspLabelOuter = byId.has("cuspLabels") ? labels.outer : next.rCuspRulerInner;
  if (byId.has("cuspLabels")) next.rCuspLabel = next.rPosHouses = (labels.outer + labels.inner) / 2;
  const bodies = band("bodies"), houses = band("houses"), hub = band("hub");
  next.rInner = byId.has("bodies") ? bodies.outer : byId.has("houses") ? houses.outer : hub.outer;
  next.rHouse = byId.has("houses") ? houses.outer : hub.outer;
  if (byId.has("bodies")) {
    const old = sourceById.get("bodies");
    for (const key of ["rPlanet", "rPos", "rPosDeg", "rPosMin", "rRetr"] as const) {
      const value = legacy[key];
      if (value == null || !old) continue;
      const ratio = Math.max(.05, Math.min(.95, (value - old.inner) / Math.max(1, old.outer - old.inner)));
      next[key] = bodies.inner + ratio * (bodies.outer - bodies.inner);
    }
  }
  next.rHouseName = (houses.outer + houses.inner) / 2;
  next.rBase = hub.outer;
  next.rAsp = byId.has("aspects") ? band("aspects").outer : hub.outer;
  const outerBodies = byId.get("outerBodies"), outerHouses = byId.get("outerHouses");
  if (openOuterTracks) {
    // Exterior glyphs, text, and cusp rays share tracks outside the primary
    // stack. Keep their anchors independent of edits to its interior bands.
    for (const key of ["rOuterPlanet", "rOuterRetr", "rOuterMax", "rOuterHouse",
      "rOuterHouseName", "rOuterMin", "rOuterASCMC", "rOuterArrow", "rOuterLine",
      "rAntis", "rAntisLines"] as const) next[key] = (legacy[key] == null ? undefined : legacy[key]! + exteriorOffset) as never;
    if (!outerBodies) next.rOuterPlanet = next.rOuterRetr = undefined;
    const anchored = {...next};
    for (let index = 0; index < bands.length; index++) {
      if (bands[index].overlay && bands[index].id.startsWith("outer")) {
        bands[index] = resizeOpenWheelTrack(style, input, bands[index], anchored, next);
      }
    }
  } else if (input.mode === "comparison") {
    // All comparison anchors belong to the resolved outer zone. Do not retain
    // absolute radii from a removed band or a different legacy biwheel recipe.
    next.rOuterPlanet = outerBodies ? (outerBodies.outer + outerBodies.inner) / 2 : undefined;
    next.rOuterRetr = outerBodies ? outerBodies.inner + (outerBodies.outer - outerBodies.inner) * .25 : undefined;
    next.rOuterMax = outerHouses?.outer ?? outerBodies?.outer ?? primaryOuter;
    next.rOuterHouse = outerHouses?.inner;
    next.rOuterHouseName = outerHouses ? (outerHouses.outer + outerHouses.inner) / 2 : undefined;
    next.rOuterMin = outerBodies?.inner ?? outerHouses?.inner ?? primaryOuter;
    next.rOuterASCMC = next.rOuterArrow = next.rOuterMax;
    next.rOuterLine = next.rOuterMax;
    next.rAntis = next.rOuterPlanet ?? next.rOuterMax;
    next.rAntisLines = next.rOuterLine;
  }
  const result = Object.freeze(next);
  COMPOSED_LAYOUTS.set(result, {family: source.family, bands, rings: result, violations: []});
  return result;
}
