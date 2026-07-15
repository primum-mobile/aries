# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Workspace session schema documentation.

This module defines the structure of workspace session dictionaries used throughout
the workspace shell and main controller. These are the canonical data contracts for
session state.

A workspace session is a dictionary that holds all state for a single workspace tab:
the chart being displayed, its session object, supplementary configuration, rendering
state, UI state (title, dirty flag), and relationships to other sessions (parent,
synastry pair, composite variants, etc).

Sessions are stored in self._workspace_sessions (dict[document_id, session_dict])
and are the unit of persistence and navigation.
"""

from typing import Any, TypedDict, Optional, Callable
from enum import Enum


# ── Place payload (serialized geographic location) ────────────────────────
# Used in supplementary_binding.retained_state when a location override is
# stored.  Also the wire format for place_to_payload() / payload_to_place().

class PlacePayload(TypedDict):
    """Serialized geographic location for persistence and inter-session transfer."""
    place: str           # Location name (e.g. 'New York')
    deglon: int          # Longitude degrees (0-180)
    minlon: int          # Longitude arc-minutes (0-59)
    seclon: int          # Longitude arc-seconds (0-59)
    east: bool           # True = East longitude, False = West
    deglat: int          # Latitude degrees (0-90)
    minlat: int          # Latitude arc-minutes (0-59)
    seclat: int          # Latitude arc-seconds (0-59)
    north: bool          # True = North latitude, False = South
    altitude: int        # Altitude in metres above sea level


# ── Supplementary binding retained_state schemas ─────────────────────────
# These document the *per-feature_kind* shape of the retained_state dict
# inside SupplementaryBinding.  The actual runtime dict is untyped; these
# TypedDicts serve as the canonical schema reference.

class RetainedStateSecondary(TypedDict, total=False):
    """retained_state for feature_kinds: 'secondary', 'solar_arc', 'minor', 'tertiary'."""
    progression_method: int   # posfordate constant (SECONDARY, SOLAR_ARC, MINOR, TERTIARY)
    feature_kind: str         # echo of the feature kind string
    angle_method: int         # posfordate angle method constant
    day_type: int             # posfordate day-rate constant (e.g. Q2)
    age: tuple                # symbolic age tuple from symbolic_time calculation

class RetainedStateSolarReturn(TypedDict, total=False):
    """retained_state for feature_kind: 'solar_return'."""
    place_payload: PlacePayload  # location override (or None for natal place)
    plus: bool                   # timezone offset direction
    zh: int                      # timezone hour offset
    zm: int                      # timezone minute offset
    daylight: bool               # DST active
    solar_year_offset: int       # years from birth year
    solar_degree_offset: int     # ecliptic degree offset from exact return
    base_year: int               # target calendar year

class RetainedStateLunarReturn(TypedDict, total=False):
    """retained_state for feature_kind: 'lunar_return'."""
    place_payload: PlacePayload
    plus: bool
    zh: int
    zm: int
    daylight: bool
    lunar_cycle_offset: int      # number of lunar cycles forward/backward
    raw_return_datetime: tuple   # (year, month, day, hour, minute, second)

class RetainedStateProfections(TypedDict, total=False):
    """retained_state for feature_kind: 'profections'."""
    proftype: int                # chart.Chart.YEAR / MONTH / DAY
    time_float: float            # floating-point time representation
    display_datetime: tuple      # (year, month, day, hour, minute, second) or None

class RetainedStateTransits(TypedDict, total=False):
    """retained_state for feature_kind: 'transits'."""
    place_payload: PlacePayload  # location override
    display_datetime: tuple      # (year, month, day, hour, minute, second)


class WorkspaceSessionChart(TypedDict, total=False):
    """Core chart and session management."""

    document_id: str
    """Unique identifier for this workspace tab/document."""

    chart: Any  # chart.Chart
    """The primary chart being displayed (radix, transit, return, etc)."""

    chart_session: Any  # chart_session.ChartSession
    """The interactive session object managing time cursor, state, navigation."""

    chart_id: str
    """Identifier linking to the chart (for searching/referencing)."""

    comparison_chart: Optional[Any]  # chart.Chart | None
    """Secondary chart for synastry/compound view (optional)."""


class WorkspaceSessionDisplay(TypedDict, total=False):
    """Display and user-visible state."""

    base_title: str
    """Base title for the tab (e.g., 'John Smith Natal Chart', 'Solar Return 2024')."""

    custom_title_root: Optional[str]
    """Override for the title if user customized it."""

    custom_subtitle: Optional[str]
    """Optional subtitle in the tab."""

    dirty: bool
    """Has the chart been modified and not saved?"""

    edit_dirty: bool
    """Has an edit operation marked the session dirty?"""

    step_dirty: bool
    """Has stepping/navigation marked the session dirty?"""


class WorkspaceSessionSupplementary(TypedDict, total=False):
    """Configuration for supplementary/derived charts (transits, progressions, returns)."""

    supplementary_feature_kind: str
    """Type of supplementary chart: 'transits', 'progressions', 'solar', 'lunar', etc."""

    launcher_kind: str
    """Which launcher created this: 'current_transits', 'event_transits', etc."""

    supplementary_binding: dict[str, Any]
    """Retained user intent and configuration (offsets, location, viewing modes).

    This is the Binding in Antikythera terms: explicit retained intent that survives
    refresh and re-navigation.
    """

    parent_source_datetime: tuple[int, int, int, int, int, int]
    """(year, month, day, hour, minute, second) of parent chart's time."""


