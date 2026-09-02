# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Horary discipline binding for the generic rule engine.

Mirrors the shape of `elections_rules.py` but with two differences:

1. **No inline fallback.** Horary is pack-only from day one — there is no
   legacy Python evaluator to fall back to. A theme with no authored
   rules simply returns `[]`.
2. **Context-first.** Every horary question comes with per-question state
   (quesited house, querent house, …) supplied by the UI. Callers MUST
   pass `context=`; predicates need it to resolve significators.

Question-category → theme slug map is seeded with the lost-object
placeholder pack; add entries here as new Lilly / Bonatti / Sahl themes
land in `corpus/<pack>/rules/horary/*.md`.
"""

import rule_engine

# Re-export so callers can `from horary_rules import Alert, list_packs`.
Alert = rule_engine.Alert
list_packs = rule_engine.list_packs
set_active_packs = rule_engine.set_active_packs


# UI label → filesystem theme slug. Extend as new horary categories ship
# pack rules.
_THEME_SLUGS = {
    'Considerations': 'considerations',
    'Lost Object': 'lost-object',
    'Theft': 'theft',
    'Strayed Beast': 'strayed-beast',
    'Marriage Question': 'marriage',
    'Sickness': 'sickness',
    'Absent Person': 'absent-person',
    'Battle / War': 'battle-war',
    'Short Journey': 'short-journey',
    'Long Journey / Voyage': 'long-journey',
    'Pregnancy / Children': 'pregnancy',
    'Honour / Preferment': 'honour',
    'Buying / Selling': 'buying-selling',
    'Treasure / Things Hid': 'treasure-hid',
    'Rumour True or False': 'rumour',
    'Partnership': 'partnership',
    'Removing / Moving': 'removing',
    'Counsel / Advice': 'counsel-advice',
    'Siege / Castle Taken': 'siege',
    # Hephaistion-tradition horary questions migrated from elections —
    # Hephaistion mixes inception and event-chart doctrine in Book III,
    # but these chapters are doctrinally horary (a question about something
    # already underway, not an electional time-picking). Pack files live
    # under `corpus/hephaistion/rules/horary/`.
    'Letters (Heph)':              'letters',
    'Court Case (Heph)':           'courts',
    'Release from Confinement (Heph)': 'imprisoned',
    'Lost Object (Heph)':          'lost-object-heph',
    'Recovering a Runaway (Heph)': 'runaways',
    'Reconciliation (Heph)':       'reconciliation',
    # Dorothean horary aphorisms — Carmen via Hephaistion App. D.
    'Considerations (Dor)':        'considerations',
    # Hephaistion-tradition additions (event-charts, not elections):
    'Decumbiture (Heph)':          'decumbiture',
    'Consultation Chart (Heph)':   'consultation',
}

# Question category → default significator houses. The UI picker feeds
# these into `context` when the user opens a horary chart; pack rules read
# the houses via the context-aware predicates in `corpus_predicates`.
# See doc/horary/lilly-book-ii.md for Lilly's house-taxonomy table.
DEFAULT_SIGNIFICATORS = {
    # General chart-state aphorisms (radicality, considerations before
    # judgment, dignity preponderance) — Lilly CA I Ch.XIX + general
    # Vol 2 doctrine. Theme is question-agnostic; only querent_house
    # is needed.
    'Considerations':    {'querent_house': 1},
    # Moveable lost goods — Lilly CA II "Of Servants fled, Beasts strayed,
    # and things lost". Theft and strayed beasts are now their own themes
    # (different significator framework: theft = L7 the thief; beast = L6
    # the cattle).
    'Lost Object':       {'querent_house': 1, 'quesited_house': 2},
    'Theft': {
        'querent_house': 1, 'quesited_house': 7,
        # Lilly limits his L7-in-Asc querent judgment to questions where
        # there is already just cause to suspect the querent's fidelity.
        # Missing question context must never manufacture that accusation.
        'querent_fidelity_suspicion': 'unspecified',
    },
    'Strayed Beast':     {'querent_house': 1, 'quesited_house': 6},
    'Marriage Question': {
        'querent_house': 1, 'quesited_house': 7,
        'querent_sex': 'unspecified',
    },
    'Sickness':          {'querent_house': 1, 'quesited_house': 6},
    'Absent Person': {
        # Lilly assigns H1 to an unrelated/general absent person.  The user
        # can change this to the turned house of a wife, child, servant, etc.
        'querent_house': 1, 'quesited_house': 1,
        'journey_length': 'unspecified',
    },
    'Battle / War': {
        'querent_house': 1, 'quesited_house': 7,
        'contest_mode': 'unspecified',
    },
    'Short Journey':     {'querent_house': 1, 'quesited_house': 3},
    # Long journey / sea voyage / pilgrimage — Lilly CA II Ch. LXXIV.
    # Significator of the journey = 9th house and its lord, with 8th for
    # gain (8th from 9th is the 4th — but Lilly explicitly uses 10th as
    # "substance of the Journey, because it is the 2nd from the 9th").
    'Long Journey / Voyage': {
        'querent_house': 1, 'quesited_house': 9,
        'journey_question_type': 'unspecified',
        # L9 always signifies the voyage.  Return-of-an-absent clauses need a
        # separate turned-house actor rather than overloading the journey role.
        'absent_house': '1',
    },
    # Pregnancy / children — Lilly CA II "If a Woman aske, whether she
    # may conceive?", "Whether the Querent shall have Children". 5th =
    # the child, 7th = the partner (carries the sex-of-child reading via
    # the sign on the cusp).
    'Pregnancy / Children': {'querent_house': 1, 'quesited_house': 5},
    # Honour / office / preferment — Lilly CA II "Of Government, Office,
    # Dignity, Preferment, or any place of Command or Trust". 10th =
    # the office; Sun is the natural significator of dignity.
    'Honour / Preferment': {'querent_house': 1, 'quesited_house': 10},
    # Buying / selling — Lilly CA II "Of Buying and Selling Lands,
    # Houses, Farmes, &c." + "Of Buying and Selling Commodities".
    # 7th = seller; 4th = the thing; 10th = price. Default quesited
    # is the seller (7th).
    'Buying / Selling': {'querent_house': 1, 'quesited_house': 7},
    # Treasure / things hid — Lilly CA II "To Find A Thing hid or
    # mislaid" + "Of Treasure lying hid in the Ground". 4th = the
    # ground / place; lord of 7 names the thing's nature.
    'Treasure / Things Hid': {
        'querent_house': 1, 'quesited_house': 4,
        'treasure_question_type': 'unspecified',
        'treasure_significator': 'unspecified',
    },
    # Rumour / news — Lilly CA II "If Rumors be True or False, According
    # to the Ancients". 3rd governs news, letters, short reports.
    'Rumour True or False': {'querent_house': 1, 'quesited_house': 3},
    # Partnership — Lilly CA II CHAP. LV. 7th = partner; 2nd =
    # querent's gain; 4th = end.
    'Partnership': {'querent_house': 1, 'quesited_house': 7},
    # Removing / moving — Lilly CA II "Of removing from place to place".
    # 1st = place left, 7th = place going to, 4th = end.
    'Removing / Moving': {'querent_house': 1, 'quesited_house': 7},
    # Counsel / advice — Lilly CA II "Of Counsell or Advice given".
    # 7th = adviser; 10th = the advice itself.
    'Counsel / Advice': {'querent_house': 1, 'quesited_house': 7},
    # Siege of castle / town — Lilly CA II CHAP. LVI. Distinct from
    # the open-battle question: 4th = town/governor, 5th = garrison.
    'Siege / Castle Taken': {'querent_house': 1, 'quesited_house': 4},
    # Hephaistion horary themes — pack-defined defaults stated in each pack
    # file's frontmatter. Repeated here so the UI picker can pre-fill them.
    'Letters (Heph)':              {'querent_house': 1, 'quesited_house': 7},
    'Court Case (Heph)':           {'querent_house': 1, 'quesited_house': 7},
    'Release from Confinement (Heph)': {'querent_house': 1, 'quesited_house': 12},
    'Lost Object (Heph)':          {'querent_house': 1, 'quesited_house': 7},
    'Recovering a Runaway (Heph)': {'querent_house': 10, 'quesited_house': 1},
    'Reconciliation (Heph)':       {'querent_house': 1, 'quesited_house': 7},
    'Considerations (Dor)':        {'querent_house': 1},
    'Decumbiture (Heph)':          {'querent_house': 1, 'quesited_house': 6},
    'Consultation Chart (Heph)':   {'querent_house': 1},
}


# Chart-independent facts used by literal source clauses.  The daemon sends
# this schema to the inspector; React only renders it and forwards the chosen
# stable value in the canonical lens context.  Missing/unspecified choices make
# dependent corpus predicates fail closed.
CONTEXT_OPTIONS = {
    'Theft': ({
        'key': 'querent_fidelity_suspicion',
        'scope': 'question_fact',
        'label_key': 'inspector.querentFidelitySuspicion',
        'options': (
            ('unspecified', 'inspector.contextUnspecified'),
            ('no', 'inspector.suspicionNotJustified'),
            ('justified', 'inspector.suspicionJustified'),
        ),
    },),
    'Battle / War': ({
        'key': 'contest_mode',
        'scope': 'question_fact',
        'label_key': 'inspector.contestMode',
        'options': (
            ('unspecified', 'inspector.contextUnspecified'),
            ('lawsuit', 'inspector.contestLawsuit'),
            ('war', 'inspector.contestWar'),
        ),
    },),
    'Long Journey / Voyage': ({
        'key': 'journey_question_type',
        'scope': 'question_fact',
        'label_key': 'inspector.journeyQuestionType',
        'options': (
            ('unspecified', 'inspector.contextUnspecified'),
            ('voyage', 'inspector.journeyVoyage'),
            ('return_speed', 'inspector.journeyReturnSpeed'),
            ('absent_return', 'inspector.journeyAbsentReturn'),
            ('journey_cause', 'inspector.journeyCause'),
        ),
    }, {
        'key': 'absent_house',
        'scope': 'question_fact',
        'label_key': 'inspector.absentHouse',
        # Numerals are locale-neutral option labels; the field label itself is
        # localized in every shipped catalog.
        'options': tuple(
            (str(house), str(house)) for house in range(1, 13)
        ),
    }),
    'Absent Person': ({
        'key': 'journey_length',
        'scope': 'question_fact',
        'label_key': 'inspector.journeyLength',
        'options': (
            ('unspecified', 'inspector.contextUnspecified'),
            ('short', 'inspector.journeyShort'),
            ('moderate', 'inspector.journeyModerate'),
            ('long', 'inspector.journeyLong'),
            ('very_long', 'inspector.journeyVeryLong'),
        ),
    },),
    'Marriage Question': ({
        'key': 'querent_sex',
        'scope': 'question_fact',
        'label_key': 'inspector.querentSex',
        'options': (
            ('unspecified', 'inspector.contextUnspecified'),
            ('man', 'inspector.sexMan'),
            ('woman', 'inspector.sexWoman'),
        ),
    },),
    'Treasure / Things Hid': ({
        'key': 'treasure_question_type',
        'scope': 'question_fact',
        'label_key': 'inspector.treasureQuestionType',
        'options': (
            ('unspecified', 'inspector.contextUnspecified'),
            ('own_hidden_goods', 'inspector.treasureOwnHiddenGoods'),
            ('absolute_treasure', 'inspector.treasureAbsolute'),
            ('acquisition', 'inspector.treasureAcquisition'),
        ),
    }, {
        'key': 'treasure_significator',
        'scope': 'question_fact',
        'label_key': 'inspector.treasureSignificator',
        'options': (
            ('unspecified', 'inspector.contextUnspecified'),
            ('lord_4', 'inspector.treasureLord4'),
            ('sun', 'astrocart.point.sun'),
            ('moon', 'astrocart.point.moon'),
            ('mercury', 'astrocart.point.mercury'),
            ('venus', 'astrocart.point.venus'),
            ('mars', 'astrocart.point.mars'),
            ('jupiter', 'astrocart.point.jupiter'),
            ('saturn', 'astrocart.point.saturn'),
        ),
    },),
}


# Register this discipline with the engine so the inspector's Discipline
# dropdown knows about it without importing this module directly.
rule_engine.register_discipline('horary', 'Horary', _THEME_SLUGS)
for _context_label, _context_defaults in DEFAULT_SIGNIFICATORS.items():
    _context_slug = _THEME_SLUGS.get(_context_label)
    if _context_slug is None:
        continue
    rule_engine.register_question_context_fields(
        'horary', _context_slug,
        set(_context_defaults) | {
            field['key']
            for field in CONTEXT_OPTIONS.get(_context_label, ())
        },
    )


def _pack_theme_lookup():
    """Pull every `[themes.horary.<slug>]` block from every loaded pack
    manifest. Returns ``(label_to_slug, label_to_default_context)``.

    Community packs drop a manifest into either the bundled corpus root
    or ``~/Library/Application Support/Aries/packs/`` and the discipline
    shim auto-picks up the new theme — no edits to ``_THEME_SLUGS`` or
    ``DEFAULT_SIGNIFICATORS`` needed. Built-ins (this module's hardcoded
    dicts) still win on collision."""
    slugs = {}
    contexts = {}
    for entry in rule_engine._pack_themes_for('horary'):
        label = entry['label']
        if label in _THEME_SLUGS:
            continue  # built-ins win
        slugs[label] = entry['slug']
        ctx = entry.get('default_context')
        if ctx:
            contexts[label] = ctx
    return slugs, contexts


def evaluate(theme, chrt, context=None):
    """UI-label entry point. Delegates to rule_engine.evaluate().

    `context` should be a dict carrying at minimum `querent_house` and
    `quesited_house`. When None, `DEFAULT_SIGNIFICATORS[theme]` is used.
    """
    theme_slug = rule_engine.theme_slug_for('horary', theme)
    if theme_slug is None:
        return []
    if context is None:
        canonical = rule_engine.canonical_theme_label_for(
            'horary', theme_slug,
        ) or theme
        fallback_context = DEFAULT_SIGNIFICATORS.get(canonical)
        if fallback_context is None:
            _slugs, pack_ctx = _pack_theme_lookup()
            fallback_context = pack_ctx.get(theme) or pack_ctx.get(canonical)
        # Core values are fallbacks, not an authored user answer.  Mark their
        # origin so each owning pack's explicit non-house question default can
        # win while core house roles and compatibility-only facts still fill
        # genuinely absent fields.
        context = {
            '_corpus_core_question_defaults': dict(fallback_context or {}),
        }
    return rule_engine.evaluate('horary', theme_slug, chrt, context=context)
