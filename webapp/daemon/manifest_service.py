"""Daemon-side workspace manifest — the single source for the skin's sidebar
launcher catalog + keyboard-shortcut map.

Paradigm: "stupid skin, working backend". The React skin must NOT own the
sidebar catalog or the shortcut table; both are derived here from the SAME
canonical wx-free structures the desktop sidebar/menus are built from:

  * ``workspace_model.DEFAULT_SECTIONS`` / ``DEFAULT_TOP_ACTIONS`` — the sidebar
    groups + actions (the same tuples ``workspace_shell`` renders).
  * ``shortcut_registry`` — the single source of truth for shortcut keys
    (``MAIN_QUICK_SHORTCUTS`` + ``WORKSPACE_SHORTCUT_OVERRIDES``).

Neither module needs wx to import: ``shortcut_registry`` defers its wx import
(only the live ``AcceleratorTable`` builder touches wx), and ``workspace_model``
is pure data. So this service obeys the daemon's wx-free wiring guard.

Action-id contract (CRITICAL): the manifest emits the EXACT action ids the skin
dispatches on today — ``new`` / ``open`` / ``now`` / ``synastry`` /
``astrocartography`` / ``transit-search`` and the supplementary public kinds
(``transits``, ``solar-revolution`` …). The canonical ``workspace_model`` action
ids (``new_chart``, ``solar_return`` …) are translated to those dispatch ids via
``_DISPATCH_ID``. Actions with no dispatch id (not-yet-built surfaces) are
emitted with ``enabled: False`` so the skin can grey/omit them without
re-deriving the catalog.

Spec parity: doc/migration/surfaces (workspace-daemon).
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

REPO_ROOT = Path(os.environ.get("ARIES_DAEMON_BASE_DIR", "").strip() or Path(__file__).resolve().parents[2])
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

import shortcut_registry  # wx-free data (lazy wx import); single shortcut source
import workspace_model  # wx-free; same DEFAULT_SECTIONS the wx sidebar is built from
import revolutions  # wx-free; Revolutions.PLANETARY_SPECS = the desktop's return bodies
import mtexts
import houses
import posfordate
from webapp.daemon.chart_service import chart_snapshot_service
from webapp.daemon.corpus_packs_service import corpus_packs_service
from webapp.daemon.table_catalog import TABLE_CATALOG
from webapp.daemon import label_i18n, settings_registry


NATIVE_MENU_MANIFEST_PATH = (
    REPO_ROOT / "webapp" / "frontend" / "src-tauri" / "native-menu-manifest.json"
)


# Canonical workspace_model.action_id -> the dispatch id the skin handles in
# home-client.handleSelect. Only these surfaces are wired today; everything else
# is emitted enabled:false (greyed) so the skin renders the full catalog without
# owning it. Keeping this map here (not in the skin) is the whole point.
_DISPATCH_ID = {
    # Top actions
    "new_chart": "new",
    "open_chart": "open",
    "here_and_now": "now",
    # Charts — supplementary children (public kinds, see supplementary_service
    # PUBLIC_TO_FEATURE_KIND) + the two daemon-document launchers.
    "synastry": "synastry",
    "transits": "transits",
    "solar_return": "solar-revolution",
    "lunar_return": "lunar-revolution",
    "planetary_return": "planetary-return",
    "secondary_chart": "secondary-progression",
    "tertiary_chart": "tertiary-progression",
    "minor_chart": "minor-progression",
    "solar_arc_chart": "solar-arc",
    "profections_chart": "profections",
    "solar_average": "solar-average",
    "primary_directions": "directions",
    "astrocart": "astrocartography",
    "astrolabe": "astrolabe",
    "astrolog_sphere": "astrolog-sphere",
    "ascensional_transits": "ascensional-transits",
    "circumambulation": "directions:circumambulation",
    # Graphic Ephemeris — a view-only daemon child (open-ephemeris), not a
    # tables_service row (it is a Canvas2D plot, not a table).
    "ephemeris": "ephemeris",
    # Search is a desktop menu/accelerator surface, not a workspace_model row.
    # It is appended to the Research group below from this same dispatch table.
    "search_module": "transit-search",
}

# Tables / Time Lords sidebar rows — every workspace_model action whose
# canonical id IS a table catalog key dispatches as
# "table:<table_id>". Rich surfaces such as eclipses can still route to a
# dedicated pane in the skin; the manifest only owns the canonical command id.
# Rows with no daemon builder (dodecatemoria, strip, exact_transits, …) get no
# dispatch id and stay greyed. (ephemeris and circumambulation dispatch above as
# dedicated non-generic surfaces.)
_DISPATCH_ID.update({table_id: f"table:{table_id}" for table_id in TABLE_CATALOG})

_CANONICAL_ID = {dispatch_id: action_id for action_id, dispatch_id in _DISPATCH_ID.items()}
_HIDDEN_ACTION_IDS = {"astrolog_sphere", "exact_transits"}
_SUPPRESSED_ACTION_SHORTCUTS = {"minor_chart", "solar_arc_chart"}


# The bodies the desktop's Revolutions menu offers for a planetary return, in
# the same Mercury→Pluto order (morin.py:11285-11292 / 14333-14340). Sourced from
# revolutions.Revolutions.PLANETARY_SPECS (revolutions.py:100-108, eight bodies
# MERCURY..PLUTO) so the skin's body-picker is daemon-owned, not a hardcoded
# frontend enum. ``planetType`` is the int the open route threads through to
# PlanetaryReturnSupplementaryAdapter.
_PLANETARY_RETURN_BODY_LABELS = {
    revolutions.Revolutions.MERCURY: "Mercury",
    revolutions.Revolutions.VENUS: "Venus",
    revolutions.Revolutions.MARS: "Mars",
    revolutions.Revolutions.JUPITER: "Jupiter",
    revolutions.Revolutions.SATURN: "Saturn",
    revolutions.Revolutions.URANUS: "Uranus",
    revolutions.Revolutions.NEPTUNE: "Neptune",
    revolutions.Revolutions.PLUTO: "Pluto",
}


def _planetary_return_bodies() -> list[dict]:
    bodies = []
    for planet_type in sorted(revolutions.Revolutions.PLANETARY_SPECS):
        label = _PLANETARY_RETURN_BODY_LABELS.get(planet_type)
        if label is None:
            continue
        bodies.append({"planetType": int(planet_type), "label": label})
    return bodies


def _shortcut_for(action_id: str, baked_shortcut: str) -> str:
    """Resolve a shortcut for an action.

    Prefer the shortcut already baked into the workspace_model action (computed
    from shortcut_registry at import). Fall back to the registry override map so
    an action with no menu-key fallback still shows its quick key."""
    if baked_shortcut:
        return baked_shortcut
    return shortcut_registry.WORKSPACE_SHORTCUT_OVERRIDES.get(action_id, "")


def _action_payload(action) -> dict:
    """Translate one workspace_model.WorkspaceAction into a manifest action.

    ``id`` is the SKIN DISPATCH id when known, else the canonical id flagged
    disabled. The label + shortcut come straight from the canonical action.

    ``enabled`` here is STATIC catalog membership — "is this surface built in
    the daemon" (does it have a dispatch id) — NOT the wx runtime session gate.
    The runtime gate (has_chart / solar_available / _supplementary_chart_allowed,
    morin._workspace_navigation_state) lives per-document in
    workspace_service._enabled_actions and travels on each document summary as
    ``enabledActions``. Same English word, orthogonal meaning; keep them apart."""
    dispatch_id = _DISPATCH_ID.get(action.action_id)
    enabled = dispatch_id is not None
    payload = {
        "id": dispatch_id or action.action_id,
        # Stable English label; the frontend localizes sidebar labels by id for
        # display (keeps this string usable as a persistence/logic key).
        "label": "Average Returns" if action.action_id == "solar_average" else action.label,
        "enabled": enabled,
    }
    shortcut = _shortcut_for(action.action_id, action.shortcut)
    if shortcut and action.action_id not in _SUPPRESSED_ACTION_SHORTCUTS:
        payload["shortcut"] = shortcut
    # The planetary-return launcher needs a body choice before it can open a
    # child (the desktop has Mercury/Venus/Mars/Jupiter/Saturn Return menu
    # items). Ship that list so the skin renders a body-picker instead of a
    # single launch.
    if action.action_id == "planetary_return":
        payload["bodies"] = _planetary_return_bodies()
    return payload


def _section_items(section) -> list:
    items = [
        item for item in getattr(section, "items", ())
        if getattr(item, "action_id", "") not in _HIDDEN_ACTION_IDS
    ]
    custom = getattr(chart_snapshot_service.options, "workspace_sidebar_action_order", {}) or {}
    ordered_ids = custom.get(section.title, ())
    if not ordered_ids:
        return items
    index_by_id = {getattr(item, "action_id", ""): idx for idx, item in enumerate(items)}
    seen: set[str] = set()
    ordered_items = []
    for action_id in ordered_ids:
        idx = index_by_id.get(action_id)
        if idx is None or action_id in seen:
            continue
        ordered_items.append(items[idx])
        seen.add(action_id)
    for item in items:
        action_id = getattr(item, "action_id", "")
        if action_id not in seen:
            ordered_items.append(item)
    return ordered_items


def _group_payload(section, collapsed_sections: set[str]) -> dict:
    actions = [_action_payload(item) for item in _section_items(section)]
    if section.title == "Research":
        actions.append({
            "id": _DISPATCH_ID["search_module"],
            "label": mtexts.txts.get("Search", "Search"),
            "enabled": True,
            "shortcut": shortcut_registry.workspace_shortcut("search_module"),
        })
    return {
        # Group id from the title (the wx sidebar has no separate id).
        "id": section.title.strip().lower().replace(" ", "-"),
        # Stable English label; frontend localizes by group id for display.
        "label": section.title,
        "collapsed": section.title in collapsed_sections,
        "actions": actions,
    }


def _collapsed_sections() -> set[str]:
    opts = chart_snapshot_service.options
    return set(getattr(opts, "workspace_sidebar_collapsed_sections", ()) or ())


def set_section_collapsed(section_label: str, collapsed: bool) -> dict:
    """Persist one sidebar section's collapsed state.

    Mirrors wx ``_handle_workspace_section_toggle`` (morin.py:10658-10666):
    state lives in ``options.workspace_sidebar_collapsed_sections`` and is saved
    through ``saveWorkspaceSidebarCollapsed``.
    """
    opts = chart_snapshot_service.options
    current = list(getattr(opts, "workspace_sidebar_collapsed_sections", ()) or ())
    if collapsed:
        if section_label not in current:
            current.append(section_label)
    else:
        current = [title for title in current if title != section_label]
    opts.workspace_sidebar_collapsed_sections = current
    save = getattr(opts, "saveWorkspaceSidebarCollapsed", None)
    if callable(save):
        save()
    return build_manifest()


def _canonical_action_id(action_id: str) -> str:
    return _CANONICAL_ID.get(action_id, action_id)


def set_action_order(section_label: str, action_id: str, before_id: str | None) -> dict:
    """Persist launcher order within one sidebar section.

    Mirrors wx ``_handle_workspace_action_move`` (morin.py:10636-10657) while
    accepting the skin dispatch ids the web sidebar uses.
    """
    target = _canonical_action_id(action_id)
    before = _canonical_action_id(before_id) if before_id else None
    section = next(
        (s for s in workspace_model.DEFAULT_SECTIONS if s.title == section_label),
        None,
    )
    if section is None:
        return build_manifest()
    action_ids = [getattr(item, "action_id", "") for item in _section_items(section)]
    if target not in action_ids:
        return build_manifest()
    if before is not None and before not in action_ids:
        return build_manifest()
    new_order = [aid for aid in action_ids if aid != target]
    insert_at = len(new_order)
    if before is not None:
        insert_at = new_order.index(before)
    new_order.insert(insert_at, target)
    opts = chart_snapshot_service.options
    opts.workspace_sidebar_action_order = dict(
        getattr(opts, "workspace_sidebar_action_order", {}) or {}
    )
    opts.workspace_sidebar_action_order[section_label] = list(new_order)
    save = getattr(opts, "saveWorkspaceSidebarOrder", None)
    if callable(save):
        save()
    return build_manifest()


def _native_accelerator_display(accelerator: str) -> str:
    """Render a Tauri accelerator in the shortcut table's macOS glyph style."""
    glyphs = {
        "CmdOrCtrl": "⌘",
        "Cmd": "⌘",
        "Meta": "⌘",
        "Ctrl": "⌃",
        "Control": "⌃",
        "Alt": "⌥",
        "Option": "⌥",
        "Shift": "⇧",
    }
    return " ".join(glyphs.get(part, part) for part in accelerator.split("+") if part)


