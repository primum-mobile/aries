# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Corpus pack discovery + loader.

A *pack* is an editable content contribution installed in the Aries user pack
directory. It may contain interpretation rules, passive inspector source text,
or both. A rule pack has:

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

import hashlib
import logging
import inspect
import os
import re
import shutil
import stat
import sys
import tempfile
import tomllib

import corpus_predicates
import corpus_pack_validation
import corpus_semantics

_log = logging.getLogger(__name__)

_RULE_BLOCK_RE = re.compile(r"```toml\s+rule\s*\n(.*?)```", re.DOTALL)


class CorpusPackLoadError(ValueError):
    """A requested transactional pack reload could not be accepted."""


class RuleBlock(object):
    __slots__ = ('pack_id', 'discipline', 'theme', 'data', 'source_path',
                 'semantic_defaults')

    def __init__(self, pack_id, discipline, theme, data, source_path,
                 semantic_defaults=None):
        self.pack_id = pack_id
        self.discipline = discipline
        self.theme = theme
        self.data = data
        self.source_path = source_path
        self.semantic_defaults = dict(semantic_defaults or {})


class Pack(object):
    __slots__ = ('id', 'name', 'era', 'short_label', 'manifest', 'rules',
                 'root', 'themes', 'ui_hidden', 'semantic_defaults',
                 'inspector_content')

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
        self.semantic_defaults = dict(manifest.get('semantics') or {})
        # Passive inspector source text is a pack capability, not an
        # interpretation discipline. Keys are (region kind, object id).
        self.inspector_content = {}
        # rules[(discipline, theme)] -> list[RuleBlock]
        self.rules = {}
        # themes[(discipline, slug)] ->
        # {label, tooltip, default_context, context_options}
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
                # Selectable context is a typed manifest channel, not part of
                # the context forwarded to predicates.  Strict reloads reject
                # malformed declarations; permissive startup fails closed by
                # omitting the complete option block.
                try:
                    context_options = (
                        corpus_pack_validation.normalize_theme_context_options(
                            spec,
                        )
                    )
                except ValueError:
                    context_options = []
                # Everything except display/option metadata goes into
                # default_context — keeps the manifest schema open without
                # the loader needing to know discipline-specific context keys.
                default_ctx = {k: v for k, v in spec.items()
                               if k not in (
                                   'label', 'tooltip', 'context_options',
                               )}
                self.themes[(discipline, slug)] = {
                    'label': label,
                    'tooltip': spec.get('tooltip', ''),
                    'default_context': default_ctx or None,
                    'context_options': context_options,
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
    base = os.path.abspath(base)
    packaged = os.path.join(base, 'pack-seeds')
    if os.path.isdir(packaged):
        return packaged
    # In Tauri development the daemon base is the repository root while the
    # resource staging tree mirrors the packaged ``pack-seeds/`` directory.
    development = os.path.join(
        base, 'webapp', 'frontend', 'src-tauri', 'target',
        'aries-pack-seeds',
    )
    if os.path.isdir(development):
        return development
    return packaged


_IGNORED_PACK_TREE_NAMES = {'.DS_Store', '__pycache__'}
_IGNORED_PACK_TREE_SUFFIXES = ('.pyc', '.bak')


def _is_link_like(path):
    """Return true for links/junctions that an upgrade must never traverse."""
    try:
        if os.path.islink(path):
            return True
        isjunction = getattr(os.path, 'isjunction', None)
        return bool(isjunction and isjunction(path))
    except OSError:
        return True


def _pack_tree_digest(root):
    """Fingerprint authored regular files in a pack, or ``None`` if unsafe.

    The digest is deliberately independent of mtimes and file modes.  It is a
    SHA-256 stream of sorted POSIX relative paths and file bytes, each separated
    by NUL.  Generated finder/Python/backup artifacts are ignored; every other
    file participates, so any user content edit prevents an automatic upgrade.
    """
    root = os.path.abspath(os.fspath(root))
    if (not os.path.isdir(root) or _is_link_like(root)):
        return None
    digest = hashlib.sha256()
    walk_errors = []
    try:
        for base, directories, filenames in os.walk(
                root, topdown=True, followlinks=False,
                onerror=walk_errors.append):
            safe_directories = []
            for name in sorted(directories):
                path = os.path.join(base, name)
                if _is_link_like(path):
                    return None
                if name not in _IGNORED_PACK_TREE_NAMES:
                    safe_directories.append(name)
            directories[:] = safe_directories
            for name in sorted(filenames):
                path = os.path.join(base, name)
                if _is_link_like(path):
                    return None
                if (name in _IGNORED_PACK_TREE_NAMES or
                        name.endswith(_IGNORED_PACK_TREE_SUFFIXES)):
                    continue
                metadata = os.lstat(path)
                if not stat.S_ISREG(metadata.st_mode):
                    return None
                relative = os.path.relpath(path, root).replace(os.sep, '/')
                digest.update(relative.encode('utf-8'))
                digest.update(b'\0')
                flags = os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0)
                descriptor = os.open(path, flags)
                with os.fdopen(descriptor, 'rb') as handle:
                    if not stat.S_ISREG(os.fstat(handle.fileno()).st_mode):
                        return None
                    while True:
                        chunk = handle.read(1024 * 1024)
                        if not chunk:
                            break
                        digest.update(chunk)
                digest.update(b'\0')
    except (OSError, UnicodeError, ValueError):
        return None
    if walk_errors:
        return None
    return digest.hexdigest()


