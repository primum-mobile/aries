# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Coordinate facts from the committed wheel scene, beside source astrology."""
from __future__ import annotations

import common
import mtexts
import util
from webapp.daemon.chart_presentation import presentation_for_session
from webapp.frontend.scripts import export_chart_json


def context(document_id, kind, object_id, chart_role, ring_index):
    if not document_id:
        return None
    from webapp.daemon.workspace_service import workspace_service
    with workspace_service._lock:
        session = workspace_service.session_for_view(document_id)
        if not session or workspace_service.presentation_for_view(document_id, session)['coordinateMode'] != 'ascensional':
            return None
        scene = workspace_service.ascensional_scene_for_view(document_id, session)
        if not scene:
            return None
        ring_item = str(object_id).split('|', 2) if kind == 'secondary_ring' else None
        index = ring_index if ring_index is not None else 1 if chart_role == 'outer' else 0
        if ring_item and ring_item[0] == 'parallel_transits':
            index = 0
        if not 0 <= index < len(scene['rings']):
            return None
        ring = scene['rings'][index]
        point = None
        if kind == 'planet':
            key = export_chart_json.planet_id_from_se_id(int(object_id))
        elif kind == 'angle':
            key = 'dsc' if object_id in ('dc', 'desc') else object_id
        elif kind == 'house':
            key = 'cusp' + str(object_id)
        else:
            key = kind
        if kind == 'secondary_ring':
            family, longitude, label = ring_item
            point = next((point for point in ring['points'] if point.get('ringItem')
                          and point['ringItem']['family'] == family
                          and abs(float(point['longitude']) - float(longitude)) < 1e-7
                          and point['ringItem'].get('label', '') == label), None)
        else:
            point = next((point for point in ring['points'] if point['semanticKey'] == key), None)
        return {'scene': scene, 'ring': ring, 'point': point, 'kind': kind, 'objectId': str(object_id)}


# Ascensional contact kinds → the shared chart aspect type and mtexts name.
_ASPECT_TYPES = {'conjunction': 0, 'opposition': 10, 'antiscia': 14, 'contra_antiscia': 15}
_ASPECT_TEXT_KEYS = {'conjunction': 'Conjunctio', 'opposition': 'Oppositio',
                     'antiscia': 'Antiscia', 'contra_antiscia': 'ContraAntiscia'}


def _degrees(value):
    degree, minute, second = util.decToDeg(value)
    return f'{degree}°{minute:02d}′{second:02d}″'


def _arc_text(arcmin):
    degree, minute, _second = util.decToDeg(abs(arcmin) / 60)
    return ('−' if arcmin < 0 else '') + f'{degree}°{minute:02d}′'


def _precession_block(session, scene):
    """The one precession switch every ascensional view carries.

    Shown wherever time elapses between compared frames: an event, or a
    second ring. A lone chart has nothing to correct, so no switch.
    """
    import ascensional_transits as at
    from webapp.daemon.ascensional_method import method_payload
    method = method_payload(session)
    calculation = scene.get('calculation') or {}
    event = method['purpose'] == 'event'
    available = event or len(scene['rings']) > 1
    corrections = ([calculation['correctionArcmin']] if 'correctionArcmin' in calculation
                   else list(calculation.get('correctionsArcmin') or []))
    return {
        'available': available,
        'applied': bool(method['applyPrecession']),
        'measure': method['measure'],
        'rateText': f"{at.precession_rate_arcsec(method['measure']):.2f}".rstrip('0').rstrip('.') + '″',
        'correctionText': ' / '.join(_arc_text(value) for value in corrections) if method['applyPrecession'] else '',
        'experimental': not event,
    }