def _live_native_accelerator_rows(native_menu: dict) -> list[dict]:
    """Flatten only accelerator rows that the installed native menu binds."""
    rows: list[dict] = []
    shortcut_label_keys = {
        "new": "sidebar.action.new",
        "now": "sidebar.action.now",
        "open": "sidebar.action.open",
        "menu.save.current": "home.save",
    }

    def visit(node: dict) -> None:
        for child in node.get("children") or []:
            visit(child)
        accelerator = str(node.get("accelerator") or "").strip()
        status = str(node.get("status") or "")
        if not accelerator or not status.startswith("live"):
            return
        row = {
            "keys": _native_accelerator_display(accelerator),
            "label": str(node.get("label") or node.get("id") or accelerator),
            "group": "WORKSPACE",
            "bound": True,
        }
        label_key = node.get("labelKey") or shortcut_label_keys.get(node.get("id"))
        if label_key:
            row["labelKey"] = label_key
        rows.append(row)

    for menu_node in native_menu.get("menus") or []:
        visit(menu_node)
    return rows


# Action ids whose quick letter lives in MAIN_QUICK_SHORTCUTS and maps to the
# CHART MODES help group. Rows with a handler also bind through the wx CHAR_HOOK;
# handler-less rows such as the Tauri-only Synodic Cycles list bind only through
# this manifest. H/toggle_houses is live on web via options_service even though
# it is not a workspace_model launcher.
def _shortcut_entries(native_menu: dict | None = None) -> list[dict]:
    """Return the complete live Tauri shortcut table.

    The table combines the native menu accelerators, manifest-dispatched quick
    keys, retained Tauri/frontend handlers, and live chart gestures. Legacy wx
    reference rows that have no Tauri binding are deliberately omitted.

    Each row is ``{keys, label, group, bound, commandId?, labelKey?, hidden?}``.
    ``commandId`` appears only when the manifest dispatcher owns the binding;
    retained native/frontend handlers stay documentation-only here so they are
    not registered twice. ``labelKey`` is optional localization metadata.
    """
    if native_menu is None:
        native_menu = _native_menu_manifest()

    entries: list[dict] = []
    entry_by_keys: dict[str, dict] = {}
    label_by_action = _canonical_labels()
    loc = _overlay_localized()

    def append_live(row: dict) -> None:
        """Append once per chord, enriching an earlier canonical row."""
        keys = str(row["keys"])
        existing = entry_by_keys.get(keys)
        if existing is not None:
            if row.get("labelKey"):
                existing["labelKey"] = row["labelKey"]
            return
        row["bound"] = True
        entries.append(row)
        entry_by_keys[keys] = row

    def retained_row(source: dict) -> dict:
        raw_label = str(source.get("label") or "")
        example = source.get("example")
        label = loc.get(raw_label, raw_label)
        if example:
            detail = loc.get(str(example), str(example))
            label = f"{label} ({detail})"
        row = {
            "keys": source["keys"],
            "label": label,
            "group": loc.get(source["group"], source["group"]),
            "bound": True,
        }
        if source.get("labelKey"):
            row["labelKey"] = source["labelKey"]
        return row

    # Always-live workspace affordances and manifest-dispatched accelerators.
    append_live({
        "keys": "?",
        "label": mtexts.txts.get("ToggleKeyboardShortcuts", "Toggle keyboard shortcuts"),
        "labelKey": "help.shortcut.showKeyHints",
        "group": "WORKSPACE",
    })
    append_live({
        "keys": "I",
        "label": mtexts.txts.get("Inspector", "Inspector"),
        "group": "WORKSPACE",
        "commandId": "toggle-inspector",
    })
    append_live({
        "keys": "⌘ E",
        "label": mtexts.txts.get("Data", "Data"),
        "group": "WORKSPACE",
        "commandId": "menu.data",
    })
    for source in shortcut_registry.TAURI_HIDDEN_SHORTCUT_ROWS:
        append_live({
            "keys": source["keys"],
            "label": "",
            "group": "",
            "commandId": source["commandId"],
            "hidden": True,
        })
    live_accelerator_commands = {
        "⌘ W": "workspace.close-active",
        "⌘ F": _DISPATCH_ID["search_module"],
        "⌘ Y": _DISPATCH_ID["synastry"],
        "⌘ ⌥ A": _DISPATCH_ID["ascensional_transits"],
    }
    for chord, label in shortcut_registry.ACCELERATOR_HELP_ROWS:
        command_id = live_accelerator_commands.get(chord)
        if command_id is None:
            continue
        append_live({
            "keys": chord,
            "label": loc.get(label, label),
            "group": "WORKSPACE",
            "commandId": command_id,
        })

    # Native menu chords are live bindings too. Existing manifest-dispatched
    # rows win chord de-duplication so their commandId behavior is unchanged.
    for row in _live_native_accelerator_rows(native_menu):
        append_live(row)

    # Hardcoded Tauri/frontend handlers stay listed without commandId; their
    # retained listeners continue to own the behavior.
    for source in shortcut_registry.TAURI_LIVE_SHORTCUT_ROWS:
        if source["group"] == "WORKSPACE":
            append_live(retained_row(source))

    # Bare-letter chart quick keys. Omit any future registry row until the web
    # binding exists rather than publishing a grey/dead shortcut.
    for key, action_id, _handler in shortcut_registry.MAIN_QUICK_SHORTCUTS:
        bound = (
            action_id in shortcut_registry.WEB_BOUND_QUICK_ACTIONS
            or action_id in {"toggle_houses", "minor_chart", "solar_arc_chart"}
        )
        if not bound:
            continue
        command_id = _DISPATCH_ID.get(action_id)
        label = label_by_action.get(action_id, action_id.replace("_", " ").title())
        if action_id == "solar_arc_chart":
            label = "Aspects"
            command_id = "toggle-aspects"
        elif action_id == "minor_chart":
            label = mtexts.txts.get("MinorAspects", "Minor aspects")
            command_id = "toggle-minor-aspects"
        elif action_id == "toggle_houses":
            command_id = "toggle-houses"
        row = {"keys": key, "label": label, "group": "CHART MODES"}
        if command_id is not None:
            row["commandId"] = command_id
        append_live(row)

    # Live stepping/view gestures shared with the desktop overlay. Esc and the
    # double-Shift trigger are Tauri-live and therefore no longer reference-only.
    live_reference_keys = {
        "← / →", "↑ / ↓", "⇧ + ← / →", "⌥ + ← / →",
        "⇧ + ↑ / ↓", "Tab", "Esc", "⇧ ⇧",
    }
    live_reference_label_keys = {
        "← / →": "help.shortcut.contextualStep",
        "⇧ + ← / →": "help.shortcut.finerStep",
        "⌥ + ← / →": "help.shortcut.finestStep",
        "↑ / ↓": "help.shortcut.weekOrListStep",
        "⇧ + ↑ / ↓": "help.shortcut.lunarQuarter",
        "Tab": "help.shortcut.toggleComparison",
    }
    for group in shortcut_registry.SHORTCUT_HELP_GROUPS:
        raw_title = group.get("title", "")
        if raw_title == "CHART MODES":
            continue
        title = loc.get(raw_title, raw_title)
        for keys, action, example in group.get("items", ()):
            if keys not in live_reference_keys:
                continue
            act = loc.get(action, action)
            ex = loc.get(example, example) if example else None
            row = {
                "keys": keys,
                "label": f"{act} ({ex})" if ex else act,
                "group": title,
            }
            label_key = live_reference_label_keys.get(keys)
            if label_key:
                row["labelKey"] = label_key
            append_live(row)
        for source in shortcut_registry.TAURI_LIVE_SHORTCUT_ROWS:
            if source["group"] == raw_title:
                append_live(retained_row(source))
    return entries


