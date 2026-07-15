"""Wx-free cursor-stepper objects extracted from the wx supplementary dialogs.

These objects carry the *unit map* and *offset/snap math* that the wx steppers
(`StepperDlg`, `ProfectionStepperDlg`, `RevolutionYearStepper`) entangle with
their accelerator tables and EVT_CHAR_HOOK glue. They decide, for a given arrow
key + modifiers, what the next binding/source mutation must be — and nothing
about wx, sizers, or chart construction. Both the wx dialogs and the FastAPI
daemon import these and run them so there is exactly one stepping brain.

WHY a plan object instead of building the chart here: the derived chart is
already deterministic from (Binding + source datetime) via
``engine.supplementary_adapter``. The wx dialog steps the SIGNIFIED datetime
(progressions/profections) or bumps the year/degree/cycle offset (returns), then
hands that to the adapter. So these objects emit a ``StepPlan`` describing the
mutation; the caller (wx ``_on_step`` / daemon ``_step_binding``) applies it and
rebuilds through the one adapter path. No second deriver.

Keycodes are plain integers equal to ``wx.WXK_LEFT/RIGHT/UP/DOWN`` (314/316/
315/317) so this module never imports wx; ``chart_session._KEYS`` already pins
the same integers (chart_session.py:51-54).
"""
from __future__ import annotations

import datetime
from dataclasses import dataclass
from typing import Any, Optional

import chart
import profectiontiming


# wx.WXK_* integer equivalents (chart_session.py:51-54). Kept as bare ints so
# this module stays wx-free and importable in the daemon.
KEY_LEFT = 314
KEY_RIGHT = 316
KEY_UP = 315
KEY_DOWN = 317


# StepPlan.kind values:
#   "source_datetime" -> shift the binding's source (= signified) datetime by
#                        (unit, delta). The progression/profection adapters read
#                        source_datetime, so this is the whole mutation.
#   "source_snap"     -> snap the source datetime to a profection boundary
#                        (continuous vs quantized) or an adjacent solar-return /
#                        monthly-profection boundary; the engine helper named in
#                        ``snap`` decides the target.
#   "solar_offset"    -> bump solar_year_offset / solar_degree_offset (returns).
#   "cycle_offset"    -> bump the lunar/planetary cycle offset by delta.
#   "synodic_event"   -> jump a planetary-return document to the next/previous
#                        Sun-planet cycle event (Shift+Left/Right).
@dataclass(frozen=True)
class StepPlan:
    kind: str
    unit: Optional[str] = None
    delta: int = 0
    # source_snap descriptors
    snap: Optional[str] = None          # 'continuous' | 'quantized' | 'adjacent_year' | 'adjacent_month'
    # solar_offset descriptors
    year_delta: int = 0
    degree_delta: int = 0