def _pack_manifest_identity(root):
    try:
        with open(os.path.join(root, 'manifest.toml'), 'rb') as handle:
            manifest = tomllib.load(handle)
    except (OSError, tomllib.TOMLDecodeError):
        return None, None, {}
    pack = manifest.get('pack') or {}
    return str(pack.get('id') or ''), str(pack.get('version') or 'legacy'), manifest


def _seed_upgrade_hashes(source):
    _pack_id, _version, manifest = _pack_manifest_identity(source)
    upgrade = manifest.get('upgrade') or {}
    hashes = upgrade.get('replace_unmodified_tree_hashes') or ()
    if not isinstance(hashes, (list, tuple)):
        return ()
    valid = []
    for value in hashes:
        candidate = str(value).strip().lower()
        if re.fullmatch(r'[0-9a-f]{64}', candidate):
            valid.append(candidate)
    return tuple(valid)


def _next_pack_backup_path(backup_root, entry, version, tree_digest):
    safe_version = re.sub(r'[^A-Za-z0-9_.-]+', '-', version).strip('-')
    stem = f'{entry}-{safe_version or "legacy"}-{tree_digest[:12]}'
    candidate = os.path.join(backup_root, stem)
    suffix = 2
    while os.path.lexists(candidate):
        candidate = os.path.join(backup_root, f'{stem}-{suffix}')
        suffix += 1
    return candidate


def _upgrade_unmodified_pack_seed(source, destination, destination_root, entry):
    """Atomically replace one allowlisted official tree and retain a backup."""
    installed_digest = _pack_tree_digest(destination)
    seed_digest = _pack_tree_digest(source)
    if not installed_digest or not seed_digest or installed_digest == seed_digest:
        return None
    allowed_hashes = _seed_upgrade_hashes(source)
    if installed_digest not in allowed_hashes:
        return None

    seed_id, _seed_version, _seed_manifest = _pack_manifest_identity(source)
    installed_id, installed_version, _installed_manifest = (
        _pack_manifest_identity(destination)
    )
    if seed_id != entry or installed_id != entry:
        _log.warning(
            'corpus: refusing pack seed upgrade with mismatched identity %s',
            entry,
        )
        return None

    application_root = os.path.dirname(os.path.abspath(destination_root))
    backup_root = os.path.join(application_root, 'pack-backups')
    if os.path.lexists(backup_root) and (
            not os.path.isdir(backup_root) or _is_link_like(backup_root)):
        _log.warning(
            'corpus: refusing pack seed upgrade because backup root is unsafe: %s',
            backup_root,
        )
        return None
    try:
        os.makedirs(backup_root, exist_ok=True)
        temporary_root = tempfile.mkdtemp(
            prefix=f'.{entry}-upgrade-', dir=destination_root,
        )
    except OSError:
        _log.warning('corpus: could not prepare pack seed upgrade %s', entry)
        return None

    replacement = os.path.join(temporary_root, entry)
    backup = _next_pack_backup_path(
        backup_root, entry, installed_version, installed_digest,
    )
    moved_old_tree = False
    try:
        shutil.copytree(source, replacement)
        if _pack_tree_digest(replacement) != seed_digest:
            raise OSError('copied seed fingerprint changed')
        # Close the digest/build race: a user edit made while preparing the
        # replacement cancels the upgrade rather than being moved silently.
        if _pack_tree_digest(destination) != installed_digest:
            raise OSError('installed pack changed during upgrade')
        os.replace(destination, backup)
        moved_old_tree = True
        try:
            os.replace(replacement, destination)
        except BaseException:
            os.replace(backup, destination)
            moved_old_tree = False
            raise
    except Exception as exc:
        _log.warning('corpus: pack seed upgrade failed for %s: %s', entry, exc)
        return None
    finally:
        if os.path.isdir(temporary_root) and not _is_link_like(temporary_root):
            try:
                shutil.rmtree(temporary_root)
            except OSError:
                _log.warning(
                    'corpus: could not clean temporary pack upgrade %s',
                    temporary_root,
                )
    if moved_old_tree:
        _log.info(
            'corpus: upgraded unmodified official pack %s; backup retained at %s',
            entry, backup,
        )
        return backup
    return None


