# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Synastry (relationship-comparison) discipline binding.

Unlike every other discipline, synastry rules read TWO charts — the two
natives, NOT a derived single chart. The shim threads the partner chart
through ``context['partner_chart']`` and the synastry predicate family
(``synastry_aspect``, ``synastry_planet_in_partner_house``,
``synastry_mutual_reception`` in ``corpus_predicates``) reads it. The
primary chart is `chart_a`; the partner is `chart_b`.

This is the one genuinely new engine primitive among the branch additions:
a two-chart predicate signature. Everything else (the loader, the rule
TOML shape, the drop-in pack system, the discipline registry) is unchanged
— synastry packs author `predicate_verdict` rules exactly like any other
discipline, they just use the `synastry_*` predicates.

Themes group the cross-contacts by life-area: attraction, communication,
commitment, conflict, etc. Drop a manifest with ``[themes.synastry.<slug>]``
blocks to register new synastry themes — no edit to this file required.
"""

import rule_engine

Alert = rule_engine.Alert
list_packs = rule_engine.list_packs
set_active_packs = rule_engine.set_active_packs


_THEME_SLUGS = {
    'Attraction & Chemistry':   'attraction',
    'Communication & Mind':     'communication',
    'Affection & Values':       'affection',
    'Commitment & Stability':   'commitment',
    'Conflict & Friction':      'conflict',
    'Overall Compatibility':    'compatibility',
}


# Synastry rules don't pivot on a single querent/quesited house — they read
# cross-contacts — but we still pass a context dict (it carries the partner
# chart). The shim injects ``partner_chart`` at evaluate time; the default
# context here only needs the houses some rules may reference.
DEFAULT_SIGNIFICATORS = {
    'Attraction & Chemistry':   {'querent_house': 1, 'quesited_house': 5},
    'Communication & Mind':     {'querent_house': 1, 'quesited_house': 3},
    'Affection & Values':       {'querent_house': 1, 'quesited_house': 7},
    'Commitment & Stability':   {'querent_house': 1, 'quesited_house': 7},
    'Conflict & Friction':      {'querent_house': 1, 'quesited_house': 7},
    'Overall Compatibility':    {'querent_house': 1, 'quesited_house': 7},
}


rule_engine.register_discipline('synastry', 'Synastry', _THEME_SLUGS)


def _pack_theme_lookup():
    slugs = {}
    contexts = {}
    for entry in rule_engine._pack_themes_for('synastry'):
        label = entry['label']
        if label in _THEME_SLUGS:
            continue
        slugs[label] = entry['slug']
        ctx = entry.get('default_context')
        if ctx:
            contexts[label] = ctx
    return slugs, contexts


def evaluate(theme, chart_a, chart_b, context=None):
    """Evaluate a synastry theme between two natal charts.

    `chart_a` is the primary; `chart_b` the partner. The partner is injected
    into the context as ``partner_chart`` so the two-chart predicate family
    can read it. Returns the alert list (the primary chart drives house
    resolution for any single-chart fields).
    """
    theme_slug = rule_engine.theme_slug_for('synastry', theme)
    if theme_slug is None:
        return []
    if context is None:
        canonical = rule_engine.canonical_theme_label_for(
            'synastry', theme_slug,
        ) or theme
        context = DEFAULT_SIGNIFICATORS.get(canonical)
        if context is None:
            _slugs, pack_ctx = _pack_theme_lookup()
            context = pack_ctx.get(theme) or pack_ctx.get(canonical)
    # Inject the partner chart so synastry_* predicates can read it.
    ctx = dict(context or {})
    ctx['partner_chart'] = chart_b
    return rule_engine.evaluate('synastry', theme_slug, chart_a, context=ctx)
