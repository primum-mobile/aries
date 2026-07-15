# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Corpus pack discovery + loader.

A *pack* is an interpretation framework (era/cosmology/author) installed in
the Aries user pack directory. Each pack has:

    packs/<pack_id>/
        manifest.toml                    # pack metadata
        rules/<discipline>/<theme>.md    # narrative + fenced TOML rule blocks

Rule blocks are fenced with ```toml rule at the opening delimiter. Each block
is one rule; TOML table shape depends on the rule `kind`. Current kinds:

    moon_sign_lookup — 12-entry table keyed by sign 0..11. Each entry is either
        a plain {status, body} record, or a `segments = [...]` list for
        degree-sensitive signs.

Packs coexist — multiple packs may interpret the same discipline/theme. The
UI layer decides which packs are active.
"""

import logging
import os
import re
import shutil
import sys
import tomllib

import corpus_predicates

_log = logging.getLogger(__name__)

_RULE_BLOCK_RE = re.compile(r"```toml\s+rule\s*\n(.*?)```", re.DOTALL)


class RuleBlock(object):
    __slots__ = ('pack_id', 'discipline', 'theme', 'data', 'source_path')

    def __init__(self, pack_id, discipline, theme, data, source_path):
        self.pack_id = pack_id
        self.discipline = discipline
        self.theme = theme
        self.data = data
        self.source_path = source_path


class Pack(object):
    __slots__ = ('id', 'name', 'era', 'short_label', 'manifest', 'rules',
                 'root', 'themes', 'ui_hidden')

    def __init__(self, id_, manifest, root):
        self.id = id_
        self.manifest = manifest
        self.root = root
        pack = manifest.get('pack', {})
        self.name = pack.get('name', id_)
        self.era = pack.get('era', '')
        self.short_label = pack.get('short_label', id_[:6])
        # Skill-only corpora set `ui_hidden = true` in [pack]. The engine and
        # CLI skills still load them; only the app UI surfaces filter them out.
        self.ui_hidden = bool(pack.get('ui_hidden', False))
        # rules[(discipline, theme)] -> list[RuleBlock]
        self.rules = {}
        # themes[(discipline, slug)] -> {label, tooltip, default_context}
        # Populated from `[themes.<discipline>.<slug>]` blocks in the
        # manifest. Empty for packs that don't declare themes (those rely
        # on whatever built-in theme registration the discipline shim
        # provides). See doc/corpus-packs.md "Manifest schema".
        self.themes = {}
        for discipline, slots in (manifest.get('themes') or {}).items():
            if not isinstance(slots, dict):
                continue
            for slug, spec in slots.items():
                if not isinstance(spec, dict):
                    continue
                label = spec.get('label')
                if not label:
                    continue
                # Everything except 'label' and 'tooltip' goes into
                # default_context — keeps the manifest schema open without
                # the loader needing to know about discipline-specific keys.
                default_ctx = {k: v for k, v in spec.items()
                               if k not in ('label', 'tooltip')}
                self.themes[(discipline, slug)] = {
                    'label': label,
                    'tooltip': spec.get('tooltip', ''),
                    'default_context': default_ctx or None,
                }


def _community_root():
    """Where user / community / agent-dropped packs live.

    Override via the ``ARIES_COMMUNITY_PACKS_DIR`` env var; otherwise:
      - macOS  : ~/Library/Application Support/Aries/packs/
      - Linux  : $XDG_DATA_HOME/aries/packs/ or ~/.local/share/aries/packs/
      - Windows: %APPDATA%/Aries/packs/

    Returns the path even if it doesn't exist (the loader silently skips
    nonexistent roots). Community contributors and the aries-pack-author
    skill drop packs here without touching the source tree.
    """
    override = os.environ.get('ARIES_COMMUNITY_PACKS_DIR')
    if override:
        return os.path.abspath(os.path.expanduser(override))
    home = os.path.expanduser('~')
    if sys.platform == 'darwin':
        return os.path.join(home, 'Library', 'Application Support',
                            'Aries', 'packs')
    if sys.platform.startswith('win'):
        appdata = os.environ.get('APPDATA') or home
        return os.path.join(appdata, 'Aries', 'packs')
    xdg = os.environ.get('XDG_DATA_HOME') or os.path.join(home, '.local',
                                                          'share')
    return os.path.join(xdg, 'aries', 'packs')


def _pack_seed_root():
    """Pack seeds shipped for first-launch installation, never a load root."""
    base = os.environ.get('ARIES_DAEMON_BASE_DIR')
    if not base:
        return None
    return os.path.join(os.path.abspath(base), 'pack-seeds')


def _install_pack_seeds():
    """Install shipped example packs into the normal user pack directory.

    Existing installs are left untouched so a user's edits remain theirs.
    """
    seed_root = _pack_seed_root()
    if not seed_root or not os.path.isdir(seed_root):
        return
    destination_root = _community_root()
    try:
        os.makedirs(destination_root, exist_ok=True)
    except OSError:
        return
    for entry in sorted(os.listdir(seed_root)):
        source = os.path.join(seed_root, entry)
        if not os.path.isfile(os.path.join(source, 'manifest.toml')):
            continue
        destination = os.path.join(destination_root, entry)
        if os.path.exists(destination):
            continue
        try:
            shutil.copytree(source, destination)
        except OSError:
            _log.warning("corpus: could not install pack seed %s", entry)


def _corpus_roots():
    """Runtime pack roots. Interpretation packs are user-installed data."""
    return [_community_root()]


# Back-compat: the single runtime pack root.
def _corpus_root():
    return _community_root()


def _parse_rule_blocks(md_text, source=None):
    """Yield parsed TOML dicts from every fenced ```toml rule block.

    A block that fails to parse is skipped rather than failing the whole
    pack load, but the skip is logged (with source path + rule id if
    recoverable) so a malformed rule surfaces instead of silently vanishing.
    """
    for idx, match in enumerate(_RULE_BLOCK_RE.finditer(md_text)):
        body = match.group(1)
        try:
            yield tomllib.loads(body)
        except tomllib.TOMLDecodeError as exc:
            rid = re.search(r'id\s*=\s*"([^"]*)"', body)
            _log.warning(
                "corpus: skipping malformed rule block #%d (%s) in %s: %s",
                idx, rid.group(1) if rid else "id?", source or "<unknown>", exc,
            )
            continue


def load_packs(root=None, roots=None):
    """Scan the corpus directories, return {pack_id: Pack} with rules indexed.

    Either ``root`` (single path) or ``roots`` (list of paths). When neither
    is given, walks the installed pack root
    (~/Library/Application Support/Aries/packs on
    macOS, $XDG_DATA_HOME/aries/packs on Linux, %APPDATA%/Aries/packs on
    Windows).
    """
    if root is None and roots is None:
        _install_pack_seeds()
    if root is not None:
        roots = [root]
    if roots is None:
        roots = _corpus_roots()
    packs = {}
    for candidate_root in roots:
        if not candidate_root or not os.path.isdir(candidate_root):
            continue
        for entry in sorted(os.listdir(candidate_root)):
            pack_dir = os.path.join(candidate_root, entry)
            manifest_path = os.path.join(pack_dir, 'manifest.toml')
            if not os.path.isfile(manifest_path):
                continue
            try:
                with open(manifest_path, 'rb') as f:
                    manifest = tomllib.load(f)
            except Exception:
                continue
            pack_id = manifest.get('pack', {}).get('id', entry)
            if pack_id in packs:
                # Bundled root wins. Community packs with a colliding id
                # are silently skipped — encourage unique ids.
                continue
            pack = Pack(pack_id, manifest, pack_dir)

            rules_dir = os.path.join(pack_dir, 'rules')
            if os.path.isdir(rules_dir):
                for discipline in sorted(os.listdir(rules_dir)):
                    disc_dir = os.path.join(rules_dir, discipline)
                    if not os.path.isdir(disc_dir):
                        continue
                    for fname in sorted(os.listdir(disc_dir)):
                        if not fname.endswith('.md'):
                            continue
                        theme = os.path.splitext(fname)[0]
                        path = os.path.join(disc_dir, fname)
                        try:
                            with open(path, 'r', encoding='utf-8') as f:
                                md = f.read()
                        except Exception:
                            continue
                        key = (discipline, theme)
                        blocks = pack.rules.setdefault(key, [])
                        for data in _parse_rule_blocks(md, source=path):
                            blocks.append(RuleBlock(pack_id, discipline,
                                                    theme, data, path))

            _validate_declared_kinds(pack)
            packs[pack_id] = pack
    return packs


def _validate_declared_kinds(pack):
    """If the manifest lists [kinds].declared, warn on any that aren't present."""
    declared = (pack.manifest.get('kinds') or {}).get('declared')
    if not declared:
        return
    present = set()
    for blocks in pack.rules.values():
        for block in blocks:
            kind = block.data.get('kind')
            if kind:
                present.add(kind)
    missing = [k for k in declared if k not in present]
    if missing:
        import sys
        sys.stderr.write(
            "corpus_loader: pack '%s' declares kinds not found in rules: %s\n"
            % (pack.id, ', '.join(missing))
        )


