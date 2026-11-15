# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Typed coordinate material for the shared wheel, independent of paint.

Semantic longitudes are immutable inputs. Drawing coordinates have their own
fields and explicit unavailable status. This module never evaluates transits,
constructs an event sky, changes options, or assigns ecliptic dignities.
"""
from __future__ import annotations

from bisect import bisect_left, bisect_right
from types import SimpleNamespace

import ascensional_transits as at
import chart_bodies
import houses
from engine import pd_in_chart
from webapp.daemon import aspect_list_service as registry
from webapp.daemon import mundane_points
from webapp.daemon.chart_presentation import equatorial_reference_frame
from webapp.frontend.scripts import export_chart_json

_AXES = {'asc': 0.0, 'dc': 180.0, 'dsc': 180.0, 'ic': 90.0, 'mc': 270.0}
_CUSP_ALIASES = {'cusp1': ('asc',), 'cusp4': ('ic',), 'cusp7': ('dc', 'dsc'), 'cusp10': ('mc',)}


def point_capabilities(point, acting_keys, receiving_keys):
    """Total role contract; AT eligibility belongs to the existing technique.

    A display catalog supplies geometric candidates, not new daily event
    actors. Declination contacts additionally require physical declination.
    """
    available = point['status'] == 'available'
    key = point['semanticKey']
    def outcome(supported, reason):
        return {'supported': bool(supported), **({} if supported else {'reason': reason})}
    return {
        'projection': outcome(available, point.get('reason', 'missing-source-coordinates')),
        'referenceReadout': outcome(available, point.get('reason', 'missing-source-coordinates')),
        'withinContacts': outcome(available, point.get('reason', 'missing-source-coordinates')),
        'comparisonContacts': outcome(available, point.get('reason', 'missing-source-coordinates')),
        'declinationContacts': outcome(False, 'declination-is-accompanying-transit-evidence'),
        # Structural rays still receive contacts from projected points.
        'structuralContacts': outcome(available and point.get('coordinateKind') != 'structural',
                                      'equal-mundane-spokes-always-exact'),
        'atActing': outcome(available and key in acting_keys, 'outside-existing-at-acting-contract'),
        'atReceiving': outcome(available and key in receiving_keys, 'outside-existing-at-receiving-contract'),
    }


def _semantic_endpoints(chrt, role, opts):
    """Resolve configured candidates before renderer/display eligibility.

    Active hit-filtered families must use their unfiltered catalog here. The
    established ascensional display filter is applied later by the paint owner.
    """
    endpoints = []
    for item in export_chart_json.technique_aspect_endpoints(chrt, chrt.options):
        key = 'dsc' if item['key'] == 'dc' else item['key']
        endpoints.append({
            'key': key, 'kind': item['kind'], 'longitude': float(item['lon']),
            'metadata': registry._endpoint_metadata(chrt, key, role, opts),
        })
    for key, longitude in export_chart_json._cusp_longitudes(chrt):
        endpoints.append({
            'key': key, 'kind': 'houseCusp', 'longitude': longitude,
            'metadata': registry._point_metadata(chrt, key, role, opts),
        })
    items = [(item, False) for item in registry._technique_ring_items(chrt, role, opts, include_active_ring=False)]
    mode = registry._active_outer_ring_mode(opts)
    if mode in mundane_points._HIT_FILTERED_FAMILIES:
        items.extend((item, True) for item in mundane_points._unfiltered_ring_items(chrt, role, opts, mode))
    else:
        _mode, active = registry._active_outer_ring_items(chrt, role, opts)
        items.extend((item, True) for item in active)
    seen = {}
    for item, active in items:
        # A semantic identity never contains the current projected angle.
        metadata = registry._ring_point_metadata(item, role, opts, chrt=chrt)
        key = str(metadata['key'])
        if key in seen:
            if active:
                seen[key].update(activeRing=True, ringItem=item, metadata=metadata)
            continue
        endpoint = {
            'key': key, 'kind': 'ringPoint', 'longitude': float(item['longitude']),
            'metadata': metadata,
            'ringItem': item, 'activeRing': active,
        }
        seen[key] = endpoint
        endpoints.append(endpoint)
    return endpoints


def project_chart(chrt, opts, *, role: str, document_id: str, revision: int,
                  event_frame=None, position_mode='mdo', sky=None) -> dict:
    """Project an existing calculated chart, including synthetic techniques.

    Physical coordinates come from the chart registry/engine transform. The
    supplied event frame is already corrected by the AT owner, when applicable.
    No display date is interpreted as a fresh ephemeris instant.
    ``position_mode='mundane'`` places bodies by the PD system's own mundane
    position (Regiomontanus/Campanus RMP/CMP, otherwise Placidian PMP) in this
    chart's frame; ``sky`` overrides the chart whose bodies are projected.
    """
    ramc = float(event_frame.event_ramc if event_frame is not None else
                 chrt.houses.ascmc2[houses.Houses.MC][houses.Houses.RA])
    latitude = float(event_frame.event_place.lat if event_frame is not None else chrt.place.lat)
    # A celestial PDs-in-Chart ring is the natal sky at its turned meridian:
    # promissors carried by diurnal motion, not its zodiacal directed degrees.
    if sky is None:
        sky = pd_in_chart.natal_sky(chrt)
    acting_ids = set(at._transit_planet_point_ids(chrt))
    receiving_ids = set(at._radix_planet_point_ids(chrt))
    acting_keys = {export_chart_json.planet_id_from_se_id(value) for value in acting_ids} - {None}
    receiving_keys = {export_chart_json.planet_id_from_se_id(value) for value in receiving_ids} - {None}
    acting_keys.update(('nnode', 'snode'))
    receiving_keys.update(('nnode', 'snode', 'fortune', *_AXES, *(f'cusp{i}' for i in range(1, 13))))
    points = []
    for endpoint in _semantic_endpoints(sky, role, opts):
        key = endpoint['key']
        point = {
            'id': f'{role}:{key}', 'semanticKey': key, 'chartRole': role,
            'documentId': document_id, 'revision': revision,
            'kind': endpoint['kind'], 'longitude': endpoint['longitude'],
            'metadata': endpoint['metadata'],
        }
        if endpoint.get('ringItem') is not None:
            point['ringItem'] = endpoint['ringItem']
            point['activeRing'] = endpoint['activeRing']
        structural = _AXES.get(key)
        if endpoint['kind'] == 'houseCusp':
            structural = (int(key[4:]) - 1) * 30.0
        if structural is not None:
            mdo, quadrant = at._mdo_q_from_pmp(structural)
            point.update(status='available', drawingAngle=structural,
                         mdo=mdo, quadrant=quadrant, coordinateKind='structural')
        else:
            try:
                lon, lat, ra, decl = mundane_points._coordinates(sky, endpoint)
                point.update(latitude=float(lat), ra=float(ra), declination=float(decl))
                if position_mode == 'mundane' and event_frame is None:
                    position = mundane_points._position(
                        chrt, (lon, lat, ra, decl), position_mode='mundane',
                    )
                    if position is None:
                        point.update(status='undefined', reason='no-ascensional-semi-arc')
                    else:
                        angle, mdo, quadrant = position
                        point.update(status='available', mdo=float(mdo), quadrant=int(quadrant),
                                     drawingAngle=float(angle),
                                     coordinateKind='mundane-primary-direction')
                else:
                    mdo, quadrant, _above = at.compute_mdo(ra, decl, ramc, latitude)
                    if mdo is None:
                        point.update(status='undefined', reason='no-ascensional-semi-arc')
                    else:
                        point.update(status='available', mdo=float(mdo), quadrant=int(quadrant),
                                     drawingAngle=float(at._pmp_from_mdo_q(mdo, quadrant)),
                                     coordinateKind='mdo')
            except (AttributeError, KeyError, IndexError, TypeError, ValueError) as error:
                point.update(status='unavailable', reason='missing-source-coordinates',
                             diagnostic=type(error).__name__)
        point['capabilities'] = point_capabilities(point, acting_keys, receiving_keys)
        points.append(point)
    return {
        'chartRole': role, 'documentId': document_id, 'revision': revision,
        'ramc': ramc, 'geographicLatitude': latitude,
        'sourceJd': float(chrt.time.jd),
        'ayanamshaOffset': float(getattr(chrt, 'ayanamsha_offset', 0.0)),
        'points': points,
    }


def _ring_role(index):
    return 'primary' if index == 0 else 'outer' if index == 1 else f'ring:{index}'


def elapsed_ring_frames(charts, elapsed_jds, measure):
    """Experimental precession frames for non-event comparison rings.

    Each later ring's own meridian moves by the event correction for the time
    elapsed since the primary chart (``elapsed_jds[index]``, already resolved
    by the session owner: a partner's birth, or a derived chart's cursor).
    Signed, so an earlier-born outer chart moves the other way.
    """
    if len(charts) < 2:
        return {}
    base_jd = float(charts[0].time.jd)
    frames = {}
    for index, chrt in enumerate(charts[1:], start=1):
        correction = at.precession_dt_correction_arcmin(base_jd, float(elapsed_jds[index]), measure=measure)
        ramc = float(chrt.houses.ascmc2[houses.Houses.MC][houses.Houses.RA])
        frames[_ring_role(index)] = SimpleNamespace(
            event_ramc=(ramc + correction / 60.0) % 360.0, event_ramc_uncorrected=ramc,
            event_place=chrt.place, precession_correction_arcmin=correction,
        )
    return frames


def build_scene(charts, opts, *, document_id: str, revision: int,
                participant_document_ids=None, event_frames=None) -> dict:
    """All rings share the primary cross's reference scale; peers do not.

    A celestial PDs-in-Chart scene projects the PD list's natal sky in every
    ring, each at its own meridian (the radix, then the sky turned by the arc),
    measured with the PD system's own mundane positions, so an in-mundo
    direction meets its significator exactly at its arc.
    """
    ids = list(participant_document_ids or [])
    pd_chart = next((chrt for chrt in charts if pd_in_chart.natal_sky(chrt) is not chrt), None)
    pd_sky = pd_in_chart.natal_sky(pd_chart) if pd_chart is not None else None
    rings = [project_chart(
        chrt, opts, role=_ring_role(index),
        document_id=(ids[index] if index < len(ids) and ids[index] else document_id),
        revision=revision,
        event_frame=(event_frames or {}).get(_ring_role(index)),
        position_mode='mundane' if pd_sky is not None else 'mdo',
        sky=pd_sky,
    ) for index, chrt in enumerate(charts)]
    if not rings:
        raise ValueError('ascensional scene requires a calculated chart')
    return {
        'schemaVersion': 1, 'documentId': document_id, 'revision': revision,
        'convention': 'aries-mdo-asc0-ic90-dsc180-mc270',
        'referenceFrame': equatorial_reference_frame(
            rings[0]['ramc'], owner_document_id=document_id, role='primary',
        ),
        'rings': rings,
    }


# The Aspect List's widest ascensional orb choice (1.5 deg). Contacts beyond the
# technique orbs exist only for the list; the wheel keeps the technique graph.
LIST_MAX_ORB_ARCMIN = 90.0


def _list_aspect(left_angle, right_angle, list_max_arcmin):
    """(aspect, orb arcmin, inside technique orb) without list prefiltering.

    Inside the technique orbs the existing detector and its priority decide, so
    every wheel contact keeps its identity; beyond them the closest geometry
    within the list maximum is reported.
    """
    aspect, orb = at._pmp_aspect(
        left_angle, right_angle,
        orb_conj=at.ORB_CONJ_OPP_ARCMIN, orb_antiscia=at.ORB_ANTISCIA_ARCMIN,
    )
    if aspect is not None:
        return aspect, orb, True
    d = abs(left_angle - right_angle) % 360.0
    d = 360.0 - d if d > 180.0 else d
    s_mod = (left_angle + right_angle) % 360.0
    candidates = (
        (at.CONJUNCTION, d * 60.0),
        (at.OPPOSITION, abs(d - 180.0) * 60.0),
        (at.ANTISCIA, abs(s_mod - 180.0) * 60.0),
        (at.CONTRA_ANTISCIA, min(s_mod, 360.0 - s_mod) * 60.0),
    )
    aspect, orb = min(candidates, key=lambda candidate: candidate[1])
    if orb <= list_max_arcmin:
        return aspect, orb, False
    return None, None, False


def technique_graph(graph: dict) -> dict:
    """The wheel/Inspector graph: contacts inside the technique orbs only."""
    contacts = [contact for contact in graph['contacts'] if contact.get('techniqueOrb', True)]
    adjacency = {}
    for contact in contacts:
        for key in ('fromId', 'toId'):
            adjacency.setdefault(contact[key], []).append(contact['id'])
    return {**graph, 'contacts': contacts, 'adjacency': adjacency}


def mdo_contacts(rings: list[dict], list_max_arcmin: float | None = None) -> dict:
    """Method-specific adjacency for presentation, never AT event evaluation.

    Use the existing engine's normalized-angle taxonomy and orbs. The complete
    available point universe participates before the skin applies draw flags.
    True-declination parallels belong to accompanying transit evidence, not
    this MDO geometry or its click adjacency.
    """
    contacts = []
    adjacency = {}

    def append(left, right, method, orb, maximum, scope, technique_orb=True):
        contact = {
            'id': f"{scope}:{left['id']}:{right['id']}:{method}",
            'method': 'mdo', 'aspect': method, 'scope': scope,
            'fromId': left['id'], 'toId': right['id'],
            'fromDrawingAngle': left['drawingAngle'],
            'toDrawingAngle': right['drawingAngle'],
            'orbArcmin': float(orb), 'maxOrbArcmin': float(maximum),
            'techniqueOrb': bool(technique_orb),
        }
        contacts.append(contact)
        adjacency.setdefault(left['id'], []).append(contact['id'])
        adjacency.setdefault(right['id'], []).append(contact['id'])

    def pair(left, right, scope):
        if left['status'] != 'available' or right['status'] != 'available':
            return
        if scope == 'within' and {left['semanticKey'], right['semanticKey']} == {'nnode', 'snode'}:
            return
        # Angles and cusps are the equal mundane spokes of the one shared frame:
        # any pair of them is exact by construction and carries no information.
        if left.get('coordinateKind') == 'structural' and right.get('coordinateKind') == 'structural':
            return
        if list_max_arcmin is None:
            aspect, orb = at._pmp_aspect(
                left['drawingAngle'], right['drawingAngle'],
                orb_conj=at.ORB_CONJ_OPP_ARCMIN, orb_antiscia=at.ORB_ANTISCIA_ARCMIN,
            )
            technique_orb = True
        else:
            aspect, orb, technique_orb = _list_aspect(
                left['drawingAngle'], right['drawingAngle'], list_max_arcmin,
            )
        if aspect is not None:
            maximum = at.ORB_ANTISCIA_ARCMIN if aspect in (at.ANTISCIA, at.CONTRA_ANTISCIA) else at.ORB_CONJ_OPP_ARCMIN
            append(left, right, aspect, orb, maximum, scope, technique_orb)

    # Index only candidate ranges; the existing detector still owns every
    # contact and its priority. This bounds dense catalogs without changing orbs.
    indexes = []
    for ring in rings:
        angles = sorted((point['drawingAngle'] % 360 + wrap, index)
                        for index, point in enumerate(ring['points']) if point['status'] == 'available'
                        for wrap in (-360, 0, 360))
        indexes.append(angles)
    angle_orb = max(at.ORB_CONJ_OPP_ARCMIN, at.ORB_ANTISCIA_ARCMIN, list_max_arcmin or 0.0) / 60

    def nearby(values, target, orb):
        # A tiny index tolerance protects exact floating-point boundary matches;
        # pair() applies the original engine's strict final comparison.
        low = bisect_left(values, (target - orb - 1e-10, -1))
        high = bisect_right(values, (target + orb + 1e-10, float('inf')))
        return (index for _, index in values[low:high])

    for ring_index, ring in enumerate(rings):
        for index, left in enumerate(ring['points']):
            if left['status'] != 'available':
                continue
            for peer_index in range(ring_index, len(rings)):
                angles = indexes[peer_index]
                candidates = set()
                angle = left['drawingAngle']
                for target in (angle, angle + 180, -angle, 180 - angle):
                    candidates.update(nearby(angles, target % 360, angle_orb))
                for other_index in sorted(candidates):
                    if peer_index == ring_index and other_index <= index:
                        continue
                    pair(left, rings[peer_index]['points'][other_index],
                         'within' if peer_index == ring_index else 'comparison')
    return {'method': 'mdo', 'contacts': contacts, 'adjacency': adjacency}


def _is_fixed_star(point: dict) -> bool:
    ref = (point.get('metadata') or {}).get('motionRef') or {}
    return ref.get('kind') == 'fixedStar' and bool(point['capabilities']['structuralContacts']['supported'])


def at_role_mdo_contacts(rings: list[dict], list_max_arcmin: float | None = None) -> dict:
    """The ascensional view's contacts follow the existing AT technique.

    Only AT acting points (planets, nodes) contact AT receiving points
    (planets, nodes, Fortune, angles, cusps). Fixed stars additionally sit on
    their own chart's angles and cusps (mundane conjunction only); lots and
    other outer-ring families are drawn but never acquire contacts. Across
    rings the outer chart acts on the inner one, as in the AT biwheel.
    """
    def role(point, name):
        return point['capabilities'][name]['supported']
    eligible = [{**ring, 'points': [point for point in ring['points']
                                    if role(point, 'atActing') or role(point, 'atReceiving')
                                    or _is_fixed_star(point)]}
                for ring in rings]
    graph = mdo_contacts(eligible, list_max_arcmin)
    points = {point['id']: point for ring in eligible for point in ring['points']}
    def allowed(contact):
        left, right = points[contact['fromId']], points[contact['toId']]
        if _is_fixed_star(left) or _is_fixed_star(right):
            return (contact['scope'] == 'within' and contact['aspect'] == at.CONJUNCTION
                    and any(point.get('coordinateKind') == 'structural' for point in (left, right)))
        if contact['scope'] == 'comparison':
            return role(right, 'atActing') and role(left, 'atReceiving')
        return ((role(left, 'atActing') and role(right, 'atReceiving'))
                or (role(right, 'atActing') and role(left, 'atReceiving')))
    contacts = [contact for contact in graph['contacts'] if allowed(contact)]
    adjacency = {}
    for contact in contacts:
        for key in ('fromId', 'toId'):
            adjacency.setdefault(contact[key], []).append(contact['id'])
    return {'method': 'mdo', 'contacts': contacts, 'adjacency': adjacency}


def apply_to_snapshot(snapshot, charts, opts, presentation, *, document_id,
                      participant_document_ids=None, at_frame=None, legacy_payload=None,
                      parallel_chart=None, ring_frames=None, precession=None):
    """Attach separate drawing material to the standard semantic payload.

    This is the shared-wheel adapter, not a replacement chart calculation.
    Source longitude, latitude, dignity, binding and cursor fields survive.
    """
    import chart as chart_mod
    import common
    import mtexts
    import util
    event_frames = ({("outer" if len(charts) > 1 else "primary"): at_frame} if at_frame else ring_frames or None)
    scene = build_scene(charts, opts, document_id=document_id,
                        revision=presentation['revision'],
                        participant_document_ids=participant_document_ids, event_frames=event_frames)
    parallel_items = []
    if parallel_chart is not None and len(charts) == 1:
        # The existing parallel-transit overlay remains a display family. Its
        # physical coordinates belong to the existing real-cursor transit sky,
        # never the symbolic display date interpreted by this adapter.
        for item in snapshot.get('outerRingItems', {}).get('parallel_transits', []):
            suffix = item['id'].removeprefix('parallel-transit-')
            ref = ({'kind': 'planet', 'bodyId': int(suffix[7:])} if suffix.startswith('planet-')
                   else {'kind': suffix})
            coordinates = mundane_points._coordinates(parallel_chart,
                {'longitude': item['longitude'], 'metadata': {'motionRef': ref}})
            position = mundane_points._position(parallel_chart, coordinates)
            metadata = registry._ring_point_metadata(item, 'outer', opts, chrt=parallel_chart)
            key = metadata['key']
            point = {'id': 'primary:' + key, 'semanticKey': key, 'chartRole': 'outer',
                     'documentId': document_id, 'revision': presentation['revision'],
                     'kind': 'ringPoint', 'metadata': metadata, 'ringItem': item,
                     'longitude': item['longitude'], 'latitude': coordinates[1], 'ra': coordinates[2],
                     'declination': coordinates[3], 'sourceJd': parallel_chart.time.jd,
                     'status': 'available' if position is not None else 'undefined'}
            if position is None:
                point['reason'] = 'no-ascensional-semi-arc'
            else:
                point.update(drawingAngle=position[0], mdo=position[1], quadrant=position[2])
                parallel_items.append(point)
            point['capabilities'] = point_capabilities(point, set(), set())
            scene['rings'][0]['points'].append(point)
    if at_frame is not None:
        # Prepared AT values are the authority for existing event factors.
        # Reuse the engine result once; do not re-evaluate ephemerides or correct the frame twice.
        for index, ring in enumerate(scene['rings']):
            source = at_frame.radix_points if len(charts) > 1 and index == 0 else at_frame.transit_points
            by_key = {at_point_key(point): point for point in source}
            for point in ring['points']:
                prepared = by_key.get(point['semanticKey'])
                if prepared is not None:
                    point.update(status='available', mdo=prepared.mdo, quadrant=prepared.quadrant,
                                 drawingAngle=at._pmp_from_mdo_q(prepared.mdo, prepared.quadrant))
                    if prepared.ra is not None:
                        point.update(ra=prepared.ra, declination=prepared.decl)
    if legacy_payload and legacy_payload.get('visualMode') == 'mundane':
        for chrt, ring, bodies in zip(charts, scene['rings'], [legacy_payload['bodies'], legacy_payload.get('secondaryBodies') or []]):
            by_id = {int(body['id']): body for body in bodies if isinstance(body.get('id'), int)}
            for point in ring['points']:
                body_id = (chart_bodies.apogee_id(chrt.options) if point['semanticKey'] == 'apogee' else
                           registry._PLANET_BY_KEY.get(point['semanticKey'], common.CHART_OBJECT_FORTUNE if point['semanticKey'] == 'fortune' else None))
                if body_id in by_id:
                    angle = by_id[body_id]['mundane']
                    mdo, quadrant = at._mdo_q_from_pmp(angle)
                    point.update(drawingAngle=angle, mdo=mdo, quadrant=quadrant)
                    point['coordinateKind'] = 'mundane-primary-direction'
                elif point.get('coordinateKind') != 'structural':
                    coords = mundane_points._coordinates(chrt, point)
                    position = mundane_points._position(chrt, coords, position_mode='mundane')
                    if position is None:
                        point.update(status='undefined', reason='no-ascensional-semi-arc')
                        point.pop('drawingAngle', None)
                    else:
                        angle, mdo, quadrant = position
                        point.update(status='available', drawingAngle=angle, mdo=mdo, quadrant=quadrant,
                                     coordinateKind='mundane-primary-direction')
    list_graph = (
        at_contact_graph(scene, at_frame, LIST_MAX_ORB_ARCMIN) if at_frame is not None
        else at_role_mdo_contacts(scene['rings'], LIST_MAX_ORB_ARCMIN)
    )
    graph = technique_graph(list_graph)
    if legacy_payload and legacy_payload.get('visualMode') == 'mundane':
        graph = list_graph = {'method': 'mundane-primary-direction', 'contacts': [], 'adjacency': {}}
    scene['graph'] = graph
    # The Aspect List's contact universe: the same detector out to its widest
    # orb choice, each contact marked inside/outside the technique orb.
    scene['listGraph'] = list_graph
    scene['contactMethod'] = graph['method']
    if at_frame is not None:
        # The prepared event frame, for consumers that sample AT motion
        # (Aspect List phase). Never serialized.
        scene['atFrame'] = at_frame
        scene['calculation'] = {
            'method': 'marr-estadella' if at_frame.apply_precession else 'ordinary',
            'eventRamcUncorrected': at_frame.event_ramc_uncorrected,
            'correctionArcmin': at_frame.precession_correction_arcmin,
            'measure': at_frame.precession_measure,
        }
    elif precession is not None:
        # Non-event rings: one correction per later ring, in ring order.
        scene['calculation'] = {
            'method': 'experimental' if ring_frames else 'ordinary',
            'measure': precession['measure'],
            # elapsed_ring_frames inserts frames in ring order.
            'correctionsArcmin': [frame.precession_correction_arcmin
                                  for frame in (ring_frames or {}).values()],
        }
    payloads = list(snapshot.get('rings') or []) or [
        snapshot['primaryChart'], *([snapshot['comparisonChart']] if snapshot.get('comparisonChart') else []),
    ]
    def readout(point):
        angle = point.get('drawingAngle')
        if angle is None:
            return None
        value = point['mdo']
        if presentation['readout'] != 'mdo-quadrant':
            value = (angle + scene['referenceFrame']['ramc'] + 90) % 360
            if presentation['readout'] == 'equatorial-signs':
                value %= 30
        degree, minute, _second = util.decToDeg(value)
        if presentation['readout'] == 'mdo-quadrant' and point.get('coordinateKind') == 'structural':
            # Angles and cusps are the fixed 30° spokes of the MDO frame:
            # their minutes are always 00, so the label is degrees only.
            return {'degText': str(degree), 'minText': ''}
        return {'degText': str(degree), 'minText': f'{minute:02d}'}

    def attach(payload, point):
        if payload is None or point is None:
            return
        payload['drawingAngle'] = point.get('drawingAngle')
        if point.get('drawingAngle') is not None:
            payload.update(mdo=point['mdo'], quadrant=point['quadrant'])
            payload.update(readout(point))
    for ring_index, (payload, ring) in enumerate(zip(payloads, scene['rings'])):
        points = {point['semanticKey']: point for point in ring['points']}
        payload['coordinateFrame'] = {
            'mode': 'ascensional', 'revision': presentation['revision'],
            'ramc': scene['referenceFrame']['ramc'],
            'readout': presentation['readout'],
            'showEquatorialSigns': presentation['showEquatorialSigns'],
            'aspectGlyphs': {'14': mtexts.txts['AntisciaAbbrev'], '15': mtexts.txts['ContraAntisciaAbbrev']},
        }
        payload['coordinatePoints'] = {key: point.get('drawingAngle') for key, point in points.items()}
        payload['angles']['drawing'] = {key: _AXES[key] for key in ('asc', 'dsc', 'mc', 'ic')}
        payload['angles']['drawing']['vertex'] = points.get('vertex', {}).get('drawingAngle')
        payload['houses']['drawingCusps'] = [index * 30.0 for index in range(12)]
        payload['houses']['cuspDegMin'] = [readout(points[f'cusp{index}']) for index in range(1, 13)]
        payload['angles']['ascDegMin'] = readout(points['asc'])
        payload['angles']['mcDegMin'] = readout(points['mc'])
        for planet in payload['planets']:
            attach(planet, points.get(planet['id']))
        for key in ('fortune', 'vertex', 'syzygy', 'eclipse'):
            attach(payload.get(key), points.get(key))
        for mark in payload.get('surveilMarks') or []:
            coords = mundane_points._coordinates(charts[ring_index], {'longitude': mark['longitude'], 'metadata': {}})
            position = mundane_points._position(charts[ring_index], coords, event_frame=(event_frames or {}).get(ring['chartRole']),
                                                position_mode='mundane' if legacy_payload and legacy_payload.get('visualMode') == 'mundane' else 'mdo')
            mark['drawingAngle'] = position[0] if position is not None else None
        # Only method-specific graph material is ever offered to the wheel.
        payload['aspects'] = []
        payload['bodyAspects'] = {}
        # Varga relationships retain source sign semantics, with separately projected rays.
        for relation in payload.get('drishti') or []:
            def sign_ray(sign):
                endpoint = {'longitude': sign * 30 + 15, 'metadata': {}}
                coords = mundane_points._coordinates(charts[ring_index], endpoint)
                position = mundane_points._position(charts[ring_index], coords, event_frame=(event_frames or {}).get(ring['chartRole']),
                                                position_mode='mundane' if legacy_payload and legacy_payload.get('visualMode') == 'mundane' else 'mdo')
                return position[0] if position is not None else None
            relation['drawingActorAngle'] = (points.get(relation.get('actorKey'), {}).get('drawingAngle')
                                             if relation['actorKind'] == 'planet' else sign_ray(relation['actorSign']))
            relation['drawingTargetAngle'] = sign_ray(relation['targetSign'])
    snapshot['multiwheelConjunctions'] = []
    type_by_aspect = {
        at.CONJUNCTION: chart_mod.Chart.CONJUNCTIO,
        at.OPPOSITION: chart_mod.Chart.OPPOSITIO,
        at.ANTISCIA: 14,
        at.CONTRA_ANTISCIA: 15,
    }
    points_by_id = {point['id']: (index, point) for index, ring in enumerate(scene['rings']) for point in ring['points']}
    snapshot['interChartAspects'] = []
    snapshot['interChartBodyAspects'] = {}
    snapshot['interChartBodyAspectIndices'] = {}
    for payload in payloads:
        payload['bodyAspectRefs'] = {}
    for contact in graph['contacts']:
        left_index, left = points_by_id[contact['fromId']]
        right_index, right = points_by_id[contact['toId']]
        aspect_type = type_by_aspect[contact['aspect']]
        aspect = {
            'type': aspect_type, 'orb': contact['orbArcmin'] / 60,
            'maxOrb': contact['maxOrbArcmin'] / 60,
            'exact': contact['orbArcmin'] <= 1e-9,
            'method': graph['method'], 'contactId': contact['id'],
        }
        left_key, right_key = left['semanticKey'], right['semanticKey']
        if left_index == right_index:
            payload = payloads[left_index]
            payload['aspects'].append({**aspect, 'p1': left_key, 'p2': right_key})
            for key, other in ((left_key, right_key), (right_key, left_key)):
                ref = {'aspectIndex': len(payload['aspects']) - 1, 'other': other}
                payload['bodyAspectRefs'].setdefault(key, []).append(ref)
                if graph['method'] == 'ascensional-transits':
                    for alias in _CUSP_ALIASES.get(key.removeprefix('reference:'), ()):
                        payload['bodyAspectRefs'].setdefault(alias, []).append(ref)
        elif len(payloads) >= 3 and contact['aspect'] == at.CONJUNCTION:
            snapshot['multiwheelConjunctions'].append({
                **aspect, 'innerRing': left_index, 'outerRing': right_index,
                'inner': left_key, 'outer': right_key,
            })
        elif left_index == 0 and right_index == len(payloads) - 1:
            entry = {**aspect, 'inner': left_key, 'outer': right_key, 'showsOnClick': True, 'showsNormally': True}
            snapshot['interChartAspects'].append(entry)
            for key in (left_key, f'outer:{right_key}'):
                snapshot['interChartBodyAspectIndices'].setdefault(key, []).append(len(snapshot['interChartAspects']) - 1)
            if graph['method'] == 'ascensional-transits':
                for alias in _CUSP_ALIASES.get(left_key, ()):
                    snapshot['interChartBodyAspectIndices'].setdefault(alias, []).append(len(snapshot['interChartAspects']) - 1)
    # Active overlay display eligibility is owned by the existing MDO adapter.
    # Recover the source item from the semantic universe, not its legacy PMP-as-
    # longitude compatibility copy.
    mode = registry._active_outer_ring_mode(opts)
    role_index = len(charts) - 1 if len(charts) > 1 and mode in (
        'arabic_parts', 'antiscia', 'contra_antiscia', 'dodecatemoria',
    ) else 0
    filter_mdo = mundane_points.mdo_hit_filtered(mode, opts) and not (
        legacy_payload and legacy_payload.get('visualMode') == 'mundane')
    target_frame = ((at_frame if role_index or len(charts) == 1 else None) if at_frame is not None
                    else (event_frames or {}).get(_ring_role(role_index)))
    targets = mundane_points._mdo_display_targets(charts[role_index], opts,
        event_frame=target_frame) if filter_mdo else None
    legacy_active = None
    if not filter_mdo and mode in mundane_points._HIT_FILTERED_FAMILIES:
        _mode, legacy_items = registry._active_outer_ring_items(charts[role_index], scene['rings'][role_index]['chartRole'], opts)
        legacy_active = {(item['family'], item['id']) for item in legacy_items}
    items = []
    for point in scene['rings'][role_index]['points']:
        if not point.get('activeRing') or point['status'] != 'available':
            continue
        item = dict(point['ringItem'])
        if legacy_active is not None and (item['family'], item['id']) not in legacy_active:
            continue
        if targets is not None:
            ref = point['metadata'].get('motionRef') or {}
            own_body = ref.get('bodyId') if ref.get('kind') == 'ephemerisBody' else None
            orb = mundane_points._mdo_display_orb(mode, item, opts)
            if not mundane_points.is_mdo_display_hit(point['mdo'], point['quadrant'], orb, own_body, targets):
                continue
        attach(item, point)
        item['aspectKey'] = point['semanticKey']
        items.append(item)
    if parallel_chart is not None and len(charts) == 1:
        mode, role_index, items = 'parallel_transits', 0, []
        for point in parallel_items:
            item = dict(point['ringItem'])
            attach(item, point)
            item['aspectKey'] = point['semanticKey']
            items.append(item)
    snapshot['outerRingItems'] = {mode: items}
    snapshot['outerRingMode'] = mode
    snapshot['outerRingChartIndex'] = role_index
    shown_keys = {'cusp1', 'cusp4', 'cusp7', 'cusp10', 'asc', 'mc', 'dsc', 'ic'}
    for index, payload in enumerate(payloads):
        visible = {planet['id'] for planet in payload['planets']}
        visible.update(key for key in ('fortune', 'vertex', 'syzygy', 'eclipse') if payload.get(key))
        # What the wheel actually draws: the Inspector lists contacts only
        # between these points, never the whole configured universe.
        shown_keys.update(visible)
        if payload['options'].get('showHouses'):
            shown_keys.update(f'cusp{number}' for number in range(1, 13))
        visible.update(('asc', 'mc', 'dsc', 'ic', 'dc'))
        visible.update(key for key in payload['coordinatePoints'] if key.startswith('reference:'))
        if payload['options'].get('showHouses'):
            visible.update(f'cusp{number}' for number in range(1, 13))
        if index == role_index:
            visible.update(item['aspectKey'] for item in items)
        payload['coordinatePoints'] = {key: value for key, value in payload['coordinatePoints'].items()
                                       if key in visible}
        if 'dsc' in payload['coordinatePoints']:
            payload['coordinatePoints']['dc'] = payload['coordinatePoints']['dsc']
    scene['shownKeys'] = sorted(shown_keys)
    snapshot['ascensionalScene'] = {key: value for key, value in scene.items() if key not in ('rings', 'graph', 'listGraph', 'shownKeys', 'atFrame')}
    snapshot['ascensionalScene']['rings'] = [{key: value for key, value in ring.items() if key != 'points'} for ring in scene['rings']]
    return scene


def at_point_key(point):
    if point.kind in ('planet', 'node'):
        return export_chart_json.planet_id_from_se_id(point.idx)
    if point.kind == 'lof':
        return 'fortune'
    if point.kind == 'cusp':
        return 'cusp' + str(point.idx)
    return None


def _list_at_pairs(frame, list_max_arcmin):
    """AT pairs out to the list maximum, with the engine's own pairing rules."""
    pairs = []
    for transit in frame.transit_points:
        if transit.mdo is None:
            continue
        pmp_t = at._pmp_from_mdo_q(transit.mdo, transit.quadrant)
        for radix in frame.radix_points:
            if radix.mdo is None:
                continue
            if transit.kind == 'planet' and radix.kind == 'planet' and transit.idx == radix.idx:
                continue
            aspect, orb, technique_orb = _list_aspect(
                pmp_t, at._pmp_from_mdo_q(radix.mdo, radix.quadrant), list_max_arcmin,
            )
            if aspect is not None:
                pairs.append((at.ATPair(transit, radix, aspect, orb), technique_orb))
    return pairs