def _overlay_localized() -> dict:
    """English overlay source string -> localized text, resolved at SERVE time.

    The keyboard-overlay rows live in ``shortcut_registry`` (the wx-free single
    source of truth shared with the wx desktop help overlay); the English there
    is the canonical key. Localize for the webapp payload HERE, at the serve
    boundary, because ``mtexts.txts`` is rebound on a language switch — resolving
    at import would freeze the first language. Keyboard glyphs (arrows, ⌘/⇧/⌥,
    'Esc') and the CHART MODES rows (served from MAIN_QUICK_SHORTCUTS labels, not
    these) are intentionally absent. Reuses existing keys where the English is
    already one (Search/Misc/Synastry/ZodiacalReleasing)."""
    return {
        # ACCELERATOR_HELP_ROWS labels
        "Close window": mtexts.txts.get("CloseWindow", "Close window"),
        "Search": mtexts.txts.get("Search", "Search"),
        "Angle at birth": mtexts.txts.get("AngleAtBirth", "Angle at birth"),
        "Zodiacal releasing": mtexts.txts.get("ZodiacalReleasing", "Zodiacal releasing"),
        "Fixed-star angle directions": mtexts.txts.get("FixedStarAngleDirections", "Fixed-star angle directions"),
        "Misc": mtexts.txts.get("Misc", "Misc"),
        "Eclipses": mtexts.txts.get("Eclipses", "Eclipses"),
        "Fixed-star parallels": mtexts.txts.get("FixedStarParallels", "Fixed-star parallels"),
        "Synastry": mtexts.txts.get("Synastry", "Synastry"),
        "Dev panel": mtexts.txts.get("DevPanel", "Dev panel"),
        "Ascensional transits": mtexts.txts.get("AscensionalTransits", "Ascensional transits"),
        # SHORTCUT_HELP_GROUPS TIME STEP / VIEW titles + items
        "TIME STEP": mtexts.txts.get("ShortcutGroupTimeStep", "TIME STEP"),
        "VIEW": mtexts.txts.get("ShortcutGroupView", "VIEW"),
        "day in transits / here-and-now charts": mtexts.txts.get("ShortcutStepDay", "day in transits / here-and-now charts"),
        "step hour": mtexts.txts.get("ShortcutStepHour", "step hour"),
        "step minute": mtexts.txts.get("ShortcutStepMinute", "step minute"),
        "step a week": mtexts.txts.get("ShortcutStepWeek", "step a week"),
        "step to next lunar phase quarter": mtexts.txts.get("ShortcutStepLunarQuarter", "step to next lunar phase quarter"),
        "compare": mtexts.txts.get("ShortcutCompare", "compare"),
        "derived charts only": mtexts.txts.get("ShortcutDerivedChartsOnly", "derived charts only"),
        "close panel / overlay": mtexts.txts.get("ShortcutClosePanel", "close panel / overlay"),
        "open spotlight": mtexts.txts.get("ShortcutOpenSpotlight", "open spotlight"),
        "double-tap shift": mtexts.txts.get("ShortcutDoubleTapShift", "double-tap shift"),
    }