def get_rules(packs, discipline, theme):
    """Collect every RuleBlock across active packs for (discipline, theme)."""
    out = []
    for pack in packs.values():
        out.extend(pack.rules.get((discipline, theme), []))
    return out


def get_lookup(packs, kind, pack_id=None):
    """Return the data dict of the first rule whose `kind` matches.

    Used for static lookup tables (verdict matrices, priority tables, the
    house-topic table, etc.) that ship as pack data and are queried by
    engine code rather than emitted as alerts. Returns None when no match.
    Pass `pack_id` to restrict the search to a single pack.
    """
    iterable = (packs[pack_id],) if pack_id else packs.values()
    for pack in iterable:
        if pack is None:
            continue
        for blocks in pack.rules.values():
            for block in blocks:
                if block.data.get('kind') == kind:
                    return block.data
    return None


_SIGN_GLYPHS = ('a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l')
_PLANET_GLYPHS = ('A', 'B', 'C', 'D', 'E', 'F', 'G')  # Sun..Saturn (ids 0..6)


def _moon_position(chrt):
    """Return (sign_idx, deg_in_sign, moon_lon) or None if unavailable."""
    try:
        import astrology
        import planets
        moon = chrt.planets.planets[astrology.SE_MOON]
        lon = moon.data[planets.Planet.LONG]
    except Exception:
        return None
    sign = int(lon // 30) % 12
    deg = lon - 30.0 * int(lon // 30)
    return (sign, deg, lon)


def _format_title(template, chrt):
    """Supply simple template variables — {sign} for Moon sign name today.
    More variables can be added as rule kinds demand them.
    """
    if not template or '{' not in template:
        return template
    sign_names = ('Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo',
                  'Libra', 'Scorpio', 'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces')
    moon = _moon_position(chrt)
    ctx = {}
    if moon is not None:
        ctx['sign'] = sign_names[moon[0]]
    try:
        return template.format(**ctx)
    except Exception:
        return template


def _build_moon_sign_alert(rule, chrt, Alert_cls):
    data = rule.data
    moon = _moon_position(chrt)
    if moon is None:
        return None
    sign_idx, deg_in_sign, _ = moon
    verdict = lookup_moon_sign(data, sign_idx, deg_in_sign)
    if verdict is None or verdict[0] is None:
        return None
    status, body = verdict
    glyph = corpus_predicates.resolve_glyph(data.get('glyph')) or _SIGN_GLYPHS[sign_idx]
    title_tmpl = data.get('title', 'Moon in {sign}')
    title = _format_title(title_tmpl, chrt)
    cite = data.get('cite', '')
    return Alert_cls(status, glyph, title, body, cite, pack=rule.pack_id)


def _build_predicate_alert(rule, chrt, Alert_cls, context=None):
    data = rule.data
    predicate = data.get('predicate')
    if not predicate:
        return None
    args = data.get('args') or {}
    if not corpus_predicates.evaluate_predicate(predicate, chrt, args,
                                                context=context):
        return None
    status = data.get('status', 'caution')
    # Lord-of-house rules resolve their subject planet at eval time — the
    # authored glyph is a placeholder (the lord depends on the chart). The
    # dynamic glyph shows the REAL lord; static is the fallback.
    glyph = corpus_predicates.resolve_dynamic_glyph(
        predicate, args, chrt, context=context)
    if not glyph:
        glyph = corpus_predicates.resolve_glyph(data.get('glyph')) or ''
    title = _format_title(data.get('title', ''), chrt)
    body = data.get('body', '')
    timing = data.get('timing')
    if timing:
        addendum = corpus_predicates.compute_timing_addendum(
            timing, chrt, context=context)
        if addendum:
            body = (body + '\n\n' + addendum) if body else addendum
    cite = data.get('cite', '')
    return Alert_cls(status, glyph, title, body, cite, pack=rule.pack_id)


def _build_moon_sign_alert_ctx(rule, chrt, Alert_cls, context=None):
    # moon_sign_lookup ignores context today; accept the kwarg so the
    # dispatch signature is uniform.
    return _build_moon_sign_alert(rule, chrt, Alert_cls)


_KIND_DISPATCH = {
    'moon_sign_lookup': _build_moon_sign_alert_ctx,
    'predicate_verdict': _build_predicate_alert,
}


def build_alerts(packs, discipline, theme, chrt, Alert_cls, context=None):
    """Walk active pack rules for (discipline, theme), evaluate, return alerts.

    `context` is an optional dict threaded through to predicates that need
    per-question state (e.g. horary quesited_house). Kinds that don't use
    context silently ignore it.
    """
    out = []
    for rule in get_rules(packs, discipline, theme):
        kind = rule.data.get('kind')
        builder = _KIND_DISPATCH.get(kind)
        if builder is None:
            continue
        try:
            alert = builder(rule, chrt, Alert_cls, context=context)
        except Exception:
            continue
        if alert is not None:
            out.append(alert)
    return out


def lookup_moon_sign(rule_data, sign_idx, deg_in_sign):
    """Evaluate a `moon_sign_lookup` rule block against a Moon position.

    Returns (status, body) or None. Common to every pack that ships a
    12-entry sign table — lives here so packs only carry data.
    """
    if rule_data.get('kind') != 'moon_sign_lookup':
        return None
    entries = rule_data.get('entries', {})
    entry = entries.get(str(sign_idx))
    if entry is None:
        return None
    segments = entry.get('segments')
    if segments:
        for seg in segments:
            lo = float(seg.get('deg_from', 0.0))
            hi = float(seg.get('deg_to', 30.0))
            if lo <= deg_in_sign < hi:
                return (seg.get('status'), seg.get('body'))
        return None
    status = entry.get('status')
    body = entry.get('body')
    if status is None or body is None:
        return None
    return (status, body)
