"""wx-free supplementary chart driver.

This module exposes the subset of ``morin.MFrame`` that
``engine.supplementary_adapter`` needs in order to build derived charts. The
methods are extracted from ``morin.py`` so daemon code can use the same
Binding -> Deriver path without importing wx frame/controller code.
"""
from __future__ import annotations

import datetime
from dataclasses import dataclass
from typing import Any, Optional

import astrology
import chart
import geonames
from engine import moment
from engine import chart_factory
from engine import supplementary_adapter
import lordofyear
import mtexts
import munprofections
import planets
import posfordate
import profections
import profectiontiming
import revolutions
import solaraverage
import symbolic_time
import transits
import util


@dataclass
class HeadlessChartSession:
	chart: Any
	radix: Any
	display_datetime: Optional[tuple[int, int, int, int, int, int]] = None


class SupplementaryHeadlessDriver:
	"""Frame-compatible driver for supplementary adapters.

	The adapter layer historically calls a handful of ``MFrame`` helpers. Keeping
	this small class in the engine layer preserves those semantics while avoiding
	wx imports in the daemon.
	"""

	def __init__(self, options):
		self.options = options
		self.horoscope = None

	def _progression_angle_method_for_chart(self, chrt):
		default = getattr(self.options, 'progressed_angle_method', posfordate.TRUE_SOLAR_ARC_LON)
		return posfordate.progression_chart_angle_method(chrt, default=default)

	def _progression_day_type_for_chart(self, chrt):
		default = getattr(self.options, 'progression_day_type', posfordate.PROGRESSION_DAY_TYPE_Q2)
		return posfordate.progression_chart_day_type(chrt, default=default)

	def _display_datetime_to_datetime(self, display_dt):
		if display_dt is None:
			return None
		try:
			parts = tuple(int(value) for value in tuple(display_dt)[:6])
			if len(parts) < 6:
				return None
			return datetime.datetime(*parts)
		except Exception:
			return None

	def _datetime_to_display_tuple(self, dt_value):
		if dt_value is None:
			return None
		if isinstance(dt_value, datetime.datetime):
			return (
				dt_value.year,
				dt_value.month,
				dt_value.day,
				dt_value.hour,
				dt_value.minute,
				dt_value.second,
			)
		try:
			parts = tuple(int(v) for v in tuple(dt_value)[:6])
			if len(parts) < 6:
				return None
			return parts
		except Exception:
			return None

	def _zone_adjusted_datetime(self, y, m, d, h, mi, s, plus, zh, zm, daylight=False):
		try:
			base = datetime.datetime(int(y), int(m), int(d), int(h), int(mi), int(s))
			offset = datetime.timedelta(hours=int(zh), minutes=int(zm))
			if bool(daylight):
				offset += datetime.timedelta(hours=1)
			if bool(plus):
				local_dt = base + offset
			else:
				local_dt = base - offset
			return (
				local_dt.year,
				local_dt.month,
				local_dt.day,
				local_dt.hour,
				local_dt.minute,
				local_dt.second,
			)
		except Exception:
			return (int(y), int(m), int(d), int(h), int(mi), int(s))

	def _revolution_display_datetime(self, radix, y, m, d, h, mi, s, plus=None, zh=None, zm=None, daylight=None):
		"""Delegates to the canonical Moment normalizer (engine/moment,
		policy-chart-lifecycle §1): tzid → geonames coordinate fallback →
		static zone offset, with the same override semantics this helper
		always had. GREENWICH may be calculation storage for returns, but
		visible display still resolves to local civil time."""
		return moment.utc_to_chart_local(
			getattr(radix, 'time', None),
			(y, m, d, h, mi, s),
			place=getattr(radix, 'place', None),
			plus=plus, zh=zh, zm=zm, daylight=daylight,
		)

	def _workspace_compact_datetime_text(self, y, m, d, h, mi, s=0):
		if getattr(self.options, 'showseconds', True):
			return '%04d.%02d.%02d %02d:%02d:%02d' % (
				int(y), int(m), int(d), int(h), int(mi), int(s),
			)
		return '%04d.%02d.%02d %02d:%02d' % (
			int(y), int(m), int(d), int(h), int(mi),
		)

	def _workspace_timed_label(self, prefix, y, m, d, h, mi, s=0):
		return '%s (%s)' % (prefix, self._workspace_compact_datetime_text(y, m, d, h, mi, s))

	def _get_configured_solar_return_year(self, reference_dt=None, radix=None):
		now = reference_dt if reference_dt is not None else datetime.datetime.now()
		if radix is None:
			radix = self._active_radix_chart()
		if radix is None or getattr(radix, 'time', None) is None:
			return int(now.year)
		natal_month = int(getattr(radix.time, 'month', now.month))
		natal_day = int(getattr(radix.time, 'day', now.day))
		active_year = int(now.year)
		if (int(now.month), int(now.day)) < (natal_month, natal_day):
			active_year -= 1
		if getattr(self.options, 'revolutions_solaryearmode', 0) == 1:
			return active_year + 1
		return active_year

	def _find_solar_longitude_revolution_seed(self, radix, start_dt, end_dt, target_lon):
		year = int(start_dt.year)
		month = int(start_dt.month)
		for _ in range(14):
			trs = transits.Transits()
			trs.month(year, month, radix, astrology.SE_SUN, pos=float(target_lon))
			for tr in trs.transits:
				hour, minute, second = util.decToDeg(tr.time)
				candidate_dt = datetime.datetime(
					int(year), int(month), int(tr.day), int(hour), int(minute), int(second)
				)
				if candidate_dt < start_dt:
					continue
				if end_dt is not None and candidate_dt >= end_dt:
					continue
				return (int(year), int(month), int(tr.day), int(hour), int(minute), int(second))
			year, month = util.incrMonth(year, month)
		return None

	def _build_solar_revolution_chart_for_year(self, radix, target_year):
		revs = revolutions.Revolutions()
		ok = revs.compute(revolutions.Revolutions.SOLAR, int(target_year), radix.time.month, radix.time.day, radix)
		if not ok:
			return (None, None, None, None)

		t1, t2, t3, t4, t5, t6 = revs.t[0], revs.t[1], revs.t[2], revs.t[3], revs.t[4], revs.t[5]
		if self.options.ayanamsha != 0:
			try:
				t1, t2, t3, t4, t5, t6 = self.calcPrecNutCorrectedRevolution(revs, astrology.SE_SUN)
			except Exception:
				pass

		place = radix.place
		plus = True
		zh = getattr(radix.time, 'zh', 0)
		zm = getattr(radix.time, 'zm', 0)
		daylight = getattr(radix.time, 'daylightsaving', False)
		if self.options.ayanamsha != 0:
			try:
				t1, t2, t3, t4, t5, t6 = self.calcPrecNutCorrectedRevolution(
					revs, astrology.SE_SUN, topo_place=place, seed=(t1, t2, t3, t4, t5, t6)
				)
			except Exception:
				pass

		time = chart.Time(t1, t2, t3, t4, t5, t6, False, radix.time.cal, chart.Time.GREENWICH, plus, 0, 0, False, place, False)
		revolution = chart_factory.build_chart(radix.name, radix.male, time, place, chart.Chart.SOLAR, '', self.options, False)
		display_dt = self._revolution_display_datetime(radix, t1, t2, t3, t4, t5, t6, plus=plus, zh=zh, zm=zm, daylight=daylight)
		label = self._workspace_timed_label(mtexts.typeList[chart.Chart.SOLAR], display_dt[0], display_dt[1], display_dt[2], display_dt[3], display_dt[4], display_dt[5])
		return (revolution, label, display_dt, {'place': place, 'plus': plus, 'base_year': t1, 'zh': zh, 'zm': zm, 'daylight': daylight})

	def _build_solar_revolution_step_chart(self, radix, base_year, place, plus, zh=0, zm=0, daylight=False, degree_offset=0):
		revs = revolutions.Revolutions()
		ok = revs.compute(revolutions.Revolutions.SOLAR, int(base_year), radix.time.month, radix.time.day, radix)
		if not ok:
			return (None, None)

		seed = tuple(int(v) for v in revs.t[:6])
		target_lon = None
		degree_offset = int(degree_offset)
		if degree_offset != 0:
			next_year_revs = revolutions.Revolutions()
			next_anchor_dt = None
			if next_year_revs.compute(revolutions.Revolutions.SOLAR, int(base_year) + 1, radix.time.month, radix.time.day, radix):
				next_anchor_dt = datetime.datetime(*[int(v) for v in next_year_revs.t[:6]])
			target_lon = util.normalize(
				float(radix.planets.planets[astrology.SE_SUN].data[planets.Planet.LONG]) + float(degree_offset)
			)
			seed = self._find_solar_longitude_revolution_seed(
				radix,
				datetime.datetime(*seed),
				next_anchor_dt,
				target_lon,
			)
			if seed is None:
				return (None, None)

		y, m, d, hh, mi, ss = seed
		if self.options.ayanamsha != 0:
			try:
				y, m, d, hh, mi, ss = self.calcPrecNutCorrectedRevolution(
					revs,
					astrology.SE_SUN,
					topo_place=place,
					seed=seed,
					target_lon_trop=target_lon,
					reference_chart=radix,
				)
			except Exception:
				pass

		time = chart.Time(y, m, d, hh, mi, ss, False, radix.time.cal, chart.Time.GREENWICH, plus, 0, 0, False, place, False)
		revolution = chart_factory.build_chart(radix.name, radix.male, time, place, chart.Chart.SOLAR, '', self.options, False)
		display_dt = self._revolution_display_datetime(
			radix,
			time.year, time.month, time.day, time.hour, time.minute, time.second,
			plus=plus,
			zh=zh,
			zm=zm,
			daylight=daylight,
		)
		return (revolution, display_dt)

	def _lunar_return_calc_chart(self, base_chart, radix_chart=None):
		if base_chart is None:
			return radix_chart if radix_chart is not None else self.horoscope
		if getattr(base_chart, 'htype', None) != chart.Chart.SOLAR:
			return base_chart
		if getattr(self.options, 'revolutions_lunarparentmode', 0) == 1:
			return base_chart
		if radix_chart is not None:
			return radix_chart
		return base_chart

	def _normalize_profections_source_datetime(self, radix, source_dt, snap_override=None):
		if radix is None or source_dt is None:
			return source_dt
		if snap_override is None:
			snap_enabled = bool(getattr(self.options, 'profections_solar_return_snap', False))
		else:
			snap_enabled = bool(snap_override)
		if not snap_enabled:
			return source_dt
		snapped = profectiontiming.completed_solar_return_datetime(radix, source_dt)
		if snapped is None:
			return source_dt
		return snapped

	def _build_profections_chart(self, base_chart, source_dt, current_chart=None, proftype=None, snap_override=None):
		source_dt = self._normalize_profections_source_datetime(base_chart, source_dt, snap_override=snap_override)
		y, m, d, h, mi, s = (
			source_dt.year,
			source_dt.month,
			source_dt.day,
			source_dt.hour,
			source_dt.minute,
			source_dt.second,
		)
		t = h + mi / 60.0 + s / 3600.0
		if proftype is None:
			proftype = getattr(current_chart, 'proftype', chart.Chart.YEAR)
		proftype = int(proftype)
		if self.options.zodprof:
			prof = profections.Profections(base_chart, y, m, d, t)
			if getattr(self.options, 'profwholesign', True):
				# "By sign" (Hellenistic whole-sign) annual profection: the ASC
				# jumps one whole sign per COMPLETED solar year and holds it until
				# the next return. Reuse the canonical Lord-of-the-Year basis
				# (lordofyear._completed_solar_years -> n*30deg) so the profected
				# wheel agrees with the radix corner's Lord of the Year exactly,
				# instead of the continuous Profections.offs drift (~30deg/yr).
				cursor_jd = lordofyear._tuple_to_jd(y, m, d, h, mi, s, base_chart)
				n = lordofyear._completed_solar_years(base_chart, cursor_jd)
				prof.offs = util.normalize(n * 30.0)
			pchart = chart_factory.build_chart(base_chart.name, base_chart.male, base_chart.time, base_chart.place, chart.Chart.PROFECTION, '', self.options, False, proftype)
			pchart.calcProfPos(prof)
		else:
			if (
				not self.options.usezodprojsprof
				and (y == base_chart.time.year or (y - base_chart.time.year) % 12 == 0)
				and m == base_chart.time.month
				and d == base_chart.time.day
			):
				pchart = base_chart
			else:
				prof = munprofections.MunProfections(base_chart, y, m, d, t)
				proflondeg, proflonmin, proflonsec = util.decToDeg(prof.lonZ)
				profplace = chart.Place(
					mtexts.txts['Profections'],
					proflondeg,
					proflonmin,
					proflonsec,
					prof.east,
					base_chart.place.deglat,
					base_chart.place.minlat,
					base_chart.place.seclat,
					base_chart.place.north,
					base_chart.place.altitude,
				)
				pchart = chart_factory.build_chart(base_chart.name, base_chart.male, base_chart.time, profplace, chart.Chart.PROFECTION, '', self.options, False, proftype, self.options.usezodprojsprof)
				pchartpls = chart_factory.build_chart(base_chart.name, base_chart.male, base_chart.time, base_chart.place, chart.Chart.PROFECTION, '', self.options, False, proftype, self.options.usezodprojsprof)
				pchart.apply_mundane_profection(pchartpls, base_chart.place.lat, base_chart.obl[0])
		display_dt = (y, m, d, h, mi, s)
		return (pchart, display_dt, t)

	def _supplementary_uses_session_cursor(self, feature_kind, chart_session=None):
		if feature_kind == 'parallel_transits':
			return True
		if feature_kind == 'transits':
			return False
		if feature_kind in (
			'solar_average',
			'secondary',
			'solar_arc',
			'minor',
			'tertiary',
			'profections',
			'solar_return',
			'lunar_return',
			'planetary_return',
		):
			return chart_session is not None and getattr(chart_session, 'display_datetime', None) is not None
		return False

	def _session_target_datetime_from_parent_refresh(self, session, source_dt):
		cs = session.get('chart_session') if session is not None else None
		current_child_dt = self._display_datetime_to_datetime(
			getattr(cs, 'display_datetime', None) if cs is not None else None
		)
		old_parent_dt = self._display_datetime_to_datetime(
			session.get('parent_source_datetime') if session is not None else None
		)
		new_parent_dt = source_dt if isinstance(source_dt, datetime.datetime) else self._display_datetime_to_datetime(source_dt)
		if current_child_dt is None or old_parent_dt is None or new_parent_dt is None:
			return self._datetime_to_display_tuple(source_dt)
		delta = current_child_dt - old_parent_dt
		return self._datetime_to_display_tuple(new_parent_dt + delta)

	def step_source_datetime(self, base_chart, source_dt, unit, delta):
		if unit not in ('day', 'hour', 'minute', 'second', 'week'):
			return None
		if base_chart is None or getattr(base_chart, 'time', None) is None:
			return None
		display_dt = self._datetime_to_display_tuple(source_dt)
		if display_dt is None:
			return None
		y, m, d, h, mi, s = display_dt
		t = base_chart.time
		step_info = chart.Time.step_datetime_fields(
			y, m, d, h, mi, s, unit, delta,
			t.bc, t.cal, t.zt, t.plus, t.zh, t.zm, t.daylightsaving,
			base_chart.place, tzid=getattr(t, 'tzid', ''),
		)
		return self._display_datetime_to_datetime(step_info['tuple'])

	def _active_chart_session(self):
		return None

	def _active_radix_chart(self):
		return self.horoscope

	def _debug_solar_child(self, _tag, **_payload):
		return None

	def _build_solar_average_for_radix(self, radix, max_birthday):
		# wx-free mirror of morin.MFrame._build_solar_average_for_radix
		# (morin.py:6191-6197). solaraverage.build_solar_average_chart is already
		# wx-free; calcPrecNutCorrectedRevolution lives on this driver.
		return solaraverage.build_solar_average_chart(
			radix,
			self.options,
			max_birthday=max_birthday,
			correction_cb=self.calcPrecNutCorrectedRevolution,
		)

	def _build_return_average_for_radix(self, radix, max_birthday, return_kind='solar'):
		return solaraverage.build_average_return_chart(
			radix,
			self.options,
			return_kind=return_kind,
			max_birthday=max_birthday,
			correction_cb=self.calcPrecNutCorrectedRevolution,
		)

	def _rebuild_workspace_solar_average_child(self, session, _current_chart, base_chart, _target_source_dt):
		# wx-free mirror of morin.MFrame._rebuild_workspace_solar_average_child
		# (morin.py:6949-6951). The wx host reads the ending age from a per-radix
		# view-state cache (default 84, morin.py:6120-6127, presets 28/56/84 at
		# :6118); headless reads it from the session intent with the same default.
		# Average Returns keeps the historic "solar_average" public kind but stores
		# the actual return type in retained_state['return_average_kind'].
		max_birthday = int(
			(session or {}).get('solar_average_max_birthday', solaraverage.DEFAULT_SOLAR_AVERAGE_BIRTHDAY)
		)
		retained = ((session or {}).get('supplementary_binding') or {}).get('retained_state') or {}
		return_kind = solaraverage.normalize_return_average_kind(
			retained.get('return_average_kind') or (session or {}).get('return_average_kind')
		)
		marr_feature_kind = 'lunar_average' if return_kind == solaraverage.RETURN_AVERAGE_LUNAR else 'solar_average'
		marr = supplementary_adapter.resolve_marr_retained(self.options, retained, marr_feature_kind)
		calc_base = supplementary_adapter.chart_with_marr_override(base_chart, marr_feature_kind, marr)
		return self._build_return_average_for_radix(calc_base, max_birthday, return_kind=return_kind)[:2]

	def calcPrecNutCorrectedRevolution(self, revs, planet_id, topo_place=None, seed=None, target_lon_trop=None, reference_chart=None):
		ref_chart = reference_chart if reference_chart is not None else self.horoscope
		place_nat = ref_chart.place
		place_trn = topo_place if topo_place is not None else place_nat

		if seed is not None:
			sy, sm, sd, sh, smin, ss = seed
		else:
			sy, sm, sd, sh, smin, ss = revs.t[0], revs.t[1], revs.t[2], revs.t[3], revs.t[4], revs.t[5]

		time0 = chart.Time(
			int(sy), int(sm), int(sd), int(sh), int(smin), int(ss),
			False, ref_chart.time.cal, chart.Time.GREENWICH,
			False, 0, 0, False, place_trn, False
		)
		jd = time0.jd

		astrology.swe_set_sid_mode(astrology.ayanamsha_swe_mode(self.options.ayanamsha), 0, 0)

		pflag = (astrology.SEFLG_SWIEPH | astrology.SEFLG_SPEED)
		if self.options.topocentric:
			pflag |= astrology.SEFLG_TOPOCTR

		def _wrap180(x):
			return (x + 180.0) % 360.0 - 180.0

		def _sid_lon_vel(jd_ut, pl):
			if self.options.topocentric:
				astrology.swe_set_topo(pl.lon, pl.lat, pl.altitude)

			_serr, dat = astrology.swe_calc_ut(jd_ut, planet_id, pflag)
			lon_trop = util.normalize(dat[0])
			vel_trop = dat[3]

			ay = astrology.swe_get_ayanamsa_ut(jd_ut)
			eps = 0.5
			ay_p = astrology.swe_get_ayanamsa_ut(jd_ut + eps)
			ay_m = astrology.swe_get_ayanamsa_ut(jd_ut - eps)
			ay_rate = _wrap180(ay_p - ay_m) / (2.0 * eps)

			lon_sid = util.normalize(lon_trop - ay)
			vel_sid = vel_trop - ay_rate
			return lon_sid, vel_sid

		if target_lon_trop is None:
			nat_lon_sid, _ = _sid_lon_vel(ref_chart.time.jd, place_nat)
		else:
			nat_lon_sid = util.normalize(float(target_lon_trop) - astrology.swe_get_ayanamsa_ut(ref_chart.time.jd))

		def _f(jd_ut):
			lon_sid, _ = _sid_lon_vel(jd_ut, place_trn)
			return _wrap180(nat_lon_sid - lon_sid)

		diff = _f(jd)
		for _ in range(80):
			if abs(diff) <= 1e-10:
				break
			_, vel_sid = _sid_lon_vel(jd, place_trn)
			if abs(vel_sid) < 1e-7:
				break

			step = diff / vel_sid
			if step > 30.0:
				step = 30.0
			elif step < -30.0:
				step = -30.0

			jd += step
			diff = _f(jd)

		if abs(diff) > 1e-8:
			_, vel_sid = _sid_lon_vel(jd, place_trn)
			span = 2.0 if abs(vel_sid) >= 0.3 else 40.0

			lo = jd - span
			hi = jd + span
			flo = _f(lo)
			fhi = _f(hi)

			for _ in range(12):
				if flo * fhi < 0.0:
					break
				span *= 2.0
				lo = jd - span
				hi = jd + span
				flo = _f(lo)
				fhi = _f(hi)

			if flo * fhi < 0.0:
				for _ in range(100):
					mid = (lo + hi) / 2.0
					fmid = _f(mid)
					if abs(fmid) <= 1e-10:
						jd = mid
						break
					if flo * fmid <= 0.0:
						hi = mid
						fhi = fmid
					else:
						lo = mid
						flo = fmid
					jd = (lo + hi) / 2.0

		_, vel_sid = _sid_lon_vel(jd, place_trn)
		if planet_id == astrology.SE_MOON:
			window = 900
		elif abs(vel_sid) < 0.05:
			window = 1200
		elif abs(vel_sid) < 0.3:
			window = 300
		else:
			window = 60

		jd0 = round(jd * 86400.0) / 86400.0
		best_jd = jd0
		best_abs = abs(_f(best_jd))
		for dt in range(-window, window + 1):
			jd_try = jd0 + (dt / 86400.0)
			value = abs(_f(jd_try))
			if value < best_abs:
				best_abs = value
				best_jd = jd_try
		jd = best_jd

		y, m, d, hour = astrology.swe_revjul(jd, astrology.SE_GREG_CAL)
		total = int(round(hour * 3600.0))
		if total >= 24 * 3600:
			total -= 24 * 3600
			y, m, d = util.incrDay(int(y), int(m), int(d))
		elif total < 0:
			total += 24 * 3600
			y, m, d = util.decrDay(int(y), int(m), int(d))

		hh = total // 3600
		total %= 3600
		mi = total // 60
		ss = total % 60

		return int(y), int(m), int(d), int(hh), int(mi), int(ss)
