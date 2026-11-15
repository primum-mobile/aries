# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Display adapter for configured zodiac bounds; no chart math is changed."""
import chartinspector
import mtexts
from webapp.daemon.display_palette import chart_body_color_role, sign_color_role


def build_region(options, object_id):
    try:
        sign, ruler = map(int, str(object_id).split(':'))
        if not 0 <= sign < 12 or ruler not in (2, 3, 4, 5, 6):
            raise ValueError
        start = 0
        for body, size in options.terms[int(options.selterm)][sign]:
            end = start + int(size)
            if int(body) == ruler:
                return {
                    'kind': 'term', 'object_id': f'{sign}:{ruler}',
                    'chart_role': 'primary',
                    'data': {'sign_index': sign, 'ruler': ruler, 'start': start, 'end': end},
                }
            start = end
    except (TypeError, ValueError, IndexError, AttributeError):
        pass
    raise SystemExit('unavailable zodiac bound')


def payload(region, options, *, chrt=None, compact=False):
    data = region['data']
    ruler = data['ruler']
    lord = chartinspector._planet_name(ruler)
    sign_label = chartinspector._sign_name(data['sign_index'])
    title = mtexts.txts['inspector.boundTitle'] % {
        'ruler': lord,
    }
    # Show the actual boundaries; the next term starts at the exclusive end.
    # For example, 0°–12° includes all of 11°, up to the transition at 12°.
    degrees = f"{data['start']}°–{data['end']}° {sign_label}"
    base = {
        'glyph': chartinspector._planet_glyph(ruler),
        'signGlyph': chartinspector._sign_glyph(data['sign_index'], options),
        'signLabel': sign_label,
        'signColourRole': sign_color_role(options, data['sign_index']),
        'title': title, 'accent': None,
        'accentRole': chart_body_color_role(options, chrt, ruler) or '--morinus-text',
    }
    if compact:
        return {**base, 'rows': [('', degrees)]}
    rows = [degrees]
    return {
        **base, 'meta': '', 'smart_rows': rows, 'rows': rows,
        'detail_rows': [], 'aspect_rows': [], 'aspect_items': [], 'footer': '',
    }
