# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Time-dependent longitude evaluators for semantic aspect-list points.

Applying/separating is a property of a relationship: the absolute error from
the selected exact aspect is either shrinking or growing.  This module keeps
that common rule separate from the trajectory of each endpoint.  Planets and
asteroids use Swiss Ephemeris motion, fixed stars retain their epoch motion,
and derived points are recalculated from their actual ingredients.

The evaluator is intentionally independent of React and of list presentation.
It is also deliberately lazy: the comparatively expensive houses/Arabic-Part
state is built only when a selected ring family needs it.
"""
from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import antiscia
import arabicparts
import astrology
import chart
import common
import fortune
import houses
import options as options_mod
import placspec
import planets
import util

from aries.astrology.ephemeris_context import EphemerisContext
from aries.astrology.transit_fast import api as transit_fast_api


_SAMPLE_EPSILON_DAYS = 1.0 / 1440.0


def _signed_arc(start: float, end: float) -> float:
    return (float(end) - float(start) + 540.0) % 360.0 - 180.0


def _planet_flags(chrt) -> int:
    common.ensure_swe_ready()
    flags = astrology.SEFLG_SWIEPH | astrology.SEFLG_SPEED
    if bool(getattr(chrt.options, "topocentric", False)):
        flags |= astrology.SEFLG_TOPOCTR
    ayanopt = int(getattr(chrt.options, "ayanamsha", 0) or 0)
    if ayanopt:
        flags |= astrology.SEFLG_SIDEREAL
    return flags


def _fixed_star_flags(chrt) -> int:
    """Match Chart's geocentric star frame while retaining epoch velocity."""
    flags = astrology.SEFLG_SWIEPH | astrology.SEFLG_SPEED
    if int(getattr(chrt.options, "ayanamsha", 0) or 0):
        flags |= astrology.SEFLG_SIDEREAL
    return flags


def _active_part_config_indices(options) -> tuple[int, ...]:
    result = []
    for index, item in enumerate(getattr(options, "arabicparts", ()) or ()):
        try:
            if not arabicparts.ArabicParts.is_active_item(item):
                continue
        except Exception:
            pass
        result.append(index)
    return tuple(result)


