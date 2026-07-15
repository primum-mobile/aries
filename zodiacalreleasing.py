# -*- coding: utf-8 -*-
"""
Zodiacal Releasing engine.

Weights (Aries..Pisces): 15, 8, 20, 25, 19, 20, 8, 15, 12, 27, 30, 12
Level base units:
  L1 = 360 days  x weight       (years per sign)
  L2 = 30  days  x weight       (months per sign)
  L3 = 2.5 days  x weight       (== 60 hours x weight)
  L4 = 5   hours x weight

Loosing of the Bond (LoB) on L2/L3/L4:
  Each sublevel starts from parent_start_sign and proceeds in zodiacal order;
  at the first moment it would re-enter parent_start_sign, jump to its
  opposite, then continue naturally from there (one-time jump per chain).
  Durations are unchanged.

Releaser resolution:
  resolve_releaser_sign(chart, options, token) returns (sign_idx, label_text).
  v1 tokens: 'spirit' (Daimon, sect-mirror of Fortune about ASC),
             'fortune' (chart.fortune longitude),
             'sign'    (explicit override via options.zr_start_sign),
             'arabic_part:<name>' (computed current Arabic Part by name).
  Spirit-Fortune same-sign shift (Valens / Brennan): when on, Spirit is
  advanced one sign whenever its natal sign coincides with Fortune's.

Row enrichment:
  Each row dict carries: level, sign, start, end, ruler (SE_<planet>),
  is_peak/peak_kind (sign angular to natal Fortune: 1/4/7/10),
  is_culmination (10th from natal Fortune), is_completion (post-LoB
  return to the parent sign), is_lob (the post-jump row in the chain).
"""
from __future__ import division
import datetime
import mtexts

# 0..11 = Aries..Pisces
def sign_names():
    """Localized sign names resolved at SERVE time.

    mtexts.setLang() rebinds mtexts.txts per active language, so this MUST be
    called when the payload is assembled, never captured at module import
    (an import-time list would freeze whatever language was active at load).
    """
    t = mtexts.txts
    return [t['Aries'], t['Taurus'], t['Gemini'], t['Cancer'], t['Leo'], t['Virgo'],
            t['Libra'], t['Scorpio'], t['Sagittarius'], t['Capricornus'], t['Aquarius'], t['Pisces']]

WEIGHTS = [15, 8, 20, 25, 19, 20, 8, 15, 12, 27, 30, 12]

# Domicile rulers per sign (SE_* planet ids 0..6, Sun..Saturn).
# Matches chart.py default_domicile_rulers and the traditional 7-planet scheme.
DOMICILE_RULERS = (4, 3, 2, 1, 0, 2, 3, 4, 5, 6, 6, 5)

L1_BASE_DAYS = 360.0
L2_BASE_DAYS = 30.0
L3_BASE_HRS  = 60.0   # 2.5 days
L4_BASE_HRS  = 5.0

# Releaser tokens
RELEASER_SPIRIT  = 'spirit'
RELEASER_FORTUNE = 'fortune'
RELEASER_SIGN    = 'sign'
RELEASER_ARABIC_PART_PREFIX = 'arabic_part:'

VALID_RELEASERS = (RELEASER_SPIRIT, RELEASER_FORTUNE, RELEASER_SIGN)


def next_sign(i): return (i + 1) % 12
def opp(i): return (i + 6) % 12


def _dur(level, sign_idx):
    w = WEIGHTS[sign_idx]
    if level == 1:
        return datetime.timedelta(days=L1_BASE_DAYS * w)
    if level == 2:
        return datetime.timedelta(days=L2_BASE_DAYS * w)
    if level == 3:
        return datetime.timedelta(hours=L3_BASE_HRS * w)
    return datetime.timedelta(hours=L4_BASE_HRS * w)


