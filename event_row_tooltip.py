# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

# event_row_tooltip.py
#
# Verbose hover-tooltip text for "event list" rows across Aries:
# search results, primary-directions list, secondary-directions list, and
# any other window where the user sees abbreviated planet/aspect glyphs
# and wants to read them as words ("Sun square Moon" instead of a small
# square symbol).
#
# All names come from the engine's canonical sources:
#   - mtexts.txts / mtexts.signs for planet, sign, angle, cusp, aspect
#     labels (already localized for the user's language)
#   - SearchObject.label for search-result rows (catalog has done the
#     work of resolving id → human label, including custom points)
#   - primdirs.PrimDir constants for the integer ranges that pack
#     promittor/significator/aspect-of-promittor/aspect-of-significator
#     into single ints
#
# This module never calls Swiss Eph (`swe_get_planet_name`) — that returns
# weird strings like "Mean Apogee" for values that primdirs uses for
# angles/cusps. Instead, every range is partitioned correctly using
# `primdirs.PrimDir.*` boundaries.

import chart
import mtexts
import primdirs
import searchquery


# ---------------------------------------------------------------------------
# Aspect words
# ---------------------------------------------------------------------------
#
# Aspects arrive in two encodings depending on the caller:
#
#   1. `chart.Chart.*` integer constants — used by primdirs (pd.promasp /
#      pd.sigasp) and by every other chart-level code path.
#   2. `searchquery.SearchQuery.ASPECT_*` string ids — used by
#      `SearchResult.aspect` in search/secondary-direction rows.
#
# `_ASPECT_TEXT_KEY` maps the integer encoding to an `mtexts.txts` key.
# `aspect_word` looks up the localized label, lower-cases it for natural
# sentence flow ("Sun square Moon", not "Sun Square Moon"), and falls
# through to the SearchQuery string ids — those are already lower-case
# English words ("conjunction", "square", ...) so we use them directly.

_ASPECT_TEXT_KEY = {
    chart.Chart.CONJUNCTIO:    'Conjunctio',
    chart.Chart.SEMISEXTIL:    'Semisextil',
    chart.Chart.SEMIQUADRAT:   'Semiquadrat',
    chart.Chart.SEXTIL:        'Sextil',
    chart.Chart.QUINTILE:      'Quintile',
    chart.Chart.QUADRAT:       'Quadrat',
    chart.Chart.TRIGON:        'Trigon',
    chart.Chart.SESQUIQUADRAT: 'Sesquiquadrat',
    chart.Chart.BIQUINTILE:    'Biquintile',
    chart.Chart.QUINQUNX:      'Quinqunx',
    chart.Chart.OPPOSITIO:     'Oppositio',
    chart.Chart.SEPTILE:       'Septile',
    chart.Chart.PARALLEL:      'Parallel',
    chart.Chart.CONTRAPARALLEL: 'Contraparallel',
    # RAPTPAR / RAPTCONTRAPAR / MIDPOINT don't have a single-word mtexts
    # entry — render as multi-word phrases in build_pd_row_tooltip().
}


def aspect_word(aspect_value):
    """Lower-case localised name for an aspect, accepting either the
    chart integer constant or the SearchQuery string id. Returns '' when
    the value is unknown so callers can choose a different sentence form
    (e.g. station/sign-change) instead of emitting a meaningless filler."""
    if aspect_value is None:
        return ''
    # SearchQuery string ids — resolve to the localized aspect word at
    # serve time (lower-cased for natural sentence flow).
    if isinstance(aspect_value, str):
        key = _SEARCH_ASPECT_KEYS.get(aspect_value)
        if key is None:
            return ''
        label = mtexts.txts.get(key, '')
        return label.lower() if label else ''
    # chart.Chart.* integer constants — look up mtexts key, lower-case
    key = _ASPECT_TEXT_KEY.get(aspect_value)
    if key is None:
        return ''
    label = mtexts.txts.get(key, '')
    return label.lower() if label else ''