def _install_pack_seeds():
    """Install shipped packs and upgrade only known, unmodified old trees.

    Existing installs remain user-owned.  A seed may replace one only when its
    full tree fingerprint appears in the seed manifest's explicit upgrade
    allowlist; the previous tree is retained beside ``packs/`` as a backup.
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
        if (_is_link_like(source) or _pack_tree_digest(source) is None or
                not os.path.isfile(os.path.join(source, 'manifest.toml'))):
            continue
        destination = os.path.join(destination_root, entry)
        if os.path.lexists(destination):
            _upgrade_unmodified_pack_seed(
                source, destination, destination_root, entry,
            )
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


def _parse_rule_blocks(md_text, source=None, strict=False):
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
            if strict:
                raise CorpusPackLoadError(
                    f"malformed rule block #{idx} in "
                    f"{source or '<unknown>'}: {exc}",
                ) from exc
            continue


def _load_inspector_content(pack, strict=False):
    """Load the optional passive inspector-content map for one pack.

    The map contains source selectors only; source prose remains in its parsed
    corpus asset. Loading it with the pack keeps edits and reloads inside the
    existing transactional pack lifecycle without involving rule evaluation.
    """
    content = pack.manifest.get('content') or {}
    spec = content.get('inspector') if isinstance(content, dict) else None
    capabilities = {
        value for value in (
            (pack.manifest.get('pack') or {}).get('capabilities') or ()
        )
        if isinstance(value, str)
    }
    if spec is None:
        if 'inspector_content' not in capabilities:
            return {}
        message = f'{pack.root}/manifest.toml: content.inspector is missing'
        if strict:
            raise CorpusPackLoadError(message)
        _log.warning('corpus: %s', message)
        return {}
    if 'inspector_content' not in capabilities:
        message = (
            f'{pack.root}/manifest.toml: content.inspector requires '
            'pack capability inspector_content'
        )
        if strict:
            raise CorpusPackLoadError(message)
        _log.warning('corpus: %s', message)
        return {}
    if not isinstance(spec, dict):
        message = f'{pack.root}/manifest.toml: content.inspector must be a table'
        if strict:
            raise CorpusPackLoadError(message)
        _log.warning('corpus: %s', message)
        return {}

    source = spec.get('source')
    mapping = spec.get('mapping')
    if not isinstance(source, str) or not source.strip():
        message = f'{pack.root}/manifest.toml: content.inspector.source is missing'
        if strict:
            raise CorpusPackLoadError(message)
        _log.warning('corpus: %s', message)
        return {}
    if source.strip() not in {'valens'}:
        message = f'{pack.root}/manifest.toml: unsupported inspector source {source}'
        if strict:
            raise CorpusPackLoadError(message)
        _log.warning('corpus: %s', message)
        return {}
    if not isinstance(mapping, str) or not mapping.strip() or os.path.isabs(mapping):
        message = f'{pack.root}/manifest.toml: content.inspector.mapping must be a relative path'
        if strict:
            raise CorpusPackLoadError(message)
        _log.warning('corpus: %s', message)
        return {}

    root = os.path.realpath(pack.root)
    path = os.path.realpath(os.path.join(root, mapping))
    try:
        inside_root = os.path.commonpath((root, path)) == root
    except ValueError:
        inside_root = False
    if not inside_root or _is_link_like(path) or not os.path.isfile(path):
        message = f'{pack.root}/manifest.toml: unsafe or missing inspector mapping {mapping}'
        if strict:
            raise CorpusPackLoadError(message)
        _log.warning('corpus: %s', message)
        return {}

    try:
        with open(path, 'rb') as handle:
            data = tomllib.load(handle)
    except Exception as exc:
        message = f'could not parse inspector content mapping {path}: {exc}'
        if strict:
            raise CorpusPackLoadError(message) from exc
        _log.warning('corpus: %s', message)
        return {}

    entries = data.get('entries')
    if data.get('version') != 1 or not isinstance(entries, list):
        message = f'{path}: expected version = 1 and [[entries]] records'
        if strict:
            raise CorpusPackLoadError(message)
        _log.warning('corpus: %s', message)
        return {}

    loaded = {}
    for index, entry in enumerate(entries):
        where = f'{path}: entries[{index}]'
        if not isinstance(entry, dict):
            message = f'{where} must be a table'
        else:
            kind = entry.get('kind')
            object_id = entry.get('object_id')
            book = entry.get('book')
            chapter = entry.get('chapter')
            paragraph = entry.get('paragraph')
            heading = entry.get('heading')
            valid_id = (
                isinstance(object_id, (str, int))
                and not isinstance(object_id, bool)
            )
            valid_location = (
                isinstance(book, int) and not isinstance(book, bool)
                and isinstance(chapter, int) and not isinstance(chapter, bool)
                and (heading is None or isinstance(heading, str))
                and (paragraph is None or (
                    isinstance(paragraph, int) and not isinstance(paragraph, bool)
                    and paragraph >= 1
                ))
            )
            if not isinstance(kind, str) or not kind.strip() or not valid_id:
                message = f'{where} requires string kind and scalar object_id'
            elif not valid_location:
                message = f'{where} requires integer book/chapter and a valid heading/paragraph'
            else:
                key = (kind.strip(), str(object_id))
                if key in loaded:
                    message = f'{where} duplicates inspector target {key[0]}:{key[1]}'
                else:
                    selector = dict(entry)
                    selector['source'] = source.strip()
                    selector['pack_id'] = pack.id
                    loaded[key] = selector
                    continue
        if strict:
            raise CorpusPackLoadError(message)
        _log.warning('corpus: %s', message)

    return loaded


def load_packs(root=None, roots=None, strict=False):
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
            except Exception as exc:
                if strict:
                    raise CorpusPackLoadError(
                        f"could not parse manifest {manifest_path}: {exc}",
                    ) from exc
                continue
            pack_id = manifest.get('pack', {}).get('id', entry)
            if pack_id in packs:
                # Bundled root wins. Community packs with a colliding id
                # are silently skipped — encourage unique ids.
                if strict:
                    raise CorpusPackLoadError(
                        f'duplicate corpus pack id "{pack_id}" at {pack_dir}',
                    )
                continue
            pack = Pack(pack_id, manifest, pack_dir)
            pack.inspector_content = _load_inspector_content(
                pack, strict=strict,
            )

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
                        except Exception as exc:
                            if strict:
                                raise CorpusPackLoadError(
                                    f"could not read corpus rule file "
                                    f"{path}: {exc}",
                                ) from exc
                            continue
                        key = (discipline, theme)
                        blocks = pack.rules.setdefault(key, [])
                        for data in _parse_rule_blocks(
                                md, source=path, strict=strict):
                            blocks.append(RuleBlock(
                                pack_id, discipline, theme, data, path,
                                semantic_defaults=pack.semantic_defaults,
                            ))

            _validate_declared_kinds(pack)
            if strict:
                _validate_runtime_pack(pack)
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


def _validate_runtime_pack(pack):
    """Reject a reload that would turn a valid pack into partial silence.

    The authoring validator remains the exhaustive schema/source lint.  This
    runtime boundary covers the failures that the permissive startup loader
    intentionally tolerates for third-party data: duplicate rule identities,
    unsupported builders, and unknown executable predicates.
    """
    semantic_values = corpus_semantics.SEMANTIC_ALLOWED_VALUES
    statuses = {'good', 'caution', 'avoid', 'info'}
    fidelities = {
        'literal', 'interpretive', 'disputed', 'approximation',
        'unclassified',
    }

    manifest_pack = pack.manifest.get('pack') or {}
    for field in ('id', 'name'):
        if not manifest_pack.get(field):
            raise CorpusPackLoadError(
                f'{pack.root}/manifest.toml: pack.{field} is missing',
            )
    disciplines = manifest_pack.get('disciplines')
    capabilities = manifest_pack.get('capabilities')
    if not isinstance(disciplines, list):
        raise CorpusPackLoadError(
            f'{pack.root}/manifest.toml: pack.disciplines must be an array',
        )
    if capabilities is not None and not isinstance(capabilities, list):
        raise CorpusPackLoadError(
            f'{pack.root}/manifest.toml: pack.capabilities must be an array',
        )
    if isinstance(capabilities, list) and not all(
            isinstance(value, str) for value in capabilities):
        raise CorpusPackLoadError(
            f'{pack.root}/manifest.toml: pack.capabilities must contain strings',
        )
    if not disciplines and not capabilities:
        raise CorpusPackLoadError(
            f'{pack.root}/manifest.toml: pack must declare a discipline or capability',
        )
    if str(manifest_pack.get('id')) != str(pack.id):
        raise CorpusPackLoadError(
            f'{pack.root}/manifest.toml: loaded pack id does not match '
            f'pack.id "{manifest_pack.get("id")}"',
        )
    for field in set(pack.semantic_defaults) - set(semantic_values):
        raise CorpusPackLoadError(
            f'{pack.root}/manifest.toml: unsupported semantics field '
            f'"{field}"',
        )
    for field, value in pack.semantic_defaults.items():
        if value not in semantic_values[field]:
            raise CorpusPackLoadError(
                f'{pack.root}/manifest.toml: unsupported semantics.{field} '
                f'"{value}"',
            )
    _manifest, _rule_count, authoring_errors = (
        corpus_pack_validation.validate_pack_directory(pack.root)
    )
    if authoring_errors:
        raise CorpusPackLoadError(
            'pack failed semantic/schema validation:\n' +
            '\n'.join(authoring_errors),
        )

    def validate_predicate_spec(spec, where, depth=0):
        if not isinstance(spec, dict):
            raise CorpusPackLoadError(
                f'{where}: predicate specification must be a table',
            )
        if depth > 8:
            raise CorpusPackLoadError(
                f'{where}: predicate specification is over-nested',
            )
        predicate = spec.get('predicate')
        if predicate not in corpus_predicates.PREDICATES:
            raise CorpusPackLoadError(
                f'{where}: unknown predicate "{predicate}"',
            )
        args = spec.get('args') or {}
        if not isinstance(args, dict):
            raise CorpusPackLoadError(
                f'{where}: predicate args must be a table',
            )
        fn = corpus_predicates.PREDICATES[predicate]
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
            raise CorpusPackLoadError(
                f'{where}: {predicate} has unknown argument(s) '
                f'{unknown_args}',
            )
        for field in corpus_semantics.SEMANTIC_FIELDS:
            if field in args and args[field] not in semantic_values[field]:
                raise CorpusPackLoadError(
                    f'{where}: unsupported {field} "{args[field]}"',
                )
        if predicate not in ('all_of', 'any_of', 'none_of'):
            return
        conditions = args.get('conditions')
        if not isinstance(conditions, list) or not conditions:
            raise CorpusPackLoadError(
                f'{where}: {predicate} requires a non-empty conditions array',
            )
        for index, condition in enumerate(conditions):
            validate_predicate_spec(
                condition, f'{where}.{predicate}[{index}]', depth + 1,
            )

    seen = set()
    rule_data_by_id = {}
    builders = globals().get('_KIND_DISPATCH') or {}
    for blocks in pack.rules.values():
        for block in blocks:
            data = block.data
            rule_id = str(data.get('id') or '').strip()
            if not rule_id:
                raise CorpusPackLoadError(
                    f'{block.source_path}: corpus rule has no id',
                )
            if rule_id in seen:
                raise CorpusPackLoadError(
                    f'{block.source_path}: duplicate corpus rule id '
                    f'"{rule_id}"',
                )
            seen.add(rule_id)
            rule_data_by_id[rule_id] = data
            kind = data.get('kind')
            if kind not in builders:
                raise CorpusPackLoadError(
                    f'{block.source_path}:{rule_id}: unsupported rule kind '
                    f'"{kind}"',
                )
            for field in ('title', 'cite'):
                if not str(data.get(field) or '').strip():
                    raise CorpusPackLoadError(
                        f'{block.source_path}:{rule_id}: missing {field}',
                    )
            status = data.get('status')
            if status is not None and status not in statuses:
                raise CorpusPackLoadError(
                    f'{block.source_path}:{rule_id}: unsupported status '
                    f'"{status}"',
                )
            fidelity = data.get('source_fidelity')
            if fidelity is not None and fidelity not in fidelities:
                raise CorpusPackLoadError(
                    f'{block.source_path}:{rule_id}: unsupported '
                    f'source_fidelity "{fidelity}"',
                )
            subject_kinds = data.get('subject_kinds')
            if subject_kinds is not None and (
                    not isinstance(subject_kinds, list)
                    or not subject_kinds
                    or any(not isinstance(value, str) or not value.strip()
                           for value in subject_kinds)):
                raise CorpusPackLoadError(
                    f'{block.source_path}:{rule_id}: subject_kinds must be '
                    'a non-empty list of context tokens',
                )
            if kind in ('predicate_verdict', 'predicate_condition',
                        'predicate_finding'):
                if not str(data.get('body') or '').strip():
                    raise CorpusPackLoadError(
                        f'{block.source_path}:{rule_id}: missing body',
                    )
                validate_predicate_spec(
                    data, f'{block.source_path}:{rule_id}',
                )
                if (kind in ('predicate_condition', 'predicate_finding')
                        and status != 'info'):
                    raise CorpusPackLoadError(
                        f'{block.source_path}:{rule_id}: {kind} must use '
                        'status "info"',
                    )
            elif kind == 'moon_sign_lookup':
                if not isinstance(data.get('entries'), dict):
                    raise CorpusPackLoadError(
                        f'{block.source_path}:{rule_id}: moon_sign_lookup '
                        'requires an entries table',
                    )
            elif kind in ('source_note', 'axis_assignment'):
                if not str(data.get('body') or '').strip():
                    raise CorpusPackLoadError(
                        f'{block.source_path}:{rule_id}: missing body',
                    )
                if status != 'info':
                    raise CorpusPackLoadError(
                        f'{block.source_path}:{rule_id}: {kind} must use '
                        'status "info"',
                    )
                if (kind == 'axis_assignment' and
                        str(data.get('point') or '').upper() not in
                        ('ASC', 'MC', 'DSC', 'IC')):
                    raise CorpusPackLoadError(
                        f'{block.source_path}:{rule_id}: invalid axis point',
                    )
                if kind == 'source_note':
                    metadata_errors = (
                        corpus_pack_validation.source_note_metadata_errors(
                            data,
                        )
                    )
                    if metadata_errors:
                        raise CorpusPackLoadError(
                            f'{block.source_path}:{rule_id}: '
                            + '; '.join(metadata_errors),
                        )

    for rule_id, data in rule_data_by_id.items():
        if data.get('kind') != 'source_note':
            continue
        for owner_id in data.get('owner_rule_ids') or ():
            owner = rule_data_by_id.get(owner_id)
            if owner is None:
                raise CorpusPackLoadError(
                    f'{pack.root}:{rule_id}: source-note owner references '
                    f'missing rule "{owner_id}"',
                )
            if not str(owner.get('kind') or '').startswith('predicate_'):
                raise CorpusPackLoadError(
                    f'{pack.root}:{rule_id}: source-note owner '
                    f'"{owner_id}" is not executable',
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
_SIGN_NAMES = ('Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo',
               'Libra', 'Scorpio', 'Sagittarius', 'Capricorn',
               'Aquarius', 'Pisces')
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


def _format_title(template, chrt, context=None):
    """Supply simple chart/context variables to trusted pack prose.

    ``{sign}`` remains the Moon-sign token used by lookup cards.  Scalar
    question-context values such as ``{quesited_house}`` let a card name the
    exact user-selected significator that its predicate and evidence used.
    Private semantic-policy keys and structured values are never exposed.
    """
    if not template or '{' not in template:
        return template
    moon = _moon_position(chrt)
    ctx = {}
    if moon is not None:
        ctx['sign'] = _SIGN_NAMES[moon[0]]
    for key, value in (context or {}).items():
        if (isinstance(key, str) and not key.startswith('_')
                and isinstance(value, (str, int, float))
                and not isinstance(value, bool)):
            ctx[key] = value
    try:
        return template.format(**ctx)
    except Exception:
        return template


def _append_provenance_evidence(evidence, data, context=None):
    """Add the active interpretive lens and explicit fidelity to evidence.

    Older pack rules predate the fidelity field.  Leaving those alerts
    unlabeled makes an unaudited mapping look indistinguishable from a literal
    one, so missing metadata is surfaced honestly as ``unclassified`` until a
    source review assigns a stronger claim.
    """
    parts = [str(evidence).strip()] if str(evidence or '').strip() else []
    profile_id = (context or {}).get('_corpus_semantic_profile')
    if profile_id:
        parts.append(f"[profile:{profile_id}]")
    fidelity = data.get('source_fidelity') or 'unclassified'
    parts.append(f"[fidelity:{fidelity}]")
    return ' · '.join(parts)


def _build_moon_sign_alert(rule, chrt, Alert_cls, context=None):
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
    title = _format_title(title_tmpl, chrt, context)
    cite = data.get('cite', '')
    evidence = _append_provenance_evidence(
        f"Moon · {_SIGN_NAMES[sign_idx]} "
        f"{deg_in_sign:.2f}° · [zodiac-segment]",
        data, context,
    )
    technical_details = _format_title(
        data.get('method_note', ''), chrt, context,
    )
    return Alert_cls(status, glyph, title, body, cite, pack=rule.pack_id,
                     rule_id=data.get('id'), evidence=evidence,
                     title_key=data.get('title_key'),
                     body_key=data.get('body_key'),
                     technical_details=technical_details)


def _build_predicate_alert(rule, chrt, Alert_cls, context=None):
    data = rule.data
    predicate = data.get('predicate')
    if not predicate:
        return None
    base_context = dict(context or {})
    subject_kinds = data.get('subject_kinds')
    if subject_kinds is not None:
        allowed = {
            str(value).strip().lower().replace('-', '_').replace(' ', '_')
            for value in subject_kinds
        }
        raw_subject_kind = base_context.get('subject_kind')
        if raw_subject_kind is None and 'animal' in allowed:
            # Backward-compatible theme default.  The manifest supplies the
            # same value in normal inspector evaluation; direct rule-engine
            # consumers that predate the new explicit gate still mean the
            # historical Strayed Beast (animal) question.
            raw_subject_kind = 'animal'
        actual = str(raw_subject_kind or '').strip().lower().replace(
            '-', '_',
        ).replace(' ', '_')
        if actual not in allowed:
            return None
    user_profile = (
        base_context.get('_corpus_semantic_profile_values') or
        base_context.get('_corpus_semantic_profile')
    )
    args = corpus_semantics.resolve_predicate_args(
        data.get('args') or {}, user_profile, rule.semantic_defaults,
    )
    base_context['_corpus_semantics'] = {
        field: args[field]
        for field in corpus_semantics.SEMANTIC_FIELDS if field in args
    }
    if not corpus_predicates.evaluate_predicate(predicate, chrt, args,
                                                context=base_context):
        return None
    match = corpus_predicates.resolve_predicate_match(
        predicate, args, chrt, context=base_context,
    )
    status = data.get('status', 'caution')
    # Lord-of-house rules resolve their subject planet at eval time — the
    # authored glyph is a placeholder (the lord depends on the chart). The
    # dynamic glyph shows the REAL lord; static is the fallback.
    glyph = corpus_predicates.resolve_dynamic_glyph(
        predicate, args, chrt, context=base_context, match=match)
    if not glyph:
        glyph = corpus_predicates.resolve_glyph(data.get('glyph')) or ''
    title = _format_title(data.get('title', ''), chrt, base_context)
    body = _format_title(data.get('body', ''), chrt, base_context)
    technical_parts = []
    method_note = _format_title(
        data.get('method_note', ''), chrt, base_context,
    )
    if method_note:
        technical_parts.append(method_note)
    timing = data.get('timing')
    if timing:
        addendum = corpus_predicates.compute_timing_addendum(
            timing, chrt, context=base_context, semantic_args=args)
        if addendum:
            technical_parts.append(addendum)
    cite = data.get('cite', '')
    evidence = _append_provenance_evidence(
        match.get('evidence', '') if match else '', data, base_context,
    )
    timing_witnesses = corpus_predicates.lilly_recovery_rule_witnesses(
        data.get('id'), data, args, chrt, context=base_context,
        match=match, pack_id=rule.pack_id,
    )
    timing_evidence = corpus_predicates.format_lilly_recovery_timing_evidence(
        timing_witnesses,
    )
    if timing_evidence:
        evidence = ' · '.join(filter(None, (evidence, timing_evidence)))
    authored_kind = data.get('kind')
    alert_kind = {
        'predicate_condition': 'condition',
        'predicate_finding': 'finding',
    }.get(authored_kind, 'verdict')
    return Alert_cls(status, glyph, title, body, cite, pack=rule.pack_id,
                     rule_id=data.get('id'), evidence=evidence,
                     kind=alert_kind,
                     timing_witnesses=timing_witnesses,
                     title_key=data.get('title_key'),
                     body_key=data.get('body_key'),
                     technical_details='\n\n'.join(technical_parts))


def _build_source_note_alert(rule, chrt, Alert_cls, context=None):
    """Always-visible, explicitly non-verdict source/context note."""
    data = rule.data
    glyph = corpus_predicates.resolve_glyph(data.get('glyph')) or ''
    role = str(data.get('source_note_role') or 'unclassified')
    note_tokens = [
        '[source-note:non-verdict]',
        f'[source-note-role:{role.replace("_", "-")}]',
    ]
    note_tokens.extend(
        f'[owner-rule:{owner}]'
        for owner in data.get('owner_rule_ids') or ()
    )
    for field, label in (
            ('owner_contract', 'owner-contract'),
            ('required_capability', 'required-capability'),
            ('undefined_field', 'undefined-field'),
            ('ambiguity_key', 'ambiguity-key'),
            ('method_scope', 'method-scope')):
        if data.get(field):
            note_tokens.append(f'[{label}:{data[field]}]')
    return Alert_cls(
        data.get('status', 'info'), glyph, data.get('title', ''),
        data.get('body', ''), data.get('cite', ''), pack=rule.pack_id,
        rule_id=data.get('id'), kind='source_note',
        title_key=data.get('title_key'), body_key=data.get('body_key'),
        technical_details=_format_title(
            data.get('method_note', ''), chrt, context,
        ),
        evidence=_append_provenance_evidence(
            ' · '.join(filter(None, (
                data.get('evidence', ''), *note_tokens,
            ))), data, context,
        ),
    )


def _build_axis_assignment_alert(rule, chrt, Alert_cls, context=None):
    """Source role assigned to an axis without inventing its geometry."""
    data = rule.data
    point = data.get('point')
    if not point:
        return None
    base_context = dict(context or {})
    semantic_args = corpus_semantics.resolve(
        data.get('args') or {},
        base_context.get('_corpus_semantic_profile_values') or
        base_context.get('_corpus_semantic_profile'),
        rule.semantic_defaults,
    )
    base_context['_corpus_semantics'] = {
        field: semantic_args[field]
        for field in corpus_semantics.SEMANTIC_FIELDS
        if field in semantic_args
    }
    glyph = corpus_predicates.resolve_glyph(data.get('glyph')) or ''
    return Alert_cls(
        data.get('status', 'info'), glyph, data.get('title', ''),
        data.get('body', ''), data.get('cite', ''), pack=rule.pack_id,
        rule_id=data.get('id'), kind='axis_assignment',
        title_key=data.get('title_key'), body_key=data.get('body_key'),
        technical_details=_format_title(
            data.get('method_note', ''), chrt, base_context,
        ),
        evidence=_append_provenance_evidence(
            corpus_predicates.resolve_axis_evidence(
                chrt, point, semantic_args.get('point_frame', 'profile'),
            ),
            data, base_context,
        ),
    )


def _build_moon_sign_alert_ctx(rule, chrt, Alert_cls, context=None):
    return _build_moon_sign_alert(rule, chrt, Alert_cls, context=context)


_KIND_DISPATCH = {
    'moon_sign_lookup': _build_moon_sign_alert_ctx,
    'predicate_verdict': _build_predicate_alert,
    'predicate_condition': _build_predicate_alert,
    'predicate_finding': _build_predicate_alert,
    'source_note': _build_source_note_alert,
    'axis_assignment': _build_axis_assignment_alert,
}


def _rule_evaluation_context(
        packs, discipline, theme, rule, context=None,
        doctrine_preferences=None, core_question_fields=None):
    """Resolve source defaults and global doctrine for one owning pack.

    Coexisting packs may intentionally assign different authored defaults to
    the same context key.  Resolve against ``rule.pack_id`` here instead of
    flattening theme metadata once, so source-native evaluation remains truly
    source-native.  Caller context may override question facts, but never a
    field explicitly scoped as global doctrine.
    """
    pack = packs.get(rule.pack_id) if isinstance(packs, dict) else None
    spec = None
    if pack is not None:
        spec = (getattr(pack, 'themes', None) or {}).get((discipline, theme))
    spec = spec if isinstance(spec, dict) else {}

    defaults = dict(spec.get('default_context') or {})
    fields = {
        field.get('key'): field
        for field in spec.get('context_options') or ()
        if isinstance(field, dict) and field.get('key')
    }
    declared_question_fields = {
        key for key, field in fields.items()
        if field.get('scope', 'question_fact') == 'question_fact'
    }
    # A legacy pack default without selectable metadata historically behaved
    # as per-question context; retain that migration behavior.  Explicitly
    # scoped doctrine never enters this set.
    declared_question_fields.update(
        key for key in defaults if key not in fields
    )
    allowed_question_fields = (
        declared_question_fields | set(core_question_fields or ()) |
        {'querent_house', 'quesited_house'}
    )
    trusted_runtime_fields = {'fixing_chart', 'partner_chart', 'theme'}
    caller_context = dict(context or {})
    core_fallbacks = caller_context.get('_corpus_core_question_defaults')
    if not isinstance(core_fallbacks, dict):
        core_fallbacks = {}
    resolved = {
        key: value for key, value in dict(context or {}).items()
        if (isinstance(key, str) and (
            (key.startswith('_')
             and key != '_corpus_core_question_defaults')
            or key in allowed_question_fields
            or key in trusted_runtime_fields
        ))
    }
    for key, default in defaults.items():
        field = fields.get(key) or {}
        if field.get('scope', 'question_fact') == 'global_doctrine':
            preference_key = field.get('preference_key') or key
            selected = (doctrine_preferences or {}).get(preference_key)
            allowed = {
                option.get('value')
                for option in field.get('options') or ()
                if isinstance(option, dict)
            }
            # Client/lens context is deliberately ignored for doctrine.  An
            # absent or stale global preference restores this pack's own
            # authored default rather than another pack's merged default.
            resolved[key] = selected if selected in allowed else default
        else:
            resolved.setdefault(key, default)
    for key, value in core_fallbacks.items():
        if key in allowed_question_fields:
            resolved.setdefault(key, value)
    return resolved


def build_alerts(
        packs, discipline, theme, chrt, Alert_cls, context=None,
        doctrine_preferences=None, core_question_fields=None):
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
        rule_context = _rule_evaluation_context(
            packs, discipline, theme, rule, context,
            doctrine_preferences, core_question_fields,
        )
        try:
            alert = builder(rule, chrt, Alert_cls, context=rule_context)
        except Exception:
            _log.exception(
                "corpus: failed rule %s from %s",
                rule.data.get('id', '<unknown>'), rule.source_path,
            )
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
