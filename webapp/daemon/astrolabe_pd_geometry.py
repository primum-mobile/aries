# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Display adapter for actual primary motion and native zodiacal reprojection.

The rete carries the sky; representatives lie on the *natal* ecliptic. Painted
links follow the system's own zero-arc locus between the two (the circle of
position, or the Placidian line), sampled from the engine's arc evaluator.
No chart positions, direction rows, house options or calculation rules change.
"""
from __future__ import annotations

import math

import astrology
import chart
import houses
import mtexts
import primdirs
import util
import astrolabe_projection as stereo
from engine import pd_in_chart, pd_row_geometry
from webapp.daemon import ascensional_scene, mundane_points, polar_azimuthal_service as polar
from webapp.daemon.display_palette import aspect_color_role
from webapp.daemon.surveil_service import format_zodiac_position


# A drawn contact's orb: two months either side of exactness under the
# stepper's key, never wider than one degree of arc. Contacts fade in from the
# lead (the corner list's half-year window, scaled with the orb) and draw at
# full strength inside the orb; they fade out the same way after exactness.
PD_ORB_YEARS = 2.0 / 12.0
PD_ORB_MAX_ARC = 1.0
PD_LEAD_YEARS = 0.5
FOCUS_CONTACTS = 2


def pd_orb_arc(years_per_degree):
    """The display orb in degrees of arc for a time key's rate."""
    return min(PD_ORB_YEARS / max(float(years_per_degree), 1e-9), PD_ORB_MAX_ARC)


def pd_lead_arc(years_per_degree):
    """Where a contact starts to fade in, in degrees of arc."""
    return pd_orb_arc(years_per_degree) * PD_LEAD_YEARS / PD_ORB_YEARS


def pd_contact_strength(distance, years_per_degree):
    """Display strength of a contact ``distance`` degrees of arc from exact:
    1 inside the orb, easing to 0 at the lead."""
    orb, lead = pd_orb_arc(years_per_degree), pd_lead_arc(years_per_degree)
    distance = abs(float(distance))
    if distance <= orb:
        return 1.0
    if distance >= lead:
        return 0.0
    u = (lead - distance) / (lead - orb)
    return u * u * (3.0 - 2.0 * u)


def _capability(reason=None):
    return {"supported": reason is None, **({"reason": reason} if reason else {})}


def _xy(radix, ra, decl, projection):
    ramc = float(radix.houses.ascmc2[houses.Houses.MC][houses.Houses.RA])
    x, y = (polar.project(ramc - ra, decl) if projection == "polarEquidistant"
            else stereo.equatorial_to_xy(ra, decl, ramc, 1.0, stereo.plate_pole(float(radix.place.lat))))
    if not all(math.isfinite(v) and abs(v) < 1e5 for v in (x, y)):
        raise ValueError("projection-singularity")
    return {"x": x, "y": y}


def _pair(radix, longitude, latitude, arc, system, projection):
    moved_lon, moved_lat, ra, decl = pd_in_chart._rotate_equatorial_ray(
        longitude, latitude, arc, radix,
    )
    actual = {**_xy(radix, ra, decl, projection), "ra": ra, "decl": decl,
              "longitude": moved_lon, "latitude": moved_lat}
    if system not in pd_row_geometry.SUPPORTED_ECLIPTIC_FOOT_SYSTEMS:
        return {"actual": actual, "capability": _capability("unsupported-pd-system")}
    try:
        lon = pd_in_chart.project_system_ecliptic_point(radix, longitude, latitude, arc, system)
        foot = _foot(radix, lon, projection)
    except ValueError:
        return {"actual": actual, "capability": _capability("undefined-native-reprojection")}
    return {"actual": actual, "representative": foot, "capability": _capability()}


def _foot(radix, lon, projection):
    """A chart-zodiac degree on the natal ecliptic as a representative."""
    ra, decl, _ = astrology.swe_cotrans(
        util.to_tropical_lon(lon, getattr(radix, "ayanamsha_offset", 0.0)),
        0.0, 1.0, -radix.obl[0],
    )
    return {**_xy(radix, ra, decl, projection), "longitude": lon, "position": format_zodiac_position(lon)}


