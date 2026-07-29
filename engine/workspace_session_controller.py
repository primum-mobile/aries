"""Wx-free WorkspaceSessionController — the migration keystone.

This is the non-GUI extraction of the ``morin.MFrame`` workspace coordinator.
It reproduces the *semantic* lifecycle that today is trapped in the wx god file
``morin.py``:

- open a document (with parent-attach + ``ChartSession`` construction),
- activate a document (tab-switch coordinator side effects),
- close a document with the descendant cascade and the **dirty + file-backed +
  owns-radix** prompt predicate (returned, never auto-resolved),
- run the session-change fan-out (binding persist + child cascade + title) when
  a cursor changes,
- track per-document ``dirty`` / ``edit_dirty`` / ``step_dirty`` flags.

It is read *from* ``morin.py`` (the oracle) but never imports it — ``morin.py``
drags wx frames, menus, event hacks and process lifecycle. The canonical wx-free
pieces it coordinates are reused verbatim:

- ``workspace_model.WorkspaceState`` — the document tree.
- ``chart_session.ChartSession`` / ``horary_session`` — the per-tab spine.
- ``engine.supplementary_adapter`` registry +
  ``engine.supplementary_headless_driver.SupplementaryHeadlessDriver`` — the
  Binding -> Deriver -> Chart child-rebuild path (the same construction
  ``webapp/daemon/supplementary_service.py`` uses).

The full extraction spec, with ``morin.py`` ``file:line`` citations for every
behaviour, is ``doc/migration/surfaces/workspace-session.md``.

Presentation (drawBkg/Refresh/status/caption/focus/AT-popup/notes/table/
stepper-dialog/step-burst render deferral) is deliberately NOT reproduced — the
controller records the semantic signal (e.g. ``change_reason``) and emits a
structured event for the presentation layer (daemon -> React) to act on.
"""
from __future__ import annotations

import datetime
import math
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional, Tuple

import chart
import chartfile
import mtexts
import chart_session
import horary_session
import workspace_model
from engine import supplementary_adapter
from engine.supplementary_headless_driver import (
    HeadlessChartSession,
    SupplementaryHeadlessDriver,
)

DisplayDateTime = Tuple[int, int, int, int, int, int]

# Canonical enum int -> schema-v1 string (the exact maps chartfile owns,
# chartfile.py:49-74). Reused so the editor seed labels the type/cal/zone the
# same way record_to_editor_fields does — never a second table.
_HTYPE_INDEX_TO_STR = dict(chartfile._HTYPE_TO_STR)
_CAL_INDEX_TO_STR = dict(chartfile._CAL_TO_STR)
_ZT_INDEX_TO_STR = dict(chartfile._ZT_TO_STR)


# Feature kinds whose child charts re-derive from the parent cursor. Mirrors
# SupplementaryHeadlessDriver._supplementary_uses_session_cursor; the controller
# only ever cascades child kinds the headless driver knows how to rebuild.
_CURSOR_DRIVEN_FEATURE_KINDS = frozenset({
    'parallel_transits',
    'solar_average',
    'secondary',
    'solar_arc',
    'minor',
    'tertiary',
    'profections',
    'solar_return',
    'lunar_return',
    'planetary_return',
})


@dataclass
class SessionChangedEvent:
    """Structured fan-out emitted by ``on_session_change`` for the presentation
    layer. Mirrors the semantic outputs of ``morin._on_chart_session_change``
    (morin.py:8890) minus the wx render/repaint side effects."""
    document_id: str
    change_reason: str
    is_active: bool
    rebuilt_child_ids: List[str] = field(default_factory=list)


@dataclass
class CloseResult:
    """Result of ``close_document``. Mirrors the semantic outcome of
    ``morin._handle_workspace_document_close`` (morin.py:11486) without driving
    any modal: the cascade is *reported*, prompts are NOT auto-resolved."""
    closed_ids: List[str]
    cascaded: bool
    prompt_worthy_ids: List[str]
    next_active_id: Optional[str]