def special_payload(ctx, *, compact):
    """Reference signs and MDO contacts must never enter zodiac dignity/phase code."""
    if ctx is None or ctx['kind'] not in ('sign', 'aspect'):
        return None
    scene = ctx['scene']
    rows = []
    glyph = ''
    if ctx['kind'] == 'sign':
        index = int(ctx['objectId']) % 12
        title = mtexts.txts['AscensionalEquatorialReference'] + ': ' + mtexts.signs[index]
        glyph = common.common.Signs1[index]
        rows = [(mtexts.txts['AscensionalEquatorialReference'], f'{index * 30}°–{(index + 1) * 30}°'),
                ('RAMC', _degrees(scene['referenceFrame']['ramc']))]
    else:
        request = ctx['objectId']
        inter = request.startswith('interchart:')
        if inter:
            request = request[len('interchart:'):]
        kinds = {value: key for key, value in _ASPECT_TYPES.items()}
        points = {point['id']: point for ring in scene['rings'] for point in ring['points']}
        def aliases(point):
            key = point['semanticKey']
            cusp = key.removeprefix('reference:')
            return (key, *{'cusp1': ('asc',), 'cusp4': ('ic',), 'cusp7': ('dc', 'dsc'), 'cusp10': ('mc',)}.get(cusp, ()))
        if request.startswith('contact:'):
            contact = next((contact for contact in scene['graph']['contacts']
                            if contact['id'] == request[len('contact:'):]), None)
        else:
            endpoints, aspect_type = request.rsplit(':', 1)
            aspect = kinds.get(int(aspect_type))
            ring_ids = {point['id'] for point in ctx['ring']['points']}
            contact = next((contact for contact in scene['graph']['contacts']
                            if contact['aspect'] == aspect
                            and (contact['scope'] != 'within') == inter
                            and (inter or contact['fromId'] in ring_ids)
                            and any(endpoints in (left + ':' + right, right + ':' + left)
                                    for left in aliases(points[contact['fromId']])
                                    for right in aliases(points[contact['toId']]))), None)
        title = mtexts.txts['AscensionalContact']
        if contact:
            aspect = contact['aspect']
            left, right = points[contact['fromId']], points[contact['toId']]
            title = left['metadata'].get('label', left['semanticKey']) + ' — ' + right['metadata'].get('label', right['semanticKey'])
            rows = [(mtexts.txts['AscensionalContact'], mtexts.txts.get(_ASPECT_TEXT_KEYS[aspect], '')),
                    (mtexts.txts['Orb'], _degrees(contact['orbArcmin'] / 60)),
                    ('MDO', _degrees(left['mdo']) + ' / ' + _degrees(right['mdo']))]
    if compact:
        return {'title': title, 'glyph': glyph, 'accent': None, 'compact': True, 'rows': rows}
    text = [label + ': ' + value for label, value in rows]
    return {'title': title, 'glyph': glyph, 'accent': None, 'meta': '',
            'smart_rows': text, 'detail_rows': [], 'dignity_rows': [], 'aspect_rows': [], 'rows': text, 'footer': ''}


def decorate(payload, ctx, *, compact):
    if not payload or not ctx or ctx['point'] is None:
        return payload
    point = ctx['point']
    if point['status'] != 'available':
        facts = [('MDO', mtexts.txts['AscensionalUndefined'])]
    else:
        facts = [('MDO', _degrees(point['mdo']) + ' · ' + mtexts.txts['AscensionalQuadrant'] + ' ' + str(point['quadrant']))]
        if 'ra' in point:
            facts.extend([('RA', _degrees(point['ra'])),
                          (mtexts.txts['AscensionalDeclination'], _degrees(point['declination']))])
    # Existing ecliptic position, source dignities, motion and context survive.
    if compact:
        payload['rows'] = facts + list(payload.get('rows') or [])
    else:
        payload['smart_rows'] = [label + ': ' + value for label, value in facts] + list(payload.get('smart_rows') or [])
    return payload


def _scene_contacts(document_id, view_side=None):
    """Index the committed wheel's AT contacts by (transit, radix, aspect)."""
    from webapp.daemon.workspace_service import workspace_service
    with workspace_service._lock:
        session = workspace_service.session_for_view(document_id, view_side)
        scene = workspace_service.ascensional_scene_for_view(document_id, session, view_side) if session else None
    if not scene or scene.get('contactMethod') != 'ascensional-transits':
        return {}
    points = {point['id']: point for ring in scene['rings'] for point in ring['points']}
    multi = len(scene['rings']) > 1
    indexed = {}
    for contact in scene['graph']['contacts']:
        left, right = points[contact['fromId']], points[contact['toId']]
        # Biwheels export radix→transit; the single AT wheel transit→reference.
        radix, transit = (left, right) if multi else (right, left)
        key = (transit['semanticKey'], radix['semanticKey'].removeprefix('reference:'), contact['aspect'])
        indexed[key] = {
            'kind': 'aspect', 'p1': left['semanticKey'], 'p2': right['semanticKey'],
            'aspectType': _ASPECT_TYPES[contact['aspect']],
            'scope': 'interchart' if contact['scope'] == 'comparison' else 'primary',
            'method': 'ascensional-transits', 'contactId': contact['id'],
        }
    return indexed


# One mundane axis, one fact: angles are cusps 1/4/7/10, and each axis end
# (and the south node) is the fixed opposite of its partner. A contact with
# one end implies the mirrored contact with the other, so the list keeps a
# single row per axis fact, named by conjunction, north node and Asc/MC.
_AXIS_ENDS = {'asc': ('asc', 0), 'cusp1': ('asc', 0), 'dsc': ('asc', 1), 'dc': ('asc', 1),
              'cusp7': ('asc', 1), 'mc': ('mc', 0), 'cusp10': ('mc', 0), 'ic': ('mc', 1),
              'cusp4': ('mc', 1), 'nnode': ('nnode', 0), 'snode': ('nnode', 1)}
