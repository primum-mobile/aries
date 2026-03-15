# -*- coding: utf-8 -*-


class SearchQuery(object):
	TECHNIQUE_TRANSITS = 'transits'
	TECHNIQUE_PROFECTIONS = 'profections'
	TECHNIQUE_PRIMARY_DIRECTIONS = 'primary_directions'

	ASPECT_CONJUNCTION = 'conjunction'
	ASPECT_SEXTILE = 'sextile'
	ASPECT_SQUARE = 'square'
	ASPECT_TRINE = 'trine'
	ASPECT_QUINCUNX = 'quincunx'
	ASPECT_OPPOSITION = 'opposition'

	def __init__(self):
		self.promittor_ids = []
		self.significator_ids = []
		self.techniques = []
		self.aspects = []


	def set_promittor_ids(self, ids):
		self.promittor_ids = list(ids)


	def set_significator_ids(self, ids):
		self.significator_ids = list(ids)


	def set_techniques(self, techniques):
		self.techniques = list(techniques)


	def set_aspects(self, aspects):
		self.aspects = list(aspects)


	def get_combination_count(self):
		if len(self.promittor_ids) == 0 or len(self.significator_ids) == 0:
			return 0

		if len(self.techniques) == 0 or len(self.aspects) == 0:
			return 0

		return len(self.promittor_ids)*len(self.significator_ids)*len(self.techniques)*len(self.aspects)


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
		self.can_open_chart = False
		self.can_export_time = False
		self.can_export_ics = False


	def has_actions(self):
		return self.can_open_chart or self.can_export_time or self.can_export_ics
