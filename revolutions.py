# -*- coding: utf-8 -*-
import datetime
import weakref
import astrology
import mtexts
import planets
import transits
import util

_PLANETARY_MONTH_HIT_CACHE = weakref.WeakKeyDictionary()
_LUNAR_MONTH_HIT_CACHE = weakref.WeakKeyDictionary()


def _marr_flag_for_body(opts, planet_id):
	"""Map a SwissEph planet id to the matching Marr sidereal-return flag.

	Marr's three categories — Sun (SSR), Moon (SLR), and the planetary
	returns Mercury–Pluto — are toggled independently in the
	Revolutions options dialog.
	"""
	if planet_id == astrology.SE_SUN:
		return bool(getattr(opts, 'revsidereal_marr_solar', False))
	if planet_id == astrology.SE_MOON:
		return bool(getattr(opts, 'revsidereal_marr_lunar', False))
	return bool(getattr(opts, 'revsidereal_marr_planet', False))


def _marr_sidereal_enabled(chrt, planet_id):
	"""Whether to apply Marr precession-shifted target for the given body."""
	opts = getattr(chrt, 'options', None)
	if opts is None:
		return False
	if not _marr_flag_for_body(opts, planet_id):
		return False
	# Marr's sidereal SR/LR is defined as a tropical-zodiac chart whose
	# return target is the precession-shifted natal point. If the user
	# already has an ayanamsha set the chart runs sidereal end-to-end and
	# the SE search returns the same result, so the precession offset
	# would be double-applied — silently skip Marr in that case.
	if int(getattr(opts, 'ayanamsha', 0) or 0) != 0:
		return False
	return True


def _natal_tropical_lon(chrt, planet_id):
	"""Body's natal tropical longitude regardless of the chart's chosen zodiac."""
	natal_lon = chrt.planets.planets[planet_id].data[planets.Planet.LONG]
	if getattr(chrt.options, 'ayanamsha', 0) != 0:
		ay = astrology.swe_get_ayanamsa_ut(chrt.time.jd)
		natal_lon = util.normalize(natal_lon + ay)
	return natal_lon


def _marr_precession_offset(jd_target, jd_birth):
	"""Fagan/Bradley ayanamsha gain between birth and target JD.

	Marr (Prediction I, ch. 4 & ch. 8) computes the sidereal return by
	adding the precession-since-birth to the natal tropical longitude
	and searching for the next tropical transit through that point —
	the SVP (Synetic Vernal Point) method used by Fagan/Bradley.
	"""
	astrology.swe_set_sid_mode(astrology.SE_SIDM_FAGAN_BRADLEY, 0, 0)
	return astrology.swe_get_ayanamsa_ut(jd_target) - astrology.swe_get_ayanamsa_ut(jd_birth)


def _approx_jd_from_datetime(chrt, dt):
	calflag = astrology.SE_GREG_CAL
	from chart import Time as _Time
	if chrt.time.cal == _Time.JULIAN:
		calflag = astrology.SE_JUL_CAL
	ut_hours = dt.hour + dt.minute / 60.0 + dt.second / 3600.0
	return astrology.swe_julday(int(dt.year), int(dt.month), int(dt.day), float(ut_hours), calflag)


def _marr_target_lon(chrt, planet_id, jd_target_approx):
	"""Tropical-frame target longitude = natal tropical lon + precession-since-birth."""
	natal_trop = _natal_tropical_lon(chrt, planet_id)
	offset = _marr_precession_offset(jd_target_approx, chrt.time.jd)
	return util.normalize(natal_trop + offset)

def compute_solar_at_year(self, chrt, target_year):
    """지정 연도의 솔라 리턴 한 방 호출"""
    by = target_year   # 시작 기준년은 그냥 target_year로
    bm = chrt.time.month
    bd = chrt.time.day
    return self.compute(Revolutions.SOLAR, by, bm, bd, chrt, target_year=target_year)

