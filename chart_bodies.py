# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Chart-side bodies outside the fixed legacy planet array.

Apogee has one semantic identity and a selected Swiss calculation. Keep the
physical ID on the body so timed consumers use the same mean/true solution.
Appearance never determines availability to calculation consumers.
"""
import astrology

APOGEE_IDS = (astrology.SE_MEAN_APOG, astrology.SE_OSCU_APOG)
DYNAMIC_BODY_ATTRS = ('chiron', 'apogee')
APOGEE_GLYPH = '\u26b8'


def apogee_id(options):
    return astrology.SE_MEAN_APOG if getattr(options, 'meanapogee', True) else astrology.SE_OSCU_APOG


def dynamic_body_specs(options):
    return ((astrology.SE_CHIRON, 'chiron'), (apogee_id(options), 'apogee'))


def iter_dynamic_bodies(chrt):
    for attr in DYNAMIC_BODY_ATTRS:
        body = getattr(chrt, attr, None)
        if body is not None:
            yield astrology.SE_CHIRON if attr == 'chiron' else body.pId, body


def dynamic_body(chrt, body_id):
    attr = 'chiron' if body_id == astrology.SE_CHIRON else 'apogee' if body_id in APOGEE_IDS else None
    body = getattr(chrt, attr, None) if attr else None
    if body is not None and (attr == 'chiron' or body.pId == body_id):
        return body
    return None
