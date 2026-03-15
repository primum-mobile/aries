# -*- coding: utf-8 -*-

import astrology
import houses
import planets
import fortune
import arabicparts
import mtexts
import util


SIGNS = (
	mtexts.txts['Ari'],
	mtexts.txts['Tau'],
	mtexts.txts['Gem'],
	mtexts.txts['Can'],
	mtexts.txts['Leo2'],
	mtexts.txts['Vir'],
	mtexts.txts['Lib'],
	mtexts.txts['Sco'],
	mtexts.txts['Sag'],
	mtexts.txts['Cap'],
	mtexts.txts['Aqu'],
	mtexts.txts['Pis'],
)


class SearchObject(object):
	FAMILY_PLANET = 'planet'
	FAMILY_NODE = 'node'
	FAMILY_ANGLE = 'angle'
	FAMILY_FORTUNE = 'fortune'
	FAMILY_PART = 'part'

	SOURCE_PLANET = 'planet'
	SOURCE_ANGLE = 'angle'
	SOURCE_FORTUNE = 'fortune'
	SOURCE_ARABIC_PART = 'arabic_part'

	def __init__(self, oid, label, family, source_type, longitude, planet_index=None, can_promittor=False, can_significator=False):
		self.id = oid
		self.label = label
		self.family = family
		self.source_type = source_type
		self.longitude = longitude
		self.planet_index = planet_index
		self.can_promittor = can_promittor
		self.can_significator = can_significator


def format_longitude(longitude):
	if longitude is None:
		return ''

	lon = util.normalize(float(longitude))
	sign = int(lon/30.0)
	deg, minute, second = util.decToDeg(lon-sign*30.0)
	return '%02d %s %02d\' %02d"' % (deg, SIGNS[sign], minute, second)


class SearchCatalog(object):
	def __init__(self, chrt):
		self.chart = chrt
		self.objects = []
		self.objects_by_id = {}
		self.promittor_ids = []
		self.significator_ids = []
		self.builtin_significator_ids = []
		self.part_ids = []

		self._build()


	def _build(self):
		self._add_planetary_objects()
		self._add_fixed_points()
		self._add_arabic_parts()


	def _add_object(self, obj):
		self.objects.append(obj)
		self.objects_by_id[obj.id] = obj

		if obj.can_promittor:
			self.promittor_ids.append(obj.id)

		if obj.can_significator:
			self.significator_ids.append(obj.id)
			if obj.family == SearchObject.FAMILY_PART:
				self.part_ids.append(obj.id)
			else:
				self.builtin_significator_ids.append(obj.id)


	def _add_planetary_objects(self):
		planet_specs = (
			('sun', astrology.SE_SUN, mtexts.txts['Sun'], SearchObject.FAMILY_PLANET),
			('moon', astrology.SE_MOON, mtexts.txts['Moon'], SearchObject.FAMILY_PLANET),
			('mercury', astrology.SE_MERCURY, mtexts.txts['Mercury'], SearchObject.FAMILY_PLANET),
			('venus', astrology.SE_VENUS, mtexts.txts['Venus'], SearchObject.FAMILY_PLANET),
			('mars', astrology.SE_MARS, mtexts.txts['Mars'], SearchObject.FAMILY_PLANET),
			('jupiter', astrology.SE_JUPITER, mtexts.txts['Jupiter'], SearchObject.FAMILY_PLANET),
			('saturn', astrology.SE_SATURN, mtexts.txts['Saturn'], SearchObject.FAMILY_PLANET),
			('uranus', astrology.SE_URANUS, mtexts.txts['Uranus'], SearchObject.FAMILY_PLANET),
			('neptune', astrology.SE_NEPTUNE, mtexts.txts['Neptune'], SearchObject.FAMILY_PLANET),
			('pluto', astrology.SE_PLUTO, mtexts.txts['Pluto'], SearchObject.FAMILY_PLANET),
			('asc_node', astrology.SE_PLUTO+1, mtexts.txts['AscNode'], SearchObject.FAMILY_NODE),
			('desc_node', astrology.SE_PLUTO+2, mtexts.txts['DescNode'], SearchObject.FAMILY_NODE),
		)

		for key, planet_index, label, family in planet_specs:
			try:
				lon = self.chart.planets.planets[planet_index].data[planets.Planet.LONG]
			except Exception:
				continue

			self._add_object(
				SearchObject(
					'planet:%s' % key,
					label,
					family,
					SearchObject.SOURCE_PLANET,
					lon,
					planet_index=planet_index,
					can_promittor=True,
					can_significator=True
				)
			)


	def _add_fixed_points(self):
		try:
			asc_lon = self.chart.houses.ascmc[houses.Houses.ASC]
			mc_lon = self.chart.houses.ascmc[houses.Houses.MC]
		except Exception:
			asc_lon = None
			mc_lon = None

		try:
			lof_lon = self.chart.fortune.fortune[fortune.Fortune.LON]
		except Exception:
			lof_lon = None

		if asc_lon is not None:
			self._add_object(
				SearchObject(
					'angle:asc',
					mtexts.txts['Asc'],
					SearchObject.FAMILY_ANGLE,
					SearchObject.SOURCE_ANGLE,
					asc_lon,
					can_promittor=True,
					can_significator=True
				)
			)

		if mc_lon is not None:
			self._add_object(
				SearchObject(
					'angle:mc',
					mtexts.txts['MC'],
					SearchObject.FAMILY_ANGLE,
					SearchObject.SOURCE_ANGLE,
					mc_lon,
					can_promittor=True,
					can_significator=True
				)
			)

		if lof_lon is not None:
			self._add_object(
				SearchObject(
					'point:lof',
					mtexts.txts['LoF'],
					SearchObject.FAMILY_FORTUNE,
					SearchObject.SOURCE_FORTUNE,
					lof_lon,
					can_promittor=True,
					can_significator=True
				)
			)


	def _add_arabic_parts(self):
		if self.chart.parts is None or self.chart.parts.parts is None:
			return

		for idx, part in enumerate(self.chart.parts.parts):
			try:
				label = part[arabicparts.ArabicParts.NAME]
				lon = part[arabicparts.ArabicParts.LONG]
			except Exception:
				continue

			self._add_object(
				SearchObject(
					'part:%03d' % idx,
					label,
					SearchObject.FAMILY_PART,
					SearchObject.SOURCE_ARABIC_PART,
					lon,
					can_promittor=False,
					can_significator=True
				)
			)


	def get(self, oid):
		return self.objects_by_id.get(oid)


	def get_labels(self, ids):
		return [self.objects_by_id[oid].label for oid in ids if oid in self.objects_by_id]