def _canonical_labels() -> dict:
    """action_id -> human label, from the canonical sidebar structures."""
    labels = {a.action_id: a.label for a in workspace_model.DEFAULT_TOP_ACTIONS}
    for section in workspace_model.DEFAULT_SECTIONS:
        for item in section.items:
            labels[item.action_id] = item.label
    return labels


def _corpus_packs_submenu() -> dict | None:
    """Daemon-generated "Corpus Packs" submenu — one check row per installed
    pack, generated live from ``rule_engine.list_packs()`` (via
    ``corpus_packs_service``). Dropping a pack into the community root lists it
    here with zero menu-file edits and zero Rust rebuild.

    Each row is a CHECK item whose checked state mirrors the active-pack filter
    (``None`` == all active, so every pack reads checked). The command id is
    ``corpus.pack:<pack_id>``; the skin toggles the pack via
    ``setCorpusPackActive`` and re-syncs the check state — the SAME door the wx
    inspector pack strip uses (workspace_shell.py:2558 ``_on_pack_toggled``).

    No pack metadata is invented here: name/era/discipline all pass through
    verbatim from ``corpus_packs_service.list_packs`` (memory
    feedback_corpus_no_hallucination.md).
    """
    try:
        payload = corpus_packs_service.list_packs()
    except Exception:
        return None
    packs = payload.get("packs") or []
    children: list[dict] = []
    if not packs:
        children.append({
            "type": "item",
            "id": "corpus.packs.empty",
            "label": mtexts.txts.get("NoCorpusPacksInstalled", "(No corpus packs installed)"),
            "enabled": False,
            "status": "live-dynamic",
            "source": "corpus_packs_service.list_packs() empty",
        })
    for pack in packs:
        pack_id = pack.get("id") or ""
        if not pack_id:
            continue
        era = pack.get("era") or ""
        label = pack["name"] if not era else f"{pack['name']} ({era})"
        children.append({
            "type": "check",
            "id": f"corpus.pack:{pack_id}",
            "label": label,
            "enabled": True,
            "checked": bool(pack.get("active", True)),
            "status": "live-dynamic",
            "source": "rule_engine.list_packs() via corpus_packs_service; toggle = /api/corpus/packs/active",
        })
    return {
        "type": "submenu",
        "id": "menu.corpus-packs",
        "label": mtexts.txts.get("CorpusPacks", "Corpus Packs"),
        "enabled": True,
        "status": "live-dynamic",
        "source": "manifest_service._corpus_packs_submenu — generated from rule_engine.list_packs()",
        "children": children,
    }


def _quick_check(id_: str, label: str, *, label_key: str | None = None) -> dict:
    node = {
        "type": "check",
        "id": id_,
        "label": label,
        "enabled": True,
        "checked": False,
        "status": "live-dynamic",
        "source": "manifest_service._options_menu_children -> React options dispatcher -> /api/options",
    }
    if label_key:
        node["labelKey"] = label_key
    return node


def _quick_radio(prefix: str, choices: list[tuple[str, str]]) -> list[dict]:
    return [_quick_check(f"{prefix}:{value}", label) for value, label in choices]


def _quick_submenu(
    id_: str,
    label: str,
    children: list[dict],
    *,
    label_key: str | None = None,
) -> dict:
    node = {
        "type": "submenu",
        "id": id_,
        "label": label,
        "enabled": True,
        "status": "live-dynamic",
        "source": "manifest_service._options_menu_children - generated from daemon option catalogs",
        "children": children,
    }
    if label_key:
        node["labelKey"] = label_key
    return node


def _mirrored_options_submenus() -> list[dict]:
    """Build the settings sections that must exist on every settings surface.

    The registry supplies order, hierarchy, fields, and localization keys.  The
    command grammar is the same generic grammar used by the native dispatcher,
    so a registered boolean requires no per-surface React handler.
    """
    sections: list[dict] = []
    for section in settings_registry.MIRRORED_SECTIONS:
        children = [
            _quick_check(
                f"quick.options.{setting['group']}:{setting['field']}",
                setting["label"],
                label_key=setting["labelKey"],
            )
            for setting in section["settings"]
        ]
        sections.append(_quick_submenu(
            section["menuId"],
            section["label"],
            children,
            label_key=section["labelKey"],
        ))
    return sections