# Search aspect ids that are real planet-to-planet aspects (i.e., share
# a meaning with one of the chart integers above). The four "event" ids
# (sign_change, station_*) get a totally different sentence and live in
# _SEARCH_EVENT_KEYS. Values here are mtexts keys resolved at serve time
# by aspect_word() so the aspect word renders in the user's language.
_SEARCH_ASPECT_KEYS = {
    searchquery.SearchQuery.ASPECT_CONJUNCTION: 'Conjunctio',
    searchquery.SearchQuery.ASPECT_SEXTILE:     'Sextil',
    searchquery.SearchQuery.ASPECT_SQUARE:      'Quadrat',
    searchquery.SearchQuery.ASPECT_TRINE:       'Trigon',
    searchquery.SearchQuery.ASPECT_QUINCUNX:    'Quinqunx',
    searchquery.SearchQuery.ASPECT_OPPOSITION:  'Oppositio',
}

# Non-aspect "event" ids → (mtexts key, English fallback) for the verb
# phrase. The dict keys are logic ids (membership-tested); the verb text
# is resolved at serve time in build_search_result_tooltip().
_SEARCH_EVENT_KEYS = {
    searchquery.SearchQuery.ASPECT_SIGN_CHANGE:        ('EventEntersSign', 'enters sign'),
    searchquery.SearchQuery.ASPECT_STATION_RETROGRADE: ('EventStationsRetrograde', 'stations retrograde'),
    searchquery.SearchQuery.ASPECT_STATION_DIRECT:     ('EventStationsDirect', 'stations direct'),
    searchquery.SearchQuery.ASPECT_STATION:            ('EventStations', 'stations'),
}


# ---------------------------------------------------------------------------
# Planet / point name lookups
# ---------------------------------------------------------------------------
#
# Engine convention: planet indices 0..PLANETS_NUM-1 map onto Swiss Eph's
# SE_SUN..SE_TRUE_NODE (with Aries appending SOUTH_NODE at index 11).
# Beyond PLANETS_NUM the integers are used for PD-specific points
# (angles, cusps, Lot of Fortune, syzygy, antiscia, terms, fixstars) and
# must NOT be passed to Swiss Eph — `swe_get_planet_name` would return
# unrelated strings like "Mean Apogee" because Swiss Eph uses different
# values past SE_TRUE_NODE.

_PLANET_TEXT_KEYS = (
    'Sun', 'Moon', 'Mercury', 'Venus', 'Mars',
    'Jupiter', 'Saturn', 'Uranus', 'Neptune', 'Pluto',
    'AscNode', 'DescNode',
)


def planet_name(planet_index):
    """Localised name for a Swiss Eph planet index (0..11). Returns ''
    for out-of-range so callers can decide on the fallback."""
    try:
        idx = int(planet_index)
    except Exception:
        return ''
    if 0 <= idx < len(_PLANET_TEXT_KEYS):
        return mtexts.txts.get(_PLANET_TEXT_KEYS[idx], _PLANET_TEXT_KEYS[idx])
    # Chiron / asteroids / fictionals come through with much higher ids
    # — defer to common.common only after we've confirmed we're not in
    # the PD-overlay range (callers handle that before us).
    try:
        import common
        return common.common.get_planet_name(idx)
    except Exception:
        return ''


def _cusp_label(hc_offset):
    """Localised label for a non-angle house cusp (HC2..HC12). hc_offset
    is the offset within (HC2, HC3, HC5, HC6, HC8, HC9, HC11, HC12)."""
    cusp_keys = ('HC2', 'HC3', 'HC5', 'HC6', 'HC8', 'HC9', 'HC11', 'HC12')
    if 0 <= hc_offset < len(cusp_keys):
        return mtexts.txts.get(cusp_keys[hc_offset], cusp_keys[hc_offset])
    return ''


# ---------------------------------------------------------------------------
# Catalog lookup (search-result rows)
# ---------------------------------------------------------------------------

