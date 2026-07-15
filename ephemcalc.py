import astrology
import calendar
import chart
import planets
import util


class EphemCalc:

	PLANET = 0
	DAY = 1
#	HOUR = 2

	def __init__(self, year, opts, start_month=1, start_day=1, days=None):
		self.year = year
		self.start_month = int(start_month)
		self.start_day = int(start_day)
		if days is None:
			self.days = self._default_days()
		else:
			self.days = int(days)
		self.flags = astrology.SEFLG_SPEED+astrology.SEFLG_SWIEPH
		self.series = {}
		self.posArr = []

		self.calc(opts)

	def _default_days(self):
		total = 0
		year = int(self.year)
		month = int(self.start_month)
		for _ in range(12):
			total += calendar.monthrange(year, month)[1]
			year, month = util.incrMonth(year, month)
		return total

	@staticmethod
	def get_planet_ids(opts):
		planet_ids = [
			astrology.SE_SUN,
			astrology.SE_MOON,
			astrology.SE_MERCURY,
			astrology.SE_VENUS,
			astrology.SE_MARS,
			astrology.SE_JUPITER,
			astrology.SE_SATURN,
		]
		if opts.transcendental[chart.Chart.TRANSURANUS]:
			planet_ids.append(astrology.SE_URANUS)
		if opts.transcendental[chart.Chart.TRANSNEPTUNE]:
			planet_ids.append(astrology.SE_NEPTUNE)
		if opts.transcendental[chart.Chart.TRANSPLUTO]:
			planet_ids.append(astrology.SE_PLUTO)
		if getattr(opts, 'showchiron', True):
			planet_ids.append(astrology.SE_CHIRON)
		return planet_ids


	def calc(self, opts):
		ayanamsha = 0.0
		if opts.ayanamsha != 0:
			astrology.swe_set_sid_mode(astrology.ayanamsha_swe_mode(opts.ayanamsha), 0, 0)
			tim = chart.Time(self.year, 1, 1, 0, 0, 0, False, chart.Time.GREGORIAN, chart.Time.GREENWICH, True, 0, 0, False, None, False)
			ayanamsha = astrology.swe_get_ayanamsa_ut(tim.jd)

		#calculating one per day (per hour would be too slow)
		for planet_id in self.get_planet_ids(opts):
			y = self.year
			m = self.start_month
			d = self.start_day
			longitudes = []
			declinations = []
			for num in range(self.days):
				time = chart.Time(y, m, d, 0, 0, 0, False, chart.Time.GREGORIAN, chart.Time.GREENWICH, True, 0, 0, False, None, False)
				pl = planets.Planet(time.jd, planet_id, self.flags)
				lon = pl.data[planets.Planet.LONG]
				if opts.ayanamsha != 0:
					lon = util.normalize(lon-ayanamsha)
				longitudes.append(lon)
				declinations.append(pl.dataEqu[planets.Planet.DECLEQU])
				y, m, d = util.incrDay(y, m, d)

			self.series[planet_id] = {
				'longitude': longitudes,
				'declination': declinations,
			}
			self.posArr.append(longitudes)