def at_contact_graph(scene, frame, list_max_arcmin: float | None = None):
    contacts, adjacency = [], {}
    rings = scene['rings']
    lookup = [{point['semanticKey']: point for point in ring['points']} for ring in rings]
    # In CHART mode the fixed radix endpoints remain explicit reference rays,
    # as in the existing AT single wheel, without masquerading as live bodies.
    if len(rings) == 1:
        for prepared in frame.radix_points:
            key = at_point_key(prepared)
            if key is None:
                continue
            point = {'id': 'reference:' + key, 'semanticKey': 'reference:' + key,
                     'documentId': rings[0]['documentId'], 'revision': scene['revision'], 'chartRole': 'primary',
                     'status': 'available', 'mdo': prepared.mdo, 'quadrant': prepared.quadrant,
                     'drawingAngle': at._pmp_from_mdo_q(prepared.mdo, prepared.quadrant),
                     'metadata': {'label': prepared.label}, 'kind': 'reference'}
            if prepared.lon is not None:
                point['longitude'] = prepared.lon
            if prepared.ra is not None:
                point.update(ra=prepared.ra, declination=prepared.decl, latitude=prepared.lat)
            point['capabilities'] = point_capabilities(point, set(), {point['semanticKey']})
            rings[0]['points'].append(point)
            lookup[0]['reference:' + key] = point
    pairs = (
        [(pair, True) for pair in frame.at_pairs] if list_max_arcmin is None
        else _list_at_pairs(frame, list_max_arcmin)
    )
    for pair, technique_orb in pairs:
        source_key, target_key = at_point_key(pair.transit), at_point_key(pair.radix)
        left = lookup[-1].get(source_key)
        right = lookup[0].get(target_key if len(rings) > 1 else 'reference:' + str(target_key))
        if left is None or right is None:
            continue
        maximum = at.ORB_ANTISCIA_ARCMIN if pair.aspect in (at.ANTISCIA, at.CONTRA_ANTISCIA) else at.ORB_CONJ_OPP_ARCMIN
        # Export primary->outer order for the shared biwheel endpoint contract.
        left, right = (right, left) if len(rings) > 1 else (left, right)
        contact = {'id': f"at:{left['id']}:{right['id']}:{pair.aspect}", 'method': 'ascensional-transits',
                   'aspect': pair.aspect, 'scope': 'comparison' if len(rings) > 1 else 'within',
                   'fromId': left['id'], 'toId': right['id'], 'fromDrawingAngle': left['drawingAngle'],
                   'toDrawingAngle': right['drawingAngle'], 'orbArcmin': pair.orb_arcmin, 'maxOrbArcmin': maximum,
                   'techniqueOrb': bool(technique_orb)}
        contacts.append(contact)
        for point in (left, right):
            adjacency.setdefault(point['id'], []).append(contact['id'])
    return {'method': 'ascensional-transits', 'contacts': contacts, 'adjacency': adjacency}