def _on_significator_circle(radix, pair, significator, remaining, system, projection):
    """Re-seat ``pair``'s representative on a latitude significator's own
    circle of position (its Placidian line under semi-arcs).

    ``significator`` is the (longitude, latitude) ray the row directs to and
    ``remaining`` the native row arc still to run (0 for the significator
    itself). The representative is the zero-latitude degree with that same
    arc to the significator, so under every system a row's diamond meets the
    significator's mark exactly at the row's arc. Pole systems give a
    latitude point its own pole; a zero-latitude foot's pole lies elsewhere,
    so the one-sky foot cannot stand in here.
    """
    lon, lat = significator
    if "representative" not in pair or not lat:
        return pair
    try:
        foot = pd_in_chart.directed_significator_longitude(radix, lon, lat, remaining, system)
        pair["representative"] = _foot(radix, foot, projection)
    except ValueError:
        pair.pop("representative")
        pair["capability"] = _capability("undefined-native-reprojection")
        return pair
    pair["locusSignificator"] = {"longitude": lon, "latitude": lat, "arc": remaining}
    return pair


def attach_display_loci(radix, payload):
    """Give each painted link its system locus once the payload is complete.

    Loci are display paths only, so hidden points cost nothing: eligibility
    mirrors the renderer's ``isDrawn`` (astrolabe-pd-reprojection.ts) over
    this payload, including asterism stars added after the overlay. Sparse
    row rays are always painted. A link without a locus is drawn straight.
    """
    overlay = payload.get("pdReprojection")
    if not overlay or abs(overlay["signedArc"]) < 1e-9:
        return
    painted = _painted(payload)
    pairs = [point for point in overlay["points"] if painted(point)]
    events = [*overlay["events"], *(overlay.get("focus") or {}).get("events", ())]
    pairs += [ray for event in events for ray in event["rays"]]
    for pair in pairs:
        actual, foot = pair.get("actual"), pair.get("representative")
        if not (actual and foot):
            continue
        locus = _position_locus(radix, actual["longitude"], actual["latitude"],
                                foot["longitude"], overlay["system"], payload["projection"],
                                pair.get("locusSignificator"))
        if locus:
            pair["locus"] = locus


def _painted(payload):
    if payload.get("projection") == "stereographic":
        body_ids = {int(body["id"]) for body in payload.get("bodies", ())}
        rete = payload.get("rete") or {}
        groups = (rete.get("stars"), rete.get("markedStars"), (payload.get("asterisms") or {}).get("stars"))
        codes = {str(star.get("nom")) for group in groups for star in group or ()}

        def stereographic(point):
            ref = point.get("metadata", {}).get("motionRef") or {}
            if ref.get("kind") == "fixedStar":
                return str(ref.get("code")) in codes
            if ref.get("kind") == "fortune":
                return -1 in body_ids
            return ref.get("kind") == "planet" and ref.get("bodyId") in body_ids
        return stereographic

    objects = payload.get("objects", ())
    body_ids = {o["bodyId"] for o in objects if o.get("bodyId") is not None}
    codes = {o["starCode"] for o in objects if o.get("starCode") is not None}
    ids = {o.get("id") for o in objects}

    def polar(point):
        metadata = point.get("metadata", {})
        ref = metadata.get("motionRef") or {}
        return ((ref.get("bodyId") is not None and ref["bodyId"] in body_ids)
                or (ref.get("code") is not None and ref["code"] in codes)
                or f"point:{point['key']}" in ids
                or (metadata.get("semanticId") is not None and metadata["semanticId"] in ids))
    return polar