def _theme_presets_submenu() -> dict:
    children = []
    for definition in settings_registry.THEME_PRESET_DEFINITIONS:
        name = definition["name"]
        label = str(mtexts.txts.get(definition.get("mtextKey"), name))
        children.append(_quick_check(f"quick.options.theme-preset:{name}", label))
    children.extend([
        {"type": "separator"},
        _quick_check(
            "quick.options.colors:follow_os_theme",
            "Follow OS theme",
            label_key="quickopt.followOsTheme",
        ),
    ])
    return _quick_submenu(
        "menu.options.quick.theme-presets",
        "Theme presets",
        children,
        label_key="quickopt.themePresets",
    )


def _options_menu_children() -> list[dict]:
    house_labels = {
        'P': 'Placidus', 'K': 'Koch', 'R': 'Regiomontanus', 'C': 'Campanus',
        'E': 'Equal', 'W': 'Whole Sign', 'X': 'Axial Rotation', 'Q': 'True Ascendant', 'M': 'Morinus',
        'H': 'Horizon', 'T': 'Polich-Page (Topocentric)', 'B': 'Alcabitius',
        'O': 'Porphyry', 'N': 'None',
    }
    aspect_labels = [
        str(mtexts.txts.get(key, fallback))
        for key, fallback in (
            ('Conjunctio', 'Conjunction'),
            ('Semisextil', 'Semisextile'),
            ('Semiquadrat', 'Semisquare'),
            ('Sextil', 'Sextile'),
            ('Quintile', 'Quintile'),
            ('Quadrat', 'Square'),
            ('Trigon', 'Trine'),
            ('Sesquiquadrat', 'Sesquisquare'),
            ('Biquintile', 'Biquintile'),
            ('Quinqunx', 'Quinqunx'),
            ('Oppositio', 'Opposition'),
            ('Septile', 'Septile'),
        )
    ]
    ayanamsha_choices = [
        (str(i), str(label)) for i, label in mtexts.ayanamsha_display_entries()
    ]
    return [
        _quick_submenu("menu.options.quick.wheel-layout", "Wheel layout", [
            *_quick_radio("quick.options.layout", [
                ("0", "Classic Wheel"),
                ("1", "Compact Wheel"),
                ("2", "Anglo Wheel"),
            ]),
            {"type": "separator"},
            _quick_submenu(
                "menu.options.quick.anglo-dense-label-layout",
                "House line routing",
                [
                    _quick_check(
                        "quick.options.anglo-dense-label-layout:leader-columns",
                        "Straight house lines",
                        label_key="optmenu.leaderColumns",
                    ),
                    _quick_check(
                        "quick.options.anglo-dense-label-layout:routed-cusps",
                        "Routed house lines",
                        label_key="optmenu.routedCuspLines",
                    ),
                ],
                label_key="optmenu.angloDenseLabelLayout",
            ),
        ]),
        {"type": "separator"},
        _quick_submenu("menu.options.quick.node", "Node calculation", _quick_radio(
            "quick.options.node",
            [
                ("1", str(mtexts.menutxts['OMNMean']).split('\t')[0]),
                ("0", str(mtexts.menutxts['OMNTrue']).split('\t')[0]),
            ],
        )),
        _quick_submenu("menu.options.quick.ayanamsha", "Ayanamsha", _quick_radio(
            "quick.options.ayanamsha", ayanamsha_choices,
        )),
        _quick_submenu("menu.options.quick.houses", "House system", _quick_radio(
            "quick.options.house",
            [(code, house_labels.get(code, code)) for code in houses.Houses.hsystems],
        )),
        {"type": "separator"},
        _quick_submenu("menu.options.quick.layers", "Chart layers", [
            _quick_check("quick.options.display:houses", "Houses"),
            _quick_check("quick.options.display:housesystem", "House system label"),
            _quick_check("quick.options.display:showchiron", "Chiron"),
            _quick_check("quick.options.display:showvertex", "Vertex"),
            _quick_check("quick.options.display:shownodes", "Nodes"),
            _quick_check("quick.options.display:showlof", "Fortuna"),
            _quick_check("quick.options.display:showprenatalsyzygy", "Prenatal Syzygy"),
            _quick_check("quick.options.display:positions", str(mtexts.txts.get("Positions", "Speculum"))),
            _quick_check("quick.options.display:intables", "In tables"),
            _quick_check("quick.options.terms", "Terms"),
            _quick_check("quick.options.display:showdecans", "Decans"),
            _quick_check("quick.options.display:topocentric", "Topocentric Moon"),
            _quick_check("quick.options.display:morin_antiscia", "Morin antiscia"),
            {"type": "separator"},
            _quick_check("quick.options.transcendental:0", "Uranus"),
            _quick_check("quick.options.transcendental:1", "Neptune"),
            _quick_check("quick.options.transcendental:2", "Pluto"),
        ]),
        _quick_submenu("menu.options.quick.aspects", "Aspects", [
            _quick_check("quick.options.display:aspects", "Aspects"),
            _quick_check("quick.options.display:symbols", "With symbols"),
            _quick_check("quick.options.traditional-aspects", "Traditional only"),
            _quick_check("quick.options.display:showaspectstovertex", "Aspects to Vertex"),
            _quick_check("quick.options.display:aspectstonodes", "Aspects to Nodes"),
            _quick_check("quick.options.display:showaspectstolof", "Aspects to Fortuna"),
            _quick_check("quick.options.display:showlofouterring", "Outer-ring Fortuna label"),
            {"type": "separator"},
            *[_quick_check(f"quick.options.aspect:{i}", label) for i, label in enumerate(aspect_labels)],
            {"type": "separator"},
            _quick_check("quick.options.exclusive-aspects", "Exclusive on click"),
            _quick_check("quick.options.exclusive-minor", "Exclusive click: show minor"),
            _quick_check("quick.options.exclusive-traditional", "Exclusive click: traditional"),
            _quick_check("quick.options.display:aspect_thickness_mode", "Orb as line thickness"),
            _quick_check("quick.options.display:aspect_flag_show_parties", "Planets in hover flag"),
        ]),
        _quick_submenu("menu.options.quick.outer", "Outer ring and signals", [
            *_quick_radio("quick.options.fixstars", [
                ("0", str(mtexts.txts.get('None', 'None'))),
                ("1", str(mtexts.txts.get('FixStars', 'Fixed Stars'))),
                ("6", str(mtexts.txts.get('Asteroids', 'Asteroids'))),
                ("7", str(mtexts.txts.get('Midpoints', 'Midpoints'))),
                ("8", str(mtexts.txts.get('HybridHits', 'Hybrid Hits'))),
                ("4", str(mtexts.txts.get('Dodecatemoria', 'Dodecatemoria'))),
                ("2", str(mtexts.txts.get('Antiscia', 'Antiscia'))),
                ("3", str(mtexts.txts.get('ContraAntiscia', 'Contraantiscia'))),
                ("5", str(mtexts.txts.get('ArabicParts', 'Arabic Parts'))),
            ]),
            {"type": "separator"},
            _quick_check("quick.options.display:showfixstarsnodes", "Fixstars to Nodes"),
            _quick_check("quick.options.display:showfixstarshcs", "Fixstars to intermediate HCs"),
            _quick_check("quick.options.display:showfixstarslof", "Fixstars to Fortuna"),
            {"type": "separator"},
            _quick_submenu("menu.options.quick.phasis", "Phasis mode", _quick_radio("quick.options.phasis", [
                ("0", "Astronomical"),
                ("1", "Hellenistic"),
                ("2", "Swiss Ephemeris"),
            ])),
            _quick_check("quick.options.display:extendedradixstations", "Phasis modern planets"),
            _quick_check("quick.options.display:showcazimi", "Cazimi"),
            _quick_submenu("menu.options.quick.cazimi", "Cazimi mode", _quick_radio("quick.options.cazimi", [
                ("0", "Hellenistic · 1°"),
                ("2", "Abu Ma'shar · 16'"),
                ("1", "al-Qabisi · 16' + latitude"),
            ])),
            _quick_submenu("menu.options.quick.synodic", "Synodic Shift+Arrow", _quick_radio("quick.options.synodic", [
                ("0", "Station+Cazimi"),
                ("1", "All"),
            ])),
            _quick_check("quick.options.display:showeclipseoverlay", "Eclipse overlay"),
        ]),
        _quick_submenu("menu.options.quick.points", "Planets and points", [
            _quick_submenu("menu.options.quick.fortuna", "Lot of Fortune", _quick_radio("quick.options.fortuna", [
                ("0", str(mtexts.txts.get('LFMoonSun', 'Moon - Sun'))),
                ("1", str(mtexts.txts.get('LFDSunMoon', 'Diurnal: Sun - Moon'))),
                ("2", str(mtexts.txts.get('LFDMoonSun', 'Diurnal: Moon - Sun'))),
            ])),
            _quick_submenu("menu.options.quick.syzygy", "Syzygy", _quick_radio("quick.options.syzygy", [
                ("0", str(mtexts.txts.get('SyzMoon', 'Moon'))),
                ("1", str(mtexts.txts.get('SyzAbove', 'Above horizon'))),
                ("2", str(mtexts.txts.get('SyzAboveNatal', 'Above natal horizon'))),
            ])),
        ]),
        _quick_submenu("menu.options.quick.layout", "Header and layout", [
            _quick_check("quick.options.quickcharts:subcharts_open_compound_default", "Sub charts as biwheels"),
            _quick_check("quick.options.display:planetarydayhour", "Planetary hour"),
            _quick_check("quick.options.display:information", "Information"),
            _quick_check("quick.options.display:showseconds", "Seconds in header"),
            _quick_check("quick.options.display:show_help_chip", "Chart navigation bar"),
        ]),
        _quick_submenu("menu.options.quick.progressions", "Progressions and returns", [
            _quick_submenu("menu.options.quick.progressed-angle", "Progressed angles", _quick_radio(
                "quick.options.progressed-angle",
                [(str(v), posfordate.progression_angle_method_label(v)) for v in sorted(posfordate.ANGLE_METHOD_NAMES)],
            )),
            _quick_submenu("menu.options.quick.progression-day", "Progression day type", _quick_radio(
                "quick.options.progression-day",
                [(str(v), posfordate.progression_day_type_label(v)) for v in sorted(posfordate.PROGRESSION_DAY_TYPE_NAMES)],
            )),
            _quick_submenu("menu.options.quick.launch-mode", "Progressions / Transits", _quick_radio("quick.options.launch-mode", [
                ("0", "Chart"),
                ("1", "Table"),
                ("2", "Both"),
            ])),
            _quick_check("quick.options.quickcharts:timed_chart_show_radix_default", "Timed rows show radix"),
            {"type": "separator"},
            _quick_submenu("menu.options.quick.solar-year", "Solar return year", _quick_radio("quick.options.solar-year", [
                ("0", "Current year"),
                ("1", "Next year"),
            ])),
            _quick_submenu("menu.options.quick.solar-location", "Solar return location", _quick_radio("quick.options.solar-location", [
                ("0", "Use natal"),
                ("1", "Ask"),
            ])),
            _quick_submenu("menu.options.quick.lunar-location", "Lunar return location", _quick_radio("quick.options.lunar-location", [
                ("0", "Use natal"),
                ("1", "Ask"),
            ])),
            _quick_submenu("menu.options.quick.planetary-location", "Planetary return location", _quick_radio("quick.options.planetary-location", [
                ("0", "Use natal"),
                ("1", "Ask"),
            ])),
            _quick_check("quick.options.return-mode:tithi_pravesha", "Tithi Pravesha (Annual Soli-Lunar Return)"),
            _quick_check("quick.options.return-mode:soli_lunar", "Lunar Phase (Embolismic)"),
            _quick_check("quick.options.return-mode:jonas_arc", "Jonas Arc"),
            _quick_check("quick.options.revolutions:revsidereal_marr_solar", "Marr sidereal solar returns"),
            _quick_check("quick.options.revolutions:revsidereal_marr_lunar", "Marr sidereal lunar returns"),
            _quick_check("quick.options.revolutions:revsidereal_marr_planet", "Marr sidereal planetary returns"),
        ]),
        _quick_submenu("menu.options.quick.timelords", "Time lords and alerts", [
            _quick_check("quick.options.profections:wholeSign", "Whole-sign profections"),
            _quick_check("quick.options.profections:zodiacal", "Zodiacal profections"),
            _quick_check("quick.options.profections:useZodProjs", "Use zodiacal projections"),
            _quick_check("quick.options.profections:solarReturnSnap", "Snap to solar return"),
            _quick_submenu("menu.options.quick.firdaria", "Firdaria order", _quick_radio("quick.options.firdaria", [
                ("1", str(mtexts.txts.get('Bonatus', 'Bonatus'))),
                ("0", str(mtexts.txts.get('AlBiruni', 'Al-Biruni'))),
            ])),
            _quick_check("quick.options.stepalerts:stepalerts_enabled", "Step conjunction alerts"),
        ]),
        *_mirrored_options_submenus(),
        _quick_submenu("menu.options.quick.other", "Other options", [
            _quick_submenu("menu.options.quick.mansions-zodiac", "Lunar Mansions zodiac", _quick_radio("quick.options.mansions", [
                ("auto", "Follow chart zodiac"),
                ("sidereal", "Always sidereal"),
                ("tropical", "Always tropical"),
            ])),
            _quick_submenu("menu.options.quick.eclipse-moment", "Eclipse chart moment", _quick_radio("quick.options.eclipse", [
                ("exact_conjunction", "Exact conjunction"),
                ("eclipse_maximum", "Eclipse maximum"),
            ])),
            _quick_submenu("menu.options.quick.relationship", "Relationship launcher", _quick_radio("quick.options.relationship", [
                ("0", "Open Synastry first"),
                ("1", "Open Composite first"),
            ])),
            _quick_check("quick.options.display:usetradfixstarnamespdlist", "Traditional fixed-star names in PD lists"),
        ]),
        _theme_presets_submenu(),
    ]


