# SPDX-FileCopyrightText: Morinus contributors
# SPDX-FileCopyrightText: 2026 Max Lange (Aries modifications)
# SPDX-License-Identifier: GPL-3.0-or-later
# Modified for Aries in 2026 by Max Lange.

"""Daemon-side corpus rule-pack toggles — port of the wx inspector pack strip.

ORACLE: workspace_shell.py:2455 ``_populate_pack_toggles`` (checkbox per pack,
name shown, id as tooltip, checked = pack in the global active filter) +
workspace_shell.py:2490 ``_collect_active_pack_ids_from_ui`` /
workspace_shell.py:2558 ``_on_pack_toggled`` (flip one pack while preserving
the rest, ``None`` == all active) + morin.py:9005 ``_on_inspector_pack_change``
(persist via ``rule_engine.save_active_pack_ids_to(options.optsdirtxt)``) +
morin.py:14535 startup restore (``load_active_pack_ids_from``).

The pack list, the active filter, and the toggle semantics all live in
``rule_engine`` (rule_engine.py:91-170) — this service only adapts them to
JSON. Nothing here invents rules, citations, or pack metadata
(memory feedback_corpus_no_hallucination.md): every field passes through from
the Pack manifest verbatim.
"""
from __future__ import annotations

import sys
import threading
from pathlib import Path
from typing import Optional

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

import mtexts
import rule_engine
# Importing the discipline shims populates rule_engine's discipline registry
# (elections_rules.py:50, horary_rules.py:66) — the same registration path wx
# depends on at startup. horary_rules also owns the per-theme default
# significator contexts (DEFAULT_SIGNIFICATORS, horary_rules.py:43-61).
import elections_rules  # noqa: F401
import horary_rules
import corpus_semantics

from webapp.daemon.chart_service import chart_snapshot_service


# Menu-tooltip text per theme — meaning carried by the wx Charts menus
# (elections: morin.py:18891-18896 doc strings; horary: morin.py:18925-18930
# tips dict). Catalog data, so it ships with the discipline catalog instead of
# living as a hardcoded label array in the skin. Built at SERVE time (not import)
# so each value resolves through mtexts under the active langid.
def _theme_tooltips() -> dict:
    return {
        "elections": {
            "Traveling": mtexts.txts.get("TipElecTraveling", "Election for travel and journeys"),
            "Meetings": mtexts.txts.get("TipElecMeetings", "Election for meetings and negotiations"),
            "Starting a Business": mtexts.txts.get("TipElecStartBusiness", "Election for starting a business or venture"),
            "Marriage": mtexts.txts.get("TipElecMarriage", "Election for marriage"),
            "Medical Procedure": mtexts.txts.get("TipElecMedical", "Election for medical procedures"),
            "Signing Contracts": mtexts.txts.get("TipElecContracts", "Election for signing contracts"),
        },
        "horary": {
            "Considerations": mtexts.txts.get("TipHorConsiderations", "Before-judgment radicality and chart-state aphorisms"),
            "Lost Object": mtexts.txts.get("TipHorLostObject", "Find lost or strayed goods, cattle, or servants"),
            "Theft": mtexts.txts.get("TipHorTheft", "Whether stolen, by whom, where the thief is, when known"),
            "Strayed Beast": mtexts.txts.get("TipHorStrayedBeast", "Lost cattle / livestock — whether recovered, alive or dead"),
            "Marriage Question": mtexts.txts.get("TipHorMarriage", "Whether a marriage shall take effect"),
            "Sickness": mtexts.txts.get("TipHorSickness", "Whether the disease is long or short, life or death"),
            "Absent Person": mtexts.txts.get("TipHorAbsentPerson", "Whether an absent person is alive and when they return"),
            "Battle / War": mtexts.txts.get("TipHorBattle", "Who shall overcome — battle, lawsuit, contention"),
            "Short Journey": mtexts.txts.get("TipHorShortJourney", "Whether a short journey is good to go"),
            "Long Journey / Voyage": mtexts.txts.get("TipHorLongJourney", "Whether a long journey or sea voyage prospers, when he returns"),
            "Pregnancy / Children": mtexts.txts.get("TipHorPregnancy", "Whether with child, when she conceives, sex of the child"),
            "Honour / Preferment": mtexts.txts.get("TipHorHonour", "Whether one shall obtain an office, command, or honour"),
            "Buying / Selling": mtexts.txts.get("TipHorBuyingSelling", "Whether a bargain shall be concluded — house, land, commodity"),
            "Treasure / Things Hid": mtexts.txts.get("TipHorTreasure", "Whether treasure is in the ground, or a thing mislaid shall be found"),
            "Rumour True or False": mtexts.txts.get("TipHorRumour", "Whether the news, letter, or report is true or false"),
            "Partnership": mtexts.txts.get("TipHorPartnership", "Whether a partnership shall hold, and to whose profit"),
            "Removing / Moving": mtexts.txts.get("TipHorRemoving", "Whether to remove from this place to another, or stay"),
            "Counsel / Advice": mtexts.txts.get("TipHorCounsel", "Whether counsel given is honest or deceitful"),
            "Siege / Castle Taken": mtexts.txts.get("TipHorSiege", "Whether a besieged city, town, or castle shall be taken"),
            # Hephaistion Book III questions (migrated 2026-05-04 from Elections)
            "Letters (Heph)": mtexts.txts.get("TipHephLetters", "Hephaistion: whether a letter / message reaches its destination"),
            "Court Case (Heph)": mtexts.txts.get("TipHephCourtCase", "Hephaistion: outcome of a court case or controversy"),
            "Release from Confinement (Heph)": mtexts.txts.get("TipHephRelease", "Hephaistion: when the prisoner is released"),
            "Lost Object (Heph)": mtexts.txts.get("TipHephLostObject", "Hephaistion: whether a lost object is found"),
            "Recovering a Runaway (Heph)": mtexts.txts.get("TipHephRunaway", "Hephaistion: whether a runaway slave / servant is found"),
            "Reconciliation (Heph)": mtexts.txts.get("TipHephReconciliation", "Hephaistion: whether the parties reconcile"),
        },
    }


