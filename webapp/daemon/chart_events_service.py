# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Saved child-chart recipes embedded in their owning radix's JSONL record.

The collection holds intent (the full ancestry and Bindings), never rendered
snapshots or live document IDs. Listing is metadata-only; only an explicit open
reconstructs charts through the existing workspace launchers.
"""
from __future__ import annotations

import copy
import datetime
import hashlib
import json
import pickle
import threading
import uuid
from collections import OrderedDict
from pathlib import Path

import chartfile
import chartcollectionsearchbackend
import chart_session
import dateformat
import mtexts
import note_storage
import searchcatalog
from engine import chart_factory, supplementary_adapter
from engine.workspace_chart_naming import specialized_chart_name
from webapp.daemon.chart_service import chart_snapshot_service
from webapp.daemon.supplementary_service import PUBLIC_TO_FEATURE_KIND
from webapp.daemon.event_tags import EventTags


def _record(chrt):
    record = chartfile.chart_to_dict(chrt, chart_id=getattr(chrt, 'chart_id', '') or 'event', include_events=False)
    record.pop('modified_at', None)
    return record


def _signature(nodes):
    return hashlib.sha256(json.dumps(nodes, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def _semantic_search_catalog(chrt):
    """Use the chart's complete enabled points, including the active ring."""
    from webapp.daemon.aspect_list_service import _technique_ring_items
    from webapp.daemon.display_palette import effective_display_options

    base = searchcatalog.SearchCatalog(chrt)
    present = {obj.id for obj in base.objects}
    bodies = {obj.planet_index: obj.id for obj in base.objects if obj.planet_index is not None}
    aliases = {}
    custom = []
    for item in _technique_ring_items(chrt, 'primary', effective_display_options(chrt.options)):
        try:
            longitude = float(item['longitude'])
            label = str(item.get('listLabel') or item['label'])
            point_id = 'outer:%s:%s' % (
                item.get('family') or 'point', item.get('semanticId') or item['id'])
            ref = item.get('motionRef') or {}
            canonical_id = None
            if ref.get('kind') == 'ephemerisBody':
                canonical_id = bodies.get(int(ref['bodyId']))
            elif ref.get('kind') == 'arabicPart':
                canonical_id = item.get('searchObjectId')
            if canonical_id in present:
                aliases[point_id] = canonical_id
                continue
            if point_id in present:
                continue
            present.add(point_id)
            custom.append({'id': point_id, 'label': label, 'longitude': longitude})
        except (KeyError, TypeError, ValueError):
            continue
    catalog = searchcatalog.SearchCatalog(chrt, custom_points=custom) if custom else base
    # Saved queries can still resolve old overlay ids, while Any and the chooser
    # see one semantic point per body/lot rather than a second overlay copy.
    catalog.objects_by_id.update({alias: catalog.get(target) for alias, target in aliases.items()})
    return catalog


