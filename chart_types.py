# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Chart type constants with semantic documentation.

This module documents the chart type constants used throughout Morinus.
Chart types define the *semantic role* of a chart: is it a birth chart,
a derived chart, a symbolic computation, or a relationship view?

Every chart has an `htype` (horoscope type) field that identifies its type.
This determines:
- How it's created and what inputs it needs
- Whether it has a "real" session cursor (time that can be stepped)
- How it appears in hierarchies and relationships
- What operations are valid on it

Note: These are defined in chart.py as simple integers. This documentation
module serves as the semantic reference.
"""

from enum import IntEnum


class ChartType(IntEnum):
    """Chart type enumeration with semantic documentation."""

    RADIX = 0
    """Birth/natal chart. The foundational chart at a specific birth moment.

    Properties:
    - Static historical moment (usually in the past)
    - Is a "real" chart with actual time
    - Can be the radix for derived charts
    - Is the anchor for supplementary charts
    - Multiple charts can reference the same radix
    """

    SOLAR = 1
    """Solar return chart. Calculated for the annual return of the Sun to
    the same longitude as the natal Sun.

    Properties:
    - Real calculated moment (once per year)
    - Has actual time (can be stepped to nearby moments)
    - Derived from a radix + year
    - Can be used as center in synastry
    - Can appear as a child under a radix in hierarchy
    """

    LUNAR = 2
    """Lunar return chart. Calculated for the monthly return of the Moon to
    the same longitude as the natal Moon.

    Properties:
    - Real calculated moment (roughly once per month)
    - Has actual time
    - Derived from a radix + month
    - Can be used in synastry
    - Appears as child under radix
    """

    REVOLUTION = 3
    """Generic revolution chart. Return of any planet to its natal longitude.

    Properties:
    - Real calculated moment
    - Has actual time
    - Derived from radix + body + year/cycle
    - Can be used in synastry
    """

    TRANSIT = 4
    """Transit chart. Planetary positions at an arbitrary real moment.

    Properties:
    - Real calculated moment (past, present, or future)
    - Has actual time (mutable via stepping)
    - Can be created for any datetime
    - Usually used as "outer" chart in synastry against a radix
    - Commonly appears as child under a radix showing "transits for this date"
    - Can be created from Shift+drag (source datetime at target location)
    """

    HORARY = 5
    """Horary chart. Chart cast for the moment a question is asked.

    Properties:
    - Real moment (the question-asking moment)
    - Has actual time
    - Can be used as center in synastry
    - Not a derived chart; independent creation
    """

    PROFECTION = 6
    """Annual profection chart. Symbolic advancement of all houses/points.

    Properties:
    - Symbolic moment (imaginary, not real time)
    - Has a time cursor (can be stepped through years/months)
    - Derived from radix + year offset
    - Can be used in synastry
    - Appears as child under radix
    - Has real session for stepping
    """

    PDINCHART = 7
    """Primary Directions in Chart. Symbolic PD calculation shown in-chart.

    Properties:
    - Symbolic (not real time)
    - Has a time cursor (can be stepped through symbols)
    - Derived from radix + PD settings
    - Can appear as child under radix
    - Not typically used as center in synastry
    """

    COMPOSITE = 8
    """Symbolic midpoint composite. Purely mathematical average of two charts.

    Properties:
    - SYMBOLIC (no real session cursor)
    - Calculated from two charts' midpoints
    - No real time (cannot be stepped meaningfully)
    - Is a relationship view, not a real derived chart
    - Cannot be used as source for Shift+drag (no cursor)
    - Excludes from: synastry as center, transits, most operations

    This is the only chart type WITHOUT a real session cursor.
    """

    RELATIONSHIP = 9
    """Relationship composite (Davison or other real-time composite).

    Properties:
    - Real calculated moment (Davison: midpoint time at midpoint location)
    - Has actual time (can be stepped)
    - Created from two real charts' time/place midpoints
    - Can be used in synastry or as navigation point
    - Is a "real" chart with actual position
    - Appears as child under first participant
    """


# Chart type grouping helpers

REAL_TIME_CHARTS = {ChartType.RADIX, ChartType.SOLAR, ChartType.LUNAR,
                    ChartType.REVOLUTION, ChartType.TRANSIT, ChartType.HORARY,
                    ChartType.PROFECTION, ChartType.PDINCHART,
                    ChartType.RELATIONSHIP}
"""Charts that have real, actual times (not symbolic).

These can be stepped, calculated, and used in time-dependent operations."""

SYMBOLIC_CHARTS = {ChartType.COMPOSITE}
"""Charts that are purely symbolic (no real time).

These cannot be stepped, used as time sources, or expected to have meaningful
navigation cursors. Only COMPOSITE is currently purely symbolic."""

DERIVED_CHARTS = {ChartType.SOLAR, ChartType.LUNAR, ChartType.REVOLUTION,
                  ChartType.PROFECTION, ChartType.PDINCHART, ChartType.COMPOSITE,
                  ChartType.RELATIONSHIP}
"""Charts derived from other charts.

These are created from a parent (radix or other base) plus configuration.
They typically appear as children in the hierarchy under their parent."""

REAL_DERIVED_CHARTS = DERIVED_CHARTS - SYMBOLIC_CHARTS
"""Derived charts with real session cursors (can be stepped, navigated)."""

SYNASTRY_COMPATIBLE_CHARTS = REAL_TIME_CHARTS - {ChartType.COMPOSITE}
"""Charts that can participate in synastry.

COMPOSITE is excluded because it has no real cursor. All other real-time
charts can be paired for synastry or comparison views."""
