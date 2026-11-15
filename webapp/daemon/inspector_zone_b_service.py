# SPDX-FileCopyrightText: Morinus contributors
# SPDX-FileCopyrightText: 2026 Max Lange (Aries modifications)
# SPDX-License-Identifier: GPL-3.0-or-later
# Modified for Aries in 2026 by Max Lange.

"""Daemon-side inspector Zone B — source-text significations + pack alerts.

Zone B is the inspector body zone below the hover/region card. Two pieces are
engine-computed and daemon-portable:

- **Significations** — passive source-text definitions contributed by an active
  inspector-content pack. Valens maps planet, sign, house, and bounds targets to the
  existing parsed corpus without entering an interpretation discipline.
  Original text and citations pass through from CorpusDB. Display paragraphs
  omit a bounds passage's leading degree labels, already shown in its header.

- **Pack alerts** — the active-lens rule-engine verdicts, produced by
  ``elections_rules.evaluate`` / ``horary_rules.evaluate`` exactly as the wx
  ORACLE ``morin._refresh_pack_alerts`` (morin.py:8959) calls them. The lens
  (discipline / theme / context) is taken as request params — the daemon does
  NOT reconstruct MFrame lens-management state.

Sits beside the committed Zone-A ``inspector_service``; reuses its chart
identity + region-building so the region dict is identical to the hover path.
"""
from __future__ import annotations

import re
import sys
import threading
from pathlib import Path
from typing import Optional

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from webapp.daemon.inspector_service import inspector_service
from webapp.daemon.fixed_star_inspector import constellation_code
from webapp.daemon import corpus_text

import elections_rules
import corpus_predicates
import engine.corpus_bridge as corpus_bridge
import horary_rules
import rule_engine

from webapp.daemon.corpus_packs_service import corpus_packs_service
from webapp.daemon.display_palette import effective_display_options, sign_color_role
import common

# Lens-resolution constants, mirrored from the wx oracle (morin.py:8994-8999).
_DISCIPLINE_ELECTIONS = "elections"
_DISCIPLINE_HORARY = "horary"


def _sign_glyph_colors(display_options, sign_index: int) -> Optional[dict]:
    """Both canonical display modes let retained source cards repaint locally."""
    if display_options is None or getattr(display_options, "clrsigns", None) is None:
        return None
    bw = bool(getattr(display_options, "bw", False))
    element = common.get_sign_color(display_options, sign_index, force_element=True)
    return {
        "plain": {
            "colour": (0, 0, 0) if bw else display_options.clrsigns,
            "colourRole": None if bw else "--morinus-signs",
        },
        "element": {
            "colour": element,
            "colourRole": sign_color_role(
                display_options, sign_index, force_element=True, resolved_color=element,
            ),
        },
    }


def _color_passage_runs(runs: list, display_options) -> list:
    return [
        {**run, "signColors": _sign_glyph_colors(display_options, run["signIndex"])}
        if "signIndex" in run else run
        for run in runs
    ]


def _section_to_passage(section: Optional[dict], *, display_options=None, omit_bound_degree_label: bool = False, omit_annotations: bool = False) -> Optional[dict]:
    """Flatten a CorpusDB section dict into a JSON passage.

    Original text and citation remain verbatim. Display-only bounds excerpts
    omit their leading degree labels. Decan cards omit annotation spans and
    commentary, without changing the stored source text.
    """
    if not section:
        return None
    book = section.get("book")
    chapter = section.get("chapter")
    cite_bits = []
    if book is not None and chapter is not None:
        cite_bits.append(f"Anthologies {book}.{chapter}")
    if section.get("kroll_page") is not None:
        cite_bits.append(f"Kroll p.{section.get('kroll_page')}")
    if section.get("pingree_page") is not None:
        cite_bits.append(f"Pingree p.{section.get('pingree_page')}")
    display_text = section.get("text") or ""
    if omit_bound_degree_label:
        # Libra has a second, editorial range (<[14-20]>). Remove the whole
        # leading run of range labels, preserving editorial prose elsewhere.
        display_text = re.sub(
            r"^\s*(?:(?:<\[\d+\s*[-–]\s*\d+\]>|\[\d+\s*[-–]\s*\d+\])\s*)+",
            "", display_text, count=1,
        )
    if omit_annotations:
        display_text = corpus_text.main_passage_text(display_text)
    display = corpus_text.structured_section({
        **section, "text": display_text,
        **({"footnotes": []} if omit_annotations else {}),
    })
    return {
        "source": section.get("source") or (
            f"Valens, Anthologies {book}.{chapter}"
            if book is not None and chapter is not None
            else "Valens, Anthologies"
        ),
        "citation": section.get("citation") or ", ".join(cite_bits),
        "citation_label": display["citation"],
        "citation_runs": _color_passage_runs(display["citation_runs"], display_options),
        "heading": section.get("heading"),
        "book": book,
        "book_title": section.get("book_title"),
        "chapter": chapter,
        "chapter_title": section.get("chapter_title"),
        "kroll_page": section.get("kroll_page"),
        "pingree_page": section.get("pingree_page"),
        "tags": list(section.get("tags") or []),
        "text": section.get("text") or "",
        "paragraphs": [
            {**paragraph, "runs": _color_passage_runs(paragraph["runs"], display_options)}
            for paragraph in display["paragraphs"]
        ],
        # Styled runs mirror the wx desktop's corpuspane rendering: cleaned text
        # (LaTeX/page-ref debris removed) segmented into italic / bold /
        # editorial / Morinus-glyph spans. The frontend renders these so the
        # passage formatting matches the desktop instead of dumping raw markers.
        "runs": _color_passage_runs(corpus_text.styled_runs(display_text), display_options),
        "footnotes": display["footnotes"],
        "footnote_runs": [
            _color_passage_runs(runs, display_options) for runs in display["footnote_runs"]
        ],
        "editorial_notes": [] if omit_annotations else list(section.get("editorial_notes") or []),
    }