class ChartMotionEvaluator:
    """Evaluate point identities against one chart's time/place/options."""

    def __init__(self, chrt):
        self.chart = chrt
        self.anchor_jd = float(chrt.time.jd)
        self.ephemeris_context = EphemerisContext.for_chart(
            chrt,
            ephe_path=common.get_ephe_path(),
        )
        self.flags = self.ephemeris_context.flags
        self.star_flags = _fixed_star_flags(chrt)
        self._planet_cache: dict[tuple[float, int], dict[str, Any]] = {}
        self._ecliptic_frame_cache: dict[float, tuple[float, float]] = {}
        self._house_cache: dict[float, tuple[Any, float]] = {}
        self._fortune_cache: dict[float, dict[str, Any]] = {}
        self._parts_cache: dict[float, dict[str, Any]] = {}
        self._syzygy_windows: list[tuple[float, float, dict[str, Any]]] = []
        self._activate_swiss_context()

    def _activate_swiss_context(self) -> None:
        """Restore this chart's process-global Swiss calculation context."""
        self.ephemeris_context.apply()

    @staticmethod
    def _jd_key(jd: float) -> float:
        # Root refinement revisits the same boundaries.  A 1e-10 day key is
        # sub-millisecond precision while avoiding duplicate Swiss calls from
        # harmless binary-float noise.
        return round(float(jd), 10)

    def planet(self, body_id: int, jd: float) -> dict[str, Any] | None:
        key = (self._jd_key(jd), int(body_id))
        if key in self._planet_cache:
            return self._planet_cache[key]
        semantic_id = int(body_id)
        ephemeris_id = semantic_id
        is_descending_node = semantic_id == astrology.SE_TRUE_NODE
        if semantic_id in (astrology.SE_MEAN_NODE, astrology.SE_TRUE_NODE):
            ephemeris_id = (
                astrology.SE_MEAN_NODE
                if bool(getattr(self.chart.options, "meannode", True))
                else astrology.SE_TRUE_NODE
            )
        try:
            with self.ephemeris_context.activate():
                _ret, data, _error = astrology.swe_calc_ut_ex(
                    float(jd), ephemeris_id, self.flags
                )
            if len(data) < 4:
                return None
            longitude = float(data[0])
            if is_descending_node:
                longitude += 180.0
            state = {
                "longitude": util.normalize(longitude),
                "latitude": float(data[1]),
                "speed": float(data[3]),
                "regime": ("ephemeris", semantic_id, ephemeris_id),
                "canAct": True,
                "valid": True,
            }
        except Exception:
            return None
        self._planet_cache[key] = state
        return state

    def fixed_star(self, code: str, jd: float) -> dict[str, Any] | None:
        code = str(code or "").strip().lstrip(",")
        if not code:
            return None
        try:
            with self.ephemeris_context.activate():
                _ret, _name, data, _error = astrology.swe_fixstar_ut(
                    "," + code,
                    float(jd),
                    self.star_flags,
                )
            if len(data) < 4:
                return None
            return {
                "longitude": util.normalize(float(data[0])),
                "speed": float(data[3]),
                "regime": ("fixedStar", code),
                # A star is a semantic target.  Its tiny epoch motion is used
                # for precision, but never makes the prose claim that the star
                # is the body doing the applying.
                "canAct": False,
                "valid": True,
            }
        except Exception:
            return None

    def _houses(self, jd: float) -> tuple[Any, float] | None:
        key = self._jd_key(jd)
        if key in self._house_cache:
            return self._house_cache[key]
        try:
            with self.ephemeris_context.activate():
                frame = self._ecliptic_frame(jd)
                if frame is None:
                    return None
                obl, ayan = frame
                ayanopt = int(getattr(self.chart.options, "ayanamsha", 0) or 0)
                hflag = astrology.SEFLG_SIDEREAL if ayanopt else 0
                value = houses.Houses(
                    float(jd),
                    hflag,
                    self.chart.place.lat,
                    self.chart.place.lon,
                    self.chart.options.hsys,
                    obl,
                    ayanopt,
                    ayan,
                )
        except Exception:
            return None
        self._house_cache[key] = (value, ayan)
        return value, ayan

    def _ecliptic_frame(self, jd: float) -> tuple[float, float] | None:
        key = self._jd_key(jd)
        if key in self._ecliptic_frame_cache:
            return self._ecliptic_frame_cache[key]
        try:
            with self.ephemeris_context.activate():
                ayanopt = int(getattr(self.chart.options, "ayanamsha", 0) or 0)
                ayan = (
                    astrology.effective_ayanamsha_ut(float(jd), ayanopt)
                    if ayanopt
                    else 0.0
                )
                delta_t = astrology.swe_deltat(float(jd))
                _error, ecl_nut = astrology.swe_calc(
                    float(jd) + float(delta_t),
                    astrology.SE_ECL_NUT,
                    0,
                )
                value = (float(ecl_nut[0]), float(ayan))
        except Exception:
            return None
        self._ecliptic_frame_cache[key] = value
        return value

    def angle_source(self, key: str, jd: float) -> dict[str, Any] | None:
        house_state = self._houses(jd)
        if house_state is None:
            return None
        hs, _ayan = house_state
        key = "dsc" if key == "dc" else str(key)
        try:
            if key == "asc":
                lon = float(hs.ascmc[houses.Houses.ASC])
            elif key == "dsc":
                lon = util.normalize(float(hs.ascmc[houses.Houses.ASC]) + 180.0)
            elif key == "mc":
                lon = float(hs.ascmc[houses.Houses.MC])
            elif key == "ic":
                lon = util.normalize(float(hs.ascmc[houses.Houses.MC]) + 180.0)
            elif key == "vertex":
                lon = float(hs.ascmc[houses.Houses.VERTEX])
            else:
                return None
        except Exception:
            return None
        return {
            "longitude": util.normalize(lon),
            "regime": ("angleSource", key),
            "canAct": True,
            "valid": True,
        }

    def _sun_above_horizon(
        self,
        jd: float,
        hs,
        sun: dict[str, Any],
    ) -> bool | None:
        try:
            with self.ephemeris_context.activate():
                equatorial_flags = (
                    int(self.flags)
                    & ~astrology.SEFLG_SIDEREAL
                ) | astrology.SEFLG_EQUATORIAL
                _ret, data, _error = astrology.swe_calc_ut_ex(
                    float(jd), astrology.SE_SUN, equatorial_flags
                )
            speculum = placspec.PlacidianSpeculum(
                float(self.chart.place.lat),
                hs.ascmc2,
                float(sun["longitude"]),
                float(sun.get("latitude", 0.0)),
                float(data[0]),
                float(data[1]),
            )
            above = bool(speculum.abovehorizon)
            if bool(getattr(self.chart.options, "usedaynightorb", False)) and not above:
                meridian_distance = float(
                    speculum.speculum[placspec.PlacidianSpeculum.MD]
                )
                semi_arc = float(
                    speculum.speculum[placspec.PlacidianSpeculum.SA]
                )
                if meridian_distance < 0.0:
                    meridian_distance += 180.0
                if semi_arc < 0.0:
                    semi_arc += 180.0
                day_night_orb = float(
                    getattr(self.chart.options, "daynightorbdeg", 0) or 0
                ) + float(
                    getattr(self.chart.options, "daynightorbmin", 0) or 0
                ) / 60.0
                if meridian_distance - day_night_orb < semi_arc:
                    above = True
            return above
        except Exception:
            return None

    def fortune(self, jd: float) -> dict[str, Any] | None:
        key = self._jd_key(jd)
        if key in self._fortune_cache:
            return self._fortune_cache[key]
        house_state = self._houses(jd)
        sun = self.planet(astrology.SE_SUN, jd)
        moon = self.planet(astrology.SE_MOON, jd)
        if house_state is None or sun is None or moon is None:
            return None
        hs, _ayan = house_state
        above = self._sun_above_horizon(jd, hs, sun)
        if above is None:
            return None
        asc = float(hs.ascmc[houses.Houses.ASC])
        sun_lon = float(sun["longitude"])
        moon_lon = float(moon["longitude"])
        formula_type = int(getattr(self.chart.options, "lotoffortune", 0) or 0)
        if formula_type == chart.Chart.LFMOONSUN:
            lon = asc + moon_lon - sun_lon
            formula_regime = "moon-sun"
        elif formula_type == chart.Chart.LFDSUNMOON:
            lon = asc + (sun_lon - moon_lon if above else moon_lon - sun_lon)
            formula_regime = "sun-moon" if above else "moon-sun"
        else:
            lon = asc + (moon_lon - sun_lon if above else sun_lon - moon_lon)
            formula_regime = "moon-sun" if above else "sun-moon"
        state = {
            "longitude": util.normalize(lon),
            "regime": ("fortune", formula_type, bool(above), formula_regime),
            "canAct": True,
            "valid": True,
        }
        self._fortune_cache[key] = state
        return state

    def midpoint(self, p1: int, p2: int, jd: float) -> dict[str, Any] | None:
        left = self.planet(int(p1), jd)
        right = self.planet(int(p2), jd)
        if left is None or right is None:
            return None
        delta = _signed_arc(float(left["longitude"]), float(right["longitude"]))
        valid = abs(abs(delta) - 180.0) > 1.0e-7
        return {
            "longitude": util.normalize(float(left["longitude"]) + delta / 2.0),
            "regime": ("midpoint", int(p1), int(p2), 1 if delta >= 0.0 else -1),
            "canAct": True,
            "valid": valid,
        }

    def _syzygy_event_state(
        self,
        event: dict[str, Any],
        candidate_houses,
    ) -> dict[str, Any] | None:
        """Resolve the configured point from one cached lunation event."""
        event_jd = float(event["jd"])
        is_new_moon = bool(event["isNewMoon"])
        selected = "moon"
        longitude = float(event["moonLongitude"])
        syzmoon = int(
            getattr(self.chart.options, "syzmoon", options_mod.Options.MOON)
        )
        if not is_new_moon and syzmoon != options_mod.Options.MOON:
            if syzmoon == options_mod.Options.ABOVEHOR:
                event_houses_state = self._houses(event_jd)
                if event_houses_state is None:
                    return None
                speculum_houses = event_houses_state[0]
            else:
                # ABOVEHORNATAL deliberately uses the evolving chart's houses.
                # The lunation event is stable, but this Moon/Sun selection can
                # change as those candidate angles rotate.
                speculum_houses = candidate_houses
            flags = astrology.SEFLG_SWIEPH | astrology.SEFLG_SPEED
            if int(getattr(self.chart.options, "ayanamsha", 0) or 0):
                flags |= astrology.SEFLG_SIDEREAL
            with self.ephemeris_context.activate():
                moon = planets.Planet(
                    event_jd,
                    astrology.SE_MOON,
                    flags,
                    self.chart.place.lat,
                    speculum_houses.ascmc2,
                )
            if not moon.abovehorizon:
                longitude = float(event["sunLongitude"])
                selected = "sun"
        return {
            "longitude": util.normalize(longitude),
            "regime": (
                "syzygy",
                "new" if is_new_moon else "full",
                round(event_jd, 7),
                selected,
            ),
            "valid": True,
        }

    def _syzygy(self, jd: float, candidate_houses) -> dict[str, Any] | None:
        for start_jd, end_jd, cached_event in self._syzygy_windows:
            if start_jd - 1.0e-7 <= float(jd) < end_jd - 1.0e-9:
                return self._syzygy_event_state(cached_event, candidate_houses)

        context = EphemerisContext.for_chart(
            self.chart,
            ephe_path=common.get_ephe_path(),
            include_topocentric=False,
        )
        flags = context.flags
        try:
            hits = transit_fast_api.search_relative_aspects_batch_raw(
                [astrology.SE_SUN, astrology.SE_MOON],
                float(jd) - 20.0,
                float(jd) + 20.0,
                [(0, 1, 0.0), (0, 1, 180.0)],
                context=context,
                step_days=0.25,
            )
            hit = max(
                (value for value in hits if float(value[0]) <= float(jd) + 1.0e-7),
                key=lambda value: float(value[0]),
            )
            event_jd = float(hit[0])
            next_event_jd = min(
                float(value[0])
                for value in hits
                if float(value[0]) > float(jd) + 1.0e-7
            )
            is_new_moon = int(hit[1]) == 0
            with context.activate():
                _ret, moon_data, _error = astrology.swe_calc_ut_ex(
                    event_jd,
                    astrology.SE_MOON,
                    flags,
                )
                _ret, sun_data, _error = astrology.swe_calc_ut_ex(
                    event_jd,
                    astrology.SE_SUN,
                    flags,
                )
            event = {
                "jd": event_jd,
                "isNewMoon": is_new_moon,
                "moonLongitude": float(moon_data[0]),
                "sunLongitude": float(sun_data[0]),
            }
        except Exception:
            return None

        # The selected prenatal syzygy remains the same until the next actual
        # conjunction/opposition. Cache that complete lunation interval rather
        # than a guessed duration, which would cause needless repeat searches.
        self._syzygy_windows.append((event_jd, next_event_jd, event))
        return self._syzygy_event_state(event, candidate_houses)

    def syzygy(self, jd: float) -> dict[str, Any] | None:
        """Sample the canonical prenatal syzygy for an evolving chart time.

        The point is piecewise continuous: it retains one lunation identity
        until the next conjunction/opposition boundary.  The regime token lets
        phase and exact-date solvers stop rather than interpolate across that
        discontinuity.
        """
        house_state = self._houses(float(jd))
        if house_state is None:
            return None
        state = self._syzygy(float(jd), house_state[0])
        if state is None:
            return None
        return {
            **state,
            # The prenatal event is a piecewise-constant chart point. It is a
            # valid target, but it does not continuously apply to another body.
            "canAct": False,
        }

    def _arabic_parts(self, jd: float) -> dict[str, Any] | None:
        key = self._jd_key(jd)
        if key in self._parts_cache:
            return self._parts_cache[key]
        house_state = self._houses(jd)
        fort = self.fortune(jd)
        if house_state is None or fort is None:
            return None
        hs, ayan = house_state
        simple_planets = []
        for body_id in range(planets.Planets.PLANETS_NUM):
            state = self.planet(body_id, jd)
            if state is None:
                return None
            simple_planets.append(SimpleNamespace(data=(state["longitude"], 0.0, 0.0, state.get("speed", 0.0))))
        pls = SimpleNamespace(planets=simple_planets)
        fort_obj = SimpleNamespace(
            fortune=(float(fort["longitude"]), 0.0, 0.0, 0.0),
            abovehorizon=bool(fort["regime"][2]),
            regime=fort["regime"],
        )

        evaluator = self

        class LazySyzygy:
            """Resolve prenatal phase only if the selected formula reaches it."""

            state: dict[str, Any] | None = None
            attempted = False

            def _resolve(self) -> dict[str, Any]:
                if not self.attempted:
                    self.state = evaluator._syzygy(jd, hs)
                    self.attempted = True
                if self.state is None:
                    raise ValueError("Unable to resolve prenatal syzygy")
                return self.state

            @property
            def lon(self) -> float:
                return float(self._resolve()["longitude"])

            @property
            def regime(self) -> Any:
                return self._resolve()["regime"]

        syz = LazySyzygy()
        try:
            calculated = arabicparts.ArabicParts(
                getattr(self.chart.options, "arabicparts", None),
                hs.ascmc,
                pls,
                hs,
                hs.cusps,
                fort_obj,
                syz,
                self.chart.options,
                ayan,
                bool(getattr(self.chart, "male", True)),
            )
            values = list(getattr(calculated, "parts", None) or [])
            regimes_by_config = tuple(
                getattr(calculated, "motion_regimes_by_config", None) or ()
            )
        except Exception:
            return None
        result = {
            "values": values,
            "activeIndices": _active_part_config_indices(self.chart.options),
            "regimesByConfig": regimes_by_config,
        }
        self._parts_cache[key] = result
        return result

    def arabic_part(self, config_index: int, jd: float) -> dict[str, Any] | None:
        bundle = self._arabic_parts(jd)
        if bundle is None:
            return None
        try:
            active_index = bundle["activeIndices"].index(int(config_index))
            part = bundle["values"][active_index]
            lon = float(part[arabicparts.ArabicParts.LONG])
            regime = bundle["regimesByConfig"][int(config_index)]
            if regime is None:
                return None
        except (ValueError, IndexError, TypeError, KeyError):
            return None
        return {
            "longitude": util.normalize(lon),
            "regime": (regime, int(config_index)),
            "canAct": True,
            "valid": True,
        }

    def projection(self, ref: dict[str, Any], jd: float) -> dict[str, Any] | None:
        source = self.sample(dict(ref.get("source") or {}), jd)
        if source is None:
            return None
        projection = str(ref.get("projection") or "")
        lon = float(source["longitude"])
        if projection == "dodecatemoria":
            sign = int(lon // 30.0) % 12
            projected = util.normalize(30.0 * sign + 12.0 * (lon % 30.0))
            regime = ("dodecatemoria", source.get("regime"), sign)
        elif projection in ("morin_antiscia", "morin_contra_antiscia"):
            frame = self._ecliptic_frame(jd)
            if frame is None:
                return None
            obl, ayan = frame
            branch = str(ref.get("branch") or "primary")
            if branch not in ("primary", "secondary"):
                return None
            points = antiscia.Antiscia.morin_projection_points(
                lon,
                float(source.get("latitude", 0.0)),
                obl,
                int(getattr(self.chart.options, "ayanamsha", 0) or 0),
                ayan,
                contra=projection == "morin_contra_antiscia",
            )
            branch_count = sum(
                1
                for candidate in points.values()
                if candidate is not None and bool(candidate.get("valid", True))
            )
            point = points.get(branch)
            if point is None or not bool(point.get("valid", True)):
                return None
            projected = util.normalize(float(point["lon"]))
            regime = (
                projection,
                source.get("regime"),
                branch,
                branch_count,
                # Direction distinguishes two simultaneous roots. A lone
                # zero-latitude branch stays continuous when it crosses the
                # source instead of being rejected as a new identity.
                int(point.get("direction", 0)) if branch_count > 1 else 0,
            )
        elif projection in ("antiscia", "contra_antiscia"):
            ayanopt = int(getattr(self.chart.options, "ayanamsha", 0) or 0)
            ayan = astrology.effective_ayanamsha_ut(float(jd), ayanopt) if ayanopt else 0.0
            tropical = util.normalize(lon + ayan)
            projected = util.normalize(180.0 - tropical - ayan)
            if projection == "contra_antiscia":
                projected = util.normalize(projected + 180.0)
            regime = (projection, source.get("regime"), "classical")
        else:
            return None
        return {
            "longitude": projected,
            "regime": regime,
            "canAct": bool(source.get("canAct", True)),
            "valid": bool(source.get("valid", True)),
        }

    def sample(self, ref: dict[str, Any], jd: float) -> dict[str, Any] | None:
        kind = str(ref.get("kind") or "")
        if kind in ("planet", "ephemerisBody"):
            return self.planet(int(ref["bodyId"]), jd)
        if kind == "fixedStar":
            return self.fixed_star(str(ref.get("code") or ""), jd)
        if kind == "fixedPoint":
            try:
                lon = float(ref["longitude"])
            except (KeyError, TypeError, ValueError):
                return None
            return {
                "longitude": util.normalize(lon),
                "regime": ("fixedPoint", str(ref.get("id") or "")),
                "canAct": False,
                "valid": True,
            }
        if kind == "angleSource":
            return self.angle_source(str(ref.get("angle") or ""), jd)
        if kind == "fortune":
            return self.fortune(jd)
        if kind == "syzygy":
            return self.syzygy(jd)
        if kind == "midpoint":
            return self.midpoint(int(ref["p1"]), int(ref["p2"]), jd)
        if kind == "projection":
            return self.projection(ref, jd)
        if kind == "arabicPart":
            return self.arabic_part(int(ref["configIndex"]), jd)
        return None


def sampled_speed(
    evaluator: ChartMotionEvaluator,
    ref: dict[str, Any],
    jd: float,
    epsilon_days: float = _SAMPLE_EPSILON_DAYS,
) -> float | None:
    """Centered local longitude velocity, with circular unwrapping."""
    before = evaluator.sample(ref, float(jd) - float(epsilon_days))
    after = evaluator.sample(ref, float(jd) + float(epsilon_days))
    if before is None or after is None:
        return None
    if before.get("regime") != after.get("regime"):
        return None
    return _signed_arc(before["longitude"], after["longitude"]) / (2.0 * float(epsilon_days))
