# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Mundane discipline binding for the generic rule engine.

Mundane astrology reads charts cast for a place and a public moment — an
ingress (Sun entering a cardinal sign), an eclipse, a great conjunction, a
lunation — to judge the affairs of a nation or city rather than a person.
At the engine level such a chart is a single Chart object cast for the
ingress / eclipse moment at the capital's coordinates, so the SAME
single-chart predicate library applies — no new predicates.

The chart is supplied by the caller: the user casts the ingress / eclipse
moment at the relevant location through the normal "here and now / specific
moment" chart creation, then applies the mundane lens. (A future
convenience could compute the exact ingress instant via
``searchbackend.search`` sign-change and cast it automatically; the lens
works today against any cast chart.)

Mundane house meanings DIFFER from natal — the houses speak of the body
politic, not a native:

  1  the common people / general state of the land
  2  the nation's wealth, treasury, trade
  3  communications, transport, neighbouring states, the press
  4  the land itself, crops, mines, the opposition party, the end of a matter
  5  pleasures, theatres, children born, ambassadors sent, the birth rate
  6  the working classes, public health, the armed services' rank and file
  7  war and foreign relations, treaties, open enemies, fugitives
  8  the nation's death rate, public debt, taxes paid to others
  9  religion, the courts, science, shipping, foreign trade
 10  the government, the head of state, those in authority, national honour
 11  parliament / the legislature, allies, the nation's hopes
 12  prisons, hospitals, secret enemies, crime, hidden sorrows

Drop a manifest with ``[themes.mundane.<slug>]`` blocks to register new
mundane themes — no edit to this file required.
"""

import rule_engine

Alert = rule_engine.Alert
list_packs = rule_engine.list_packs
set_active_packs = rule_engine.set_active_packs


_THEME_SLUGS = {
    'The People (1st)':              'people',
    'National Wealth (2nd)':         'wealth',
    'Communications & Press (3rd)':  'communications',
    'Land & Opposition (4th)':       'land',
    'Births & Pleasures (5th)':      'births',
    'Public Health & Forces (6th)':  'public-health',
    'War & Foreign Relations (7th)': 'war',
    'Death Rate & Public Debt (8th)': 'death-debt',
    'Religion & Courts (9th)':       'religion-courts',
    'Government & Authority (10th)': 'government',
    'Legislature & Allies (11th)':   'legislature',
    'Crime & Hidden Enemies (12th)': 'crime',
    'General State of the Land':     'general',
}


DEFAULT_SIGNIFICATORS = {
    'The People (1st)':               {'querent_house': 1,  'quesited_house': 1},
    'National Wealth (2nd)':          {'querent_house': 1,  'quesited_house': 2},
    'Communications & Press (3rd)':   {'querent_house': 1,  'quesited_house': 3},
    'Land & Opposition (4th)':        {'querent_house': 1,  'quesited_house': 4},
    'Births & Pleasures (5th)':       {'querent_house': 1,  'quesited_house': 5},
    'Public Health & Forces (6th)':   {'querent_house': 1,  'quesited_house': 6},
    'War & Foreign Relations (7th)':  {'querent_house': 1,  'quesited_house': 7},
    'Death Rate & Public Debt (8th)': {'querent_house': 1,  'quesited_house': 8},
    'Religion & Courts (9th)':        {'querent_house': 1,  'quesited_house': 9},
    'Government & Authority (10th)':  {'querent_house': 1,  'quesited_house': 10},
    'Legislature & Allies (11th)':    {'querent_house': 1,  'quesited_house': 11},
    'Crime & Hidden Enemies (12th)':  {'querent_house': 1,  'quesited_house': 12},
    'General State of the Land':      {'querent_house': 1},
}


rule_engine.register_discipline('mundane', 'Mundane', list(_THEME_SLUGS))


def _pack_theme_lookup():
    slugs = {}
    contexts = {}
    for entry in rule_engine._pack_themes_for('mundane'):
        label = entry['label']
        if label in _THEME_SLUGS:
            continue
        slugs[label] = entry['slug']
        ctx = entry.get('default_context')
        if ctx:
            contexts[label] = ctx
    return slugs, contexts


def evaluate(theme, ingress_chart, context=None):
    """Evaluate a theme against a mundane chart (ingress, eclipse, lunation,
    great conjunction) cast for the relevant place. Single Chart object;
    same predicate library as natal."""
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
    return rule_engine.evaluate('mundane', theme_slug, ingress_chart,
                                context=context)