def _enrich(level, sgn, start, end, peak_sign, is_lob, parent_sign=None, is_completion=False):
    kind = _peak_kind(sgn, peak_sign)
    return {
        'level': level,
        'sign': sgn,
        'start': start,
        'end': end,
        'ruler': DOMICILE_RULERS[sgn],
        'is_peak': kind is not None,
        'peak_kind': kind,
        'is_culmination': _is_culmination(sgn, peak_sign),
        'is_completion': bool(is_completion),
        'peak_sign': None if peak_sign is None else int(peak_sign) % 12,
        'is_lob': bool(is_lob),
        'parent_sign': parent_sign,    # sign of the immediate parent level (L1 for L2, L2 for L3, L3 for L4); None for L1 itself
    }


def _peak_offset(sgn, peak_sign):
    if peak_sign is None:
        return None
    fs = int(peak_sign) % 12
    s = int(sgn) % 12
    return (s - fs) % 12


def _peak_kind(sgn, peak_sign):
    offset = _peak_offset(sgn, peak_sign)
    if offset is None:
        return None
    if offset == 0 or offset == 9:
        return 'major'
    if offset == 6:
        return 'moderate'
    if offset == 3:
        return 'minor'
    return None


def _is_peak(sgn, peak_sign):
    return _peak_kind(sgn, peak_sign) is not None


def _is_culmination(sgn, peak_sign):
    return _peak_offset(sgn, peak_sign) == 9


def _peak_reference(start_sign_idx, releaser_sign=None, peak_sign=None):
    if peak_sign is not None:
        return int(peak_sign) % 12
    if releaser_sign is not None:
        return int(releaser_sign) % 12
    return int(start_sign_idx) % 12


def _stream_sublevel(parent_start, parent_end, parent_start_sign, level, peak_sign):
    """
    Generate L(level) rows inside [parent_start, parent_end].
    LoB: one-time jump when next sign would be parent_start_sign.
    The post-jump row carries is_lob=True. Rows may be truncated at parent_end.
    Each row records parent_sign = parent_start_sign so the UI can identify
    rows that visually repeat their parent (first sub-period of every chain).
    """
    rows = []
    t = parent_start
    sgn = parent_start_sign
    lob_done = False
    next_is_lob = False  # true when the row we are about to emit IS the LoB jump landing

    while t < parent_end:
        dur = _dur(level, sgn)
        e = t + dur
        if e > parent_end:
            e = parent_end

        is_completion = bool(lob_done and sgn == parent_start_sign)
        rows.append(_enrich(
            level,
            sgn,
            t,
            e,
            peak_sign,
            is_lob=next_is_lob,
            parent_sign=parent_start_sign,
            is_completion=is_completion,
        ))
        next_is_lob = False

        # advance time and sign
        t = e
        nxt = next_sign(sgn)
        if (not lob_done) and nxt == parent_start_sign:
            sgn = opp(parent_start_sign)
            lob_done = True
            next_is_lob = True  # the next emitted row is the LoB landing
        else:
            sgn = nxt

        if t >= parent_end:
            break
    return rows


def build_main(start_dt, start_sign_idx, releaser_sign=None, years_horizon=150, *, peak_sign=None):
    """
    Build main table rows: interleaved L1 + L2 (L2 within each L1 interval).
    Returns a list of rows with 'level' in {1,2}. Canonical ZR callers pass
    natal Fortune as peak_sign; releaser_sign remains as the backward-compatible
    fallback for old sequence-only callers.
    """
    peak_ref = _peak_reference(start_sign_idx, releaser_sign, peak_sign)
    out = []
    t = start_dt
    sgn = start_sign_idx
    acc_years = 0.0
    while acc_years < years_horizon:
        dur = _dur(1, sgn)
        s = t
        e = t + dur
        # L1 rows are never LoB (they are the parent chain).
        out.append(_enrich(1, sgn, s, e, peak_ref, is_lob=False))
        l2_rows = _stream_sublevel(s, e, sgn, level=2, peak_sign=peak_ref)
        out.extend(l2_rows)
        t = e
        acc_years += WEIGHTS[sgn]
        sgn = next_sign(sgn)
    return out


