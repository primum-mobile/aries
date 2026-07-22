# -*- coding: utf-8 -*-
# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Moment normalizer — first piece of the canonical Moment layer.

Policy: doc/policy-chart-lifecycle.md §1 (Moment) and the display rule —
a displayed chart always shows LOCAL civil time of its place/zone; UT only in
the footer. Julian days (``swe_revjul``) are UT; their digits must pass
through :func:`utc_to_chart_local` before touching any visible display field.

This is THE single UT->local conversion for the daemon. It follows the Aries
display rule, not wx's older "GREENWICH means display UT" shortcut. wx's
tzid/geonames/static-offset resolution lives in morin._revolution_display_datetime.
The previously scattered copies (workspace_service, search_service, the
headless driver) all delegate here.
"""

import datetime

try:
    import zoneinfo
except ImportError:  # pragma: no cover - py<3.9 fallback, not expected
    zoneinfo = None

# chart.Time zone-type enum (chart.py:55-58). Numeric here so this module does
# not import the heavy chart module.
ZT_ZONE = 0           # standard zone time: UTC + zh:zm
ZT_GREENWICH = 1      # UTC calculation/storage; visible display still local
ZT_LOCALMEAN = 2      # LMT — wx passthrough (no display conversion), kept
ZT_LOCALAPPARENT = 3  # LAT — wx passthrough, kept


def utc_to_zone_fields(utc_dt, tzid):
    """Resolve one exact UTC instant into an IANA zone and Time fields.

    Deriving the offset from the UTC instant avoids both stale DST flags and
    the ambiguous repeated local hour at the autumn clock change.
    """
    try:
        y, m, d, h, mi, s = [int(v) for v in tuple(utc_dt)[:6]]
    except Exception:
        return None
    if not tzid or zoneinfo is None:
        return None
    try:
        aware_utc = datetime.datetime(
            y, m, d, h, mi, s, tzinfo=datetime.timezone.utc,
        )
        aware_local = aware_utc.astimezone(zoneinfo.ZoneInfo(str(tzid)))
        total_offset = aware_local.utcoffset()
        dst_offset = aware_local.dst() or datetime.timedelta(0)
        if total_offset is None:
            return None
        standard_minutes = int(
            (total_offset - dst_offset).total_seconds() // 60
        )
        plus = standard_minutes >= 0
        absolute_minutes = abs(standard_minutes)
        return {
            "datetime": (
                aware_local.year,
                aware_local.month,
                aware_local.day,
                aware_local.hour,
                aware_local.minute,
                aware_local.second,
            ),
            "tzid": str(tzid),
            "plus": plus,
            "zh": absolute_minutes // 60,
            "zm": absolute_minutes % 60,
            "daylightsaving": dst_offset != datetime.timedelta(0),
        }
    except Exception:
        return None


def _resolve_tzid(time_obj, place):
    tzid = getattr(time_obj, "tzid", "") or ""
    if tzid:
        return tzid
    # wx fallback: resolve from coordinates (morin._revolution_display_datetime
    # via geonames.Geonames.get_timezone_name). Lazy import: geonames pulls its
    # places DB only when this path is actually hit.
    if place is not None:
        try:
            import geonames

            return geonames.Geonames.get_timezone_name(place.lon, place.lat) or ""
        except Exception:
            return ""
    return ""


def utc_to_chart_local(time_obj, utc_dt, *, place=None,
                       plus=None, zh=None, zm=None, daylight=None):
    """Convert UT digits to the chart-zone local civil tuple.

    ``time_obj`` is a ``chart.Time``-shaped object (or None); ``utc_dt`` is a
    ``(y, m, d, h, mi, s)`` tuple in UT.

    Aries display rule: GREENWICH charts may store/calculate a UT instant, but
    visible chart time still converts to the chart place/zone. LMT/LAT are
    already local-style inputs and remain passthrough for now.

    Conversion prefers the stored IANA ``tzid`` (zoneinfo: historical offsets
    + DST), then a coordinate lookup via ``place`` (the wx geonames fallback),
    then the static zone offset. The keyword overrides (``plus``/``zh``/
    ``zm``/``daylight``) replace the chart's static fields in the fallback —
    used by relocated-return callers that carry the RETURN place's zone.
    Returns the input digits unchanged when nothing better is known.
    """
    try:
        y, m, d, h, mi, s = [int(v) for v in tuple(utc_dt)[:6]]
    except Exception:
        return None
    if time_obj is None:
        return y, m, d, h, mi, s
    zt = int(getattr(time_obj, "zt", ZT_ZONE) or 0)
    if zt in (ZT_LOCALMEAN, ZT_LOCALAPPARENT):
        return y, m, d, h, mi, s
    tzid = _resolve_tzid(time_obj, place)
    resolved_zone = utc_to_zone_fields((y, m, d, h, mi, s), tzid)
    if resolved_zone is not None:
        return resolved_zone["datetime"]
    try:
        base = datetime.datetime(y, m, d, h, mi, s)
        use_plus = bool(getattr(time_obj, "plus", True) if plus is None else plus)
        use_zh = int((getattr(time_obj, "zh", 0) if zh is None else zh) or 0)
        use_zm = int((getattr(time_obj, "zm", 0) if zm is None else zm) or 0)
        use_dst = bool(
            getattr(time_obj, "daylightsaving", False) if daylight is None else daylight
        )
        # chart.Time semantics are signed standard offset + one positive DST
        # hour.  Applying the sign after adding DST would turn UTC-5+DST into
        # UTC-6 instead of UTC-4.
        standard_minutes = use_zh * 60 + use_zm
        if not use_plus:
            standard_minutes *= -1
        total_minutes = standard_minutes + (60 if use_dst else 0)
        local_dt = base + datetime.timedelta(minutes=total_minutes)
        return (
            local_dt.year,
            local_dt.month,
            local_dt.day,
            local_dt.hour,
            local_dt.minute,
            local_dt.second,
        )
    except Exception:
        return y, m, d, h, mi, s


def utc_to_place_local_zone(utc_dt, place):
    """Return clicked-place local display time plus ZONE fields for a UT instant.

    Relocation-style callers need both halves: the local civil clock for visible
    chart metadata and the zone fields required to build a ``chart.Time`` whose
    JD remains the original UT instant. The offset is derived from the actual
    UTC instant, avoiding ambiguous fall-back-hour drift.
    """
    try:
        y, m, d, h, mi, s = [int(v) for v in tuple(utc_dt)[:6]]
    except Exception:
        return None

    class _PlaceTime:
        pass

    place_time = _PlaceTime()
    place_time.zt = ZT_GREENWICH
    place_time.plus = True
    place_time.zh = 0
    place_time.zm = 0
    place_time.daylightsaving = False
    place_time.tzid = ""
    tzid = _resolve_tzid(place_time, place)
    resolved_zone = utc_to_zone_fields((y, m, d, h, mi, s), tzid)
    if resolved_zone is not None:
        return resolved_zone

    local_dt = utc_to_chart_local(place_time, (y, m, d, h, mi, s), place=place)
    return {
        "datetime": local_dt or (y, m, d, h, mi, s),
        "tzid": "",
        "plus": True,
        "zh": 0,
        "zm": 0,
        "daylightsaving": False,
    }
