# -*- coding: utf-8 -*-
# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

"""ChartFactory — the single chart constructor (policy-chart-lifecycle §1).

Every ``chart.Chart`` in the daemon process is this module's output, held by
the CI guard (tests/test_lifecycle_guards.py, Invariant 1). The factory is
deliberately thin today — a choke point, not a re-architecture: it gives the
process exactly one place where Moments become Times and Times become Charts,
so normalization rules (tz/DST/calendar resolution, the display rule in
engine/moment.py) accrete HERE instead of drifting across call sites.

Doors (policy §2):
  * :func:`build_time`  — local civil digits + place + zone context -> Time
                          (the Moment normalizer's input side).
  * :func:`build_chart` — the one ``chart.Chart`` construction site (see build_chart).
  * :func:`chart_from_record` — schema-v1 Record dict -> Chart (wraps
                          ``chartfile.dict_to_chart``; Open/Import doors).

Derivers compute the Moment + context and call these; they do not construct.
"""

import chart
import chartfile


def build_time(y, m, d, h, mi, s, *, place,
               bc=False,
               cal=chart.Time.GREGORIAN,
               zt=chart.Time.ZONE,
               plus=True, zh=0, zm=0,
               daylight=False,
               full=True,
               tzid='', tzauto=False):
    """Local civil digits + zone context -> ``chart.Time``.

    The digits are LOCAL (as-entered) civil time; ``chart.Time`` performs the
    zone subtraction to UT/jd internally (chart.py:308 "To GMT"). Callers
    holding a UT instant must convert through ``engine.moment`` first — never
    feed UT digits to a zone-typed Time (the display-rule bug class).
    """
    return chart.Time(
        int(y), int(m), int(d), int(h), int(mi), int(s),
        bool(bc), cal, zt, bool(plus), int(zh), int(zm), bool(daylight),
        place, bool(full), tzid=tzid or '', tzauto=bool(tzauto),
    )


def build_chart(name, male, time_obj, place, htype, notes, options, *args, **kwargs):
    """The single direct Chart construction in the daemon.

    Positional tail (``*args``) carries the legacy optional parameters
    (fixed-stars flag, proftype, zodiacal-projection, …) exactly as
    ``chart.Chart`` defines them — the factory does not reinterpret them.
    ``options`` is threaded explicitly (policy Decided: the singleton is the
    accepted default, but per-chart narrowing passes a narrowed copy here —
    see supplementary_adapter.chart_with_marr_override).
    """
    return chart.Chart(name, male, time_obj, place, htype, notes, options, *args, **kwargs)


def chart_from_record(record, options):
    """Schema-v1 Record dict -> Chart (the Open / Import doors).

    Wraps ``chartfile.dict_to_chart`` — the canonical Record decoder (real
    seclon, folded DST, tzauto resolution). Import adapters produce Records;
    this turns Records into charts. Nothing else parses chart files.
    """
    return chartfile.dict_to_chart(record, options)