def build_drill(parent_row, releaser_sign=None, *, peak_sign=None):
    """
    Given an L2 row dict, compute L3 + L4 inside it.
    Returns (l3_rows, l4_rows). Canonical ZR callers pass natal Fortune as
    peak_sign; releaser_sign remains as the backward-compatible fallback.
    """
    peak_ref = _peak_reference(parent_row.get('sign'), releaser_sign, peak_sign)
    s = parent_row['start']
    e = parent_row['end']
    parent_start_sign = parent_row['sign']
    l3 = _stream_sublevel(s, e, parent_start_sign, level=3, peak_sign=peak_ref)
    l4 = []
    for r in l3:
        l4.extend(_stream_sublevel(r['start'], r['end'], r['sign'], level=4, peak_sign=peak_ref))
    return (l3, l4)


def fmt_length(row):
    td = row['end'] - row['start']
    secs = td.total_seconds()
    days = secs / 86400.0

    if row['level'] == 1:
        yrs = days / 360.0
        unit = mtexts.txts['Year'] if abs(yrs) == 1 else mtexts.txts['Years']
        return u'%.0f %s' % (yrs, unit)

    if row['level'] == 2:
        total_days = int(round(days))
        months = total_days // 30
        unit = mtexts.txts['Month'] if abs(months) == 1 else mtexts.txts['Months']
        return u'%d %s' % (months, unit)

    if row['level'] in (3, 4):
        unit = mtexts.txts['Day'] if abs(days) == 1 else mtexts.txts['Days']
        return u"%.1f %s" % (days, unit)


def fmt_date(dt):
    # strftime fails for year<1900 on some platforms; format manually.
    return u'%04d.%02d.%02d' % (int(dt.year), int(dt.month), int(dt.day))


# ─────────────────────────── Releaser resolution ───────────────────────────

def _fortune_lon(chart_obj):
    try:
        import fortune as _fortune_mod
        return float(chart_obj.fortune.fortune[_fortune_mod.Fortune.LON]) % 360.0
    except Exception:
        try:
            return float(chart_obj.fortune.fortune[0]) % 360.0
        except Exception:
            return None


def _asc_lon(chart_obj):
    try:
        import houses as _houses_mod
        return float(chart_obj.houses.ascmc[_houses_mod.Houses.ASC]) % 360.0
    except Exception:
        try:
            return float(chart_obj.houses.ascmc[0]) % 360.0
        except Exception:
            return None


def _spirit_lon(chart_obj):
    """Spirit is the sect-mirror of Fortune about the ASC: 2*ASC - Fortune.
    Holds for both day and night Fortune variants because Spirit and Fortune
    are formula-mirrors (ASC + Sun-Moon vs ASC + Moon-Sun, swapping at sect).
    """
    asc = _asc_lon(chart_obj)
    fort = _fortune_lon(chart_obj)
    if asc is None or fort is None:
        return None
    return (2.0 * asc - fort) % 360.0