class WorkspaceSessionController:
    """The wx-free workspace/session coordinator.

    One instance owns one ``WorkspaceState`` document tree and a per-document
    runtime dict (``self._runtime[doc_id]``) holding the same keys the wx
    ``MFrame._workspace_runtime`` dict holds (subset — the GUI-only keys are
    dropped). ``options`` is the canonical options object, passed in exactly as
    the headless driver expects (never re-derived).
    """

    def __init__(self, options, registry=None):
        self.options = options
        self._state = workspace_model.WorkspaceState()
        self._runtime: Dict[str, dict] = {}
        self._registry = registry or supplementary_adapter.SupplementaryAdapterRegistry()
        # Headless analogue of MFrame.horoscope — the active document's chart.
        # Used only as the "current chart" pointer (morin.py:8897 / 7362); the
        # active-document id in WorkspaceState is the real authority.
        self.active_chart = None
        self._on_event: Optional[Callable[[SessionChangedEvent], None]] = None

    # -- accessors ---------------------------------------------------------

    @property
    def state(self) -> workspace_model.WorkspaceState:
        return self._state

    def documents(self) -> Tuple[workspace_model.WorkspaceDocument, ...]:
        return self._state.documents()

    def active_document_id(self) -> Optional[str]:
        return self._state.active_document_id()

    def session(self, document_id: str) -> Optional[dict]:
        """The per-document runtime dict (analogue of
        ``MFrame._find_workspace_session``, morin.py:5126)."""
        return self._runtime.get(document_id)

    def active_session(self) -> Optional[dict]:
        active_id = self._state.active_document_id()
        if active_id is None:
            return None
        return self._runtime.get(active_id)

    def set_event_listener(self, callback: Optional[Callable[[SessionChangedEvent], None]]) -> None:
        self._on_event = callback

    def _emit(self, event: SessionChangedEvent) -> None:
        if self._on_event is not None:
            self._on_event(event)

    # -- reverse lookups (morin.py:5126-5144) ------------------------------

    def _session_by_chart_session(self, cs) -> Optional[dict]:
        # morin.py:5129 _find_workspace_session_by_chart_session
        for session in self._runtime.values():
            if session.get('chart_session') is cs:
                return session
        return None

    def _document_id_for_chart(self, chrt) -> Optional[str]:
        # morin.py:5135 _find_workspace_document_id_for_chart
        if chrt is None:
            return None
        for document_id, session in self._runtime.items():
            if session.get('chart') is chrt:
                return document_id
            cs = session.get('chart_session')
            if cs is not None and getattr(cs, 'chart', None) is chrt:
                return document_id
        return None

    def _descendant_ids(self, document_id: str) -> List[str]:
        # morin.py:5458 _collect_workspace_descendant_ids
        return list(self._state.descendant_document_ids(document_id))

    def _insert_index(self, parent_document_id: Optional[str]) -> Optional[int]:
        # morin.py:5476 _workspace_document_insert_index
        documents = list(self._state.documents())
        if not documents:
            return 0
        if parent_document_id is None:
            return len(documents)
        branch_ids = set(self._state.descendant_document_ids(parent_document_id))
        branch_ids.add(parent_document_id)
        last_branch_index = -1
        for index, document in enumerate(documents):
            if getattr(document, 'document_id', None) in branch_ids:
                last_branch_index = index
        if last_branch_index >= 0:
            return last_branch_index + 1
        return len(documents)

    # -- datetime helpers (mirror morin.py:6421 / headless driver) ---------

    @staticmethod
    def _datetime_to_display_tuple(dt_value) -> Optional[DisplayDateTime]:
        if dt_value is None:
            return None
        if isinstance(dt_value, datetime.datetime):
            return (dt_value.year, dt_value.month, dt_value.day,
                    dt_value.hour, dt_value.minute, dt_value.second)
        try:
            parts = tuple(int(v) for v in tuple(dt_value)[:6])
            if len(parts) < 6:
                return None
            return parts
        except Exception:
            return None

    @staticmethod
    def _display_tuple_to_datetime(display_dt) -> Optional[datetime.datetime]:
        if display_dt is None:
            return None
        try:
            parts = tuple(int(v) for v in tuple(display_dt)[:6])
            if len(parts) < 6:
                return None
            return datetime.datetime(*parts)
        except Exception:
            return None

    # -- binding persistence (morin.py:6456) -------------------------------

    def _apply_supplementary_binding(self, session: dict, binding) -> None:
        # morin.py:6456 _apply_supplementary_binding
        if session is None or binding is None:
            return
        session['supplementary_feature_kind'] = binding.feature_kind
        session['supplementary_binding'] = binding.to_payload()
        if binding.parent_source_datetime is not None:
            session['parent_source_datetime'] = binding.parent_source_datetime

    def _set_parent_source_datetime(self, session: dict, source_dt) -> None:
        # morin.py:6434 _set_session_parent_source_datetime
        if session is None:
            return
        parent_source_dt = self._datetime_to_display_tuple(source_dt)
        session['parent_source_datetime'] = parent_source_dt
        binding_payload = session.get('supplementary_binding')
        if isinstance(binding_payload, dict):
            binding_payload = dict(binding_payload)
            binding_payload['parent_source_datetime'] = parent_source_dt
            session['supplementary_binding'] = binding_payload

    def _comparison_chart_for_parent(self, parent_session: Optional[dict]):
        # morin.py:6445 _workspace_comparison_chart_for_parent_session
        if parent_session is None:
            return None
        parent_cs = parent_session.get('chart_session')
        if parent_cs is not None:
            return getattr(parent_cs, 'chart', None)
        return parent_session.get('chart')

    def _comparison_chart_for_child_session(
        self,
        session: Optional[dict],
        parent_session: Optional[dict],
    ):
        if session is not None and session.get('show_radix_comparison'):
            radix = self._runtime_radix_for_session(session)
            if radix is not None:
                return radix
        return self._comparison_chart_for_parent(parent_session)

    def comparison_anchor_for_session(self, session: Optional[dict]):
        """Immediate-parent chart a hierarchical child compares against.

        This is deliberately not ``cs.radix``. ``cs.radix`` remains the branch
        identity/calculation radix; the visible COMPOUND center for an indented
        child is its direct parent's live chart (morin.py:6445, 21747-21750).
        """
        if session is None or session.get('parent_document_id') is None:
            return None
        anchor = session.get('comparison_chart')
        if anchor is not None:
            return anchor
        parent_session = self._runtime.get(session.get('parent_document_id'))
        return self._comparison_chart_for_child_session(session, parent_session)

    def _runtime_radix_for_session(self, session: dict):
        cs = session.get('chart_session')
        if cs is not None and getattr(cs, 'radix', None) is not None:
            return cs.radix
        return session.get('chart')

    # -- title (coordinator-lite; presentation owns rich formatting) -------

    def _sync_runtime_title(self, session: dict) -> None:
        """morin.py:8913/5764 _update_workspace_generic_runtime_title.

        The wx version composes a rich, context-aware tab title via
        ``chart_context_view`` + horary/synastry special cases — all GUI-adjacent
        formatting. The headless controller keeps the document title in sync with
        the chart's name and dirty marker (the load-bearing semantic part) and
        leaves the decorative suffix to the presentation layer.
        """
        if session is None:
            return
        chrt = session.get('chart')
        cs = session.get('chart_session')
        if cs is not None and getattr(cs, 'chart', None) is not None:
            chrt = cs.chart
        custom_root = session.get('custom_title_root') or ''
        name = custom_root or getattr(chrt, 'name', '') or session.get('base_title') or ''
        dirty = bool(session.get('dirty', False))
        title = ('%s *' % name) if (dirty and name) else name
        if title:
            self._state.update_document(session['document_id'], title=title)

    # -- dirty model (morin.py:9571 / 11704) -------------------------------

    def get_dirty(self, document_id: str) -> bool:
        session = self._runtime.get(document_id)
        return bool(session.get('dirty', False)) if session is not None else False

    def set_dirty(self, document_id: str, edit_dirty: Optional[bool] = None,
                  step_dirty: Optional[bool] = None) -> None:
        """morin.py:11704 _apply_workspace_session_dirty_state.

        ``dirty = edit_dirty or step_dirty``. Passing ``None`` leaves a flag
        unchanged. Keeps the legacy ``self.dirty``-equivalent absent (the active
        doc's flag is the authority; callers read ``get_dirty``)."""
        session = self._runtime.get(document_id)
        if session is None:
            return
        prev_edit = bool(session.get('edit_dirty', False))
        prev_step = bool(session.get('step_dirty', False))
        new_edit = prev_edit if edit_dirty is None else bool(edit_dirty)
        new_step = prev_step if step_dirty is None else bool(step_dirty)
        session['edit_dirty'] = new_edit
        session['step_dirty'] = new_step
        session['dirty'] = bool(new_edit or new_step)
        self._sync_runtime_title(session)

    def mark_clean(self, document_id: str) -> None:
        # morin.py:11738 _mark_workspace_session_clean
        self.set_dirty(document_id, edit_dirty=False, step_dirty=False)

    # -- OPTIONS RE-RENDER (morin.py:3393 _refresh_current_views) -----------

    def apply_progression_calc_options(self, angle_method: int, day_type: int) -> None:
        """Stamp new progression calc options into open progression bindings.

        When the user changes ``progressed_angle_method`` / ``progression_day_type``
        the option is the authority at change time: secdirui's Calculate passes the
        new value into the rebuild AND writes the option (morin.py:18719-18737),
        and the wx settings OK re-derives the open progression session against the
        new option default (morin.py:20126-20143, _refresh_active_progression_session
        morin.py:5974-6013 ``retained.get('angle_method', options...)``). The
        headless adapter build stamps angle/day into retained_state on every
        secondary/minor/tertiary progression build, and angle_method into every
        Solar Arc build, so without this overwrite the recalc
        fan-out would rebuild each open progression chart with its OLD values
        forever. Call this BEFORE refresh_all_sessions so
        _refresh_progression_session_for_option_change builds with the new ones.
        Solar Arc keeps its body math as the uniform solar arc, but its
        angles/houses use the shared progressed-angle setting.
        """
        for session in self._runtime.values():
            if session.get('supplementary_feature_kind') not in (
                    'secondary', 'solar_arc', 'minor', 'tertiary'):
                continue
            payload = session.get('supplementary_binding')
            if not isinstance(payload, dict):
                continue
            payload = dict(payload)
            retained = dict(payload.get('retained_state') or {})
            retained['angle_method'] = int(angle_method)
            if session.get('supplementary_feature_kind') == 'solar_arc':
                retained.pop('day_type', None)
            else:
                retained['day_type'] = int(day_type)
            payload['retained_state'] = retained
            session['supplementary_binding'] = payload

    def refresh_all_sessions(self, mode: str = 'recalc') -> List[str]:
        """Headless option-change fan-out for every open workspace document.

        Source contract:
        - ayanamsha changes call ``morin._refresh_open_charts_for_ayanamsha_change``
          (morin.py:9154) and rebuild each chart with ``Chart.recalc``;
        - house-system changes call ``morin._refresh_open_charts_for_house_system_change``
          (morin.py:9257) and use ``Chart.setHouseSystem`` for existing chart
          objects;
        - both source paths sort by indent, refresh/re-derive supplementary
          children, and do not mark chart files dirty or persist them.

        ``mode='house-system'`` preserves the source ``setHouseSystem`` operation
        for chart objects. ``mode='display-overlay'`` mirrors secondary-ring
        option changes: mark snapshots stale without rebuilding chart semantics.
        ``mode='display-text'`` regenerates daemon-owned labels/titles without
        touching chart math. ``mode='pd-in-chart'`` invokes only retained PD
        projection hooks. Every other mode uses full ``Chart.recalc``. Returns
        the stable list of document ids whose live session state changed so the
        daemon can broadcast full snapshot invalidation for each one.
        """
        if mode not in (
            'recalc', 'house-system', 'display-overlay', 'display-text',
            'pd-in-chart',
        ):
            mode = 'recalc'

        refreshed: List[str] = []
        refreshed_set: set[str] = set()
        seen_charts: set[int] = set()
        # The top-level options.changed event is the retained-data authority
        # for a house-system transaction.  Chart sessions still publish so
        # resident snapshots repaint, but those intermediate events must not
        # trigger a second retained-list request before the typed patch arrives.
        option_change_reason = (
            'options-refresh' if mode == 'house-system' else 'options'
        )

        def mark(document_id: Optional[str]) -> None:
            if not document_id or document_id in refreshed_set:
                return
            refreshed_set.add(document_id)
            refreshed.append(document_id)

        documents = sorted(
            list(self._state.documents()),
            key=lambda d: int(getattr(d, 'indent_level', 0) or 0),
        )
        for document in documents:
            document_id = getattr(document, 'document_id', None)
            session = self._runtime.get(document_id) if document_id else None
            if session is None:
                continue

            if mode == 'display-text':
                mark(document_id)
                self._sync_runtime_title(session)
                self._emit(SessionChangedEvent(
                    document_id=document_id,
                    change_reason='display-text',
                    is_active=(document_id == self._state.active_document_id()),
                    rebuilt_child_ids=[],
                ))
                continue

            if mode == 'display-overlay':
                mark(document_id)
                continue

            if mode == 'pd-in-chart':
                if self._refresh_session_via_options_hook(session, mode):
                    mark(document_id)
                continue

            feature_kind = session.get('supplementary_feature_kind')
            if feature_kind is None and session.get('launcher_kind') == 'solar_average':
                feature_kind = 'solar_average'
            parent_session = self._runtime.get(session.get('parent_document_id'))

            if self._refresh_session_via_options_hook(session, mode):
                mark(document_id)
                continue

            if feature_kind in ('secondary', 'solar_arc', 'minor', 'tertiary', 'profections'):
                if self._refresh_progression_session_for_option_change(
                    session,
                    change_reason=option_change_reason,
                ):
                    mark(document_id)
                    continue

            if feature_kind == 'solar_return':
                if parent_session is not None:
                    session['comparison_chart'] = self._comparison_chart_for_child_session(
                        session,
                        parent_session,
                    )
                if self._refresh_session_chart_objects_for_options(session, mode, seen_charts):
                    mark(document_id)
                    self._emit_options_changed(
                        document_id,
                        change_reason=option_change_reason,
                    )
                continue

            if feature_kind is not None and parent_session is not None:
                if self._rebuild_child_session_for_options(
                    session,
                    parent_session,
                    change_reason=option_change_reason,
                ):
                    mark(document_id)
                    continue

            if self._refresh_session_chart_objects_for_options(session, mode, seen_charts):
                mark(document_id)
                self._emit_options_changed(
                    document_id,
                    change_reason=option_change_reason,
                )

        return refreshed

    def _refresh_session_via_options_hook(self, session: dict, mode: str) -> bool:
        hook = session.get('option_refresh_handler')
        if not callable(hook):
            return False
        try:
            return bool(hook(session, mode))
        except Exception:
            return False

    def _refresh_chart_object_for_options(self, chrt, mode: str, seen_charts: set[int]) -> bool:
        if chrt is None:
            return False
        key = id(chrt)
        if key in seen_charts:
            return False
        seen_charts.add(key)
        try:
            if mode == 'house-system' and hasattr(chrt, 'setHouseSystem'):
                chrt.setHouseSystem()
            elif hasattr(chrt, 'recalc'):
                chrt.recalc()
            else:
                return False
            return True
        except Exception:
            return False

    def _refresh_session_chart_objects_for_options(self, session: dict, mode: str, seen_charts: set[int]) -> bool:
        """Refresh all chart objects a session directly owns.

        Mirrors the object walk in morin.py:9246-9253 / 9322-9329: runtime chart,
        comparison chart, ChartSession chart/radix/initial/display anchor. This
        covers roots, synastry/comparison documents, and view-only documents whose
        session carries a reference chart even though they have no ChartSession.
        """
        changed = False
        has_chart_reference = False
        cs = session.get('chart_session')
        for obj in (
            session.get('chart'),
            session.get('comparison_chart'),
            getattr(cs, 'chart', None) if cs is not None else None,
            getattr(cs, 'radix', None) if cs is not None else None,
            getattr(cs, '_initial_chart', None) if cs is not None else None,
            getattr(cs, 'display_anchor_chart', None) if cs is not None else None,
        ):
            has_chart_reference = has_chart_reference or obj is not None
            changed |= self._refresh_chart_object_for_options(obj, mode, seen_charts)
        return changed or has_chart_reference

    def _emit_options_changed(
        self,
        document_id: str,
        rebuilt_child_ids: Optional[List[str]] = None,
        *,
        change_reason: str = 'options',
    ) -> None:
        self._emit(SessionChangedEvent(
            document_id=document_id,
            change_reason=change_reason,
            is_active=(document_id == self._state.active_document_id()),
            rebuilt_child_ids=list(rebuilt_child_ids or []),
        ))

    def _refresh_progression_session_for_option_change(
        self,
        session: dict,
        *,
        change_reason: str = 'options',
    ) -> bool:
        """Rebuild symbolic progression / profection children from their OWN
        display cursor (not the parent radix cursor).

        Source: morin.py:9117-9152. The wx path uses the supplementary adapter and
        the child's display datetime instead of merely mutating the old chart's
        houses, so an option change keeps a stepped child at its own year. Without
        this, ``_rebuild_child_session_for_options`` would re-derive the child from
        the parent's launch datetime and snap a stepped profection/progression back
        to birth.
        """
        if session is None:
            return False
        cs = session.get('chart_session')
        if cs is None or getattr(cs, 'radix', None) is None or getattr(cs, 'chart', None) is None:
            return False
        feature_kind = session.get('supplementary_feature_kind')
        if feature_kind not in ('secondary', 'solar_arc', 'minor', 'tertiary', 'profections'):
            return False
        adapter = self._registry.adapter_for_feature_kind(feature_kind)
        if adapter is None:
            return False
        driver = self._driver_for_session(session)
        try:
            binding = adapter.capture_binding(
                driver, session=session, current_chart=cs.chart,
                feature_kind=feature_kind,
            )
        except Exception:
            return False
        display_dt = getattr(cs, 'display_datetime', None)
        source_dt = self._display_tuple_to_datetime(display_dt)
        if source_dt is None:
            return False
        base_chart = getattr(cs, 'radix', None)
        driver.horoscope = base_chart
        driver_state = supplementary_adapter.SupplementaryDriverState(
            base_chart=base_chart,
            source_datetime=source_dt,
            chart_session=cs,
            runtime_radix=base_chart,
            source_display_datetime=self._datetime_to_display_tuple(source_dt),
        )
        try:
            result = adapter.build(
                driver, driver_state, binding,
                current_chart=getattr(cs, 'chart', None), session=session,
            )
        except Exception:
            return False
        if result is None or result.chart is None:
            return False
        result.binding.parent_source_datetime = self._datetime_to_display_tuple(source_dt)
        session['chart'] = result.chart
        cs.change_chart(result.chart, display_datetime=result.display_datetime or display_dt,
                        change_reason=change_reason)
        self._apply_supplementary_binding(session, result.binding)
        return True

    def _rebuild_child_session_for_options(
        self,
        session: dict,
        parent_session: dict,
        *,
        change_reason: str = 'options',
    ) -> bool:
        """Option-refresh child rebuild without the cursor-change gate.

        ``_rebuild_child_session`` is the normal parent-cursor cascade and may
        skip adapters whose cursor did not change. Global options are a different
        source edge: morin.py:9224-9244 / 9305-9320 explicitly rebuilds open
        supplementary descendants while walking by indent.
        """
        cs = session.get('chart_session')
        parent_cs = parent_session.get('chart_session')
        if cs is None or parent_cs is None:
            return False
        current_chart = getattr(cs, 'chart', None)
        if current_chart is None:
            return False

        feature_kind = session.get('supplementary_feature_kind')
        if feature_kind is None and session.get('launcher_kind') == 'solar_average':
            feature_kind = 'solar_average'
        if feature_kind is None:
            return False
        adapter = self._registry.adapter_for_feature_kind(feature_kind)
        if adapter is None:
            return False

        base_chart = getattr(parent_cs, 'radix', None) or getattr(parent_cs, 'chart', None)
        source_dt = self._launch_reference_datetime(feature_kind, parent_cs)
        if base_chart is None or source_dt is None:
            return False

        driver = self._driver_for_session(session)
        driver.horoscope = base_chart
        try:
            binding = adapter.capture_binding(
                driver, session=session, current_chart=current_chart,
                feature_kind=feature_kind,
            )
            target_source_dt = adapter.refresh_source_datetime(driver, session, source_dt, binding)
            driver_state = supplementary_adapter.SupplementaryDriverState(
                base_chart=base_chart,
                source_datetime=target_source_dt,
                chart_session=parent_cs,
                runtime_radix=base_chart,
                source_display_datetime=self._datetime_to_display_tuple(source_dt),
            )
            result = adapter.build(
                driver, driver_state, binding,
                current_chart=current_chart, session=session,
            )
        except Exception:
            return False
        if result is None or result.chart is None or result.display_datetime is None:
            return False

        persisted_source_dt = adapter.parent_source_datetime_for_options_rebuild(
            driver, session, source_dt, target_source_dt, binding, result,
        )
        self._apply_rebuilt_child(session, cs, base_chart, persisted_source_dt,
                                  result.chart, result.display_datetime,
                                  change_reason=change_reason)
        result.binding.parent_source_datetime = session.get('parent_source_datetime')
        self._apply_supplementary_binding(session, result.binding)
        return True

    # -- OPEN (morin.py:9526) ----------------------------------------------

    def open_document(
        self,
        chrt,
        *,
        fpath: str = '',
        dpath: str = '',
        session_label: Optional[str] = None,
        radix=None,
        view_mode: int = 0,
        navigation_units=None,
        navigation_title_label=None,
        display_datetime=None,
        display_anchor_chart=None,
        parent_document_id_override: Optional[str] = None,
        indent_level_override: Optional[int] = None,
        comparison_chart=None,
        dirty: Optional[bool] = None,
        custom_subtitle: Optional[str] = None,
        launcher_kind: Optional[str] = None,
        supplementary_feature_kind: Optional[str] = None,
        timed_event_title: bool = False,
        supplementary_binding=None,
        session_factory: Optional[Callable] = None,
    ) -> Optional[workspace_model.WorkspaceDocument]:
        """morin.py:9526 _open_workspace_session.

        Constructs a ``WorkspaceDocument`` + runtime dict + ``ChartSession``
        (when ``radix`` is given), auto-indenting derived charts under their
        radix, then activates the new document.

        ``session_factory`` lets callers inject ``HorarySession`` /
        ``DirtyRadixSession``; defaults to ``ChartSession``.
        """
        if chrt is None:
            return None

        # Dirty default (morin.py:9571-9572).
        if dirty is None:
            dirty = (not bool(fpath)) and (radix is None or chrt is radix)

        # Indent / parent resolution (morin.py:9574-9596).
        if indent_level_override is not None:
            indent_level = max(0, int(indent_level_override))
        else:
            indent_level = 0
        parent_document_id = parent_document_id_override
        if parent_document_id is not None and indent_level_override is None:
            parent_document = self._state.find_document(parent_document_id)
            if parent_document is not None:
                indent_level = max(0, int(getattr(parent_document, 'indent_level', 0) or 0)) + 1
        # Auto-indent derived charts under their radix (morin.py:9593-9596).
        if parent_document_id_override is None and radix is not None and chrt is not radix:
            if indent_level_override is None:
                indent_level = 1
            parent_document_id = self._document_id_for_chart(radix)

        base_title = session_label or (getattr(chrt, 'name', '') or '')
        if dirty and base_title:
            display_title = '%s *' % base_title
        else:
            display_title = base_title
        document = self._state.open_document(
            kind='chart',
            title=display_title,
            subtitle=custom_subtitle if custom_subtitle is not None else (getattr(chrt, 'name', '') or ''),
            path=fpath,
            parent_document_id=parent_document_id,
            indent_level=indent_level,
            insert_index=self._insert_index(parent_document_id),
        )

        # Runtime dict (morin.py:9608-9628) — GUI-only keys dropped.
        session = {
            'document_id': document.document_id,
            'chart': chrt,
            'chart_id': getattr(chrt, 'chart_id', ''),
            'fpath': fpath,
            'dpath': dpath,
            'dirty': bool(dirty),
            'edit_dirty': bool(dirty),
            'step_dirty': False,
            'base_title': base_title,
            'custom_title_root': session_label or '',
            'custom_subtitle': custom_subtitle,
            'launcher_kind': launcher_kind,
            'supplementary_feature_kind': supplementary_feature_kind,
            'timed_event_title': bool(timed_event_title),
            'supplementary_binding': None,
            'parent_document_id': parent_document_id,
            'previous_parent_document_id': None,
            'parent_source_datetime': None,
            'chart_session': None,
            'comparison_chart': comparison_chart,
        }
        if supplementary_binding is not None:
            self._apply_supplementary_binding(session, supplementary_binding)

        # Parent comparison + parent_source_datetime seed (morin.py:9631-9643).
        if parent_document_id is not None:
            parent_session = self._runtime.get(parent_document_id)
            if session.get('comparison_chart') is None:
                session['comparison_chart'] = self._comparison_chart_for_child_session(
                    session,
                    parent_session,
                )
            if supplementary_feature_kind is not None and parent_session is not None:
                parent_cs = parent_session.get('chart_session')
                if parent_cs is not None and session.get('parent_source_datetime') is None:
                    source_dt = self._launch_reference_datetime(
                        supplementary_feature_kind, parent_cs)
                    self._set_parent_source_datetime(session, source_dt)

        # ChartSession construction (morin.py:9644-9655).
        if radix is not None:
            factory = session_factory or chart_session.ChartSession
            if session_factory is None:
                cs = chart_session.ChartSession(
                    chrt, radix, self.options,
                    view_mode=view_mode,
                    navigation_units=navigation_units,
                    navigation_title_label=navigation_title_label,
                    on_change=self.on_session_change,
                    display_datetime=display_datetime,
                    display_anchor_chart=display_anchor_chart,
                    lazy_optional_step_features=True,
                )
            else:
                # Horary/DirtyRadix factories track step-dirty internally
                # (horary_session._refresh_step_dirty: dirty iff the cursor
                # differs from the open moment, self-clearing on step-back/
                # reset). Wire the hook to the canonical dirty model — the wx
                # on_step_dirty_change=_set_current_chart_step_dirty wiring
                # (morin.py:4941/9737).
                _doc_id = document.document_id
                cs = factory(
                    chrt, self.options,
                    on_change=self.on_session_change,
                    on_step_dirty_change=(
                        lambda dirty, _id=_doc_id: self.set_dirty(_id, step_dirty=bool(dirty))
                    ),
                    display_datetime=display_datetime,
                    lazy_optional_step_features=True,
                )
            session['chart_session'] = cs

        self._runtime[document.document_id] = session
        self.activate_document(document.document_id)
        if session['chart_session'] is not None:
            self._sync_runtime_title(session)
        return document

    def _launch_reference_datetime(self, feature_kind, parent_cs) -> datetime.datetime:
        # morin.py:6323/6360: cursor-driven children inherit the immediate
        # parent session cursor, except root-like sessions always open from wall
        # clock. Stepping a radix changes that radix session's own display
        # cursor; it does not turn the radix into a timed derivation parent.
        if self._uses_parent_launch_cursor(feature_kind, parent_cs):
            dt = self._parent_launch_cursor_datetime(parent_cs)
            if dt is not None:
                return dt
        return datetime.datetime.now()

    def _uses_parent_launch_cursor(self, feature_kind, parent_cs) -> bool:
        if feature_kind not in _CURSOR_DRIVEN_FEATURE_KINDS:
            return False
        return parent_cs is not None and getattr(parent_cs, 'display_datetime', None) is not None

    def _parent_launch_cursor_datetime(self, parent_cs):
        if parent_cs is None:
            return None
        display_dt = getattr(parent_cs, 'display_datetime', None)
        if display_dt is None:
            return None
        if self._launch_cursor_defaults_to_wall_clock(parent_cs):
            return datetime.datetime.now()
        return self._display_tuple_to_datetime(display_dt)

    @staticmethod
    def _launch_cursor_defaults_to_wall_clock(parent_cs) -> bool:
        if getattr(parent_cs, '_launch_with_wall_clock_when_unset', False):
            return True
        chart_obj = getattr(parent_cs, 'chart', None)
        radix_obj = getattr(parent_cs, 'radix', None)
        return chart_obj is not None and chart_obj is radix_obj

    # -- ACTIVATE (morin.py:7301) ------------------------------------------

    def activate_document(self, document_id) -> None:
        """morin.py:7301 _activate_workspace_session — coordinator subset.

        Resolves the new active chart, mirrors fpath/dirty, and flips the
        active document in ``WorkspaceState``. Presentation side effects
        (drawBkg / table capture / notes / AT-popup / focus) are emitted to the
        listener, not run here."""
        if isinstance(document_id, dict):
            session = document_id
            document_id = session.get('document_id')
        else:
            session = self._runtime.get(document_id)
        if session is None or document_id is None:
            return

        cs = session.get('chart_session')
        if cs is not None:
            new_chart = cs.chart or session.get('chart') or getattr(cs, 'radix', None)
        else:
            new_chart = session.get('chart')
        if new_chart is None:
            return

        current_active_id = self._state.active_document_id()
        already_active = (current_active_id == document_id and self.active_chart is new_chart)

        self.active_chart = new_chart
        self._state.activate_document(document_id)
        self._emit(SessionChangedEvent(
            document_id=document_id,
            change_reason='activate',
            is_active=True,
        ))
        if already_active:
            return

    # -- MOVE / REORDER (workspace_model.move_document) --------------------

    def move_document(self, document_id, before_document_id) -> bool:
        """Reorder a document (with its descendant family) among its siblings.

        Thin pass-through to ``WorkspaceState.move_document`` (workspace_model.py:309),
        which already enforces the sibling-only rule: the move is rejected unless
        ``before_document_id`` shares the same ``parent_document_id`` (or is None,
        meaning move to the end of the sibling group). DnD reorder in the wx
        navigator routes through the same model method, so the semantics match.

        Returns True if the tree order changed."""
        moved = bool(self._state.move_document(document_id, before_document_id))
        if moved:
            # The active document is unchanged, but the tree order shifted — emit
            # a bare activate-flavoured event so the listener re-broadcasts the
            # documents.changed tree (no session recompute needed for a reorder).
            active_id = self._state.active_document_id()
            self._emit(SessionChangedEvent(
                document_id=active_id,
                change_reason='reorder',
                is_active=True,
            ))
        return moved

    # -- SESSION CHANGE FAN-OUT (morin.py:8890) ----------------------------

    def on_session_change(self, cs) -> SessionChangedEvent:
        """morin.py:8890 _on_chart_session_change — coordinator subset.

        Runs in order: sync runtime chart, track active chart, persist the
        feature_kind binding, cascade child sessions, recompute title. Emits a
        single ``SessionChangedEvent`` carrying ``change_reason`` (so the
        presentation layer can honour the step-burst render deferral) instead of
        calling drawBkg/Refresh/handleStatusBar/etc."""
        session = self._session_by_chart_session(cs)
        if session is not None:
            session['chart'] = cs.chart  # morin.py:8893

        active_document_id = self._state.active_document_id()
        is_active = session is not None and session.get('document_id') == active_document_id
        if is_active:
            self.active_chart = cs.chart  # morin.py:8897

        change_reason = getattr(cs, '_last_change_reason', 'normal')  # morin.py:8898

        # Binding persist for this session's feature_kind (morin.py:8908-8911).
        self._sync_binding_state(cs, session)
        # Child cascade (morin.py:8912).
        rebuilt = self._refresh_child_sessions(session)
        # Title recompute (morin.py:8913).
        if session is not None:
            self._sync_runtime_title(session)

        event = SessionChangedEvent(
            document_id=session.get('document_id') if session is not None else None,
            change_reason=change_reason,
            is_active=bool(is_active),
            rebuilt_child_ids=rebuilt,
        )
        self._emit(event)
        return event

    def _sync_binding_state(self, cs, session: Optional[dict]) -> None:
        """morin.py:6700-6790 _sync_workspace_*_binding_state (cursor-derivable
        subset). Recaptures the adapter binding for the session's feature_kind
        and persists the refreshed retained state that follows the cursor
        (display_datetime / place / proftype). Stepper-only retained keys
        (``_rev_ctx`` / ``_planet_rev_dt`` / stepper ``t``) are wx presentation
        state and intentionally not reproduced here."""
        if session is None:
            return
        feature_kind = session.get('supplementary_feature_kind')
        if feature_kind is None:
            return
        adapter = self._registry.adapter_for_feature_kind(feature_kind)
        if adapter is None:
            return
        driver = self._driver_for_session(session)
        try:
            binding = adapter.capture_binding(
                driver, session=session,
                current_chart=getattr(cs, 'chart', None),
                feature_kind=feature_kind,
            )
        except Exception:
            return
        retained = dict(binding.retained_state or {})
        display_dt = self._datetime_to_display_tuple(getattr(cs, 'display_datetime', None))
        if feature_kind == 'transits':
            retained['display_datetime'] = display_dt
            retained['place_payload'] = supplementary_adapter.place_to_payload(
                getattr(getattr(cs, 'chart', None), 'place', None))
        elif feature_kind == 'converse_transits':
            # The visible cursor is symbolic; the chart itself is the mirrored
            # physical transit. Preserve both retained clock contexts and only
            # advance the symbolic display stamp here.
            retained['display_datetime'] = display_dt
            if display_dt is not None:
                retained['symbolic_cursor_datetime'] = display_dt
            self._sync_converse_symbolic_cursor_jd(cs, retained)
        elif feature_kind == 'profections':
            retained['display_datetime'] = display_dt
            chrt = getattr(cs, 'chart', None)
            if chrt is not None:
                retained['proftype'] = int(getattr(chrt, 'proftype', retained.get('proftype', 0)) or 0)
        else:
            # secondary/solar_arc/minor/tertiary/returns: keep the parent-source
            # cursor; the adapter recomputes age/return on rebuild from it.
            if display_dt is not None:
                retained.setdefault('display_datetime', display_dt)
        binding.retained_state = retained
        self._apply_supplementary_binding(session, binding)

    @staticmethod
    def _sync_converse_symbolic_cursor_jd(cs, retained) -> None:
        """Keep the session cursor on the symbolic clock, not the chart epoch."""
        if cs is None or not isinstance(retained, dict):
            return
        try:
            symbolic_jd = float(retained.get('symbolic_cursor_jd'))
        except (TypeError, ValueError):
            return
        if not math.isfinite(symbolic_jd):
            return
        cs.cursor_jd = symbolic_jd
        if getattr(cs, 'chart', None) is getattr(cs, '_initial_chart', None):
            cs._initial_cursor_jd = symbolic_jd

    # -- CHILD REFRESH (morin.py:7202) -------------------------------------

    def _refresh_child_sessions(self, parent_session: Optional[dict]) -> List[str]:
        """morin.py:7202 _refresh_workspace_child_sessions. Returns the list of
        child document ids that were rebuilt."""
        if parent_session is None:
            return []
        parent_document_id = parent_session.get('document_id')
        if parent_document_id is None:
            return []
        rebuilt: List[str] = []
        for child_document_id in self._descendant_ids(parent_document_id):
            child_session = self._runtime.get(child_document_id)
            if child_session is None:
                continue
            immediate_parent = self._runtime.get(child_session.get('parent_document_id'))
            if immediate_parent is None:
                continue
            # Parent-anchor sync (morin.py:7218).
            feature_kind = child_session.get('supplementary_feature_kind')
            if feature_kind is not None:
                child_session['comparison_chart'] = self._comparison_chart_for_child_session(
                    child_session,
                    immediate_parent,
                )
            if self._rebuild_child_session(child_session, immediate_parent):
                rebuilt.append(child_document_id)
        return rebuilt

    def _driver_for_session(self, session: dict) -> SupplementaryHeadlessDriver:
        """A headless driver scoped to this session's radix — same construction
        webapp/daemon/supplementary_service.build_result uses
        (supplementary_service.py:184-187)."""
        driver = SupplementaryHeadlessDriver(self.options)
        driver.horoscope = self._runtime_radix_for_session(session)
        return driver

    def _rebuild_child_session(self, session: dict, parent_session: dict) -> bool:
        """morin.py:7229 _rebuild_workspace_child_session via the headless
        driver + adapter (the Binding -> Deriver -> Chart path). Returns True if
        the child chart was rebuilt."""
        cs = session.get('chart_session')
        parent_cs = parent_session.get('chart_session')
        if cs is None or parent_cs is None:
            return False
        current_chart = cs.chart
        if current_chart is None:
            return False

        feature_kind = session.get('supplementary_feature_kind')
        if feature_kind is None and session.get('launcher_kind') == 'solar_average':
            feature_kind = 'solar_average'
        if feature_kind is None:
            return False
        adapter = self._registry.adapter_for_feature_kind(feature_kind)
        if adapter is None:
            return False

        # base_chart = parent's radix (the master natal), source cursor = parent
        # cursor. Mirrors _supplementary_launch_lineage (morin.py:6367) for the
        # parent chart_session.
        base_chart = getattr(parent_cs, 'radix', None) or getattr(parent_cs, 'chart', None)
        source_dt = self._launch_reference_datetime(feature_kind, parent_cs)
        if base_chart is None or source_dt is None:
            return False

        driver = self._driver_for_session(session)
        driver.horoscope = base_chart

        try:
            binding = adapter.capture_binding(
                driver, session=session, current_chart=current_chart,
                feature_kind=feature_kind,
            )
            if not adapter.uses_parent_cursor(driver, parent_cs, binding):
                return False
            target_source_dt = adapter.refresh_source_datetime(driver, session, source_dt, binding)
            driver_state = supplementary_adapter.SupplementaryDriverState(
                base_chart=base_chart,
                source_datetime=target_source_dt,
                chart_session=parent_cs,
                runtime_radix=base_chart,
                source_display_datetime=self._datetime_to_display_tuple(source_dt),
            )
            result = adapter.build(driver, driver_state, binding,
                                   current_chart=current_chart, session=session)
        except Exception:
            return False
        if result is None or result.chart is None:
            return False

        self._apply_rebuilt_child(session, cs, base_chart, source_dt,
                                  result.chart, result.display_datetime)
        result.binding.parent_source_datetime = session.get('parent_source_datetime')
        self._apply_supplementary_binding(session, result.binding)
        return True

    def _apply_rebuilt_child(self, session, cs, base_chart, source_dt,
                             rebuilt_chart, display_dt, change_reason='normal') -> None:
        """morin.py:6940 _apply_rebuilt_workspace_child_session.

        Re-points the child ``ChartSession`` at the rebuilt chart. ``change_chart``
        re-fires ``on_change`` -> nested fan-out for the child (which, having no
        descendants, is a no-op cascade)."""
        if rebuilt_chart is None or display_dt is None:
            return
        previous_chart = getattr(cs, 'chart', None)
        session['chart'] = rebuilt_chart
        parent_session = self._runtime.get(session.get('parent_document_id'))
        session['comparison_chart'] = self._comparison_chart_for_child_session(
            session,
            parent_session,
        )
        cs.radix = base_chart
        if getattr(cs, '_initial_chart', None) is previous_chart:
            cs._initial_chart = rebuilt_chart
            cs._initial_display_datetime = display_dt
        if getattr(cs, 'display_anchor_chart', None) is previous_chart:
            cs.display_anchor_chart = rebuilt_chart
        cs.change_chart(rebuilt_chart, display_datetime=display_dt,
                        change_reason=change_reason)
        self._set_parent_source_datetime(session, source_dt)

    # -- CHART EDITOR / SESSION-CURSOR EDIT (morin.py:14821-14872) ----------

    def uses_session_cursor(self, document_id: str) -> bool:
        """Whether ``onData`` would edit this document's session CURSOR rather
        than a stored radix. wx-free twin of
        ``morin._supplementary_uses_session_cursor`` invoked from onData
        (morin.py:14815-14818). A transit/SR/return/progression child whose
        cursor carries a live ``display_datetime`` edits the stepping anchor."""
        session = self._runtime.get(document_id)
        if session is None:
            return False
        cs = session.get('chart_session')
        feature_kind = session.get('supplementary_feature_kind')
        driver = self._driver_for_session(session)
        return bool(driver._supplementary_uses_session_cursor(feature_kind, chart_session=cs))

    def _session_authoritative_display_datetime(self, session):
        """morin.py:4996 _session_authoritative_display_datetime
        (fallback_to_chart=False slice used by the editor). The cursor's live
        ``display_datetime`` is the stepping anchor the dialog seeds from."""
        if session is None:
            return None
        cs = session.get('chart_session')
        feature_kind = session.get('supplementary_feature_kind')
        driver = self._driver_for_session(session)
        if driver._supplementary_uses_session_cursor(feature_kind, chart_session=cs):
            dt = getattr(cs, 'display_datetime', None) if cs is not None else None
            if dt is not None:
                try:
                    return tuple(int(v) for v in tuple(dt)[:6])
                except Exception:
                    return None
        return None

    def editor_seed(self, document_id: str) -> Optional[dict]:
        """wx-free twin of the onData session-cursor seed lane
        (morin.py:14821-14831): ``_build_chart_editor_seed_chart`` +
        ``set_time_context_hint`` + ``lock_chart_type(True)``.

        Returns the editor form fields (same shape ``record_to_editor_fields``
        emits) seeded from the cursor's stepping anchor (the live
        ``display_datetime``, NOT the symbolic chart time), plus the
        ``lockChartType`` flag and the ``timeContextHint`` string. Returns
        ``None`` for documents that are NOT session-cursor editors (the skin
        then takes the stored-radix CREATE/EDIT path). The seed reuses the
        derived child's own place/tz fields — re-relocating a cursor would be
        off-topic (morin.py:14833-14836)."""
        session = self._runtime.get(document_id)
        if session is None:
            return None
        if not self.uses_session_cursor(document_id):
            return None
        cs = session.get('chart_session')
        chrt = getattr(cs, 'chart', None) if cs is not None else session.get('chart')
        if chrt is None or getattr(chrt, 'time', None) is None or getattr(chrt, 'place', None) is None:
            return None
        display_dt = self._session_authoritative_display_datetime(session)
        if display_dt is None:
            display_dt = self._chart_time_display_tuple(chrt)
        if display_dt is None or len(display_dt) < 6:
            return None
        fields = self._chart_editor_fields(chrt, display_dt)
        return {
            'fields': fields,
            'lockChartType': True,
            'timeContextHint': self._supplementary_editor_hint(session, display_dt),
            'usesSessionCursor': True,
        }

    @staticmethod
    def _chart_time_display_tuple(chrt):
        """morin.py:4980 _chart_time_display_tuple — the chart's symbolic
        (orig*) civil date/time tuple."""
        if chrt is None or getattr(chrt, 'time', None) is None:
            return None
        t = chrt.time
        try:
            return (
                int(getattr(t, 'origyear', getattr(t, 'year', 0))),
                int(getattr(t, 'origmonth', getattr(t, 'month', 0))),
                int(getattr(t, 'origday', getattr(t, 'day', 0))),
                int(getattr(t, 'hour', 0)),
                int(getattr(t, 'minute', 0)),
                int(getattr(t, 'second', 0)),
            )
        except Exception:
            return None

    @staticmethod
    def _format_editor_datetime(display_dt) -> str:
        # morin.py:6218 _format_editor_datetime
        if display_dt is None:
            return 'n/a'
        try:
            y, m, d, h, mi, s = [int(v) for v in tuple(display_dt)[:6]]
            return '%04d-%02d-%02d %02d:%02d:%02d' % (y, m, d, h, mi, s)
        except Exception:
            return 'n/a'

    def _supplementary_editor_hint(self, session: dict, real_dt) -> str:
        """morin.py:6308 _supplementary_editor_hint. The cursor-anchor editor
        shows that the time it carries is the live stepping anchor, and (when it
        diverges) the symbolic chart time alongside."""
        if real_dt is None:
            return ''
        chrt = session.get('chart')
        if chrt is None:
            cs = session.get('chart_session')
            chrt = getattr(cs, 'chart', None) if cs is not None else None
        symbolic_dt = self._chart_time_display_tuple(chrt)
        if symbolic_dt is None or tuple(real_dt) == tuple(symbolic_dt):
            return mtexts.txts.get(
                'EditingRealCursor', 'Editing real cursor: %s'
            ) % self._format_editor_datetime(real_dt)
        return mtexts.txts.get(
            'EditingRealCursorSymbolic',
            'Editing real cursor: %s\nSymbolic chart time: %s',
        ) % (
            self._format_editor_datetime(real_dt),
            self._format_editor_datetime(symbolic_dt),
        )

    @staticmethod
    def _chart_editor_fields(chrt, display_dt) -> dict:
        """Build the editor's form-field dict from a chart + the cursor anchor
        date/time. Mirrors ``_build_chart_editor_seed_chart`` (morin.py:6265):
        the place/tz come from the derived chart, but the date/time come from
        the LIVE cursor anchor (``display_dt``), not the symbolic chart time.
        Field shape matches editor_service.record_to_editor_fields so the same
        React form renders it."""
        t = chrt.time
        p = chrt.place
        y, m, d, h, mi, s = [int(v) for v in tuple(display_dt)[:6]]
        return {
            'id': '',
            'name': chrt.name or '',
            'male': chrt.male,
            'type': _HTYPE_INDEX_TO_STR.get(int(getattr(chrt, 'htype', 0)), 'radix'),
            'bc': bool(getattr(t, 'bc', False)),
            'year': y, 'month': m, 'day': d,
            'hour': h, 'minute': mi, 'second': s,
            'lonDeg': int(getattr(p, 'deglon', 0)),
            'lonMin': int(getattr(p, 'minlon', 0)),
            'east': bool(getattr(p, 'east', True)),
            'latDeg': int(getattr(p, 'deglat', 0)),
            'latMin': int(getattr(p, 'minlat', 0)),
            'north': bool(getattr(p, 'north', True)),
            'place': getattr(p, 'place', '') or '',
            'cal': _CAL_INDEX_TO_STR.get(int(getattr(t, 'cal', 0)), 'gregorian'),
            'zt': _ZT_INDEX_TO_STR.get(int(getattr(t, 'zt', 0)), 'zone'),
            'plus': bool(getattr(t, 'plus', True)),
            'zoneHour': int(getattr(t, 'zh', 0) or 0),
            'zoneMin': int(getattr(t, 'zm', 0) or 0),
            'daylightSaving': bool(getattr(t, 'daylightsaving', False)),
            'tzauto': bool(getattr(t, 'tzauto', False)),
            'tzid': getattr(t, 'tzid', '') or '',
            'altitude': int(getattr(p, 'altitude', 0) or 0),
            'notes': getattr(chrt, 'notes', '') or '',
        }

    def apply_editor_to_cursor(self, document_id: str, fields: dict) -> bool:
        """wx-free twin of ``_apply_data_dialog_to_session_cursor_chart``
        (morin.py:5217). Reads the EDITED date/time/place/name/gender/notes from
        the editor form fields (in place of the wx dlg getters) and re-derives
        the cursor chart through the SAME Binding -> Deriver -> Chart path the
        controller already runs for child rebuild — never a second derivation.
        Returns True if the cursor chart was re-derived + re-applied."""
        session = self._runtime.get(document_id)
        if session is None:
            return False
        cs = session.get('chart_session')
        feature_kind = session.get('supplementary_feature_kind')
        if cs is None:
            return False
        driver = self._driver_for_session(session)
        if not driver._supplementary_uses_session_cursor(feature_kind, chart_session=cs):
            return False
        parent_session = self._runtime.get(session.get('parent_document_id'))
        if parent_session is None:
            return False

        place = chart.Place(
            (fields.get('place', '') or '')[:20],
            int(fields.get('lonDeg', 0) or 0),
            int(fields.get('lonMin', 0) or 0),
            0,
            bool(fields.get('east', True)),
            int(fields.get('latDeg', 0) or 0),
            int(fields.get('latMin', 0) or 0),
            0,
            bool(fields.get('north', True)),
            int(fields.get('altitude', 0) or 0),
        )
        display_dt = (
            int(fields.get('year', 2000)), int(fields.get('month', 1)),
            int(fields.get('day', 1)), int(fields.get('hour', 0)),
            int(fields.get('minute', 0)), int(fields.get('second', 0)),
        )

        previous_display_dt = self._session_authoritative_display_datetime(session)
        temporal_changed = True
        try:
            temporal_changed = tuple(int(v) for v in tuple(previous_display_dt)[:6]) != tuple(int(v) for v in display_dt)
        except Exception:
            pass
        source_dt = self._display_tuple_to_datetime(display_dt)
        if feature_kind == 'lunar_return' and not temporal_changed:
            source_dt = self._retained_raw_return_datetime(session) or source_dt
        elif feature_kind == 'solar_return' and not temporal_changed:
            source_dt = self._display_tuple_to_datetime(session.get('parent_source_datetime')) or source_dt
        if source_dt is None:
            return False

        adapter = self._registry.adapter_for_feature_kind(feature_kind)
        if adapter is None:
            return False
        base_chart = getattr(cs, 'radix', None) or getattr(cs, 'chart', None)
        if base_chart is None:
            return False
        driver.horoscope = base_chart
        try:
            binding = adapter.capture_binding(
                driver, session=session, current_chart=getattr(cs, 'chart', None),
                feature_kind=feature_kind,
            )
        except Exception:
            return False
        binding = self._update_binding_from_editor_fields(binding, feature_kind, fields, place)
        if binding is None:
            return False

        parent_cs = parent_session.get('chart_session')
        driver_state = supplementary_adapter.SupplementaryDriverState(
            base_chart=base_chart,
            source_datetime=source_dt,
            chart_session=parent_cs,
            runtime_radix=base_chart,
            source_display_datetime=self._datetime_to_display_tuple(source_dt),
        )
        try:
            result = adapter.build(
                driver, driver_state, binding,
                current_chart=getattr(cs, 'chart', None), session=session,
            )
        except Exception:
            return False
        if result is None or result.chart is None or result.display_datetime is None:
            return False

        result.chart.name = (fields.get('name', '') or '')[:20]
        result.chart.male = fields.get('male', True)
        result.chart.notes = fields.get('notes', '') or ''
        try:
            result.chart.calcFortune()
            result.chart.calcAntiscia()
            result.chart.calcArabicParts()
            result.chart.recalcAlmutens()
        except Exception:
            pass

        self._apply_rebuilt_child(session, cs, base_chart, source_dt,
                                  result.chart, result.display_datetime)
        result.binding.parent_source_datetime = self._datetime_to_display_tuple(source_dt)
        self._apply_supplementary_binding(session, result.binding)
        session['dirty'] = True
        self._sync_runtime_title(session)
        self._refresh_child_sessions(session)
        self._emit(SessionChangedEvent(
            document_id=document_id, change_reason='edit',
            is_active=(self._state.active_document_id() == document_id),
            rebuilt_child_ids=self._descendant_ids(document_id),
        ))
        return True

    def _update_binding_from_editor_fields(self, binding, feature_kind, fields, place):
        """morin.py:6466 _update_binding_from_personal_data_dialog, fields shape.
        Folds the editor's edited place + GMT offset back into the retained
        binding state so the re-derivation honours the new relocation/offset."""
        if binding is None:
            return None
        retained = dict(binding.retained_state or {})
        if feature_kind in ('transits', 'solar_return', 'lunar_return', 'planetary_return'):
            retained.update({
                'place_payload': supplementary_adapter.place_to_payload(place),
                'plus': bool(fields.get('plus', True)),
                'zh': int(fields.get('zoneHour', 0) or 0),
                'zm': int(fields.get('zoneMin', 0) or 0),
                'daylight': bool(fields.get('daylightSaving', False)),
            })
        if feature_kind == 'lunar_return':
            retained['lunar_cycle_offset'] = 0
        elif feature_kind == 'solar_return':
            retained['solar_year_offset'] = 0
            retained['solar_degree_offset'] = 0
            retained.pop('base_year', None)
        elif feature_kind == 'planetary_return':
            retained['cycle_offset'] = 0
        binding.retained_state = retained
        return binding

    def _retained_raw_return_datetime(self, session):
        # morin.py:6210 _retained_raw_return_datetime
        if session is None:
            return None
        binding_payload = session.get('supplementary_binding')
        retained = binding_payload.get('retained_state') if isinstance(binding_payload, dict) else None
        raw_dt = (retained or {}).get('raw_return_datetime') if isinstance(retained, dict) else None
        return self._display_tuple_to_datetime(raw_dt)

    # -- CLOSE CASCADE (morin.py:11486) ------------------------------------

    def close_preflight(self, document_id, cascade: bool = True) -> CloseResult:
        """Non-destructive twin of ``close_document``: collect the descendant
        cascade and compute ``prompt_worthy_ids`` WITHOUT tearing anything down,
        so the caller can show the discard/save modal first and only then call
        ``close_document`` to finalize. Keeps the dirty + file-backed + owns-radix
        predicate (morin.py:11529-11551) daemon-owned — the skin never recomputes
        it."""
        if document_id is None or self._state.find_document(document_id) is None:
            return CloseResult([], False, [], self._state.active_document_id())
        if cascade:
            close_ids = self._descendant_ids(document_id)
        else:
            close_ids = []
        close_ids.append(document_id)
        return CloseResult(
            closed_ids=list(close_ids),
            cascaded=len(close_ids) > 1,
            prompt_worthy_ids=self._prompt_worthy_ids(close_ids),
            next_active_id=self._state.active_document_id(),
        )

    def quit_preflight(self) -> List[str]:
        """App-quit predicate (policy-chart-lifecycle §3): the prompt-worthy set
        across ALL open documents — dirty + file-backed + owns-radix. UNBOUND
        (no-fpath) charts are deliberately excluded (they auto-persist to recents
        silently, never prompt). Same predicate as close, scoped to every doc;
        the wx app-quit guard (morin.py:8476-8540 exit handler) over the whole
        workspace rather than one closing branch."""
        all_ids = [d.document_id for d in self._state.documents()]
        return self._prompt_worthy_ids(all_ids)

    def close_document(self, document_id, cascade: bool = True) -> CloseResult:
        """morin.py:11486 _handle_workspace_document_close.

        Collects the descendant cascade and tears the family down, then resolves
        the next active document. Unlike the wx handler it does **not** drive a
        modal: it returns the set of ``prompt_worthy_ids`` (dirty + file-backed +
        owns-radix, morin.py:11529-11551) so the caller (daemon -> React modal)
        owns the discard/save decision. ``cascade=False`` closes only the single
        document (still removing it from the tree)."""
        # Idempotence guard (morin.py:11496-11501).
        if document_id is None:
            return CloseResult([], False, [], self._state.active_document_id())
        if self._state.find_document(document_id) is None:
            return CloseResult([], False, [], self._state.active_document_id())

        if cascade:
            close_ids = self._descendant_ids(document_id)
        else:
            close_ids = []
        close_ids.append(document_id)  # morin.py:11511-11512

        cascaded = len(close_ids) > 1

        # Prompt-worthy predicate (morin.py:11529-11551) — reported, not driven.
        prompt_worthy = self._prompt_worthy_ids(close_ids)

        # Tear down family children-before-parent (morin.py:11564-11567).
        for close_id in reversed(close_ids):
            self._runtime.pop(close_id, None)
            self._state.close_document(close_id)

        # Next-active resolution (morin.py:11573-11592).
        next_id = self._state.active_document_id()
        if next_id is not None:
            self.active_chart = None  # force re-resolve (morin.py:11578)
            self.activate_document(next_id)
        else:
            self.active_chart = None

        return CloseResult(
            closed_ids=list(close_ids),
            cascaded=cascaded,
            prompt_worthy_ids=prompt_worthy,
            next_active_id=next_id,
        )

    def _prompt_worthy_ids(self, close_ids: List[str]) -> List[str]:
        """Close/quit prompt predicate.

        A prompt is warranted only for unsaved edits, not for a stepped cursor
        that has not been written yet. Step-only dirty still drives the sidebar
        marker and explicit Save, but close remains silent.
        """
        prompt_worthy: List[str] = []
        for close_id in reversed(close_ids):
            session = self._runtime.get(close_id)
            if session is None or not session.get('edit_dirty', False):
                continue
            if not session.get('fpath'):
                continue
            cs = session.get('chart_session')
            owns_radix = (
                cs is None
                or getattr(cs, 'chart', None) is getattr(cs, 'radix', None)
                or isinstance(cs, horary_session.HorarySession)
            )
            if not owns_radix:
                continue
            prompt_worthy.append(close_id)
        return prompt_worthy