def _position_locus(radix, lon, lat, foot_lon, system, projection, significator=None):
    """Projected interior samples of the turned point's zero-arc locus, or of
    a latitude significator's own circle when the representative sits there."""
    samples = _locus_samples(radix, lon, lat, foot_lon, system, significator)
    if samples is None:
        return None
    offset = getattr(radix, "ayanamsha_offset", 0.0)
    path = []
    for sample_lon, sample_lat in samples:
        ra, decl, _ = astrology.swe_cotrans(
            util.to_tropical_lon(sample_lon, offset), sample_lat, 1.0, -radix.obl[0],
        )
        try:
            path.append(_xy(radix, ra, decl, projection))
        except ValueError:
            return None
    return path


def _locus_samples(radix, lon, lat, foot_lon, system, significator=None):
    """Interior (longitude, latitude) samples of the system's zero-arc locus
    from a turned point down to its ecliptic representative: the circle of
    position under Regio, Campanus and the pole systems, the Placidian line
    under semi-arcs. With ``significator`` (longitude, latitude, arc) each
    sample instead keeps that row arc to the significator: its own circle.

    Latitude steps toward zero; each longitude zeroes the system's native arc
    from the turned point, so the path is the engine's own locus and ends
    where the diamond sits. The engine solver already placed that diamond;
    these sparse display samples only need sub-pixel accuracy, so a short
    Newton walk reuses the previous sample's slope and offset from the chord.
    The renderer smooths between them. A branch that jumps or fails returns
    None; the renderer then keeps a plain link.
    """
    span = _wrap(foot_lon - lon)
    count = min(5, math.ceil(math.hypot(span, lat) / 4.0))
    samples, bend, slope = [], 0.0, None
    for k in range(1, count + 1):
        t = k / (count + 1)
        target_lat = lat * (1.0 - t)
        chord = lon + span * t
        if significator is None:
            def evaluate(candidate, target_lat=target_lat):
                return pd_row_geometry.evaluate_ecliptic_point_arc(
                    system, radix, lon, lat, candidate, target_lat)
        else:
            def evaluate(candidate, target_lat=target_lat):
                return pd_row_geometry.evaluate_ecliptic_point_arc(
                    system, radix, candidate, target_lat,
                    significator["longitude"], significator["latitude"]) - significator["arc"]
        try:
            sample, slope = _zero_arc_longitude(evaluate, chord + bend, slope)
        except ValueError:
            return None
        bend = _wrap(sample - chord)
        if abs(bend) > abs(span) + 2.0:
            return None
        samples.append((sample, target_lat))
    return samples


def _wrap(angle):
    return util.normalize(angle + 180.0) - 180.0


def _zero_arc_longitude(evaluate, guess, slope=None, step=1e-4, tolerance=1e-3):
    """Display-precision root: 1e-3° stays under 0.2 px at the 12x zoom limit."""
    longitude = guess
    for _iteration in range(6):
        value = _wrap(evaluate(longitude))
        if abs(value) < tolerance:
            return util.normalize(longitude), slope
        if slope is None or _iteration > 1:
            slope = _wrap(evaluate(longitude + step) - value) / step
        if not math.isfinite(slope) or abs(slope) < 1e-8:
            break
        longitude -= max(-10.0, min(10.0, value / slope))
    raise ValueError("locus-sample-unresolved")


def _endpoint_for_pd(radix, endpoints, point, dynamic_key=None):
    """Classify PD ids before body ids (IC and Chiron share integer 15)."""
    from webapp.daemon.primdir_points import primdir_semantic_point

    identity = primdir_semantic_point(point, dynamic_key=dynamic_key, reference_chart=radix)
    if not identity:
        return None
    pid, body_id = identity["pointId"], identity.get("planetId")
    key = {"point:lof": "fortune", "point:syzygy": "syzygy",
           "point:vertex": "vertex"}.get(pid)
    if pid.startswith("angle:"):
        key = pid.split(":", 1)[1]
    if pid.startswith("house-cusp:"):
        key = "cusp" + pid.split(":", 1)[1]
    for endpoint in endpoints:
        metadata = endpoint["metadata"]
        ref = metadata.get("motionRef") or {}
        if key and endpoint["key"] == key:
            return endpoint
        if (pid.startswith(("planet:", "asteroid:")) and body_id is not None
                and ref.get("kind") in ("planet", "ephemerisBody") and ref.get("bodyId") == body_id):
            return endpoint
        if pid.startswith("fixstar:") and ref.get("code") == pid.split(":", 1)[1]:
            return endpoint
        if dynamic_key and (metadata.get("semanticId") == dynamic_key or
                            str(metadata.get("semanticId", "")).endswith(":" + str(dynamic_key))):
            return endpoint
        if str(dynamic_key or "").startswith("part:") and ref.get("kind") == "arabicPart":
            if ref.get("configIndex") == int(dynamic_key.split(":", 1)[1]):
                return endpoint
    return None


