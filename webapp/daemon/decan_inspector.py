# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Display adapter for existing configured decans; no chart math changes."""
import chartinspector
import mtexts
from webapp.daemon.display_palette import chart_body_color_role, sign_color_role


def build_region(options, object_id):
    try:
        sign, decan = map(int, str(object_id).split(':'))
        if not 0 <= sign < 12 or not 0 <= decan < 3:
            raise ValueError
        ruler = int(options.decans[int(options.seldecan)][sign][decan])
        return {
            'kind': 'decan', 'object_id': f'{sign}:{decan}',
            'chart_role': 'primary',
            'data': {'sign_index': sign, 'decan_index': decan, 'ruler': ruler,
                     'start': decan * 10, 'end': (decan + 1) * 10},
        }
    except (TypeError, ValueError, IndexError, AttributeError):
        raise SystemExit('unavailable zodiac decan') from None


def payload(region, options, *, chrt=None, compact=False):
    data = region['data']
    ruler = data['ruler']
    sign = data['sign_index']
    sign_label = chartinspector._sign_name(sign)
    title = mtexts.txts['inspector.decanTitle'] % {
        'sign': sign_label,
        'number': ('I', 'II', 'III')[data['decan_index']],
    }
    # Match terms: display the transition boundaries, with an exclusive end.
    degrees = f"{data['start']}°–{data['end']}° {sign_label}"
    base = {
        'glyph': chartinspector._planet_glyph(ruler),
        'signGlyph': chartinspector._sign_glyph(sign, options),
        'signLabel': sign_label,
        'signColourRole': sign_color_role(options, sign),
        'title': title, 'accent': None,
        'accentRole': chart_body_color_role(options, chrt, ruler) or '--morinus-text',
    }
    if compact:
        return {**base, 'rows': [('', degrees)]}
    return {
        **base, 'meta': '', 'smart_rows': [degrees], 'rows': [degrees],
        'detail_rows': [], 'aspect_rows': [], 'aspect_items': [], 'footer': '',
    }