# Native menu-bar label localization. The JSON base ships English labels. Every
# static node is routed either through this id -> mtexts map (legacy labels with
# complete engine catalogs) or through _NATIVE_MENU_FRONTEND_KEYS below (modern
# labels translated by React). This split also lets the Rust shell build the
# visible legacy/top-level menu labels in the active language at startup.
_NATIVE_MENU_LABEL_KEYS = {
    # top-level titles
    "menu.file": "MHoroscope", "menu.tables": "MTable", "menu.charts": "MCharts",
    "menu.options": "MOptions", "menu.help": "MHelp",
    # File
    "new": "HMNew", "menu.data": "HMData", "now": "HMHereAndNow", "open": "HMLoad",
    "menu.save": "Save",
    "menu.save.current": "HMSave", "menu.export": "HMSaveAsBmp",
    "synastry": "HMSynastry", "menu.find-time": "HMFindTime",
    # Tables
    "menu.tables.planets-points": "PlanetsPoints",
    "menu.table.positions": "TMPositions", "menu.table.antiscia": "TMAntiscia",
    "menu.table.dodecatemoria": "TMDodecatemoria", "menu.table.strip": "TMStrip",
    "menu.table.aspects": "TMAspects", "menu.table.zodiacal-parallels": "TMZodPars",
    "menu.table.speeds": "TMSpeeds", "menu.table.rise-set": "TMRiseSet",
    "menu.table.planetary-hours": "TMPlanetaryHours", "menu.table.phasis": "TMPhasis",
    "menu.table.midpoints": "TMMidpoints", "menu.table.arabic-parts": "TMArabianParts",
    "menu.table.eclipses": "TMEclipses", "menu.table.misc": "TMMisc",
    "menu.tables.almutens": "TMAlmutens", "menu.table.almuten-chart": "TMAlmutenChart",
    "menu.table.almuten-points": "TMAlmutenZodiacal", "menu.table.almuten-topical": "TMAlmutenTopical",
    "menu.tables.fixed-stars": "OMFixStarsOpt", "menu.table.fixed-stars": "TMFixStars",
    "menu.table.fixed-star-aspects": "TMFixStarsAsps", "menu.table.fixed-star-parallels": "TMFixStarsParallels",
    "menu.table.paranatellonta": "TMParanatellonta", "menu.table.angle-at-birth": "TMAngleAtBirth",
    "menu.tables.time-lords": "TimeLords",
    "menu.table.profections": "TMProfections", "menu.table.firdaria": "TMFirdaria",
    "menu.table.decennials": "TMDecennials", "menu.table.zodiacal-releasing": "TMZodiacalReleasing",
    "menu.table.triplicity-directions": "TriplicityDirections",
    "menu.table.circumambulation": "TMCircumambulation", "ephemeris": "HMEphemeris",
    "menu.tables.primary-directions": "PrimaryDirections",
    "directions": "TMPrimaryDirs",
    "menu.table.fixed-star-angle-directions": "TMFixStarAngleDirs",
    "menu.table.mundane-positions": "TMMunPos", "menu.table.user-speculum": "TMCustomerSpeculum",
    "menu.table.monthly-transits": "TMExactTransits", "transit-search": "Search",
    # Charts
    "profections": "PMProfections", "menu.progressions": "Progressions",
    "secondary-progression": "PMSecondaryDirs",
    "menu.secprog.positions": "PMPositionForDate", "menu.chart.square": "PMSquareChart",
    "menu.chart.mundane": "PMMundane", "astrolabe": "PMAstrolabe",
    "menu.other-revolutions": "PMRevolutions", "menu.transits": "PMTransits",
    "transits": "PMTransits", "menu.sun-transits": "PMSunTransits",
    "solar-revolution": "Solar Return", "lunar-revolution": "Lunar Return",
    "ascensional-transits": "AscensionalTransits",
    "menu.elections": "PMElections", "menu.horary": "Horary",
    # Options entries present in the JSON base (the runtime replaces these with
    # the generated quick-options tree, whose nodes carry optmenu.* labelKeys).
    "appearance.toggle": "OMAppearance1", "menu.colors": "OMColors",
    "menu.symbols": "OMSymbols", "menu.lunar-mansions": "LunarMansions",
    "menu.house-system": "OMHouseSystem",
    "menu.options.planets-points": "PlanetsPoints",
    "menu.options.speculum": "OMAppearance2", "menu.options.orbs": "OMOrbs",
    "menu.options.dignities": "Dignities", "menu.options.nodes": "OMNodes",
    "menu.options.arabic-parts": "ArabicParts", "menu.options.syzygy": "OMSyzygy",
    "menu.options.almutens": "OMAlmutens", "menu.options.fixed-stars": "OMFixStarsOpt",
    "menu.options.time-lords": "TimeLords",
    "menu.options.primary-directions": "PrimaryDirections",
    "menu.options.default-location": "OMDefLocationOpt",
    "menu.options.revolutions": "PMRevolutions",
    "menu.options.quick-charts": "Progressions", "menu.options.eclipses": "TMEclipses",
    "menu.options.relationship-charts": "RelationshipCharts",
    "menu.ayanamsha": "OMAyanamsha", "menu.options.languages": "OMLanguages",
    # Help
    "menu.help.help": "HEMHelp", "menu.help.about": "HEMAbout",
}


