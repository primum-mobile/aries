# SPDX-FileCopyrightText: Morinus contributors
# SPDX-FileCopyrightText: 2026 Max Lange (Aries modifications)
# SPDX-License-Identifier: GPL-3.0-or-later
# Modified for Aries in 2026 by Max Lange.

"""Daemon-side supplementary chart computation.

This service intentionally routes every derived chart through
``engine.supplementary_adapter``. It is the same Binding -> Deriver contract the
wx workspace uses, with a wx-free headless driver supplying the small helper
surface the adapters expect.
"""
from __future__ import annotations

import datetime
import sys
import threading
from pathlib import Path
from typing import Any, Optional

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

import phasiscalc
import moonphasejump
import mtexts
from engine import (
    converse_transits,
    cursor_steppers,
    harmonic_chart,
    solilunar,
    supplementary_adapter,
    synodic_cycle,
)
from engine.supplementary_headless_driver import (
    HeadlessChartSession,
    SupplementaryHeadlessDriver,
)
from webapp.daemon.chart_service import chart_snapshot_service
from webapp.frontend.scripts import export_chart_json


PUBLIC_TO_FEATURE_KIND = {
    "transits": "transits",
    "converse-transits": "converse_transits",
    "solar-revolution": "solar_return",
    "lunar-revolution": "lunar_return",
    "secondary-progression": "secondary",
    "tertiary-progression": "tertiary",
    "minor-progression": "minor",
    "solar-arc": "solar_arc",
    "profections": "profections",
    "planetary-return": "planetary_return",
    # solar_average is a LegacySupplementaryAdapter registered in the engine
    # registry (supplementary_adapter.py:753-756); its rebuilder is now wx-free
    # (supplementary_headless_driver._rebuild_workspace_solar_average_child) so
    # the daemon can build it like any other supplementary child.
    "solar-average": "solar_average",
    "harmonic": "harmonic",
}

FEATURE_TO_PUBLIC_KIND = {value: key for key, value in PUBLIC_TO_FEATURE_KIND.items()}
SUPPLEMENTARY_KINDS = set(PUBLIC_TO_FEATURE_KIND)

# Display title roots for derived children (titles-and-naming BUG-2): the
# sidebar/tab line reads "<type> • <weekday date time>" — the
# type, not the radix name (wx roots child rows in mtexts.typeList; we use the
# explicit modern names from the product contract). Planetary returns prepend the body
# ("Mars Return") in workspace_service._open_child.
FEATURE_KIND_DISPLAY_LABELS = {
    "transits": "Transits",
    "converse_transits": "ConverseTransits",
    "solar_return": "Solar Return",
    "lunar_return": "Lunar Return",
    "planetary_return": "Planetary Return",
    "secondary": "Secondary Progression",
    "tertiary": "Tertiary Progression",
    "minor": "Minor Progression",
    "solar_arc": "Solar Arc",
    "profections": "Profections",
    "solar_average": "Solar Average",
    "harmonic": mtexts.txts.get("HarmonicChart", "Harmonic Chart"),
}

# revolutions.Revolutions planet types -> body names (revolutions.py:91-98).
PLANETARY_RETURN_BODY_NAMES = {
    2: "Mercury", 3: "Venus", 4: "Mars", 5: "Jupiter",
    6: "Saturn", 7: "Uranus", 8: "Neptune", 9: "Pluto",
}


def normalize_public_kind(kind: str) -> str:
    if kind not in PUBLIC_TO_FEATURE_KIND:
        raise ValueError(f"Unsupported supplementary kind: {kind!r}")
    return PUBLIC_TO_FEATURE_KIND[kind]


def display_tuple_to_iso(display_dt: Optional[tuple[int, int, int, int, int, int]]) -> Optional[str]:
    if display_dt is None:
        return None
    y, m, d, h, mi, s = [int(v) for v in tuple(display_dt)[:6]]
    return datetime.datetime(y, m, d, h, mi, s).isoformat()


def display_tuple_to_datetime(display_dt: Any) -> Optional[datetime.datetime]:
    if display_dt is None:
        return None
    try:
        y, m, d, h, mi, s = [int(v) for v in tuple(display_dt)[:6]]
        return datetime.datetime(y, m, d, h, mi, s)
    except (TypeError, ValueError, OverflowError):
        return None