def native_cusps(radix, opts):
    """Cusp longitudes the PD engine directs to, when they differ from the
    drawn houses: the selected system's own P/R/C/T houses, as in
    ``PrimDirs._use_native_house_cusp_significators``. The private
    displayed-cusp path keeps the drawn cusps (None)."""
    code = primdirs.PrimDirs.house_system_for_primarydir(int(opts.primarydir))
    if (code is None or code == getattr(radix.houses, "hsys", None)
            or getattr(opts, "_pd_use_display_house_cusp_significators", False)):
        return None
    _pflag, hflag, _fsflag, _astflag = radix._zodiac_flags()
    native = houses.Houses(radix.time.jd, hflag, radix.place.lat, radix.place.lon, code,
                           radix.obl[0], opts.ayanamsha, radix.ayanamsha_offset)
    return {f"cusp{i}": float(native.cusps[i]) for i in range(1, 13)}


def _source(radix, endpoint, cusps=None):
    if cusps and endpoint["kind"] == "houseCusp" and endpoint["key"] in cusps:
        return cusps[endpoint["key"]], 0.0
    lon, lat, _ra, _decl = mundane_points._coordinates(radix, endpoint)
    return lon, lat


def _ray(radix, opts, endpoint, pd, promissor, cusps=None):
    aspect = int(pd.promasp if promissor else pd.sigasp)
    offset = getattr(pd, "promasp_offset" if promissor else "sigasp_offset", None)
    return _ray_point(radix, opts, endpoint, aspect, offset, promissor, cusps)


def _ray_point(radix, opts, endpoint, aspect, offset, promissor, cusps=None):
    lon, lat = _source(radix, endpoint, cusps)
    if aspect < chart.Chart.CONJUNCTIO or aspect > chart.Chart.SEPTILE:
        raise ValueError("unsupported-aspect-construction")
    if aspect != chart.Chart.CONJUNCTIO and offset is None:
        raise ValueError("missing-signed-aspect-side")
    offset = float(offset or 0.0)
    sub = getattr(opts, "subzodiacal", primdirs.PrimDirs.SZNEITHER)
    latitude_enabled = sub in (
        (primdirs.PrimDirs.SZPROMISSOR if promissor else primdirs.PrimDirs.SZSIGNIFICATOR),
        primdirs.PrimDirs.SZBOTH,
    )
    ray_lon, ray_lat = util.normalize(lon + offset), lat if latitude_enabled else 0.0
    construction = "native-latitude" if latitude_enabled else "ecliptic"
    if latitude_enabled and aspect != chart.Chart.CONJUNCTIO:
        if getattr(opts, "morin_excentric", False):
            owner = primdirs.PrimDirs.__new__(primdirs.PrimDirs)
            owner.chart = radix
            # The canonical engine applies Morin's correction to standard
            # planets only. Dynamic bodies keep their native row convention.
            body_id = (endpoint["metadata"].get("motionRef") or {}).get("bodyId", -1)
            ray_lon, ray_lat = owner.getMorinExcentric(body_id, lon, lat, offset)
            construction = "morin" if 0 <= body_id <= astrology.SE_PLUTO else "native-latitude"
        elif getattr(opts, "bianchini", False):
            ray_lat = math.degrees(math.asin(math.sin(math.radians(lat)) * math.cos(math.radians(offset))))
            construction = "bianchini"
        else:
            construction = "native-latitude"
    return ray_lon, ray_lat, aspect, offset, construction