# Modern native-menu rows that have no legacy mtexts equivalent. These use the
# canonical frontend catalog so live relabeling never falls back to the English
# JSON label. Every key in this map is required in every shipped locale by the
# native-menu localization regression test.
_NATIVE_MENU_FRONTEND_KEYS = {
    "menu.save.as": "nativeMenu.saveAs",
    "menu.startup.set": "nativeMenu.useCurrentAsStartupChart",
    "menu.startup.clear": "nativeMenu.clearStartupChart",
    "menu.restore-open-charts": "nativeMenu.restoreOpenChartsOnLaunch",
    "menu.recent-charts": "nativeMenu.recentCharts",
    "menu.recent-charts.empty": "nativeMenu.noRecentCharts",
    "menu.import.charts": "nativeMenu.importCharts",
    "menu.table.asteroids": "chartmenu.asteroids",
    "menu.table.surveil-studies": "chartmenu.surveilStudies",
    "menu.help.license": "license.menuItem",
    "menu.help.features": "featureCatalog.menuItem",
    "menu.alternative-charts": "nativeMenu.alternativeCharts",
    "planetary-return:2": "nativeMenu.mercuryReturn",
    "planetary-return:3": "nativeMenu.venusReturn",
    "planetary-return:4": "nativeMenu.marsReturn",
    "planetary-return:5": "nativeMenu.jupiterReturn",
    "planetary-return:6": "nativeMenu.saturnReturn",
    "planetary-return:7": "nativeMenu.uranusReturn",
    "planetary-return:8": "nativeMenu.neptuneReturn",
    "planetary-return:9": "nativeMenu.plutoReturn",
    "elections:Traveling": "nativeMenu.electionTraveling",
    "elections:Meetings": "nativeMenu.electionMeetings",
    "elections:Starting a Business": "nativeMenu.electionStartingBusiness",
    "elections:Marriage": "nativeMenu.electionMarriage",
    "elections:Medical Procedure": "nativeMenu.electionMedicalProcedure",
    "elections:Signing Contracts": "nativeMenu.electionSigningContracts",
    "horary:Considerations": "nativeMenu.horaryConsiderations",
    "horary:Lost Object": "nativeMenu.horaryLostObject",
    "horary:Theft": "nativeMenu.horaryTheft",
    "horary:Strayed Beast": "nativeMenu.horaryStrayedBeast",
    "horary:Marriage Question": "nativeMenu.horaryMarriageQuestion",
    "horary:Sickness": "nativeMenu.horarySickness",
    "horary:Absent Person": "nativeMenu.horaryAbsentPerson",
    "horary:Battle / War": "nativeMenu.horaryBattleWar",
    "horary:Short Journey": "nativeMenu.horaryShortJourney",
    "menu.options.display": "nativeMenu.displayCharts",
    "cycle-secondary-view": "nativeMenu.cycleSecondaryView",
    "toggle-houses": "nativeMenu.toggleHouses",
    "menu.options.step-alerts": "nativeMenu.steppingAlerts",
}


