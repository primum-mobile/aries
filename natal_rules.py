# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Natal discipline binding for the generic rule engine.

Mirror of `horary_rules.py` but:

1. **No quesited.** A natal chart has no question; we read the SAME radix
   through topical lenses. Each theme = a house-topic (1 = body/character,
   2 = wealth, 7 = relationships, 10 = career, …) or planet-topic (Sun =
   vitality, Saturn = discipline, …). Predicates that take an
   ``in_houses`` arg get the topical house directly; predicates that
   reference ``querent_house`` get the same topical house (we set
   ``querent_house = quesited_house = <topic_house>`` so any horary-
   compatible predicate works without modification).

2. **Pack-only from day one.** Same contract as horary: a theme with no
   authored rules simply returns ``[]``.

Drop a manifest at ``corpus/<pack>/manifest.toml`` with
``[themes.natal.<slug>]`` blocks (see ``doc/corpus-pack-authoring.md``),
or drop the pack into the community pack root, and Aries picks up the
new natal theme automatically — no edits to this file required.
"""

import rule_engine

# Re-export so callers can `from natal_rules import Alert, list_packs`.
Alert = rule_engine.Alert
list_packs = rule_engine.list_packs
set_active_packs = rule_engine.set_active_packs


# Built-in topic table. Community packs MAY register additional themes via
# their manifest's ``[themes.natal.<slug>]`` blocks; the engine auto-merges
# pack themes with these built-ins (`rule_engine.theme_labels_for`).
#
# Twelve house-topics + a small planet/feature set. Each label here maps to
# a theme-slug filename under ``corpus/<pack>/rules/natal/<slug>.md``.
_THEME_SLUGS = {
    # House topics — Lilly Vol III + Morin AG 17–22 + Avelar/Ribeiro
    'Body & Character (1st)':       'body-character',
    'Wealth & Possessions (2nd)':   'wealth',
    'Siblings & Communication (3rd)': 'siblings',
    'Home & Parents (4th)':         'home',
    'Children & Pleasure (5th)':    'children',
    'Health & Service (6th)':       'health',
    'Marriage & Partnership (7th)': 'marriage-natal',
    'Death & Inheritance (8th)':    'death-inheritance',
    'Religion & Long Journeys (9th)': 'religion-journey',
    'Career & Honour (10th)':       'career',
    'Friends & Hopes (11th)':       'friends',
    'Enemies & Confinement (12th)': 'enemies',
    # Whole-chart aphorisms (radicality, sect, preponderance — no single house)
    'General Reading':              'general',
}


# Default topic-house per theme. Predicates that read ``querent_house``
# or ``quesited_house`` from context get the topical house, so existing
# horary-style predicates (lord_of_house_in_houses, body_in_houses, etc.)
# work without any natal-specific changes.
DEFAULT_SIGNIFICATORS = {
    'Body & Character (1st)':         {'querent_house': 1,  'quesited_house': 1},
    'Wealth & Possessions (2nd)':     {'querent_house': 1,  'quesited_house': 2},
    'Siblings & Communication (3rd)': {'querent_house': 1,  'quesited_house': 3},
    'Home & Parents (4th)':           {'querent_house': 1,  'quesited_house': 4},
    'Children & Pleasure (5th)':      {'querent_house': 1,  'quesited_house': 5},
    'Health & Service (6th)':         {'querent_house': 1,  'quesited_house': 6},
    'Marriage & Partnership (7th)':   {'querent_house': 1,  'quesited_house': 7},
    'Death & Inheritance (8th)':      {'querent_house': 1,  'quesited_house': 8},
    'Religion & Long Journeys (9th)': {'querent_house': 1,  'quesited_house': 9},
    'Career & Honour (10th)':         {'querent_house': 1,  'quesited_house': 10},
    'Friends & Hopes (11th)':         {'querent_house': 1,  'quesited_house': 11},
    'Enemies & Confinement (12th)':   {'querent_house': 1,  'quesited_house': 12},
    'General Reading':                {'querent_house': 1},
}


# Register this discipline with the engine so the inspector's Discipline
# dropdown picks it up without importing this module directly.
rule_engine.register_discipline('natal', 'Natal', _THEME_SLUGS)


def _pack_theme_lookup():
    """Pull every ``[themes.natal.<slug>]`` block from every loaded pack
    manifest. Returns ``(label_to_slug, label_to_default_context)``.

    Built-ins above win on label collision; pack themes get appended."""
    slugs = {}
    contexts = {}
    for entry in rule_engine._pack_themes_for('natal'):
        label = entry['label']
        if label in _THEME_SLUGS:
            continue
        slugs[label] = entry['slug']
        ctx = entry.get('default_context')
        if ctx:
            contexts[label] = ctx
    return slugs, contexts


def evaluate(theme, chrt, context=None):
    """UI-label entry point. Delegates to ``rule_engine.evaluate()``.

    ``context`` is optional — natal themes default to the topical-house
    context from ``DEFAULT_SIGNIFICATORS``, but a caller (e.g. the dev
    panel) can override.
    """
    theme_slug = rule_engine.theme_slug_for('natal', theme)
    if theme_slug is None:
        return []
    if context is None:
        canonical = rule_engine.canonical_theme_label_for(
            'natal', theme_slug,
        ) or theme
        context = DEFAULT_SIGNIFICATORS.get(canonical)
        if context is None:
            _slugs, pack_ctx = _pack_theme_lookup()
            context = pack_ctx.get(theme) or pack_ctx.get(canonical)
    return rule_engine.evaluate('natal', theme_slug, chrt, context=context)