def build_overlay(radix, opts, signed_arc, projection, entries=(), years_per_degree=1.0):
    """Resolve the entire semantic universe before selecting painted actors.

    Every family has actual-motion, reprojection and canonical-row-ray roles.
    Visibility belongs to the existing renderer. Unsupported systems, missing
    coordinates and undefined native branches retain explicit capabilities.
    Nearby rows supply sparse rays; their semantics never come from glyphs.
    The signed API supports both directions; today's rete remains forward-only.
    """
    system = int(opts.primarydir)
    endpoints = ascensional_scene._semantic_endpoints(radix, "primary", opts)
    points = []
    for endpoint in endpoints:
        metadata = endpoint["metadata"]
        display_metadata = {key: metadata[key] for key in (
            "name", "glyph", "glyphFont", "color", "colorRole", "semanticId", "motionRef", "longitude",
        ) if key in metadata}
        point = {"key": endpoint["key"], "kind": endpoint["kind"], "metadata": display_metadata}
        try:
            lon, lat, _ra, _decl = mundane_points._coordinates(radix, endpoint)
            point.update(_pair(radix, lon, lat, signed_arc, system, projection))
        except (ValueError, AttributeError, KeyError, IndexError, TypeError):
            point["capability"] = _capability("missing-source-coordinates")
        point["capabilities"] = {
            "actualMotion": _capability(None if "actual" in point else "missing-source-coordinates"),
            "reprojection": point.pop("capability"),
            "aspectRay": _capability("requires-canonical-direction-row"),
        }
        points.append(point)

    rays = []
    seen = set()
    cusps = native_cusps(radix, opts)
    resolve = _endpoint_resolver(radix, endpoints)
    # Contacts draw from the lead, with their fade strength. Converse rows
    # belong to the converse sky, never to a forward-turned body marker.
    for magnitude, pd in entries:
        strength = pd_contact_strength(float(magnitude) - abs(signed_arc), years_per_degree)
        if strength <= 0.0:
            continue
        if bool(pd.direct) != (signed_arc >= 0):
            continue
        row = _row_rays(radix, opts, resolve, pd, signed_arc, system, projection, cusps, seen)
        row["strength"] = strength
        rays.append(row)
    supported_ray_keys = {ray.get("key") for event in rays for ray in event["rays"]
                          if ray["capability"]["supported"]}
    for point in points:
        if point["key"] in supported_ray_keys:
            point["capabilities"]["aspectRay"] = _capability()
    ecliptic = []
    for degree in range(0, 361, 3):
        ra, decl, _ = astrology.swe_cotrans(float(degree), 0.0, 1.0, -radix.obl[0])
        ecliptic.append(_xy(radix, ra, decl, projection))
    label = mtexts.typeListDirs[system] if 0 <= system < len(mtexts.typeListDirs) else ""
    return {"system": system, "systemLabel": label,
            "signedArc": signed_arc, "points": points, "events": rays,
            "natalEcliptic": ecliptic, "natalSigns": _natal_signs(radix, opts, projection)}


_DISPLAY_METADATA = ("name", "glyph", "glyphFont", "color", "colorRole", "semanticId", "motionRef", "longitude")


def _endpoint_resolver(radix, endpoints):
    """Memoized PD id -> semantic endpoint; a table names few distinct points."""
    memo = {}

    def resolve(point_id, dynamic_key):
        identity = (point_id, dynamic_key)
        if identity not in memo:
            memo[identity] = _endpoint_for_pd(radix, endpoints, point_id, dynamic_key)
        return memo[identity]
    return resolve


def _row_reason(pd, system):
    if pd.mundane:
        return "mundane-row-has-no-zodiacal-ray"
    if int(pd.prom2) != primdirs.PrimDir.NONE:
        return "compound-promissor-has-no-single-ray"
    if getattr(pd, "system", system) != system:
        return "system-mismatch"
    return None


