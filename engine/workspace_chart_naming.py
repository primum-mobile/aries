# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Parameter-bearing default names shared by workspace, events and saves."""
import dateformat
import mtexts
from engine import harmonic_chart


def specialized_chart_name(session, *, recipe=False):
    if not session or (session.get('saved_event_name') and not recipe) or session.get('timed_event_title') or session.get('user_chart_name'):
        return None
    cs = session.get('chart_session')
    chrt = getattr(cs, 'chart', None)
    if chrt is None:
        return None
    feature = session.get('supplementary_feature_kind')
    retained = (session.get('supplementary_binding') or {}).get('retained_state') or {}
    if feature == 'harmonic':
        if retained.get('projection_mode') == harmonic_chart.PROJECTION_MODE_VARGA:
            number = harmonic_chart.normalize_varga_number(retained.get('varga_number'))
            name = mtexts.txts[harmonic_chart.varga_name_key(number)]
            return mtexts.txts['VargaTabFmt'] % (number, name)
        number = harmonic_chart.format_harmonic_number(retained.get('harmonic_number'))
        return mtexts.txts['HarmonicTabFmt'] % number
    if feature not in ('solar_return', 'lunar_return'):
        return None
    # Return tabs keep their full workspace labels; only Events use SR/LR dates.
    if not recipe:
        return None
    # Distinct return techniques retain their existing specialized labels.
    mode = retained.get('solar_return_mode' if feature == 'solar_return' else 'lunar_return_mode')
    if mode not in (None, 'standard', 'lunar'):
        return None
    display = getattr(cs, 'display_datetime', None) or retained.get('raw_return_datetime')
    if not display:
        return None
    if feature == 'solar_return':
        year = ('-' if chrt.time.bc else '') + str(display[0])
        return mtexts.txts['SolarReturnTabFmt'] % year
    date = dateformat.date_text(*display[:3], chrt.options, bc=chrt.time.bc)
    return mtexts.txts['LunarReturnTabFmt'] % date