def _alert_to_dict(alert, *, display_options=None) -> dict:
    """Flatten a rule_engine.Alert (rule_engine.py:29-40) for JSON."""
    glyph = getattr(alert, "glyph", "") or ""
    glyph_colors = None
    symbols = getattr(common, "common", None)
    for signs in (getattr(symbols, "Signs1", ()), getattr(symbols, "Signs2", ())):
        if glyph in signs:
            glyph_colors = _sign_glyph_colors(display_options, signs.index(glyph))
            break
    return {
        "status": getattr(alert, "status", None),
        "glyph": glyph,
        "glyphColors": glyph_colors,
        "title": getattr(alert, "title", "") or "",
        "titleKey": getattr(alert, "title_key", None),
        "body": getattr(alert, "body", "") or "",
        "bodyKey": getattr(alert, "body_key", None),
        "cite": getattr(alert, "cite", "") or "",
        "pack": getattr(alert, "pack", None),
        "kind": getattr(alert, "kind", "verdict") or "verdict",
        "ruleId": getattr(alert, "rule_id", None),
        "evidence": getattr(alert, "evidence", "") or "",
        "technicalDetails": getattr(alert, "technical_details", "") or "",
        "timingWitnesses": list(
            getattr(alert, "timing_witnesses", ()) or ()
        ),
    }


class InspectorZoneBService:
    """Source-text passages + pack alerts for the inspector body zone."""

    def __init__(self) -> None:
        self._lock = threading.RLock()