def _row_rays(radix, opts, resolve, pd, signed_arc, system, projection, cusps, seen):
    """One canonical row's promissor ray (turned) and significator ray (natal)."""
    row = {"arc": float(pd.arc), "direct": bool(pd.direct), "rays": []}
    reason = _row_reason(pd, system)
    if reason:
        row["capability"] = _capability(reason)
        return row
    significator = None
    sig_endpoint = resolve(pd.sig, getattr(pd, "sigdyn", None))
    if sig_endpoint is not None:
        try:
            significator = _ray(radix, opts, sig_endpoint, pd, False, cusps)[:2]
        except (ValueError, AttributeError, TypeError, KeyError, IndexError):
            significator = None
    for promissor in (True, False):
        point_id = pd.prom if promissor else pd.sig
        endpoint = resolve(point_id, getattr(pd, "promdyn" if promissor else "sigdyn", None))
        role = "promissor" if promissor else "significator"
        ray = {"role": role}
        if endpoint is None:
            ray["capability"] = _capability("point-outside-semantic-registry")
        else:
            # Rays dedupe across rows; the row itself always names both ends.
            row[role] = endpoint["key"]
            ray.update(key=endpoint["key"], metadata={key: endpoint["metadata"][key]
                                                      for key in _DISPLAY_METADATA if key in endpoint["metadata"]})
            try:
                ref = endpoint["metadata"].get("motionRef") or {}
                if promissor and ref.get("bodyId") == astrology.SE_MOON and getattr(opts, "pdsecmotion", False):
                    raise ValueError("moon-secondary-motion")
                lon, lat, aspect, offset, construction = _ray(radix, opts, endpoint, pd, promissor, cusps)
                ray.update(aspect=aspect, offset=offset, construction=construction,
                           sourceLongitude=lon, sourceLatitude=lat,
                           aspectGlyph=common_aspect_glyph(aspect), **_aspect_ink(opts, aspect))
                ray.update(_pair(radix, lon, lat, signed_arc if promissor else 0.0, system, projection))
                if significator is not None and "representative" in ray:
                    remaining = 0.0 if not promissor else pd_row_geometry.evaluate_ecliptic_point_arc(
                        system, radix, ray["actual"]["longitude"], ray["actual"]["latitude"], *significator)
                    _on_significator_circle(radix, ray, significator, remaining, system, projection)
                if promissor and aspect != chart.Chart.CONJUNCTIO and "representative" in ray:
                    arc = _promissor_aspect_arc(radix, opts, endpoint, cusps, signed_arc, system, projection,
                                                ray["representative"]["longitude"], offset)
                    if arc:
                        ray["aspectArc"] = arc
            except (ValueError, AttributeError, TypeError, KeyError, IndexError) as error:
                ray["capability"] = _capability(str(error) if isinstance(error, ValueError) else "missing-source-coordinates")
        identity = (role, endpoint["key"] if endpoint else point_id, ray.get("offset"))
        if identity not in seen:
            row["rays"].append(ray)
            seen.add(identity)
    row["capability"] = _capability()
    return row


def _promissor_aspect_arc(radix, opts, endpoint, cusps, signed_arc, system, projection, end, offset):
    """A promissor aspect as it lies on the natal ecliptic: from the turned
    promissor's own conjunction representative to its aspect representative,
    the aspect's signed way round. At the row's arc the far end meets the
    significator, so the arc spans promissor to significator. Primary motion
    need not keep the nominal width; ``span`` reports the real one."""
    try:
        lon, lat, _aspect, _offset, _construction = _ray_point(
            radix, opts, endpoint, chart.Chart.CONJUNCTIO, 0.0, True, cusps)
        foot = _pair(radix, lon, lat, signed_arc, system, projection)
    except (ValueError, AttributeError, TypeError, KeyError, IndexError):
        return None
    if "representative" not in foot:
        return None
    return _ring_arc(radix, foot["representative"]["longitude"], end, offset, projection)


