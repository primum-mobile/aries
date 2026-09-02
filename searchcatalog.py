# -*- coding: utf-8 -*-
# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

import astrology
import fixstars
import houses
import planets
import fortune
import arabicparts
import mtexts
import util
import eclipses


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
	FAMILY_SYZYGY = 'syzygy'
	FAMILY_ECLIPSE = 'eclipse'
	FAMILY_FIXED_STAR = 'fixed_star'
	FAMILY_PART = 'part'
	FAMILY_CUSTOM_POINT = 'custom_point'

	SOURCE_PLANET = 'planet'
	SOURCE_ANGLE = 'angle'
	SOURCE_FORTUNE = 'fortune'
	SOURCE_SYZYGY = 'syzygy'
	SOURCE_ECLIPSE = 'eclipse'
	SOURCE_FIXED_STAR = 'fixed_star'
	SOURCE_ARABIC_PART = 'arabic_part'
	SOURCE_CUSTOM_POINT = 'custom_point'

	def __init__(
		self,
		oid,
		label,
		family,
		source_type,
		longitude,
		planet_index=None,
		can_promittor=False,
		can_significator=False,
		display_glyph='',
		display_glyph_font='morinus',
		display_marker='',
		display_segments=None,
		fixedstar_code=None,
	):
		self.id = oid
		self.label = label
		self.family = family
		self.source_type = source_type
		self.longitude = longitude
		self.planet_index = planet_index
		self.can_promittor = can_promittor
		self.can_significator = can_significator
		self.display_glyph = display_glyph
		self.display_glyph_font = display_glyph_font
		self.display_marker = display_marker
		self.display_segments = list(display_segments or [])
		self.fixedstar_code = fixedstar_code


def format_longitude(longitude):
	if longitude is None:
		return ''

	lon = util.normalize(float(longitude))
	sign = int(lon/30.0)
	deg, minute, second = util.decToDeg(lon-sign*30.0)
	return '%02d %s %02d\' %02d"' % (deg, SIGNS[sign], minute, second)


class SearchCatalog(object):
	def __init__(self, chrt, custom_points=None):
		self.chart = chrt
		self.custom_points = list(custom_points or [])
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
		self._add_fixed_stars()
		self._add_arabic_parts()
		self._add_custom_points()


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

		try:
			if hasattr(self.chart, 'get_planet_body'):
				chiron = self.chart.get_planet_body(astrology.SE_CHIRON)
			else:
				chiron = getattr(self.chart, 'chiron', None)
			lon = chiron.data[planets.Planet.LONG]
		except Exception:
			chiron = None

		if chiron is not None:
			self._add_object(
				SearchObject(
					'planet:chiron',
					mtexts.txts.get('Chiron', 'Chiron'),
					SearchObject.FAMILY_PLANET,
					SearchObject.SOURCE_PLANET,
					lon,
					planet_index=astrology.SE_CHIRON,
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

		try:
			syzygy_lon = self.chart.syzygy.lon
		except Exception:
			syzygy_lon = None

		try:
			eclipse_event, _eclipse_jd, eclipse_lon = eclipses.selected_prenatal_eclipse_point(self.chart)
		except Exception:
			eclipse_event = None
			eclipse_lon = None

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

		if syzygy_lon is not None:
			self._add_object(
				SearchObject(
					'point:syzygy',
					'Prenatal Syzygy',
					SearchObject.FAMILY_SYZYGY,
					SearchObject.SOURCE_SYZYGY,
					syzygy_lon,
					can_promittor=False,
					can_significator=True
				)
			)

		if eclipse_lon is not None:
			self._add_object(
				SearchObject(
					'point:eclipse',
					eclipses.eclipse_event_label(eclipse_event),
					SearchObject.FAMILY_ECLIPSE,
					SearchObject.SOURCE_ECLIPSE,
					eclipse_lon,
					can_promittor=False,
					can_significator=True,
					display_glyph='Ec',
					display_glyph_font='text',
				)
			)


	def _add_fixed_stars(self):
		for idx, star in enumerate(getattr(getattr(self.chart, 'fixstars', None), 'data', ()) or ()):
			try:
				code = str(star[fixstars.FixStars.NOMNAME] or '').strip()
				name = astrology.display_fixstar_name(code, getattr(self.chart, 'options', None), star[fixstars.FixStars.NAME])
				lon = float(star[fixstars.FixStars.LON])
			except Exception:
				continue
			if not code:
				continue
			self._add_object(
				SearchObject(
					'fixstar:%s' % code,
					name or code,
					SearchObject.FAMILY_FIXED_STAR,
					SearchObject.SOURCE_FIXED_STAR,
					lon,
					can_promittor=True,
					can_significator=True,
					fixedstar_code=code,
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

	def _add_custom_points(self):
		for idx, point in enumerate(self.custom_points):
			if not isinstance(point, dict):
				continue
			try:
				lon = util.normalize(float(point.get('longitude')))
			except (TypeError, ValueError):
				continue
			label = str(point.get('label') or point.get('title') or format_longitude(lon) or 'Custom point')
			oid = str(point.get('id') or 'custom:%03d' % idx)
			display_glyph = str(point.get('display_glyph') or point.get('displayGlyph') or point.get('glyph') or '')
			display_marker = str(point.get('display_marker') or point.get('displayMarker') or point.get('marker') or '')
			display_segments = point.get('display_segments') or point.get('displaySegments') or []
			self._add_object(
				SearchObject(
					oid,
					label,
					SearchObject.FAMILY_CUSTOM_POINT,
					SearchObject.SOURCE_CUSTOM_POINT,
					lon,
					can_promittor=False,
					can_significator=True,
					display_glyph=display_glyph,
					display_marker=display_marker,
					display_segments=display_segments
				)
			)


	def get(self, oid):
		return self.objects_by_id.get(oid)


	def get_labels(self, ids):
		return [self.objects_by_id[oid].label for oid in ids if oid in self.objects_by_id]
