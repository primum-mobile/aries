# -*- coding: utf-8 -*-
# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

import astrology
import common
import fortune
import houses
import mtexts
import planets


KIND_AGE = 'age'
KIND_DATE = 'date'
KIND_ASC = 'asc'
KIND_MC = 'mc'
KIND_HOURLORD = 'hourlord'
KIND_FORTUNE = 'fortune'
KIND_BODY = 'body'


def _hour_lord_label():
	try:
		return mtexts.txts['HourLord']
	except Exception:
		return u'Hour Lord'


def _include_transcendental_in_table(body_id, options):
	if not getattr(options, 'intables', False):
		return True
	if body_id == astrology.SE_URANUS and not options.transcendental[0]:
		return False
	if body_id == astrology.SE_NEPTUNE and not options.transcendental[1]:
		return False
	if body_id == astrology.SE_PLUTO and not options.transcendental[2]:
		return False
	return True


def build_columns(chrt, options, mainsigs):
	columns = [
		{'kind': KIND_AGE, 'label': mtexts.txts['Age']},
		{'kind': KIND_DATE, 'label': mtexts.txts['Date']},
		{'kind': KIND_ASC, 'label': mtexts.txts['Asc']},
		{'kind': KIND_MC, 'label': mtexts.txts['MC']},
		{'kind': KIND_HOURLORD, 'label': _hour_lord_label()},
		{'kind': KIND_BODY, 'body_id': astrology.SE_SUN, 'label': common.common.get_planet_glyph(astrology.SE_SUN)},
		{'kind': KIND_BODY, 'body_id': astrology.SE_MOON, 'label': common.common.get_planet_glyph(astrology.SE_MOON)},
		{'kind': KIND_FORTUNE, 'label': common.common.fortune},
	]
	if mainsigs:
		return columns

	for body_id in (
		astrology.SE_MERCURY,
		astrology.SE_VENUS,
		astrology.SE_MARS,
		astrology.SE_JUPITER,
		astrology.SE_SATURN,
		astrology.SE_URANUS,
		astrology.SE_NEPTUNE,
		astrology.SE_PLUTO,
	):
		if _include_transcendental_in_table(body_id, options):
			columns.append({
				'kind': KIND_BODY,
				'body_id': body_id,
				'label': common.common.get_planet_glyph(body_id),
			})

	if getattr(chrt, 'chiron', None) is not None and common.common.is_planet_visible(options, astrology.SE_CHIRON):
		columns.append({
			'kind': KIND_BODY,
			'body_id': astrology.SE_CHIRON,
			'label': common.common.get_planet_glyph(astrology.SE_CHIRON),
		})

	return columns


def is_body_column(column):
	return column.get('kind') == KIND_BODY


def get_column_width(column, cell_width, big_cell_width):
	if column.get('kind') == KIND_AGE:
		return cell_width
	return big_cell_width


def get_column_lon(chrt, column):
	kind = column.get('kind')
	if kind == KIND_ASC:
		return chrt.houses.ascmc[houses.Houses.ASC]
	if kind == KIND_MC:
		return chrt.houses.ascmc[houses.Houses.MC]
	if kind == KIND_FORTUNE:
		return chrt.fortune.fortune[fortune.Fortune.LON]
	if kind == KIND_BODY:
		body = common.common.get_chart_planet(chrt, column.get('body_id'))
		if body is None:
			return None
		return body.data[planets.Planet.LONG]
	return None


def get_body_header_color(chrt, options, body_id, bw, default_color):
	if bw:
		return (0, 0, 0)
	if getattr(options, 'useplanetcolors', False):
		color_idx = min(common.common.get_planet_color_index(body_id), len(options.clrindividual)-1)
		return options.clrindividual[color_idx]
	if body_id == astrology.SE_CHIRON:
		return options.clrperegrin
	palette = (
		options.clrdomicil,
		options.clrexal,
		options.clrperegrin,
		options.clrcasus,
		options.clrexil,
	)
	try:
		return palette[chrt.dignity(body_id)]
	except Exception:
		return default_color