class Revolutions:
    SOLAR = 0
    LUNAR = 1
    MERCURY = 2
    VENUS = 3
    MARS = 4
    JUPITER = 5
    SATURN = 6
    URANUS = 7
    NEPTUNE = 8
    PLUTO = 9

    PLANETARY_SPECS = {
        MERCURY: (astrology.SE_MERCURY, 14),
        VENUS: (astrology.SE_VENUS, 16),
        MARS: (astrology.SE_MARS, 26),
        JUPITER: (astrology.SE_JUPITER, 12*12),
        SATURN: (astrology.SE_SATURN, 30*12),
        URANUS: (astrology.SE_URANUS, 100*12),
        NEPTUNE: (astrology.SE_NEPTUNE, 200*12),
        PLUTO: (astrology.SE_PLUTO, 300*12),
    }
    def __init__(self):
        self.t = [0, 0, 0, 0, 0, 0]

    def _planet_params(self, typ):
        return Revolutions.PLANETARY_SPECS.get(typ, (None, 0))

    def _rounded_transit_values(self, year, month, day, time_float):
        total_seconds = int(round(float(time_float) * 3600.0))
        y = int(year)
        m = int(month)
        d = int(day)

        while total_seconds >= 86400:
            total_seconds -= 86400
            y, m, d = util.incrDay(y, m, d)
        while total_seconds < 0:
            total_seconds += 86400
            y, m, d = util.decrDay(y, m, d)

        hour = total_seconds // 3600
        minute = (total_seconds % 3600) // 60
        second = total_seconds % 60
        return (y, m, d, int(hour), int(minute), int(second))

    @classmethod
    def is_planetary_type(cls, typ):
        return typ in cls.PLANETARY_SPECS

    @classmethod
    def planetary_pid(cls, typ):
        spec = cls.PLANETARY_SPECS.get(typ)
        if spec is None:
            return None
        return spec[0]

    def _candidate_datetime(self, year, month, tr):
        values = self._rounded_transit_values(year, month, tr.day, tr.time)
        return datetime.datetime(*values)

    def _set_candidate(self, year, month, trans, index):
        self.createRevolution(int(year), int(month), trans, int(index))
        return True

    def _set_hit_values(self, values):
        self.t = [int(value) for value in values]
        return True

    def _solar_search_months(self, year, month, day, radius=6):
        yielded = set()

        def add(y, m):
            key = (int(y), int(m))
            if key in yielded:
                return
            yielded.add(key)
            months.append(key)

        def shift(y, m, offset):
            y = int(y)
            m = int(m)
            for _ in range(abs(int(offset))):
                if offset < 0:
                    y, m = util.decrMonth(y, m)
                else:
                    y, m = util.incrMonth(y, m)
            return y, m

        months = []
        add(year, month)
        preferred = -1 if int(day) < 4 else 1
        for distance in range(1, int(radius) + 1):
            add(*shift(year, month, preferred * distance))
            add(*shift(year, month, -preferred * distance))
        return months

    def _dt_from_t(self, values=None):
        source = self.t if values is None else values
        return datetime.datetime(*[int(value) for value in source])

    def _planet_cluster_gap_seconds(self, typ):
        _planet, months = self._planet_params(typ)
        if months <= 0:
            return 0
        return int((months * 31 * 24 * 60 * 60) / 2)

    def _month_range_end(self, ref_dt, months):
        year = int(ref_dt.year)
        month = int(ref_dt.month)
        # Return an exclusive upper bound so the terminal search month is included.
        for _ in range(int(months)+1):
            year, month = util.incrMonth(year, month)
        return datetime.datetime(year, month, 1, 0, 0, 0)

    def _birth_datetime(self, chrt):
        return datetime.datetime(
            int(chrt.time.year), int(chrt.time.month), int(chrt.time.day),
            int(chrt.time.hour), int(chrt.time.minute), int(chrt.time.second),
        )

    def _planetary_cache_bucket(self, chrt):
        try:
            return _PLANETARY_MONTH_HIT_CACHE.setdefault(chrt, {})
        except TypeError:
            return None

    def _lunar_cache_bucket(self, chrt):
        try:
            return _LUNAR_MONTH_HIT_CACHE.setdefault(chrt, {})
        except TypeError:
            return None

    def _lunar_month_hits(self, year, month, chrt):
        bucket = self._lunar_cache_bucket(chrt)
        marr = _marr_sidereal_enabled(chrt, astrology.SE_MOON)
        cache_key = (
            int(year),
            int(month),
            int(getattr(chrt.options, 'ayanamsha', 0)),
            int(bool(getattr(chrt.options, 'topocentric', False))),
            1 if marr else 0,
        )
        if bucket is not None and cache_key in bucket:
            return bucket[cache_key]

        trans = transits.Transits()
        if marr:
            approx_dt = datetime.datetime(int(year), int(month), 15, 0, 0, 0)
            target = _marr_target_lon(chrt, astrology.SE_MOON, _approx_jd_from_datetime(chrt, approx_dt))
            trans.month(int(year), int(month), chrt, astrology.SE_MOON, target)
        else:
            trans.month(int(year), int(month), chrt, astrology.SE_MOON)
        hits = []
        birth_dt = self._birth_datetime(chrt)
        for tr in trans.transits:
            values = self._rounded_transit_values(year, month, tr.day, tr.time)
            candidate_dt = self._dt_from_t(values)
            if not marr and abs((candidate_dt - birth_dt).total_seconds()) <= 2:
                values = (
                    int(birth_dt.year),
                    int(birth_dt.month),
                    int(birth_dt.day),
                    int(birth_dt.hour),
                    int(birth_dt.minute),
                    int(birth_dt.second),
                )
            hits.append((self._dt_from_t(values), values))
        hits = tuple(hits)

        if bucket is not None:
            bucket[cache_key] = hits
        return hits

    def _planetary_month_hits(self, typ, year, month, chrt):
        planet, _months = self._planet_params(typ)
        if planet is None:
            return ()

        bucket = self._planetary_cache_bucket(chrt)
        marr = _marr_sidereal_enabled(chrt, planet)
        cache_key = (
            int(typ),
            int(year),
            int(month),
            int(getattr(chrt.options, 'ayanamsha', 0)),
            int(bool(getattr(chrt.options, 'topocentric', False))),
            1 if marr else 0,
        )
        if bucket is not None and cache_key in bucket:
            return bucket[cache_key]

        trans = transits.Transits()
        if marr:
            approx_dt = datetime.datetime(int(year), int(month), 15, 0, 0, 0)
            target = _marr_target_lon(chrt, planet, _approx_jd_from_datetime(chrt, approx_dt))
            trans.month(int(year), int(month), chrt, planet, target)
        else:
            trans.month(int(year), int(month), chrt, planet)
        hits = []
        for tr in trans.transits:
            values = self._rounded_transit_values(year, month, tr.day, tr.time)
            hits.append((self._dt_from_t(values), values))
        hits = tuple(hits)

        if bucket is not None:
            bucket[cache_key] = hits
        return hits

    def enumerate_planetary_hits_in_range(self, typ, start_dt, end_dt, chrt, inclusive_start=True, inclusive_end=False):
        if not Revolutions.is_planetary_type(typ):
            return []
        if end_dt < start_dt:
            return []

        hits = []
        year = int(start_dt.year)
        month = int(start_dt.month)
        while True:
            month_start = datetime.datetime(year, month, 1, 0, 0, 0)
            if month_start > end_dt or (month_start == end_dt and not inclusive_end):
                break

            for candidate_dt, values in self._planetary_month_hits(typ, year, month, chrt):
                if candidate_dt < start_dt or (candidate_dt == start_dt and not inclusive_start):
                    continue
                if candidate_dt > end_dt or (candidate_dt == end_dt and not inclusive_end):
                    continue
                hits.append((candidate_dt, values))

            year, month = util.incrMonth(year, month)

        return hits

    def compute_lunar_after_datetime(self, ref_dt, chrt, inclusive=False):
        year = int(ref_dt.year)
        month = int(ref_dt.month)
        for _ in range(15):
            for candidate_dt, values in self._lunar_month_hits(year, month, chrt):
                if candidate_dt < ref_dt or (candidate_dt == ref_dt and not inclusive):
                    continue
                return self._set_hit_values(values)
            year, month = util.incrMonth(year, month)
        return False

    def compute_lunar_before_datetime(self, ref_dt, chrt, inclusive=False):
        year = int(ref_dt.year)
        month = int(ref_dt.month)
        for _ in range(15):
            candidate = None
            for candidate_dt, values in self._lunar_month_hits(year, month, chrt):
                if candidate_dt > ref_dt or (candidate_dt == ref_dt and not inclusive):
                    continue
                candidate = values
            if candidate is not None:
                return self._set_hit_values(candidate)
            year, month = util.decrMonth(year, month)
        return False

    def compute_planetary_after_datetime(self, typ, ref_dt, chrt, inclusive=False):
        _planet, months = self._planet_params(typ)
        if months <= 0:
            return False
        year = int(ref_dt.year)
        month = int(ref_dt.month)
        for _ in range(int(months)+1):
            for candidate_dt, values in self._planetary_month_hits(typ, year, month, chrt):
                if candidate_dt < ref_dt or (candidate_dt == ref_dt and not inclusive):
                    continue
                return self._set_hit_values(values)
            year, month = util.incrMonth(year, month)
        return False

    def compute_planetary_before_datetime(self, typ, ref_dt, chrt, inclusive=False):
        _planet, months = self._planet_params(typ)
        if months <= 0:
            return False

        year = int(ref_dt.year)
        month = int(ref_dt.month)
        for _ in range(int(months)+1):
            candidate = None
            for candidate_dt, values in self._planetary_month_hits(typ, year, month, chrt):
                if candidate_dt > ref_dt or (candidate_dt == ref_dt and not inclusive):
                    continue
                candidate = values
            if candidate is not None:
                return self._set_hit_values(candidate)

            year, month = util.decrMonth(year, month)
        return False

    def compute_planetary_cycle_start_datetime(self, typ, ref_dt, chrt):
        anchor = Revolutions()
        if not anchor.compute_planetary_before_datetime(typ, ref_dt, chrt, inclusive=True):
            if not anchor.compute_planetary_after_datetime(typ, ref_dt, chrt, inclusive=True):
                return False

        current_dt = anchor._dt_from_t()
        max_gap_seconds = self._planet_cluster_gap_seconds(typ)
        cluster_start_values = tuple(anchor.t)

        while True:
            prev = Revolutions()
            if not prev.compute_planetary_before_datetime(typ, current_dt, chrt, inclusive=False):
                break
            prev_dt = prev._dt_from_t()
            if (current_dt-prev_dt).total_seconds() > max_gap_seconds:
                break
            cluster_start_values = tuple(prev.t)
            current_dt = prev_dt

        return self._set_hit_values(cluster_start_values)

    @staticmethod
    def closest_lunar_return(chrt, anchor_dt, window_days=2):
        """Return the lunar return nearest ``anchor_dt`` under ``chrt`` options."""
        revs = Revolutions()
        start = anchor_dt - datetime.timedelta(days=window_days)
        end = anchor_dt + datetime.timedelta(days=window_days)
        year = int(start.year)
        month = int(start.month)
        best = None
        best_delta = None
        while True:
            month_start = datetime.datetime(year, month, 1, 0, 0, 0)
            if month_start > end:
                break
            for candidate_dt, values in revs._lunar_month_hits(year, month, chrt):
                if candidate_dt < start or candidate_dt > end:
                    continue
                delta = abs((candidate_dt - anchor_dt).total_seconds())
                if best_delta is None or delta < best_delta:
                    best = (candidate_dt, values)
                    best_delta = delta
            year, month = util.incrMonth(year, month)
        return best

    @staticmethod
    def closest_planetary_return(typ, chrt, anchor_dt, window_days=30):
        """Return the planetary return nearest ``anchor_dt`` under ``chrt`` options."""
        revs = Revolutions()
        hits = revs.enumerate_planetary_hits_in_range(
            typ,
            anchor_dt - datetime.timedelta(days=window_days),
            anchor_dt + datetime.timedelta(days=window_days),
            chrt,
            inclusive_start=True,
            inclusive_end=True,
        )
        if not hits:
            return None
        return min(hits, key=lambda hv: abs((hv[0] - anchor_dt).total_seconds()))


    # 기존 시그니처
    # def compute(self, typ, by, bm, bd, chrt):

    # ── 변경: 선택 인자 target_year 추가
    def compute(self, typ, by, bm, bd, chrt, target_year=None):
        if typ == Revolutions.SOLAR:
            # ① 연도 결정
            if target_year is not None:
                year = int(target_year)
            else:
                year = by
                if bm > chrt.time.month or (bm == chrt.time.month and bd > chrt.time.day):
                    year += 1

            month = chrt.time.month
            day = chrt.time.day

            marr = _marr_sidereal_enabled(chrt, astrology.SE_SUN)
            target = None
            if marr:
                approx_dt = datetime.datetime(int(year), int(month), int(day), 12, 0, 0)
                target = _marr_target_lon(chrt, astrology.SE_SUN, _approx_jd_from_datetime(chrt, approx_dt))

            for search_year, search_month in self._solar_search_months(year, month, day):
                trans = transits.Transits()
                trans.month(search_year, search_month, chrt, astrology.SE_SUN, target)
                if len(trans.transits) > 0:
                    self.createRevolution(search_year, search_month, trans)
                    return True
            return False
        # 나머지 LUNAR~SATURN 분기는 그대로...

        elif typ == Revolutions.LUNAR:
            ref_dt = datetime.datetime(int(by), int(bm), int(bd), 0, 0, 0)
            return self.compute_lunar_after_datetime(ref_dt, chrt, inclusive=True)
        elif Revolutions.is_planetary_type(typ):
            ref_dt = datetime.datetime(int(by), int(bm), int(bd), 0, 0, 0)
            return self.compute_planetary_after_datetime(typ, ref_dt, chrt, inclusive=True)

        return False


    def createRevolution(self, year, month, trans, num = 0):
        values = self._rounded_transit_values(year, month, trans.transits[num].day, trans.transits[num].time)
        self.t[0] = values[0]
        self.t[1] = values[1]
        self.t[2] = values[2]
        self.t[3] = values[3]
        self.t[4] = values[4]
        self.t[5] = values[5]