def _attach_native_menu_frontend_keys(node: dict) -> None:
    key = _NATIVE_MENU_FRONTEND_KEYS.get(node.get("id"))
    if key:
        node["labelKey"] = key
    for child in node.get("children") or []:
        _attach_native_menu_frontend_keys(child)


def _mtext_menu_label(key: str) -> str | None:
    """Resolve an mtexts key to a clean menu label: drop the ``\\t`` accelerator
    tail and the wx ``&`` mnemonic marker. Checks menutxts then txts."""
    for table in (getattr(mtexts, "menutxts", {}) or {}, getattr(mtexts, "txts", {}) or {}):
        if key in table:
            text = str(table[key]).split("\t")[0].replace("&", "").strip()
            if text:
                return text
    return None


def _localize_native_menu(node: dict) -> None:
    """Depth-first relabel of a native-menu node from _NATIVE_MENU_LABEL_KEYS
    using the currently active mtexts language (mtexts.setLang has already bound
    the active tables). Only mapped ids are touched; all else is left as-is."""
    key = _NATIVE_MENU_LABEL_KEYS.get(node.get("id"))
    if key:
        label = _mtext_menu_label(key)
        if label:
            node["label"] = label
    for child in node.get("children") or []:
        _localize_native_menu(child)



def _native_menu_manifest() -> dict:
    """Shared native menu-bar manifest consumed by Tauri and exposed to React.

    Hybrid tree: a JSON BASE loaded from the file under ``src-tauri`` plus a
    DAEMON-GENERATED "Corpus Packs" submenu appended live. The Rust shell fetches
    this whole tree at startup and builds the native menu from it, so editing the
    JSON base no longer needs a Rust rebuild, and dropping in a corpus pack lists
    it automatically (no menu edits at all). Disabled/deferred rows intentionally
    remain present with source citations instead of becoming silent no-ops.

    Legacy-backed labels are localized against the active mtexts language at
    startup. Modern static labels and the generated Options submenu carry stable
    frontend labelKeys; both the native live-relabel path and BrowserMenuBar
    resolve those keys from the shared React catalogs.
    """
    # Resolve the active language FIRST — accessing options triggers
    # activate_language() which rebinds mtexts; _options_menu_children() below
    # reads mtexts, so it must run AFTER the switch or its labels bind to English.
    try:
        active_langid = int(getattr(chart_snapshot_service.options, "langid", 0) or 0)
    except Exception:
        active_langid = 0
    with NATIVE_MENU_MANIFEST_PATH.open("r", encoding="utf-8") as handle:
        manifest = json.load(handle)
    for menu_node in manifest.get("menus", []):
        _attach_native_menu_frontend_keys(menu_node)
    options_menu = next(
        (m for m in manifest.get("menus", []) if m.get("id") == "menu.options"),
        None,
    )
    if options_menu is not None:
        # The generated quick-options tree fully replaces the broad legacy
        # settings catalog. The titlebar drawer supplies its separate Full
        # settings entry; Cycle secondary view remains available by shortcut.
        options_menu["children"] = _options_menu_children()
    packs_submenu = _corpus_packs_submenu()
    if packs_submenu is not None:
        menus = manifest.setdefault("menus", [])
        # Append the generated Packs submenu after the file-based menus, before
        # Help if Help is present (so Help stays last, matching the wx menu-bar
        # convention where Help is the rightmost top-level menu).
        help_idx = next(
            (i for i, m in enumerate(menus) if m.get("id") == "menu.help"),
            None,
        )
        if help_idx is None:
            menus.append(packs_submenu)
        else:
            menus.insert(help_idx, packs_submenu)
    # Options submenu: emit stable labelKeys (language-neutral); the FRONTEND
    # relabel path translates them from the shared catalog (optmenu.*). The
    # submenu is nested (not shown at startup), so translating it post-boot has
    # no visible flash. This replaces the old daemon-side translation.
    if options_menu is not None:
        label_i18n.attach_label_keys(options_menu, label_i18n.OPTIONS_MENU_KEYS)
    # Top-level File/Tables/Charts/Help still localize at boot via mtexts (they
    # are visible immediately); the frontend relabel re-pushes them unchanged.
    if active_langid:
        for menu_node in manifest.get("menus", []):
            _localize_native_menu(menu_node)
    return manifest


def build_manifest() -> dict:
    """The workspace manifest: sidebar groups + top actions + shortcut rows.

    Shape (consumed by client.fetchWorkspaceManifest):
      { groups: [{id, label, actions: [{id, label, enabled, shortcut?}]}],
        topActions: [{id, label, enabled, shortcut?}],
        shortcuts: [{keys, label, group, commandId?, labelKey?, bound}],
        nativeMenu: {menus: [...]} }

    ``shortcuts`` contains live Tauri bindings only; ``bound`` remains for wire
    compatibility and is therefore true on every emitted row.

    ``actions[].enabled`` is the STATIC "this surface is built in the daemon"
    flag (catalog membership); the per-session RUNTIME gate (has_chart /
    solar_available / composite) rides each workspace document summary as
    ``enabledActions`` (workspace_service._enabled_actions). The two are
    orthogonal — do not conflate them.
    """
    collapsed_sections = _collapsed_sections()
    native_menu = _native_menu_manifest()
    return {
        "groups": [
            _group_payload(section, collapsed_sections)
            for section in workspace_model.DEFAULT_SECTIONS
        ],
        "topActions": [_action_payload(a) for a in workspace_model.DEFAULT_TOP_ACTIONS],
        "shortcuts": _shortcut_entries(native_menu),
        "nativeMenu": native_menu,
        "settingsRegistry": settings_registry.registry_payload(),
    }


class ManifestService:
    """Thin holder so the endpoint mirrors the other daemon services."""

    def manifest(self) -> dict:
        return build_manifest()

    def set_section_collapsed(self, section_label: str, collapsed: bool) -> dict:
        return set_section_collapsed(section_label, collapsed)

    def set_action_order(
        self,
        section_label: str,
        action_id: str,
        before_id: str | None,
    ) -> dict:
        return set_action_order(section_label, action_id, before_id)


manifest_service = ManifestService()
