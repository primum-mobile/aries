# circumambulation.py
# -*- coding: utf-8 -*-

from __future__ import division
import os, math, datetime
import io 
import astrology, chart, houses, mtexts
import mtexts
import primdirs

ASPECTS = (0, 60, 90, 120, 180)
DEFAULT_KEY_Y_PER_DEG = 1.0  # years per equatorial degree (OA)
DAYS_PER_YEAR = 365.2421897


def years_per_degree_from_options(options):
    """Return years-per-degree key for circumambulation from current options."""
    v = getattr(options, 'circumkey', None)
    if v is not None:
        try:
            return float(v)
        except Exception:
            pass

    if getattr(options, 'pdkeydyn', False):
        try:
            coeff = float(primdirs.PrimDirs.staticData[primdirs.PrimDirs.NAIBOD][primdirs.PrimDirs.COEFF])
            return coeff if coeff > 0.0 else DEFAULT_KEY_Y_PER_DEG
        except Exception:
            return DEFAULT_KEY_Y_PER_DEG

    try:
        if getattr(options, 'pdkeys', None) == primdirs.PrimDirs.CUSTOMER:
            deg = float(getattr(options, 'pdkeydeg', 0.0))
            minu = float(getattr(options, 'pdkeymin', 0.0))
            sec = float(getattr(options, 'pdkeysec', 0.0))
            deg_per_year = deg + minu / 60.0 + sec / 3600.0
            return (1.0 / deg_per_year) if deg_per_year > 0.0 else DEFAULT_KEY_Y_PER_DEG

        pdkeys = getattr(options, 'pdkeys', None)
        if pdkeys is not None:
            coeff = float(primdirs.PrimDirs.staticData[pdkeys][primdirs.PrimDirs.COEFF])
            return coeff if coeff > 0.0 else DEFAULT_KEY_Y_PER_DEG
    except Exception:
        pass

    return DEFAULT_KEY_Y_PER_DEG


def use_pd_circumoa_from_options(options):
    """Return True when circumambulation must use the PD engine method."""
    mode = getattr(options, 'pdcircumoa', primdirs.PrimDirs.CIRCUM_OA_ASCENSIONAL_TIMES)
    return mode == primdirs.PrimDirs.CIRCUM_OA_USE_PD

def _gregorian_date_in_radix_zone(jd, chrt):
    """
    표시용 날짜를 라딕스의 민법(현지) 시각대(TZ + DST)에 맞춰 반환.
    Morinus: plus(동경=+), zh(시간), zm(분), daylightsaving(썸머타임) 기준.
    """
    tz_hours = 0.0
    dst_hours = 0.0
    t = getattr(chrt, 'time', None)
    if t is not None:
        # 우선순위 1: Morinus 고유 필드(plus, zh, zm, daylightsaving)
        try:
            if hasattr(t, 'plus') and hasattr(t, 'zh') and hasattr(t, 'zm'):
                base = float(getattr(t, 'zh', 0.0)) + float(getattr(t, 'zm', 0.0)) / 60.0
                sign = 1.0 if bool(getattr(t, 'plus', True)) else -1.0   # 동경=+, 서경=-
                tz_hours = sign * base
            if bool(getattr(t, 'daylightsaving', False)):
                dst_hours = 1.0
        except Exception:
            pass
        # 우선순위 2: 다른 프로젝트 변형 필드들(가능하면 활용, 없으면 0 유지)
        if tz_hours == 0.0:
            for name in ('zone', 'tz', 'utcoff', 'utc_offset'):
                v = getattr(t, name, None)
                if v is not None:
                    try:
                        tz_hours = float(v)
                        break
                    except Exception:
                        pass
        if dst_hours == 0.0:
            for name in ('dst', 'DST'):
                v = getattr(t, name, None)
                if v is not None:
                    try:
                        dst_hours = float(v)
                        break
                    except Exception:
                        pass

    off_days = (tz_hours + dst_hours) / 24.0
    gY, gM, gD, _ = astrology.swe_revjul(jd + off_days + 1e-9, astrology.SE_GREG_CAL)
    return datetime.date(int(gY), int(gM), int(gD))

_ASTROSEEK_CANDIDATES = [
    os.path.join(os.path.dirname(__file__), "data", "rt_0p5.txt"),
    os.path.join(os.path.dirname(__file__), "rt_0p5.txt"),
    os.path.join(os.getcwd(), "rt_0p5.txt"),
]
_GRID_PHI = None
_GRID_RT  = None

