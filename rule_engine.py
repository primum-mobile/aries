# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Discipline-agnostic rule engine for corpus packs.

Owns the pieces that are shared by every interpretation discipline
(elections, horary, natal, mundane, …):

- `Alert` — the verdict record every rule emits.
- `evaluate(discipline, theme, chrt, *, inline_fallback=None, context=None)`
  — entry point. First tries pack rules via `corpus_loader.build_alerts`;
  if a pack covers the (discipline, theme), its output drives the result.
  If no pack fires, the optional `inline_fallback(chrt)` runs and its output
  is returned (this is the legacy-Python safety net used by elections).
- Pack cache + `list_packs()` / `set_active_packs()` for UI toggles.

Per-discipline modules (`elections_rules.py`, future `horary_rules.py`, …)
stay thin: they map UI labels to filesystem theme slugs, register their
inline fallback (if any), and delegate to `evaluate()`. The engine below
knows nothing about electional rules in particular.
"""

import json
import logging
import os

import corpus_loader
import corpus_semantics


_SEVERITY = {'avoid': 0, 'caution': 1, 'good': 2, 'info': 3}
_log = logging.getLogger(__name__)
_SEMANTIC_PROFILE = corpus_semantics.profile(
    corpus_semantics.DEFAULT_PROFILE_ID,
)
_DOCTRINE_PREFERENCES = {}


class Alert(object):
    """A single emitted rule verdict. Discipline-agnostic."""
    __slots__ = ('status', 'glyph', 'title', 'body', 'cite', 'pack',
                 'rule_id', 'evidence', 'kind', 'timing_witnesses',
                 'title_key', 'body_key', 'technical_details')

    def __init__(self, status, glyph, title, body, cite='', pack=None,
                 rule_id=None, evidence='', kind='verdict',
                 timing_witnesses=(), title_key=None, body_key=None,
                 technical_details=''):
        self.status = status
        self.glyph = glyph
        self.title = title
        self.body = body
        self.cite = cite
        # Pack id of the authoring corpus pack. None == legacy inline rule.
        self.pack = pack
        # Stable authored rule identity plus a compact, chart-derived proof of
        # what actually matched.  Legacy inline rules leave both empty.
        self.rule_id = rule_id
        self.evidence = evidence or ''
        # Presentation semantics are separate from severity.  A source note
        # is background doctrine and must never masquerade as a chart match.
        self.kind = str(kind or 'verdict')
        # Typed physical clocks attached by the rule that actually supplied
        # them.  Symbolic timing qualifiers remain unselected metadata.
        self.timing_witnesses = tuple(
            witness for witness in (timing_witnesses or ())
            if isinstance(witness, dict)
        )
        # Official cards may supply stable frontend localization keys while
        # retaining authored English prose as a compatibility fallback.
        self.title_key = str(title_key) if title_key else None
        self.body_key = str(body_key) if body_key else None
        # Method notes and computed diagnostics are deliberately separate from
        # authored reading prose.  The inspector keeps this material behind an
        # explicit technical-details disclosure instead of rewriting a card's
        # source-facing body.
        self.technical_details = str(technical_details or '')


# ─────────────────────────────────────────────────────────────
# Pack cache + active-pack filtering
# ─────────────────────────────────────────────────────────────

_PACKS = None
_ACTIVE_PACK_IDS = None  # None == all packs active

# Registry of per-discipline shim modules, populated at shim-import time.
# Each entry: slug → {'display_name': str, 'theme_labels': [UI label, ...]}.
# The inspector uses this to populate its Discipline / Theme dropdowns
# without coupling directly to elections_rules / horary_rules.
_DISCIPLINE_REGISTRY = {}
_QUESTION_CONTEXT_FIELDS = {}


def register_discipline(slug, display_name, theme_labels):
    """Register canonical labels and, when supplied, their stable slugs."""
    if isinstance(theme_labels, dict):
        theme_slugs = dict(theme_labels)
        labels = []
        seen_slugs = set()
        for label, theme_slug in theme_slugs.items():
            if theme_slug in seen_slugs:
                continue
            labels.append(label)
            seen_slugs.add(theme_slug)
    else:
        labels = list(theme_labels)
        theme_slugs = {}
    _DISCIPLINE_REGISTRY[slug] = {
        'display_name': display_name,
        'theme_labels': labels,
        'theme_slugs': theme_slugs,
    }


def register_question_context_fields(discipline, theme_slug, fields):
    """Register trusted core per-question keys for one stable theme.

    Pack-declared question fields are discovered from manifest metadata.  This
    registry covers the small built-in compatibility schema (house roles and
    legacy horary question facts) without making ``corpus_loader`` import a
    discipline shim and create an import cycle.
    """
    key = (str(discipline), str(theme_slug))
    _QUESTION_CONTEXT_FIELDS[key] = frozenset(
        str(field) for field in fields if str(field)
    )


def question_context_fields(discipline, theme_slug):
    return frozenset(_QUESTION_CONTEXT_FIELDS.get(
        (str(discipline), str(theme_slug)), (),
    ))


def registered_disciplines():
    """[(slug, display_name)] for every discipline whose shim has imported."""
    return [(slug, info['display_name'])
            for slug, info in sorted(_DISCIPLINE_REGISTRY.items())]


def theme_labels_for(discipline_slug):
    """Union of the discipline's built-in themes and any themes contributed
    by community packs via their manifest `[themes.<discipline>.<slug>]`
    blocks. Built-ins come first; pack themes are appended in pack-id sort
    order. Duplicate labels are filtered.

    See doc/corpus-packs.md "Manifest schema" and the aries-pack-author
    skill for how a pack registers a new theme."""
    info = _DISCIPLINE_REGISTRY.get(discipline_slug)
    labels = list(info['theme_labels']) if info else []
    built_in_slugs = dict((info or {}).get('theme_slugs') or {})
    seen_labels = set(labels)
    seen_slugs = set(built_in_slugs.values())
    for entry in _pack_themes_for(discipline_slug):
        # Stable slug identity wins over display-label differences between a
        # built-in question and one or more source manifests.  Otherwise one
        # real theme appears several times and its defaults/options split
        # across aliases.
        if entry['slug'] in seen_slugs:
            continue
        if entry['label'] not in seen_labels:
            labels.append(entry['label'])
            seen_labels.add(entry['label'])
            seen_slugs.add(entry['slug'])
    return labels


def theme_slug_for(discipline_slug, label_or_slug, *, include_inactive=False):
    """Resolve a canonical label, manifest alias, or already-stable slug."""
    value = str(label_or_slug or '')
    info = _DISCIPLINE_REGISTRY.get(discipline_slug) or {}
    built_in = dict(info.get('theme_slugs') or {})
    if value in built_in:
        return built_in[value]
    if value in set(built_in.values()):
        return value
    entries = (
        _pack_themes_for(discipline_slug, include_inactive=True)
        if include_inactive
        else _pack_themes_for(discipline_slug)
    )
    for entry in entries:
        if value in (entry['label'], entry['slug']):
            return entry['slug']
    return None


def canonical_theme_label_for(
        discipline_slug, theme_slug, *, include_inactive=False):
    """Return one UI label per stable theme slug; built-ins win."""
    info = _DISCIPLINE_REGISTRY.get(discipline_slug) or {}
    for label, slug in dict(info.get('theme_slugs') or {}).items():
        if slug == theme_slug:
            return label
    entries = (
        _pack_themes_for(discipline_slug, include_inactive=True)
        if include_inactive
        else _pack_themes_for(discipline_slug)
    )
    for entry in entries:
        if entry['slug'] == theme_slug:
            return entry['label']
    return None


def theme_aliases_for(
        discipline_slug, theme_slug, *, include_inactive=False):
    """Every accepted non-canonical label for one stable theme slug."""
    canonical = canonical_theme_label_for(
        discipline_slug, theme_slug, include_inactive=include_inactive,
    )
    aliases = []
    info = _DISCIPLINE_REGISTRY.get(discipline_slug) or {}
    for label, slug in dict(info.get('theme_slugs') or {}).items():
        if slug == theme_slug and label != canonical and label not in aliases:
            aliases.append(label)
    entries = (
        _pack_themes_for(discipline_slug, include_inactive=True)
        if include_inactive
        else _pack_themes_for(discipline_slug)
    )
    for entry in entries:
        label = entry['label']
        if (entry['slug'] == theme_slug and label != canonical
                and label not in aliases):
            aliases.append(label)
    return aliases


def _pack_themes_for(discipline_slug, *, include_inactive=False):
    """Merged theme metadata for every
    pack-declared theme in the discipline. Used internally by
    `theme_labels_for`, `theme_metadata_for`, and the discipline shim
    modules (horary_rules / elections_rules) to auto-pick-up community
    themes without code edits."""
    out = []
    packs = (
        _ensure_packs_loaded()
        if include_inactive
        else active_packs()
    )
    for pack_id in sorted(packs):
        pack = packs[pack_id]
        themes = getattr(pack, 'themes', None) or {}
        for (disc, slug), spec in themes.items():
            if disc != discipline_slug:
                continue
            out.append({
                'pack_id': pack_id,
                'slug': slug,
                'label': spec.get('label') or slug,
                'tooltip': spec.get('tooltip') or '',
                'default_context': spec.get('default_context'),
                'context_options': list(spec.get('context_options') or ()),
            })
    return out


def theme_metadata_for(discipline_slug, *, include_inactive=False):
    """Per-label metadata declared by packs for one discipline.

    Built-ins remain in their discipline shim; callers merge this pack data
    with core defaults by stable context-option key.
    """
    out = {}
    entries = (
        _pack_themes_for(discipline_slug, include_inactive=True)
        if include_inactive
        else _pack_themes_for(discipline_slug)
    )
    by_slug = {}
    for entry in entries:
        slug = entry['slug']
        if slug not in by_slug:
            by_slug[slug] = dict(entry)
            by_slug[slug]['context_options'] = list(
                entry.get('context_options') or (),
            )
            by_slug[slug]['default_context'] = dict(
                entry.get('default_context') or {},
            )
            by_slug[slug]['aliases'] = [entry['label']]
            continue
        # Several packs may contribute rules to one established question.
        # Preserve deterministic first-pack conflicts, but union independently
        # declared context dimensions and missing defaults by stable slug.
        merged = by_slug[slug]
        if entry['label'] not in merged['aliases']:
            merged['aliases'].append(entry['label'])
        if not merged.get('tooltip') and entry.get('tooltip'):
            merged['tooltip'] = entry['tooltip']
        defaults = merged['default_context']
        for key, value in dict(entry.get('default_context') or {}).items():
            defaults.setdefault(key, value)
        existing = merged['context_options']
        seen = {field.get('key') for field in existing}
        for field in entry.get('context_options') or ():
            if field.get('key') in seen:
                continue
            existing.append(field)
            seen.add(field.get('key'))
    for slug, entry in by_slug.items():
        label = canonical_theme_label_for(
            discipline_slug, slug, include_inactive=include_inactive,
        ) or entry['label']
        entry['label'] = label
        entry['aliases'] = theme_aliases_for(
            discipline_slug, slug, include_inactive=include_inactive,
        )
        out[label] = entry
    return out


def discipline_display_name(slug):
    info = _DISCIPLINE_REGISTRY.get(slug)
    return info['display_name'] if info else (slug or '').capitalize()


def _ensure_packs_loaded():
    global _PACKS
    if _PACKS is None:
        try:
            _PACKS = corpus_loader.load_packs()
        except Exception:
            _PACKS = {}
    return _PACKS


def set_active_packs(pack_ids):
    """Restrict evaluation to a subset of packs.

    Pass None to activate all. Unknown ids are silently ignored.
    """
    global _ACTIVE_PACK_IDS
    _ACTIVE_PACK_IDS = None if pack_ids is None else set(pack_ids)


def active_packs():
    """Return the {pack_id: Pack} dict filtered by the active set."""
    packs = _ensure_packs_loaded()
    if _ACTIVE_PACK_IDS is None:
        return packs
    return {pid: p for pid, p in packs.items() if pid in _ACTIVE_PACK_IDS}


def list_packs():
    """Return a stable [(pack_id, Pack)] list for UI listings."""
    return sorted(_ensure_packs_loaded().items())


def packs_for_discipline(discipline):
    """Return [(pack_id, Pack)] of packs that declare support for a discipline."""
    out = []
    for pack_id, pack in sorted(_ensure_packs_loaded().items()):
        manifest_pack = pack.manifest.get('pack', {}) if pack.manifest else {}
        if discipline in (manifest_pack.get('disciplines') or []):
            out.append((pack_id, pack))
    return out


def active_inspector_content(kind, object_id):
    """Return the first active passive-content selector for an inspector target.

    Content-only packs participate in the same persisted on/off filter as rule
    packs, but they never register a discipline or enter ``evaluate()``.
    """
    key = (str(kind), str(object_id))
    first_pack_id = None
    for pack_id, pack in sorted(active_packs().items()):
        content = getattr(pack, 'inspector_content', None) or {}
        if not content:
            continue
        if first_pack_id is None:
            first_pack_id = pack_id
        selector = content.get(key)
        if selector is not None:
            return pack_id, selector
    return first_pack_id, None


def active_theme_slugs(discipline, exclude_ui_hidden=True):
    """Theme slugs that have >=1 rule in a currently-ACTIVE pack.

    Used by the UI lens picker so the discipline/theme dropdown reflects the
    title-bar Corpus Packs toggles: a theme appears only while some active
    pack ships rules for it; a discipline disappears when none do. Skill-only
    (`ui_hidden`) packs are excluded by default so they never surface a theme
    in the app UI.
    """
    out = set()
    for pack in active_packs().values():
        if exclude_ui_hidden and getattr(pack, 'ui_hidden', False):
            continue
        for (disc, slug), blocks in (pack.rules or {}).items():
            if disc == discipline and blocks:
                out.add(slug)
    return out


def get_active_pack_ids():
    """Return the current active-pack filter. None == all active."""
    return _ACTIVE_PACK_IDS


def get_semantic_profile_id():
    """Global corpus interpretation profile; current-chart is the default."""
    return _SEMANTIC_PROFILE['id']


def get_semantic_profile():
    """Return a detached copy of the active semantic profile definition."""
    return dict(_SEMANTIC_PROFILE)


def set_semantic_profile(profile_id):
    """Validate and activate a built-in id or persisted custom definition."""
    global _SEMANTIC_PROFILE
    selected = corpus_semantics.select_profile(profile_id)
    _SEMANTIC_PROFILE = dict(selected)
    return dict(selected)


def get_doctrine_preferences():
    """Sparse global corpus-doctrine overrides, detached for one evaluation."""
    return dict(_DOCTRINE_PREFERENCES)


def set_doctrine_preferences(preferences):
    """Atomically publish daemon-validated global doctrine overrides."""
    global _DOCTRINE_PREFERENCES
    if not isinstance(preferences, dict):
        raise ValueError("doctrine preferences must be a mapping")
    _DOCTRINE_PREFERENCES = dict(preferences)
    return dict(_DOCTRINE_PREFERENCES)


def load_semantic_profile_from(opts_dir):
    global _SEMANTIC_PROFILE
    if not opts_dir:
        _SEMANTIC_PROFILE = corpus_semantics.profile(
            corpus_semantics.DEFAULT_PROFILE_ID,
        )
        return dict(_SEMANTIC_PROFILE)
    store = corpus_semantics.SemanticProfileStore(opts_dir)
    selected = store.active_profile()
    _SEMANTIC_PROFILE = dict(selected)
    return dict(selected)


def save_semantic_profile_to(opts_dir, profile_id=None):
    """Persist a validated profile without changing evaluator truth.

    ``profile_id`` lets the daemon durably write a candidate before making it
    globally visible.  Omitting it preserves the older save-current-profile
    API used by the wx path and callers outside the Tauri service.
    """
    selected = (
        get_semantic_profile()
        if profile_id is None
        else corpus_semantics.SemanticProfileStore(opts_dir).profile(profile_id)
        if opts_dir
        else corpus_semantics.profile(profile_id)
    )
    if not opts_dir:
        return selected
    return corpus_semantics.SemanticProfileStore(opts_dir).activate(
        selected['id'],
    )


# ─────────────────────────────────────────────────────────────
# Active-pack persistence (JSON sidecar in the options dir)
# ─────────────────────────────────────────────────────────────

_PACK_STATE_FILENAME = 'corpus_packs.json'


def load_active_pack_ids_from(opts_dir):
    """Read persisted active-pack filter from <opts_dir>/corpus_packs.json.

    Called at app startup. Missing file or parse errors are silent — the
    engine falls back to "all packs active".
    """
    if not opts_dir:
        return
    path = os.path.join(opts_dir, _PACK_STATE_FILENAME)
    if not os.path.isfile(path):
        return
    try:
        with open(path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        ids = data.get('active_pack_ids')
        set_active_packs(ids)
    except Exception:
        pass


def save_active_pack_ids_to(opts_dir):
    """Persist the current active-pack filter for the next app launch."""
    if not opts_dir:
        return
    path = os.path.join(opts_dir, _PACK_STATE_FILENAME)
    try:
        os.makedirs(opts_dir, exist_ok=True)
        ids = _ACTIVE_PACK_IDS
        if isinstance(ids, set):
            ids = sorted(ids)
        with open(path, 'w', encoding='utf-8') as f:
            json.dump({'active_pack_ids': ids}, f, indent=2)
            f.write('\n')
    except Exception:
        pass


def reload_packs():
    """Transactionally re-scan installed packs and retain prior truth on error."""
    global _PACKS
    candidate = corpus_loader.load_packs(strict=True)
    _PACKS = candidate
    return candidate


# ─────────────────────────────────────────────────────────────
# evaluate() — the generic entry point
# ─────────────────────────────────────────────────────────────

def _flatten(items):
    """Rules may return a single Alert, None, or a list. Flatten + drop None."""
    out = []
    for it in items:
        if it is None:
            continue
        if isinstance(it, list):
            out.extend(x for x in it if x is not None)
        else:
            out.append(it)
    return out


def evaluate(discipline, theme_slug, chrt,
             inline_fallback=None, context=None):
    """Evaluate pack rules for (discipline, theme_slug) against a chart.

    Returns a severity-sorted list of Alert.

    Pack-driven path: calls `corpus_loader.build_alerts()`. Pack coverage owns
    the output even when no rule matches; an empty covered result must not mix
    in a second doctrine through the legacy fallback.

    Legacy fallback: when no pack covers the (discipline, theme_slug),
    `inline_fallback(chrt)` (if provided) runs. It may return a list
    containing Alert, None, or nested lists — they are flattened and
    filtered.

    `context` is reserved for disciplines that need per-question state
    (e.g. horary significator houses). It is threaded through
    `corpus_loader.build_alerts()`; predicates that don't declare it
    simply absorb it via **kwargs.
    """
    if chrt is None or discipline is None or theme_slug is None:
        return []

    packs = active_packs()
    eval_context = dict(context or {})
    # Snapshot once.  Profile replacement is atomic, but reading the id and
    # values from the global in two separate operations could otherwise pair
    # an old id with a newly selected definition during concurrent evaluation.
    semantic_profile = get_semantic_profile()
    doctrine_preferences = get_doctrine_preferences()
    eval_context['_corpus_semantic_profile'] = semantic_profile['id']
    eval_context['_corpus_semantic_profile_values'] = semantic_profile
    covered = bool(corpus_loader.get_rules(packs, discipline, theme_slug))
    pack_alerts = []
    try:
        pack_alerts = corpus_loader.build_alerts(
            packs, discipline, theme_slug, chrt, Alert,
            context=eval_context,
            doctrine_preferences=doctrine_preferences,
            core_question_fields=question_context_fields(
                discipline, theme_slug,
            ),
        )
    except Exception:
        _log.exception(
            "corpus: failed evaluating covered theme %s/%s",
            discipline, theme_slug,
        )
        pack_alerts = []

    # Coverage, not whether a rule happened to fire, owns the fallback
    # boundary.  A covered chart with zero matches is a valid empty answer;
    # falling through to legacy rules would silently mix two doctrines.
    if covered:
        flat = pack_alerts
    elif inline_fallback is not None:
        try:
            raw = inline_fallback(chrt)
        except Exception:
            raw = []
        flat = _flatten(raw) if raw else []
    else:
        flat = []

    flat.sort(key=lambda a: _SEVERITY.get(a.status, 3))
    return flat