_ASPECT_FAMILY = {'conjunction': 'axis', 'opposition': 'axis',
                  'antiscia': 'antiscia', 'contra_antiscia': 'antiscia'}


def _collapse_axis_mirrors(entries):
    """entries: (left key, right key, aspect, orb, row) in list order."""
    groups, order = {}, []
    for left, right, aspect, orb, row in entries:
        ends = [_AXIS_ENDS.get(key.removeprefix('reference:'), (key, 0)) for key in (left, right)]
        group = (tuple(sorted(end[0] for end in ends)), _ASPECT_FAMILY.get(aspect, aspect))
        cusps = sum(key.removeprefix('reference:').startswith('cusp') for key in (left, right))
        rank = (sum(end[1] for end in ends) + (aspect in ('opposition', 'contra_antiscia')), cusps, orb)
        if group not in groups:
            order.append(group)
        if group not in groups or rank < groups[group][0]:
            groups[group] = (rank, row)
    return [groups[group][1] for group in order]


def _rows_by_exactness(entries):
    """Axis-collapsed rows, tightest orb first."""
    orb_by_id = {row['id']: orb for *_, orb, row in entries}
    return sorted(_collapse_axis_mirrors(entries), key=lambda row: orb_by_id[row['id']])


def _mdo_section(document_id, scene, precession):
    """Rows use precisely the committed wheel graph, including all point families."""
    from webapp.daemon.ascensional_service import _aspect_glyph_and_font
    points = {point['id']: point for ring in scene['rings'] for point in ring['points']}
    ring_indices = {point['id']: index for index, ring in enumerate(scene['rings']) for point in ring['points']}
    def item(point):
        meta = point['metadata']
        label = meta.get('label') or meta.get('name') or point['semanticKey']
        return {'glyph': meta.get('glyph') or label, 'font': meta.get('glyphFont', 'text'), 'label': label}
    # Same drawn-points limit as the AT section: undrawn outer-ring items
    # stay out of the Inspector.
    shown = set(scene['shownKeys']) if scene.get('shownKeys') is not None else None
    entries = []
    for contact in scene['graph']['contacts']:
        left, right = points[contact['fromId']], points[contact['toId']]
        if shown is not None and (left['semanticKey'].removeprefix('reference:') not in shown
                                  or right['semanticKey'].removeprefix('reference:') not in shown):
            continue
        glyph, font = _aspect_glyph_and_font(contact['aspect'])
        index = ring_indices[left['id']]
        entries.append((left['semanticKey'], right['semanticKey'], contact['aspect'], contact['orbArcmin'], {
            'id': contact['id'], 'transit': item(left), 'radix': item(right),
            'aspect': {'glyph': glyph, 'font': font, 'label': mtexts.txts[_ASPECT_TEXT_KEYS[contact['aspect']]]},
            'orbText': _degrees(contact['orbArcmin'] / 60), 'statusText': '', 'twoTransit': [],
            'region': {'kind': 'aspect', 'p1': left['semanticKey'], 'p2': right['semanticKey'],
                       'aspectType': _ASPECT_TYPES[contact['aspect']],
                       'scope': 'interchart' if contact['scope'] == 'comparison' else 'primary',
                       'chartRole': 'outer' if index else 'primary', 'ringIndex': index,
                       'method': scene['contactMethod'], 'contactId': contact['id']},
        }))
    rows = _rows_by_exactness(entries)
    return {'documentId': document_id, 'supportsEvent': False, 'title': mtexts.txts['AscensionalContact'],
            'event': {'jd': scene['rings'][0]['sourceJd'], 'datetimeText': '',
                      'ramcText': _degrees(scene['referenceFrame']['ramc']), 'applyPrecession': precession['applied']},
            'precession': precession,
            'twoTransit': {'isActiveMoment': False, 'activeEclipticCount': 0, 'activeAspectCount': 0},
            'sections': [{'id': 'contacts', 'title': mtexts.txts['AscensionalContact'], 'rows': rows, 'emptyText': None}]}


