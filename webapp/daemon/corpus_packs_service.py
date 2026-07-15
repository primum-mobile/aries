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


class CorpusPacksService:
    """List corpus packs and flip the global active-pack filter."""

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._restored = False

    def _opts_dir(self) -> Optional[str]:
        # Same persistence root wx uses (morin.py:9008): the live options
        # object's optsdirtxt (options.py:658).
        return getattr(chart_snapshot_service.options, "optsdirtxt", None)

    def _ensure_restored(self) -> None:
        # Startup restore, mirroring morin.py:14535 (lazy so import order
        # never races options construction).
        if self._restored:
            return
        rule_engine.load_active_pack_ids_from(self._opts_dir())
        self._restored = True

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
                label_to_slug = _label_to_slug(slug)
                # Community pack manifests auto-contribute tooltip + default
                # context via `[themes.<discipline>.<theme>]` blocks. Built-in
                # tooltips win on conflict; pack tooltips fill in everything
                # else without code edits in this file.
                pack_meta = rule_engine.theme_metadata_for(slug)
                themes = []
                for label in rule_engine.theme_labels_for(slug):
                    theme_slug = label_to_slug.get(label)
                    if theme_slug not in active_slugs:
                        continue  # no active-pack rules for this theme → hide it
                    tooltip = tips.get(label) or (pack_meta.get(label, {}) or {}).get("tooltip") or ""
                    ctx = None
                    if slug == "horary":
                        ctx = dict(horary_rules.DEFAULT_SIGNIFICATORS.get(label) or {}) or None
                    if ctx is None:
                        pack_ctx = (pack_meta.get(label, {}) or {}).get("default_context")
                        if pack_ctx:
                            ctx = dict(pack_ctx)
                    themes.append({
                        "label": label,
                        "tooltip": tooltip,
                        "defaultContext": ctx,
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