# ── Significations (B1) ──────────────────────────────────────────────
    def passages(
        self,
        *,
        kind: str,
        object_id: str,
        doc_id: Optional[str] = None,
        source: Optional[str] = None,
        name: str = "Morinus",
        here_now: bool = False,
        chart_role: str = "primary",
        ring_index: Optional[int] = None,
        supplementary_kind: Optional[str] = None,
        comparison_name: Optional[str] = None,
        when_iso: Optional[str] = None,
        binding_payload: Optional[dict] = None,
        view_mode: Optional[int] = None,
        max_results: int = 4,
        at_jd: Optional[float] = None,
    ) -> dict:
        """Return passive source text contributed by the active content pack."""
        with self._lock:
            # The persisted global pack filter is authoritative even when this
            # is the first corpus-related request after daemon startup.
            corpus_packs_service.ensure_restored()
            pack_id, selector = rule_engine.active_inspector_content(
                kind, object_id,
            )
            if pack_id is None:
                return {
                    "region": {"kind": kind, "object_id": object_id},
                    "packId": None,
                    "section": None,
                }
            fixed_star = (
                kind == "secondary_ring"
                and str(object_id).split("|", 1)[0] in {"fixstar", "fixed_star"}
            )
            if selector is None and not fixed_star:
                return {
                    "region": {"kind": kind, "object_id": object_id},
                    "packId": pack_id,
                    "section": None,
                }
            opts, chrt, partner_chart = inspector_service.resolve_chart(
                doc_id=doc_id,
                source=source,
                name=name,
                here_now=here_now,
                supplementary_kind=supplementary_kind,
                comparison_name=comparison_name,
                when_iso=when_iso,
                binding_payload=binding_payload,
                view_mode=view_mode,
                ring_index=ring_index,
                at_jd=at_jd,
            )
            region = inspector_service.build_region(
                chrt,
                partner_chart,
                opts,
                kind,
                object_id,
                chart_role,
            )

            lookup_kind, lookup_id = kind, object_id
            fallback_targets = []
            if fixed_star:
                # Resolve identity from the same live chart/role as Zone A.
                # The renderer's longitude and label are not corpus keys.
                code = (region.get("data") or {}).get("fixstar_code") or ""
                lookup_kind, lookup_id = "fixed_star", code
                constellation = constellation_code(code)
                if constellation:
                    fallback_targets.append(("fixed_star_constellation", constellation))
            contents = rule_engine.active_inspector_contents(
                lookup_kind, lookup_id, fallback_targets=fallback_targets,
            )
            sections = []
            display_options = effective_display_options(opts) if opts is not None else None
            for source_pack_id, source_selector in contents:
                section = _section_to_passage(
                    corpus_bridge.inspector_section(source_selector),
                    display_options=display_options,
                    omit_bound_degree_label=(
                        kind == "term" and source_selector.get("asset") == "valens-bounds"
                    ),
                    omit_annotations=(kind == "decan"),
                )
                if section is not None:
                    sections.append({"packId": source_pack_id, "section": section})

            return {
                "region": {"kind": kind, "object_id": region.get("object_id")},
                "packId": contents[0][0] if contents else pack_id,
                "section": sections[0]["section"] if sections else None,
                "sections": sections,
            }

    # ── Pack alerts (B3) ─────────────────────────────────────────────────
    def alerts(
        self,
        *,
        discipline: Optional[str] = None,
        theme: Optional[str] = None,
        context: Optional[dict] = None,
        doc_id: Optional[str] = None,
        source: Optional[str] = None,
        name: str = "Morinus",
        here_now: bool = False,
        supplementary_kind: Optional[str] = None,
        when_iso: Optional[str] = None,
        binding_payload: Optional[dict] = None,
        view_mode: Optional[int] = None,
    ) -> dict:
        """Evaluate the active lens against the chart — port of
        morin._refresh_pack_alerts (morin.py:8984-9009).

        The lens (discipline/theme/context) is taken as params; this daemon
        does NOT reconstruct MFrame lens auto-adoption / horary-session
        mirroring. An empty alert list is a valid result.
        """
        with self._lock:
            if not discipline or not theme:
                return {
                    "alerts": [], "discipline": None, "theme": None,
                    "context": None, "recoveryTiming": None,
                }

            # Chart source = wx _active_workspace_chart (morin.py:9044-9056):
            # the LIVE session chart (cs.chart — the stepped/derived chart),
            # NEVER the biwheel inner ring. resolve_chart's doc_id path returns
            # the render pair (COMPOUND derived child -> primary=radix), which
            # froze the alert cards while the transit ring stepped. Forcing
            # view_mode=0 on the name-based fallback yields the same active
            # chart (the derived chart itself) for session-less identities.
            fixing_chart = None
            if doc_id:
                from webapp.daemon.workspace_service import workspace_service
                opts, chrt = workspace_service.lens_chart(doc_id)
                try:
                    _opts, primary, comparison = (
                        workspace_service.inspector_charts(doc_id)
                    )
                    # The live lens chart can be either ring.  The other
                    # visibly paired chart is the only unambiguous fixing
                    # supplied by the workspace; a single chart supplies none.
                    fixing_chart = next(
                        (
                            candidate for candidate in (primary, comparison)
                            if candidate is not None and candidate is not chrt
                        ),
                        None,
                    )
                except (AttributeError, RuntimeError, ValueError):
                    fixing_chart = None
            else:
                opts, chrt, fixing_chart = inspector_service.resolve_chart(
                    source=source,
                    name=name,
                    here_now=here_now,
                    supplementary_kind=supplementary_kind,
                    when_iso=when_iso,
                    binding_payload=binding_payload,
                    view_mode=0,
                )

            evaluation_context = dict(context or {})
            if fixing_chart is not None:
                # Runtime-only chart truth: never return or persist this
                # object in the JSON lens context.
                evaluation_context["fixing_chart"] = fixing_chart

            try:
                if discipline == _DISCIPLINE_ELECTIONS:
                    raw_alerts = elections_rules.evaluate(
                        theme, chrt, context=evaluation_context,
                    )
                elif discipline == _DISCIPLINE_HORARY:
                    raw_alerts = horary_rules.evaluate(
                        theme, chrt, context=evaluation_context,
                    )
                else:
                    raw_alerts = []
            except Exception:
                # Mirror the oracle: predicate failure clears alerts (morin.py:9000-9008).
                import traceback

                traceback.print_exc()
                raw_alerts = []

            display_options = effective_display_options(opts) if opts is not None else None
            alerts = [
                _alert_to_dict(a, display_options=display_options)
                for a in (raw_alerts or []) if a is not None
            ]
            timing_witnesses = [
                witness
                for alert in (raw_alerts or []) if alert is not None
                for witness in (
                    getattr(alert, "timing_witnesses", ()) or ()
                )
            ]
            recovery_timing = (
                corpus_predicates.aggregate_lilly_recovery_timing(
                    timing_witnesses, context=context,
                )
                if timing_witnesses else None
            )
            # Pack-tag suppression input: wx tags a card with its pack id only
            # when MORE than one pack ships rules for the discipline
            # (workspace_shell.py:2660-2669). Ship the count so the skin can
            # apply the same gate without recomputing pack scoping.
            try:
                pack_count = len(rule_engine.packs_for_discipline(discipline))
            except Exception:
                pack_count = 0
            return {
                "alerts": alerts,
                "discipline": discipline,
                "theme": theme,
                "context": context,
                "packCount": pack_count,
                "recoveryTiming": recovery_timing,
            }


inspector_zone_b_service = InspectorZoneBService()
