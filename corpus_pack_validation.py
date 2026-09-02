#!/usr/bin/env python3
# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Lint a community corpus pack before shipping it.

Usage:
    python3 tools/validate_pack.py <pack_dir>
    python3 tools/validate_pack.py ~/Library/Application\\ Support/Aries/packs/witchcraft_grimoire

Checks:
    1. `manifest.toml` exists and is valid TOML.
    2. Required manifest fields and declared disciplines/capabilities.
    3. Each `[themes.<discipline>.<slug>]` block has a label.
    4. For every rule .md under `rules/<discipline>/`:
         - every `toml rule` block parses
         - has id, kind, predicate (or other supported kind), title, body, cite
         - predicate name is registered in corpus_predicates.PREDICATES
         - timing block (if present) is well-formed
    5. Optionally smoke-evaluate against a reference chart (--smoke).

Exit code 0 = clean. Non-zero = errors found.
"""
from __future__ import annotations

import argparse
import inspect
import math
import os
import re
import sys
from pathlib import Path

try:
    import tomllib
except ImportError:
    import tomli as tomllib  # type: ignore

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import corpus_predicates  # noqa: E402
import corpus_semantics  # noqa: E402

_RULE_BLOCK_RE = re.compile(r'```toml rule\n(.*?)```', re.DOTALL)

_COMMON_RULE_FIELDS = ('id', 'kind', 'title', 'cite')
_SUPPORTED_KINDS = {
    'predicate_verdict', 'predicate_condition', 'predicate_finding',
    'moon_sign_lookup', 'source_note',
    'axis_assignment',
}
_SUPPORTED_STATUSES = {'good', 'caution', 'avoid', 'info'}
_ORB_POLICIES = corpus_semantics.ORB_POLICIES
_POINT_ORB_POLICIES = corpus_semantics.POINT_ORB_POLICIES
_HOUSE_FRAMES = corpus_semantics.HOUSE_FRAMES
_ASPECT_FRAMES = corpus_semantics.ASPECT_FRAMES
_SIGN_ASPECT_FRAMES = {'sign', 'whole_sign', 'sign_configuration'}
_POINT_FRAMES = corpus_semantics.POINT_FRAMES
_DIGNITY_FRAMES = corpus_semantics.DIGNITY_FRAMES
_SIGN_POINT_FRAMES = {'sign', 'whole_sign', 'sign_configuration'}
_UNRESOLVED_POINT_FRAMES = {'unresolved'}
_BODY_SIGN_CONFIGURATION_PREDICATES = {
    'bodies_configure_by_sign', 'body_overcomes_body',
}
_BODY_SEMANTIC_RELATION_PREDICATES = {
    'benefic_configures_body',
    'benefic_witnessing_luminaries',
    'both_luminaries_aspect_each_other_in_angles',
    'lords_asc_moon_aversion',
    'lord_of_house_aspects_moon_dispositor',
    'malefic_configures_body',
    'mars_saturn_aspecting_venus',
    'moon_aspects_body',
    'moon_dispositor_aspects_moon',
    'moon_in_scorpio_with_mars',
    'moon_in_signs_with_benefic_aspect',
    'moon_in_signs_without_benefic_aspect',
    'planet_aspects_body',
}
_BODY_DEGREE_RELATION_PREDICATES = (
    _BODY_SEMANTIC_RELATION_PREDICATES |
    {'is_applying_between', 'is_separating_between'}
)
_POINT_SIGN_CONFIGURATION_PREDICATES = {
    'body_configures_point_by_sign', 'moon_configures_point_by_sign',
    'body_overcomes_lot_of_fortune', 'point_in_signs',
}
_POINT_RELATION_PREDICATES = {
    'benefic_aspects_point', 'benefic_on_asc_no_malefic_on_mc',
    'benefic_on_point', 'body_aspects_point', 'body_near_fixed_star',
    'body_on_point',
    'both_luminaries_aspect_house', 'malefic_on_point',
    'moon_aspects_point', 'moon_configures_point_by_sign',
    'lord_of_house_aspects_point',
    'lord_of_house_near_fixed_star', 'moon_dispositor_aspects_point',
    'lot_of_fortune_aspects_point',
    'lot_of_fortune_aspects_body',
    'lot_of_fortune_aspects_moon_dispositor',
    'part_of_fortune_lord_aspects_fortune',
    'moon_on_nodes', 'south_node_aspects_body',
    'pivot_malefic_retrograde',
    'body_configures_point_by_sign',
    'body_overcomes_lot_of_fortune',
    'point_in_signs',
}
_CONTEXT_HOUSE_ARGUMENTS = {
    ('lilly_lord_impeded', 'house'),
    ('lilly_lord_unimpeded', 'house'),
    ('lilly_lord_free_from_infortunes', 'house'),
    ('lilly_lord_swift', 'house'),
    ('lilly_lord_direct', 'house'),
    ('lilly_lord_oriental', 'house'),
    ('lilly_lord_occidental', 'house'),
    ('lilly_lord_in_house_unimpeded', 'lord_house'),
    ('lilly_lord_in_house_unimpeded', 'in_house'),
    ('lord_of_house_aspects_point', 'house'),
    ('lord_of_house_cazimi', 'house'),
    ('lord_of_house_under_beams', 'house'),
    ('lord_of_house_solar_phase', 'house'),
    ('lord_of_house_additive_in_numbers', 'house'),
}
_ORBLESS_ORDER_PREDICATES = {
    'body_besieged', 'body_beleaguered', 'body_overcomes_body',
    'body_overcomes_lot_of_fortune',
    'lord_of_house_besieged', 'lord_of_house_beleaguered',
}
_STATION_POLICY_ARGUMENTS = {
    'planet_stationary': 'policy',
    'any_stationary': 'policy',
    'lord_asc_stationary': 'policy',
    'lord_of_house_stationary': 'policy',
    'planet_direct_and_free': 'station_policy',
}
_STATION_POLICIES = {
    'source_phrase_only', 'exact_event_day', 'within_one_day',
}
_ANCIENT_VISIBILITY_POLICIES = {
    'hellenistic_15_degree', 'astronomical_visibility',
    'chart_selected', 'source_phrase_only',
}
_DOROTHEUS_FIXING_PLACE_POLICIES = {
    'same_sign', 'same_place', 'source_phrase_only',
}
_PHASIS_TRANSITION_POLICIES = {
    'exact_event_day', 'within_three_days', 'within_seven_days',
    'source_phrase_only',
}
_LUNAR_PHASE_POLICIES = {
    'exact_event_day', 'within_one_day', 'within_three_days',
    'source_phrase_only',
}
_LUNAR_PHASES = {
    'assembly', 'new_moon', 'diameter', 'full_moon',
    'one_sign_after_assembly',
}
_LUNAR_OBSCURATION_POLICIES = {
    'hellenistic_15_degree', 'exact_assembly_day',
    'within_one_day_of_assembly', 'source_phrase_only',
}
_LUNAR_OBSCURATION_STATES = {'under_rays', 'free_of_rays'}
_HEPHAISTION_FOUNDATION_ECLIPSE_READINGS = {
    'dykes_2013_two_eclipse_branches', 'source_phrase_only',
}
_ANCIENT_SOLAR_PHASES = {
    'under_rays', 'out_of_rays', 'visible',
    'toward_rising', 'toward_setting',
    'eastern', 'morning_visible', 'western', 'evening_visible',
    'rising', 'setting', 'morning_rising', 'evening_rising',
    'morning_setting', 'evening_setting',
}
_SOURCE_FIDELITIES = {
    'literal', 'interpretive', 'disputed', 'approximation', 'unclassified',
}
SOURCE_NOTE_ROLES = frozenset({
    'owned_fragment', 'owned_metadata', 'duplicate_alias',
    'irreducible_fragment', 'cross_reference', 'source_method',
    'requires_projection', 'undefined_threshold',
    'bounded_source_ambiguity', 'undefined_source_term',
})
_SOURCE_NOTE_RULE_OWNER_ROLES = frozenset({
    'owned_fragment', 'duplicate_alias', 'cross_reference',
})
_SOURCE_NOTE_TOKEN_RE = re.compile(r'^[a-z][a-z0-9_]{0,127}$')
_SEMANTIC_FIELDS = corpus_semantics.SEMANTIC_ALLOWED_VALUES

_CONTEXT_OPTION_KEY_RE = re.compile(r'^[a-z][a-z0-9_]{0,63}$')
_CONTEXT_OPTION_VALUE_RE = re.compile(r'^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$')
_LOCALIZATION_KEY_RE = re.compile(
    r'^[a-z][A-Za-z0-9_-]*(?:\.[A-Za-z0-9_-]+)+$',
)
_CONTEXT_OPTION_RESERVED_KEYS = {'querent_house', 'quesited_house'}
_CONTEXT_OPTION_SCOPES = {'global_doctrine', 'question_fact'}
_CONTEXT_OPTION_MAX_FIELDS = 16
_CONTEXT_OPTION_MAX_VALUES = 64
_KNOWN_CONTEXT_OPTION_VALUES = {
    'station_admission_policy': set(_STATION_POLICIES),
    'ancient_visibility_policy': set(_ANCIENT_VISIBILITY_POLICIES),
    'phasis_transition_policy': set(_PHASIS_TRANSITION_POLICIES),
    'lunar_phase_admission_policy': set(_LUNAR_PHASE_POLICIES),
    'lunar_obscuration_policy': set(_LUNAR_OBSCURATION_POLICIES),
    'ancient_harm_policy': {
        'malefic_testimony', 'source_phrase_only',
    },
    'ancient_place_policy': {
        'timaeus_seven', 'nechepso_eight', 'source_phrase_only',
    },
    'hephaistion_additive_policy': {
        'direct_motion', 'increasing_longitude_speed',
        'source_phrase_only',
    },
    'hephaistion_harmony_policy': {
        'whole_sign_trine', 'profile_trine', 'source_phrase_only',
    },
    'hephaistion_conception_lot_policy': {
        'lot_of_fortune', 'source_phrase_only',
    },
    'hephaistion_foundation_eclipse_reading': set(
        _HEPHAISTION_FOUNDATION_ECLIPSE_READINGS
    ),
    'hephaistion_farming_activity': {
        'unselected', 'general_tillage', 'planting', 'sowing',
        'fallow_land', 'harvest', 'vineyards', 'livestock',
        'orchards_gardens', 'renewal',
    },
    'hephaistion_favor_well_placed_scope': {
        'named_three_each_well_placed',
        'at_least_one_configured_well_placed', 'source_phrase_only',
    },
    'hephaistion_connection_policy': {
        'antiochus_moon_13_degree', 'configured_orbs',
        'source_phrase_only',
    },
    'hephaistion_rich_endowment_policy': {
        'hephaistion_iii38_fourfold', 'source_phrase_only',
    },
    'hephaistion_court_strength_aggregation': {
        'strict_factor_dominance', 'equal_factor_count',
        'source_phrase_only',
    },
    'hephaistion_court_strength_tie_policy': {
        'report_tie', 'suppress_tie', 'source_phrase_only',
    },
    'hephaistion_court_contact_aspect_set': {
        'co_presence_and_classical', 'classical_without_co_presence',
        'source_phrase_only',
    },
    'hephaistion_court_contact_course': {
        'moon_sign', 'pair_signs', 'unbounded', 'source_phrase_only',
    },
    'hephaistion_court_contact_tie_policy': {
        'require_unique', 'co_roles', 'source_phrase_only',
    },
    'ancient_good_phase_policy': {
        'visible', 'eastern_visible', 'source_phrase_only',
    },
    'dorotheus_friend_person_class': {
        'unselected', 'soldier', 'ruler', 'king', 'tiller',
    },
    'recovery_clock_selection': {
        'all_witnesses', 'earliest_physical',
        'recovery_before_hope_then_earliest',
    },
    'recovery_timing_place_basis': {
        'both_candidates', 'current_place', 'perfection_place',
    },
    'recovery_timing_unit': {
        'unselected', 'hours', 'days', 'weeks', 'months', 'years',
    },
}

_TIMING_OPTIONAL_FIELDS = {
    'from', 'from_kind', 'from_house', 'from_house_key',
    'to', 'to_body', 'house', 'house_key',
    'aspects', 'unit',
}
_RECOVERY_TIMING_FIELDS = {'clock', 'mode', 'grade', 'reason'}
_RECOVERY_TIMING_CLOCKS = {'perfection', 'none'}
_RECOVERY_TIMING_MODES = {
    'body_pair', 'fixed_point', 'translation_final_leg',
}
_RECOVERY_TIMING_GRADES = {'recovery', 'hope'}
_RECOVERY_NO_CLOCK_REASONS = {
    'placement_only', 'condition_only', 'geometry_only',
    'placement_and_motion_state',
    'paired_snapshot_without_single_perfection', 'dignity_only',
}


def _finite_number(value):
    return (
        isinstance(value, (int, float))
        and not isinstance(value, bool)
        and math.isfinite(float(value))
    )


def _validate_predicate_argument_types(pname, args, fn, where, errors):
    """Reject shapes that permissive ``**kwargs`` would otherwise swallow."""
    parameters = inspect.signature(fn).parameters
    for name, value in args.items():
        if name in corpus_semantics.SEMANTIC_FIELDS or name == 'conditions':
            continue
        parameter = parameters.get(name)
        if parameter is None:
            continue  # unknown-name reporting is handled by the caller
        default = parameter.default
        if (pname, name) in _CONTEXT_HOUSE_ARGUMENTS:
            valid = (
                isinstance(value, (int, str))
                and not isinstance(value, bool)
            )
        elif isinstance(default, bool):
            valid = isinstance(value, bool)
        elif isinstance(default, (int, float)) and not isinstance(default, bool):
            valid = _finite_number(value)
        elif isinstance(default, str):
            valid = isinstance(value, str)
        elif isinstance(default, (tuple, list, set, frozenset)):
            valid = isinstance(value, (list, tuple))
        elif isinstance(default, dict):
            valid = isinstance(value, dict)
        elif default is None and name in ('directions',):
            valid = isinstance(value, (list, tuple))
        elif default is None and (
                name == 'orb' or name.endswith('_orb') or
                name in ('threshold', 'stat_threshold', 'margin')):
            valid = _finite_number(value)
        elif default is None and (
                name == 'house' or name.endswith('_house') or
                name in ('house_a', 'house_b', 'reference_lord_of')):
            valid = isinstance(value, (int, str)) and not isinstance(value, bool)
        else:
            valid = True
        if not valid:
            _err(errors, where,
                 f'{pname}.{name} has invalid value type '
                 f'{type(value).__name__}')

    for name in ('aspects', 'houses', 'in_houses', 'places', 'signs', 'bodies',
                 'directions', 'levels', 'reception_levels',
                 'separating_houses'):
        if name not in args or not isinstance(args[name], (list, tuple)):
            continue
        values = tuple(args[name])
        if not values:
            _err(errors, where, f'{pname}.{name} must not be empty')
            continue
        if name == 'aspects' and not all(
                _finite_number(value) and 0.0 <= float(value) <= 180.0
                for value in values):
            _err(errors, where,
                 f'{pname}.aspects must contain finite angles from 0 to 180')
        elif name in ('houses', 'in_houses', 'places', 'separating_houses') \
                and not all(isinstance(value, int) and not isinstance(value, bool)
                            and 1 <= value <= 12 for value in values):
            _err(errors, where,
                 f'{pname}.{name} must contain house/place numbers 1..12')
        elif name == 'signs' and not all(
                isinstance(value, int) and not isinstance(value, bool)
                and 0 <= value <= 11 for value in values):
            _err(errors, where,
                 f'{pname}.signs must contain sign indexes 0..11')
        elif name == 'bodies' and not all(
                isinstance(value, str) and value.strip().lower() in {
                    'mercury', 'venus', 'mars', 'jupiter', 'saturn',
                }
                for value in values):
            _err(errors, where,
                 f'{pname}.bodies must contain classical stellar planets')
        elif name == 'directions' and not all(
                value in ('applying', 'separating', 'exact')
                for value in values):
            _err(errors, where,
                 f'{pname}.directions contains an unsupported phase')
        elif name in ('levels', 'reception_levels') and not all(
                value in ('domicile', 'exaltation', 'triplicity', 'term', 'face')
                for value in values):
            _err(errors, where,
                 f'{pname}.{name} contains an unsupported dignity level')

    segments = args.get('segments')
    if segments is not None and isinstance(segments, (list, tuple)):
        for index, segment in enumerate(segments):
            if not isinstance(segment, dict):
                _err(errors, where,
                     f'{pname}.segments[{index}] must be a table')
                continue
            sign = segment.get('sign')
            lower = segment.get('deg_from')
            upper = segment.get('deg_to')
            if (not isinstance(sign, int) or isinstance(sign, bool) or
                    not 0 <= sign <= 11 or not _finite_number(lower) or
                    not _finite_number(upper) or
                    not 0.0 <= float(lower) <= float(upper) <= 30.0):
                _err(errors, where,
                     f'{pname}.segments[{index}] has invalid sign/degree bounds')


def _err(errors, path, msg):
    errors.append(f'  [{path}] {msg}')


def source_note_metadata_errors(data: dict) -> list[str]:
    """Return structural errors for one explicitly non-voting source note.

    A source note is not an untyped TODO.  Its role says whether executable
    logic owns the fragment, a runtime contract owns metadata, the note is a
    cross-reference or source method, or a specific missing source/capability
    prevents a vote.  Pack-level validation separately verifies rule owners.
    """
    errors = []
    role = data.get('source_note_role')
    if role not in SOURCE_NOTE_ROLES:
        errors.append(
            'source_note_role must be one of '
            f'{sorted(SOURCE_NOTE_ROLES)}'
        )
        return errors

    owners = data.get('owner_rule_ids')
    owner_contract = data.get('owner_contract')
    required_capability = data.get('required_capability')
    undefined_field = data.get('undefined_field')
    ambiguity_key = data.get('ambiguity_key')
    method_scope = data.get('method_scope')

    if owners is not None and (
            not isinstance(owners, list) or not owners
            or any(not isinstance(value, str)
                   or not _SOURCE_NOTE_TOKEN_RE.fullmatch(value)
                   for value in owners)
            or len(set(owners)) != len(owners)):
        errors.append('owner_rule_ids must be unique stable rule ids')
    if role in _SOURCE_NOTE_RULE_OWNER_ROLES and not owners:
        errors.append(f'{role} requires owner_rule_ids')
    if role not in _SOURCE_NOTE_RULE_OWNER_ROLES and owners is not None:
        errors.append(f'{role} must not declare owner_rule_ids')

    token_fields = {
        'owner_contract': owner_contract,
        'required_capability': required_capability,
        'undefined_field': undefined_field,
        'ambiguity_key': ambiguity_key,
        'method_scope': method_scope,
    }
    for field, value in token_fields.items():
        if value is not None and (
                not isinstance(value, str)
                or not _SOURCE_NOTE_TOKEN_RE.fullmatch(value)):
            errors.append(f'{field} must be a stable snake_case token')

    required_by_role = {
        'owned_metadata': ('owner_contract', owner_contract),
        'requires_projection': ('required_capability', required_capability),
        'undefined_threshold': ('undefined_field', undefined_field),
        'undefined_source_term': ('undefined_field', undefined_field),
        'bounded_source_ambiguity': ('ambiguity_key', ambiguity_key),
        'source_method': ('method_scope', method_scope),
    }
    required = required_by_role.get(role)
    if required is not None and not required[1]:
        errors.append(f'{role} requires {required[0]}')

    allowed_by_role = {
        'owned_metadata': {'owner_contract'},
        'requires_projection': {'required_capability'},
        'undefined_threshold': {'undefined_field'},
        'undefined_source_term': {'undefined_field'},
        'bounded_source_ambiguity': {'ambiguity_key'},
        'source_method': {'method_scope'},
    }
    allowed = allowed_by_role.get(role, set())
    for field, value in token_fields.items():
        if value is not None and field not in allowed:
            errors.append(f'{role} must not declare {field}')
    return errors


def normalize_theme_context_options(spec: dict) -> list[dict]:
    """Validate and normalize one manifest theme's selectable context.

    The returned shape is safe to expose verbatim through the daemon catalog.
    Values are deliberately bounded stable tokens and labels are localization
    keys, never authored markup or an unbounded data channel.  Callers loading
    packs permissively may catch ``ValueError`` and drop the complete block;
    strict authoring/runtime validation reports the same error and rejects it.
    """
    raw_fields = spec.get('context_options')
    if raw_fields is None:
        return []
    if not isinstance(raw_fields, list):
        raise ValueError('context_options must be an array of tables')
    if not raw_fields:
        raise ValueError('context_options must not be empty')
    if len(raw_fields) > _CONTEXT_OPTION_MAX_FIELDS:
        raise ValueError(
            f'context_options exceeds {_CONTEXT_OPTION_MAX_FIELDS} fields',
        )

    normalized = []
    seen_keys = set()
    for field_index, field in enumerate(raw_fields):
        where = f'context_options[{field_index}]'
        if not isinstance(field, dict):
            raise ValueError(f'{where} must be a table')
        unknown = sorted(
            set(field) - {
                'key', 'label_key', 'options', 'scope', 'preference_key',
            },
        )
        if unknown:
            raise ValueError(f'{where} has unsupported field(s) {unknown}')
        key = field.get('key')
        if not isinstance(key, str) or not _CONTEXT_OPTION_KEY_RE.fullmatch(key):
            raise ValueError(f'{where}.key must be a stable snake_case token')
        if key in _CONTEXT_OPTION_RESERVED_KEYS:
            raise ValueError(
                f'{where}.key "{key}" is reserved for the typed house picker',
            )
        if key in seen_keys:
            raise ValueError(f'duplicate context_options key "{key}"')
        seen_keys.add(key)

        # Older/community packs did not distinguish persistent doctrine from
        # chart-specific question facts.  Keep those declarations on the
        # historical per-question path unless the pack opts into the explicit
        # global doctrine contract.
        scope = field.get('scope', 'question_fact')
        if scope not in _CONTEXT_OPTION_SCOPES:
            raise ValueError(
                f'{where}.scope must be global_doctrine or question_fact',
            )
        preference_key = field.get('preference_key')
        if preference_key is not None:
            if scope != 'global_doctrine':
                raise ValueError(
                    f'{where}.preference_key requires global_doctrine scope',
                )
            if (not isinstance(preference_key, str) or
                    not _CONTEXT_OPTION_KEY_RE.fullmatch(preference_key)):
                raise ValueError(
                    f'{where}.preference_key must be a stable snake_case token',
                )

        label_key = field.get('label_key')
        if (not isinstance(label_key, str) or
                not _LOCALIZATION_KEY_RE.fullmatch(label_key)):
            raise ValueError(
                f'{where}.label_key must be a stable localization key',
            )
        raw_options = field.get('options')
        if not isinstance(raw_options, list) or not raw_options:
            raise ValueError(f'{where}.options must be a non-empty array')
        if len(raw_options) > _CONTEXT_OPTION_MAX_VALUES:
            raise ValueError(
                f'{where}.options exceeds {_CONTEXT_OPTION_MAX_VALUES} values',
            )

        options = []
        seen_values = set()
        for option_index, option in enumerate(raw_options):
            option_where = f'{where}.options[{option_index}]'
            if not isinstance(option, dict):
                raise ValueError(f'{option_where} must be a table')
            unknown = sorted(set(option) - {'value', 'label_key'})
            if unknown:
                raise ValueError(
                    f'{option_where} has unsupported field(s) {unknown}',
                )
            value = option.get('value')
            if (not isinstance(value, str) or
                    not _CONTEXT_OPTION_VALUE_RE.fullmatch(value)):
                raise ValueError(
                    f'{option_where}.value must be a bounded stable token',
                )
            if value in seen_values:
                raise ValueError(
                    f'{where}.options has duplicate value "{value}"',
                )
            seen_values.add(value)
            option_label_key = option.get('label_key')
            if (not isinstance(option_label_key, str) or
                    not _LOCALIZATION_KEY_RE.fullmatch(option_label_key)):
                raise ValueError(
                    f'{option_where}.label_key must be a stable '
                    'localization key',
                )
            options.append({
                'value': value,
                'label_key': option_label_key,
            })

        if key not in spec:
            raise ValueError(
                f'context_options key "{key}" requires a theme default',
            )
        default = spec[key]
        if not isinstance(default, str) or default not in seen_values:
            raise ValueError(
                f'theme default {key} must be one declared option value',
            )
        known_values = _KNOWN_CONTEXT_OPTION_VALUES.get(key)
        if known_values is not None and seen_values != known_values:
            raise ValueError(
                f'context_options key "{key}" must declare exactly '
                f'{sorted(known_values)}',
            )
        normalized_field = {
            'key': key,
            'label_key': label_key,
            'options': options,
            'scope': scope,
        }
        if scope == 'global_doctrine':
            normalized_field['preference_key'] = preference_key or key
        normalized.append(normalized_field)
    return normalized


def _validate_manifest(pack_dir: Path, errors: list) -> dict:
    manifest_path = pack_dir / 'manifest.toml'
    if not manifest_path.is_file():
        _err(errors, manifest_path, 'manifest.toml missing')
        return {}
    try:
        with manifest_path.open('rb') as f:
            manifest = tomllib.load(f)
    except Exception as exc:
        _err(errors, manifest_path, f'invalid TOML: {exc}')
        return {}
    pack = manifest.get('pack') or {}
    for field in ('id', 'name'):
        if not pack.get(field):
            _err(errors, manifest_path, f'pack.{field} missing or empty')
    disciplines = pack.get('disciplines')
    capabilities = pack.get('capabilities')
    if not isinstance(disciplines, list):
        _err(errors, manifest_path, 'pack.disciplines must be an array')
        disciplines = []
    if capabilities is not None and not isinstance(capabilities, list):
        _err(errors, manifest_path, 'pack.capabilities must be an array')
        capabilities = []
    capabilities = capabilities or []
    if not all(isinstance(value, str) for value in capabilities):
        _err(errors, manifest_path, 'pack.capabilities must contain strings')
        capabilities = [
            value for value in capabilities if isinstance(value, str)
        ]
    unknown_capabilities = sorted(
        set(capabilities) - {'inspector_content'}
    )
    if unknown_capabilities:
        _err(
            errors, manifest_path,
            f'unsupported pack capabilities: {unknown_capabilities}',
        )
    if not disciplines and not capabilities:
        _err(
            errors, manifest_path,
            'pack must declare a discipline or capability',
        )

    inspector_spec = (
        (manifest.get('content') or {}).get('inspector')
        if isinstance(manifest.get('content') or {}, dict)
        else None
    )
    if inspector_spec is not None and 'inspector_content' not in capabilities:
        _err(
            errors, manifest_path,
            '[content.inspector] requires pack capability inspector_content',
        )
    if 'inspector_content' in capabilities:
        if not isinstance(inspector_spec, dict):
            _err(errors, manifest_path, '[content.inspector] missing')
        else:
            source = inspector_spec.get('source')
            mapping = inspector_spec.get('mapping')
            if not isinstance(source, str) or not source.strip():
                _err(errors, manifest_path, 'content.inspector.source missing')
            elif source.strip() not in {'valens'}:
                _err(
                    errors, manifest_path,
                    f'unsupported content.inspector.source "{source}"',
                )
            if (
                not isinstance(mapping, str) or not mapping.strip()
                or Path(mapping).is_absolute()
            ):
                _err(
                    errors, manifest_path,
                    'content.inspector.mapping must be a relative path',
                )
            else:
                mapping_path = (pack_dir / mapping).resolve()
                try:
                    mapping_path.relative_to(pack_dir.resolve())
                except ValueError:
                    _err(
                        errors, manifest_path,
                        'content.inspector.mapping escapes the pack root',
                    )
                else:
                    try:
                        with mapping_path.open('rb') as handle:
                            content_map = tomllib.load(handle)
                        if (
                            content_map.get('version') != 1
                            or not isinstance(content_map.get('entries'), list)
                        ):
                            _err(
                                errors, mapping_path,
                                'expected version = 1 and [[entries]] records',
                            )
                    except Exception as exc:
                        _err(errors, mapping_path, f'invalid mapping: {exc}')
    semantics = manifest.get('semantics') or {}
    if semantics and not isinstance(semantics, dict):
        _err(errors, manifest_path, '[semantics] must be a table')
    elif semantics:
        for field in sorted(set(semantics) - set(_SEMANTIC_FIELDS)):
            _err(errors, manifest_path,
                 f'unsupported semantics field "{field}"; '
                 f'valid: {sorted(_SEMANTIC_FIELDS)}')
        for field, allowed in _SEMANTIC_FIELDS.items():
            if field in semantics and semantics[field] not in allowed:
                _err(errors, manifest_path,
                     f'unsupported semantics.{field} "{semantics[field]}"; '
                     f'valid: {sorted(allowed)}')
        point_frame = semantics.get('point_frame')
        point_orb_policy = semantics.get('point_orb_policy')
        if (point_frame in (_SIGN_POINT_FRAMES |
                            _UNRESOLVED_POINT_FRAMES) and
                point_orb_policy not in
                (None, 'profile', 'inherit', 'unresolved')):
            _err(errors, manifest_path,
                 f'semantics.point_frame "{point_frame}" cannot carry '
                 f'degree point-orb policy "{point_orb_policy}"')
    upgrade = manifest.get('upgrade')
    if upgrade is not None:
        if not isinstance(upgrade, dict):
            _err(errors, manifest_path, '[upgrade] must be a table')
        else:
            unknown_upgrade_fields = set(upgrade) - {
                'replace_unmodified_tree_hashes',
            }
            for field in sorted(unknown_upgrade_fields):
                _err(errors, manifest_path,
                     f'unsupported upgrade field "{field}"')
            fingerprints = upgrade.get('replace_unmodified_tree_hashes')
            if (not isinstance(fingerprints, list) or not fingerprints or
                    not all(
                        isinstance(value, str) and
                        re.fullmatch(r'[0-9a-fA-F]{64}', value)
                        for value in fingerprints
                    )):
                _err(errors, manifest_path,
                     'upgrade.replace_unmodified_tree_hashes must be a '
                     'non-empty array of SHA-256 hex strings')
            elif len({value.lower() for value in fingerprints}) != len(
                    fingerprints):
                _err(errors, manifest_path,
                     'upgrade.replace_unmodified_tree_hashes contains '
                     'duplicate fingerprints')
    themes = manifest.get('themes') or {}
    for discipline, slots in themes.items():
        if not isinstance(slots, dict):
            _err(errors, manifest_path,
                 f'[themes.{discipline}] must be a table')
            continue
        for slug, spec in slots.items():
            if not isinstance(spec, dict):
                _err(errors, manifest_path,
                     f'[themes.{discipline}.{slug}] must be a table')
                continue
            if not spec.get('label'):
                _err(errors, manifest_path,
                     f'[themes.{discipline}.{slug}].label missing')
            try:
                normalize_theme_context_options(spec)
            except ValueError as exc:
                _err(
                    errors, manifest_path,
                    f'[themes.{discipline}.{slug}] {exc}',
                )
    return manifest


def _validate_predicate_spec(spec: dict, where: str, errors: list, depth=0,
                             inherited_aspect_frame=None,
                             inherited_point_frame=None,
                             inherited_orb_policy=None,
                             inherited_point_orb_policy=None):
    if depth > 8 or not isinstance(spec, dict):
        _err(errors, where, 'malformed or over-nested predicate specification')
        return
    pname = spec.get('predicate')
    if not pname:
        _err(errors, where, 'predicate specification has no `predicate` field')
        return
    if pname not in corpus_predicates.PREDICATES:
        _err(errors, where,
             f'unknown predicate "{pname}"; not registered in '
             'corpus_predicates.PREDICATES')
        return
    args = spec.get('args') or {}
    if not isinstance(args, dict):
        _err(errors, where, 'predicate args must be a table')
        return
    fn = corpus_predicates.PREDICATES[pname]
    allowed_args = set(corpus_semantics.SEMANTIC_FIELDS)
    for parameter in inspect.signature(fn).parameters.values():
        if parameter.name in ('chrt', 'context', '_depth'):
            continue
        if parameter.kind in (
                inspect.Parameter.VAR_POSITIONAL,
                inspect.Parameter.VAR_KEYWORD):
            continue
        allowed_args.add(parameter.name)
    unknown_args = sorted(set(args) - allowed_args)
    if unknown_args:
        _err(errors, where,
             f'{pname} has unknown argument(s) {unknown_args}; '
             f'valid: {sorted(allowed_args)}')
    _validate_predicate_argument_types(pname, args, fn, where, errors)
    station_policy_argument = _STATION_POLICY_ARGUMENTS.get(pname)
    if (station_policy_argument in args
            and args[station_policy_argument] not in _STATION_POLICIES):
        _err(
            errors, where,
            'unsupported station policy '
            f'"{args[station_policy_argument]}"; '
            f'valid: {sorted(_STATION_POLICIES)}',
        )
    if pname in (
            'ancient_solar_phase', 'lord_of_house_solar_phase',
            'any_ancient_solar_phase'):
        visibility_policy = args.get(
            'visibility_policy', 'hellenistic_15_degree',
        )
        if visibility_policy not in _ANCIENT_VISIBILITY_POLICIES:
            _err(
                errors, where,
                f'unsupported ancient visibility policy '
                f'"{visibility_policy}"; valid: '
                f'{sorted(_ANCIENT_VISIBILITY_POLICIES)}',
            )
        transition_policy = args.get(
            'transition_policy', 'exact_event_day',
        )
        if transition_policy not in _PHASIS_TRANSITION_POLICIES:
            _err(
                errors, where,
                f'unsupported phasis transition policy '
                f'"{transition_policy}"; valid: '
                f'{sorted(_PHASIS_TRANSITION_POLICIES)}',
            )
        phase = args.get('phase', 'under_rays')
        if phase not in _ANCIENT_SOLAR_PHASES:
            _err(
                errors, where,
                f'unsupported ancient solar phase "{phase}"; valid: '
                f'{sorted(_ANCIENT_SOLAR_PHASES)}',
            )
    if pname == 'body_matches_fixing_chart_place':
        policy = args.get('policy', 'source_phrase_only')
        if policy not in _DOROTHEUS_FIXING_PLACE_POLICIES:
            _err(
                errors, where,
                f'unsupported Dorotheus fixing-place policy "{policy}"; '
                f'valid: {sorted(_DOROTHEUS_FIXING_PLACE_POLICIES)}',
            )
    if pname == 'hephaistion_foundation_eclipse_warning':
        reading = args.get('reading', 'source_phrase_only')
        if reading not in _HEPHAISTION_FOUNDATION_ECLIPSE_READINGS:
            _err(
                errors, where,
                f'unsupported Hephaistion foundation eclipse reading '
                f'"{reading}"; valid: '
                f'{sorted(_HEPHAISTION_FOUNDATION_ECLIPSE_READINGS)}',
            )
    if pname == 'lunar_phase_event':
        policy = args.get('policy', 'exact_event_day')
        if policy not in _LUNAR_PHASE_POLICIES:
            _err(
                errors, where,
                f'unsupported lunar phase admission policy "{policy}"; '
                f'valid: {sorted(_LUNAR_PHASE_POLICIES)}',
            )
        phase = args.get('phase', 'assembly')
        if phase not in _LUNAR_PHASES:
            _err(
                errors, where,
                f'unsupported exact lunar phase "{phase}"; valid: '
                f'{sorted(_LUNAR_PHASES)}',
            )
    if pname in (
            'moon_solar_obscuration',
            'moon_increasing_and_free_of_rays'):
        policy = args.get('policy', 'hellenistic_15_degree')
        if policy not in _LUNAR_OBSCURATION_POLICIES:
            _err(
                errors, where,
                f'unsupported lunar obscuration policy "{policy}"; '
                f'valid: {sorted(_LUNAR_OBSCURATION_POLICIES)}',
            )
        if pname == 'moon_solar_obscuration':
            state = args.get('state', 'under_rays')
            if state not in _LUNAR_OBSCURATION_STATES:
                _err(
                    errors, where,
                    f'unsupported lunar obscuration state "{state}"; '
                    f'valid: {sorted(_LUNAR_OBSCURATION_STATES)}',
                )
    orb_policy = args.get('orb_policy')
    if orb_policy is not None and orb_policy not in _ORB_POLICIES:
        _err(errors, where,
             f'unsupported orb_policy "{orb_policy}"; valid: {sorted(_ORB_POLICIES)}')
    effective_orb_policy = orb_policy
    if effective_orb_policy in (None, 'profile', 'inherit'):
        effective_orb_policy = inherited_orb_policy
    point_orb_policy = args.get('point_orb_policy')
    if (point_orb_policy is not None and
            point_orb_policy not in _POINT_ORB_POLICIES):
        _err(errors, where,
             f'unsupported point_orb_policy "{point_orb_policy}"; '
             f'valid: {sorted(_POINT_ORB_POLICIES)}')
    effective_point_orb_policy = point_orb_policy
    if effective_point_orb_policy in (None, 'profile', 'inherit'):
        effective_point_orb_policy = inherited_point_orb_policy
    house_frame = args.get('house_frame')
    if house_frame is not None and house_frame not in _HOUSE_FRAMES:
        _err(errors, where,
             f'unsupported house_frame "{house_frame}"; valid: {sorted(_HOUSE_FRAMES)}')
    dignity_frame = args.get('dignity_frame')
    if dignity_frame is not None and dignity_frame not in _DIGNITY_FRAMES:
        _err(errors, where,
             f'unsupported dignity_frame "{dignity_frame}"; '
             f'valid: {sorted(_DIGNITY_FRAMES)}')
    aspect_frame = args.get('aspect_frame')
    if aspect_frame is not None and aspect_frame not in _ASPECT_FRAMES:
        _err(errors, where,
             f'unsupported aspect_frame "{aspect_frame}"; valid: {sorted(_ASPECT_FRAMES)}')
    effective_frame = aspect_frame
    if effective_frame in (None, 'profile', 'inherit'):
        effective_frame = inherited_aspect_frame
    point_frame = args.get('point_frame')
    if point_frame is not None and point_frame not in _POINT_FRAMES:
        _err(errors, where,
             f'unsupported point_frame "{point_frame}"; '
             f'valid: {sorted(_POINT_FRAMES)}')
    effective_point_frame = point_frame
    if effective_point_frame in (None, 'profile', 'inherit'):
        effective_point_frame = inherited_point_frame
    body_sign_configuration = (
        pname in _BODY_SIGN_CONFIGURATION_PREDICATES or
        (pname in _BODY_SEMANTIC_RELATION_PREDICATES and
         effective_frame in _SIGN_ASPECT_FRAMES)
    )
    if body_sign_configuration:
        orb_fields = {
            field for field in args
            if field == 'orb' or field.endswith('_orb')
        }
        if (orb_policy is not None
                and orb_policy not in ('profile', 'inherit', 'unresolved')):
            orb_fields.add('orb_policy')
        if (point_orb_policy is not None and point_orb_policy not in
                ('profile', 'inherit', 'unresolved')):
            orb_fields.add('point_orb_policy')
        if orb_fields:
            _err(errors, where,
                 'sign-configuration relation cannot carry orb field(s) '
                 f'{sorted(orb_fields)}; sign relationships are discrete')
    if (pname in _BODY_DEGREE_RELATION_PREDICATES and
            effective_frame in ('degree', 'zodiacal_degree') and
            effective_orb_policy in ('fixed', 'rule', 'source_fixed') and
            'orb' not in args):
        _err(errors, where,
             f'{effective_orb_policy} degree relation requires an authored '
             '`orb`; use orb_policy="unresolved" when the source gives none')
    elif (pname in _BODY_DEGREE_RELATION_PREDICATES and
          effective_frame in ('degree', 'zodiacal_degree') and
          'orb' in args and effective_orb_policy in
          ('configured', 'chart', 'chart_aspect', 'lilly', 'lilly_moiety',
           'source_moiety', 'unresolved')):
        _err(errors, where,
             f'authored `orb` is dormant under orb_policy '
             f'"{effective_orb_policy}"; remove it or select a sourced '
             'fixed policy')
    point_sign_configuration = (
        pname in _POINT_SIGN_CONFIGURATION_PREDICATES or
        (pname in _POINT_RELATION_PREDICATES and
         effective_point_frame in _SIGN_POINT_FRAMES)
    )
    if point_sign_configuration:
        degree_orb_fields = {
            field for field in args
            if field == 'orb' or field.endswith('_orb')
        }
        if (orb_policy is not None and
                orb_policy not in ('profile', 'inherit')):
            degree_orb_fields.add('orb_policy')
        if (point_orb_policy is not None and
                point_orb_policy not in
                ('profile', 'inherit', 'unresolved')):
            degree_orb_fields.add('point_orb_policy')
        if degree_orb_fields:
            _err(errors, where,
                 'point sign-configuration relation cannot carry '
                 f'degree-orb field(s) {sorted(degree_orb_fields)}; '
                 'set point_frame="degree" to lock axial-degree geometry '
                 'or remove the orb claim')
    if (pname in _POINT_RELATION_PREDICATES and
            effective_point_frame in _UNRESOLVED_POINT_FRAMES and
            any(
                field == 'orb' or field.endswith('_orb')
                for field in args
            )):
        _err(errors, where,
             'unresolved point frame cannot carry a degree-orb field')
    if (pname in _POINT_RELATION_PREDICATES and
            effective_point_frame in _UNRESOLVED_POINT_FRAMES and
            effective_point_orb_policy not in
            (None, 'profile', 'inherit', 'unresolved')):
        _err(errors, where,
             f'unresolved point frame cannot carry point_orb_policy '
             f'"{effective_point_orb_policy}"')
    if (pname in _POINT_RELATION_PREDICATES and
            effective_point_frame in ('degree', 'zodiacal_degree',
                                      'axial_degree')):
        if (effective_point_orb_policy in
                ('fixed', 'rule', 'source_fixed') and 'orb' not in args):
            _err(errors, where,
                 f'{effective_point_orb_policy} point relation requires an '
                 'authored `orb`')
        elif ('orb' in args and effective_point_orb_policy in
              ('configured', 'lilly', 'lilly_moiety', 'source_moiety',
               'exact', 'unresolved')):
            _err(errors, where,
                 f'authored `orb` is dormant under point_orb_policy '
                 f'"{effective_point_orb_policy}"; remove it or select a '
                 'sourced fixed policy')
    if (pname == 'point_in_zodiac_segments' and
            effective_point_frame not in
            ('degree', 'zodiacal_degree', 'axial_degree')):
        _err(errors, where,
             'point_in_zodiac_segments requires an explicit degree '
             'point_frame; a whole-sign place has no degree band')
    for flag in ('include_north_node', 'include_south_node'):
        if flag in args and not isinstance(args[flag], bool):
            _err(errors, where, f'{flag} must be true or false')
    if pname in _ORBLESS_ORDER_PREDICATES and any(
            field == 'orb' or field.endswith('_orb') for field in args):
        _err(errors, where,
             f'{pname} is an orb-free same-sign ordering relation; '
             'remove the numeric orb')
    if pname in ('all_of', 'any_of', 'none_of'):
        conditions = args.get('conditions')
        if not isinstance(conditions, list):
            _err(errors, where, f'{pname} requires args.conditions array')
            return
        if not conditions:
            _err(errors, where,
                 f'{pname} requires at least one authored condition')
            return
        for idx, condition in enumerate(conditions):
            _validate_predicate_spec(
                condition, f'{where}.{pname}[{idx}]', errors, depth + 1,
                effective_frame, effective_point_frame,
                effective_orb_policy, effective_point_orb_policy,
            )


def _validate_rule(rule_path: Path, block_idx: int, data: dict, errors: list,
                   semantic_defaults=None):
    rid = data.get('id', f'<block #{block_idx}>')
    where = f'{rule_path}:{rid}'
    for field in _COMMON_RULE_FIELDS:
        if not data.get(field):
            _err(errors, where, f'missing required field "{field}"')
    for field in ('title_key', 'body_key'):
        value = data.get(field)
        if (value is not None and (
                not isinstance(value, str)
                or not _LOCALIZATION_KEY_RE.fullmatch(value))):
            _err(
                errors, where,
                f'{field} must be a stable localization key',
            )
    method_note = data.get('method_note')
    if method_note is not None and not isinstance(method_note, str):
        _err(errors, where, 'method_note must be a string')
    kind = data.get('kind')
    if kind and kind not in _SUPPORTED_KINDS:
        _err(errors, where, f'unsupported kind "{kind}"; valid: {sorted(_SUPPORTED_KINDS)}')
    if kind in ('predicate_verdict', 'predicate_condition',
                'predicate_finding'):
        if not data.get('body'):
            _err(errors, where, f'{kind} rule has no `body` field')
        _validate_predicate_spec(
            data, where, errors,
            inherited_aspect_frame=(semantic_defaults or {}).get(
                'aspect_frame'),
            inherited_point_frame=(semantic_defaults or {}).get(
                'point_frame'),
            inherited_orb_policy=(semantic_defaults or {}).get('orb_policy'),
            inherited_point_orb_policy=(semantic_defaults or {}).get(
                'point_orb_policy'),
        )
        if (kind in ('predicate_condition', 'predicate_finding')
                and data.get('status') != 'info'):
            _err(errors, where, f'{kind} must use status "info"')
    elif kind == 'moon_sign_lookup':
        if not isinstance(data.get('entries'), dict):
            _err(errors, where, 'moon_sign_lookup rule requires an `entries` table')
    elif kind == 'source_note':
        if not data.get('body'):
            _err(errors, where, 'source_note rule has no `body` field')
        if data.get('status') != 'info':
            _err(errors, where, 'source_note must use status "info"')
        for message in source_note_metadata_errors(data):
            _err(errors, where, message)
    elif kind == 'axis_assignment':
        if not data.get('body'):
            _err(errors, where, 'axis_assignment rule has no `body` field')
        if data.get('status') != 'info':
            _err(errors, where, 'axis_assignment must use status "info"')
        if str(data.get('point', '')).upper() not in ('ASC', 'MC', 'DSC', 'IC'):
            _err(errors, where, 'axis_assignment point must be ASC, MC, DSC, or IC')
    status = data.get('status')
    if status is not None and status not in _SUPPORTED_STATUSES:
        _err(errors, where,
             f'unsupported status "{status}"; valid: {sorted(_SUPPORTED_STATUSES)}')
    source_fidelity = data.get('source_fidelity')
    if (source_fidelity is not None and
            source_fidelity not in _SOURCE_FIDELITIES):
        _err(errors, where,
             f'unsupported source_fidelity "{source_fidelity}"; '
             f'valid: {sorted(_SOURCE_FIDELITIES)}')
    recovery_timing = data.get('recovery_timing')
    if recovery_timing is not None:
        if kind != 'predicate_verdict':
            _err(
                errors, where,
                'recovery_timing is allowed only on predicate_verdict',
            )
        if not isinstance(recovery_timing, dict):
            _err(errors, where, 'recovery_timing must be a table')
        else:
            extra = set(recovery_timing) - _RECOVERY_TIMING_FIELDS
            if extra:
                _err(
                    errors, where,
                    f'recovery_timing has unknown field(s): {sorted(extra)}',
                )
            clock = recovery_timing.get('clock')
            if clock not in _RECOVERY_TIMING_CLOCKS:
                _err(
                    errors, where,
                    'recovery_timing.clock must be "perfection" or "none"',
                )
            elif clock == 'perfection':
                mode = recovery_timing.get('mode')
                grade = recovery_timing.get('grade')
                if mode not in _RECOVERY_TIMING_MODES:
                    _err(
                        errors, where,
                        'perfection recovery_timing requires a supported mode',
                    )
                if grade not in _RECOVERY_TIMING_GRADES:
                    _err(
                        errors, where,
                        'perfection recovery_timing requires recovery/hope grade',
                    )
                if recovery_timing.get('reason') is not None:
                    _err(
                        errors, where,
                        'perfection recovery_timing must not declare a no-clock reason',
                    )
            elif clock == 'none':
                reason = recovery_timing.get('reason')
                if reason not in _RECOVERY_NO_CLOCK_REASONS:
                    _err(
                        errors, where,
                        'no-clock recovery_timing requires a supported reason',
                    )
                if (recovery_timing.get('mode') is not None
                        or recovery_timing.get('grade') is not None):
                    _err(
                        errors, where,
                        'no-clock recovery_timing must not declare mode/grade',
                    )
    timing = data.get('timing')
    if timing is not None:
        if kind not in ('predicate_verdict', 'predicate_finding'):
            _err(
                errors, where,
                'timing is allowed only on predicate_verdict or '
                'predicate_finding',
            )
        if not isinstance(timing, dict):
            _err(errors, where, 'timing must be a table')
        else:
            extra = set(timing) - _TIMING_OPTIONAL_FIELDS
            if extra:
                _err(errors, where,
                     f'timing has unknown field(s): {sorted(extra)}; '
                     f'allowed: {sorted(_TIMING_OPTIONAL_FIELDS)}')
            unit = timing.get('unit', 'days')
            if unit not in ('days', 'sign'):
                _err(errors, where,
                     'timing.unit must be "days" or "sign"')
            from_kind = timing.get('from_kind', 'body')
            if from_kind not in ('body', 'lord_of_house'):
                _err(errors, where,
                     'timing.from_kind must be "body" or "lord_of_house"')
            elif from_kind == 'body':
                if not isinstance(timing.get('from'), str):
                    _err(errors, where,
                         'body timing requires an explicit timing.from actor')
            else:
                selectors = [
                    timing.get('from_house') is not None,
                    bool(timing.get('from_house_key')),
                ]
                if sum(selectors) != 1:
                    _err(errors, where,
                         'lord timing requires exactly one of from_house or '
                         'from_house_key')
            to_kind = timing.get('to', 'body')
            if to_kind not in ('body', 'lord_of_house'):
                _err(errors, where,
                     'timing.to must be "body" or "lord_of_house"')
            elif to_kind == 'body':
                if not isinstance(timing.get('to_body'), str):
                    _err(errors, where,
                         'body timing requires an explicit timing.to_body actor')
            else:
                selectors = [
                    timing.get('house') is not None,
                    bool(timing.get('house_key')),
                ]
                if sum(selectors) != 1:
                    _err(errors, where,
                         'lord timing requires exactly one of house or house_key')
            aspects = timing.get('aspects')
            if (not isinstance(aspects, (list, tuple)) or not aspects or
                    not all(_finite_number(value) and
                            0.0 <= float(value) <= 180.0
                            for value in aspects)):
                _err(errors, where,
                     'timing requires an explicit non-empty aspect set')
            rule_args = data.get('args') or {}
            if rule_args.get('aspect_frame') not in (
                    'degree', 'zodiacal_degree'):
                _err(errors, where,
                     'timing requires an explicit degree aspect_frame lock')
            if rule_args.get('orb_policy') not in (
                    'configured', 'chart', 'chart_aspect', 'lilly',
                    'lilly_moiety', 'source_moiety', 'fixed', 'rule',
                    'source_fixed'):
                _err(errors, where,
                     'timing requires an explicit resolved orb_policy')


def validate_pack_directory(pack_dir: Path):
    """Return ``(manifest, rule_count, errors)`` for CLI and runtime parity."""
    pack_dir = Path(pack_dir)
    errors = []
    manifest = _validate_manifest(pack_dir, errors)
    rule_count = _validate_rules(pack_dir, manifest, errors)
    return manifest, rule_count, errors


def _validate_rules(pack_dir: Path, manifest: dict, errors: list) -> int:
    rules_dir = pack_dir / 'rules'
    if not rules_dir.is_dir():
        return 0
    rule_count = 0
    seen_ids = {}
    declared_disciplines = set((manifest.get('pack') or {}).get('disciplines') or ())
    semantic_defaults = manifest.get('semantics') or {}
    seen_disciplines = set()
    rule_data_by_id = {}
    for discipline_dir in sorted(rules_dir.iterdir()):
        if not discipline_dir.is_dir():
            continue
        seen_disciplines.add(discipline_dir.name)
        for rule_path in sorted(discipline_dir.glob('*.md')):
            try:
                text = rule_path.read_text(encoding='utf-8')
            except Exception as exc:
                _err(errors, rule_path, f'read error: {exc}')
                continue
            blocks = _RULE_BLOCK_RE.findall(text)
            if not blocks:
                _err(errors, rule_path,
                     'no `toml rule` fenced blocks found in this file')
                continue
            for i, body in enumerate(blocks):
                try:
                    data = tomllib.loads(body)
                except tomllib.TOMLDecodeError as exc:
                    _err(errors, rule_path,
                         f'block #{i} TOML parse error: {exc}')
                    continue
                _validate_rule(
                    rule_path, i, data, errors,
                    semantic_defaults=semantic_defaults,
                )
                rid = data.get('id')
                if rid:
                    previous = seen_ids.get(rid)
                    if previous is not None:
                        _err(errors, rule_path,
                             f'duplicate rule id "{rid}"; first seen in {previous}')
                    else:
                        seen_ids[rid] = rule_path
                        rule_data_by_id[rid] = data
                rule_count += 1
    # Cross-check disciplines
    for disc in seen_disciplines - declared_disciplines:
        _err(errors, pack_dir / 'manifest.toml',
             f'rules/{disc}/ exists but pack.disciplines does not list "{disc}"')
    for rule_id, data in rule_data_by_id.items():
        if data.get('kind') != 'source_note':
            continue
        for owner_id in data.get('owner_rule_ids') or ():
            owner = rule_data_by_id.get(owner_id)
            if owner is None:
                _err(
                    errors, seen_ids[rule_id],
                    f'source-note owner_rule_ids references missing rule '
                    f'"{owner_id}"',
                )
            elif not str(owner.get('kind') or '').startswith('predicate_'):
                _err(
                    errors, seen_ids[rule_id],
                    f'source-note owner "{owner_id}" must be executable',
                )
        if data.get('source_note_role') == 'bounded_source_ambiguity':
            ambiguity_key = data.get('ambiguity_key')
            rule_path = seen_ids[rule_id]
            try:
                relative = rule_path.relative_to(rules_dir)
                discipline = relative.parts[0]
                slug = rule_path.stem
                theme = (
                    ((manifest.get('themes') or {}).get(discipline) or {})
                    .get(slug) or {}
                )
                fields = normalize_theme_context_options(theme)
            except (ValueError, IndexError):
                fields = []
            selector = next(
                (field for field in fields
                 if field.get('key') == ambiguity_key),
                None,
            )
            if selector is None:
                _err(
                    errors, rule_path,
                    'bounded source ambiguity requires a same-theme '
                    f'context selector "{ambiguity_key}"',
                )
            else:
                values = {
                    option.get('value')
                    for option in selector.get('options') or ()
                }
                if ('source_phrase_only' not in values
                        or len(values - {'source_phrase_only'}) < 1):
                    _err(
                        errors, rule_path,
                        'bounded source ambiguity selector must offer '
                        'source_phrase_only and at least one explicit reading',
                    )
    return rule_count


def _smoke_evaluate(pack_dir: Path, manifest: dict) -> None:
    """Load the pack alongside the bundled packs and confirm at least one
    rule fires against a fixed reference chart. No assertion — just
    prints what fires for a quick manual check."""
    import options
    import chart
    print()
    print('--- smoke evaluate (Vienna 2026-08-15 14:30) ---')
    opts = options.Options(); opts.reload(); opts.ayanamsha = 0
    place = chart.Place('Vienna', 16, 22, 0, True, 48, 12, 0, True, 100)
    t = chart.Time(2026, 8, 15, 14, 30, 0, False,
                   chart.Time.GREGORIAN, chart.Time.ZONE,
                   True, 1, 0, False, place, tzid='', tzauto=False)
    chrt = chart.Chart('PackValidation', False, t, place,
                       chart.Chart.RADIX, '', opts)
    import rule_engine
    rule_engine.reload_packs()
    packs = rule_engine.list_packs()
    pack_id = (manifest.get('pack') or {}).get('id')
    if pack_id not in packs:
        print(f'  ! pack id "{pack_id}" not picked up by loader')
        return
    pack = packs[pack_id]
    themes = (manifest.get('themes') or {})
    for discipline, slots in themes.items():
        for slug in slots:
            label = (slots[slug] or {}).get('label') or slug
            try:
                alerts = rule_engine.evaluate(discipline, slug, chrt,
                                              context=slots[slug])
            except Exception as exc:
                print(f'  ! {discipline}/{slug}: evaluation error: {exc}')
                continue
            print(f'  {discipline}/{slug} ({label}): {len(alerts)} alerts')
            for a in alerts[:3]:
                print(f'    [{a.status}] {a.title}')


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('pack_dir', type=Path,
                        help='Directory containing manifest.toml + rules/')
    parser.add_argument('--smoke', action='store_true',
                        help='Also evaluate each theme against a reference chart')
    args = parser.parse_args(argv)

    pack_dir = args.pack_dir.expanduser().resolve()
    if not pack_dir.is_dir():
        print(f'ERROR: not a directory: {pack_dir}', file=sys.stderr)
        return 2

    print(f'Validating pack: {pack_dir}')
    manifest, rule_count, errors = validate_pack_directory(pack_dir)

    if errors:
        print(f'\n{len(errors)} error(s):')
        for e in errors:
            print(e)
        return 1
    print(f'OK — {rule_count} rule(s), manifest valid, all predicates known.')
    if args.smoke:
        _smoke_evaluate(pack_dir, manifest)
    return 0


if __name__ == '__main__':
    sys.exit(main())