def _load_rt_table_once():
    global _GRID_PHI, _GRID_RT
    if _GRID_PHI is not None:
        return _GRID_PHI, _GRID_RT
    grid_phi, grid_rt = [], []
    def _try(path):
        if not os.path.exists(path):
            return False
        # 유니코드로 안전하게 읽고, 쉼표/세미콜론도 허용
        with io.open(path, "r", encoding="utf-8", errors="ignore") as f:
            for line in f:
                if not line.strip():
                    continue
                parts = line.strip().replace("\t", " ")
                parts = parts.replace(",", " ").replace(";", " ").split()
                if len(parts) != 13:
                    continue
                try:
                    phi_txt = parts[0].replace(u"°", u"")
                    phi = float(phi_txt)
                    row = [float(x) for x in parts[1:13]]
                except Exception:
                    continue
                if phi > 66.0:
                    continue
                s = sum(row)
                if 300.0 <= s <= 420.0:
                    grid_phi.append(phi); grid_rt.append(row)
        return len(grid_phi) > 0
    for p in _ASTROSEEK_CANDIDATES:
        try:
            if _try(p):
                break
        except Exception:
            pass
    if not grid_phi:
        raise RuntimeError("Rising Times table not found. Put 'rt_0p5.txt' under ./data/ or project root.")
    pairs = sorted(zip(grid_phi, grid_rt), key=lambda t: t[0])
    _GRID_PHI = [p for p,_ in pairs]
    _GRID_RT  = [r for _,r in pairs]
    return _GRID_PHI, _GRID_RT

def _interp_rt12(phi):
    grid_phi, grid_rt = _load_rt_table_once()
    if phi <= grid_phi[0]:
        return list(grid_rt[0])
    if phi >= grid_phi[-1]:
        return list(grid_rt[-1])
    lo, hi = 0, len(grid_phi)-1
    while lo <= hi:
        mid = (lo+hi)//2
        if grid_phi[mid] < phi:
            lo = mid+1
        else:
            hi = mid-1
    i = lo
    if i <= 0:
        return list(grid_rt[0])
    if i >= len(grid_phi):
        return list(grid_rt[-1])
    p0, p1 = grid_phi[i-1], grid_phi[i]
    w = 0.0 if p1 == p0 else (phi - p0) / (p1 - p0)
    row0, row1 = grid_rt[i-1], grid_rt[i]
    return [ (1.0-w)*a + w*b for a,b in zip(row0,row1) ]

