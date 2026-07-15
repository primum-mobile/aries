# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Solar synodic-cycle event finder for planetary-return stepping.

The planetary-return chart remains the normal return-to-natal-longitude mode.
This module supplies the separate Sun-planet cycle points used when a return
document is stepped with Shift+Arrow: stations, greatest elongations, heliacal
first/last visibility, Sun conjunctions, and outer-planet oppositions.

Visibility uses the same phasis-mode threshold source as heliacal search:
Hellenistic mode uses the 15-degree rule, while the arcus-visionis path reads
``phasiscalc.arcus_visionis_deg``.
"""
from __future__ import annotations

import datetime
import math
from dataclasses import dataclass
from typing import Iterable, Optional

import astrology
import chart
import phasiscalc
import revolutions


INNER_PLANETS = frozenset((astrology.SE_MERCURY, astrology.SE_VENUS))

SYNODIC_MODE_STATION_CAZIMI = 0
SYNODIC_MODE_ALL = 1

_FLAGS = astrology.SEFLG_SWIEPH | astrology.SEFLG_SPEED
_ROOT_TOLERANCE_DAYS = 1.0 / 86400.0

_STATION_CAZIMI_CODES = frozenset((
    "station_retrograde",
    "station_direct",
    "inferior_conjunction",
    "superior_conjunction",
    "solar_conjunction",
))

_SEARCH_DAYS = {
    astrology.SE_MERCURY: 140,
    astrology.SE_VENUS: 620,
    astrology.SE_MARS: 830,
    astrology.SE_JUPITER: 430,
    astrology.SE_SATURN: 410,
    astrology.SE_URANUS: 380,
    astrology.SE_NEPTUNE: 375,
    astrology.SE_PLUTO: 375,
}

_PLANET_NAMES = {
    astrology.SE_MERCURY: "Mercury",
    astrology.SE_VENUS: "Venus",
    astrology.SE_MARS: "Mars",
    astrology.SE_JUPITER: "Jupiter",
    astrology.SE_SATURN: "Saturn",
    astrology.SE_URANUS: "Uranus",
    astrology.SE_NEPTUNE: "Neptune",
    astrology.SE_PLUTO: "Pluto",
}


@dataclass(frozen=True)
class SynodicEvent:
    planet_type: int
    planet_id: int
    code: str
    label: str
    jd_ut: float
    signed_elongation: float
    solar_phase: str = ""
    motion: str = ""
    visibility_threshold_deg: Optional[float] = None
    visibility_method_label: str = ""

    def datetime_tuple(self, calflag: int) -> tuple[int, int, int, int, int, int]:
        return jd_to_datetime_tuple(self.jd_ut, calflag)

    def to_payload(self, calflag: int) -> dict:
        return {
            "planet_type": int(self.planet_type),
            "planet_id": int(self.planet_id),
            "code": self.code,
            "label": self.label,
            "jd_ut": float(self.jd_ut),
            "datetime": self.datetime_tuple(calflag),
            "signed_elongation": float(self.signed_elongation),
            "solar_phase": self.solar_phase,
            "motion": self.motion,
            "visibility_threshold_deg": self.visibility_threshold_deg,
            "visibility_method_label": self.visibility_method_label,
        }


def calflag_for_chart(radix) -> int:
    if getattr(getattr(radix, "time", None), "cal", chart.Time.GREGORIAN) == chart.Time.JULIAN:
        return astrology.SE_JUL_CAL
    return astrology.SE_GREG_CAL


def datetime_to_jd(radix, value: datetime.datetime) -> float:
    calflag = calflag_for_chart(radix)
    hour = (
        int(value.hour)
        + int(value.minute) / 60.0
        + int(value.second) / 3600.0
    )
    return float(astrology.swe_julday(int(value.year), int(value.month), int(value.day), hour, calflag))


def jd_to_datetime_tuple(jd_ut: float, calflag: int) -> tuple[int, int, int, int, int, int]:
    year, month, day, hour = astrology.swe_revjul(float(jd_ut), int(calflag))
    total_seconds = int(round(float(hour) * 3600.0))
    while total_seconds >= 86400:
        total_seconds -= 86400
        year, month, day = _incr_day(int(year), int(month), int(day), int(calflag))
    while total_seconds < 0:
        total_seconds += 86400
        year, month, day = _decr_day(int(year), int(month), int(day), int(calflag))
    hh = total_seconds // 3600
    mm = (total_seconds % 3600) // 60
    ss = total_seconds % 60
    return int(year), int(month), int(day), int(hh), int(mm), int(ss)


def search_days_for_planet(planet_id: int) -> int:
    return int(_SEARCH_DAYS.get(int(planet_id), 430))


def arcus_visionis_deg(planet_id: int) -> Optional[float]:
    return phasiscalc.arcus_visionis_deg(int(planet_id))


def visibility_threshold_deg(planet_id: int, phasis_mode=None) -> Optional[float]:
    mode = getattr(phasiscalc, "_normalize_phasis_mode", lambda value: value)(phasis_mode)
    if mode == phasiscalc.PHASIS_MODE_HELLENISTIC:
        return float(phasiscalc.PHASIS_CLASSICAL_ELONGATION_DEG)
    return arcus_visionis_deg(int(planet_id))


def visibility_method_label(phasis_mode=None) -> str:
    mode = getattr(phasiscalc, "_normalize_phasis_mode", lambda value: value)(phasis_mode)
    if mode == phasiscalc.PHASIS_MODE_HELLENISTIC:
        return "Hellenistic 15 deg elongation"
    return "Arcus visionis"


def normalize_mode(value) -> int:
    try:
        mode = int(value)
    except (TypeError, ValueError):
        return SYNODIC_MODE_ALL
    if mode == SYNODIC_MODE_STATION_CAZIMI:
        return SYNODIC_MODE_STATION_CAZIMI
    return SYNODIC_MODE_ALL


def event_codes_for_mode(value) -> Optional[frozenset[str]]:
    mode = normalize_mode(value)
    if mode == SYNODIC_MODE_STATION_CAZIMI:
        return _STATION_CAZIMI_CODES
    return None


def events_around(
    radix,
    planet_type: int,
    start_dt: datetime.datetime,
    end_dt: datetime.datetime,
    event_mode: int = SYNODIC_MODE_ALL,
    phasis_mode=None,
) -> list[SynodicEvent]:
    """Return synodic events in ``[start_dt, end_dt]`` sorted by exact JD."""
    pid = revolutions.Revolutions.planetary_pid(int(planet_type))
    if pid is None:
        return []
    if phasis_mode is None:
        phasis_mode = getattr(getattr(radix, "options", None), "phasismode", phasiscalc.PHASIS_MODE_ASTRONOMICAL)
    start_jd = datetime_to_jd(radix, start_dt)
    end_jd = datetime_to_jd(radix, end_dt)
    if end_jd < start_jd:
        start_jd, end_jd = end_jd, start_jd
    events = []
    events.extend(_station_events(int(planet_type), pid, start_jd, end_jd))
    events.extend(_conjunction_events(int(planet_type), pid, start_jd, end_jd))
    events.extend(_elongation_events(int(planet_type), pid, start_jd, end_jd))
    events.extend(_visibility_events(int(planet_type), pid, start_jd, end_jd, phasis_mode=phasis_mode))
    events = _dedupe_events(events)
    codes = event_codes_for_mode(event_mode)
    if codes is not None:
        events = [event for event in events if event.code in codes]
    return events


def next_event(
    radix,
    planet_type: int,
    anchor_dt: datetime.datetime,
    direction: int,
    event_mode: int = SYNODIC_MODE_ALL,
    phasis_mode=None,
) -> Optional[SynodicEvent]:
    """Find the nearest synodic event after/before ``anchor_dt``."""
    pid = revolutions.Revolutions.planetary_pid(int(planet_type))
    if pid is None:
        return None
    days = search_days_for_planet(pid)
    direction = 1 if int(direction) >= 0 else -1
    if direction > 0:
        start_dt = anchor_dt + datetime.timedelta(minutes=1)
        end_dt = anchor_dt + datetime.timedelta(days=days)
        candidates = events_around(radix, planet_type, start_dt, end_dt, event_mode, phasis_mode=phasis_mode)
        return candidates[0] if candidates else None
    start_dt = anchor_dt - datetime.timedelta(days=days)
    end_dt = anchor_dt - datetime.timedelta(minutes=1)
    candidates = events_around(radix, planet_type, start_dt, end_dt, event_mode, phasis_mode=phasis_mode)
    return candidates[-1] if candidates else None


def _body_state(jd_ut: float, planet_id: int):
    _retflag, xx, _serr = astrology.swe_calc_ut_ex(float(jd_ut), int(planet_id), _FLAGS)
    return xx


def _longitude(jd_ut: float, planet_id: int) -> float:
    return float(_body_state(jd_ut, planet_id)[0])


def _speed(jd_ut: float, planet_id: int) -> float:
    return float(_body_state(jd_ut, planet_id)[3])


def _signed_elongation(jd_ut: float, planet_id: int) -> float:
    sun_lon = _longitude(jd_ut, astrology.SE_SUN)
    pl_lon = _longitude(jd_ut, planet_id)
    return ((pl_lon - sun_lon + 180.0) % 360.0) - 180.0


def _safe_signed_elongation(jd_ut: float, planet_id: int) -> Optional[float]:
    try:
        return _signed_elongation(jd_ut, planet_id)
    except Exception:
        return None


def _bisect_root(fn, left: float, right: float) -> Optional[float]:
    fl = fn(left)
    fr = fn(right)
    if fl is None or fr is None:
        return None
    if abs(fl) < 1e-12:
        return float(left)
    if abs(fr) < 1e-12:
        return float(right)
    if fl * fr > 0.0:
        return None
    lo, hi = (float(left), float(right)) if left <= right else (float(right), float(left))
    flo = fn(lo)
    for _ in range(80):
        mid = 0.5 * (lo + hi)
        if hi - lo <= _ROOT_TOLERANCE_DAYS:
            return mid
        fm = fn(mid)
        if fm is None:
            return None
        if abs(fm) < 1e-12:
            return mid
        if flo * fm <= 0.0:
            hi = mid
        else:
            lo = mid
            flo = fm
    return 0.5 * (lo + hi)


def _scan_pairs(start_jd: float, end_jd: float, step_days: float = 1.0) -> Iterable[tuple[float, float]]:
    t0 = float(start_jd)
    end = float(end_jd)
    step = abs(float(step_days)) or 1.0
    while t0 < end:
        t1 = min(t0 + step, end)
        yield t0, t1
        t0 = t1


def _station_events(planet_type: int, pid: int, start_jd: float, end_jd: float) -> list[SynodicEvent]:
    events = []
    prev_jd = None
    prev_speed = None
    for left, right in _scan_pairs(start_jd, end_jd, 0.5):
        if prev_jd is None:
            prev_jd = left
            try:
                prev_speed = _speed(prev_jd, pid)
            except Exception:
                prev_speed = None
        try:
            cur_speed = _speed(right, pid)
        except Exception:
            cur_speed = None
        if prev_speed is not None and cur_speed is not None and prev_speed * cur_speed <= 0.0:
            root = _bisect_root(lambda jd: _speed(jd, pid), prev_jd, right)
            if root is not None:
                before = _speed(root - 0.05, pid)
                after = _speed(root + 0.05, pid)
                if before > 0.0 and after < 0.0:
                    events.append(_event(planet_type, pid, "station_retrograde", root, motion="station_retrograde"))
                elif before < 0.0 and after > 0.0:
                    events.append(_event(planet_type, pid, "station_direct", root, motion="station_direct"))
        prev_jd = right
        prev_speed = cur_speed
    return events


def _conjunction_events(planet_type: int, pid: int, start_jd: float, end_jd: float) -> list[SynodicEvent]:
    events = []
    prev_jd = None
    prev_delta = None
    for left, right in _scan_pairs(start_jd, end_jd, 1.0):
        if prev_jd is None:
            prev_jd = left
            prev_delta = _safe_signed_elongation(prev_jd, pid)
        cur_delta = _safe_signed_elongation(right, pid)
        if (
            prev_delta is not None
            and cur_delta is not None
            and abs(cur_delta - prev_delta) < 180.0
            and prev_delta * cur_delta <= 0.0
        ):
            root = _bisect_root(lambda jd: _signed_elongation(jd, pid), prev_jd, right)
            if root is not None:
                speed = _speed(root, pid)
                if pid in INNER_PLANETS:
                    code = "inferior_conjunction" if speed < 0.0 else "superior_conjunction"
                    solar_phase = "inferior" if speed < 0.0 else "superior"
                else:
                    code = "solar_conjunction"
                    solar_phase = "conjunction"
                events.append(_event(planet_type, pid, code, root, solar_phase=solar_phase))
        if pid not in INNER_PLANETS:
            opp_root = _opposition_root(prev_jd, right, pid, prev_delta, cur_delta)
            if opp_root is not None:
                events.append(_event(planet_type, pid, "opposition", opp_root, solar_phase="opposition"))
        prev_jd = right
        prev_delta = cur_delta
    return events


def _opposition_root(left: float, right: float, pid: int, prev_delta, cur_delta) -> Optional[float]:
    if prev_delta is None or cur_delta is None:
        return None
    # Use sin(delta) for roots at 0/180, then keep only the anti-solar root.
    def f(jd):
        delta = _signed_elongation(jd, pid)
        return math.sin(math.radians(delta))

    f0 = math.sin(math.radians(prev_delta))
    f1 = math.sin(math.radians(cur_delta))
    if f0 * f1 > 0.0:
        return None
    root = _bisect_root(f, left, right)
    if root is None:
        return None
    if math.cos(math.radians(_signed_elongation(root, pid))) < 0.0:
        return root
    return None


def _elongation_events(planet_type: int, pid: int, start_jd: float, end_jd: float) -> list[SynodicEvent]:
    if pid not in INNER_PLANETS:
        return []
    samples = []
    t = float(start_jd)
    while t <= end_jd + 1e-9:
        val = _safe_signed_elongation(t, pid)
        if val is not None:
            samples.append((t, val))
        t += 1.0
    events = []
    for idx in range(1, len(samples) - 1):
        left_t, left_v = samples[idx - 1]
        mid_t, mid_v = samples[idx]
        right_t, right_v = samples[idx + 1]
        if mid_v > 0.0 and left_v < mid_v and right_v < mid_v:
            root = _maximize_signed_elongation(left_t, right_t, pid, sign=1.0)
            events.append(_event(planet_type, pid, "greatest_eastern_elongation", root, solar_phase="east"))
        elif mid_v < 0.0 and left_v > mid_v and right_v > mid_v:
            root = _maximize_signed_elongation(left_t, right_t, pid, sign=-1.0)
            events.append(_event(planet_type, pid, "greatest_western_elongation", root, solar_phase="west"))
    return events


def _maximize_signed_elongation(left: float, right: float, pid: int, *, sign: float) -> float:
    lo = float(left)
    hi = float(right)
    gr = (math.sqrt(5.0) - 1.0) / 2.0

    def score(jd):
        return sign * _signed_elongation(jd, pid)

    c = hi - gr * (hi - lo)
    d = lo + gr * (hi - lo)
    fc = score(c)
    fd = score(d)
    while hi - lo > _ROOT_TOLERANCE_DAYS:
        if fc < fd:
            lo = c
            c = d
            fc = fd
            d = lo + gr * (hi - lo)
            fd = score(d)
        else:
            hi = d
            d = c
            fd = fc
            c = hi - gr * (hi - lo)
            fc = score(c)
    return 0.5 * (lo + hi)


def _visibility_events(planet_type: int, pid: int, start_jd: float, end_jd: float, *, phasis_mode=None) -> list[SynodicEvent]:
    threshold = visibility_threshold_deg(pid, phasis_mode)
    if threshold is None:
        return []
    events = []
    prev_jd = None
    prev_signed = None
    for left, right in _scan_pairs(start_jd, end_jd, 1.0):
        if prev_jd is None:
            prev_jd = left
            prev_signed = _safe_signed_elongation(prev_jd, pid)
        cur_signed = _safe_signed_elongation(right, pid)
        if prev_signed is None or cur_signed is None or abs(cur_signed - prev_signed) >= 180.0:
            prev_jd = right
            prev_signed = cur_signed
            continue

        # Evening visibility: planet east of Sun, signed elongation >= +AV.
        prev_e = prev_signed - threshold
        cur_e = cur_signed - threshold
        if prev_e < 0.0 <= cur_e:
                root = _bisect_root(lambda jd: _signed_elongation(jd, pid) - threshold, prev_jd, right)
                if root is not None:
                    events.append(_event(
                        planet_type, pid, "evening_first_visibility", root,
                        solar_phase="evening",
                        visibility_threshold_deg=threshold,
                        visibility_method_label=visibility_method_label(phasis_mode),
                    ))
        elif prev_e >= 0.0 > cur_e:
            root = _bisect_root(lambda jd: _signed_elongation(jd, pid) - threshold, prev_jd, right)
            if root is not None:
                events.append(_event(
                    planet_type, pid, "evening_last_visibility", root,
                    solar_phase="evening",
                    visibility_threshold_deg=threshold,
                    visibility_method_label=visibility_method_label(phasis_mode),
                ))

        # Morning visibility: planet west of Sun, signed elongation <= -AV.
        prev_m = prev_signed + threshold
        cur_m = cur_signed + threshold
        if prev_m > 0.0 >= cur_m:
                root = _bisect_root(lambda jd: _signed_elongation(jd, pid) + threshold, prev_jd, right)
                if root is not None:
                    events.append(_event(
                        planet_type, pid, "morning_first_visibility", root,
                        solar_phase="morning",
                        visibility_threshold_deg=threshold,
                        visibility_method_label=visibility_method_label(phasis_mode),
                    ))
        elif prev_m <= 0.0 < cur_m:
            root = _bisect_root(lambda jd: _signed_elongation(jd, pid) + threshold, prev_jd, right)
            if root is not None:
                events.append(_event(
                    planet_type, pid, "morning_last_visibility", root,
                    solar_phase="morning",
                    visibility_threshold_deg=threshold,
                    visibility_method_label=visibility_method_label(phasis_mode),
                ))

        prev_jd = right
        prev_signed = cur_signed
    return events


def _event(
    planet_type: int,
    pid: int,
    code: str,
    jd_ut: float,
    *,
    solar_phase: str = "",
    motion: str = "",
    visibility_threshold_deg: Optional[float] = None,
    visibility_method_label: str = "",
) -> SynodicEvent:
    return SynodicEvent(
        planet_type=int(planet_type),
        planet_id=int(pid),
        code=code,
        label=_event_label(pid, code),
        jd_ut=float(jd_ut),
        signed_elongation=float(_signed_elongation(jd_ut, pid)),
        solar_phase=solar_phase,
        motion=motion,
        visibility_threshold_deg=float(visibility_threshold_deg) if visibility_threshold_deg is not None else None,
        visibility_method_label=str(visibility_method_label or ""),
    )


def _event_label(pid: int, code: str) -> str:
    name = _PLANET_NAMES.get(int(pid), "Planet")
    labels = {
        "station_retrograde": "%s station retrograde" % name,
        "station_direct": "%s station direct" % name,
        "inferior_conjunction": "%s conjunct Sun (inferior)" % name,
        "superior_conjunction": "%s conjunct Sun (superior)" % name,
        "solar_conjunction": "%s conjunct Sun" % name,
        "opposition": "%s opposite Sun" % name,
        "greatest_eastern_elongation": "%s greatest elongation (east evening)" % name,
        "greatest_western_elongation": "%s greatest elongation (west morning)" % name,
        "evening_first_visibility": "%s evening rise (first visibility)" % name,
        "evening_last_visibility": "%s evening setting (last visibility)" % name,
        "morning_first_visibility": "%s morning rise (first visibility)" % name,
        "morning_last_visibility": "%s morning setting (last visibility)" % name,
    }
    return labels.get(code, "%s synodic event" % name)


def _dedupe_events(events: Iterable[SynodicEvent]) -> list[SynodicEvent]:
    ordered = sorted(events, key=lambda event: (event.jd_ut, event.code))
    out: list[SynodicEvent] = []
    seen: set[tuple[str, int]] = set()
    for event in ordered:
        key = (event.code, int(round(event.jd_ut * 86400.0)))
        if key in seen:
            continue
        seen.add(key)
        out.append(event)
    return out


def _incr_day(year: int, month: int, day: int, calflag: int) -> tuple[int, int, int]:
    jd = astrology.swe_julday(int(year), int(month), int(day), 12.0, int(calflag)) + 1.0
    y, m, d, _ = astrology.swe_revjul(jd, int(calflag))
    return int(y), int(m), int(d)


def _decr_day(year: int, month: int, day: int, calflag: int) -> tuple[int, int, int]:
    jd = astrology.swe_julday(int(year), int(month), int(day), 12.0, int(calflag)) - 1.0
    y, m, d, _ = astrology.swe_revjul(jd, int(calflag))
    return int(y), int(m), int(d)