def _catalog_label(catalog, obj_id, fallback=''):
    """Return the catalog's pre-formatted label for obj_id, falling back
    to `fallback` then to obj_id itself. The catalog already calls
    mtexts.txts for built-in points and uses the user's chosen part name
    / custom-point label everywhere else."""
    if catalog is not None and obj_id:
        try:
            obj = catalog.get(obj_id)
        except Exception:
            obj = None
        label = getattr(obj, 'label', '') if obj is not None else ''
        if label:
            return label
    return fallback or obj_id or ''


# ---------------------------------------------------------------------------
# Search results
# ---------------------------------------------------------------------------

def build_search_result_tooltip(row, catalog=None):
    """Verbose label for a searchquery.SearchResult row.

    Examples
        "Sun square Moon"
        "Mars sextile Lot of Fortune"
        "Mars stations retrograde"
        "Sun enters Aries"
    """
    if row is None:
        return ''

    prom = _catalog_label(catalog,
                          getattr(row, 'promittor_id', ''),
                          getattr(row, 'promittor_label', ''))
    sig  = _catalog_label(catalog,
                          getattr(row, 'significator_id', ''),
                          getattr(row, 'significator_label', ''))

    aspect_val = getattr(row, 'aspect', None)

    # Event-style sentences (stations, sign changes) have no significator.
    if aspect_val in _SEARCH_EVENT_KEYS:
        if aspect_val == searchquery.SearchQuery.ASPECT_SIGN_CHANGE and sig:
            # Mundane weather sweeps encode sig_label as "Cancer|Leo" —
            # the right side is the destination sign.
            return mtexts.txts.get('EntersSignTemplate', '%s enters %s') % (
                prom, sig.split('|', 1)[-1])
        vkey, vfallback = _SEARCH_EVENT_KEYS[aspect_val]
        verb = mtexts.txts.get(vkey, vfallback)
        return '%s %s' % (prom, verb)

    aspect = aspect_word(aspect_val)
    if not aspect:
        # Last resort — show the raw aspect identifier so a future bug
        # surfaces immediately instead of being silently mangled.
        aspect = str(aspect_val) if aspect_val not in (None, '') else ''
    return ' '.join(p for p in (prom, aspect, sig) if p)


# ---------------------------------------------------------------------------
# Primary directions list
# ---------------------------------------------------------------------------

_PD = primdirs.PrimDir
_OFFSANGLES = _PD.OFFSANGLES  # = Planets.PLANETS_NUM (12) — boundary
                              # between "real planet index" and the
                              # cascade of PD-specific point ranges.


