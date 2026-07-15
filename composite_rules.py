# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Composite (relationship) discipline binding for the generic rule engine.

A composite chart is the midpoint chart of two natal charts — it represents
the *relationship itself* as a third entity. At the engine level it is a
single Chart object (built by `compositechart.build_composite_chart` /
`build_davison_chart`), so EVERY existing single-chart predicate works on
it unchanged. This shim is therefore identical in shape to `natal_rules.py`;
only the theme framing differs (relationship topics, not native topics).

Two entry points:

- ``evaluate(theme, composite_chart, context=None)`` — the composite chart
  is ALREADY built (the dispatch layer constructed it from the two natives).
  Same signature as the other discipline shims so the daemon / wx oracle
  can call all disciplines uniformly.

- ``build_and_evaluate(theme, chrt_a, chrt_b, opts, method='composite')`` —
  convenience that builds the composite from two natal charts first. Used
  by the demo + any caller that has the two charts but not the composite.

Drop a manifest with ``[themes.composite.<slug>]`` blocks (or drop a pack
into the community pack root) and Aries auto-registers new composite themes
— no edit to this file required.
"""

import rule_engine

# Re-export so callers can `from composite_rules import Alert, list_packs`.
Alert = rule_engine.Alert
list_packs = rule_engine.list_packs
set_active_packs = rule_engine.set_active_packs


# Built-in relationship-topic themes. Twelve composite-house lenses + a
# whole-chart reading. Community packs MAY register additional themes via
# their manifest's ``[themes.composite.<slug>]`` blocks.
_THEME_SLUGS = {
    'The Relationship Itself (1st)':  'relationship-self',
    'Shared Resources (2nd)':         'shared-resources',
    'Communication (3rd)':            'communication',
    'Home & Foundations (4th)':       'foundations',
    'Romance & Children (5th)':       'romance',
    'Daily Life & Duties (6th)':      'daily-life',
    'Commitment & Balance (7th)':     'commitment',
    'Intimacy & Crisis (8th)':        'intimacy',
    'Shared Beliefs & Growth (9th)':  'beliefs',
    'Public Role & Goals (10th)':     'public-role',
    'Friendship & Hopes (11th)':      'friendship',
    'Hidden Tensions (12th)':         'hidden-tensions',
    'General Relationship Reading':   'general',
}


# Default topic-house per theme. As with natal, we set
# ``querent_house = quesited_house = <topic_house>`` so any predicate that
# reads a context house works against the composite chart unchanged.
DEFAULT_SIGNIFICATORS = {
    'The Relationship Itself (1st)':  {'querent_house': 1,  'quesited_house': 1},
    'Shared Resources (2nd)':         {'querent_house': 1,  'quesited_house': 2},
    'Communication (3rd)':            {'querent_house': 1,  'quesited_house': 3},
    'Home & Foundations (4th)':       {'querent_house': 1,  'quesited_house': 4},
    'Romance & Children (5th)':       {'querent_house': 1,  'quesited_house': 5},
    'Daily Life & Duties (6th)':      {'querent_house': 1,  'quesited_house': 6},
    'Commitment & Balance (7th)':     {'querent_house': 1,  'quesited_house': 7},
    'Intimacy & Crisis (8th)':        {'querent_house': 1,  'quesited_house': 8},
    'Shared Beliefs & Growth (9th)':  {'querent_house': 1,  'quesited_house': 9},
    'Public Role & Goals (10th)':     {'querent_house': 1,  'quesited_house': 10},
    'Friendship & Hopes (11th)':      {'querent_house': 1,  'quesited_house': 11},
    'Hidden Tensions (12th)':         {'querent_house': 1,  'quesited_house': 12},
    'General Relationship Reading':   {'querent_house': 1},
}


rule_engine.register_discipline('composite', 'Composite', list(_THEME_SLUGS))


def _pack_theme_lookup():
    slugs = {}
    contexts = {}
    for entry in rule_engine._pack_themes_for('composite'):
        label = entry['label']
        if label in _THEME_SLUGS:
            continue
        slugs[label] = entry['slug']
        ctx = entry.get('default_context')
        if ctx:
            contexts[label] = ctx
    return slugs, contexts


def evaluate(theme, composite_chart, context=None):
    """Evaluate a theme against an ALREADY-BUILT composite chart.

    `composite_chart` is a normal Chart object (the midpoint chart). Every
    predicate treats it as a single chart — no two-chart logic here.
    """
    theme_slug = _THEME_SLUGS.get(theme)
    if theme_slug is None:
        pack_slugs, _pack_ctx = _pack_theme_lookup()
        theme_slug = pack_slugs.get(theme)
        if theme_slug is None:
            return []
    if context is None:
        context = DEFAULT_SIGNIFICATORS.get(theme)
        if context is None:
            _slugs, pack_ctx = _pack_theme_lookup()
            context = pack_ctx.get(theme)
    return rule_engine.evaluate('composite', theme_slug, composite_chart,
                                context=context)


def build_and_evaluate(theme, chrt_a, chrt_b, opts, method='composite',
                       context=None):
    """Build the composite chart from two natal charts, then evaluate.

    `method` ∈ {'composite' (midpoint), 'davison' (time/space midpoint)}.
    Returns ([], built_chart=None) on build failure so callers can degrade
    gracefully.
    """
    import compositechart
    try:
        if method == 'davison':
            comp = compositechart.build_davison_chart(chrt_a, chrt_b, opts)
        else:
            comp = compositechart.build_composite_chart(chrt_a, chrt_b, opts)
    except Exception:
        return [], None
    return evaluate(theme, comp, context=context), comp