class ChartEventsService:
    def __init__(self, workspace):
        self.workspace = workspace
        self.tags = EventTags()
        self._search_cache = OrderedDict()
        self._search_cache_lock = threading.RLock()
        self._copied_event = None

    def owner(self, document_id):
        controller = self.workspace._controller
        seen = set()
        while document_id not in seen:
            seen.add(document_id)
            session = controller.session(document_id)
            if session is None:
                raise ValueError('Unknown event owner')
            parent_id = session.get('parent_document_id')
            if not parent_id:
                return document_id, session, self.workspace._parent_radix(document_id)
            document_id = parent_id
        raise ValueError('Cyclic event ancestry')

    def menu_items(self, document_id, session):
        # Tables and maps may carry a source chart, but are not chart events.
        cs = session.get('chart_session')
        if cs is None or getattr(cs, 'chart', None) is None:
            return []
        paste = [{
            'type': 'item', 'label': 'Paste event',
            'labelKey': 'chartEvents.paste', 'actionId': 'workspace.paste_event',
            'payload': {'documentId': document_id},
        }] if self._copied_event is not None else []
        if session.get('parent_document_id'):
            return [{
                'type': 'item', 'label': 'Add event',
                'labelKey': 'chartEvents.save', 'actionId': 'workspace.save_event',
                'payload': {'documentId': document_id, 'ownerDocumentId': self.owner(document_id)[0]},
            }, *paste]
        _, owner, _ = self.owner(document_id)
        return [{
            'type': 'submenu', 'label': 'Events', 'labelKey': 'chartEvents.title',
            'eventsDocumentId': document_id,
            'eventCount': len(owner.get('saved_events', [])), 'children': [],
        }, *paste]

    def _capture_node(self, session):
        cs = session.get('chart_session')
        if cs is None or getattr(cs, 'chart', None) is None:
            raise ValueError('Only child charts can be saved as events')
        chrt = cs.chart
        node = {
            'chart': _record(chrt),
            'label': str(specialized_chart_name(session, recipe=True) or session.get('custom_title_root') or session.get('base_title') or chrt.name or mtexts.txts.get('Chart', 'Chart')),
            'feature': session.get('supplementary_feature_kind'),
            'launcher': session.get('launcher_kind'),
            'binding': copy.deepcopy(session.get('supplementary_binding')),
            'display': list(self.workspace._session_display_datetime(cs)),
            'cursorJd': cs.cursor_jd,
            'viewMode': cs.view_mode,
            'navigationUnits': list(cs.navigation_units or ()),
            'presentation': {key: copy.deepcopy(session[key]) for key in (
                'chart_visual_mode', 'comparison_layout', 'show_radix_comparison',
                'parallel_transits_enabled', 'planetary_return_type',
            ) if key in session},
        }
        comparison = session.get('comparison_chart')
        if comparison is not None:
            parent = self.workspace._controller.session(session.get('parent_document_id'))
            parent_chart = self.workspace._controller._comparison_chart_for_parent(parent)
            if comparison is parent_chart:
                node['comparisonRole'] = 'parent'
            elif comparison is self.owner(session['document_id'])[2]:
                node['comparisonRole'] = 'radix'
            else:
                node['comparison'] = _record(comparison)
        if session.get('pd_in_chart_binding'):
            node['pd'] = copy.deepcopy(session['pd_in_chart_binding'])
        if self.workspace._is_relationship_session(session):
            node['participants'] = [_record(c) for c in self.workspace._relationship_session_all_participants(session)]
            node['pair'] = [_record(c) for c in self.workspace._active_synastry_pair(session)]
            node['participantStates'] = list(self.workspace._relationship_session_participant_states(session))
            node['compositeVariant'] = session.get('composite_variant')
        # Validate portability before touching the user's chart file.
        json.dumps(node, allow_nan=False)
        return node

    def _nodes(self, document_id, owner_id):
        nodes = []
        cursor = document_id
        while cursor != owner_id:
            session = self.workspace._controller.session(cursor)
            nodes.append(self._capture_node(session))
            cursor = session['parent_document_id']
        nodes.reverse()
        return nodes

    def _transit_node(self, chrt, radix, name):
        cs = chart_session.ChartSession(chrt, radix, chart_snapshot_service.options,
            navigation_units=('day', 'hour', 'minute', 'second'))
        binding = supplementary_adapter.TransitSupplementaryAdapter().capture_binding(
            None, current_chart=chrt, feature_kind='transits')
        binding.parent_source_datetime = cs.display_datetime
        return self._capture_node({'chart_session': cs, 'base_title': name,
            'supplementary_feature_kind': 'transits',
            'supplementary_binding': binding.to_payload()})

    def save(self, document_id):
        owner_id, owner, radix = self.owner(document_id)
        if owner_id == document_id:
            raise ValueError('Only child charts can be saved as events')
        nodes = self._nodes(document_id, owner_id)
        signature = _signature(nodes)
        events = copy.deepcopy(owner.get('saved_events', []))
        session = self.workspace._controller.session(document_id)
        event = next((item for item in events if item.get('signature') == signature or (
            item['id'] == session.get('saved_event_id')
            and owner_id == session.get('saved_event_owner')
            and signature == session.get('saved_event_signature'))), None)
        if event is None:
            event = {'v': 1, 'id': str(uuid.uuid4()), 'name': nodes[-1]['label'],
                     'signature': signature, 'nodes': nodes}
            events.append(event)
            self._persist(owner_id, owner, radix, events)
        session['saved_event_id'] = event['id']
        session['saved_event_owner'] = owner_id
        session['saved_event_signature'] = signature
        session['saved_event_source_signature'] = event['signature']
        session['saved_event_name'] = event['name']
        self.workspace._controller._sync_runtime_title(session)
        self.workspace._manager.broadcast_threadsafe({'type': 'documents.changed', 'tree': self.workspace._tree_payload()})
        return {'ok': True, 'ownerDocumentId': owner_id, 'eventId': event['id']}

    def create(self, document_id, fields, event_id):
        """Create a portable event without opening or activating a workspace chart."""
        from webapp.daemon.editor_service import editor_fields_to_record, editor_service
        from webapp.daemon.notes_service import write_note_state
        event_id = str(uuid.UUID(str(event_id)))
        owner_id, owner, radix = self.owner(document_id)
        fields = editor_service._new_chart_fields_with_default_location(fields)
        record = editor_fields_to_record({**fields, 'id': event_id, 'type': 'transit'})
        name = record['name'].strip()
        if not name:
            raise ValueError('An event needs a name')
        markdown = record.pop('notes', '')
        chrt = chart_factory.chart_from_record(record, chart_snapshot_service.options)
        node = self._transit_node(chrt, radix, name)
        events = copy.deepcopy(owner.get('saved_events', []))
        # A retry after a failed note write must not add a second event.
        event = next((item for item in events if item['id'] == event_id), None)
        if event is None:
            event = {'v': 1, 'id': event_id}
            events.append(event)
        event.update(name=name, signature=_signature([node]), nodes=[node])
        self._persist(owner_id, owner, radix, events)
        write_note_state(name, markdown, record_id=owner['chart_id'], event_id=event_id)
        return {'ok': True, 'ownerDocumentId': owner_id, 'eventId': event_id}

    def copy_saved_chart(self, source_document_id, target_document_id, event_id):
        """Snapshot any open chart as an independent event on another radix."""
        from webapp.daemon.notes_service import read_note_state, write_note_state
        event_id = str(uuid.UUID(str(event_id)))
        controller = self.workspace._controller
        source = controller.session(source_document_id)
        target = controller.session(target_document_id)
        if not source or not target or target.get('parent_document_id'):
            raise ValueError('The event target must be an open parent chart')
        cs = source.get('chart_session')
        if cs is None or getattr(cs, 'chart', None) is None:
            raise ValueError('The source tab does not contain a chart')
        if source_document_id == target_document_id:
            raise ValueError('A chart cannot be its own event')
        source_owner_id, source_owner, _ = self.owner(source_document_id)
        source_path = str(source.get('fpath') or '')
        source_id = str(source.get('chart_id') or '')
        if source_owner_id == source_document_id and source_path and source_id and not source.get('dirty'):
            try:
                index, _ = chartfile.find_jsonl_record_index(source_path, {'chart_id': source_id})
            except FileNotFoundError:
                index = None
            if index is not None:
                record = chartfile.read_jsonl_record(source_path, index)
                record.pop('events', None)
                name = str(record.get('name') or '').strip()
                chrt = chart_factory.chart_from_record(record, chart_snapshot_service.options)
                source_cs = chart_session.ChartSession(chrt, chrt, chart_snapshot_service.options,
                    navigation_units=('day', 'hour', 'minute', 'second'))
                nodes = [self._capture_node({'chart_session': source_cs, 'base_title': name})]
            else:
                # The tab is still a usable chart if its collection record was
                # moved or deleted after opening it.
                nodes = [self._capture_node(source)]
                name = nodes[-1]['label'].strip()
        elif source_owner_id == source_document_id:
            # A stepped, edited, or scratch radix is copied from its current
            # chart, leaving its original collection record untouched.
            nodes = [self._capture_node(source)]
            name = nodes[-1]['label'].strip()
        else:
            saved = next((item for item in source_owner.get('saved_events', [])
                if item.get('id') == source.get('saved_event_id')), None)
            if saved and not source.get('dirty'):
                # An opened event already has a portable recipe. Runtime
                # comparison defaults can otherwise add a spurious parent node.
                nodes = copy.deepcopy(saved['nodes'])
                name = str(saved['name']).strip()
            else:
                nodes = self._nodes(source_document_id, source_owner_id)
                name = nodes[-1]['label'].strip()
            first = nodes[0]
            if not first.get('independentRadix') and (
                len(nodes) > 1 or any(first.get(key) for key in (
                    'feature', 'launcher', 'binding', 'pd', 'participants', 'comparisonRole'
                ))
            ):
                self._insert_source_radix(nodes, source_owner_id, source_owner)
        if source_owner_id != source_document_id or not source_id:
            source_id = str(nodes[-1]['chart'].get('id') or source_id)
        if not name:
            raise ValueError('The source chart needs a name')
        owner_id, owner, radix = self.owner(target_document_id)
        if source_owner_id == source_document_id and source_id == str(owner.get('chart_id') or ''):
            raise ValueError('A chart cannot be its own event')
        events = copy.deepcopy(owner.get('saved_events', []))
        signature = _signature(nodes)
        existing = next((item for item in events if item.get('signature') == signature), None)
        if existing is not None:
            return {'ok': True, 'ownerDocumentId': owner_id, 'eventId': existing['id'], 'alreadyExists': True}
        note_context = self.note_context(source_document_id)
        if note_context:
            markdown = read_note_state(note_context['sourceName'],
                record_id=note_context['recordId'], event_id=note_context['eventId'])['content']
        elif source_owner_id != source_document_id:
            markdown = ''
        elif source_path and source_id:
            markdown = read_note_state(name, record_id=source_id)['content']
        else:
            markdown = read_note_state(name, document_id=source_document_id, scratch=True)['content']
        event = {'v': 1, 'id': event_id, 'name': name, 'signature': signature,
                 'nodes': nodes, 'sourceChartId': source_id}
        events.append(event)
        # A failed note write leaves the target collection untouched. A retry
        # uses the same event ID and may safely overwrite its private sidecar.
        write_note_state(name, markdown, record_id=owner['chart_id'], event_id=event_id)
        self._persist(owner_id, owner, radix, events)
        return {'ok': True, 'ownerDocumentId': owner_id, 'eventId': event_id}

    def _insert_source_radix(self, nodes, source_owner_id, source_owner):
        # Derived children need their own source radix and ancestry so
        # replay does not silently substitute the receiving radix.
        # A stepped root's visible chart is not its calculation radix.
        source_radix = self.workspace._parent_radix(source_owner_id)
        radix_cs = chart_session.ChartSession(source_radix, source_radix,
            chart_snapshot_service.options,
            navigation_units=('day', 'hour', 'minute', 'second'))
        source_node = self._capture_node({'chart_session': radix_cs,
            'base_title': source_owner.get('base_title') or source_radix.name})
        # Only an inserted context node owns a separate calculation
        # radix. Ordinary attached events retain their owner semantics.
        source_node['independentRadix'] = True
        nodes.insert(0, source_node)

    def copy_event(self, document_id, event_id):
        """Remember one saved event so another chart can paste it."""
        from webapp.daemon.notes_service import read_note_state
        owner_id, owner, _ = self.owner(document_id)
        event = next((item for item in owner.get('saved_events', []) or []
            if item.get('id') == event_id), None)
        if event is None:
            raise ValueError('Unknown saved event')
        nodes = copy.deepcopy(event['nodes'])
        first = nodes[0]
        # A plain moment (one transit node, compared with whatever radix it
        # opens under) is the same moment on any chart. Anything derived
        # keeps the radix it was calculated from.
        plain_moment = len(nodes) == 1 and first.get('feature') == 'transits' and not any(
            first.get(key) for key in ('launcher', 'pd', 'participants'))
        if not plain_moment and not first.get('independentRadix'):
            self._insert_source_radix(nodes, owner_id, owner)
        notes = read_note_state(event['name'], record_id=str(owner.get('chart_id') or ''),
            event_id=event['id'])['content']
        self._copied_event = {'name': event['name'], 'nodes': nodes,
            'tags': copy.deepcopy(event.get('tags') or []), 'notes': notes,
            'sourceChartId': event.get('sourceChartId')}
        return {'ok': True}

    def paste_event(self, document_id):
        """Add the copied event to this chart's radix."""
        from webapp.daemon.notes_service import write_note_state
        copied = self._copied_event
        if copied is None:
            raise ValueError('No event has been copied')
        owner_id, owner, radix = self.owner(document_id)
        events = copy.deepcopy(owner.get('saved_events', []))
        nodes = copy.deepcopy(copied['nodes'])
        signature = _signature(nodes)
        existing = next((item for item in events if item.get('signature') == signature), None)
        if existing is not None:
            return {'ok': True, 'ownerDocumentId': owner_id, 'eventId': existing['id'], 'alreadyExists': True}
        event = {'v': 1, 'id': str(uuid.uuid4()), 'name': copied['name'],
                 'signature': signature, 'nodes': nodes}
        if copied['tags']:
            event['tags'] = copy.deepcopy(copied['tags'])
        if copied.get('sourceChartId'):
            event['sourceChartId'] = copied['sourceChartId']
        events.append(event)
        if copied['notes']:
            write_note_state(event['name'], copied['notes'], record_id=owner['chart_id'], event_id=event['id'])
        self._persist(owner_id, owner, radix, events)
        return {'ok': True, 'ownerDocumentId': owner_id, 'eventId': event['id']}

    def update_from_editor(self, document_id, name):
        """Replace the attached recipe while retaining its identity and metadata."""
        session = self.workspace._controller.session(document_id)
        if not session or not session.get('saved_event_id'):
            return
        owner_id, owner, radix = self.owner(document_id)
        if session.get('saved_event_owner') != owner_id:
            raise ValueError('Event owner changed')
        events = copy.deepcopy(owner.get('saved_events', []))
        event = next((item for item in events if item['id'] == session['saved_event_id']), None)
        if event is None:
            raise ValueError('Saved event no longer exists')
        event['name'] = str(name or event['name']).strip() or event['name']
        nodes = self._nodes(document_id, owner_id)
        nodes[-1]['label'] = event['name']
        event['nodes'] = nodes
        event['signature'] = _signature(nodes)
        self._persist(owner_id, owner, radix, events)
        session['custom_title_root'] = event['name']
        session['saved_event_name'] = event['name']
        session['saved_event_signature'] = _signature(self._nodes(document_id, owner_id))
        session['saved_event_source_signature'] = event['signature']
        self.workspace._controller._sync_runtime_title(session)

    def note_context(self, document_id):
        """Nearest saved event owns notes for its branch; no file access."""
        visited = set()
        while document_id and document_id not in visited:
            visited.add(document_id)
            session = self.workspace._controller.session(document_id)
            if session is None:
                break
            event_id = session.get('saved_event_id')
            if event_id:
                return {'eventId': event_id, 'sourceName': session.get('saved_event_name', ''),
                        'documentId': document_id,
                        'recordId': str(self.owner(document_id)[1].get('chart_id') or ''), 'scratch': False}
            document_id = session.get('parent_document_id')
        return None

    def _persist(self, owner_id, owner, radix, events, *, tags_changed=False):
        path = str(owner.get('fpath') or '')
        if not path:
            # Saving an event also makes a scratch radix durable, using the
            # ordinary default collection. There is no chart/collection picker.
            path = str(note_storage.default_chart_collection_path())
            Path(path).parent.mkdir(parents=True, exist_ok=True)
            self.workspace.save_document(owner_id, path=path)
        record_id = str(owner.get('chart_id') or getattr(radix, 'chart_id', ''))
        index, _ = chartfile.find_jsonl_record_index(path, {'chart_id': record_id})
        if index is None:
            raise ValueError('The event owner is no longer in its collection')
        record = chartfile.read_jsonl_record(path, index)
        for event in events:
            if 'tags' in event:
                event['tags'] = self.tags.resolve(event['tags'])
        record['events'] = events
        chartfile.update_jsonl(record, path)
        # Apply only after the durable write, and keep simultaneous openings of
        # this same saved radix coherent. No chart recalc or global refresh.
        owners = []
        for session in self.workspace._controller._runtime.values():
            if str(session.get('fpath') or '') != path or str(session.get('chart_id') or '') != record_id:
                continue
            owners.append(session['document_id'])
            session['saved_events'] = copy.deepcopy(events)
            cs = session.get('chart_session')
            for chrt in (session.get('chart'), getattr(cs, 'radix', None), getattr(cs, 'chart', None)):
                if chrt is not None:
                    chrt.saved_events = copy.deepcopy(events)
        radix.saved_events = copy.deepcopy(events)
        if tags_changed:
            self._tags_changed()
        self.workspace._manager.broadcast_threadsafe({'type': 'chart.events.changed', 'documentIds': owners})

    def list(self, document_id, *, offset=0, limit=128, query='', sort='date', descending=False):
        owner_id, owner, radix = self.owner(document_id)
        events = owner.get('saved_events', [])
        needle = str(query).strip().casefold()
        if sort not in ('date', 'added'):
            raise ValueError('Unknown event sort')
        ordered = [event for event in events if not needle or needle in event['name'].casefold()]
        if sort == 'date':
            ordered.sort(key=lambda event: event['nodes'][-1]['cursorJd'])
        # The persisted array is insertion order, including legacy events.
        if descending:
            ordered.reverse()
        start = max(0, int(offset))
        stop = start + min(256, max(1, int(limit)))
        rows = []
        for event in ordered[start:stop]:
            rows.append(self._summary_row(event))
        return {'ownerDocumentId': owner_id, 'recordId': str(owner.get('chart_id') or getattr(radix, 'chart_id', '') or ''),
                'sourceName': radix.name, **self.tag_metadata(events),
                'rows': rows, 'total': len(ordered), 'offset': start}

    def _summary_row(self, event):
        node = event['nodes'][-1]
        y, m, d, h, mi, s = node['display']
        return {'id': event['id'], 'name': event['name'], 'tags': self.tags.resolve(event.get('tags')),
                'date': dateformat.date_text(y, m, d, chart_snapshot_service.options,
                                             bc=node['chart'].get('bc', False)),
                'time': f'{h:02d}:{mi:02d}', 'datetime': dateformat.iso_datetime_text(node['display']),
                'kind': node['feature'] or node['launcher'] or node['chart']['type']}

    def search_catalog(self, document_id):
        from webapp.daemon.chart_picker_service import ChartPickerService
        with self.workspace._lock:
            _, _, radix = self.owner(document_id)
            objects = _semantic_search_catalog(radix).objects
        catalog = ChartPickerService().search_catalog()
        known = {choice['value'] for choice in catalog['objects']}
        catalog['objects'].extend({'value': obj.id, 'label': obj.label}
                                  for obj in objects if obj.id not in known)
        # Station at an event's saved cursor is a trajectory question, not a
        # chart-snapshot motion property; keep it out until that role is wired.
        catalog['motions'] = [choice for choice in catalog['motions']
                              if not choice['value'].startswith('station_')]
        return catalog

    def search_batch(self, document_id, payload):
        """Search a bounded slice of one radix's attachments, off the live workspace.

        The saved recipe is authoritative. In particular, a progression's visible
        date is not its ephemeris date, and harmonic positions cannot be recovered
        by decoding its last chart record as an ordinary chart.
        """
        from webapp.daemon.chart_picker_service import ChartPickerService
        from webapp.daemon.workspace_service import WorkspaceService

        query = ChartPickerService.build_search_query(payload)
        if not query.is_active():
            raise ValueError('Set at least one placement or aspect')
        if any(motion.startswith('station_') for clause in query.active_placement_clauses()
               for motion in clause.motions):
            raise ValueError('Station searches need an event motion trajectory')
        for clause in query.active_placement_clauses():
            if clause.motions and any(not (object_id.startswith('planet:') or object_id.startswith('asteroid:'))
                                      for object_id in clause.object_ids):
                raise ValueError('Direct and retrograde motion require an ephemeris body')
        with self.workspace._lock:
            owner_id, owner, radix = self.owner(document_id)
            events = owner.get('saved_events', [])
            needle = str(payload.get('nameTagQuery') or '').strip().casefold()
            tag_ids = set(str(value) for value in payload.get('tagIds') or [])
            tag_match = payload.get('tagMatch') or 'any'
            untagged = payload.get('untagged') is True
            ordered = []
            for event in events:
                tags = self.tags.resolve(event.get('tags'))
                event_tag_ids = {tag['id'] for tag in tags}
                if needle and not any(needle in value.casefold() for value in
                                      [event['name'], *(tag['name'] for tag in tags)]):
                    continue
                if untagged and tags:
                    continue
                if tag_ids and not (tag_ids <= event_tag_ids if tag_match == 'all'
                                    else tag_ids & event_tag_ids):
                    continue
                ordered.append(event)
            sort = payload.get('sort') or 'date'
            if sort not in ('date', 'added'):
                raise ValueError('Unknown event sort')
            if sort == 'date':
                ordered.sort(key=lambda event: event['nodes'][-1]['cursorJd'])
            if payload.get('descending') is True:
                ordered.reverse()
            offset = max(0, int(payload.get('offset') or 0))
            limit = min(8, max(1, int(payload.get('limit') or 8)))
            selected = copy.deepcopy(ordered[offset:offset + limit])
            total = len(ordered)
            root_record = _record(radix)

        if not selected:
            return {'rows': [], 'nextOffset': min(offset, total), 'totalCandidates': total,
                    'errors': 0, 'done': True, 'ownerDocumentId': owner_id}

        # Cache only reconstructed semantic charts, never authoritative event
        # records. A calculation-option or owner-radix change changes the key.
        opts = chart_snapshot_service.options
        try:
            options_key = hashlib.sha256(pickle.dumps(opts, protocol=4)).digest()
        except (TypeError, pickle.PickleError):
            options_key = hashlib.sha256(repr(vars(opts)).encode()).digest()
        root_key = hashlib.sha256(json.dumps(root_record, sort_keys=True, default=str).encode()).digest()
        shadow = None
        root_id = None
        rows = []
        errors = 0
        for event in selected:
            key = (root_key, _signature(event['nodes']), options_key)
            with self._search_cache_lock:
                cached = self._search_cache.get(key)
                if cached is not None:
                    self._search_cache.move_to_end(key)
            created = []
            try:
                if cached is None:
                    if shadow is None:
                        # This private controller replays the same ancestry and
                        # Binding path as Open event, without visible documents.
                        shadow = WorkspaceService(register_options_controller=False)
                        shadow._controller.set_event_listener(None)
                        shadow.chart_events.tags = self.tags
                        root_chart = chart_factory.chart_from_record(root_record, opts)
                        root_id = shadow._controller.open_document(root_chart, radix=root_chart).document_id
                    parent_id = root_id
                    for index, node in enumerate(event['nodes']):
                        parent_id = shadow.chart_events._open_node(
                            parent_id, node, event['name'] if index == len(event['nodes']) - 1 else node['label'])
                        created.append(parent_id)
                    chrt = shadow._controller.session(parent_id)['chart_session'].chart
                    catalog = _semantic_search_catalog(chrt)
                    with self._search_cache_lock:
                        self._search_cache[key] = (chrt, catalog)
                        self._search_cache.move_to_end(key)
                        while len(self._search_cache) > 16:
                            self._search_cache.popitem(last=False)
                else:
                    chrt, catalog = cached
                matches = chartcollectionsearchbackend._match_chart(
                    chrt, catalog, query.active_placement_clauses(),
                    query.active_aspect_clauses(), query)
                if matches is not None:
                    rows.append({**self._summary_row(event), 'matches': matches})
            except Exception:
                errors += 1
            finally:
                for created_id in reversed(created):
                    if shadow is not None and shadow._controller.session(created_id) is not None:
                        shadow._controller.close_document(created_id)
        next_offset = min(total, offset + len(selected))
        return {'rows': rows, 'nextOffset': next_offset, 'totalCandidates': total,
                'errors': errors, 'done': next_offset >= total, 'ownerDocumentId': owner_id}

    def tag_metadata(self, events):
        resolved = [self.tags.resolve(event.get('tags')) for event in events]
        refs = [ref for tags in resolved for ref in tags]
        counts = {}
        for ref in refs:
            counts[ref['id']] = counts.get(ref['id'], 0) + 1
        return {'tagCatalog': self.tags.catalog(refs), 'catalogVersion': self.tags.catalog_version, 'tagCounts': counts,
                'untaggedCount': sum(not tags for tags in resolved)}

    def set_tags(self, document_id, event_id, *, tag_ids=None, name=None):
        owner_id, owner, radix = self.owner(document_id)
        events = copy.deepcopy(owner.get('saved_events', []))
        event = next((item for item in events if item['id'] == event_id), None)
        if event is None:
            raise ValueError('Unknown saved event')
        catalog = self.tag_metadata(events)['tagCatalog']
        available = {tag['id']: tag for tag in catalog}
        ids = list(dict.fromkeys(tag_ids or []))
        if any(tag_id not in available for tag_id in ids):
            raise ValueError('Unknown event tag')
        if name is not None:
            tag = self.tags.change(name=name, refs=catalog)
            available[tag['id']] = tag
            if tag['id'] not in ids:
                ids.append(tag['id'])
        previous = {tag['id'] for tag in self.tags.resolve(event.get('tags'))}
        added = [tag_id for tag_id in ids if tag_id not in previous]
        self.tags.touch(added, refs=available.values())
        event['tags'] = self.tags.resolve([available[tag_id] for tag_id in ids])
        self._persist(owner_id, owner, radix, events, tags_changed=bool(added) or name is not None)
        return {'eventId': event_id, 'tags': event['tags'], **self.tag_metadata(events)}

    def change_tag(self, document_id, tag_id, *, name=None, remove=False):
        _, owner, _ = self.owner(document_id)
        refs = self.tag_metadata(owner.get('saved_events', []))['tagCatalog']
        tag = self.tags.change(tag_id=tag_id, name=name, remove=remove, refs=refs)
        self._tags_changed(refresh_rows=True)
        return {'tag': tag, 'tagCatalog': self.tags.catalog(refs), 'catalogVersion': self.tags.catalog_version}

    def _tags_changed(self, *, refresh_rows=False):
        self.workspace._manager.broadcast_threadsafe({
            'type': 'chart.event-tags.changed', 'tagCatalog': self.tags.catalog(),
            'catalogVersion': self.tags.catalog_version,
        })
        if not refresh_rows:
            return
        # The shared vocabulary affects every chart, including closed records
        # resolved on their next open. No chart construction or collection scan.
        ids = [doc_id for doc_id, session in self.workspace._controller._runtime.items()
               if not session.get('parent_document_id')]
        self.workspace._manager.broadcast_threadsafe({'type': 'chart.events.changed', 'documentIds': ids})

    def change(self, document_id, event_id, *, name=None, remove=False):
        owner_id, owner, radix = self.owner(document_id)
        events = copy.deepcopy(owner.get('saved_events', []))
        event = next((item for item in events if item['id'] == event_id), None)
        if event is None:
            raise ValueError('Unknown saved event')
        if remove:
            events.remove(event)
        else:
            clean_name = str(name or '').strip()
            if not clean_name:
                raise ValueError('An event needs a name')
            event['name'] = clean_name
        self._persist(owner_id, owner, radix, events)
        if not remove:
            for session in self.workspace._controller._runtime.values():
                if session.get('saved_event_id') == event_id:
                    session['saved_event_name'] = event['name']
                    self.workspace._controller._sync_runtime_title(session)
            self.workspace._manager.broadcast_threadsafe({'type': 'documents.changed', 'tree': self.workspace._tree_payload()})
        return {'ok': True, 'ownerDocumentId': owner_id}

    def open(self, document_id, event_id):
        owner_id, owner, radix = self.owner(document_id)
        event = next((item for item in owner.get('saved_events', []) if item['id'] == event_id), None)
        if event is None:
            raise ValueError('Unknown saved event')
        workspace = self.workspace
        for doc_id, session in workspace._controller._runtime.items():
            if (session.get('saved_event_id') == event_id and session.get('saved_event_owner') == owner_id
                    and session.get('saved_event_source_signature') == event.get('signature')
                    and session.get('saved_event_signature') == _signature(self._nodes(doc_id, owner_id))):
                workspace._controller.activate_document(doc_id)
                return workspace._attach_full_snapshot({'ok': True, 'documentId': doc_id,
                    'activeDocumentId': doc_id, 'documents': workspace._tree_payload()}, doc_id)
        parent_id = owner_id
        controller = workspace._controller
        previous_ids = set(controller._runtime)
        previous_active = controller.active_document_id()
        listener = controller._on_event
        controller.set_event_listener(None)
        try:
            for index, node in enumerate(event['nodes']):
                parent_id = self._open_node(parent_id, node, event['name'] if index == len(event['nodes']) - 1 else node['label'])
        except Exception:
            for doc_id in set(controller._runtime) - previous_ids:
                if controller.session(doc_id) is not None:
                    controller.close_document(doc_id)
            if previous_active:
                controller.activate_document(previous_active)
            raise
        finally:
            controller.set_event_listener(listener)
        session = workspace._controller.session(parent_id)
        session['saved_event_id'] = event_id
        session['saved_event_owner'] = owner_id
        session['saved_event_signature'] = _signature(self._nodes(parent_id, owner_id))
        session['saved_event_source_signature'] = event.get('signature')
        session['saved_event_name'] = event['name']
        workspace._controller._sync_runtime_title(session)
        tree = workspace._tree_payload()
        workspace._manager.broadcast_threadsafe({'type': 'documents.changed', 'tree': tree})
        return workspace._attach_full_snapshot({'ok': True, 'documentId': parent_id,
            'activeDocumentId': parent_id, 'documents': tree}, parent_id)

    def _open_node(self, parent_id, node, label):
        from webapp.daemon.workspace_service import SupplementaryStepper
        workspace = self.workspace
        opts = chart_snapshot_service.options
        # Older sidebar-created transits had no Binding.
        # Normalize at the persistence boundary; live sessions use ordinary
        # supplementary ownership, steppers and projections thereafter.
        node = copy.deepcopy(node)
        if (node.get('feature') == 'transits' and not node.get('binding')
            and not node.get('pd') and not node.get('participants')):
            chrt = chart_factory.chart_from_record(node['chart'], opts)
            node['binding'] = self._transit_node(chrt, workspace._parent_radix(parent_id), label)['binding']
        display = tuple(node['display'])
        comparison = chart_factory.chart_from_record(node['comparison'], opts) if node.get('comparison') else None
        if node.get('comparisonRole') == 'parent':
            comparison = workspace._controller._comparison_chart_for_parent(workspace._controller.session(parent_id))
        elif node.get('comparisonRole') == 'radix':
            comparison = self.owner(parent_id)[2]
        if node.get('launcher') == 'ascensional_transits':
            result = workspace.open_ascensional_transits(
                parent_id, source_document_id=parent_id, publish=False)
            doc_id = result['documentId']
        elif node.get('pd'):
            pd = node['pd']
            result = workspace.open_directions_pd_in_chart(
                directions_document_id=parent_id, arc=pd['currentArc'],
                mode=pd['mode'], direct=pd['direct'],
                when_iso=dateformat.iso_datetime_text(display), session_label=label,
                event_jd=pd.get('exactEventJd'), direction_event=pd.get('directionEvent'), publish=False)
            doc_id = result['documentId']
        elif node.get('participants'):
            participants = [chart_factory.chart_from_record(record, opts) for record in node['participants']]
            pair = [chart_factory.chart_from_record(record, opts) for record in node['pair']]
            result = workspace._open_loaded_synastry(pair[0], pair[1],
                comparison_name=pair[1].name, center_ref=None, partner_ref=None, publish=False)
            doc_id = result['documentId']
            session = workspace._controller.session(doc_id)
            session['relationship_participants'] = participants
            session['relationship_participant_states'] = node['participantStates']
            workspace.set_synastry_composite(doc_id, node.get('compositeVariant') or 'synastry', publish=False)
            workspace._controller.state.reparent_document(doc_id, parent_id)
            session['parent_document_id'] = parent_id
        elif node['feature'] in PUBLIC_TO_FEATURE_KIND.values() and node.get('binding'):
            binding = copy.deepcopy(node.get('binding'))
            when = (binding or {}).get('parent_source_datetime') or display
            document = workspace._open_child(parent_document_id=parent_id,
                feature_kind=node['feature'], when_iso=dateformat.iso_datetime_text(when),
                binding_payload=binding, comparison_chart=comparison,
                comparison_layout=node['presentation'].get('comparison_layout'), session_label=label)
            doc_id = document.document_id
        else:
            chrt = chart_factory.chart_from_record(node['chart'], opts)
            document = workspace._controller.open_document(chrt,
                radix=chrt if node.get('independentRadix') else workspace._parent_radix(parent_id),
                parent_document_id_override=parent_id,
                session_label=label, display_datetime=display,
                comparison_chart=comparison, view_mode=node['viewMode'],
                navigation_units=tuple(node['navigationUnits']) or ('day', 'hour', 'minute', 'second'),
                launcher_kind=node['launcher'], supplementary_feature_kind=node['feature'], dirty=False)
            doc_id = document.document_id
        session = workspace._controller.session(doc_id)
        session.update(copy.deepcopy(node['presentation']))
        session['base_title'] = label
        session['custom_title_root'] = label
        cs = session['chart_session']
        if tuple(cs.display_datetime) != display:
            # A saved cursor can be displaced from its Binding's launch seed.
            # Replay that displacement through the same navigation owner used
            # by the live chart, including the signified progression clock.
            seconds = int((datetime.datetime(*display) - datetime.datetime(*cs.display_datetime)).total_seconds())
            feature = node['feature']
            if feature in ('secondary', 'tertiary', 'minor', 'solar_arc'):
                workspace._navigate_progression_direct(session, cs, 'second', seconds)
            elif feature == 'converse_transits':
                workspace._navigate_converse_transit_direct(cs, 'second', seconds)
            else:
                cs.navigate_relative('second', seconds)
        cs._initial_chart = cs.chart
        cs._initial_display_datetime = cs.display_datetime
        cs._initial_cursor_jd = cs.cursor_jd
        stepper = getattr(cs, '_stepper', None)
        if isinstance(stepper, SupplementaryStepper):
            stepper._initial_binding_payload = copy.deepcopy(session.get('supplementary_binding'))
            stepper._initial_parent_source_datetime = session.get('parent_source_datetime')
        cs.view_mode = node['viewMode']
        if workspace._is_at_visual_session(session):
            workspace._sync_ascensional_session_metadata(session)
        workspace._controller._sync_runtime_title(session)
        return doc_id