def _sign_of(lon):
    if lon is None:
        return None
    return int(lon // 30) % 12


def arabic_part_releaser_token(name):
    return RELEASER_ARABIC_PART_PREFIX + str(name or '')


def is_arabic_part_releaser_token(token):
    return (
        isinstance(token, str) and
        token.startswith(RELEASER_ARABIC_PART_PREFIX) and
        bool(token[len(RELEASER_ARABIC_PART_PREFIX):])
    )


def arabic_part_name_from_releaser(token):
    if not is_arabic_part_releaser_token(token):
        return ''
    return token[len(RELEASER_ARABIC_PART_PREFIX):]


def iter_arabic_part_releasers(chart_obj):
    try:
        import arabicparts as _arabicparts
        parts = getattr(getattr(chart_obj, 'parts', None), 'parts', None) or []
        seen = set()
        for part in parts:
            try:
                name = str(part[_arabicparts.ArabicParts.NAME])
                if not name or name in seen:
                    continue
                lon = float(part[_arabicparts.ArabicParts.LONG]) % 360.0
            except Exception:
                continue
            seen.add(name)
            yield {
                'name': name,
                'token': arabic_part_releaser_token(name),
                'lon': lon,
                'sign': _sign_of(lon),
            }
    except Exception:
        return


def _arabic_part_lon(chart_obj, name):
    target = str(name or '')
    if not target:
        return None
    for item in iter_arabic_part_releasers(chart_obj):
        try:
            if item.get('name') == target:
                return float(item.get('lon')) % 360.0
        except Exception:
            continue
    return None


def resolve_peak_sign(chart_obj):
    """Peak periods are keyed to natal Fortune, regardless of releaser."""
    return _sign_of(_fortune_lon(chart_obj))


def resolve_releaser_sign(chart_obj, options, token, *, apply_spirit_shift=True, manual_sign=None):
    """
    Return (sign_idx, label_token) for the chosen releaser.

    label_token is one of: 'spirit', 'spirit_shifted', 'fortune', 'sign'.
    UI uses label_token to decorate the header with the right wording.

    Falls back to RELEASER_SIGN with manual_sign=0 if the chosen lot cannot
    be computed (e.g. no fortune on the chart).
    """
    tok = (token or RELEASER_SPIRIT)
    if tok not in VALID_RELEASERS and not is_arabic_part_releaser_token(tok):
        tok = RELEASER_SPIRIT

    if tok == RELEASER_SIGN:
        sign = int(manual_sign if manual_sign is not None else getattr(options, 'zr_start_sign', 0)) % 12
        return sign, 'sign'

    if is_arabic_part_releaser_token(tok):
        sign = _sign_of(_arabic_part_lon(chart_obj, arabic_part_name_from_releaser(tok)))
        if sign is None:
            return int(getattr(options, 'zr_start_sign', 0)) % 12, 'sign'
        return sign, 'arabic_part'

    if tok == RELEASER_FORTUNE:
        sign = _sign_of(_fortune_lon(chart_obj))
        if sign is None:
            return int(getattr(options, 'zr_start_sign', 0)) % 12, 'sign'
        return sign, 'fortune'

    # Spirit (default)
    spirit_lon = _spirit_lon(chart_obj)
    spirit_sign = _sign_of(spirit_lon)
    if spirit_sign is None:
        return int(getattr(options, 'zr_start_sign', 0)) % 12, 'sign'

    if apply_spirit_shift:
        fortune_sign = _sign_of(_fortune_lon(chart_obj))
        if fortune_sign is not None and spirit_sign == fortune_sign:
            spirit_sign = (spirit_sign + 1) % 12
            return spirit_sign, 'spirit_shifted'
    return spirit_sign, 'spirit'


def releaser_lon(chart_obj, token):
    """Raw longitude of the releaser (pre-shift). Useful for headers that want
    to show degrees within sign. Returns None for 'sign' token."""
    if token == RELEASER_FORTUNE:
        return _fortune_lon(chart_obj)
    if token == RELEASER_SPIRIT:
        return _spirit_lon(chart_obj)
    if is_arabic_part_releaser_token(token):
        return _arabic_part_lon(chart_obj, arabic_part_name_from_releaser(token))
    return None


def find_current_period_index(rows, dt, level=None):
    """Return the index of the row whose [start, end) contains dt, optionally
    restricted to a specific level. -1 if none found."""
    if dt is None or not rows:
        return -1
    for i, r in enumerate(rows):
        if level is not None and int(r.get('level', 0)) != int(level):
            continue
        s = r.get('start'); e = r.get('end')
        if s is None or e is None:
            continue
        if s <= dt < e:
            return i
    return -1