class WorkspaceSessionComposite(TypedDict, total=False):
    """Configuration for synastry and composite charts."""

    compound_kind: str
    """Type: 'synastry' or 'composite_from_synastry'."""

    synastry_pair: tuple[Any, Any]  # (chart.Chart, chart.Chart)
    """(center_chart, outer_chart) for synastry display."""

    relationship_participants: list[Any]  # list[chart.Chart]
    """All charts involved in this relationship (for multi-way relationships)."""

    relationship_participant_states: list[bool]
    """Which participants are currently displayed."""

    composite_variants: dict[str, Any]
    """Cached composite variants (symbolic midpoint, Davison, etc)."""

    composite_variants_pair_key: str
    """Cache key for the current composite variant pair."""

    composite_variant: Optional[Any]
    """Currently selected composite variant."""


class WorkspaceSessionRender(TypedDict, total=False):
    """Rendering and cache state."""

    render_cache: Optional[Any]
    """Cached render output (chart drawing data)."""

    drawbkg_count: int
    """Counter for background render passes (for animation/refresh)."""

    overlay_defer_full_pass: bool
    """Should the next render do a full pass instead of incremental?"""

    overlay_defer_initialized: bool
    """Has the overlay render been initialized for this session?"""

    overlay_defer_key: Optional[str]
    """Current overlay render state key."""


class WorkspaceSessionNavigation(TypedDict, total=False):
    """Navigation and stepping state."""

    step_burst_active: bool
    """Is continuous stepping (clicking/holding step button) active?"""

    step_burst_timer: Optional[Any]  # wx.CallLater | None
    """Timer for continuous stepping."""

    step_burst_token: int
    """Token to prevent stale callbacks from old step bursts."""

    parallel_transits_enabled: bool
    """Are parallel transits shown (for transits view)?"""


class WorkspaceSessionPrimaryDirections(TypedDict, total=False):
    """Configuration for primary directions sessions."""

    pd_runtime: Optional[Any]
    """Runtime state for primary directions calculation."""

    pd_runtime_entries: Optional[list[Any]]
    """Cached PD entries."""


class WorkspaceSessionSolar(TypedDict, total=False):
    """Configuration for solar return variants."""

    solar_average_max_birthday: Optional[tuple[int, int, int, int, int, int]]
    """Cached average birthday for multi-year solar returns."""


class WorkspaceSessionFile(TypedDict, total=False):
    """File and persistence metadata."""

    fpath: Optional[str]
    """File path if this session was loaded from disk."""

    dpath: Optional[str]
    """Directory path if this session was loaded from disk."""


class WorkspaceSession(WorkspaceSessionChart, WorkspaceSessionDisplay,
                      WorkspaceSessionSupplementary, WorkspaceSessionComposite,
                      WorkspaceSessionRender, WorkspaceSessionNavigation,
                      WorkspaceSessionPrimaryDirections, WorkspaceSessionSolar,
                      WorkspaceSessionFile, total=False):
    """Complete workspace session state.

    A workspace session is the state container for a single tab/document in the
    workspace. It holds:

    - The chart and its interactive session (ChartSession)
    - Display metadata (title, dirty flag)
    - Supplementary configuration (for transits, progressions, etc)
    - Synastry/composite configuration (if this is a pair view)
    - Rendering cache and state
    - Navigation state (stepping, animation)
    - File metadata (if loaded from disk)

    Sessions are mutable and updated in place as the user navigates, steps through
    time, switches charts, etc. They are the primary unit of persistence and recovery.

    Antikythera mapping:
    - ChartSession + chart + display_datetime ≈ Context (canonical semantic state)
    - supplementary_binding ≈ Binding (retained explicit intent)
    - The session dict itself ≈ the union of all controller/view state

    Key invariants:
    - A session always has at least `chart` and `chart_session`
    - `comparison_chart` is optional; present only in synastry/compound views
    - `supplementary_feature_kind` indicates if this is a derived chart
    - `dirty` flags should be respected before overwriting chart state
    """
    pass
