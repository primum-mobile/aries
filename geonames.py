# -*- coding: utf-8 -*-
# SPDX-FileCopyrightText: Morinus contributors
# SPDX-FileCopyrightText: 2026 Max Lange (Aries modifications)
# SPDX-License-Identifier: GPL-3.0-or-later
# Modified for Aries in 2026 by Max Lange.

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
	NAME, LON, LAT, COUNTRYCODE, COUNTRYNAME, ALTITUDE, GMTOFFS, ADMIN1CODE, ADMIN1NAME = range(0, 9)
	_tz_cache = {}
	_elevation_cache = {}
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
	def get_cached_elevation(cls, longitude, latitude):
		try:
			key = cls._coord_key(longitude, latitude)
		except Exception:
			return None
		return cls._elevation_cache.get(key)

	@classmethod
	def get_timezone_name(cls, longitude, latitude, allow_remote=False):
		try:
			key = cls._coord_key(longitude, latitude)
		except Exception:
			return None

		if key in cls._tz_cache:
			return cls._tz_cache[key]

		try:
			import localcities
			tzname = localcities.timezone_near(longitude, latitude)
			if tzname:
				cls._tz_cache[key] = tzname
				return tzname
		except Exception:
			pass

		if not allow_remote:
			return None

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
		cached = Geonames.get_cached_elevation(longitude, latitude)
		if cached is not None:
			return cached
		url = "http://api.geonames.org/astergdemJSON?%s"
		params = {
			"username" : self.username,
			"lng" : longitude,
			"lat" : latitude
			}
		elevation = self.fetch_values_from_page(url, params, "astergdem")
		if elevation is not None:
			try:
				Geonames._elevation_cache[Geonames._coord_key(longitude, latitude)] = elevation
			except Exception:
				pass
		return elevation


	def get_location_info(self):
		try:
			import localcities
			local = localcities.search(self.city, self.maxnum)
			if local:
				for item in local:
					try:
						key = Geonames._coord_key(item[Geonames.LON], item[Geonames.LAT])
					except Exception:
						continue
					altitude = item[Geonames.ALTITUDE]
					if altitude is not None:
						Geonames._elevation_cache[key] = altitude
				self.li = list(local)
				return True
		except Exception:
			pass

		info = self.get_basic_info(self.city)

		if not info:
			return False

		self.li = []
		for it in info:
			if "lng" not in it or "lat" not in it:
				continue
			try:
				longitude = float(it.get("lng"))
				latitude = float(it.get("lat"))
			except (TypeError, ValueError):
				continue
			placename = it.get("name", "")
			country_code = it.get("countryCode", "")
			country_name = it.get("countryName", "")

			gmt_offset = None
			elevation  = None

			self.li.append((placename, longitude, latitude,
				country_code, country_name, elevation, gmt_offset))
			try:
				Geonames._elevation_cache[Geonames._coord_key(longitude, latitude)] = elevation
			except Exception:
				pass

		return len(self.li) > 0
