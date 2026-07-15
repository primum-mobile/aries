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
import os

import corpus_loader


_SEVERITY = {'avoid': 0, 'caution': 1, 'good': 2}


class Alert(object):
    """A single emitted rule verdict. Discipline-agnostic."""
    __slots__ = ('status', 'glyph', 'title', 'body', 'cite', 'pack')

    def __init__(self, status, glyph, title, body, cite='', pack=None):
        self.status = status
        self.glyph = glyph
        self.title = title
        self.body = body
        self.cite = cite
        # Pack id of the authoring corpus pack. None == legacy inline rule.
        self.pack = pack


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


def register_discipline(slug, display_name, theme_labels):
    """Called by per-discipline shim modules at import time."""
    _DISCIPLINE_REGISTRY[slug] = {
        'display_name': display_name,
        'theme_labels': list(theme_labels),
    }


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
    seen = set(labels)
    for entry in _pack_themes_for(discipline_slug):
        if entry['label'] not in seen:
            labels.append(entry['label'])
            seen.add(entry['label'])
    return labels


def _pack_themes_for(discipline_slug):
    """Merged [label, slug, default_context, tooltip, pack_id] for every
    pack-declared theme in the discipline. Used internally by
    `theme_labels_for`, `theme_metadata_for`, and the discipline shim
    modules (horary_rules / elections_rules) to auto-pick-up community
    themes without code edits."""
    out = []
    packs = active_packs()
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
            })
    return out


def theme_metadata_for(discipline_slug):
    """Per-label metadata for the discipline: {label: {slug, tooltip,
    default_context, pack_id}}. Built-ins are NOT included here — they
    own their slug/context table inside the discipline shim. Pack
    contributions are."""
    out = {}
    for entry in _pack_themes_for(discipline_slug):
        out.setdefault(entry['label'], entry)
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
    """Force a re-scan of `corpus/` on the next evaluation."""
    global _PACKS
    _PACKS = None


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

    Pack-driven path: calls `corpus_loader.build_alerts()`; if any pack
    produced alerts, those drive the output.

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

    pack_alerts = []
    try:
        pack_alerts = corpus_loader.build_alerts(
            active_packs(), discipline, theme_slug, chrt, Alert,
            context=context,
        )
    except Exception:
        pack_alerts = []

    if pack_alerts:
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
