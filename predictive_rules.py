# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Predictive discipline binding for the generic rule engine.

Predictive astrology reads a TIMED / DERIVED chart — a solar or lunar
return, a profected chart, a secondary/tertiary/minor progression, a
solar-arc chart — to describe a period of life rather than the whole
nativity. At the engine level each of these is a single Chart object that
the daemon already builds (``webapp.daemon.supplementary_service`` /
``engine.supplementary_adapter``; the wx oracle builds the same charts
through ``chart_session``). So predictive is another *derived-single-chart*
discipline: the dispatch layer resolves the timed chart, and this shim
evaluates it through the SAME single-chart predicate library as natal and
composite — no new predicates.

The themes are the twelve topical houses (read on the timed chart: "Career
This Year" = the solar-return 10th, etc.) plus a whole-chart "Year Ahead"
reading. The distinction from natal is purely WHICH chart the rules run on
— the discipline slug ``predictive`` lets packs ship rules framed for a
period ("Saturn crosses the return Ascendant — a heavy year") rather than
for the life.

The caller supplies the timed chart (the daemon resolves it via the active
``supplementary_kind``). Drop a manifest with ``[themes.predictive.<slug>]``
blocks to register new predictive themes — no edit to this file required.
"""

import rule_engine

Alert = rule_engine.Alert
list_packs = rule_engine.list_packs
set_active_packs = rule_engine.set_active_packs


_THEME_SLUGS = {
    'Year Ahead (Whole Chart)':       'year-ahead',
    'Body & Vitality (1st)':          'body',
    'Money This Period (2nd)':        'money',
    'Movement & News (3rd)':          'movement',
    'Home & Family (4th)':            'home',
    'Romance & Children (5th)':       'romance',
    'Work & Health (6th)':            'work-health',
    'Relationships (7th)':            'relationships',
    'Crisis & Shared Money (8th)':    'crisis',
    'Travel & Learning (9th)':        'travel-learning',
    'Career & Status (10th)':         'career',
    'Friends & Gains (11th)':         'gains',
    'Troubles & Retreat (12th)':      'troubles',
}


DEFAULT_SIGNIFICATORS = {
    'Year Ahead (Whole Chart)':       {'querent_house': 1},
    'Body & Vitality (1st)':          {'querent_house': 1,  'quesited_house': 1},
    'Money This Period (2nd)':        {'querent_house': 1,  'quesited_house': 2},
    'Movement & News (3rd)':          {'querent_house': 1,  'quesited_house': 3},
    'Home & Family (4th)':            {'querent_house': 1,  'quesited_house': 4},
    'Romance & Children (5th)':       {'querent_house': 1,  'quesited_house': 5},
    'Work & Health (6th)':            {'querent_house': 1,  'quesited_house': 6},
    'Relationships (7th)':            {'querent_house': 1,  'quesited_house': 7},
    'Crisis & Shared Money (8th)':    {'querent_house': 1,  'quesited_house': 8},
    'Travel & Learning (9th)':        {'querent_house': 1,  'quesited_house': 9},
    'Career & Status (10th)':         {'querent_house': 1,  'quesited_house': 10},
    'Friends & Gains (11th)':         {'querent_house': 1,  'quesited_house': 11},
    'Troubles & Retreat (12th)':      {'querent_house': 1,  'quesited_house': 12},
}


rule_engine.register_discipline('predictive', 'Predictive', _THEME_SLUGS)


def _pack_theme_lookup():
    slugs = {}
    contexts = {}
    for entry in rule_engine._pack_themes_for('predictive'):
        label = entry['label']
        if label in _THEME_SLUGS:
            continue
        slugs[label] = entry['slug']
        ctx = entry.get('default_context')
        if ctx:
            contexts[label] = ctx
    return slugs, contexts


def evaluate(theme, timed_chart, context=None):
    """Evaluate a theme against a timed/derived chart (solar return,
    progression, profected chart, …). The dispatch layer resolves the
    chart from the active supplementary kind and passes it here as a
    single Chart object."""
    theme_slug = rule_engine.theme_slug_for('predictive', theme)
    if theme_slug is None:
        return []
    if context is None:
        canonical = rule_engine.canonical_theme_label_for(
            'predictive', theme_slug,
        ) or theme
        context = DEFAULT_SIGNIFICATORS.get(canonical)
        if context is None:
            _slugs, pack_ctx = _pack_theme_lookup()
            context = pack_ctx.get(theme) or pack_ctx.get(canonical)
    return rule_engine.evaluate('predictive', theme_slug, timed_chart,
                                context=context)
