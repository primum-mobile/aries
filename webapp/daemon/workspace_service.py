# SPDX-FileCopyrightText: Morinus contributors
# SPDX-FileCopyrightText: 2026 Max Lange (Aries modifications)
# SPDX-License-Identifier: GPL-3.0-or-later
# Modified for Aries in 2026 by Max Lange.

"""Daemon-side workspace state — the single-user Tauri sidecar model.

One daemon process holds exactly one ``WorkspaceSessionController`` instance in
memory (one daemon = one workspace). This service wraps the controller's
methods behind HTTP commands and broadcasts the controller's *semantic* events
(documents.changed / active_document.changed / session.changed) to every
connected WebSocket client.

The controller is the wx-free extraction of ``morin.MFrame``'s workspace
coordinator (slice 1, ``engine/workspace_session_controller.py``); this service
never imports ``morin.py``. Derived child charts are built through the same
``supplementary_service`` Binding -> Deriver path the rest of the daemon uses,
so the adapter construction stays identical to the wx frame.

Spec: ``doc/migration/surfaces/workspace-daemon.md``.
"""
from __future__ import annotations

import asyncio
import copy
from dataclasses import dataclass
import datetime
import math
import sys
import threading
import time
from collections import OrderedDict
from pathlib import Path
from typing import Any, Optional, Sequence

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

import chart_session  # wx-free; same module the controller uses (COMPOUND view_mode)
import chartfile
import chart_context
import chart_context_view
import compositechart
import dateformat
import default_location as default_location_model
import horary_session
import horary_rules  # DEFAULT_SIGNIFICATORS seed for horary here-now docs (morin.py:18992)
import rule_engine
import revolutions
import note_storage
import options as morinus_options
import astrology
import common
import mtexts
import moonphasejump
import searchcatalog
import solaraverage
import util
import ascensional_transits as at_engine
from engine import cursor_steppers
from engine import harmonic_chart
from engine import moment
from engine import chart_factory
from engine import solilunar
from engine import supplementary_adapter
from webapp.daemon import notes_service
from webapp.daemon import chart_rings
from engine.workspace_session_controller import (
    SessionChangedEvent,
    WorkspaceSessionController,
)
from webapp.daemon.chart_service import chart_snapshot_service
from webapp.daemon.astrocart_service import (
    ASTROCART_MODE_ORDER,
    ASTROCART_MODES,
    ASTROCART_MODE_STANDARD,
    astrocart_service,
)
from webapp.daemon import astrocart_spec
from webapp.daemon.ephemeris_service import ephemeris_service
from webapp.daemon.event_time import (
    EVENT_TABLE_TIME_UT,
    table_event_clock,
)
from webapp.daemon.options_service import options_service
from webapp.daemon.supplementary_service import (
    FEATURE_KIND_DISPLAY_LABELS,
    FEATURE_TO_PUBLIC_KIND,
    PLANETARY_RETURN_BODY_NAMES,
    PUBLIC_TO_FEATURE_KIND,
    supplementary_service,
)
from webapp.daemon.ascensional_service import (
    _default_event_place as _default_ascensional_event_place,
    _place_from_payload as _ascensional_place_from_payload,
    _place_payload as _ascensional_place_payload,
)
from webapp.frontend.scripts import export_chart_json
from webapp.daemon import surveil_service
import symbolic_time  # pure brain, wx-free; signified-datetime derivation (symbolic_time.py:183)
import posfordate  # per-method progression rate / method normalization (posfordate.py:101)


# The four symbolic-progression methods whose DISPLAY cursor is the SIGNIFIED
# real datetime (radix + N symbolic years), derived from the chart — not the
# progressed ephemeris orig date. Mirrors engine/supplementary_adapter.py:190.
_PROGRESSION_FEATURE_KINDS = ('secondary', 'solar_arc', 'minor', 'tertiary')
_ASTROCART_PREFERENCES_SAVE_LOCK = threading.Lock()

_ASTROLABE_VIEW_DEFAULTS: dict[str, Any] = {
    "deltaDeg": 0.0,
    "atmospheric": True,
    "regioHouses": True,
    "zodiacWheel": True,
    "almucantars": False,
    "azimuths": False,
    "hourLines": False,
    "stars": False,
}
_ASTROLABE_VIEW_BOOLEAN_KEYS = tuple(
    key for key in _ASTROLABE_VIEW_DEFAULTS if key != "deltaDeg"
)

# Aspect List phase/perfection must follow the chart technique that produced the
# visible wheel.  These techniques evolve on the meaningful civil cursor, not
# directly on ``chart.time.jd`` (which is a progressed/symbolic ephemeris epoch
# for several of them).  Returns and transits are deliberately absent: once
# their snapshot is built, ordinary physical ephemeris motion is the coherent
# local trajectory around that instant.
_ASPECT_SYMBOLIC_FEATURE_KINDS = {
    'secondary', 'solar_arc', 'minor', 'tertiary',
    'profections', 'converse_transits',
}

# Solar/lunar/planetary returns and transits are ordinary physical charts at a
# real epoch.  Solar Average is deliberately not in either evolving set: it is
# an aggregate across an age range and its canonical rebuilder ignores the
# session cursor (there is no meaningful event-time trajectory to root-find).
_ASPECT_PHYSICAL_FEATURE_KINDS = {
    'transits', 'solar_return', 'lunar_return', 'planetary_return',
}

_ROOT_RECORD_CACHE_MAX = 128

# The macro temporal map starts with a deliberately stable product horizon.
# Use the same tropical-year scale as Primary Directions in Chart so age
# labels, the life endpoint, and direction dates do not drift apart.
_TEMPORAL_MAP_LIFE_YEARS = 120
_TEMPORAL_MAP_TROPICAL_YEAR_DAYS = 365.2421904

_CHART_VISUAL_ZODIAC = "zodiac"
_CHART_VISUAL_MDO = "mdo"
_CHART_VISUAL_MUNDANE = "mundane"
_CHART_VISUAL_AT = "ascensional_transits"
_MDO_VISUAL_MODES = {_CHART_VISUAL_MDO, _CHART_VISUAL_MUNDANE, _CHART_VISUAL_AT}


_OVERLAY_MENU_ITEMS = (
    ("Simple Chart", morinus_options.Options.NONE),
    ("Dodecatemoria", morinus_options.Options.DODECATEMORIA),
    ("Arabic parts", morinus_options.Options.ARABICPARTS),
    ("Antiscia", morinus_options.Options.ANTIS),
    ("Contra-antiscia", morinus_options.Options.CANTIS),
    ("Fixed stars", morinus_options.Options.FIXSTARS),
    ("Asteroids", morinus_options.Options.ASTEROIDS),
    ("Midpoints", morinus_options.Options.MIDPOINTS),
    ("Hybrid Hits", morinus_options.Options.HYBRID_HITS),
)

_RADIX_DISPLAY_TOGGLES = (
    ("planetarydayhour", "Planetary hour"),
    ("housesystem", "House system label"),
    ("information", "Chart information"),
)

# Labels grepped verbatim from the engine's house-system menu source
# (mtexts.menutxts['OMHS*'], mtexts.py:82, consumed at morin.py:1037-1050). The wx
# strings carry a "\tShift+Fn" accelerator suffix that wx strips when rendering;
# the rendered text is what is mirrored here. NOT reworded English.
_HOUSE_SYSTEM_ITEMS = (
    ("P", "Placidus"),
    ("K", "Koch"),
    ("R", "Regiomontanus"),
    ("C", "Campanus"),
    ("E", "Equal"),
    ("W", "Whole Sign"),
    ("F", "Fortune Houses"),
    ("X", "Axial"),
    ("Q", "True Ascendant"),
    ("M", "Morinus"),
    ("H", "Horizontal"),
    ("T", "Page-Polich"),
    ("B", "Alcabitus"),
    ("O", "Porphyrius"),
    ("N", "Angles only (no house lines)"),
)

# Chart-menu labels are localized on the "daemon emits keys, frontend renders"
# path: the context-menu endpoint attaches labelKey (label_i18n.attach_label_keys)
# and the frontend renders it. Builders below emit plain English labels — no
# i18n concern lives here.

_DUPLICATE_CHART_ITEMS = (
    ("Transit", "transits", "transit"),
    ("Solar", "solar-revolution", "solar"),
    ("Lunar", "lunar-revolution", "lunar"),
    ("Secondary Progressions", "secondary-progression", "secondary"),
    ("Solar Arc", "solar-arc", "secondary"),
    ("Minor Progression", "minor-progression", "secondary"),
    ("Tertiary Progression", "tertiary-progression", "secondary"),
    ("Profections", "profections", "profections"),
)

_OTHER_REVOLUTION_ITEMS = (
    ("Mercury Return", revolutions.Revolutions.MERCURY),
    ("Venus Return", revolutions.Revolutions.VENUS),
    ("Mars Return", revolutions.Revolutions.MARS),
    ("Jupiter Return", revolutions.Revolutions.JUPITER),
    ("Saturn Return", revolutions.Revolutions.SATURN),
    ("Uranus Return", revolutions.Revolutions.URANUS),
    ("Neptune Return", revolutions.Revolutions.NEPTUNE),
    ("Pluto Return", revolutions.Revolutions.PLUTO),
)


@dataclass(frozen=True)
class ChildLaunchContext:
    parent_session: dict[str, Any]
    parent_chart_session: Any
    radix: Any
    source_datetime: datetime.datetime
    source_display_datetime: tuple[int, int, int, int, int, int]

_SEARCH_PLANET_ID_BY_SE_ID = {
    astrology.SE_SUN: "planet:sun",
    astrology.SE_MOON: "planet:moon",
    astrology.SE_MERCURY: "planet:mercury",
    astrology.SE_VENUS: "planet:venus",
    astrology.SE_MARS: "planet:mars",
    astrology.SE_JUPITER: "planet:jupiter",
    astrology.SE_SATURN: "planet:saturn",
    astrology.SE_URANUS: "planet:uranus",
    astrology.SE_NEPTUNE: "planet:neptune",
    astrology.SE_PLUTO: "planet:pluto",
    astrology.SE_MEAN_NODE: "planet:asc_node",
    astrology.SE_TRUE_NODE: "planet:desc_node",
    astrology.SE_CHIRON: "planet:chiron",
}


def _display_tuple_to_iso(
    display_dt: Optional[tuple[int, int, int, int, int, int]],
) -> Optional[str]:
    if display_dt is None:
        return None
    try:
        y, m, d, h, mi, s = [int(v) for v in tuple(display_dt)[:6]]
        return datetime.datetime(y, m, d, h, mi, s).isoformat()
    except (TypeError, ValueError):
        return None


def _display_tuple_to_datetime(
    display_dt: Optional[tuple[int, int, int, int, int, int]],
) -> Optional[datetime.datetime]:
    if display_dt is None:
        return None
    try:
        y, m, d, h, mi, s = [int(v) for v in tuple(display_dt)[:6]]
        return datetime.datetime(y, m, d, h, mi, s)
    except (TypeError, ValueError):
        return None


_DECENNIAL_START_TOKENS = {
    "valens_apheta", "sect", "sun", "moon", "mercury", "venus", "mars", "jupiter", "saturn",
    "asc", "mc", "prenatal_new_moon", "fortune",
}
_DECENNIAL_APHETA_HOUSE_SYSTEMS = {"whole_sign", "porphyry"}
_DECENNIAL_OVERLAP_RESOLUTIONS = {"table", "sun_ray", "moon_ray"}
_DECENNIAL_LOWER_LEVEL_METHODS = {"proportional", "repeating_cycles"}

_TIME_LORD_TABLE_IDS = {'firdaria', 'vimshottari', 'decennials', 'triplicity_directions', 'zodiacal_releasing', 'profections_table'}

_TEMPORAL_CONFLUENCE_SOURCE_IDS = frozenset({
    'transits',
    'primary_directions',
    'secondary_progressions',
    'minor_progressions',
    'tertiary_progressions',
    'circumambulation',
    'synodic_cycles',
    'zodiacal_releasing',
    'firdaria',
    'decennials',
    'profection_periods',
    'triplicity_directions',
})
_TEMPORAL_CONFLUENCE_DEFAULT_SOURCES = (
    'transits',
    'synodic_cycles',
    'zodiacal_releasing',
    'primary_directions',
)


def _normalize_profections_age_offset(value: Any) -> int:
    try:
        age = int(value)
    except Exception:
        age = 0
    age = max(0, min(144, age))
    return age - (age % 12)


def _normalize_eclipse_date_values(value: Any) -> list[int] | None:
    if isinstance(value, dict):
        raw = (value.get('year'), value.get('month'), value.get('day'))
    else:
        raw = value
    try:
        y, m, d = tuple(raw)[:3]
        y, m, d = int(y), int(m), int(d)
        if not (1 <= m <= 12 and 1 <= d <= 31):
            return None
        return [y, m, d]
    except Exception:
        return None


def _normalize_table_binding(table_id: str, binding: Optional[dict[str, Any]]) -> dict[str, Any]:
    cleaned = dict(binding or {})
    if table_id == 'angle_at_birth':
        try:
            minutes = int(cleaned.get('minutes', 10))
        except Exception:
            minutes = 10
        cleaned['minutes'] = max(1, minutes)
    elif table_id == 'firdaria':
        default_isfirbonatti = getattr(chart_snapshot_service.options, 'isfirbonatti', True)
        cleaned['isfirbonatti'] = bool(cleaned.get('isfirbonatti', default_isfirbonatti))
    elif table_id == 'vimshottari':
        import vimshottari as _vimshottari

        raw_expanded = cleaned.get('expanded_row_ids')
        if isinstance(raw_expanded, str):
            raw_expanded = [raw_expanded]
        expanded_row_ids = list(dict.fromkeys(
            item
            for item in (raw_expanded if isinstance(raw_expanded, (list, tuple)) else ())
            if isinstance(item, str) and item.startswith('main:') and ':l2:' in item
        ))[:256]
        cleaned = {
            'anchor': _vimshottari.normalize_anchor(cleaned.get('anchor')),
            'start_star': _vimshottari.normalize_start_star(cleaned.get('start_star')),
            'year_days': _vimshottari.normalize_year_days(cleaned.get('year_days')),
            'ayanamsha': _vimshottari.normalize_ayanamsha(cleaned.get('ayanamsha')),
            'expanded_row_ids': expanded_row_ids,
        }
    elif table_id == 'decennials':
        token = str(cleaned.get('start_token') or 'valens_apheta').strip().lower()
        if (
            token == 'sect'
            and 'apheta_house_system' not in cleaned
            and 'overlap_resolution' not in cleaned
        ):
            token = 'valens_apheta'
        apheta_house_system = str(cleaned.get('apheta_house_system') or 'whole_sign').strip().lower()
        overlap_resolution = str(cleaned.get('overlap_resolution') or 'table').strip().lower()
        lower_level_method = str(cleaned.get('lower_level_method') or 'proportional').strip().lower()
        cleaned = {
            'start_token': token if token in _DECENNIAL_START_TOKENS else 'valens_apheta',
            'apheta_house_system': (
                apheta_house_system
                if apheta_house_system in _DECENNIAL_APHETA_HOUSE_SYSTEMS
                else 'whole_sign'
            ),
            'overlap_resolution': (
                overlap_resolution
                if overlap_resolution in _DECENNIAL_OVERLAP_RESOLUTIONS
                else 'table'
            ),
            'lower_level_method': (
                lower_level_method
                if lower_level_method in _DECENNIAL_LOWER_LEVEL_METHODS
                else 'proportional'
            ),
        }
    elif table_id == 'triplicity_directions':
        raw_expanded = cleaned.get('expanded_row_ids')
        expanded_row_ids: list[str] = []
        if isinstance(raw_expanded, str):
            raw_expanded = [raw_expanded]
        if isinstance(raw_expanded, (list, tuple)):
            for item in raw_expanded:
                if isinstance(item, str) and item.startswith('cycle:'):
                    expanded_row_ids.append(item)
        drill_row_id = cleaned.get('drill_row_id')
        if isinstance(drill_row_id, str) and drill_row_id.startswith('cycle:'):
            expanded_row_ids.append(drill_row_id)
        expanded_row_ids = list(dict.fromkeys(expanded_row_ids))[:256]
        try:
            start_sign = int(cleaned.get('start_sign')) % 12
        except Exception:
            start_sign = None
        cleaned = {'extended_depth': bool(cleaned.get('extended_depth', False))}
        if start_sign is not None:
            cleaned['start_sign'] = start_sign
        if isinstance(drill_row_id, str) and drill_row_id.startswith('cycle:'):
            cleaned['drill_row_id'] = drill_row_id
        if expanded_row_ids:
            cleaned['expanded_row_ids'] = expanded_row_ids
    elif table_id == 'zodiacal_releasing':
        import zodiacalreleasing as _zr

        releaser = str(cleaned.get('releaser') or getattr(chart_snapshot_service.options, 'zr_releaser', _zr.RELEASER_SPIRIT))
        if releaser not in _zr.VALID_RELEASERS and not _zr.is_arabic_part_releaser_token(releaser):
            releaser = _zr.RELEASER_SPIRIT
        try:
            start_sign = int(cleaned.get('start_sign', getattr(chart_snapshot_service.options, 'zr_start_sign', 0))) % 12
        except Exception:
            start_sign = 0
        # Drill-panel selection persists by the L2 row's start datetime, the
        # stable key ZRWnd.get_state/apply_state use (zodiacalreleasingwnd.py:249-292).
        drill_l2_start = cleaned.get('drill_l2_start')
        raw_expanded = cleaned.get('expanded_l2_starts')
        expanded_l2_starts: list[str] = []
        if isinstance(raw_expanded, str):
            raw_expanded = [raw_expanded]
        if isinstance(raw_expanded, (list, tuple)):
            for item in raw_expanded:
                if isinstance(item, str) and item:
                    expanded_l2_starts.append(item)
        if isinstance(drill_l2_start, str) and drill_l2_start:
            expanded_l2_starts.append(drill_l2_start)
        expanded_l2_starts = list(dict.fromkeys(expanded_l2_starts))
        cleaned = {
            'releaser': releaser,
            'apply_spirit_shift': bool(
                cleaned.get('apply_spirit_shift', getattr(chart_snapshot_service.options, 'zr_apply_spirit_shift', True))
            ),
            'start_sign': start_sign,
        }
        if isinstance(drill_l2_start, str) and drill_l2_start:
            cleaned['drill_l2_start'] = drill_l2_start
        if expanded_l2_starts:
            cleaned['expanded_l2_starts'] = expanded_l2_starts
    elif table_id == 'profections_table':
        cleaned = {
            'mainsigs': bool(cleaned.get('mainsigs', True)),
            'monthly_steps12': bool(cleaned.get('monthly_steps12', True)),
            'age_offset': _normalize_profections_age_offset(cleaned.get('age_offset', 0)),
        }
    elif table_id == 'temporal_confluence':
        raw_lanes = cleaned.get('lanes')
        lanes: list[dict[str, Any]] = []
        selected_sources: set[str] = set()
        if isinstance(raw_lanes, (list, tuple)):
            for raw_lane in raw_lanes[:4]:
                if not isinstance(raw_lane, dict):
                    continue
                source_id = str(raw_lane.get('sourceId') or raw_lane.get('source_id') or '')
                if source_id not in _TEMPORAL_CONFLUENCE_SOURCE_IDS or source_id in selected_sources:
                    continue
                selected_sources.add(source_id)
                lanes.append({
                    'id': f"lane-{len(lanes) + 1}",
                    'sourceId': source_id,
                })
        for source_id in _TEMPORAL_CONFLUENCE_DEFAULT_SOURCES:
            if len(lanes) >= 4:
                break
            if source_id in selected_sources:
                continue
            selected_sources.add(source_id)
            lanes.append({
                'id': f"lane-{len(lanes) + 1}",
                'sourceId': source_id,
            })
        cleaned = {'lanes': lanes}
    elif table_id == 'eclipses':
        from_values = _normalize_eclipse_date_values(cleaned.get('from'))
        to_values = _normalize_eclipse_date_values(cleaned.get('to'))
        # wx keeps a sticky year value across endless-scroll extension
        # (eclipsesframe.py:167-171 _set_year_value, :407,:412 update_year=False)
        # and an explicit focus date after -10y/+10y/year entry
        # (eclipsesframe.py:470,:536 focus_values=(year, 7, 1)). Persist both.
        try:
            year = int(cleaned.get('year'))
        except Exception:
            year = None
        focus_values = _normalize_eclipse_date_values(cleaned.get('focus'))
        if from_values is not None and to_values is not None and tuple(from_values) <= tuple(to_values):
            cleaned = {'from': from_values, 'to': to_values}
        elif year is not None:
            cleaned = {'year': year}
        else:
            cleaned = {}
        if year is not None:
            cleaned['year'] = year
        if focus_values is not None:
            cleaned['focus'] = focus_values
        saros_kind = str((binding or {}).get('saros_kind') or '').strip().lower()
        try:
            saros_series = int((binding or {}).get('saros_series'))
            saros_member = int((binding or {}).get('saros_member'))
            saros_event_jd = float((binding or {}).get('saros_event_jd'))
        except (TypeError, ValueError):
            saros_series = saros_member = None
            saros_event_jd = None
        if (
            saros_kind in ('solar', 'lunar')
            and saros_series is not None and saros_series > 0
            and saros_member is not None and saros_member > 0
            and saros_event_jd is not None and math.isfinite(saros_event_jd)
        ):
            cleaned.update({
                'saros_kind': saros_kind,
                'saros_series': saros_series,
                'saros_member': saros_member,
                'saros_event_jd': saros_event_jd,
            })
    elif table_id == 'monthly_transits':
        # Monthly Transits anchors on (year, month); both default to the wall
        # clock in the builder (transitmwnd.py:151-153). Persist only when both
        # are present and valid so the default-current-month path stays clean.
        out: dict[str, Any] = {}
        try:
            year = int(cleaned.get('year'))
            month = int(cleaned.get('month'))
            if 1 <= month <= 12:
                out = {'year': year, 'month': month}
        except Exception:
            out = {}
        cleaned = out
    elif table_id == 'fixedstar_angle_directions':
        # Range (PD range radios) + direction (Direct/Converse/Both) bindings
        # from the wx range popup (morin.py:17645-17668).
        range_token = str(cleaned.get('range') or 'all').strip().lower()
        if range_token not in ('25', '50', '75', '100', 'all'):
            range_token = 'all'
        direction_token = str(cleaned.get('direction') or 'both').strip().lower()
        if direction_token not in ('direct', 'converse', 'both'):
            direction_token = 'both'
        cleaned = {'range': range_token, 'direction': direction_token}
    return cleaned


class WorkspaceConnectionManager:
    """Tracks the set of live ``/ws/events`` sockets and fans events out.

    The controller's event callback fires synchronously inside HTTP command
    handling (which FastAPI runs in a threadpool), so broadcasts are scheduled
    onto the captured asyncio loop via ``run_coroutine_threadsafe``."""

    def __init__(self) -> None:
        self._connections: set[Any] = set()
        self._lock = threading.Lock()
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._latest_broadcasts: dict[str, tuple[asyncio.TimerHandle, dict]] = {}

    def bind_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        self._loop = loop

    async def connect(self, websocket) -> None:
        await websocket.accept()
        # Capture the serving loop so threadpool-side broadcasts can reach it.
        try:
            self._loop = asyncio.get_running_loop()
        except RuntimeError:
            pass
        with self._lock:
            self._connections.add(websocket)

    def disconnect(self, websocket) -> None:
        with self._lock:
            self._connections.discard(websocket)

    async def broadcast(self, event: dict) -> None:
        with self._lock:
            targets = list(self._connections)
        dead = []
        for ws in targets:
            try:
                await ws.send_json(event)
            except Exception:
                dead.append(ws)
        if dead:
            with self._lock:
                for ws in dead:
                    self._connections.discard(ws)

    def broadcast_threadsafe(self, event: dict) -> None:
        """Schedule a broadcast from a non-async (threadpool) context."""
        loop = self._loop
        if loop is None:
            return
        try:
            asyncio.run_coroutine_threadsafe(self.broadcast(event), loop)
        except RuntimeError:
            pass

    def broadcast_latest_threadsafe(
        self,
        key: str,
        event: dict,
        *,
        delay_seconds: float,
    ) -> None:
        """Broadcast only the newest event for *key* after a short quiet period.

        Cursor-step events carry current state rather than an ordered delta, so
        sending every intermediate event only wakes every retained subscriber.
        The navigate response remains the immediate chart-paint authority; this
        trailing event synchronizes list/table consumers with the final cursor.
        """
        loop = self._loop
        if loop is None:
            return

        def schedule() -> None:
            previous = self._latest_broadcasts.pop(key, None)
            if previous is not None:
                previous[0].cancel()

            def send_latest() -> None:
                current = self._latest_broadcasts.pop(key, None)
                if current is None:
                    return
                asyncio.create_task(self.broadcast(current[1]))

            handle = loop.call_later(delay_seconds, send_latest)
            self._latest_broadcasts[key] = (handle, event)

        try:
            loop.call_soon_threadsafe(schedule)
        except RuntimeError:
            pass

    def cancel_latest_threadsafe(self, key: str) -> None:
        """Cancel a queued latest-state event before a newer immediate event."""
        loop = self._loop
        if loop is None:
            return

        def cancel() -> None:
            previous = self._latest_broadcasts.pop(key, None)
            if previous is not None:
                previous[0].cancel()

        try:
            loop.call_soon_threadsafe(cancel)
        except RuntimeError:
            pass


class SupplementaryStepper:
    """Wx-free analogue of the desktop revolution/profection ``StepperDlg``,
    plugged into ``ChartSession._stepper``.

    It owns BOTH halves of a derived child's step position: the year/cycle/source
    step AND its reset. Because it lives in the slot ``ChartSession`` already
    rewinds (``reset_to_initial_chart`` -> ``stepper.reset_to_initial_state``,
    chart_session.py:200-204), pressing space and then stepping starts from the
    initial offset again instead of preserving the stale one.

    There is no second stepping brain: the deriver math is reused verbatim from
    ``supplementary_service`` (``_step_binding`` + ``build_result``); this object
    only carries the open-time Binding so reset has something to restore.
    """

    # chart_session arrow keycodes (chart_session.py:51-54; == wx.WXK_*).
    _LEFT = 314
    _RIGHT = 316
    _UP = 315
    _DOWN = 317
    _ARROWS = (_LEFT, _RIGHT, _UP, _DOWN)

    def __init__(self, *, controller, session, cs, radix, feature_kind):
        self._controller = controller
        self._session = session
        self._cs = cs
        self._radix = radix
        self._feature_kind = feature_kind
        # Snapshot the open-time Binding + source cursor so reset restores exactly
        # what the initial child was built from. The binding is stored on the
        # session as a JSON payload (controller._apply_supplementary_binding:220),
        # so a deep copy is a safe, independent restore point.
        binding_payload = session.get('supplementary_binding')
        self._initial_binding_payload = (
            copy.deepcopy(binding_payload) if binding_payload is not None else None
        )
        self._initial_parent_source_datetime = session.get('parent_source_datetime')

    # -- ChartSession._forward_stepper_arrow protocol (chart_session.py:122) --

    def handle_navigation_key(self, keycode, *, shift_down=False, alt_down=False,
                              control_down=False, cmd_down=False, repeat=1):
        # Forward every arrow (including up/down) WITH the keycode so the
        # extracted wx-free stepper decides the unit. Progressions step the
        # signified datetime by year on up/down; profections snap on up/down;
        # returns ignore up/down (their stepper emits no plan -> no mutation).
        if keycode in self._ARROWS:
            direction = -1 if keycode in (self._LEFT, self._DOWN) else 1
            return self._step(
                direction,
                keycode=keycode,
                shift=shift_down,
                alt=alt_down,
                repeat=repeat,
            )
        return False

    def step_backward(self):
        return self._step(-1, keycode=self._LEFT)

    def step_forward(self):
        return self._step(1, keycode=self._RIGHT)

    # -- ChartSession.reset_to_initial_chart protocol (chart_session.py:200) --

    def reset_to_initial_state(self):
        """Rewind the Binding + source cursor to their open-time values.

        We deliberately do NOT rebuild the chart here: ``reset_to_initial_chart``
        restores the displayed chart to ``_initial_chart`` immediately after
        calling us, and that chart already corresponds to this initial binding.
        Resetting the session binding *before* that ``change_chart`` also means the
        ``_sync_binding_state`` re-capture it triggers (controller:604/620)
        re-persists the initial offset rather than the stale one."""
        self._session['supplementary_binding'] = (
            copy.deepcopy(self._initial_binding_payload)
            if self._initial_binding_payload is not None else None
        )
        self._session['parent_source_datetime'] = self._initial_parent_source_datetime
        return True

    # -- internal: one step via the canonical adapter path -----------------

    def _step(self, direction, *, keycode=None, shift=False, alt=False, repeat=1):
        public_kind = FEATURE_TO_PUBLIC_KIND.get(self._feature_kind)
        if public_kind is None:
            return False
        session = self._session
        cs = self._cs
        if self._feature_kind == 'profections':
            # wx _resolve_profections_stepper_source_datetime reads the child
            # display cursor first. This matters when SR snap is enabled:
            # display_datetime is the normalized profection date, while the
            # launch parent source may still be the unsnapped command date.
            when = _display_to_datetime(getattr(cs, 'display_datetime', None))
            if when is None:
                when = _display_to_datetime(session.get('parent_source_datetime'))
        else:
            when = _display_to_datetime(session.get('parent_source_datetime'))
            if when is None:
                when = _display_to_datetime(getattr(cs, 'display_datetime', None))
        if when is None:
            when = datetime.datetime.now()
        binding = (
            supplementary_adapter.SupplementaryBinding.from_payload(
                session.get('supplementary_binding') or {},
                feature_kind=self._feature_kind,
            )
            or supplementary_adapter.SupplementaryBinding(self._feature_kind)
        )
        # Snapshot before the in-place step so a no-mutation key can be detected.
        prior_binding_payload = binding.to_payload()
        # supplementary_service runs the extracted wx-free stepper for this kind
        # (engine.cursor_steppers) and folds its StepPlan onto the binding/source
        # datetime — the SAME path /api/chart/supplementary/step uses. We never
        # reimplement the unit map or the deriver.
        next_when = when
        next_binding_payload = prior_binding_payload
        for _ in range(max(1, int(repeat))):
            current_binding = (
                supplementary_adapter.SupplementaryBinding.from_payload(
                    next_binding_payload or {},
                    feature_kind=self._feature_kind,
                )
                or supplementary_adapter.SupplementaryBinding(self._feature_kind)
            )
            next_when, next_binding_payload = supplementary_service._step_binding(
                radix=self._radix,
                feature_kind=self._feature_kind,
                when=next_when,
                direction=direction,
                shift=shift,
                alt=alt,
                binding=current_binding,
                keycode=keycode,
            )
        # The extracted stepper emitted no mutation for this key+modifier (e.g.
        # up/down on a return, shift/alt on a lunar/planetary cycle — unmodelled
        # in wx too: the wx stepper returns False here). Report not-stepped so the
        # caller skips the no-op rebuild + step_fast render, matching the desktop.
        if (
            next_when == when
            and next_binding_payload == prior_binding_payload
        ):
            return False
        built = supplementary_service.build_result(
            radix=self._radix,
            kind=public_kind,
            when=next_when,
            binding_payload=next_binding_payload,
        )
        derived_chart = built["chart"]
        if derived_chart is None:
            return False
        session['parent_source_datetime'] = _datetime_to_display(next_when)
        self._controller._apply_supplementary_binding(session, built["binding"])
        cs.change_chart(
            derived_chart,
            display_datetime=built["display_datetime"],
            change_reason='step',
        )
        return True


class WorkspaceService:
    """Holds the one in-memory ``WorkspaceSessionController`` for this daemon."""

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._manager = WorkspaceConnectionManager()
        opts = chart_snapshot_service.options
        self._controller = WorkspaceSessionController(opts)
        self._controller.set_event_listener(self._on_controller_event)
        # wx MFrame._radix_view_state: per-radix table/surface state such as
        # astrocart map viewport. Kept daemon-side so React remounts do not
        # throw away workspace view state.
        self._radix_view_state: dict[tuple[str, tuple], dict] = {}
        self._root_record_cache: OrderedDict[tuple[Any, ...], dict[str, Any]] = OrderedDict()
        # The options backend drives a re-render of every open document after a
        # settings change (the headless _refresh_current_views). Bind the one
        # controller so options_service.refresh_all_sessions() reaches it.
        options_service.set_controller(self._controller)
        # Surveil study store (wx-free; surveil_service). Lands next to the
        # desktop store under the user opts dir (options.optsdirtxt).
        self._surveil_store = surveil_service.SurveilStudyStore(
            lambda: getattr(options_service.options, "optsdirtxt", None)
        )
        self._unsaved_recent_chart_refs: list[dict[str, Any]] = []
        self._startup_restore_attempted = False

    @property
    def manager(self) -> WorkspaceConnectionManager:
        return self._manager

    @staticmethod
    def _chart_visual_mode(session: Optional[dict]) -> str:
        if not isinstance(session, dict):
            return _CHART_VISUAL_ZODIAC
        mode = str(session.get("chart_visual_mode") or "").strip()
        if mode in (
            _CHART_VISUAL_ZODIAC,
            _CHART_VISUAL_MDO,
            _CHART_VISUAL_MUNDANE,
            _CHART_VISUAL_AT,
        ):
            return mode
        if session.get("launcher_kind") == "ascensional_transits":
            return _CHART_VISUAL_AT
        return _CHART_VISUAL_ZODIAC

    def _is_mdo_visual_session(self, session: Optional[dict]) -> bool:
        return self._chart_visual_mode(session) in _MDO_VISUAL_MODES

    def _is_at_visual_session(self, session: Optional[dict]) -> bool:
        return self._chart_visual_mode(session) == _CHART_VISUAL_AT

    def broadcast_options_changed(
        self,
        refreshed_document_ids=None,
        refresh_mode=None,
        *,
        style_only: bool = False,
        list_data_changed: bool = True,
        retained_list_target: Optional[str] = None,
        inspector_data_changed: bool = False,
    ) -> None:
        """Fan an ``options.changed`` event out to all connected clients.

        The per-document ``session.changed`` events are already broadcast by the
        controller's event listener as ``refresh_all_sessions`` re-fires each
        session's ``on_session_change``; this is the single top-level signal the
        frontend listens to in order to re-pull options + re-render."""
        theme_state = options_service.get_theme_state()
        self._manager.broadcast_threadsafe({
            "type": "options.changed",
            "refreshedDocumentIds": list(refreshed_document_ids or []),
            "refreshMode": refresh_mode or "recalc",
            "styleOnly": bool(style_only),
            "listDataChanged": bool(list_data_changed),
            "retainedListTarget": retained_list_target,
            "retainedListDataKey": options_service.get_retained_list_data_key(),
            "ephemerisDataKey": ephemeris_service.payload_revision_key(),
            "retainedListDisplay": options_service.get_retained_list_display(),
            "inspectorDataChanged": bool(inspector_data_changed),
            "langid": int(getattr(options_service.options, "langid", 0) or 0),
            "schemaVersion": theme_state["schemaVersion"],
            "themeVersion": theme_state["version"],
            "styleRevision": theme_state["styleRevision"],
            "paletteHash": theme_state["paletteHash"],
            "styleHash": theme_state["styleHash"],
        })

    def set_eclipse_chart_moment(self, mode: str) -> dict[str, Any]:
        """Persist Options/Eclipses chart moment for row timed-chart actions.

        Source twin: morin._set_eclipse_chart_moment_mode writes
        options.eclipse_chart_moment, syncs menu checks, and saves
        quickcharts.opt (morin.py:958-976; options.py:1964-1972,2734).
        """
        exact = "exact_conjunction"
        maximum = "eclipse_maximum"
        value = str(mode or "")
        if value not in {exact, maximum}:
            raise ValueError(f"unsupported eclipse chart moment {mode!r}")
        with self._lock:
            opts = chart_snapshot_service.options
            setattr(opts, "eclipse_chart_moment", value)
            try:
                opts.saveQuickCharts()
            except Exception:
                pass
        self.broadcast_options_changed([])
        return {
            "eclipseChartMoment": value,
            "options": {
                "eclipse_chart_moment": value,
            },
        }

    # -- controller event -> WS broadcast ----------------------------------

    def _on_controller_event(self, event: SessionChangedEvent) -> None:
        """Translate a controller ``SessionChangedEvent`` into the crib-sheet WS
        event shapes (40-state-contract.md §Events) and fan out to all clients."""
        if event.change_reason == 'activate':
            self._manager.broadcast_threadsafe({
                "type": "active_document.changed",
                "docId": event.document_id,
            })
        else:
            display_dt = None
            session = self._controller.session(event.document_id) if event.document_id else None
            is_ascensional_transits = self._is_at_visual_session(session)
            if is_ascensional_transits:
                self._sync_ascensional_session_metadata(session)
            if session is not None:
                cs = session.get('chart_session')
                if cs is not None:
                    display_dt = _display_tuple_to_iso(getattr(cs, 'display_datetime', None))
                    tab_suffix = self._tab_runtime_suffix(session, cs)
                else:
                    tab_suffix = None
            else:
                tab_suffix = None
            session_event = {
                "type": "session.changed",
                "docId": event.document_id,
                "changeReason": event.change_reason,
                "isActive": bool(event.is_active),
                "rebuiltChildIds": list(event.rebuilt_child_ids),
                "displayDatetime": display_dt,
                "tabSuffix": tab_suffix,
            }
            if event.change_reason == "options-refresh":
                session_event["listDataChanged"] = False
            step_broadcast_key = str(event.document_id)
            if event.change_reason == 'step' and not event.rebuilt_child_ids:
                # One direct navigate response paints each chart step. Retained
                # lists need the latest cursor, not a global store wake-up for
                # every intermediate auto-repeat event. Forty milliseconds is
                # below the interaction budget while coalescing a 30 ms key
                # repeat into one canonical trailing notification.
                self._manager.broadcast_latest_threadsafe(
                    step_broadcast_key,
                    session_event,
                    delay_seconds=0.040,
                )
            else:
                # Preserve event order: an edit/rebuild supersedes any older
                # cursor-only tail still waiting in the debounce window.
                self._manager.cancel_latest_threadsafe(step_broadcast_key)
                self._manager.broadcast_threadsafe(session_event)
        # The tree (titles / dirty markers / membership) may have shifted — but a
        # pure cursor STEP never changes tree membership/titles, only the moving
        # display cursor (already carried by session.changed.displayDatetime). The
        # desktop coalesces step bursts and repaints only the dynamic layer; the
        # web twin must not flood a full documents.changed per keystroke (that
        # storm is exactly what made stepping slow — see ISSUE 1). Rebuilding a
        # derived child (rebuilt_child_ids non-empty) DOES touch the tree, so we
        # still broadcast then.
        if (
            event.change_reason == 'step'
            and not event.rebuilt_child_ids
            and not (
                self._is_at_visual_session(session)
            )
        ):
            return
        self._manager.broadcast_threadsafe({
            "type": "documents.changed",
            "tree": self._tree_payload(),
        })

    # -- state serialisation -----------------------------------------------

    def _document_summary(self, document) -> dict:
        session = self._controller.session(document.document_id) or {}
        cs = session.get('chart_session')
        feature_kind = session.get('supplementary_feature_kind')
        public_feature_kind = FEATURE_TO_PUBLIC_KIND.get(feature_kind)
        if feature_kind == 'converse_transits':
            retained = (session.get('supplementary_binding') or {}).get('retained_state') or {}
            if bool(retained.get('converse_enabled', True)):
                title_key = "supplementary.converse-transits"
            elif session.get('timed_event_title'):
                title_key = None
            else:
                title_key = "supplementary.transits"
        elif session.get('timed_event_title'):
            # Row-opened charts carry a data-bearing event title (Solar Eclipse,
            # Ven con. Mon, …), so the generic supplementary localization key
            # must not replace it in the sidebar/titlebar.
            title_key = None
        elif session.get('table_id'):
            title_key = f"table.{session['table_id']}"
        elif (
            session.get('launcher_kind') == 'synastry'
            and session.get('compound_kind') == 'synastry'
        ):
            title_key = "supplementary.synastry"
        elif public_feature_kind not in (None, 'planetary-return', 'solar-average'):
            title_key = f"supplementary.{public_feature_kind}"
        else:
            # Planetary-return and solar-average titles carry body/range data.
            title_key = None
        display_dt = None
        symbolic_readout = None
        if cs is not None:
            display_dt = _display_tuple_to_iso(getattr(cs, 'display_datetime', None))
            symbolic_readout = self._symbolic_time_readout(session, cs)
        elif session.get('directions_focus_datetime'):
            display_dt = session.get('directions_focus_datetime')
        active_id = self._controller.active_document_id()
        fpath = session.get('fpath', '')
        if (
            not fpath
            and document.parent_document_id is not None
            and session.get('launcher_kind') in {
                'astrocart', 'directions', 'astrolabe', 'astrolog_sphere', 'ephemeris',
                'square_chart', 'mundane_chart',
                'transit_search', 'table',
            }
        ):
            parent_session = self._controller.session(document.parent_document_id) or {}
            fpath = parent_session.get('fpath', '')
        return {
            "documentId": document.document_id,
            "kind": document.kind,
            "title": document.title,
            # Stable semantic display key. Data-bearing titles remain raw and
            # localized daemon-side; ordinary derived/table titles relocalize
            # immediately in React, including already-open documents.
            "titleKey": title_key,
            "subtitle": document.subtitle,
            "sourceName": self._document_source_name(session, document),
            "path": document.path,
            "parentDocumentId": document.parent_document_id,
            "indentLevel": document.indent_level,
            "featureKind": feature_kind,
            "launcherKind": session.get('launcher_kind'),
            "chartVisualMode": self._chart_visual_mode(session),
            "comparisonName": session.get('comparison_name'),
            "compoundKind": session.get('compound_kind'),
            "compositeVariant": session.get('composite_variant'),
            "dirty": bool(session.get('dirty', False)),
            "editDirty": bool(session.get('edit_dirty', False)),
            "stepDirty": bool(session.get('step_dirty', False)),
            "fpath": fpath,
            "displayDatetime": display_dt,
            "symbolicTime": symbolic_readout,
            "tabSuffix": self._tab_runtime_suffix(session, cs) if cs is not None else None,
            # wx horary tab format flag: "Name (Wkdy date time)" instead of
            # "Name • suffix" (morin._horary_workspace_tab_title, morin.py:4734).
            "isHorary": bool(getattr(session.get('chart'), 'htype', None)
                             == export_chart_json.chart_mod.Chart.HORARY),
            # Saved horary lens (chrt.interpretation) — the skin adopts it into
            # inspectorLens on activation (morin._adopt_lens_for_active_chart,
            # morin.py:9073-9083; round-trip chartfile.py:82-163/276-282).
            "interpretation": self._chart_interpretation(session),
            "isActive": document.document_id == active_id,
            "searchInitialSignificatorId": session.get("search_initial_significator_id"),
            "searchInitialLabel": session.get("search_initial_label", ""),
            "searchInitialGlyph": session.get("search_initial_glyph", ""),
            "directionsCustomSignificator": session.get("directions_custom_significator"),
            "directionsDefaultDirection": session.get("directions_default_direction"),
            "tableId": session.get("table_id"),
            "tableBinding": session.get("table_binding"),
            # Solar-eclipse path overlay carried by astrocart docs opened via
            # "Show Eclipse Path on Map" (morin.py:16211-16227 wx twin).
            "eclipseEvent": session.get("eclipse_event_payload"),
            "ascensionalEventJd": session.get("ascensional_event_jd"),
            "ascensionalEventPlace": session.get("ascensional_event_place_payload"),
            "ascensionalFilterToActiveMoment": session.get("ascensional_filter_to_active_moment"),
            "ascensionalApplyPrecession": session.get("ascensional_apply_precession"),
            # RUNTIME session gate (has_chart / solar_available / composite
            # gate) keyed by skin dispatch id — the wx-free twin of
            # morin._workspace_navigation_state. The skin greys launchers from
            # the ACTIVE document's map instead of recomputing has_chart in TS.
            "enabledActions": self._enabled_actions(session),
        }

    @staticmethod
    def _horary_session_charts(session: dict) -> list:
        """Chart objects carrying the horary lens slot for a session — both the
        session chart and the ChartSession radix (HorarySession is self-as-radix
        so they are usually the same object; loaded radixes have
        chart_session=None). Only HORARY charts qualify (morin.py:9058-9060)."""
        horary = export_chart_json.chart_mod.Chart.HORARY
        charts = []
        for chrt in (session.get('chart'),
                     getattr(session.get('chart_session'), 'radix', None)):
            if chrt is not None and getattr(chrt, 'htype', None) == horary \
                    and chrt not in charts:
                charts.append(chrt)
        return charts

    @staticmethod
    def _normalize_horary_interpretation(
        lens: Optional[dict], *, strict: bool = True,
    ) -> Optional[dict]:
        """Return a canonical, JSON-safe horary interpretation payload.

        Horary lens context is persisted chart data, not an open-ended client
        scratchpad.  Its canonical keys come from the selected theme's
        ``DEFAULT_SIGNIFICATORS`` / ``CONTEXT_OPTIONS`` plus validated
        manifest options declared by installed packs.  House selectors are
        stored as integers, declared option values use their stable string
        tokens, missing or invalid values fall back to the theme default, and
        unknown context keys are discarded.  This makes malformed/older saved
        records fail closed instead of silently feeding arbitrary semantics to
        corpus predicates.

        Other disciplines remain an intentionally opaque global-lens payload:
        legacy wx can mirror an elections lens while a horary chart is active,
        and this backend door must preserve that existing round trip.
        ``strict=False`` is the load/display path: an invalid saved horary
        theme is hidden rather than making the workspace document unreadable.
        """
        if lens is None:
            return None
        if not isinstance(lens, dict):
            if strict:
                raise ValueError("interpretation lens must be an object or null")
            return None

        discipline = str(lens.get('discipline') or '').strip().lower()
        theme_value = lens.get('theme')
        theme = str(theme_value).strip() if isinstance(theme_value, str) else ''
        if not discipline or not theme:
            if strict:
                raise ValueError(
                    "interpretation lens requires discipline and theme",
                )
            return None
        if discipline != 'horary':
            raw_context = lens.get('context')
            if raw_context is not None and not isinstance(raw_context, dict):
                if strict:
                    raise ValueError(
                        "interpretation context must be an object or null",
                    )
                raw_context = None
            result = {'discipline': discipline, 'theme': theme}
            if raw_context is not None:
                result['context'] = copy.deepcopy(raw_context)
            return result

        # Persisted lenses may carry an older manifest label or the stable
        # slug itself.  Resolve identity before looking up core or pack
        # defaults; indexing those maps by the raw display label splits one
        # theme's context contract across aliases (for example, Lilly's
        # "Marriage Questions" versus the canonical "Marriage Question").
        theme_slug = rule_engine.theme_slug_for(
            'horary', theme, include_inactive=True,
        )
        if theme_slug is not None:
            theme = (
                rule_engine.canonical_theme_label_for(
                    'horary', theme_slug, include_inactive=True,
                ) or theme
            )

        pack_theme = rule_engine.theme_metadata_for(
            'horary', include_inactive=True,
        ).get(theme) or {}
        core_defaults = horary_rules.DEFAULT_SIGNIFICATORS.get(theme)
        pack_defaults = pack_theme.get('default_context') or {}
        if core_defaults is None and not pack_defaults:
            if strict:
                raise ValueError("unknown horary interpretation theme: %r" % theme_value)
            return None

        raw_context = lens.get('context')
        if raw_context is None:
            raw_context = {}
        elif not isinstance(raw_context, dict):
            if strict:
                raise ValueError("horary interpretation context must be an object or null")
            raw_context = {}

        option_fields = {}
        option_specs = (
            tuple(pack_theme.get('context_options') or ())
            + tuple(horary_rules.CONTEXT_OPTIONS.get(theme, ()))
        )
        for field in option_specs:
            # Global doctrine is daemon-owned persisted application state.  It
            # is never copied into a horary chart's interpretation context;
            # older saved lenses carrying these keys are migrated by omission.
            if field.get('scope', 'question_fact') != 'question_fact':
                continue
            key = str(field.get('key') or '')
            if not key or key in option_fields:
                continue
            values = []
            for option in tuple(field.get('options') or ()):
                if isinstance(option, dict):
                    value = option.get('value')
                elif isinstance(option, (tuple, list)) and len(option) == 2:
                    value = option[0]
                else:
                    continue
                if isinstance(value, str):
                    values.append(value)
            if values:
                option_fields[key] = tuple(values)

        # Pack context can extend a built-in theme.  Core defaults retain
        # ownership of established house roles and fields on collision.
        canonical_defaults = dict(core_defaults or {})
        for key, value in dict(pack_defaults).items():
            if (key not in ('querent_house', 'quesited_house')
                    and key in option_fields):
                canonical_defaults[key] = value
        for key, allowed in option_fields.items():
            if key not in canonical_defaults and allowed:
                canonical_defaults[key] = (
                    'unspecified' if 'unspecified' in allowed else allowed[0]
                )

        def normalized_option(value, allowed, default):
            if isinstance(value, bool) or value is None:
                return str(default)
            token = str(value).strip()
            if token in allowed:
                return token
            normalized = token.lower().replace('-', '_').replace(' ', '_')
            by_normalized = {
                item.lower().replace('-', '_').replace(' ', '_'): item
                for item in allowed
            }
            return by_normalized.get(normalized, str(default))

        def normalized_house(value, default):
            if isinstance(value, bool):
                return int(default)
            if isinstance(value, int):
                house = value
            elif isinstance(value, str) and value.strip().isdigit():
                house = int(value.strip())
            else:
                return int(default)
            return house if 1 <= house <= 12 else int(default)

        context = {}
        for key, default in canonical_defaults.items():
            value = raw_context.get(key, default)
            allowed = option_fields.get(key)
            if allowed:
                context[key] = normalized_option(value, allowed, default)
            elif key.rpartition('_')[2] == 'house':
                context[key] = normalized_house(value, default)
            else:
                # No unconstrained client values enter persisted horary
                # semantics.  A future non-house field becomes editable only
                # when its canonical CONTEXT_OPTIONS declaration lands.
                context[key] = copy.deepcopy(default)

        return {
            'discipline': 'horary',
            'theme': theme,
            'context': context,
        }

    def _chart_interpretation(self, session: dict):
        """Canonical saved lens from the session's horary chart, else None."""
        for chrt in self._horary_session_charts(session):
            interp = getattr(chrt, 'interpretation', None)
            if interp:
                normalized = self._normalize_horary_interpretation(
                    interp, strict=False,
                )
                if normalized:
                    return normalized
        return None

    @staticmethod
    def _document_source_name(session: dict, document) -> str:
        """User-facing chart/source label for React surfaces.

        Wx keeps scratch event charts' ``chart.name`` empty, but gives their
        workspace document a real session label via ``custom_title_root`` /
        ``base_title``. Mirror that separation here: prefer the chart's real
        saved name, then a comparison/source label for view-only docs, then the
        custom session label. The chart object itself is not renamed.
        """
        chrt = session.get("chart")
        cs = session.get("chart_session")
        if cs is not None and getattr(cs, "chart", None) is not None:
            chrt = cs.chart
        comparison = str(session.get("comparison_name") or "").strip()
        if (
            comparison
            and (
                session.get("launcher_kind") == "transits"
                or session.get("supplementary_feature_kind") in {
                    "transits",
                    "converse_transits",
                }
            )
        ):
            return comparison
        name = str(getattr(chrt, "name", "") or "").strip()
        if name:
            return name
        if comparison:
            return comparison
        for key in ("custom_title_root", "base_title"):
            label = str(session.get(key) or "").strip().rstrip("*").strip()
            if label:
                return label
        return str(getattr(document, "title", "") or "").strip().rstrip("*").strip()

    def _tree_payload(self) -> list[dict]:
        return [self._document_summary(doc) for doc in self._controller.documents()]

    def state(self) -> dict:
        with self._lock:
            self._ensure_startup_restore_attempted()
            return {
                "documents": self._tree_payload(),
                "activeDocumentId": self._controller.active_document_id(),
            }

    def spotlight_default_location_context(self) -> dict[str, Any]:
        with self._lock:
            active_id = self._controller.active_document_id()
            session = self._controller.session(active_id) if active_id else None
            if session is not None:
                cs = session.get("chart_session")
                for chrt in (
                    getattr(cs, "radix", None),
                    getattr(cs, "chart", None),
                    session.get("chart"),
                ):
                    place = getattr(chrt, "place", None)
                    time_obj = getattr(chrt, "time", None)
                    if place is not None and time_obj is not None:
                        return {
                            "place": place,
                            "zt": getattr(time_obj, "zt", export_chart_json.chart_mod.Time.ZONE),
                            "plus": getattr(time_obj, "plus", True),
                            "zh": getattr(time_obj, "zh", 0),
                            "zm": getattr(time_obj, "zm", 0),
                            "daylightsaving": getattr(time_obj, "daylightsaving", False),
                            "tzid": getattr(time_obj, "tzid", ""),
                            "tzauto": getattr(time_obj, "tzauto", False),
                        }
            opts = chart_snapshot_service.options
            # Auto-TZ is owned by the saved Default Location coordinates.  Use
            # the normalized read contract here as well so Spotlight cannot
            # resurrect a stale tzid when there is no active chart.
            default_location = options_service._read_defloc(opts)
            place = default_location_model.place_from_options(opts)
            return {
                "place": place,
                "zt": export_chart_json.chart_mod.Time.ZONE,
                "plus": default_location["deflocplus"],
                "zh": default_location["defloczhour"],
                "zm": default_location["defloczminute"],
                "daylightsaving": default_location["deflocdst"],
                "tzid": default_location["defloctzid"],
                "tzauto": default_location["defloctzauto"],
            }

    # -- chart context menu ------------------------------------------------

    def chart_context_menu(self, document_id: Optional[str] = None, region: Optional[dict] = None) -> dict:
        """Daemon-owned chart right-click menu.

        Mirrors the supported, wx-free subset of ``morin.onChartContextMenu``
        (morin.py:1050-1197) in the same order. React renders this tree
        verbatim and dispatches only the returned ``actionId``/``payload``.

        REGION CHANNEL (the wx twin morin.py:1056-1066): the desktop frame
        hit-tests the cursor (``get_chart_region_at_screen_pos``,
        workspace_shell.py:7553) so region-specific items (Find transits /
        Surveil) can be built and their actions can carry the clicked point.
        Option (a) of the migration: the React skin already hit-tests the wheel
        on hover (draw-chart.findHitRegion -> workspace-store.hoveredRegion) and
        ships that descriptor here as ``region`` (chart-context-menu.tsx:35),
        so the daemon reuses the frontend hit-test instead of rebuilding one.
        We normalize it (``_normalize_region``) and carry it in the menu's
        action payloads so region-specific actions slot in once their Python
        action/state lands.

        Region-specific research actions (Find transits, morin.py:1070-1082;
        Surveil, morin.py:1084-1106) and synastry Composite (morin.py:1108-1114)
        keep wx order. Composite is daemon-owned because the midpoint/Davison
        chart is built and cached from source charts here, never in React.
        """
        clicked_region = self._normalize_region(region)
        with self._lock:
            doc_id = document_id or self._controller.active_document_id()
            session = self._controller.session(doc_id) if doc_id else None
            if session is None:
                return {"items": [], "region": clicked_region}

            items: list[dict] = []

            multiwheel_items = self._multiwheel_menu_items(doc_id, session)
            if multiwheel_items:
                items.extend(multiwheel_items)
                items.append({"type": "separator"})

            # Region-specific research actions ride the region channel. Both are
            # deferred (no search/surveil subsystem in the daemon yet), so the
            # builder is a no-op today; it exists so the channel is exercised and
            # the items slot in here, in wx order, once ported.
            items.extend(self._region_research_items(doc_id, session, clicked_region))

            composite_item = self._synastry_composite_menu_item(doc_id, session)
            if composite_item is not None:
                items.append(composite_item)
                items.append({"type": "separator"})

            items.append(self._supplementary_charts_menu(doc_id, session))
            if session.get("supplementary_feature_kind") == "harmonic":
                items.append(self._harmonic_chart_menu(doc_id, session))
            if session.get("supplementary_feature_kind") == "profections":
                items.append({"type": "separator"})
                items.append(self._profections_mode_menu())
            converse_item = self._converse_transit_mode_item(doc_id, session)
            if converse_item is not None:
                items.append({"type": "separator"})
                items.append(converse_item)
            items.append({"type": "separator"})
            items.append(self._overlay_menu())
            items.append({"type": "separator"})
            items.extend(self._display_toggle_items())
            items.append({"type": "separator"})
            items.append(self._house_system_menu())

            # Chart anchoring is intentionally hidden from the graph chart
            # context menu for now. Revisit the whole anchor workflow before
            # exposing this again; the handler/helper below are left in place.

            # Echo the region the menu was built for so the skin (and curl) can
            # confirm the channel survived end-to-end. Carries no meaning the
            # skin recomputes; it is the daemon's normalized view of the click.
            return {
                "items": self._strip_redundant_separators(items),
                "region": clicked_region,
            }

    def document_context_menu(self, document_id: str) -> dict:
        """Daemon-owned sidebar/tab document-row context menu.

        Mirrors ``morin._handle_workspace_document_context`` (morin.py:11303-
        11342): duplicate launchers, Other Revolutions, Parallel Transit, Marr
        sidereal-return toggle, and Packet 07B relationship participant/Split
        actions. React renders the daemon menu tree and never recomputes
        relationship predicates.
        """
        with self._lock:
            doc_id = str(document_id or "")
            session = self._controller.session(doc_id)
            if session is None:
                return {"items": []}
            if self._controller.active_document_id() != doc_id:
                self._controller.activate_document(doc_id)

            items: list[dict] = []
            multiwheel_items = self._multiwheel_menu_items(doc_id, session)
            if multiwheel_items:
                items.extend(multiwheel_items)
                items.append({"type": "separator"})
            items.extend(self._duplicate_chart_items(doc_id, session, include_parallel=True))

            converse_item = self._converse_transit_mode_item(doc_id, session)
            if converse_item is not None:
                items.append({"type": "separator"})
                items.append(converse_item)

            items.append({"type": "separator"})
            items.append(self._other_revolutions_menu(doc_id, session))

            return_mode_items = self._return_calculation_mode_items(doc_id, session)
            if return_mode_items:
                items.append({"type": "separator"})
                items.extend(return_mode_items)

            relationship_items = self._relationship_document_context_items(doc_id, session)
            if relationship_items:
                items.append({"type": "separator"})
                items.extend(relationship_items)

            return {"items": self._strip_redundant_separators(items)}

    def _relationship_document_context_items(self, document_id: str, session: dict) -> list[dict]:
        """Composite participant toggles + Extract + Split rows.

        Source rows: morin.py:11318-11339. Participant checkboxes are visible
        only for 3+ relationship participants; Split is visible for synastry or
        composite-from-synastry sessions. The Extract participant / Extract all
        rows (morin._workspace_extract_relationship_participant /
        _workspace_extract_all_relationship_participants, morin.py:11468-11479)
        have no visible wx menu trigger; per the BUG-3 / DEF-004 directive they
        are surfaced here on the relationship document context menu as the
        natural home (deviation from wx, which exposed only the methods).
        """
        items: list[dict] = []
        participants = self._relationship_session_all_participants(session)
        states = self._relationship_session_participant_states(session)
        if (
            len(participants) >= 3
            and session.get("compound_kind") != "synastry"
        ):
            for idx, participant in enumerate(participants):
                checked = bool(states[idx]) if idx < len(states) else True
                items.append({
                    "type": "checkbox",
                    "label": self._chart_label(participant, "Untitled"),
                    "checked": checked,
                    "actionId": "workspace.toggle_relationship_participant",
                    "payload": {
                        "documentId": document_id,
                        "participantIndex": idx,
                    },
                })
        if self._is_relationship_session(session) and participants:
            if items:
                items.append({"type": "separator"})
            extract_children: list[dict] = []
            for idx, participant in enumerate(participants):
                extract_children.append({
                    "type": "item",
                    "label": self._chart_label(participant, "Untitled"),
                    "actionId": "workspace.extract_relationship_participant",
                    "payload": {
                        "documentId": document_id,
                        "participantIndex": idx,
                    },
                })
            if len(participants) > 1:
                extract_children.append({"type": "separator"})
                extract_children.append({
                    "type": "item",
                    "label": mtexts.txts.get(
                        "ExtractAllParticipants", "Extract All Participants"
                    ),
                    "actionId": "workspace.extract_all_relationship_participants",
                    "payload": {"documentId": document_id},
                })
            items.append({
                "type": "submenu",
                "label": mtexts.txts.get("ExtractParticipant", "Extract Participant"),
                "children": extract_children,
            })
        if self._is_relationship_session(session):
            if items:
                items.append({"type": "separator"})
            items.append({
                "type": "item",
                "label": "Split into Radixes",
                "actionId": "workspace.split_compound_into_radixes",
                "payload": {"documentId": document_id},
            })
        return items

    @staticmethod
    def _normalize_region(region: Optional[dict]) -> Optional[dict]:
        """Daemon's view of the React hit-test descriptor (workspace-store.ts
        HoverRegion, shipped at chart-context-menu.tsx:35).

        The frontend already owns the wheel hit-test (the wx twin is
        workspace_shell.get_chart_region_at_screen_pos -> chart_host, pass-through
        at workspace_shell.py:7553-7555); the daemon does NOT rebuild a second
        hit-test. We only keep the descriptor's stable identity fields so a
        future Find-transits/Surveil action can reconstruct the significator from
        the same channel the wx frame used (morin.py:1058-1066). Unknown/empty
        regions collapse to None, matching wx where ``clicked_region`` is None
        when the cursor is over no point (morin.py:1058)."""
        if not isinstance(region, dict):
            return None
        kind = region.get("kind")
        if not isinstance(kind, str) or not kind:
            return None
        # Whitelist the identity-bearing keys the React HoverRegion union carries
        # (workspace-store.ts:23-46). No recompute; pure projection.
        keep = (
	            "kind", "planetId", "seId", "longitude", "latitude", "speed",
	            "house", "dignity", "angleId", "houseIndex", "signIndex",
	            "family", "itemId", "label", "glyph", "segments", "p1", "p2", "aspectType",
	            "chartRole", "searchObjectId",
	        )
        out = {k: region[k] for k in keep if k in region}
        return out or None

    def _region_research_items(
        self, document_id: str, session: dict, region: Optional[dict]
    ) -> list[dict]:
        """Region significator actions: Find transits + Surveil mark.

        wx twin: ``_search_significator_spec_for_region`` -> 'Find transits'
        (morin.py:1070-1082) and ``_surveil_spec_for_region`` -> 'Surveil ...'
        (morin.py:1084-1106).

        Find Transits is migrated: build the same significator spec from the
        clicked primary-chart region and open the transit-search workspace
        document seeded to that target. Surveil is now migrated too (the
        surveil_service study store): a per-point "Surveil <label>" check item
        toggles a global research mark in the active study, and — when any mark
        exists — Studies… + Clear Active Surveil Study follow, in wx order
        (morin.py:1084-1106).
        """
        items: list[dict] = []
        point_items: list[dict] = []
        spec = self._search_significator_spec_for_region(document_id, region)
        if spec is not None:
            point_items.append({
                "type": "item",
                "label": "Find transits",
                "actionId": "workspace.show_transit_search_pane",
                "payload": {
                    "documentId": document_id,
                    "significatorId": spec["id"],
                    "chartRole": spec.get("chart_role"),
                    "customPoints": spec.get("custom_points") or [],
                    "label": spec.get("label") or "",
                },
            })

        custom_point = self._search_custom_point_for_region(region)
        if custom_point is not None:
            point_items.append({
                "type": "item",
                "label": "Primary directions",
                "actionId": "workspace.show_primary_directions_to_point",
                "payload": {
                    "documentId": document_id,
                    "customSignificator": {**custom_point, "only": True},
                },
            })

        # Surveil: global research mark on a clicked zodiacal point + the
        # studies/clear rows once any mark exists (morin.py:1084-1106).
        surveil_spec = self._surveil_spec_for_region(document_id, session, region)
        has_any_marks = self._surveil_store.has_any_marks()
        if surveil_spec is not None or has_any_marks:
            if surveil_spec is not None:
                point_items.append({
                    "type": "checkbox",
                    "label": "Surveil " + surveil_spec["label"],
                    "checked": self._surveil_store.mark_exists(surveil_spec["longitude"]),
                    "actionId": "surveil.toggle_mark",
                    "payload": {"documentId": document_id, "spec": surveil_spec},
                })
            if point_items:
                items.append({
                    "type": "submenu",
                    "label": "For this point",
                    "children": point_items,
                })
            if has_any_marks:
                items.append({
                    "type": "item",
                    "label": "Surveil Studies...",
                    "actionId": "surveil.open_studies",
                    "payload": {"documentId": document_id},
                })
                items.append({
                    "type": "item",
                    "label": "Clear Active Surveil Study",
                    "actionId": "surveil.clear_study",
                    "payload": {"documentId": document_id},
                })
            items.append({"type": "separator"})
        elif point_items:
            items.append({
                "type": "submenu",
                "label": "For this point",
                "children": point_items,
            })
        return items

    def _surveil_spec_for_region(
        self, document_id: str, session: dict, region: Optional[dict]
    ) -> Optional[dict]:
        """Build a surveil mark spec (label/longitude/glyph/source identity) from
        a clicked region, or None if the region isn't surveilable.

        Port of MorinApp._surveil_spec_for_region (morin.py:1396-1427). Reuses the
        already-migrated region helpers (_region_longitude, _custom_point_* and
        the glyph reader); the surveil label/glyph mapping lives in
        surveil_service so the renderer-fed fields match the desktop exactly.
        """
        if not isinstance(region, dict):
            return None
        kind = str(region.get("kind") or "")
        if kind not in surveil_service.SURVEILABLE_KINDS:
            return None
        lon = self._region_longitude(region)
        if lon is None:
            return None
        lon = lon % 360.0
        object_id = self._surveil_object_id_for_region(region)
        fallback_label = self._custom_point_label_for_region(region)
        label = surveil_service.label_for_kind(kind, object_id, lon, fallback_label)
        glyph, glyph_font = surveil_service.glyph_for_spec(
            kind, object_id, {"glyph": self._custom_point_glyph_for_region(region)}
        )
        return {
            "longitude": lon,
            "label": label,
            "source_name": self._surveil_source_name(session),
            "source_ref": self._surveil_source_ref(document_id, session),
            "source_kind": kind,
            "source_id": object_id,
            "glyph": glyph,
            "glyph_font": glyph_font,
        }

    @staticmethod
    def _surveil_object_id_for_region(region: dict):
        """The wx ``region.object_id`` analogue used by the glyph/label mapping
        (morin.py:1414/1438-1443 expect planet se_id, angle key, or house index).
        """
        kind = str(region.get("kind") or "")
        if kind == "planet":
            try:
                return int(region.get("seId", region.get("planetId")))
            except Exception:
                return region.get("planetId")
        if kind == "angle":
            return str(region.get("angleId") or "angle").lower()
        if kind == "house":
            try:
                return int(region.get("houseIndex"))
            except Exception:
                return region.get("houseIndex")
        if kind == "syzygy":
            return "syzygy"
        if kind == "eclipse":
            return "eclipse"
        return None

    def _surveil_source_name(self, session: Optional[dict]) -> str:
        """Chart name the mark is captured from (morin.py:1455-1470)."""
        if not isinstance(session, dict):
            return ""
        cs = session.get("chart_session")
        chrt = getattr(cs, "chart", None) if cs is not None else None
        name = getattr(chrt, "name", None)
        if name:
            return str(name)
        radix = getattr(cs, "radix", None) if cs is not None else None
        name = getattr(radix, "name", None)
        if name:
            return str(name)
        fallback = session.get("chart")
        return str(getattr(fallback, "name", "") or "")

    def _surveil_source_ref(self, document_id: str, session: Optional[dict]) -> dict:
        """Identity so the studies-dialog "Open Radix" row can reactivate the
        source document (morin.py:1472-1491). The webapp source is the live
        document; we carry its document_id (+ path/chart_id when present)."""
        ref: dict = {}
        if document_id:
            ref["document_id"] = document_id
        if isinstance(session, dict):
            fpath = session.get("fpath", "")
            if fpath:
                ref["path"] = fpath
            chart_id = session.get("chart_id", "")
            if chart_id:
                ref["chart_id"] = chart_id
        return ref

    def _synastry_composite_menu_item(self, document_id: str, session: dict) -> Optional[dict]:
        """Composite checkbox for synastry/composite sessions.

        wx twin: morin.py:1108-1114 appends a checked ``Composite`` item when
        ``_active_synastry_pair`` resolves and routes it through
        ``_open_active_synastry_composite``. The daemon resolves the same pair
        from session state and emits one action id; the skin renders only.
        """
        center, partner = self._active_synastry_pair(session)
        if center is None or partner is None:
            return None
        return {
            "type": "checkbox",
            "label": mtexts.txts.get("Composite", "Composite"),
            "checked": session.get("compound_kind") == "composite_from_synastry",
            "actionId": "workspace.toggle_synastry_composite",
            "payload": {"documentId": document_id},
        }

    def _search_significator_spec_for_region(
        self, document_id: str, region: Optional[dict]
    ) -> Optional[dict]:
        chart_role = self._search_region_chart_role(region)
        reference_chart = self._search_reference_chart_for_document(
            document_id, chart_role=chart_role)
        if reference_chart is None:
            return None
        oid = self._search_significator_id_for_region(
            region, reference_role=chart_role)
        if oid is not None:
            obj = searchcatalog.SearchCatalog(reference_chart).get(oid)
            if obj is not None and obj.can_significator:
                return {"id": oid, "label": obj.label, "chart_role": chart_role}
        custom_point = self._search_custom_point_for_region(region)
        if custom_point is not None:
            return {
                "id": custom_point["id"],
                "label": custom_point["label"],
                "chart_role": chart_role,
                "custom_points": [custom_point],
            }
        return None

    @staticmethod
    def _search_region_chart_role(region: Optional[dict]) -> str:
        if isinstance(region, dict) and region.get("chartRole") == "outer":
            return "outer"
        return "primary"

    def _search_reference_chart_for_document(
        self, document_id: str, chart_role: Optional[str] = None
    ):
        session = self._controller.session(document_id)
        if session is None:
            return None
        role_chart = self._search_render_chart_for_role(session, chart_role)
        if role_chart is not None:
            return role_chart
        cs = session.get("chart_session")
        if cs is not None:
            if getattr(cs, "view_mode", None) == chart_session.ChartSession.COMPOUND:
                if session.get("compound_kind") == "synastry":
                    return getattr(cs, "chart", None)
                if session.get("comparison_chart") is not None:
                    return session.get("comparison_chart")
                parent_session = self._controller.session(session.get("parent_document_id"))
                parent_cs = parent_session.get("chart_session") if parent_session else None
                if parent_cs is not None and getattr(parent_cs, "chart", None) is not None:
                    return parent_cs.chart
                return getattr(cs, "radix", None) or getattr(cs, "chart", None)
            if getattr(cs, "chart", None) is not None:
                return cs.chart
        return session.get("chart")

    def _search_render_chart_for_role(self, session: dict, chart_role: Optional[str]):
        if chart_role not in ("primary", "outer"):
            return None
        cs = session.get("chart_session") if isinstance(session, dict) else None
        if cs is None:
            return session.get("chart") if chart_role == "primary" else None
        live = getattr(cs, "chart", None) or session.get("chart")
        if live is None:
            return None
        primary, comparison = self._select_render_charts(session, cs, live)
        if chart_role == "outer":
            return comparison
        return primary

    @staticmethod
    def _search_custom_point_for_region(region: Optional[dict]) -> Optional[dict]:
        if not isinstance(region, dict):
            return None
        kind = str(region.get("kind") or "")
        if kind not in ("planet", "fortune", "vertex", "syzygy", "eclipse", "angle", "house", "secondary_ring"):
            return None
        lon = WorkspaceService._region_longitude(region)
        if lon is None:
            return None
        lat = WorkspaceService._region_latitude(region)
        role = str(region.get("chartRole") or "primary")
        label = WorkspaceService._custom_point_label_for_region(region)
        object_id = WorkspaceService._custom_point_id_for_region(region)
        out = {
            "id": "custom:%s:%s:%s" % (role, kind, object_id),
            "label": label,
            "longitude": lon,
            "display_glyph": WorkspaceService._custom_point_glyph_for_region(region),
            "display_marker": WorkspaceService._custom_point_marker_for_region(region),
            "display_segments": WorkspaceService._custom_point_segments_for_region(region),
        }
        display_planet_id = WorkspaceService._custom_point_display_planet_id(region)
        if display_planet_id is not None:
            out["display_planet_id"] = display_planet_id
        if lat is not None:
            out["latitude"] = lat
        return out

    @staticmethod
    def _custom_point_display_planet_id(region: dict) -> Optional[int]:
        kind = str(region.get("kind") or "")
        if kind == "planet":
            try:
                return int(region.get("seId", region.get("planetId")))
            except Exception:
                return None
        if kind == "secondary_ring":
            for segment in region.get("segments") or []:
                if not isinstance(segment, dict):
                    continue
                if str(segment.get("kind") or "") != "planet":
                    continue
                try:
                    return int(segment.get("seId"))
                except Exception:
                    return None
        return None

    @staticmethod
    def _custom_point_glyph_for_region(region: dict) -> str:
        kind = str(region.get("kind") or "")
        if kind == "planet":
            try:
                se_id = int(region.get("seId", region.get("planetId")))
                return common.common.get_planet_glyph(se_id)
            except Exception:
                return ""
        if kind == "fortune":
            return common.common.fortune
        if kind == "syzygy":
            return ""
        if kind == "eclipse":
            return surveil_service.ECLIPSE_GLYPH
        if kind == "secondary_ring":
            if str(region.get("family") or "") == "midpoint":
                return ""
            for segment in region.get("segments") or []:
                if not isinstance(segment, dict):
                    continue
                segment_kind = str(segment.get("kind") or "")
                if segment_kind == "planet":
                    try:
                        return common.common.get_planet_glyph(int(segment.get("seId")))
                    except Exception:
                        text = str(segment.get("text") or "")
                        if text:
                            return text
                if segment_kind == "glyph":
                    text = str(segment.get("text") or "")
                    if text:
                        return text
        return ""

    @staticmethod
    def _custom_point_marker_for_region(region: dict) -> str:
        if str(region.get("kind") or "") != "secondary_ring":
            return ""
        return export_chart_json.ring_item_display_marker(region)

    @staticmethod
    def _custom_point_segments_for_region(region: dict) -> list[dict]:
        if str(region.get("kind") or "") != "secondary_ring":
            return []
        return export_chart_json.ring_item_display_segments(region)

    @staticmethod
    def _region_longitude(region: dict) -> Optional[float]:
        try:
            lon = float(region.get("longitude"))
        except (TypeError, ValueError):
            return None
        if not math.isfinite(lon):
            return None
        return lon

    @staticmethod
    def _region_latitude(region: dict) -> Optional[float]:
        try:
            lat = float(region.get("latitude"))
        except (TypeError, ValueError):
            return None
        if not math.isfinite(lat):
            return None
        return lat

    @staticmethod
    def _custom_point_id_for_region(region: dict) -> str:
        kind = str(region.get("kind") or "point")
        if kind == "planet":
            return str(region.get("seId", region.get("planetId", "planet")))
        if kind == "angle":
            return str(region.get("angleId") or "angle")
        if kind == "house":
            return str(region.get("houseIndex") or "house")
        if kind == "syzygy":
            return "syzygy"
        if kind == "eclipse":
            return "eclipse"
        if kind == "secondary_ring":
            family = str(region.get("family") or "secondary_ring")
            item_id = str(region.get("itemId") or region.get("label") or "item")
            return "%s:%s" % (family, item_id)
        return kind

    @staticmethod
    def _custom_point_label_for_region(region: dict) -> str:
        kind = str(region.get("kind") or "")
        if kind == "planet":
            try:
                se_id = int(region.get("seId", region.get("planetId")))
                return common.common.get_planet_name(se_id)
            except Exception:
                return str(region.get("planetId") or "Planet")
        if kind == "fortune":
            return mtexts.txts.get("LoF", mtexts.txts.get("LotOfFortune", "Fortuna"))
        if kind == "vertex":
            return mtexts.txts.get("Vertex", "Vertex")
        if kind == "syzygy":
            return str(region.get("label") or "Prenatal Syzygy")
        if kind == "eclipse":
            return str(region.get("label") or surveil_service.ECLIPSE_GLYPH)
        if kind == "angle":
            angle_id = str(region.get("angleId") or "").lower()
            return {
                "asc": mtexts.txts.get("Asc", "Asc"),
                "mc": mtexts.txts.get("MC", "MC"),
                "dsc": mtexts.txts.get("Dsc", "Dsc"),
                "ic": mtexts.txts.get("IC", "IC"),
            }.get(angle_id, "Angle")
        if kind == "house":
            try:
                idx = int(region.get("houseIndex"))
            except Exception:
                idx = 0
            return (
                mtexts.txts.get("HouseCuspIndexedFmt", "House %d cusp") % idx
                if idx > 0
                else mtexts.txts.get("HouseCuspLabel", "House cusp")
            )
        if kind == "secondary_ring":
            label = str(region.get("label") or "").strip()
            if label:
                return label
            family = str(region.get("family") or "Point").replace("_", " ")
            return family[:1].upper() + family[1:]
        return "Point"

    @staticmethod
    def _search_significator_id_for_region(
        region: Optional[dict], *, reference_role: str = "primary"
    ) -> Optional[str]:
        if not isinstance(region, dict):
            return None
        region_role = "outer" if region.get("chartRole") == "outer" else "primary"
        if region_role != reference_role:
            return None
        search_object_id = region.get("searchObjectId")
        if isinstance(search_object_id, str) and search_object_id:
            return search_object_id
        kind = region.get("kind")
        if kind == "planet":
            planet_id = region.get("seId", region.get("planetId"))
            try:
                planet_id = int(planet_id)
            except Exception:
                return None
            return _SEARCH_PLANET_ID_BY_SE_ID.get(planet_id)
        if kind == "fortune":
            return "point:lof"
        if kind == "syzygy":
            return "point:syzygy"
        if kind == "eclipse":
            return "point:eclipse"
        if kind == "angle":
            angle_id = region.get("angleId")
            if angle_id in ("asc", "mc"):
                return "angle:%s" % angle_id
            return None
        return None

    def run_context_menu_action(self, action_id: str, payload: Optional[dict] = None) -> dict:
        """Execute one daemon-issued context-menu action id."""
        payload = payload or {}
        with self._lock:
            if action_id == "workspace.open_supplementary":
                doc_id = str(payload.get("documentId") or "")
                kind = str(payload.get("kind") or "")
                planet_type = payload.get("planetType")
                return self.open_document(
                    kind="chart",
                    parent_document_id=doc_id,
                    feature_kind=kind,
                    planet_type=int(planet_type) if planet_type is not None else None,
                    binding_payload=payload.get("binding") if isinstance(payload.get("binding"), dict) else None,
                )

            if action_id == "workspace.set_harmonic_number":
                doc_id = str(payload.get("documentId") or "")
                division_number = payload.get("divisionNumber", payload.get("harmonicNumber"))
                if not self._set_harmonic_projection_in_place(doc_id, value=division_number):
                    raise ValueError("division number is available only on a harmonic chart")
                session = self._controller.session(doc_id) or {}
                retained = (session.get("supplementary_binding") or {}).get("retained_state") or {}
                return {
                    "ok": True,
                    "documentId": doc_id,
                    "activeDocumentId": self._controller.active_document_id(),
                    "harmonicNumber": retained.get("harmonic_number"),
                    "vargaNumber": retained.get("varga_number"),
                    "projectionMode": retained.get("projection_mode"),
                    "snapshot": self.document_snapshot(doc_id),
                }

            if action_id == "workspace.set_harmonic_projection_mode":
                doc_id = str(payload.get("documentId") or "")
                if not self._set_harmonic_projection_in_place(
                    doc_id,
                    mode=payload.get("projectionMode"),
                ):
                    raise ValueError("projection mode is available only on a harmonic chart")
                session = self._controller.session(doc_id) or {}
                retained = (session.get("supplementary_binding") or {}).get("retained_state") or {}
                return {
                    "ok": True,
                    "documentId": doc_id,
                    "activeDocumentId": self._controller.active_document_id(),
                    "projectionMode": retained.get("projection_mode"),
                    "snapshot": self.document_snapshot(doc_id),
                }

            if action_id == "workspace.open_transit_search":
                doc_id = str(payload.get("documentId") or "")
                return self.open_transit_search(
                    doc_id,
                    significator_id=payload.get("significatorId"),
                    chart_role=payload.get("chartRole"),
                    custom_points=payload.get("customPoints") or [],
                )

            if action_id == "workspace.open_primary_directions_to_point":
                doc_id = str(payload.get("documentId") or self._controller.active_document_id() or "")
                custom_significator = payload.get("customSignificator")
                return self.open_directions(
                    doc_id,
                    custom_significator=custom_significator
                    if isinstance(custom_significator, dict)
                    else None,
                )

            if action_id == "workspace.toggle_parallel_transits":
                doc_id = str(payload.get("documentId") or "")
                session = self._controller.session(doc_id)
                if session is None:
                    raise ValueError(f"unknown document {doc_id!r}")
                if not self._parallel_transit_available(session):
                    raise ValueError("parallel transit is not available for this document")
                session["parallel_transits_enabled"] = not bool(session.get("parallel_transits_enabled", False))
                result = {
                    "ok": True,
                    "documentId": doc_id,
                    "activeDocumentId": self._controller.active_document_id(),
                    "parallelTransitsEnabled": bool(session.get("parallel_transits_enabled", False)),
                    "documents": self._tree_payload(),
                }
                self._attach_full_snapshot(result, doc_id, overlay_render_mode="full")
                self._broadcast_session_changed(doc_id, "options")
                return result

            if action_id == "workspace.set_show_radix_comparison":
                doc_id = str(payload.get("documentId") or self._controller.active_document_id() or "")
                return self.set_show_radix_comparison(
                    doc_id,
                    bool(payload.get("showRadix", False)),
                )

            if action_id == "workspace.toggle_marr_sidereal_return":
                doc_id = str(payload.get("documentId") or "")
                return self._toggle_marr_sidereal_return(doc_id)

            if action_id == "workspace.toggle_converse_transit":
                doc_id = str(payload.get("documentId") or "")
                return self._toggle_converse_transit(doc_id)

            if action_id == "workspace.set_return_calculation_mode":
                doc_id = str(payload.get("documentId") or "")
                return self._set_return_calculation_mode(doc_id, payload.get("mode"))

            if action_id == "workspace.toggle_return_calculation_mode":
                doc_id = str(payload.get("documentId") or "")
                return self._toggle_return_calculation_mode(doc_id, payload.get("mode"))

            if action_id == "workspace.set_lunar_return_mode":
                doc_id = str(payload.get("documentId") or "")
                return self._set_lunar_return_mode(doc_id, payload.get("mode"))

            if action_id == "workspace.toggle_anchor_this_chart":
                doc_id = str(payload.get("documentId") or self._controller.active_document_id() or "")
                session = self._controller.session(doc_id)
                cs = session.get("chart_session") if session is not None else None
                if cs is None or getattr(cs, "chart", None) is None:
                    raise ValueError("active document has no chart session")
                if getattr(cs, "display_anchor_chart", None) is None:
                    cs.display_anchor_chart = cs.chart
                else:
                    cs.display_anchor_chart = None
                self._broadcast_session_changed(doc_id, "options")
                return {"ok": True, "documents": self._tree_payload()}

            if action_id == "workspace.set_chart_ring_count":
                return self.set_chart_ring_count(
                    str(payload.get("documentId") or ""),
                    int(payload.get("ringCount", chart_rings.CHART_RING_COUNT_MIN)),
                )

            if action_id == "workspace.set_multiwheel_enabled":
                return self.set_multiwheel_enabled(
                    str(payload.get("documentId") or ""),
                    bool(payload.get("enabled", False)),
                )

            if action_id == "workspace.toggle_multiwheel_participant":
                return self.toggle_multiwheel_participant(
                    str(payload.get("documentId") or ""),
                    str(payload.get("participantDocumentId") or ""),
                )

            if action_id == "workspace.toggle_synastry_composite":
                doc_id = str(payload.get("documentId") or self._controller.active_document_id() or "")
                return self.set_synastry_composite(doc_id)

            if action_id == "workspace.toggle_relationship_participant":
                doc_id = str(payload.get("documentId") or "")
                return self.toggle_relationship_participant(
                    doc_id,
                    int(payload.get("participantIndex", -1)),
                )

            if action_id == "workspace.split_compound_into_radixes":
                doc_id = str(payload.get("documentId") or "")
                return self.split_compound_into_radixes(doc_id)

            if action_id == "workspace.extract_relationship_participant":
                doc_id = str(payload.get("documentId") or "")
                return self.extract_relationship_participant(
                    doc_id,
                    int(payload.get("participantIndex", -1)),
                )

            if action_id == "workspace.extract_all_relationship_participants":
                doc_id = str(payload.get("documentId") or "")
                return self.extract_all_relationship_participants(doc_id)

            if action_id == "options.set_display":
                attr = str(payload.get("attr") or "")
                value = payload.get("value")
                result = options_service.set_options({"display": {attr: value}})
                self.broadcast_options_changed(
                    result.get("refreshedDocumentIds"),
                    result.get("refreshMode"),
                    list_data_changed=result.get("listDataChanged", True),
                    retained_list_target=result.get("retainedListTarget"),
                )
                return result

            if action_id == "options.set_showfixstars":
                result = options_service.set_options({
                    "display": {"showfixstars": int(payload.get("mode", 0))}
                })
                self.broadcast_options_changed(
                    result.get("refreshedDocumentIds"),
                    result.get("refreshMode"),
                    list_data_changed=result.get("listDataChanged", True),
                    retained_list_target=result.get("retainedListTarget"),
                )
                return result

            if action_id == "options.set_house_system":
                result = options_service.set_options({
                    "houseSystem": {"hsys": str(payload.get("hsys") or "P")}
                })
                self.broadcast_options_changed(
                    result.get("refreshedDocumentIds"),
                    result.get("refreshMode"),
                    list_data_changed=result.get("listDataChanged", True),
                )
                return result

            if action_id == "options.set_profection_mode":
                result = options_service.set_options({
                    "profections": {"wholeSign": bool(payload.get("wholeSign", True))}
                })
                self.broadcast_options_changed(
                    result.get("refreshedDocumentIds"),
                    result.get("refreshMode"),
                    list_data_changed=result.get("listDataChanged", True),
                )
                return result

            if action_id == "options.set_quickcharts_anchor_mode":
                mode = int(payload.get("mode", morinus_options.Options.QUICKCHARTS_ANCHOR_AUTO))
                if mode not in (
                    morinus_options.Options.QUICKCHARTS_ANCHOR_AUTO,
                    morinus_options.Options.QUICKCHARTS_ANCHOR_RADIX,
                ):
                    mode = morinus_options.Options.QUICKCHARTS_ANCHOR_AUTO
                opts = options_service.options
                opts.quickcharts_anchor_to_radix = mode
                active_id = self._controller.active_document_id()
                if active_id:
                    session = self._controller.session(active_id)
                    cs = session.get("chart_session") if session is not None else None
                    if cs is not None:
                        cs.display_anchor_chart = None
                refreshed = self._controller.refresh_all_sessions()
                self.broadcast_options_changed(refreshed)
                return {"ok": True, "refreshedDocumentIds": refreshed}

            if action_id == "surveil.toggle_mark":
                spec = payload.get("spec")
                if not isinstance(spec, dict):
                    raise ValueError("surveil.toggle_mark requires a spec")
                result = self._surveil_store.toggle_mark(spec)
                return {"ok": bool(result.get("ok"))}

            if action_id == "surveil.clear_study":
                result = self._surveil_store.clear_active_study()
                return {"ok": bool(result.get("ok"))}

            if action_id == "surveil.open_studies":
                # The studies dialog is a React surface; the daemon owns only the
                # store. The skin intercepts this action id and opens the dialog
                # (see chart-context-menu.tsx), then drives the CRUD routes.
                return {"ok": True, "openStudies": True}

            raise ValueError(f"unknown context menu action: {action_id!r}")

    def _supplementary_charts_menu(self, document_id: str, session: dict) -> dict:
        is_harmonic = session.get("supplementary_feature_kind") == "harmonic"
        children = self._duplicate_chart_items(
            document_id,
            session,
            include_parallel=True,
            include_harmonic=not is_harmonic,
        )
        return {
            "type": "submenu",
            "label": "Derived Charts",
            "children": self._strip_redundant_separators(children),
        }

    def _duplicate_chart_items(
        self,
        document_id: str,
        session: dict,
        *,
        include_parallel: bool,
        include_harmonic: bool = True,
    ) -> list[dict]:
        children: list[dict] = []
        for label, kind, allowed_kind in _DUPLICATE_CHART_ITEMS:
            children.append({
                "type": "item",
                "label": label,
                "disabled": not self._supplementary_chart_allowed(allowed_kind, session),
                "actionId": "workspace.open_supplementary",
                "payload": {"documentId": document_id, "kind": kind},
            })
        if include_harmonic:
            children.append(self._harmonic_chart_menu(document_id, session))
        if include_parallel:
            children.append({"type": "separator"})
            children.append({
                "type": "checkbox",
                "label": "Parallel Transit",
                "checked": bool(session.get("parallel_transits_enabled", False)),
                "disabled": not self._parallel_transit_available(session),
                "actionId": "workspace.toggle_parallel_transits",
                "payload": {"documentId": document_id},
            })
        return children

    def _harmonic_chart_menu(self, document_id: str, session: dict) -> dict:
        is_harmonic = session.get("supplementary_feature_kind") == "harmonic"
        retained = (session.get("supplementary_binding") or {}).get("retained_state") or {}
        controller = self.__dict__.get("_controller")
        controller_options = getattr(controller, "options", None)
        default_mode = harmonic_chart.normalize_projection_mode(
            getattr(controller_options, "harmonic_chart_mode", harmonic_chart.PROJECTION_MODE_HARMONIC)
        )
        mode = harmonic_chart.normalize_projection_mode(retained.get("projection_mode"), default=default_mode)
        current = (
            harmonic_chart.normalize_varga_number(retained.get("varga_number", harmonic_chart.DEFAULT_VARGA))
            if mode == harmonic_chart.PROJECTION_MODE_VARGA
            else harmonic_chart.normalize_harmonic_number(
                retained.get("harmonic_number", harmonic_chart.DEFAULT_HARMONIC)
            )
        )
        action_id = (
            "workspace.set_harmonic_number"
            if is_harmonic
            else "workspace.open_supplementary"
        )
        allowed = self._supplementary_chart_allowed("secondary", session)
        mode_children = []
        for projection_mode, label in (
            (harmonic_chart.PROJECTION_MODE_HARMONIC, "Harmonic chart"),
            (harmonic_chart.PROJECTION_MODE_VARGA, "Vargas"),
        ):
            if is_harmonic:
                mode_payload = {
                    "documentId": document_id,
                    "projectionMode": projection_mode,
                }
                mode_action = "workspace.set_harmonic_projection_mode"
            else:
                mode_payload = {
                    "documentId": document_id,
                    "kind": "harmonic",
                    "binding": {
                        "feature_kind": "harmonic",
                        "retained_state": {"projection_mode": projection_mode},
                    },
                }
                mode_action = "workspace.open_supplementary"
            mode_children.append({
                "type": "radio",
                "label": label,
                "value": projection_mode,
                "disabled": not allowed,
                "actionId": mode_action,
                "payload": mode_payload,
            })

        number_children = []
        presets = (
            harmonic_chart.VARGA_DIVISIONS
            if mode == harmonic_chart.PROJECTION_MODE_VARGA
            else harmonic_chart.PRESET_HARMONICS
        )
        for preset in presets:
            payload = {
                "documentId": document_id,
                "divisionNumber": preset,
            }
            if not is_harmonic:
                payload = {
                    "documentId": document_id,
                    "kind": "harmonic",
                    "binding": {
                        "feature_kind": "harmonic",
                        "retained_state": {
                            "projection_mode": mode,
                            "varga_number" if mode == harmonic_chart.PROJECTION_MODE_VARGA else "harmonic_number": preset,
                        },
                    },
                }
            number_children.append({
                "type": "radio",
                "label": harmonic_chart.format_harmonic_number(preset),
                "value": harmonic_chart.format_harmonic_number(preset),
                "disabled": not allowed,
                "actionId": action_id,
                "payload": payload,
            })
        return {
            "type": "submenu",
            "label": "Harmonic",
            "children": [
                {
                    "type": "radioGroup",
                    "value": mode,
                    "children": mode_children,
                },
                {"type": "separator"},
                {
                    "type": "radioGroup",
                    "value": harmonic_chart.format_harmonic_number(current) if is_harmonic else "",
                    "children": number_children,
                },
            ],
        }

    def _other_revolutions_menu(self, document_id: str, session: dict) -> dict:
        supported = (
            "planetary-return" in PUBLIC_TO_FEATURE_KIND
            and PUBLIC_TO_FEATURE_KIND.get("planetary-return") == "planetary_return"
        )
        allowed = self._supplementary_chart_allowed("revolution", session)
        children = []
        for label, planet_type in _OTHER_REVOLUTION_ITEMS:
            children.append({
                "type": "item",
                "label": label,
                "disabled": not (
                    supported
                    and planet_type in revolutions.Revolutions.PLANETARY_SPECS
                    and allowed
                ),
                "actionId": "workspace.open_supplementary",
                "payload": {
                    "documentId": document_id,
                    "kind": "planetary-return",
                    "planetType": int(planet_type),
                },
            })
        return {
            "type": "submenu",
            "label": "Other Revolutions",
            "children": children,
        }

    def _marr_sidereal_item(self, document_id: str, session: dict) -> Optional[dict]:
        attr = self._marr_flag_attr_for_session(session)
        if attr is None:
            return None
        # Per-document flag: the binding value when stamped (every build stamps
        # it), else the global default — policy-chart-lifecycle Decided: the
        # row toggle is chart-local, Settings > Revolutions owns the default.
        retained = (session.get("supplementary_binding") or {}).get("retained_state") or {}
        checked = retained.get("marr_sidereal")
        if checked is None:
            checked = getattr(options_service.options, attr, False)
        return {
            "type": "checkbox",
            "label": "Sidereal Return (Marr)",
            "checked": bool(checked),
            "actionId": "workspace.toggle_marr_sidereal_return",
            "payload": {"documentId": document_id},
        }

    @staticmethod
    def _converse_transit_enabled(session: Optional[dict]) -> bool:
        if isinstance(session, dict) and session.get("supplementary_feature_kind") == "transits":
            return False
        retained = (
            (session.get("supplementary_binding") or {}).get("retained_state") or {}
            if isinstance(session, dict)
            else {}
        )
        return bool(retained.get("converse_enabled", True))

    def _converse_transit_mode_item(
        self,
        document_id: str,
        session: dict,
    ) -> Optional[dict]:
        if session.get("supplementary_feature_kind") not in {
            "transits",
            "converse_transits",
        }:
            return None
        return {
            "type": "checkbox",
            "label": "Converse transits",
            "checked": self._converse_transit_enabled(session),
            "actionId": "workspace.toggle_converse_transit",
            "payload": {"documentId": document_id},
        }

    def _return_calculation_mode_value(self, session: dict) -> str:
        attr = self._marr_flag_attr_for_session(session)
        retained = (session.get("supplementary_binding") or {}).get("retained_state") or {}
        marr = retained.get("marr_sidereal")
        if marr is None and attr is not None:
            marr = getattr(options_service.options, attr, False)
        feature_kind = session.get("supplementary_feature_kind")
        if (
            feature_kind == "solar_return"
            and retained.get("solar_return_mode") == solilunar.RETURN_MODE_TITHI_PRAVESHA
        ):
            return solilunar.RETURN_MODE_TITHI_PRAVESHA
        if feature_kind == "lunar_return":
            lunar_mode = solilunar.normalize_return_mode(retained.get("lunar_return_mode"))
            if lunar_mode != solilunar.RETURN_MODE_LUNAR:
                return lunar_mode
            return "marr_sidereal" if bool(marr) else "standard"
        return "marr_sidereal" if bool(marr) else "standard"

    def _return_calculation_mode_items(self, document_id: str, session: dict) -> list[dict]:
        attr = self._marr_flag_attr_for_session(session)
        if attr is None:
            return []
        feature_kind = session.get("supplementary_feature_kind")
        current = self._return_calculation_mode_value(session)
        if feature_kind == "solar_return":
            return [
                self._return_mode_checkbox(document_id, "Sidereal Return (Marr)", "marr_sidereal", current),
                self._return_mode_checkbox(
                    document_id,
                    "Tithi Pravesha (Annual Soli-Lunar Return)",
                    solilunar.RETURN_MODE_TITHI_PRAVESHA,
                    current,
                ),
            ]
        if feature_kind == "lunar_return":
            return [
                self._return_mode_checkbox(document_id, "Sidereal Return (Marr)", "marr_sidereal", current),
                self._return_mode_checkbox(document_id, "Lunar Phase (Embolismic)", solilunar.RETURN_MODE_SOLILUNAR, current),
                self._return_mode_checkbox(document_id, "Jonas Arc", solilunar.RETURN_MODE_JONAS_ARC, current),
            ]
        marr_item = self._marr_sidereal_item(document_id, session)
        return [marr_item] if marr_item is not None else []

    def _return_mode_checkbox(self, document_id: str, label: str, mode: str, current: str) -> dict:
        return {
            "type": "checkbox",
            "label": label,
            "checked": current == mode,
            "actionId": "workspace.toggle_return_calculation_mode",
            "payload": {"documentId": document_id, "mode": mode},
        }

    def _overlay_menu(self) -> dict:
        opts = options_service.options
        current = int(getattr(opts, "showfixstars", morinus_options.Options.NONE) or 0)
        return {
            "type": "radioGroup",
            "value": str(current),
            "children": [
                {
                    "type": "radio",
                    "label": label,
                    "value": str(mode),
                    "actionId": "options.set_showfixstars",
                    "payload": {"mode": int(mode)},
                }
                for label, mode in _OVERLAY_MENU_ITEMS
            ],
        }

    def _display_toggle_items(self) -> list[dict]:
        opts = options_service.options
        return [
            {
                "type": "checkbox",
                "label": label,
                "checked": bool(getattr(opts, attr, False)),
                "actionId": "options.set_display",
                "payload": {"attr": attr, "value": not bool(getattr(opts, attr, False))},
            }
            for attr, label in _RADIX_DISPLAY_TOGGLES
        ]

    def _house_system_menu(self) -> dict:
        opts = options_service.options
        hsys = str(getattr(opts, "hsys", "P") or "P")
        show = bool(getattr(opts, "housesystem", False))
        current = "N" if hsys == "N" and not show else hsys
        return {
            "type": "submenu",
            "label": "House System",
            "children": [{
                "type": "radioGroup",
                "value": current,
                "children": [
                    {
                        "type": "radio",
                        "label": label,
                        "value": code,
                        "actionId": "options.set_house_system",
                        "payload": {"hsys": code},
                    }
                    for code, label in _HOUSE_SYSTEM_ITEMS
                ],
            }],
        }

    @staticmethod
    def _wheel_draws_multiple_rings() -> bool:
        """The independent tri/quad renderer is available for every theme."""
        return True

    def _ring_owner(self, document_id: str) -> tuple[str, Optional[dict]]:
        """Root document/session that owns branch-wide multi-wheel state."""
        branch = chart_rings.branch_document_ids(
            self._controller.documents(), str(document_id or ""),
        )
        owner_id = branch[0] if branch else str(document_id or "")
        return owner_id, self._controller.session(owner_id)

    def _reconcile_multiwheel_state(
        self,
        document_id: str,
    ) -> tuple[str, Optional[dict], list[str], list[str], bool]:
        """Prune branch-owned membership and resolve the live display mode.

        Participant IDs are explicit session truth. Closing/reparenting a tab
        removes it here before any snapshot is rendered. A legacy explicit
        ``chart_ring_count`` session override is migrated once; the old saved
        global count is intentionally not a mode switch.
        """
        owner_id, owner = self._ring_owner(document_id)
        if owner is None:
            return owner_id, None, [], [], False
        eligible = chart_rings.eligible_multiwheel_document_ids(
            self._controller.documents(),
            document_id,
            has_chart=lambda doc_id: self._ring_chart_for_document(doc_id) is not None,
        )
        known_raw = owner.get("multiwheel_known_eligible_ids")
        known_eligible = (
            {str(value) for value in known_raw if value is not None}
            if isinstance(known_raw, (list, tuple))
            else set(eligible)
        )
        newly_eligible = [
            participant_id for participant_id in eligible
            if participant_id not in known_eligible
        ]
        stored = owner.get("multiwheel_participant_ids")
        if isinstance(stored, (list, tuple)):
            selected = chart_rings.normalize_multiwheel_participant_ids(stored, eligible)
        else:
            legacy_requested = chart_rings.normalize_ring_count(
                owner.get("chart_ring_count", chart_rings.CHART_RING_COUNT_MIN)
            )
            initial_count = (
                legacy_requested
                if legacy_requested > chart_rings.CHART_RING_COUNT_MIN
                else chart_rings.CHART_RING_COUNT_MAX
            )
            selected = eligible[:initial_count]
            owner["multiwheel_enabled"] = bool(
                legacy_requested > chart_rings.CHART_RING_COUNT_MIN
            )
        owner["multiwheel_participant_ids"] = selected

        auto_enabled = bool(
            getattr(options_service.options, "multiwheel_open_at_three", False)
        )
        auto_armed = bool(owner.get("multiwheel_auto_armed", True))
        if auto_armed and not bool(owner.get("multiwheel_enabled", False)):
            # Before the user has made a mode/participant choice, keep the
            # proposed participant set in sync with the branch so enabling the
            # mode does exactly what its checked rows already advertise.
            selected = eligible[:chart_rings.CHART_RING_COUNT_MAX]
            owner["multiwheel_participant_ids"] = selected
        if len(eligible) < 3:
            enabled = bool(owner.get("multiwheel_enabled", False))
            owner["multiwheel_auto_armed"] = True
        elif auto_enabled and auto_armed:
            selected = eligible[:chart_rings.CHART_RING_COUNT_MAX]
            owner["multiwheel_participant_ids"] = selected
            enabled = True
            owner["multiwheel_auto_armed"] = False
        else:
            enabled = bool(owner.get("multiwheel_enabled", False))

        # A chart intentionally created or attached after the participant set
        # was established joins the wheel automatically while capacity remains.
        # The remembered eligible universe distinguishes that chart from one a
        # user has merely untoggled, so ordinary reconciliation never rechecks
        # a deliberate exclusion.
        if newly_eligible and len(selected) < chart_rings.CHART_RING_COUNT_MAX:
            selected = chart_rings.normalize_multiwheel_participant_ids(
                [*selected, *newly_eligible], eligible,
            )
            owner["multiwheel_participant_ids"] = selected
        owner["multiwheel_known_eligible_ids"] = list(eligible)

        owner["multiwheel_enabled"] = enabled
        drawable = enabled and len(selected) >= 3
        owner["chart_ring_count"] = len(selected) if drawable else chart_rings.CHART_RING_COUNT_MIN
        if not drawable:
            owner.pop("multiwheel_cursor_datetime", None)
            owner.pop("multiwheel_initial_cursor_datetime", None)
            owner.pop("multiwheel_single_chart_view", None)
        return owner_id, owner, eligible, selected, enabled

    def _multiwheel_participant_ids(self, document_id: str) -> list[str]:
        _owner_id, _owner, _eligible, selected, enabled = (
            self._reconcile_multiwheel_state(document_id)
        )
        return selected if enabled and len(selected) >= 3 else []

    def _multiwheel_tree_order_refresh(
        self, document_id: str,
    ) -> tuple[dict, Optional[str], list[str]]:
        """Reorder participant truth and prepare one coherent visible repaint."""
        _owner_id, owner, eligible, selected, enabled = (
            self._reconcile_multiwheel_state(document_id)
        )
        if owner is None or not enabled or len(selected) < 3:
            return {}, None, []
        affected_ids = list(eligible)
        result: dict = {"snapshotInvalidatedIds": affected_ids}
        active_id = self._controller.active_document_id()
        refresh_id = active_id if active_id in affected_ids else None
        if refresh_id is not None:
            self._attach_full_snapshot(result, refresh_id, overlay_render_mode="full")
        return result, refresh_id, affected_ids

    def _multiwheel_menu_items(self, document_id: str, session: dict) -> list[dict]:
        """Top-level branch multi-wheel toggle and explicit participants."""
        relationship_items = self._relationship_multiwheel_menu_items(
            document_id, session,
        )
        if relationship_items:
            return relationship_items
        if session.get("compound_kind") is not None:
            return []
        cs = session.get("chart_session")
        if cs is None or getattr(cs, "chart", None) is None:
            return []
        _owner_id, owner, eligible, selected, enabled = self._reconcile_multiwheel_state(
            document_id
        )
        if owner is None or len(eligible) < 3:
            return []
        selected_set = set(selected)
        selected_numerals = (
            {
                participant_id: identity["numeral"]
                for participant_id, identity in zip(
                    selected,
                    chart_rings.multiwheel_ring_taxonomy(len(selected)),
                )
            }
            if enabled and len(selected) >= 3
            else {}
        )
        items: list[dict] = [{
            "type": "checkbox",
            "label": "Multi-wheel",
            "checked": enabled,
            "actionId": "workspace.set_multiwheel_enabled",
            "payload": {"documentId": document_id, "enabled": not enabled},
        }]
        for participant_id in eligible:
            participant_document = self._controller.state.find_document(participant_id)
            participant_session = self._controller.session(participant_id) or {}
            participant_label = str(
                getattr(participant_document, "title", "")
                or participant_session.get("custom_title_root")
                or participant_session.get("base_title")
                or "Untitled"
            ).strip()
            checked = participant_id in selected_set
            participant_numeral = selected_numerals.get(participant_id)
            if participant_numeral:
                participant_label = f"{participant_numeral} {participant_label}"
            items.append({
                "type": "checkbox",
                "label": participant_label,
                "checked": checked,
                "inset": True,
                "disabled": (
                    not checked and len(selected) >= chart_rings.CHART_RING_COUNT_MAX
                ),
                "actionId": "workspace.toggle_multiwheel_participant",
                "payload": {
                    "documentId": document_id,
                    "participantDocumentId": participant_id,
                },
            })
        return items

    def _relationship_multiwheel_state(
        self,
        session: Optional[dict],
    ) -> tuple[list, list[bool], list, bool]:
        """Active source charts for a three/four-person synastry wheel.

        Composite mode continues to draw the one calculated composite. When
        Composite is unchecked, the same participant truth supplies a direct
        multi-wheel synastry without extracting synthetic workspace tabs.
        """
        if (
            not isinstance(session, dict)
            or session.get("compound_kind") != "synastry"
        ):
            return [], [], [], False
        participants = self._relationship_session_all_participants(session)
        if len(participants) < 3:
            return participants, [], [], False
        states = self._relationship_session_participant_states(session)
        active = [
            participant
            for index, participant in enumerate(participants)
            if index < len(states) and states[index]
        ]
        if "relationship_multiwheel_enabled" not in session:
            session["relationship_multiwheel_enabled"] = bool(
                3 <= len(active) <= chart_rings.CHART_RING_COUNT_MAX
            )
        enabled = bool(session.get("relationship_multiwheel_enabled", False))
        if not (enabled and 3 <= len(active) <= chart_rings.CHART_RING_COUNT_MAX):
            session.pop("relationship_multiwheel_single_chart_view", None)
        return participants, states, active, enabled

    def _relationship_multiwheel_charts(self, session: Optional[dict]) -> list:
        _participants, _states, active, enabled = self._relationship_multiwheel_state(
            session
        )
        if enabled and 3 <= len(active) <= chart_rings.CHART_RING_COUNT_MAX:
            return active
        return []

    def _relationship_multiwheel_menu_items(
        self,
        document_id: str,
        session: dict,
    ) -> list[dict]:
        participants, states, active, enabled = self._relationship_multiwheel_state(
            session
        )
        if len(participants) < 3:
            return []
        drawable = 3 <= len(active) <= chart_rings.CHART_RING_COUNT_MAX
        numerals_by_identity = (
            {
                id(participant): identity["numeral"]
                for participant, identity in zip(
                    active,
                    chart_rings.multiwheel_ring_taxonomy(len(active)),
                )
            }
            if enabled and drawable
            else {}
        )
        items: list[dict] = [{
            "type": "checkbox",
            "label": "Multi-wheel",
            "checked": enabled,
            "disabled": not enabled and not drawable,
            "actionId": "workspace.set_multiwheel_enabled",
            "payload": {"documentId": document_id, "enabled": not enabled},
        }]
        for index, participant in enumerate(participants):
            checked = bool(states[index]) if index < len(states) else True
            label = self._chart_label(participant, "Untitled")
            numeral = numerals_by_identity.get(id(participant))
            if numeral:
                label = f"{numeral} {label}"
            items.append({
                "type": "checkbox",
                "label": label,
                "checked": checked,
                "inset": True,
                "disabled": checked and len(active) == 1,
                "actionId": "workspace.toggle_relationship_participant",
                "payload": {
                    "documentId": document_id,
                    "participantIndex": index,
                },
            })
        return items

    def set_multiwheel_enabled(self, document_id: str, enabled: bool) -> dict:
        with self._lock:
            doc_id = str(document_id or "")
            session = self._controller.session(doc_id)
            participants, states, active, _relationship_enabled = (
                self._relationship_multiwheel_state(session)
            )
            if len(participants) >= 3:
                target = bool(enabled)
                if target and not (
                    3 <= len(active) <= chart_rings.CHART_RING_COUNT_MAX
                ):
                    raise ValueError(
                        "multi-wheel needs three or four active participants"
                    )
                session["relationship_multiwheel_enabled"] = target
                session.pop("relationship_multiwheel_single_chart_view", None)
                result = {
                    "ok": True,
                    "documentId": doc_id,
                    "activeDocumentId": self._controller.active_document_id(),
                    "multiwheelEnabled": target,
                    "participantStates": states,
                    "activeParticipantCount": len(active),
                    "chart_ring_count": len(active) if target else 2,
                    "ringOwnerDocumentId": doc_id,
                    "documents": self._tree_payload(),
                }
                self._attach_full_snapshot(
                    result, doc_id, overlay_render_mode="full",
                )
                self._broadcast_session_changed(doc_id, "display-overlay")
                return result
            owner_id, owner, eligible, selected, _current = (
                self._reconcile_multiwheel_state(doc_id)
            )
            if owner is None:
                raise ValueError(f"unknown ring owner {owner_id!r}")
            target = bool(enabled)
            if target:
                if len(eligible) < 3:
                    raise ValueError("multi-wheel needs at least three charts")
                owner["multiwheel_participant_ids"] = selected
            owner["multiwheel_enabled"] = target
            owner["multiwheel_auto_armed"] = False
            owner["chart_ring_count"] = len(selected) if target and len(selected) >= 3 else 2
            if not target:
                owner.pop("multiwheel_cursor_datetime", None)
                owner.pop("multiwheel_initial_cursor_datetime", None)
                owner.pop("multiwheel_single_chart_view", None)
            return self._multiwheel_presentation_result(doc_id, owner_id, owner)

    def toggle_multiwheel_participant(
        self,
        document_id: str,
        participant_document_id: str,
    ) -> dict:
        with self._lock:
            doc_id = str(document_id or "")
            participant_id = str(participant_document_id or "")
            owner_id, owner, eligible, selected, enabled = (
                self._reconcile_multiwheel_state(doc_id)
            )
            if owner is None:
                raise ValueError(f"unknown ring owner {owner_id!r}")
            if participant_id not in eligible:
                raise ValueError("chart is not available to this multi-wheel")
            if participant_id in selected:
                selected = [value for value in selected if value != participant_id]
            else:
                if len(selected) >= chart_rings.CHART_RING_COUNT_MAX:
                    raise ValueError("multi-wheel supports at most four charts")
                selected.append(participant_id)
                selected = chart_rings.normalize_multiwheel_participant_ids(
                    selected, eligible,
                )
            owner["multiwheel_participant_ids"] = selected
            owner["multiwheel_enabled"] = enabled
            owner["multiwheel_auto_armed"] = False
            owner["chart_ring_count"] = len(selected) if enabled and len(selected) >= 3 else 2
            return self._multiwheel_presentation_result(doc_id, owner_id, owner)

    def _multiwheel_presentation_result(
        self,
        document_id: str,
        owner_id: str,
        owner: dict,
    ) -> dict:
        selected = list(owner.get("multiwheel_participant_ids") or [])
        result = {
            "ok": True,
            "documentId": document_id,
            "activeDocumentId": self._controller.active_document_id(),
            "multiwheelEnabled": bool(owner.get("multiwheel_enabled", False)),
            "multiwheelParticipantIds": selected,
            "chart_ring_count": int(owner.get("chart_ring_count", 2) or 2),
            "ringOwnerDocumentId": owner_id,
            "documents": self._tree_payload(),
        }
        self._attach_full_snapshot(result, document_id, overlay_render_mode="full")
        self._broadcast_session_changed(document_id, "display-overlay")
        return result

    def set_chart_ring_count(self, document_id: str, ring_count: int) -> dict:
        """Compatibility door for callers predating explicit participants."""
        requested = chart_rings.normalize_ring_count(
            ring_count, chart_rings.chart_ring_count(options_service.options))
        if requested <= 2:
            return self.set_multiwheel_enabled(document_id, False)
        with self._lock:
            doc_id = str(document_id or "")
            owner_id, owner, eligible, _selected, _enabled = (
                self._reconcile_multiwheel_state(doc_id)
            )
            if owner is None:
                raise ValueError(f"unknown ring owner {owner_id!r}")
            selected = eligible[:min(requested, chart_rings.CHART_RING_COUNT_MAX)]
            owner["multiwheel_participant_ids"] = selected
            owner["multiwheel_enabled"] = len(selected) >= 3
            owner["multiwheel_auto_armed"] = False
            owner["chart_ring_count"] = len(selected) if len(selected) >= 3 else 2
            return self._multiwheel_presentation_result(doc_id, owner_id, owner)

    def _profections_mode_menu(self) -> dict:
        """Profection chart motion radio (the wx ProfectionsWnd Zodiacal/Placidian
        submenu, profectionswnd.py:48-60, plus the Aries sign/continuous toggle).

        "By sign" = the chart jumps one sign per completed solar year.
        "Continuous" = the ~30deg/yr Profections.offs rotation.
        """
        opts = options_service.options
        whole_sign = bool(getattr(opts, "profwholesign", True))
        return {
            "type": "submenu",
            "label": "Profections",
            "children": [{
                "type": "radioGroup",
                "value": "bysign" if whole_sign else "continuous",
                "children": [
                    {
                        "type": "radio",
                        "label": "By sign",
                        "value": "bysign",
                        "actionId": "options.set_profection_mode",
                        "payload": {"wholeSign": True},
                    },
                    {
                        "type": "radio",
                        "label": "Continuous",
                        "value": "continuous",
                        "actionId": "options.set_profection_mode",
                        "payload": {"wholeSign": False},
                    },
                ],
            }],
        }

    def _anchor_this_chart_item(self, session: dict) -> dict:
        cs = session.get("chart_session")
        return {
            "type": "checkbox",
            "label": "Anchor to This Chart",
            "checked": bool(cs is not None and getattr(cs, "display_anchor_chart", None) is not None),
            "actionId": "workspace.toggle_anchor_this_chart",
            "payload": {"documentId": session.get("document_id")},
        }

    @staticmethod
    def _supplementary_chart_mode(session: Optional[dict]) -> str:
        if session is not None and session.get("compound_kind") == "composite_from_synastry":
            if session.get("composite_variant", "midpoint") == "davison":
                return "all"
            return "transits_only"
        return "all"

    def _supplementary_chart_allowed(self, kind: str, session: Optional[dict]) -> bool:
        mode = self._supplementary_chart_mode(session)
        if mode == "all":
            return True
        return kind in ("transit", "sun_transit", "exact_transit")

    def _enabled_actions(self, session: Optional[dict]) -> dict:
        """Per-session RUNTIME enabled gate — the wx-free twin of
        morin._workspace_navigation_state (morin.py:10373-10428).

        This is the SESSION gate the desktop sidebar uses to grey actions
        (workspace_shell.py:4010-4014), NOT the manifest's static "is this
        surface built in the daemon" flag. Three inputs, all from session
        state the daemon already holds:
          * has_chart      — this session has a live chart (morin.py:10374);
          * return availability — solar revolution can compute for BC radixes;
            lunar return and solar average still keep the wx BC gate;
          * _supplementary_chart_allowed(kind, session) — per-kind composite
            gate (morin.py:8504-8508, midpoint composites forbid non-transit
            children).
        Keys are the SKIN DISPATCH ids (manifest action ids) so the React
        sidebar can grey a launcher by id without recomputing the gate. Only
        the launchers the daemon can open today are emitted; the same set the
        manifest flags ``enabled`` (built)."""
        cs = session.get("chart_session") if session is not None else None
        live = getattr(cs, "chart", None) if cs is not None else None
        has_chart = live is not None
        radix = getattr(cs, "radix", None) if cs is not None else None
        radix = radix if radix is not None else live
        radix_is_bc = bool(getattr(getattr(radix, "time", None), "bc", False))
        solar_revolution_available = bool(has_chart)
        non_bc_return_available = bool(has_chart and not radix_is_bc)
        allowed = self._supplementary_chart_allowed
        # action_id -> runtime-enabled. Based on the morin dict
        # (morin.py:10382-10425), translated to the skin dispatch ids; Solar
        # Revolution deliberately remains available for BC radixes here.
        return {
            "synastry": has_chart,
            "transits": has_chart and allowed("transit", session),
            "solar-revolution": solar_revolution_available and allowed("solar", session),
            "lunar-revolution": non_bc_return_available and allowed("lunar", session),
            "planetary-return": has_chart and allowed("revolution", session),
            "secondary-progression": has_chart and allowed("secondary", session),
            "tertiary-progression": has_chart and allowed("secondary", session),
            "minor-progression": has_chart and allowed("secondary", session),
            "solar-arc": has_chart and allowed("secondary", session),
            "profections": has_chart and allowed("profections", session),
            "harmonic": has_chart and allowed("secondary", session),
            "solar-average": non_bc_return_available,
            "astrocartography": has_chart,
            "astrolabe": has_chart,
            "astrolog-sphere": has_chart,
            "ephemeris": has_chart,
            "directions": has_chart,
            "transit-search": has_chart,
            "ascensional-transits": has_chart and allowed("exact_transit", session),
        }

    @staticmethod
    def _parallel_transit_available(session: Optional[dict]) -> bool:
        if session is None:
            return False
        cs = session.get("chart_session")
        if cs is None:
            return False
        radix = getattr(cs, "radix", None) or getattr(cs, "chart", None)
        return bool(radix is not None and not getattr(getattr(radix, "time", None), "bc", False))

    @staticmethod
    def _marr_flag_attr_for_session(session: Optional[dict]) -> Optional[str]:
        if not isinstance(session, dict):
            return None
        feature_kind = session.get("supplementary_feature_kind")
        if feature_kind == "solar_return":
            return "revsidereal_marr_solar"
        if feature_kind == "solar_average":
            retained = (session.get("supplementary_binding") or {}).get("retained_state") or {}
            return_kind = WorkspaceService._return_average_kind(
                session.get("return_average_kind") or retained.get("return_average_kind")
            )
            if return_kind == solaraverage.RETURN_AVERAGE_LUNAR:
                return "revsidereal_marr_lunar"
            return "revsidereal_marr_solar"
        if feature_kind == "lunar_return":
            return "revsidereal_marr_lunar"
        if feature_kind == "planetary_return":
            return "revsidereal_marr_planet"
        return None

    def _toggle_marr_sidereal_return(self, document_id: str) -> dict:
        session = self._controller.session(document_id)
        if session is None:
            raise ValueError(f"unknown document {document_id!r}")
        attr = self._marr_flag_attr_for_session(session)
        if attr is None:
            raise ValueError("document is not a return session")
        if session.get("supplementary_feature_kind") == "solar_return":
            return self._toggle_return_calculation_mode(document_id, "marr_sidereal")
        # PER-DOCUMENT toggle (policy-chart-lifecycle decision):
        # flip the return's binding flag and rebuild only this session. The
        # global option (Settings > Revolutions) is NOT written — it stays the
        # default for newly opened returns. Previously this wrote the global
        # via set_revolutions_scoped, so other open returns silently flipped
        # on their next refresh.
        binding = dict(session.get("supplementary_binding") or {})
        retained = dict(binding.get("retained_state") or {})
        current = retained.get("marr_sidereal")
        if current is None:
            current = getattr(options_service.options, attr, False)
        retained["marr_sidereal"] = not bool(current)
        binding["retained_state"] = retained
        session["supplementary_binding"] = binding
        rebuilt = self._rebuild_return_session_in_place(session)
        refreshed_ids = [document_id] if rebuilt else []
        self.broadcast_options_changed(refreshed_ids)
        return {
            "ok": True,
            "rebuilt": rebuilt,
            "refreshedDocumentIds": refreshed_ids,
            "activeDocumentId": self._controller.active_document_id(),
            "documents": self._tree_payload(),
        }

    def _toggle_converse_transit(self, document_id: str) -> dict:
        """Flip any transit session at its current symbolic/civil cursor."""
        session = self._controller.session(document_id)
        if session is None:
            raise ValueError(f"unknown document {document_id!r}")
        feature_kind = session.get("supplementary_feature_kind")
        if feature_kind not in {"transits", "converse_transits"}:
            raise ValueError("document is not a transit session")
        cs = session.get("chart_session")
        radix = getattr(cs, "radix", None) if cs is not None else None
        current_chart = getattr(cs, "chart", None) if cs is not None else None
        current_dt = _display_to_datetime(
            getattr(cs, "display_datetime", None) if cs is not None else None
        )
        if cs is None or radix is None or current_chart is None or current_dt is None:
            raise ValueError("transit session has no current cursor")

        binding_payload = copy.deepcopy(session.get("supplementary_binding") or {})
        retained = dict(binding_payload.get("retained_state") or {})
        converse_enabled = not self._converse_transit_enabled(session)
        retained["converse_enabled"] = converse_enabled
        current_tuple = _datetime_to_display(current_dt)
        retained["display_datetime"] = current_tuple
        retained["symbolic_cursor_datetime"] = current_tuple
        if feature_kind == "transits":
            current_time = getattr(current_chart, "time", None)
            current_place = getattr(current_chart, "place", None)
            if current_time is None or current_place is None:
                raise ValueError("transit session has no time context")
            clock_context = {
                "place_payload": supplementary_adapter.place_to_payload(current_place),
                "cal": int(current_time.cal),
                "zt": int(current_time.zt),
                "plus": bool(current_time.plus),
                "zh": int(current_time.zh),
                "zm": int(current_time.zm),
                "daylight": bool(current_time.daylightsaving),
                "tzid": str(getattr(current_time, "tzid", "") or ""),
                "tzauto": bool(getattr(current_time, "tzauto", False)),
            }
            for prefix in ("symbolic", "physical"):
                for key, value in clock_context.items():
                    retained[f"{prefix}_{key}"] = value
            try:
                symbolic_jd = float(getattr(cs, "cursor_jd", current_time.jd))
            except (TypeError, ValueError):
                symbolic_jd = float(current_time.jd)
            if math.isfinite(symbolic_jd):
                retained["symbolic_cursor_jd"] = symbolic_jd

            document = self._controller.state.find_document(document_id)
            direct_title = str(
                getattr(document, "title", "")
                or session.get("custom_title_root")
                or session.get("base_title")
                or ""
            ).strip()
            session["transit_direct_title"] = direct_title
            session["transit_direct_timed_event_title"] = bool(
                session.get("timed_event_title", False)
            )
        binding_payload["feature_kind"] = "converse_transits"
        binding_payload["parent_source_datetime"] = current_tuple
        binding_payload["retained_state"] = retained

        built = supplementary_service.build_result(
            radix=radix,
            kind="converse-transits",
            when=current_dt,
            binding_payload=binding_payload,
        )
        derived_chart = built.get("chart")
        binding = built.get("binding")
        if derived_chart is None or binding is None:
            raise RuntimeError("could not rebuild converse-transit session")

        derived_chart.name = getattr(current_chart, "name", derived_chart.name)
        derived_chart.male = getattr(current_chart, "male", derived_chart.male)
        derived_chart.notes = getattr(current_chart, "notes", "")
        binding.parent_source_datetime = current_tuple
        self._controller._apply_supplementary_binding(session, binding)
        session["chart"] = derived_chart
        if converse_enabled:
            session["timed_event_title"] = False
            title = mtexts.txts.get("ConverseTransits", "Converse Transits")
        else:
            restore_timed_title = bool(
                session.get("transit_direct_timed_event_title", False)
            )
            restored_title = str(session.get("transit_direct_title") or "").strip()
            session["timed_event_title"] = restore_timed_title
            title = (
                restored_title
                if restore_timed_title and restored_title
                else mtexts.txts.get("Transits", "Transits")
            )
        self._update_document_title(
            session,
            title,
            str(session.get("custom_subtitle") or ""),
        )
        cs.navigation_title_label = title
        cs._initial_chart = derived_chart
        cs._initial_display_datetime = built["display_datetime"]
        cs.change_chart(
            derived_chart,
            display_datetime=built["display_datetime"],
            change_reason="options",
        )
        retained_result = dict(getattr(binding, "retained_state", {}) or {})
        self._controller._sync_converse_symbolic_cursor_jd(cs, retained_result)
        cs._stepper = SupplementaryStepper(
            controller=self._controller,
            session=session,
            cs=cs,
            radix=radix,
            feature_kind="converse_transits",
        )
        self._save_restore_open_charts_state()
        result = {
            "ok": True,
            "rebuilt": True,
            "documentId": document_id,
            "activeDocumentId": self._controller.active_document_id(),
            "converseEnabled": converse_enabled,
            "documents": self._tree_payload(),
        }
        return self._attach_full_snapshot(
            result,
            document_id,
            overlay_render_mode="full",
        )

    def _set_lunar_return_mode(self, document_id: str, mode: Any) -> dict:
        session = self._controller.session(document_id)
        if session is None:
            raise ValueError(f"unknown document {document_id!r}")
        if session.get("supplementary_feature_kind") != "lunar_return":
            raise ValueError("document is not a lunar return session")
        normalized = solilunar.normalize_return_mode(mode)
        binding = dict(session.get("supplementary_binding") or {})
        retained = dict(binding.get("retained_state") or {})
        current = solilunar.normalize_return_mode(retained.get("lunar_return_mode"))
        retained["lunar_return_mode"] = normalized
        if current != normalized:
            retained["lunar_cycle_offset"] = 0
            if normalized == solilunar.RETURN_MODE_JONAS_ARC:
                retained["jonas_arc_anchor_branch"] = solilunar.RETURN_BRANCH_MIRROR
            else:
                retained.pop("jonas_arc_anchor_branch", None)
                retained.pop("jonas_arc_branch", None)
                retained.pop("jonas_arc_target_phase", None)
        binding["retained_state"] = retained
        session["supplementary_binding"] = binding
        rebuilt = self._rebuild_return_session_in_place(session, preserve_return_cycle=(current == normalized))
        refreshed_ids = [document_id] if rebuilt else []
        self.broadcast_options_changed(refreshed_ids)
        return {
            "ok": True,
            "rebuilt": rebuilt,
            "refreshedDocumentIds": refreshed_ids,
            "activeDocumentId": self._controller.active_document_id(),
            "documents": self._tree_payload(),
        }

    def _toggle_return_calculation_mode(self, document_id: str, mode: Any) -> dict:
        session = self._controller.session(document_id)
        if session is None:
            raise ValueError(f"unknown document {document_id!r}")
        requested = str(mode or "").strip().lower()
        current = self._return_calculation_mode_value(session)
        target = "standard" if current == requested else requested
        return self._set_return_calculation_mode(document_id, target)

    def _set_return_calculation_mode(self, document_id: str, mode: Any) -> dict:
        session = self._controller.session(document_id)
        if session is None:
            raise ValueError(f"unknown document {document_id!r}")
        attr = self._marr_flag_attr_for_session(session)
        if attr is None:
            raise ValueError("document is not a return session")

        old_mode = self._return_calculation_mode_value(session)
        requested = str(mode or "").strip().lower()
        binding = dict(session.get("supplementary_binding") or {})
        retained = dict(binding.get("retained_state") or {})

        feature_kind = session.get("supplementary_feature_kind")
        if feature_kind == "lunar_return":
            lunar_mode = solilunar.normalize_return_mode(requested)
            if requested == "marr_sidereal":
                retained["marr_sidereal"] = True
                retained["lunar_return_mode"] = solilunar.RETURN_MODE_LUNAR
                retained.pop("jonas_arc_anchor_branch", None)
                retained.pop("jonas_arc_branch", None)
                retained.pop("jonas_arc_target_phase", None)
            elif lunar_mode in (solilunar.RETURN_MODE_SOLILUNAR, solilunar.RETURN_MODE_JONAS_ARC):
                retained["marr_sidereal"] = False
                retained["lunar_return_mode"] = lunar_mode
                if old_mode != solilunar.RETURN_MODE_JONAS_ARC and lunar_mode == solilunar.RETURN_MODE_JONAS_ARC:
                    retained["jonas_arc_anchor_branch"] = solilunar.RETURN_BRANCH_MIRROR
                else:
                    retained.pop("jonas_arc_anchor_branch", None)
                if lunar_mode != solilunar.RETURN_MODE_JONAS_ARC:
                    retained.pop("jonas_arc_branch", None)
                    retained.pop("jonas_arc_target_phase", None)
            else:
                retained["marr_sidereal"] = False
                retained["lunar_return_mode"] = solilunar.RETURN_MODE_LUNAR
                retained.pop("jonas_arc_anchor_branch", None)
                retained.pop("jonas_arc_branch", None)
                retained.pop("jonas_arc_target_phase", None)
        elif feature_kind == "solar_return":
            if requested == solilunar.RETURN_MODE_TITHI_PRAVESHA:
                retained["marr_sidereal"] = False
                retained["solar_return_mode"] = solilunar.RETURN_MODE_TITHI_PRAVESHA
            else:
                retained["marr_sidereal"] = requested == "marr_sidereal"
                retained["solar_return_mode"] = "standard"
        else:
            retained["marr_sidereal"] = requested == "marr_sidereal"

        new_mode = self._return_calculation_mode_value({
            **session,
            "supplementary_binding": {
                **binding,
                "retained_state": retained,
            },
        })
        if old_mode != new_mode:
            retained["lunar_cycle_offset"] = 0 if session.get("supplementary_feature_kind") == "lunar_return" else retained.get("lunar_cycle_offset", 0)
            if feature_kind == "solar_return":
                retained["solar_degree_offset"] = 0

        binding["retained_state"] = retained
        session["supplementary_binding"] = binding
        preserve_return_cycle = True
        if session.get("supplementary_feature_kind") == "lunar_return":
            preserve_return_cycle = old_mode in ("standard", "marr_sidereal") and new_mode in ("standard", "marr_sidereal")
        rebuilt = self._rebuild_return_session_in_place(session, preserve_return_cycle=preserve_return_cycle)
        refreshed_ids = [document_id] if rebuilt else []
        self.broadcast_options_changed(refreshed_ids)
        return {
            "ok": True,
            "rebuilt": rebuilt,
            "refreshedDocumentIds": refreshed_ids,
            "activeDocumentId": self._controller.active_document_id(),
            "documents": self._tree_payload(),
        }

    def _rebuild_return_session_in_place(self, session: dict, *, preserve_return_cycle: bool = True) -> bool:
        feature_kind = session.get("supplementary_feature_kind")
        if feature_kind not in ("solar_return", "solar_average", "lunar_return", "planetary_return"):
            return False
        cs = session.get("chart_session")
        if cs is None or getattr(cs, "chart", None) is None:
            return False
        base_chart = getattr(cs, "radix", None)
        if base_chart is None:
            parent_session = self._controller.session(session.get("parent_document_id"))
            parent_cs = parent_session.get("chart_session") if parent_session else None
            base_chart = (
                getattr(parent_cs, "radix", None)
                or getattr(parent_cs, "chart", None)
                if parent_cs is not None else None
            )
        if base_chart is None:
            return False

        current_dt = _display_to_datetime(getattr(cs, "display_datetime", None))
        if current_dt is None:
            current_time = getattr(getattr(cs, "chart", None), "time", None)
            try:
                current_dt = datetime.datetime(
                    int(current_time.year), int(current_time.month), int(current_time.day),
                    int(current_time.hour), int(current_time.minute), int(current_time.second),
                )
            except Exception:
                current_dt = None
        if current_dt is None:
            return False

        source_dt = current_dt
        if feature_kind == "lunar_return":
            source_dt = current_dt + datetime.timedelta(days=2)
        elif feature_kind == "planetary_return":
            source_dt = current_dt + datetime.timedelta(days=30)

        adapter = self._controller._registry.adapter_for_feature_kind(feature_kind)
        if adapter is None:
            return False
        driver = self._controller._driver_for_session(session)
        driver.horoscope = base_chart
        try:
            binding = adapter.capture_binding(
                driver,
                session=session,
                current_chart=getattr(cs, "chart", None),
                feature_kind=feature_kind,
            )
            driver_state = supplementary_adapter.SupplementaryDriverState(
                base_chart=base_chart,
                source_datetime=source_dt,
                chart_session=cs,
                runtime_radix=base_chart,
                source_display_datetime=_datetime_to_display(source_dt),
                # In-place rebuild: keep the SAME return cycle/year — only the
                # computation mode (e.g. the per-document Marr flag) changed.
                # Without this the solar build re-derives the anchor year from
                # the child's own cursor (just before the birthday) and the SR
                # regresses one year per toggle.
                preserve_return_cycle=bool(preserve_return_cycle),
            )
            result = adapter.build(
                driver,
                driver_state,
                binding,
                current_chart=getattr(cs, "chart", None),
                session=session,
            )
        except Exception:
            import traceback
            print("[rebuild-return] build failed:", traceback.format_exc(), file=sys.stderr)
            return False
        if result is None or result.chart is None or result.display_datetime is None:
            return False

        persisted_source_dt = source_dt
        retained_state = dict(getattr(result.binding, "retained_state", {}) or {})
        if feature_kind in ("lunar_return", "planetary_return"):
            raw_return_dt = _display_to_datetime(retained_state.get("raw_return_datetime"))
            if raw_return_dt is not None:
                cushion_days = 2 if feature_kind == "lunar_return" else 30
                persisted_source_dt = raw_return_dt + datetime.timedelta(days=cushion_days)
        result.binding.parent_source_datetime = _datetime_to_display(persisted_source_dt)
        self._controller._apply_supplementary_binding(session, result.binding)
        session["chart"] = result.chart
        try:
            cs._initial_chart = result.chart
            cs._initial_display_datetime = result.display_datetime
        except Exception:
            pass
        cs.change_chart(result.chart, display_datetime=result.display_datetime, change_reason="options")
        cs._stepper = SupplementaryStepper(
            controller=self._controller,
            session=session,
            cs=cs,
            radix=base_chart,
            feature_kind=feature_kind,
        )
        return True

    @staticmethod
    def _is_root_radix_step_session(session: Optional[dict], cs) -> bool:
        if session is None or cs is None:
            return False
        if session.get('parent_document_id') is not None:
            return False
        if (
            session.get('supplementary_feature_kind') is not None
            or session.get('launcher_kind') is not None
            or session.get('compound_kind') is not None
        ):
            return False
        chrt = getattr(cs, 'chart', None) or session.get('chart') or getattr(cs, 'radix', None)
        return getattr(chrt, 'htype', None) == export_chart_json.chart_mod.Chart.RADIX

    def _ensure_root_radix_step_session(self, session: Optional[dict]):
        """Install DirtyRadixSession semantics for file-backed radix stepping.

        Older restored/open sessions can still be plain ChartSession instances.
        Before stepping, promote them so change_chart updates the radix anchor
        first; child rebuilds, editor seed, dirty marker, and Save all then read
        the same stepped chart.
        """
        cs = session.get('chart_session') if session is not None else None
        if not self._is_root_radix_step_session(session, cs):
            return cs
        if isinstance(cs, horary_session.DirtyRadixSession):
            return cs
        chrt = getattr(cs, 'chart', None) or session.get('chart') or getattr(cs, 'radix', None)
        if chrt is None:
            return cs
        document_id = str(session.get('document_id') or '')
        promoted = horary_session.DirtyRadixSession(
            chrt,
            chart_snapshot_service.options,
            on_change=self._controller.on_session_change,
            on_step_dirty_change=(
                lambda dirty, _id=document_id: self._controller.set_dirty(_id, step_dirty=bool(dirty))
            ),
            display_datetime=getattr(cs, 'display_datetime', None),
        )
        for attr in (
            '_initial_chart',
            '_initial_display_datetime',
            '_initial_cursor_jd',
            '_launch_with_wall_clock_when_unset',
        ):
            if hasattr(cs, attr):
                try:
                    setattr(promoted, attr, getattr(cs, attr))
                except Exception:
                    pass
        promoted.view_mode = getattr(cs, 'view_mode', promoted.view_mode)
        promoted.display_anchor_chart = getattr(
            cs, 'display_anchor_chart', getattr(promoted, 'display_anchor_chart', None)
        )
        promoted._comparison_toggle_handler = getattr(cs, '_comparison_toggle_handler', None)
        promoted.navigation_units = getattr(cs, 'navigation_units', None) or promoted.navigation_units
        promoted.navigation_title_label = getattr(cs, 'navigation_title_label', None)
        session['chart_session'] = promoted
        session['chart'] = chrt
        was_dirty = bool(session.get('dirty', False))
        try:
            promoted._refresh_step_dirty()
        except Exception:
            pass
        if bool(session.get('dirty', False)) != was_dirty:
            self._broadcast_document_patch(document_id)
        return promoted

    def _clear_rectification_dirty_if_reset(self, document_id: str, session: Optional[dict], cs) -> None:
        if session is None or cs is None or not session.get('rectification_dirty'):
            return
        if getattr(cs, 'chart', None) is not getattr(cs, '_initial_chart', None):
            return
        session.pop('rectification_dirty', None)
        self._controller.set_dirty(document_id, edit_dirty=False, step_dirty=False)

    def _broadcast_session_changed(
        self,
        document_id: str,
        reason: str,
        *,
        rebuilt_child_ids: Optional[Sequence[str]] = None,
    ) -> None:
        session = self._controller.session(document_id)
        cs = session.get("chart_session") if session is not None else None
        display_dt = _display_tuple_to_iso(getattr(cs, "display_datetime", None)) if cs is not None else None
        self._manager.broadcast_threadsafe({
            "type": "session.changed",
            "docId": document_id,
            "changeReason": reason,
            "isActive": document_id == self._controller.active_document_id(),
            "rebuiltChildIds": list(rebuilt_child_ids or []),
            "displayDatetime": display_dt,
        })

    def _broadcast_document_patch(self, document_id: str) -> None:
        document = self._controller.state.find_document(document_id)
        session = self._controller.session(document_id) or {}
        if document is None:
            return
        self._manager.broadcast_threadsafe({
            "type": "document.changed",
            "docId": document_id,
            "title": document.title,
            "dirty": bool(session.get('dirty', False)),
            "editDirty": bool(session.get('edit_dirty', False)),
            "stepDirty": bool(session.get('step_dirty', False)),
        })

    @staticmethod
    def _strip_redundant_separators(items: list[dict]) -> list[dict]:
        out: list[dict] = []
        for item in items:
            if item.get("type") == "separator":
                if not out or out[-1].get("type") == "separator":
                    continue
            out.append(item)
        while out and out[-1].get("type") == "separator":
            out.pop()
        return out

    def _select_render_charts(self, session, cs, live):
        """Map a live ChartSession to its (inner, outer) render pair.

        The inner/outer mapping follows the LIVE ``ChartSession.view_mode``
        contract from wx — the single source of truth for both the render path
        (``document_snapshot``) and the hover-inspector path
        (``inspector_charts``), so a hovered region is built over exactly the
        chart(s) the wheel is drawing. Returns ``(primary, comparison)`` where
        ``comparison`` is the outer ring (or ``None`` for a singleton).
        """
        radix = getattr(cs, 'radix', None)
        feature_kind = session.get('supplementary_feature_kind')
        view_mode = getattr(cs, 'view_mode', 0)
        is_compound = view_mode == chart_session.ChartSession.COMPOUND
        comparison = None
        child_anchor = self._controller.comparison_anchor_for_session(session)
        if (
            (feature_kind is not None or session.get('launcher_kind') == 'transits')
            and radix is not None
            and live is not radix
        ):
            # Derived child (progression / return / transit). Wx opens some
            # of these as CHART singletons (e.g. Solar Return) and others as
            # COMPOUND biwheels (e.g. Transits); the live ChartSession
            # view_mode is the source of truth for which chart is visible.
            # In COMPOUND, the inner ring is the immediate parent node, while
            # ``radix`` stays the branch/calculation identity.
            if is_compound:
                primary = child_anchor or radix
                comparison = live
            else:
                primary = live
                comparison = None
        elif is_compound and child_anchor is not None and child_anchor is not live:
            # Non-supplementary hierarchical chart sessions (for example
            # drag-created transit children) follow the same Antikythera parent
            # anchor rule as derived children.
            primary = child_anchor
            comparison = live
        elif is_compound:
            # Synastry / explicit comparison doc: COMPOUND shows the stored
            # partner as the outer ring; TAB (-> CHART) drops to singleton.
            primary = live
            comparison = session.get('comparison_chart')
        else:
            primary = live
        return primary, comparison

    def _ring_chart_for_document(self, document_id: Optional[str]):
        """The live chart a ring document contributes, or None.

        Same accessor as ``_comparison_chart_for_parent``
        (engine/workspace_session_controller.py:252): the session's live
        ChartSession chart, falling back to its stored chart. View-only
        documents (tables, astrocart) return None and are never rings.
        """
        if not document_id:
            return None
        session = self._controller.session(document_id)
        if session is None:
            return None
        cs = session.get("chart_session")
        if cs is not None:
            chrt = getattr(cs, "chart", None)
            if chrt is not None:
                return chrt
        return session.get("chart")

    @staticmethod
    def _ring_zodiac() -> str:
        """Global Appearance setting; multi-wheel sessions do not override it."""
        return chart_rings.chart_ring_zodiac(options_service.options)

    def _resolve_wheel_charts(self, session, cs, live):
        """``(primary, comparison, ring_charts)`` for one live session.

        ``primary`` is always the framework chart — the one whose houses,
        zodiac orientation and angles the wheel is drawn on — and
        ``comparison`` the outermost body ring. At two rings that is the
        established ``_select_render_charts`` pair verbatim. At three or more
        it is ring 1 and ring N, so ``primaryChart``/``comparisonChart`` keep
        meaning exactly what every existing consumer already assumes.

        ``document_snapshot`` and ``inspector_charts`` share this so a hovered
        region is built over exactly the charts the wheel is drawing.
        """
        ring_charts = self._select_ring_charts(session, cs, live)
        if len(ring_charts) >= 3:
            if bool(session.get("relationship_multiwheel_single_chart_view")):
                return live, None, [live]
            document_id = str(session.get("document_id") or "")
            _owner_id, owner = self._ring_owner(document_id)
            if owner is not None and bool(owner.get("multiwheel_single_chart_view")):
                return live, None, [live]
            return ring_charts[0], ring_charts[-1], ring_charts
        primary, comparison = self._select_render_charts(session, cs, live)
        return primary, comparison, ring_charts

    def _select_ring_charts(self, session, cs, live) -> list:
        """Ordered ring charts for a document, innermost first.

        Two rings remains the established per-document comparison contract.
        Three or more rings is the root-owned explicit participant selection:
        selecting another tab changes only navigation grammar, never membership.
        """
        primary, comparison = self._select_render_charts(session, cs, live)
        base = [primary] if comparison is None else [primary, comparison]
        if not isinstance(session, dict):
            return base
        relationship_charts = self._relationship_multiwheel_charts(session)
        if len(relationship_charts) >= 3:
            return relationship_charts
        if session.get("compound_kind") is not None:
            return base
        document_id = session.get("document_id")
        ring_ids = self._multiwheel_participant_ids(str(document_id or ""))
        if len(ring_ids) < 3:
            return base

        charts = []
        for ring_id in ring_ids:
            chrt = self._ring_chart_for_document(ring_id)
            if chrt is None:
                continue
            # The same chart object reaching two rings would paint one ring
            # twice; keep the outermost occurrence only.
            if any(chrt is existing for existing in charts):
                continue
            charts.append(chrt)
        if len(charts) < 3:
            return base
        return charts

    def _multiwheel_ring_display_datetimes(
        self,
        document_id: str,
        ring_charts: list,
    ) -> list[Optional[tuple]]:
        """Return each visible ring's canonical session cursor in ring order.

        A derived chart's computational time can intentionally differ from its
        real/signified cursor. Corner metadata must therefore follow the owning
        ChartSession rather than formatting the chart Time object again.
        """
        if len(ring_charts) < 3:
            return []
        session = self._controller.session(document_id)
        relationship_charts = self._relationship_multiwheel_charts(session)
        if len(relationship_charts) == len(ring_charts) and all(
            expected is actual
            for expected, actual in zip(relationship_charts, ring_charts)
        ):
            # Each source chart already exports its own canonical radix date.
            return [None] * len(ring_charts)
        ring_ids = self._multiwheel_participant_ids(document_id)
        cursors_by_chart_identity: dict[int, Optional[tuple]] = {}
        for ring_id in ring_ids:
            ring_chart = self._ring_chart_for_document(ring_id)
            ring_session = self._controller.session(ring_id)
            ring_cs = ring_session.get('chart_session') if ring_session is not None else None
            if ring_chart is not None:
                cursors_by_chart_identity[id(ring_chart)] = copy.deepcopy(
                    getattr(ring_cs, 'display_datetime', None)
                )
        return [cursors_by_chart_identity.get(id(chrt)) for chrt in ring_charts]

    def _multiwheel_ring_document_ids(
        self,
        document_id: str,
        ring_charts: list,
    ) -> list[Optional[str]]:
        """Map the visible chart objects back to their selected documents."""
        session = self._controller.session(document_id)
        relationship_charts = self._relationship_multiwheel_charts(session)
        if len(relationship_charts) == len(ring_charts) and all(
            expected is actual
            for expected, actual in zip(relationship_charts, ring_charts)
        ):
            return [None] * len(ring_charts)
        ids_by_chart_identity: dict[int, str] = {}
        for ring_id in self._multiwheel_participant_ids(document_id):
            ring_chart = self._ring_chart_for_document(ring_id)
            if ring_chart is not None:
                ids_by_chart_identity[id(ring_chart)] = ring_id
        return [ids_by_chart_identity.get(id(chrt)) for chrt in ring_charts]

    @staticmethod
    def _overlay_display_datetime_for_session(session: dict, cs):
        """Cursor time for overlay rows that depend on radix lineage.

        Lord-of-year intentionally defaults a plain radix chart to "now" when
        no cursor is supplied. Only pass ChartSession.display_datetime for live
        child/current sessions where that cursor is the Antikythera truth.
        """
        if session is None or cs is None:
            return None
        display_dt = getattr(cs, 'display_datetime', None)
        if display_dt is None:
            return None
        if session.get('supplementary_feature_kind') is not None:
            return display_dt
        if session.get('launcher_kind') in ('transits', 'ascensional_transits'):
            return display_dt
        if WorkspaceService._chart_visual_mode(session) == _CHART_VISUAL_AT:
            return display_dt
        if session.get('parallel_transits_enabled'):
            return display_dt
        if isinstance(cs, horary_session.HorarySession):
            return display_dt
        if isinstance(cs, horary_session.DirtyRadixSession) and (
            not session.get('fpath')
            or session.get('edit_dirty')
            or session.get('step_dirty')
        ):
            return display_dt
        initial_dt = getattr(cs, '_initial_display_datetime', None)
        if initial_dt is not None:
            try:
                if tuple(display_dt[:6]) != tuple(initial_dt[:6]):
                    return display_dt
            except Exception:
                return display_dt
        return None

    def _midpoint_composite_corner_lines(self, session: dict, chrt) -> Optional[dict[str, list[str]]]:
        """Wx-style corner labels for midpoint relationship composites.

        Source twin: ``graphchart.py:3575-3595`` draws the source participant
        names in the top-left; ``graphchart.py:3653-3663`` draws ``Composite`` /
        ``(Midpoints)`` in the bottom-left. Keep this in the daemon snapshot so
        React only renders declared lines and never infers relationship truth.
        """
        if not isinstance(session, dict):
            return None
        if session.get('compound_kind') != 'composite_from_synastry':
            return None
        if session.get('composite_variant') not in (None, 'midpoint'):
            return None

        names: list[str] = []
        pair = getattr(chrt, '_composite_source_pair', None)
        if isinstance(pair, (list, tuple)) and len(pair) >= 2:
            names = [self._chart_label(participant, "") for participant in pair[:2]]
        if len([name for name in names if name]) < 2:
            pair = session.get('synastry_pair')
            if isinstance(pair, (list, tuple)) and len(pair) >= 2:
                names = [self._chart_label(participant, "") for participant in pair[:2]]
        if len([name for name in names if name]) < 2:
            participants = self._relationship_session_participants(session)
            names = [self._chart_label(participant, "") for participant in participants[:2]]
        names = [name for name in names if name]
        if not names:
            names = [self._chart_label(chrt, "Composite")]
        return {
            "topLeft": names[:2],
            "bottomLeft": [
                mtexts.txts.get("Composite", "Composite"),
                "(%s)" % mtexts.txts.get("Midpoints", "Midpoints"),
            ],
        }

    def _ensure_midpoint_composite_corner_lines(self, snapshot: dict, session: dict, primary) -> None:
        lines = self._midpoint_composite_corner_lines(session, primary)
        if lines is None:
            return
        primary_slot = snapshot.get('primaryChart')
        meta = primary_slot.get('meta') if isinstance(primary_slot, dict) else None
        if not isinstance(meta, dict):
            return
        corner_lines = meta.get('cornerLines')
        if not isinstance(corner_lines, dict):
            corner_lines = {}
        if not corner_lines.get('topLeft'):
            corner_lines['topLeft'] = lines['topLeft']
        corner_lines['bottomLeft'] = lines['bottomLeft']
        meta['cornerLines'] = corner_lines

    def lens_chart(self, document_id: str):
        """Resolve the chart pack-alert evaluation reads — the wx
        ``_active_workspace_chart`` twin (morin.py:9044-9056).

        wx ``_refresh_pack_alerts`` (morin.py:8972, 8984-8987) always evaluates
        the LIVE session chart (``cs.chart`` — the stepped transit/derived
        chart), never the biwheel inner ring. ``inspector_charts`` maps a
        COMPOUND child to the wheel/hover render pair; evaluating THAT would
        freeze alert cards while the transit ring stepped.
        Returns ``(options, chart)``.
        """
        with self._lock:
            session = self._controller.session(document_id)
            if session is None:
                raise ValueError(f"unknown document {document_id!r}")
            cs = session.get('chart_session')
            live = (getattr(cs, 'chart', None) if cs is not None else None) or session.get('chart')
            if live is None:
                raise ValueError(f"document {document_id!r} has no chart")
            return chart_snapshot_service.options, live

    def inspector_charts(
        self,
        document_id: str,
        ring_index: Optional[int] = None,
    ):
        """Resolve the LIVE (inner, outer) chart pair for a document by id.

        The hover-inspector twin of ``document_snapshot``: it returns the same
        chart objects the wheel is drawing so the inspector/flag/passages
        endpoints build a region over session truth (a live, possibly unsaved or
        derived chart) instead of reloading a chart by name from a .jsonl file —
        which fails for any document that isn't file-backed (``fpath == ""``).
        Returns ``(options, primary, comparison)``.
        """
        with self._lock:
            session = self._controller.session(document_id)
            if session is None:
                raise ValueError(f"unknown document {document_id!r}")
            cs = session.get('chart_session')
            if cs is None:
                raise ValueError(f"document {document_id!r} has no chart session")
            live = cs.chart or session.get('chart')
            if live is None:
                raise ValueError(f"document {document_id!r} has no chart")
            primary, comparison, rings = self._resolve_wheel_charts(session, cs, live)
            if ring_index is not None:
                if len(rings) < 3:
                    raise ValueError("ringIndex requires a multi-wheel document")
                index = int(ring_index)
                if index < 0 or index >= len(rings):
                    raise ValueError(f"ringIndex {index} is outside the visible multi-wheel")
                if index == 0:
                    return chart_snapshot_service.options, rings[0], rings[-1]
                # Preserve the established inspector contract: the requested
                # ring is the comparison partner and chartRole='outer' performs
                # the same swap used by a normal biwheel hover.
                return chart_snapshot_service.options, rings[0], rings[index]
            return chart_snapshot_service.options, primary, comparison

    def inspector_ring_context(
        self,
        document_id: str,
        ring_index: Optional[int],
    ) -> Optional[dict]:
        """Visible I–IV identities for one multi-wheel inspector request."""
        if ring_index is None:
            return None
        with self._lock:
            session = self._controller.session(document_id)
            if session is None:
                raise ValueError(f"unknown document {document_id!r}")
            cs = session.get("chart_session")
            live = (getattr(cs, "chart", None) if cs is not None else None) or session.get("chart")
            if cs is None or live is None:
                return None
            _primary, _comparison, rings = self._resolve_wheel_charts(session, cs, live)
            if len(rings) < 3:
                return None
            index = int(ring_index)
            if index < 0 or index >= len(rings):
                raise ValueError(f"ringIndex {index} is outside the visible multi-wheel")
            taxonomy = chart_rings.multiwheel_ring_taxonomy(len(rings))
            comparison_index = len(rings) - 1 if index == 0 else index
            partner_index = comparison_index if index == 0 else 0
            return {
                "currentNumeral": taxonomy[index]["numeral"],
                "partnerNumeral": taxonomy[partner_index]["numeral"],
                "primaryNumeral": taxonomy[0]["numeral"],
                "comparisonNumeral": taxonomy[comparison_index]["numeral"],
            }

    def inspector_pd_direction_context(self, document_id: str) -> Optional[dict]:
        """Return locked live PD-in-chart truth for marker/inspector queries.

        This remains separate from ``inspector_charts`` so its tuple contract
        stays unchanged for every existing consumer.
        """
        with self._lock:
            session = self._controller.session(document_id)
            if session is None:
                raise ValueError(f"unknown document {document_id!r}")
            if session.get("launcher_kind") != "pd_in_chart":
                return None
            cs = session.get("chart_session")
            if cs is None:
                raise ValueError(f"document {document_id!r} has no chart session")
            live = getattr(cs, "chart", None) or session.get("chart")
            if live is None:
                raise ValueError(f"document {document_id!r} has no chart")
            primary, comparison = self._select_render_charts(session, cs, live)
            return {
                "options": chart_snapshot_service.options,
                "primary": primary,
                "comparison": comparison,
                "state": copy.deepcopy(live._pd_direction_state),
                "overlay": copy.deepcopy(getattr(live, "_pd_event_overlay", None)),
                "binding": copy.deepcopy(session.get("pd_in_chart_binding") or {}),
                "displayDatetime": copy.deepcopy(getattr(cs, "display_datetime", None)),
            }

    def document_snapshot(
        self,
        document_id: str,
        *,
        overlay_render_mode: str = "full",
        include_perf: bool = False,
    ) -> dict:
        """Render a document by id from the LIVE in-memory session — the
        session-truth render path.

        Serializes the actual ``chart_session.chart`` the controller holds and
        has already stepped, instead of reconstructing a chart from
        name+kind+when. This is the keystone of "stupid skin": the frontend
        renders whatever this returns and never rebuilds a chart itself.

        The inner/outer mapping follows the LIVE ``ChartSession.view_mode``
        contract from wx:
          - synastry COMPOUND: center + partner biwheel; CHART: center only;
          - derived child COMPOUND: immediate parent inner + derived outer
            biwheel; CHART: derived singleton;
          - root radix / here-now: primary = the chart, no comparison.
        """
        snapshot_started_at = time.perf_counter()
        perf = {
            "documentId": document_id,
            "overlayRenderMode": overlay_render_mode,
            "phases": [],
        } if include_perf else None

        def mark_phase(name: str, started_at: float) -> None:
            if perf is not None:
                perf["phases"].append({
                    "name": name,
                    "ms": (time.perf_counter() - started_at) * 1000.0,
                })

        lock_wait_started_at = time.perf_counter()
        with self._lock:
            mark_phase("lock_wait", lock_wait_started_at)
            phase_started_at = time.perf_counter()
            session = self._controller.session(document_id)
            if session is None:
                raise ValueError(f"unknown document {document_id!r}")
            cs = session.get('chart_session')
            if cs is None:
                # View-only documents (e.g. astrocart) have no ChartSession; the
                # skin fetches those from their own endpoint (/api/astrocart).
                raise ValueError(f"document {document_id!r} has no chart session")
            live = cs.chart or session.get('chart')
            if live is None:
                raise ValueError(f"document {document_id!r} has no chart")

            radix = getattr(cs, 'radix', None)
            feature_kind = session.get('supplementary_feature_kind')
            view_mode = getattr(cs, 'view_mode', 0)
            primary, comparison, ring_charts = self._resolve_wheel_charts(session, cs, live)
            parallel_transit = (
                self._build_parallel_transit_overlay(cs)
                if comparison is None and session.get('parallel_transits_enabled')
                else None
            )
            overlay_display_dt = self._overlay_display_datetime_for_session(session, cs)
            overlay_cursor_jd = getattr(cs, 'cursor_jd', None) if overlay_display_dt is not None else None
            mark_phase("resolve_session_charts", phase_started_at)

            # Feed the active study's enabled surveil marks onto the primary
            # chart so the already-migrated exporter (export_surveil_marks ->
            # payload.surveilMarks) and renderer (draw-chart.drawSurveilMarks)
            # draw them on the visible wheel (morin.py:1303-1305 active-study
            # marks; graphchart.py:5822 draw). The chart object is session-cached,
            # so the attribute is set just for this export and restored after,
            # never persisting wx-style per-session marks on the chart.
            surveil_marks = self._surveil_store.enabled_marks_for_active_study()
            prev_surveil = getattr(primary, 'surveil_marks', None)
            if surveil_marks:
                primary.surveil_marks = surveil_marks
            phase_started_at = time.perf_counter()
            export_perf = {"phases": []} if include_perf else None
            try:
                snapshot = export_chart_json.export_snapshot(
                    primary,
                    comparison=comparison,
                    radix=radix,
                    anchor=getattr(cs, 'display_anchor_chart', None),
                    overlay_render_mode=overlay_render_mode,
                    overlay_display_datetime=overlay_display_dt,
                    overlay_cursor_jd=overlay_cursor_jd,
                    parallel_transit=parallel_transit,
                    perf=export_perf,
                    rings=ring_charts if len(ring_charts) >= 3 else None,
                )
                if len(ring_charts) >= 3:
                    ring_payloads = snapshot.get('rings') or []
                    ring_display_datetimes = self._multiwheel_ring_display_datetimes(
                        document_id, ring_charts,
                    )
                    ring_document_ids = self._multiwheel_ring_document_ids(
                        document_id, ring_charts,
                    )
                    ring_taxonomy = chart_rings.multiwheel_ring_taxonomy(
                        len(ring_payloads)
                    )
                    for ring_chart, ring_payload, display_dt in zip(
                        ring_charts, ring_payloads, ring_display_datetimes,
                    ):
                        export_chart_json.apply_display_datetime_to_chart_payload(
                            ring_payload,
                            display_dt,
                            bc=bool(getattr(getattr(ring_chart, 'time', None), 'bc', False)),
                            options=chart_snapshot_service.options,
                        )
                    for ring_payload, ring_identity, ring_document_id in zip(
                        ring_payloads, ring_taxonomy, ring_document_ids,
                    ):
                        ring_payload.setdefault('meta', {})['multiwheelRingIndex'] = (
                            ring_identity['ringIndex']
                        )
                        ring_payload['meta']['multiwheelRingNumeral'] = (
                            ring_identity['numeral']
                        )
                        if ring_document_id is not None:
                            ring_identity['documentId'] = ring_document_id
                        ring_identity['chartName'] = str(
                            ring_payload.get('meta', {}).get('name') or ''
                        )
                    snapshot['ringTaxonomy'] = ring_taxonomy
                    # Zodiac position is only meaningful once rings stack:
                    # the two-ring wheel keeps its inherited layout.
                    snapshot['ringZodiac'] = self._ring_zodiac()
                requested_comparison_layout = session.get('comparison_layout')
                if requested_comparison_layout not in ('standard', 'with-houses'):
                    requested_comparison_layout = (
                        'with-houses'
                        if comparison is not None and bool(session.get('compound_kind'))
                        else 'standard'
                    )
                snapshot['comparisonLayout'] = requested_comparison_layout
            finally:
                if surveil_marks:
                    if prev_surveil is None:
                        try:
                            delattr(primary, 'surveil_marks')
                        except AttributeError:
                            primary.surveil_marks = None
                    else:
                        primary.surveil_marks = prev_surveil
            if perf is not None and export_perf is not None:
                perf["export"] = export_perf
            mark_phase("export_snapshot", phase_started_at)

            phase_started_at = time.perf_counter()
            if len(ring_charts) < 3:
                self._ensure_midpoint_composite_corner_lines(snapshot, session, primary)
            mark_phase("midpoint_corner", phase_started_at)
            session_display_dt = getattr(cs, 'display_datetime', None)
            if feature_kind is not None and session_display_dt is not None:
                phase_started_at = time.perf_counter()
                # Derived charts may calculate/store their instant in a
                # GREENWICH Time (returns do this deliberately). Visible chart
                # metadata follows the Aries display rule: local civil time from
                # cs.display_datetime, while footer/status remains free to show
                # the chart Time/UT sanity line.
                derived_slot = (
                    snapshot.get('comparisonChart')
                    if comparison is not None
                    else snapshot.get('primaryChart')
                )
                export_chart_json.apply_display_datetime_to_chart_payload(
                    derived_slot,
                    session_display_dt,
                    bc=bool(getattr(getattr(live, 'time', None), 'bc', False)),
                    options=chart_snapshot_service.options,
                )
                cursor_iso = _display_tuple_to_iso(session_display_dt)
                if cursor_iso is not None:
                    snapshot['displayDatetime'] = cursor_iso
                mark_phase("derived_display_datetime", phase_started_at)
            # The signified-age readout for a progression child, DERIVED from
            # the live chart exactly like the desktop status/context render
            # (morin.py:5529-5565; chart_context_view.py:239-263). None for
            # non-progression documents.
            phase_started_at = time.perf_counter()
            symbolic_readout = self._symbolic_time_readout(session, cs)
            mark_phase("symbolic_time", phase_started_at)
            # The wheel's top-left corner label must show the REAL/meaningful
            # cursor date the desktop draws via drawChartTimeTopLeft
            # (graphchart.py:3562-3638) — which uses cs.display_datetime — NOT the
            # derived chart's raw ephemeris orig date. The general session-time
            # override above covers normal derived charts, including returns.
            # These special kinds need extra label/readout shaping:
            #   * progressions (secondary/solar_arc/minor/tertiary): chart is the
            #     progressed ephemeris chart -> corner shows the SIGNIFIED date;
            #   * profections: chart is built on the RADIX Time -> orig date is the
            #     birth date -> corner must show the PROFECTED real date;
            #   * solar_average: the desktop draws an "Age min - max" label, not a
            #     date (graphchart.py:3564-3573).
            # The derived chart occupies the comparison slot in a biwheel else the
            # primary slot in singleton; React draws the corner from
            # ``comparisonChart ?? primaryChart`` (workspace-content.tsx:372), so
            # override that same slot's display strings.
            corner_override = self._corner_real_date_override(
                session, cs, symbolic_readout)
            if corner_override is not None:
                phase_started_at = time.perf_counter()
                derived_slot = (
                    snapshot.get('comparisonChart')
                    if comparison is not None
                    else snapshot.get('primaryChart')
                )
                meta = derived_slot.get('meta') if isinstance(derived_slot, dict) else None
                if isinstance(meta, dict):
                    date_disp = corner_override.get('dateDisplay')
                    time_disp = corner_override.get('timeDisplay')
                    if date_disp is not None:
                        meta['dateDisplay'] = date_disp
                        # Some kinds (solar_average) have no time line; keep the
                        # existing one rather than blanking the corner.
                        if time_disp is not None:
                            meta['timeDisplay'] = time_disp
                        meta['anchorDisplay'] = (
                            f"{date_disp} {time_disp}" if time_disp is not None
                            else date_disp
                        )
                # A corner override means the derived chart's own ephemeris orig
                # date DIFFERS from the meaningful cursor (profections build on the
                # radix birth Time; progressions on the progressed-ephemeris date).
                # export_snapshot derived the TOP-LEVEL displayDatetime from that
                # chart orig date (export_chart_json.py:1602), so for these kinds it
                # would read the birth/ephemeris year, not the profected/signified
                # cursor. cs.display_datetime is the brain-owned cursor truth (the
                # same value document.displayDatetime ships and the wx
                # cs.display_datetime contract), so align the top-level field to it.
                # Most render-by-doc consumers already prefer document.displayDatetime,
                # but this keeps the snapshot internally consistent and prevents any
                # fallback consumer from surfacing the stale orig date.
                cursor_iso = _display_tuple_to_iso(getattr(cs, 'display_datetime', None))
                if cursor_iso is not None:
                    snapshot['displayDatetime'] = cursor_iso
                mark_phase("corner_override", phase_started_at)
            # Live session metadata the skin needs to label/route — all read from
            # daemon memory, never recomputed client-side.
            phase_started_at = time.perf_counter()
            snapshot['pdEventOverlay'] = (
                copy.deepcopy(getattr(live, '_pd_event_overlay', None))
                if session.get('launcher_kind') == 'pd_in_chart'
                else None
            )
            snapshot['pdDirectionState'] = (
                copy.deepcopy(live._pd_direction_state)
                if session.get('launcher_kind') == 'pd_in_chart'
                else None
            )
            snapshot['document'] = {
                'documentId': document_id,
                'featureKind': feature_kind,
                'launcherKind': session.get('launcher_kind'),
                'chartVisualMode': self._chart_visual_mode(session),
                'comparisonName': session.get('comparison_name'),
                'compoundKind': session.get('compound_kind'),
                'compositeVariant': session.get('composite_variant'),
                'viewMode': view_mode,
                'displayDatetime': _display_tuple_to_iso(getattr(cs, 'display_datetime', None)),
                'titleSuffix': self._titlebar_runtime_suffix(session, cs),
                'binding': session.get('supplementary_binding'),
                'dirty': bool(session.get('dirty', False)),
                'editDirty': bool(session.get('edit_dirty', False)),
                'stepDirty': bool(session.get('step_dirty', False)),
                'isActive': document_id == self._controller.active_document_id(),
                'symbolicTime': symbolic_readout,
                'showRadixComparison': bool(session.get('show_radix_comparison', False)),
                'pdInChartFrame': (
                    live._pd_display_frame
                    if session.get('launcher_kind') == 'pd_in_chart'
                    else None
                ),
                'pdInChartMovingRole': (
                    live._pd_moving_role
                    if session.get('launcher_kind') == 'pd_in_chart'
                    else None
                ),
                'pdInChartFixedRole': (
                    live._pd_fixed_role
                    if session.get('launcher_kind') == 'pd_in_chart'
                    else None
                ),
                'pdInChartEventId': (
                    (snapshot.get('pdDirectionState') or {}).get('eventId')
                    if session.get('launcher_kind') == 'pd_in_chart'
                    else None
                ),
            }
            mark_phase("document_meta", phase_started_at)
            if perf is not None:
                perf["totalMs"] = (time.perf_counter() - snapshot_started_at) * 1000.0
                snapshot["debugTiming"] = perf
            return snapshot

    def _initial_command_snapshot_mode(self, document_id: Optional[str]) -> str:
        if not document_id:
            return "full"
        try:
            session = self._controller.session(document_id)
        except Exception:
            return "full"
        if session is None or session.get("chart_session") is None:
            return "full"
        return "deferred"

    def _attach_full_snapshot(
        self,
        result: dict,
        document_id: Optional[str],
        overlay_render_mode: Optional[str] = None,
        include_perf: bool = False,
    ) -> dict:
        """Attach a rendered chart snapshot when the document owns a chart session.

        This is the web/Tauri equivalent of wx retaining a painted chart surface
        on activation: command responses can hand React the first drawable frame
        instead of forcing an activate/open response followed by a separate
        snapshot request. Callers choose full versus deferred overlay explicitly;
        view-only docs simply omit the field.
        """
        if not document_id:
            return result
        try:
            result["snapshot"] = self.document_snapshot(
                document_id,
                overlay_render_mode=overlay_render_mode or self._initial_command_snapshot_mode(document_id),
                include_perf=include_perf,
            )
        except (ValueError, RuntimeError):
            pass
        return result

    def _titlebar_runtime_suffix(self, session, cs) -> Optional[str]:
        """Daemon-owned titlebar date/age suffix.

        Mirrors the wx main-frame title path:
        ``_main_frame_chart_title`` -> ``chart_context_view.get_title_suffix``
        (morin.py:5040-5080, chart_context_view.py:324). This keeps the skin from
        inventing date/age labels or calculating age in TypeScript.
        """
        try:
            if isinstance(session, dict) and session.get('launcher_kind') == 'pd_in_chart':
                readout = self._pd_in_chart_symbolic_time_readout(session, cs)
                if readout is not None:
                    return "%s · %s" % (
                        readout['signifiedDateText'], readout['ageText'])
            horary_datetime = self._horary_current_datetime_text(getattr(cs, 'chart', None))
            if horary_datetime:
                try:
                    view_label = mtexts.typeList[export_chart_json.chart_mod.Chart.HORARY]
                except Exception:
                    view_label = mtexts.txts.get('Horary', 'Horary')
                if view_label:
                    return "%s • %s" % (view_label, horary_datetime)
                return horary_datetime
            if (
                isinstance(session, dict)
                and session.get('compound_kind') == 'composite_from_synastry'
                and session.get('composite_variant') == 'davison'
            ):
                chrt = getattr(cs, 'chart', None)
                if chrt is not None and getattr(chrt, 'time', None) is not None:
                    cursor_dt = self._workspace_runtime_cursor_datetime(
                        cs, wall_clock_if_unset=True)
                    if cursor_dt is not None:
                        calflag = symbolic_time._calflag_from_chart(chrt)
                        date_txt = chart_context_view._compact_context_datetime_text(
                            cursor_dt,
                            calflag,
                            show_seconds=getattr(chart_snapshot_service.options, "showseconds", True),
                            options=chart_snapshot_service.options,
                        )
                        y, m, d, h, mi, s = cursor_dt
                        ut_disp = float(h) + float(mi) / 60.0 + float(s) / 3600.0
                        disp_jd = astrology.swe_julday(y, m, d, ut_disp, calflag)
                        age_years = max(0.0, (disp_jd - float(chrt.time.jd)) / 365.2425)
                        age_txt = mtexts.txts.get('AgeYears', 'Age: %.2fy') % age_years
                        return "%s • %s" % (date_txt, age_txt)
            ctx = self._chart_context_for_session_display(cs, session=session)
            suffix = chart_context_view.get_title_suffix(ctx, chart_snapshot_service.options)
            if suffix is not None:
                return suffix
            custom_dt = session.get("custom_tab_suffix_datetime") if isinstance(session, dict) else None
            if custom_dt is not None:
                return self._format_tab_datetime_suffix(custom_dt, getattr(cs, "chart", None))
            return None
        except Exception:
            return None

    def _tab_runtime_suffix(self, session, cs) -> Optional[str]:
        """Daemon-owned sidebar tab date suffix.

        Mirrors wx ``_update_workspace_generic_runtime_title`` for document
        rows: relationship compound documents keep their base title, while
        ordinary chart sessions append ``chart_context_view.get_tab_title_suffix``.
        """
        try:
            if isinstance(session, dict) and session.get('launcher_kind') == 'pd_in_chart':
                return self._format_tab_datetime_suffix(
                    getattr(cs, 'display_datetime', None), getattr(cs, 'chart', None))
            if isinstance(session, dict) and session.get('compound_kind') in (
                'synastry',
                'composite_from_synastry',
            ):
                return None
            # Horary/here-now: the generic suffix is gated off for self-anchored
            # charts (chart_context_view.py:207 ctx.chart is ctx.radix). wx shows
            # the chart's CURRENT moment instead, baked by
            # _horary_workspace_tab_title (morin.py:4734) — HorarySession mutates
            # radix with the cursor, so this tracks stepping. The skin renders it
            # parenthesized via the isHorary flag.
            horary_datetime = self._horary_current_datetime_text(getattr(cs, 'chart', None))
            if horary_datetime:
                return horary_datetime
            ctx = self._chart_context_for_session_display(cs, session=session)
            suffix = chart_context_view.get_tab_title_suffix(ctx, chart_snapshot_service.options)
            if suffix is not None:
                return suffix
            custom_dt = session.get("custom_tab_suffix_datetime") if isinstance(session, dict) else None
            if custom_dt is not None:
                return self._format_tab_datetime_suffix(custom_dt, getattr(cs, "chart", None))
            return None
        except Exception:
            return None

    @staticmethod
    def _horary_current_datetime_text(chrt) -> Optional[str]:
        if (
            chrt is None
            or getattr(chrt, 'htype', None) != export_chart_json.chart_mod.Chart.HORARY
            or getattr(chrt, 'time', None) is None
        ):
            return None
        try:
            t = chrt.time
            calflag = symbolic_time._calflag_from_chart(chrt)
            return chart_context_view._compact_context_datetime_text(
                (t.origyear, t.origmonth, t.origday, t.hour, t.minute, t.second),
                calflag,
                show_seconds=getattr(chart_snapshot_service.options, "showseconds", True),
                options=chart_snapshot_service.options,
            )
        except Exception:
            return None

    @staticmethod
    def _format_tab_datetime_suffix(display_dt, chrt) -> Optional[str]:
        try:
            values = tuple(int(v) for v in tuple(display_dt)[:6])
            if len(values) < 6:
                return None
            calflag = symbolic_time._calflag_from_chart(chrt)
            return chart_context_view._compact_context_datetime_text(
                values,
                calflag,
                show_seconds=getattr(chart_snapshot_service.options, "showseconds", True),
                options=chart_snapshot_service.options,
            )
        except Exception:
            return None

    @staticmethod
    def _session_display_datetime(cs):
        if cs is None:
            return None
        display_dt = getattr(cs, 'display_datetime', None)
        if display_dt is not None:
            return display_dt
        chrt = getattr(cs, 'chart', None)
        time_obj = getattr(chrt, 'time', None)
        if time_obj is None:
            return None
        try:
            return (
                int(getattr(time_obj, 'origyear', time_obj.year)),
                int(getattr(time_obj, 'origmonth', time_obj.month)),
                int(getattr(time_obj, 'origday', time_obj.day)),
                int(time_obj.hour),
                int(time_obj.minute),
                int(time_obj.second),
            )
        except Exception:
            return None

    @staticmethod
    def _workspace_runtime_cursor_datetime(cs, *, wall_clock_if_unset: bool = False):
        if cs is None:
            return None
        display_dt = getattr(cs, 'display_datetime', None)
        if wall_clock_if_unset:
            initial_dt = getattr(cs, '_initial_display_datetime', None)
            if display_dt is None:
                now = datetime.datetime.now()
                return (now.year, now.month, now.day, now.hour, now.minute, now.second)
            try:
                if (
                    initial_dt is not None
                    and tuple(int(v) for v in tuple(display_dt)[:6])
                    == tuple(int(v) for v in tuple(initial_dt)[:6])
                ):
                    now = datetime.datetime.now()
                    return (now.year, now.month, now.day, now.hour, now.minute, now.second)
            except Exception:
                pass
        if display_dt is None:
            return None
        try:
            return tuple(int(v) for v in tuple(display_dt)[:6])
        except Exception:
            return None

    @staticmethod
    def _display_datetime_jd(display_dt, base_chart) -> Optional[float]:
        try:
            y, m, d, h, mi, s = [int(v) for v in tuple(display_dt)[:6]]
            calflag = symbolic_time._calflag_from_chart(base_chart)
            ut = float(h) + float(mi) / 60.0 + float(s) / 3600.0
            return float(astrology.swe_julday(y, m, d, ut, calflag))
        except Exception:
            return None

    def _timed_subchart_age_metadata(self, session, cs) -> Optional[dict[str, Any]]:
        if not isinstance(session, dict) or cs is None:
            return None
        child_chart = getattr(cs, 'chart', None)
        radix = getattr(cs, 'radix', None)
        if child_chart is None or radix is None:
            return None
        chart_mod = export_chart_json.chart_mod
        if getattr(child_chart, 'htype', None) != chart_mod.Chart.TRANSIT:
            return None
        parent_id = session.get('parent_document_id')
        if not parent_id:
            return None
        parent_session = self._controller.session(str(parent_id))
        if not isinstance(parent_session, dict):
            return None
        parent_cs = parent_session.get('chart_session')
        parent_chart = getattr(parent_cs, 'chart', None) if parent_cs is not None else parent_session.get('chart')
        parent_radix = getattr(parent_cs, 'radix', None) if parent_cs is not None else parent_chart
        if parent_chart is None or parent_radix is None:
            return None
        if parent_chart is parent_radix:
            return None
        if getattr(parent_chart, 'htype', None) != chart_mod.Chart.SOLAR:
            return None
        parent_dt = self._session_display_datetime(parent_cs)
        if parent_dt is None:
            return None
        parent_jd = self._display_datetime_jd(parent_dt, radix)
        if parent_jd is None:
            return None
        try:
            parent_age_years = (float(parent_jd) - float(radix.time.jd)) / 365.2425
        except Exception:
            return None
        return {
            'age_base_jd': parent_jd,
            'age_base_years': parent_age_years,
        }

    def _chart_context_for_session_display(self, cs, session=None):
        """Wx-free twin of ``morin._chart_context_for_session_display``.

        The desktop converts the active ChartSession into a ChartContext before
        asking ``chart_context_view`` for title/status strings. The daemon needs
        the same adapter so titlebar text is generated by Python semantics, not
        by React.
        """
        metadata = self._timed_subchart_age_metadata(session, cs)
        return chart_context.context_from_session_like(cs, metadata=metadata)

    def _progression_method_for_session(self, session, cs) -> Optional[str]:
        """Resolve the progression METHOD for a session, never defaulting to
        secondary for the other three methods.

        Mirrors the desktop resolver (morin.py:5935-5947): prefer the binding's
        retained ``progression_method``, then the feature_kind, then the chart's
        recorded method. Returns the normalized posfordate method string, or
        ``None`` if this is not a progression session."""
        feature_kind = session.get('supplementary_feature_kind')
        if feature_kind not in _PROGRESSION_FEATURE_KINDS:
            return None
        binding = session.get('supplementary_binding')
        retained = {}
        if isinstance(binding, dict):
            retained = dict(binding.get('retained_state') or {})
        else:
            retained = dict(getattr(binding, 'retained_state', None) or {})
        method = retained.get('progression_method')
        if method is not None:
            return posfordate.progression_method(method)
        resolved = self._progression_method_for_feature_kind(feature_kind)
        if resolved is not None:
            return resolved
        return posfordate.progression_chart_method(
            getattr(cs, 'chart', None), default=posfordate.SECONDARY)

    @staticmethod
    def _progression_method_for_feature_kind(feature_kind):
        """feature_kind -> posfordate progression method
        (engine/supplementary_adapter.py:17-23). None if not a progression."""
        if feature_kind == 'solar_arc':
            return posfordate.SOLAR_ARC
        if feature_kind == 'minor':
            return posfordate.MINOR
        if feature_kind == 'tertiary':
            return posfordate.TERTIARY
        if feature_kind == 'secondary':
            return posfordate.SECONDARY
        return None

    def _symbolic_time_readout(self, session, cs) -> Optional[dict]:
        """The signified-real-time + age readout for a symbolic derived chart.

        True secondary/minor/tertiary progressions derive the signified datetime
        from the directed chart's ephemeris time. Solar Arc does not: its real
        cursor date maps directly to fractional age, then that age only finds
        the progressed-Sun arc.

        PD-in-Chart uses the same contract: its projected chart Time is the
        symbolic post-birth rotation instant, while ``cs.display_datetime`` is
        the real date signified by the active primary-direction key.

        Returns None for non-symbolic documents."""
        pd_readout = self._pd_in_chart_symbolic_time_readout(session, cs)
        if pd_readout is not None:
            return pd_readout
        method = self._progression_method_for_session(session, cs)
        if method is None:
            return None
        radix = getattr(cs, 'radix', None)
        chrt = getattr(cs, 'chart', None)
        if radix is None or chrt is None:
            return None
        if method == posfordate.SOLAR_ARC:
            sig = getattr(cs, 'display_datetime', None)
            if sig is None:
                return None
            try:
                sig = tuple(int(v) for v in tuple(sig)[:6])
            except Exception:
                return None
            try:
                age_years = symbolic_time.solar_arc_age_for_real_datetime(radix, sig)
            except Exception:
                age_years = float(
                    getattr(chrt, '_progression_age_years',
                            getattr(chrt, '_progression_symbolic_age', 0.0))
                )
            prog = export_chart_json.chart_datetime_tuple(chrt)
            sig_bc = bool(getattr(getattr(radix, 'time', None), 'bc', False))
            sig_date_display, sig_time_display = export_chart_json.format_datetime_tuple(
                sig, bc=sig_bc, options=chart_snapshot_service.options)
            age_years_int = int(age_years)
            sig_text = dateformat.date_text(sig[0], sig[1], sig[2], chart_snapshot_service.options)
            sig_datetime_text = dateformat.date_time_text(sig, chart_snapshot_service.options, show_seconds=True)
            return {
                'method': method,
                'signifiedDatetime': _display_tuple_to_iso(sig),
                'signifiedDateText': sig_text,
                'signifiedDateDisplay': sig_date_display,
                'signifiedTimeDisplay': sig_time_display,
                'progressedDatetime': _display_tuple_to_iso(prog),
                'ageYears': float(age_years),
                'ageYearsInt': age_years_int,
                'ageText': mtexts.txts.get("AgeColonFmt", "Age: %d") % age_years_int,
                'realText': mtexts.txts.get("RealColonFmt", "Real: %s") % sig_text,
                'symbolicRealText': (
                    mtexts.txts.get("SolarArcRealFmt", "Solar Arc: %.6f deg - Real: %s") % (
                        float(getattr(chrt, '_solar_arc_degrees', 0.0)),
                        sig_datetime_text,
                    )
                ),
            }
        try:
            day_type = posfordate.progression_chart_day_type(
                chrt, default=getattr(getattr(radix, 'options', None),
                                      'progression_day_type',
                                      posfordate.PROGRESSION_DAY_TYPE_Q2))
        except Exception:
            day_type = posfordate.PROGRESSION_DAY_TYPE_Q2
        binding_payload = session.get('supplementary_binding') or {}
        retained = (
            binding_payload.get('retained_state') or {}
            if isinstance(binding_payload, dict)
            else {}
        )
        progression_direction = (
            'converse'
            if retained.get('progression_direction') == 'converse'
            else 'direct'
        )
        info = symbolic_time.secondary_direction_symbolic_info(
            radix,
            chrt,
            method=method,
            day_type=day_type,
            converse=progression_direction == 'converse',
        )
        if info is None:
            return None
        prog = info['progressed_datetime']
        sig = info['signified_datetime']
        if sig is None:
            return None
        # Signified date/time in the SAME corner-label format the chart wheel
        # draws (export_chart_json.format_chart_datetime). The progression's
        # displayed chart is the progressed/ephemeris one, so its meta carries
        # the ephemeris date; the corner must instead show the SIGNIFIED real
        # date (the cursor) - these strings replace the corner label.
        sig_bc = bool(getattr(getattr(radix, 'time', None), 'bc', False))
        sig_date_display, sig_time_display = export_chart_json.format_datetime_tuple(
            sig, bc=sig_bc, options=chart_snapshot_service.options)
        prog_datetime_text = dateformat.date_time_text(prog, chart_snapshot_service.options, show_seconds=True)
        sig_text = dateformat.date_text(sig[0], sig[1], sig[2], chart_snapshot_service.options)
        sig_datetime_text = dateformat.date_time_text(sig, chart_snapshot_service.options, show_seconds=True)
        # Desktop formatter strings (morin.py:5543-5546 symbolic-real pair;
        # morin.py:5562 real-date; chart_context_view.py:278 age status).
        symbolic_real_text = (
            mtexts.txts.get("SymbolicRealFmt", "Symbolic: %s - Real: %s")
            % (prog_datetime_text, sig_datetime_text)
        )
        return {
            'method': method,
            'direction': progression_direction,
            'signifiedDatetime': _display_tuple_to_iso(sig),
            'signifiedDateText': sig_text,
            'signifiedDateDisplay': sig_date_display,
            'signifiedTimeDisplay': sig_time_display,
            'progressedDatetime': _display_tuple_to_iso(prog),
            'ageYears': float(info['age_years']),
            'ageYearsInt': int(info['age_years_int']),
            'ageText': mtexts.txts.get("AgeColonFmt", "Age: %d") % int(info['age_years_int']),
            'realText': mtexts.txts.get("RealColonFmt", "Real: %s") % sig_text,
            'symbolicRealText': symbolic_real_text,
        }

    def _pd_in_chart_symbolic_time_readout(self, session, cs) -> Optional[dict]:
        if not isinstance(session, dict) or session.get('launcher_kind') != 'pd_in_chart':
            return None
        radix = getattr(cs, 'radix', None)
        chrt = getattr(cs, 'chart', None)
        sig = getattr(cs, 'display_datetime', None)
        if radix is None or chrt is None or sig is None:
            return None
        try:
            sig = tuple(int(v) for v in tuple(sig)[:6])
            if len(sig) < 6:
                return None
            prog = export_chart_json.chart_datetime_tuple(chrt)
            sig_dt = _display_to_datetime(sig)
            if sig_dt is None:
                return None
            from engine import pd_in_chart
            event_jd = pd_in_chart.event_jd_for_display_datetime(radix, sig_dt)
            age_years = max(
                0.0,
                (float(event_jd) - float(radix.time.jd)) / pd_in_chart.TROPICAL_YEAR_DAYS,
            )
        except Exception:
            return None

        sig_bc = bool(getattr(getattr(radix, 'time', None), 'bc', False))
        sig_date_display, sig_time_display = export_chart_json.format_datetime_tuple(
            sig, bc=sig_bc, options=chart_snapshot_service.options)
        prog_datetime_text = dateformat.date_time_text(
            prog, chart_snapshot_service.options, show_seconds=True)
        sig_text = dateformat.date_text(
            sig[0], sig[1], sig[2], chart_snapshot_service.options)
        sig_datetime_text = dateformat.date_time_text(
            sig, chart_snapshot_service.options, show_seconds=True)
        age_years_int = int(age_years)
        return {
            'method': 'primary_direction',
            'signifiedDatetime': _display_tuple_to_iso(sig),
            'signifiedDateText': sig_text,
            'signifiedDateDisplay': sig_date_display,
            'signifiedTimeDisplay': sig_time_display,
            'progressedDatetime': _display_tuple_to_iso(prog),
            'ageYears': float(age_years),
            'ageYearsInt': age_years_int,
            'ageText': mtexts.txts.get("AgeColonFmt", "Age: %d") % age_years_int,
            'realText': mtexts.txts.get("RealColonFmt", "Real: %s") % sig_text,
            'symbolicRealText': (
                mtexts.txts.get("SymbolicRealFmt", "Symbolic: %s - Real: %s")
                % (prog_datetime_text, sig_datetime_text)
            ),
        }

    def _corner_real_date_override(self, session, cs, symbolic_readout):
        """Per-kind resolver for the chart-wheel top-left corner date/time
        strings — the wx-free twin of drawChartTimeTopLeft (graphchart.py:3562).

        Returns a dict with ``dateDisplay`` (required) and ``timeDisplay``
        (optional; None means "keep the chart's exported time line"), formatted in
        the SAME ``{year}.{MonthName}.{DD}`` / ``{HH}:{MM}:{SS}`` style the corner
        uses (export_chart_json.format_datetime_tuple), or ``None`` when the
        chart's already-exported meta is correct (transits / solar / lunar /
        planetary returns — their chart orig date IS the real cursor moment).

        Kinds that DIFFER from chart orig and need an override:
          * progressions -> the SIGNIFIED date (reuses the symbolic_readout
            already computed, graphchart.py:3609 uses cs.display_datetime which the
            seed set to the signified);
          * profections -> the PROFECTED real date = cs.display_datetime
            (morin._format_profection_real_date_and_age, morin.py:5567-5585;
            the chart.time is the radix birth Time so the corner must override it);
          * solar_average -> an "Age min - max" label, not a date
            (graphchart.py:3564-3573).
        No engine math is reimplemented: the signified comes from
        symbolic_time, cs.display_datetime is the brain-owned cursor, and the
        solar-average age bounds are the chart attributes the engine builder set.
        """
        feature_kind = session.get('supplementary_feature_kind')
        chrt = getattr(cs, 'chart', None)
        radix = getattr(cs, 'radix', None)

        # Progressions: the signified real date (already derived for the readout).
        if symbolic_readout is not None:
            date_disp = symbolic_readout.get('signifiedDateDisplay')
            time_disp = symbolic_readout.get('signifiedTimeDisplay')
            if date_disp and time_disp:
                return {'dateDisplay': date_disp, 'timeDisplay': time_disp}
            return None

        # Solar Average: the desktop draws "Age min - max" (graphchart.py:3570-
        # 3573), reading the engine-set bounds on the built chart. No time line.
        if getattr(chrt, 'is_solar_average', False):
            age_min = int(getattr(chrt, 'solar_average_age_min', 0))
            age_max = int(getattr(chrt, 'solar_average_age_max', age_min))
            # The desktop emits ONLY the "Age" line and returns (graphchart.py:
            # 3573) — no second/time line. Blank it so the corner matches.
            return {
                'dateDisplay': mtexts.txts.get("AgeRangeFmt", "Age %d - %d") % (age_min, age_max),
                'timeDisplay': '',
            }

        # Profections: cs.display_datetime carries the PROFECTED real date (seeded
        # at open from the adapter's normalized source datetime); the chart's own
        # orig date is the radix birth. Format the cursor exactly like the corner.
        if feature_kind == 'profections':
            dt = getattr(cs, 'display_datetime', None)
            if dt is None:
                return None
            bc = bool(getattr(getattr(radix, 'time', None), 'bc', False))
            date_disp, time_disp = export_chart_json.format_datetime_tuple(
                dt, bc=bc, options=chart_snapshot_service.options)
            return {'dateDisplay': date_disp, 'timeDisplay': time_disp}

        # All other derived kinds (transits / solar / lunar / planetary returns):
        # the exported meta already shows the real moment — no override.
        return None

    @staticmethod
    def _build_parallel_transit_overlay(cs):
        """Build the TRANSIT overlay chart for the Parallel Transit toggle.

        Verbatim port of the wx renderer's overlay construction
        (morin.py:11203-11226): a TRANSIT chart for the live cursor datetime,
        placed at the radix's own place, using the radix Time's calendar/zone
        settings. Returns ``None`` (no overlay) on any malformed cursor — exactly
        like the wx ``except Exception: pass`` guard. The chart's own options are
        reused so the transit positions match the radix's engine config.
        """
        dt = getattr(cs, 'display_datetime', None)
        if dt is None:
            return None
        radix = getattr(cs, 'radix', None)
        if radix is None:
            radix = getattr(cs, 'chart', None)
        if radix is None:
            return None
        chart_mod = export_chart_json.chart_mod
        try:
            y, m, d, h, mi, s = [int(v) for v in tuple(dt)[:6]]
            place = radix.place
            transit_time = chart_mod.Time(
                y, m, d, h, mi, s,
                False, radix.time.cal, radix.time.zt,
                radix.time.plus, radix.time.zh, radix.time.zm,
                False, place, False,
                tzid=getattr(radix.time, 'tzid', ''),
                tzauto=getattr(radix.time, 'tzauto', False),
            )
            return chart_factory.build_chart(
                radix.name, radix.male, transit_time, place,
                chart_mod.Chart.TRANSIT, '', radix.options, False,
            )
        except Exception:
            return None

    # -- commands ----------------------------------------------------------

    def _load_radix(
        self,
        source: Optional[str],
        name: str,
        record_index: Optional[int] = None,
    ):
        opts = chart_snapshot_service.options
        source_path = str(Path(source).expanduser()) if source else str(export_chart_json.DEFAULT_SOURCE)
        source_file = Path(source_path)
        if source_file.suffix.lower() == ".jsonl" and record_index is not None:
            cache_key: tuple[Any, ...] | None = None
            try:
                stat = source_file.stat()
                cache_key = (source_path, int(record_index), stat.st_mtime_ns, stat.st_size)
            except OSError:
                cache_key = None
            record = self._root_record_cache.get(cache_key) if cache_key is not None else None
            if record is not None and cache_key is not None:
                self._root_record_cache.move_to_end(cache_key)
            else:
                record = chartfile.read_jsonl_record(source_path, int(record_index))
                if cache_key is not None:
                    self._root_record_cache[cache_key] = dict(record)
                    self._root_record_cache.move_to_end(cache_key)
                    while len(self._root_record_cache) > _ROOT_RECORD_CACHE_MAX:
                        self._root_record_cache.popitem(last=False)
            return chart_factory.chart_from_record(dict(record), opts)
        radix, _record = export_chart_json.load_chart(
            source_path,
            opts,
            name=name,
            record_index=record_index,
        )
        return radix

    def _find_jsonl_record_index(
        self,
        path: str,
        chart_ref: Optional[dict[str, Any]] = None,
    ) -> tuple[Optional[int], bool]:
        try:
            record_index, resolved = chartfile.find_jsonl_record_index(path, chart_ref)
            if resolved or Path(path).suffix.lower() != ".jsonl":
                return record_index, resolved
            if not isinstance(chart_ref, dict):
                return record_index, resolved
            records = chartfile.read_jsonl(path)
            chart_id = str(chart_ref.get("chart_id", "") or "")
            if chart_id:
                matches = [
                    idx for idx, record in enumerate(records)
                    if str(record.get("id", "") or "") == chart_id
                ]
                if len(matches) == 1:
                    return matches[0], True
            fingerprint = {
                "name": str(chart_ref.get("chart_name", "") or "").strip(),
                "date": str(chart_ref.get("chart_date", "") or "").strip(),
                "time": str(chart_ref.get("chart_time", "") or "").strip(),
                "place": str(chart_ref.get("chart_place", "") or "").strip(),
            }
            if any(fingerprint.values()):
                matches = [
                    idx
                    for idx, record in enumerate(records)
                    if all(
                        not value or str(record.get(key, "") or "").strip() == value
                        for key, value in fingerprint.items()
                    )
                ]
                if len(matches) == 1:
                    return matches[0], True
            if chart_ref.get("chart_id") or chart_ref.get("chart_name"):
                return record_index, resolved
            label = str(chart_ref.get("label", "") or "").strip()
            if not label:
                return record_index, resolved
            collection = Path(path).stem
            suffix = f" ({collection})"
            name = label[: -len(suffix)].strip() if label.endswith(suffix) else label
            if not name or name == collection:
                return record_index, resolved
            matches = [
                idx
                for idx, record in enumerate(records)
                if str(record.get("name", "") or "").strip() == name
            ]
            if len(matches) == 1:
                return matches[0], True
            return record_index, resolved
        except Exception:
            return None, False

    def _chart_recent_identity(self, chrt, chart_id: str = "") -> dict[str, str]:
        identity: dict[str, str] = {}
        chart_id = chart_id or getattr(chrt, "chart_id", "") or ""
        if chart_id:
            identity["chart_id"] = chart_id
        name = (getattr(chrt, "name", "") or "").strip()
        if name:
            identity["chart_name"] = name
        time_obj = getattr(chrt, "time", None)
        if time_obj is not None:
            year = getattr(time_obj, "origyear", getattr(time_obj, "year", 0))
            month = getattr(time_obj, "origmonth", getattr(time_obj, "month", 0))
            day = getattr(time_obj, "origday", getattr(time_obj, "day", 0))
            hour = getattr(time_obj, "hour", 0)
            minute = getattr(time_obj, "minute", 0)
            second = getattr(time_obj, "second", 0)
            bc = getattr(time_obj, "bc", False)
            date_prefix = "-" if bc else ""
            identity["chart_date"] = f"{date_prefix}{abs(int(year)):04d}-{int(month):02d}-{int(day):02d}"
            identity["chart_time"] = f"{int(hour):02d}:{int(minute):02d}:{int(second):02d}"
        place_obj = getattr(chrt, "place", None)
        if place_obj is not None:
            place_name = (getattr(place_obj, "place", "") or "").strip()
            if place_name:
                identity["chart_place"] = place_name
        return identity

    def _chart_recent_label(self, chrt=None, fpath: str = "") -> str:
        name = (getattr(chrt, "name", "") if chrt is not None else "").strip()
        if fpath and Path(fpath).suffix.lower() == ".jsonl":
            collection = Path(fpath).stem
            return f"{name} ({collection})" if name else collection
        if name:
            return name
        if fpath:
            return Path(fpath).name
        date_suffix = ""
        time_obj = getattr(chrt, "time", None) if chrt is not None else None
        if time_obj is not None:
            try:
                year = int(getattr(time_obj, "origyear", getattr(time_obj, "year", 0)))
                month = int(getattr(time_obj, "origmonth", getattr(time_obj, "month", 0)))
                day = int(getattr(time_obj, "origday", getattr(time_obj, "day", 0)))
                date_suffix = f" ({abs(year):04d}-{month:02d}-{day:02d})"
            except Exception:
                pass
        htype = getattr(chrt, "htype", None) if chrt is not None else None
        if htype == export_chart_json.chart_mod.Chart.HORARY:
            return mtexts.txts.get("Horary", "Horary") + date_suffix
        return mtexts.txts.get("Untitled", "Untitled") + date_suffix

    def _ephemeral_recent_label(self, chrt) -> str:
        """Recent-list label for an unsaved scratch / here-now chart.

        Unlike a file-backed chart (whose name alone identifies it), a scratch
        chart's name is generic ("Here and Now") — so two of them would be
        indistinguishable in Recent Charts. Append the full moment (date + time
        of day) the way the workspace tab subtitle shows it, so each scratch
        entry reads e.g. "Here and Now (2026-06-14 17:46)"."""
        name = (getattr(chrt, "name", "") or "").strip()
        if not name:
            htype = getattr(chrt, "htype", None)
            name = (
                mtexts.txts.get("Horary", "Horary")
                if htype == export_chart_json.chart_mod.Chart.HORARY
                else mtexts.txts.get("Untitled", "Untitled")
            )
        moment = ""
        t = getattr(chrt, "time", None)
        if t is not None:
            try:
                year = int(getattr(t, "origyear", getattr(t, "year", 0)))
                month = int(getattr(t, "origmonth", getattr(t, "month", 0)))
                day = int(getattr(t, "origday", getattr(t, "day", 0)))
                hour = int(getattr(t, "hour", 0))
                minute = int(getattr(t, "minute", 0))
                moment = f"{abs(year):04d}-{month:02d}-{day:02d} {hour:02d}:{minute:02d}"
            except Exception:
                moment = ""
        return f"{name} ({moment})" if moment else name

    def _compound_recent_label(self, session: dict[str, Any], participants=None) -> str:
        if participants is None:
            participants = session.get("relationship_participants") or []
        names = [self._chart_label(chrt, "?") for chrt in participants or []]
        kind = session.get("compound_kind", "synastry")
        if kind == "composite_from_synastry":
            variant = session.get("composite_variant", "midpoint")
            suffix = "Composite" if variant != "davison" else "Davison"
        else:
            suffix = "Synastry"
        return "%s (%s)" % (" / ".join(names), suffix)

    def _serializable_chart_ref_for_session(
        self,
        session: Optional[dict[str, Any]],
    ) -> Optional[dict[str, Any]]:
        if session is None or session.get("compound_kind"):
            return None
        fpath = str(session.get("fpath", "") or "")
        if not fpath:
            return None
        chrt = session.get("chart")
        cs = session.get("chart_session")
        if cs is not None and getattr(cs, "chart", None) is not None:
            chrt = cs.chart
        chart_id = str(session.get("chart_id", "") or getattr(chrt, "chart_id", "") or "")
        ref: dict[str, Any] = {
            "label": self._chart_recent_label(chrt, fpath),
            "path": fpath,
        }
        ref.update(self._chart_recent_identity(chrt, chart_id=chart_id))
        return ref

    def _serializable_participant_ref_live(self, chrt) -> Optional[dict[str, Any]]:
        if chrt is None:
            return None
        source_session = self._find_noncompound_session_for_chart(chrt)
        fpath = str(source_session.get("fpath", "") if source_session else "")
        if not fpath:
            return None
        chart_id = str(source_session.get("chart_id", "") or getattr(chrt, "chart_id", "") or "")
        return self._participant_ref_from_source(chrt, fpath, chart_id=chart_id)

    def _participant_ref_from_source(
        self,
        chrt,
        source_path: str,
        *,
        chart_id: str = "",
    ) -> Optional[dict[str, Any]]:
        path = str(Path(source_path).expanduser()) if source_path else ""
        if not path:
            return None
        chart_id = str(chart_id or getattr(chrt, "chart_id", "") or "")
        ref: dict[str, Any] = {
            "label": self._chart_recent_label(chrt, path),
            "path": path,
        }
        ref.update(self._chart_recent_identity(chrt, chart_id=chart_id))
        return ref

    def _serializable_compound_ref(
        self,
        session: dict[str, Any],
    ) -> Optional[dict[str, Any]]:
        compound_kind = session.get("compound_kind", "")
        if compound_kind not in ("synastry", "composite_from_synastry"):
            return None
        participants = session.get("relationship_participants") or []
        pair = session.get("synastry_pair")
        if not participants and isinstance(pair, (list, tuple)) and len(pair) >= 2:
            participants = list(pair)
        if len(participants) < 2:
            return None
        stored_refs = session.get("relationship_participant_refs") or []
        participant_refs: list[dict[str, Any]] = []
        for idx, chrt in enumerate(participants):
            pref = None
            if idx < len(stored_refs) and isinstance(stored_refs[idx], dict) and stored_refs[idx].get("path"):
                pref = dict(stored_refs[idx])
            if pref is None:
                pref = self._serializable_participant_ref_live(chrt)
            if pref is None or not pref.get("path"):
                return None
            participant_refs.append(pref)
        ref: dict[str, Any] = {
            "label": self._compound_recent_label(session, participants),
            "path": participant_refs[0].get("path", ""),
            "compound_kind": compound_kind,
            "participants": participant_refs,
        }
        if compound_kind == "composite_from_synastry":
            ref["composite_variant"] = session.get("composite_variant", "midpoint")
        return ref

    def _serializable_open_chart_refs(self) -> list[dict[str, Any]]:
        refs: list[dict[str, Any]] = []
        for document in self._controller.documents():
            session = self._controller.session(document.document_id)
            if session is None:
                continue
            if session.get("compound_kind") in ("synastry", "composite_from_synastry"):
                item = self._serializable_compound_ref(session)
            else:
                item = self._serializable_chart_ref_for_session(session)
            if item is not None:
                refs.append(item)
        return refs

    def _save_restore_open_charts_state(self) -> bool:
        opts = chart_snapshot_service.options
        if getattr(opts, "restore_open_charts", False):
            opts.restore_open_chart_refs = self._serializable_open_chart_refs()
            opts.restore_open_charts_active_ref = (
                self._serializable_chart_ref_for_session(self._controller.active_session()) or {}
            )
        else:
            opts.restore_open_chart_refs = []
            opts.restore_open_charts_active_ref = {}
        try:
            return bool(opts.saveRestoreOpenCharts())
        except Exception:
            return False

    def _load_chart_from_ref(self, ref: dict[str, Any]):
        path = str(ref.get("path", "") or "")
        if not path or not Path(path).exists():
            return None, None, "missing"
        record_index, resolved = self._find_jsonl_record_index(path, ref)
        if Path(path).suffix.lower() == ".jsonl" and not resolved:
            return None, None, "unresolved"
        try:
            chrt = self._load_radix(path, str(ref.get("chart_name") or ""), record_index)
        except Exception:
            return None, None, "load_failed"
        return chrt, record_index, "loaded"

    def _restore_workspace_chart_ref(self, ref: dict[str, Any]) -> Optional[str]:
        if ref.get("compound_kind"):
            return self._restore_compound_chart_ref(ref)
        path = str(ref.get("path", "") or "")
        chrt, record_index, status = self._load_chart_from_ref(ref)
        if status != "loaded" or chrt is None:
            return None
        result = self.open_document(
            kind="chart",
            source_name=getattr(chrt, "name", "") or str(ref.get("chart_name") or "Morinus"),
            source=path,
            record_index=record_index,
        )
        return result.get("documentId")

    def _restore_compound_chart_ref(self, ref: dict[str, Any]) -> Optional[str]:
        participants = ref.get("participants") or []
        if len(participants) < 2:
            return None
        first_ref = participants[0] if isinstance(participants[0], dict) else {}
        partner_ref = participants[1] if isinstance(participants[1], dict) else {}
        parent_doc_id = self._find_open_document_id_for_ref(first_ref)
        if parent_doc_id is None:
            parent_doc_id = self._restore_workspace_chart_ref(first_ref)
        if parent_doc_id is None:
            return None
        partner_path = str(partner_ref.get("path", "") or "")
        partner_index, resolved = self._find_jsonl_record_index(partner_path, partner_ref)
        if Path(partner_path).suffix.lower() == ".jsonl" and not resolved:
            return None
        partner_name = str(partner_ref.get("chart_name") or partner_ref.get("name") or "")
        if not partner_name and partner_path:
            partner_name = Path(partner_path).stem
        try:
            result = self.open_synastry(
                parent_doc_id,
                partner_name,
                comparison_source=partner_path,
                comparison_record_index=partner_index,
            )
        except Exception:
            return None
        doc_id = result.get("documentId")
        variant = ref.get("composite_variant")
        if doc_id and ref.get("compound_kind") == "composite_from_synastry":
            try:
                self.set_synastry_composite(str(doc_id), variant=str(variant or "midpoint"))
            except Exception:
                pass
        return str(doc_id) if doc_id else None

    def _find_open_document_id_for_ref(self, ref: dict[str, Any]) -> Optional[str]:
        for document in self._controller.documents():
            session = self._controller.session(document.document_id)
            if session is not None and self._restore_chart_ref_matches_session(ref, session):
                return document.document_id
        return None

    def _restore_chart_ref_matches_session(self, ref: dict[str, Any], session: dict[str, Any]) -> bool:
        if not ref or session is None or session.get("compound_kind"):
            return False
        if str(session.get("fpath", "") or "") != str(ref.get("path", "") or ""):
            return False
        ref_chart_id = str(ref.get("chart_id", "") or "")
        if ref_chart_id:
            return str(session.get("chart_id", "") or "") == ref_chart_id
        session_ref = self._serializable_chart_ref_for_session(session) or {}
        for key in ("chart_name", "chart_date", "chart_time", "chart_place"):
            ref_value = ref.get(key)
            if ref_value and session_ref.get(key) != ref_value:
                return False
        return True

    def _restore_open_charts_if_configured(self) -> bool:
        opts = chart_snapshot_service.options
        if not getattr(opts, "restore_open_charts", False):
            return False
        refs = getattr(opts, "restore_open_chart_refs", []) or []
        if not refs:
            return False
        restored_any = False
        for ref in refs:
            if not isinstance(ref, dict):
                continue
            if self._restore_workspace_chart_ref(ref) is not None:
                restored_any = True
        if not restored_any:
            return False
        active_ref = getattr(opts, "restore_open_charts_active_ref", {}) or {}
        if isinstance(active_ref, dict) and active_ref:
            doc_id = self._find_open_document_id_for_ref(active_ref)
            if doc_id:
                self._controller.activate_document(doc_id)
        return True

    def _load_startup_chart_if_configured(self) -> dict[str, Any]:
        self._startup_restore_attempted = True
        if self._restore_open_charts_if_configured():
            return {"ok": True, "mode": "restore_open_charts", "documents": self._tree_payload()}
        opts = chart_snapshot_service.options
        startup_ref = getattr(opts, "startupchart", "") or ""
        if not startup_ref:
            return {"ok": True, "mode": "none", "documents": self._tree_payload()}
        startup_path = startup_ref if isinstance(startup_ref, str) else startup_ref.get("path", "")
        if not startup_path:
            return {"ok": True, "mode": "none", "documents": self._tree_payload()}
        if not Path(startup_path).exists():
            opts.startupchart = ""
            try:
                opts.saveStartupChart()
            except Exception:
                pass
            return {"ok": True, "mode": "startup_missing_cleared", "documents": self._tree_payload()}
        ref = {"path": startup_path} if isinstance(startup_ref, str) else dict(startup_ref)
        doc_id = self._restore_workspace_chart_ref(ref)
        return {
            "ok": doc_id is not None,
            "mode": "startup_chart" if doc_id is not None else "startup_unresolved",
            "documentId": doc_id,
            "documents": self._tree_payload(),
        }

    def _ensure_startup_restore_attempted(self) -> None:
        if self._startup_restore_attempted:
            return
        self._load_startup_chart_if_configured()

    def startup_restore_state(self) -> dict[str, Any]:
        opts = chart_snapshot_service.options
        return {
            "startupRef": getattr(opts, "startupchart", "") or "",
            "restoreOpenCharts": {
                "enabled": bool(getattr(opts, "restore_open_charts", False)),
                "refs": list(getattr(opts, "restore_open_chart_refs", []) or []),
                "activeRef": dict(getattr(opts, "restore_open_charts_active_ref", {}) or {}),
            },
            "canSetStartup": self._serializable_chart_ref_for_session(self._controller.active_session()) is not None,
        }

    def set_startup_chart_to_active(self) -> dict[str, Any]:
        ref = self._serializable_chart_ref_for_session(self._controller.active_session())
        if ref is None:
            return {
                "ok": False,
                "requires": "saved_chart_file_path",
                "message": mtexts.txts.get(
                    "StartupChartRequiresSavedFile",
                    "Startup chart requires the active chart to be opened from a saved chart file.",
                ),
                "state": self.startup_restore_state(),
            }
        opts = chart_snapshot_service.options
        opts.startupchart = ref
        saved = False
        try:
            saved = bool(opts.saveStartupChart())
        except Exception:
            saved = False
        return {"ok": saved, "startupRef": ref, "state": self.startup_restore_state()}

    def clear_startup_chart(self) -> dict[str, Any]:
        opts = chart_snapshot_service.options
        opts.startupchart = ""
        saved = False
        try:
            saved = bool(opts.saveStartupChart())
        except Exception:
            saved = False
        return {"ok": saved, "startupRef": "", "state": self.startup_restore_state()}

    def set_restore_open_charts_enabled(self, enabled: bool) -> dict[str, Any]:
        opts = chart_snapshot_service.options
        opts.restore_open_charts = bool(enabled)
        self._save_restore_open_charts_state()
        return {"ok": True, "state": self.startup_restore_state()}

    def save_restore_open_charts(self) -> dict[str, Any]:
        return {"ok": self._save_restore_open_charts_state(), "state": self.startup_restore_state()}

    def save_document(self, document_id: str, path: Optional[str] = None,
                      name: Optional[str] = None) -> dict:
        """Save Horoscope / Save As — DEF-007 core (policy-chart-lifecycle §3).

        Save serializes the document's live chart through chartfile and upserts
        it into the bound collection by id. Save As writes to ``path``, mints a
        fresh Record id, and REBINDS the live document to that new copy. Child
        charts that have a real chart session may also be saved; transit
        findings are written as standalone event records without changing the
        live calculation type.
        ``name`` (the wx Save flow's name prompt, morin._prompt_for_chart_name)
        renames the live chart + record before writing. Clears dirty state and,
        for self-anchored scratch sessions, promotes the current chart as the
        new space-reset anchor before firing the single recents event.
        """
        with self._lock:
            session = self._controller.session(document_id)
            if session is None:
                raise ValueError(f"unknown document {document_id!r}")
            if session.get('compound_kind'):
                raise ValueError("compound documents cannot be saved as horoscope records")
            is_child_chart = bool(
                session.get('parent_document_id')
                or session.get('supplementary_feature_kind')
                or session.get('launcher_kind')
            )
            cs = session.get('chart_session')
            if is_child_chart:
                chrt = getattr(cs, 'chart', None) if cs is not None else None
            else:
                if cs is not None and session.get('step_dirty'):
                    chrt = getattr(cs, 'chart', None) or getattr(cs, 'radix', None)
                else:
                    chrt = getattr(cs, 'radix', None) if cs is not None else None
                    if chrt is None:
                        chrt = getattr(cs, 'chart', None) if cs is not None else None
            if chrt is None:
                chrt = session.get('chart')
            if chrt is None:
                raise ValueError("document has no chart to save")
            explicit_target = str(path).strip() if path is not None else ""
            save_as = bool(explicit_target)
            target = explicit_target or str(session.get('fpath') or '').strip()
            if not target:
                raise ValueError("document has no file binding; use Save As")
            # Name prompt (wx _prompt_for_chart_name): rename the live chart so
            # the record, the session title, and the wheel corner all agree.
            clean_name = str(name or '').strip()
            if clean_name and clean_name != (getattr(chrt, 'name', '') or ''):
                try:
                    chrt.name = clean_name
                except Exception:
                    pass
                session['base_title'] = clean_name
                session['custom_title_root'] = clean_name
            chart_id = str(session.get('chart_id') or getattr(chrt, 'chart_id', '') or '').strip()
            if is_child_chart and chart_id:
                parent_id = str(session.get('parent_document_id') or '').strip()
                parent_chart_id = ""
                if parent_id:
                    parent_session = self._controller.session(parent_id)
                    if parent_session is not None:
                        parent_cs = parent_session.get('chart_session')
                        parent_chrt = getattr(parent_cs, 'chart', None) if parent_cs is not None else None
                        if parent_chrt is None:
                            parent_chrt = parent_session.get('chart')
                        parent_chart_id = str(
                            parent_session.get('chart_id')
                            or getattr(parent_chrt, 'chart_id', '')
                            or ''
                        ).strip()
                if parent_chart_id and chart_id == parent_chart_id:
                    chart_id = ""
            if save_as:
                chart_id = ""
            record = chartfile.chart_to_dict(chrt, chart_id=chart_id or None)
            chart_mod = export_chart_json.chart_mod
            if is_child_chart and getattr(chrt, "htype", None) == chart_mod.Chart.TRANSIT:
                record["type"] = "radix"
            notes_service.lift_legacy_record_notes(record)
            try:
                chrt.notes = ""
            except Exception:
                pass
            chartfile.update_jsonl(record, target)
            rebound = bool(path) and str(target) != str(session.get('fpath') or '')
            session['fpath'] = target
            record_id = str(record.get('id', '') or '')
            if record_id:
                session['chart_id'] = record_id
                try:
                    chrt.chart_id = record_id
                except Exception:
                    pass
                notes_service.commit_scratch_note(
                    getattr(chrt, "name", "") or "",
                    document_id,
                    record_id=record_id,
                )
            try:
                if clean_name:
                    self._controller._state.update_document(
                        document_id,
                        title=clean_name,
                        path=target,
                    )
                else:
                    self._controller._state.update_document(document_id, path=target)
            except Exception:
                pass
            if cs is not None and hasattr(cs, "mark_saved"):
                try:
                    cs.mark_saved()
                except Exception:
                    pass
            elif cs is not None:
                try:
                    cs._initial_chart = getattr(cs, "chart", None)
                    cs._initial_display_datetime = getattr(cs, "display_datetime", None)
                    cs._initial_cursor_jd = getattr(cs, "cursor_jd", None)
                except Exception:
                    pass
            session.pop('rectification_dirty', None)
            self._controller.set_dirty(document_id, edit_dirty=False, step_dirty=False)
            self._remember_recent_chart(chrt, target)
            tree = self._tree_payload()
            snapshot = None
            try:
                snapshot = self.document_snapshot(document_id, overlay_render_mode="full")
            except (ValueError, RuntimeError):
                snapshot = None
            self._manager.broadcast_threadsafe({
                "type": "documents.changed",
                "tree": tree,
            })
            result = {
                "ok": True,
                "documentId": document_id,
                "activeDocumentId": self._controller.active_document_id(),
                "path": target,
                "rebound": bool(rebound),
                "documents": tree,
            }
            if snapshot is not None:
                result["snapshot"] = snapshot
            return result

    def note_record_context(self, document_id: str) -> dict:
        """Resolve the Record identity used by the private notes sidecar."""
        with self._lock:
            session = self._controller.session(document_id)
            if session is None:
                return {"recordId": "", "sourceName": "", "documentId": "", "scratch": False}
            chrt = session.get('chart')
            cs = session.get('chart_session')
            if cs is not None:
                chrt = getattr(cs, 'radix', None) or getattr(cs, 'chart', None) or chrt
            owner_id = self._controller._document_id_for_chart(chrt) or document_id
            owner_session = self._controller.session(owner_id) or session
            record_id = str(owner_session.get('chart_id') or getattr(chrt, 'chart_id', '') or '')
            source_name = str(getattr(chrt, 'name', '') or '').strip()
            return {
                "recordId": record_id,
                "sourceName": source_name,
                "documentId": str(owner_id),
                "scratch": not bool(str(owner_session.get('fpath') or '').strip()),
            }

    def _remember_recent_chart(self, chrt, source_path: str) -> None:
        chart_mod = export_chart_json.chart_mod
        if not source_path:
            is_unsaved_ephemeral = bool(
                chrt is not None
                and getattr(chrt, "htype", None) in (chart_mod.Chart.HORARY, chart_mod.Chart.RADIX)
            )
            if not is_unsaved_ephemeral:
                return
            ref: dict[str, Any] = {
                "id": f"unsaved:{id(chrt)}",
                "label": self._ephemeral_recent_label(chrt),
                "path": "",
                "last_opened": datetime.datetime.now().strftime("%Y-%m-%d %H:%M"),
                "unsaved": True,
                "chart_ref": chrt,
            }
            ref.update(self._chart_recent_identity(chrt))
            self._unsaved_recent_chart_refs = [
                existing
                for existing in self._unsaved_recent_chart_refs
                if existing.get("chart_ref") is not chrt
            ]
            self._unsaved_recent_chart_refs.insert(0, ref)
            self._unsaved_recent_chart_refs = self._unsaved_recent_chart_refs[:24]
            return
        if not source_path:
            return
        opts = chart_snapshot_service.options
        path = str(Path(source_path).expanduser())
        canonical_dir = Path(note_storage.charts_directory()).expanduser().resolve()
        try:
            if Path(path).expanduser().resolve().parent != canonical_dir:
                return
        except Exception:
            return
        collection = Path(path).stem
        name = (getattr(chrt, "name", "") or "").strip()
        ref = {
            "label": f"{name} ({collection})" if name else collection,
            "path": path,
            "last_opened": datetime.datetime.now().strftime("%Y-%m-%d %H:%M"),
        }
        ref.update(self._chart_recent_identity(chrt))

        def same_ref(a: dict[str, Any], b: dict[str, Any]) -> bool:
            if a.get("compound_kind") or b.get("compound_kind"):
                return False
            return (a.get("path", ""), a.get("chart_id", "")) == (
                b.get("path", ""),
                b.get("chart_id", ""),
            )

        refs = []
        for existing in getattr(opts, "recent_chart_refs", []) or []:
            if isinstance(existing, dict) and not same_ref(existing, ref):
                refs.append(existing)
        refs.insert(0, ref)
        opts.recent_chart_refs = refs[:24]
        try:
            opts.saveRecentCharts()
        except Exception:
            pass

    def rebind_moved_chart_records(self, moves: list[dict[str, Any]]) -> dict[str, Any]:
        """Rebind live and persisted references after collection-file moves."""

        normalized = [dict(move) for move in moves if move.get("source") and move.get("destination")]
        if not normalized:
            return {"ok": True, "reboundDocuments": 0}

        with self._lock:
            rebound_documents = 0
            relationship_refs_changed = False
            for document in self._controller.documents():
                session = self._controller.session(document.document_id)
                if session is None:
                    continue
                session_ref = self._serializable_chart_ref_for_session(session) or {}
                move = self._moved_chart_match(session_ref, normalized)
                if move is not None:
                    destination = str(move["destination"])
                    session["fpath"] = destination
                    self._controller.state.update_document(document.document_id, path=destination)
                    rebound_documents += 1

                stored_refs = session.get("relationship_participant_refs")
                if isinstance(stored_refs, list):
                    rebound_refs, changed = self._rebind_moved_refs(stored_refs, normalized)
                    if changed:
                        session["relationship_participant_refs"] = rebound_refs
                        relationship_refs_changed = True

            opts = chart_snapshot_service.options
            recent_refs, recent_changed = self._rebind_moved_refs(
                list(getattr(opts, "recent_chart_refs", []) or []),
                normalized,
            )
            if recent_changed:
                opts.recent_chart_refs = recent_refs
                try:
                    opts.saveRecentCharts()
                except Exception:
                    pass

            startup_ref = getattr(opts, "startupchart", "")
            if isinstance(startup_ref, dict):
                rebound_startup, startup_changed = self._rebind_moved_refs(startup_ref, normalized)
                if startup_changed:
                    opts.startupchart = rebound_startup
                    try:
                        opts.saveStartupChart()
                    except Exception:
                        pass
            elif isinstance(startup_ref, str) and startup_ref:
                emptied_source_move = next(
                    (
                        move
                        for move in normalized
                        if startup_ref == str(move.get("source", "") or "")
                        and int(move.get("sourceRemainingCount", -1)) == 0
                    ),
                    None,
                )
                if emptied_source_move is not None:
                    opts.startupchart = str(emptied_source_move["destination"])
                    try:
                        opts.saveStartupChart()
                    except Exception:
                        pass

            restore_refs, restore_changed = self._rebind_moved_refs(
                list(getattr(opts, "restore_open_chart_refs", []) or []),
                normalized,
            )
            active_ref, active_changed = self._rebind_moved_refs(
                dict(getattr(opts, "restore_open_charts_active_ref", {}) or {}),
                normalized,
            )
            if restore_changed or active_changed:
                opts.restore_open_chart_refs = restore_refs
                opts.restore_open_charts_active_ref = active_ref
                try:
                    opts.saveRestoreOpenCharts()
                except Exception:
                    pass

            if rebound_documents:
                self._save_restore_open_charts_state()
                self._manager.broadcast_threadsafe(
                    {"type": "documents.changed", "tree": self._tree_payload()}
                )
            elif relationship_refs_changed:
                self._save_restore_open_charts_state()
            return {"ok": True, "reboundDocuments": rebound_documents}

    @classmethod
    def _rebind_moved_refs(
        cls,
        value: Any,
        moves: list[dict[str, Any]],
    ) -> tuple[Any, bool]:
        if isinstance(value, list):
            changed = False
            rebound_items = []
            for item in value:
                rebound, item_changed = cls._rebind_moved_refs(item, moves)
                rebound_items.append(rebound)
                changed = changed or item_changed
            return rebound_items, changed
        if not isinstance(value, dict):
            return value, False

        rebound = dict(value)
        changed = False
        participants = rebound.get("participants")
        if isinstance(participants, list):
            rebound_participants, participants_changed = cls._rebind_moved_refs(participants, moves)
            if participants_changed:
                rebound["participants"] = rebound_participants
                if rebound_participants and isinstance(rebound_participants[0], dict):
                    rebound["path"] = rebound_participants[0].get("path", rebound.get("path", ""))
                changed = True

        move = cls._moved_chart_match(rebound, moves)
        if move is not None:
            rebound["path"] = str(move["destination"])
            name = str(move.get("name", "") or rebound.get("chart_name", "") or "")
            collection = Path(str(move["destination"])).stem
            rebound["label"] = f"{name} ({collection})" if name else collection
            changed = True
        return rebound, changed

    @staticmethod
    def _moved_chart_match(
        ref: dict[str, Any],
        moves: list[dict[str, Any]],
    ) -> Optional[dict[str, Any]]:
        ref_path = str(ref.get("path", "") or "")
        if not ref_path:
            return None
        for move in moves:
            if ref_path != str(move.get("source", "") or ""):
                continue
            ref_id = str(ref.get("chart_id", ref.get("chartId", "")) or "")
            move_id = str(move.get("chartId", "") or "")
            if ref_id and move_id:
                if ref_id == move_id:
                    return move
                continue
            compared = False
            matched = True
            for ref_key, move_key in (
                ("chart_name", "name"),
                ("chart_date", "date"),
                ("chart_time", "time"),
                ("chart_place", "place"),
            ):
                ref_value = str(ref.get(ref_key, "") or "")
                move_value = str(move.get(move_key, "") or "")
                if ref_value and move_value:
                    compared = True
                    if ref_value != move_value:
                        matched = False
                        break
            if matched and compared:
                return move
        return None

    def _remember_recent_session_chart(self, session: Optional[dict]) -> None:
        if not isinstance(session, dict):
            return
        if session.get('fpath') or session.get('parent_document_id'):
            return
        chrt = session.get('chart')
        cs = session.get('chart_session')
        if cs is not None:
            chrt = (
                getattr(cs, 'radix', None)
                or getattr(cs, 'chart', None)
                or chrt
            )
        self._remember_recent_chart(chrt, "")

    def recent_charts(self) -> dict[str, Any]:
        """File > Recent Charts MRU for the native menu (morin.py:15716-15738).

        wx renders the first 12 refs of the 24-entry MRU (morin.py:15734) with
        the stored recent label, '(Untitled)' fallback (morin.py:15735). The
        daemon owns labels and ordering; the skin renders the list verbatim.
        """
        opts = chart_snapshot_service.options
        items: list[dict[str, Any]] = []
        refs = list(self._unsaved_recent_chart_refs)
        refs.extend(
            ref
            for ref in (getattr(opts, "recent_chart_refs", []) or [])
            if isinstance(ref, dict)
        )
        refs = [
            ref
            for _, ref in sorted(
                enumerate(refs),
                key=lambda indexed: (
                    str(indexed[1].get("last_opened", "") or ""),
                    -indexed[0],
                ),
                reverse=True,
            )
        ]
        for ref in refs[:12]:
            if not isinstance(ref, dict):
                continue
            path = str(ref.get("path", "") or "")
            items.append({
                "label": str(ref.get("label", "") or "") or "(%s)" % mtexts.txts.get("Untitled", "Untitled"),
                "id": str(ref.get("id", "") or ""),
                "path": path,
                "chartId": str(ref.get("chart_id", "") or ""),
                "sourceName": str(ref.get("chart_name", "") or "") or (Path(path).stem if path else ""),
                "compound": bool(ref.get("compound_kind", "")),
                "unsaved": bool(ref.get("unsaved", False)),
                "lastOpened": str(ref.get("last_opened", "") or ""),
            })
        return {"items": items}

    def _remove_recent_chart_ref(self, ref: dict[str, Any]) -> None:
        """Drop one stale MRU entry and persist — the wx stale-removal twin
        (FileHistory removes missing files, morin.py:15710-15714)."""
        opts = chart_snapshot_service.options
        opts.recent_chart_refs = [
            existing
            for existing in (getattr(opts, "recent_chart_refs", []) or [])
            if isinstance(existing, dict) and existing is not ref
        ]
        try:
            opts.saveRecentCharts()
        except Exception:
            pass

    def open_recent_chart(
        self,
        *,
        recent_id: str = "",
        path: str,
        chart_id: str = "",
        label: str = "",
    ) -> dict[str, Any]:
        """Reopen a Recent Charts entry (morin.py:15740-15778).

        Already-open ref -> activate the existing session (wx activates rather
        than duplicating, morin.py:15751-15754, 15783-15785). Compound refs
        reopen through the synastry/composite restore door (morin.py:15758-15761
        -> _open_recent_compound_ref morin.py:15780). Plain refs resolve their
        JSONL record like wx (_find_jsonl_record_index, morin.py:15770-15775)
        and re-enter through the canonical open_document door. Stale path ->
        remove the entry and raise (wx errors at morin.py:15763-15768 and its
        FileHistory removes stale entries, morin.py:15710-15714).
        """
        with self._lock:
            opts = chart_snapshot_service.options
            ref: Optional[dict[str, Any]] = None
            if recent_id:
                for candidate in self._unsaved_recent_chart_refs:
                    if (
                        isinstance(candidate, dict)
                        and str(candidate.get("id", "") or "") == recent_id
                    ):
                        ref = candidate
                        break
            if ref is not None and ref.get("unsaved"):
                chrt = ref.get("chart_ref")
                if chrt is None:
                    raise ValueError("recent unsaved chart is no longer available")
                for session in self._controller._runtime.values():
                    if session.get("chart") is chrt:
                        return {"ok": True, **self.activate_document(session["document_id"])}
                    cs = session.get("chart_session")
                    if cs is not None and getattr(cs, "chart", None) is chrt:
                        return {"ok": True, **self.activate_document(session["document_id"])}
                chart_mod = export_chart_json.chart_mod
                htype = getattr(chrt, "htype", None)
                if htype == chart_mod.Chart.HORARY:
                    display_dt = WorkspaceSessionController._chart_time_display_tuple(chrt)
                    return {
                        "ok": True,
                        **self.open_spotlight_horary(
                            chrt=chrt,
                            session_label=mtexts.txts.get("Horary", "Horary"),
                            display_datetime=display_dt or (2000, 1, 1, 0, 0, 0),
                        ),
                    }
                display_dt = WorkspaceSessionController._chart_time_display_tuple(chrt)
                return {
                    "ok": True,
                    **self.open_dirty_scratch_chart(
                        chrt=chrt,
                        session_label=getattr(chrt, "name", "") or "Chart",
                        display_datetime=display_dt or (2000, 1, 1, 0, 0, 0),
                    ),
                }
            for candidate in getattr(opts, "recent_chart_refs", []) or []:
                if not isinstance(candidate, dict):
                    continue
                if str(candidate.get("path", "") or "") != str(path or ""):
                    continue
                if candidate.get("compound_kind"):
                    if label and str(candidate.get("label", "") or "") != label:
                        continue
                elif chart_id and str(candidate.get("chart_id", "") or "") != chart_id:
                    continue
                ref = candidate
                break
            if ref is None:
                raise ValueError("recent chart entry not found")

            existing_id = self._find_open_document_id_for_ref(ref)
            if existing_id is not None:
                return {"ok": True, **self.activate_document(existing_id)}

            if ref.get("compound_kind"):
                participant_paths = [
                    str(p.get("path", "") or "")
                    for p in (ref.get("participants") or [])
                    if isinstance(p, dict)
                ]
                if any(p and not Path(p).exists() for p in participant_paths):
                    self._remove_recent_chart_ref(ref)
                    raise ValueError(
                        "A chart file for this synastry/composite no longer exists; "
                        "the recent entry was removed."
                    )
                doc_id = self._restore_compound_chart_ref(ref)
                if doc_id is None:
                    raise ValueError("the synastry/composite could not be reopened")
                return {
                    "ok": True,
                    "documentId": doc_id,
                    "activeDocumentId": self._controller.active_document_id(),
                    "documents": self._tree_payload(),
                }

            chrt, record_index, status = self._load_chart_from_ref(ref)
            if status == "missing":
                self._remove_recent_chart_ref(ref)
                raise ValueError(
                    "The chart file no longer exists; the recent entry was removed."
                )
            if status == "unresolved":
                # morin.py:15771-15775 — unmatched JSONL record errors, entry kept.
                raise ValueError("The saved chart could not be matched in this collection.")
            if status != "loaded" or chrt is None:
                raise ValueError("the recent chart could not be loaded")
            return {
                "ok": True,
                **self.open_document(
                    kind="chart",
                    source_name=getattr(chrt, "name", "") or str(ref.get("chart_name") or "Morinus"),
                    source=str(ref.get("path", "") or ""),
                    record_index=record_index,
                ),
            }

    def open_document(
        self,
        *,
        kind: str,
        source_name: str = "Morinus",
        source: Optional[str] = None,
        record_index: Optional[int] = None,
        parent_document_id: Optional[str] = None,
        feature_kind: Optional[str] = None,
        comparison_name: Optional[str] = None,
        when_iso: Optional[str] = None,
        planet_type: Optional[int] = None,
        binding_payload: Optional[dict[str, Any]] = None,
        comparison_chart=None,
        comparison_layout: Optional[str] = None,
        session_label: Optional[str] = None,
        reuse_existing: bool = False,
        include_perf: bool = False,
    ) -> dict:
        """morin.py:9526 _open_workspace_session via the controller.

        A root radix (no ``parent_document_id``) is loaded and opened
        self-anchored. A derived child is built through the supplementary
        Binding->Deriver path, then opened under its parent so the controller
        auto-indents it and gives it a re-derivable ChartSession."""
        command_started_at = time.perf_counter()
        perf = {
            "command": "workspace.open",
            "kind": kind,
            "featureKind": feature_kind,
            "phases": [],
        } if include_perf else None

        def mark_phase(name: str, started_at: float) -> None:
            if perf is not None:
                perf["phases"].append({
                    "name": name,
                    "ms": (time.perf_counter() - started_at) * 1000.0,
                })

        lock_wait_started_at = time.perf_counter()
        with self._lock:
            mark_phase("lock_wait", lock_wait_started_at)
            if parent_document_id is None:
                phase_started_at = time.perf_counter()
                source_path = (
                    str(Path(source).expanduser())
                    if source
                    else str(export_chart_json.DEFAULT_SOURCE)
                )
                dpath = str(Path(source_path).expanduser().parent) if source_path else ""
                radix = self._load_radix(source, source_name, record_index)
                self._remember_recent_chart(radix, source_path)
                mark_phase("root_load", phase_started_at)
                phase_started_at = time.perf_counter()
                chart_mod = export_chart_json.chart_mod
                session_factory = (
                    horary_session.DirtyRadixSession
                    if getattr(radix, "htype", None) == chart_mod.Chart.RADIX
                    else None
                )
                open_kwargs = {}
                if session_factory is not None:
                    open_kwargs["session_factory"] = session_factory
                document = self._controller.open_document(
                    radix,
                    fpath=source_path,
                    dpath=dpath,
                    radix=radix,
                    session_label=getattr(radix, 'name', source_name),
                    navigation_units=('day', 'hour', 'minute', 'second'),
                    **open_kwargs,
                )
                mark_phase("root_controller_open", phase_started_at)
            else:
                phase_started_at = time.perf_counter()
                document = self._open_child(
                    parent_document_id=parent_document_id,
                    feature_kind=feature_kind,
                    when_iso=when_iso,
                    planet_type=planet_type,
                    binding_payload=binding_payload,
                    comparison_chart=comparison_chart,
                    comparison_layout=comparison_layout,
                    session_label=session_label,
                    reuse_existing=reuse_existing,
                    perf=perf,
                )
                mark_phase("child_open", phase_started_at)
            phase_started_at = time.perf_counter()
            self._save_restore_open_charts_state()
            mark_phase("save_restore_state", phase_started_at)
            if document is None:
                phase_started_at = time.perf_counter()
                result = {"documentId": None, "documents": self._tree_payload()}
                mark_phase("tree_payload", phase_started_at)
            else:
                phase_started_at = time.perf_counter()
                result = self._attach_full_snapshot({
                    "documentId": document.document_id,
                    "activeDocumentId": self._controller.active_document_id(),
                    "documents": self._tree_payload(),
                }, document.document_id, include_perf=include_perf)
                mark_phase("attach_snapshot", phase_started_at)
            # Broadcast after the first drawable snapshot is attached to the
            # command result. Otherwise React sees the new active document via
            # the tree event and starts a redundant snapshot GET while this same
            # request is still rendering the command snapshot.
            phase_started_at = time.perf_counter()
            self._manager.broadcast_threadsafe({
                "type": "documents.changed",
                "tree": self._tree_payload(),
            })
            mark_phase("broadcast_documents_changed", phase_started_at)
            if perf is not None:
                perf["totalMs"] = (time.perf_counter() - command_started_at) * 1000.0
                result["debugTiming"] = perf
            return result

    @staticmethod
    def _return_average_kind(return_kind: Optional[str]) -> str:
        return solaraverage.normalize_return_average_kind(return_kind)

    @staticmethod
    def _solar_average_label(max_birthday: int, return_kind: Optional[str] = None) -> str:
        kind = WorkspaceService._return_average_kind(return_kind)
        root = solaraverage.RETURN_AVERAGE_KIND_LABELS.get(
            kind,
            solaraverage.RETURN_AVERAGE_KIND_LABELS[solaraverage.RETURN_AVERAGE_SOLAR],
        )
        return f"{root} 0-{int(max_birthday)}"

    @staticmethod
    def _solar_average_subtitle(max_birthday: int, return_kind: Optional[str] = None) -> str:
        return f"{mtexts.txts.get('Research', 'Research')} 0-{int(max_birthday)}"

    @staticmethod
    def _solar_average_binding_value(binding_payload: Optional[dict[str, Any]]):
        if not isinstance(binding_payload, dict):
            return None
        retained = binding_payload.get("retained_state")
        if not isinstance(retained, dict):
            return None
        value = retained.get("solar_average_max_birthday")
        if value is None:
            value = retained.get("max_birthday")
        return value

    @staticmethod
    def _solar_average_binding_kind(binding_payload: Optional[dict[str, Any]]) -> Optional[str]:
        if not isinstance(binding_payload, dict):
            return None
        retained = binding_payload.get("retained_state")
        if not isinstance(retained, dict):
            return None
        value = retained.get("return_average_kind")
        if value is None:
            value = retained.get("average_return_kind")
        if value is None:
            return None
        return WorkspaceService._return_average_kind(str(value))

    def _solar_average_state_for_radix(self, radix) -> dict[str, Any]:
        state = self._view_state_for_radix("solar_average", radix)
        if not state:
            return {
                "max_birthday": solaraverage.DEFAULT_SOLAR_AVERAGE_BIRTHDAY,
                "return_average_kind": solaraverage.RETURN_AVERAGE_DEFAULT_KIND,
            }
        try:
            max_birthday = int(state.get("max_birthday", solaraverage.DEFAULT_SOLAR_AVERAGE_BIRTHDAY))
        except (TypeError, ValueError):
            max_birthday = solaraverage.DEFAULT_SOLAR_AVERAGE_BIRTHDAY
        if max_birthday < 0:
            max_birthday = solaraverage.DEFAULT_SOLAR_AVERAGE_BIRTHDAY
        return {
            "max_birthday": max_birthday,
            "return_average_kind": self._return_average_kind(state.get("return_average_kind")),
        }

    def _store_solar_average_state_for_radix(
        self,
        radix,
        max_birthday: int,
        return_kind: Optional[str] = None,
    ) -> None:
        self._store_view_state_for_radix(
            "solar_average",
            radix,
            {
                "max_birthday": int(max_birthday),
                "return_average_kind": self._return_average_kind(return_kind),
            },
        )

    def _solar_average_max_birthday_for_launch(
        self,
        radix,
        binding_payload: Optional[dict[str, Any]],
    ) -> int:
        value = self._solar_average_binding_value(binding_payload)
        if value is not None:
            try:
                return max(0, int(value))
            except (TypeError, ValueError):
                pass
        return int(self._solar_average_state_for_radix(radix).get(
            "max_birthday",
            solaraverage.DEFAULT_SOLAR_AVERAGE_BIRTHDAY,
        ))

    def _solar_average_return_kind_for_launch(
        self,
        radix,
        binding_payload: Optional[dict[str, Any]],
    ) -> str:
        value = self._solar_average_binding_kind(binding_payload)
        if value is not None:
            return value
        state = self._solar_average_state_for_radix(radix)
        return self._return_average_kind(state.get("return_average_kind"))

    def _solar_average_binding_payload(
        self,
        binding_payload: Optional[dict[str, Any]],
        max_birthday: int,
        return_kind: Optional[str] = None,
    ) -> dict[str, Any]:
        return_kind = self._return_average_kind(return_kind)
        payload = dict(binding_payload or {})
        retained = dict(payload.get("retained_state") or {})
        retained["solar_average_max_birthday"] = int(max_birthday)
        retained["return_average_kind"] = return_kind
        if "marr_sidereal" not in retained:
            attr = (
                "revsidereal_marr_lunar"
                if return_kind == solaraverage.RETURN_AVERAGE_LUNAR
                else "revsidereal_marr_solar"
            )
            retained["marr_sidereal"] = bool(
                getattr(options_service.options, attr, False)
            )
        payload["feature_kind"] = "solar_average"
        payload["retained_state"] = retained
        return payload

    def _find_solar_average_session(
        self,
        *,
        parent_document_id: str,
        radix,
        max_birthday: int,
        return_kind: Optional[str] = None,
    ) -> Optional[dict]:
        return_kind = self._return_average_kind(return_kind)
        for session in self._controller._runtime.values():
            if session.get("parent_document_id") != parent_document_id:
                continue
            if session.get("supplementary_feature_kind") != "solar_average" and session.get("launcher_kind") != "solar_average":
                continue
            cs = session.get("chart_session")
            if cs is None or getattr(cs, "radix", None) is not radix:
                continue
            if int(session.get("solar_average_max_birthday", -1)) != int(max_birthday):
                continue
            retained = (session.get("supplementary_binding") or {}).get("retained_state") or {}
            session_kind = self._return_average_kind(
                session.get("return_average_kind") or retained.get("return_average_kind")
            )
            if session_kind != return_kind:
                continue
            return session
        return None

    def _find_reusable_supplementary_document(
        self,
        *,
        parent_document_id: str,
        engine_feature_kind: str,
        planet_type: Optional[int] = None,
        solar_average_max_birthday: Optional[int] = None,
        return_average_kind: Optional[str] = None,
    ):
        """Find the launcher-owned singleton child for a chart type.

        Launcher buttons/shortcuts are recall controls: one open child of a
        supplementary chart type per radix branch. Document/context-menu actions
        deliberately skip this helper so users can still create duplicates under
        a chosen child/parent tab.
        """
        for document in self._controller.documents():
            if document.parent_document_id != parent_document_id:
                continue
            session = self._controller.session(document.document_id) or {}
            if session.get("supplementary_feature_kind") != engine_feature_kind:
                continue
            if engine_feature_kind == "planetary_return":
                retained = (session.get("supplementary_binding") or {}).get("retained_state") or {}
                session_planet = session.get("planetary_return_type", retained.get("planet_type"))
                if planet_type is None or session_planet is None or int(session_planet) != int(planet_type):
                    continue
            elif engine_feature_kind == "solar_average":
                if solar_average_max_birthday is None:
                    continue
                if int(session.get("solar_average_max_birthday", -1)) != int(solar_average_max_birthday):
                    continue
                retained = (session.get("supplementary_binding") or {}).get("retained_state") or {}
                session_kind = self._return_average_kind(
                    session.get("return_average_kind") or retained.get("return_average_kind")
                )
                if session_kind != self._return_average_kind(return_average_kind):
                    continue
            self._controller.activate_document(document.document_id)
            return document
        return None

    def _set_harmonic_projection_in_place(
        self,
        document_id: str,
        *,
        mode: Any = None,
        value: Any = None,
    ) -> bool:
        """Retarget one division child without replacing its document/session.

        This is the mode/manual-entry/preset path.  It mirrors one
        SupplementaryStepper change: Binding mutates, the deriver rebuilds from
        the radix, then ChartSession emits one ``step`` paint event.
        """
        session = self._controller.session(document_id)
        if session is None or session.get("supplementary_feature_kind") != "harmonic":
            return False
        cs = session.get("chart_session")
        radix = getattr(cs, "radix", None) if cs is not None else None
        if cs is None or radix is None:
            return False

        binding = (
            supplementary_adapter.SupplementaryBinding.from_payload(
                session.get("supplementary_binding") or {},
                feature_kind="harmonic",
            )
            or supplementary_adapter.SupplementaryBinding("harmonic")
        )
        retained = dict(binding.retained_state or {})
        default_mode = harmonic_chart.normalize_projection_mode(
            getattr(self._controller.options, "harmonic_chart_mode", harmonic_chart.PROJECTION_MODE_HARMONIC)
        )
        current_mode = harmonic_chart.normalize_projection_mode(
            retained.get("projection_mode"), default=default_mode
        )
        next_mode = harmonic_chart.normalize_projection_mode(mode, default=current_mode)
        retained["projection_mode"] = next_mode
        changed = next_mode != current_mode
        if next_mode == harmonic_chart.PROJECTION_MODE_VARGA:
            current_number = harmonic_chart.normalize_varga_number(
                retained.get("varga_number", harmonic_chart.DEFAULT_VARGA)
            )
            next_number = harmonic_chart.normalize_varga_number(value, default=current_number)
            retained["varga_number"] = next_number
        else:
            current_number = harmonic_chart.normalize_harmonic_number(
                retained.get("harmonic_number", harmonic_chart.DEFAULT_HARMONIC)
            )
            next_number = harmonic_chart.normalize_harmonic_number(
                value, default=current_number
            )
            retained["harmonic_number"] = next_number
        changed = changed or next_number != current_number
        if not changed:
            return True
        binding.retained_state = retained

        when = _display_to_datetime(session.get("parent_source_datetime"))
        if when is None:
            when = _display_to_datetime(getattr(cs, "display_datetime", None))
        if when is None:
            when = datetime.datetime.now()
        built = supplementary_service.build_result(
            radix=radix,
            kind="harmonic",
            when=when,
            binding_payload=binding.to_payload(),
        )
        if built.get("chart") is None:
            return False
        self._controller._apply_supplementary_binding(session, built["binding"])
        cs.change_chart(
            built["chart"],
            display_datetime=built.get("display_datetime"),
            change_reason="step",
        )
        return True

    def _set_harmonic_number_in_place(self, document_id: str, value: Any) -> bool:
        """Compatibility wrapper for callers predating the dual-mode binding."""
        return self._set_harmonic_projection_in_place(document_id, value=value)

    def _build_solar_arc_child_result(
        self,
        radix,
        when: datetime.datetime,
        binding_payload: Optional[dict[str, Any]] = None,
    ) -> dict[str, Any]:
        target_dt = (
            int(when.year),
            int(when.month),
            int(when.day),
            int(when.hour),
            int(when.minute),
            int(when.second),
        )
        retained_payload = dict((binding_payload or {}).get("retained_state") or {})
        angle_method = posfordate.progression_angle_method(
            retained_payload.get(
                "angle_method",
                getattr(self._controller.options, "progressed_angle_method", posfordate.TRUE_SOLAR_ARC_LON),
            )
        )
        age = symbolic_time.solar_arc_age_for_real_datetime(radix, target_dt)
        _age_int, _age_years, _progressed_tuple, solar_arc_chart = posfordate.make_progressed_chart_by_symbolic_age(
            radix,
            self._controller.options,
            age,
            method=posfordate.SOLAR_ARC,
            angle_method=angle_method,
        )
        binding = supplementary_adapter.SupplementaryBinding(
            'solar_arc',
            parent_source_datetime=target_dt,
            retained_state={
                'feature_kind': 'solar_arc',
                'progression_method': posfordate.SOLAR_ARC,
                'angle_method': angle_method,
                'age': float(age),
            },
        )
        return {
            "feature_kind": "solar_arc",
            "chart": solar_arc_chart,
            "display_datetime": target_dt,
            "binding": binding,
        }

    @staticmethod
    def _parse_open_when(when_iso: Optional[str]) -> Optional[datetime.datetime]:
        if not when_iso:
            return None
        try:
            return datetime.datetime.fromisoformat(str(when_iso)).replace(tzinfo=None)
        except (TypeError, ValueError):
            return None

    @staticmethod
    def _subcharts_open_compound_default() -> bool:
        return bool(getattr(options_service.options, 'subcharts_open_compound_default', False))

    def _resolve_child_launch_context(
        self,
        *,
        parent_document_id: str,
        engine_feature_kind: str,
        public_kind: str,
        when_iso: Optional[str],
    ) -> ChildLaunchContext:
        parent_session = self._controller.session(parent_document_id)
        if parent_session is None:
            raise ValueError(f"unknown parent document {parent_document_id!r}")
        parent_cs = parent_session.get('chart_session')
        radix = None
        if parent_cs is not None:
            radix = getattr(parent_cs, 'radix', None) or getattr(parent_cs, 'chart', None)
        if radix is None:
            radix = parent_session.get('chart')
        if radix is None:
            raise ValueError("parent has no radix to derive from")

        explicit_when = self._parse_open_when(when_iso)
        if explicit_when is not None:
            if public_kind in {"solar-revolution", "lunar-revolution", "planetary-return"}:
                source_dt = _return_launch_datetime(parent_session, when_iso)
            else:
                source_dt = explicit_when
        elif parent_cs is not None:
            source_dt = self._controller._launch_reference_datetime(engine_feature_kind, parent_cs)
        else:
            source_dt = datetime.datetime.now()

        if explicit_when is None and engine_feature_kind in {"lunar_return", "planetary_return"}:
            return_anchor = self._ancestor_return_anchor_datetime(parent_session, engine_feature_kind)
            if return_anchor is not None:
                source_dt = return_anchor

        return ChildLaunchContext(
            parent_session=parent_session,
            parent_chart_session=parent_cs,
            radix=radix,
            source_datetime=source_dt,
            source_display_datetime=_datetime_to_display(source_dt),
        )

    def _ancestor_return_anchor_datetime(
        self,
        parent_session: Optional[dict[str, Any]],
        feature_kind: str,
    ) -> Optional[datetime.datetime]:
        """Keep nested cycle returns attached to the nearest same-return family.

        Lunar/planetary returns carry the selected cycle identity as
        ``raw_return_datetime``. If a user opens another return through an
        intervening derived child (for example LR -> Profections -> LR), that
        child's display cursor can be a profected/symbolic date in the past.
        The return family anchor is the retained raw return instant, not the
        intervening child's display date.
        """
        if feature_kind not in {"lunar_return", "planetary_return"}:
            return None
        visited: set[str] = set()
        current = parent_session if isinstance(parent_session, dict) else None
        while current is not None:
            document_id = str(current.get("document_id") or "")
            if document_id:
                if document_id in visited:
                    return None
                visited.add(document_id)
            if current.get("supplementary_feature_kind") == feature_kind:
                cs = current.get("chart_session")
                current_chart = getattr(cs, "chart", None) if cs is not None else current.get("chart")
                anchor = _retained_return_datetime(current, current_chart)
                if anchor is not None:
                    return anchor
            parent_id = current.get("parent_document_id")
            if parent_id is None:
                return None
            current = self._controller.session(str(parent_id))
        return None

    def _open_child(
        self,
        *,
        parent_document_id: str,
        feature_kind: Optional[str],
        when_iso: Optional[str],
        planet_type: Optional[int] = None,
        binding_payload: Optional[dict[str, Any]] = None,
        comparison_chart=None,
        comparison_layout: Optional[str] = None,
        session_label: Optional[str] = None,
        reuse_existing: bool = False,
        perf: Optional[dict[str, Any]] = None,
    ):
        def mark_child_phase(name: str, started_at: float) -> None:
            if perf is not None:
                perf.setdefault("childPhases", []).append({
                    "name": name,
                    "ms": (time.perf_counter() - started_at) * 1000.0,
                })

        # Accept either a public kind ("solar-revolution") or an engine
        # feature_kind ("solar_return"); map to the public kind the
        # supplementary service expects.
        phase_started_at = time.perf_counter()
        public_kind = feature_kind
        if feature_kind in PUBLIC_TO_FEATURE_KIND.values():
            public_kind = {v: k for k, v in PUBLIC_TO_FEATURE_KIND.items()}[feature_kind]
        if public_kind not in PUBLIC_TO_FEATURE_KIND:
            raise ValueError(f"unsupported feature kind: {feature_kind!r}")
        engine_feature_kind = PUBLIC_TO_FEATURE_KIND[public_kind]
        mark_child_phase("resolve_kind", phase_started_at)

        phase_started_at = time.perf_counter()
        launch_context = self._resolve_child_launch_context(
            parent_document_id=parent_document_id,
            engine_feature_kind=engine_feature_kind,
            public_kind=public_kind,
            when_iso=when_iso,
        )
        parent_session = launch_context.parent_session
        radix = launch_context.radix
        when = launch_context.source_datetime
        if public_kind == "solar-revolution":
            parent_cs = launch_context.parent_chart_session
            parent_chart = getattr(parent_cs, "chart", None) if parent_cs is not None else None
            parent_radix = getattr(parent_cs, "radix", None) if parent_cs is not None else None
            if parent_chart is not None and parent_chart is not parent_radix:
                binding_payload = copy.deepcopy(binding_payload) if isinstance(binding_payload, dict) else {}
                retained = dict(binding_payload.get("retained_state") or {})
                if retained.get("solar_year_mode") is None and retained.get("year_mode") is None:
                    retained["solar_year_mode"] = "containing"
                    binding_payload["retained_state"] = retained
        mark_child_phase("resolve_launch_context", phase_started_at)

        solar_average_max_birthday: Optional[int] = None
        return_average_kind: Optional[str] = None
        existing_solar_average_session: Optional[dict] = None
        if public_kind == "solar-average":
            phase_started_at = time.perf_counter()
            solar_average_max_birthday = self._solar_average_max_birthday_for_launch(
                radix,
                binding_payload,
            )
            return_average_kind = self._solar_average_return_kind_for_launch(
                radix,
                binding_payload,
            )
            binding_payload = self._solar_average_binding_payload(
                binding_payload,
                solar_average_max_birthday,
                return_average_kind,
            )
            self._store_solar_average_state_for_radix(
                radix,
                solar_average_max_birthday,
                return_average_kind,
            )
            existing_solar_average_session = self._find_solar_average_session(
                parent_document_id=parent_document_id,
                radix=radix,
                max_birthday=solar_average_max_birthday,
                return_kind=return_average_kind,
            )
            mark_child_phase("solar_average_state", phase_started_at)

        if reuse_existing:
            phase_started_at = time.perf_counter()
            reusable_document = self._find_reusable_supplementary_document(
                parent_document_id=parent_document_id,
                engine_feature_kind=engine_feature_kind,
                planet_type=planet_type,
                solar_average_max_birthday=solar_average_max_birthday,
                return_average_kind=return_average_kind,
            )
            mark_child_phase("reuse_existing_lookup", phase_started_at)
            if reusable_document is not None:
                if engine_feature_kind == "harmonic" and isinstance(binding_payload, dict):
                    requested_retained = binding_payload.get("retained_state")
                    if isinstance(requested_retained, dict) and any(
                        requested_retained.get(key) is not None
                        for key in ("projection_mode", "harmonic_number", "varga_number")
                    ):
                        requested_mode = harmonic_chart.normalize_projection_mode(
                            requested_retained.get("projection_mode"),
                            default=harmonic_chart.PROJECTION_MODE_HARMONIC,
                        )
                        requested_number = (
                            requested_retained.get("varga_number")
                            if requested_mode == harmonic_chart.PROJECTION_MODE_VARGA
                            else requested_retained.get("harmonic_number")
                        )
                        self._set_harmonic_projection_in_place(
                            reusable_document.document_id,
                            mode=requested_mode,
                            value=requested_number,
                        )
                return reusable_document

        phase_started_at = time.perf_counter()
        if public_kind == "solar-arc":
            built = self._build_solar_arc_child_result(radix, when, binding_payload=binding_payload)
        else:
            built = supplementary_service.build_result(
                radix=radix,
                kind=public_kind,
                when=when,
                binding_payload=binding_payload,
                planet_type=planet_type,
            )
        derived_chart = built["chart"]
        if derived_chart is None:
            raise RuntimeError(f"could not build {public_kind!r} child chart")
        binding = built.get("binding")
        if binding is not None:
            binding.parent_source_datetime = launch_context.source_display_datetime
        mark_child_phase("build_result", phase_started_at)

        phase_started_at = time.perf_counter()
        engine_feature_kind = built["feature_kind"]
        # Title ROOT is the chart TYPE, not the radix name (the derived chart
        # inherits radix.name, which pinned every child row to "Morinus" —
        # titles-and-naming BUG-2). The sidebar renders "<root> • <tabSuffix>",
        # matching the wx type-rooted child rows; the radix name stays visible
        # as the subtitle/parent row. Planetary returns name the body.
        raw_label = FEATURE_KIND_DISPLAY_LABELS.get(engine_feature_kind) or public_kind
        # Resolve the derived-chart title root through mtexts at serve time (the
        # module-level FEATURE_KIND_DISPLAY_LABELS holds the English source-of-truth,
        # which is also the mtexts key). English falls back to itself.
        label = mtexts.txts.get(raw_label, raw_label)
        timed_event_label = str(session_label or "").strip()
        if timed_event_label:
            label = timed_event_label
        custom_subtitle = None
        if engine_feature_kind == 'solar_average' and solar_average_max_birthday is not None:
            label = self._solar_average_label(solar_average_max_birthday, return_average_kind)
            custom_subtitle = self._solar_average_subtitle(solar_average_max_birthday, return_average_kind)
        if engine_feature_kind == 'planetary_return':
            retained_pt = planet_type
            if retained_pt is None:
                retained_pt = (getattr(built["binding"], 'retained_state', {}) or {}).get('planet_type')
            body = PLANETARY_RETURN_BODY_NAMES.get(int(retained_pt)) if retained_pt is not None else None
            if body:
                label = f"{body} {mtexts.txts.get('Return', 'Return')}"
        # A progression/direction child's DISPLAY cursor must be the exact
        # SIGNIFIED real datetime (radix + N symbolic years), NOT the progressed
        # chart's ephemeris orig date (e.g. 1988). The adapter already carries
        # that authoritative cursor alongside the derived chart; do not
        # reconstruct it from the chart's whole-second ephemeris Time.
        # ChartSession then sets BOTH display_datetime AND
        # _initial_display_datetime (chart_session.py:61-65), so the chart never
        # opens on the radix date and SPACE restores the INITIAL signified
        # (policy-time-architecture.md:59-64). Gated to the four progression
        # methods so most non-progression children (transits/returns) keep the
        # engine launch-reference seed (workspace_session_controller.py:518).
        # Profections are the exception below: their visible cursor is the
        # normalized profection source and must also become their step source.
        open_display_datetime = None
        if engine_feature_kind in _PROGRESSION_FEATURE_KINDS:
            open_display_datetime = built["display_datetime"]
        elif engine_feature_kind == 'profections':
            # A profection chart is built on the RADIX Time object, so its
            # chart.time.orig* is the BIRTH date — the corner/title must instead
            # show the PROFECTED real date (the cursor). The desktop seeds
            # cs.display_datetime to the profection source/snap datetime and draws
            # it via drawChartTimeTopLeft (graphchart.py:3609) / titles via
            # _format_profection_real_date_and_age (morin.py:5567-5585, which
            # reads cs.display_datetime). Without this seed ChartSession defaults
            # display_datetime to the chart's birth orig date (chart_session.py:
            # 61-63), so the corner would show 1988 instead of the profected year.
            # ``built["display_datetime"]`` is the adapter's normalized profection
            # source datetime (supplementary_adapter.py:641;
            # supplementary_headless_driver.py:336).
            open_display_datetime = built["display_datetime"]
            if binding is not None:
                binding.parent_source_datetime = open_display_datetime
        else:
            # EVERY other child (solar/lunar/planetary returns, transits, …)
            # seeds from the adapter's display_dt too. Returns are built on a
            # GREENWICH Time (UT digits); without this seed ChartSession falls
            # back to _chart_display_datetime(chart) = the UT digits, so the
            # chart opened showing UT and only healed on the first step (the
            # recalc path threads result.display_datetime,
            # workspace_session_controller.py:531). The adapter value is the
            # UT→radix-local conversion from engine/moment
            # (policy-chart-lifecycle display rule: local civil time, UT
            # footer-only).
            open_display_datetime = built.get("display_datetime")
        mark_child_phase("display_datetime", phase_started_at)

        open_view_mode = (
            chart_session.ChartSession.COMPOUND
            if comparison_chart is not None or self._subcharts_open_compound_default()
            else chart_session.ChartSession.CHART
        )

        if existing_solar_average_session is not None:
            phase_started_at = time.perf_counter()
            doc_id = str(existing_solar_average_session.get("document_id") or "")
            cs = existing_solar_average_session.get("chart_session")
            existing_solar_average_session["chart"] = derived_chart
            existing_solar_average_session["base_title"] = label
            existing_solar_average_session["custom_title_root"] = label
            existing_solar_average_session["custom_subtitle"] = custom_subtitle
            existing_solar_average_session["launcher_kind"] = "solar_average"
            existing_solar_average_session["solar_average_max_birthday"] = int(solar_average_max_birthday)
            existing_solar_average_session["return_average_kind"] = self._return_average_kind(return_average_kind)
            self._controller._apply_supplementary_binding(existing_solar_average_session, built["binding"])
            if cs is not None:
                cs.change_chart(derived_chart, display_datetime=open_display_datetime)
            if doc_id:
                self._controller.state.update_document(
                    doc_id,
                    title=label,
                    subtitle=custom_subtitle or "",
                )
                self._controller.activate_document(doc_id)
                mark_child_phase("reuse_existing_session", phase_started_at)
                return self._controller.state.find_document(doc_id)

        phase_started_at = time.perf_counter()
        document = self._controller.open_document(
            derived_chart,
            radix=radix,
            session_label=label,
            navigation_units=('day', 'hour', 'minute', 'second'),
            parent_document_id_override=parent_document_id,
            custom_subtitle=custom_subtitle,
            comparison_chart=comparison_chart,
            view_mode=open_view_mode,
            launcher_kind="solar_average" if engine_feature_kind == 'solar_average' else None,
            supplementary_feature_kind=engine_feature_kind,
            timed_event_title=bool(timed_event_label),
            supplementary_binding=built["binding"],
            display_datetime=open_display_datetime,
        )
        mark_child_phase("controller_open", phase_started_at)
        # Plug a wx-free stepper into the slot ChartSession already rewinds on
        # reset (chart_session.py:200-204). This is the daemon analogue of the
        # desktop StepperDlg: it owns BOTH the year/cycle step and the reset of
        # the binding offset, so "space then step" no longer preserves the stale
        # offset. Stepping for this child now flows through the same ChartSession
        # plumbing (_forward_stepper_arrow) the desktop uses.
        phase_started_at = time.perf_counter()
        if document is not None:
            child_session = self._controller.session(document.document_id)
            child_cs = child_session.get('chart_session') if child_session else None
            if child_session is not None and engine_feature_kind == 'planetary_return':
                retained = getattr(built["binding"], "retained_state", {}) or {}
                resolved_planet_type = planet_type if planet_type is not None else retained.get("planet_type")
                if resolved_planet_type is not None:
                    # wx parity: morin._workspace_open_planetary_return_from_document
                    # records these session fields for reuse/recompute paths.
                    child_session['launcher_kind'] = 'planetary_return'
                    child_session['planetary_return_type'] = int(resolved_planet_type)
            if child_session is not None and engine_feature_kind == 'solar_average' and solar_average_max_birthday is not None:
                child_session['launcher_kind'] = 'solar_average'
                child_session['solar_average_max_birthday'] = int(solar_average_max_birthday)
                child_session['return_average_kind'] = self._return_average_kind(return_average_kind)
            if child_session is not None and engine_feature_kind == 'transits':
                child_session['comparison_name'] = self._chart_label(radix, "Radix")
            elif child_session is not None and engine_feature_kind == 'converse_transits':
                child_session['comparison_name'] = self._chart_label(
                    comparison_chart if comparison_chart is not None else radix,
                    "Comparison" if comparison_chart is not None and comparison_chart is not radix else "Radix",
                )
            if child_session is not None:
                child_session['timed_event_title'] = bool(timed_event_label)
                if (
                    comparison_chart is not None
                    and comparison_layout in ('standard', 'with-houses')
                ):
                    child_session['comparison_layout'] = comparison_layout
                parent_anchor = self._controller._comparison_chart_for_parent(parent_session)
                child_session['show_radix_comparison'] = bool(
                    comparison_chart is not None
                    and comparison_chart is radix
                    and comparison_chart is not parent_anchor
                )
            if child_session is not None and child_cs is not None:
                child_cs._stepper = SupplementaryStepper(
                    controller=self._controller,
                    session=child_session,
                    cs=child_cs,
                    radix=radix,
                    feature_kind=engine_feature_kind,
                )
                if engine_feature_kind == 'converse_transits':
                    retained = getattr(built["binding"], "retained_state", {}) or {}
                    self._controller._sync_converse_symbolic_cursor_jd(
                        child_cs,
                        retained,
                    )
        mark_child_phase("session_setup", phase_started_at)
        return document

    def _parent_radix(self, parent_document_id: str):
        """The radix chart owned by a parent document (the chart a child derives
        from). Mirrors _open_child's parent-radix resolution."""
        parent_session = self._controller.session(parent_document_id)
        if parent_session is None:
            raise ValueError(f"unknown parent document {parent_document_id!r}")
        parent_cs = parent_session.get('chart_session')
        radix = None
        if parent_cs is not None:
            radix = getattr(parent_cs, 'radix', None) or getattr(parent_cs, 'chart', None)
        if radix is None:
            radix = parent_session.get('chart')
        if radix is None:
            raise ValueError("parent has no radix")
        return radix

    @staticmethod
    def _radix_view_state_key(radix) -> Optional[tuple]:
        """Source twin: morin.MFrame._radix_view_state_key.

        Key by chart input identity rather than transient document ids so a
        workspace view survives closing/reopening the same surface for the same
        chart during the daemon session.
        """
        if radix is None:
            return None
        t = getattr(radix, 'time', None)
        p = getattr(radix, 'place', None)
        if t is None or p is None:
            return None
        return (
            getattr(radix, 'name', '') or '',
            bool(getattr(radix, 'male', False)),
            int(getattr(t, 'origyear', getattr(t, 'year', 0))),
            int(getattr(t, 'origmonth', getattr(t, 'month', 0))),
            int(getattr(t, 'origday', getattr(t, 'day', 0))),
            int(getattr(t, 'hour', 0)),
            int(getattr(t, 'minute', 0)),
            int(getattr(t, 'second', 0)),
            bool(getattr(t, 'bc', False)),
            int(getattr(t, 'cal', 0)),
            getattr(p, 'place', '') or '',
            int(getattr(p, 'deglon', 0)),
            int(getattr(p, 'minlon', 0)),
            int(getattr(p, 'seclon', 0)),
            bool(getattr(p, 'east', True)),
            int(getattr(p, 'deglat', 0)),
            int(getattr(p, 'minlat', 0)),
            int(getattr(p, 'seclat', 0)),
            bool(getattr(p, 'north', True)),
            int(getattr(p, 'altitude', 0)),
        )

    def _view_state_for_radix(self, namespace: str, radix) -> dict:
        key = self._radix_view_state_key(radix)
        if key is None:
            return {}
        return dict(self._radix_view_state.get((namespace, key), {}))

    def _store_view_state_for_radix(self, namespace: str, radix, state: dict) -> None:
        key = self._radix_view_state_key(radix)
        if key is None:
            return
        self._radix_view_state[(namespace, key)] = dict(state or {})

    @staticmethod
    def _astrocart_preferences_payload(value: Any) -> dict[str, Any]:
        if not isinstance(value, dict):
            value = {}
        spec = value.get("spec")
        view = value.get("view")
        return {
            "schemaVersion": 1,
            "spec": copy.deepcopy(spec) if isinstance(spec, dict) else {},
            "view": copy.deepcopy(view) if isinstance(view, dict) else {},
        }

    def _astrocart_preferences_locked(self) -> dict[str, Any]:
        return self._astrocart_preferences_payload(
            getattr(
                chart_snapshot_service.options,
                "astrocartography_preferences",
                {},
            )
        )

    @staticmethod
    def _store_astrocart_preferences_locked(preferences: dict[str, Any]) -> None:
        chart_snapshot_service.options.astrocartography_preferences = (
            WorkspaceService._astrocart_preferences_payload(preferences)
        )

    @staticmethod
    def _save_astrocart_preferences() -> None:
        save = getattr(
            chart_snapshot_service.options,
            "saveAstrocartographyPreferences",
            None,
        )
        if callable(save):
            # Parans produces a static view POST and a canonical spec POST in
            # quick succession. Serialize their shared option-file write so two
            # FastAPI worker threads cannot truncate the pickle concurrently.
            with _ASTROCART_PREFERENCES_SAVE_LOCK:
                save()

    @staticmethod
    def _astrocart_static_spec_payload(payload: Any) -> dict[str, Any]:
        static = copy.deepcopy(payload) if isinstance(payload, dict) else {}
        static.pop("dynamicLayers", None)
        static.pop("dynamic_layers", None)
        return static

    @staticmethod
    def _astrocart_dynamic_spec_payload(payload: Any) -> dict[str, Any]:
        if not isinstance(payload, dict):
            return {"dynamicLayers": []}
        layers = payload.get("dynamicLayers", payload.get("dynamic_layers", []))
        return {
            "dynamicLayers": copy.deepcopy(layers) if isinstance(layers, list) else [],
        }

    @staticmethod
    def _astrocart_merge_unavailable_point_preferences(
        incoming: dict[str, Any],
        previous: dict[str, Any],
        available_point_ids: tuple[str, ...],
    ) -> dict[str, Any]:
        """Retain global selections a chart cannot currently represent.

        A configured asteroid or Lot may be absent from another radix's active
        catalog. Toggling Parans or another static setting on that second map
        must not silently erase the first chart's still-valid global selection.
        """
        merged = copy.deepcopy(incoming)
        available = set(available_point_ids)

        def values_at(payload: dict[str, Any], path: tuple[str, ...]) -> list[str]:
            current: Any = payload
            for key in path:
                if not isinstance(current, dict):
                    return []
                current = current.get(key)
            if not isinstance(current, list):
                return []
            return [value for value in current if isinstance(value, str)]

        def set_at(payload: dict[str, Any], path: tuple[str, ...], values: list[str]) -> None:
            current = payload
            for key in path[:-1]:
                child = current.get(key)
                if not isinstance(child, dict):
                    child = {}
                    current[key] = child
                current = child
            current[path[-1]] = values

        for path in (
            ("staticAngleLinePointIds",),
            ("paran", "participantIds"),
            ("aspects", "actorIds"),
        ):
            selected = values_at(merged, path)
            unavailable = [
                point_id
                for point_id in values_at(previous, path)
                if point_id not in available and point_id not in selected
            ]
            set_at(merged, path, selected + unavailable)
        return merged

    @staticmethod
    def _astrocart_static_view_payload(state: Any) -> dict[str, Any]:
        """Allowlist durable, non-camera, non-timing ACG view preferences."""
        if not isinstance(state, dict):
            return {}
        result: dict[str, Any] = {}
        projection = state.get("projection")
        if projection in ("globe", "mercator"):
            result["projection"] = projection
        if "lineModes" in state:
            raw_modes = state.get("lineModes")
            requested = (
                {
                    mode
                    for mode in raw_modes
                    if isinstance(mode, str) and mode in ASTROCART_MODES
                }
                if isinstance(raw_modes, list)
                else set()
            )
            normalized_modes = [
                mode for mode in ASTROCART_MODE_ORDER if mode in requested
            ]
            # An explicit empty selection is meaningful: it hides every natal
            # line mode while dynamic timing layers remain independently
            # available. Unknown-only or malformed legacy payloads still fall
            # back to the standard view.
            result["lineModes"] = (
                normalized_modes
                if normalized_modes or raw_modes == []
                else [ASTROCART_MODE_STANDARD]
            )

        overlays = state.get("overlays")
        if isinstance(overlays, dict):
            durable_overlays: dict[str, Any] = {}
            for key in (
                "asterisms",
                "aspects",
                "zeniths",
                "localSpaceOppositions",
            ):
                if isinstance(overlays.get(key), bool):
                    durable_overlays[key] = overlays[key]
            layers = overlays.get("layers")
            if isinstance(layers, dict) and isinstance(layers.get("natal"), bool):
                durable_overlays["layers"] = {
                    "natal": layers["natal"],
                }
            filters = overlays.get("filters")
            if isinstance(filters, dict):
                durable_filters = {}
                for key in ("points", "kinds", "aspects"):
                    value = filters.get(key)
                    if value is None and key in filters:
                        durable_filters[key] = None
                    elif isinstance(value, list):
                        durable_filters[key] = [
                            item for item in value if isinstance(item, str)
                        ]
                if durable_filters:
                    durable_overlays["filters"] = durable_filters
            if durable_overlays:
                result["overlays"] = durable_overlays

        legend = state.get("legend")
        if isinstance(legend, dict):
            durable_legend = {
                key: legend[key]
                for key in ("collapsed", "userSet")
                if isinstance(legend.get(key), bool)
            }
            if durable_legend:
                result["legend"] = durable_legend
        return result

    @staticmethod
    def _astrocart_transient_view_payload(state: Any) -> dict[str, Any]:
        """Retain one radix's camera and timing visibility only in daemon RAM."""
        if not isinstance(state, dict):
            return {}
        result = {
            key: copy.deepcopy(state[key])
            for key in ("zoom", "center", "bearing", "pitch")
            if key in state
        }
        overlays = state.get("overlays")
        if not isinstance(overlays, dict):
            return result
        transient_overlays: dict[str, Any] = {}
        layers = overlays.get("layers")
        if isinstance(layers, dict):
            transient_layers = {
                key: copy.deepcopy(layers[key])
                for key in ("transit", "progression")
                if key in layers
            }
            if transient_layers:
                transient_overlays["layers"] = transient_layers
        filters = overlays.get("filters")
        if isinstance(filters, dict) and "techniques" in filters:
            transient_overlays["filters"] = {
                "techniques": copy.deepcopy(filters["techniques"]),
            }
        if transient_overlays:
            result["overlays"] = transient_overlays
        return result

    @staticmethod
    def _astrocart_merge_payloads(
        base: dict[str, Any],
        overlay: dict[str, Any],
    ) -> dict[str, Any]:
        merged = copy.deepcopy(base)
        for key, value in overlay.items():
            if isinstance(value, dict) and isinstance(merged.get(key), dict):
                merged[key] = WorkspaceService._astrocart_merge_payloads(
                    merged[key],
                    value,
                )
            else:
                merged[key] = copy.deepcopy(value)
        return merged

    def _astrocart_spec_for_radix_locked(
        self,
        radix,
        *,
        incoming: Optional[dict[str, Any]] = None,
    ) -> tuple[
        astrocart_spec.AstrocartPointCatalog,
        astrocart_spec.AstrocartMapSpec,
    ]:
        """Resolve global static ACG preferences plus this radix's timing state."""
        catalog = astrocart_spec.build_point_catalog(
            radix,
            chart_snapshot_service.options,
        )
        preferences = self._astrocart_preferences_locked()
        global_static = self._astrocart_static_spec_payload(preferences["spec"])
        transient = self._view_state_for_radix("astrocart-spec", radix)
        if incoming is None:
            static_source = (
                global_static
                if global_static
                else self._astrocart_static_spec_payload(
                    astrocart_spec.AstrocartMapSpec.default_for_catalog(
                        catalog
                    ).to_payload()
                )
            )
            combined = self._astrocart_merge_payloads(
                static_source,
                self._astrocart_dynamic_spec_payload(transient),
            )
        else:
            incoming_spec = astrocart_spec.normalize_spec_for_catalog(
                incoming,
                catalog,
            )
            previous_spec = astrocart_spec.normalize_spec_for_catalog(
                (
                    global_static
                    if global_static
                    else astrocart_spec.AstrocartMapSpec.default_for_catalog(
                        catalog
                    )
                ),
                catalog,
            )
            incoming_spec = (
                astrocart_spec.enroll_newly_activated_paran_participants(
                    incoming_spec,
                    previous_spec,
                    catalog,
                )
            )
            incoming_payload = incoming_spec.to_payload()
            static_source = self._astrocart_merge_unavailable_point_preferences(
                self._astrocart_static_spec_payload(incoming_payload),
                global_static,
                catalog.point_ids,
            )
            preferences["spec"] = static_source
            self._store_astrocart_preferences_locked(preferences)
            combined = self._astrocart_merge_payloads(
                static_source,
                self._astrocart_dynamic_spec_payload(incoming_payload),
            )

        normalized = astrocart_spec.normalize_spec_for_catalog(combined, catalog)
        # Dynamic layers remain scoped to the source radix and daemon lifetime.
        # Static configuration never enters the per-radix retained-state map.
        self._store_view_state_for_radix(
            "astrocart-spec",
            radix,
            self._astrocart_dynamic_spec_payload(normalized.to_payload()),
        )
        return catalog, normalized

    def astrocart_spec_for_document(self, document_id: str) -> dict:
        """Authoritative retained ACG configuration for a workspace map."""
        with self._lock:
            parent_id = self._timed_chart_parent_document_id(document_id)
            radix = self._parent_radix(parent_id)
            catalog, spec = self._astrocart_spec_for_radix_locked(radix)
        return astrocart_service.configuration_payload_for_chart(
            radix,
            spec=spec,
            catalog=catalog,
        )

    def store_astrocart_spec_for_document(
        self,
        document_id: str,
        spec_payload: dict,
    ) -> dict:
        """Normalize and retain ACG configuration against the live radix."""
        if not isinstance(spec_payload, dict):
            raise ValueError("spec must be an object")
        with self._lock:
            previous_static = self._astrocart_preferences_locked()["spec"]
            parent_id = self._timed_chart_parent_document_id(document_id)
            radix = self._parent_radix(parent_id)
            catalog, spec = self._astrocart_spec_for_radix_locked(
                radix,
                incoming=spec_payload,
            )
            static_changed = (
                self._astrocart_preferences_locked()["spec"] != previous_static
            )
        if static_changed:
            self._save_astrocart_preferences()
        return astrocart_service.configuration_payload_for_chart(
            radix,
            spec=spec,
            catalog=catalog,
        )

    def astrocart_geojson_for_document(
        self,
        document_id: str,
        mode: Optional[str] = None,
        modes: Optional[list[str]] = None,
        precision: Optional[str] = None,
    ) -> dict:
        """ACG lines for the live chart backing an astrocart document.

        Saved chart-name lookup is not enough for workspace tabs: Here-and-Now,
        cursor, and eclipse-opened maps may have no collection row. Resolve the
        view-only astrocart document through its parent and compute from the
        in-memory chart instead.
        """
        # Resolve the immutable radix reference under the workspace lock, then
        # release it before the potentially long geometry calculation. The
        # Astrocart service has its own serialization lock; holding the global
        # workspace lock here made an invisible/refining map block chart steps.
        with self._lock:
            parent_id = self._timed_chart_parent_document_id(document_id)
            radix = self._parent_radix(parent_id)
            source_name = self._chart_label(radix, "Radix")
            catalog, spec = self._astrocart_spec_for_radix_locked(radix)
        if modes is not None:
            return astrocart_service.lines_geojson_for_chart_modes(
                radix,
                source_name=source_name,
                modes=modes,
                precision=precision,
                spec=spec,
                catalog=catalog,
            )
        return astrocart_service.lines_geojson_for_chart(
            radix,
            source_name=source_name,
            mode=mode,
            precision=precision,
            spec=spec,
            catalog=catalog,
        )

    @staticmethod
    def _astrocart_pdf_output_path(path: str) -> Path:
        raw_path = str(path or "").strip()
        if not raw_path or "\x00" in raw_path:
            raise ValueError("no astrocart PDF export path selected")
        destination = Path(raw_path).expanduser()
        if destination.suffix.lower() != ".pdf":
            destination = destination.with_suffix(".pdf")
        if not destination.parent.is_dir():
            raise ValueError(
                f"export directory does not exist: {destination.parent}"
            )
        if destination.is_dir():
            raise ValueError("astrocart PDF export path is a directory")
        return destination

    @staticmethod
    def _astrocart_pdf_download_filename(
        filename: Optional[str],
        source_name: str,
    ) -> str:
        raw_name = str(filename or "").strip()
        if "\x00" in raw_name:
            raise ValueError("astrocart PDF filename is invalid")
        candidate = Path(raw_name).name if raw_name else str(source_name or "")
        stem = (Path(candidate).stem or candidate).strip().strip(".")
        safe_stem = "".join(
            "-" if char in '<>:"/\\|?*' or ord(char) < 32 else char
            for char in stem
        ).strip().strip(".")
        if not safe_stem:
            safe_stem = "aries"
        return f"{safe_stem[:180]}.pdf"

    def export_astrocart_pdf_for_document(
        self,
        document_id: str,
        *,
        path: Optional[str] = None,
        filename: Optional[str] = None,
        mode: Optional[str] = None,
        modes: Optional[list[str]] = None,
        expected_spec_key: Optional[str] = None,
        selection: Optional[dict[str, Any]] = None,
        page_format: str = "A4",
        locale: str = "en",
        title: str = "",
        subtitle: str = "",
        chart_date: str = "",
        selection_summary: str = "",
        localized_labels: Optional[dict[str, Any]] = None,
        atlas: Optional[dict[str, Any]] = None,
    ) -> dict[str, Any]:
        """Render the retained map as a bounded print atlas.

        The workspace lock protects only document/radix/spec resolution.
        Geometry, atlas validation, style derivation, bundled resource reads,
        and ReportLab work happen after release so an export cannot stall chart
        navigation.
        """
        # ReportLab is an export-only dependency. Keep it off daemon startup
        # and routine chart/workspace paths, including the hermetic speed gate.
        from webapp.daemon import astrocart_pdf_service

        if modes is not None:
            if not isinstance(modes, (list, tuple)) or not modes:
                raise ValueError("astrocart PDF modes must be a non-empty list")
            if any(not isinstance(item, str) or not item.strip() for item in modes):
                raise ValueError("astrocart PDF modes must contain strings")
            if mode is not None:
                raise ValueError("astrocart PDF accepts either mode or modes")
            requested_modes: Optional[tuple[str, ...]] = tuple(modes)
        else:
            requested_modes = None
            if mode is not None and (
                not isinstance(mode, str) or not mode.strip()
            ):
                raise ValueError("astrocart PDF mode must be a string")

        if selection is not None and not isinstance(selection, dict):
            raise ValueError("astrocart PDF selection must be an object")
        if expected_spec_key is not None and (
            not isinstance(expected_spec_key, str)
            or not expected_spec_key.strip()
        ):
            raise ValueError("astrocart PDF expected spec key must be a string")
        try:
            normalized_selection = (
                astrocart_pdf_service.normalize_export_selection(selection)
            )
        except (TypeError, ValueError) as exc:
            raise ValueError(str(exc)) from exc

        normalized_page_format = str(page_format or "").strip().upper()
        if normalized_page_format not in astrocart_pdf_service.PAGE_FORMATS:
            raise ValueError(
                f"unsupported astrocart PDF page format: {page_format}"
            )
        if not isinstance(localized_labels, (dict, type(None))):
            raise ValueError("astrocart PDF localized labels must be an object")
        if not isinstance(atlas, (dict, type(None))):
            raise ValueError("astrocart PDF atlas must be an object")
        destination = (
            self._astrocart_pdf_output_path(path)
            if path is not None
            else None
        )

        with self._lock:
            try:
                parent_id = self._timed_chart_parent_document_id(document_id)
                radix = self._parent_radix(parent_id)
            except ValueError as exc:
                raise LookupError(str(exc)) from exc
            source_name = str(self._chart_label(radix, "Radix"))
            catalog, spec = self._astrocart_spec_for_radix_locked(radix)
            if (
                expected_spec_key is not None
                and spec.cache_key() != expected_spec_key
            ):
                raise ValueError("astrocart map changed during PDF preparation")
            pdf_color_mode = str(
                getattr(
                    getattr(radix, "options", None),
                    "pdf_chart_color_mode",
                    "monochrome",
                )
                or "monochrome"
            )

        if atlas is not None:
            atlas_mode_values = (
                requested_modes
                if requested_modes is not None
                else ((mode or ASTROCART_MODE_STANDARD),)
            )
            requested_atlas_modes: set[str] = set()
            for atlas_mode in atlas_mode_values:
                normalized_atlas_mode = atlas_mode.strip().lower()
                if normalized_atlas_mode not in ASTROCART_MODES:
                    raise ValueError(
                        f"unknown astrocartography mode: {atlas_mode}"
                    )
                requested_atlas_modes.add(normalized_atlas_mode)
            normalized_atlas_modes = tuple(
                atlas_mode
                for atlas_mode in ASTROCART_MODE_ORDER
                if atlas_mode in requested_atlas_modes
            )
            geojson = {
                "type": "FeatureCollection",
                "features": [],
                "meta": {
                    "radix": source_name,
                    "precision": "precise",
                    "modes": list(normalized_atlas_modes),
                    **(
                        {"mode": normalized_atlas_modes[0]}
                        if len(normalized_atlas_modes) == 1
                        else {}
                    ),
                },
            }
            style = None
        elif requested_modes is not None:
            geojson = astrocart_service.lines_geojson_for_chart_modes(
                radix,
                source_name=source_name,
                modes=requested_modes,
                precision="precise",
                spec=spec,
                catalog=catalog,
            )
            style = astrocart_service.display_style_for_chart(radix)
        else:
            geojson = astrocart_service.lines_geojson_for_chart(
                radix,
                source_name=source_name,
                mode=mode,
                precision="precise",
                spec=spec,
                catalog=catalog,
            )
            style = astrocart_service.display_style_for_chart(radix)
        resolved_chart_date = str(chart_date or "").strip()
        if not resolved_chart_date:
            try:
                date_text, time_text = export_chart_json.format_chart_datetime(radix)
                resolved_chart_date = " ".join(
                    value for value in (str(date_text).strip(), str(time_text).strip())
                    if value
                )
            except Exception:
                resolved_chart_date = ""
        resolved_filename = self._astrocart_pdf_download_filename(
            filename if destination is None else destination.name,
            source_name,
        )
        render_options = {
            "title": str(title or source_name),
            "client_name": source_name,
            "chart_date": resolved_chart_date,
            "subtitle": str(subtitle or ""),
            "localized_labels": copy.deepcopy(localized_labels or {}),
            "selection_summary": str(selection_summary or ""),
            "selection": normalized_selection,
            "page_format": normalized_page_format,
            "locale": str(locale or "en"),
            "style": style,
            "color_mode": pdf_color_mode,
            "atlas": atlas,
        }
        render_started_at = time.perf_counter()
        if destination is None:
            data = astrocart_pdf_service.render_astrocart_pdf_bytes(
                geojson,
                **render_options,
            )
        else:
            written = astrocart_pdf_service.write_astrocart_pdf(
                destination,
                geojson,
                **render_options,
            )
            data = None
            destination = written
        render_ms = (time.perf_counter() - render_started_at) * 1000.0

        metadata = geojson.get("meta")
        if not isinstance(metadata, dict):
            metadata = {}
        normalized_modes = metadata.get("modes")
        if not isinstance(normalized_modes, list):
            normalized_mode = metadata.get("mode")
            normalized_modes = (
                [normalized_mode]
                if isinstance(normalized_mode, str) and normalized_mode
                else list(requested_modes or ((mode or "standard"),))
            )
        byte_size = (
            len(data)
            if data is not None
            else int(destination.stat().st_size)
        )
        feature_count = (
            0
            if atlas is not None
            else astrocart_pdf_service.count_export_features(
                geojson,
                normalized_selection,
            )
        )
        atlas_bytes = astrocart_pdf_service.atlas_payload_bytes(atlas)
        atlas_page_count = len(atlas.get("pages", ())) if atlas is not None else 0
        result: dict[str, Any] = {
            "ok": True,
            "schema": astrocart_pdf_service.ASTROCART_PDF_SCHEMA,
            "schemaVersion": astrocart_pdf_service.ASTROCART_PDF_SCHEMA_VERSION,
            "kind": "pdf",
            "mimeType": "application/pdf",
            "bytes": byte_size,
            "filename": resolved_filename,
            "documentId": document_id,
            "sourceName": source_name,
            "precision": "precise",
            "modes": normalized_modes,
            "specKey": spec.cache_key(),
            "selection": normalized_selection.to_payload(),
            "featureCount": feature_count,
            "atlasBytes": atlas_bytes,
            "atlasPageCount": atlas_page_count,
            "renderMs": round(render_ms, 3),
        }
        if destination is not None:
            result["path"] = str(destination)
        else:
            result["data"] = data
        return result

    def astrocart_display_style_for_document(self, document_id: str) -> dict:
        """Live ACG colors/glyphs without recalculating line geometry."""
        with self._lock:
            parent_id = self._timed_chart_parent_document_id(document_id)
            radix = self._parent_radix(parent_id)
            return astrocart_service.display_style_for_chart(radix)

    def astrocart_asterisms_geojson_for_document(self, document_id: str) -> dict:
        """Substellar asterism figures for the live chart backing this map."""
        with self._lock:
            parent_id = self._timed_chart_parent_document_id(document_id)
            radix = self._parent_radix(parent_id)
        return astrocart_service.asterisms_geojson_for_chart(radix)

    def astrocart_view_state_for_document(self, document_id: str) -> dict:
        with self._lock:
            parent_id = self._timed_chart_parent_document_id(document_id)
            radix = self._parent_radix(parent_id)
            preferences = self._astrocart_preferences_locked()
            static_view = self._astrocart_static_view_payload(preferences["view"])
            transient_view = self._view_state_for_radix("astrocart", radix)
            state = self._astrocart_merge_payloads(static_view, transient_view)
            overlays = state.get("overlays")
            if not isinstance(overlays, dict):
                overlays = {}
                state["overlays"] = overlays
            # Parans are calculation-backed: the canonical global spec decides
            # both geometry generation and restored visibility. Read that one
            # static preference directly; rebuilding the complete point catalog
            # would put unnecessary chart work on every retained-map activation.
            static_spec = self._astrocart_static_spec_payload(preferences["spec"])
            overlays["parans"] = (
                astrocart_spec.AstrocartMapSpec.from_payload(
                    static_spec
                ).paran_enabled
                if static_spec
                else False
            )
            return {"state": state}

    def store_astrocart_view_state_for_document(
        self,
        document_id: str,
        state: dict,
        *,
        scope: str = "all",
    ) -> dict:
        if not isinstance(state, dict):
            raise ValueError("state must be an object")
        if scope not in ("camera", "global", "all"):
            raise ValueError("scope must be camera, global, or all")
        with self._lock:
            parent_id = self._timed_chart_parent_document_id(document_id)
            radix = self._parent_radix(parent_id)
            preferences = self._astrocart_preferences_locked()
            static_changed = False
            if scope in ("global", "all"):
                incoming_static = self._astrocart_static_view_payload(state)
                updated_static = self._astrocart_merge_payloads(
                    self._astrocart_static_view_payload(preferences["view"]),
                    incoming_static,
                )
                static_changed = updated_static != preferences["view"]
                preferences["view"] = updated_static
                if static_changed:
                    self._store_astrocart_preferences_locked(preferences)
            if scope in ("camera", "all"):
                current_transient = self._view_state_for_radix(
                    "astrocart",
                    radix,
                )
                self._store_view_state_for_radix(
                    "astrocart",
                    radix,
                    self._astrocart_merge_payloads(
                        current_transient,
                        self._astrocart_transient_view_payload(state),
                    ),
                )
        if static_changed:
            self._save_astrocart_preferences()
        return {"ok": True}

    def _timed_chart_parent_document_id(self, document_id: str) -> str:
        """Resolve the chart document that owns timed-row child actions.

        Direction/list documents are view-only children, so row-created charts
        are nested under the list's immediate parent chart. Search rows can be
        hosted directly in the active chart right pane, so a chart-owning
        document is its own parent. This keeps return-hosted lists opening
        transit children under the return node instead of jumping back to the
        branch radix.
        """
        session = self._controller.session(document_id)
        if session is None:
            raise ValueError(f"unknown timed-chart document {document_id!r}")
        if session.get('chart_session') is not None:
            return document_id
        parent_id = session.get('parent_document_id')
        if parent_id:
            return str(parent_id)
        if session.get('chart') is not None:
            return document_id
        raise ValueError("timed-chart document has no parent chart")

    def _owning_radix_document_id(self, document_id: str) -> str:
        """Resolve the workspace document that owns the natal radix.

        Timed-row actions deliberately stop at the immediate chart (for example
        ``radix -> solar return -> directions`` stays attached to the return).
        Rectification is different: it always edits the natal chart, so resolve
        the live ``ChartSession.radix`` object back to its owning document.
        """
        chart_document_id = self._timed_chart_parent_document_id(document_id)
        session = self._controller.session(chart_document_id)
        if session is None:
            raise ValueError(f"unknown radix source document {chart_document_id!r}")
        cs = session.get('chart_session')
        radix = getattr(cs, 'radix', None) if cs is not None else None
        if radix is None:
            radix = session.get('chart') or (getattr(cs, 'chart', None) if cs is not None else None)
        owner_id = self._controller._document_id_for_chart(radix)
        if owner_id is None:
            raise ValueError("radix source has no owning workspace document")
        return str(owner_id)

    def _timed_chart_parent_chart(self, parent_document_id: str):
        """Live chart for the timed-row parent document.

        For ``radix -> solar return -> list -> Open as Transit``, this returns
        the solar return chart. The branch radix remains available through
        ``_parent_radix`` for calculation identity.
        """
        parent_session = self._controller.session(parent_document_id)
        if parent_session is None:
            raise ValueError(f"unknown timed-chart parent {parent_document_id!r}")
        parent_cs = parent_session.get("chart_session")
        if parent_cs is not None and getattr(parent_cs, "chart", None) is not None:
            return parent_cs.chart
        chrt = parent_session.get("chart")
        if chrt is not None:
            return chrt
        raise ValueError("timed-chart parent has no chart")

    def _timed_chart_when_iso(
        self,
        *,
        parent_document_id: str,
        when_iso: str,
        event_jd: Optional[float] = None,
        time_context: Optional[dict[str, Any]] = None,
    ) -> str:
        """Resolve the selected timed row's exact event moment.

        Primary Directions rows expose the engine ``pd.time`` Julian day. That
        is the wx source of truth for Open as Chart/Transit
        (primdirslistwnd.py:_pd_event_datetime_for_menu), so prefer it over any
        date-only display string sent by the React table.

        Eclipses rows already serialize the chart-moment as local civil
        ``eventDatetime`` plus the matching zone ``timeContext`` from
        eclipses.local_datetime_tuple_and_context. Do not reinterpret those
        actions through ``eventJd``; the wx row handlers pass that local datetime
        and context directly to morin.open_transits_for_event_date /
        morin.open_chart_for_event_date.
        """
        if isinstance(time_context, dict) and time_context:
            return str(when_iso or "")
        if event_jd is not None:
            try:
                jd = float(event_jd)
            except (TypeError, ValueError):
                jd = None
            if jd is not None and math.isfinite(jd):
                # PD/search event dates are modern Gregorian; pass the chart.Time
                # GREGORIAN enum (0), which _jd_to_calendar_datetime now maps to
                # SE_GREG_CAL. (Previously this passed a raw 1 that worked only
                # because the helper forwarded the SE flag unmapped; the helper
                # now takes the chart enum like every other caller.)
                event_dt = self._jd_to_calendar_datetime(
                    jd, export_chart_json.chart_mod.Time.GREGORIAN
                )
                if event_dt is not None:
                    # swe_revjul yields UT digits. The consumers
                    # (_open_exact_event_chart / _open_timed_transit_chart /
                    # supplementary when) interpret the digits as LOCAL civil
                    # time under the owning chart's zone, so convert UT to the
                    # timed-row parent chart's local clock first.
                    # first (policy-chart-lifecycle: displayed chart time is
                    # always local; UT only in the footer). wx leaks UT here
                    # (primdirslistwnd.py:1058 raw swe_revjul digits into
                    # morin.open_transits_for_event_date's zone Time,
                    # morin.py:10031) — deliberate documented divergence: we
                    # fix the instant AND the display instead of porting the
                    # defect.
                    try:
                        radix = self._timed_chart_parent_chart(parent_document_id)
                    except ValueError:
                        radix = None
                    local_dt = (
                        self._display_datetime_for_chart_instant(radix, event_dt)
                        if radix is not None
                        else None
                    )
                    return "%04d-%02d-%02dT%02d:%02d:%02d" % (local_dt or event_dt)
        return str(when_iso or "")

    @staticmethod
    def _time_context_fields(radix, time_context: Optional[dict[str, Any]] = None) -> tuple[int, bool, int, int, bool, str, bool]:
        ctx = time_context if isinstance(time_context, dict) else {}
        radix_time = getattr(radix, 'time', None)
        try:
            zt = int(ctx.get('zt', getattr(radix_time, 'zt', 0)))
        except Exception:
            zt = int(getattr(radix_time, 'zt', 0) or 0)
        plus = bool(ctx.get('plus', getattr(radix_time, 'plus', True)))
        try:
            zh = int(abs(ctx.get('zh', getattr(radix_time, 'zh', 0)) or 0))
        except Exception:
            zh = int(abs(getattr(radix_time, 'zh', 0) or 0))
        try:
            zm = int(abs(ctx.get('zm', getattr(radix_time, 'zm', 0)) or 0))
        except Exception:
            zm = int(abs(getattr(radix_time, 'zm', 0) or 0))
        daylightsaving = bool(ctx.get('daylightsaving', getattr(radix_time, 'daylightsaving', False)))
        tzid = str(ctx.get('tzid', getattr(radix_time, 'tzid', '') or '') or '')
        tzauto = bool(ctx.get('tzauto', getattr(radix_time, 'tzauto', False)))
        return zt, plus, zh, zm, daylightsaving, tzid, tzauto

    def open_dirty_scratch_chart(
        self,
        *,
        chrt,
        session_label: str,
        display_datetime: tuple[int, int, int, int, int, int],
        tab_suffix_datetime: Optional[tuple[int, int, int, int, int, int]] = None,
    ) -> dict:
        """Open a standalone dirty scratch chart through the normal workspace path.

        Source contract: ``morin._open_exact_chart_for_event_date`` creates a
        root RADIX chart whose ``chart.name`` remains empty, supplies a workspace
        session label, uses the chart as its own radix, marks edit-dirty, and
        activates it. The scratch chart is not a transit/supplementary child.
        """
        with self._lock:
            y, m, d, h, mi, s = [int(v) for v in tuple(display_datetime)[:6]]
            document = self._controller.open_document(
                chrt,
                radix=chrt,
                session_label=session_label,
                view_mode=chart_session.ChartSession.CHART,
                display_datetime=(y, m, d, h, mi, s),
                dirty=True,
                session_factory=horary_session.DirtyRadixSession,
            )
            if document is not None:
                session = self._controller.session(document.document_id)
                if session is not None:
                    session["scratch_launch_uses_wall_clock"] = True
                    if tab_suffix_datetime is not None:
                        session["custom_tab_suffix_datetime"] = tuple(
                            int(v) for v in tuple(tab_suffix_datetime)[:6]
                        )
                    cs = session.get("chart_session")
                    if cs is not None:
                        cs._launch_with_wall_clock_when_unset = True
            # wx remembers an unsaved ephemeral chart in the recent list at OPEN
            # time (morin.py:9760 spotlight horary, 14928 Here-and-Now), not only
            # on close; mirror that so a freshly opened scratch chart shows in
            # Recent Charts immediately. The htype predicate inside
            # _remember_recent_chart gates HORARY/RADIX, so this is a no-op for
            # any other chart type.
            self._remember_recent_chart(chrt, "")
            self._manager.broadcast_threadsafe({
                "type": "documents.changed",
                "tree": self._tree_payload(),
            })
            self._save_restore_open_charts_state()
            if document is None:
                return {"documentId": None, "documents": self._tree_payload()}
            return self._attach_full_snapshot({
                "documentId": document.document_id,
                "activeDocumentId": self._controller.active_document_id(),
                "documents": self._tree_payload(),
            }, document.document_id)

    def _open_exact_event_chart(
        self,
        parent_document_id: str,
        when_iso: str,
        *,
        time_context: Optional[dict[str, Any]] = None,
        session_label: Optional[str] = None,
    ) -> dict:
        """Open wx Search/Direction 'Open as Chart' as a fresh exact chart."""
        radix = self._parent_radix(parent_document_id)
        try:
            when = datetime.datetime.fromisoformat(str(when_iso or ""))
        except (TypeError, ValueError) as exc:
            raise ValueError(f"invalid timed-chart datetime {when_iso!r}") from exc
        chart_mod = export_chart_json.chart_mod
        y, m, d = int(when.year), int(when.month), int(when.day)
        h, mi, s = int(when.hour), int(when.minute), int(when.second)
        ctx = time_context if isinstance(time_context, dict) else {}
        place = ctx.get('place') if isinstance(ctx.get('place'), chart_mod.Place) else radix.place
        zt, plus, zh, zm, daylightsaving, tzid, tzauto = self._time_context_fields(radix, time_context)
        time = chart_mod.Time(
            y, m, d, h, mi, s,
            False, radix.time.cal, zt,
            plus, zh, zm,
            daylightsaving, place, False,
            tzid=tzid,
            tzauto=tzauto,
        )
        exact_chart = chart_factory.build_chart(
            '', True, time, place, chart_mod.Chart.RADIX, '',
            chart_snapshot_service.options, False,
        )
        custom_label = str(session_label or "").strip()
        if custom_label:
            label = custom_label
            tab_suffix_datetime = (y, m, d, h, mi, s)
        else:
            month = common.common.months[m - 1] if 1 <= m <= len(common.common.months) else f"{m:02d}"
            date_txt = dateformat.date_text_named_month(
                y, month, d, chart_snapshot_service.options, pad_day=False)
            label = "%s (%s %02d:%02d)" % (mtexts.txts.get("Chart", "Chart"), date_txt, h, mi)
            tab_suffix_datetime = None
        return self.open_dirty_scratch_chart(
            chrt=exact_chart,
            session_label=label,
            display_datetime=(y, m, d, h, mi, s),
            tab_suffix_datetime=tab_suffix_datetime,
        )

    def _open_timed_transit_chart(
        self,
        parent_document_id: str,
        when_iso: str = "",
        *,
        display_datetime: Optional[tuple[int, int, int, int, int, int]] = None,
        calendar: Optional[int] = None,
        time_context: Optional[dict[str, Any]] = None,
        session_label: Optional[str] = None,
        show_radix: bool = False,
        calculation_base=None,
        comparison_override=None,
        force_compound: Optional[bool] = None,
        comparison_layout: Optional[str] = None,
    ) -> dict:
        """Open wx commonwnd 'Open as Transit' at the selected event moment.

        The optional ``time_context`` carries the event-local zone fields from
        eclipse rows (eclipses.local_datetime_tuple_and_context), mirroring
        morin.open_transits_for_event_date(..., time_context=...).
        """
        with self._lock:
            radix = self._parent_radix(parent_document_id)
            compound_base = calculation_base or self._timed_chart_parent_chart(parent_document_id)
            open_as_compound = (
                bool(force_compound)
                if force_compound is not None
                else self._subcharts_open_compound_default() or bool(show_radix)
            )
            comparison_chart = (
                comparison_override
                if comparison_override is not None
                else radix if show_radix else compound_base
            )
            if display_datetime is not None:
                try:
                    y, m, d, h, mi, s = [
                        int(value) for value in tuple(display_datetime)[:6]
                    ]
                    datetime.date(y, m, d)
                except (TypeError, ValueError) as exc:
                    raise ValueError("invalid timed-chart datetime fields") from exc
            else:
                try:
                    when = datetime.datetime.fromisoformat(str(when_iso or ""))
                except (TypeError, ValueError) as exc:
                    raise ValueError(f"invalid timed-chart datetime {when_iso!r}") from exc
                y, m, d = int(when.year), int(when.month), int(when.day)
                h, mi, s = int(when.hour), int(when.minute), int(when.second)
            chart_mod = export_chart_json.chart_mod
            place = time_context.get('place') if isinstance(time_context, dict) and isinstance(time_context.get('place'), chart_mod.Place) else compound_base.place
            zt, plus, zh, zm, daylightsaving, tzid, tzauto = self._time_context_fields(compound_base, time_context)
            calendar_value = (
                int(calendar)
                if calendar in (chart_mod.Time.GREGORIAN, chart_mod.Time.JULIAN)
                else int(compound_base.time.cal)
            )
            time = chart_mod.Time(
                y, m, d, h, mi, s,
                False, calendar_value, zt,
                plus, zh, zm,
                daylightsaving, place, False,
                tzid=tzid,
                tzauto=tzauto,
            )
            trans = chart_factory.build_chart(
                compound_base.name,
                getattr(compound_base, "male", True),
                time,
                place,
                chart_mod.Chart.TRANSIT,
                "",
                chart_snapshot_service.options,
                False,
            )
            label = str(session_label or "").strip() or self._workspace_timed_label(
                mtexts.typeList[chart_mod.Chart.TRANSIT], y, m, d, h, mi, s
            )
            document = self._controller.open_document(
                trans,
                radix=radix,
                session_label=label,
                view_mode=(
                    chart_session.ChartSession.COMPOUND
                    if open_as_compound
                    else chart_session.ChartSession.CHART
                ),
                navigation_units=('day', 'hour', 'minute', 'second'),
                navigation_title_label=mtexts.typeList[chart_mod.Chart.TRANSIT],
                display_datetime=(y, m, d, h, mi, s),
                comparison_chart=comparison_chart,
                parent_document_id_override=parent_document_id,
                launcher_kind='transits',
                supplementary_feature_kind='transits',
                timed_event_title=bool(str(session_label or "").strip()),
                dirty=False,
            )
            if document is not None:
                session = self._controller.session(document.document_id)
                if session is not None:
                    session['timed_event_title'] = bool(str(session_label or "").strip())
                    session['comparison_name'] = self._chart_label(
                        comparison_chart if comparison_override is not None else radix,
                        "Comparison" if comparison_override is not None else "Radix",
                    )
                    session['show_radix_comparison'] = bool(
                        show_radix
                        and comparison_chart is radix
                        and comparison_chart is not compound_base
                    )
                    if (
                        open_as_compound
                        and comparison_layout in ('standard', 'with-houses')
                    ):
                        session['comparison_layout'] = comparison_layout
            self._manager.broadcast_threadsafe({
                "type": "documents.changed",
                "tree": self._tree_payload(),
            })
            self._save_restore_open_charts_state()
            if document is None:
                return {"documentId": None, "documents": self._tree_payload()}
            return self._attach_full_snapshot({
                "documentId": document.document_id,
                "activeDocumentId": self._controller.active_document_id(),
                "documents": self._tree_payload(),
            }, document.document_id)

    def _open_converse_timed_transit_chart(
        self,
        parent_document_id: str,
        physical_when_iso: str,
        *,
        symbolic_when_iso: str,
        symbolic_event_jd: Optional[float],
        time_context: Optional[dict[str, Any]] = None,
        show_radix: bool = False,
    ) -> dict:
        """Open a converse row as a dual-clock supplementary transit.

        ``symbolic_when_iso`` is the saved event-list clock and owns the
        header/navigation cursor. ``physical_when_iso`` remains the row's real
        prenatal chart time; the adapter re-derives that physical instant from
        the exact symbolic JD so every subsequent step keeps both clocks paired.
        """
        try:
            symbolic_when = datetime.datetime.fromisoformat(
                str(symbolic_when_iso or "")
            )
            # Validate the physical row contract even though the canonical
            # deriver recomputes it from the exact mirrored symbolic JD.
            datetime.datetime.fromisoformat(str(physical_when_iso or ""))
        except (TypeError, ValueError) as exc:
            raise ValueError("invalid converse-transit timed-chart datetime") from exc

        with self._lock:
            radix = self._parent_radix(parent_document_id)
            compound_base = self._timed_chart_parent_chart(parent_document_id)
            open_as_compound = (
                self._subcharts_open_compound_default() or bool(show_radix)
            )
            comparison_chart = radix if show_radix else compound_base

            physical_ctx = time_context if isinstance(time_context, dict) else {}
            physical_place = (
                physical_ctx.get("place")
                if isinstance(physical_ctx.get("place"), export_chart_json.chart_mod.Place)
                else compound_base.place
            )
            (
                physical_zt,
                physical_plus,
                physical_zh,
                physical_zm,
                physical_daylight,
                physical_tzid,
                physical_tzauto,
            ) = self._time_context_fields(compound_base, physical_ctx)

            symbolic_clock = table_event_clock(chart_snapshot_service.options)
            symbolic_place = default_location_model.place_from_options(
                chart_snapshot_service.options
            )
            symbolic_fields = symbolic_clock.local_zone_fields((
                symbolic_when.year,
                symbolic_when.month,
                symbolic_when.day,
                symbolic_when.hour,
                symbolic_when.minute,
                symbolic_when.second,
            ))
            symbolic_is_ut = symbolic_clock.basis == EVENT_TABLE_TIME_UT
            symbolic_zt = (
                export_chart_json.chart_mod.Time.GREENWICH
                if symbolic_is_ut
                else export_chart_json.chart_mod.Time.ZONE
            )
            symbolic_tuple = (
                symbolic_when.year,
                symbolic_when.month,
                symbolic_when.day,
                symbolic_when.hour,
                symbolic_when.minute,
                symbolic_when.second,
            )
            retained = {
                "converse_enabled": True,
                "display_datetime": symbolic_tuple,
                "symbolic_cursor_datetime": symbolic_tuple,
                "symbolic_place_payload": supplementary_adapter.place_to_payload(
                    symbolic_place
                ),
                "symbolic_cal": int(compound_base.time.cal),
                "symbolic_zt": int(symbolic_zt),
                "symbolic_plus": True if symbolic_is_ut else bool(symbolic_fields["plus"]),
                "symbolic_zh": 0 if symbolic_is_ut else int(symbolic_fields["zh"]),
                "symbolic_zm": 0 if symbolic_is_ut else int(symbolic_fields["zm"]),
                "symbolic_daylight": False if symbolic_is_ut else bool(
                    symbolic_fields["daylightsaving"]
                ),
                "symbolic_tzid": "" if symbolic_is_ut else str(
                    symbolic_fields.get("tzid") or symbolic_clock.zone_id or ""
                ),
                "symbolic_tzauto": False if symbolic_is_ut else bool(
                    symbolic_fields.get("tzauto", symbolic_clock.automatic)
                ),
                "physical_place_payload": supplementary_adapter.place_to_payload(
                    physical_place
                ),
                "physical_cal": int(compound_base.time.cal),
                "physical_zt": int(physical_zt),
                "physical_plus": bool(physical_plus),
                "physical_zh": int(physical_zh),
                "physical_zm": int(physical_zm),
                "physical_daylight": bool(physical_daylight),
                "physical_tzid": str(physical_tzid or ""),
                "physical_tzauto": bool(physical_tzauto),
            }
            try:
                exact_symbolic_jd = float(symbolic_event_jd)
            except (TypeError, ValueError):
                exact_symbolic_jd = None
            if exact_symbolic_jd is not None and math.isfinite(exact_symbolic_jd):
                retained["symbolic_cursor_jd"] = exact_symbolic_jd
            binding_payload = {
                "feature_kind": "converse_transits",
                "parent_source_datetime": symbolic_tuple,
                "retained_state": retained,
            }
            session_label = mtexts.txts.get(
                "ConverseTransits",
                "Converse Transits",
            )

        return self.open_document(
            kind="supplementary",
            parent_document_id=parent_document_id,
            feature_kind="converse-transits",
            when_iso=symbolic_when.isoformat(),
            binding_payload=binding_payload,
            comparison_chart=comparison_chart if open_as_compound else None,
            session_label=session_label,
        )

    def _open_pd_aspect_perfection(
        self,
        *,
        owner_document_id: str,
        display_datetime: tuple[int, int, int, int, int, int],
        comparison_chart=None,
        comparison_layout: Optional[str] = None,
    ) -> dict:
        """Open a PD-in-Chart perfection through its canonical cursor builder."""
        with self._lock:
            owner = self._controller.session(owner_document_id)
            if owner is None or owner.get("launcher_kind") != "pd_in_chart":
                raise ValueError("Aspect List PD trajectory is no longer available")
            owner_cs = owner.get("chart_session")
            radix = getattr(owner_cs, "radix", None) if owner_cs is not None else None
            if radix is None:
                raise ValueError("Aspect List PD trajectory has no radix")
            when = datetime.datetime(*[int(value) for value in display_datetime[:6]])
            built = self._build_pd_in_chart_for_cursor(owner, when)
            if built is None:
                raise ValueError("Aspect List PD perfection could not be built")
            pd_chart, arc = built
            label = str(
                owner.get("custom_title_root")
                or owner.get("base_title")
                or mtexts.txts.get("PDsInChart", "PDs in Chart")
            ).strip()
            document = self._controller.open_document(
                pd_chart,
                radix=radix,
                session_label=label,
                view_mode=(
                    chart_session.ChartSession.COMPOUND
                    if comparison_chart is not None
                    else chart_session.ChartSession.CHART
                ),
                display_datetime=display_datetime,
                comparison_chart=comparison_chart,
                parent_document_id_override=owner.get("parent_document_id"),
                launcher_kind="pd_in_chart",
                dirty=False,
            )
            if document is not None:
                session = self._controller.session(document.document_id)
                if session is not None:
                    binding = copy.deepcopy(owner.get("pd_in_chart_binding") or {})
                    binding.update({
                        "initialArc": abs(float(arc)),
                        "currentArc": abs(float(arc)),
                        "exactArc": abs(float(arc)),
                        "initialDisplayDatetime": tuple(display_datetime),
                        "hasEventDatetime": True,
                    })
                    session["pd_in_chart_binding"] = binding
                    session["option_refresh_handler"] = self._refresh_pd_in_chart_options
                    if (
                        comparison_chart is not None
                        and comparison_layout in ('standard', 'with-houses')
                    ):
                        session['comparison_layout'] = comparison_layout
                    if owner.get("chart_visual_mode") == _CHART_VISUAL_MUNDANE:
                        session["chart_visual_mode"] = _CHART_VISUAL_MUNDANE
            self._manager.broadcast_threadsafe({
                "type": "documents.changed",
                "tree": self._tree_payload(),
            })
            self._save_restore_open_charts_state()
            if document is None:
                return {"documentId": None, "documents": self._tree_payload()}
            return self._attach_full_snapshot({
                "documentId": document.document_id,
                "activeDocumentId": self._controller.active_document_id(),
                "documents": self._tree_payload(),
            }, document.document_id)

    def open_aspect_perfection(
        self,
        *,
        document_id: str,
        mode: str,
        event_jd: float,
        expected_context_key: Optional[str] = None,
        action: str = "exact",
        show_radix: Optional[bool] = None,
        preserve_source_frame: bool = False,
    ) -> dict:
        """Open the exact event represented by an Aspect List row.

        Within-chart views open a standalone exact chart. Cross-chart views
        preserve the comparison structure, independent of endpoint type. The
        explicit generic menu alternatives retain the same validated row and
        instant, then use the canonical timed-chart builders.
        """
        with self._lock:
            context = self.table_context(document_id, requested_table_id="aspect_list")
            primary = context.get("chart")
            outer = context.get("comparison_chart")
            role_contexts = context.get("role_contexts") or {}
            if primary is None:
                raise ValueError("Aspect List document has no primary chart")
            if mode not in ("primary", "outer", "outerToPrimary", "primaryToOuter"):
                raise ValueError("unknown Aspect List view")
            action = str(action or "exact")
            if action not in ("exact", "solar", "transits", "secondary", "chart"):
                raise ValueError("unknown Aspect List perfection action")
            if mode != "primary" and outer is None:
                raise ValueError("Aspect List comparison chart is no longer available")
            if expected_context_key is not None:
                from .aspect_list_service import aspect_list_context_key

                current_context_key = aspect_list_context_key(context, mode)
                if not expected_context_key or current_context_key != str(expected_context_key):
                    raise ValueError("Aspect List context changed; refresh the list")

            exact_role = (
                "outer" if mode in ("outer", "outerToPrimary", "primaryToOuter")
                else "primary"
            )
            calculation_base = outer if exact_role == "outer" else primary
            role_context = role_contexts.get(exact_role) or {}
            trajectory_kind = str(role_context.get("trajectoryKind") or "physical")
            try:
                exact_jd = float(event_jd)
            except (TypeError, ValueError) as exc:
                raise ValueError("invalid Aspect List perfection time") from exc
            if not math.isfinite(exact_jd):
                raise ValueError("invalid Aspect List perfection time")
            calendar = int(role_context.get("calendar", calculation_base.time.cal) or 0)
            decoded_datetime = self._jd_to_calendar_datetime(exact_jd, calendar)
            if decoded_datetime is None:
                raise ValueError("Aspect List perfection time could not be decoded")
            feature_kind = str(role_context.get("featureKind") or "")
            exact_binding_payload = copy.deepcopy(role_context.get("binding") or {})
            if trajectory_kind in ("supplementary", "pd_in_chart"):
                if (
                    trajectory_kind == "supplementary"
                    and feature_kind == "converse_transits"
                ):
                    candidate = self._aspect_converse_candidate(
                        exact_binding_payload,
                        calculation_base,
                        exact_jd,
                    )
                    if candidate is None:
                        raise ValueError(
                            "Aspect List perfection time could not be decoded"
                        )
                    display_datetime, exact_binding_payload = candidate
                else:
                    display_datetime = tuple(decoded_datetime)
                zone = {}
            else:
                zone = moment.utc_to_place_local_zone(
                    decoded_datetime, calculation_base.place,
                ) or {}
                display_datetime = tuple(zone.get("datetime") or decoded_datetime)
            is_cross = mode in ("outerToPrimary", "primaryToOuter")
            comparison_layout = str(
                (context.get("aspect_context") or {}).get("comparisonLayout") or ""
            )
            if comparison_layout not in ('standard', 'with-houses'):
                comparison_layout = 'standard'
            if trajectory_kind in ("static", "unsupported"):
                raise ValueError("This chart role has no supported perfection trajectory")
            if action != "exact":
                # Generic alternatives are deliberate destinations, but they
                # still originate from the validated relationship row. Cross-
                # chart actions attach to the displayed primary chart; within-
                # chart actions attach to the selected role. Physical rows keep
                # their absolute JD, while symbolic/PD trajectories keep their
                # canonical civil timeline rather than being reinterpreted as
                # a physical UT Julian day.
                action_role = "primary" if is_cross else exact_role
                action_role_context = role_contexts.get(action_role) or {}
                action_document_id = str(
                    action_role_context.get("ownerDocumentId") or document_id
                )
                action_when = datetime.datetime(
                    *[int(value) for value in display_datetime[:6]]
                ).isoformat()
                if action == "secondary":
                    return self.open_directions_secondary_chart(
                        directions_document_id=action_document_id,
                        when_iso=action_when,
                        symbolic_event_jd=exact_jd,
                    )
                return self.open_directions_timed_chart(
                    directions_document_id=action_document_id,
                    action=action,
                    when_iso=action_when,
                    event_jd=(exact_jd if trajectory_kind == "physical" else None),
                    show_radix=show_radix,
                )
            if trajectory_kind == "supplementary":
                parent_document_id = str(role_context.get("parentDocumentId") or "")
                if not parent_document_id or feature_kind not in _ASPECT_SYMBOLIC_FEATURE_KINDS:
                    raise ValueError("Aspect List symbolic trajectory is no longer available")
                return self.open_document(
                    kind="supplementary",
                    parent_document_id=parent_document_id,
                    feature_kind=feature_kind,
                    when_iso=datetime.datetime(*display_datetime[:6]).isoformat(),
                    binding_payload=exact_binding_payload,
                    comparison_chart=primary if is_cross else None,
                    comparison_layout=comparison_layout if is_cross else None,
                )
            if trajectory_kind == "pd_in_chart":
                owner_document_id = str(role_context.get("ownerDocumentId") or "")
                if not owner_document_id:
                    raise ValueError("Aspect List PD trajectory is no longer available")
                return self._open_pd_aspect_perfection(
                    owner_document_id=owner_document_id,
                    display_datetime=tuple(int(value) for value in display_datetime[:6]),
                    comparison_chart=primary if is_cross else None,
                    comparison_layout=comparison_layout if is_cross else None,
                )
            time_context = {
                "place": calculation_base.place,
                "zt": export_chart_json.chart_mod.Time.ZONE,
                "plus": bool(zone.get("plus", True)),
                "zh": int(zone.get("zh", 0) or 0),
                "zm": int(zone.get("zm", 0) or 0),
                "daylightsaving": bool(zone.get("daylightsaving", False)),
                "tzid": str(zone.get("tzid") or ""),
                "tzauto": bool(zone.get("tzid")),
            }
            parent_document_id = str(role_context.get("ownerDocumentId") or document_id)
            if mode in ("primary", "outer"):
                if preserve_source_frame:
                    return self._open_timed_transit_chart(
                        parent_document_id,
                        "",
                        display_datetime=display_datetime,
                        calendar=calendar,
                        time_context=time_context,
                        calculation_base=calculation_base,
                        comparison_override=calculation_base,
                        force_compound=True,
                        comparison_layout=comparison_layout,
                    )
                return self._open_timed_transit_chart(
                    parent_document_id,
                    "",
                    display_datetime=display_datetime,
                    calendar=calendar,
                    time_context=time_context,
                    calculation_base=calculation_base,
                    force_compound=False,
                )
            return self._open_timed_transit_chart(
                parent_document_id,
                "",
                display_datetime=display_datetime,
                calendar=calendar,
                time_context=time_context,
                calculation_base=calculation_base,
                comparison_override=primary,
                force_compound=True,
                comparison_layout=comparison_layout,
            )

    def open_spotlight_horary(
        self,
        *,
        chrt,
        session_label: str,
        display_datetime: tuple[int, int, int, int, int, int],
    ) -> dict:
        """Open an ambient-input horary as a real HorarySession document.

        Wx twin: morin._spotlight_open_horary builds a Here-and-Now HORARY chart
        at the parsed moment/place, then opens it through _open_workspace_horary_session.
        """
        with self._lock:
            y, m, d, h, mi, s = [int(v) for v in tuple(display_datetime)[:6]]
            document = self._controller.open_document(
                chrt,
                radix=chrt,
                session_label=session_label,
                navigation_units=('day', 'hour', 'minute', 'second'),
                display_datetime=(y, m, d, h, mi, s),
                dirty=False,
                session_factory=horary_session.HorarySession,
            )
            self._remember_recent_chart(chrt, "")
            self._manager.broadcast_threadsafe({
                "type": "documents.changed",
                "tree": self._tree_payload(),
            })
            self._save_restore_open_charts_state()
            if document is None:
                return {"documentId": None, "documents": self._tree_payload()}
            return self._attach_full_snapshot({
                "documentId": document.document_id,
                "activeDocumentId": self._controller.active_document_id(),
                "documents": self._tree_payload(),
            }, document.document_id)

    def open_spotlight_transit(
        self,
        *,
        when_iso: str = "",
        display_datetime: Optional[tuple[int, int, int, int, int, int]] = None,
        calendar: Optional[int] = None,
        time_context: Optional[dict[str, Any]] = None,
    ) -> dict:
        active_id = self._controller.active_document_id()
        if not active_id:
            raise ValueError("no active radix for transit")
        parent_id = self._timed_chart_parent_document_id(active_id)
        return self._open_timed_transit_chart(
            parent_id,
            when_iso,
            display_datetime=display_datetime,
            calendar=calendar,
            time_context=time_context,
        )

    def spotlight_active_display_datetime(self) -> Optional[tuple[int, int, int, int, int, int]]:
        """Return the active session cursor tuple used by ambient current updates."""
        with self._lock:
            session = self._controller.active_session()
            if session is None:
                return None
            cs = session.get('chart_session')
            chrt = getattr(cs, 'chart', None) if cs is not None else session.get('chart')
            display_dt = getattr(cs, 'display_datetime', None) if cs is not None else None
            if display_dt is None:
                display_dt = WorkspaceSessionController._chart_time_display_tuple(chrt)
            try:
                parts = [int(v) for v in tuple(display_dt or ())[:6]]
            except Exception:
                return None
            if len(parts) < 6:
                return None
            return tuple(parts[:6])

    def spotlight_current_supported(self) -> bool:
        """Whether the active session can accept a wx Spotlight Current Chart update.

        Do not promote a clean root radix here. Wx only targets sessions that are
        already steppable; a pure radix falls through to the default transit
        open path instead of being mutated in place.
        """
        with self._lock:
            session = self._controller.active_session()
            cs = session.get('chart_session') if session is not None else None
            return self._spotlight_current_session_supported(session, cs)

    @staticmethod
    def _spotlight_current_session_supported(session: Optional[dict], cs) -> bool:
        if session is None or cs is None or getattr(cs, 'chart', None) is None:
            return False
        if isinstance(cs, horary_session.HorarySession):
            return True
        if isinstance(cs, horary_session.DirtyRadixSession):
            return bool(
                not session.get('fpath')
                or session.get('dirty')
                or session.get('edit_dirty')
                or session.get('step_dirty')
            )
        feature_kind = session.get('supplementary_feature_kind')
        launcher_kind = session.get('launcher_kind')
        if feature_kind in ('solar_return', 'lunar_return', 'planetary_return'):
            return True
        if feature_kind in _PROGRESSION_FEATURE_KINDS:
            return True
        if feature_kind == 'transits' or launcher_kind == 'transits':
            return True
        if launcher_kind == 'ascensional_transits':
            return True
        if (
            WorkspaceService._chart_visual_mode(session) in _MDO_VISUAL_MODES
            and feature_kind not in _PROGRESSION_FEATURE_KINDS
        ):
            return True
        chart_mod = export_chart_json.chart_mod
        return getattr(getattr(cs, 'chart', None), 'htype', None) == chart_mod.Chart.TRANSIT

    def apply_spotlight_current(
        self,
        *,
        parsed: dict[str, Any],
        location_context: Optional[dict[str, Any]] = None,
    ) -> dict:
        """Apply ambient input to the active steppable chart.

        Wx twin: morin._spotlight_apply_to_active_steppable_chart for direct
        ChartSession targets. Partial dates/times merge into the current display
        cursor. Location-only input keeps the active chart's UT instant and
        expresses it at the new place, so the chart remains the same moment.
        """
        with self._lock:
            active_id = self._controller.active_document_id()
            session = self._controller.active_session()
            cs = session.get('chart_session') if session is not None else None
            if not active_id or not self._spotlight_current_session_supported(session, cs):
                raise ValueError("active chart cannot accept spotlight current updates")

            current_chart = getattr(cs, 'chart', None)
            time_obj = getattr(current_chart, 'time', None)
            place = getattr(current_chart, 'place', None)
            if current_chart is None or time_obj is None or place is None:
                raise ValueError("active chart has no mutable time/place")

            base_dt = getattr(cs, 'display_datetime', None) or WorkspaceSessionController._chart_time_display_tuple(current_chart)
            try:
                merged = [int(v) for v in tuple(base_dt or ())[:6]]
            except Exception as exc:
                raise ValueError("active chart has no display datetime") from exc
            if len(merged) < 6:
                raise ValueError("active chart has no display datetime")

            has_temporal = bool(parsed.get('hasTime') or parsed.get('hasDate'))
            has_temporal = has_temporal or any(
                parsed.get(attr) is not None for attr in ('day', 'month', 'year')
            )
            if has_temporal:
                for idx, attr in enumerate(('year', 'month', 'day')):
                    value = parsed.get(attr)
                    if value is not None:
                        merged[idx] = int(value)
                if parsed.get('hour') is not None:
                    merged[3] = int(parsed.get('hour') or 0)
                    merged[4] = int(parsed.get('minute') or 0)
                    merged[5] = int(parsed.get('second') or 0)

            feature_kind = session.get('supplementary_feature_kind')
            if (
                feature_kind == 'solar_return'
                and has_temporal
                and parsed.get('year') is not None
                and parsed.get('month') is None
                and parsed.get('day') is None
                and not parsed.get('hasTime')
            ):
                radix = getattr(cs, 'radix', None)
                radix_time = getattr(radix, 'time', None) if radix is not None else None
                if radix_time is not None:
                    try:
                        natal_month = int(radix_time.month)
                        natal_day = int(radix_time.day)
                        typed_year = int(merged[0])
                        if natal_month == 2 and natal_day == 29:
                            is_leap = (
                                (typed_year % 4 == 0 and typed_year % 100 != 0)
                                or typed_year % 400 == 0
                            )
                            if not is_leap:
                                natal_day = 28
                        anchor = (
                            datetime.datetime(typed_year, natal_month, natal_day, 23, 59, 59)
                            + datetime.timedelta(days=2)
                        )
                        merged = [
                            anchor.year,
                            anchor.month,
                            anchor.day,
                            anchor.hour,
                            anchor.minute,
                            anchor.second,
                        ]
                    except Exception:
                        pass

            ctx = location_context if isinstance(location_context, dict) else None
            if ctx is not None and ctx.get('place') is not None:
                place = ctx.get('place')

            chart_mod = export_chart_json.chart_mod
            calendar_value = int(getattr(time_obj, 'cal', chart_mod.Time.GREGORIAN))
            if has_temporal:
                parsed_calendar = str(parsed.get('calendar') or '').strip().lower()
                if parsed_calendar == 'julian':
                    calendar_value = chart_mod.Time.JULIAN
                elif parsed_calendar == 'gregorian':
                    calendar_value = chart_mod.Time.GREGORIAN
            try:
                datetime.date(int(merged[0]), int(merged[1]), int(merged[2]))
                if not (
                    0 <= int(merged[3]) <= 23
                    and 0 <= int(merged[4]) <= 59
                    and 0 <= int(merged[5]) <= 59
                ):
                    raise ValueError
                calflag = (
                    astrology.SE_JUL_CAL
                    if calendar_value == chart_mod.Time.JULIAN
                    else astrology.SE_GREG_CAL
                )
                check_jd = astrology.swe_julday(
                    int(merged[0]), int(merged[1]), int(merged[2]), 12.0, calflag,
                )
                check_y, check_m, check_d, _check_hour = astrology.swe_revjul(
                    check_jd, calflag,
                )
                if (int(check_y), int(check_m), int(check_d)) != tuple(merged[:3]):
                    raise ValueError
            except Exception as exc:
                raise ValueError("spotlight current datetime is invalid") from exc

            if feature_kind in ('solar_return', 'lunar_return', 'planetary_return'):
                return self._apply_spotlight_current_return(
                    active_id,
                    session,
                    cs,
                    tuple(merged),
                    location_context=ctx,
                    preserve_return_anchor=bool(
                        parsed.get('locationQuery')
                        and not has_temporal
                    ),
                )
            if feature_kind in _PROGRESSION_FEATURE_KINDS:
                return self._apply_spotlight_current_progression(
                    active_id,
                    session,
                    cs,
                    tuple(merged),
                )
            if feature_kind == 'converse_transits':
                return self._apply_spotlight_current_converse_transit(
                    active_id,
                    session,
                    cs,
                    tuple(merged),
                    location_context=ctx,
                    cursor_changed=has_temporal,
                )

            try:
                needs_full_chart = bool(cs._navigation_requires_full_chart())
            except Exception:
                needs_full_chart = False
            zt = ctx.get('zt', getattr(time_obj, 'zt', export_chart_json.chart_mod.Time.ZONE)) if ctx else getattr(time_obj, 'zt', export_chart_json.chart_mod.Time.ZONE)
            plus = ctx.get('plus', getattr(time_obj, 'plus', True)) if ctx else getattr(time_obj, 'plus', True)
            zh = ctx.get('zh', getattr(time_obj, 'zh', 0)) if ctx else getattr(time_obj, 'zh', 0)
            zm = ctx.get('zm', getattr(time_obj, 'zm', 0)) if ctx else getattr(time_obj, 'zm', 0)
            daylight = ctx.get('daylightsaving', getattr(time_obj, 'daylightsaving', False)) if ctx else getattr(time_obj, 'daylightsaving', False)
            tzid = ctx.get('tzid', getattr(time_obj, 'tzid', '')) if ctx else getattr(time_obj, 'tzid', '')
            tzauto = ctx.get('tzauto', getattr(time_obj, 'tzauto', False)) if ctx else getattr(time_obj, 'tzauto', False)
            location_only = bool(
                ctx is not None
                and ctx.get('place') is not None
                and parsed.get('locationQuery')
                and not has_temporal
            )
            if location_only:
                jd = getattr(time_obj, 'jd', None)
                if jd is None:
                    raise ValueError("active chart has no UT instant")
                utc_dt = self._jd_to_calendar_datetime(
                    float(jd),
                    getattr(time_obj, 'cal', export_chart_json.chart_mod.Time.GREGORIAN),
                )
                if utc_dt is None:
                    raise ValueError("could not retain active chart UT for location update")
                zone = moment.utc_to_place_local_zone(utc_dt, place) or {}
                local_dt = zone.get("datetime")
                if local_dt is None:
                    raise ValueError("could not resolve local time for spotlight location")
                merged = [int(v) for v in tuple(local_dt)[:6]]
                zt = export_chart_json.chart_mod.Time.ZONE
                plus = bool(zone.get("plus", True))
                zh = int(zone.get("zh", 0) or 0)
                zm = int(zone.get("zm", 0) or 0)
                daylight = bool(zone.get("daylightsaving", False))
                tzid = str(zone.get("tzid") or ctx.get("tzid") or "")
                tzauto = False
            newtime = chart_factory.build_time(
                merged[0],
                merged[1],
                merged[2],
                merged[3],
                merged[4],
                merged[5],
                place=place,
                bc=bool(getattr(time_obj, 'bc', False)),
                cal=calendar_value,
                zt=zt,
                plus=plus,
                zh=zh,
                zm=zm,
                daylight=daylight,
                full=needs_full_chart,
                tzid=tzid,
                tzauto=tzauto,
            )
            newchart = chart_factory.build_chart(
                getattr(current_chart, 'name', ''),
                getattr(current_chart, 'male', True),
                newtime,
                place,
                getattr(current_chart, 'htype', export_chart_json.chart_mod.Chart.RADIX),
                '',
                chart_snapshot_service.options,
                needs_full_chart,
            )
            was_dirty = bool(session.get('dirty', False))
            cs.change_chart(newchart, display_datetime=tuple(merged), change_reason='step')
            if hasattr(cs, '_refresh_step_dirty'):
                try:
                    cs._refresh_step_dirty()
                except Exception:
                    pass
            result = self._navigate_key_result(
                active_id, cs, True, was_dirty=was_dirty, include_documents=True,
            )
            result["activeDocumentId"] = self._controller.active_document_id()
            return result

    def _apply_spotlight_current_converse_transit(
        self,
        document_id: str,
        session: dict[str, Any],
        cs,
        display_dt: tuple[int, int, int, int, int, int],
        *,
        location_context: Optional[dict[str, Any]] = None,
        cursor_changed: bool = True,
    ) -> dict:
        """Apply Spotlight to the symbolic cursor without flattening its clocks."""
        radix = getattr(cs, 'radix', None)
        current_chart = getattr(cs, 'chart', None)
        if radix is None or current_chart is None:
            raise ValueError("converse transit session has no radix")
        when = _display_to_datetime(display_dt)
        if when is None:
            raise ValueError("spotlight converse-transit datetime is invalid")
        binding = supplementary_adapter.SupplementaryBinding.from_payload(
            session.get('supplementary_binding') or {},
            feature_kind='converse_transits',
        ) or supplementary_adapter.SupplementaryBinding('converse_transits')
        retained = dict(binding.retained_state or {})
        if cursor_changed:
            retained.pop('symbolic_cursor_datetime', None)
            retained.pop('symbolic_cursor_jd', None)
        ctx = location_context if isinstance(location_context, dict) else None
        if ctx is not None and ctx.get('place') is not None:
            retained.update({
                'physical_place_payload': supplementary_adapter.place_to_payload(
                    ctx.get('place')
                ),
                'physical_zt': int(ctx.get(
                    'zt',
                    retained.get('physical_zt', export_chart_json.chart_mod.Time.ZONE),
                )),
                'physical_plus': bool(ctx.get(
                    'plus',
                    retained.get('physical_plus', True),
                )),
                'physical_zh': int(ctx.get(
                    'zh',
                    retained.get('physical_zh', 0),
                ) or 0),
                'physical_zm': int(ctx.get(
                    'zm',
                    retained.get('physical_zm', 0),
                ) or 0),
                'physical_daylight': bool(ctx.get(
                    'daylightsaving',
                    retained.get('physical_daylight', False),
                )),
                'physical_tzid': str(ctx.get(
                    'tzid',
                    retained.get('physical_tzid', ''),
                ) or ''),
                'physical_tzauto': bool(ctx.get(
                    'tzauto',
                    retained.get('physical_tzauto', False),
                )),
            })
        binding.retained_state = retained
        built = supplementary_service.build_result(
            radix=radix,
            kind='converse-transits',
            when=when,
            binding_payload=binding.to_payload(),
        )
        derived_chart = built.get('chart')
        result_display_dt = built.get('display_datetime')
        result_binding = built.get('binding')
        if derived_chart is None or result_display_dt is None or result_binding is None:
            raise ValueError("converse transit session could not be rebuilt")
        derived_chart.name = getattr(current_chart, 'name', derived_chart.name)
        derived_chart.male = getattr(current_chart, 'male', derived_chart.male)
        derived_chart.notes = getattr(current_chart, 'notes', '')
        was_dirty = bool(session.get('dirty', False))
        session['parent_source_datetime'] = _datetime_to_display(when)
        session['chart'] = derived_chart
        self._controller._apply_supplementary_binding(session, result_binding)
        cs.change_chart(
            derived_chart,
            display_datetime=result_display_dt,
            change_reason='step',
        )
        result = self._navigate_key_result(
            document_id,
            cs,
            True,
            was_dirty=was_dirty,
            include_documents=True,
        )
        result['activeDocumentId'] = self._controller.active_document_id()
        return result

    def _apply_spotlight_current_progression(
        self,
        document_id: str,
        session: dict[str, Any],
        cs,
        display_dt: tuple[int, int, int, int, int, int],
    ) -> dict:
        feature_kind = session.get('supplementary_feature_kind')
        if feature_kind not in _PROGRESSION_FEATURE_KINDS:
            raise ValueError("active chart is not a progression session")
        radix = getattr(cs, 'radix', None)
        if radix is None:
            raise ValueError("progression session has no radix")
        signified_dt = _display_to_datetime(display_dt)
        if signified_dt is None:
            raise ValueError("spotlight progression datetime is invalid")

        current_chart = getattr(cs, 'chart', None)
        binding_payload = session.get('supplementary_binding')
        # For progression adapters, ``when`` is the SIGNIFIED real cursor. The
        # adapter owns the symbolic-age conversion and builds the progressed
        # ephemeris chart; never rebuild the chart directly at this calendar year.
        if feature_kind == 'solar_arc':
            built = self._build_solar_arc_child_result(
                radix,
                signified_dt,
                binding_payload=binding_payload,
            )
        else:
            public_kind = FEATURE_TO_PUBLIC_KIND.get(feature_kind)
            if public_kind is None:
                raise ValueError("progression session has no public kind")
            built = supplementary_service.build_result(
                radix=radix,
                kind=public_kind,
                when=signified_dt,
                binding_payload=binding_payload,
            )

        derived_chart = built.get("chart") if isinstance(built, dict) else None
        result_display_dt = built.get("display_datetime") if isinstance(built, dict) else None
        binding = built.get("binding") if isinstance(built, dict) else None
        if derived_chart is None or result_display_dt is None or binding is None:
            raise ValueError("progression session could not be rebuilt")
        if current_chart is not None:
            derived_chart.name = getattr(current_chart, 'name', getattr(derived_chart, 'name', ''))
            derived_chart.male = getattr(current_chart, 'male', getattr(derived_chart, 'male', True))
            derived_chart.notes = getattr(current_chart, 'notes', getattr(derived_chart, 'notes', ''))

        was_dirty = bool(session.get('dirty', False))
        session['parent_source_datetime'] = _datetime_to_display(signified_dt)
        session['chart'] = derived_chart
        self._controller._apply_supplementary_binding(session, binding)
        cs.change_chart(derived_chart, display_datetime=result_display_dt, change_reason='step')
        if hasattr(cs, '_refresh_step_dirty'):
            try:
                cs._refresh_step_dirty()
            except Exception:
                pass
        result = self._navigate_key_result(
            document_id,
            cs,
            True,
            was_dirty=was_dirty,
            include_documents=True,
        )
        result["activeDocumentId"] = self._controller.active_document_id()
        return result

    def _apply_spotlight_current_return(
        self,
        document_id: str,
        session: dict[str, Any],
        cs,
        display_dt: tuple[int, int, int, int, int, int],
        *,
        location_context: Optional[dict[str, Any]] = None,
        preserve_return_anchor: bool = False,
    ) -> dict:
        feature_kind = session.get('supplementary_feature_kind')
        if feature_kind not in ('solar_return', 'lunar_return', 'planetary_return'):
            raise ValueError("active chart is not a return session")
        parent_session = self._controller.session(session.get('parent_document_id'))
        parent_cs = parent_session.get('chart_session') if parent_session is not None else None
        if parent_session is None or parent_cs is None:
            raise ValueError("return session has no parent radix")
        adapter = self._controller._registry.adapter_for_feature_kind(feature_kind)
        if adapter is None:
            raise ValueError("return session has no adapter")
        source_dt = _display_to_datetime(display_dt)
        if source_dt is None:
            raise ValueError("spotlight return datetime is invalid")
        current_chart = getattr(cs, 'chart', None)
        base_chart = getattr(parent_cs, 'radix', None) or getattr(parent_cs, 'chart', None)
        if current_chart is None or base_chart is None:
            raise ValueError("return session has no chart")
        ctx = location_context if isinstance(location_context, dict) else None
        location_only = bool(
            preserve_return_anchor
            and ctx is not None
            and ctx.get('place') is not None
        )
        if location_only and feature_kind in ('lunar_return', 'planetary_return'):
            source_dt = _retained_return_datetime(session, current_chart) or source_dt
        driver = self._controller._driver_for_session(session)
        driver.horoscope = base_chart
        binding = adapter.capture_binding(
            driver,
            session=session,
            current_chart=current_chart,
            feature_kind=feature_kind,
        )
        retained = dict(binding.retained_state or {})
        if ctx is not None and ctx.get('place') is not None:
            retained.update({
                'place_payload': supplementary_adapter.place_to_payload(ctx.get('place')),
                'plus': bool(ctx.get('plus', retained.get('plus', True))),
                'zh': int(ctx.get('zh', retained.get('zh', 0)) or 0),
                'zm': int(ctx.get('zm', retained.get('zm', 0)) or 0),
                'daylight': bool(ctx.get('daylightsaving', retained.get('daylight', False))),
                'tzid': str(ctx.get('tzid', retained.get('tzid', '')) or ''),
                'tzauto': bool(ctx.get('tzauto', retained.get('tzauto', False))),
            })
        if feature_kind == 'lunar_return' and (not location_only or _retained_return_datetime(session, current_chart) is not None):
            retained['lunar_cycle_offset'] = 0
        elif feature_kind == 'planetary_return' and (not location_only or _retained_return_datetime(session, current_chart) is not None):
            retained['cycle_offset'] = 0
        elif feature_kind == 'solar_return' and not location_only:
            retained['solar_year_offset'] = 0
        binding.retained_state = retained
        source_display_dt = _datetime_to_display(source_dt)
        driver_state = supplementary_adapter.SupplementaryDriverState(
            base_chart=base_chart,
            source_datetime=source_dt,
            chart_session=parent_cs,
            runtime_radix=base_chart,
            source_display_datetime=source_display_dt,
            preserve_return_cycle=bool(location_only and feature_kind == 'solar_return'),
        )
        result = adapter.build(
            driver,
            driver_state,
            binding,
            current_chart=current_chart,
            session=session,
        )
        if result is None or result.chart is None or result.display_datetime is None:
            raise ValueError("return session could not be rebuilt")
        result.chart.name = getattr(current_chart, 'name', '')
        result.chart.male = getattr(current_chart, 'male', True)
        result.chart.notes = getattr(current_chart, 'notes', '')
        self._controller._apply_rebuilt_child(
            session,
            cs,
            base_chart,
            source_dt,
            result.chart,
            result.display_datetime,
            change_reason='step',
        )
        result.binding.parent_source_datetime = source_display_dt
        self._controller._apply_supplementary_binding(session, result.binding)
        cs._stepper = SupplementaryStepper(
            controller=self._controller,
            session=session,
            cs=cs,
            radix=base_chart,
            feature_kind=feature_kind,
        )
        nav_result = self._navigate_key_result(document_id, cs, True, include_documents=True)
        nav_result["activeDocumentId"] = self._controller.active_document_id()
        return nav_result

    # ------------------------------------------------------------------
    # Astrocartography right-click "here" actions. Source twin:
    # morin.on_astrocart_here_request (morin.py:16428) dispatched from the
    # map.html #acg-menu via astrocartframe._on_here_request (astrocartframe.py:591).
    # Four chart-context actions act on the lon/lat the user right-clicked:
    #   relocation    -> the radix recomputed for the clicked place (same moment)
    #   solar_return  -> the solar return at the clicked place (now)
    #   transit       -> a transit chart at the clicked place (now)
    #   set_pob       -> mutate the radix birthplace to the clicked location
    # Each routes through the SAME controller open / change-chart machinery the
    # other launchers use; no astrology is recomputed here.

    @staticmethod
    def _astrocart_coordinates_title(lon: float, lat: float) -> str:
        """Source twin: morin._astrocart_coordinates_title (morin.py:16296)."""
        return '%.2f%s %.2f%s' % (
            abs(float(lat)),
            'N' if float(lat) >= 0.0 else 'S',
            abs(float(lon)),
            'E' if float(lon) >= 0.0 else 'W',
        )

    def _astrocart_resolve_place_name(self, lon: float, lat: float, label_hint: str = '') -> str:
        """Source twin: morin._astrocart_resolve_place_name (morin.py:16255).

        Three-tier name preference for the clicked point: a trusted MapLibre
        label hint, else the offline localcities nearest-city DB, else a coord
        string. Truncated to 20 chars (chart.Place historical MaxLength)."""
        hint = (label_hint or '').strip()
        coords_like = bool(hint) and all(
            ch.isdigit() or ch in '.,°-NESWnesw ' for ch in hint
        )
        if hint and not coords_like:
            return hint[:20]
        try:
            import localcities  # wx-free; lazy like the wx source
            row = localcities.nearest(lon, lat)
        except Exception:
            row = None
        if row is not None:
            try:
                name = (row[0] or '').strip()
            except Exception:
                name = ''
            if name:
                return name[:20]
        return self._astrocart_coordinates_title(lon, lat)

    @staticmethod
    def _dms_round(value: float) -> tuple[int, int, int]:
        """abs decimal degrees -> (deg, min, sec) for the DISPLAY/payload fields,
        rounded to the nearest whole arcsecond with proper 60-carry. util.decToDeg
        floors (loses up to ~30 m); the authoritative coordinate is kept as the
        full-precision decimal on the Place (see _astrocart_place_from_lonlat)."""
        total = int(round(abs(value) * 3600.0))
        deg, rem = divmod(total, 3600)
        minute, sec = divmod(rem, 60)
        return deg, minute, sec

    def _astrocart_place_from_lonlat(self, lon: float, lat: float, place_name: str = ''):
        """Source twin: morin._astrocart_relocation_place (morin.py:16236).

        Build a chart.Place from a clicked lon/lat. Longitude normalised to
        (-180,180], latitude clamped. The deg/min/sec fields carry the rounded
        DMS for display, but Place.lon/lat are overwritten with the EXACT clicked
        decimal: Place.__init__ recomputes lon/lat from integer DMS, which floors
        the right-click coordinate to whole arcseconds (~10-30 m). The clicked
        point is the ground truth — keep it at full precision so set-place-of-birth
        (and the directly-built relocation/here charts) land within ~0.1 m."""
        chart_mod = export_chart_json.chart_mod
        lon = ((float(lon) + 180.0) % 360.0) - 180.0
        lat = max(-89.999, min(89.999, float(lat)))
        title = (place_name or '').strip() or self._astrocart_coordinates_title(lon, lat)
        londeg, lonmin, lonsec = self._dms_round(lon)
        latdeg, latmin, latsec = self._dms_round(lat)
        place = chart_mod.Place(
            title,
            londeg, lonmin, lonsec, lon >= 0.0,
            latdeg, latmin, latsec, lat >= 0.0,
            0,
        )
        place.lon = lon
        place.lat = lat
        return place

    @staticmethod
    def _astrocart_now_utc() -> datetime.datetime:
        """Source twin: morin._astrocart_current_utc_datetime (morin.py:16304)."""
        return datetime.datetime.now(datetime.timezone.utc).replace(
            tzinfo=None, microsecond=0
        )

    def astrocart_here(
        self,
        *,
        astrocart_document_id: str,
        action: str,
        lon: float,
        lat: float,
        place_name: str = '',
    ) -> dict:
        """Dispatch a right-click "here" action. Source twin:
        morin.on_astrocart_here_request (morin.py:16428)."""
        action = (action or 'relocation').strip()
        # Resolve the parent radix the same way the timed-chart actions do: the
        # astrocart doc is a view-only child whose parent_document_id is the
        # radix. _timed_chart_parent_document_id also accepts a chart-owning doc
        # directly, so passing a radix id works too.
        with self._lock:
            parent_radix_id = self._timed_chart_parent_document_id(astrocart_document_id)
            base_chart = self._parent_radix(parent_radix_id)
            if base_chart is None or getattr(getattr(base_chart, 'time', None), 'bc', False):
                # wx returns None for BC charts (morin.py:16452).
                raise ValueError("astrocart 'here' actions require a non-BC radix")

        # Resolve a human place name (closest city) for the click and use it for
        # EVERY action — the relocation / solar / transit charts and set_pob all
        # show the nearest place name, not bare coordinates. (wx reverse-geocoded
        # only for set_pob, morin.py:16430; surfacing it on the relocation + here
        # charts too is an intentional, display-only product improvement —
        # the angles/houses depend on lon/lat, not the label.) The map's label
        # hint is often empty, so fall through: label hint → localcities.nearest
        # → coordinate fallback.
        try:
            resolved_name = self._astrocart_resolve_place_name(lon, lat, place_name)
        except Exception:
            resolved_name = (place_name or '').strip()
        place = self._astrocart_place_from_lonlat(lon, lat, place_name=resolved_name)

        if action == 'set_pob':
            return self._astrocart_set_place_of_birth(parent_radix_id, place)
        if action == 'set_default_loc':
            # Gated to the default_location menu context which the webapp astrocart
            # surface never enters (it always runs in chart ctx); see
            # doc/migration/wiring/astrocart.md §9.5. Deferred.
            raise ValueError("set_default_loc is not available in the webapp astrocart surface")
        if action == 'solar_return':
            return self._astrocart_open_solar_here(parent_radix_id, place)
        if action == 'transit':
            return self._astrocart_open_transit_here(parent_radix_id, place)
        return self._astrocart_open_relocation_here(parent_radix_id, base_chart, place)

    def _astrocart_open_relocation_here(self, parent_radix_id: str, base_chart, place) -> dict:
        """Source twin: morin._open_astrocart_relocation_here (morin.py:16331).

        The radix recomputed for the clicked place at the SAME birth instant:
        the UTC calendar datetime is read back from the radix jd, converted to
        clicked-place local civil time, and a fresh RADIX chart is built at that
        place (so angles / houses relocate while the moment is identical).
        Opened as a CHART-view child under the radix via the same controller path
        _open_exact_event_chart uses — never a second derivation."""
        chart_mod = export_chart_json.chart_mod
        utc_dt = self._jd_to_calendar_datetime(
            float(base_chart.time.jd),
            getattr(base_chart.time, 'cal', chart_mod.Time.GREGORIAN),
        )
        if utc_dt is None:
            raise RuntimeError("could not resolve radix UTC datetime for relocation")
        zone = moment.utc_to_place_local_zone(utc_dt, place) or {}
        local_dt = zone.get("datetime") or utc_dt
        y, m, d, h, mi, s = [int(v) for v in local_dt[:6]]
        time = chart_mod.Time(
            y, m, d, h, mi, s,
            False, base_chart.time.cal, chart_mod.Time.ZONE,
            bool(zone.get("plus", True)),
            int(zone.get("zh", 0) or 0),
            int(zone.get("zm", 0) or 0),
            bool(zone.get("daylightsaving", False)),
            place, False,
            tzid=str(zone.get("tzid") or ""),
            tzauto=False,
        )
        title = getattr(place, 'place', '') or self._astrocart_coordinates_title(place.lon, place.lat)
        relocated = chart_factory.build_chart(
            title, base_chart.male, time, place, chart_mod.Chart.RADIX, '',
            chart_snapshot_service.options, False,
        )
        document = self._controller.open_document(
            relocated,
            radix=base_chart,
            session_label=title,
            view_mode=chart_session.ChartSession.CHART,
            display_datetime=(y, m, d, h, mi, s),
            parent_document_id_override=parent_radix_id,
            launcher_kind='relocation',
            dirty=False,
        )
        return self._astrocart_open_result(document)

    def _astrocart_open_transit_here(self, parent_radix_id: str, place) -> dict:
        """Source twin: morin._open_astrocart_transit_here (morin.py:16355).

        A transit chart for NOW at the clicked place. Routed through the shared
        supplementary open path with a place_payload override so the engine's
        TransitSupplementaryAdapter (which already honours retained place_payload,
        supplementary_adapter.py:707) builds the relocated transit — no transit
        chart is constructed here."""
        now = self._astrocart_now_utc()
        when_iso = "%04d-%02d-%02dT%02d:%02d:%02d" % (
            now.year, now.month, now.day, now.hour, now.minute, now.second,
        )
        binding_payload = {
            "feature_kind": "transits",
            "retained_state": {
                "place_payload": supplementary_adapter.place_to_payload(place),
            },
        }
        return self.open_document(
            kind="supplementary",
            parent_document_id=parent_radix_id,
            feature_kind="transits",
            when_iso=when_iso,
            binding_payload=binding_payload,
        )

    def _astrocart_open_solar_here(self, parent_radix_id: str, place) -> dict:
        """Source twin: morin._open_astrocart_solar_here (morin.py:16379).

        The configured solar return at the clicked place, anchored at NOW. The
        SolarReturnSupplementaryAdapter (supplementary_adapter.py:326) honours the
        retained place_payload + plus/zh/zm/daylight exactly as the wx binding
        sets them (morin.py:16387-16393), so the engine builds the relocated SR —
        no return is recomputed here."""
        now = self._astrocart_now_utc()
        when_iso = "%04d-%02d-%02dT%02d:%02d:%02d" % (
            now.year, now.month, now.day, now.hour, now.minute, now.second,
        )
        binding_payload = {
            "feature_kind": "solar_return",
            "retained_state": {
                "place_payload": supplementary_adapter.place_to_payload(place),
                "plus": True,
                "zh": 0,
                "zm": 0,
                "daylight": False,
            },
        }
        return self.open_document(
            kind="supplementary",
            parent_document_id=parent_radix_id,
            feature_kind="solar_return",
            when_iso=when_iso,
            binding_payload=binding_payload,
        )

    def _astrocart_set_place_of_birth(self, radix_document_id: str, new_place) -> dict:
        """Source twin: morin._astrocart_set_place_of_birth (morin.py:16532).

        Replace the radix's place of birth with the clicked location. The local
        clock fields (Y/M/D/h/mi/s) are kept literal; for ZONE charts with
        tzauto the offset is re-resolved from the new coordinates via geonames
        (so a New York -> Paris correction lands on CET). GMT/LMT/LAT-entered
        charts keep their zone fields (those modes derive UT from the entered
        fields). The new chart is swapped into the open radix session in place
        and the wheel + any children re-render — the single-click map equivalent
        of editing the chart's personal data."""
        chart_mod = export_chart_json.chart_mod
        with self._lock:
            session = self._controller.session(radix_document_id)
            if session is None:
                raise ValueError(f"unknown radix document {radix_document_id!r}")
            cs = session.get('chart_session')
            cs = self._ensure_root_radix_step_session(session) or cs
            base_chart = None
            if cs is not None:
                base_chart = getattr(cs, 'radix', None) or getattr(cs, 'chart', None)
            if base_chart is None:
                base_chart = session.get('chart')
            if base_chart is None:
                raise ValueError("radix document has no chart")
            old_time = base_chart.time
            if getattr(old_time, 'bc', False):
                raise ValueError("Set place of birth not supported for BC charts")
            civil_dt = (
                int(getattr(old_time, 'origyear', old_time.year)),
                int(getattr(old_time, 'origmonth', old_time.month)),
                int(getattr(old_time, 'origday', old_time.day)),
                int(old_time.hour),
                int(old_time.minute),
                int(old_time.second),
            )

            plus = bool(getattr(old_time, 'plus', True))
            zh = int(getattr(old_time, 'zh', 0))
            zm = int(getattr(old_time, 'zm', 0))
            daylight = bool(getattr(old_time, 'daylightsaving', False))
            tzid = ''
            tzauto = bool(getattr(old_time, 'tzauto', False))

            if old_time.zt == chart_mod.Time.ZONE and tzauto:
                try:
                    import geonames  # wx-free; lazy like the wx source
                    info = geonames.Geonames.resolve_zone_fields(
                        civil_dt[0], civil_dt[1], civil_dt[2],
                        civil_dt[3], civil_dt[4], civil_dt[5],
                        new_place, '',
                    )
                except Exception:
                    info = None
                if info is not None:
                    plus = bool(info['plus'])
                    zh = int(info['zh'])
                    zm = int(info['zm'])
                    daylight = bool(info['daylightsaving'])
                    tzid = info['tzid']

            new_time = chart_mod.Time(
                civil_dt[0], civil_dt[1], civil_dt[2],
                civil_dt[3], civil_dt[4], civil_dt[5],
                False, int(old_time.cal), int(old_time.zt),
                plus, zh, zm, daylight,
                new_place, True,
                tzid=tzid,
                tzauto=tzauto,
            )
            new_chart = chart_factory.build_chart(
                base_chart.name, base_chart.male, new_time, new_place,
                base_chart.htype, getattr(base_chart, 'notes', '') or '',
                chart_snapshot_service.options,
            )
            chart_id = str(session.get('chart_id') or getattr(base_chart, 'chart_id', '') or '')
            if chart_id:
                try:
                    new_chart.chart_id = chart_id
                except Exception:
                    pass

            # Swap the rebuilt chart into the open radix session in place. A radix
            # CHART-view session has cs.chart IS cs.radix, so both refs move; the
            # change_chart call re-seeds the display cursor and fires the session
            # change (chart_session.py:285). session['chart'] mirrors it for the
            # state-serialiser and snapshot fetch.
            session['chart'] = new_chart
            session['chart_id'] = chart_id or getattr(new_chart, 'chart_id', '')
            session['dirty'] = True
            session['edit_dirty'] = True
            session['rectification_dirty'] = True
            rebuilt_child_ids: list[str] = []
            if cs is not None:
                if getattr(cs, 'radix', None) is base_chart:
                    cs.radix = new_chart
                if getattr(cs, 'display_anchor_chart', None) is base_chart:
                    cs.display_anchor_chart = new_chart
                cs.change_chart(new_chart, display_datetime=civil_dt, change_reason='edit')
                rebuilt_child_ids = self._controller._refresh_child_sessions(session)
            self._controller._sync_runtime_title(session)

        # Tree (dirty marker) + the radix wheel + any rebuilt children repaint.
        self._broadcast_session_changed(radix_document_id, "edit")
        for child_id in rebuilt_child_ids:
            self._broadcast_session_changed(child_id, "edit")
        self._manager.broadcast_threadsafe({
            "type": "documents.changed",
            "tree": self._tree_payload(),
        })
        place_label = getattr(new_place, 'place', '') or ''
        return {
            "documentId": radix_document_id,
            "activeDocumentId": self._controller.active_document_id(),
            "documents": self._tree_payload(),
            "placeName": place_label,
        }

    @staticmethod
    def _shift_rectification_tuple(
        dt_tuple: tuple[int, int, int, int, int, int],
        delta_seconds: int,
    ) -> tuple[int, int, int, int, int, int]:
        y, m, d, h, mi, s = [int(v) for v in dt_tuple]
        delta = int(delta_seconds)
        if delta == 0:
            return y, m, d, h, mi, s
        if abs(delta) > 600:
            raise ValueError("rectification step is limited to 10 minutes")
        minutes, seconds = divmod(abs(delta), 60)
        if delta > 0:
            if minutes:
                y, m, d, h, mi = util.addMins(y, m, d, h, mi, minutes)
            if seconds:
                y, m, d, h, mi, s = util.addSecs(y, m, d, h, mi, s, seconds)
        else:
            if minutes:
                y, m, d, h, mi = util.subtractMins(y, m, d, h, mi, minutes)
            if seconds:
                y, m, d, h, mi, s = util.subtractSecs(y, m, d, h, mi, s, seconds)
        if y <= 0:
            raise ValueError("rectification before year 1 is not supported")
        return y, m, d, h, mi, s

    def rectify_radix_time(self, document_id: str, delta_seconds: int) -> dict:
        """Nudge the owning radix birth time from a directions pane.

        Source twin: DirectionCompanionFrame.onIncr/onDecr +
        morin.apply_radix_rectification. Direction/list documents are view-only
        children, so the posted document id first resolves to the parent radix
        through _timed_chart_parent_document_id, just like timed-row actions.
        """
        delta = int(delta_seconds)
        if delta == 0:
            return {"ok": True, "deltaSeconds": 0, "documentId": document_id}

        chart_mod = export_chart_json.chart_mod
        with self._lock:
            radix_document_id = self._owning_radix_document_id(document_id)
            session = self._controller.session(radix_document_id)
            if session is None:
                raise ValueError(f"unknown radix document {radix_document_id!r}")
            cs = session.get('chart_session')
            cs = self._ensure_root_radix_step_session(session) or cs
            base_chart = None
            if cs is not None:
                base_chart = getattr(cs, 'radix', None) or getattr(cs, 'chart', None)
            if base_chart is None:
                base_chart = session.get('chart')
            if base_chart is None:
                raise ValueError("radix document has no chart")
            old_time = base_chart.time
            if getattr(old_time, 'bc', False):
                raise ValueError("rectification stepping is not supported for BC charts")

            current = (
                int(getattr(old_time, 'origyear', old_time.year)),
                int(getattr(old_time, 'origmonth', old_time.month)),
                int(getattr(old_time, 'origday', old_time.day)),
                int(old_time.hour),
                int(old_time.minute),
                int(old_time.second),
            )
            y, m, d, h, mi, s = self._shift_rectification_tuple(current, delta)
            new_time = chart_mod.Time(
                y, m, d, h, mi, s,
                bool(getattr(old_time, 'bc', False)),
                int(getattr(old_time, 'cal', chart_mod.Time.GREGORIAN)),
                int(getattr(old_time, 'zt', chart_mod.Time.ZONE)),
                bool(getattr(old_time, 'plus', True)),
                int(getattr(old_time, 'zh', 0) or 0),
                int(getattr(old_time, 'zm', 0) or 0),
                bool(getattr(old_time, 'daylightsaving', False)),
                base_chart.place,
                True,
                tzid=getattr(old_time, 'tzid', ''),
                tzauto=bool(getattr(old_time, 'tzauto', False)),
            )
            new_chart = chart_factory.build_chart(
                base_chart.name,
                base_chart.male,
                new_time,
                base_chart.place,
                base_chart.htype,
                getattr(base_chart, 'notes', '') or '',
                chart_snapshot_service.options,
            )
            chart_id = str(session.get('chart_id') or getattr(base_chart, 'chart_id', '') or '')
            if chart_id:
                try:
                    new_chart.chart_id = chart_id
                except Exception:
                    pass

            session['chart'] = new_chart
            session['chart_id'] = chart_id or getattr(new_chart, 'chart_id', '')
            session['dirty'] = True
            session['edit_dirty'] = True
            session['rectification_dirty'] = True
            rebuilt_child_ids: list[str] = []
            if cs is not None:
                if getattr(cs, 'radix', None) is base_chart:
                    cs.radix = new_chart
                if getattr(cs, 'display_anchor_chart', None) is base_chart:
                    cs.display_anchor_chart = new_chart
                cs.change_chart(new_chart, change_reason='edit')
                rebuilt_child_ids = self._controller._refresh_child_sessions(session)
            self._controller._sync_runtime_title(session)
            display_dt = (
                _display_tuple_to_iso(getattr(cs, "display_datetime", None))
                if cs is not None else None
            )

        self._broadcast_session_changed(radix_document_id, "edit")
        for child_id in rebuilt_child_ids:
            self._broadcast_session_changed(child_id, "edit")
        self._manager.broadcast_threadsafe({
            "type": "documents.changed",
            "tree": self._tree_payload(),
        })
        return {
            "ok": True,
            "documentId": radix_document_id,
            "activeDocumentId": self._controller.active_document_id(),
            "deltaSeconds": delta,
            "birthDatetime": "%04d-%02d-%02dT%02d:%02d:%02d" % (y, m, d, h, mi, s),
            "displayDatetime": display_dt,
            "documents": self._tree_payload(),
        }

    def apply_chart_edit(self, document_id: str, fields: dict) -> dict:
        """Apply edited personal-data fields to an OPEN radix document IN PLACE
        (wx onData edit path, morin.py:14869-14905). Rebuilds the radix chart
        from the fields KEEPING the same Record id, swaps it into the live
        session (no close/reopen → no flash), re-derives children, and then:

          * bound (session has fpath): auto-save by upserting the record into
            its collection and CLEAR dirty (wx auto-persist on OK,
            morin.py:14887-14899) — edit + save is one fluid OK, not a separate
            Cmd+S step;
          * unbound: mark dirty (the star) and leave it to the Save flow.

        Mirrors _astrocart_set_place_of_birth's in-place swap, but from the full
        editor field set rather than only the place. NOT for derived/cursor docs
        (those use apply-cursor)."""
        from webapp.daemon import editor_service as _editor
        with self._lock:
            session = self._controller.session(document_id)
            if session is None:
                raise ValueError(f"unknown document {document_id!r}")
            if session.get('supplementary_feature_kind') or session.get('launcher_kind') \
                    or session.get('compound_kind'):
                raise ValueError("apply_chart_edit targets a radix document only")
            cs = session.get('chart_session')
            base_chart = None
            if cs is not None:
                base_chart = getattr(cs, 'radix', None) or getattr(cs, 'chart', None)
            if base_chart is None:
                base_chart = session.get('chart')
            if base_chart is None:
                raise ValueError("document has no chart to edit")

            # Field set -> schema-v1 record -> Chart, via the canonical editor +
            # factory path. Keep the SAME Record id so this edits the existing
            # record (rebind, never fork).
            markdown = str(fields.get('notes') or '')
            record = _editor.editor_fields_to_record(fields)
            record['notes'] = ''
            chart_id = session.get('chart_id') or getattr(base_chart, 'chart_id', '') or None
            if chart_id:
                record['id'] = chart_id
            new_chart = chart_factory.chart_from_record(
                record, chart_snapshot_service.options,
            )

            # Swap in place (same machinery as _astrocart_set_place_of_birth).
            session['chart'] = new_chart
            session['chart_id'] = record.get('id', '') or getattr(new_chart, 'chart_id', '')
            session['base_title'] = str(record.get('name', '') or '')
            session['custom_title_root'] = session['base_title']
            rebuilt_child_ids: list[str] = []
            if cs is not None:
                if getattr(cs, 'radix', None) is base_chart:
                    cs.radix = new_chart
                if getattr(cs, '_initial_chart', None) is base_chart:
                    cs._initial_chart = new_chart
                    cs._initial_display_datetime = cs._chart_display_datetime(new_chart)
                if getattr(cs, 'display_anchor_chart', None) is base_chart:
                    cs.display_anchor_chart = new_chart
                cs.change_chart(new_chart, change_reason='edit')
                rebuilt_child_ids = self._controller._refresh_child_sessions(session)

            # wx onData: auto-save to the bound file + clear dirty; else dirty.
            fpath = str(session.get('fpath') or '').strip()
            saved = False
            if fpath:
                try:
                    notes_service.lift_legacy_record_notes(record)
                    chartfile.update_jsonl(record, fpath)
                    saved = True
                except Exception:
                    saved = False
            self._controller.set_dirty(
                document_id, edit_dirty=not saved, step_dirty=False,
            )
            if saved:
                self._remember_recent_chart(new_chart, fpath)
            self._controller._sync_runtime_title(session)
            notes_service.write_note_state(
                str(record.get('name') or ''),
                markdown,
                record_id=str(record.get('id') or '').strip() or None,
                document_id=document_id,
                scratch=not bool(fpath),
            )

        self._broadcast_session_changed(document_id, "edit")
        for child_id in rebuilt_child_ids:
            self._broadcast_session_changed(child_id, "edit")
        self._manager.broadcast_threadsafe({
            "type": "documents.changed",
            "tree": self._tree_payload(),
        })
        return {
            "ok": True,
            "documentId": document_id,
            "saved": bool(saved),
            "name": str(record.get('name', '') or ''),
            "documents": self._tree_payload(),
        }

    def set_default_location_from_map(self, lon: float, lat: float,
                                      place_name: str = '') -> dict:
        """Write a map-clicked location into the saved default-location options.

        Source twin: morin._astrocart_set_default_location (morin.py:16664),
        reached in wx when the astrocart panel is opened from the Default
        Location settings flow (``default_location`` menu context) and the user
        right-clicks "Set default location". The webapp launches the same map
        surface from the Settings > Default Location tab, so this is the daemon
        endpoint that path posts ``set_default_loc`` to.

        Resolves the clicked lon/lat to a city name (the editor's localcities
        machinery, reused via _astrocart_resolve_place_name — never a second
        geocoder), builds a chart.Place, then writes the legacy ``defloc*``
        fields used by the wx saver (morin.py:16683-16711): coords + 20-char
        name, plus the authoritative signed decimals used by every Tauri
        default-location consumer, a tz re-resolve from those coordinates for
        the current Here-and-Now clock, and ``defloctzauto=True``. Persists via
        options.saveDefLocation (the wx writer, slot order owned by
        options.py) and broadcasts
        options.changed so Here-and-Now reflects the new default immediately."""
        opts = options_service.options
        if opts is None:
            raise RuntimeError("options unavailable")

        # localcities reverse-geocode for a human name, then build the Place
        # (lon normalised, lat clamped, DMS via util.decToDeg). Both reuse the
        # set_pob / relocation helpers — same resolution path the chart-context
        # astrocart actions use.
        try:
            resolved_name = self._astrocart_resolve_place_name(lon, lat, place_name)
        except Exception:
            resolved_name = (place_name or '').strip()
        new_place = self._astrocart_place_from_lonlat(lon, lat, place_name=resolved_name)

        # Keep the legacy DMS fields for compatibility, while the signed
        # decimals remain authoritative for Tauri construction and timezone use.
        opts.defloclondeg = int(getattr(new_place, 'deglon', 0) or 0)
        opts.defloclonmin = int(getattr(new_place, 'minlon', 0) or 0)
        opts.defloceast = bool(getattr(new_place, 'east', True))
        opts.defloclatdeg = int(getattr(new_place, 'deglat', 0) or 0)
        opts.defloclatmin = int(getattr(new_place, 'minlat', 0) or 0)
        opts.deflocnorth = bool(getattr(new_place, 'north', True))
        default_location_model.apply_exact_coordinates(
            opts,
            float(new_place.lon),
            float(new_place.lat),
        )
        opts.deflocalt = int(getattr(new_place, 'altitude', 0) or 0)
        opts.deflocname = (getattr(new_place, 'place', '') or '')[:20]

        # Refresh tz from the new coords. Default location feeds Here-and-Now,
        # so resolve against the current clock instead of a winter standard-time
        # anchor; the shared options helper keeps the settings-tab patch path
        # and map-pick path identical.
        opts.defloctzauto = True
        options_service._apply_defloc_auto_timezone(opts, place=new_place)

        # Persist the same way the wx OK handler does (morin.py:16713-16721;
        # also the Location-tab _apply_defloc path). wx gates the save on
        # opts.autosave; the daemon settings model always persists option groups
        # immediately (options_service._apply_defloc:2834), so save unconditionally
        # to match the webapp's autosave-on-change semantics. saveDefLocation is
        # wx-free on the success path; best-effort like every other group writer.
        try:
            opts.saveDefLocation()
        except Exception:
            pass

        # Here-and-Now (and search / astrolabe fallback) read defloc* at build
        # time; broadcast so any open here-now surface re-pulls. No open chart
        # is recomputed (defloc only feeds FUTURE construction), so no document
        # ids are refreshed — matching the Location-tab patch (recalc is a no-op
        # for defloc; see options-default-location.md:41).
        self.broadcast_options_changed(None)

        place_label = getattr(new_place, 'place', '') or ''
        return {
            "placeName": place_label,
            "defaultLocation": options_service._read_defloc(opts),
        }

    def _astrocart_open_result(self, document) -> dict:
        """Shared open+activate result shape (mirrors open_astrocart's return).
        The controller's open_document already activated the document and the
        documents.changed broadcast fired inside it; surface the new id."""
        self._manager.broadcast_threadsafe({
            "type": "documents.changed",
            "tree": self._tree_payload(),
        })
        self._save_restore_open_charts_state()
        if document is None:
            return {"documentId": None, "documents": self._tree_payload()}
        return {
            "documentId": document.document_id,
            "activeDocumentId": self._controller.active_document_id(),
            "documents": self._tree_payload(),
        }

    def open_synastry(
        self,
        parent_radix_id: str,
        comparison_name: str,
        *,
        comparison_source: Optional[str] = None,
        comparison_record_index: Optional[int] = None,
    ) -> dict:
        """Open a synastry comparison as a root-level relationship document.

        Mirrors the wx frame's synastry open (morin.py:8543): the center chart is
        the parent radix, the partner is loaded by name, and the document is a
        COMPOUND-view ChartSession (so it renders as a biwheel, not a popup). It
        is intentionally not parented in the sidebar; drag/drop conversion owns
        nesting/reordering separately. The synastry chart payload itself is
        served by supplementary_service.synastry_snapshot /
        export_chart_json.export_snapshot — this command owns only the document
        lifecycle."""
        with self._lock:
            center = self._parent_radix(parent_radix_id)
            opts = chart_snapshot_service.options
            source_path = (
                str(Path(comparison_source).expanduser())
                if comparison_source
                else str(export_chart_json.DEFAULT_SOURCE)
            )
            partner, _ = export_chart_json.load_chart(
                source_path,
                opts,
                name=comparison_name,
                record_index=comparison_record_index,
            )
            if partner is None:
                raise RuntimeError(f"could not load comparison chart {comparison_name!r}")
            return self._open_loaded_synastry(
                center,
                partner,
                comparison_name=comparison_name,
                center_ref=self._serializable_participant_ref_live(center),
                partner_ref=self._participant_ref_from_source(partner, source_path),
            )

    def open_synastry_pair(
        self,
        center_name: str,
        comparison_name: str,
        *,
        center_source: Optional[str] = None,
        center_record_index: Optional[int] = None,
        comparison_source: Optional[str] = None,
        comparison_record_index: Optional[int] = None,
    ) -> dict:
        """Open two stored charts directly as one relationship document.

        The chart picker's two-selection Synastry command must be atomic: the
        center participant is an input to the compound document, not a
        temporary singleton workspace document.
        """
        with self._lock:
            opts = chart_snapshot_service.options
            center_path = (
                str(Path(center_source).expanduser())
                if center_source
                else str(export_chart_json.DEFAULT_SOURCE)
            )
            comparison_path = (
                str(Path(comparison_source).expanduser())
                if comparison_source
                else str(export_chart_json.DEFAULT_SOURCE)
            )
            center, _ = export_chart_json.load_chart(
                center_path,
                opts,
                name=center_name,
                record_index=center_record_index,
            )
            if center is None:
                raise RuntimeError(f"could not load center chart {center_name!r}")
            partner, _ = export_chart_json.load_chart(
                comparison_path,
                opts,
                name=comparison_name,
                record_index=comparison_record_index,
            )
            if partner is None:
                raise RuntimeError(f"could not load comparison chart {comparison_name!r}")
            self._remember_recent_chart(center, center_path)
            return self._open_loaded_synastry(
                center,
                partner,
                comparison_name=comparison_name,
                center_ref=self._participant_ref_from_source(center, center_path),
                partner_ref=self._participant_ref_from_source(partner, comparison_path),
            )

    def _open_loaded_synastry(
        self,
        center,
        partner,
        *,
        comparison_name: str,
        center_ref: Optional[dict[str, Any]],
        partner_ref: Optional[dict[str, Any]],
    ) -> dict:
        """Create and publish one root-level relationship document.

        Callers hold ``self._lock`` and own participant loading/ref resolution.
        """
        label = "%s & %s" % (
            getattr(center, 'name', '') or 'Radix',
            getattr(partner, 'name', '') or comparison_name,
        )
        document = self._controller.open_document(
            center,
            radix=center,
            session_label=label,
            view_mode=chart_session.ChartSession.COMPOUND,
            comparison_chart=partner,
            launcher_kind='synastry',
            dirty=False,
        )
        if document is not None:
            # Stamp the compound metadata the wx session carries
            # (morin.py:8545-8565) so the tree summary can label it and the
            # later Composite checkbox can reuse the same pair/cache.
            session = self._controller.session(document.document_id)
            if session is not None:
                participant_refs = [center_ref or {}, partner_ref or {}]
                self._stamp_synastry_session(
                    session,
                    center,
                    partner,
                    comparison_name,
                    participant_refs=participant_refs,
                )
                self._update_document_title(
                    session,
                    self._synastry_session_title(center, partner),
                    self._chart_label(center),
                )
                self._apply_synastry_launcher_preference(session)
        self._manager.broadcast_threadsafe({
            "type": "documents.changed",
            "tree": self._tree_payload(),
        })
        self._save_restore_open_charts_state()
        if document is None:
            return {"documentId": None, "documents": self._tree_payload()}
        return self._attach_full_snapshot({
            "documentId": document.document_id,
            "activeDocumentId": self._controller.active_document_id(),
            "documents": self._tree_payload(),
        }, document.document_id)

    # -- Synastry <-> Composite same-document lifecycle --------------------

    @staticmethod
    def _chart_label(chrt, fallback: str = "Chart") -> str:
        return (getattr(chrt, "name", "") or fallback).strip() or fallback

    @staticmethod
    def _is_relationship_session(session: Optional[dict]) -> bool:
        if not isinstance(session, dict):
            return False
        return session.get('compound_kind') in ('synastry', 'composite_from_synastry')

    @classmethod
    def _synastry_session_title(cls, center, partner) -> str:
        # Source twin: morin._synastry_session_title, morin.py:7572-7577.
        return "%s - %s %s" % (
            cls._chart_label(center),
            cls._chart_label(partner),
            mtexts.txts.get("Synastry", "Synastry"),
        )

    @classmethod
    def _composite_session_title(cls, center, partner, *, davison: bool = False) -> str:
        # Source twin: morin._composite_session_title, morin.py:7579-7588.
        suffix = ("%s (Davison)" % mtexts.txts.get("Composite", "Composite")) if davison else mtexts.txts.get("Composite", "Composite")
        return "%s + %s • %s" % (
            cls._chart_label(center),
            cls._chart_label(partner),
            suffix,
        )

    @classmethod
    def _composite_participants_session_title(cls, participants, *, davison: bool = False) -> str:
        # Source twin: morin._composite_participants_session_title, morin.py:7660-7666.
        participants = [participant for participant in (participants or []) if participant is not None]
        if len(participants) == 2:
            return cls._composite_session_title(participants[0], participants[1], davison=davison)
        suffix = ("%s (Davison)" % mtexts.txts.get("Composite", "Composite")) if davison else mtexts.txts.get("Composite", "Composite")
        names = [cls._chart_label(participant) for participant in participants]
        return "%s • %s" % (" + ".join(names), suffix)

    @staticmethod
    def _chart_pair_identity(chrt) -> tuple:
        time = getattr(chrt, "time", None)
        place = getattr(chrt, "place", None)
        return (
            getattr(chrt, "chart_id", "") or "",
            getattr(chrt, "name", "") or "",
            getattr(time, "jd", None),
            getattr(time, "origyear", getattr(time, "year", None)),
            getattr(time, "origmonth", getattr(time, "month", None)),
            getattr(time, "origday", getattr(time, "day", None)),
            getattr(time, "hour", None),
            getattr(time, "minute", None),
            getattr(time, "second", None),
            getattr(place, "lon", None),
            getattr(place, "lat", None),
        )

    @classmethod
    def _synastry_composite_pair_key(cls, center, partner) -> tuple:
        # Source twin: morin._synastry_composite_pair_key, morin.py:7650-7661.
        return tuple(sorted((cls._chart_pair_identity(center), cls._chart_pair_identity(partner))))

    def _stamp_synastry_session(
        self,
        session: dict,
        center,
        partner,
        comparison_name: str = "",
        *,
        participant_refs: Optional[list[dict[str, Any]]] = None,
    ) -> None:
        session['compound_kind'] = 'synastry'
        session['comparison_name'] = comparison_name or self._chart_label(partner, "Comparison")
        session['synastry_pair'] = (center, partner)
        session['relationship_participants'] = [center, partner]
        session['relationship_participant_states'] = [True, True]
        session['relationship_participant_refs'] = self._capture_participant_refs(
            [center, partner],
            fallback_refs=participant_refs,
        )
        session['base_title'] = self._synastry_session_title(center, partner)
        session['composite_variant'] = None
        session['option_refresh_handler'] = self._refresh_relationship_session_for_options
        self._ensure_synastry_composite_variants(session, center, partner)

    def _apply_synastry_launcher_preference(self, session: dict) -> None:
        """Honor ``synastry_opens_composite_first`` on every synastry opener.

        Wx routes both chart-picker Synastry and Alt-drop conversion through
        ``_open_synastry_session``; that method immediately switches the new
        session to midpoint composite when the launcher option is enabled
        (morin.py:8560-8563). Keep the same behavior daemon-side.
        """
        if not bool(getattr(chart_snapshot_service.options, 'synastry_opens_composite_first', False)):
            return
        if not self._is_relationship_session(session):
            return
        cs = session.get('chart_session')
        if cs is None:
            return
        active_participants = self._relationship_session_participants(session)
        if len(active_participants) >= 3:
            comp, pair = self._build_recursive_composite_variant(active_participants, 'midpoint')
            center, partner = pair
            title = self._composite_participants_session_title(active_participants, davison=False)
        else:
            center, partner = self._active_synastry_pair(session)
            if center is None or partner is None:
                return
            comp = self._cached_synastry_composite_variant(session, center, partner, 'midpoint')
            title = self._composite_session_title(center, partner, davison=False)
        if comp is None or center is None or partner is None:
            return
        display_dt = (
            cs._chart_display_datetime(comp)
            if hasattr(cs, "_chart_display_datetime")
            else getattr(cs, 'display_datetime', None)
        )
        session['compound_kind'] = 'composite_from_synastry'
        session['comparison_chart'] = None
        session['chart'] = comp
        session['synastry_pair'] = (center, partner)
        session['composite_variant'] = 'midpoint'
        session['base_title'] = title
        session['custom_title_root'] = title
        session['option_refresh_handler'] = self._refresh_relationship_session_for_options
        cs.radix = comp
        cs._initial_chart = comp
        cs._initial_display_datetime = display_dt
        cs.view_mode = chart_session.ChartSession.CHART
        cs.change_chart(comp, display_datetime=display_dt)
        self._update_document_title(
            session,
            title,
            getattr(comp, 'name', '') or self._chart_label(comp, "Composite"),
        )

    def _capture_participant_refs(self, participants, fallback_refs=None) -> list[dict]:
        # Source twin: morin._capture_participant_refs, morin.py:4386-4416.
        refs: list[dict] = []
        fallback_refs = fallback_refs or []
        for idx, chrt in enumerate(participants or []):
            ref = self._serializable_participant_ref_live(chrt)
            if ref is None and idx < len(fallback_refs) and isinstance(fallback_refs[idx], dict):
                stored = dict(fallback_refs[idx])
                if stored.get("path"):
                    chart_id = str(stored.get("chart_id") or getattr(chrt, "chart_id", "") or "")
                    ref = {
                        "label": stored.get("label") or self._chart_recent_label(chrt, str(stored.get("path") or "")),
                        "path": str(stored.get("path") or ""),
                    }
                    ref.update(self._chart_recent_identity(chrt, chart_id=chart_id))
            if ref is None:
                chart_id = str(getattr(chrt, "chart_id", "") or "")
                ref = {"path": ""}
                ref.update(self._chart_recent_identity(chrt, chart_id=chart_id))
            refs.append(ref)
        return refs

    def _relationship_session_participants(self, session: Optional[dict]) -> list:
        # Source twin: morin._relationship_session_participants, morin.py:5314-5341.
        if not self._is_relationship_session(session):
            return []
        participants = session.get('relationship_participants') if isinstance(session, dict) else None
        states = session.get('relationship_participant_states') if isinstance(session, dict) else None
        if isinstance(participants, (list, tuple)):
            result = []
            seen = set()
            for idx, participant in enumerate(participants):
                if participant is None:
                    continue
                if isinstance(states, (list, tuple)) and idx < len(states) and not bool(states[idx]):
                    continue
                key = id(participant)
                if key in seen:
                    continue
                seen.add(key)
                result.append(participant)
            if result:
                return result
        pair = session.get('synastry_pair') if isinstance(session, dict) else None
        if isinstance(pair, (list, tuple)) and len(pair) == 2:
            return [pair[0], pair[1]]
        return []

    def _relationship_session_all_participants(self, session: Optional[dict]) -> list:
        # Source twin: morin._relationship_session_all_participants, morin.py:5343-5351.
        if not isinstance(session, dict):
            return []
        participants = session.get('relationship_participants')
        if isinstance(participants, (list, tuple)):
            return [participant for participant in participants if participant is not None]
        return self._relationship_session_participants(session)

    def _relationship_session_participant_states(self, session: Optional[dict]) -> list[bool]:
        # Source twin: morin._relationship_session_participant_states, morin.py:5353-5362.
        participants = self._relationship_session_all_participants(session)
        if not participants:
            return []
        states = session.get('relationship_participant_states') if isinstance(session, dict) else None
        if isinstance(states, (list, tuple)) and len(states) == len(participants):
            return [bool(state) for state in states]
        return [True] * len(participants)

    def _ensure_synastry_composite_variants(self, session: dict, center, partner) -> dict:
        key = self._synastry_composite_pair_key(center, partner)
        if session.get('composite_variants_pair_key') != key:
            session['composite_variants'] = {}
            session['composite_variants_pair_key'] = key
        variants = session.get('composite_variants')
        if not isinstance(variants, dict):
            variants = {}
            session['composite_variants'] = variants
        return variants

    def _build_synastry_composite_variant(self, center, partner, variant: str):
        opts = copy.deepcopy(chart_snapshot_service.options)
        title = self._composite_session_title(center, partner, davison=(variant == "davison"))
        if variant == "davison":
            comp = compositechart.build_davison_chart(center, partner, opts, name=title)
        else:
            comp = compositechart.build_composite_chart(center, partner, opts, name=title)
        setattr(comp, "_composite_variant", variant)
        setattr(comp, "_composite_source_pair", (center, partner))
        return comp

    def _cached_synastry_composite_variant(self, session: dict, center, partner, variant: str):
        # Source twin: morin._cached_synastry_composite_variant, morin.py:7669-7694.
        # The daemon keeps one built chart per pair/variant and reuses it on
        # same-document switches; React receives only rendered snapshots.
        variants = self._ensure_synastry_composite_variants(session, center, partner)
        comp = variants.get(variant)
        if comp is None:
            comp = self._build_synastry_composite_variant(center, partner, variant)
            variants[variant] = comp
        return comp

    def _replace_active_composite_chart(
        self,
        session: dict,
        comp,
        pair,
        variant: str,
        *,
        change_reason: str = 'options',
    ) -> bool:
        cs = session.get('chart_session')
        center, partner = pair
        if cs is None or comp is None or center is None or partner is None:
            return False
        display_dt = (
            cs._chart_display_datetime(comp)
            if hasattr(cs, "_chart_display_datetime")
            else getattr(cs, 'display_datetime', None)
        )
        session['compound_kind'] = 'composite_from_synastry'
        session['comparison_chart'] = None
        session['chart'] = comp
        session['synastry_pair'] = (center, partner)
        session['composite_variant'] = variant
        session['option_refresh_handler'] = self._refresh_relationship_session_for_options
        cs.radix = comp
        cs._initial_chart = comp
        cs._initial_display_datetime = display_dt
        cs.view_mode = chart_session.ChartSession.CHART
        cs.change_chart(
            comp,
            display_datetime=display_dt,
            change_reason=change_reason,
        )
        return True

    def _refresh_relationship_session_for_options(self, session: dict, mode: str) -> bool:
        """Refresh relationship charts without generic ``Chart.recalc``.

        Midpoint composites are symbolic charts. Recalculating them as ordinary
        radix charts overwrites the midpoint planet/house state with a chart for
        the pseudo midpoint time. Wx avoids that by rebuilding only the selected
        overlay family on the current chart; in the daemon the equivalent is to
        rebuild the composite from its source participants with the current
        options, and clear stale cached variants for plain synastry.
        """
        if not self._is_relationship_session(session):
            return False
        session['composite_variants'] = None
        session['composite_variants_pair_key'] = None
        if session.get('compound_kind') != 'composite_from_synastry':
            return False
        variant = session.get('composite_variant') or 'midpoint'
        active_participants = self._relationship_session_participants(session)
        if len(active_participants) >= 3:
            comp, pair = self._build_recursive_composite_variant(active_participants, variant)
            title = self._composite_participants_session_title(
                active_participants,
                davison=(variant == 'davison'),
            )
        else:
            center, partner = self._active_synastry_pair(session)
            if center is None or partner is None:
                return False
            comp = self._build_synastry_composite_variant(center, partner, variant)
            pair = (center, partner)
            variants = self._ensure_synastry_composite_variants(session, center, partner)
            variants[variant] = comp
            title = self._composite_session_title(center, partner, davison=(variant == 'davison'))
        if not self._replace_active_composite_chart(
            session,
            comp,
            pair,
            variant,
            change_reason=(
                'options-refresh' if mode == 'house-system' else 'options'
            ),
        ):
            return False
        session['base_title'] = title
        session['custom_title_root'] = title
        self._update_document_title(
            session,
            title,
            getattr(comp, 'name', '') or self._chart_label(comp, "Composite"),
        )
        return True

    def _build_recursive_composite_variant(self, participants, variant: str):
        """Fold 3+ relationship participants through the source composite
        builder without involving React.

        Source twin: morin._build_recursive_composite_variant, morin.py:7640-
        7658. For 3+ participants, the accumulated composite becomes the center
        chart for the next participant.
        """
        participants = [participant for participant in (participants or []) if participant is not None]
        if len(participants) < 2:
            return None, (None, None)
        if len(participants) == 2:
            center = participants[0]
            outer = participants[1]
            return self._build_synastry_composite_variant(center, outer, variant), (center, outer)
        acc_chart, _pair = self._build_recursive_composite_variant(participants[:-1], variant)
        if acc_chart is None:
            return None, (None, None)
        outer = participants[-1]
        return self._build_synastry_composite_variant(acc_chart, outer, variant), (acc_chart, outer)

    @staticmethod
    def _active_synastry_pair(session: Optional[dict]) -> tuple:
        if not isinstance(session, dict):
            return None, None
        pair = session.get('synastry_pair')
        if isinstance(pair, (list, tuple)) and len(pair) == 2 and pair[0] is not None and pair[1] is not None:
            return pair[0], pair[1]
        cs = session.get('chart_session')
        if cs is not None and session.get('compound_kind') == 'synastry':
            center = getattr(cs, 'chart', None)
            partner = session.get('comparison_chart')
            if center is not None and partner is not None:
                return center, partner
        return None, None

    def _update_document_title(self, session: dict, title: str, subtitle: str) -> None:
        session['base_title'] = title
        session['custom_title_root'] = title
        session['custom_subtitle'] = subtitle
        doc_id = session.get('document_id')
        if doc_id:
            self._controller.state.update_document(doc_id, title=title, subtitle=subtitle)

    def _toggle_synastry_center(self, document_id: str, session: dict, cs) -> dict:
        """Swap a plain synastry document's inner/outer charts.

        Source twin: ``morin._toggle_active_synastry_center`` (morin.py:8683-
        8702), reached from Tab via ``ChartSession.toggleComparisonView``'s
        installed handler. This is intentionally daemon-owned so React keeps
        forwarding the raw Tab intent instead of learning relationship semantics.
        """
        center = getattr(cs, 'chart', None) or session.get('chart')
        partner = session.get('comparison_chart')
        if center is None or partner is None:
            raise ValueError("active document is not a plain synastry biwheel")

        session['comparison_chart'] = center
        session['chart'] = partner
        session['synastry_pair'] = (partner, center)
        session['composite_variant'] = None
        cs.radix = partner
        cs.view_mode = chart_session.ChartSession.COMPOUND
        display_dt = (
            cs._chart_display_datetime(partner)
            if hasattr(cs, "_chart_display_datetime")
            else getattr(cs, 'display_datetime', None)
        )
        cs.change_chart(partner, display_datetime=display_dt)
        self._update_document_title(
            session,
            self._synastry_session_title(partner, center),
            self._chart_label(partner),
        )
        self._ensure_synastry_composite_variants(session, partner, center)
        self._manager.broadcast_threadsafe({
            "type": "documents.changed",
            "tree": self._tree_payload(),
        })
        result = {
            "documentId": document_id,
            "toggled": True,
            "compoundKind": session.get('compound_kind'),
            "compositeVariant": session.get('composite_variant'),
            "viewMode": getattr(cs, 'view_mode', 0),
            "documents": self._tree_payload(),
        }
        try:
            result["snapshot"] = self.document_snapshot(
                document_id, overlay_render_mode="full",
            )
        except (ValueError, RuntimeError):
            pass
        self._save_restore_open_charts_state()
        return result

    def set_synastry_composite(self, document_id: str, variant: Optional[str] = None) -> dict:
        """Switch an existing synastry document to midpoint/Davison composite or
        back to synastry, preserving the source same-document id.

        Source twins:
          * morin._open_active_synastry_composite, morin.py:8679-8754
          * morin._toggle_active_composite_variant, morin.py:8611-8677
          * composite builders/cache, morin.py:7572-7694 + compositechart.py
        """
        with self._lock:
            session = self._controller.session(document_id)
            if session is None:
                raise ValueError(f"unknown document {document_id!r}")
            cs = session.get('chart_session')
            if cs is None:
                raise ValueError(f"document {document_id!r} has no chart session")
            center, partner = self._active_synastry_pair(session)
            if center is None or partner is None:
                raise ValueError("active document is not a synastry/composite pair")

            requested = (variant or "").strip().lower()
            current_kind = session.get('compound_kind')
            current_variant = session.get('composite_variant') or "midpoint"
            if requested in ("synastry", "relationship"):
                target = "synastry"
            elif requested in ("midpoint", "davison"):
                target = requested
            elif current_kind == "composite_from_synastry":
                target = "synastry"
            else:
                target = "midpoint"
            active_participants = self._relationship_session_participants(session)

            if target == "synastry":
                display_dt = cs._chart_display_datetime(center) if hasattr(cs, "_chart_display_datetime") else getattr(cs, 'display_datetime', None)
                session['compound_kind'] = 'synastry'
                session['comparison_chart'] = partner
                session['chart'] = center
                session['synastry_pair'] = (center, partner)
                stored_participants = session.get('relationship_participants')
                if (
                    not isinstance(stored_participants, (list, tuple))
                    or not any(participant is not None for participant in stored_participants)
                ):
                    session['relationship_participants'] = [center, partner]
                    session['relationship_participant_states'] = [True, True]
                    session['relationship_participant_refs'] = self._capture_participant_refs(
                        [center, partner],
                        fallback_refs=session.get('relationship_participant_refs') or [],
                    )
                session['composite_variant'] = None
                session['option_refresh_handler'] = self._refresh_relationship_session_for_options
                session['relationship_multiwheel_enabled'] = bool(
                    3 <= len(active_participants) <= chart_rings.CHART_RING_COUNT_MAX
                )
                session.pop("relationship_multiwheel_single_chart_view", None)
                cs.radix = center
                cs._initial_chart = center
                cs._initial_display_datetime = display_dt
                cs.view_mode = chart_session.ChartSession.COMPOUND
                cs.change_chart(center, display_datetime=display_dt)
                self._update_document_title(
                    session,
                    self._synastry_session_title(center, partner),
                    self._chart_label(center),
                )
            else:
                if len(active_participants) >= 3:
                    comp, pair = self._build_recursive_composite_variant(active_participants, target)
                    center, partner = pair
                    if comp is None or center is None or partner is None:
                        raise ValueError("could not rebuild relationship composite")
                    title = self._composite_participants_session_title(
                        active_participants,
                        davison=(target == "davison"),
                    )
                else:
                    comp = self._cached_synastry_composite_variant(session, center, partner, target)
                    title = self._composite_session_title(center, partner, davison=(target == "davison"))
                display_dt = cs._chart_display_datetime(comp) if hasattr(cs, "_chart_display_datetime") else getattr(cs, 'display_datetime', None)
                session['compound_kind'] = 'composite_from_synastry'
                session['comparison_chart'] = None
                session['chart'] = comp
                session['synastry_pair'] = (center, partner)
                if len(active_participants) < 3:
                    session['relationship_participants'] = [center, partner]
                    session['relationship_participant_states'] = [True, True]
                    session['relationship_participant_refs'] = self._capture_participant_refs(
                        [center, partner],
                        fallback_refs=session.get('relationship_participant_refs') or [],
                    )
                session['composite_variant'] = target
                cs.radix = comp
                cs._initial_chart = comp
                cs._initial_display_datetime = display_dt
                cs.view_mode = chart_session.ChartSession.CHART
                cs.change_chart(comp, display_datetime=display_dt)
                self._update_document_title(
                    session,
                    title,
                    getattr(comp, 'name', '') or self._chart_label(comp, "Composite"),
                )

            self._manager.broadcast_threadsafe({
                "type": "documents.changed",
                "tree": self._tree_payload(),
            })
            result = {
                "documentId": document_id,
                "compoundKind": session.get('compound_kind'),
                "compositeVariant": session.get('composite_variant'),
                "viewMode": getattr(cs, 'view_mode', 0),
                "documents": self._tree_payload(),
            }
            try:
                result["snapshot"] = self.document_snapshot(
                    document_id, overlay_render_mode="full",
                )
            except (ValueError, RuntimeError):
                pass
            self._save_restore_open_charts_state()
            return result

    def toggle_relationship_participant(self, document_id: str, participant_index: int) -> dict:
        """Toggle one relationship participant and rebuild the daemon chart.

        Source twin: morin._workspace_toggle_composite_participant,
        morin.py:11389-11442. Visible only for 3+ participants; refuses to drop
        below one active participant; single-active demotes to a plain radix.
        """
        with self._lock:
            session = self._controller.session(document_id)
            if session is None:
                raise ValueError(f"unknown document {document_id!r}")
            participants = self._relationship_session_all_participants(session)
            if len(participants) < 3:
                raise ValueError("relationship participant toggles require 3+ participants")
            if participant_index < 0 or participant_index >= len(participants):
                raise ValueError(f"participant index {participant_index!r} out of range")
            states = self._relationship_session_participant_states(session)
            was_synastry = session.get('compound_kind') == 'synastry'
            states[participant_index] = not bool(states[participant_index])
            if sum(1 for state in states if state) < 1:
                raise ValueError("cannot deactivate every relationship participant")
            active_participants = [
                participant for idx, participant in enumerate(participants) if states[idx]
            ]
            cs = session.get('chart_session')
            if cs is None:
                raise ValueError(f"document {document_id!r} has no chart session")

            session['relationship_participants'] = list(participants)
            session['relationship_participant_states'] = list(states)
            session['relationship_participant_refs'] = self._capture_participant_refs(participants)
            variant = session.get('composite_variant') or 'midpoint'
            next_view_mode = chart_session.ChartSession.CHART

            if len(active_participants) == 1:
                next_chart = active_participants[0]
                session['chart'] = next_chart
                session['synastry_pair'] = None
                session['comparison_chart'] = None
                session['compound_kind'] = None
                session['comparison_name'] = None
                session['launcher_kind'] = None
                session['base_title'] = self._chart_label(next_chart)
                session['custom_title_root'] = session['base_title']
                session['composite_variant'] = None
                session['composite_variants'] = None
                session['composite_variants_pair_key'] = None
                cs.radix = next_chart
            elif was_synastry:
                center = active_participants[0]
                outer = active_participants[-1]
                next_chart = center
                session['chart'] = center
                session['synastry_pair'] = (center, outer)
                session['comparison_chart'] = outer
                session['comparison_name'] = self._chart_label(outer, "Comparison")
                session['compound_kind'] = 'synastry'
                session['launcher_kind'] = 'synastry'
                session['base_title'] = self._synastry_session_title(center, outer)
                session['custom_title_root'] = session['base_title']
                session['composite_variant'] = None
                session['composite_variants'] = None
                session['composite_variants_pair_key'] = None
                cs.radix = center
                next_view_mode = chart_session.ChartSession.COMPOUND
                self._ensure_synastry_composite_variants(session, center, outer)
            else:
                next_chart, pair = self._build_recursive_composite_variant(active_participants, variant)
                center, outer = pair
                if next_chart is None or center is None or outer is None:
                    raise ValueError("could not rebuild relationship composite")
                session['chart'] = next_chart
                session['synastry_pair'] = (center, outer)
                session['comparison_chart'] = None
                session['compound_kind'] = 'composite_from_synastry'
                session['launcher_kind'] = 'synastry'
                session['base_title'] = self._composite_participants_session_title(
                    active_participants,
                    davison=(variant == 'davison'),
                )
                session['custom_title_root'] = session['base_title']
                session['composite_variants'] = None
                session['composite_variants_pair_key'] = None
                cs.radix = next_chart

            cs.view_mode = next_view_mode
            display_dt = cs._chart_display_datetime(next_chart) if hasattr(cs, "_chart_display_datetime") else getattr(cs, 'display_datetime', None)
            cs._initial_chart = next_chart
            cs._initial_display_datetime = display_dt
            cs.change_chart(next_chart, display_datetime=display_dt)
            self._update_document_title(
                session,
                session['base_title'],
                getattr(next_chart, 'name', '') or self._chart_label(next_chart),
            )
            self._manager.broadcast_threadsafe({
                "type": "documents.changed",
                "tree": self._tree_payload(),
            })
            result = {
                "documentId": document_id,
                "participantStates": list(states),
                "activeParticipantCount": len(active_participants),
                "compoundKind": session.get('compound_kind'),
                "compositeVariant": session.get('composite_variant'),
                "documents": self._tree_payload(),
            }
            try:
                result["snapshot"] = self.document_snapshot(
                    document_id, overlay_render_mode="full",
                )
            except (ValueError, RuntimeError):
                pass
            return result

    def split_compound_into_radixes(self, document_id: str) -> dict:
        """Open each relationship participant as a standalone radix and close
        the compound document.

        Source twin: morin._workspace_split_compound_into_radixes,
        morin.py:11344-11387. Existing non-compound participant tabs are reused;
        the compound tab is torn down through the controller close lifecycle.
        """
        with self._lock:
            session = self._controller.session(document_id)
            if session is None:
                raise ValueError(f"unknown document {document_id!r}")
            participants = session.get('relationship_participants') or []
            pair = session.get('synastry_pair')
            if not participants and isinstance(pair, (list, tuple)) and len(pair) >= 2:
                participants = list(pair)
            participants = [participant for participant in participants if participant is not None]
            if len(participants) < 2:
                raise ValueError("split requires at least two relationship participants")
            stored_refs = session.get('relationship_participant_refs') or []
            opened_ids: list[str] = []
            reused_ids: list[str] = []
            for idx, participant in enumerate(participants):
                existing = self._find_noncompound_session_for_chart(participant)
                if existing is not None:
                    reused_ids.append(str(existing.get('document_id') or ""))
                    continue
                fpath = ""
                dpath = ""
                if idx < len(stored_refs) and isinstance(stored_refs[idx], dict):
                    fpath = str(stored_refs[idx].get('path') or "")
                    dpath = str(Path(fpath).expanduser().parent) if fpath else ""
                document = self._controller.open_document(
                    participant,
                    radix=participant,
                    fpath=fpath,
                    dpath=dpath,
                    session_label=self._chart_label(participant),
                    dirty=False,
                )
                if document is not None:
                    opened_ids.append(document.document_id)
            close_result = self._controller.close_document(document_id, cascade=True)
            self._manager.broadcast_threadsafe({
                "type": "documents.changed",
                "tree": self._tree_payload(),
            })
            return {
                "documentId": document_id,
                "openedIds": opened_ids,
                "reusedIds": [doc_id for doc_id in reused_ids if doc_id],
                "closedIds": list(close_result.closed_ids),
                "nextActiveId": close_result.next_active_id,
                "documents": self._tree_payload(),
            }

    def _find_noncompound_session_for_chart(self, chrt) -> Optional[dict]:
        if chrt is None:
            return None
        for session in self._controller._runtime.values():
            if session.get('compound_kind'):
                continue
            cs = session.get('chart_session')
            session_chart = getattr(cs, 'chart', None) if cs is not None else session.get('chart')
            if session_chart is chrt or session.get('chart') is chrt:
                return session
        return None

    def _relationship_participant_fpath_dpath(
        self, session: dict, participant, participant_index: int
    ) -> tuple[str, str, bool]:
        """Resolve a participant's file lineage for extraction.

        Source twin: morin._open_workspace_extracted_participant
        (morin.py:11449-11466). The participant inherits fpath/dpath ONLY if it
        already lives in a non-relationship session; a chart that exists only as
        part of the compound extracts unbacked (fpath='', add_to_history=False).
        The daemon also consults the stored participant refs so a restored
        compound (whose participants were never opened standalone) still recovers
        its source path, mirroring the split door's stored-ref fallback
        (morin.py:11367-11369).
        """
        source_session = self._find_noncompound_session_for_chart(participant)
        if source_session is not None:
            fpath = str(source_session.get('fpath', '') or '')
            dpath = str(source_session.get('dpath', '') or '')
            return fpath, dpath, bool(fpath)
        stored_refs = session.get('relationship_participant_refs') or []
        if 0 <= participant_index < len(stored_refs) and isinstance(
            stored_refs[participant_index], dict
        ):
            fpath = str(stored_refs[participant_index].get('path') or '')
            dpath = str(Path(fpath).expanduser().parent) if fpath else ''
            return fpath, dpath, bool(fpath)
        return '', '', False

    def _open_extracted_participant(
        self, session: dict, participant, participant_index: int
    ) -> Optional[str]:
        """Open one relationship participant as its own radix document.

        Source twin: morin._open_workspace_extracted_participant
        (morin.py:11449-11466). Unlike Split, the compound document is left open;
        an already-open standalone tab for the same chart is reused rather than
        duplicated (the wx door re-enters _open_workspace_session, which the
        daemon controller keys by chart identity through the runtime scan).
        """
        if participant is None:
            return None
        existing = self._find_noncompound_session_for_chart(participant)
        if existing is not None:
            doc_id = str(existing.get('document_id') or '')
            if doc_id:
                self._controller.activate_document(doc_id)
            return doc_id or None
        fpath, dpath, add_to_history = self._relationship_participant_fpath_dpath(
            session, participant, participant_index
        )
        document = self._controller.open_document(
            participant,
            radix=participant,
            fpath=fpath,
            dpath=dpath,
            session_label=self._chart_label(participant),
            dirty=False,
        )
        if document is None:
            return None
        # wx passes add_to_history=bool(fpath) through _open_workspace_session,
        # which remembers a file-backed chart in the recent list
        # (morin.py:11459, 11464). The daemon's recents-store analog is
        # _remember_recent_chart; the desktop FileHistory submenu itself is wx
        # chrome superseded by the daemon Recent Charts surface.
        if add_to_history and fpath:
            self._remember_recent_chart(participant, fpath)
        return document.document_id

    def extract_relationship_participant(
        self, document_id: str, participant_index: int
    ) -> dict:
        """Open one relationship participant as a standalone radix.

        Source twin: morin._workspace_extract_relationship_participant
        (morin.py:11468-11473). The compound document stays open; the extracted
        chart becomes the active document.
        """
        with self._lock:
            session = self._controller.session(document_id)
            if session is None:
                raise ValueError(f"unknown document {document_id!r}")
            participants = self._relationship_session_all_participants(session)
            if participant_index < 0 or participant_index >= len(participants):
                raise ValueError("participant index out of range")
            opened_id = self._open_extracted_participant(
                session, participants[participant_index], participant_index
            )
            self._manager.broadcast_threadsafe({
                "type": "documents.changed",
                "tree": self._tree_payload(),
            })
            self._save_restore_open_charts_state()
            return {
                "documentId": opened_id,
                "activeDocumentId": self._controller.active_document_id(),
                "documents": self._tree_payload(),
            }

    def extract_all_relationship_participants(self, document_id: str) -> dict:
        """Open every relationship participant as its own radix document.

        Source twin: morin._workspace_extract_all_relationship_participants
        (morin.py:11475-11479). The compound document stays open.
        """
        with self._lock:
            session = self._controller.session(document_id)
            if session is None:
                raise ValueError(f"unknown document {document_id!r}")
            participants = self._relationship_session_all_participants(session)
            opened_ids: list[str] = []
            for idx, participant in enumerate(participants):
                opened_id = self._open_extracted_participant(session, participant, idx)
                if opened_id:
                    opened_ids.append(opened_id)
            self._manager.broadcast_threadsafe({
                "type": "documents.changed",
                "tree": self._tree_payload(),
            })
            self._save_restore_open_charts_state()
            return {
                "openedIds": list(dict.fromkeys(opened_ids)),
                "activeDocumentId": self._controller.active_document_id(),
                "documents": self._tree_payload(),
            }

    def open_here_now(self, *, when_iso: Optional[str] = None) -> dict:
        """Open File -> Here and Now as a REAL self-anchored workspace document
        (a current-moment chart with its own daemon cursor) — not a client
        fabricated 'now' from the browser clock. The chart is built wx-free via
        chart_snapshot_service (mirrors morin._build_here_and_now_chart); the
        skin renders it by document id and steps it like any other doc."""
        with self._lock:
            opts = chart_snapshot_service.options
            chrt = chart_snapshot_service._build_here_now_chart(opts, when_iso=when_iso)
            # wx parity (morin.py:9735-9752 _open_workspace_horary_session):
            # here-and-now opens CLEAN (dirty/edit/step all False — the star
            # appears only when the HorarySession is stepped off its open
            # moment) and runs on HorarySession so the step-dirty hook fires.
            document = self._controller.open_document(
                chrt,
                radix=chrt,
                session_label=getattr(chrt, 'name', mtexts.txts.get("HereAndNow", "Here and Now")),
                navigation_units=('day', 'hour', 'minute', 'second'),
                dirty=False,
                session_factory=horary_session.HorarySession,
            )
            # Here-and-Now is an unsaved ephemeral HORARY chart; wx remembers it
            # in the recent list at OPEN time (morin.py:14928), so it shows in
            # Recent Charts before the user closes it.
            self._remember_recent_chart(chrt, "")
            self._manager.broadcast_threadsafe({
                "type": "documents.changed",
                "tree": self._tree_payload(),
            })
            if document is None:
                return {"documentId": None, "documents": self._tree_payload()}
            return self._attach_full_snapshot({
                "documentId": document.document_id,
                "activeDocumentId": self._controller.active_document_id(),
                "documents": self._tree_payload(),
            }, document.document_id)

    def set_document_lens(self, document_id: str, lens: Optional[dict]) -> dict:
        """Mirror the skin's interpretation lens onto a horary document's chart.

        wx twin: morin._mirror_lens_to_horary_session (morin.py:9062-9071) —
        `chrt.interpretation` is the authoritative slot; chartfile.chart_to_dict
        round-trips it through the JSONL record on save (chartfile.py:154-165)
        and dict_to_chart restores it on load (chartfile.py:276-282). Non-horary
        charts are left untouched (the lens is a global cursor that follows the
        user). A None lens CLEARS the slot (morin.py:9030-9031 + 9041)."""
        with self._lock:
            session = self._controller.session(document_id)
            if session is None:
                raise ValueError(f"unknown document {document_id!r}")
            charts = self._horary_session_charts(session)
            mirrored = bool(charts)
            changed = False
            normalized = (
                self._normalize_horary_interpretation(lens)
                if charts else None
            )
            for chrt in charts:
                current = getattr(chrt, 'interpretation', None) or None
                # Compare effective semantics, not the persisted JSON shape.
                # Older records legitimately omit context fields which newer
                # pack manifests fill from their declared defaults.  Adopting
                # such a record into the global lens and mirroring it straight
                # back must remain a no-op: opening/switching a tab is not an
                # edit and must not dirty the chart or broadcast a document
                # change merely because the manifest learned new defaults.
                canonical_current = self._normalize_horary_interpretation(
                    current, strict=False,
                )
                if canonical_current == normalized:
                    continue
                chrt.interpretation = copy.deepcopy(normalized)
                changed = True
            if changed and str(session.get('fpath') or '').strip():
                # Interpretation/context is serialized into the bound chart
                # record.  Treat a material change like any other file-backed
                # edit so close/quit cannot discard it silently.
                self._controller.set_dirty(document_id, edit_dirty=True)
            if changed:
                self._manager.broadcast_threadsafe({
                    "type": "documents.changed",
                    "tree": self._tree_payload(),
                })
            return {
                "ok": True,
                "mirrored": mirrored,
                "documents": self._tree_payload(),
            }

    def open_lens_here_now(self, discipline: str, theme: Optional[str] = None) -> dict:
        """No-chart fallback for a Charts > Elections / Horary theme pick.

        Port of morin._open_elections / _open_horary (morin.py:19057-19114,
        18979-19032): when no chart is open, picking a theme still builds a
        here-and-now chart so the lens has something to evaluate —
        elections: a TRANSIT 'Election Base' chart (morin.py:19082-19101);
        horary: a HORARY chart on HorarySession (morin.py:19005-19029, same
        session the open-here-now door uses). Both open with d/h/m/s stepping
        units and the wx label 'Discipline: Theme (Y.Mon.D H:MM:SS)'. The LENS
        itself stays client presentation state (inspectorLens); this door only
        supplies the chart.
        """
        with self._lock:
            opts = chart_snapshot_service.options
            chart_mod = export_chart_json.chart_mod
            if discipline == 'elections':
                chrt = chart_snapshot_service._build_here_now_chart(
                    opts, chart_type=chart_mod.Chart.TRANSIT,
                    name=mtexts.txts.get("ElectionBase", "Election Base"))
                base = mtexts.txts.get('Elections', 'Elections')
                session_factory = None
            elif discipline == 'horary':
                chrt = chart_snapshot_service._build_here_now_chart(
                    opts, chart_type=chart_mod.Chart.HORARY, name='Horary')
                base = mtexts.txts.get('Horary', 'Horary')
                session_factory = horary_session.HorarySession
                # wx _open_horary seeds the lens with the theme's default
                # significator context and mirrors it onto the chart at once
                # (morin.py:18992 + 19031); the daemon owns the mirror so the
                # save round-trip works without an extra skin round trip.
                if theme:
                    chrt.interpretation = {
                        'discipline': 'horary',
                        'theme': theme,
                        'context': dict(
                            horary_rules.DEFAULT_SIGNIFICATORS.get(theme) or {}),
                    }
            else:
                raise ValueError("unknown lens discipline: %r" % (discipline,))
            t = chrt.time
            if t.bc:
                # wx refuses BC here-and-now charts (morin.py:19087-19091).
                raise RuntimeError(mtexts.txts.get('NotAvailable', 'Not available'))
            if theme:
                base = base + ': ' + theme
            month = common.common.months[t.origmonth - 1]
            date_txt = dateformat.date_text_named_month(
                t.origyear,
                month,
                t.origday,
                chart_snapshot_service.options,
                pad_year=False,
                pad_day=False,
            )
            label = '%s (%s %d:%02d:%02d)' % (
                base, date_txt, t.hour, t.minute, t.second)
            kwargs = {}
            if session_factory is not None:
                kwargs['session_factory'] = session_factory
            document = self._controller.open_document(
                chrt,
                radix=chrt,
                session_label=label,
                navigation_units=('day', 'hour', 'minute', 'second'),
                display_datetime=(t.origyear, t.origmonth, t.origday,
                                  t.hour, t.minute, t.second),
                dirty=False,
                **kwargs,
            )
            self._manager.broadcast_threadsafe({
                "type": "documents.changed",
                "tree": self._tree_payload(),
            })
            if document is None:
                return {"documentId": None, "documents": self._tree_payload()}
            return self._attach_full_snapshot({
                "documentId": document.document_id,
                "activeDocumentId": self._controller.active_document_id(),
                "documents": self._tree_payload(),
            }, document.document_id)

    def open_astrocart(self, parent_radix_id: str,
                       eclipse_jd: Optional[float] = None,
                       eclipse_retflag: Optional[int] = None) -> dict:
        """Open astrocartography as a lightweight view-only child document.

        Unlike returns/progressions/synastry, astrocart has no chart session — in
        the wx frame it is a table panel hosted in the workspace
        (morin.py:16208 _workspace_table_astrocart -> _show_table_in_workspace),
        not a ChartSession tab. We model it the same way: a tracked document under
        the radix with ``radix=None`` (so open_document creates NO ChartSession),
        carrying ``launcher_kind='astrocart'`` and the parent's source name so the
        frontend can fetch the map from the existing GET /api/astrocart/lines.
        It still flows through the controller, so it indents under the parent,
        cascade-closes with it, and activates like any other document.

        Frontend still needed: render the map for an 'astrocart' launcher_kind doc
        by calling /api/astrocart/lines?source_name=<comparisonName-or-radix> —
        this command does not push a chart snapshot (there is no chart)."""
        with self._lock:
            center = self._parent_radix(parent_radix_id)
            parent_session = self._controller.session(parent_radix_id) or {}
            parent_fpath = parent_session.get('fpath', '')
            source_name = getattr(center, 'name', '') or 'Radix'
            title = mtexts.txts.get("AstrocartographyTitleFmt", "Astrocartography — %s") % source_name
            existing_document = None
            for document in self._controller.documents():
                if document.parent_document_id != parent_radix_id:
                    continue
                session = self._controller.session(document.document_id) or {}
                if session.get('launcher_kind') == 'astrocart':
                    existing_document = document
                    break
            if existing_document is not None:
                session = self._controller.session(existing_document.document_id)
                if session is not None:
                    session['comparison_name'] = source_name
                    if eclipse_jd is None:
                        session.pop('eclipse_event_payload', None)
                    else:
                        session['eclipse_event_payload'] = {
                            'jdUt': float(eclipse_jd),
                            'retflag': int(eclipse_retflag or 0),
                        }
                self._controller.state.update_document(
                    existing_document.document_id,
                    title=title,
                    subtitle=source_name,
                    path=parent_fpath,
                )
                self._controller.activate_document(existing_document.document_id)
                self._manager.broadcast_threadsafe({
                    "type": "documents.changed",
                    "tree": self._tree_payload(),
                })
                return {
                    "documentId": existing_document.document_id,
                    "activeDocumentId": self._controller.active_document_id(),
                    "documents": self._tree_payload(),
                    "reused": True,
                }
            document = self._controller.open_document(
                center,
                fpath=parent_fpath,
                radix=None,  # view-only: no ChartSession, no cursor
                session_label=title,
                parent_document_id_override=parent_radix_id,
                launcher_kind='astrocart',
                dirty=False,
            )
            if document is not None:
                session = self._controller.session(document.document_id)
                if session is not None:
                    # The map is fetched by source name; persist it for the client.
                    session['comparison_name'] = source_name
                    # Eclipse path overlay — the wx twin passes the eclipse
                    # event into AstrocartPanel (morin.py:16198-16227
                    # _workspace_table_astrocart(eclipse_event=...) /
                    # show_eclipse_path_on_map). The skin fetches the GeoJSON
                    # from /api/astrocart/eclipse-path with these values.
                    if eclipse_jd is not None:
                        session['eclipse_event_payload'] = {
                            'jdUt': float(eclipse_jd),
                            'retflag': int(eclipse_retflag or 0),
                        }
            self._manager.broadcast_threadsafe({
                "type": "documents.changed",
                "tree": self._tree_payload(),
            })
            if document is None:
                return {"documentId": None, "documents": self._tree_payload()}
            return {
                "documentId": document.document_id,
                "activeDocumentId": self._controller.active_document_id(),
                "documents": self._tree_payload(),
            }

    def open_directions(
        self,
        parent_radix_id: str,
        *,
        custom_significator: Optional[dict[str, Any]] = None,
    ) -> dict:
        """Open the Primary Directions list as a lightweight view-only child.

        Like astrocartography (open_astrocart above), the PD list is a real
        dated-directions TABLE, not a ChartSession tab — in the wx frame it is a
        list window driven by the engine PD pipeline, with no chart cursor of its
        own. We model it the same way: a tracked document under the owning chart
        with ``radix=None`` (so open_document creates NO ChartSession), carrying
        ``launcher_kind='directions'`` and the parent's source name so the
        frontend can fetch the list from the existing GET /api/directions
        (+ /api/directions/annual). It still flows through the controller, so it
        indents under the parent, cascade-closes with it, and activates like any
        other document. When the owner is a return chart, row-launched timed
        charts are nested under that return while keeping the branch radix for
        calculation identity.

        Frontend renders the list for a 'directions' launcher_kind doc by calling
        /api/directions?name=<comparisonName-or-radix> (DirectionsView); this
        command does not push a chart snapshot (there is no chart)."""
        with self._lock:
            center = self._parent_radix(parent_radix_id)
            parent_session = self._controller.session(parent_radix_id)
            parent_cs = parent_session.get('chart_session') if parent_session else None
            parent_fpath = parent_session.get('fpath', '') if parent_session else ''
            focus_dt = (
                _display_tuple_to_iso(getattr(parent_cs, 'display_datetime', None))
                if parent_cs is not None else None
            )
            source_name = getattr(center, 'name', '') or 'Radix'
            normalized_sig = None
            if custom_significator is not None:
                from webapp.daemon.directions_service import normalize_custom_significator

                normalized_sig = normalize_custom_significator(custom_significator)
            from webapp.daemon.options_service import _primary_directions_default_direction

            default_direction = _primary_directions_default_direction(chart_snapshot_service.options)
            session_label = mtexts.txts.get(
                "PrimaryDirectionsTitleFmt", "Primary Directions — %s") % source_name
            if normalized_sig is not None:
                session_label = mtexts.txts.get(
                    "PrimaryDirectionsToTitleFmt", "Primary Directions to %s — %s") % (
                    normalized_sig["label"],
                    source_name,
                )
            document = self._controller.open_document(
                center,
                fpath=parent_fpath,
                radix=None,  # view-only: no ChartSession, no cursor
                session_label=session_label,
                parent_document_id_override=parent_radix_id,
                launcher_kind='directions',
                dirty=False,
            )
            if document is not None:
                session = self._controller.session(document.document_id)
                if session is not None:
                    # The list is fetched by source name; persist it for the client.
                    session['comparison_name'] = source_name
                    session['directions_focus_datetime'] = focus_dt
                    session['directions_default_direction'] = default_direction
                    if normalized_sig is not None:
                        session['directions_custom_significator'] = normalized_sig
            self._manager.broadcast_threadsafe({
                "type": "documents.changed",
                "tree": self._tree_payload(),
            })
            if document is None:
                return {"documentId": None, "documents": self._tree_payload()}
            return {
                "documentId": document.document_id,
                "activeDocumentId": self._controller.active_document_id(),
                "documents": self._tree_payload(),
            }

    def open_transit_search(
        self,
        parent_document_id: str,
        *,
        significator_id: Optional[str] = None,
        chart_role: Optional[str] = None,
        custom_points: Optional[list[dict[str, Any]]] = None,
    ) -> dict:
        """Open the transit search engine as a lightweight view-only child.

        Source edges:
        - menu launcher: ``morin.onSearchModule`` opens ``SearchFrame`` for the
          current chart (morin.py:17334-17342);
        - context launcher: ``Find transits`` seeds one significator and limits
          the technique to Transits (morin.py:1070-1082, 17467-17477);
        - backend: ``SearchWnd`` calls ``searchbackend.search`` with
          ``SearchQuery.TECHNIQUE_TRANSITS`` when seeded (searchwnd.py:3547).

        Like directions/astrocart/astrolabe, this is a view-only document: it
        carries no ChartSession, but it lives under the reference chart so close
        cascade and activation are still managed by the controller.
        """
        with self._lock:
            reference_chart = self._search_reference_chart_for_document(
                parent_document_id, chart_role=chart_role)
            if reference_chart is None:
                reference_chart = self._parent_radix(parent_document_id)
            source_name = getattr(reference_chart, "name", "") or "Radix"
            custom_points = [dict(point) for point in list(custom_points or []) if isinstance(point, dict)]
            label, glyph = self._search_seed_label_and_glyph(
                reference_chart, str(significator_id or ""), custom_points)
            session_title = mtexts.txts.get("TransitSearchTitleFmt", "Transit Search — %s") % source_name
            document = self._controller.open_document(
                reference_chart,
                radix=None,
                session_label=session_title,
                parent_document_id_override=parent_document_id,
                launcher_kind="transit_search",
                dirty=False,
            )
            if document is not None:
                session = self._controller.session(document.document_id)
                if session is not None:
                    session["comparison_name"] = source_name
                    session["search_initial_significator_id"] = str(significator_id or "")
                    session["search_chart_role"] = self._normalize_search_chart_role(chart_role)
                    session["search_initial_label"] = label
                    session["search_initial_glyph"] = glyph
                    session["search_custom_points"] = custom_points
            self._manager.broadcast_threadsafe({
                "type": "documents.changed",
                "tree": self._tree_payload(),
            })
            if document is None:
                return {"documentId": None, "documents": self._tree_payload()}
            return {
                "documentId": document.document_id,
                "activeDocumentId": self._controller.active_document_id(),
                "documents": self._tree_payload(),
            }

    @staticmethod
    def _search_seed_label_and_glyph(chrt, significator_id: str, custom_points: list[dict[str, Any]]) -> tuple[str, str]:
        if not significator_id:
            return "", ""
        catalog = searchcatalog.SearchCatalog(chrt, custom_points=custom_points)
        obj = catalog.get(significator_id)
        if obj is None:
            return "", ""
        glyph = ""
        if obj.planet_index is not None:
            glyph = common.common.get_planet_glyph(obj.planet_index)
        elif obj.id == "point:lof":
            glyph = common.common.fortune
        return obj.label, glyph

    def search_context(self, document_id: str) -> dict[str, Any]:
        """Return the daemon-owned chart/context for a transit-search document."""
        with self._lock:
            session = self._controller.session(document_id)
            if session is None:
                raise ValueError(f"unknown search document {document_id!r}")
            if session.get("launcher_kind") != "transit_search":
                raise ValueError(f"document {document_id!r} is not a transit search")
            chrt = session.get("chart")
            if chrt is None:
                raise ValueError("search document has no reference chart")
            return {
                "chart": chrt,
                "chart_role": session.get("search_chart_role") or None,
                "custom_points": list(session.get("search_custom_points") or []),
                "initial_significator_id": session.get("search_initial_significator_id") or None,
            }

    def search_context_for_document(
        self,
        document_id: str,
        *,
        significator_id: Optional[str] = None,
        chart_role: Optional[str] = None,
        custom_points: Optional[list[dict[str, Any]]] = None,
    ) -> dict[str, Any]:
        """Return the chart/context for an in-pane transit search.

        This is the non-document path: the active chart remains active and the
        React right pane holds presentation state. The chart resolution mirrors
        ``open_transit_search`` so sidebar Search and chart-region Find Transits
        use the same reference chart without creating a workspace tab.
        """
        with self._lock:
            reference_chart = self._search_reference_chart_for_document(
                document_id, chart_role=chart_role)
            if reference_chart is None:
                reference_chart = self._parent_radix(document_id)
            if reference_chart is None:
                raise ValueError(f"document {document_id!r} has no searchable chart")
            cleaned_custom_points = [
                dict(point)
                for point in list(custom_points or [])
                if isinstance(point, dict)
            ]
            return {
                "chart": reference_chart,
                "chart_role": self._normalize_search_chart_role(chart_role),
                "custom_points": cleaned_custom_points,
                "initial_significator_id": str(significator_id or "") or None,
            }

    @staticmethod
    def _normalize_search_chart_role(chart_role: Optional[str]) -> Optional[str]:
        return "outer" if chart_role == "outer" else "primary" if chart_role == "primary" else None

    def _aspect_list_owner_session(self, host_session: dict, chrt) -> Optional[dict]:
        """Resolve the workspace session that owns one displayed wheel role.

        ``_select_render_charts`` may return the live child, its immediate
        parent, or the branch radix after the show-radix center switch.  Role
        names and symbolic motion therefore have to resolve from the returned
        chart object, not from the Aspect List host alone.
        """
        if chrt is None:
            return None
        host_cs = host_session.get("chart_session") if isinstance(host_session, dict) else None
        if host_cs is not None and getattr(host_cs, "chart", None) is chrt:
            return host_session
        owner_id = self._controller._document_id_for_chart(chrt)
        if owner_id is None:
            return None
        return self._controller.session(str(owner_id))

    def _aspect_list_role_label(self, owner: Optional[dict], chrt, fallback: str) -> str:
        """Use the actual owning document/session label for a wheel role."""
        if isinstance(owner, dict):
            # A synastry document owns the current center participant, but its
            # document title describes the relationship rather than that
            # participant.  Participant names remain the truthful role labels.
            if owner.get("compound_kind") == "synastry":
                return self._chart_label(chrt, fallback)
            label = str(
                owner.get("custom_title_root")
                or owner.get("base_title")
                or ""
            ).strip()
            if label:
                return label.rstrip(" *")
        return self._chart_label(chrt, fallback)

    def _aspect_symbolic_builder(
        self,
        owner: dict,
        feature_kind: str,
        radix,
    ):
        """Snapshot the canonical Binding -> Deriver trajectory for a role."""
        binding_payload = copy.deepcopy(owner.get("supplementary_binding") or {})
        planet_type = owner.get("planetary_return_type")
        calendar = int(getattr(getattr(radix, "time", None), "cal", 0) or 0)

        def build(candidate_jd: float):
            candidate_binding = binding_payload
            if feature_kind == "converse_transits":
                candidate = self._aspect_converse_candidate(
                    binding_payload,
                    radix,
                    candidate_jd,
                )
                if candidate is None:
                    return None
                values, candidate_binding = candidate
            else:
                values = self._jd_to_calendar_datetime(float(candidate_jd), calendar)
                if values is None:
                    return None
            when = datetime.datetime(*[int(value) for value in values[:6]])
            if feature_kind == "solar_arc":
                result = self._build_solar_arc_child_result(
                    radix,
                    when,
                    binding_payload=candidate_binding,
                )
            else:
                public_kind = FEATURE_TO_PUBLIC_KIND.get(feature_kind)
                if public_kind is None:
                    return None
                result = supplementary_service.build_result(
                    radix=radix,
                    kind=public_kind,
                    when=when,
                    binding_payload=candidate_binding,
                    planet_type=(
                        int(planet_type)
                        if planet_type is not None and feature_kind == "planetary_return"
                        else None
                    ),
                )
            return result.get("chart") if isinstance(result, dict) else None

        return build

    def _aspect_converse_candidate(
        self,
        binding_payload: dict[str, Any],
        radix,
        candidate_jd: float,
    ) -> Optional[tuple[tuple[int, int, int, int, int, int], dict[str, Any]]]:
        """Keep one Aspect List candidate on the retained symbolic clock."""
        try:
            exact_jd = float(candidate_jd)
        except (TypeError, ValueError):
            return None
        if not math.isfinite(exact_jd):
            return None
        candidate_binding = copy.deepcopy(binding_payload or {})
        retained = dict(candidate_binding.get("retained_state") or {})
        values = supplementary_adapter.retained_clock_local_tuple_for_jd(
            retained,
            "symbolic",
            exact_jd,
            fallback_place=getattr(radix, "place", None),
            fallback_time=getattr(radix, "time", None),
        )
        if values is None:
            return None
        display_datetime = tuple(int(value) for value in values[:6])
        retained.update({
            "display_datetime": display_datetime,
            "symbolic_cursor_datetime": display_datetime,
            "symbolic_cursor_jd": exact_jd,
        })
        candidate_binding["parent_source_datetime"] = display_datetime
        candidate_binding["retained_state"] = retained
        return display_datetime, candidate_binding

    def _aspect_symbolic_anchor_jd(
        self,
        owner: dict,
        owner_cs,
        display_dt,
        radix,
        feature_kind: str,
    ) -> Optional[float]:
        """Resolve a symbolic trajectory anchor without demoting exact state."""
        if feature_kind == "converse_transits":
            binding = owner.get("supplementary_binding") or {}
            retained = (
                binding.get("retained_state") or {}
                if isinstance(binding, dict)
                else {}
            )
            for candidate in (
                retained.get("symbolic_cursor_jd"),
                getattr(owner_cs, "cursor_jd", None),
            ):
                try:
                    exact_jd = float(candidate)
                except (TypeError, ValueError):
                    continue
                if math.isfinite(exact_jd):
                    return exact_jd
        return self._display_datetime_jd(display_dt, radix)

    def _aspect_pd_builder(self, owner: dict, radix):
        """Snapshot the existing PD-in-Chart cursor builder without mutation."""
        session_snapshot = dict(owner)
        session_snapshot["pd_in_chart_binding"] = copy.deepcopy(
            owner.get("pd_in_chart_binding") or {}
        )
        calendar = int(getattr(getattr(radix, "time", None), "cal", 0) or 0)

        def build(candidate_jd: float):
            values = self._jd_to_calendar_datetime(float(candidate_jd), calendar)
            if values is None:
                return None
            result = self._build_pd_in_chart_for_cursor(
                session_snapshot,
                datetime.datetime(*[int(value) for value in values[:6]]),
            )
            return result[0] if result is not None else None

        return build

    def _aspect_list_role_context(
        self,
        host_session: dict,
        chrt,
        role: str,
    ) -> dict[str, Any]:
        """Describe one displayed chart role's real motion/time authority."""
        owner = self._aspect_list_owner_session(host_session, chrt)
        owner_cs = owner.get("chart_session") if isinstance(owner, dict) else None
        owner_id = str(owner.get("document_id") or "") if isinstance(owner, dict) else ""
        fallback = mtexts.txts.get("Chart", "Chart")
        context: dict[str, Any] = {
            "role": role,
            "ownerDocumentId": owner_id or None,
            "label": self._aspect_list_role_label(owner, chrt, fallback),
            "trajectoryKind": "physical",
            "anchorJd": float(chrt.time.jd),
            "calendar": int(getattr(chrt.time, "cal", 0) or 0),
            "featureKind": None,
            "launcherKind": owner.get("launcher_kind") if isinstance(owner, dict) else None,
            "pointMotionPolicy": {"syzygy": "anchor-fixed", "eclipse": "anchor-fixed"},
        }
        if not isinstance(owner, dict):
            return context

        # Arithmetic midpoint composites do not describe bodies coexisting at
        # one physical epoch.  Their current orb is valid, but phase/perfection
        # would be fabricated.  Davison composites retain an actual time/place
        # chart and therefore keep the physical trajectory.
        if (
            owner.get("compound_kind") == "composite_from_synastry"
            and owner.get("composite_variant") != "davison"
        ):
            context["trajectoryKind"] = "static"
            context["unsupportedReason"] = "arithmetic-composite-is-static"
            return context

        display_dt = getattr(owner_cs, "display_datetime", None) if owner_cs is not None else None
        radix = getattr(owner_cs, "radix", None) if owner_cs is not None else None
        feature_kind = owner.get("supplementary_feature_kind")
        if feature_kind == "solar_average" or owner.get("launcher_kind") == "solar_average":
            context.update({
                "trajectoryKind": "static",
                "featureKind": "solar_average",
                "unsupportedReason": "solar-average-has-no-single-timeline",
            })
            return context
        if feature_kind == "harmonic":
            context.update({
                "trajectoryKind": "static",
                "featureKind": "harmonic",
                "unsupportedReason": "harmonic-chart-has-no-physical-timeline",
            })
            return context
        if feature_kind in _ASPECT_SYMBOLIC_FEATURE_KINDS and radix is not None:
            anchor_jd = self._aspect_symbolic_anchor_jd(
                owner,
                owner_cs,
                display_dt,
                radix,
                str(feature_kind),
            )
            if anchor_jd is None:
                context["trajectoryKind"] = "unsupported"
                context["unsupportedReason"] = "missing-symbolic-cursor"
                return context
            binding_payload = copy.deepcopy(owner.get("supplementary_binding") or {})
            context.update({
                "trajectoryKind": "supplementary",
                "anchorJd": float(anchor_jd),
                "calendar": int(getattr(radix.time, "cal", 0) or 0),
                "featureKind": str(feature_kind),
                "parentDocumentId": owner.get("parent_document_id"),
                "binding": binding_payload,
                "builder": self._aspect_symbolic_builder(owner, str(feature_kind), radix),
                # Symbolic techniques own their point transforms.  Do not
                # impose the ordinary physical-chart fixed-Syzygy policy on a
                # canonical supplementary builder.
                "pointMotionPolicy": {"syzygy": "trajectory", "eclipse": "trajectory"},
            })
            if feature_kind == "converse_transits":
                def display_for_jd(candidate_jd):
                    candidate = self._aspect_converse_candidate(
                        binding_payload,
                        radix,
                        candidate_jd,
                    )
                    return candidate[0] if candidate is not None else None

                context["displayForJd"] = display_for_jd
            return context

        # A newly introduced supplementary technique must declare its motion
        # authority above before Aspect List may claim applying/separating or
        # manufacture an exact date.  Ordinary root/relationship documents have
        # no feature kind and retain the physical default.
        if feature_kind is not None and feature_kind not in _ASPECT_PHYSICAL_FEATURE_KINDS:
            context.update({
                "trajectoryKind": "unsupported",
                "featureKind": str(feature_kind),
                "unsupportedReason": "undeclared-technique-trajectory",
            })
            return context

        if owner.get("launcher_kind") == "pd_in_chart" and radix is not None:
            anchor_jd = self._display_datetime_jd(display_dt, radix)
            if anchor_jd is None:
                context["trajectoryKind"] = "unsupported"
                context["unsupportedReason"] = "missing-pd-cursor"
                return context
            context.update({
                "trajectoryKind": "pd_in_chart",
                "anchorJd": float(anchor_jd),
                "calendar": int(getattr(radix.time, "cal", 0) or 0),
                "featureKind": "pd_in_chart",
                "parentDocumentId": owner.get("parent_document_id"),
                "binding": copy.deepcopy(owner.get("pd_in_chart_binding") or {}),
                "builder": self._aspect_pd_builder(owner, radix),
                "pointMotionPolicy": {"syzygy": "trajectory", "eclipse": "trajectory"},
            })
        return context

    @staticmethod
    def _temporal_map_calendar_name(calendar: int) -> str:
        chart_mod = export_chart_json.chart_mod
        return (
            "julian"
            if int(calendar) == chart_mod.Time.JULIAN
            else "gregorian"
        )

    def _temporal_map_authority(self, document_id: str) -> tuple[dict, Any, float, int]:
        """Resolve one chart document's radix, focus, and label calendar.

        The temporal map is a lens over an existing chart document.  The radix
        owns the lifetime axis and calendar; the live document session owns the
        focus instant.  This keeps a derived chart focused at its real cursor
        without quietly changing the map's birth epoch.
        """
        session = self._controller.session(document_id)
        if session is None:
            raise ValueError(f"unknown chart document {document_id!r}")
        radix = self._parent_radix(document_id)
        time_obj = getattr(radix, "time", None)
        try:
            birth_jd = float(getattr(time_obj, "jd"))
        except (AttributeError, TypeError, ValueError):
            raise ValueError("chart document has no radix birth instant") from None
        if not math.isfinite(birth_jd):
            raise ValueError("chart document has no finite radix birth instant")

        parent_id = session.get("parent_document_id")
        parent_session = (
            self._controller.session(str(parent_id))
            if parent_id
            else None
        )
        # A view-only child may retain an open-time chart reference but has no
        # live cursor of its own.  In that case the parent chart session is the
        # focus authority; a real derived chart session remains authoritative.
        focus_session = (
            parent_session
            if session.get("chart_session") is None and parent_session is not None
            else session
        )
        focus_jd = self._session_authoritative_jd(focus_session)
        if focus_jd is None:
            focus_jd = self._session_authoritative_jd(parent_session)
        if focus_jd is None or not math.isfinite(float(focus_jd)):
            focus_jd = birth_jd

        chart_mod = export_chart_json.chart_mod
        calendar = int(
            getattr(time_obj, "cal", chart_mod.Time.GREGORIAN)
        )
        if calendar != chart_mod.Time.JULIAN:
            calendar = chart_mod.Time.GREGORIAN
        return session, radix, float(focus_jd), calendar

    def _format_temporal_map_instant(
        self,
        jd_ut: float,
        *,
        birth_jd_ut: float,
        calendar: int,
    ) -> dict[str, Any]:
        try:
            exact_jd = float(jd_ut)
        except (TypeError, ValueError):
            raise ValueError("temporal map JD must be numeric") from None
        if not math.isfinite(exact_jd):
            raise ValueError("temporal map JD must be finite")
        values = self._jd_to_calendar_datetime(exact_jd, calendar)
        if values is None:
            raise ValueError(f"cannot decode temporal map JD {exact_jd!r}")
        y, m, d, h, mi, s = [int(value) for value in values[:6]]
        civil_date = dateformat.iso_date_text(y, m, d)
        civil_datetime = dateformat.iso_datetime_text(values)
        canonical_query_datetime = civil_datetime
        try:
            datetime.datetime(y, m, d, h, mi, s)
        except ValueError:
            # Canonical calendar lists currently load a Gregorian month/range.
            # A valid Julian civil date such as 1900-02-29 is not a valid
            # Gregorian/JavaScript date and would normalize into March.  Keep
            # the exact JD and Julian labels authoritative, but anchor the
            # loader to the nearest earlier valid day in the same month so its
            # range still contains the exact event row.
            for query_day in range(d - 1, 0, -1):
                try:
                    canonical_query_datetime = datetime.datetime(
                        y,
                        m,
                        query_day,
                        h,
                        mi,
                        s,
                    ).isoformat()
                except ValueError:
                    continue
                break
        date_label = dateformat.date_text(
            y,
            m,
            d,
            chart_snapshot_service.options,
        )
        datetime_label = dateformat.date_time_text(
            values,
            chart_snapshot_service.options,
            show_seconds=True,
        )
        age_years = (
            exact_jd - float(birth_jd_ut)
        ) / _TEMPORAL_MAP_TROPICAL_YEAR_DAYS
        nearest_age = round(age_years)
        if abs(age_years - nearest_age) < 1e-9:
            age_years = float(nearest_age)
        age_years_int = math.floor(age_years)
        return {
            "jdUt": exact_jd,
            "year": y,
            "month": m,
            "day": d,
            "hour": h,
            "minute": mi,
            "second": s,
            "civilDate": civil_date,
            "civilDatetime": civil_datetime,
            "canonicalQueryDatetime": canonical_query_datetime,
            "dateLabel": date_label,
            "datetimeLabel": datetime_label,
            "ageYears": float(age_years),
            "ageYearsInt": int(age_years_int),
            "ageLabel": (
                mtexts.txts.get("AgeColonFmt", "Age: %d")
                % int(age_years_int)
            ),
        }

    def temporal_map_context(self, document_id: str) -> dict[str, Any]:
        """Return the daemon-owned macro axis for one chart document."""
        with self._lock:
            _, radix, focus_jd, calendar = self._temporal_map_authority(document_id)
            birth_jd = float(radix.time.jd)
            life_end_jd = birth_jd + (
                _TEMPORAL_MAP_LIFE_YEARS * _TEMPORAL_MAP_TROPICAL_YEAR_DAYS
            )
            return {
                "documentId": str(document_id),
                "birthJdUt": birth_jd,
                "lifeEndJdUt": life_end_jd,
                "focusJdUt": focus_jd,
                "lifeYears": _TEMPORAL_MAP_LIFE_YEARS,
                "tropicalYearDays": _TEMPORAL_MAP_TROPICAL_YEAR_DAYS,
                "calendar": self._temporal_map_calendar_name(calendar),
                "timeBasis": "ut",
                "birth": self._format_temporal_map_instant(
                    birth_jd,
                    birth_jd_ut=birth_jd,
                    calendar=calendar,
                ),
                "focus": self._format_temporal_map_instant(
                    focus_jd,
                    birth_jd_ut=birth_jd,
                    calendar=calendar,
                ),
                "lifeEnd": self._format_temporal_map_instant(
                    life_end_jd,
                    birth_jd_ut=birth_jd,
                    calendar=calendar,
                ),
            }

    def format_temporal_map_jds(
        self,
        document_id: str,
        jds: list[float],
    ) -> dict[str, Any]:
        """Batch-format map ticks/hovers in the chart's own civil calendar."""
        if len(jds) > 512:
            raise ValueError("temporal map formatting is limited to 512 JDs")
        with self._lock:
            _, radix, _, calendar = self._temporal_map_authority(document_id)
            birth_jd = float(radix.time.jd)
            return {
                "documentId": str(document_id),
                "birthJdUt": birth_jd,
                "calendar": self._temporal_map_calendar_name(calendar),
                "timeBasis": "ut",
                "instants": [
                    self._format_temporal_map_instant(
                        jd,
                        birth_jd_ut=birth_jd,
                        calendar=calendar,
                    )
                    for jd in jds
                ],
            }

    def table_context(self, document_id: str, requested_table_id: Optional[str] = None) -> dict[str, Any]:
        """Return the live chart + table id for a generic table document.

        Generic table tabs are view-only children like astrocart/directions
        (``radix=None``), but their rows must track the parent chart cursor. For
        table docs we therefore resolve through ``parent_document_id`` instead of
        using the open-time chart reference stored on the view-only session.

        ``requested_table_id`` additionally lets a CHART-OWNING document host a
        right-pane table (the Zodiacal Releasing pane): the pane fetches with the
        radix document id, the binding lives in the session's per-table
        ``table_bindings`` map (the wx per-radix binding store,
        morin.store_table_binding_for_radix / morin.py:17138-17158), and the
        cursor is that document's own display datetime (morin.py:4119-4147).
        """
        with self._lock:
            comparison_chart = None
            cs = None
            session = self._controller.session(document_id)
            if session is None:
                raise ValueError(f"unknown table document {document_id!r}")
            if session.get("launcher_kind") == "table":
                table_id = str(session.get("table_id") or "")
                binding = session.get("table_binding") or {}
                parent_id = session.get("parent_document_id")
                if not parent_id:
                    raise ValueError("table document has no parent chart")
                parent_session = self._controller.session(str(parent_id)) or {}
                parent_cs = parent_session.get("chart_session")
                current_datetime = _display_tuple_to_datetime(
                    getattr(parent_cs, "display_datetime", None) if parent_cs is not None else None
                )
                chart_anchor_datetime = current_datetime
                if table_id in _TIME_LORD_TABLE_IDS | {'eclipses'}:
                    chrt = self._parent_radix(str(parent_id))
                else:
                    chrt = self._search_reference_chart_for_document(str(parent_id))
                    if chrt is None:
                        chrt = self._parent_radix(str(parent_id))
            else:
                table_id = str(session.get("table_id") or "")
                binding = session.get("table_binding") or {}
                cs = session.get("chart_session")
                current_datetime = _display_tuple_to_datetime(
                    getattr(cs, "display_datetime", None) if cs is not None else None
                )
                chart_anchor_datetime = current_datetime
                if not table_id and requested_table_id:
                    # Right-pane table hosted on a chart-owning document.
                    table_id = str(requested_table_id)
                    binding = (session.get("table_bindings") or {}).get(table_id) or {}
                    if table_id in _TIME_LORD_TABLE_IDS | {'eclipses'}:
                        chrt = self._parent_radix(document_id)
                    else:
                        chrt = getattr(cs, "chart", None) if cs is not None else None
                        if chrt is None:
                            chrt = session.get("chart")
                        if table_id == "aspect_list" and cs is not None and chrt is not None:
                            chrt, comparison_chart = self._select_render_charts(session, cs, chrt)
                    # Non-Time-Lord right-pane tables may inherit the active
                    # chart cursor. Time Lords are re-anchored to wall-clock
                    # time below so their default branch is today's period.
                    active_id = self._controller.active_document_id()
                    active_session = self._controller.session(active_id) if active_id else None
                    active_cs = active_session.get("chart_session") if active_session else None
                    active_dt = _display_tuple_to_datetime(
                        getattr(active_cs, "display_datetime", None) if active_cs is not None else None
                    )
                    if active_dt is not None:
                        current_datetime = active_dt
                        chart_anchor_datetime = active_dt
                else:
                    chrt = getattr(cs, "chart", None) if cs is not None else None
                    if chrt is None:
                        chrt = session.get("chart")
            if not table_id:
                raise ValueError(f"document {document_id!r} has no table id")
            if chrt is None:
                raise ValueError(f"document {document_id!r} has no chart for table rows")
            if table_id in _TIME_LORD_TABLE_IDS:
                current_datetime = datetime.datetime.now()
            if table_id == 'eclipses':
                # EclipsesFrame's initial consultation viewport is anchored to
                # the current wall clock. User year/focus bindings still
                # override this in tables_service; the chart cursor remains a
                # separate toolbar anchor for the Current/Birth toggle.
                current_datetime = None
            role_contexts: dict[str, dict[str, Any]] = {}
            primary_label = self._chart_label(chrt, mtexts.txts.get("Chart", "Chart"))
            outer_label = (
                self._chart_label(comparison_chart, mtexts.txts.get("Comparison", "Comparison"))
                if comparison_chart is not None
                else None
            )
            if table_id == "aspect_list":
                role_contexts["primary"] = self._aspect_list_role_context(
                    session, chrt, "primary",
                )
                primary_label = str(role_contexts["primary"]["label"])
                if comparison_chart is not None:
                    role_contexts["outer"] = self._aspect_list_role_context(
                        session, comparison_chart, "outer",
                    )
                    outer_label = str(role_contexts["outer"]["label"])
            aspect_context = {}
            if table_id == "aspect_list":
                aspect_context = {
                    "hostDocumentId": str(document_id),
                    "hostSessionIdentity": id(cs) if cs is not None else None,
                    "viewMode": int(getattr(cs, "view_mode", -1)) if cs is not None else None,
                    "showRadixComparison": bool(session.get("show_radix_comparison", False)),
                    "parentDocumentId": session.get("parent_document_id"),
                    "compoundKind": session.get("compound_kind"),
                    "compositeVariant": session.get("composite_variant"),
                    "comparisonLayout": session.get("comparison_layout"),
                }
            return {
                "chart": chrt,
                "comparison_chart": comparison_chart,
                "primary_label": primary_label,
                "outer_label": outer_label,
                "role_contexts": role_contexts,
                "host_document_id": document_id,
                "aspect_context": aspect_context,
                "table_id": table_id,
                "binding": binding,
                "current_datetime": current_datetime,
                "chart_anchor_datetime": chart_anchor_datetime,
            }

    def set_show_radix_comparison(self, document_id: str, show_radix: bool) -> dict:
        """Switch a grandchild comparison wheel's center between parent and radix.

        This is presentation/session state only: the child chart calculation and
        radix lineage stay unchanged. ``show_radix=True`` replaces the COMPOUND
        center chart with ``cs.radix``; ``False`` restores the immediate parent.
        """
        with self._lock:
            doc_id = str(document_id or "")
            session = self._controller.session(doc_id)
            if session is None:
                raise ValueError(f"unknown document {doc_id!r}")
            if session.get("compound_kind") is not None:
                raise ValueError("show radix is not available for relationship charts")
            cs = session.get("chart_session")
            if cs is None:
                raise ValueError(f"document {doc_id!r} has no chart session")
            parent_id = session.get("parent_document_id")
            parent_session = self._controller.session(parent_id) if parent_id else None
            if parent_session is None or parent_session.get("parent_document_id") is None:
                raise ValueError("show radix is only available for grandchild charts")
            parent_anchor = self._controller._comparison_chart_for_parent(parent_session)
            radix = getattr(cs, "radix", None) or session.get("chart")
            if radix is None:
                raise ValueError("document has no radix chart")
            session["show_radix_comparison"] = bool(show_radix)
            session["comparison_chart"] = radix if show_radix else parent_anchor
            result = {
                "ok": True,
                "documentId": doc_id,
                "activeDocumentId": self._controller.active_document_id(),
                "showRadix": bool(show_radix),
                "documents": self._tree_payload(),
            }
            self._attach_full_snapshot(result, doc_id, overlay_render_mode="full")
            self._broadcast_session_changed(doc_id, "display-overlay")
            return result

    def open_directions_timed_chart(
        self,
        *,
        directions_document_id: str,
        action: str,
        when_iso: str,
        event_jd: Optional[float] = None,
        time_context: Optional[dict[str, Any]] = None,
        session_label: Optional[str] = None,
        show_radix: Optional[bool] = None,
        source_technique: Optional[str] = None,
        symbolic_when_iso: Optional[str] = None,
        symbolic_event_jd: Optional[float] = None,
    ) -> dict:
        """Timed-chart context action from any direction-list popup.

        Mirrors commonwnd.add_timed_chart_menu_actions (commonwnd.py:63-85): the
        three items each open a REAL child document for the selected event date —
        'Open containing Solar Revolution' / 'Open as Transit' / 'Open as Chart'
        (primdirslistwnd.py:1078-1122, secdirframe.py:1278-1291,
        circumambulationframe.py:597-644). The wx handlers call
        open_solar_return_for_event_date / open_transits_for_event_date /
        open_chart_for_event_date (morin.py:9932,9974,10144). Here we route them
        through the SAME daemon child-open path (open_document -> _open_child ->
        supplementary Binding/Deriver) so the chart is built by the engine, never
        reimplemented, and indents under the owning chart like every other child.

        Direction/list docs have radix=None and use their parent document as the
        chart owner. Search can live in the active chart's right pane, so a
        chart-owning document is also accepted directly. The branch radix is
        resolved separately for calculation identity.
        """
        with self._lock:
            parent_document_id = self._timed_chart_parent_document_id(directions_document_id)
            effective_show_radix = (
                bool(getattr(options_service.options, 'timed_chart_show_radix_default', False))
                if show_radix is None
                else bool(show_radix)
            )
            event_when = self._timed_chart_when_iso(
                parent_document_id=parent_document_id,
                when_iso=when_iso,
                event_jd=event_jd,
                time_context=time_context,
            )
            # commonwnd's three items -> daemon feature kinds. Solar Revolution
            # builds the SR chart containing the date; Transit builds a transit
            # child; Chart is handled below as a standalone exact chart.
            kind_for_action = {
                "solar": "solar-revolution",
                "transits": "transits",
            }
            feature_kind = kind_for_action.get(action)
            if feature_kind is None and action != "chart":
                raise ValueError(f"unknown timed-chart action {action!r}")
            binding_payload = None
            if action == "solar":
                binding_payload = {
                    "feature_kind": "solar_return",
                    "retained_state": {"solar_year_mode": "containing"},
                }
            if action == "chart":
                parent_for_exact = parent_document_id
            else:
                parent_for_exact = None
        # open_document takes its own lock; call it outside the with-block.
        if parent_for_exact is not None:
            return self._open_exact_event_chart(
                parent_for_exact,
                event_when,
                time_context=time_context,
                session_label=session_label,
            )
        if action == "transits":
            if source_technique == "converse_transits":
                return self._open_converse_timed_transit_chart(
                    parent_document_id,
                    event_when,
                    symbolic_when_iso=str(symbolic_when_iso or ""),
                    symbolic_event_jd=symbolic_event_jd,
                    time_context=time_context,
                    show_radix=effective_show_radix,
                )
            return self._open_timed_transit_chart(
                parent_document_id,
                event_when,
                time_context=time_context,
                session_label=session_label,
                show_radix=effective_show_radix,
            )
        return self.open_document(
            kind="supplementary",
            parent_document_id=parent_document_id,
            feature_kind=feature_kind,
            when_iso=event_when,
            binding_payload=binding_payload,
            session_label=session_label,
        )

    def open_directions_pd_in_chart(
        self,
        *,
        directions_document_id: str,
        arc: float,
        mode: str = "celestial",
        direct: bool = True,
        event_jd: Optional[float] = None,
        when_iso: Optional[str] = None,
        session_label: Optional[str] = None,
        direction_event: Optional[dict] = None,
    ) -> dict:
        """Open a Primary-Direction row as a retained PD-in-Chart session.

        Source twin: PrimDirsListWnd._open_workspace_pd_tab
        (primdirslistwnd.py:1137-1185). The desktop builds the PD-projected chart
        with ``_compute_pd_chart(radix, signed_arc, options, terrestrial=...)``
        (now the wx-free ``engine.pd_in_chart.compute_pd_chart``) and opens it as
        a COMPOUND workspace tab with the natal radix as the inner ring — the
        radix advanced by the directed arc, drawn as a biwheel. The co-spawned
        wx PD stepper dialog (pdsinchartstepperdlg) is superseded by the native
        chart navigation on the resulting tab.

        ``arc`` is the row's magnitude in degrees; ``direct`` restores the
        signed-arc contract from PrimDirsListWnd.calc.  Ring orientation chooses
        the projection operator; it never changes that semantic D/C sign.
        ``mode`` is the row's celestial/terrestrial calculation class.
        ``when_iso`` is the directed-moment civil datetime for the tab's
        display_datetime; when absent we fall back to the PD-projected chart's
        own time so the biwheel still labels coherently.
        """
        from engine import pd_in_chart

        with self._lock:
            # PD-in-Chart is a radix-owned projection.  Unlike ordinary timed
            # row actions, opening it from an already-derived chart must create
            # a sibling under the radix instead of recursively nesting another
            # projected chart below the active child.
            parent_radix_id = self._owning_radix_document_id(directions_document_id)
            radix = self._parent_radix(parent_radix_id)
            if radix is None:
                raise ValueError("directions document has no parent radix")
            if mode not in {"celestial", "terrestrial"}:
                raise ValueError(f"unknown PDs-in-Chart mode {mode!r}")
            signed_arc = self._pd_in_chart_projection_arc(
                abs(float(arc)), direct, mode=mode,
            )
            display_frame = self._pd_in_chart_display_frame(mode, direct)
            outer_promissor = bool(display_frame["outerPromissor"])
            pd_chart = pd_in_chart.compute_pd_chart(
                radix,
                signed_arc,
                chart_snapshot_service.options,
                terrestrial=mode == "terrestrial",
                outer_promissor=outer_promissor,
            )
            label = str(session_label or "").strip() or mtexts.txts.get("PDsInChart", "PDs in Chart")
            exact_event = self._pd_in_chart_exact_event(
                direction_event,
                direct=direct,
                arc=arc,
                event_jd=event_jd,
                event_label=label,
            )
            pd_chart._pd_exact_event = exact_event
            if mode == "celestial":
                row_native = pd_in_chart.apply_selected_ecliptic_foot_projection(
                    pd_chart,
                    radix,
                    exact_event,
                    signed_arc,
                    chart_snapshot_service.options,
                    outer_promissor=outer_promissor,
                )
                if (
                    outer_promissor
                    and not row_native
                    and getattr(
                        chart_snapshot_service.options,
                        "pdincharttyp",
                        None,
                    ) == pd_in_chart.FROMZODIACALPOS
                ):
                    pd_in_chart.apply_exact_planet_to_angle_projection(
                        pd_chart,
                        radix,
                        exact_event,
                        signed_arc,
                        chart_snapshot_service.options,
                    )
            self._stamp_pd_in_chart_direction(
                pd_chart, direct, signed_arc, display_frame,
            )
            event_overlay = pd_in_chart.attach_selected_angle_event_overlay(
                pd_chart,
                radix,
                exact_event,
                signed_arc,
                chart_snapshot_service.options,
                outer_promissor=outer_promissor,
            )
            direction_state = pd_in_chart.attach_pd_direction_state(
                pd_chart,
                exact_event,
                signed_arc,
                event_label=(exact_event or {}).get("eventLabel"),
            )
            display_dt: Optional[tuple[int, int, int, int, int, int]] = None
            event_when = self._timed_chart_when_iso(
                parent_document_id=parent_radix_id,
                when_iso=str(when_iso or ""),
                event_jd=event_jd,
            )
            if event_when:
                try:
                    when = datetime.datetime.fromisoformat(event_when)
                    display_dt = (
                        int(when.year), int(when.month), int(when.day),
                        int(when.hour), int(when.minute), int(when.second),
                    )
                except (TypeError, ValueError):
                    display_dt = None
            if display_dt is None:
                pt = pd_chart.time
                display_dt = (
                    int(pt.year), int(pt.month), int(pt.day),
                    int(pt.hour), int(pt.minute), int(pt.second),
                )
            document = self._controller.open_document(
                pd_chart,
                radix=radix,
                session_label=label,
                view_mode=chart_session.ChartSession.COMPOUND,
                display_datetime=display_dt,
                comparison_chart=None,
                parent_document_id_override=parent_radix_id,
                launcher_kind='pd_in_chart',
                dirty=False,
            )
            if document is not None:
                session = self._controller.session(document.document_id)
                if session is not None:
                    if mode == "terrestrial":
                        # Legacy terrestrial PDs use MundaneWnd.  Keep the
                        # retained chart session/cursor, but render its radix +
                        # directed chart through the legacy mundane-coordinate
                        # surface, kept distinct from Marr/AT MDO semantics.
                        session["chart_visual_mode"] = _CHART_VISUAL_MUNDANE
                    session["pd_in_chart_binding"] = {
                        "mode": mode,
                        "direct": bool(direct),
                        "initialArc": abs(float(arc)),
                        "currentArc": abs(float(arc)),
                        # Preserve the selected table row's full-precision
                        # arc/JD across option refreshes and reset.  Only a
                        # genuinely stepped cursor uses the inverse key
                        # calculation from its displayed civil time.
                        "exactArc": abs(float(arc)),
                        "exactEventJd": float(event_jd) if event_jd is not None else None,
                        "initialDisplayDatetime": tuple(display_dt),
                        "hasEventDatetime": bool(event_when),
                        "directionEvent": exact_event,
                        "eventLabel": (exact_event or {}).get("eventLabel", label),
                        "eventId": (
                            direction_state.get("eventId")
                            if isinstance(direction_state, dict)
                            else None
                        ),
                        "displayFrame": display_frame["displayFrame"],
                        "movingRole": display_frame["movingRole"],
                        "fixedRole": display_frame["fixedRole"],
                    }
                    # Targeted option refresh: PD projection controls rebuild
                    # only open PD tabs, never every radix/supplementary chart.
                    session["option_refresh_handler"] = self._refresh_pd_in_chart_options
            self._manager.broadcast_threadsafe({
                "type": "documents.changed",
                "tree": self._tree_payload(),
            })
            self._save_restore_open_charts_state()
            if document is None:
                return {"documentId": None, "documents": self._tree_payload()}
            return self._attach_full_snapshot({
                "documentId": document.document_id,
                "activeDocumentId": self._controller.active_document_id(),
                "documents": self._tree_payload(),
            }, document.document_id)

    @staticmethod
    def _stamp_pd_in_chart_direction(
        pd_chart,
        direct: bool,
        projection_arc: float,
        display_frame: dict,
    ) -> None:
        """Keep semantic D/C separate from the chosen on-wheel orientation."""
        pd_chart._pd_direction_direct = bool(direct)
        pd_chart._pd_projection_direct = float(
            getattr(pd_chart, "_pd_frame_arc_signed", projection_arc)
        ) >= 0.0
        # Existing consumers read _pd_direct as the selected row's D/C marker;
        # keep that semantic truth independent of any compatibility frame used
        # by a projection family.
        pd_chart._pd_direct = bool(direct)
        pd_chart._pd_display_frame = str(display_frame["displayFrame"])
        pd_chart._pd_moving_role = str(display_frame["movingRole"])
        pd_chart._pd_fixed_role = str(display_frame["fixedRole"])

    @staticmethod
    def _pd_in_chart_exact_event(
        event,
        *,
        direct: bool,
        arc: float,
        event_jd=None,
        event_label=None,
    ):
        if not isinstance(event, dict):
            return None
        exact = dict(event)
        if "sig" not in exact and "sigPoint" in exact:
            exact["sig"] = exact.get("sigPoint")
        exact["direct"] = bool(direct)
        exact["arc"] = abs(float(arc))
        exact_jd = event_jd
        if exact_jd is None:
            exact_jd = exact.get("jd", exact.get("time"))
        if exact_jd is not None:
            exact["time"] = float(exact_jd)
        retained_label = event_label if event_label is not None else exact.get("eventLabel")
        exact["eventLabel"] = str(retained_label or "").strip()
        return exact

    @staticmethod
    def _pd_in_chart_projection_arc(arc: float, direct: bool, *, mode="celestial") -> float:
        del mode  # Ring presentation must never alter the direction's sign.
        return abs(float(arc)) if direct else -abs(float(arc))

    @staticmethod
    def _pd_in_chart_display_frame(mode: str, direct: bool) -> dict:
        """Return the one canonical role frame for a PD-in-Chart rebuild.

        The persisted true/default setting keeps the radix fixed and moves
        promissors for both Direct and Converse.  Its false value requests the
        traditional significator-moving frame, but only for celestial Converse
        directions; Direct and every terrestrial chart remain fixed-radix.
        """
        traditional_converse = bool(
            str(mode) == "celestial"
            and not bool(direct)
            and not bool(
                getattr(
                    chart_snapshot_service.options,
                    "pdinchartreverse",
                    True,
                )
            )
        )
        if traditional_converse:
            return {
                "displayFrame": "traditional-converse",
                "outerPromissor": False,
                "movingRole": "significator",
                "fixedRole": "promissor",
            }
        return {
            "displayFrame": "fixed-radix",
            "outerPromissor": True,
            "movingRole": "promissor",
            "fixedRole": "significator",
        }

    def _build_pd_in_chart_for_cursor(self, session: dict, when: datetime.datetime, *, initial=False):
        from engine import pd_in_chart

        cs = session.get("chart_session")
        binding = session.get("pd_in_chart_binding") or {}
        radix = getattr(cs, "radix", None) if cs is not None else None
        if radix is None:
            return None
        direct = bool(binding.get("direct", True))
        if initial:
            arc = abs(float(binding.get("exactArc", binding.get("initialArc", 0.0))))
        else:
            event_jd = pd_in_chart.event_jd_for_display_datetime(radix, when)
            arc = pd_in_chart.arc_for_event_jd(
                radix, event_jd, chart_snapshot_service.options, direct=direct,
            )
        mode = str(binding.get("mode") or "celestial")
        projection_arc = self._pd_in_chart_projection_arc(
            arc, direct, mode=mode,
        )
        display_frame = self._pd_in_chart_display_frame(mode, direct)
        outer_promissor = bool(display_frame["outerPromissor"])
        pd_chart = pd_in_chart.compute_pd_chart(
            radix,
            projection_arc,
            chart_snapshot_service.options,
            terrestrial=mode == "terrestrial",
            outer_promissor=outer_promissor,
        )
        exact_event = binding.get("directionEvent")
        if isinstance(exact_event, dict):
            exact_event = dict(exact_event)
            # This object describes the selected row's perfection, not the
            # movable chart cursor.  Keep its full-precision JD immutable while
            # stepping; the cursor already lives in display_datetime/currentArc.
            if binding.get("exactEventJd") is not None:
                exact_event["time"] = float(binding["exactEventJd"])
        pd_chart._pd_exact_event = exact_event
        if mode == "celestial":
            row_native = pd_in_chart.apply_selected_ecliptic_foot_projection(
                pd_chart,
                radix,
                exact_event,
                projection_arc,
                chart_snapshot_service.options,
                outer_promissor=outer_promissor,
            )
            if (
                outer_promissor
                and not row_native
                and getattr(
                    chart_snapshot_service.options,
                    "pdincharttyp",
                    None,
                ) == pd_in_chart.FROMZODIACALPOS
            ):
                pd_in_chart.apply_exact_planet_to_angle_projection(
                    pd_chart,
                    radix,
                    exact_event,
                    projection_arc,
                    chart_snapshot_service.options,
                )
        self._stamp_pd_in_chart_direction(
            pd_chart, direct, projection_arc, display_frame,
        )
        event_overlay = pd_in_chart.attach_selected_angle_event_overlay(
            pd_chart,
            radix,
            exact_event,
            projection_arc,
            chart_snapshot_service.options,
            outer_promissor=outer_promissor,
        )
        direction_state = pd_in_chart.attach_pd_direction_state(
            pd_chart,
            exact_event,
            projection_arc,
            event_label=binding.get("eventLabel"),
        )
        binding["displayFrame"] = display_frame["displayFrame"]
        binding["movingRole"] = display_frame["movingRole"]
        binding["fixedRole"] = display_frame["fixedRole"]
        if isinstance(direction_state, dict):
            binding["eventId"] = direction_state.get("eventId")
        session["pd_in_chart_binding"] = binding
        return pd_chart, float(arc)

    def _navigate_pd_in_chart(self, session: dict, cs, unit: str, delta: int) -> bool:
        if unit not in ("year", "month", "week", "day"):
            return False
        radix = getattr(cs, "radix", None)
        current_when = _display_to_datetime(getattr(cs, "display_datetime", None))
        if radix is None or current_when is None:
            return False
        next_when = cursor_steppers.step_source_datetime(radix, current_when, unit, int(delta))
        if next_when is None or next_when == current_when:
            return False
        built = self._build_pd_in_chart_for_cursor(session, next_when)
        if built is None:
            return False
        pd_chart, arc = built
        binding = session.get("pd_in_chart_binding") or {}
        binding["currentArc"] = arc
        session["pd_in_chart_binding"] = binding
        session["chart"] = pd_chart
        cs.change_chart(
            pd_chart,
            display_datetime=_datetime_to_display(next_when),
            change_reason="step",
        )
        return True

    def _reset_pd_in_chart(self, session: dict, cs) -> bool:
        stepped = bool(cs.reset_to_initial_chart())
        if stepped:
            binding = session.get("pd_in_chart_binding") or {}
            binding["currentArc"] = float(binding.get("initialArc", 0.0))
            session["pd_in_chart_binding"] = binding
            session["chart"] = cs.chart
        return stepped

    def _refresh_pd_in_chart_options(self, session: dict, mode: str) -> bool:
        if session.get("launcher_kind") != "pd_in_chart":
            return False
        cs = session.get("chart_session")
        binding = session.get("pd_in_chart_binding") or {}
        if cs is None or not binding:
            return False
        current_when = _display_to_datetime(getattr(cs, "display_datetime", None))
        initial_when = _display_to_datetime(binding.get("initialDisplayDatetime"))
        if current_when is None or initial_when is None:
            return False
        current_is_initial = current_when == initial_when
        current_built = self._build_pd_in_chart_for_cursor(
            session, current_when, initial=current_is_initial,
        )
        initial_built = (
            current_built
            if current_is_initial
            else self._build_pd_in_chart_for_cursor(session, initial_when, initial=True)
        )
        if current_built is None or initial_built is None:
            return False
        current_chart, current_arc = current_built
        initial_chart, initial_arc = initial_built
        binding["currentArc"] = current_arc
        binding["initialArc"] = initial_arc
        session["pd_in_chart_binding"] = binding
        cs._initial_chart = initial_chart
        cs._initial_display_datetime = _datetime_to_display(initial_when)
        session["chart"] = current_chart
        cs.change_chart(
            current_chart,
            display_datetime=_datetime_to_display(current_when),
            change_reason=(
                "options-refresh" if mode == "house-system" else "options"
            ),
        )
        return True

    def open_directions_secondary_chart(
        self,
        *,
        directions_document_id: str,
        when_iso: str,
        session_label: Optional[str] = None,
        symbolic_event_jd: Optional[float] = None,
    ) -> dict:
        """Open/Step Secondary Chart from the progression-popup row menu.

        Source parity: secdirframe.py:onOpenSecondaryChart routes the selected
        row through ``_open_progression_session(..., method=SECONDARY, ...)``.
        Minor/Tertiary list variants deliberately keep that SECONDARY method, so
        this route always opens the normal secondary-progression child.
        """
        launch_when_iso = str(when_iso or "")
        binding_payload = None
        resolved_session_label = session_label
        with self._lock:
            parent_radix_id = self._timed_chart_parent_document_id(directions_document_id)
            if symbolic_event_jd is not None:
                radix = self._parent_radix(parent_radix_id)
                radix_options = getattr(radix, "options", None) or chart_snapshot_service.options
                try:
                    symbolic_jd = float(symbolic_event_jd)
                    radix_jd = float(radix.time.jd)
                except (TypeError, ValueError, AttributeError) as exc:
                    raise ValueError("invalid Aspect List symbolic perfection date") from exc
                use_converse = bool(
                    symbolic_jd < radix_jd
                    and getattr(
                        options_service.options,
                        "aspectlist_prebirth_secondary_converse",
                        True,
                    )
                )
                signified = symbolic_time.signified_datetime_for_progressed_jd(
                    radix,
                    symbolic_jd,
                    method=posfordate.SECONDARY,
                    day_type=getattr(
                        radix_options,
                        "progression_day_type",
                        posfordate.PROGRESSION_DAY_TYPE_Q2,
                    ),
                    converse=use_converse,
                )
                if signified is None:
                    raise ValueError(
                        "Aspect List symbolic perfection date could not be projected"
                    )
                launch_when_iso = datetime.datetime(
                    *[int(value) for value in signified[:6]]
                ).isoformat()
                if use_converse:
                    binding_payload = {
                        "feature_kind": "secondary",
                        "retained_state": {
                            "progression_direction": "converse",
                        },
                    }
                    if not resolved_session_label:
                        resolved_session_label = "%s %s" % (
                            mtexts.txts.get("Converse", "Converse"),
                            mtexts.txts.get("SecondaryDirs", "Secondary Progressions"),
                        )
        return self.open_document(
            kind="supplementary",
            parent_document_id=parent_radix_id,
            feature_kind="secondary-progression",
            when_iso=launch_when_iso,
            binding_payload=binding_payload,
            session_label=resolved_session_label,
        )

    def open_astrolabe(self, parent_radix_id: str) -> dict:
        """Open the planispheric astrolabe as a lightweight view-only child.

        Like astrocartography (open_astrocart above) and the PD list
        (open_directions), the astrolabe is a real view-only surface, not a
        ChartSession tab — in the wx app it is the AstrolabeChart frame, with no
        chart cursor of its own. We model it the same way: a tracked document
        under the radix with ``radix=None`` (so open_document creates NO
        ChartSession), carrying ``launcher_kind='astrolabe'`` and the parent's
        source name for labels. The frontend fetches geometry by this document
        id, so packaged builds do not need a default chart collection. It still
        flows through the controller, so it indents under the parent,
        cascade-closes with it, and activates like any other document.

        Frontend renders it for an 'astrolabe' launcher_kind doc by calling
        /api/astrolabe?documentId=<doc> (AstrolabeView); this command does not
        push a chart snapshot (there is no chart)."""
        with self._lock:
            center = self._parent_radix(parent_radix_id)
            parent_session = self._controller.session(parent_radix_id) or {}
            parent_fpath = parent_session.get('fpath', '')
            source_name = getattr(center, 'name', '') or 'Radix'
            document = self._controller.open_document(
                center,
                fpath=parent_fpath,
                radix=None,  # view-only: no ChartSession, no cursor
                session_label=mtexts.txts.get("AstrolabeTitleFmt", "Astrolabe — %s") % source_name,
                parent_document_id_override=parent_radix_id,
                launcher_kind='astrolabe',
                dirty=False,
            )
            if document is not None:
                session = self._controller.session(document.document_id)
                if session is not None:
                    # Persist the source label for title/summary display.
                    session['comparison_name'] = source_name
            self._manager.broadcast_threadsafe({
                "type": "documents.changed",
                "tree": self._tree_payload(),
            })
            if document is None:
                return {"documentId": None, "documents": self._tree_payload()}
            return {
                "documentId": document.document_id,
                "activeDocumentId": self._controller.active_document_id(),
                "documents": self._tree_payload(),
            }

    @staticmethod
    def _normalized_astrolabe_view_state(value: Any) -> dict[str, Any]:
        """Normalize the complete per-radix Astrolabe presentation state.

        The rete arc is forward-only, matching the projection endpoint and the
        primary-direction stepper. Layer flags remain strict booleans so a
        malformed client payload cannot silently enable a display layer.
        """
        state = dict(_ASTROLABE_VIEW_DEFAULTS)
        if not isinstance(value, dict):
            return state
        try:
            delta = float(value.get("deltaDeg", state["deltaDeg"]))
        except (TypeError, ValueError):
            delta = state["deltaDeg"]
        if math.isfinite(delta):
            state["deltaDeg"] = max(0.0, delta)
        for key in _ASTROLABE_VIEW_BOOLEAN_KEYS:
            candidate = value.get(key)
            if isinstance(candidate, bool):
                state[key] = candidate
        return state

    def astrolabe_view_state_for_document(self, document_id: str) -> dict:
        """Return retained Astrolabe state for the view document's radix."""
        with self._lock:
            parent_id = self._timed_chart_parent_document_id(document_id)
            radix = self._parent_radix(parent_id)
            stored = self._view_state_for_radix("astrolabe", radix)
            return {"state": self._normalized_astrolabe_view_state(stored)}

    def store_astrolabe_view_state_for_document(
        self,
        document_id: str,
        state: dict,
    ) -> dict:
        """Persist one canonical Astrolabe view state for this radix."""
        if not isinstance(state, dict):
            raise ValueError("state must be an object")
        with self._lock:
            parent_id = self._timed_chart_parent_document_id(document_id)
            radix = self._parent_radix(parent_id)
            normalized = self._normalized_astrolabe_view_state(state)
            self._store_view_state_for_radix("astrolabe", radix, normalized)
        return {"ok": True, "state": normalized}

    def open_astrolog_sphere(self, parent_radix_id: str) -> dict:
        """Open the Astrolog-style chart sphere as a view-only child.

        The document carries no ChartSession. It exists so the workspace tree,
        activation, cascade close, and source-path inheritance behave like the
        Astrolabe child while /api/astrolog-sphere supplies the actual sphere
        geometry by workspace document id.
        """
        with self._lock:
            center = self._parent_radix(parent_radix_id)
            parent_session = self._controller.session(parent_radix_id) or {}
            parent_fpath = parent_session.get('fpath', '')
            source_name = getattr(center, 'name', '') or 'Radix'
            document = self._controller.open_document(
                center,
                fpath=parent_fpath,
                radix=None,
                session_label=mtexts.txts.get("AstrologSphereTitleFmt", "Astrolog Sphere — %s") % source_name,
                parent_document_id_override=parent_radix_id,
                launcher_kind='astrolog_sphere',
                dirty=False,
            )
            if document is not None:
                session = self._controller.session(document.document_id)
                if session is not None:
                    session['comparison_name'] = source_name
            self._manager.broadcast_threadsafe({
                "type": "documents.changed",
                "tree": self._tree_payload(),
            })
            if document is None:
                return {"documentId": None, "documents": self._tree_payload()}
            return {
                "documentId": document.document_id,
                "activeDocumentId": self._controller.active_document_id(),
                "documents": self._tree_payload(),
            }

    def open_square_chart(self, parent_radix_id: str) -> dict:
        """Open the Square Chart (medieval square diagram) as a view-only child.

        Same model as the Astrolabe child (open_astrolabe above): a tracked
        document under the radix with ``radix=None`` (no ChartSession, no
        cursor), carrying ``launcher_kind='square_chart'`` and the parent's
        source name so the frontend fetches the data from /api/square-chart.
        wx twin: SquareChartWnd (squarechartwnd.py)."""
        with self._lock:
            center = self._parent_radix(parent_radix_id)
            parent_session = self._controller.session(parent_radix_id) or {}
            parent_fpath = parent_session.get('fpath', '')
            source_name = getattr(center, 'name', '') or 'Radix'
            document = self._controller.open_document(
                center,
                fpath=parent_fpath,
                radix=None,
                session_label=mtexts.txts.get("SquareChartTitleFmt", "Square Chart — %s") % source_name,
                parent_document_id_override=parent_radix_id,
                launcher_kind='square_chart',
                dirty=False,
            )
            if document is not None:
                session = self._controller.session(document.document_id)
                if session is not None:
                    session['comparison_name'] = source_name
            self._manager.broadcast_threadsafe({
                "type": "documents.changed",
                "tree": self._tree_payload(),
            })
            if document is None:
                return {"documentId": None, "documents": self._tree_payload()}
            return {
                "documentId": document.document_id,
                "activeDocumentId": self._controller.active_document_id(),
                "documents": self._tree_payload(),
            }

    def open_mundane_chart(self, parent_radix_id: str) -> dict:
        """Open the Mundane Chart (planets by mundane position) as a view-only
        child.

        Same model as open_square_chart / open_astrolabe: a tracked document
        under the radix with ``radix=None``, ``launcher_kind='mundane_chart'``
        and the parent's source name so the frontend fetches the data from
        /api/mundane-chart. wx twin: MundaneWnd (mundanewnd.py)."""
        with self._lock:
            center = self._parent_radix(parent_radix_id)
            parent_session = self._controller.session(parent_radix_id) or {}
            parent_fpath = parent_session.get('fpath', '')
            source_name = getattr(center, 'name', '') or 'Radix'
            document = self._controller.open_document(
                center,
                fpath=parent_fpath,
                radix=None,
                session_label=mtexts.txts.get("MundaneChartTitleFmt", "Mundane Chart — %s") % source_name,
                parent_document_id_override=parent_radix_id,
                launcher_kind='mundane_chart',
                dirty=False,
            )
            if document is not None:
                session = self._controller.session(document.document_id)
                if session is not None:
                    session['comparison_name'] = source_name
            self._manager.broadcast_threadsafe({
                "type": "documents.changed",
                "tree": self._tree_payload(),
            })
            if document is None:
                return {"documentId": None, "documents": self._tree_payload()}
            return {
                "documentId": document.document_id,
                "activeDocumentId": self._controller.active_document_id(),
                "documents": self._tree_payload(),
            }

    def open_table(
        self,
        parent_radix_id: str,
        table_id: str,
        *,
        binding: Optional[dict[str, Any]] = None,
    ) -> dict:
        """Open a generic embedded table as a lightweight view-only child.

        Source edge: wx uses ``_show_simple_table_in_workspace`` for the simple
        table catalogue (morin.py:15898-15915) and stores per-radix table state
        around ``_show_table_in_workspace`` (morin.py:3556-3607). The webapp
        document is not a chart session and is never dirty/persisted; rows are
        fetched from ``/api/tables/{table_id}`` against the live parent chart.
        """
        from webapp.daemon.table_catalog import TABLE_CATALOG

        spec = TABLE_CATALOG.get(table_id)
        if spec is None:
            raise ValueError(f"unsupported table id {table_id!r}")
        if spec.surface != "table":
            raise ValueError(
                f"table id {table_id!r} is hosted in the right pane, not as a workspace document"
            )
        with self._lock:
            center = self._parent_radix(parent_radix_id)
            source_name = getattr(center, 'name', '') or 'Radix'
            title = "%s — %s" % (spec.title, source_name)
            document = self._controller.open_document(
                center,
                radix=None,
                session_label=title,
                parent_document_id_override=parent_radix_id,
                launcher_kind='table',
                dirty=False,
            )
            if document is not None:
                session = self._controller.session(document.document_id)
                if session is not None:
                    session['comparison_name'] = source_name
                    session['table_id'] = table_id
                    session['table_binding'] = _normalize_table_binding(table_id, binding)
            self._manager.broadcast_threadsafe({
                "type": "documents.changed",
                "tree": self._tree_payload(),
            })
            if document is None:
                return {"documentId": None, "documents": self._tree_payload()}
            return {
                "documentId": document.document_id,
                "activeDocumentId": self._controller.active_document_id(),
                "documents": self._tree_payload(),
            }

    def open_ephemeris(self, parent_radix_id: str) -> dict:
        """Open the Graphic Ephemeris as a lightweight view-only child.

        wx twin: morin._workspace_table_ephemeris (morin.py:16180-16195) hosts a
        GraphEphemPanel in the workspace table host. Like the astrolabe, this is
        a view-only document (radix=None, no ChartSession cursor) under the
        parent radix; the curve payload comes from GET /api/ephemeris and the
        per-radix view state (year/mode/planets/grid — morin.py:5364-5426) from
        the document state routes."""
        with self._lock:
            center = self._parent_radix(parent_radix_id)
            parent_session = self._controller.session(parent_radix_id) or {}
            parent_fpath = parent_session.get('fpath', '')
            source_name = getattr(center, 'name', '') or 'Radix'
            document = self._controller.open_document(
                center,
                fpath=parent_fpath,
                radix=None,  # view-only: no ChartSession, no cursor
                session_label="%s — %s" % (mtexts.txts.get("Ephemeris", "Ephemeris"), source_name),
                parent_document_id_override=parent_radix_id,
                launcher_kind='ephemeris',
                dirty=False,
            )
            self._manager.broadcast_threadsafe({
                "type": "documents.changed",
                "tree": self._tree_payload(),
            })
            if document is None:
                return {"documentId": None, "documents": self._tree_payload()}
            return {
                "documentId": document.document_id,
                "activeDocumentId": self._controller.active_document_id(),
                "documents": self._tree_payload(),
            }

    def ephemeris_state_for_document(self, document_id: str) -> dict:
        """Per-radix ephemeris view state (morin.ephemeris_state_for_radix twin,
        morin.py:5409-5419) resolved through the ephemeris doc's parent radix."""
        with self._lock:
            parent_id = self._timed_chart_parent_document_id(document_id)
            radix = self._parent_radix(parent_id)
            return ephemeris_service.state_for_radix(radix)

    def store_ephemeris_state_for_document(self, document_id: str, state: dict) -> None:
        """morin.store_ephemeris_state_for_radix twin (morin.py:5421-5426)."""
        with self._lock:
            parent_id = self._timed_chart_parent_document_id(document_id)
            radix = self._parent_radix(parent_id)
            ephemeris_service.store_state_for_radix(radix, state)

    def open_ascensional_transits(
        self,
        parent_radix_id: str,
        *,
        source_document_id: Optional[str] = None,
    ) -> dict:
        """Toggle Ascensional/MDO on an existing chart document.

        AT is no longer a chart-backed child. The endpoint name remains for
        compatibility with existing launchers. The first command activates the
        source chart through the MDO view layer; repeating it restores the normal
        zodiac view on that same live session.
        """
        with self._lock:
            parent_session = self._controller.session(parent_radix_id)
            if parent_session is None:
                raise ValueError(f"unknown parent document {parent_radix_id!r}")
            target_id = str(source_document_id or parent_radix_id)
            target_session = self._controller.session(target_id)
            if target_session is None or target_session.get("chart_session") is None:
                target_id = str(parent_radix_id)
                target_session = parent_session
            cs = target_session.get("chart_session")
            if cs is None or getattr(cs, "chart", None) is None:
                raise ValueError(f"document {target_id!r} has no chart session")
            radix = getattr(cs, "radix", None) or target_session.get("chart") or getattr(cs, "chart", None)
            if radix is None:
                raise ValueError("document has no radix for Ascensional Transits")
            if getattr(getattr(radix, "time", None), "bc", False):
                raise ValueError("Ascensional Transits are not available for BC charts")

            current_visual_mode = self._chart_visual_mode(target_session)
            if current_visual_mode in (_CHART_VISUAL_MDO, _CHART_VISUAL_AT):
                target_session["chart_visual_mode"] = _CHART_VISUAL_ZODIAC
                for key in (
                    "ascensional_event_jd",
                    "ascensional_event_place",
                    "ascensional_event_place_payload",
                    "ascensional_chart_a_place",
                    "ascensional_chart_a_place_payload",
                    "ascensional_chart_b_place",
                    "ascensional_chart_b_place_payload",
                    "ascensional_filter_to_active_moment",
                    "ascensional_apply_precession",
                ):
                    target_session.pop(key, None)
                target_session["render_cache"] = None
                self._controller.activate_document(target_id)
                tree = self._tree_payload()
                snapshot = None
                try:
                    snapshot = self.document_snapshot(target_id, overlay_render_mode="full")
                except (ValueError, RuntimeError):
                    snapshot = None
                self._manager.broadcast_threadsafe({
                    "type": "documents.changed",
                    "tree": tree,
                })
                result = {
                    "documentId": target_id,
                    "activeDocumentId": self._controller.active_document_id(),
                    "documents": tree,
                    "reused": True,
                    "reclickBehavior": "restore_zodiac",
                    "chartVisualMode": _CHART_VISUAL_ZODIAC,
                }
                if snapshot is not None:
                    result["snapshot"] = snapshot
                return result
            if current_visual_mode == _CHART_VISUAL_MUNDANE:
                self._controller.activate_document(target_id)
                tree = self._tree_payload()
                self._manager.broadcast_threadsafe({
                    "type": "documents.changed",
                    "tree": tree,
                })
                return self._attach_full_snapshot({
                    "documentId": target_id,
                    "activeDocumentId": self._controller.active_document_id(),
                    "documents": tree,
                    "reused": True,
                    "reclickBehavior": "recall_existing",
                    "chartVisualMode": current_visual_mode,
                }, target_id, overlay_render_mode="full")

            primary, comparison = self._select_render_charts(target_session, cs, cs.chart)
            has_radix_live_pair = (
                getattr(cs, "radix", None) is not None
                and getattr(cs, "chart", None) is not None
                and getattr(cs, "chart", None) is not getattr(cs, "radix", None)
            )
            feature_kind = target_session.get("supplementary_feature_kind")
            visual_mode = (
                _CHART_VISUAL_MDO
                if feature_kind in _PROGRESSION_FEATURE_KINDS
                else
                _CHART_VISUAL_AT
                if comparison is not None or has_radix_live_pair
                else _CHART_VISUAL_MDO
            )
            target_session["chart_visual_mode"] = visual_mode
            target_session["ascensional_filter_to_active_moment"] = True
            target_session["ascensional_apply_precession"] = True
            if visual_mode == _CHART_VISUAL_AT:
                self._sync_ascensional_session_metadata(target_session)
            else:
                target_session["ascensional_event_jd"] = None
                target_session["ascensional_event_place"] = None
                target_session["ascensional_event_place_payload"] = None
            target_session["render_cache"] = None
            self._controller.activate_document(target_id)
            tree = self._tree_payload()
            snapshot = None
            try:
                snapshot = self.document_snapshot(target_id, overlay_render_mode="full")
            except (ValueError, RuntimeError):
                snapshot = None
            self._manager.broadcast_threadsafe({
                "type": "documents.changed",
                "tree": tree,
            })
            result = {
                "documentId": target_id,
                "activeDocumentId": self._controller.active_document_id(),
                "documents": tree,
                "reused": True,
                "reclickBehavior": "view_mode",
                "chartVisualMode": visual_mode,
            }
            if snapshot is not None:
                result["snapshot"] = snapshot
            return result

    def _ascensional_source_context(
        self,
        radix,
        *,
        source_document_id: Optional[str] = None,
    ) -> tuple[datetime.datetime, Any | None]:
        """Initial AT event time and chart-B place.

        wx ``_open_ascensional_transits_session`` uses
        ``_exact_transits_reference_datetime(radix=radix)``: the active
        same-radix chart cursor seeds AT, but an unstepped root radix falls back
        to wall clock. The web route has separate document ids for parentage and
        source cursor, so keep that distinction explicit. For AT transposition
        the source chart's place is chart B; chart A is always the radix.
        """

        def _from_session(session: Optional[dict]) -> Optional[tuple[datetime.datetime, Any | None]]:
            if not isinstance(session, dict):
                return None
            cs = session.get("chart_session")
            if cs is None:
                return None
            session_radix = getattr(cs, "radix", None) or getattr(cs, "chart", None)
            if session_radix is not radix:
                return None
            root_like = getattr(cs, "chart", None) is getattr(cs, "radix", None)
            display = self._workspace_runtime_cursor_datetime(
                cs,
                wall_clock_if_unset=bool(root_like),
            )
            source_dt = _display_to_datetime(display)
            if source_dt is None:
                return None
            source_chart = getattr(cs, "chart", None)
            source_place = getattr(source_chart, "place", None)
            return source_dt, source_place

        if source_document_id:
            source_context = _from_session(self._controller.session(str(source_document_id)))
            if source_context is not None:
                return source_context

        active_id = self._controller.active_document_id()
        if active_id:
            source_context = _from_session(self._controller.session(active_id))
            if source_context is not None:
                return source_context

        return datetime.datetime.now(), getattr(radix, "place", None)

    def _find_ascensional_transits_session(self, parent_radix_id: str, radix) -> Optional[dict]:
        for session in self._controller._runtime.values():
            if session.get("launcher_kind") != "ascensional_transits":
                continue
            if session.get("parent_document_id") != parent_radix_id:
                continue
            cs = session.get("chart_session")
            session_radix = getattr(cs, "radix", None) if cs is not None else None
            if session_radix is radix:
                return session
        return None

    def _sync_ascensional_session_metadata(self, session: dict) -> None:
        cs = session.get("chart_session") if isinstance(session, dict) else None
        if cs is None or getattr(cs, "chart", None) is None:
            return
        try:
            session["ascensional_event_jd"] = float(cs.chart.time.jd)
        except Exception:
            pass
        existing_chart_b_place = session.get("ascensional_chart_b_place")
        live_chart_b_place = getattr(cs.chart, "place", None)
        radix = getattr(cs, "radix", None) or session.get("chart")
        if radix is not None:
            session["ascensional_chart_a_place"] = getattr(radix, "place", None)
            if getattr(radix, "place", None) is not None:
                session["ascensional_chart_a_place_payload"] = _ascensional_place_payload(
                    radix.place, source="chart_a")
        chart_a_place = session.get("ascensional_chart_a_place")
        if live_chart_b_place is not None:
            session["ascensional_chart_b_place"] = live_chart_b_place
            session["ascensional_chart_b_place_payload"] = _ascensional_place_payload(
                live_chart_b_place, source="chart_b")
        elif existing_chart_b_place is not None and session.get("ascensional_chart_b_place_payload") is None:
            session["ascensional_chart_b_place_payload"] = _ascensional_place_payload(
                existing_chart_b_place, source="chart_b")

        event_place = session.get("ascensional_chart_b_place") or chart_a_place
        if event_place is not None:
            session["ascensional_event_place"] = event_place
            session["ascensional_event_place_payload"] = _ascensional_place_payload(
                event_place, source="chart_b",
            )
        session["ascensional_apply_precession"] = True
        session["render_cache"] = None

    def update_ascensional_event_place(self, document_id: str, place_payload: dict[str, Any]) -> dict:
        """Legacy route retained for older clients; AT now always uses Chart B place."""
        with self._lock:
            session = self._controller.session(document_id)
            if session is None:
                raise ValueError(f"unknown document {document_id!r}")
            if session.get("launcher_kind") != "ascensional_transits" and not self._is_at_visual_session(session):
                raise ValueError(f"document {document_id!r} is not Ascensional Transits")
            cs = session.get("chart_session")
            if cs is None or getattr(cs, "chart", None) is None:
                raise ValueError(f"document {document_id!r} has no chart session")
            self._sync_ascensional_session_metadata(session)
            result = {
                "documentId": document_id,
                "displayDatetime": _display_tuple_to_iso(getattr(cs, "display_datetime", None)),
                "ascensionalEventJd": session.get("ascensional_event_jd"),
                "ascensionalEventPlace": session.get("ascensional_event_place_payload"),
                "documents": self._tree_payload(),
            }
            try:
                result["snapshot"] = self.document_snapshot(document_id, overlay_render_mode="full")
            except (ValueError, RuntimeError):
                pass
            return result

    def update_ascensional_event_place_from_map(
        self,
        document_id: str,
        *,
        lon: float,
        lat: float,
        place_name: str = "",
    ) -> dict:
        """Legacy map route retained for older clients; AT ignores place overrides."""
        try:
            resolved_name = self._astrocart_resolve_place_name(lon, lat, place_name)
        except Exception:
            resolved_name = (place_name or "").strip()
        event_place = self._astrocart_place_from_lonlat(
            lon,
            lat,
            place_name=resolved_name,
        )
        return self.update_ascensional_event_place(
            document_id,
            _ascensional_place_payload(event_place, source="map"),
        )

    @staticmethod
    def _build_ascensional_transit_chart(radix, source_dt: datetime.datetime, event_place):
        """Construct the event-time transit chart for an AT child.

        Mirrors ``morin._build_ascensional_transit_chart``: the datetime tuple
        is interpreted using the radix timezone convention, while the chart
        place is the AT event place.
        """
        chart_mod = export_chart_json.chart_mod
        rtime = radix.time
        t = chart_mod.Time(
            int(source_dt.year), int(source_dt.month), int(source_dt.day),
            int(source_dt.hour), int(source_dt.minute), int(source_dt.second),
            False, chart_mod.Time.GREGORIAN,
            rtime.zt, rtime.plus, rtime.zh, rtime.zm, rtime.daylightsaving,
            event_place, full=False,
            tzid=getattr(rtime, "tzid", ""),
            tzauto=getattr(rtime, "tzauto", False),
        )
        c = chart_factory.build_chart(
            radix.name, radix.male, t, event_place,
            chart_mod.Chart.TRANSIT, "", chart_snapshot_service.options,
            full=False,
        )
        return c, t

    def update_table_binding(self, document_id: str, binding: Optional[dict[str, Any]] = None,
                             table_id: Optional[str] = None) -> dict:
        """Persist a view-only table document's binding without touching chart files.

        Mirrors wx per-radix table binding persistence for Decennials/ZR
        (morin.py:17129-17181) at the daemon document-session level. Table docs
        stay view-only and dirty=False; changing a binding only changes the
        table payload fetched by React.

        ``table_id`` lets a CHART-OWNING document persist a right-pane table
        binding (the Zodiacal Releasing pane) in its ``table_bindings`` map —
        the daemon twin of wx store_table_binding_for_radix
        (morin.py:17154-17158 / zodiacalreleasingwnd.py:358-367).
        """
        with self._lock:
            session = self._controller.session(document_id)
            if session is None:
                raise ValueError(f"unknown table document {document_id!r}")
            if session.get("launcher_kind") != "table":
                pane_table_id = str(table_id or "")
                has_chart = session.get("chart_session") is not None or session.get("chart") is not None
                if not pane_table_id or not has_chart:
                    raise ValueError(f"document {document_id!r} is not a table")
                bindings_map = session.setdefault("table_bindings", {})
                bindings_map[pane_table_id] = _normalize_table_binding(pane_table_id, binding)
                return {
                    "documentId": document_id,
                    "tableId": pane_table_id,
                    "binding": dict(bindings_map[pane_table_id]),
                    "documents": self._tree_payload(),
                }
            table_id = str(session.get("table_id") or "")
            if not table_id:
                raise ValueError(f"document {document_id!r} has no table id")
            session['table_binding'] = _normalize_table_binding(table_id, binding)
            session['dirty'] = False
            self._manager.broadcast_threadsafe({
                "type": "documents.changed",
                "tree": self._tree_payload(),
            })
            return {
                "documentId": document_id,
                "tableId": table_id,
                "binding": dict(session['table_binding']),
                "documents": self._tree_payload(),
            }

    def activate_document(self, document_id: str) -> dict:
        with self._lock:
            self._controller.activate_document(document_id)
            self._save_restore_open_charts_state()
            return self._attach_full_snapshot({
                "activeDocumentId": self._controller.active_document_id(),
                "documents": self._tree_payload(),
            }, self._controller.active_document_id())

    # -- Surveil studies CRUD (the studies-dialog meaning, morin.py:1702-1834) --

    def surveil_studies(self) -> dict:
        """Studies list + active study (the dialog's wx.Choice contents)."""
        return self._surveil_store.list_studies()

    def surveil_study_marks(self, study: Optional[str] = None) -> dict:
        """Marks of one study with display labels + per-mark openable flag.

        ``openable`` mirrors _can_open_surveil_source (morin.py:1660-1670): true
        when the mark's source document is still open in the workspace."""
        name = study or self._surveil_store.active_study_name()
        marks = self._surveil_store.study_marks(name)
        for mark in marks:
            mark["openable"] = self._can_open_surveil_source(mark.get("sourceRef"), mark.get("sourceName"))
        return {"study": name, "marks": marks}

    def surveil_create_study(self, name: str) -> dict:
        return self._surveil_store.create_study(name)

    def surveil_set_active_study(self, name: str) -> dict:
        return self._surveil_store.set_active_study(name)

    def surveil_set_mark_enabled(self, study: str, mark_id: str, enabled: bool) -> dict:
        return self._surveil_store.set_mark_enabled(study, mark_id, enabled)

    def surveil_remove_mark(self, study: str, mark_id: str) -> dict:
        return self._surveil_store.remove_mark(study, mark_id)

    def surveil_clear_study(self, name: str) -> dict:
        return self._surveil_store.clear_study(name)

    def surveil_open_source(self, source_ref: Optional[dict], source_name: str = "") -> dict:
        """Open/activate the chart a mark was captured from — the studies-dialog
        "Open Radix" row action (morin.py:1684-1700). The webapp source is a live
        workspace document referenced by document_id; activate it when still open.
        Path-based reopen of a closed source is deferred (see note below)."""
        with self._lock:
            ref = source_ref if isinstance(source_ref, dict) else {}
            doc_id = ref.get("document_id")
            if doc_id and self._controller.session(doc_id) is not None:
                self._controller.activate_document(doc_id)
                self._save_restore_open_charts_state()
                return {"ok": True, "activeDocumentId": self._controller.active_document_id(),
                        "documents": self._tree_payload()}
            # Fall back to matching an open session by source chart name.
            session = self._surveil_find_open_source_session(str(source_name or "").strip())
            if isinstance(session, dict) and session.get("document_id"):
                self._controller.activate_document(session["document_id"])
                self._save_restore_open_charts_state()
                return {"ok": True, "activeDocumentId": self._controller.active_document_id(),
                        "documents": self._tree_payload()}
            # DEFERRED: reopen a closed file-backed source from source_ref.path
            # (morin.py:1692-1695 _open_recent_chart_ref). The webapp recent-open
            # path needs a recent-ref shape, not just a path; not wired here.
            return {"ok": False, "error": "source not open"}

    def _can_open_surveil_source(self, source_ref: Optional[dict], source_name: Optional[str]) -> bool:
        ref = source_ref if isinstance(source_ref, dict) else {}
        doc_id = ref.get("document_id")
        if doc_id and self._controller.session(doc_id) is not None:
            return True
        name = str(source_name or "").strip()
        return bool(name and self._surveil_find_open_source_session(name) is not None)

    def _surveil_find_open_source_session(self, source_name: str) -> Optional[dict]:
        """Open session whose chart name matches (morin.py:1672-1682)."""
        if not source_name:
            return None
        for session in self._controller._runtime.values():
            cs = session.get("chart_session")
            chrt = getattr(cs, "chart", None) if cs is not None else None
            if getattr(chrt, "name", "") == source_name:
                return session
            radix = getattr(cs, "radix", None) if cs is not None else None
            if getattr(radix, "name", "") == source_name:
                return session
            fallback = session.get("chart")
            if getattr(fallback, "name", "") == source_name:
                return session
        return None

    def close_preflight(self, document_id: str, cascade: bool = True) -> dict:
        """Non-destructive close check: returns the prompt-worthy ids the discard
        modal must confirm, WITHOUT closing anything. The skin calls this, shows
        the modal iff promptWorthyIds is non-empty, then calls close_document to
        finalize. No documents.changed broadcast — nothing changed."""
        with self._lock:
            result = self._controller.close_preflight(document_id, cascade=cascade)
            return {
                "closedIds": list(result.closed_ids),
                "cascaded": bool(result.cascaded),
                "promptWorthyIds": list(result.prompt_worthy_ids),
                "nextActiveId": result.next_active_id,
                "documents": self._tree_payload(),
            }

    def quit_preflight(self) -> dict:
        """App-quit guard (policy-chart-lifecycle §3, DEF-007 close-out).

        Returns the bound+dirty radix documents that need a Save/Discard prompt
        before the app closes, with labels for the modal. UNBOUND dirty radixes
        (here-now / quick charts) are NOT prompted — they auto-persist to the
        recents store silently before the native shell tears down the daemon.
        Non-destructive for documents: nothing is closed or saved here; the
        native CloseRequested handler decides prevent_close + modal from
        ``needsPrompt``."""
        with self._lock:
            ids = self._controller.quit_preflight()
            for session in list(self._controller._runtime.values()):
                self._remember_recent_session_chart(session)
            prompts = []
            for did in ids:
                session = self._controller.session(did) or {}
                cs = session.get('chart_session')
                chrt = None
                if cs is not None:
                    chrt = getattr(cs, 'radix', None) or getattr(cs, 'chart', None)
                if chrt is None:
                    chrt = session.get('chart')
                prompts.append({
                    "documentId": did,
                    "label": str(getattr(chrt, 'name', '') or '') or 'Untitled',
                    "path": str(session.get('fpath') or ''),
                })
            return {
                "needsPrompt": bool(ids),
                "promptWorthyIds": list(ids),
                "prompts": prompts,
            }

    def close_document(self, document_id: str, cascade: bool = True) -> dict:
        with self._lock:
            affected_branch_ids = chart_rings.branch_document_ids(
                self._controller.documents(), str(document_id or ""),
            )
            preflight = self._controller.close_preflight(document_id, cascade=cascade)
            scratch_targets: list[tuple[str, str]] = []
            for close_id in preflight.closed_ids:
                close_session = self._controller.session(close_id) or {}
                self._remember_recent_session_chart(close_session)
                if close_session.get('fpath') or close_session.get('parent_document_id'):
                    continue
                chrt = close_session.get('chart')
                cs = close_session.get('chart_session')
                if cs is not None:
                    chrt = getattr(cs, 'radix', None) or getattr(cs, 'chart', None) or chrt
                source_name = str(getattr(chrt, 'name', '') or '').strip()
                if source_name:
                    scratch_targets.append((source_name, close_id))
            result = self._controller.close_document(document_id, cascade=cascade)
            for source_name, close_id in scratch_targets:
                notes_service.discard_scratch_note(source_name, close_id)
            remaining_affected_ids = [
                doc_id for doc_id in affected_branch_ids
                if self._controller.session(doc_id) is not None
            ]
            if remaining_affected_ids:
                self._reconcile_multiwheel_state(remaining_affected_ids[0])
            self._manager.broadcast_threadsafe({
                "type": "documents.changed",
                "tree": self._tree_payload(),
            })
            self._save_restore_open_charts_state()
            payload = {
                "closedIds": list(result.closed_ids),
                "cascaded": bool(result.cascaded),
                "promptWorthyIds": list(result.prompt_worthy_ids),
                "nextActiveId": result.next_active_id,
                "activeDocumentId": self._controller.active_document_id(),
                "snapshotInvalidatedIds": remaining_affected_ids,
                "documents": self._tree_payload(),
            }
            active_id = self._controller.active_document_id()
            if active_id in remaining_affected_ids and self._ring_chart_for_document(active_id) is not None:
                self._attach_full_snapshot(payload, active_id, overlay_render_mode="full")
                self._broadcast_session_changed(active_id, "display-overlay")
            return payload

    def move_document(self, document_id: str, before_id: Optional[str]) -> dict:
        """Reorder a sibling document via the controller. ``before_id`` None means
        move to the end of the sibling group. The controller emits a reorder event
        whose documents.changed carries the new tree; we also return the new state
        synchronously for the caller."""
        with self._lock:
            moved = self._controller.move_document(document_id, before_id)
            refresh_result: dict = {}
            refresh_id: Optional[str] = None
            affected_ids: list[str] = []
            if moved:
                refresh_result, refresh_id, affected_ids = (
                    self._multiwheel_tree_order_refresh(document_id)
                )
            self._manager.broadcast_threadsafe({
                "type": "documents.changed",
                "tree": self._tree_payload(),
            })
            if refresh_id is not None:
                self._broadcast_session_changed(
                    refresh_id,
                    "display-overlay",
                    rebuilt_child_ids=affected_ids,
                )
            result = {
                "moved": bool(moved),
                "documents": self._tree_payload(),
                "activeDocumentId": self._controller.active_document_id(),
            }
            result.update(refresh_result)
            return result

    def drag_context(self, document_id: str) -> dict:
        """Daemon-owned DnD context for a workspace document row.

        Source twin: ``morin._handle_workspace_document_move('query_drag_context')``
        delegates to ``WorkspaceState.drag_context`` (morin.py:10551-10553,
        workspace_model.py:440). The skin may use the ids to render drop affordances,
        but the tree semantics stay in the daemon/model.
        """
        with self._lock:
            context = self._controller.state.drag_context(document_id)
            return {
                "documentId": document_id,
                "context": context,
                "documents": self._tree_payload(),
            }

    def preview_move_intent(
        self,
        source_document_id: str,
        *,
        target_document_id: Optional[str] = None,
        before_id: Optional[str] = None,
        root_before_id: Optional[str] = None,
        prefer_attach: bool = False,
    ) -> dict:
        """Resolve the wx reorder/reparent/detach intent without mutating state.

        Mirrors ``morin._handle_workspace_document_move('preview_move')`` at
        morin.py:10554-10562. The returned intent is a direct
        ``WorkspaceState.resolve_drag_intent`` payload and is safe to pass back to
        ``apply_move_intent``.
        """
        with self._lock:
            intent = self._controller.state.resolve_drag_intent(
                source_document_id,
                hover_document_id=target_document_id,
                sibling_before_document_id=before_id,
                root_before_document_id=root_before_id,
                prefer_attach=bool(prefer_attach),
            )
            return {
                "sourceDocumentId": source_document_id,
                "targetDocumentId": target_document_id,
                "intent": self._normalize_move_intent(intent),
                "documents": self._tree_payload(),
            }

    def apply_move_intent(self, source_document_id: str, move_intent: Optional[dict]) -> dict:
        """Apply a daemon-resolved DnD move intent.

        Scope is Packet 07C-A only: ``reorder``, ``detach``, and ``attach``.
        Drag-to-synastry and drag-to-transit remain separate 07C-B work. Source
        twin: ``morin._handle_workspace_document_move('apply_move_intent')`` at
        morin.py:10579-10631.
        """
        with self._lock:
            intent = self._normalize_move_intent(move_intent)
            if intent is None:
                return self._move_intent_result(False, source_document_id, None, [])
            kind = intent.get("kind")
            affected_ids: list[str] = []
            applied = False
            if kind == "reorder":
                applied = bool(
                    self._controller.move_document(
                        source_document_id,
                        intent.get("before_document_id"),
                    )
                )
            elif kind == "detach":
                applied = self._apply_detach_move_intent(source_document_id, intent)
                if applied:
                    affected_ids.append(source_document_id)
            elif kind == "attach":
                applied, affected_ids = self._apply_attach_move_intent(source_document_id, intent)
            else:
                applied = False

            if applied:
                refresh_result: dict = {}
                refresh_id: Optional[str] = None
                refresh_ids: list[str] = []
                if kind == "reorder":
                    refresh_result, refresh_id, refresh_ids = (
                        self._multiwheel_tree_order_refresh(source_document_id)
                    )
                self._manager.broadcast_threadsafe({
                    "type": "documents.changed",
                    "tree": self._tree_payload(),
                })
                if refresh_id is not None:
                    self._broadcast_session_changed(
                        refresh_id,
                        "display-overlay",
                        rebuilt_child_ids=refresh_ids,
                    )
            result = self._move_intent_result(
                applied, source_document_id, intent, affected_ids,
            )
            if applied and kind == "reorder":
                result.update(refresh_result)
            return result

    def apply_drag_conversion(
        self,
        action: str,
        source_document_id: str,
        target_document_id: str,
    ) -> dict:
        """Apply wx modifier-drag conversions.

        Source twin: ``morin._handle_workspace_document_move`` routes Shift
        drops to ``_workspace_create_transit_from_drag`` and Alt drops to
        ``_workspace_convert_document_to_synastry`` before the normal move-intent
        path (morin.py:10566-10577). React chooses only the modifier/action and
        ids; all chart/session mutation is daemon-owned here.
        """
        action = str(action or "").strip().lower()
        if action not in ("synastry", "transit"):
            raise ValueError(f"unknown drag conversion action {action!r}")
        if not source_document_id or not target_document_id:
            return self._drag_conversion_result(False, action, source_document_id, target_document_id, [], None)
        if source_document_id == target_document_id:
            return self._drag_conversion_result(False, action, source_document_id, target_document_id, [], None)

        with self._lock:
            if action == "synastry":
                applied, affected_ids, document_id = self._convert_drag_target_to_synastry(
                    target_document_id,
                    source_document_id,
                )
            else:
                applied, affected_ids, document_id = self._create_transit_from_drag(
                    source_document_id,
                    target_document_id,
                )
            if applied:
                self._manager.broadcast_threadsafe({
                    "type": "documents.changed",
                    "tree": self._tree_payload(),
                })
            return self._drag_conversion_result(
                applied,
                action,
                source_document_id,
                target_document_id,
                affected_ids,
                document_id,
            )

    def _drag_conversion_result(
        self,
        applied: bool,
        action: str,
        source_document_id: str,
        target_document_id: str,
        affected_ids: list[str],
        document_id: Optional[str],
    ) -> dict:
        return {
            "applied": bool(applied),
            "action": action,
            "sourceDocumentId": source_document_id,
            "targetDocumentId": target_document_id,
            "documentId": document_id,
            "affectedDocumentIds": list(dict.fromkeys(affected_ids)),
            "documents": self._tree_payload(),
            "activeDocumentId": self._controller.active_document_id(),
        }

    def _convert_drag_target_to_synastry(
        self,
        target_document_id: str,
        partner_document_id: str,
    ) -> tuple[bool, list[str], Optional[str]]:
        """Alt-drop: replace the target document with a new synastry doc.

        Mirrors ``morin._workspace_convert_document_to_synastry`` at
        morin.py:8571-8604. If the target is already a relationship session,
        all existing participants are carried forward and the dragged chart is
        appended.
        """
        target_session = self._controller.session(target_document_id)
        partner_session = self._controller.session(partner_document_id)
        if target_session is None or partner_session is None:
            return False, [], None

        center_chart = self._session_chart(target_session)
        partner_chart = self._session_chart(partner_session)
        if center_chart is None or partner_chart is None:
            return False, [], None

        participants = self._relationship_session_all_participants(target_session)
        if not participants:
            participants = [center_chart]
        participants = list(participants) + [partner_chart]

        label = self._synastry_session_title(center_chart, partner_chart)
        document = self._controller.open_document(
            center_chart,
            radix=center_chart,
            session_label=label,
            view_mode=chart_session.ChartSession.COMPOUND,
            comparison_chart=partner_chart,
            launcher_kind='synastry',
            dirty=False,
        )
        if document is None:
            return False, [], None

        session = self._controller.session(document.document_id)
        if session is None:
            return False, [], None
        session['compound_kind'] = 'synastry'
        session['comparison_name'] = self._chart_label(partner_chart, "Comparison")
        session['synastry_pair'] = (center_chart, partner_chart)
        session['relationship_participants'] = list(participants)
        session['relationship_participant_states'] = [True] * len(participants)
        session['relationship_participant_refs'] = self._capture_participant_refs(participants)
        session['composite_variant'] = None
        session['relationship_multiwheel_enabled'] = bool(
            3 <= len(participants) <= chart_rings.CHART_RING_COUNT_MAX
        )
        session['option_refresh_handler'] = self._refresh_relationship_session_for_options
        self._ensure_synastry_composite_variants(session, center_chart, partner_chart)
        self._update_document_title(session, label, self._chart_label(center_chart))
        self._apply_synastry_launcher_preference(session)

        self._controller.state.move_document(document.document_id, target_document_id)
        close_result = self._controller.close_document(target_document_id, cascade=True)
        if self._controller.session(document.document_id) is None:
            return False, list(close_result.closed_ids), document.document_id
        self._controller.activate_document(document.document_id)
        affected_ids = [document.document_id, *list(close_result.closed_ids)]
        return True, list(dict.fromkeys(affected_ids)), document.document_id

    def _create_transit_from_drag(
        self,
        source_document_id: str,
        target_document_id: str,
    ) -> tuple[bool, list[str], Optional[str]]:
        """Shift-drop: create a transit child from the dragged chart instant/place.

        Source twin: ``morin._workspace_create_transit_from_drag``
        (morin.py:8606-8681). The dragged chart's absolute cursor JD is
        preserved, then expressed at the dragged chart's place/timezone before
        the new transit chart is opened below the target document.
        """
        source_session = self._controller.session(source_document_id)
        target_session = self._controller.session(target_document_id)
        if source_session is None or target_session is None:
            return False, [], None

        source_chart = self._session_chart(source_session)
        target_chart = self._session_chart(target_session)
        if source_chart is None or target_chart is None:
            return False, [], None

        chart_mod = export_chart_json.chart_mod
        if getattr(source_chart, "htype", None) == chart_mod.Chart.COMPOSITE:
            return False, [], None

        source_time = getattr(source_chart, "time", None)
        source_place = getattr(source_chart, "place", None)
        if source_time is None or source_place is None:
            return False, [], None

        source_jd = self._session_authoritative_jd(source_session)
        if source_jd is None:
            return False, [], None
        utc_dt = self._jd_to_calendar_datetime(
            source_jd,
            getattr(source_time, "cal", chart_mod.Time.GREGORIAN),
        )
        if utc_dt is None:
            return False, [], None
        display_dt = self._display_datetime_for_chart_instant(source_chart, utc_dt)
        if display_dt is None:
            return False, [], None
        y, m, d, h, mi, s = [int(v) for v in display_dt[:6]]

        time = chart_factory.build_time(
            y, m, d, h, mi, s,
            place=source_place,
            bc=False,
            cal=getattr(source_time, "cal", chart_mod.Time.GREGORIAN),
            zt=getattr(source_time, "zt", chart_mod.Time.ZONE),
            plus=getattr(source_time, "plus", True),
            zh=getattr(source_time, "zh", 0),
            zm=getattr(source_time, "zm", 0),
            daylight=bool(getattr(source_time, "daylightsaving", False)),
            full=False,
            tzid=getattr(source_time, "tzid", ""),
            tzauto=getattr(source_time, "tzauto", False),
        )
        source_jd = float(source_jd)
        # The dragged chart's authoritative JD is the contract, even when the
        # display tuple came through a historical timezone with sub-minute
        # offsets or from a stepped source session.
        time.jd = source_jd
        time.sidTime = astrology.swe_sidtime(time.jd)
        trans = chart_factory.build_chart(
            self._chart_label(target_chart, "Transit"),
            getattr(target_chart, "male", True),
            time,
            source_place,
            chart_mod.Chart.TRANSIT,
            '',
            chart_snapshot_service.options,
            False,
        )
        display_tuple = (y, m, d, h, mi, s)
        binding = supplementary_adapter.SupplementaryBinding(
            "transits",
            parent_source_datetime=display_tuple,
            retained_state={
                "display_datetime": display_tuple,
                "place_payload": supplementary_adapter.place_to_payload(source_place),
            },
        )
        label = self._workspace_timed_label(mtexts.typeList[chart_mod.Chart.TRANSIT], y, m, d, h, mi, s)
        document = self._controller.open_document(
            trans,
            radix=target_chart,
            session_label=label,
            view_mode=chart_session.ChartSession.COMPOUND,
            navigation_units=('day', 'hour', 'minute', 'second'),
            navigation_title_label=mtexts.typeList[chart_mod.Chart.TRANSIT],
            display_datetime=display_tuple,
            comparison_chart=None,
            parent_document_id_override=target_document_id,
            launcher_kind='transits',
            supplementary_feature_kind='transits',
            supplementary_binding=binding,
            dirty=False,
        )
        if document is None:
            return False, [], None
        session = self._controller.session(document.document_id)
        cs = session.get("chart_session") if isinstance(session, dict) else None
        if cs is not None:
            cs.cursor_jd = source_jd
            cs._initial_cursor_jd = source_jd
        return True, [document.document_id], document.document_id

    @staticmethod
    def _session_chart(session: Optional[dict]):
        if not isinstance(session, dict):
            return None
        cs = session.get("chart_session")
        chrt = session.get("chart")
        if chrt is None and cs is not None:
            chrt = getattr(cs, "chart", None)
        return chrt

    @staticmethod
    def _session_authoritative_jd(session: Optional[dict]) -> Optional[float]:
        """Source twin: morin._session_authoritative_jd, morin.py:5015-5033."""
        if not isinstance(session, dict):
            return None
        cs = session.get("chart_session")
        if cs is not None:
            cursor_jd = getattr(cs, "cursor_jd", None)
            if cursor_jd is not None:
                try:
                    return float(cursor_jd)
                except (TypeError, ValueError):
                    pass
            chrt = getattr(cs, "chart", None)
        else:
            chrt = session.get("chart")
        time_obj = getattr(chrt, "time", None)
        jd = getattr(time_obj, "jd", None)
        if jd is None:
            return None
        try:
            return float(jd)
        except (TypeError, ValueError):
            return None

    @staticmethod
    def _jd_to_calendar_datetime(jd: float, calendar: int) -> Optional[tuple[int, int, int, int, int, int]]:
        """Source twin: morin._jd_to_calendar_datetime, morin.py:6227-6254.

        The ``calendar`` argument is a ``chart.Time`` calendar enum
        (GREGORIAN=0 / JULIAN=1, chart.py:51), which is INVERTED relative to the
        Swiss-Ephemeris flag swe_revjul expects (SE_GREG_CAL=1 / SE_JUL_CAL=0).
        The wx source maps it explicitly (morin.py:6229-6231); passing the raw
        enum makes a Gregorian chart decode as Julian (a ~13-day shift for 1988).
        Mirror that mapping exactly."""
        try:
            chart_mod = export_chart_json.chart_mod
            calflag = astrology.SE_GREG_CAL
            if int(calendar) == chart_mod.Time.JULIAN:
                calflag = astrology.SE_JUL_CAL
            y, m, d, hour = astrology.swe_revjul(float(jd), calflag)
            h = int(hour)
            minute_float = (hour - h) * 60.0
            mi = int(minute_float)
            s = int(round((minute_float - mi) * 60.0))
            if s >= 60:
                s -= 60
                mi += 1
            if mi >= 60:
                mi -= 60
                h += 1
            if h >= 24:
                h -= 24
                y, m, d = util.incrDay(int(y), int(m), int(d))
            if h < 0:
                h += 24
                y, m, d = util.decrDay(int(y), int(m), int(d))
            return int(y), int(m), int(d), int(h), int(mi), int(s)
        except Exception:
            return None

    def _display_datetime_for_chart_instant(
        self,
        radix,
        utc_dt: tuple[int, int, int, int, int, int],
    ) -> Optional[tuple[int, int, int, int, int, int]]:
        """Convert a UT event tuple to the chart's visible local civil time.

        Delegates to the canonical Moment normalizer
        (engine/moment.utc_to_chart_local — policy-chart-lifecycle §1)."""
        return moment.utc_to_chart_local(
            getattr(radix, "time", None), utc_dt, place=getattr(radix, "place", None)
        )

    @staticmethod
    def _zone_adjusted_datetime(
        y: int,
        m: int,
        d: int,
        h: int,
        mi: int,
        s: int,
        plus: bool,
        zh: int,
        zm: int,
        daylight: bool = False,
    ) -> tuple[int, int, int, int, int, int]:
        try:
            base = datetime.datetime(int(y), int(m), int(d), int(h), int(mi), int(s))
            offset = datetime.timedelta(hours=int(zh), minutes=int(zm))
            if bool(daylight):
                offset += datetime.timedelta(hours=1)
            local_dt = base + offset if bool(plus) else base - offset
            return (
                local_dt.year,
                local_dt.month,
                local_dt.day,
                local_dt.hour,
                local_dt.minute,
                local_dt.second,
            )
        except Exception:
            return int(y), int(m), int(d), int(h), int(mi), int(s)

    @staticmethod
    def _workspace_timed_label(prefix: str, y: int, m: int, d: int, h: int, mi: int, s: int = 0) -> str:
        """Source twin: morin._workspace_timed_label, morin.py:12318-12319."""
        showseconds = bool(getattr(chart_snapshot_service.options, "showseconds", True))
        text = dateformat.date_time_text(
            (int(y), int(m), int(d), int(h), int(mi), int(s)),
            chart_snapshot_service.options,
            show_seconds=showseconds,
        )
        return "%s (%s)" % (prefix, text)

    @staticmethod
    def _normalize_move_intent(intent: Optional[dict]) -> Optional[dict]:
        if not isinstance(intent, dict):
            return None
        kind = intent.get("kind")
        if kind not in ("reorder", "detach", "attach"):
            return None
        target_id = intent.get("target_document_id", intent.get("targetDocumentId"))
        before_id = intent.get("before_document_id", intent.get("beforeDocumentId"))
        scope = intent.get("indicator_scope", intent.get("indicatorScope"))
        return {
            "kind": kind,
            "target_document_id": target_id if target_id else None,
            "before_document_id": before_id if before_id else None,
            "indicator_scope": scope if scope else None,
        }

    def _move_intent_result(
        self,
        applied: bool,
        source_document_id: str,
        intent: Optional[dict],
        affected_ids: list[str],
    ) -> dict:
        return {
            "applied": bool(applied),
            "sourceDocumentId": source_document_id,
            "intent": intent,
            "affectedDocumentIds": list(dict.fromkeys(affected_ids)),
            "documents": self._tree_payload(),
            "activeDocumentId": self._controller.active_document_id(),
        }

    def _apply_detach_move_intent(self, source_document_id: str, intent: dict) -> bool:
        state = self._controller.state
        source_document = state.find_document(source_document_id)
        source_session = self._controller.session(source_document_id)
        if source_document is None or source_session is None:
            return False
        if getattr(source_document, "parent_document_id", None) is None:
            return False
        if not state.detach_document_to_root(
            source_document_id,
            before_document_id=intent.get("before_document_id"),
        ):
            return False
        source_session["parent_document_id"] = None
        # morin.py:10593-10598: detached nodes freeze as standalone documents and
        # must not keep rendering against the former immediate parent.
        source_session["comparison_chart"] = None
        self._broadcast_session_changed(source_document_id, "move")
        return True

    def _apply_attach_move_intent(self, source_document_id: str, intent: dict) -> tuple[bool, list[str]]:
        target_document_id = intent.get("target_document_id")
        if target_document_id is None or source_document_id == target_document_id:
            return False, []
        state = self._controller.state
        source_document = state.find_document(source_document_id)
        target_document = state.find_document(target_document_id)
        if source_document is None or target_document is None:
            return False, []
        if target_document_id in state.descendant_document_ids(source_document_id):
            return False, []
        source_session = self._controller.session(source_document_id)
        target_session = self._controller.session(target_document_id)
        if source_session is None or target_session is None:
            return False, []
        if source_session.get("parent_document_id") == target_document_id:
            return False, []

        prebuilt = None
        if self._workspace_session_supports_rebinding(source_session):
            prebuilt = self._build_reparent_supplementary_result(source_session, target_session)
            if prebuilt is None:
                return False, []

        if not state.reparent_document(source_document_id, target_document_id):
            return False, []

        source_session["parent_document_id"] = target_document_id
        source_cs = source_session.get("chart_session")
        if (
            source_cs is not None
            and source_session.get("supplementary_feature_kind") is None
            and source_session.get("compound_kind") is None
        ):
            # A plain chart attached beneath another plain chart is a named
            # hierarchical synastry child. Keep the source document/session
            # intact, but show its immediate parent as the comparison anchor.
            source_session["comparison_chart"] = (
                self._controller._comparison_chart_for_child_session(
                    source_session,
                    target_session,
                )
            )
            source_cs.view_mode = chart_session.ChartSession.COMPOUND
        affected_ids = [source_document_id]
        if prebuilt is not None:
            base_chart, source_dt, result = prebuilt
            if not self._apply_reparent_supplementary_result(
                source_session,
                target_session,
                base_chart,
                source_dt,
                result,
            ):
                return True, affected_ids
        else:
            feature_kind = source_session.get("supplementary_feature_kind")
            if feature_kind is not None:
                source_session["comparison_chart"] = self._controller._comparison_chart_for_parent(target_session)
            if self._controller._rebuild_child_session(source_session, target_session):
                affected_ids.append(source_document_id)
            else:
                self._broadcast_session_changed(source_document_id, "move")

        rebuilt_descendants = self._controller._refresh_child_sessions(source_session)
        affected_ids.extend(rebuilt_descendants)
        return True, list(dict.fromkeys(affected_ids))

    @staticmethod
    def _workspace_session_supports_rebinding(session: Optional[dict]) -> bool:
        if session is None:
            return False
        if session.get("supplementary_feature_kind") is not None:
            return True
        return session.get("launcher_kind") == "solar_average"

    def _build_reparent_supplementary_result(self, session: dict, parent_session: dict):
        cs = session.get("chart_session")
        parent_cs = parent_session.get("chart_session")
        if cs is None or parent_cs is None:
            return None
        current_chart = getattr(cs, "chart", None)
        if current_chart is None:
            return None
        feature_kind = session.get("supplementary_feature_kind")
        if feature_kind is None and session.get("launcher_kind") == "solar_average":
            feature_kind = "solar_average"
        adapter = self._controller._registry.adapter_for_feature_kind(feature_kind)
        if adapter is None:
            return None
        source_dt = self._session_authoritative_datetime(session)
        if source_dt is None:
            return None
        base_chart = getattr(parent_cs, "radix", None) or getattr(parent_cs, "chart", None)
        if base_chart is None:
            return None
        driver = self._controller._driver_for_session(session)
        driver.horoscope = base_chart
        try:
            binding = adapter.capture_binding(
                driver,
                session=session,
                current_chart=current_chart,
                feature_kind=feature_kind,
            )
            source_display_dt = _datetime_to_display(source_dt)
            driver_state = supplementary_adapter.SupplementaryDriverState(
                base_chart=base_chart,
                source_datetime=source_dt,
                chart_session=parent_cs,
                runtime_radix=base_chart,
                source_display_datetime=source_display_dt,
            )
            result = adapter.build(
                driver,
                driver_state,
                binding,
                current_chart=current_chart,
                session=session,
            )
        except Exception:
            return None
        if result is None or result.chart is None or result.display_datetime is None:
            return None
        result.binding.parent_source_datetime = _datetime_to_display(source_dt)
        return base_chart, source_dt, result

    def _apply_reparent_supplementary_result(
        self,
        session: dict,
        parent_session: dict,
        base_chart,
        source_dt: datetime.datetime,
        result,
    ) -> bool:
        cs = session.get("chart_session")
        if cs is None or result is None or result.chart is None or result.display_datetime is None:
            return False
        self._controller._apply_rebuilt_child(
            session,
            cs,
            base_chart,
            source_dt,
            result.chart,
            result.display_datetime,
        )
        session["comparison_chart"] = self._controller._comparison_chart_for_parent(parent_session)
        self._controller._apply_supplementary_binding(session, result.binding)
        return True

    @staticmethod
    def _session_authoritative_datetime(session: dict) -> Optional[datetime.datetime]:
        cs = session.get("chart_session")
        if cs is not None:
            display_dt = _display_to_datetime(getattr(cs, "display_datetime", None))
            if display_dt is not None:
                return display_dt
            chrt = getattr(cs, "chart", None)
        else:
            chrt = session.get("chart")
        display_dt = _display_to_datetime(WorkspaceSessionController._chart_time_display_tuple(chrt))
        if display_dt is not None:
            return display_dt
        return None

    # -- chart editor: session-cursor edit lane (morin.py:14821-14872) -----

    def editor_cursor_seed(self, document_id: str) -> dict:
        """Seed the chart editor from a document's session cursor when ``onData``
        would edit the stepping anchor rather than a stored radix
        (morin.py:14821). Returns ``{usesSessionCursor: False}`` for documents
        that are NOT cursor editors — the skin then takes the stored-radix
        CREATE/EDIT path. Pure delegation to the controller's wx-free
        ``editor_seed`` (workspace_session_controller.editor_seed)."""
        with self._lock:
            seed = self._controller.editor_seed(document_id)
        if seed is None:
            return {"usesSessionCursor": False}
        fields = seed.get("fields")
        if isinstance(fields, dict):
            context = self.note_record_context(document_id)
            legacy = str(fields.get("notes") or "")
            notes_service.merge_legacy_note_state(
                str(context.get("sourceName") or ""),
                legacy,
                record_id=str(context.get("recordId") or "").strip() or None,
                document_id=str(context.get("documentId") or "").strip() or None,
                scratch=bool(context.get("scratch")),
            )
            fields["notes"] = str(notes_service.read_note_state(
                str(context.get("sourceName") or ""),
                record_id=str(context.get("recordId") or "").strip() or None,
                document_id=str(context.get("documentId") or "").strip() or None,
                scratch=bool(context.get("scratch")),
            ).get("content") or "")
        return seed

    def editor_radix_seed(self, document_id: str) -> dict:
        """Seed the editor from an OPEN radix document's live chart.

        Loading by JSONL record is stale whenever the open radix has dirty
        in-memory edits (astrocart set_pob, rectification, unsaved personal-data
        changes). This endpoint mirrors the stored-record field shape but reads
        the canonical session chart and preserves its Record id.
        """
        from webapp.daemon import editor_service as _editor
        with self._lock:
            session = self._controller.session(document_id)
            if session is None:
                raise ValueError(f"unknown document {document_id!r}")
            if session.get('supplementary_feature_kind') or session.get('launcher_kind') \
                    or session.get('compound_kind'):
                raise ValueError("editor_radix_seed targets a radix document only")
            cs = session.get('chart_session')
            chrt = None
            if cs is not None:
                chrt = getattr(cs, 'radix', None) or getattr(cs, 'chart', None)
            if chrt is None:
                chrt = session.get('chart')
            if chrt is None:
                raise ValueError("document has no chart to edit")
            chart_id = str(session.get('chart_id') or getattr(chrt, 'chart_id', '') or '')
            record = chartfile.chart_to_dict(chrt, chart_id=chart_id or None)
            context = self.note_record_context(document_id)
            notes_service.merge_legacy_note_state(
                str(context.get("sourceName") or record.get("name") or ""),
                str(record.get("notes") or ""),
                record_id=str(context.get("recordId") or chart_id).strip() or None,
                document_id=str(context.get("documentId") or document_id).strip() or None,
                scratch=bool(context.get("scratch")),
            )
            record["notes"] = ""
            try:
                chrt.notes = ""
            except Exception:
                pass
            fields = _editor.record_to_editor_fields(record)
            fields["notes"] = str(notes_service.read_note_state(
                str(context.get("sourceName") or record.get("name") or ""),
                record_id=str(context.get("recordId") or chart_id).strip() or None,
                document_id=str(context.get("documentId") or document_id).strip() or None,
                scratch=bool(context.get("scratch")),
            ).get("content") or "")
            return {
                "fields": fields,
                "collection": str(session.get('fpath') or '').strip(),
                "usesLiveDocument": True,
            }

    def editor_apply_cursor(self, document_id: str, fields: dict) -> dict:
        """Apply edited editor fields back to a document's session-cursor chart
        (morin.py:14855 _apply_data_dialog_to_session_cursor_chart). Delegates to
        the controller, which re-derives the cursor chart through the canonical
        Binding -> Deriver -> Chart path and emits the session.changed fan-out."""
        with self._lock:
            session = self._controller.session(document_id)
            if session is None:
                raise ValueError(f"unknown document {document_id!r}")
            context = self.note_record_context(document_id)
            markdown = str(fields.get("notes") or "")
            prepared_fields = dict(fields)
            prepared_fields["notes"] = ""
            ok = self._controller.apply_editor_to_cursor(document_id, prepared_fields)
        if not ok:
            raise ValueError(
                f"document {document_id!r} is not a session-cursor editor target"
            )
        notes_service.write_note_state(
            str(context.get("sourceName") or ""),
            markdown,
            record_id=str(context.get("recordId") or "").strip() or None,
            document_id=str(context.get("documentId") or "").strip() or None,
            scratch=bool(context.get("scratch")),
        )
        # The tree title/dirty marker shifted (the cursor chart was re-derived);
        # broadcast the new document tree alongside the controller's own
        # session.changed so every client repaints the edited child + descendants.
        self._manager.broadcast_threadsafe({
            "type": "documents.changed",
            "tree": self._tree_payload(),
        })
        return {"ok": True, "docId": document_id}

    def navigate(self, document_id: str, unit: str, delta: int) -> dict:
        """morin.py cursor step -> cs.navigate_relative -> on_session_change
        (change_reason='step'). The controller's on_change fan-out broadcasts the
        session.changed event; we just return the resulting state."""
        with self._lock:
            session = self._controller.session(document_id)
            if session is None:
                raise ValueError(f"unknown document {document_id!r}")
            cs = session.get('chart_session')
            if cs is None:
                raise ValueError(f"document {document_id!r} has no chart session")
            cs = self._ensure_root_radix_step_session(session) or cs
            was_dirty = bool(session.get('dirty', False))
            if session.get('launcher_kind') == 'pd_in_chart':
                stepped = self._navigate_pd_in_chart(session, cs, unit, int(delta))
            elif session.get('supplementary_feature_kind') in _PROGRESSION_FEATURE_KINDS:
                stepped = self._navigate_progression_direct(session, cs, unit, int(delta))
            elif session.get('supplementary_feature_kind') == 'converse_transits':
                stepped = self._navigate_converse_transit_direct(
                    cs,
                    unit,
                    int(delta),
                )
            else:
                stepped = bool(cs.navigate_relative(unit, int(delta)))
            if stepped and self._is_at_visual_session(session):
                self._sync_ascensional_session_metadata(session)
            return self._navigate_key_result(
                document_id, cs, stepped, was_dirty=was_dirty, include_documents=True,
            )

    @staticmethod
    def _navigate_converse_transit_direct(cs, unit: str, delta: int) -> bool:
        """Route the legacy unit API through the dual-clock stepper too."""
        if int(delta) == 0:
            return False
        modifiers = {
            "day": (False, False, 316, 314),
            "hour": (True, False, 316, 314),
            "minute": (False, True, 316, 314),
            "second": (True, True, 316, 314),
            "week": (False, False, 315, 317),
        }.get(str(unit))
        if modifiers is None:
            return False
        shift, alt, positive_key, negative_key = modifiers
        keycode = positive_key if int(delta) > 0 else negative_key
        return bool(cs._forward_stepper_arrow(
            keycode,
            shift_down=shift,
            alt_down=alt,
            repeat=abs(int(delta)),
        ))

    def _navigate_progression_direct(self, session: dict, cs, unit: str, delta: int) -> bool:
        feature_kind = session.get('supplementary_feature_kind')
        radix = getattr(cs, 'radix', None)
        if feature_kind not in _PROGRESSION_FEATURE_KINDS or radix is None:
            return False
        current_when = _display_to_datetime(getattr(cs, 'display_datetime', None))
        if current_when is None:
            current_when = _display_to_datetime(session.get('parent_source_datetime'))
        if current_when is None:
            return False
        next_when = cursor_steppers.step_source_datetime(radix, current_when, unit, delta)
        if next_when is None or next_when == current_when:
            return False

        if feature_kind == 'solar_arc':
            built = self._build_solar_arc_child_result(
                radix,
                next_when,
                binding_payload=session.get('supplementary_binding'),
            )
        else:
            public_kind = FEATURE_TO_PUBLIC_KIND.get(feature_kind)
            if public_kind is None:
                return False
            built = supplementary_service.build_result(
                radix=radix,
                kind=public_kind,
                when=next_when,
                binding_payload=session.get('supplementary_binding'),
            )
        derived_chart = built.get("chart") if isinstance(built, dict) else None
        display_dt = built.get("display_datetime") if isinstance(built, dict) else None
        binding = built.get("binding") if isinstance(built, dict) else None
        if derived_chart is None or display_dt is None or binding is None:
            return False
        session['parent_source_datetime'] = _datetime_to_display(next_when)
        session['chart'] = derived_chart
        self._controller._apply_supplementary_binding(session, binding)
        cs.change_chart(derived_chart, display_datetime=display_dt, change_reason='step')
        return True

    # Integer keycodes the canonical ChartSession fallbacks recognise
    # (chart_session.py:51-54 LEFT/RIGHT/UP/DOWN _KEYS). Passing these lets
    # _normalized_nav_key resolve them to wx.WXK_* regardless of the wx build.
    _ARROW_KEYCODES = {
        'left': 314,
        'right': 316,
        'up': 315,
        'down': 317,
    }

    # Feature kinds whose arrows step a calendar cursor via
    # _navigate_intrinsically (transit children + the self-anchored root radix,
    # whose feature_kind is None). Every other supplementary kind routes to the
    # year/cycle stepper — see doc/migration/surfaces/arrow-stepping.md
    # "Resolved: return/progression routing".
    _INTRINSIC_FEATURE_KINDS = {None, 'transits'}

    _MULTIWHEEL_NAVIGATION_RETAINED_KEYS = {
        'solar_year_offset',
        'solar_degree_offset',
        'lunar_cycle_offset',
        'cycle_offset',
        'planetary_step_anchor_datetime',
        'planetary_step_delta',
        'synodic_event_datetime',
        'raw_synodic_datetime',
        'synodic_event',
        'symbolic_cursor_jd',
    }

    @staticmethod
    def _multiwheel_rebased_binding(
        binding_payload: Optional[dict[str, Any]],
        target: datetime.datetime,
    ) -> Optional[dict[str, Any]]:
        """Keep technique configuration while discarding its private cursor.

        Return/cycle offsets are navigation state, not part of a chart's
        astrological definition. A following ring must resolve itself from the
        branch cursor instead of applying the offset it accumulated before the
        multi-wheel became coherent.
        """
        if not isinstance(binding_payload, dict):
            return binding_payload
        rebound = copy.deepcopy(binding_payload)
        retained = dict(rebound.get('retained_state') or {})
        for key in WorkspaceService._MULTIWHEEL_NAVIGATION_RETAINED_KEYS:
            retained.pop(key, None)
        target_tuple = _datetime_to_display(target)
        retained['display_datetime'] = target_tuple
        retained['symbolic_cursor_datetime'] = target_tuple
        rebound['retained_state'] = retained
        rebound['parent_source_datetime'] = target_tuple
        return rebound

    @staticmethod
    def _multiwheel_cursor_seed(
        owner: dict,
        selected_session: dict,
        moving_sessions: list[dict],
    ) -> Optional[datetime.datetime]:
        stored = _display_to_datetime(owner.get('multiwheel_cursor_datetime'))
        if stored is not None:
            return stored
        candidates = [selected_session, *reversed(moving_sessions)]
        for candidate in candidates:
            cs = candidate.get('chart_session') if candidate is not None else None
            seed = _display_to_datetime(getattr(cs, 'display_datetime', None))
            if seed is not None:
                stamp = _datetime_to_display(seed)
                owner['multiwheel_cursor_datetime'] = stamp
                owner.setdefault('multiwheel_initial_cursor_datetime', stamp)
                return seed
        return None

    @staticmethod
    def _multiwheel_ring_follows_cursor(session: Optional[dict]) -> bool:
        """Whether a ring has a declared canonical temporal re-deriver.

        Static chart transforms such as relocations and harmonics remain valid
        visual reference rings, but they do not become temporal techniques just
        because a return/progression in the same branch is stepped.
        """
        if not isinstance(session, dict):
            return False
        if session.get('launcher_kind') == 'pd_in_chart':
            return True
        feature_kind = session.get('supplementary_feature_kind')
        if feature_kind is None and session.get('launcher_kind') == 'solar_average':
            feature_kind = 'solar_average'
        return FEATURE_TO_PUBLIC_KIND.get(feature_kind) is not None

    def _quantize_fixed_multiwheel_cursor(
        self,
        owner: dict,
        cs,
        cursor: datetime.datetime,
        key: str,
        *,
        shift: bool,
        alt: bool,
        repeat: int,
    ) -> Optional[datetime.datetime]:
        """Apply the fixed radix tab's grammar without moving the radix."""
        normalized = str(key or '').strip().lower()
        if normalized == 'space':
            if shift or alt:
                return None
            return (
                _display_to_datetime(owner.get('multiwheel_initial_cursor_datetime'))
                or cursor
            )
        if normalized not in self._ARROW_KEYCODES:
            raise ValueError(f"unsupported navigate key {key!r}")
        radix = getattr(cs, 'radix', None) or getattr(cs, 'chart', None)
        if radix is None:
            return None
        direction = -1 if normalized in ('left', 'down') else 1
        if normalized in ('left', 'right'):
            unit = cs._get_navigation_unit(shift_down=shift, alt_down=alt)
            if unit is None:
                return None
            return cursor_steppers.step_source_datetime(
                radix, cursor, unit, direction * repeat,
            )
        if shift and not alt:
            source_time = getattr(radix, 'time', None)
            if source_time is None:
                return None
            try:
                cursor_time = export_chart_json.chart_mod.Time(
                    cursor.year, cursor.month, cursor.day,
                    cursor.hour, cursor.minute, cursor.second,
                    bool(getattr(source_time, 'bc', False)),
                    getattr(source_time, 'cal', export_chart_json.chart_mod.Time.GREGORIAN),
                    getattr(source_time, 'zt', export_chart_json.chart_mod.Time.ZONE),
                    bool(getattr(source_time, 'plus', True)),
                    int(getattr(source_time, 'zh', 0) or 0),
                    int(getattr(source_time, 'zm', 0) or 0),
                    bool(getattr(source_time, 'daylightsaving', False)),
                    radix.place,
                    False,
                    tzid=getattr(source_time, 'tzid', ''),
                    tzauto=bool(getattr(source_time, 'tzauto', False)),
                )
                phase_time = moonphasejump.jump_to_classical_phase(
                    cursor_time, radix.place, direction,
                )
            except Exception:
                return None
            if phase_time is None:
                return None
            try:
                return datetime.datetime(
                    int(getattr(phase_time, 'origyear', phase_time.year)),
                    int(getattr(phase_time, 'origmonth', phase_time.month)),
                    int(getattr(phase_time, 'origday', phase_time.day)),
                    int(phase_time.hour), int(phase_time.minute), int(phase_time.second),
                )
            except (TypeError, ValueError, OverflowError):
                return None
        return cursor_steppers.step_source_datetime(
            radix, cursor, 'week', direction * repeat,
        )

    def _rederive_multiwheel_ring_at_cursor(
        self,
        session: dict,
        target: datetime.datetime,
    ) -> bool:
        """Translate one moving layer from the shared Antikythera cursor."""
        cs = session.get('chart_session')
        if cs is None:
            return False
        target_tuple = _datetime_to_display(target)
        if session.get('launcher_kind') == 'pd_in_chart':
            built = self._build_pd_in_chart_for_cursor(session, target)
            if built is None:
                return False
            derived_chart, arc = built
            pd_binding = dict(session.get('pd_in_chart_binding') or {})
            pd_binding['currentArc'] = arc
            session['pd_in_chart_binding'] = pd_binding
        else:
            feature_kind = session.get('supplementary_feature_kind')
            if feature_kind is None and session.get('launcher_kind') == 'solar_average':
                feature_kind = 'solar_average'
            public_kind = FEATURE_TO_PUBLIC_KIND.get(feature_kind)
            radix = getattr(cs, 'radix', None)
            if public_kind is None or radix is None:
                return False
            binding_payload = self._multiwheel_rebased_binding(
                session.get('supplementary_binding'), target,
            )
            built = supplementary_service.build_result(
                radix=radix,
                kind=public_kind,
                when=target,
                binding_payload=binding_payload,
                planet_type=session.get('planetary_return_type'),
            )
            derived_chart = built.get('chart')
            binding = built.get('binding')
            if derived_chart is None or binding is None:
                return False
            binding.parent_source_datetime = target_tuple
            self._controller._apply_supplementary_binding(session, binding)
            session['parent_source_datetime'] = target_tuple

        current_chart = getattr(cs, 'chart', None)
        if current_chart is not None:
            derived_chart.name = getattr(current_chart, 'name', derived_chart.name)
            derived_chart.male = getattr(current_chart, 'male', derived_chart.male)
            derived_chart.notes = getattr(current_chart, 'notes', '')
        session['chart'] = derived_chart
        parent_session = self._controller.session(session.get('parent_document_id'))
        session['comparison_chart'] = self._controller._comparison_chart_for_child_session(
            session, parent_session,
        )
        cs.change_chart(
            derived_chart,
            display_datetime=target_tuple,
            change_reason='step',
        )
        return True

    def navigate_key(
        self,
        document_id: str,
        key: str,
        *,
        shift: bool = False,
        alt: bool = False,
        repeat: int = 1,
        include_perf: bool = False,
    ) -> dict:
        """Navigate one tab, or the moving charts in its multi-wheel branch.

        The selected tab still supplies the visible navigation controls and key
        grammar. The same intent is then applied once to each moving ring
        session and only the final, fully coordinated multi-wheel snapshot is
        serialized. A radix branch owner is the fixed reference ring and never
        advances with the derived/timed children.
        """
        command_started_at = time.perf_counter()
        with self._lock:
            session = self._controller.session(document_id)
            if session is None:
                raise ValueError(f"unknown document {document_id!r}")
            ring_ids = self._multiwheel_participant_ids(document_id)
        if len(ring_ids) < 3:
            return self._navigate_key_single(
                document_id,
                key,
                shift=shift,
                alt=alt,
                repeat=repeat,
                include_perf=include_perf,
            )

        fixed_ids: list[str] = []
        with self._lock:
            owner_id, owner = self._ring_owner(document_id)
            fixed_ids = [
                ring_id
                for ring_id in ring_ids
                if (
                    ring_id == owner_id
                    or not self._multiwheel_ring_follows_cursor(
                        self._controller.session(ring_id)
                    )
                )
            ]
        step_ids = [ring_id for ring_id in ring_ids if ring_id not in fixed_ids]

        buffered_events: list[SessionChangedEvent] = []
        selected: Optional[dict] = None
        canonical_target: Optional[datetime.datetime] = None
        captured: dict[str, dict[str, Any]] = {}
        owner_cursor_before = None
        owner_initial_before = None
        try:
            with self._lock:
                owner_id, owner = self._ring_owner(document_id)
                if owner is None:
                    raise ValueError(f"unknown ring owner {owner_id!r}")
                selected_session = self._controller.session(document_id)
                if selected_session is None:
                    raise ValueError(f"unknown document {document_id!r}")
                owner_cursor_before = owner.get('multiwheel_cursor_datetime')
                owner_initial_before = owner.get('multiwheel_initial_cursor_datetime')
                moving_sessions = [
                    ring_session
                    for ring_id in step_ids
                    if (ring_session := self._controller.session(ring_id)) is not None
                ]
                seed_session = (
                    selected_session
                    if document_id in step_ids
                    else moving_sessions[-1] if moving_sessions else selected_session
                )
                branch_cursor = self._multiwheel_cursor_seed(
                    owner, seed_session, moving_sessions,
                )
                if branch_cursor is None:
                    raise ValueError("multi-wheel branch has no time cursor")
                for ring_id in step_ids:
                    ring_session = self._controller.session(ring_id)
                    ring_cs = ring_session.get('chart_session') if ring_session else None
                    if ring_session is None or ring_cs is None:
                        raise ValueError(f"multi-wheel ring {ring_id!r} has no chart session")
                    captured[ring_id] = {
                        'session_chart': ring_session.get('chart'),
                        'supplementary_binding': copy.deepcopy(
                            ring_session.get('supplementary_binding')
                        ),
                        'parent_source_datetime': ring_session.get('parent_source_datetime'),
                        'comparison_chart': ring_session.get('comparison_chart'),
                        'pd_in_chart_binding': copy.deepcopy(
                            ring_session.get('pd_in_chart_binding')
                        ),
                        'dirty': ring_session.get('dirty'),
                        'chart': ring_cs.chart,
                        'display_datetime': ring_cs.display_datetime,
                        'cursor_jd': ring_cs.cursor_jd,
                        'last_change_reason': ring_cs._last_change_reason,
                        'exact_hit_metrics': copy.deepcopy(ring_cs._exact_hit_metrics),
                    }
                self._controller.set_event_listener(buffered_events.append)
                with self._controller.suspend_child_refresh():
                    if document_id in fixed_ids:
                        selected_cs = selected_session.get('chart_session')
                        canonical_target = self._quantize_fixed_multiwheel_cursor(
                            owner,
                            selected_cs,
                            branch_cursor,
                            key,
                            shift=shift,
                            alt=alt,
                            repeat=repeat,
                        )
                        moved = (
                            canonical_target is not None
                            and canonical_target != branch_cursor
                        )
                        selected = {
                            'documentId': document_id,
                            'stepped': moved,
                            'appliedSteps': repeat if moved else 0,
                            'displayDatetime': _display_tuple_to_iso(
                                _datetime_to_display(canonical_target)
                                if canonical_target is not None
                                else getattr(selected_cs, 'display_datetime', None)
                            ),
                        }
                    else:
                        selected = self._navigate_key_single(
                            document_id,
                            key,
                            shift=shift,
                            alt=alt,
                            repeat=repeat,
                            include_perf=False,
                            attach_snapshot=False,
                        )
                        selected_cs = selected_session.get('chart_session')
                        canonical_target = _display_to_datetime(
                            getattr(selected_cs, 'display_datetime', None)
                        )
                        moved = bool(selected.get('stepped'))

                    if moved:
                        if canonical_target is None:
                            raise RuntimeError("selected multi-wheel quantizer returned no cursor")
                        for ring_id in step_ids:
                            if ring_id == document_id:
                                continue
                            ring_session = self._controller.session(ring_id)
                            if not self._rederive_multiwheel_ring_at_cursor(
                                ring_session, canonical_target,
                            ):
                                raise RuntimeError(
                                    f"multi-wheel ring {ring_id!r} could not be re-derived"
                                )
                        owner['multiwheel_cursor_datetime'] = _datetime_to_display(
                            canonical_target
                        )
        except Exception:
            # Coherence is atomic: if one deriver fails, restore every moving
            # layer and publish none of the intermediate session events.
            with self._lock:
                for ring_id, state in captured.items():
                    ring_session = self._controller.session(ring_id)
                    ring_cs = ring_session.get('chart_session') if ring_session else None
                    if ring_session is None or ring_cs is None:
                        continue
                    ring_session['chart'] = state['session_chart']
                    ring_session['supplementary_binding'] = state['supplementary_binding']
                    ring_session['parent_source_datetime'] = state['parent_source_datetime']
                    ring_session['comparison_chart'] = state['comparison_chart']
                    ring_session['pd_in_chart_binding'] = state['pd_in_chart_binding']
                    ring_session['dirty'] = state['dirty']
                    ring_cs.chart = state['chart']
                    ring_cs.display_datetime = state['display_datetime']
                    ring_cs.cursor_jd = state['cursor_jd']
                    ring_cs._last_change_reason = state['last_change_reason']
                    ring_cs._exact_hit_metrics = state['exact_hit_metrics']
                    self._controller._sync_runtime_title(ring_session)
                if owner is not None:
                    if owner_cursor_before is None:
                        owner.pop('multiwheel_cursor_datetime', None)
                    else:
                        owner['multiwheel_cursor_datetime'] = owner_cursor_before
                    if owner_initial_before is None:
                        owner.pop('multiwheel_initial_cursor_datetime', None)
                    else:
                        owner['multiwheel_initial_cursor_datetime'] = owner_initial_before
            raise
        finally:
            self._controller.set_event_listener(self._on_controller_event)

        if selected is None:
            with self._lock:
                selected_session = self._controller.session(document_id)
                selected_cs = (
                    selected_session.get('chart_session')
                    if selected_session is not None
                    else None
                )
            selected = {
                "documentId": document_id,
                "stepped": False,
                "appliedSteps": 0,
                "displayDatetime": _display_tuple_to_iso(
                    getattr(selected_cs, 'display_datetime', None)
                ),
            }
        stepped = bool(selected.get("stepped"))
        result = {
            **selected,
            "stepped": stepped,
            "coordinatedDocumentIds": step_ids,
            "fixedDocumentIds": fixed_ids,
        }
        if stepped:
            result["snapshot"] = self.document_snapshot(
                document_id,
                overlay_render_mode=self._step_render_mode(document_id),
                include_perf=include_perf,
            )
            selected_event = next(
                (
                    event for event in reversed(buffered_events)
                    if event.document_id == document_id
                ),
                None,
            )
            self._on_controller_event(SessionChangedEvent(
                document_id=document_id,
                change_reason=(selected_event.change_reason if selected_event else 'step'),
                is_active=(document_id == self._controller.active_document_id()),
                rebuilt_child_ids=[],
            ))
        if include_perf:
            timing = result.setdefault("debugTiming", {})
            timing["totalMs"] = (time.perf_counter() - command_started_at) * 1000.0
        return result

    def _navigate_key_single(
        self,
        document_id: str,
        key: str,
        *,
        shift: bool = False,
        alt: bool = False,
        repeat: int = 1,
        include_perf: bool = False,
        attach_snapshot: bool = True,
    ) -> dict:
        """Canonical arrow-key navigation — the wx-free twin of
        keyboard_layers.handle_transit_key_event (keyboard_layers.py:81).

        ``space`` (no mods) resets to the initial chart. Arrows are forwarded to
        the document's ChartSession ``_navigate_intrinsically`` (transit/root
        path: day/hour/minute/week/lunar-phase, chosen server-side from the
        session's ``navigation_units`` + modifiers). For return/progression docs
        the arrow is instead routed to the supplementary year/cycle stepper via
        the same ``supplementary_service`` path ``/api/chart/supplementary/step``
        uses (the daemon opens those children with calendar units, so we must
        route on ``supplementary_feature_kind`` rather than trust the units —
        see the spec's Resolved note)."""
        command_started_at = time.perf_counter()
        normalized = str(key or '').strip().lower()
        repeat = max(1, min(64, int(repeat)))
        with self._lock:
            session = self._controller.session(document_id)
            if session is None:
                raise ValueError(f"unknown document {document_id!r}")
            cs = session.get('chart_session')
            if cs is None:
                raise ValueError(f"document {document_id!r} has no chart session")
            cs = self._ensure_root_radix_step_session(session) or cs
            was_dirty = bool(session.get('dirty', False))
            is_pd_in_chart = session.get('launcher_kind') == 'pd_in_chart'

            def finish(stepped: bool, **kwargs) -> dict:
                return self._navigate_key_result(
                    document_id,
                    cs,
                    stepped,
                    include_perf=include_perf,
                    attach_snapshot=attach_snapshot,
                    command_started_at=command_started_at,
                    **kwargs,
                )

            # Space (no modifiers) -> canonical reset.
            if normalized == 'space':
                if shift or alt:
                    return finish(False, was_dirty=was_dirty)
                stepped = (
                    self._reset_pd_in_chart(session, cs)
                    if is_pd_in_chart
                    else bool(cs.reset_to_initial_chart())
                )
                if stepped:
                    self._clear_rectification_dirty_if_reset(document_id, session, cs)
                if stepped and self._is_at_visual_session(session):
                    self._sync_ascensional_session_metadata(session)
                    self._manager.broadcast_threadsafe({
                        "type": "documents.changed",
                        "tree": self._tree_payload(),
                    })
                return finish(stepped, was_dirty=was_dirty)

            keycode = self._ARROW_KEYCODES.get(normalized)
            if keycode is None:
                raise ValueError(f"unsupported navigate key {key!r}")

            if is_pd_in_chart:
                if normalized not in ('left', 'right'):
                    return finish(False, was_dirty=was_dirty)
                unit = 'week' if alt else 'month' if shift else 'year'
                direction = -1 if normalized == 'left' else 1
                # Fold policy is a property of the (family, intent) pair, not of
                # the document kind — doc/temporal-capability-matrix.md §3.5.
                # 'week' is a fixed-length unit, so N presses are exactly one
                # call with delta N. 'month' and 'year' clamp at month ends and
                # leap days, where the two diverge: 5x(+1 month) from 31 Jan
                # lands on 28 Jun, one (+5 months) lands on 30 Jun. Those are
                # sequence_required and must execute one transition at a time,
                # the same way SupplementaryStepper._step loops over `repeat`.
                if cursor_steppers.is_fold_safe_unit(unit):
                    stepped = self._navigate_pd_in_chart(
                        session, cs, unit, direction * repeat,
                    )
                    applied = repeat if stepped else 0
                else:
                    applied = 0
                    for _ in range(repeat):
                        if not self._navigate_pd_in_chart(session, cs, unit, direction):
                            break
                        applied += 1
                    stepped = applied > 0
                return finish(
                    stepped, was_dirty=was_dirty, applied_steps=applied or repeat,
                )

            feature_kind = session.get('supplementary_feature_kind')
            if (
                self._is_mdo_visual_session(session)
                and feature_kind not in _PROGRESSION_FEATURE_KINDS
            ):
                return self._navigate_ascensional_key(
                    document_id,
                    session,
                    cs,
                    normalized,
                    shift=shift,
                    alt=alt,
                    repeat=repeat,
                    include_perf=include_perf,
                    attach_snapshot=attach_snapshot,
                    command_started_at=command_started_at,
                )

            if feature_kind in self._INTRINSIC_FEATURE_KINDS:
                if repeat > 1 and normalized in ('left', 'right'):
                    unit = cs._get_navigation_unit(shift_down=shift, alt_down=alt)
                    delta = (-1 if normalized == 'left' else 1) * repeat
                    stepped = bool(unit and cs.navigate_relative(unit, delta))
                elif repeat > 1 and normalized in ('up', 'down') and not (shift and not alt):
                    delta = (-1 if normalized == 'down' else 1) * repeat
                    stepped = bool(cs.navigate_relative('week', delta))
                else:
                    stepped = bool(cs._navigate_intrinsically(
                        keycode, shift_down=shift, alt_down=alt,
                    ))
                if stepped:
                    return finish(
                        True,
                        was_dirty=was_dirty,
                        applied_steps=repeat if repeat == 1 or not (shift and normalized in ('up', 'down')) else 1,
                    )
                # Fall through to the stepper only if the session somehow carries
                # a stepper feature (defensive; transit/root normally don't).

            # Derived (return/progression) charts step through the wx-free stepper
            # plugged into cs._stepper at open — the SAME ChartSession plumbing the
            # desktop uses (_forward_stepper_arrow, chart_session.py:122-140).
            # Routing through cs (not a daemon-private step path) is exactly what
            # lets space -> cs.reset_to_initial_chart rewind the offset for free.
            stepped = bool(cs._forward_stepper_arrow(
                keycode, shift_down=shift, alt_down=alt, repeat=repeat,
            ))
            return finish(stepped, was_dirty=was_dirty, applied_steps=repeat)

    def _navigate_ascensional_key(
        self,
        document_id: str,
        session: dict,
        cs,
        key: str,
        *,
        shift: bool,
        alt: bool,
        repeat: int = 1,
        include_perf: bool = False,
        attach_snapshot: bool = True,
        command_started_at: Optional[float] = None,
    ) -> dict:
        """AT MDO/diurnal key cadence.

        Normal arrows rotate the event chart by one degree of diurnal/MDO
        motion. Shift arrows step one minute; Alt arrows step one second.
        """
        stepped = False
        if key in ("left", "right", "up", "down"):
            direction = (-1 if key in ("left", "down") else 1) * repeat
            if alt:
                stepped = bool(cs.navigate_relative("second", direction))
            elif shift:
                stepped = bool(cs.navigate_relative("minute", direction))
            else:
                delta_seconds = int(round(direction * 86164.0905 / 360.0))
                stepped = bool(cs.navigate_relative("second", delta_seconds))
        if stepped and self._is_at_visual_session(session):
            self._sync_ascensional_session_metadata(session)
            self._manager.broadcast_threadsafe({
                "type": "documents.changed",
                "tree": self._tree_payload(),
            })
        return self._navigate_key_result(
            document_id,
            cs,
            stepped,
            applied_steps=repeat,
            include_perf=include_perf,
            attach_snapshot=attach_snapshot,
            command_started_at=command_started_at,
        )

    def toggle_comparison(self, document_id: str) -> dict:
        """Toggle a document between comparison and focused singleton view —
        the wx-free twin of the TAB key (keyboard_layers.handle_transit_key_event
        keyboard_layers.py:123-128 -> morin.toggleComparisonView morin.py:8762 ->
        ChartSession.toggleComparisonView chart_session.py:209).
        A branch multi-wheel keeps its membership and ordering intact while a
        branch-owned presentation flag isolates whichever chart tab is active.
        Ordinary wheels flip ``cs.view_mode`` (CHART<->COMPOUND), which remains
        the source of truth for whether their outer ring appears.
        Returns the new viewMode + a FULL re-rendered snapshot because this is a
        structural ring change, not a step-burst frame."""
        with self._lock:
            session = self._controller.session(document_id)
            if session is None:
                raise ValueError(f"unknown document {document_id!r}")
            cs = session.get('chart_session')
            if cs is None:
                raise ValueError(f"document {document_id!r} has no chart session")
            if session.get('compound_kind') == 'composite_from_synastry':
                next_variant = 'davison' if session.get('composite_variant') != 'davison' else 'midpoint'
                result = self.set_synastry_composite(document_id, variant=next_variant)
                result["toggled"] = True
                return result
            if session.get('compound_kind') == 'synastry':
                relationship_rings = self._relationship_multiwheel_charts(session)
                if len(relationship_rings) >= 3:
                    single_chart = not bool(
                        session.get("relationship_multiwheel_single_chart_view")
                    )
                    if single_chart:
                        session["relationship_multiwheel_single_chart_view"] = True
                    else:
                        session.pop(
                            "relationship_multiwheel_single_chart_view", None,
                        )
                    result = {
                        "documentId": document_id,
                        "toggled": True,
                        "viewMode": getattr(cs, 'view_mode', 0),
                        "multiwheelSingleChartView": single_chart,
                        "ringOwnerDocumentId": document_id,
                        "documents": self._tree_payload(),
                    }
                    try:
                        result["snapshot"] = self.document_snapshot(
                            document_id, overlay_render_mode="full",
                        )
                    except (ValueError, RuntimeError):
                        pass
                    return result
                return self._toggle_synastry_center(document_id, session, cs)
            owner_id = document_id
            owner = None
            selected: list[str] = []
            enabled = False
            if callable(getattr(self._controller, "documents", None)):
                owner_id, owner, _eligible, selected, enabled = (
                    self._reconcile_multiwheel_state(document_id)
                )
            if owner is not None and enabled and len(selected) >= 3:
                single_chart = not bool(owner.get("multiwheel_single_chart_view"))
                if single_chart:
                    owner["multiwheel_single_chart_view"] = True
                else:
                    owner.pop("multiwheel_single_chart_view", None)
                result = {
                    "documentId": document_id,
                    "toggled": True,
                    "viewMode": getattr(cs, 'view_mode', 0),
                    "multiwheelSingleChartView": single_chart,
                    "ringOwnerDocumentId": owner_id,
                    "documents": self._tree_payload(),
                }
                try:
                    result["snapshot"] = self.document_snapshot(
                        document_id, overlay_render_mode="full",
                    )
                except (ValueError, RuntimeError):
                    pass
                return result
            # This command returns the authoritative full snapshot directly.
            # Suppress ChartSession's generic change callback here so Tab does
            # not also emit session.changed/documents.changed, advance retained
            # list mutation epochs, and turn cached singleton/comparison worlds
            # into one-use entries. Legacy/wx callers keep the notifying default.
            toggled = bool(cs.toggleComparisonView(notify=False))
            result = {
                "documentId": document_id,
                "toggled": toggled,
                "viewMode": getattr(cs, 'view_mode', 0),
                "documents": self._tree_payload(),
            }
            if toggled:
                try:
                    result["snapshot"] = self.document_snapshot(
                        document_id, overlay_render_mode="full",
                    )
                except (ValueError, RuntimeError):
                    pass
            return result

    def _step_render_mode(self, document_id: str) -> str:
        """Pick the cheapest CORRECT render mode for a step.

        ``step_fast`` is a wx-style burst mode, not a stale-geometry mode: the
        zodiac ring, houses, ASC/MC arrows, bodies, outer labels, and hover
        regions all repaint from the stepped snapshot. The only skipped work is
        exporter-side non-frame overlay detail that the settle/full pass fills
        in. Rotating supplementary charts still use ``deferred`` so their
        expensive auxiliary overlay labels can follow the first coherent chart
        paint. Ascensional Transits also rotates its RA wheel, so it joins the
        deferred set.
        """
        session = self._controller.session(document_id)
        if session is None:
            return "step_fast"
        if self._is_mdo_visual_session(session):
            return "deferred"
        feature_kind = session.get("supplementary_feature_kind")
        if feature_kind in self._INTRINSIC_FEATURE_KINDS or feature_kind == 'converse_transits':
            return "step_fast"
        return "deferred"

    def _navigate_key_result(self, document_id: str, cs, stepped: bool,
                             *, was_dirty: Optional[bool] = None,
                             applied_steps: int = 1,
                             include_documents: bool = False,
                             include_perf: bool = False,
                             attach_snapshot: bool = True,
                             command_started_at: Optional[float] = None) -> dict:
        # Step-dirty transition (HorarySession hook -> controller.set_dirty)
        # must reach the sidebar star, but never via a full documents.changed
        # tree broadcast. Alternating around the initial moment can flip dirty
        # on every keypress, so this stays a tiny per-document chrome patch.
        if was_dirty is not None:
            session = self._controller.session(document_id)
            now_dirty = bool(session.get('dirty', False)) if session else False
            if now_dirty != bool(was_dirty):
                self._broadcast_document_patch(document_id)
        result = {
            "documentId": document_id,
            "stepped": bool(stepped),
            "appliedSteps": int(applied_steps) if stepped else 0,
            "displayDatetime": _display_tuple_to_iso(
                getattr(cs, 'display_datetime', None)
            ),
        }
        if include_documents:
            result["documents"] = self._tree_payload()
        # Attach the freshly-rendered chart to the POST response so the skin
        # paints from THIS result instead of waiting for session.changed -> a
        # second snapshot GET (the two serialized round-trips that made stepping
        # slow — ISSUE 1). ``step_fast`` still repaints the full visible wheel
        # from this snapshot; it only skips expensive non-frame overlay details.
        # See _step_render_mode.
        if stepped and attach_snapshot:
            try:
                snapshot_started_at = time.perf_counter()
                result["snapshot"] = self.document_snapshot(
                    document_id,
                    overlay_render_mode=self._step_render_mode(document_id),
                    include_perf=include_perf,
                )
                if include_perf:
                    snapshot = result["snapshot"]
                    result["debugTiming"] = {
                        "preSnapshotMs": (
                            (snapshot_started_at - command_started_at) * 1000.0
                            if command_started_at is not None
                            else None
                        ),
                        "snapshot": snapshot.get("debugTiming"),
                    }
            except (ValueError, RuntimeError):
                # View-only docs (no ChartSession) can't step anyway; leave the
                # skin to its GET fallback rather than fail the navigate.
                pass
        if include_perf:
            timing = result.setdefault("debugTiming", {})
            timing["totalMs"] = (
                (time.perf_counter() - command_started_at) * 1000.0
                if command_started_at is not None
                else None
            )
        return result


def _display_to_datetime(
    display_dt: Optional[tuple[int, int, int, int, int, int]],
) -> Optional[datetime.datetime]:
    if display_dt is None:
        return None
    try:
        y, m, d, h, mi, s = [int(v) for v in tuple(display_dt)[:6]]
        return datetime.datetime(y, m, d, h, mi, s)
    except (TypeError, ValueError):
        return None


def _retained_return_datetime(
    session: Optional[dict[str, Any]],
    current_chart=None,
) -> Optional[datetime.datetime]:
    """Return the active lunar/planetary return instant stamped by the adapter.

    Location-only rebuilds should change the observer place, not the selected
    return cycle. The return adapters stamp the cycle's raw Greenwich instant in
    retained_state; fall back to the displayed chart's own Time if an older
    binding lacks that stamp.
    """
    retained: dict[str, Any] = {}
    if isinstance(session, dict):
        binding = session.get("supplementary_binding")
        if isinstance(binding, dict):
            retained = dict(binding.get("retained_state") or {})
    raw = retained.get("raw_return_datetime")
    dt_value = _display_to_datetime(raw)
    if dt_value is not None:
        return dt_value
    time_obj = getattr(current_chart, "time", None)
    if time_obj is None:
        return None
    try:
        return datetime.datetime(
            int(getattr(time_obj, "year")),
            int(getattr(time_obj, "month")),
            int(getattr(time_obj, "day")),
            int(getattr(time_obj, "hour")),
            int(getattr(time_obj, "minute")),
            int(getattr(time_obj, "second")),
        )
    except Exception:
        return None


def _return_launch_datetime(
    parent_session: Optional[dict[str, Any]],
    when_iso: Optional[str],
) -> datetime.datetime:
    parsed = None
    if when_iso:
        try:
            parsed = datetime.datetime.fromisoformat(str(when_iso)).replace(tzinfo=None)
        except (TypeError, ValueError):
            parsed = None
    if parsed is None:
        return datetime.datetime.now()
    session = parent_session if isinstance(parent_session, dict) else {}
    cs = session.get("chart_session")
    chrt = getattr(cs, "chart", None) if cs is not None else session.get("chart")
    if cs is None or getattr(chrt, "htype", None) != export_chart_json.chart_mod.Chart.RADIX:
        return parsed
    initial = getattr(cs, "_initial_display_datetime", None)
    current = getattr(cs, "display_datetime", None)
    try:
        parsed_tuple = (
            int(parsed.year),
            int(parsed.month),
            int(parsed.day),
            int(parsed.hour),
            int(parsed.minute),
            int(parsed.second),
        )
        initial_tuple = tuple(int(v) for v in tuple(initial or ())[:6])
        current_tuple = tuple(int(v) for v in tuple(current or ())[:6])
    except Exception:
        return parsed
    if (
        len(initial_tuple) == 6
        and len(current_tuple) == 6
        and parsed_tuple == initial_tuple
        and current_tuple == initial_tuple
    ):
        return datetime.datetime.now()
    return parsed


def _datetime_to_display(
    when: Optional[datetime.datetime],
) -> Optional[tuple[int, int, int, int, int, int]]:
    if when is None:
        return None
    return (when.year, when.month, when.day, when.hour, when.minute, when.second)


workspace_service = WorkspaceService()