def transits_section(document_id, view_side=None):
    """Inspector section for an AT event document, or None when the view is
    no longer live or ascensional.

    Rows come unfiltered from the existing AT list service. Contacts that the
    active-ecliptic two-transit condition supports are marked, not removed,
    and each in-orb row carries the wheel contact it corresponds to.
    """
    from webapp.daemon.workspace_service import workspace_service
    with workspace_service._lock:
        session = workspace_service.session_for_view(document_id, view_side)
        if not session:
            # Retained snapshots may outlive their document while the next
            # chart is loading, just as they may outlive a coordinate change.
            return None
        if workspace_service.presentation_for_view(document_id, session, view_side)['coordinateMode'] != 'ascensional':
            # The view left ascensional mode before the Inspector's snapshot
            # caught up; there is no section, which is not a lookup failure.
            return None
        scene = workspace_service.ascensional_scene_for_view(document_id, session, view_side)
        if not scene:
            workspace_service.document_snapshot(document_id, view_side=view_side, include_split_peer=False)
            scene = workspace_service.ascensional_scene_for_view(document_id, session, view_side)
        precession = _precession_block(session, scene)
        if scene['contactMethod'] != 'ascensional-transits':
            return _mdo_section(document_id, scene, precession)
    from types import SimpleNamespace
    from webapp.daemon.ascensional_scene import at_point_key
    from webapp.daemon.ascensional_service import ascensional_service
    try:
        data = ascensional_service.snapshot(document_id=document_id, filter_to_active_moment=False)
    except (ValueError, SystemExit):
        # The document can close after the scene lookup releases the lock.
        # Only an expired document is an empty section; live failures propagate.
        with workspace_service._lock:
            if workspace_service._controller.session(document_id) is None:
                return None
        raise
    contacts = _scene_contacts(document_id, view_side)
    qualifying_by_body = {}
    for item in data['activeEclipticAspects']:
        qualifying_by_body.setdefault(item['transitId'], []).append({
            'radixLabel': item['radixLabel'], 'radixGlyph': item['radixGlyph'],
            'aspectDeg': item['aspectDeg'], 'orbText': item['orbText'],
        })
    for item in data['activeDeclinationAspects']:
        qualifying_by_body.setdefault(item['transitId'], []).append({
            'radixLabel': item['radixLabel'], 'radixGlyph': item['radixGlyph'],
            'aspectLabel': item['aspectLabel'], 'orbText': item['orbText'],
        })
    shown = set(scene['shownKeys']) if scene.get('shownKeys') is not None else None
    sections = []
    for row in data['list']['rows']:
        if row['kind'] == 'section':
            section_id = 'contacts' if not sections else 'approaching'
            sections.append({'id': section_id, 'title': row['title'], 'rows': [], 'emptyText': None})
            continue
        section = sections[-1]
        pair = row.get('pair')
        if not pair:
            section['emptyText'] = row['radixGlyph']
            continue
        transit, radix, aspect = pair['transit'], pair['radix'], pair['aspect']
        transit_key = at_point_key(SimpleNamespace(kind=transit['kind'], idx=transit['idx']))
        radix_key = at_point_key(SimpleNamespace(kind=radix['kind'], idx=radix['idx']))
        if shown is not None and (transit_key not in shown or radix_key not in shown):
            continue
        region = contacts.get((transit_key, radix_key, aspect)) if section['id'] == 'contacts' else None
        section['rows'].append((transit_key or '', radix_key or '', aspect, pair.get('orbArcmin', 0.0), {
            'id': f"{section['id']}:{transit['kind']}:{transit['idx']}:{radix['kind']}:{radix['idx']}:{aspect}",
            'transit': {'glyph': row['transitGlyph'], 'font': row['transitFont'], 'label': transit['label']},
            'aspect': {'glyph': row['aspectGlyph'], 'font': row['aspectFont'],
                       'label': mtexts.txts.get(_ASPECT_TEXT_KEYS.get(aspect, ''), aspect)},
            'radix': {'glyph': row['radixGlyph'], 'font': row['radixFont'], 'label': radix['label']},
            'orbText': row['orbText'],
            'statusText': row['statusText'],
            'twoTransit': qualifying_by_body.get(transit['idx'], []) if transit['kind'] == 'planet' else [],
            'region': region,
        }))
    for section in sections:
        section['rows'] = _rows_by_exactness(section['rows'])
    event = data['event']
    return {
        'documentId': document_id,
        'supportsEvent': True,
        'title': mtexts.txts.get('AscensionalTransits', mtexts.txts['AscensionalContact']),
        'event': {
            'jd': event['jd'],
            'datetimeText': event['datetime']['isoUtc'].replace('T', ' '),
            'ramcText': _degrees(event['ramc']),
            'applyPrecession': bool(event['applyPrecession']),
        },
        'precession': precession,
        'twoTransit': {
            'isActiveMoment': bool(data['twoTransitRule']['isActiveMoment']),
            'activeEclipticCount': len(data['activeEclipticAspects']),
            'activeAspectCount': len(data['activeEclipticAspects']) + len(data['activeDeclinationAspects']),
        },
        'sections': sections,
    }