class ProgressionStepper:
    """Extracted from ``StepperDlg.handle_navigation_key`` (stepperdlg.py:315)
    and ``_shift_signified_datetime`` (stepperdlg.py:158).

    Unit map (stepperdlg.py:331-345):
        up/down   -> year   (steps the SIGNIFIED datetime by a calendar year)
        left/right-> month
        shift+L/R -> week
        alt+L/R   -> day

    Every press shifts the SIGNIFIED datetime (the real calendar date the native
    lives through = radix + N years), NEVER the progressed-ephemeris *source*
    datetime. The symbolic age — and from it the tiny source-ephemeris step
    (~1 day per signified year for secondary; ~27 for minor; ~13 for tertiary;
    solar-arc's uniform arc) — is derived from the shifted signified datetime by
    the adapter, NOT here: the progression adapters feed the stepped
    source_datetime into ``symbolic_time`` then
    ``posfordate.make_progressed_chart_by_symbolic_age``. Solar Arc has its own
    adapter, but follows the same cursor rule: use the real date only to find
    the progressed-Sun arc, then uniformly offset the natal chart. In the
    adapter's Binding -> Deriver contract the ``source_datetime`` field carries
    the SIGNIFIED datetime for progressions; the symbolic-to-ephemeris rate math
    lives entirely in ``symbolic_time``/``posfordate``. So this stepper must
    emit the calendar shift of the signified datetime (year/month/week/day) and
    nothing else — emitting a literal source-ephemeris delta here would bypass the
    symbolic mapping and break the rate (the regression
    tests/test_progression_symbolic_step.py guards). The hand-rolled bisection in
    stepperdlg.py:99-156 only existed because the wx dialog also tracked a numeric
    age display; the adapter path needs none of it.
    """

    def plan(self, keycode, *, shift=False, alt=False) -> Optional[StepPlan]:
        if keycode in (KEY_UP, KEY_DOWN):
            delta = 1 if keycode == KEY_UP else -1
            return StepPlan(kind="source_datetime", unit="year", delta=delta)
        if keycode in (KEY_LEFT, KEY_RIGHT):
            delta = -1 if keycode == KEY_LEFT else 1
            if alt:
                unit = "day"
            elif shift:
                unit = "week"
            else:
                unit = "month"
            return StepPlan(kind="source_datetime", unit=unit, delta=delta)
        return None


class ProfectionStepper:
    """Extracted from ``ProfectionStepperDlg.handle_navigation_key``
    (profectionstepperdlg.py:198) plus its snap shortcuts (onContinuousShortcut
    / onQuantizedShortcut, :314/317).

    Unit map (profectionstepperdlg.py:239-257):
        left/right-> year   (source_dt.year +/- 1, or adjacent solar-return snap)
        shift+L/R -> month  (source_dt month +/- 1, or adjacent monthly snap)
        alt+L/R   -> day    (source_dt day +/- 1)
        up        -> continuous source-snap to the completed solar return
        down      -> quantized source-snap (same target; the snap_override path)

    With the ``profections_solar_return_snap`` option ON, the year/month deltas
    snap to ``profectiontiming.adjacent_solar_return_datetime`` /
    ``adjacent_monthly_profection_datetime`` instead of plain calendar steps
    (morin.py:7066-7100). The caller passes that flag in so this object owns the
    unit decision but the engine owns the snap math.
    """

    def plan(self, keycode, *, shift=False, alt=False, solar_return_snap=False) -> Optional[StepPlan]:
        if keycode == KEY_UP:
            return StepPlan(kind="source_snap", snap="continuous")
        if keycode == KEY_DOWN:
            return StepPlan(kind="source_snap", snap="quantized")
        if keycode in (KEY_LEFT, KEY_RIGHT):
            delta = -1 if keycode == KEY_LEFT else 1
            if alt:
                return StepPlan(kind="source_datetime", unit="day", delta=delta)
            if shift:
                if solar_return_snap:
                    return StepPlan(kind="source_snap", snap="adjacent_month", delta=delta)
                return StepPlan(kind="source_datetime", unit="month", delta=delta)
            if solar_return_snap:
                return StepPlan(kind="source_snap", snap="adjacent_year", delta=delta)
            return StepPlan(kind="source_datetime", unit="year", delta=delta)
        return None