def _pd_point_name(value, is_promittor, pd, chrt):
    """Verbose label for a single PrimDir prom/sig index. Mirrors the
    branches in primdirslistwnd._build_prom / _build_sig exactly so the
    tooltip text always matches the row glyphs."""
    if value is None or value == _PD.NONE:
        return ''
    try:
        v = int(value)
    except Exception:
        return ''

    # Planet range — strict bounds 0..PLANETS_NUM-1. Anything at or above
    # OFFSANGLES is a PD-specific point and must not be treated as a planet.
    if 0 <= v < _OFFSANGLES:
        return planet_name(v)

    # Specific angle / point constants.
    if v == _PD.ASC:
        return mtexts.txts.get('Asc', 'Asc')
    if v == _PD.DESC:
        return mtexts.txts.get('Dsc', 'Dsc')
    if v == _PD.MC:
        return mtexts.txts.get('MC', 'MC')
    if v == _PD.IC:
        return mtexts.txts.get('IC', 'IC')

    if v == _PD.LOF:
        return mtexts.txts.get('LoF', 'Fortuna')
    if v == _PD.SYZ:
        return mtexts.txts.get('Syzygy', 'Syzygy')
    if v == _PD.CUSTOMERPD:
        # Dynamic user point — defer to the per-window helper, which
        # knows about user/customer/chiron variants.
        try:
            from primdirslistwnd import _pd_dynamic_point_label
            kind = getattr(pd, 'promdyn' if is_promittor else 'sigdyn', None)
            text = _pd_dynamic_point_label(chrt, kind, is_promittor) if chrt is not None else ''
            return text or mtexts.txts.get('CustomPoint', 'Custom point')
        except Exception:
            return mtexts.txts.get('CustomPoint', 'Custom point')

    # House cusps HC2..HC12 — packed contiguously between IC and LOF.
    if _PD.HC2 <= v < _PD.LOF:
        return _cusp_label(v - _PD.HC2)

    # Antiscion / contra-antiscion range — value - offset = source body.
    if _PD.ANTISCION <= v < _PD.TERM:
        is_contra = v >= _PD.CONTRAANT
        prefix = (mtexts.txts.get('ContraAntiscion', 'Contra-antiscion')
                  if is_contra else mtexts.txts.get('Antiscion', 'Antiscion'))
        of_tmpl = mtexts.txts.get('OfConnector', '%s of %s')
        if v == _PD.ANTISCIONLOF or v == _PD.CONTRAANTLOF:
            return of_tmpl % (prefix, mtexts.txts.get('LoF', 'Fortuna'))
        if v == _PD.ANTISCIONASC or v == _PD.CONTRAANTASC:
            return of_tmpl % (prefix, mtexts.txts.get('Asc', 'Asc'))
        if v == _PD.ANTISCIONMC or v == _PD.CONTRAANTMC:
            return of_tmpl % (prefix, mtexts.txts.get('MC', 'MC'))
        offset = _PD.CONTRAANT if is_contra else _PD.ANTISCION
        return of_tmpl % (prefix, planet_name(v - offset))

    # Term range — value - TERM = sign index. The lord lives on pd.prom2.
    if _PD.TERM <= v < _PD.FIXSTAR:
        sign_idx = v - _PD.TERM
        try:
            sign_name = mtexts.signs[sign_idx]
        except Exception:
            sign_name = 'sign %d' % sign_idx
        if is_promittor and pd is not None:
            lord = planet_name(getattr(pd, 'prom2', _PD.NONE))
            if lord:
                return mtexts.txts.get('TermOfLordInSign', 'Term of %s in %s') % (lord, sign_name)
        return mtexts.txts.get('TermInSign', 'Term in %s') % sign_name

    # Fixed star — value - FIXSTAR = star index into chart.fixstars.
    if v >= _PD.FIXSTAR:
        if chrt is None:
            return mtexts.txts.get('Fixed star', 'Fixed star')
        try:
            from fixstars import FixStars
            star_idx = v - _PD.FIXSTAR
            raw = chrt.fixstars.data[star_idx][FixStars.NAME]
            return (raw or '').strip() or mtexts.txts.get('Fixed star', 'Fixed star')
        except Exception:
            return mtexts.txts.get('Fixed star', 'Fixed star')

    return ''


def _parallel_axis_label(parallelaxis):
    """Return the angle name for an axis offset, '' if not on an axis."""
    if not parallelaxis:
        return ''
    angle_keys = ('Asc', 'Dsc', 'MC', 'IC')
    idx = parallelaxis - _OFFSANGLES
    if 0 <= idx < len(angle_keys):
        return mtexts.txts.get(angle_keys[idx], angle_keys[idx])
    return ''