def _label_to_slug(discipline: str) -> dict:
    """UI theme-label → filesystem theme-slug for a discipline.

    Combines the live shim's built-in `_THEME_SLUGS` (horary / elections) with
    any community pack-manifest themes (`[themes.<discipline>.<slug>]`). Used to
    map the lens-picker labels back to the slugs that `active_theme_slugs`
    reports, so the picker can gate themes by active-pack rules.
    """
    out: dict = {}
    if discipline == "horary":
        out.update(horary_rules._THEME_SLUGS)
    elif discipline == "elections":
        out.update(elections_rules._THEME_SLUGS)
    for entry in rule_engine._pack_themes_for(discipline):
        out[entry["label"]] = entry["slug"]
    return out


def _pack_to_dict(pack_id: str, pack, active_ids) -> dict:
    """Flatten a corpus_loader.Pack (corpus_loader.py:43-56) for JSON."""
    manifest_pack = (pack.manifest or {}).get("pack", {})
    return {
        "id": pack_id,
        # wx shows just the display name; the id rides as tooltip
        # (workspace_shell.py:2474-2477).
        "name": pack.name,
        "era": pack.era or "",
        "short_label": pack.short_label or "",
        "disciplines": list(manifest_pack.get("disciplines") or []),
        # active filter: None == all on (rule_engine.py:91-106).
        "active": (active_ids is None) or (pack_id in active_ids),
    }


def _context_option_payload(field: dict) -> Optional[dict]:
    """Adapt validated snake-case manifest/core metadata to JSON shape."""
    if not isinstance(field, dict):
        return None
    key = field.get("key")
    label_key = field.get("label_key")
    options = []
    for option in field.get("options") or ():
        if isinstance(option, dict):
            value = option.get("value")
            option_label_key = option.get("label_key")
        elif isinstance(option, (tuple, list)) and len(option) == 2:
            value, option_label_key = option
        else:
            return None
        if not isinstance(value, str) or not isinstance(option_label_key, str):
            return None
        options.append({"value": value, "labelKey": option_label_key})
    if (not isinstance(key, str) or not isinstance(label_key, str) or
            not options):
        return None
    scope = field.get("scope", "question_fact")
    if scope not in ("global_doctrine", "question_fact"):
        return None
    payload = {
        "key": key,
        "contextKey": key,
        "labelKey": label_key,
        "options": options,
        "scope": scope,
    }
    if scope == "global_doctrine":
        preference_key = field.get("preference_key") or key
        if not isinstance(preference_key, str):
            return None
        payload["preferenceKey"] = preference_key
    return payload