class SolarRevolutionStepper:
    """Extracted from ``RevolutionYearStepper.handle_navigation_key``
    (revolutionsdlg.py:243) + the solar-longitude callbacks bound in
    ``morin._install_workspace_solar_revolution_stepper``
    (``_step_rev_solar_longitude``, morin.py:12754-12784).

    Unit map (revolutionsdlg.py:249-264 + morin.py:12687-12690/12795-12798):
        left/right-> year    (solar_year_offset +/- 1)
        shift+L/R -> +/-30 deg solar longitude
        alt+L/R   -> +/-1  deg solar longitude

    Degree stepping carries into years at the 360-degree boundary exactly as the
    wx callback does (morin.py:12761-12766): while degree_offset < 0 add 360 and
    borrow a year; while >= 360 subtract 360 and carry a year. The adapter does
    NOT carry degrees into years (supplementary_adapter.py:332-336), so this
    object emits the carried (year_delta, degree_delta) pair and the caller folds
    it onto solar_year_offset / solar_degree_offset.
    """

    def plan(self, keycode, *, shift=False, alt=False, current_degree_offset=0) -> Optional[StepPlan]:
        if keycode in (KEY_LEFT, KEY_RIGHT):
            direction = -1 if keycode == KEY_LEFT else 1
            if alt:
                return self._degree_plan(current_degree_offset, direction * 1)
            if shift:
                return self._degree_plan(current_degree_offset, direction * 30)
            return StepPlan(kind="solar_offset", year_delta=direction, degree_delta=0)
        return None

    @staticmethod
    def _degree_plan(current_degree_offset, delta_degrees) -> StepPlan:
        target_year_carry = 0
        target_degree = int(current_degree_offset) + int(delta_degrees)
        while target_degree < 0:
            target_degree += 360
            target_year_carry -= 1
        while target_degree >= 360:
            target_degree -= 360
            target_year_carry += 1
        return StepPlan(
            kind="solar_offset",
            year_delta=target_year_carry,
            # degree_delta carries the NEW absolute degree offset (after carry),
            # not a relative delta, because the carry resets the within-year
            # remainder. The caller assigns it directly to solar_degree_offset.
            degree_delta=int(target_degree) - int(current_degree_offset),
        )


class CycleRevolutionStepper:
    """Extracted from ``RevolutionMonthStepper`` (lunar) /
    ``RevolutionCallbackStepperController`` (planetary) in revolutionsdlg.py.

    Unit map (revolutionsdlg.py:57-66 / :105-114):
        left/right -> cycle_offset +/- 1

    Planetary returns now extend the old wx controller with Shift+Left/Right:
    step through the planet's Sun synodic-cycle events. Lunar returns still keep
    the wx no-op behaviour for modifiers.
    """

    def plan(self, keycode, *, shift=False, alt=False, allow_synodic=False) -> Optional[StepPlan]:
        if alt:
            return None
        if keycode in (KEY_LEFT, KEY_RIGHT):
            direction = -1 if keycode == KEY_LEFT else 1
            if shift:
                if allow_synodic:
                    return StepPlan(kind="synodic_event", delta=direction)
                return None
            return StepPlan(kind="cycle_offset", delta=direction)
        return None


# -- feature-kind dispatch (the single stepping brain selector) -------------

_PROGRESSION_KINDS = frozenset({"secondary", "solar_arc", "minor", "tertiary"})

_progression_stepper = ProgressionStepper()
_profection_stepper = ProfectionStepper()
_solar_stepper = SolarRevolutionStepper()
_cycle_stepper = CycleRevolutionStepper()


def plan_for_feature_kind(
    feature_kind: str,
    keycode: int,
    *,
    shift: bool = False,
    alt: bool = False,
    current_degree_offset: int = 0,
    solar_return_snap: bool = False,
) -> Optional[StepPlan]:
    """Pick the extracted stepper for ``feature_kind`` and emit its StepPlan.

    This is the wx-free analogue of ``morin`` choosing which ``StepperDlg`` to
    install as ``cs._stepper`` (morin.py:6792/7134/12704). One brain, dispatched
    by kind."""
    if feature_kind in _PROGRESSION_KINDS:
        return _progression_stepper.plan(keycode, shift=shift, alt=alt)
    if feature_kind == "profections":
        return _profection_stepper.plan(
            keycode, shift=shift, alt=alt, solar_return_snap=solar_return_snap
        )
    if feature_kind == "solar_return":
        return _solar_stepper.plan(
            keycode, shift=shift, alt=alt, current_degree_offset=current_degree_offset
        )
    if feature_kind == "lunar_return":
        return _cycle_stepper.plan(keycode, shift=shift, alt=alt)
    if feature_kind == "planetary_return":
        return _cycle_stepper.plan(keycode, shift=shift, alt=alt, allow_synodic=True)
    return None


