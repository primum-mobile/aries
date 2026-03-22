# -*- coding: utf-8 -*-
import datetime
import weakref
import astrology
import mtexts
import transits
import util

_PLANETARY_MONTH_HIT_CACHE = weakref.WeakKeyDictionary()

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

    PLANETARY_SPECS = {
        MERCURY: (astrology.SE_MERCURY, 14),
        VENUS: (astrology.SE_VENUS, 16),
        MARS: (astrology.SE_MARS, 26),
        JUPITER: (astrology.SE_JUPITER, 12*12),
        SATURN: (astrology.SE_SATURN, 30*12),
        URANUS: (astrology.SE_URANUS, 100*12),
    }
    def __init__(self):
        self.t = [0, 0, 0, 0, 0, 0]

    def _planet_params(self, typ):
        return Revolutions.PLANETARY_SPECS.get(typ, (None, 0))

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
        hour, minute, second = util.decToDeg(tr.time)
        return datetime.datetime(int(year), int(month), int(tr.day), int(hour), int(minute), int(second))

    def _set_candidate(self, year, month, trans, index):
        self.createRevolution(int(year), int(month), trans, int(index))
        return True

    def _set_hit_values(self, values):
        self.t = [int(value) for value in values]
        return True

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

    def _planetary_month_hits(self, typ, year, month, chrt):
        planet, _months = self._planet_params(typ)
        if planet is None:
            return ()

        bucket = self._planetary_cache_bucket(chrt)
        cache_key = (
            int(typ),
            int(year),
            int(month),
            int(getattr(chrt.options, 'ayanamsha', 0)),
            int(bool(getattr(chrt.options, 'topocentric', False))),
        )
        if bucket is not None and cache_key in bucket:
            return bucket[cache_key]

        trans = transits.Transits()
        trans.month(int(year), int(month), chrt, planet)
        hits = []
        for tr in trans.transits:
            hour, minute, second = util.decToDeg(tr.time)
            values = (
                int(year), int(month), int(tr.day),
                int(hour), int(minute), int(second),
            )
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

            # ② 이하 기존 로직 유지
            month = chrt.time.month
            day = chrt.time.day

            trans = transits.Transits()
            trans.month(year, month, chrt, astrology.SE_SUN)

            if len(trans.transits) == 0:
                if day < 4:
                    year, month = util.decrMonth(year, month)
                else:
                    year, month = util.incrMonth(year, month)
                trans = transits.Transits()
                trans.month(year, month, chrt, astrology.SE_SUN)

            if len(trans.transits) > 0:
                self.createRevolution(year, month, trans)
                return True
            return False
        # 나머지 LUNAR~SATURN 분기는 그대로...

        elif typ == Revolutions.LUNAR:
            trans = transits.Transits()
            trans.month(by, bm, chrt, astrology.SE_MOON)

            if len(trans.transits) > 0:
                second = False

                if bd > trans.transits[0].day:
                    # There can be more than one lunar in a month!!
                    if len(trans.transits) > 1:
                        if bd > trans.transits[1].day:
                            by, bm = util.incrMonth(by, bm)

                            trans = transits.Transits()
                            trans.month(by, bm, chrt, astrology.SE_MOON)
                        else:
                            second = True
                    else:
                        by, bm = util.incrMonth(by, bm)

                        trans = transits.Transits()
                        trans.month(by, bm, chrt, astrology.SE_MOON)

                if len(trans.transits) > 0:
                    if second:
                        self.createRevolution(by, bm, trans, 1)
                    else:
                        self.createRevolution(by, bm, trans)
                    return True

            return False
        elif Revolutions.is_planetary_type(typ):
            ref_dt = datetime.datetime(int(by), int(bm), int(bd), 0, 0, 0)
            return self.compute_planetary_after_datetime(typ, ref_dt, chrt, inclusive=True)

        return False


    def createRevolution(self, year, month, trans, num = 0):
        self.t[0] = year
        self.t[1] = month
        self.t[2] = trans.transits[num].day
        h, m, s = util.decToDeg(trans.transits[num].time)
        self.t[3] = h
        self.t[4] = m
        self.t[5] = s