def _merged_context_options(core_fields, pack_fields) -> list[dict]:
    """Merge selectable context by stable key with core as fallback.

    Pack declarations own a migrated semantic field; core declarations remain
    the compatibility fallback until that metadata moves into a manifest.
    Both channels pass through the same narrow JSON adapter.
    """
    merged = []
    seen = set()
    for field in tuple(pack_fields or ()) + tuple(core_fields or ()):
        payload = _context_option_payload(field)
        if payload is None or payload["key"] in seen:
            continue
        seen.add(payload["key"])
        merged.append(payload)
    return merged


class CorpusPacksService:
    """List corpus packs and flip the global active-pack filter."""

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._restored = False

    def _opts_dir(self) -> Optional[str]:
        # Same persistence root wx uses (morin.py:9008): the live options
        # object's optsdirtxt (options.py:658).
        return getattr(chart_snapshot_service.options, "optsdirtxt", None)

    def _semantic_store(
            self, *, required: bool = False,
    ) -> Optional[corpus_semantics.SemanticProfileStore]:
        options_directory = self._opts_dir()
        if options_directory:
            return corpus_semantics.SemanticProfileStore(options_directory)
        if required:
            raise ValueError("semantic profile persistence is unavailable")
        return None

    def _ensure_restored(self) -> None:
        # Startup restore, mirroring morin.py:14535 (lazy so import order
        # never races options construction).
        if self._restored:
            return
        rule_engine.load_active_pack_ids_from(self._opts_dir())
        rule_engine.load_semantic_profile_from(self._opts_dir())
        rule_engine.set_doctrine_preferences(
            self._validated_stored_doctrine_preferences(),
        )
        self._restored = True

    def _semantic_profile_payload(self) -> dict:
        active_id = rule_engine.get_semantic_profile_id()
        profiles = []
        store = self._semantic_store()
        available = (
            store.profiles()
            if store is not None
            else tuple(
                corpus_semantics.profile(profile_id)
                for profile_id in corpus_semantics.profile_ids()
            )
        )
        for selected in available:
            profile_id = selected["id"]
            profiles.append({
                "id": profile_id,
                "name": selected.get("name"),
                "custom": profile_id not in corpus_semantics.profile_ids(),
                "active": profile_id == active_id,
                # Empty for source-native because its effective fields are
                # deliberately supplied per pack. Concrete presets expose
                # their complete geometry so clients never infer semantics
                # from a display label.
                "semantics": {
                    field: selected[field]
                    for field in corpus_semantics.SEMANTIC_FIELDS
                    if field in selected
                },
            })
        return {
            "profiles": profiles,
            "active_profile_id": active_id,
            "doctrine": self._doctrine_payload(),
        }

    @staticmethod
    def _doctrine_definitions() -> dict[str, dict]:
        """Global doctrine selectors contributed by every installed UI pack.

        Preferences are keyed independently of the predicate context key so a
        pack can share one definition across themes, or explicitly namespace
        two source clauses that happen to use the same local argument name.
        A shared preference must expose the same value universe everywhere;
        otherwise one global choice could silently mean different things on
        different cards.
        """
        definitions: dict[str, dict] = {}
        for discipline, _display in rule_engine.registered_disciplines():
            for entry in rule_engine._pack_themes_for(
                    discipline, include_inactive=True):
                pack = dict(rule_engine.list_packs()).get(entry["pack_id"])
                if pack is not None and getattr(pack, "ui_hidden", False):
                    continue
                defaults = dict(entry.get("default_context") or {})
                for raw_field in entry.get("context_options") or ():
                    field = _context_option_payload(raw_field)
                    if field is None or field["scope"] != "global_doctrine":
                        continue
                    preference_key = field["preferenceKey"]
                    values = tuple(
                        option["value"] for option in field["options"]
                    )
                    existing = definitions.get(preference_key)
                    if existing is not None:
                        existing_values = tuple(
                            option["value"]
                            for option in existing["options"]
                        )
                        if values != existing_values:
                            raise ValueError(
                                "global doctrine preference "
                                f'"{preference_key}" has incompatible '
                                "option definitions; give the source clauses "
                                "distinct preference_key values",
                            )
                        occurrence = {
                            "discipline": discipline,
                            "theme": entry["slug"],
                            "contextKey": field["contextKey"],
                            "defaultValue": defaults.get(field["contextKey"]),
                        }
                        if occurrence not in existing["occurrences"]:
                            existing["occurrences"].append(occurrence)
                        continue
                    definitions[preference_key] = {
                        "key": preference_key,
                        "contextKey": field["contextKey"],
                        "labelKey": field["labelKey"],
                        "options": field["options"],
                        "occurrences": [{
                            "discipline": discipline,
                            "theme": entry["slug"],
                            "contextKey": field["contextKey"],
                            "defaultValue": defaults.get(field["contextKey"]),
                        }],
                    }
        return definitions

    def _validated_stored_doctrine_preferences(self) -> dict[str, str]:
        store = self._semantic_store()
        if store is None:
            return {}
        definitions = self._doctrine_definitions()
        valid = {}
        for key, value in store.doctrine_preferences().items():
            definition = definitions.get(key)
            if definition is None:
                continue
            allowed = {
                option["value"] for option in definition["options"]
            }
            if value in allowed:
                valid[key] = value
        return valid

    def _doctrine_payload(self) -> dict:
        definitions = self._doctrine_definitions()
        preferences = self._validated_stored_doctrine_preferences()
        options = []
        for key in sorted(definitions):
            item = dict(definitions[key])
            if key in preferences:
                item["value"] = preferences[key]
            options.append(item)
        return {
            "preferences": preferences,
            "options": options,
        }

    def _payload(self, discipline: Optional[str]) -> dict:
        active = rule_engine.get_active_pack_ids()
        if discipline:
            # wx scopes the visible toggles to the selected discipline
            # (workspace_shell.py:2472 packs_for_discipline).
            pairs = rule_engine.packs_for_discipline(discipline)
        else:
            pairs = rule_engine.list_packs()
        # Skill-only corpora (ui_hidden=true, e.g. the Morin AG21 pack consumed
        # only by the morin-read CLI skill) never appear in the app UI — not in
        # the title-bar Corpus Packs menu, not in the inspector pack strip.
        pairs = [(pid, p) for pid, p in pairs if not getattr(p, "ui_hidden", False)]
        return {
            "packs": [_pack_to_dict(pid, p, active) for pid, p in pairs],
            "active_pack_ids": sorted(active) if active is not None else None,
        }

    def disciplines(self) -> dict:
        """Discipline + theme catalog for the inspector lens picker.

        Port of _populate_discipline_choice / _populate_theme_choice
        (workspace_shell.py:2441-2454): items come straight from
        rule_engine.registered_disciplines() and theme_labels_for(). Horary
        themes carry their default significator context
        (horary_rules.DEFAULT_SIGNIFICATORS — morin.py:9034 seeds the lens
        from it) so the skin can forward it without computing anything.
        """
        with self._lock:
            # The discipline catalog is filtered through the active-pack
            # state, so it must restore the same persisted pack/profile
            # selection as the list and alert paths.  Otherwise a first-ever
            # catalog request after daemon startup can briefly expose the
            # factory state until some later menu request happens to restore
            # it.
            self._ensure_restored()
            disciplines = []
            theme_tooltips = _theme_tooltips()
            for slug, display in rule_engine.registered_disciplines():
                tips = theme_tooltips.get(slug, {})
                # UNISON with the title-bar Corpus Packs menu: a theme appears
                # only while some ACTIVE pack ships rules for it; a discipline
                # disappears when none do. Toggling a pack off in the menu thus
                # gates the lens picker (the frontend re-fetches this catalog on
                # packsVersion change). ui_hidden packs never contribute.
                active_slugs = rule_engine.active_theme_slugs(slug)
                if not active_slugs:
                    continue
                # Community pack manifests auto-contribute tooltip + default
                # context via `[themes.<discipline>.<theme>]` blocks. Built-in
                # tooltips win on conflict; pack tooltips fill in everything
                # else without code edits in this file.
                pack_meta = rule_engine.theme_metadata_for(slug)
                themes = []
                for label in rule_engine.theme_labels_for(slug):
                    theme_slug = rule_engine.theme_slug_for(slug, label)
                    if theme_slug not in active_slugs:
                        continue  # no active-pack rules for this theme → hide it
                    tooltip = tips.get(label) or (pack_meta.get(label, {}) or {}).get("tooltip") or ""
                    # A pack may extend an established horary theme with a
                    # typed source-definition choice.  Merge that declaration
                    # with the core significator houses instead of dropping it
                    # whenever a built-in default already exists.  Reserved
                    # querent/quesited keys remain owned by the core contract.
                    pack_ctx = (pack_meta.get(label, {}) or {}).get(
                        "default_context",
                    ) or {}
                    core_context_options = ()
                    if slug == "horary":
                        core_context_options = horary_rules.CONTEXT_OPTIONS.get(
                            label, (),
                        )
                    context_options = _merged_context_options(
                        core_context_options,
                        (pack_meta.get(label, {}) or {}).get(
                            "context_options",
                        ),
                    )
                    global_doctrine_keys = {
                        field["contextKey"]
                        for field in context_options
                        if field.get("scope") == "global_doctrine"
                    }
                    ctx = {}
                    if slug == "horary":
                        ctx.update(horary_rules.DEFAULT_SIGNIFICATORS.get(
                            label,
                        ) or {})
                    # A manifest may replace migrated non-role defaults, but
                    # cannot redefine the canonical querent/quesited houses.
                    for key, value in dict(pack_ctx).items():
                        if (key not in ("querent_house", "quesited_house")
                                and key not in global_doctrine_keys):
                            ctx[key] = value
                    ctx = ctx or None
                    themes.append({
                        "label": label,
                        "aliases": rule_engine.theme_aliases_for(
                            slug, theme_slug,
                        ),
                        "tooltip": tooltip,
                        "defaultContext": ctx,
                        "contextOptions": context_options,
                    })
                if not themes:
                    continue
                disciplines.append({
                    "slug": slug,
                    "displayName": display,
                    "themes": themes,
                })
            return {"disciplines": disciplines}

    def list_packs(self, discipline: Optional[str] = None) -> dict:
        with self._lock:
            self._ensure_restored()
            return self._payload(discipline)

    def ensure_restored(self) -> None:
        """Make persisted pack/profile state authoritative for consumers.

        Alert evaluation is intentionally owned by the discipline shims, not
        by this service.  This small door lets their API boundary guarantee
        startup restoration without duplicating options-path knowledge or
        rebuilding a menu payload.
        """
        with self._lock:
            self._ensure_restored()

    def semantic_profiles(self) -> dict:
        with self._lock:
            self._ensure_restored()
            return self._semantic_profile_payload()

    def set_semantic_profile(self, profile_id: str) -> dict:
        with self._lock:
            self._ensure_restored()
            store = self._semantic_store()
            selected = (
                store.profile(profile_id)
                if store is not None
                else corpus_semantics.profile(profile_id)
            )
            # Commit durable state before publishing the new global profile.
            # Evaluations do not take this service lock, so setting first and
            # rolling back on an I/O failure would expose a transient doctrine
            # that the client never successfully selected.
            rule_engine.save_semantic_profile_to(
                self._opts_dir(), selected["id"],
            )
            rule_engine.set_semantic_profile(selected)
            return self._semantic_profile_payload()

    def upsert_semantic_profile(
            self, profile_id: str, semantics: dict,
            name: Optional[str] = None, activate: bool = False) -> dict:
        """Persist a partial user profile, optionally making it active.

        The store validates every dimension against the same enums used by
        pack/rule validation.  It commits durable state before evaluator truth
        changes, and built-in ids cannot be overwritten.
        """
        with self._lock:
            self._ensure_restored()
            store = self._semantic_store(required=True)
            assert store is not None
            selected = store.upsert_custom_profile(
                profile_id, semantics, name=name, activate=activate,
            )
            if activate or rule_engine.get_semantic_profile_id() == selected[
                    "id"]:
                rule_engine.set_semantic_profile(selected)
            return self._semantic_profile_payload()

    def delete_semantic_profile(self, profile_id: str) -> dict:
        """Delete a custom profile; deleting the active one restores current-chart."""
        with self._lock:
            self._ensure_restored()
            store = self._semantic_store(required=True)
            assert store is not None
            selected = store.delete_custom_profile(profile_id)
            rule_engine.set_semantic_profile(selected)
            return self._semantic_profile_payload()

    def patch_doctrine_preferences(
            self, updates: dict[str, Optional[str]]) -> dict:
        """Persist sparse global doctrine overrides and publish atomically.

        ``None`` removes an override, restoring each owning source theme's own
        authored default.  A concrete value must be valid everywhere sharing
        the preference key, so one global choice cannot split card semantics.
        """
        with self._lock:
            self._ensure_restored()
            if not isinstance(updates, dict):
                raise ValueError("doctrine preference updates must be an object")
            definitions = self._doctrine_definitions()
            for key, value in updates.items():
                definition = definitions.get(key)
                if definition is None:
                    raise ValueError(f'unknown doctrine preference: {key}')
                if value is None:
                    continue
                allowed = {
                    option["value"] for option in definition["options"]
                }
                if value not in allowed:
                    raise ValueError(
                        f'unsupported value "{value}" for doctrine '
                        f'preference "{key}"',
                    )
            store = self._semantic_store(required=True)
            assert store is not None
            # Durable state first: failed publication never leaks a temporary
            # evaluator doctrine that the client did not successfully save.
            stored = store.patch_doctrine_preferences(updates)
            valid = {
                key: value for key, value in stored.items()
                if key in definitions and value in {
                    option["value"]
                    for option in definitions[key]["options"]
                }
            }
            rule_engine.set_doctrine_preferences(valid)
            return self._semantic_profile_payload()

    def reload_packs(self) -> dict:
        """Invalidate the disk-backed pack cache and report the live ids."""
        with self._lock:
            self._ensure_restored()
            rule_engine.reload_packs()
            # Pack changes may add/remove doctrine definitions or alter their
            # allowed value universe.  Preserve sparse disk state for a pack
            # that is temporarily absent, but publish only values valid under
            # the newly installed all-pack catalog.
            rule_engine.set_doctrine_preferences(
                self._validated_stored_doctrine_preferences(),
            )
            packs = rule_engine.list_packs()
            return {
                "ok": True,
                "pack_count": len(packs),
                "pack_ids": sorted(pack_id for pack_id, _pack in packs),
                "pack_versions": {
                    pack_id: str(
                        ((_pack.manifest or {}).get("pack") or {}).get(
                            "version", "",
                        )
                    )
                    for pack_id, _pack in packs
                },
            }

    def set_pack_active(
        self, pack_id: str, active: bool, discipline: Optional[str] = None,
    ) -> dict:
        """Flip one pack on/off, preserving every other pack's state.

        Port of _collect_active_pack_ids_from_ui (workspace_shell.py:2490):
        ``None`` (all on) expands to the full id set before the flip; a result
        equal to the full set collapses back to ``None``. Persists like
        morin._on_inspector_pack_change (morin.py:9005).
        """
        with self._lock:
            self._ensure_restored()
            all_ids = {pid for pid, _ in rule_engine.list_packs()}
            current = rule_engine.get_active_pack_ids()
            base = set(all_ids) if current is None else set(current)
            if active:
                base.add(pack_id)
            else:
                base.discard(pack_id)
            rule_engine.set_active_packs(None if base == all_ids else base)
            rule_engine.save_active_pack_ids_to(self._opts_dir())
            return self._payload(discipline)


corpus_packs_service = CorpusPacksService()
