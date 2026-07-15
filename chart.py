# -*- coding: utf-8 -*-

import math
import datetime
import astrology
import planets
import houses
import fixstars
import midpoints
import riseset
import asteroids
import zodpars
import antzodpars
import options
import hours
import almutens
import fortune
# ###########################################
# Roberto change – V 7.3.0
import firdaria
# ###########################################
import munfortune
import arabicparts
import antiscia
import customerpd
import syzygy
import util
import mtexts
import geonames
import common


# if long is 'E' or/and lat is 'S' -> negate value

class Time:
	"""Time of Birth.

	Attributes stored per instance:
	  year, month, day, hour, minute, second  — civil datetime components
	  bc        — True if BCE date
	  cal       — GREGORIAN or JULIAN calendar system
	  zt        — zone/time type (ZONE, GREENWICH, LOCALMEAN, LOCALAPPARENT)
	  plus      — True if timezone offset is positive (east of Greenwich)
	  zh, zm    — timezone hour and minute offset
	  daylightsaving — True if DST is active
	  tzid      — Olson timezone ID string (e.g. 'America/New_York'), or ''
	  tzauto    — True if timezone was auto-detected from coordinates
	"""

	# Calendar systems
	GREGORIAN = 0  # Gregorian calendar (modern, post-1582)
	JULIAN = 1     # Julian calendar (pre-1582 / historical dates)

	# Time interpretation modes (zt field)
	ZONE = 0            # Standard zone time: UTC + (zh:zm) offset supplied by user
	GREENWICH = 1       # Greenwich Mean Time / UTC: no offset applied
	LOCALMEAN = 2       # Local Mean Time: offset computed from geographic longitude
	LOCALAPPARENT = 3   # Local Apparent (True Solar) Time: includes equation of time

	HOURSPERDAY = 24.0

	@staticmethod
	def _gregorian_days_in_month(year, month):
		if month == 12:
			next_month = datetime.date(int(year) + 1, 1, 1)
		else:
			next_month = datetime.date(int(year), int(month) + 1, 1)
		return int((next_month - datetime.timedelta(days=1)).day)

	@classmethod
	def _calendar_shift_fields(cls, y, m, d, h, mi, s, unit, delta):
		y = int(y)
		m = int(m)
		d = int(d)
		h = int(h)
		mi = int(mi)
		s = int(s)
		delta = int(delta)
		if unit == 'second':
			step = abs(delta)
			for _ in range(step):
				if delta >= 0:
					y, m, d, h, mi, s = util.addSecs(y, m, d, h, mi, s, 1)
				else:
					y, m, d, h, mi, s = util.subtractSecs(y, m, d, h, mi, s, 1)
			return y, m, d, h, mi, s
		if unit == 'minute':
			step = abs(delta)
			for _ in range(step):
				if delta >= 0:
					y, m, d, h, mi = util.addMins(y, m, d, h, mi, 1)
				else:
					y, m, d, h, mi = util.subtractMins(y, m, d, h, mi, 1)
			return y, m, d, h, mi, s
		if unit == 'hour':
			step = abs(delta)
			for _ in range(step):
				if delta >= 0:
					y, m, d, h = util.addHour(y, m, d, h)
				else:
					y, m, d, h = util.subtractHour(y, m, d, h)
			return y, m, d, h, mi, s
		if unit == 'day':
			step = abs(delta)
			for _ in range(step):
				if delta >= 0:
					y, m, d = util.incrDay(y, m, d)
				else:
					y, m, d = util.decrDay(y, m, d)
			return y, m, d, h, mi, s
		if unit == 'week':
			return cls._calendar_shift_fields(y, m, d, h, mi, s, 'day', delta * 7)
		if unit == 'month':
			step = abs(delta)
			for _ in range(step):
				if delta >= 0:
					y, m = util.incrMonth(y, m)
				else:
					y, m = util.decrMonth(y, m)
			d = min(d, cls._gregorian_days_in_month(y, m))
			return y, m, d, h, mi, s
		if unit == 'year':
			y += delta
			d = min(d, cls._gregorian_days_in_month(y, m))
		return y, m, d, h, mi, s

	@classmethod
	def _resolved_zone_local_datetime(cls, y, m, d, h, mi, s, tzid, prefer_dst=None, direction=1):
		zoneinfo_cls = getattr(geonames, 'ZoneInfo', None)
		if not tzid or zoneinfo_cls is None:
			return None
		try:
			zone = zoneinfo_cls(tzid)
			naive_dt = datetime.datetime(int(y), int(m), int(d), int(h), int(mi), int(s))
		except Exception:
			return None

		candidates = []
		for fold in (0, 1):
			try:
				aware = naive_dt.replace(tzinfo=zone, fold=fold)
				roundtrip = aware.astimezone(datetime.timezone.utc).astimezone(zone)
				candidates.append((fold, aware, roundtrip))
			except Exception:
				continue

		valid = [item for item in candidates if item[2].replace(tzinfo=None) == naive_dt]
		if valid:
			if len(valid) == 1 or valid[0][1].utcoffset() == valid[-1][1].utcoffset():
				return valid[0][2]
			for item in valid:
				if bool(item[2].dst()) == bool(prefer_dst):
					return item[2]
			return valid[0][2] if direction >= 0 else valid[-1][2]

		if not candidates:
			return None
		sort_key = lambda item: item[2].astimezone(datetime.timezone.utc)
		chosen = max(candidates, key=sort_key) if direction >= 0 else min(candidates, key=sort_key)
		return chosen[2]

	@staticmethod
	def _zone_fields_from_local_datetime(local_dt):
		try:
			total_offset = local_dt.utcoffset()
			dst_offset = local_dt.dst()
		except Exception:
			return None
		if total_offset is None:
			return None
		if dst_offset is None:
			dst_offset = datetime.timedelta(0)
		total_minutes = int(total_offset.total_seconds() // 60)
		dst_minutes = int(dst_offset.total_seconds() // 60)
		standard_minutes = total_minutes - dst_minutes
		plus = standard_minutes >= 0
		absolute_minutes = abs(standard_minutes)
		return {
			'plus': plus,
			'zh': absolute_minutes // 60,
			'zm': absolute_minutes % 60,
			'daylightsaving': dst_minutes != 0,
		}

	@classmethod
	def step_datetime_fields(cls, y, m, d, h, mi, s, unit, delta, bc, cal, zt, plus, zh, zm, daylightsaving, place, tzid=''):
		direction = 1 if int(delta) >= 0 else -1
		if (not bc) and cal == Time.GREGORIAN and zt == Time.ZONE and place is not None and tzid:
			current_local = cls._resolved_zone_local_datetime(
				y, m, d, h, mi, s, tzid,
				prefer_dst=daylightsaving,
				direction=direction,
			)
			if current_local is not None:
				if unit in ('second', 'minute', 'hour'):
					if unit == 'second':
						step = datetime.timedelta(seconds=int(delta))
					elif unit == 'minute':
						step = datetime.timedelta(minutes=int(delta))
					else:
						step = datetime.timedelta(hours=int(delta))
					target_local = (current_local.astimezone(datetime.timezone.utc) + step).astimezone(current_local.tzinfo)
				else:
					target_fields = cls._calendar_shift_fields(
						current_local.year, current_local.month, current_local.day,
						current_local.hour, current_local.minute, current_local.second,
						unit, delta,
					)
					target_local = cls._resolved_zone_local_datetime(
						target_fields[0], target_fields[1], target_fields[2],
						target_fields[3], target_fields[4], target_fields[5],
						tzid,
						prefer_dst=bool(current_local.dst()),
						direction=direction,
					)
				if target_local is not None:
					resolved_zone = cls._zone_fields_from_local_datetime(target_local)
					if resolved_zone is not None:
						return {
							'tuple': (
								int(target_local.year), int(target_local.month), int(target_local.day),
								int(target_local.hour), int(target_local.minute), int(target_local.second),
							),
							'plus': resolved_zone['plus'],
							'zh': resolved_zone['zh'],
							'zm': resolved_zone['zm'],
							'daylightsaving': resolved_zone['daylightsaving'],
						}

		target_fields = cls._calendar_shift_fields(y, m, d, h, mi, s, unit, delta)
		return {
			'tuple': tuple(int(v) for v in target_fields),
			'plus': plus,
			'zh': zh,
			'zm': zm,
			'daylightsaving': daylightsaving,
		}

	def __init__(self, year, month, day, hour, minute, second, bc, cal, zt, plus, zh, zm, daylightsaving, place, full = True, tzid='', tzauto=False): #zt is zonetime, zh is zonehour, zm is zoneminute, full means to calculate everything e.g. FixedStars, MidPoints, ...
		self.tzid = tzid or ''
		self.tzauto = bool(tzauto)
		if self.tzauto and (not bc) and cal == Time.GREGORIAN and zt == Time.ZONE:
			resolved_zone = geonames.Geonames.resolve_zone_fields(year, month, day, hour, minute, second, place, self.tzid)
			if resolved_zone is not None:
				plus = resolved_zone['plus']
				zh = resolved_zone['zh']
				zm = resolved_zone['zm']
				daylightsaving = resolved_zone['daylightsaving']
				self.tzid = resolved_zone['tzid']

		self.year = year
		self.month = month
		self.day = day
		self.origyear = year
		self.origmonth = month
		self.origday = day
		self.hour = hour
		self.minute = minute
		self.second = second
		self.bc = bc
		self.cal = cal
		self.zt = zt
		self.plus = plus
		self.zh = zh
		self.zm = zm
		self.daylightsaving = daylightsaving

		self.time = hour+minute/60.0+second/3600.0

		self.dyear, self.dmonth, self.dday, self.dhour, self.dmin, self.dsec = year, month, day, hour, minute, second
		if self.daylightsaving:
			self.time -= 1.0
			self.dhour -= 1
		#check daylightsaving underflow
		if self.time < 0.0:
			self.time += Time.HOURSPERDAY
			self.year, self.month, self.day = util.decrDay(self.year, self.month, self.day)
			self.dhour += int(Time.HOURSPERDAY)
			self.dyear, self.dmonth, self.dday = self.year, self.month, self.day
			
		if zt == Time.ZONE:#ZONE
			ztime = zh+zm/60.0
			if self.plus:
				self.time-=ztime
			else:
				self.time+=ztime
		elif zt == Time.LOCALMEAN:#LMT
			t = (place.deglon+place.minlon/60.0)*4.0 #long * 4min
			if place.east:
				self.time-=t/60.0
			else:
				self.time+=t/60.0	

		if bc:
			self.year = 1-self.year

		#check over/underflow
		if self.time >= Time.HOURSPERDAY:
			self.time -= Time.HOURSPERDAY
			self.year, self.month, self.day = util.incrDay(self.year, self.month, self.day)
		elif self.time < 0.0:
			self.time += Time.HOURSPERDAY
			self.year, self.month, self.day = util.decrDay(self.year, self.month, self.day)

		calflag = astrology.SE_GREG_CAL
		if self.cal == Time.JULIAN:
			calflag = astrology.SE_JUL_CAL
		self.jd = astrology.swe_julday(self.year, self.month, self.day, self.time, calflag)

		if zt == Time.LOCALAPPARENT:#LAT
			ret, te, serr = astrology.swe_time_equ(self.jd)
			self.jd += te #LMT
			#Back to h,m,s(self.time) from julianday fromat
			self.year, self.month, self.day, self.time = astrology.swe_revjul(self.jd, calflag)
			#To GMT
			t = (place.deglon+place.minlon/60.0)*4.0 #long * 4min
			if place.east:
				self.time-=t/60.0
			else:
				self.time+=t/60.0	

			#check over/underflow
			if self.time >= Time.HOURSPERDAY:
				self.time -= Time.HOURSPERDAY
				self.year, self.month, self.day = util.incrDay(self.year, self.month, self.day)
			elif self.time < 0.0:
				self.time += Time.HOURSPERDAY
				self.year, self.month, self.day = util.decrDay(self.year, self.month, self.day)

			#GMT in JD (julianday)
			self.jd = astrology.swe_julday(self.year, self.month, self.day, self.time, calflag)

		self.sidTime = astrology.swe_sidtime(self.jd) #GMT

		self.ph = None
		if full:
			self.calcPHs(place)

		self.profy = None
		self.profm = None
		self.profd = None
		self.profho = None
		self.profmi = None
		self.profse = None


	def calcPHs(self, place):
		#Planetary day/hour calculation
		#self.weekday = datetime.datetime(self.dyear, self.dmonth, self.dday, self.dhour, self.dmin, self.dsec).weekday()#only daylightsaving was subtracted
		lon = place.deglon+place.minlon/60.0
		if not place.east:
			lon *= -1
		lat = place.deglat+place.minlat/60.0
		if not place.north:
			lat *= -1
			
		if self.zt == Time.ZONE:  # 표준시
			tz_hours = (1 if self.plus else -1) * (self.zh + self.zm/60.0) + (1.0 if self.daylightsaving else 0.0)
		elif self.zt == Time.GREENWICH:  # GMT
			tz_hours = 0.0
		elif self.zt == Time.LOCALMEAN:  # LMT
			tz_hours = place.lon / 15.0
		else:  # Time.LOCALAPPARENT (LAT = LMT + 방정시)
			ret, te, serr = astrology.swe_time_equ(self.jd)  # te: day 단위
			tz_hours = (place.lon / 15.0) + te*24.0

		# --- JD 기반 요일 계산 (달력 독립, Monday=0 ... Sunday=6)
		# tz_hours: 현지시 오프셋(시간) → 일수로 환산해 로컬 JD를 만든다
		offs = float(tz_hours) / 24.0
		jd_local = self.jd + offs
		# JD는 정오 기준 증가하므로 +0.5로 자정 경계를 맞춘 뒤 요일 산출
		self.weekday = int(math.floor(jd_local + 0.5)) % 7
		# --- 끝

		self.ph = hours.PlanetaryHours(lon, lat, place.altitude, self.weekday, self.jd, tz_hours)

		
class Place:
	"""Place of Birth"""

	def __init__(self, place, deglon, minlon, seclon, east, deglat, minlat, seclat, north, altitude):
		self.place = place	

		self.deglon = deglon
		self.minlon = minlon
		self.seclon = seclon
		self.east = east	

		self.deglat = deglat
		self.minlat = minlat
		self.seclat = seclat
		self.north = north

		self.altitude = altitude

		self.lon = deglon+minlon/60.0+seclon/3600.0
		self.lat = deglat+minlat/60.0+seclat/3600.0

		if not self.north:
			self.lat *= -1.0

		if not self.east:
			self.lon *= -1.0


class Asp:
	def __init__(self):
		self.typ = Chart.NONE
		self.dif = 0.0
		self.aspdif = 0.0
		self.appl = False
		self.parallel = Chart.NONE
		self.exact = False
		self.max_orb = 0.0


class BodyProxy:
	def __init__(self, data, dataEqu):
		self.data = data
		self.dataEqu = dataEqu


class Chart:
	"""Represents a horoscope"""

	#types
	RADIX = 0
	SOLAR = 1
	LUNAR = 2
	REVOLUTION = 3
	TRANSIT = 4
	HORARY = 5
	PROFECTION = 6
	PDINCHART = 7
	COMPOSITE = 8      # Symbolic midpoint composite (no real session cursor)
	RELATIONSHIP = 9   # Real-time relationship composite (Davison, with session cursor)
	# NOTE: COMPOSITE is the ONLY chart type without a real session cursor.
	# It cannot be navigated, stepped, used as synastry center, or converted to transits.
	# RELATIONSHIP (e.g., Davison) has real time and behaves like other real-time charts.

	SIGN_NUM = 12
	SIGN_DEG = 30

	ARIES = 0
	TAURUS = 1
	GEMINI = 2
	CANCER = 3
	LEO = 4
	VIRGO = 5
	LIBRA = 6
	SCORPIO = 7
	SAGITTARIUS = 8
	CAPRICORNUS = 9
	AQUARIUS = 10
	PISCES = 11

	NONE = -1
	CONJUNCTIO = 0
	SEMISEXTIL = 1
	SEMIQUADRAT = 2
	SEXTIL = 3
	QUINTILE = 4
	QUADRAT = 5
	TRIGON = 6
	SESQUIQUADRAT = 7
	BIQUINTILE = 8
	QUINQUNX = 9
	OPPOSITIO = 10
	SEPTILE = 11
	PARALLEL = 12
	CONTRAPARALLEL = 13

	RAPTPAR = 14
	RAPTCONTRAPAR = 15
	MIDPOINT = 16

	DOMICIL = 0
	EXAL = 1
	PEREGRIN = 2
	CASUS = 3
	EXIL = 4

	# Septile = 360°/7 ≈ 51.428571° — placed at end of the ecliptic-aspect block
	# so prior indices for the 11 classical/Ptolemaic aspects are unchanged.
	Aspects = [0.0, 30.0, 45.0, 60.0, 72.0, 90.0, 120.0, 135.0, 144.0, 150.0, 180.0, 360.0/7.0]
	ASPECT_NUM = 12

	TRANSURANUS = 0
	TRANSNEPTUNE = 1
	TRANSPLUTO = 2

	#Speculums
	PLACIDIAN = 0
	REGIOMONTAN = 1

	#Lot of Fortune
	LFMOONSUN = 0
	LFDSUNMOON = 1
	LFDMOONSUN = 2
	
	def_fixstarsorb = 1.5	

	#Profections
	YEAR, MONTH, DAY = range(0, 3)

	def __init__(self, name, male, time, place, htype, notes, options, full = True, proftype = 0, nolat=False):
		common.ensure_swe_ready()
		self.name = name
		self.male = male
		self.time = time
		self.place = place
		self.htype = htype
		self.notes = notes
		self.options = options
		self.full = full
		self.proftype = proftype
		self.nolat = nolat

		d = astrology.swe_deltat(time.jd)
		serr, self.obl  = astrology.swe_calc(time.jd+d, astrology.SE_ECL_NUT, 0)
		#true obliquity of the ecliptic
		#mean
		#nutation in long
		#nutation in obl

		astrology.swe_set_topo(place.lon, place.lat, place.altitude)

		self.create()


	def create(self):
		common.ensure_swe_ready()
		astrology.swe_set_topo(self.place.lon, self.place.lat, self.place.altitude)
		pflag, hflag, fsflag, astflag = self._zodiac_flags()

		self.houses = houses.Houses(self.time.jd, hflag, self.place.lat, self.place.lon, self.options.hsys, self.obl[0], self.options.ayanamsha, self.ayanamsha)

		# EquAsc is intrinsic to the chart's geometry; like ASC/MC, its
		# RA is frame-independent, so cotrans needs a tropical lon.
		self.raequasc, declequasc, dist = astrology.swe_cotrans(util.to_tropical_lon(self.houses.ascmc[houses.Houses.EQUASC], self.ayanamsha_offset), 0.0, 1.0, -self.obl[0])
		self.planets = planets.Planets(self.time.jd, self.options.meannode, pflag, self.place.lat, self.houses.ascmc2, self.raequasc, self.nolat, self.obl[0])
		self.chiron = planets.Planet(self.time.jd, astrology.SE_CHIRON, pflag, self.place.lat, self.houses.ascmc2, self.raequasc, None, None, self.nolat, self.obl[0])

		self.abovehorizonwithorb = self.isAboveHorizonWithOrb()

		abovehor = self.planets.planets[astrology.SE_SUN].abovehorizon
		if self.options.usedaynightorb:
			abovehor = self.abovehorizonwithorb

		self.fortune = fortune.Fortune(self.options.lotoffortune, self.houses.ascmc2, self.raequasc, self.planets, self.obl[0], self.place.lat, abovehor, self.ayanamsha_offset)

# ###########################################
# Roberto change  V 7.3.0		
		self.firdaria = None
# ###########################################		
		self.munfortune = None
		# Asteroids are cheap (12 swe_calc_ut_ex calls) and required by the
		# outer ring on derived charts too (solar/lunar returns, transits),
		# so compute unconditionally rather than gating on `full`.
		self.asteroids = asteroids.Asteroids(self.time.jd, pflag, self.place.lat, self.houses.ascmc2)
		self.parts = None
		self.fixstars = None
		self.midpoints = None
		self.riseset = None
		self.zodpars = None
		self.antiscia = None
		self.antzodpars = None
		self.cpd = None
		self.cpd2 = None
		self.syzygy = None
		self.almutens = None
		mdsun = self.planets.planets[astrology.SE_SUN].speculums[0][planets.Planet.MD]
		sasun = self.planets.planets[astrology.SE_SUN].speculums[0][planets.Planet.SA]
		if self.full:
# ###########################################
# Roberto change  V 7.3.0		
			self.firdaria = firdaria.Firdaria(self.time.origyear, self.time.origmonth, self.time.origday, self.options, self.abovehorizonwithorb)
# ###########################################
			self.munfortune = munfortune.MundaneFortune(self.options.lotoffortune, self.houses.ascmc2, self.planets, self.obl[0], self.place.lat, abovehor)
			self.syzygy = syzygy.Syzygy(self)
			self.parts = arabicparts.ArabicParts(self.options.arabicparts, self.houses.ascmc, self.planets, self.houses, self.houses.cusps, self.fortune, self.syzygy, self.options, self.ayanamsha, self.male)
			self.fixstars = fixstars.FixStars(
				self.time.jd,
				fsflag,
				self.options.fixstars,
				self.obl[0],
				self.ayanamsha_offset,
			)
			self.midpoints = midpoints.MidPoints(self.planets, chiron=self.chiron)
			# 차트의 시간 설정을 그대로 따른다 (ZONE / GREENWICH / LMT / LAT)
			if self.time.zt == Time.ZONE:  # 표준시
				tz_hours = (1 if self.time.plus else -1) * (self.time.zh + self.time.zm/60.0) + (1.0 if self.time.daylightsaving else 0.0)
			elif self.time.zt == Time.GREENWICH:  # GMT
				tz_hours = 0.0
			elif self.time.zt == Time.LOCALMEAN:  # LMT = 경도/15h (동경 +, 서경 -)
				tz_hours = self.place.lon / 15.0
			else:  # Time.LOCALAPPARENT (LAT) = LMT + 방정시
				_, te, _ = astrology.swe_time_equ(self.time.jd)  # te는 '일(day)' 단위
				tz_hours = (self.place.lon / 15.0) + te*24.0     # 시간을 시(hour) 단위로

			self.riseset = riseset.RiseSet(self.time.jd, self.time.cal, self.place.lon, self.place.lat, self.place.altitude, tz_hours, self.planets)

			self.zodpars = zodpars.ZodPars(self.planets, self.obl[0])
			self.antiscia = antiscia.Antiscia(self.planets.planets, self.houses.ascmc, self.fortune.fortune, self.obl[0], self.options.ayanamsha, self.ayanamsha_offset, morin_antiscia=getattr(self.options, 'morin_antiscia', False))
			self.antzodpars = antzodpars.AntZodPars(self.antiscia.plantiscia, self.antiscia.plcontraant, self.obl[0])
			if self.time.ph is None:
				self.time.calcPHs(self.place)
			self.almutens = almutens.Almutens(self)
			if self.options.pdcustomer:
				self.cpd = customerpd.CustomerPD(self.options.pdcustomerlon[0], self.options.pdcustomerlon[1], self.options.pdcustomerlon[2], self.options.pdcustomerlat[0], self.options.pdcustomerlat[1], self.options.pdcustomerlat[2], self.options.pdcustomersouthern, self.place.lat, self.houses.ascmc2, self.obl[0], self.raequasc)
			if self.options.pdcustomer2:
				self.cpd2 = customerpd.CustomerPD(self.options.pdcustomer2lon[0], self.options.pdcustomer2lon[1], self.options.pdcustomer2lon[2], self.options.pdcustomer2lat[0], self.options.pdcustomer2lat[1], self.options.pdcustomer2lat[2], self.options.pdcustomer2southern, self.place.lat, self.houses.ascmc2, self.obl[0], self.raequasc)
			self.pd_arabic_part_prom = self._get_pd_arabic_part_promissor_point()
			self.pd_arabic_part_sig = self._get_pd_arabic_part_significator_point()

		astrology.swe_close()

		self.calcAspMatrix()

		if self.fixstars != None:
			self.calcFixStarAspMatrix()

	def rebuildFixStars(self):
		if self.fixstars is not None:
			del self.fixstars
		common.ensure_swe_ready()
		_pflag, _hflag, fsflag, _astflag = self._zodiac_flags()
		self.fixstars = fixstars.FixStars(
			self.time.jd,
			fsflag,
			self.options.fixstars,
			self.obl[0],
			self.ayanamsha_offset,
		)
		if self.fixstars is not None:
			self.calcFixStarAspMatrix()

	def rebuildRiseSet(self):
		if self.planets is None:
			self.riseset = None
			return None

		if self.time.zt == Time.ZONE:
			tz_hours = (1 if self.time.plus else -1) * (self.time.zh + self.time.zm/60.0) + (1.0 if self.time.daylightsaving else 0.0)
		elif self.time.zt == Time.GREENWICH:
			tz_hours = 0.0
		elif self.time.zt == Time.LOCALMEAN:
			tz_hours = self.place.lon / 15.0
		else:
			_, te, _ = astrology.swe_time_equ(self.time.jd)
			tz_hours = (self.place.lon / 15.0) + te*24.0

		self.riseset = riseset.RiseSet(self.time.jd, self.time.cal, self.place.lon, self.place.lat, self.place.altitude, tz_hours, self.planets)
		return self.riseset

	def _zodiac_flags(self):
		"""Single source of truth for SwissEph flag construction.

		Returns ``(pflag, hflag, fsflag, astflag)`` and refreshes two
		attributes that encode the ayanamsha invariant for every
		downstream consumer:

		**``self.ayanamsha = 0.0`` (always).** Historical meaning of
		this attribute was "subtract this from a tropical longitude to
		get sidereal." After this helper sets ``SEFLG_SIDEREAL`` on the
		SwissEph flag, the conversion happens at the SwissEph boundary,
		so the residual offset is zero. The codebase still has roughly
		60 inherited consumer sites doing ``lon -= chrt.ayanamsha`` or
		``util.normalize(lon - chrt.ayanamsha)`` — those degrade
		correctly to no-ops because this attribute is now always 0, but
		they no longer do anything useful and should not be relied upon
		when writing new code. The attribute is preserved purely so
		existing call sites keep working without a sweeping rewrite.

		**``self.ayanamsha_offset`` carries the real value** in degrees
		at this chart's JD (0.0 in tropical mode, ~24° in modern
		sidereal modes). This is what to use for:

		- JSON / chart-record serialisation
		- UI display ("Ayanamsha: Lahiri 24.18°")
		- Tropical recovery before ``swe_cotrans`` (use
		  ``util.to_tropical_lon(lon, chrt.ayanamsha_offset)``)
		- ``antiscia`` solstitial-axis mirror geometry
		- ``manazil.resolve_lon``'s tropical-input contract
		- Primary-direction term-arc cotransformation

		Anything that needs to derive a sign from a longitude can do
		so directly: ``planets.data[LONG]`` and ``houses.cusps[]`` are
		already in the chart's chosen zodiac post-helper, so
		``int(lon // 30) % 12`` is the correct sign in both modes.

		See ``doc/ayanamsha-test-plan.md`` for the full invariant
		battery and ``tests/test_ayanamsha_intrinsics.py`` for the
		automated regression guard.
		"""
		pflag = astrology.SEFLG_SWIEPH | astrology.SEFLG_SPEED
		hflag = 0
		fsflag = 0
		astflag = astrology.SEFLG_SWIEPH
		self.ayanamsha = 0.0
		self.ayanamsha_offset = 0.0
		if self.options.ayanamsha != 0:
			astrology.swe_set_sid_mode(astrology.ayanamsha_swe_mode(self.options.ayanamsha), 0, 0)
			self.ayanamsha_offset = astrology.swe_get_ayanamsa_ut(self.time.jd)
			pflag |= astrology.SEFLG_SIDEREAL
			hflag |= astrology.SEFLG_SIDEREAL
			fsflag |= astrology.SEFLG_SIDEREAL
			astflag |= astrology.SEFLG_SIDEREAL
		if self.options.topocentric:
			pflag |= astrology.SEFLG_TOPOCTR
		return pflag, hflag, fsflag, astflag

	def _planet_calc_flag(self):
		pflag, _hflag, _fsflag, _astflag = self._zodiac_flags()
		return pflag

	def _rebuild_dynamic_chart_bodies(self, pflag):
		self.chiron = planets.Planet(
			self.time.jd,
			astrology.SE_CHIRON,
			pflag,
			self.place.lat,
			self.houses.ascmc2,
			self.raequasc,
			None,
			None,
			self.nolat,
			self.obl[0],
		)

	def _rebuild_cached_mundane_fortune(self, abovehor):
		if self.munfortune == None:
			return
		self.munfortune = munfortune.MundaneFortune(
			self.options.lotoffortune,
			self.houses.ascmc2,
			self.planets,
			self.obl[0],
			self.place.lat,
			abovehor,
		)

	def _rebuild_cached_customer_pd_point(self, point):
		if point == None:
			return None
		try:
			if point.londeg is None or point.latdeg is None:
				return point
			return customerpd.CustomerPD(
				point.londeg, point.lonmin, point.lonsec,
				point.latdeg, point.latmin, point.latsec,
				point.southern,
				self.place.lat,
				self.houses.ascmc2,
				self.obl[0],
				self.raequasc,
			)
		except Exception:
			return point

	def _apply_house_geometry(self, houses_obj, materialize_optional=False):
		if houses_obj == None:
			return
		self.houses = houses_obj
		try:
			# EquAsc RA is frame-independent; recover tropical for cotrans.
			self.raequasc, _declequasc, _dist = astrology.swe_cotrans(
				util.to_tropical_lon(
					self.houses.ascmc[houses.Houses.EQUASC],
					getattr(self, 'ayanamsha_offset', 0.0),
				),
				0.0, 1.0, -self.obl[0],
			)
		except Exception:
			pass

		common.ensure_swe_ready()
		astrology.swe_set_topo(self.place.lon, self.place.lat, self.place.altitude)
		pflag = self._planet_calc_flag()
		self.planets = planets.Planets(
			self.time.jd,
			self.options.meannode,
			pflag,
			self.place.lat,
			self.houses.ascmc2,
			self.raequasc,
			self.nolat,
			self.obl[0],
		)
		self._rebuild_dynamic_chart_bodies(pflag)

		self.abovehorizonwithorb = self.isAboveHorizonWithOrb()
		abovehor = self.planets.planets[astrology.SE_SUN].abovehorizon
		if self.options.usedaynightorb:
			abovehor = self.abovehorizonwithorb

		self.calcFortune()
		self._rebuild_cached_mundane_fortune(abovehor)
		if self.firdaria != None:
			self.firdaria = firdaria.Firdaria(
				self.time.origyear,
				self.time.origmonth,
				self.time.origday,
				self.options,
				self.abovehorizonwithorb,
			)

		self.calcAspMatrix()
		if self.fixstars != None:
			self.calcFixStarAspMatrix()

		refresh_antiscia = materialize_optional or self.antiscia != None
		if refresh_antiscia:
			self.calcAntiscia()
			if self.antzodpars != None and self.antiscia != None:
				self.antzodpars = antzodpars.AntZodPars(
					self.antiscia.plantiscia,
					self.antiscia.plcontraant,
					self.obl[0],
				)

		refresh_parts = (
			materialize_optional
			or self.parts != None
			or getattr(self, 'pd_arabic_part_prom', None) != None
			or getattr(self, 'pd_arabic_part_sig', None) != None
		)
		if refresh_parts:
			self.calcArabicParts()

		if self.cpd != None:
			self.cpd = self._rebuild_cached_customer_pd_point(self.cpd)
		if self.cpd2 != None:
			self.cpd2 = self._rebuild_cached_customer_pd_point(self.cpd2)
		self.pd_arabic_part_prom = self._get_pd_arabic_part_promissor_point()
		self.pd_arabic_part_sig = self._get_pd_arabic_part_significator_point()

		if materialize_optional or self.almutens != None:
			self.recalcAlmutens()

	def setHouseSystem(self):
		_pflag, hflag, _fsflag, _astflag = self._zodiac_flags()
		self._apply_house_geometry(
			houses.Houses(
				self.time.jd,
				hflag,
				self.place.lat,
				self.place.lon,
				self.options.hsys,
				self.obl[0],
				self.options.ayanamsha,
				self.ayanamsha,
			),
			materialize_optional=self.full,
		)


	def setNodes(self):
		# Same SwissEph flag construction as chart.create() — sidereal
		# mode comes back baked into planet longitudes when an
		# ayanamsha is selected.
		pflag, _hflag, _fsflag, _astflag = self._zodiac_flags()
		self.planets = planets.Planets(self.time.jd, self.options.meannode,
									pflag, self.place.lat, self.houses.ascmc2,
									self.raequasc, self.nolat, self.obl[0])

	def calcFortune(self):
		del self.fortune
		self.abovehorizonwithorb = self.isAboveHorizonWithOrb()

		abovehor = self.planets.planets[astrology.SE_SUN].abovehorizon
		if self.options.usedaynightorb:
			abovehor = self.abovehorizonwithorb

		self.fortune = fortune.Fortune(self.options.lotoffortune, self.houses.ascmc2, self.raequasc, self.planets, self.obl[0], self.place.lat, abovehor, getattr(self, 'ayanamsha_offset', 0.0))
		self.calcLoFAspMatrix()


	def isAboveHorizonWithOrb(self):
		mdsun = self.planets.planets[astrology.SE_SUN].speculums[0][planets.Planet.MD]
		sasun = self.planets.planets[astrology.SE_SUN].speculums[0][planets.Planet.SA]
		abovehorizon = self.planets.planets[astrology.SE_SUN].abovehorizon
#		mdsun = self.planets.planets[planets.Planets.SUN].speculums[planets.Planet.PLACIDIAN].speculum[placspec.PlacidianSpeculum.MD]
#		sasun = self.planets.planets[planets.Planets.SUN].speculums[planets.Planet.PLACIDIAN].speculum[placspec.PlacidianSpeculum.SA]
#		abovehorizon = self.planets.planets[planets.Planets.SUN].speculums[planets.Planet.PLACIDIAN].abovehorizon

		if not abovehorizon:
			if mdsun < 0.0:
				mdsun += 180.0
			if sasun < 0.0:
				sasun += 180.0

			orb = self.options.daynightorbdeg+self.options.daynightorbmin/60.0
			if mdsun-orb < sasun:
				abovehorizon = True			

		return abovehorizon


	def calcSyzygy(self):
		if self.syzygy != None:
			del self.syzygy
		self.syzygy = syzygy.Syzygy(self)


	def calcArabicParts(self):
		if self.parts != None:
			del self.parts
		if self.syzygy == None:
			try:
				self.calcSyzygy()
			except Exception:
				self.syzygy = None
		if self.syzygy == None:
			self.parts = None
			return
		self.parts = arabicparts.ArabicParts(self.options.arabicparts, self.houses.ascmc, self.planets, self.houses, self.houses.cusps, self.fortune, self.syzygy, self.options, self.ayanamsha, self.male)


	def calcAntiscia(self):
		if self.antiscia != None:
			del self.antiscia
		self.antiscia = antiscia.Antiscia(self.planets.planets, self.houses.ascmc, self.fortune.fortune, self.obl[0], self.options.ayanamsha, self.ayanamsha_offset, morin_antiscia=getattr(self.options, 'morin_antiscia', False))


	def calcMidPoints(self):
		if self.midpoints != None:
			del self.midpoints
		self.midpoints = midpoints.MidPoints(self.planets, chiron=self.chiron)

	def _get_desc_node_body(self):
		try:
			node = self.planets.planets[astrology.SE_MEAN_NODE]
		except Exception:
			return None
		try:
			data = list(node.data)
			data[planets.Planet.LONG] = util.normalize(node.data[planets.Planet.LONG] + 180.0)
			dataEqu = list(node.dataEqu)
			if planets.Planet.RAEQU < len(dataEqu):
				dataEqu[planets.Planet.RAEQU] = util.normalize(node.dataEqu[planets.Planet.RAEQU] + 180.0)
			if planets.Planet.DECLEQU < len(dataEqu):
				dataEqu[planets.Planet.DECLEQU] = -node.dataEqu[planets.Planet.DECLEQU]
			return BodyProxy(data, dataEqu)
		except Exception:
			return None

	def get_planet_body(self, planet_idx):
		if planet_idx == astrology.SE_CHIRON:
			return getattr(self, 'chiron', None)
		if planet_idx == astrology.SE_TRUE_NODE:
			return self._get_desc_node_body()
		try:
			if 0 <= planet_idx < len(self.planets.planets):
				return self.planets.planets[planet_idx]
		except Exception:
			pass
		return None

	def get_planet_orb_index(self, planet_idx):
		if planet_idx == astrology.SE_CHIRON:
			return astrology.SE_PLUTO
		if planet_idx < 0:
			return 0
		try:
			if planet_idx >= len(self.options.orbis):
				return len(self.options.orbis)-1
		except Exception:
			return 0
		return planet_idx

	def get_visible_aspect_planet_ids(self, include_chiron=False):
		ids = []
		for planet_idx in range(astrology.SE_SUN, astrology.SE_TRUE_NODE+1):
			if planet_idx == astrology.SE_URANUS and not self.options.transcendental[Chart.TRANSURANUS]:
				continue
			if planet_idx == astrology.SE_NEPTUNE and not self.options.transcendental[Chart.TRANSNEPTUNE]:
				continue
			if planet_idx == astrology.SE_PLUTO and not self.options.transcendental[Chart.TRANSPLUTO]:
				continue
			if planet_idx in (astrology.SE_MEAN_NODE, astrology.SE_TRUE_NODE) and not self.options.shownodes:
				continue
			if self.get_planet_body(planet_idx) is not None:
				ids.append(planet_idx)
		if include_chiron and getattr(self, 'chiron', None) is not None and getattr(self.options, 'showchiron', True):
			ids.append(astrology.SE_CHIRON)
		return ids

	def _aspect_distance(self, lon1, lon2):
		dif = math.fabs(float(lon1) - float(lon2))
		if dif > 180.0:
			dif = 360.0 - dif
		return dif

	@staticmethod
	def _aspect_distance_static(lon1, lon2):
		dif = math.fabs(float(lon1) - float(lon2))
		if dif > 180.0:
			dif = 360.0 - dif
		return dif

	@staticmethod
	def _aspect_orb_delta(lon1, lon2, aspect_type):
		return math.fabs(Chart._aspect_distance_static(lon1, lon2) - Chart.Aspects[aspect_type])

	@staticmethod
	def directed_aspect_state_from_motion(current_idx, other_idx, lon_current, speed_current, lon_other, speed_other, aspect_type):
		current_delta = Chart._aspect_orb_delta(lon_current, lon_other, aspect_type)
		next_lon_current = util.normalize(float(lon_current) + float(speed_current) / 24.0)
		next_lon_other = util.normalize(float(lon_other) + float(speed_other) / 24.0)
		next_delta = Chart._aspect_orb_delta(next_lon_current, next_lon_other, aspect_type)
		full_motion = current_delta - next_delta

		current_only = current_delta - Chart._aspect_orb_delta(next_lon_current, lon_other, aspect_type)
		other_only = current_delta - Chart._aspect_orb_delta(lon_current, next_lon_other, aspect_type)
		eps = 1e-9

		if full_motion > eps:
			is_applying = True
			is_separating = False
			if current_only > other_only + eps:
				actor_id = current_idx
			elif other_only > current_only + eps:
				actor_id = other_idx
			else:
				actor_id = current_idx if math.fabs(float(speed_current)) >= math.fabs(float(speed_other)) else other_idx
		elif full_motion < -eps:
			is_applying = False
			is_separating = True
			if current_only < other_only - eps:
				actor_id = current_idx
			elif other_only < current_only - eps:
				actor_id = other_idx
			else:
				actor_id = current_idx if math.fabs(float(speed_current)) >= math.fabs(float(speed_other)) else other_idx
		else:
			is_applying = False
			is_separating = False
			actor_id = current_idx if math.fabs(float(speed_current)) >= math.fabs(float(speed_other)) else other_idx

		target_id = other_idx if actor_id == current_idx else current_idx
		return {
			'actor_id': actor_id,
			'target_id': target_id,
			'is_applying': is_applying,
			'is_separating': is_separating,
			'current_is_actor': actor_id == current_idx,
			'other_is_actor': actor_id == other_idx,
		}

	def _passes_traditional_aspect_filter(self, aspect_type, lon1, lon2):
		if not self.options.traditionalaspects:
			return True
		if aspect_type == Chart.CONJUNCTIO:
			diff = 0
		elif aspect_type == Chart.SEXTIL:
			diff = 2
		elif aspect_type == Chart.QUADRAT:
			diff = 3
		elif aspect_type == Chart.TRIGON:
			diff = 4
		elif aspect_type == Chart.OPPOSITIO:
			diff = 6
		else:
			return False
		# planets.data[LONG] and houses.cusps[] are already in the chart's
		# chosen zodiac (Chart._zodiac_flags applies SEFLG_SIDEREAL at the
		# SwissEph boundary), so the sign index falls out of the lon
		# directly without any per-call ayanamsha adjustment.
		lona1 = float(lon1)
		lona2 = float(lon2)
		sign1 = int(util.normalize(lona1) / Chart.SIGN_DEG)
		sign2 = int(util.normalize(lona2) / Chart.SIGN_DEG)
		signdiff = math.fabs(sign1 - sign2)
		if signdiff > Chart.SIGN_NUM / 2:
			signdiff = Chart.SIGN_NUM - signdiff
		return diff == signdiff

	def _calc_parallel_type(self, decl1, decl2, same_orb, contra_orb):
		if decl1 is None or decl2 is None:
			return Chart.NONE
		if (decl1 > 0.0 and decl2 > 0.0) or (decl1 < 0.0 and decl2 < 0.0):
			if (decl1 + same_orb > decl2) and (decl1 - same_orb < decl2):
				return Chart.PARALLEL
		else:
			if decl1 < 0.0:
				decl1 *= -1.0
			if decl2 < 0.0:
				decl2 *= -1.0
			if (decl1 + contra_orb > decl2) and (decl1 - contra_orb < decl2):
				return Chart.CONTRAPARALLEL
		return Chart.NONE

	def _is_applying_dynamic(self, lon1, speed1, lon2, speed2, aspect_type):
		current = math.fabs(self._aspect_distance(lon1, lon2) - Chart.Aspects[aspect_type])
		next_lon1 = util.normalize(float(lon1) + float(speed1) / 24.0)
		next_lon2 = util.normalize(float(lon2) + float(speed2) / 24.0)
		next_delta = math.fabs(self._aspect_distance(next_lon1, next_lon2) - Chart.Aspects[aspect_type])
		return next_delta < current

	def _build_dynamic_aspect(self, lon1, lon2, speed1, speed2, orb_by_aspect, decl1=None, decl2=None, parallel_orbs=None, node_only_conjunction=False):
		asp = Asp()
		asp.dif = self._aspect_distance(lon1, lon2)
		if parallel_orbs is not None:
			asp.parallel = self._calc_parallel_type(decl1, decl2, parallel_orbs[0], parallel_orbs[1])
		for a in range(Chart.ASPECT_NUM):
			if node_only_conjunction and a > 0:
				break
			if not self._passes_traditional_aspect_filter(a, lon1, lon2):
				continue
			delta = math.fabs(asp.dif - Chart.Aspects[a])
			if delta > orb_by_aspect[a]:
				continue
			if asp.typ == Chart.NONE or delta < asp.aspdif:
				asp.typ = a
				asp.aspdif = delta
				asp.max_orb = orb_by_aspect[a]
				asp.appl = self._is_applying_dynamic(lon1, speed1, lon2, speed2, a)
				asp.exact = delta <= self.options.exact
		return asp

	def get_planetary_aspect(self, planet1_idx, planet2_idx):
		if {planet1_idx, planet2_idx} == {astrology.SE_MEAN_NODE, astrology.SE_TRUE_NODE}:
			return Asp()
		legacy_limit = self.planets.PLANETS_NUM - 1
		if 0 <= planet1_idx < legacy_limit and 0 <= planet2_idx < legacy_limit:
			return self.aspmatrix[max(planet1_idx, planet2_idx)][min(planet1_idx, planet2_idx)]
		body1 = self.get_planet_body(planet1_idx)
		body2 = self.get_planet_body(planet2_idx)
		if body1 is None or body2 is None:
			return Asp()
		idx1 = self.get_planet_orb_index(planet1_idx)
		idx2 = self.get_planet_orb_index(planet2_idx)
		orb_by_aspect = []
		for a in range(Chart.ASPECT_NUM):
			orb_by_aspect.append(self.options.orbis[idx1][a] + self.options.orbis[idx2][a])
		parallel_orbs = [self.options.orbisplanetspar[idx1][0] + self.options.orbisplanetspar[idx2][0], self.options.orbisplanetspar[idx1][1] + self.options.orbisplanetspar[idx2][1]]
		return self._build_dynamic_aspect(body1.data[planets.Planet.LONG], body2.data[planets.Planet.LONG], body1.data[planets.Planet.SPLON], body2.data[planets.Planet.SPLON], orb_by_aspect, body1.dataEqu[planets.Planet.DECLEQU], body2.dataEqu[planets.Planet.DECLEQU], parallel_orbs, False)

	def get_directed_planetary_aspect(self, current_idx, other_idx):
		asp = self.get_planetary_aspect(current_idx, other_idx)
		if asp.typ == Chart.NONE:
			return None
		current_body = self.get_planet_body(current_idx)
		other_body = self.get_planet_body(other_idx)
		if current_body is None or other_body is None:
			return None
		state = Chart.directed_aspect_state_from_motion(
			current_idx,
			other_idx,
			current_body.data[planets.Planet.LONG],
			current_body.data[planets.Planet.SPLON],
			other_body.data[planets.Planet.LONG],
			other_body.data[planets.Planet.SPLON],
			asp.typ,
		)
		state['aspect_type'] = asp.typ
		state['orb'] = asp.aspdif
		state['exact'] = asp.exact
		return state

	def get_cross_chart_planetary_aspect(self, planet1_idx, other_chart, planet2_idx):
		# Aspect between this chart's planet1 and *other_chart*'s planet2.
		# Uses this chart's options/orb config and the dynamic aspect builder
		# so the inspector can report transit-to-radix aspects in biwheel mode
		# without bolting a second pre-computed aspect matrix onto Chart.
		if {planet1_idx, planet2_idx} == {astrology.SE_MEAN_NODE, astrology.SE_TRUE_NODE}:
			return Asp()
		body1 = self.get_planet_body(planet1_idx)
		body2 = other_chart.get_planet_body(planet2_idx) if other_chart is not None else None
		if body1 is None or body2 is None:
			return Asp()
		idx1 = self.get_planet_orb_index(planet1_idx)
		idx2 = self.get_planet_orb_index(planet2_idx)
		orb_by_aspect = []
		for a in range(Chart.ASPECT_NUM):
			orb_by_aspect.append(self.options.orbis[idx1][a] + self.options.orbis[idx2][a])
		parallel_orbs = [
			self.options.orbisplanetspar[idx1][0] + self.options.orbisplanetspar[idx2][0],
			self.options.orbisplanetspar[idx1][1] + self.options.orbisplanetspar[idx2][1],
		]
		return self._build_dynamic_aspect(
			body1.data[planets.Planet.LONG], body2.data[planets.Planet.LONG],
			body1.data[planets.Planet.SPLON], body2.data[planets.Planet.SPLON],
			orb_by_aspect,
			body1.dataEqu[planets.Planet.DECLEQU], body2.dataEqu[planets.Planet.DECLEQU],
			parallel_orbs, False,
		)

	def get_directed_cross_chart_planetary_aspect(self, current_idx, other_chart, other_idx):
		asp = self.get_cross_chart_planetary_aspect(current_idx, other_chart, other_idx)
		if asp.typ == Chart.NONE:
			return None
		current_body = self.get_planet_body(current_idx)
		other_body = other_chart.get_planet_body(other_idx) if other_chart is not None else None
		if current_body is None or other_body is None:
			return None
		state = Chart.directed_aspect_state_from_motion(
			current_idx,
			other_idx,
			current_body.data[planets.Planet.LONG],
			current_body.data[planets.Planet.SPLON],
			other_body.data[planets.Planet.LONG],
			other_body.data[planets.Planet.SPLON],
			asp.typ,
		)
		state['aspect_type'] = asp.typ
		state['orb'] = asp.aspdif
		state['exact'] = asp.exact
		return state

	def get_ascmc_aspect(self, angle_idx, planet_idx):
		legacy_limit = self.planets.PLANETS_NUM - 1
		if 0 <= planet_idx < legacy_limit:
			return self.aspmatrixAscMC[angle_idx][planet_idx]
		body = self.get_planet_body(planet_idx)
		if body is None:
			return Asp()
		idx = self.get_planet_orb_index(planet_idx)
		orb_by_aspect = []
		for a in range(Chart.ASPECT_NUM):
			orb_by_aspect.append(self.options.orbisAscMC[a] + self.options.orbis[idx][a])
		parallel_orbs = [self.options.orbisparAscMC[0] + self.options.orbisplanetspar[idx][0], self.options.orbisparAscMC[1] + self.options.orbisplanetspar[idx][1]]
		decl = self.houses.ascmc2[houses.Houses.ASC][houses.Houses.DECL]
		if angle_idx == 1:
			decl = self.houses.ascmc2[houses.Houses.MC][houses.Houses.DECL]
		return self._build_dynamic_aspect(body.data[planets.Planet.LONG], self.houses.ascmc[angle_idx], body.data[planets.Planet.SPLON], 0.0, orb_by_aspect, body.dataEqu[planets.Planet.DECLEQU], decl, parallel_orbs, planet_idx in (astrology.SE_MEAN_NODE, astrology.SE_TRUE_NODE))

	def get_house_aspect(self, house_idx, planet_idx):
		legacy_limit = self.planets.PLANETS_NUM - 1
		if 0 <= planet_idx < legacy_limit:
			return self.aspmatrixH[house_idx][planet_idx]
		body = self.get_planet_body(planet_idx)
		if body is None:
			return Asp()
		hidx = (1, 2, 3, 10, 11, 12)
		idx = self.get_planet_orb_index(planet_idx)
		orb_by_aspect = []
		for a in range(Chart.ASPECT_NUM):
			orbH = self.options.orbisH[a]
			if (house_idx == 0 or house_idx == 3) and (self.houses.hsys == 'P' or self.houses.hsys == 'K' or self.houses.hsys == 'O' or self.houses.hsys == 'R' or self.houses.hsys == 'C' or self.houses.hsys == 'E' or self.houses.hsys == 'T' or self.houses.hsys == 'B'):
				orbH = self.options.orbisAscMC[a]
			orb_by_aspect.append(orbH + self.options.orbis[idx][a])
		parallel_orbs = [self.options.orbisparH[0] + self.options.orbisplanetspar[idx][0], self.options.orbisparH[1] + self.options.orbisplanetspar[idx][1]]
		# Both `pllon` and the Whole-Sign cusps stored in `self.houses.cusps`
		# are already in the chart's chosen zodiac post-Chart._zodiac_flags;
		# the W-house special-case in houses.py rebases the cusps to
		# sidereal-sign boundaries directly so no second subtraction is
		# needed here.
		pllon = body.data[planets.Planet.LONG]
		return self._build_dynamic_aspect(pllon, self.houses.cusps[hidx[house_idx]], body.data[planets.Planet.SPLON], 0.0, orb_by_aspect, body.dataEqu[planets.Planet.DECLEQU], self.houses.cusps2[hidx[house_idx]-1][1], parallel_orbs, planet_idx in (astrology.SE_MEAN_NODE, astrology.SE_TRUE_NODE))

	def get_lof_aspect(self, planet_idx):
		legacy_limit = self.planets.PLANETS_NUM
		if 0 <= planet_idx < legacy_limit:
			return self.aspmatrixLoF[planet_idx]
		body = self.get_planet_body(planet_idx)
		if body is None:
			return Asp()
		idx = self.get_planet_orb_index(planet_idx)
		orb_by_aspect = self.options.orbis[idx][:]
		return self._build_dynamic_aspect(body.data[planets.Planet.LONG], self.fortune.fortune[fortune.Fortune.LON], body.data[planets.Planet.SPLON], 0.0, orb_by_aspect, node_only_conjunction=planet_idx in (astrology.SE_MEAN_NODE, astrology.SE_TRUE_NODE))


	def calcAspMatrix(self):	
		self.calcSpeeds()

		self.aspmatrix = [[Asp(),Asp(),Asp(),Asp(),Asp(),Asp(),Asp(),Asp(),Asp(),Asp(),Asp()], 
					[Asp(),Asp(),Asp(),Asp(),Asp(),Asp(),Asp(),Asp(),Asp(),Asp(),Asp()], 
					[Asp(),Asp(),Asp(),Asp(),Asp(),Asp(),Asp(),Asp(),Asp(),Asp(),Asp()], 
					[Asp(),Asp(),Asp(),Asp(),Asp(),Asp(),Asp(),Asp(),Asp(),Asp(),Asp()], 
					[Asp(),Asp(),Asp(),Asp(),Asp(),Asp(),Asp(),Asp(),Asp(),Asp(),Asp()], 
					[Asp(),Asp(),Asp(),Asp(),Asp(),Asp(),Asp(),Asp(),Asp(),Asp(),Asp()], 
					[Asp(),Asp(),Asp(),Asp(),Asp(),Asp(),Asp(),Asp(),Asp(),Asp(),Asp()], 
					[Asp(),Asp(),Asp(),Asp(),Asp(),Asp(),Asp(),Asp(),Asp(),Asp(),Asp()], 
					[Asp(),Asp(),Asp(),Asp(),Asp(),Asp(),Asp(),Asp(),Asp(),Asp(),Asp()], 
					[Asp(),Asp(),Asp(),Asp(),Asp(),Asp(),Asp(),Asp(),Asp(),Asp(),Asp()], 
					[Asp(),Asp(),Asp(),Asp(),Asp(),Asp(),Asp(),Asp(),Asp(),Asp(),Asp()]]

		for i in range(self.planets.PLANETS_NUM-1):
			for j in range(self.planets.PLANETS_NUM-1):
				if i != j:
					k = i
					l = j
					if j > i:
						k = j
						l = i

					#Check parallel-contraparallel	
					self.aspmatrix[k][l].parallel = Chart.NONE 
					decl1 = self.planets.planets[i].dataEqu[1]							
					decl2 = self.planets.planets[j].dataEqu[1]							
					if (decl1 > 0.0 and decl2 > 0.0) or (decl1 < 0.0 and decl2 < 0.0):
						if ((decl1 > 0.0 and (decl1+self.options.orbisplanetspar[i][0]+self.options.orbisplanetspar[j][0] > decl2) and (decl1-(self.options.orbisplanetspar[i][0]+self.options.orbisplanetspar[j][0]) < decl2)) or (decl1 < 0.0 and (decl1+self.options.orbisplanetspar[i][0]+self.options.orbisplanetspar[j][0] > decl2) and (decl1-(self.options.orbisplanetspar[i][0]+self.options.orbisplanetspar[j][0]) < decl2))):
							self.aspmatrix[k][l].parallel = Chart.PARALLEL
					else:
						if decl1 < 0.0:
							decl1 *= -1.0
						if decl2 < 0.0:
							decl2 *= -1.0
						if (decl1+self.options.orbisplanetspar[i][1]+self.options.orbisplanetspar[j][1] > decl2) and (decl1-(self.options.orbisplanetspar[i][1]+self.options.orbisplanetspar[j][1]) < decl2):
							self.aspmatrix[k][l].parallel = Chart.CONTRAPARALLEL

					for a in range(Chart.ASPECT_NUM):
						#Check aspects

						val1 = self.planets.planets[j].data[0]+self.options.orbis[j][a]+self.options.orbis[i][a]
						val2 = self.planets.planets[j].data[0]-(self.options.orbis[j][a]+self.options.orbis[i][a])

						if (self.inorbsinister(val1, val2, self.planets.planets[i].data[0], a)):
							tmp = util.normalize(self.planets.planets[i].data[0]+Chart.Aspects[a])
							dif = math.fabs(tmp-self.planets.planets[j].data[0])
							if self.aspmatrix[k][l].typ == Chart.NONE or (self.aspmatrix[k][l].typ != Chart.NONE and self.aspmatrix[k][l].dif > dif):
								self.aspmatrix[k][l].typ = a
								self.aspmatrix[k][l].aspdif = dif
								self.aspmatrix[k][l].appl = self.isApplPlanets(tmp, i, j)
								self.aspmatrix[k][l].max_orb = self.options.orbis[j][a]+self.options.orbis[i][a]  # Set max orb for thickness calculation 

								#Check Exact
								val1 = self.planets.planets[j].data[0]+self.options.exact
								val2 = self.planets.planets[j].data[0]-self.options.exact

								if (self.inorbsinister(val1, val2, self.planets.planets[i].data[0], a)):
									self.aspmatrix[k][l].exact = True 
								else:	
									self.aspmatrix[k][l].exact = False
						dif = self.planets.planets[i].data[0]-self.planets.planets[j].data[0]
						if self.planets.planets[j].data[0] > self.planets.planets[i].data[0]:
							dif = self.planets.planets[j].data[0]-self.planets.planets[i].data[0]

						if dif > 180.0:
							dif = 360.0-dif

						self.aspmatrix[k][l].dif = dif

		NODES = 2
		# AscMC
		self.aspmatrixAscMC = [[Asp(),Asp(),Asp(),Asp(),Asp(),Asp(),Asp(),Asp(),Asp(),Asp(), Asp()], 
							[Asp(),Asp(),Asp(),Asp(),Asp(),Asp(),Asp(),Asp(),Asp(),Asp(), Asp()]]

		ascmc = [self.houses.ascmc2[houses.Houses.ASC][houses.Houses.DECL], self.houses.ascmc2[houses.Houses.MC][houses.Houses.DECL]]
		for i in range(self.planets.PLANETS_NUM-1):
			for j in range(2):
				#Check parallel-contraparallel
				self.aspmatrixAscMC[j][i].parallel = Chart.NONE 
				decl1 = self.planets.planets[i].dataEqu[1]
				decl2 = ascmc[j]
				if (decl1 > 0.0 and decl2 > 0.0) or (decl1 < 0.0 and decl2 < 0.0):
					if ((decl1 > 0.0 and (decl1+self.options.orbisparAscMC[0]+self.options.orbisplanetspar[i][0] > decl2) and (decl1-(self.options.orbisparAscMC[0]+self.options.orbisplanetspar[i][0]) < decl2)) or (decl1 < 0.0 and (decl1+self.options.orbisparAscMC[0]+self.options.orbisplanetspar[i][0] > decl2) and (decl1-(self.options.orbisparAscMC[0]+self.options.orbisplanetspar[i][0]) < decl2))):
						self.aspmatrixAscMC[j][i].parallel = Chart.PARALLEL
				else:
					if decl1 < 0.0:
						decl1 *= -1.0
					if decl2 < 0.0:
						decl2 *= -1.0
					if (decl1+self.options.orbisparAscMC[1]+self.options.orbisplanetspar[i][1] > decl2) and (decl1-(self.options.orbisparAscMC[1]+self.options.orbisplanetspar[i][1]) < decl2):
						self.aspmatrixAscMC[j][i].parallel = Chart.CONTRAPARALLEL

				for a in range(Chart.ASPECT_NUM):
					if i == self.planets.PLANETS_NUM-NODES and a > 0:#exclude the aspects of the nodes
						break

					#Check aspects
					val1 = self.houses.ascmc[j]+self.options.orbisAscMC[a]+self.options.orbis[i][a]
					val2 = self.houses.ascmc[j]-(self.options.orbisAscMC[a]+self.options.orbis[i][a])

					if (self.inorbsinister(val1, val2, self.planets.planets[i].data[0], a)):
						tmp = util.normalize(self.planets.planets[i].data[0]+Chart.Aspects[a])
						dif = math.fabs(tmp-self.houses.ascmc[j])
						if self.aspmatrixAscMC[j][i].typ == Chart.NONE or (self.aspmatrixAscMC[j][i].typ != Chart.NONE and self.aspmatrixAscMC[j][i].dif > dif):
							self.aspmatrixAscMC[j][i].typ = a
							self.aspmatrixAscMC[j][i].aspdif = dif
							self.aspmatrixAscMC[j][i].appl = tmp > self.houses.ascmc[j]
							self.aspmatrixAscMC[j][i].max_orb = self.options.orbisAscMC[a]+self.options.orbis[i][a]  # Set max orb for thickness calculation 

							#Exact
							val1 = self.houses.ascmc[j]+self.options.exact
							val2 = self.houses.ascmc[j]-self.options.exact

							if (self.inorbsinister(val1, val2, self.planets.planets[i].data[0], a)):
								self.aspmatrixAscMC[j][i].exact = True 
							else:	
								self.aspmatrixAscMC[j][i].exact = False
					else:#negativ
						if (self.inorbdexter(val1, val2, self.planets.planets[i].data[0], a)):
							tmp = util.normalize(self.planets.planets[i].data[0]-Chart.Aspects[a])
							dif = math.fabs(tmp-self.houses.ascmc[j])
							if self.aspmatrixAscMC[j][i].typ == Chart.NONE or (self.aspmatrixAscMC[j][i].typ != Chart.NONE and self.aspmatrixAscMC[j][i].dif > dif):
								self.aspmatrixAscMC[j][i].typ = a
								self.aspmatrixAscMC[j][i].aspdif = dif
								self.aspmatrixAscMC[j][i].appl = tmp > self.houses.ascmc[j]
								self.aspmatrixAscMC[j][i].max_orb = self.options.orbisAscMC[a]+self.options.orbis[i][a]  # Set max orb for thickness calculation 

								#Exact
								val1 = self.houses.ascmc[j]+self.options.exact
								val2 = self.houses.ascmc[j]-self.options.exact

								if (self.inorbdexter(val1, val2, self.planets.planets[i].data[0], a)):
									self.aspmatrixAscMC[j][i].exact = True 
								else:	
									self.aspmatrixAscMC[j][i].exact = False

					dif = self.planets.planets[i].data[0]-self.houses.ascmc[j]
					if self.houses.ascmc[j] > self.planets.planets[i].data[0]:
						dif = self.houses.ascmc[j]-self.planets.planets[i].data[0]

					if dif > 180.0:
						dif = 360.0-dif

					self.aspmatrixAscMC[j][i].dif = dif

		# Houses
		hidx = (1, 2, 3, 10, 11, 12)

		self.aspmatrixH = [[Asp(),Asp(),Asp(),Asp(),Asp(),Asp(),Asp(),Asp(),Asp(),Asp(), Asp()], 
							[Asp(),Asp(),Asp(),Asp(),Asp(),Asp(),Asp(),Asp(),Asp(),Asp(), Asp()], 
							[Asp(),Asp(),Asp(),Asp(),Asp(),Asp(),Asp(),Asp(),Asp(),Asp(), Asp()], 
							[Asp(),Asp(),Asp(),Asp(),Asp(),Asp(),Asp(),Asp(),Asp(),Asp(), Asp()], 
							[Asp(),Asp(),Asp(),Asp(),Asp(),Asp(),Asp(),Asp(),Asp(),Asp(), Asp()], 
							[Asp(),Asp(),Asp(),Asp(),Asp(),Asp(),Asp(),Asp(),Asp(),Asp(), Asp()]] 

		for i in range(self.planets.PLANETS_NUM-1):
			for j in range(len(hidx)):
				#Check parallel-contraparallel
				self.aspmatrixH[j][i].parallel = Chart.NONE 
				decl1 = self.planets.planets[i].dataEqu[1]
				decl2 = self.houses.cusps2[hidx[j]-1][1]	
				if (decl1 > 0.0 and decl2 > 0.0) or (decl1 < 0.0 and decl2 < 0.0):
					if ((decl1 > 0.0 and (decl1+self.options.orbisparH[0]+self.options.orbisplanetspar[i][0] > decl2) and (decl1-(self.options.orbisparH[0]+self.options.orbisplanetspar[i][0]) < decl2)) or (decl1 < 0.0 and (decl1+self.options.orbisparH[0]+self.options.orbisplanetspar[i][0] > decl2) and (decl1-(self.options.orbisparH[0]+self.options.orbisplanetspar[i][0]) < decl2))):
						self.aspmatrixH[j][i].parallel = Chart.PARALLEL
				else:
					if decl1 < 0.0:
						decl1 *= -1.0
					if decl2 < 0.0:
						decl2 *= -1.0
					if (decl1+self.options.orbisparH[1]+self.options.orbisplanetspar[i][1] > decl2) and (decl1-(self.options.orbisparH[1]+self.options.orbisplanetspar[i][1]) < decl2):
						self.aspmatrixH[j][i].parallel = Chart.CONTRAPARALLEL

				for a in range(Chart.ASPECT_NUM):
					if i == self.planets.PLANETS_NUM-NODES and a > 0:#exclude the aspects of the nodes
						break

					#Check aspects
					orbH = self.options.orbisH[a]
					val1 = self.houses.cusps[hidx[j]]+orbH+self.options.orbis[i][a]
					val2 = self.houses.cusps[hidx[j]]-(orbH+self.options.orbis[i][a])

					if (j == 0 or j == 3) and (self.houses.hsys == 'P' or self.houses.hsys == 'K' or self.houses.hsys == 'O' or self.houses.hsys == 'R' or self.houses.hsys == 'C' or self.houses.hsys == 'E' or self.houses.hsys == 'T' or self.houses.hsys == 'B'):
						orbH = self.options.orbisAscMC[a]

					pllon = self.planets.planets[i].data[0]
					if self.options.ayanamsha != 0 and self.houses.hsys == 'W':
						pllon = util.normalize(pllon-self.ayanamsha)
					if (self.inorbsinister(val1, val2, pllon, a)):
						tmp = util.normalize(pllon+Chart.Aspects[a])
						dif = math.fabs(tmp-self.houses.cusps[hidx[j]])
						if self.aspmatrixH[j][i].typ == Chart.NONE or (self.aspmatrixH[j][i].typ != Chart.NONE and self.aspmatrixH[j][i].dif > dif):
							self.aspmatrixH[j][i].typ = a
							self.aspmatrixH[j][i].aspdif = dif
							self.aspmatrixH[j][i].appl = tmp > self.houses.cusps[hidx[j]]
							self.aspmatrixH[j][i].max_orb = orbH+self.options.orbis[i][a]  # Set max orb for thickness calculation 

							#Exact
							val1 = self.houses.cusps[hidx[j]]+self.options.exact
							val2 = self.houses.cusps[hidx[j]]-self.options.exact

							if (self.inorbsinister(val1, val2, pllon, a)):
								self.aspmatrixH[j][i].exact = True 
							else:	
								self.aspmatrixH[j][i].exact = False
					else:#negativ
						if (j == 0 or j == 3) and (self.houses.hsys == 'P' or self.houses.hsys == 'K' or self.houses.hsys == 'O' or self.houses.hsys == 'R' or self.houses.hsys == 'C' or self.houses.hsys == 'E' or self.houses.hsys == 'T' or self.houses.hsys == 'B'):
							orbH = self.options.orbisAscMC[a]

						if (self.inorbdexter(val1, val2, pllon, a)):
							tmp = util.normalize(pllon-Chart.Aspects[a])
							dif = math.fabs(tmp-self.houses.cusps[hidx[j]])
							if self.aspmatrixH[j][i].typ == Chart.NONE or (self.aspmatrixH[j][i].typ != Chart.NONE and self.aspmatrixH[j][i].dif > dif):
								self.aspmatrixH[j][i].typ = a
								self.aspmatrixH[j][i].aspdif = dif
								self.aspmatrixH[j][i].appl = tmp > self.houses.cusps[hidx[j]]
								self.aspmatrixH[j][i].max_orb = orbH+self.options.orbis[i][a]  # Set max orb for thickness calculation 

								#exact
								val1 = self.houses.cusps[hidx[j]]+self.options.exact
								val2 = self.houses.cusps[hidx[j]]-self.options.exact

								if (self.inorbdexter(val1, val2, pllon, a)):
									self.aspmatrixH[j][i].exact = True 
								else:	
									self.aspmatrixH[j][i].exact = False

					dif = pllon-self.houses.cusps[hidx[j]]
					if self.houses.cusps[hidx[j]] > pllon:
						dif = self.houses.cusps[hidx[j]]-pllon

					if dif > 180.0:
						dif = 360.0-dif

					self.aspmatrixH[j][i].dif = dif


		self.calcLoFAspMatrix()


	def calcLoFAspMatrix(self):
		NODES = 2
		lonlof = self.fortune.fortune[fortune.Fortune.LON]
		self.aspmatrixLoF = [Asp(),Asp(),Asp(),Asp(),Asp(),Asp(),Asp(),Asp(),Asp(),Asp(), Asp(), Asp()] 
	
		for i in range(self.planets.PLANETS_NUM):#Both nodes (conjunctio only)
			#We don't check parallel-contraparallel now
			self.aspmatrixLoF[i].parallel = Chart.NONE 

			for a in range(Chart.ASPECT_NUM):
				#only conjunctio in case of the nodes
				if i >= self.planets.PLANETS_NUM-NODES and a > 0:
					break
					
				#Check aspects
				orb = 0.0
				if i < self.planets.PLANETS_NUM-1:
					orb = self.options.orbis[i][a]
				else:
					orb = self.options.orbis[i-1][a]

				val1 = lonlof+orb
				val2 = lonlof-orb

				if (self.inorbsinister(val1, val2, self.planets.planets[i].data[0], a)):
					tmp = util.normalize(self.planets.planets[i].data[0]+Chart.Aspects[a])
					dif = math.fabs(tmp-lonlof)
					if self.aspmatrixLoF[i].typ == Chart.NONE or (self.aspmatrixLoF[i].typ != Chart.NONE and self.aspmatrixLoF[i].dif > dif):
						self.aspmatrixLoF[i].typ = a
						self.aspmatrixLoF[i].aspdif = dif
						self.aspmatrixLoF[i].appl = tmp > lonlof
						self.aspmatrixLoF[i].max_orb = orb  # Set max orb for thickness calculation

						#Exact
						val1 = lonlof+self.options.exact
						val2 = lonlof-self.options.exact

						if (self.inorbsinister(val1, val2, self.planets.planets[i].data[0], a)):
							self.aspmatrixLoF[i].exact = True 
						else:	
							self.aspmatrixLoF[i].exact = False
				else:#negativ
					if (self.inorbdexter(val1, val2, self.planets.planets[i].data[0], a)):
						tmp = util.normalize(self.planets.planets[i].data[0]-Chart.Aspects[a])
						dif = math.fabs(tmp-lonlof)
						if self.aspmatrixLoF[i].typ == Chart.NONE or (self.aspmatrixLoF[i].typ != Chart.NONE and self.aspmatrixLoF[i].dif > dif):
							self.aspmatrixLoF[i].typ = a
							self.aspmatrixLoF[i].aspdif = dif
							self.aspmatrixLoF[i].appl = tmp > lonlof
							self.aspmatrixLoF[i].max_orb = orb  # Set max orb for thickness calculation

							#exact
							val1 = lonlof+self.options.exact
							val2 = lonlof-self.options.exact

							if (self.inorbdexter(val1, val2, self.planets.planets[i].data[0], a)):
								self.aspmatrixLoF[i].exact = True 
							else:	
								self.aspmatrixLoF[i].exact = False

				dif = self.planets.planets[i].data[0]-lonlof
				if lonlof > self.planets.planets[i].data[0]:
					dif = lonlof-self.planets.planets[i].data[0]

				if dif > 180.0:
					dif = 360.0-dif

				self.aspmatrixLoF[i].dif = dif


	def isApplPlanets(self, tmp, pl1, pl2):
		pl1speed = 0
		pl2speed = 0
		for i in range(self.planets.PLANETS_NUM-1):
			if self.speeds[i] == pl1:
				pl1speed = i
			if self.speeds[i] == pl2:
				pl2speed = i

		pl1ret = self.planets.planets[pl1].data[3] < 0.0
		pl2ret = self.planets.planets[pl2].data[3] < 0.0

		#Aspects are checked only forward => pl1 is always before pl2!
		if tmp < self.planets.planets[pl2].data[0]:
			if pl1speed > pl2speed:
				return not pl1ret
			else:
				return pl2ret
		else:
			if pl1speed > pl2speed:
				return pl1ret
			else:
				return not pl2ret		


	def calcSpeeds(self):
		self.speeds = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
		planetspds = [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]
		for i in range(self.planets.PLANETS_NUM-1):
			planetspds[i] = self.planets.planets[i].data[3]
			if planetspds[i] < 0.0:
				planetspds[i] *= -1.0

		for j in range(self.planets.PLANETS_NUM-1):
			for i in range(self.planets.PLANETS_NUM-2):
				if (planetspds[i] > planetspds[i+1]):
					tmp = planetspds[i]
					planetspds[i] = planetspds[i+1]
					planetspds[i+1] = tmp
					a = self.speeds[i]
					self.speeds[i] = self.speeds[i+1]
					self.speeds[i+1] = a


	def dignity(self, pid):
		# planets.data[0] is already in the chart's chosen zodiac; sign
		# falls out via `lon // 30` regardless of tropical / sidereal.
		lona = util.normalize(self.planets.planets[pid].data[0])
		sign = int(lona/Chart.SIGN_DEG)
		val = Chart.PEREGRIN

		if pid < astrology.SE_PLUTO+1:
			isdom = self.options.dignities[pid][0][sign]
			isexal = self.options.dignities[pid][1][sign]

			oppsign = (sign + Chart.SIGN_NUM // 2) % Chart.SIGN_NUM
			isexil = self.options.dignities[pid][0][oppsign]
			iscasus = self.options.dignities[pid][1][oppsign]

			if isdom:
				val = Chart.DOMICIL
			elif isexil:
				val = Chart.EXIL
			elif isexal:
				val = Chart.EXAL
			elif iscasus:
				val = Chart.CASUS	

		return val


	def get_planetary_joy_info(self, pid, lon=None, house_index=None):
		pid = int(pid)
		if pid < astrology.SE_SUN or pid > astrology.SE_SATURN:
			return None

		joy_houses = {
			astrology.SE_SUN: 9,
			astrology.SE_MOON: 3,
			astrology.SE_MERCURY: 1,
			astrology.SE_VENUS: 5,
			astrology.SE_MARS: 6,
			astrology.SE_JUPITER: 11,
			astrology.SE_SATURN: 12,
		}

		try:
			if lon is None:
				body = self.get_planet_body(pid)
				if body is None:
					return None
				lon = float(body.data[planets.Planet.LONG])
			else:
				lon = float(lon)
			if house_index is None:
				house_index = int(self.houses.getHousePos(lon, self.options, False)) + 1
			else:
				house_index = int(house_index)
		except Exception:
			return None

		joy_house = joy_houses.get(pid)
		if joy_house is None:
			return None

		active = house_index == joy_house
		return {
			'label': mtexts.txts.get('House of Joy', 'House of Joy'),
			'short_label': mtexts.txts.get('Joy', 'Joy'),
			'joy_house': joy_house,
			'house_index': house_index,
			'active': active,
			'active_summary': mtexts.txts.get('Joy', 'Joy') if active else '—',
		}


	def get_planet_essential_dignities(self, pid, lon=None):
		pid = int(pid)
		if pid < astrology.SE_SUN or pid > astrology.SE_SATURN:
			return None

		try:
			if lon is None:
				body = self.get_planet_body(pid)
				if body is None:
					return None
				lon = float(body.data[planets.Planet.LONG])
			else:
				lon = float(lon)
			# planets.data[LONG] is in the chosen zodiac; sign falls
			# out directly.
			lon = util.normalize(lon)
			sign = int(lon / Chart.SIGN_DEG) % Chart.SIGN_NUM
			pos_in_sign = lon % Chart.SIGN_DEG
			daytime = bool(self.planets.planets[astrology.SE_SUN].abovehorizon)
			if getattr(self.options, 'usedaynightorb', False):
				daytime = bool(self.fortune.abovehorizon)
		except Exception:
			return None

		rows = []
		active = []
		triplicity_groups = (0, 3, 1, 2, 0, 3, 1, 2, 0, 3, 1, 2)
		default_domicile_rulers = (4, 3, 2, 1, 0, 2, 3, 4, 5, 6, 6, 5)

		try:
			is_domicile = bool(self.options.dignities[pid][0][sign])
			domicile_ruler = default_domicile_rulers[sign]
			for candidate in range(astrology.SE_SUN, astrology.SE_SATURN + 1):
				if self.options.dignities[candidate][0][sign]:
					domicile_ruler = candidate
					break
			rows.append({'label': 'Domicile', 'ruler': domicile_ruler, 'active': is_domicile, 'score': self.options.dignityscores[0]})
			if is_domicile:
				active.append('Domicile')
		except Exception:
			pass

		try:
			exaltation_ruler = None
			for candidate in range(astrology.SE_SUN, astrology.SE_SATURN + 1):
				if self.options.dignities[candidate][1][sign]:
					exaltation_ruler = candidate
					break
			mercury_in_virgo = sign == 5 and pid == astrology.SE_MERCURY
			is_exaltation = bool(exaltation_ruler == pid)
			if mercury_in_virgo and not getattr(self.options, 'useexaltationmercury', False):
				is_exaltation = False
			rows.append({'label': 'Exaltation', 'ruler': exaltation_ruler, 'active': is_exaltation, 'score': self.options.dignityscores[1]})
			if is_exaltation:
				active.append('Exaltation')
		except Exception:
			pass

		try:
			triplicity_group = triplicity_groups[sign]
			score_slot = 0 if daytime else 1
			secondary_slot = 1 if daytime else 0
			triplicity_rulers = []
			triplicity_slots = []
			for slot, candidate in enumerate(self.options.trips[self.options.seltrip][triplicity_group]):
				candidate = int(candidate)
				if candidate < astrology.SE_SUN or candidate > astrology.SE_SATURN:
					continue
				if candidate not in triplicity_rulers:
					triplicity_rulers.append(candidate)
				triplicity_slots.append({
					'slot': slot,
					'ruler': candidate,
					'status_label': (
						'Trigon lord' if slot == score_slot else
						'Trigon lord (2nd)' if slot == secondary_slot else
						'Trigon lord (part.)'
					),
				})
			active_slot = None
			for slot_info in triplicity_slots:
				if slot_info['ruler'] == pid:
					active_slot = slot_info
					break
			has_triplicity_status = active_slot is not None
			active_triplicity = False
			triplicity_ruler = None
			if getattr(self.options, 'oneruler', False):
				raw_ruler = int(self.options.trips[self.options.seltrip][triplicity_group][score_slot])
				if astrology.SE_SUN <= raw_ruler <= astrology.SE_SATURN:
					triplicity_ruler = raw_ruler
					active_triplicity = triplicity_ruler == pid
			else:
				active_triplicity = has_triplicity_status
			rows.append({
				'label': 'Triplicity',
				'ruler': triplicity_ruler,
				'rulers': triplicity_rulers,
				'active': active_triplicity,
				'present': has_triplicity_status,
				'status_label': active_slot.get('status_label') if active_slot is not None else None,
				'score': self.options.dignityscores[2],
			})
			if active_triplicity:
				active.append('Triplicity')
		except Exception:
			pass

		try:
			term_ruler = None
			span_total = 0.0
			for term_pid, span in self.options.terms[self.options.selterm][sign]:
				span_total += float(span)
				if span_total > pos_in_sign:
					term_ruler = int(term_pid)
					break
			is_term = term_ruler == pid
			rows.append({'label': 'Term', 'ruler': term_ruler, 'active': is_term, 'score': self.options.dignityscores[3]})
			if is_term:
				active.append('Term')
		except Exception:
			pass

		try:
			decan_index = int(pos_in_sign / 10.0)
			decan_ruler = int(self.options.decans[self.options.seldecan][sign][decan_index])
			is_face = decan_ruler == pid
			rows.append({'label': 'Face', 'ruler': decan_ruler, 'active': is_face, 'score': self.options.dignityscores[4]})
			if is_face:
				active.append('Face')
		except Exception:
			pass

		active_summary = ', '.join(mtexts.txts.get(name, name) for name in active) if active else mtexts.txts.get('Peregrine', 'Peregrine')
		return {'rows': rows, 'active': active, 'active_summary': active_summary}


	def calcFixStarAspMatrix(self):
		'''Calculates conjunctions of fixstars(planets and AscMC)'''

		self.fsaspmatrix = []
		self.fsaspmatrixangles = []
		self.fsaspmatrixhcs = []
		self.fsaspmatrixlof = []

		num = len(self.fixstars.data)
		for i in range(num):
			ar = []

			val1 = self.fixstars.data[i][fixstars.FixStars.LON]+self.options.fixstars[self.fixstars.data[i][fixstars.FixStars.NOMNAME]]
			val2 = self.fixstars.data[i][fixstars.FixStars.LON]-self.options.fixstars[self.fixstars.data[i][fixstars.FixStars.NOMNAME]]

			for body_id in common.get_visible_fixstar_trigger_body_ids(self, self.options):
				body = common.get_chart_planet(self, body_id)
				if body is None:
					continue
				if (self.inorbsinister(val1, val2, body.data[planets.Planet.LONG], Chart.CONJUNCTIO)):
					ar.append(body_id)

			if len(ar) != 0:
				fsar = (i, ar)
				self.fsaspmatrix.append(fsar)

		# AscDescMCIC
		ASC = self.houses.ascmc[houses.Houses.ASC]
		DESC = util.normalize(self.houses.ascmc[houses.Houses.ASC]+180.0)
		MC = self.houses.ascmc[houses.Houses.MC]
		IC = util.normalize(self.houses.ascmc[houses.Houses.MC]+180.0)
		ascmc = [ASC, DESC, MC, IC]

		for i in range(num):
			ar = []

			val1 = self.fixstars.data[i][fixstars.FixStars.LON]+self.options.fixstars[self.fixstars.data[i][fixstars.FixStars.NOMNAME]]
			val2 = self.fixstars.data[i][fixstars.FixStars.LON]-self.options.fixstars[self.fixstars.data[i][fixstars.FixStars.NOMNAME]]

			for j in range(len(ascmc)):
				if (self.inorbsinister(val1, val2, ascmc[j], Chart.CONJUNCTIO)):
					ar.append(j)

			if len(ar) != 0:
				fsar = (i, ar)
				self.fsaspmatrixangles.append(fsar)

		# Housecusps
		for i in range(num):
			ar = []

			val1 = self.fixstars.data[i][fixstars.FixStars.LON]+self.options.fixstars[self.fixstars.data[i][fixstars.FixStars.NOMNAME]]
			val2 = self.fixstars.data[i][fixstars.FixStars.LON]-self.options.fixstars[self.fixstars.data[i][fixstars.FixStars.NOMNAME]]

			for j in range(houses.Houses.HOUSE_NUM):
				if (j == 0 or j == 3 or j == 6 or j == 9) and (self.houses.hsys == 'P' or self.houses.hsys == 'K' or self.houses.hsys == 'O' or self.houses.hsys == 'R' or self.houses.hsys == 'C' or self.houses.hsys == 'E' or self.houses.hsys == 'T' or self.houses.hsys == 'B'):
					continue

				if (self.inorbsinister(val1, val2, self.houses.cusps[j+1], Chart.CONJUNCTIO)):
					ar.append(j)

			if len(ar) != 0:
				fsar = (i, ar)
				self.fsaspmatrixhcs.append(fsar)

		#LoF
		lonlof = self.fortune.fortune[fortune.Fortune.LON]
		for i in range(num):
			val1 = self.fixstars.data[i][fixstars.FixStars.LON]+self.options.fixstars[self.fixstars.data[i][fixstars.FixStars.NOMNAME]]
			val2 = self.fixstars.data[i][fixstars.FixStars.LON]-self.options.fixstars[self.fixstars.data[i][fixstars.FixStars.NOMNAME]]

			if (self.inorbsinister(val1, val2, lonlof, Chart.CONJUNCTIO)):
				self.fsaspmatrixlof.append(i)


	def recalc(self):
		del self.houses
		del self.planets

		del self.fortune
		del self.fixstars
		del self.midpoints
		del self.riseset
		del self.zodpars
# ###########################################
# Roberto change  V 7.3.0
		del self.firdaria
# ###########################################		
		del self.antiscia
		del self.antzodpars
		del self.syzygy
		del self.almutens
		del self.parts
		del self.cpd
		del self.cpd2

		self.create()


	def recalcAlmutens(self):
		if self.syzygy == None:
			try:
				self.calcSyzygy()
			except Exception:
				self.syzygy = None
		if self.time.ph is None:
			try:
				self.time.calcPHs(self.place)
			except Exception:
				self.almutens = None
				return
		if hasattr(self, 'almutens') and self.almutens != None:
			del self.almutens
		if self.syzygy == None:
			self.almutens = None
			return
		self.almutens = almutens.Almutens(self)


	def setCustomer(self, cpd):
		if self.cpd != None:
			del self.cpd

		self.cpd = cpd
		self.pd_arabic_part_prom = self._get_pd_arabic_part_promissor_point()
		self.pd_arabic_part_sig = self._get_pd_arabic_part_significator_point()


	def setCustomer2(self, cpd2):
		if self.cpd2 != None:
			del self.cpd2

		self.cpd2 = cpd2
		self.pd_arabic_part_prom = self._get_pd_arabic_part_promissor_point()
		self.pd_arabic_part_sig = self._get_pd_arabic_part_significator_point()

	def _get_chiron_pd_point(self):
		if getattr(self, 'chiron', None) is None:
			return None
		if not getattr(self.options, 'showchiron', True):
			return None
		try:
			return customerpd.CustomerPD.from_planet(self.chiron)
		except Exception:
			return None

	def _get_vertex_pd_point(self):
		try:
			lon = self.houses.ascmc[houses.Houses.VERTEX]
			return customerpd.CustomerPD.from_ecliptic_longitude(
				lon,
				self.place.lat,
				self.houses.ascmc2,
				self.obl[0],
				self.raequasc,
				0.0,
			)
		except Exception:
			return None

	def _get_pd_active_arabic_part_name(self, promissor=False):
		enabled_attr = 'pdpromarabicparts' if promissor else 'pdsigarabicparts'
		name_attr = 'pdpromarabicpartname' if promissor else 'pdsigarabicpartname'
		if not getattr(self.options, enabled_attr, False):
			return None
		selected_name = getattr(self.options, name_attr, '')
		if not selected_name:
			return None
		for item in getattr(self.options, 'arabicparts', []):
			try:
				if item[arabicparts.ArabicParts.NAME] != selected_name:
					continue
				if len(item) > 4 and not bool(item[4]):
					return None
				return selected_name
			except Exception:
				continue
		return None

	def _get_pd_arabic_part_point(self, promissor=False):
		selected_name = self._get_pd_active_arabic_part_name(promissor)
		if selected_name is None:
			return None
		parts = getattr(getattr(self, 'parts', None), 'parts', None)
		if not parts:
			return None
		for part in parts:
			try:
				if part[arabicparts.ArabicParts.NAME] != selected_name:
					continue
				return customerpd.CustomerPD.from_ecliptic_longitude(
					part[arabicparts.ArabicParts.LONG],
					self.place.lat,
					self.houses.ascmc2,
					self.obl[0],
					self.raequasc,
				)
			except Exception:
				return None
		return None

	def _get_pd_arabic_part_promissor_point(self):
		return self._get_pd_arabic_part_point(True)

	def _get_pd_arabic_part_significator_point(self):
		return self._get_pd_arabic_part_point(False)

	def get_pd_dynamic_point_label(self, key, promissor):
		if key == 'chiron':
			return mtexts.txts.get('Chiron', 'Chiron')
		if key == 'vertex':
			return mtexts.txts.get('Vertex', 'Vertex')
		if key == 'arabic_part_prom':
			label = self._get_pd_active_arabic_part_name(True)
			if label:
				return label
		if key == 'arabic_part_sig':
			label = self._get_pd_active_arabic_part_name(False)
			if label:
				return label
		if promissor:
			return mtexts.txts['Customer2']
		return mtexts.txts['User2']

	def _ensure_pd_customer_point(self, significator):
		if significator:
			if self.cpd2 is None and self.options.pdcustomer2:
				self.cpd2 = customerpd.CustomerPD(self.options.pdcustomer2lon[0], self.options.pdcustomer2lon[1], self.options.pdcustomer2lon[2], self.options.pdcustomer2lat[0], self.options.pdcustomer2lat[1], self.options.pdcustomer2lat[2], self.options.pdcustomer2southern, self.place.lat, self.houses.ascmc2, self.obl[0], self.raequasc)
			return self.cpd2
		if self.cpd is None and self.options.pdcustomer:
			self.cpd = customerpd.CustomerPD(self.options.pdcustomerlon[0], self.options.pdcustomerlon[1], self.options.pdcustomerlon[2], self.options.pdcustomerlat[0], self.options.pdcustomerlat[1], self.options.pdcustomerlat[2], self.options.pdcustomersouthern, self.place.lat, self.houses.ascmc2, self.obl[0], self.raequasc)
		return self.cpd

	def iter_pd_promissor_points(self):
		points = []
		cpd = self._ensure_pd_customer_point(False)
		if self.options.pdcustomer and cpd != None:
			points.append(('user_prom', cpd))
		chiron_point = self._get_chiron_pd_point()
		if chiron_point is not None and getattr(self.options, 'pdpromchiron', getattr(self.options, 'showchiron', True)):
			points.append(('chiron', chiron_point))
		arabic_part_point = getattr(self, 'pd_arabic_part_prom', None)
		if arabic_part_point is not None:
			points.append(('arabic_part_prom', arabic_part_point))
		return points

	def iter_pd_significator_points(self):
		points = []
		cpd2 = self._ensure_pd_customer_point(True)
		if self.options.pdcustomer2 and cpd2 != None:
			points.append(('user_sig', cpd2))
		chiron_point = self._get_chiron_pd_point()
		if chiron_point is not None and getattr(self.options, 'pdsigchiron', getattr(self.options, 'showchiron', True)):
			points.append(('chiron', chiron_point))
		vertex_point = self._get_vertex_pd_point()
		if vertex_point is not None and getattr(self.options, 'pdsigvertex', False):
			points.append(('vertex', vertex_point))
		arabic_part_point = getattr(self, 'pd_arabic_part_sig', None)
		if arabic_part_point is not None:
			points.append(('arabic_part_sig', arabic_part_point))
		return points


	def inorbsinister(self, val1, val2, pos, asp):
		'''Checks if inside orb (Pisces-Aries transition also!), val1 is leftorbboundary, val2 is rightorb boundary'''

		asppoint = pos+Chart.Aspects[asp]

		if (val1 >= 360.0 and val2 < 360.0) or (val1 > 0 and val2 < 0):#left is in Aries, right is in Pisces
			if (val1 >= 0 and val2 < 0):
				val1 += 360.0
				val2 += 360.0
			if asp == Chart.CONJUNCTIO and pos < 20.0: # 20.0 is arbitrary, just to see if the planet is close to the Pisces-Aries transition
				asppoint += 360.0
		else:
			val1 = util.normalize(val1)
			val2 = util.normalize(val2)
			asppoint = util.normalize(asppoint)

		if val1 > asppoint and val2 < asppoint:
			return True

		return False 


	def inorbdexter(self, val1, val2, pos, asp):
		'''Checks if inside orb (Pisces-Aries transition also!), val1 is leftorbboundary, val2 is rightorb boundary'''

		asppoint = pos-Chart.Aspects[asp]
		asppoint = util.normalize(asppoint)

		if (val1 >= 360.0 and val2 < 360.0) or (val1 > 0 and val2 < 0):#left is in Aries, right is in Pisces
			asppoint += 360.0
			if (val1 >= 0 and val2 < 0):
				val1 += 360.0
				val2 += 360.0
			if asppoint < 20.0: # 20.0 is arbitrary, just to see if the planet is close to the Pisces-Aries transition
				asppoint += 360.0
		else:
			val1 = util.normalize(val1)
			val2 = util.normalize(val2)

		if val1 > asppoint and val2 < asppoint:
			return True

		return False 


	def calcProfPos(self, prof):
		if getattr(self, 'syzygy', None) is None:
			try:
				self.calcSyzygy()
			except Exception:
				self.syzygy = None
		self.planets.calcProfPos(prof)
		if getattr(self, 'chiron', None) is not None:
			self.chiron.calcProfPos(prof)
		self.houses.calcProfPos(prof)
		self.fortune.calcProfPos(prof)
		if getattr(self, 'syzygy', None) is not None:
			self.syzygy.calcProfPos(prof)

	def apply_mundane_profection(self, source_chart, placelat, obl):
		if source_chart is None:
			return
		self.planets.calcMundaneProfPos(self.houses.ascmc2, source_chart.planets.planets, placelat, obl)
		if getattr(self, 'chiron', None) is not None and getattr(source_chart, 'chiron', None) is not None:
			self.chiron.calcMundaneProfPos(self.houses.ascmc2, source_chart.chiron, placelat, obl)
		self.fortune.calcMundaneProfPos(self.houses.ascmc2, source_chart.fortune, placelat, obl)
		self.calcAspMatrix()
		self.calcLoFAspMatrix()


	def printAspMatrix(self):
		planets = ('Sun', 'Moon', 'Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune', 'Pluto', 'Node')		
		partxt = ('none', 'parallel', 'contrap')

		for i in range(self.planets.PLANETS_NUM-1):
			for j in range(self.planets.PLANETS_NUM-1):
				if j > i:
					if self.aspmatrix[j][i].typ != Chart.NONE:
						plel = 0
						if self.aspmatrix[j][i].parallel == Chart.PARALLEL:
							plel = 1
						if self.aspmatrix[j][i].parallel == Chart.CONTRAPARALLEL:
							plel = 2
						extxt = ''
						if self.aspmatrix[j][i].exact:
							extxt = 'exact'
						appltxt = 'sepa'
						if self.aspmatrix[j][i].appl:
							appltxt = 'appl'
						print ('%s - %s: type=%d diff=%f %s par=%s %s\n' % (planets[i], planets[j], self.aspmatrix[j][i].typ, self.aspmatrix[j][i].dif, appltxt, partxt[plel], extxt))

		print ('\n')

		hname = ('Asc', '2', '3', 'X', '11', '12')
		hnum = 6
		for i in range(self.planets.PLANETS_NUM-2):
			for j in range(hnum):
				if self.aspmatrixH[j][i].typ != Chart.NONE:
					extxt = ''
					if self.aspmatrixH[j][i].exact:
						extxt = 'exact'
					appltxt = 'sepa'
					if self.aspmatrixH[j][i].appl:
						appltxt = 'appl'
					print ('%s - %s: type=%d %s diff=%f  %s\n' % (planets[i], hname[j], self.aspmatrixH[j][i].typ, appltxt, self.aspmatrixH[j][i].dif, extxt))