def _ring_arc(radix, start, end, offset, projection, step=2.0):
    """Samples of the fixed natal ecliptic from ``start`` to ``end`` (chart
    zodiac), going the way the signed aspect ``offset`` points."""
    span = (end - start) % 360.0 if offset >= 0 else -((start - end) % 360.0)
    count = max(2, math.ceil(abs(span) / step))
    try:
        points = []
        for k in range(count + 1):
            place = _ecliptic_place(radix, start + span * k / count, projection)
            points.append({"x": place["x"], "y": place["y"]})
    except ValueError:
        return None
    return {"start": util.normalize(start), "end": util.normalize(end), "span": span, "points": points}


def build_significators(radix, opts, entries, projection):
    """Static PD targets on the natal ring, resolved from the canonical rows.

    The significator universe is what the engine actually directs to: every
    zodiacal row of the selected system names its significator and, for
    significator-aspect rows, the signed aspect point. Each mark sits at that
    target's own representative (arc 0), so a promissor diamond meeting a mark
    is the row's exact contact under every latitude setting. House cusps are
    the PD system's own cusps. Arc-independent: callers cache this per table.
    """
    system = int(opts.primarydir)
    endpoints = ascensional_scene._semantic_endpoints(radix, "primary", opts)
    resolve = _endpoint_resolver(radix, endpoints)
    cusps = native_cusps(radix, opts)
    targets = {}
    for _magnitude, pd in entries:
        if _row_reason(pd, system) == "mundane-row-has-no-zodiacal-ray" or getattr(pd, "system", system) != system:
            continue
        endpoint = resolve(pd.sig, getattr(pd, "sigdyn", None))
        if endpoint is None:
            continue
        target = targets.get(endpoint["key"])
        if target is None:
            target = targets[endpoint["key"]] = {
                "key": endpoint["key"], "kind": endpoint["kind"],
                "metadata": {key: endpoint["metadata"][key] for key in _DISPLAY_METADATA if key in endpoint["metadata"]},
                "endpoint": endpoint, "aspects": {},
            }
        aspect, offset = int(pd.sigasp), getattr(pd, "sigasp_offset", None)
        if aspect != chart.Chart.CONJUNCTIO:
            target["aspects"].setdefault((aspect, None if offset is None else float(offset)), None)
    out = []
    for target in targets.values():
        endpoint = target.pop("endpoint")
        marks = target.pop("aspects")
        target.update(_target_mark(radix, opts, endpoint, chart.Chart.CONJUNCTIO, 0.0, cusps, system, projection))
        target["aspects"] = []
        for aspect, offset in sorted(marks, key=lambda item: (item[0], item[1] or 0.0)):
            mark = {"aspect": aspect, "offset": offset, "aspectGlyph": common_aspect_glyph(aspect),
                    **_aspect_ink(opts, aspect)}
            mark.update(_target_mark(radix, opts, endpoint, aspect, offset, cusps, system, projection))
            if "mark" in mark and "mark" in target and offset is not None:
                # The significator aspect itself, from its mark to the aspect point.
                arc = _ring_arc(radix, target["mark"]["longitude"], mark["mark"]["longitude"], offset, projection)
                if arc:
                    mark["arc"] = arc
            target["aspects"].append(mark)
        out.append(target)
    return out


def _target_mark(radix, opts, endpoint, aspect, offset, cusps, system, projection):
    try:
        lon, lat, _aspect, _offset, construction = _ray_point(
            radix, opts, endpoint, aspect, offset, False, cusps)
        foot = _on_significator_circle(
            radix, _pair(radix, lon, lat, 0.0, system, projection), (lon, lat), 0.0, system, projection)
    except (ValueError, AttributeError, TypeError, KeyError, IndexError) as error:
        return {"capability": _capability(str(error) if isinstance(error, ValueError) else "missing-source-coordinates")}
    if "representative" not in foot:
        return {"capability": foot["capability"]}
    longitude = foot["representative"]["longitude"]
    return {"construction": construction, "capability": _capability(),
            "mark": {**_ecliptic_place(radix, longitude, projection), "longitude": longitude,
                     "position": foot["representative"]["position"]}}


