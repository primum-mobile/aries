# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Non-mutating style-profile palette adapters for daemon display payloads.

Astrology calculations must continue to receive their original options object.
Table/list serializers call this module only when resolving final presentation
colors for JSON payloads.
"""
from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import astrology
import chart
import common


_BODY_COLOR_ROLE_BY_PLANET = {
    astrology.SE_SUN: ("--morinus-body-sun", 0),
    astrology.SE_MOON: ("--morinus-body-moon", 1),
    astrology.SE_MERCURY: ("--morinus-body-mercury", 2),
    astrology.SE_VENUS: ("--morinus-body-venus", 3),
    astrology.SE_MARS: ("--morinus-body-mars", 4),
    astrology.SE_JUPITER: ("--morinus-body-jupiter", 5),
    astrology.SE_SATURN: ("--morinus-body-saturn", 6),
    astrology.SE_URANUS: ("--morinus-body-uranus", 7),
    astrology.SE_NEPTUNE: ("--morinus-body-neptune", 8),
    astrology.SE_PLUTO: ("--morinus-body-pluto", 9),
    astrology.SE_MEAN_NODE: ("--morinus-body-nodes", 10),
    astrology.SE_TRUE_NODE: ("--morinus-body-nodes", 10),
    astrology.SE_CHIRON: ("--morinus-body-chiron", 12),
}
_ASPECT_COLOR_ROLE_BY_INDEX = {
    chart.Chart.CONJUNCTIO: "--morinus-aspect-conjunction",
    chart.Chart.SEMISEXTIL: "--morinus-aspect-semisextile",
    chart.Chart.SEMIQUADRAT: "--morinus-aspect-semisquare",
    chart.Chart.SEXTIL: "--morinus-aspect-sextile",
    chart.Chart.QUINTILE: "--morinus-aspect-quintile",
    chart.Chart.QUADRAT: "--morinus-aspect-square",
    chart.Chart.TRIGON: "--morinus-aspect-trine",
    chart.Chart.SESQUIQUADRAT: "--morinus-aspect-sesquisquare",
    chart.Chart.BIQUINTILE: "--morinus-aspect-biquintile",
    chart.Chart.QUINQUNX: "--morinus-aspect-quincunx",
    chart.Chart.OPPOSITIO: "--morinus-aspect-opposition",
    chart.Chart.SEPTILE: "--morinus-aspect-septile",
    chart.Chart.PARALLEL: "--morinus-aspect-parallel",
    chart.Chart.CONTRAPARALLEL: "--morinus-aspect-contraparallel",
}
_DIGNITY_COLOR_ROLE_BY_CODE = {
    chart.Chart.DOMICIL: ("--morinus-dignity-domicil", "clrdomicil"),
    chart.Chart.EXAL: ("--morinus-dignity-exal", "clrexal"),
    chart.Chart.PEREGRIN: ("--morinus-peregrin", "clrperegrin"),
    chart.Chart.CASUS: ("--morinus-dignity-casus", "clrcasus"),
    chart.Chart.EXIL: ("--morinus-dignity-exil", "clrexil"),
}
_ELEMENT_COLOR_ROLE_BY_KEY = {
    "fire": ("--morinus-element-fire", "clrsignelementfire"),
    "earth": ("--morinus-element-earth", "clrsignelementearth"),
    "air": ("--morinus-element-air", "clrsignelementair"),
    "water": ("--morinus-element-water", "clrsignelementwater"),
}


def effective_display_options(source_options=None):
    """Return the active profile's chart palette layered over ``source_options``.

    The import stays local because options_service owns the live profile store
    and imports several daemon services during normal startup.
    """
    from webapp.daemon.options_service import options_service

    return options_service.get_effective_style_chart_options(source_options)


def object_glyph_color(
    display_options,
    obj,
    dignity_code: Any,
    *,
    fallback: Any = None,
    source_options=None,
):
    """Resolve a search/list object's semantic color from an effective palette.

    This preserves the existing individual-colour versus dignity-colour display
    mode while allowing the backend's already-computed dignity code to be
    rendered through an active style profile. No dignity or object semantics
    are recomputed here.
    """
    # Without a profile-layered palette, the serialized metadata is the
    # established presentation authority. Preserve it byte-for-byte instead of
    # silently reinterpreting dignity/individual-colour settings.
    if source_options is not None and display_options is source_options:
        return fallback
    if display_options is None or obj is None:
        return fallback
    object_id = getattr(obj, "id", None)
    planet_index = getattr(obj, "planet_index", None)
    if object_id != "point:lof" and planet_index is None:
        return getattr(display_options, "clrtexts", fallback)
    try:
        planet_index = int(planet_index) if planet_index is not None else None
    except Exception:
        return fallback

    if getattr(display_options, "useplanetcolors", False):
        if object_id == "point:lof":
            color_index = astrology.SE_MEAN_NODE + 1
        elif planet_index == astrology.SE_CHIRON:
            color_index = astrology.SE_PLUTO + 3
        elif planet_index == astrology.SE_TRUE_NODE:
            color_index = astrology.SE_MEAN_NODE
        elif planet_index is not None and planet_index < 0:
            color_index = 0
        elif planet_index is not None and planet_index >= astrology.SE_MEAN_NODE + 2:
            color_index = astrology.SE_MEAN_NODE + 1
        else:
            color_index = planet_index
        try:
            colors = getattr(display_options, "clrindividual")
            if color_index is None:
                raise IndexError
            return colors[min(color_index, len(colors) - 1)]
        except Exception:
            return getattr(display_options, "clrperegrin", fallback)

    if object_id == "point:lof" or planet_index == astrology.SE_CHIRON:
        return getattr(display_options, "clrperegrin", fallback)
    palette = (
        getattr(display_options, "clrdomicil", fallback),
        getattr(display_options, "clrexal", fallback),
        getattr(display_options, "clrperegrin", fallback),
        getattr(display_options, "clrcasus", fallback),
        getattr(display_options, "clrexil", fallback),
    )
    try:
        return palette[int(dignity_code)]
    except Exception:
        return getattr(display_options, "clrperegrin", fallback)


def object_glyph_color_role(
    display_options,
    obj,
    dignity_code: Any,
    *,
    resolved_color: Any = None,
) -> str | None:
    """Return the stable CSS role for a serialized object color.

    ``resolved_color`` is an exact safety guard. A custom/sentinel literal that
    does not match the current semantic palette stays literal instead of being
    silently forced through an unrelated CSS variable.
    """
    if display_options is None or obj is None:
        return _matching_role(
            [("--morinus-text-bright", getattr(display_options, "clrtexts", None))],
            resolved_color,
        ) if display_options is not None else None

    object_id = str(getattr(obj, "id", "") or "")
    planet_index = getattr(obj, "planet_index", None)
    try:
        planet_index = int(planet_index) if planet_index is not None else None
    except Exception:
        planet_index = None

    candidates: list[tuple[str, Any]] = []
    body_role = None
    if object_id == "point:lof":
        body_role = ("--morinus-body-fortune", 11)
    elif planet_index in _BODY_COLOR_ROLE_BY_PLANET:
        body_role = _BODY_COLOR_ROLE_BY_PLANET[planet_index]
    if body_role is not None and bool(getattr(display_options, "useplanetcolors", False)):
        role, color_index = body_role
        try:
            candidates.append((role, getattr(display_options, "clrindividual")[color_index]))
        except Exception:
            pass

    if object_id == "point:lof" or planet_index == astrology.SE_CHIRON:
        candidates.append(("--morinus-peregrin", getattr(display_options, "clrperegrin", None)))
    elif planet_index is None:
        candidates.append(("--morinus-text-bright", getattr(display_options, "clrtexts", None)))
    else:
        try:
            dignity = int(dignity_code)
        except Exception:
            dignity = chart.Chart.PEREGRIN
        role, attr = _DIGNITY_COLOR_ROLE_BY_CODE.get(
            dignity,
            _DIGNITY_COLOR_ROLE_BY_CODE[chart.Chart.PEREGRIN],
        )
        candidates.append((role, getattr(display_options, attr, None)))
        if dignity != chart.Chart.PEREGRIN:
            candidates.append(("--morinus-peregrin", getattr(display_options, "clrperegrin", None)))

    return _matching_role(candidates, resolved_color)


def chart_body_color_role(
    display_options,
    chrt,
    body_id: Any,
    *,
    is_fortune: bool = False,
    is_vertex: bool = False,
    resolved_color: Any = None,
) -> str | None:
    """Return the live CSS role for a retained chart-renderer body color.

    Specialized canvases serialize geometry and a literal fallback color in
    one daemon payload.  The role lets an already-open canvas follow profile
    palette changes without refetching or rebuilding that geometry.  The
    literal remains authoritative when it does not match the active semantic
    palette, preserving custom/sentinel producer colors.
    """
    if display_options is None or bool(getattr(display_options, "bw", False)):
        return None
    try:
        planet_index = int(body_id)
    except (TypeError, ValueError):
        planet_index = None

    object_id = "point:lof" if is_fortune else (
        "point:vertex" if is_vertex else f"planet:{planet_index}"
    )
    dignity = chart.Chart.PEREGRIN
    if not is_fortune and not is_vertex and planet_index is not None:
        try:
            dignity = int(chrt.dignity(planet_index))
        except Exception:
            dignity = chart.Chart.PEREGRIN

    return object_glyph_color_role(
        display_options,
        SimpleNamespace(id=object_id, planet_index=planet_index),
        dignity,
        resolved_color=resolved_color,
    )


def sign_color_role(
    display_options,
    sign_index: Any,
    *,
    force_element: bool = False,
    resolved_color: Any = None,
) -> str | None:
    """Return the sign or element CSS role matching a serialized sign color."""
    if display_options is None or bool(getattr(display_options, "bw", False)):
        return None
    candidates: list[tuple[str, Any]] = []
    if force_element or bool(getattr(display_options, "usezodiacelementcolors", False)):
        element = common.get_sign_element_key(sign_index)
        role, attr = _ELEMENT_COLOR_ROLE_BY_KEY[element]
        candidates.append((role, getattr(display_options, attr, None)))
    candidates.append(("--morinus-signs", getattr(display_options, "clrsigns", None)))
    return _matching_role(candidates, resolved_color)


def aspect_color_role(
    display_options,
    aspect_index: Any,
    *,
    resolved_color: Any = None,
) -> str | None:
    """Return an aspect CSS role, falling back to the chart text role."""
    candidates: list[tuple[str, Any]] = []
    try:
        index = int(aspect_index)
    except Exception:
        index = None
    role = _ASPECT_COLOR_ROLE_BY_INDEX.get(index)
    if role is not None:
        try:
            candidates.append((role, getattr(display_options, "clraspect")[index]))
        except Exception:
            pass
    candidates.append(("--morinus-text-bright", getattr(display_options, "clrtexts", None)))
    return _matching_role(candidates, resolved_color)


def _matching_role(
    candidates: list[tuple[str, Any]],
    resolved_color: Any,
) -> str | None:
    if resolved_color is None:
        return next((role for role, value in candidates if _rgb_key(value) is not None), None)
    resolved = _rgb_key(resolved_color)
    if resolved is None:
        return None
    return next(
        (role for role, value in candidates if _rgb_key(value) == resolved),
        None,
    )


def _rgb_key(value: Any) -> tuple[int, int, int] | None:
    if isinstance(value, str):
        text = value.strip().lower()
        if text.startswith("#"):
            raw = text[1:]
            if len(raw) == 3:
                raw = "".join(channel * 2 for channel in raw)
            if len(raw) == 6:
                try:
                    return tuple(int(raw[index:index + 2], 16) for index in (0, 2, 4))
                except ValueError:
                    return None
        if text.startswith("rgb(") and text.endswith(")"):
            text = text[4:-1].replace(",", " ")
            try:
                channels = [int(float(part)) for part in text.split()[:3]]
                if len(channels) == 3:
                    return tuple(max(0, min(255, value)) for value in channels)
            except (TypeError, ValueError):
                return None
        return None
    try:
        channels = [int(value) for value in list(value)[:3]]
    except (TypeError, ValueError):
        return None
    if len(channels) != 3:
        return None
    return tuple(max(0, min(255, value)) for value in channels)