def build_pd_row_tooltip(pd, chrt=None):
    """Verbose label for a primdirs.PrimDir row. Pure "<prom> <aspect>
    <sig>" — no mode/direction suffix; the M/Z and D/C columns already
    show that.

    Aspect-field encoding (matches primdirslistwnd._build_prom and
    _build_sig branches): a PD row can carry the aspect on either
    `pd.promasp` (read as "aspect of <prom> reaches <sig>") or
    `pd.sigasp` (read as "<prom> reaches aspect of <sig>"). When BOTH
    are CONJUNCTIO the direction is a body-to-body hit. Parallels,
    rapt parallels, and midpoint promissors are special and handled
    first.
    """
    if pd is None:
        return ''

    # Parallels and contra-parallels — sigasp carries the kind, sig
    # carries the body, parallelaxis (if set) names an angle axis.
    if pd.sigasp == chart.Chart.PARALLEL or pd.sigasp == chart.Chart.CONTRAPARALLEL:
        prom_name = _pd_point_name(pd.prom, True, pd, chrt)
        sig_name = _pd_point_name(pd.sig, False, pd, chrt)
        aspect = aspect_word(pd.sigasp)  # uses mtexts: "parallel" / "contraparallel"
        axis = _parallel_axis_label(getattr(pd, 'parallelaxis', 0))
        suffix = mtexts.txts.get('AxisSuffix', ' (%s axis)') % axis if axis else ''
        return '%s %s %s%s' % (prom_name, aspect, sig_name, suffix)

    # Rapt parallel / rapt contra-parallel — render as the phrase that
    # matches the column header (reuse the RaptParallel label, lower-cased).
    if pd.sigasp == chart.Chart.RAPTPAR or pd.sigasp == chart.Chart.RAPTCONTRAPAR:
        prom_name = _pd_point_name(pd.prom, True, pd, chrt)
        sig_name = _pd_point_name(pd.sig, False, pd, chrt)
        if pd.sigasp == chart.Chart.RAPTPAR:
            aspect = mtexts.txts.get('RaptParallel', 'Rapt Parallel').lower()
        else:
            aspect = mtexts.txts.get('RaptContraParallel', 'Rapt Contra-Parallel').lower()
        axis = _parallel_axis_label(getattr(pd, 'parallelaxis', 0))
        suffix = mtexts.txts.get('AxisSuffix', ' (%s axis)') % axis if axis else ''
        return '%s %s %s%s' % (prom_name, aspect, sig_name, suffix)

    # Midpoint promissor: prom + prom2 form the pair.
    if pd.promasp == chart.Chart.MIDPOINT:
        prom_name = planet_name(pd.prom)
        prom2_name = planet_name(getattr(pd, 'prom2', _PD.NONE))
        sig_name = _pd_point_name(pd.sig, False, pd, chrt)
        return mtexts.txts.get(
            'MidpointConjunction', 'Midpoint of %s and %s conjunction %s') % (
            prom_name, prom2_name, sig_name)

    # Default: interplanetary or to-angle/cusp. Pick the aspect from
    # whichever side is non-CONJUNCTIO (promasp wins to match the
    # display priority in _build_prom), fall back to "conjunction".
    prom_name = _pd_point_name(pd.prom, True, pd, chrt)
    sig_name = _pd_point_name(pd.sig, False, pd, chrt)
    promasp = getattr(pd, 'promasp', chart.Chart.CONJUNCTIO)
    sigasp = getattr(pd, 'sigasp', chart.Chart.CONJUNCTIO)
    if promasp not in (None, _PD.NONE, chart.Chart.CONJUNCTIO):
        aspect = aspect_word(promasp)
    elif sigasp not in (None, _PD.NONE, chart.Chart.CONJUNCTIO):
        aspect = aspect_word(sigasp)
    else:
        aspect = aspect_word(chart.Chart.CONJUNCTIO)
    if not aspect:
        aspect = mtexts.txts.get('Aspect', 'Aspect').lower()
    return '%s %s %s' % (prom_name, aspect, sig_name)


# ---------------------------------------------------------------------------
# Secondary directions list
# ---------------------------------------------------------------------------

def build_secondary_row_tooltip(row, catalog=None):
    """Verbose label for a SecDirsListWnd row. The rows are produced by
    the same `searchbackend` pipeline (TECHNIQUE_SECONDARY_DIRECTIONS),
    so the field layout is identical to a SearchResult — delegate."""
    if row is None:
        return ''
    if hasattr(row, 'promittor_id') and hasattr(row, 'aspect') and hasattr(row, 'significator_id'):
        return build_search_result_tooltip(row, catalog=catalog)
    return ''