def _radix_calflag(radix) -> int:
    import astrology
    cal = getattr(getattr(radix, "time", None), "cal", chart.Time.GREGORIAN)
    if cal == chart.Time.JULIAN:
        return astrology.SE_JUL_CAL
    return astrology.SE_GREG_CAL


def step_source_datetime(radix, when: datetime.datetime, unit: str, delta: int) -> Optional[datetime.datetime]:
    """Shift a source/signified datetime by (unit, delta) via the ONE engine
    calendar stepper, ``chart.Time.step_datetime_fields`` (chart.py:186).

    Supports year/month/week/day/hour/minute/second — the same fields the wx
    ``StepperDlg._shift_signified_datetime`` (stepperdlg.py:158) reimplemented by
    hand. We do not reimplement it; ``_calendar_shift_fields`` (chart.py:71) is
    the source of truth for year/month carry and month-length clamping."""
    if radix is None or getattr(radix, "time", None) is None:
        return None
    if unit not in ("year", "month", "week", "day", "hour", "minute", "second"):
        return None
    t = radix.time
    step_info = chart.Time.step_datetime_fields(
        when.year, when.month, when.day, when.hour, when.minute, when.second,
        unit, int(delta),
        t.bc, t.cal, t.zt, t.plus, t.zh, t.zm, t.daylightsaving,
        radix.place, tzid=getattr(t, "tzid", ""),
    )
    y, m, d, h, mi, s = step_info["tuple"]
    try:
        return datetime.datetime(int(y), int(m), int(d), int(h), int(mi), int(s))
    except (ValueError, OverflowError):
        return None


def resolve_profection_snap_datetime(
    radix, when: datetime.datetime, plan: StepPlan
) -> Optional[datetime.datetime]:
    """Map a profection ``source_snap`` StepPlan to a concrete source datetime
    via the wx-free ``profectiontiming`` helpers (no reimplementation).

    continuous / quantized -> snap the cursor to the completed solar return
        boundary (profectiontiming.completed_solar_return_datetime). The wx
        dialog distinguishes them through ``snap_override`` into
        ``_build_profections_chart`` (morin.py:6985), but both resolve to the
        completed-SR snap; the build flag only governs which chart object is
        shown, not a different source datetime.
    adjacent_year  -> profectiontiming.adjacent_solar_return_datetime (snap mode)
    adjacent_month -> profectiontiming.adjacent_monthly_profection_datetime
    """
    if plan.snap in ("continuous", "quantized"):
        return profectiontiming.completed_solar_return_datetime(radix, when)
    if plan.snap == "adjacent_year":
        return profectiontiming.adjacent_solar_return_datetime(radix, when, plan.delta)
    if plan.snap == "adjacent_month":
        return profectiontiming.adjacent_monthly_profection_datetime(radix, when, plan.delta)
    return None


def apply_solar_offset(retained: dict[str, Any], plan: StepPlan) -> dict[str, Any]:
    """Fold a solar-return StepPlan onto solar_year_offset / solar_degree_offset.

    Mirrors ``morin._step_rev_solar_longitude`` (morin.py:12754-12784): a plain
    arrow bumps the year offset; shift/alt change the degree offset and may carry
    a year at the 360-degree boundary (the carry is already computed in
    ``SolarRevolutionStepper._degree_plan``)."""
    updated = dict(retained or {})
    updated["solar_year_offset"] = int(updated.get("solar_year_offset", 0) or 0) + int(plan.year_delta)
    updated["solar_degree_offset"] = int(updated.get("solar_degree_offset", 0) or 0) + int(plan.degree_delta)
    return updated
