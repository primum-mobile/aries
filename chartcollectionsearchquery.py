# -*- coding: utf-8 -*-
# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

import chart


class ChartCollectionSearchQuery(object):
	MOTION_ANY = ''
	MOTION_DIRECT = 'direct'
	MOTION_RETROGRADE = 'retrograde'
	MOTION_STATION_DIRECT = 'station_direct'
	MOTION_STATION_RETROGRADE = 'station_retrograde'

	DEFAULT_STATION_WINDOW_DAYS = 2.0

	def __init__(self):
		self.placement_clauses = []
		self.aspect_clauses = []
		self.station_window_days = self.DEFAULT_STATION_WINDOW_DAYS

	def add_placement(self, clause):
		if clause is not None:
			self.placement_clauses.append(clause)

	def add_aspect(self, clause):
		if clause is not None:
			self.aspect_clauses.append(clause)

	def active_placement_clauses(self):
		return [clause for clause in self.placement_clauses if clause.is_active()]

	def active_aspect_clauses(self):
		return [clause for clause in self.aspect_clauses if clause.is_active()]

	def is_active(self):
		return bool(self.active_placement_clauses() or self.active_aspect_clauses())


class PlacementClause(object):
	def __init__(self, object_ids=None, sign_indices=None, degree=None, degree_orb=None, house_numbers=None, motion=''):
		self.object_ids = _clean_list(object_ids)
		self.sign_indices = _clean_int_list(sign_indices)
		self.degree = _clean_float_or_none(degree)
		self.degree_orb = _clean_float_or_none(degree_orb)
		self.house_numbers = _clean_int_list(house_numbers)
		self.motion = motion or ''

	def is_active(self):
		return bool(
			self.object_ids
			or self.sign_indices
			or self.degree is not None
			or self.house_numbers
			or self.motion
		)


class AspectClause(object):
	COPRESENCE = -2

	def __init__(self, object_a_ids=None, aspect_type=None, object_b_ids=None, orb=1.0):
		self.object_a_ids = _clean_list(object_a_ids)
		self.object_b_ids = _clean_list(object_b_ids)
		self.aspect_type = _clean_int_or_none(aspect_type)
		self.orb = _clean_float_or_none(orb)
		if self.orb is None:
			self.orb = 1.0

	def is_active(self):
		return self.aspect_type is not None and self.aspect_type != chart.Chart.NONE


def _clean_list(values):
	if values is None:
		return []
	if isinstance(values, (str, bytes)):
		values = [values]
	out = []
	for value in values:
		if value is None:
			continue
		value = str(value).strip()
		if value:
			out.append(value)
	return out


def _clean_int_list(values):
	out = []
	for value in _clean_list(values):
		try:
			out.append(int(value))
		except Exception:
			pass
	return out


def _clean_float_or_none(value):
	if value is None:
		return None
	if isinstance(value, str) and not value.strip():
		return None
	try:
		return float(value)
	except Exception:
		return None


def _clean_int_or_none(value):
	if value is None:
		return None
	if isinstance(value, str) and not value.strip():
		return None
	try:
		return int(value)
	except Exception:
		return None