def _sign_index(lmb):
    return int((lmb % 360.0) // 30.0)
def _oa_rising_deg_unwrapped(lon_deg, phi_deg, eps_deg):
    """Rising OA(°) for ecliptic longitude lon_deg (tropical), latitude phi_deg, obliquity eps_deg.
    Unwrap so lon+360 -> OA+360.
    """
    k = math.floor(lon_deg / 360.0)
    lon0 = lon_deg - 360.0 * k

    lon = math.radians(lon0)
    phi = math.radians(phi_deg)
    eps = math.radians(eps_deg)

    # RA/Dec of ecliptic point (β=0)
    ra = math.atan2(math.sin(lon) * math.cos(eps), math.cos(lon))
    if ra < 0:
        ra += 2.0 * math.pi
    dec = math.asin(math.sin(eps) * math.sin(lon))

    # semi-diurnal arc: cos(H) = -tan(phi)*tan(dec)
    x = -math.tan(phi) * math.tan(dec)
    if x <= -1.0:
        H = math.pi
    elif x >= 1.0:
        H = 0.0
    else:
        H = math.acos(x)

    oa = (ra - H) % (2.0 * math.pi)
    return math.degrees(oa) + 360.0 * k


def _delta_oa_exact(phi_deg, lam1_sid, lam2_sid, ayan_deg, eps_deg):
    """Exact ΔOA using OA difference. lam*_sid are your internal longitudes; +ayan -> tropical."""
    lon1 = lam1_sid + ayan_deg
    lon2 = lam2_sid + ayan_deg
    if lon2 < lon1:
        lon2 += 360.0

    oa1 = _oa_rising_deg_unwrapped(lon1, phi_deg, eps_deg)
    oa2 = _oa_rising_deg_unwrapped(lon2, phi_deg, eps_deg)
    return max(0.0, oa2 - oa1)
def _delta_oa_by_rt(rt12, lam1, lam2, ayan=0.0, gran_deg=0.0):
    import math
    a_t = lam1 + ayan
    b_t = lam2 + ayan
    if b_t < a_t:
        b_t += 360.0

    cur_t = a_t
    end_t = b_t
    s = 0.0
    eps = 1e-12

    while cur_t + eps < end_t:
        # 현재 트로피컬 사인 경계
        si = _sign_index(cur_t)
        k_next = math.floor((cur_t + eps) / 30.0) + 1
        sign_end_t = 30.0 * k_next

        # 선택적: 0.5° 같은 세분 격자 경계
        if gran_deg and gran_deg > 0.0:
            gk = math.floor((cur_t + eps) / gran_deg) + 1
            grid_end_t = gran_deg * gk
            step_end = min(sign_end_t, grid_end_t, end_t)
        else:
            step_end = min(sign_end_t, end_t)

        step_t = step_end - cur_t
        s += rt12[si] * (step_t / 30.0)
        cur_t = step_end

    return max(0.0, s)

def _term_edges_deg(options, ayan=0.0):

    """Return [(lam_start, lam_end, ruler_pid, sign_idx)] over 0..360°.

    - Morinus 옵션의 terms 구조가 환경에 따라
      * 각 텀의 '길이(span)' 5개 (합≈30) 이거나
      * 각 텀의 '끝도수(end)' 5개 (단조증가, 마지막≈30)
      로 들어오는 사례가 있어, 여기서 자동 판별한다.
    """
    edges = []
    sel = getattr(options, "selterm", 0)
    terms = options.terms[sel]    # [12][n][planet_id, value]

    # 텀 경계는 이미 시데리얼 좌표계(0,30,60…°)에서 생성해야 한다.
    # 상위 레벨에서 아야남샤 보정이 끝났으므로 여기서는 추가 평행이동을 하지 않는다.
    lam0 = 0.0

    for sign in range(12):
        rows = terms[sign]
        # value 후보를 한 번에 뽑기
        vals = []
        pids = []
        for t in range(len(rows)):
            pid = rows[t][0]
            try:
                val = float(rows[t][1])
            except Exception:
                # (안전) 숫자가 아니면 0 취급
                val = 0.0
            pids.append(pid)
            vals.append(val)

        # --- 판별: span 형식인가 end 형식인가?
        use_span = False
        use_end  = False
        ssum = sum(vals)
        if 28.5 <= ssum <= 31.5:
            use_span = True
        # end 후보: 단조 증가 & 마지막이 28~30.5
        if all(vals[i] <= vals[i+1] for i in range(len(vals)-1)) and (28.0 <= vals[-1] <= 30.5):
            use_end = True

        # 애매하면 span 우선(실전에서 Morinus가 span인 빌드가 많음)
        mode = "span" if (use_span or not use_end) else "end"

        prev = 0.0
        if mode == "span":
            for t in range(len(vals)):
                span = max(0.0, min(vals[t], 30.0 - prev))
                a = lam0 + prev
                b = a + span
                if b - a > 1e-9:
                    edges.append((a, b, pids[t], sign))
                prev += span
        else:  # end
            for t in range(len(vals)):
                end = max(prev, min(vals[t], 30.0))
                a = lam0 + prev
                b = lam0 + end
                if b - a > 1e-9:
                    edges.append((a, b, pids[t], sign))
                prev = end

        lam0 += 30.0

    # 시작경도 기준 정렬 보장
    edges.sort(key=lambda x: x[0])
    return edges
def _sidereal_offset_deg(chrt, options):
    """
    시데리얼 모드일 때 사용할 아야남샤(°)를 반환.
    options.ayanamsha == 0 이면 트로피컬이므로 0.0 반환.
    chart.Chart.create()에서 chrt.ayanamsha 가 세팅되므로 우선 사용.
    """
    try:
        if getattr(options, 'ayanamsha', 0) != 0:
            return float(getattr(chrt, 'ayanamsha', 0.0)) or 0.0
    except Exception:
        pass
    return 0.0
def _ayan_ut(jd_ut, options):
    """Return ayanamsha(°) for given jd_ut if sidereal mode is on, else 0.0.

    NOTE:
    - Swiss Ephemeris sidereal mode is global, so set it here to be safe.
    - We intentionally use *_ut variants everywhere in this module.
    """
    try:
        if getattr(options, 'ayanamsha', 0) != 0:
            astrology.swe_set_sid_mode(int(options.ayanamsha) - 1, 0, 0)
            return float(astrology.swe_get_ayanamsa_ut(float(jd_ut)))
    except Exception:
        pass
    return 0.0

def _solve_segment_time(rt12, lam1_sid, lam2_sid, jd_start, key, calflag, options, iters=4,
                        phi_deg=None, use_exact_oa=False):
    # Initial guess: use ayanamsha at segment start
    ay = _ayan_ut(jd_start, options)
    if use_exact_oa and phi_deg is not None:
        eps = _mean_obliquity_deg(jd_start)
        delta_oa = _delta_oa_exact(phi_deg, lam1_sid, lam2_sid, ay, eps)
    else:
        delta_oa = _delta_oa_by_rt(rt12, lam1_sid, lam2_sid, ay)
    delta_years = delta_oa * key
    jd_end = _jd_add_years(jd_start, delta_years, calflag)

    # Fixed-point iteration: ay depends on jd_end; jd_end depends on ay.
    for _ in range(max(0, int(iters) - 1)):
        ay2 = _ayan_ut(jd_end, options)
        if use_exact_oa and phi_deg is not None:
            eps2 = _mean_obliquity_deg(jd_end)
            delta_oa2 = _delta_oa_exact(phi_deg, lam1_sid, lam2_sid, ay2, eps2)
        else:
            delta_oa2 = _delta_oa_by_rt(rt12, lam1_sid, lam2_sid, ay2)
        delta_years2 = delta_oa2 * key
        jd_end2 = _jd_add_years(jd_start, delta_years2, calflag)

        if abs(jd_end2 - jd_end) < 1e-7 and abs(ay2 - ay) < 1e-7:
            ay, delta_oa, delta_years, jd_end = ay2, delta_oa2, delta_years2, jd_end2
            break
        ay, delta_oa, delta_years, jd_end = ay2, delta_oa2, delta_years2, jd_end2

    return delta_oa, delta_years, jd_end, ay

def _planet_longitudes(chart_obj, options):
    pls = {}
    ayan = _sidereal_offset_deg(chart_obj, options)
    pmap = [
        (astrology.SE_SUN,  mtexts.txts.get('Sun','Sun')),
        (astrology.SE_MOON, mtexts.txts.get('Moon','Moon')),
        (astrology.SE_MERCURY, mtexts.txts.get('Mercury','Mercury')),
        (astrology.SE_VENUS,   mtexts.txts.get('Venus','Venus')),
        (astrology.SE_MARS,    mtexts.txts.get('Mars','Mars')),
        (astrology.SE_JUPITER, mtexts.txts.get('Jupiter','Jupiter')),
        (astrology.SE_SATURN,  mtexts.txts.get('Saturn','Saturn')),
    ]
    if options.transcendental[chart.Chart.TRANSURANUS]:
        pmap.append((astrology.SE_URANUS, mtexts.txts.get('Uranus','Uranus')))
    if options.transcendental[chart.Chart.TRANSNEPTUNE]:
        pmap.append((astrology.SE_NEPTUNE, mtexts.txts.get('Neptune','Neptune')))
    if options.transcendental[chart.Chart.TRANSPLUTO]:
        pmap.append((astrology.SE_PLUTO, mtexts.txts.get('Pluto','Pluto')))
    for pid, label in pmap:
        lam = chart_obj.planets.planets[pid].data[0]
        if ayan:
            lam = (lam - ayan) % 360.0
        pls[label] = lam
    return pls

def _exact_aspect_hits(lam_start_abs, lam_end_abs, planet_lams, aspects=(0,60,90,120,180)):
    """
    lam_start_abs, lam_end_abs : 절대 경도(증가 단조)
    planet_lams : {"Venus": 123.45, ...} (0..360)
    반환: [(L_abs, planet, A), ...]  -- 세그먼트 내부(양끝 제외)만
    """
    hits = []
    if lam_end_abs <= lam_start_abs + 1e-12:
        return hits

    for label, lp in planet_lams.items():
        lp = lp % 360.0
        for A in aspects:
            bases = [(lp - A) % 360.0]
            if A not in (0, 180):
                bases.append((lp + A) % 360.0)   # ±A 모두
            for base in bases:
                k_min = int(math.ceil((lam_start_abs - base) / 360.0))
                k_max = int(math.floor((lam_end_abs   - base) / 360.0))
                for k in range(k_min, k_max + 1):
                    L = base + 360.0 * k
                    if lam_start_abs + 1e-9 < L < lam_end_abs - 1e-9:  # 경계 제외
                        hits.append((L, label, A))
    hits.sort(key=lambda x: x[0])
    return hits

def _jd_add_years(jd0, years, calflag):
    return jd0 + float(years) * DAYS_PER_YEAR

def _years_since_birth(jd, jd_birth):
    yrs = (jd - jd_birth) / DAYS_PER_YEAR
    return 0.0 if yrs < 0 else yrs

def calibrate_key_with_anchor(phi, lam_start, lam_end, observed_years, ayan=0.0):

    """Return key so that ΔOA(rt(phi), lam_start→lam_end) * key == observed_years."""
    rt12 = _interp_rt12(phi)    
    doa  = _delta_oa_by_rt(rt12, lam_start%360.0, lam_end%360.0, ayan)

    if doa <= 0.0:
        return DEFAULT_KEY_Y_PER_DEG
    return float(observed_years) / doa
def _mean_obliquity_deg(jd):
    T = (jd - 2451545.0) / 36525.0
    eps = (84381.406
           - 46.836769*T
           - 0.0001831*T*T
           + 0.00200340*T**3
           - 5.76e-7*T**4
           - 4.34e-8*T**5) / 3600.0
    return eps


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

def compute_distributions(chrt, options, start_lambda=None, key=DEFAULT_KEY_Y_PER_DEG,
                          max_rows=200, include_participating=True, max_age_years=150,
                          use_exact_oa=False):
    """Route to the correct back-end depending on the OA method setting.

    use_exact_oa=True  (CIRCUM_OA_USE_PD):
        Delegates entirely to the Morinus PD engine (PlacidianSAPD).
        Circumambulations are simply: Significator=ASC, Promittors=Terms+Planets,
        all governed by the same PD settings already configured in the app.

    use_exact_oa=False (CIRCUM_OA_ASCENSIONAL_TIMES):
        Uses the traditional Hellenistic rising-times table (rt_0p5.txt).
        Original table-based implementation preserved below as
        _compute_distributions_ascensional_times().
    """
    if use_exact_oa:
        return _compute_distributions_pd(
            chrt, options, max_rows=max_rows, max_age_years=max_age_years)
    else:
        return _compute_distributions_ascensional_times(
            chrt, options, start_lambda=start_lambda, key=key,
            max_rows=max_rows, include_participating=include_participating,
            max_age_years=max_age_years)


def _compute_distributions_pd(chrt, options, max_rows=200, max_age_years=150):
    """Compute circumambulation table by delegating to the Morinus PD engine.

    Circumambulations = PD with Significator:ASC, Promittors:Terms+Planets (zodiacal).
    Arc→years conversion uses the same key (Naibod/Cardan/Ptolemy/Custom) and
    ayanamsha already set in options, so results align exactly with the PD table.
    """
    import copy
    import placidiansapd

    # Build effective options: ASC-only significator, terms enabled.
    # All other settings (key, ayanamsha, subzodiacal, bianchini, secmotion…)
    # are inherited from the user's PD settings unchanged.
    eff = copy.copy(options)
    eff.sigangles = [True, False, False, False]   # ASC only
    eff.sighouses = False
    eff.pdterms   = True
    eff.pdlof     = [False, False]
    eff.pdsyzygy  = False
    eff.subzodiacal = primdirs.PrimDirs.SZNEITHER
    eff.bianchini = False
    if hasattr(eff, 'pdparallels'):
        eff.pdparallels = [False, False]

    classical_asps = {
        chart.Chart.CONJUNCTIO,
        chart.Chart.SEXTIL,
        chart.Chart.QUADRAT,
        chart.Chart.TRIGON,
        chart.Chart.OPPOSITIO,
    }
    if hasattr(eff, 'pdaspects'):
        try:
            pdaspects = [False] * len(eff.pdaspects)
            for idx in classical_asps:
                if 0 <= idx < len(pdaspects):
                    pdaspects[idx] = True
            eff.pdaspects = pdaspects
        except Exception:
            pass

    abort = primdirs.AbortPD()
    try:
        pd_engine = placidiansapd.PlacidianSAPD(
            chrt, eff, primdirs.PrimDirs.RANGEALL, primdirs.PrimDirs.DIRECT, abort)
        pd_engine.calcZodAscMC()
    except Exception as e:
        raise ValueError("PD engine error in circumambulation: %s" % e)

    # Simple PD stream: ASC significator only.
    asc_pds = [
        pd for pd in pd_engine.pds
        if pd.sig == primdirs.PrimDir.ASC and pd.direct
    ]
    asc_pds.sort(key=lambda pd: pd.arc)

    TERM_MIN = primdirs.PrimDir.TERM
    TERM_MAX = primdirs.PrimDir.TERM + 11        # 12 signs → TERM+0 … TERM+11

    def _unique_by(events, keyfunc):
        out = []
        seen = set()
        for ev in events:
            key = keyfunc(ev)
            if key in seen:
                continue
            seen.add(key)
            out.append(ev)
        return out

    # Root-cause normalization:
    # - term stream = true term-boundary events only (conjunction)
    # - collapse equivalent PD emissions to one event identity
    term_hits_raw = [
        pd for pd in asc_pds
        if TERM_MIN <= pd.prom <= TERM_MAX and int(pd.promasp) == chart.Chart.CONJUNCTIO
    ]
    term_hits = _unique_by(
        term_hits_raw,
        lambda pd: (int(pd.prom), int(pd.prom2), round(float(pd.arc), 10), round(float(pd.time), 8))
    )

    planet_count = len(chrt.planets.planets)
    planet_hits_raw = [
        pd for pd in asc_pds
        if 0 <= pd.prom < planet_count and int(pd.promasp) in classical_asps
    ]
    planet_hits = _unique_by(
        planet_hits_raw,
        lambda pd: (int(pd.prom), int(pd.promasp), round(float(pd.arc), 10), round(float(pd.time), 8))
    )

    if not term_hits:
        return []

    # Birth JD
    calflag = astrology.SE_GREG_CAL
    if chrt.time.cal == chart.Time.JULIAN:
        calflag = astrology.SE_JUL_CAL
    jd0 = astrology.swe_julday(chrt.time.year, chrt.time.month, chrt.time.day,
                                chrt.time.time, calflag)
    jd_limit = jd0 + max_age_years * DAYS_PER_YEAR

    # Term edges for lam_start/lam_end (kept from original helper)
    ayan_birth = _sidereal_offset_deg(chrt, options)
    edges = sorted(_term_edges_deg(options, ayan_birth), key=lambda e: e[0])

    # Find which term the natal ASC falls in
    asc_sid = (chrt.houses.ascmc[houses.Houses.ASC] - ayan_birth) % 360.0
    i0 = 0
    for idx, (a, b, _, _) in enumerate(edges):
        if a - 1e-9 <= asc_sid < b + 1e-9:
            i0 = idx
            break

    rows = []
    prev_arc = 0.0
    prev_jd  = jd0
    prev_age = 0.0
    ph_ptr   = 0   # pointer into planet_hits list

    for k, th in enumerate(term_hits):
        if len(rows) >= max_rows:
            break
        if th.time > jd_limit + 1e-9:
            break

        edge = edges[(i0 + k) % len(edges)]
        a, b, edge_ruler, _ = edge

        # Period k ruler: birth term ruler for k=0, else the ruler entered at hit k-1
        ruler_pid = edge_ruler if k == 0 else term_hits[k - 1].prom2

        g_start = _gregorian_date_in_radix_zone(prev_jd, chrt)
        g_end   = _gregorian_date_in_radix_zone(th.time,  chrt)

        # Collect participating planet hits whose arc falls within this period
        participating = []
        seg_arc = max(th.arc - prev_arc, 0.0)
        seg_lon = (b - a) % 360.0
        while ph_ptr < len(planet_hits):
            ph = planet_hits[ph_ptr]
            if ph.arc > th.arc - 1e-9:
                break
            if ph.arc > prev_arc + 1e-9 and ph.time <= jd_limit + 1e-9:
                if seg_arc > 1e-12:
                    frac = (ph.arc - prev_arc) / seg_arc
                    if frac < 0.0:
                        frac = 0.0
                    elif frac > 1.0:
                        frac = 1.0
                else:
                    frac = 0.0
                lam_part = (a + seg_lon * frac) % 360.0
                aspect_deg  = chart.Chart.Aspects[ph.promasp] if 0 <= ph.promasp < len(chart.Chart.Aspects) else 0.0
                participating.append({
                    'lam':     lam_part,
                    'lam_abs': ph.arc,
                    'planet':  planet_label(ph.prom),
                    'aspect':  aspect_deg,
                    'doa':     ph.arc,
                    'years':   ph.age,
                    'jd':      ph.time,
                    'date':    _gregorian_date_in_radix_zone(ph.time, chrt),
                })
            ph_ptr += 1

        rows.append({
            'lam_start':      a % 360.0,
            'lam_end':        b % 360.0,
            'sign_idx':       _sign_index(a),
            'term_ruler_pid': ruler_pid,
            'delta_oa':       th.arc - prev_arc,
            'delta_years':    th.age - prev_age,
            'date_start':     g_start,
            'date_end':       g_end,
            'age_start':      prev_age,
            'age_end':        th.age,
            'jd_start':       prev_jd,
            'jd_end':         th.time,
            'participating':  participating,
        })

        prev_arc = th.arc
        prev_jd  = th.time
        prev_age = th.age

    return rows


# ---------------------------------------------------------------------------
# Legacy: Ascensional Times (rt_0p5.txt table) implementation
#
# NOTE: The following function was the original implementation written to
# compute circumambulation periods using a rising-times table read from an
# external file (rt_0p5.txt).  It is kept here as a reference and as the
# back-end for the "Ascensional Times" mode (CIRCUM_OA_ASCENSIONAL_TIMES).
#
# For the preferred "Use PD Settings" mode the code above (_compute_distributions_pd)
# delegates directly to the Morinus PD engine, which uses the exact same spherical
# trigonometry already trusted for all other primary directions in the application.
# ---------------------------------------------------------------------------

def _compute_distributions_ascensional_times(
        chrt, options, start_lambda=None, key=DEFAULT_KEY_Y_PER_DEG,
        max_rows=200, include_participating=True, max_age_years=150):
    """
    Returns list of rows:
      - 'lam_start','lam_end','sign_idx','term_ruler_pid'
      - 'delta_oa','delta_years'
      - 'date_start','date_end'  (datetime.date)
      - 'participating' : [{'lam','planet','aspect','date'}, ...]
    """
    if start_lambda is None:
        start_lambda = chrt.houses.ascmc[houses.Houses.ASC]
    # Birth ayanamsha is used only to place the radix ASC into sidereal longitudes.
    # Per-segment timing may still use time-varying ayanamsha (see _solve_segment_time).
    ayan_birth = _sidereal_offset_deg(chrt, options)
    start_lambda = (float(start_lambda) - ayan_birth) % 360.0

    phi = chrt.place.lat
    rt12 = _interp_rt12(phi)
    edges = _term_edges_deg(options, ayan_birth)

    calflag = astrology.SE_GREG_CAL
    if chrt.time.cal == chart.Time.JULIAN:
        calflag = astrology.SE_JUL_CAL
    jd0 = astrology.swe_julday(chrt.time.year, chrt.time.month, chrt.time.day, chrt.time.time, calflag)
    # --- Polar guard: 고위도(극권)에서는 전통적 분배(OA/RT)가 물리적으로 미정의 ---
    # 임계 위도 = 90° - ε  (ε: 출생 시점의 황도경사)
    eps_deg   = _mean_obliquity_deg(jd0)
    phi_limit = 90.0 - eps_deg  # ≈ 66.56° 부근
    # 경계 근처의 수치 진동을 막기 위해 아주 소폭(0.01°) 안쪽에서 컷
    if abs(phi) >= (phi_limit - 0.01):
        raise ValueError(mtexts.txts['CircumPolarLatErr'].format(abs(phi), phi_limit))

    jd_limit = jd0 + max_age_years * DAYS_PER_YEAR

    rows = []
    planet_lams = _planet_longitudes(chrt, options) if include_participating else {}

    # 텀 경계 생성 + 정렬(시데리얼 경계는 -ayan 만큼 평행이동되어 있음)
    edges1 = sorted(edges, key=lambda t: t[0])  # edges는 위에서 _term_edges_deg(options, ayan)

    # start_lambda(0..360)를 경계가 놓인 '절대 링'으로 올림/내림
    base0 = edges1[0][0]  # 첫 경계의 절대 시작도수(예: 337°)
    start_abs = start_lambda
    while start_abs < base0 - 1e-9:
        start_abs += 360.0
    while start_abs >= base0 + 360.0 - 1e-9:
        start_abs -= 360.0

    # 포함 세그먼트 찾기: a ≤ start_abs < b
    i0 = None
    for idx, (a, b, _, _) in enumerate(edges1):
        if (a - 1e-9) <= start_abs < (b - 1e-9):
            i0 = idx
            break
    # 경계선(==b)에 정확히 걸려 있으면 다음 세그먼트로
    if i0 is None:
        for idx, (a, b, _, _) in enumerate(edges1):
            if abs(start_abs - b) <= 1e-9:
                i0 = (idx + 1) % len(edges1)
                break
    # 그래도 못 찾으면: start_abs 이후 첫 b(없으면 0)
    if i0 is None:
        i0 = min(range(len(edges1)), key=lambda i: ((edges1[i][1] - start_abs) % 360.0))


    # 진행 루프 (edges1을 원형으로 순회)
    lam_cursor = start_abs

    jd_cursor  = jd0
    idx = i0
    if jd_cursor < jd0:
        jd_cursor = jd0
    if jd_cursor >= jd_limit - 1e-9:
        return rows

        
    for _ in range(max_rows):
        a, b, pid, _sign_ignored = edges1[idx]
        seg_start = lam_cursor
        seg_end   = b

        delta_oa, delta_year, jd_next, ayan_used = _solve_segment_time(
            rt12, seg_start, seg_end, jd_cursor, key, calflag, options,
            phi_deg=phi, use_exact_oa=False
        )
        if delta_oa <= 1e-9:
            # ★ 0길이 구간이라도 '텀 진입 시점'이 UI에 보이도록 마커 행을 추가한다.
            g0 = _gregorian_date_in_radix_zone(jd_cursor, chrt)
            rows.append({
                'lam_start': seg_start % 360.0,                   # 표시용: 시데리얼 그대로
                'lam_end':   seg_end   % 360.0,
                'sign_idx':  _sign_index(seg_start),              # 시데리얼 사인 인덱스
                'term_ruler_pid': pid,
                'delta_oa':  0.0,
                'delta_years': 0.0,
                'date_start': g0,
                'age_start': _years_since_birth(jd_cursor, jd0),
                'age_end':   _years_since_birth(jd_cursor, jd0),
                'date_end':  g0,
                'jd_start':  jd_cursor,
                'jd_end':    jd_cursor,
                'participating': []
            })
            # 다음 세그먼트로 진행
            lam_cursor = seg_end
            idx = (idx + 1) % len(edges1)
            continue

        # ★ rows.append에서 쓰일 시작/끝 날짜 + participatings를 먼저 계산
        y0, m0, d0, h0 = astrology.swe_revjul(jd_cursor, calflag)
        y1, m1, d1, h1 = astrology.swe_revjul(jd_next,   calflag)
        age_start_years = _years_since_birth(jd_cursor, jd0)
        age_end_years   = _years_since_birth(jd_next,   jd0)
        # 표시용 날짜는 항상 Gregorian으로 변환 (Julian 출생이라도 음수/역전 방지)
        g0 = _gregorian_date_in_radix_zone(jd_cursor, chrt)
        g1 = _gregorian_date_in_radix_zone(jd_next,   chrt)

        participants = []
        if include_participating and planet_lams:
            hits = _exact_aspect_hits(seg_start, seg_end, planet_lams)
            for L, label, A in hits:
                doa, yrs, jd, _ay_hit = _solve_segment_time(
                    rt12, seg_start, L, jd_cursor, key, calflag, options,
                    phi_deg=phi, use_exact_oa=False
                )
                if jd > jd_limit + 1e-9:
                    continue
                gP = _gregorian_date_in_radix_zone(jd, chrt)
                participants.append({
                    'lam':   L % 360.0,            # 표시용: 시데리얼 그대로
                    'lam_abs': L,
                    'planet': label,
                    'aspect': A,
                    'doa':   doa,
                    'years': yrs,
                    'jd':    jd,
                    'date':  gP
                })

        # ★ 150세 컷: 부분 구간으로 잘라 1줄 추가하고 종료
        if jd_next > jd_limit + 1e-9:
            remain_years = max(0.0, (jd_limit - jd_cursor) / DAYS_PER_YEAR)
            rem_doa = remain_years / max(key, 1e-12)

            # 표시용 사인 인덱스(시데리얼)과, RT 선택용 사인 인덱스(트로피컬)를 분리
            sign_from_start_sid = _sign_index(seg_start)           # 시데리얼(표시)
            ayan_cap = _ayan_ut(jd_limit, options)
            sign_from_start_tro = _sign_index(seg_start + ayan_cap)    # 트로피컬(RT용)

            rt_sign = rt12[sign_from_start_tro]
            lam_end_cap = seg_start + (rem_doa / max(rt_sign, 1e-12)) * 30.0

            # 표시용 date_end는 컷 시점(jd_limit)을 라딕스 민법 시각대 기준으로
            gCut = _gregorian_date_in_radix_zone(jd_limit, chrt)

            rows.append({
                'lam_start': seg_start   % 360.0,
                'lam_end':   lam_end_cap % 360.0,
                'sign_idx':  sign_from_start_sid,
                'term_ruler_pid': pid,
                'delta_oa':  rem_doa,
                'delta_years': remain_years,
                'date_start':  g0,
                'age_start': age_start_years,
                'age_end':   _years_since_birth(jd_limit, jd0),
                'date_end':    gCut,
                'jd_start':  jd_cursor,
                'jd_end':    jd_limit,
                'participating': participants
            })
            break

        else:
            # 정상 케이스: 한 텀 전체를 행으로 추가
            sign_from_start = _sign_index(seg_start)               # 시데리얼(표시)
            rows.append({
                'lam_start': seg_start % 360.0,                    # 표시용: 시데리얼 그대로
                'lam_end':   seg_end   % 360.0,
                'sign_idx':  sign_from_start,
                'term_ruler_pid': pid,
                'delta_oa':  delta_oa,
                'delta_years': delta_year,
                'date_start': g0,
                'age_start': age_start_years,
                'age_end':   age_end_years,
                'date_end':   g1,
                'jd_start':  jd_cursor,
                'jd_end':    jd_next,
                'participating': participants
            })

            # ★ 다음 세그먼트로 진행
            lam_cursor = seg_end
            jd_cursor  = jd_next
            idx = (idx + 1) % len(edges1)

    return rows

def planet_label(pid):
    base10 = [u"Sun", u"Moon", u"Mercury", u"Venus", u"Mars", u"Jupiter", u"Saturn",
              u"Uranus", u"Neptune", u"Pluto"]
    five   = [u"Mercury", u"Venus", u"Mars", u"Jupiter", u"Saturn"]
    try:
        x = int(pid)
    except Exception:
        return str(pid)
    if 0 <= x < len(base10):  # SwissEph 스타일
        return base10[x]
    if 0 <= x < 5:            # 5행성 전용
        return five[x]
    return str(pid)

