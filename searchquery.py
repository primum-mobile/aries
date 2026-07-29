# -*- coding: utf-8 -*-
# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later


class SearchQuery(object):
	TECHNIQUE_TRANSITS = 'transits'
	TECHNIQUE_CONVERSE_TRANSITS = 'converse_transits'
	TECHNIQUE_PROFECTIONS = 'profections'
	TECHNIQUE_SECONDARY_DIRECTIONS = 'secondary_directions'
	TECHNIQUE_PRIMARY_DIRECTIONS = 'primary_directions'
	TECHNIQUE_MUNDANE_WEATHER = 'mundane_weather'
	TECHNIQUE_HELIACAL_PHASES = 'heliacal_phases'
	TECHNIQUE_INGRESS_SYNODIC = 'sign_changes'
	ASPECT_TECHNIQUES = (
		TECHNIQUE_TRANSITS,
		TECHNIQUE_CONVERSE_TRANSITS,
		TECHNIQUE_PROFECTIONS,
		TECHNIQUE_SECONDARY_DIRECTIONS,
		TECHNIQUE_PRIMARY_DIRECTIONS,
		TECHNIQUE_MUNDANE_WEATHER,
	)

	ASPECT_CONJUNCTION = 'conjunction'
	ASPECT_SEXTILE = 'sextile'
	ASPECT_SQUARE = 'square'
	ASPECT_TRINE = 'trine'
	ASPECT_QUINCUNX = 'quincunx'
	ASPECT_OPPOSITION = 'opposition'
	ASPECT_SIGN_CHANGE = 'sign_change'
	ASPECT_CAZIMI = 'cazimi'
	ASPECT_STATION_RETROGRADE = 'station_retrograde'
	ASPECT_STATION_DIRECT = 'station_direct'
	ASPECT_STATION = 'station'
	ASPECT_HELIACAL_MORNING_FIRST = 'heliacal_morning_first'
	ASPECT_HELIACAL_MORNING_LAST = 'heliacal_morning_last'
	ASPECT_HELIACAL_EVENING_FIRST = 'heliacal_evening_first'
	ASPECT_HELIACAL_EVENING_LAST = 'heliacal_evening_last'

	MOTION_RX = 'rx'
	MOTION_DIRECT = 'd'

	# Progression-method selector for SECONDARY_DIRECTIONS-style searches. Values
	# match posfordate.SECONDARY (0), posfordate.MINOR (2), posfordate.TERTIARY (3).
	# Stored as int to avoid importing posfordate at the query layer.
	PROGRESSION_METHOD_SECONDARY = 0
	PROGRESSION_METHOD_MINOR = 2
	PROGRESSION_METHOD_TERTIARY = 3

	def __init__(self):
		self.promittor_ids = []
		self.significator_ids = []
		self.techniques = []
		self.aspects = []
		self.include_sign_changes = False
		self.object_motion_filters = {}
		self.progression_method = self.PROGRESSION_METHOD_SECONDARY


	def set_progression_method(self, method):
		try:
			method = int(method)
		except Exception:
			method = self.PROGRESSION_METHOD_SECONDARY
		if method not in (
			self.PROGRESSION_METHOD_SECONDARY,
			self.PROGRESSION_METHOD_MINOR,
			self.PROGRESSION_METHOD_TERTIARY,
		):
			method = self.PROGRESSION_METHOD_SECONDARY
		self.progression_method = method


	def set_promittor_ids(self, ids):
		self.promittor_ids = list(ids)


	def set_significator_ids(self, ids):
		self.significator_ids = list(ids)


	def set_techniques(self, techniques):
		self.techniques = list(techniques)


	def set_aspects(self, aspects):
		self.aspects = list(aspects)


	def set_include_sign_changes(self, enabled):
		self.include_sign_changes = bool(enabled)


	def set_object_motion_filter(self, object_id, motion):
		if not object_id:
			return
		if motion:
			self.object_motion_filters[object_id] = motion
		elif object_id in self.object_motion_filters:
			del self.object_motion_filters[object_id]


	def set_object_motion_filters(self, filters):
		self.object_motion_filters = {}
		for object_id, motion in dict(filters).items():
			self.set_object_motion_filter(object_id, motion)


	def has_object_motion_filters(self):
		return len(self.object_motion_filters) != 0


	def get_combination_count(self):
		if len(self.promittor_ids) == 0:
			return 0

		count = 0
		aspect_techniques = [
			technique
			for technique in self.techniques
			if technique in self.ASPECT_TECHNIQUES
		]
		if len(aspect_techniques) != 0 and len(self.aspects) != 0 and len(self.significator_ids) != 0:
			count += len(self.promittor_ids)*len(self.significator_ids)*len(aspect_techniques)*len(self.aspects)
		if self.include_sign_changes:
			count += len(self.promittor_ids)
		if self.TECHNIQUE_HELIACAL_PHASES in self.techniques:
			count += len(self.promittor_ids)
		return count


class SearchResult(object):
	def __init__(self, technique, aspect, promittor_id, significator_id):
		self.technique = technique
		self.aspect = aspect
		self.promittor_id = promittor_id
		self.significator_id = significator_id
		self.promittor_label = ''
		self.significator_label = ''
		self.event_label = ''
		self.event_date = ''
		self.event_time = ''
		self.event_jd = None
		self.event_year = None
		self.event_month = None
		self.event_day = None
		self.event_hour = None
		self.event_minute = None
		self.event_second = None
		self.status = ''
		self.notes = ''
		self.metadata = {}
		self.can_open_chart = False
		self.can_export_time = False
		self.can_export_ics = False


	def has_actions(self):
		return self.can_open_chart or self.can_export_time or self.can_export_ics