def build_focus(radix, opts, entries, key, signed_arc, projection, years_per_degree, contacts=FOCUS_CONTACTS):
    """The focused significator's nearest canonical contacts.

    Of its direct rows from the lead behind the rete onward, the ``contacts``
    nearest the current arc, each with its fade strength (0 beyond the lead;
    the renderer keeps focused contacts faintly visible). Under promissor
    aspects each row's promissor ray carries its own signed aspect and arc.
    """
    system = int(opts.primarydir)
    endpoints = ascensional_scene._semantic_endpoints(radix, "primary", opts)
    resolve = _endpoint_resolver(radix, endpoints)
    cusps = native_cusps(radix, opts)
    current = abs(signed_arc)
    start = current - pd_lead_arc(years_per_degree)
    rows, ahead = [], 0
    for magnitude, pd in sorted(entries, key=lambda item: float(item[0])):
        if not pd.direct or float(magnitude) < start or _row_reason(pd, system) is not None:
            continue
        endpoint = resolve(pd.sig, getattr(pd, "sigdyn", None))
        if endpoint is not None and endpoint["key"] == key:
            rows.append((float(magnitude), pd))
            # Any later row is farther than these upcoming ones.
            ahead += float(magnitude) > current
            if ahead == contacts:
                break
    nearest = sorted(sorted(rows, key=lambda item: abs(item[0] - current))[:contacts], key=lambda item: item[0])
    events, seen = [], set()
    for magnitude, pd in nearest:
        row = _row_rays(radix, opts, resolve, pd, signed_arc, system, projection, cusps, seen)
        row["strength"] = pd_contact_strength(magnitude - current, years_per_degree)
        events.append(row)
    return {"key": key, "contacts": contacts, "events": events}


def _ecliptic_place(radix, lon, projection):
    """A chart-zodiac degree on the fixed natal ecliptic, with its unit tangent
    (increasing longitude) for marks drawn across the path."""
    def at(value):
        ra, decl, _ = astrology.swe_cotrans(
            util.to_tropical_lon(value, getattr(radix, "ayanamsha_offset", 0.0)),
            0.0, 1.0, -radix.obl[0],
        )
        point = _xy(radix, ra, decl, projection)
        return point["x"], point["y"]

    x, y = at(lon)
    (bx, by), (ax, ay) = at(lon - 0.25), at(lon + 0.25)
    d = math.hypot(ax - bx, ay - by) or 1.0
    return {"x": x, "y": y, "tx": (ax - bx) / d, "ty": (ay - by) / d}


def _natal_signs(radix, opts, projection):
    """Chart-zodiac sign starts and middles on the natal ecliptic.

    Like the circle itself these belong to the plate: the radix frame stays
    where birth left it while the rete turns past. Sidereal charts keep their
    own sign boundaries.
    """
    import common

    glyphs = common.common.Signs1 if getattr(opts, "signs", True) else common.common.Signs2
    return [{"sign": sign, "glyph": glyphs[sign],
             "start": _ecliptic_place(radix, sign * 30.0, projection),
             "middle": _ecliptic_place(radix, sign * 30.0 + 15.0, projection)} for sign in range(12)]


def _aspect_ink(opts, aspect):
    """The theme's aspect colour, as the aspect list sends it: role first,
    the resolved value as the fallback."""
    try:
        value = opts.clraspect[int(aspect)]
    except (AttributeError, IndexError, TypeError, ValueError):
        value = getattr(opts, "clrtexts", None)
    try:
        r, g, b = list(value)[:3]
        color = "#%02x%02x%02x" % tuple(max(0, min(255, int(c))) for c in (r, g, b))
    except (TypeError, ValueError):
        color = None
    return {"aspectColor": color, "aspectColorRole": aspect_color_role(opts, aspect, resolved_color=value)}


def common_aspect_glyph(aspect):
    import common
    return common.common.Aspects[aspect]
