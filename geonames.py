# -*- coding: utf-8 -*-
import json
import urllib.request as urllib2
import urllib
from datetime import datetime, timedelta, timezone
try:
	from zoneinfo import ZoneInfo            # Py3.9+
except Exception:
	try:
		from backports.zoneinfo import ZoneInfo  # Py3.7–3.8
	except Exception:
		ZoneInfo = None

#Csaba's code

class Geonames:
	NAME, LON, LAT, COUNTRYCODE, COUNTRYNAME, ALTITUDE, GMTOFFS = range(0, 7)
	_tz_cache = {}
	username='morinus'
	langs = ("en", "hu", "it", "fr", "ru", "es","en","en","en")

	def __init__(self, city, maxnum, langid):
		self.city = city

		self.maxnum = maxnum
		self.langid = langid
		self.li = None


	def fetch_values_from_page(self, url, params, key):
		url = url % urllib.parse.urlencode(params)

		try:
			page = urllib2.urlopen(url)
			doc = json.loads(page.read())
			values = doc.get(key, None)
		except Exception as e:
			values = None
#			print(e)

		return values


	def get_basic_info(self, city):
		url = "http://api.geonames.org/searchJSON?%s"

		params = {
			"username" : self.username,
			"lang" : Geonames.langs[self.langid],
			"q" : city,
			"featureClass" : "P",
			"maxRows" : self.maxnum,
			"orderby" : "relevance"    # ← 추가(선택사항, 지원되면 상위가 더 빨리 뜸)
		}

		return self.fetch_values_from_page(url, params, "geonames")

	@staticmethod
	def _coord_key(longitude, latitude):
		return '%.4f,%.4f' % (float(longitude), float(latitude))

	@classmethod
	def get_timezone_name(cls, longitude, latitude):
		try:
			key = cls._coord_key(longitude, latitude)
		except Exception:
			return None

		if key in cls._tz_cache:
			return cls._tz_cache[key]

		url = "http://api.geonames.org/timezoneJSON?%s"
		params = {
			"username": cls.username,
			"lng": longitude,
			"lat": latitude
		}
		url = url % urllib.parse.urlencode(params)
		tzname = None
		try:
			page = urllib2.urlopen(url, timeout=4)
			doc = json.loads(page.read())
			tzname = doc.get("timezoneId", None)
		except Exception:
			tzname = None

		cls._tz_cache[key] = tzname
		return tzname

	@classmethod
	def resolve_zone_fields(cls, year, month, day, hour, minute, second, place, tzid=''):
		if ZoneInfo is None or place is None:
			return None
		if not tzid:
			tzid = cls.get_timezone_name(place.lon, place.lat)
		if not tzid:
			return None
		try:
			local_dt = datetime(year, month, day, hour, minute, second, tzinfo=ZoneInfo(tzid))
			total_offset = local_dt.utcoffset()
			dst_offset = local_dt.dst()
		except Exception:
			return None
		if total_offset is None:
			return None
		if dst_offset is None:
			dst_offset = timedelta(0)
		total_minutes = int(total_offset.total_seconds() // 60)
		dst_minutes = int(dst_offset.total_seconds() // 60)
		standard_minutes = total_minutes - dst_minutes
		plus = standard_minutes >= 0
		absolute_minutes = abs(standard_minutes)
		zh = absolute_minutes // 60
		zm = absolute_minutes % 60
		total_sign = '+' if total_minutes >= 0 else '-'
		total_abs = abs(total_minutes)
		total_h = total_abs // 60
		total_m = total_abs % 60
		return {
			'tzid': tzid,
			'plus': plus,
			'zh': zh,
			'zm': zm,
			'daylightsaving': dst_minutes != 0,
			'label': '%s (UTC%s%d:%02d%s)' % (
				tzid.split('/')[-1].replace('_', ' '),
				total_sign,
				total_h,
				total_m,
				', DST' if dst_minutes != 0 else '',
			),
		}

	def get_gmt_offset(self, longitude, latitude):
		tzname = Geonames.get_timezone_name(longitude, latitude)
		if tzname and ZoneInfo is not None:
			try:
				tz = ZoneInfo(tzname)
				from datetime import timezone as _tz
				offs = []
				for m in range(1, 13):
					dt_utc = datetime(2024, m, 1, 12, tzinfo=_tz.utc)
					off = dt_utc.astimezone(tz).utcoffset()
					if off is not None:
						offs.append(off.total_seconds() / 3600.0)
				if offs:
					return min(offs)
			except Exception:
				pass
		url = "http://api.geonames.org/timezoneJSON?%s"
		params = {
			"username" : self.username,
			"lng" : longitude,
			"lat" : latitude
			}
		return self.fetch_values_from_page(url, params, "rawOffset")


	def get_elevation(self, longitude, latitude):
		url = "http://api.geonames.org/astergdemJSON?%s"
		params = {
			"username" : self.username,
			"lng" : longitude,
			"lat" : latitude
			}
		return self.fetch_values_from_page(url, params, "astergdem")


	def get_location_info(self):
		info = self.get_basic_info(self.city)

		if not info:
			return False

		self.li = []
		for it in info:
			longitude = it.get("lng", 0)
			latitude = it.get("lat", 0)
			placename = it.get("name", "")
			country_code = it.get("countryCode", "")
			country_name = it.get("countryName", "")

			gmt_offset = None
			elevation  = None

			self.li.append((placename, float(longitude), float(latitude), 
				country_code, country_name, elevation, gmt_offset))

		return True



