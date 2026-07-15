#!/usr/bin/env python3
"""Lint a community corpus pack before shipping it.

Usage:
    python3 tools/validate_pack.py <pack_dir>
    python3 tools/validate_pack.py ~/Library/Application\\ Support/Aries/packs/witchcraft_grimoire

Checks:
    1. `manifest.toml` exists and is valid TOML.
    2. Required manifest fields: pack.id, pack.name, pack.disciplines.
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
import os
import re
import sys
from pathlib import Path

try:
    import tomllib
except ImportError:
    import tomli as tomllib  # type: ignore

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import corpus_predicates  # noqa: E402
import corpus_loader  # noqa: E402

_RULE_BLOCK_RE = re.compile(r'```toml rule\n(.*?)```', re.DOTALL)

_REQUIRED_RULE_FIELDS = ('id', 'kind', 'title', 'body', 'cite')
_SUPPORTED_KINDS = {'predicate_verdict', 'moon_sign_lookup'}

_TIMING_OPTIONAL_FIELDS = {
    'from', 'from_kind', 'from_house', 'from_house_key',
    'to', 'to_body', 'house', 'house_key',
    'aspects', 'unit',
}


def _err(errors, path, msg):
    errors.append(f'  [{path}] {msg}')


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
    for field in ('id', 'name', 'disciplines'):
        if not pack.get(field):
            _err(errors, manifest_path, f'pack.{field} missing or empty')
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
    return manifest


def _validate_rule(rule_path: Path, block_idx: int, data: dict, errors: list):
    rid = data.get('id', f'<block #{block_idx}>')
    where = f'{rule_path}:{rid}'
    for field in _REQUIRED_RULE_FIELDS:
        if not data.get(field):
            _err(errors, where, f'missing required field "{field}"')
    kind = data.get('kind')
    if kind and kind not in _SUPPORTED_KINDS:
        _err(errors, where, f'unsupported kind "{kind}"; valid: {sorted(_SUPPORTED_KINDS)}')
    if kind == 'predicate_verdict':
        pname = data.get('predicate')
        if not pname:
            _err(errors, where, 'predicate_verdict rule has no `predicate` field')
        elif pname not in corpus_predicates.PREDICATES:
            _err(errors, where,
                 f'predicate "{pname}" not registered in corpus_predicates.PREDICATES')
    timing = data.get('timing')
    if timing is not None:
        if not isinstance(timing, dict):
            _err(errors, where, 'timing must be a table')
        else:
            extra = set(timing) - _TIMING_OPTIONAL_FIELDS
            if extra:
                _err(errors, where,
                     f'timing has unknown field(s): {sorted(extra)}; '
                     f'allowed: {sorted(_TIMING_OPTIONAL_FIELDS)}')


def _validate_rules(pack_dir: Path, manifest: dict, errors: list) -> int:
    rules_dir = pack_dir / 'rules'
    if not rules_dir.is_dir():
        return 0
    rule_count = 0
    declared_disciplines = set((manifest.get('pack') or {}).get('disciplines') or ())
    seen_disciplines = set()
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
                _validate_rule(rule_path, i, data, errors)
                rule_count += 1
    # Cross-check disciplines
    for disc in seen_disciplines - declared_disciplines:
        _err(errors, pack_dir / 'manifest.toml',
             f'rules/{disc}/ exists but pack.disciplines does not list "{disc}"')
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
    errors: list = []
    manifest = _validate_manifest(pack_dir, errors)
    rule_count = _validate_rules(pack_dir, manifest, errors)

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
