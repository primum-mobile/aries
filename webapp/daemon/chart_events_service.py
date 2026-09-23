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
import uuid
from pathlib import Path

import chartfile
import chart_session
import dateformat
import mtexts
import note_storage
from engine import chart_factory
from webapp.daemon.chart_service import chart_snapshot_service
from webapp.daemon.supplementary_service import PUBLIC_TO_FEATURE_KIND
from webapp.daemon.event_tags import EventTags


def _record(chrt):
    record = chartfile.chart_to_dict(chrt, chart_id=getattr(chrt, 'chart_id', '') or 'event', include_events=False)
    record.pop('modified_at', None)
    return record


def _signature(nodes):
    return hashlib.sha256(json.dumps(nodes, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


class ChartEventsService:
    def __init__(self, workspace):
        self.workspace = workspace
        self.tags = EventTags()

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
        if session.get('parent_document_id'):
            return [{
                'type': 'item', 'label': 'Add event',
                'labelKey': 'chartEvents.save', 'actionId': 'workspace.save_event',
                'payload': {'documentId': document_id, 'ownerDocumentId': self.owner(document_id)[0]},
            }]
        _, owner, _ = self.owner(document_id)
        return [{
            'type': 'submenu', 'label': 'Events', 'labelKey': 'chartEvents.title',
            'eventsDocumentId': document_id,
            'eventCount': len(owner.get('saved_events', [])), 'children': [],
        }]

    def _capture_node(self, session):
        cs = session.get('chart_session')
        if cs is None or getattr(cs, 'chart', None) is None:
            raise ValueError('Only child charts can be saved as events')
        chrt = cs.chart
        node = {
            'chart': _record(chrt),
            'label': str(session.get('custom_title_root') or session.get('base_title') or chrt.name or mtexts.txts.get('Chart', 'Chart')),
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
        session['saved_event_name'] = event['name']
        self.workspace._controller._sync_runtime_title(session)
        self.workspace._manager.broadcast_threadsafe({'type': 'documents.changed', 'tree': self.workspace._tree_payload()})
        return {'ok': True, 'ownerDocumentId': owner_id, 'eventId': event['id']}

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

    def list(self, document_id, *, offset=0, limit=128, query=''):
        owner_id, owner, radix = self.owner(document_id)
        events = owner.get('saved_events', [])
        needle = str(query).strip().casefold()
        ordered = sorted((event for event in events if not needle or needle in event['name'].casefold()),
                         key=lambda event: event['nodes'][-1]['cursorJd'])
        start = max(0, int(offset))
        stop = start + min(256, max(1, int(limit)))
        rows = []
        for event in ordered[start:stop]:
            node = event['nodes'][-1]
            y, m, d, h, mi, s = node['display']
            rows.append({'id': event['id'], 'name': event['name'], 'tags': self.tags.resolve(event.get('tags')),
                         'date': dateformat.date_text(y, m, d, chart_snapshot_service.options,
                                                     bc=node['chart'].get('bc', False)),
                         'time': f'{h:02d}:{mi:02d}', 'datetime': dateformat.iso_datetime_text(node['display']),
                         'kind': node['feature'] or node['launcher'] or node['chart']['type']})
        return {'ownerDocumentId': owner_id, 'recordId': str(owner.get('chart_id') or getattr(radix, 'chart_id', '') or ''),
                'sourceName': radix.name, **self.tag_metadata(events),
                'rows': rows, 'total': len(ordered), 'offset': start}

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
        display = tuple(node['display'])
        comparison = chart_factory.chart_from_record(node['comparison'], opts) if node.get('comparison') else None
        if node.get('comparisonRole') == 'parent':
            comparison = workspace._controller._comparison_chart_for_parent(workspace._controller.session(parent_id))
        elif node.get('comparisonRole') == 'radix':
            comparison = self.owner(parent_id)[2]
        if node.get('pd'):
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
                radix=workspace._parent_radix(parent_id), parent_document_id_override=parent_id,
                session_label=label, display_datetime=display,
                comparison_chart=comparison, view_mode=node['viewMode'],
                navigation_units=tuple(node['navigationUnits']) or None,
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
        workspace._controller._sync_runtime_title(session)
        return doc_id