def parse_when(when_iso: Optional[str]) -> datetime.datetime:
    if when_iso:
        try:
            return datetime.datetime.fromisoformat(when_iso)
        except (TypeError, ValueError):
            pass
    return datetime.datetime.now()


class SupplementaryService:
    """Builds derived charts off a source radix loaded via chart_snapshot_service."""

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._registry = supplementary_adapter.SupplementaryAdapterRegistry()

    def snapshot(
        self,
        *,
        source: Optional[str] = None,
        source_name: str = "Morinus",
        kind: str = "transits",
        when_iso: Optional[str] = None,
        binding_payload: Optional[dict[str, Any]] = None,
        planet_type: Optional[int] = None,
    ) -> dict:
        with self._lock:
            opts = chart_snapshot_service.options
            source_path = str(Path(source).expanduser()) if source else str(export_chart_json.DEFAULT_SOURCE)
            radix, _record = export_chart_json.load_chart(source_path, opts, name=source_name)
            result = self.build_result(
                radix=radix,
                kind=kind,
                when=parse_when(when_iso),
                binding_payload=binding_payload,
                planet_type=planet_type,
            )
            if result["chart"] is None:
                raise RuntimeError(f"Could not build {kind!r} for {source_name!r}")

            snapshot = export_chart_json.export_snapshot(
                primary=radix,
                comparison=result["chart"],
                radix=radix,
                overlay_render_mode="full",
                overlay_display_datetime=result["display_datetime"],
                overlay_cursor_jd=getattr(getattr(result["chart"], "time", None), "jd", None),
            )
            export_chart_json.apply_display_datetime_to_chart_payload(
                snapshot.get("comparisonChart"),
                result["display_datetime"],
                bc=bool(getattr(getattr(result["chart"], "time", None), "bc", False)),
                options=getattr(result["chart"], "options", None),
            )
            display_iso = display_tuple_to_iso(result["display_datetime"])
            if display_iso is not None:
                snapshot["displayDatetime"] = display_iso
            snapshot["supplementary"] = {
                "kind": kind,
                "featureKind": result["feature_kind"],
                "displayDatetime": display_iso,
                "binding": result["binding"].to_payload(),
            }
            return snapshot

    def step_snapshot(
        self,
        *,
        source: Optional[str] = None,
        source_name: str = "Morinus",
        kind: str,
        when_iso: Optional[str],
        direction: int,
        shift: bool = False,
        alt: bool = False,
        binding_payload: Optional[dict[str, Any]] = None,
        planet_type: Optional[int] = None,
    ) -> dict:
        with self._lock:
            opts = chart_snapshot_service.options
            source_path = str(Path(source).expanduser()) if source else str(export_chart_json.DEFAULT_SOURCE)
            radix, _record = export_chart_json.load_chart(source_path, opts, name=source_name)
            feature_kind = normalize_public_kind(kind)
            binding = supplementary_adapter.SupplementaryBinding.from_payload(
                binding_payload,
                feature_kind=feature_kind,
            ) or supplementary_adapter.SupplementaryBinding(feature_kind)
            when = parse_when(when_iso or display_tuple_to_iso(binding.parent_source_datetime))
            next_when, next_binding_payload = self._step_binding(
                radix=radix,
                feature_kind=feature_kind,
                when=when,
                direction=direction,
                shift=shift,
                alt=alt,
                binding=binding,
            )
            return self.snapshot(
                source=source,
                source_name=source_name,
                kind=kind,
                when_iso=next_when.isoformat(),
                binding_payload=next_binding_payload,
                planet_type=planet_type,
            )

    def synastry_snapshot(
        self,
        *,
        source: Optional[str] = None,
        source_name: str = "Morinus",
        comparison_name: str,
    ) -> dict:
        with self._lock:
            opts = chart_snapshot_service.options
            source_path = str(Path(source).expanduser()) if source else str(export_chart_json.DEFAULT_SOURCE)
            primary, _ = export_chart_json.load_chart(source_path, opts, name=source_name)
            comparison, _ = export_chart_json.load_chart(source_path, opts, name=comparison_name)
            return export_chart_json.export_snapshot(
                primary=primary,
                comparison=comparison,
                overlay_render_mode="full",
            )

    def build_result(
        self,
        *,
        radix,
        kind: str,
        when: datetime.datetime,
        binding_payload: Optional[dict[str, Any]] = None,
        planet_type: Optional[int] = None,
    ) -> dict[str, Any]:
        feature_kind = normalize_public_kind(kind)
        adapter = self._registry.adapter_for_feature_kind(feature_kind)
        if adapter is None:
            raise ValueError(f"Unsupported supplementary feature kind: {feature_kind!r}")

        driver = SupplementaryHeadlessDriver(radix.options)
        driver.horoscope = radix
        source_display_dt = driver._datetime_to_display_tuple(when)
        parent_session = HeadlessChartSession(chart=radix, radix=radix, display_datetime=source_display_dt)
        session = {
            "supplementary_feature_kind": feature_kind,
            "supplementary_binding": binding_payload,
            "parent_source_datetime": source_display_dt,
            "chart_session": HeadlessChartSession(chart=None, radix=radix, display_datetime=source_display_dt),
            "planetary_return_type": planet_type,
        }
        self._apply_solar_average_window_intent(session, binding_payload)

        binding = adapter.capture_binding(
            driver,
            session=session,
            current_chart=None,
            feature_kind=feature_kind,
        )
        if planet_type is not None and feature_kind == "planetary_return":
            retained = dict(binding.retained_state or {})
            retained["planet_type"] = int(planet_type)
            binding.retained_state = retained

        driver_state = supplementary_adapter.SupplementaryDriverState(
            base_chart=radix,
            source_datetime=when,
            chart_session=parent_session,
            runtime_radix=radix,
            source_display_datetime=source_display_dt,
        )
        result = adapter.build(driver, driver_state, binding, current_chart=None, session=session)
        result.binding.parent_source_datetime = source_display_dt
        return {
            "feature_kind": feature_kind,
            "chart": result.chart,
            "display_datetime": result.display_datetime,
            "binding": result.binding,
        }

    def build_chart(
        self,
        *,
        radix,
        kind: str,
        when: datetime.datetime,
        binding_payload: Optional[dict[str, Any]] = None,
    ):
        return self.build_result(
            radix=radix,
            kind=kind,
            when=when,
            binding_payload=binding_payload,
        )["chart"]

    def _step_binding(
        self,
        *,
        radix,
        feature_kind: str,
        when: datetime.datetime,
        direction: int,
        shift: bool,
        alt: bool,
        binding: supplementary_adapter.SupplementaryBinding,
        keycode: Optional[int] = None,
    ) -> tuple[datetime.datetime, dict[str, Any]]:
        """Run the extracted wx-free stepper for ``feature_kind`` and apply its
        StepPlan. There is one stepping brain: ``engine.cursor_steppers`` carries
        the verbatim wx unit/offset/snap maps; ``profectiontiming`` and
        ``chart.Time.step_datetime_fields`` carry the math. The daemon only folds
        the resulting plan onto the binding / source datetime.

        ``keycode`` distinguishes up/down from left/right (progressions step the
        signified datetime by YEAR on up/down vs MONTH on left/right; profections
        snap on up/down). REST callers that only do year/cycle steps pass a plain
        left/right keycode derived from ``direction``."""
        direction = 1 if int(direction) >= 0 else -1
        if keycode is None:
            keycode = cursor_steppers.KEY_RIGHT if direction >= 0 else cursor_steppers.KEY_LEFT
        retained = dict(binding.retained_state or {})

        if feature_kind == "harmonic":
            if shift or alt or keycode not in (cursor_steppers.KEY_LEFT, cursor_steppers.KEY_RIGHT):
                binding.retained_state = retained
                return when, binding.to_payload()
            mode = harmonic_chart.normalize_projection_mode(
                retained.get("projection_mode"),
                default=harmonic_chart.normalize_projection_mode(
                    getattr(radix.options, "harmonic_chart_mode", harmonic_chart.PROJECTION_MODE_HARMONIC)
                ),
            )
            retained["projection_mode"] = mode
            if mode == harmonic_chart.PROJECTION_MODE_VARGA:
                retained["varga_number"] = harmonic_chart.step_varga_number(
                    retained.get("varga_number", harmonic_chart.DEFAULT_VARGA), direction
                )
            else:
                current = harmonic_chart.normalize_harmonic_number(
                    retained.get("harmonic_number", harmonic_chart.DEFAULT_HARMONIC)
                )
                retained["harmonic_number"] = harmonic_chart.normalize_harmonic_number(
                    current + direction
                )
            binding.retained_state = retained
            return when, binding.to_payload()

        solar_return_snap = bool(getattr(radix.options, "profections_solar_return_snap", False))
        plan = cursor_steppers.plan_for_feature_kind(
            feature_kind,
            keycode,
            shift=shift,
            alt=alt,
            current_degree_offset=int(retained.get("solar_degree_offset", 0) or 0),
            solar_return_snap=solar_return_snap,
        )
        if plan is None:
            # No stepper meaning for this key+modifier (e.g. up/down on a return,
            # shift/alt on a lunar/planetary cycle — unmodelled in wx too). Leave
            # the binding untouched so the rebuild reproduces the same chart.
            binding.retained_state = retained
            return when, binding.to_payload()

        if plan.kind == "solar_offset":
            if (
                retained.get("solar_return_mode") == solilunar.RETURN_MODE_TITHI_PRAVESHA
                and plan.degree_delta != 0
            ):
                # Tithi Pravesha is anchored to the exact annual Solar Return;
                # shifted-degree stepping would change that anchor and cease to
                # be the requested annual soli-lunar return.
                binding.retained_state = retained
                return when, binding.to_payload()
            # Plain-arrow year step keeps the displayed-year re-anchoring against
            # parent-cursor drift (SolarReturnSupplementaryAdapter.build adds the
            # offset to the binding's year-mode anchor; base_year stamps the last
            # displayed year). Degree steps (shift/alt) add the carried
            # (year, degree) on top.
            if plan.degree_delta == 0:
                base_year = retained.get("base_year")
                anchor_year = self._solar_anchor_year(radix, when, retained)
                if base_year is not None and anchor_year is not None:
                    retained["solar_year_offset"] = int(base_year) + plan.year_delta - int(anchor_year)
                else:
                    retained["solar_year_offset"] = int(retained.get("solar_year_offset", 0) or 0) + plan.year_delta
            else:
                retained = cursor_steppers.apply_solar_offset(retained, plan)
        elif plan.kind == "cycle_offset":
            if feature_kind == "lunar_return":
                retained["lunar_cycle_offset"] = int(retained.get("lunar_cycle_offset", 0) or 0) + plan.delta
            else:
                step_anchor = retained.get("raw_return_datetime")
                if self._has_synodic_event(retained):
                    when = self._synodic_anchor_datetime(retained, when)
                    step_anchor = (
                        when.year, when.month, when.day,
                        when.hour, when.minute, when.second,
                    )
                    retained = self._clear_synodic_event(retained)
                    retained["cycle_offset"] = 0
                if step_anchor is not None:
                    retained["planetary_step_anchor_datetime"] = tuple(int(value) for value in step_anchor[:6])
                    retained["planetary_step_delta"] = int(plan.delta)
                retained["cycle_offset"] = int(retained.get("cycle_offset", 0) or 0) + plan.delta
        elif plan.kind == "synodic_event":
            if feature_kind != "planetary_return":
                binding.retained_state = retained
                return when, binding.to_payload()
            planet_type = retained.get("planet_type")
            if planet_type is None:
                binding.retained_state = retained
                return when, binding.to_payload()
            anchor_dt = self._synodic_anchor_datetime(retained, when)
            event = synodic_cycle.next_event(
                radix,
                int(planet_type),
                anchor_dt,
                plan.delta,
                getattr(getattr(radix, "options", None), "synodicmode", synodic_cycle.SYNODIC_MODE_ALL),
                getattr(getattr(radix, "options", None), "phasismode", phasiscalc.PHASIS_MODE_SIMPLE_SWEP),
            )
            if event is None:
                binding.retained_state = retained
                return when, binding.to_payload()
            calflag = synodic_cycle.calflag_for_chart(radix)
            event_tuple = event.datetime_tuple(calflag)
            when = datetime.datetime(*event_tuple)
            retained = self._clear_synodic_event(retained)
            retained["cycle_offset"] = 0
            retained["synodic_event_datetime"] = event_tuple
            retained["raw_synodic_datetime"] = event_tuple
            retained["synodic_event"] = event.to_payload(calflag)
        elif plan.kind == "converse_phase":
            if feature_kind != "converse_transits":
                binding.retained_state = retained
                return when, binding.to_payload()
            physical_dt = display_tuple_to_datetime(
                retained.get("physical_cursor_datetime")
            )
            if physical_dt is None:
                binding.retained_state = retained
                return when, binding.to_payload()
            physical_time = supplementary_adapter.retained_clock_time(
                retained,
                "physical",
                (
                    physical_dt.year,
                    physical_dt.month,
                    physical_dt.day,
                    physical_dt.hour,
                    physical_dt.minute,
                    physical_dt.second,
                ),
                fallback_place=getattr(radix, "place", None),
                fallback_time=getattr(radix, "time", None),
            )
            physical_place = supplementary_adapter.payload_to_place(
                retained.get("physical_place_payload"),
                fallback=getattr(radix, "place", None),
            )
            if physical_time is None or physical_place is None:
                binding.retained_state = retained
                return when, binding.to_payload()
            converse_enabled = bool(retained.get("converse_enabled", True))
            try:
                # A forward symbolic phase is backward only while the physical
                # chart is projected conversely. Direct mode follows it.
                next_physical_time = moonphasejump.jump_to_classical_phase(
                    physical_time,
                    physical_place,
                    -int(plan.delta) if converse_enabled else int(plan.delta),
                )
            except Exception:
                next_physical_time = None
            if next_physical_time is None:
                binding.retained_state = retained
                return when, binding.to_payload()
            symbolic_jd = (
                converse_transits.mirrored_jd(
                    getattr(getattr(radix, "time", None), "jd"),
                    next_physical_time.jd,
                )
                if converse_enabled
                else float(next_physical_time.jd)
            )
            symbolic_dt = supplementary_adapter.retained_clock_local_tuple_for_jd(
                retained,
                "symbolic",
                symbolic_jd,
                fallback_place=getattr(radix, "place", None),
                fallback_time=getattr(radix, "time", None),
            )
            when = datetime.datetime(*symbolic_dt)
            retained.update({
                "symbolic_cursor_datetime": tuple(symbolic_dt),
                "symbolic_cursor_jd": float(symbolic_jd),
                "physical_cursor_datetime": (
                    int(next_physical_time.origyear),
                    int(next_physical_time.origmonth),
                    int(next_physical_time.origday),
                    int(next_physical_time.hour),
                    int(next_physical_time.minute),
                    int(next_physical_time.second),
                ),
                "physical_cursor_jd": float(next_physical_time.jd),
            })
        elif plan.kind == "source_datetime":
            if feature_kind == "converse_transits":
                next_when = self._step_converse_source_datetime(
                    radix,
                    when,
                    plan.unit,
                    plan.delta,
                    retained,
                )
            else:
                next_when = cursor_steppers.step_source_datetime(
                    radix,
                    when,
                    plan.unit,
                    plan.delta,
                )
            if next_when is not None:
                when = next_when
                if feature_kind == "profections":
                    retained["_profections_snap_override"] = False
                elif feature_kind == "converse_transits":
                    # Civil-unit navigation changed the symbolic instant; the
                    # adapter now derives its exact JD from the stepped clock.
                    retained.pop("symbolic_cursor_datetime", None)
                    retained.pop("symbolic_cursor_jd", None)
        elif plan.kind == "source_snap":
            snapped = cursor_steppers.resolve_profection_snap_datetime(radix, when, plan)
            if snapped is not None:
                when = snapped
                if feature_kind == "profections" and plan.snap in ("adjacent_year", "adjacent_month"):
                    # wx _build_profections_stepper_*_target resolves the SR or
                    # monthly boundary first, then builds with snap_override=False;
                    # otherwise the adapter normalizes the cursor back to the
                    # completed solar return and month/day stepping appears stuck.
                    retained["_profections_snap_override"] = False

        binding.retained_state = retained
        return when, binding.to_payload()

    @staticmethod
    def _step_converse_source_datetime(
        radix,
        when: datetime.datetime,
        unit: str,
        delta: int,
        retained: dict[str, Any],
    ) -> Optional[datetime.datetime]:
        if unit not in ("week", "day", "hour", "minute", "second"):
            return None
        clock_time = supplementary_adapter.retained_clock_time(
            retained,
            "symbolic",
            (when.year, when.month, when.day, when.hour, when.minute, when.second),
            fallback_place=getattr(radix, "place", None),
            fallback_time=getattr(radix, "time", None),
        )
        place = supplementary_adapter.payload_to_place(
            retained.get("symbolic_place_payload"),
            fallback=getattr(radix, "place", None),
        )
        if clock_time is None or place is None:
            return None
        stepped = clock_time.step_datetime_fields(
            when.year,
            when.month,
            when.day,
            when.hour,
            when.minute,
            when.second,
            unit,
            int(delta),
            clock_time.bc,
            clock_time.cal,
            clock_time.zt,
            clock_time.plus,
            clock_time.zh,
            clock_time.zm,
            clock_time.daylightsaving,
            place,
            tzid=getattr(clock_time, "tzid", ""),
        )
        try:
            return datetime.datetime(*[int(value) for value in stepped["tuple"][:6]])
        except (TypeError, ValueError, OverflowError):
            return None

    @staticmethod
    def _has_synodic_event(retained: dict[str, Any]) -> bool:
        return any(
            key in retained
            for key in ("synodic_event_datetime", "raw_synodic_datetime", "synodic_event")
        )

    @staticmethod
    def _clear_synodic_event(retained: dict[str, Any]) -> dict[str, Any]:
        updated = dict(retained or {})
        for key in ("synodic_event_datetime", "raw_synodic_datetime", "synodic_event"):
            updated.pop(key, None)
        return updated

    @staticmethod
    def _synodic_anchor_datetime(retained: dict[str, Any], fallback: datetime.datetime) -> datetime.datetime:
        for key in ("synodic_event_datetime", "raw_synodic_datetime", "raw_return_datetime"):
            dt = display_tuple_to_datetime((retained or {}).get(key))
            if dt is not None:
                return dt
        return fallback

    def _solar_anchor_year(
        self,
        radix,
        when: datetime.datetime,
        retained: dict[str, Any],
    ) -> Optional[int]:
        mode = retained.get("solar_year_mode") or retained.get("year_mode") or "configured"
        if mode == "containing":
            return self._solar_containing_year(radix, when)
        driver = SupplementaryHeadlessDriver(getattr(radix, "options", chart_snapshot_service.options))
        driver.horoscope = radix
        try:
            return int(driver._get_configured_solar_return_year(reference_dt=when, radix=radix))
        except (AttributeError, TypeError, ValueError):
            return None

    def _solar_containing_year(
        self,
        radix,
        when: datetime.datetime,
    ) -> Optional[int]:
        """The solar-return year that *contains* ``when`` for this radix, via the
        adapter's own ``_containing_solar_return_year`` (no reimplementation — we
        reuse the engine deriver exactly as build does). Returns None on any
        failure so the caller falls back to the plain offset bump."""
        adapter = self._registry.adapter_for_feature_kind("solar_return")
        if adapter is None:
            return None
        driver = SupplementaryHeadlessDriver(radix.options)
        driver.horoscope = radix
        try:
            year = adapter._containing_solar_return_year(driver, radix, when)
        except Exception:
            return None
        return int(year) if year is not None else None

    @staticmethod
    def _apply_solar_average_window_intent(
        session: dict[str, Any],
        binding_payload: Optional[dict[str, Any]],
    ) -> None:
        """Thread the Solar Average window intent into the extracted rebuilder.

        The wx source stores the selected ending age on the workspace session as
        ``solar_average_max_birthday`` before calling
        ``_rebuild_workspace_solar_average_child`` (morin.py:10183,10275), and
        that rebuilder reads the same key (morin.py:6949-6951). The headless
        driver mirrors that rebuilder, so the daemon must translate the JSON
        Binding intent into the same session key instead of silently falling back
        to the default 84-year window.
        """
        if not isinstance(binding_payload, dict):
            return
        retained = binding_payload.get("retained_state")
        if not isinstance(retained, dict):
            return
        raw_value = retained.get("solar_average_max_birthday")
        if raw_value is None:
            raw_value = retained.get("max_birthday")
        if raw_value is None:
            return
        try:
            max_birthday = int(raw_value)
        except (TypeError, ValueError):
            return
        if max_birthday < 0:
            max_birthday = 0
        session["solar_average_max_birthday"] = max_birthday


supplementary_service = SupplementaryService()
