# -*- coding: utf-8 -*-
# SPDX-FileCopyrightText: Morinus contributors
# SPDX-FileCopyrightText: 2026 Max Lange (Aries modifications)
# SPDX-License-Identifier: GPL-3.0-or-later
# Modified for Aries in 2026 by Max Lange.

import os
import sys
import shutil
import wx
import pickle
import copy
import astrology
import chart
import fontprofiles
import primdirs
import mtexts
import app_paths
from aries.ui import tokens as _tokens

USER_PANEL_CUSTOM_NAME = 'My Panel'


class SafeColorList(list):
	def __getitem__(self, index):
		if isinstance(index, slice):
			return SafeColorList(super().__getitem__(index))
		if not self:
			raise IndexError('list index out of range')
		if index < 0:
			index += len(self)
		if index < 0:
			index = 0
		if index >= len(self):
			index = len(self) - 1
		return super().__getitem__(index)

	def __setitem__(self, index, value):
		if isinstance(index, slice):
			return super().__setitem__(index, value)
		if not self:
			raise IndexError('list assignment index out of range')
		if index < 0:
			index += len(self)
		if index < 0:
			index = 0
		if index >= len(self):
			index = len(self) - 1
		return super().__setitem__(index, value)


class Options:
	APP_COLOR_TRAILER_SCHEMA_VERSION = 1
	SPECULUM_SPEED_WORDS = 'words'
	SPECULUM_SPEED_PERCENT = 'percent'
	SPECULUM_SPEED_DAILY = 'daily'
	SPECULUM_SPEED_MODES = (
		SPECULUM_SPEED_WORDS,
		SPECULUM_SPEED_PERCENT,
		SPECULUM_SPEED_DAILY,
	)
	DATE_CONVENTION_CURRENT = 'current'
	DATE_CONVENTION_DMY = 'dmy'
	ANGLO_DENSE_LABEL_LAYOUT_LEADER_COLUMNS = 'leader-columns'
	ANGLO_DENSE_LABEL_LAYOUT_ROUTED_CUSPS = 'routed-cusps'
	ANGLO_DENSE_LABEL_LAYOUT_SIGN_LOCKED = 'sign-locked'
	ANGLO_DENSE_LABEL_LAYOUTS = (
		ANGLO_DENSE_LABEL_LAYOUT_LEADER_COLUMNS,
		ANGLO_DENSE_LABEL_LAYOUT_ROUTED_CUSPS,
		ANGLO_DENSE_LABEL_LAYOUT_SIGN_LOCKED,
	)
	NONE = 0
	FIXSTARS = 1
	ANTIS = 2
	CANTIS = 3
	PDLIST_PAGED = 0
	PDLIST_CONTINUOUS = 1
	QUICKCHARTS_ANCHOR_AUTO = 0
	QUICKCHARTS_ANCHOR_RADIX = 1
	QUICKCHARTS_ANCHOR_ROOT_RADIX = QUICKCHARTS_ANCHOR_RADIX
	QUICKCHARTS_ANCHOR_SOURCE_CHART = QUICKCHARTS_ANCHOR_RADIX
	ECLIPSE_CHART_MOMENT_EXACT = 'exact_conjunction'
	ECLIPSE_CHART_MOMENT_MAXIMUM = 'eclipse_maximum'
	PRENATAL_ECLIPSE_SOLAR_ONLY = 'solar_only'
	PRENATAL_ECLIPSE_SOLAR_AND_LUNAR = 'solar_and_lunar'
	EVENT_TABLE_TIME_DEFAULT_LOCATION = 'default_location'
	EVENT_TABLE_TIME_UT = 'ut'
	SECONDARY_LAUNCH_CHART = 0
	SECONDARY_LAUNCH_TABLE = 1
	SECONDARY_LAUNCH_BOTH = 2
	HARMONIC_CHART_MODE_HARMONIC = 'harmonic'
	HARMONIC_CHART_MODE_VARGA = 'varga'
	PD_IN_CHART_FROM_PLANETS = 0
	PD_IN_CHART_ECLIPTIC_FEET = 1
	CHART_RING_COUNT_MIN = 2
	CHART_RING_COUNT_MAX = 4
	CHART_RING_ZODIAC_RIM = 'rim'
	CHART_RING_ZODIAC_CENTRE = 'centre'
	VARGA_DRISHTI_OFF = 'off'
	VARGA_DRISHTI_PARASHARI = 'parashari'
	VARGA_DRISHTI_JAIMINI = 'jaimini'
# ###################################
# Elias change v 7.2.0
	DODECATEMORIA = 4
	ARABICPARTS = 5
	ASTEROIDS = 6
	MIDPOINTS = 7
	HYBRID_HITS = 8
# ###################################

	# Composite construction methods
	# MC always uses short-arc midpoint
	# ASC has 3 options:
	COMPOSITE_ASC_MIDPOINT = 0  # ASC short-arc midpoint (default)
	COMPOSITE_ASC_DERIVED_REF = 1  # ASC derived from reference place
	COMPOSITE_ASC_DERIVED_GEO = 2  # ASC derived from geographic midpoint

	MOON = 0
	ABOVEHOR = 1
	ABOVEHORNATAL = 2
	PHASIS_MODE_ASTRONOMICAL = 0
	PHASIS_MODE_HELLENISTIC = 1
	PHASIS_MODE_SIMPLE_SWEP = 2
	PHASIS_MODE_ARCUS_VISIONIS = 3
	CAZIMI_MODE_HELLENISTIC = 0
	CAZIMI_MODE_AL_QABISI = 1
	CAZIMI_MODE_ABU_MASHAR = 2
	SYNODIC_MODE_STATION_CAZIMI = 0
	SYNODIC_MODE_ALL = 1
	SOLAR_CONDITION_MODE_LATE_HELLENISTIC = 0
	SOLAR_CONDITION_MODE_AL_QABISI = 1
	SOLAR_CONDITION_MODE_IBN_EZRA = 2
	SOLAR_CONDITION_MODE_WILLIAM_LILLY = 3
	SOLAR_CONDITION_MODE_MORIN = 4
	SOLAR_CONDITION_MODES = (
		SOLAR_CONDITION_MODE_LATE_HELLENISTIC,
		SOLAR_CONDITION_MODE_AL_QABISI,
		SOLAR_CONDITION_MODE_IBN_EZRA,
		SOLAR_CONDITION_MODE_WILLIAM_LILLY,
		SOLAR_CONDITION_MODE_MORIN,
	)

	@staticmethod
	def _resolve_user_opts_dir():
		return app_paths.user_opts_dir()

	@staticmethod
	def _resolve_legacy_user_opts_dir():
		return app_paths.legacy_user_opts_dir()

	@staticmethod
	def _resolve_factory_opts_dir():
		candidates = []
		daemon_base = os.environ.get('ARIES_DAEMON_BASE_DIR', '').strip()
		if daemon_base:
			candidates.append(daemon_base)
		mei = getattr(sys, '_MEIPASS', None)
		if mei:
			candidates.append(mei)
		candidates.append(os.getcwd())
		candidates.append(os.path.dirname(os.path.abspath(__file__)))
		for base_dir in candidates:
			res_opts_dir = os.path.join(base_dir, 'Res', 'Opts')
			if os.path.isdir(res_opts_dir):
				return res_opts_dir
		return os.path.join(candidates[-1], 'Opts')

	def __init__(self):
		#Appearance
		self.def_aspects = self.aspects = True
		self.aspect = [True, False, False, True, False, True, True, False, False, False, True, False]
		self.def_aspect = self.aspect[:]
		self.def_symbols = self.symbols = True
		self.def_traditionalaspects = self.traditionalaspects = False
		self.def_showaspectsforderivedpoints = self.showaspectsforderivedpoints = False
		self.def_aspectlist_perfection_link_mode = self.aspectlist_perfection_link_mode = 'transits'
		self.def_showaspectstoasc = self.showaspectstoasc = True
		self.def_showaspectstomc = self.showaspectstomc = True
		self.def_showaspectstodsc = self.showaspectstodsc = True
		self.def_showaspectstoic = self.showaspectstoic = True
		self.def_houses = self.houses = True
		self.def_showouterhouselines = self.showouterhouselines = True
		self.def_positions = self.positions = False
		self.def_intables = self.intables = False
		self.def_bw = self.bw = False
		self.def_theme = self.theme = 0
		self.def_anglo_dense_label_layout = self.anglo_dense_label_layout = self.ANGLO_DENSE_LABEL_LAYOUT_ROUTED_CUSPS
		self.def_ascmcsize = self.ascmcsize = 5
		self.def_tablesize = self.tablesize = 0.75
		self.def_chartringthickness = self.chartringthickness = _tokens.CHART_RING_THICKNESS
		# Legacy aesthetic: render the chart at half resolution and blit
		# back up with nearest-neighbor, recreating the aliased pre-fork
		# Morinus look. Applied at the `morin._push_chart_bitmap` bottleneck
		# so all chart variants (round/compact/biwheel) share the effect.
		# Off by default; toggle in the Colors dialog.
		self.def_legacypixelated = self.legacypixelated = False
		self.def_showkeyprompts = self.showkeyprompts = True
		# Short-lived keyboard learning hint for users who do not yet know the
		# chart navigation keys. Power users disable this in Appearance.
		self.def_show_help_chip = self.show_help_chip = True
		# Hidden Tauri presentation aid. The webapp may replace the ordinary
		# arrow with a larger graphical cursor; no public Settings control exposes
		# this option and specialized text/resize/grab cursors remain native.
		self.def_presentation_cursor = self.presentation_cursor = False
		# Key-prompts style: 'overlay' (wx overlay on chart, original),
		# 'native' (PyObjC HUD below chart), 'strip' (always-visible legend
		# strip between chart and table host), 'off' (no prompts UI).
		self.def_keyprompts_style = self.keyprompts_style = 'overlay'
		self.def_planetarydayhour = self.planetarydayhour = True
		self.def_housesystem = self.housesystem = True
		self.def_information = self.information = True
		# Tauri chart chrome can move the radix name from the centred titlebar
		# into the top-left information overlay, directly above the birth date.
		self.def_showradixnameincanvas = self.showradixnameincanvas = False
		self.def_showseconds = self.showseconds = True
		self.def_dateconvention = self.dateconvention = self.DATE_CONVENTION_CURRENT
		self.transcendental = [True, True, True]
		self.def_transcendental = self.transcendental[:]
		self.def_showchiron = self.showchiron = True
		self.def_extendedradixstations = self.extendedradixstations = False
		self.def_showvertex = self.showvertex = False
		self.def_showaspectstovertex = self.showaspectstovertex = False
		self.def_shownodes = self.shownodes = True
		self.def_aspectstonodes = self.aspectstonodes = False
		self.def_exclusive_aspects_on_click = self.exclusive_aspects_on_click = False
		self.def_exclusive_aspects_on_click_show_minor = self.exclusive_aspects_on_click_show_minor = True
		self.def_exclusive_aspects_on_click_traditional = self.exclusive_aspects_on_click_traditional = False
		self.def_aspect_flag_show_parties = self.aspect_flag_show_parties = True
		self.def_showlof = self.showlof = True
		self.def_showaspectstolof = self.showaspectstolof = False
		self.def_showlofouterring = self.showlofouterring = False
		self.def_showprenatalsyzygy = self.showprenatalsyzygy = False
		self.def_showprenataleclipse = self.showprenataleclipse = False
		self.def_pdf_chart_color_mode = self.pdf_chart_color_mode = 'monochrome'
		self.def_pdf_chart_raster_preset = self.pdf_chart_raster_preset = 'clean'
		self.def_pdf_include_overlays = self.pdf_include_overlays = True
		self.def_png_chart_appearance = self.png_chart_appearance = 'screen'
		self.def_png_include_overlays = self.png_include_overlays = True
		self.def_list_export_aspect_symbols = self.list_export_aspect_symbols = False
		self.def_showterms = self.showterms = False
		self.def_showdecans = self.showdecans = False
		self.def_showanglearrowheads = self.showanglearrowheads = True
		self.def_showcusplessascmclabels = self.showcusplessascmclabels = True
		# Multi-wheel-only presentation controls. These do not alter chart
		# construction or the single/biwheel renderers.
		self.def_multiwheel_show_positions = self.multiwheel_show_positions = True
		self.def_multiwheel_show_minutes = self.multiwheel_show_minutes = True
		self.def_multiwheel_sign_colors = self.multiwheel_sign_colors = False
		self.def_multiwheel_show_angle_labels = self.multiwheel_show_angle_labels = True
		self.def_dignitylabelcolors = self.dignitylabelcolors = False
		self.def_showfixstars = self.showfixstars = 0
		# Swiss Ephemeris's Schaefer visibility model is the best-supported
		# general-purpose default. Existing saved preferences still override it.
		self.def_phasismode = self.phasismode = self.PHASIS_MODE_SIMPLE_SWEP
		self.def_showcazimi = self.showcazimi = True
		self.def_cazimimode = self.cazimimode = self.CAZIMI_MODE_HELLENISTIC
		self.def_synodicmode = self.synodicmode = self.SYNODIC_MODE_ALL
		self.def_solarconditionmode = self.solarconditionmode = self.SOLAR_CONDITION_MODE_MORIN
		self.def_showeclipseoverlay = self.showeclipseoverlay = True
		self.def_astrocart_localspace_additive = self.astrocart_localspace_additive = True
		self.def_astrocart_show_ecliptic = self.astrocart_show_ecliptic = False
		self.def_astrocart_show_equator = self.astrocart_show_equator = False
		self.def_astrocart_show_asc_circle = self.astrocart_show_asc_circle = False
		self.def_astrocart_show_mc_circle = self.astrocart_show_mc_circle = False
		self.def_astrocart_show_house_lines = self.astrocart_show_house_lines = False
		self.def_astrocart_show_zodiac_lines = self.astrocart_show_zodiac_lines = False
		self.def_astrocart_show_country_labels = self.astrocart_show_country_labels = True
		self.def_astrocart_terrain_relief = self.astrocart_terrain_relief = False
		self.def_showfixstarsnodes = self.showfixstarsnodes = False
		self.def_showfixstarshcs = self.showfixstarshcs = False
		self.def_showfixstarslof = self.showfixstarslof = False
		self.def_ringorb_midpoints = self.ringorb_midpoints = 1.5
		self.def_ringorb_asteroids = self.ringorb_asteroids = 1.5
		self.def_ringorb_hybrid = self.ringorb_hybrid = 1.5
		self.def_topocentric = self.topocentric = False
		self.def_usetradfixstarnamespdlist = self.usetradfixstarnamespdlist = False
		self.def_netbook = self.netbook = False

		#AppearanceII
		self.speculums = [[True, True, True, True, False, False, False, False, False, False, False, False, False, False, True, True], [True, True, True, True, False, False, False, False, False, False, False, False, True, True]]
		self.def_speculums = copy.deepcopy(self.speculums)
# ########################################
# Roberto change - V 7.1.0
# ########################################

		self.intime = False
		# Dodecatemorion in Speculum (Placidian / Regiomontan)
		self.speculumdodecat = [False, False]
		self.def_speculumdodecat = copy.deepcopy(self.speculumdodecat)
		self.def_speculum_speed_mode = self.speculum_speed_mode = self.SPECULUM_SPEED_DAILY

		self.def_intime = self.intime

		#Symbols
		self.def_uranus = self.uranus = True
		self.def_pluto = self.pluto = 3
		self.def_signs = self.signs = True

		#Dignities(planets, domicile, exaltatio)
							#Sun
		self.dignities = [[[False, False, False, False, True, False, False, False, False, False, False, False], [True, False, False, False, False, False, False, False, False, False, False, False]],
							#Moon
							[[False, False, False, True, False, False, False, False, False, False, False, False], [False, True, False, False, False, False, False, False, False, False, False, False]],
							#Mercury
							[[False, False, True, False, False, True, False, False, False, False, False, False], [False, False, False, False, False, True, False, False, False, False, False, False]],
							#Venus
							[[False, True, False, False, False, False, True, False, False, False, False, False], [False, False, False, False, False, False, False, False, False, False, False, True]],
							#Mars
							[[True, False, False, False, False, False, False, True, False, False, False, False], [False, False, False, False, False, False, False, False, False, True, False, False]],
							#Jupiter
							[[False, False, False, False, False, False, False, False, True, False, False, True], [False, False, False, True, False, False, False, False, False, False, False, False]],
							#Saturnus
							[[False, False, False, False, False, False, False, False, False, True, True, False], [False, False, False, False, False, False, True, False, False, False, False, False]],
							#Uranus
							[[False, False, False, False, False, False, False, False, False, False, False, False], [False, False, False, False, False, False, False, False, False, False, False, False]],
							#Neptune
							[[False, False, False, False, False, False, False, False, False, False, False, False], [False, False, False, False, False, False, False, False, False, False, False, False]],
							#Pluto
							[[False, False, False, False, False, False, False, False, False, False, False, False], [False, False, False, False, False, False, False, False, False, False, False, False]]]

		self.def_dignities = copy.deepcopy(self.dignities)

		#Minor dignities
		#Triplicities
		self.seltrip = 0
		self.def_seltrip = self.seltrip

		self.trips = [[[0, 5, 6],
						[6, 2, 5],
						[3, 4, 1],
						[3, 1, 4]],
						[[0, 5, 7],
						[6, 2, 7],
						[4, 4, 7],
						[3, 1, 7]],
						[[0, 4, 5],
						[6, 3, 2],
						[5, 1, 4],
						[2, 6, 3]]]

		self.def_trips = copy.deepcopy(self.trips)

		#Terms
		self.selterm = 0
		self.def_selterm = self.selterm

		self.terms = [[[[5, 6], [3, 6], [2, 8], [4, 5], [6, 5]],
					[[3, 8], [2, 6], [5, 8], [6, 5], [4, 3]],
					[[2, 6], [5, 6], [3, 5], [4, 7], [6, 6]],
					[[4, 7], [3, 6], [2, 6], [5, 7], [6, 4]],
					[[5, 6], [3, 5], [6, 7], [2, 6], [4, 6]],
					[[2, 7], [3, 10], [5, 4], [4, 7], [6, 2]],
					[[6, 6], [2, 8], [5, 7], [3, 7], [4, 2]],
					[[4, 7], [3, 4], [2, 8], [5, 5], [6, 6]],
					[[5, 12], [3, 5], [2, 4], [6, 5], [4, 4]],
					[[2, 7], [5, 7], [3, 8], [6, 4], [4, 4]],
					[[2, 7], [3, 6], [5, 7], [4, 5], [6, 5]],
					[[3, 12], [5, 4], [2, 3], [4, 9], [6, 2]]],
					[[[5, 6], [3, 8], [2, 7], [4, 5], [6, 4]],
					[[3, 8], [2, 7], [5, 7], [6, 2], [4, 6]],
					[[2, 7], [5, 6], [3, 7], [4, 6], [6, 4]],
					[[4, 6], [5, 7], [2, 7], [3, 7], [6, 3]],
					[[5, 6], [2, 7], [6, 6], [3, 6], [4, 5]],
					[[2, 7], [3, 6], [5, 5], [6, 6], [4, 6]],
					[[6, 6], [3, 5], [2, 5], [5, 8], [4, 6]],
					[[4, 6], [3, 7], [5, 8], [2, 6], [6, 3]],
					[[5, 8], [3, 6], [2, 5], [6, 6], [4, 5]],
					[[3, 6], [2, 6], [5, 7], [6, 6], [4, 5]],
					[[6, 6], [2, 6], [3, 8], [5, 5], [4, 5]],
					[[3, 8], [5, 6], [2, 6], [4, 5], [6, 5]]]]

		self.def_terms = copy.deepcopy(self.terms)

		#Decans
		self.seldecan = 0
		self.def_seldecan = self.seldecan

		self.decans = [[[4, 0, 3],
						[2, 1, 6],
						[5, 4, 0],
						[3, 2, 1],
						[6, 5, 4],
						[0, 3, 2],
						[1, 6, 5],
						[4, 0, 3],
						[2, 1, 6],
						[5, 4, 0],
						[3, 2, 1],
						[6, 5, 4]],
						[[4, 0, 5],
						[3, 2, 6],
						[2, 3, 6],
						[1, 4, 5],
						[0, 5, 4],
						[2, 6, 3],
						[3, 6, 2],
						[4, 5, 1],
						[5, 4, 0],
						[6, 3, 2],
						[6, 2, 3],
						[5, 1, 4]]]

		self.def_decans = copy.deepcopy(self.decans)

		#ChartAlmuten
		self.def_oneruler = self.oneruler = True
		self.def_usedaynightorb = self.usedaynightorb = False
		self.def_dignityscores = self.dignityscores = [5, 4, 3, 2, 1]
		self.def_useaccidental = self.useaccidental = True
		self.def_housescores = self.housescores = [12, 6, 3, 9, 7, 1, 10, 5, 4, 11, 8, 2]
		self.def_sunphases = self.sunphases = [3, 2, 1]
		self.def_dayhourscores = self.dayhourscores = [7, 6]
		self.def_useexaltationmercury = self.useexaltationmercury = False

		#TopicalAlmuten and Parts
		self.def_topicals = self.topicals = None
			#Arabic Parts
		self.def_arabicpartsref = self.arabicpartsref = 0
		self.def_daynightorbdeg = self.daynightorbdeg = 0
		self.def_daynightorbmin = self.daynightorbmin = 0
		self.def_arabicparts = self.arabicparts = []

		#Ayanamsha
		self.def_ayanamsha = self.ayanamsha = 0

		#Lunar Mansions (Arabic manāzil)
		self.def_manazil_zodiac = self.manazil_zodiac = 'auto'
		self.def_show_manzil_in_inspector = self.show_manzil_in_inspector = True

		#Lunar Day anchor — 'true' | 'mean' | 'both'. See lunar.py for citations.
		self.def_lunar_day_anchor = self.lunar_day_anchor = 'true'

		#Colors
		# Built-in fallback palette. Keep this aligned with the shipped
		# factory Opts/colors.opt default: pinned Midnight.
		self.def_clrframe = self.clrframe = (220, 220, 221)
		self.def_clrsigns = self.clrsigns = (215, 215, 217)
		self.def_usezodiacelementcolors = self.usezodiacelementcolors = True
		self.def_clrsignelementfire = self.clrsignelementfire = (214, 82, 60)
		self.def_clrsignelementearth = self.clrsignelementearth = (118, 146, 74)
		self.def_clrsignelementair = self.clrsignelementair = (88, 138, 214)
		self.def_clrsignelementwater = self.clrsignelementwater = (68, 164, 172)
		self.def_clrAscMC = self.clrAscMC = (205, 205, 209)
		self.def_clrhouses = self.clrhouses = (138, 139, 141)
		self.def_clrhousenumbers = self.clrhousenumbers = (59, 59, 60)
		self.def_clrpositions = self.clrpositions = (255, 255, 255)

		self.def_clrperegrin = self.clrperegrin = (205, 205, 209)
		self.def_clrdomicil = self.clrdomicil = (2, 191, 2)
		self.def_clrexil = self.clrexil = (255,0,0)
		self.def_clrexal = self.clrexal = (255,215,0)
		self.def_clrcasus = self.clrcasus = (205,92,92)

		self.clraspect = [(246,0,206), (40,232,232), (246,0,206), (34,255,154), (255,242,0), (246,0,206), (34,255,154), (246,0,206), (255,122,0), (0,0,251), (246,0,206), (138,43,226)]
		self.def_clraspect = self.clraspect[:]

		self.clrindividual = SafeColorList([(255,215,0), (0,191,255), (138,43,226), (0,128,0), (178,34,34), (0,0,255), (0,0,0), (0,0,128), (0,0,128), (0,0,128), (139,54,38), (205,96,144), (128,0,128)])
		self.def_clrindividual = SafeColorList(self.clrindividual[:])
		self._default_clrindividual = SafeColorList(self.clrindividual[:])

		self.def_useplanetcolors = self.useplanetcolors = False

#		self.def_clrbackground = self.clrbackground = (wx.SystemSettings.GetColour(wx.SYS_COLOUR_WINDOWFRAME)).Get(False)
		self.def_clrbackground = self.clrbackground = (35, 36, 40)
		self.def_clrsidebar = self.clrsidebar = (29, 30, 33)
		self.def_clrtable = self.clrtable = (0,0,0)
		self.def_clrtexts = self.clrtexts = (255, 255, 255)
		self.def_clrsidebartext = self.clrsidebartext = self.def_clrtexts
		# Tauri app chrome is independently persisted from chart ink/canvas.
		# Existing colors.opt files do not carry these fields; load() migrates
		# them from clrbackground/clrtexts so every pre-split profile is visually
		# identical on first use.
		self.def_clrappbackground = self.clrappbackground = self.def_clrbackground
		self.def_clrapptexts = self.clrapptexts = self.def_clrtexts
		self.custom_color_preset = self._current_color_preset()

		# False by default: vanilla Aries opens in pinned Midnight.
		self.def_follow_os_theme = self.follow_os_theme = False

		#Housesystem
		self.def_hsys = self.hsys = 'P'

		#Nodes
		self.def_meannode = self.meannode = True

		#Orbis
		# Per-planet × per-aspect orb table. Aspect order matches Chart.Aspects:
		# conj, semisext, semisq, sext, quintile, sq, trine, sesquisq, biquintile, quinqunx, opp, septile
		self.orbis = [[5.0, 1.75, 1.75, 3.0, 1.75, 4.0, 4.0, 1.75, 1.75, 1.75, 5.0, 1.75], [5.0, 1.75, 1.75, 3.0, 1.75, 4.0, 4.0, 1.75, 1.75, 1.75, 5.0, 1.75], [3.5, 1.5, 1.5, 2.5, 1.5, 3.0, 3.0, 1.5, 1.5, 1.5, 3.5, 1.5], [3.5, 1.5, 1.5, 2.5, 1.5, 3.0, 3.0, 1.5, 1.5, 1.5, 3.5, 1.5], [3.5, 1.5, 1.5, 2.5, 1.5, 3.0, 3.0, 1.5, 1.5, 1.5, 3.5, 1.5], [4.0, 1.5, 1.5, 3.0, 1.5, 3.5, 3.5, 1.5, 1.5, 1.5, 4.0, 1.5], [4.0, 1.5, 1.5, 3.0, 1.5, 3.5, 3.5, 1.5, 1.5, 1.5, 4.0, 1.5], [3.0, 1.0, 1.0, 2.0, 1.0, 2.5, 2.5, 1.0, 1.0, 1.0, 3.0, 1.0], [3.0, 1.0, 1.0, 2.0, 1.0, 2.5, 2.5, 1.0, 1.0, 1.0, 3.0, 1.0], [3.0, 1.0, 1.0, 2.0, 1.0, 2.5, 2.5, 1.0, 1.0, 1.0, 3.0, 1.0], [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5]]
		self.def_orbis = copy.deepcopy(self.orbis)

		self.orbisplanetspar = [[1.0, 1.0], [1.0, 1.0], [1.0, 1.0], [1.0, 1.0], [1.0, 1.0], [1.0, 1.0], [1.0, 1.0], [1.0, 1.0], [1.0, 1.0], [1.0, 1.0], [1.0, 1.0]]
		self.def_orbisplanetspar = copy.deepcopy(self.orbisplanetspar)

			# Houses
		self.orbisH = [0.25, 0.25, 0.25, 0.25, 0.25, 0.25, 0.25, 0.25, 0.25, 0.25, 0.25, 0.25]
		self.def_orbisH = self.orbisH[:]

		self.orbisparH = [0.25, 0.25] #parallel/contraparallel
		self.def_orbisparH = self.orbisparH[:]

		self.def_orbiscuspH = self.orbiscuspH = 3.0

			# Asc,MC
		self.orbisAscMC = [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5]
		self.def_orbisAscMC = self.orbisAscMC[:]

		self.orbisparAscMC = [0.5, 0.5]
		self.def_orbisparAscMC = self.orbisparAscMC[:]

		self.def_orbiscuspAscMC = self.orbiscuspAscMC = 5.0

		self.def_exact = self.exact = 1.0
		self.def_aspect_thickness_mode = self.aspect_thickness_mode = False
		self.def_aspect_opacity_mode = self.aspect_opacity_mode = False

		#Primary Dirs
		self.def_primarydir = self.primarydir = primdirs.PrimDirs.PLACIDIANSEMIARC
		self.def_subprimarydir = self.subprimarydir = primdirs.PrimDirs.MUNDANE
		self.def_subzodiacal = self.subzodiacal = primdirs.PrimDirs.SZNEITHER
		self.def_bianchini = self.bianchini = False
		self.def_morin_excentric = self.morin_excentric = False
		self.def_morin_antiscia = self.morin_antiscia = False

		self.def_revsidereal_marr_solar = self.revsidereal_marr_solar = False
		self.def_revsidereal_marr_lunar = self.revsidereal_marr_lunar = False
		self.def_revsidereal_marr_planet = self.revsidereal_marr_planet = False

		self.sigascmc = [True, True]
		self.def_sigascmc = self.sigascmc[:]

		self.sigangles = [True, True, True, True]
		self.def_sigangles = self.sigangles[:]

		self.sighouses = False
		self.def_sighouses = self.sighouses

		self.sigplanets = [True, True, True, True, True, True, True, True, True, True, True, True]
		self.def_sigplanets = self.sigplanets[:]
		self.promplanets = [True, True, True, True, True, True, True, True, True, True, True, True]
		self.def_promplanets = self.promplanets[:]
		self.stepalerts_enabled = self.def_stepalerts_enabled = True
		self.stepalerts_sigangles = [True, False, False, False]
		self.def_stepalerts_sigangles = self.stepalerts_sigangles[:]
		import common
		stepalerts_len = len(common.get_step_alert_body_ids())
		self.stepalerts_sigplanets = [False] * stepalerts_len
		self.def_stepalerts_sigplanets = self.stepalerts_sigplanets[:]
		self.stepalerts_promplanets = [True] * stepalerts_len
		self.def_stepalerts_promplanets = self.stepalerts_promplanets[:]

		self.pdaspects = [True, False, False, True, False, True, True, False, False, False, True, False]
		self.def_pdaspects = self.pdaspects[:]

		self.pdcircumoa = self.def_pdcircumoa = primdirs.PrimDirs.CIRCUM_OA_ASCENSIONAL_TIMES
		self.pdcircumprommode = self.def_pdcircumprommode = primdirs.PrimDirs.CIRCUM_PROMISSORS_FOLLOW_PD
		self.pdlistmode = self.def_pdlistmode = Options.PDLIST_CONTINUOUS
		self.pdlistglyphcolors = self.def_pdlistglyphcolors = False

		self.pdmidpoints = False
		self.def_pdmidpoints = self.pdmidpoints

		self.pdparallels = [False, False]
		self.def_pdparallels = self.pdparallels[:]

		self.pdsecmotion = self.def_pdsecmotion = False
		self.pdsecmotioniter = self.def_pdsecmotioniter = 2 #3rd iter is the default
		self.pdrevsunyearmode = self.def_pdrevsunyearmode = primdirs.PrimDirs.REVSOLAR_TROPICAL
		self.pdrevannualmode = self.def_pdrevannualmode = primdirs.PrimDirs.REVANNUAL_USE_PRIMARY
		self.pdrevshownatalpromissors = self.def_pdrevshownatalpromissors = False

		self.zodpromsigasps = [True, False]
		self.def_zodpromsigasps = self.zodpromsigasps[:]
		self.ascmchcsasproms = False
		self.def_ascmchcsasproms = self.ascmchcsasproms
		# House cusps (and angle aspect points) as PROMISSORS to planet
		# significators -- the planet supplies the pole (Marr/Polich-Page).
		# Default off keeps existing PD output byte-identical.
		self.pdcusppromissors = False
		self.def_pdcusppromissors = self.pdcusppromissors

		self.pdfixstars = False
		self.def_pdfixstars = self.pdfixstars

		self.pdfixstarssel = [False, False, False, False, False, False, False, False, False, False, False, False, False, False, False, False, False, False, False, False, False, False, False, False, False, False, False, False, False, False]
		self.pdfixstarssel = self._normalized_pdfixstarssel(self.pdfixstarssel)
		self.def_pdfixstarssel = self.pdfixstarssel[:]

		self.pdlof = [False, False]
		self.def_pdlof = self.pdlof[:]

		self.pdsyzygy = self.def_pdsyzygy = False

		self.pdterms = False
		self.def_pdterms = self.pdterms

		self.pdantiscia = False
		self.def_pdantiscia = self.pdantiscia
		self.pdmorinpromittorset = False
		self.def_pdmorinpromittorset = self.pdmorinpromittorset

		self.def_pdcustomer = self.pdcustomer = False
		self.pdcustomerlon = [0,0,0]
		self.def_pdcustomerlon = self.pdcustomerlon[:]
		self.pdcustomerlat = [0,0,0]
		self.def_pdcustomerlat = self.pdcustomerlat[:]
		self.def_pdcustomersouthern = self.pdcustomersouthern = False

		self.def_pdcustomer2 = self.pdcustomer2 = False
		self.pdcustomer2lon = [0,0,0]
		self.def_pdcustomer2lon = self.pdcustomer2lon[:]
		self.pdcustomer2lat = [0,0,0]
		self.def_pdcustomer2lat = self.pdcustomer2lat[:]
		self.def_pdcustomer2southern = self.pdcustomer2southern = False
		self.def_pdpromchiron = self.pdpromchiron = True
		self.def_pdsigchiron = self.pdsigchiron = True
		self.def_pdsigvertex = self.pdsigvertex = False
		self.def_pdpromarabicparts = self.pdpromarabicparts = False
		self.def_pdpromarabicpartname = self.pdpromarabicpartname = ''
		self.def_pdsigarabicparts = self.pdsigarabicparts = False
		self.def_pdsigarabicpartname = self.pdsigarabicpartname = ''

		#PD-keys
		self.pdkeydyn = False
		self.def_pdkeydyn = self.pdkeydyn
		self.pdkeyd = primdirs.PrimDirs.TRUESOLAREQUATORIALARC
		self.def_pdkeyd = self.pdkeyd
		self.pdkeys = primdirs.PrimDirs.NAIBOD
		self.def_pdkeys = self.pdkeys
		self.pdkeydeg = 0
		self.def_pdkeydeg = self.pdkeydeg
		self.pdkeymin = 0
		self.def_pdkeymin = self.pdkeymin
		self.pdkeysec = 0
		self.def_pdkeysec = self.pdkeysec

		self.useregressive = False
		self.def_useregressive = self.useregressive

		#Lot of Fortune
		self.lotoffortune = chart.Chart.LFMOONSUN
		self.def_lotoffortune = self.lotoffortune

		#Zodiacal Releasing
		self.zr_releaser = self.def_zr_releaser = 'spirit'
		self.zr_apply_spirit_shift = self.def_zr_apply_spirit_shift = True
		self.zr_start_sign = self.def_zr_start_sign = 0

		#Syzygy
		self.def_syzmoon = self.syzmoon = Options.MOON

		#Fixstars
		self.fixstars = {'etTau':1.5, 'alTau':1.5, 'bePer':1.5, 'ga-1And':1.5, 'alSco':1.5, 'alBoo':1.5, 'deCnc':1.5, 'gaCnc':1.5, 'etUMa':1.5, 'alOri':1.5, 'alCen':1.5, 'alCar':1.5, 'alGem':1.5, 'beLeo':1.5, 'alPsA':1.5, 'alCrB':1.5, 'alPeg':1.5, 'beAnd':1.5, 'alUMi':1.5, 'beGem':1.5, 'M44':1.5, 'alCMi':1.5, 'alLeo':1.5, 'beOri':1.5, 'alCMa':1.5, 'alVir':1.5, 'alSer':1.5, 'alLyr':1.5, 'al-2Lib':1.5, 'beLib':1.5}
		self.def_useIndianFixstarNames = self.useIndianFixstarNames = False

		self.def_fixstars = self.fixstars.copy()

		#Profections
		self.def_zodprof = self.zodprof = True
		self.def_usezodprojsprof = self.usezodprojsprof = False
		self.def_profections_solar_return_snap = self.profections_solar_return_snap = False
		# Whole-sign ("by sign") vs continuous annual profection of the chart.
		# True  -> the profected ASC jumps one whole sign per completed solar year
		#          (Hellenistic annual profection; matches the Lord-of-the-Year corner).
		# False -> the continuous Profections.offs rotation (~30deg/yr, the old behaviour).
		self.def_profwholesign = self.profwholesign = True

# ########################################
# Roberto change - V 7.3.0
		#Firdaria
		self.def_isfirbonatti = self.isfirbonatti = True
# ########################################

# ########################################
# Roberto change - V 7.2.0
		#Default Location
		self.def_deflocname = self.deflocname = ''
		self.def_deflocplus = self.deflocplus = True
		self.def_defloczhour = self.defloczhour = 0
		self.def_defloczminute = self.defloczminute = 0
		self.def_deflocdst = self.deflocdst = False
		self.def_defloctzauto = self.defloctzauto = True
		self.def_defloctzid = self.defloctzid = ''
		self.def_defloclondeg = self.defloclondeg = 0
		self.def_defloclonmin = self.defloclonmin = 0
		self.def_defloclatdeg = self.defloclatdeg = 0
		self.def_defloclatmin = self.defloclatmin = 0
		self.def_defloclon = self.defloclon = None
		self.def_defloclat = self.defloclat = None
		self.def_defloceast = self.defloceast = True
		self.def_deflocnorth = self.deflocnorth = True
		self.def_deflocalt = self.deflocalt = 0
# ########################################

		#PDsInChart
		self.def_pdincharttyp = self.pdincharttyp = 0
		self.def_pdinchartsecmotion = self.pdinchartsecmotion = False

		# The no-secondary-motion terrestrial chart is the exact graphical
		# partner of a tabled mundane direction.  Actual symbolic-time planetary
		# motion remains available as an explicitly illustrative option.
		self.def_pdinchartterrsecmotion = self.pdinchartterrsecmotion = False
		# Converse-view reference frame.  True keeps the radix fixed and moves
		# outer promissors (the Aries default); False keeps outer promissors
		# fixed for celestial converse rows and moves directed significators in
		# an inner overlay.  Direct and terrestrial views always remain native
		# fixed-radix presentations.  Preserve this Boolean pickle/API slot.
		self.def_pdinchartreverse = self.pdinchartreverse = True

		#Languages
		self.def_langid = self.langid = 0
		self.def_fontfamily = self.fontfamily = fontprofiles.PROFILE_DEFAULT

		self.autosave = False
		self.def_autosave = self.autosave
		self.quickcharts_prompt = True
		self.def_quickcharts_prompt = self.quickcharts_prompt
		self.quickcharts_anchor_to_radix = self.QUICKCHARTS_ANCHOR_AUTO
		self.def_quickcharts_anchor_to_radix = self.quickcharts_anchor_to_radix
		self.timed_chart_show_radix_default = False
		self.def_timed_chart_show_radix_default = self.timed_chart_show_radix_default
		self.event_table_time_basis = self.EVENT_TABLE_TIME_DEFAULT_LOCATION
		self.def_event_table_time_basis = self.event_table_time_basis
		self.subcharts_open_compound_default = False
		self.def_subcharts_open_compound_default = self.subcharts_open_compound_default
		self.multiwheel_open_at_three = False
		self.def_multiwheel_open_at_three = self.multiwheel_open_at_three
		self.chart_ring_count = self.CHART_RING_COUNT_MIN
		self.def_chart_ring_count = self.chart_ring_count
		self.chart_ring_zodiac = self.CHART_RING_ZODIAC_RIM
		self.def_chart_ring_zodiac = self.chart_ring_zodiac
		self.eclipse_chart_moment = self.ECLIPSE_CHART_MOMENT_EXACT
		self.def_eclipse_chart_moment = self.eclipse_chart_moment
		self.prenatal_eclipse_mode = self.PRENATAL_ECLIPSE_SOLAR_AND_LUNAR
		self.def_prenatal_eclipse_mode = self.prenatal_eclipse_mode
		self.secondary_progression_launch_mode = self.SECONDARY_LAUNCH_CHART
		self.def_secondary_progression_launch_mode = self.secondary_progression_launch_mode
		self.aspectlist_prebirth_secondary_converse = True
		self.def_aspectlist_prebirth_secondary_converse = self.aspectlist_prebirth_secondary_converse
		# Ascensional Transits sidebar re-click behavior:
		#   'focus_only'         → focus the existing AT tab as-is
		#   'focus_and_snap_now' → focus + snap cursor to current time
		#   'new_tab'            → always open a fresh AT tab
		self.at_reclick_behavior = 'focus_only'
		self.def_at_reclick_behavior = self.at_reclick_behavior
		self.progression_day_type = 0
		self.def_progression_day_type = self.progression_day_type
		self.progressed_angle_method = 0
		self.def_progressed_angle_method = self.progressed_angle_method
		self.harmonic_chart_mode = self.HARMONIC_CHART_MODE_HARMONIC
		self.def_harmonic_chart_mode = self.harmonic_chart_mode
		self.varga_drishti_mode = self.VARGA_DRISHTI_PARASHARI
		self.def_varga_drishti_mode = self.varga_drishti_mode
		self.varga_node_special_drishti = False
		self.def_varga_node_special_drishti = self.varga_node_special_drishti
		self.search_techniques = []
		self.def_search_techniques = self.search_techniques[:]
		self.search_aspects = []
		self.def_search_aspects = self.search_aspects[:]
		self.search_promittor_ids = []
		self.def_search_promittor_ids = self.search_promittor_ids[:]
		self.search_significator_ids = []
		self.def_search_significator_ids = self.search_significator_ids[:]
		self.search_promittor_motion = ''
		self.def_search_promittor_motion = self.search_promittor_motion
		self.search_significator_motion = ''
		self.def_search_significator_motion = self.search_significator_motion
		self.search_lunation_orb = 3.0
		self.def_search_lunation_orb = self.search_lunation_orb
		self.search_moon_phase = ''
		self.def_search_moon_phase = self.search_moon_phase
		self.search_from = ()
		self.def_search_from = self.search_from
		self.search_to = ()
		self.def_search_to = self.search_to
		self.search_part_filter = ''
		self.def_search_part_filter = self.search_part_filter
		self.search_sign_changes = False
		self.def_search_sign_changes = self.search_sign_changes
		self.search_default_offset_months = -2
		self.def_search_default_offset_months = self.search_default_offset_months
		self.search_default_range_months = 12
		self.def_search_default_range_months = self.search_default_range_months
		self.search_lifetime_years = 100
		self.def_search_lifetime_years = self.search_lifetime_years
		self.search_has_saved_state = False
		self.def_search_has_saved_state = self.search_has_saved_state
		self.startupchart = ''
		self.def_startupchart = self.startupchart
		self.restore_open_charts = False
		self.def_restore_open_charts = self.restore_open_charts
		self.restore_open_chart_refs = []
		self.def_restore_open_chart_refs = self.restore_open_chart_refs[:]
		self.restore_open_charts_active_ref = {}
		self.def_restore_open_charts_active_ref = copy.deepcopy(self.restore_open_charts_active_ref)
		self.recent_chart_refs = []
		self.def_recent_chart_refs = self.recent_chart_refs[:]
		self.chart_picker_sort_column = 8
		self.def_chart_picker_sort_column = self.chart_picker_sort_column
		self.chart_picker_sort_ascending = False
		self.def_chart_picker_sort_ascending = self.chart_picker_sort_ascending
		self.workspace_sidebar_action_order = {}
		self.def_workspace_sidebar_action_order = copy.deepcopy(self.workspace_sidebar_action_order)
		self.workspace_sidebar_collapsed_sections = []
		self.def_workspace_sidebar_collapsed_sections = self.workspace_sidebar_collapsed_sections[:]
		self.astrocartography_preferences = {
			'schemaVersion': 1,
			'spec': {},
			'view': {},
		}
		self.def_astrocartography_preferences = copy.deepcopy(
			self.astrocartography_preferences
		)
		self.sidebar_list_preferences = {
			'schemaVersion': 2,
			'aspectList': {
				'mode': None,
				'maxOrb': 10,
				'sortBy': 'orb',
				'sortDirection': 'asc',
				'focusedFilterIds': [],
				'focusMatchMode': 'or',
				'rxFocusEnabled': False,
				'secondaryRingEnabledByMode': {},
				'filterDrawerOpen': False,
			},
			'transitList': {
				'selectedPromittorId': None,
				'promittorDrawerOpen': False,
				'direction': 'direct',
			},
			'synodicList': {
				'ingressPlanetIds': list(range(11)) + [astrology.SE_CHIRON],
				'synodicPlanetIds': [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, astrology.SE_CHIRON],
				'lunarCycleIds': ['draconic', 'anomalistic'],
				'ingressDrawerOpen': False,
				'synodicDrawerOpen': False,
				'lunarDrawerOpen': False,
			},
			'vimshottari': {
				'anchor': 'moon',
				'startStar': 'janma',
				'yearDays': 365.25,
				'ayanamsha': 'follow_chart',
			},
		}
		self.def_sidebar_list_preferences = copy.deepcopy(
			self.sidebar_list_preferences
		)
		# Composite construction method
		self.composite_method = Options.COMPOSITE_ASC_MIDPOINT
		self.def_composite_method = self.composite_method
		# Synastry launcher opens composite first
		self.synastry_opens_composite_first = False
		self.def_synastry_opens_composite_first = self.synastry_opens_composite_first
		self.last_hor_dir = ''
		self.def_last_hor_dir = self.last_hor_dir
		self.revolutions_solaryearmode = 0
		self.def_revolutions_solaryearmode = self.revolutions_solaryearmode
		self.revolutions_solarlocationmode = 0
		self.def_revolutions_solarlocationmode = self.revolutions_solarlocationmode
		self.revolutions_planetslocationmode = 0
		self.def_revolutions_planetslocationmode = self.revolutions_planetslocationmode
		self.revolutions_lunarlocationmode = 0
		self.def_revolutions_lunarlocationmode = self.revolutions_lunarlocationmode
		self.revolutions_lunarparentmode = 0
		self.def_revolutions_lunarparentmode = self.revolutions_lunarparentmode
		self.revolutions_solarreturnmode = 'standard'
		self.def_revolutions_solarreturnmode = self.revolutions_solarreturnmode
		self.revolutions_lunarreturnmode = 'lunar'
		self.def_revolutions_lunarreturnmode = self.revolutions_lunarreturnmode
		self.user_panel_presets = {}
		self.def_user_panel_presets = {}

# ########################################
# Roberto change - V 7.2.0 / V 7.3.0
		self.optionsfilestxt = ('appearance1.opt', 'appearance2.opt', 'symbols.opt', 'dignities.opt', 'triplicities.opt', 'terms.opt', 'decans.opt', 'almutenchart.opt', 'almutentopicalandparts.opt', 'ayanamsa.opt', 'colors.opt', 'housesystem.opt', 'nodes.opt', 'orbs.opt', 'primarydirs.opt', 'primarykeys.opt', 'fortune.opt', 'syzygy.opt', 'fixedstars.opt', 'profections.opt', 'firdaria.opt', 'deflocation.opt', 'pdsinchart.opt', 'languages.opt', 'autosave.opt', 'revolutions.opt', 'quickcharts.opt', 'search.opt', 'startupchart.opt', 'recentcharts.opt', 'stepalerts.opt', 'lasthordir.opt', 'workspacesidebarorder.opt', 'workspacesidebarcollapsed.opt', 'composite.opt', 'userpanel.opt', 'restoreopencharts.opt')
# ########################################
		self.factoryoptsdirtxt = self._resolve_factory_opts_dir()
		self.optsdirtxt = self._resolve_user_opts_dir()
		self.arabicpartsjson = 'arabic_parts.json'
		self._migrate_legacy_user_opts_dir()
		self._ensure_user_opts_dir()
		self._seed_user_opts_from_factory()
		self._sync_factory_color_defaults()

		self.appearance1opt = os.path.join(self.optsdirtxt, self.optionsfilestxt[0])
		self.appearance2opt = os.path.join(self.optsdirtxt, self.optionsfilestxt[1])
		self.symbolsopt = os.path.join(self.optsdirtxt, self.optionsfilestxt[2])
		self.dignitiesopt = os.path.join(self.optsdirtxt, self.optionsfilestxt[3])
		self.triplicitiesopt = os.path.join(self.optsdirtxt, self.optionsfilestxt[4])
		self.termsopt = os.path.join(self.optsdirtxt, self.optionsfilestxt[5])
		self.decansopt = os.path.join(self.optsdirtxt, self.optionsfilestxt[6])
		self.chartalmutenopt = os.path.join(self.optsdirtxt, self.optionsfilestxt[7])
		self.topicalandpartsopt = os.path.join(self.optsdirtxt, self.optionsfilestxt[8])
		self.ayanamsaopt = os.path.join(self.optsdirtxt, self.optionsfilestxt[9])
		self.colorsopt = os.path.join(self.optsdirtxt, self.optionsfilestxt[10])
		self.housesystemopt = os.path.join(self.optsdirtxt, self.optionsfilestxt[11])
		self.nodesopt = os.path.join(self.optsdirtxt, self.optionsfilestxt[12])
		self.orbsopt = os.path.join(self.optsdirtxt, self.optionsfilestxt[13])
		self.primarydirsopt = os.path.join(self.optsdirtxt, self.optionsfilestxt[14])
		self.primarykeysopt = os.path.join(self.optsdirtxt, self.optionsfilestxt[15])
		self.fortuneopt = os.path.join(self.optsdirtxt, self.optionsfilestxt[16])
		self.syzygyopt = os.path.join(self.optsdirtxt, self.optionsfilestxt[17])
		self.fixstarsopt = os.path.join(self.optsdirtxt, self.optionsfilestxt[18])
		self.profectionsopt = os.path.join(self.optsdirtxt, self.optionsfilestxt[19])
# ########################################
# Roberto change - V 7.3.0
		self.firdariaopt = os.path.join(self.optsdirtxt, self.optionsfilestxt[20])
# ########################################
# ########################################
# Roberto change - V 7.2.0 / V 7.3.0
		self.deflocationopt = os.path.join(self.optsdirtxt, self.optionsfilestxt[21])
		self.pdsinchartopt = os.path.join(self.optsdirtxt, self.optionsfilestxt[22])
		self.languagesopt = os.path.join(self.optsdirtxt, self.optionsfilestxt[23])
		self.autosaveopt = os.path.join(self.optsdirtxt, self.optionsfilestxt[24])
		self.revolutionsopt = os.path.join(self.optsdirtxt, self.optionsfilestxt[25])
		self.quickchartsopt = os.path.join(self.optsdirtxt, self.optionsfilestxt[26])
		self.searchopt = os.path.join(self.optsdirtxt, self.optionsfilestxt[27])
		self.startupchartopt = os.path.join(self.optsdirtxt, self.optionsfilestxt[28])
		self.recentchartsopt = os.path.join(self.optsdirtxt, self.optionsfilestxt[29])
		self.stepalertsopt = os.path.join(self.optsdirtxt, self.optionsfilestxt[30])
		self.lasthordiropt = os.path.join(self.optsdirtxt, self.optionsfilestxt[31])
		self.workspacesidebarorderopt = os.path.join(self.optsdirtxt, self.optionsfilestxt[32])
		self.workspacesidebarcollapsedopt = os.path.join(self.optsdirtxt, self.optionsfilestxt[33])
		self.compositeopt = os.path.join(self.optsdirtxt, self.optionsfilestxt[34])
		self.userpanelopt = os.path.join(self.optsdirtxt, 'userpanel.opt')
		self.restoreopenchartsopt = os.path.join(self.optsdirtxt, self.optionsfilestxt[36])
		self.astrocartographypreferencesopt = os.path.join(
			self.optsdirtxt,
			'astrocartography.opt',
		)
		self.sidebarlistpreferencesopt = os.path.join(
			self.optsdirtxt,
			'sidebar_lists.opt',
		)
		self.load()
# ########################################

	def _ensure_user_opts_dir(self):
		try:
			os.makedirs(self.optsdirtxt, exist_ok=True)
		except Exception:
			pass

	def _migrate_legacy_user_opts_dir(self):
		try:
			app_paths.migrate_directory_contents(
				self._resolve_legacy_user_opts_dir(),
				self.optsdirtxt,
				factory_dir=self.factoryoptsdirtxt,
				marker_name=app_paths.MIGRATION_MARKER,
			)
		except Exception:
			pass

	def _factory_opt_path(self, filename):
		return os.path.join(self.factoryoptsdirtxt, filename)

	def _open_opt_for_load(self, optfile):
		filename = os.path.basename(optfile)
		candidates = [optfile, self._factory_opt_path(filename)]
		for path in candidates:
			if path and os.path.exists(path):
				return open(path, 'rb')
		raise IOError

	def _seed_user_opts_from_factory(self):
		if not os.path.isdir(self.factoryoptsdirtxt):
			return

		for filename in self.optionsfilestxt:
			dst = os.path.join(self.optsdirtxt, filename)
			if os.path.exists(dst):
				continue

			src = self._factory_opt_path(filename)
			if not os.path.exists(src):
				continue

			try:
				shutil.copy2(src, dst)
			except Exception:
				pass

		# Seed bundled default Arabic Parts catalog JSON as user-editable data.
		try:
			json_name = self.arabicpartsjson
		except Exception:
			json_name = 'arabic_parts.json'

		dst = os.path.join(self.optsdirtxt, json_name)
		if not os.path.exists(dst):
			src = self._factory_opt_path(json_name)
			if os.path.exists(src):
				try:
					shutil.copy2(src, dst)
				except Exception:
					pass

	def _sync_factory_color_defaults(self):
		optfile = self._factory_opt_path('colors.opt')
		if not os.path.exists(optfile):
			return

		try:
			f = open(optfile, 'rb')
			self.def_clrframe = pickle.load(f)
			self.def_clrsigns = pickle.load(f)
			self.def_clrAscMC = pickle.load(f)
			self.def_clrhouses = pickle.load(f)
			self.def_clrhousenumbers = pickle.load(f)
			self.def_clrpositions = pickle.load(f)
			self.def_clrperegrin = pickle.load(f)
			self.def_clrdomicil = pickle.load(f)
			self.def_clrexil = pickle.load(f)
			self.def_clrexal = pickle.load(f)
			self.def_clrcasus = pickle.load(f)
			self.def_clraspect = pickle.load(f)
			self.def_clrindividual = pickle.load(f)
			self.def_useplanetcolors = pickle.load(f)
			self.def_clrbackground = pickle.load(f)
			self.def_clrtable = pickle.load(f)
			self.def_clrtexts = pickle.load(f)
			try:
				self.def_clrsidebar = pickle.load(f)
			except Exception:
				self.def_clrsidebar = self.def_clrbackground
			try:
				self.def_clrsidebartext = pickle.load(f)
			except Exception:
				self.def_clrsidebartext = self.def_clrtexts
			legacy_use_zodiac_element_colors = None
			try:
				custom_color_preset = pickle.load(f)
				if isinstance(custom_color_preset, dict):
					self.custom_color_preset = custom_color_preset
				else:
					# Older colors.opt files did not have custom_color_preset.
					legacy_use_zodiac_element_colors = custom_color_preset
			except Exception:
				pass
			try:
				if legacy_use_zodiac_element_colors is None:
					self.def_usezodiacelementcolors = pickle.load(f)
				else:
					self.def_usezodiacelementcolors = legacy_use_zodiac_element_colors
				self.def_clrsignelementfire = pickle.load(f)
				self.def_clrsignelementearth = pickle.load(f)
				self.def_clrsignelementair = pickle.load(f)
				self.def_clrsignelementwater = pickle.load(f)
			except Exception:
				pass
			try:
				# follow_os_theme is the final pre-tokenization colors.opt slot.
				pickle.load(f)
			except Exception:
				pass
			try:
				app_color_trailer = pickle.load(f)
			except Exception:
				app_color_trailer = None
			(self.def_clrappbackground, self.def_clrapptexts) = self._normalize_app_color_trailer(
				app_color_trailer,
				self.def_clrbackground,
				self.def_clrtexts,
			)
			self.clrappbackground = self.def_clrappbackground
			self.clrapptexts = self.def_clrapptexts
			f.close()
			try:
				import chart
				aspect_num = chart.Chart.ASPECT_NUM
			except Exception:
				aspect_num = len(self.clraspect)
			self.def_clraspect = list(self.def_clraspect or [])
			fallback_aspects = list(self.clraspect or [])
			while len(self.def_clraspect) < aspect_num and fallback_aspects:
				i = len(self.def_clraspect)
				self.def_clraspect.append(fallback_aspects[i] if i < len(fallback_aspects) else fallback_aspects[-1])
			self.def_clraspect = self.def_clraspect[:aspect_num]
			if not isinstance(self.def_usezodiacelementcolors, bool):
				self.def_usezodiacelementcolors = False
			self.def_clrindividual = self._normalize_clrindividual(self.def_clrindividual, fallback=self.clrindividual)
			self.clrindividual = self._normalize_clrindividual(self.clrindividual, fallback=self.def_clrindividual)
			self.custom_color_preset = self._normalize_color_preset(self.custom_color_preset)
		except Exception:
			try:
				f.close()
			except Exception:
				pass

	def _normalize_clrindividual(self, values, fallback=None):
		normalized = list(values or [])
		source = list(fallback or getattr(self, '_default_clrindividual', []))
		if not source:
			source = list(normalized)
		default_len = len(getattr(self, '_default_clrindividual', source))
		if len(source) < default_len:
			source = list(getattr(self, '_default_clrindividual', source))
		while len(normalized) < len(source):
			normalized.append(source[len(normalized)])
		return SafeColorList(normalized[:len(source)])

	@staticmethod
	def _normalize_app_rgb(value, fallback):
		try:
			rgb = tuple(int(channel) for channel in value[:3])
			if len(rgb) == 3 and all(0 <= channel <= 255 for channel in rgb):
				return rgb
		except Exception:
			pass
		return tuple(fallback)

	def _normalize_app_color_trailer(self, trailer, fallback_background, fallback_text):
		if not isinstance(trailer, dict):
			trailer = {}
		try:
			schema_version = int(trailer.get('schemaVersion', 0))
		except Exception:
			schema_version = 0
		if schema_version < 1:
			trailer = {}
		return (
			self._normalize_app_rgb(trailer.get('clrappbackground'), fallback_background),
			self._normalize_app_rgb(trailer.get('clrapptexts'), fallback_text),
		)

	def _app_color_trailer(self):
		return {
			'schemaVersion': self.APP_COLOR_TRAILER_SCHEMA_VERSION,
			'clrappbackground': tuple(self.clrappbackground),
			'clrapptexts': tuple(self.clrapptexts),
		}

	def _current_color_preset(self):
		return self._normalize_color_preset({
			'clrframe': self.clrframe,
			'clrsigns': self.clrsigns,
			'usezodiacelementcolors': bool(self.usezodiacelementcolors),
			'clrsignelementfire': self.clrsignelementfire,
			'clrsignelementearth': self.clrsignelementearth,
			'clrsignelementair': self.clrsignelementair,
			'clrsignelementwater': self.clrsignelementwater,
			'clrAscMC': self.clrAscMC,
			'clrhouses': self.clrhouses,
			'clrhousenumbers': self.clrhousenumbers,
			'clrpositions': self.clrpositions,
			'clrperegrin': self.clrperegrin,
			'clrdomicil': self.clrdomicil,
			'clrexil': self.clrexil,
			'clrexal': self.clrexal,
			'clrcasus': self.clrcasus,
			'clrbackground': self.clrbackground,
			'clrsidebar': self.clrsidebar,
			'clrsidebartext': self.clrsidebartext,
			'clrtable': self.clrtable,
			'clrtexts': self.clrtexts,
			'clrappbackground': self.clrappbackground,
			'clrapptexts': self.clrapptexts,
			'clrindividual': self.clrindividual[:],
			'clraspect': self.clraspect[:],
			'useplanetcolors': bool(self.useplanetcolors),
		})

	def _normalize_color_preset(self, preset):
		state = {
			'clrframe': self.clrframe,
			'clrsigns': self.clrsigns,
			'usezodiacelementcolors': bool(self.usezodiacelementcolors),
			'clrsignelementfire': self.clrsignelementfire,
			'clrsignelementearth': self.clrsignelementearth,
			'clrsignelementair': self.clrsignelementair,
			'clrsignelementwater': self.clrsignelementwater,
			'clrAscMC': self.clrAscMC,
			'clrhouses': self.clrhouses,
			'clrhousenumbers': self.clrhousenumbers,
			'clrpositions': self.clrpositions,
			'clrperegrin': self.clrperegrin,
			'clrdomicil': self.clrdomicil,
			'clrexil': self.clrexil,
			'clrexal': self.clrexal,
			'clrcasus': self.clrcasus,
			'clrbackground': self.clrbackground,
			'clrsidebar': self.clrsidebar,
			'clrsidebartext': self.clrsidebartext,
			'clrtable': self.clrtable,
			'clrtexts': self.clrtexts,
			'clrappbackground': self.clrappbackground,
			'clrapptexts': self.clrapptexts,
			'clrindividual': self.clrindividual[:],
			'clraspect': self.clraspect[:],
			'useplanetcolors': bool(self.useplanetcolors),
		}
		if isinstance(preset, dict):
			state.update(preset)
			# A pre-split saved "My Colors" dict has no app-only keys. Migrate
			# from that preset's own legacy chart/app values, not factory defaults.
			if 'clrappbackground' not in preset:
				state['clrappbackground'] = state['clrbackground']
			if 'clrapptexts' not in preset:
				state['clrapptexts'] = state['clrtexts']
		state['clrindividual'] = list(state.get('clrindividual', self.clrindividual[:]))
		state['clrindividual'] = self._normalize_clrindividual(state['clrindividual'])
		state['clraspect'] = list(state.get('clraspect', self.clraspect[:]))
		# Pad clraspect up to current Chart.ASPECT_NUM so legacy 11-entry
		# saved presets (pre-Septile) don't IndexError when picked.
		import chart
		num = chart.Chart.ASPECT_NUM
		defaults = list(getattr(self, 'def_clraspect', self.clraspect))
		while len(state['clraspect']) < num:
			i = len(state['clraspect'])
			state['clraspect'].append(defaults[i] if i < len(defaults) else defaults[-1])
		state['useplanetcolors'] = bool(state.get('useplanetcolors', False))
		state['usezodiacelementcolors'] = bool(state.get('usezodiacelementcolors', False))
		return state

	def _normalize_user_panel_presets(self, presets):
		if isinstance(presets, dict):
			return copy.deepcopy(presets)
		if isinstance(presets, list):
			normalized = {}
			for item in presets:
				if not isinstance(item, dict):
					continue
				name = str(item.get('name', '')).strip()
				state = item.get('state')
				if name:
					normalized[name] = copy.deepcopy(state)
			return normalized
		return {}

	@staticmethod
	def _normalize_astrocartography_preferences(preferences):
		if not isinstance(preferences, dict):
			preferences = {}
		spec = preferences.get('spec')
		view = preferences.get('view')
		return {
			'schemaVersion': 1,
			'spec': copy.deepcopy(spec) if isinstance(spec, dict) else {},
			'view': copy.deepcopy(view) if isinstance(view, dict) else {},
		}

	@staticmethod
	def _normalize_sidebar_list_preferences(preferences):
		if not isinstance(preferences, dict):
			preferences = {}
		try:
			schema_version = int(preferences.get('schemaVersion', 1))
		except (TypeError, ValueError):
			schema_version = 1
		aspect = preferences.get('aspectList')
		transit = preferences.get('transitList')
		synodic = preferences.get('synodicList')
		secondary = preferences.get('secondaryProgressions')
		vimshottari = preferences.get('vimshottari')
		if not isinstance(aspect, dict):
			aspect = {}
		if not isinstance(transit, dict):
			transit = {}
		if not isinstance(synodic, dict):
			synodic = {}
		if not isinstance(secondary, dict):
			secondary = {}
		if not isinstance(vimshottari, dict):
			vimshottari = {}

		mode = aspect.get('mode')
		if mode not in (None, 'primary', 'outer', 'outerToPrimary', 'primaryToOuter'):
			mode = None
		try:
			max_orb = float(aspect.get('maxOrb', 10))
		except (TypeError, ValueError):
			max_orb = 10
		if not 0 < max_orb <= 30:
			max_orb = 10
		if max_orb.is_integer():
			max_orb = int(max_orb)
		sort_by = aspect.get('sortBy')
		if sort_by not in ('body', 'orb', 'exact'):
			sort_by = 'orb'
		sort_direction = aspect.get('sortDirection')
		if sort_direction not in ('asc', 'desc'):
			sort_direction = 'asc'
		focus_match_mode = aspect.get('focusMatchMode')
		if focus_match_mode not in ('or', 'and'):
			focus_match_mode = 'or'
		focused_filter_ids = []
		raw_focused_filter_ids = aspect.get('focusedFilterIds')
		if isinstance(raw_focused_filter_ids, (list, tuple)):
			for value in raw_focused_filter_ids:
				if not isinstance(value, str):
					continue
				value = value.strip()
				if value and value not in focused_filter_ids:
					focused_filter_ids.append(value)
				if len(focused_filter_ids) >= 512:
					break
		secondary_ring_enabled_by_mode = {}
		known_secondary_ring_modes = (
			'fixstars',
			'asteroids',
			'midpoints',
			'hybrid_hits',
			'antiscia',
			'dodecatemoria',
			'contra_antiscia',
			'arabic_parts',
		)
		raw_secondary_ring_enabled = aspect.get('secondaryRingEnabledByMode')
		if isinstance(raw_secondary_ring_enabled, dict):
			for key in known_secondary_ring_modes:
				if key in raw_secondary_ring_enabled:
					secondary_ring_enabled_by_mode[key] = bool(
						raw_secondary_ring_enabled[key]
					)
		elif 'includeArabicParts' in aspect:
			# One-time compatibility for preferences written before the family
			# control followed the context-active secondary ring.
			secondary_ring_enabled_by_mode['arabic_parts'] = bool(
				aspect.get('includeArabicParts')
			)

		selected_promittor_id = transit.get('selectedPromittorId')
		if not isinstance(selected_promittor_id, str) or not selected_promittor_id.strip():
			selected_promittor_id = None
		else:
			selected_promittor_id = selected_promittor_id.strip()
		direction = transit.get('direction')
		if direction not in ('direct', 'converse', 'both'):
			direction = 'direct'

		def selected_ids(source, field, allowed, defaults):
			raw = source.get(field, defaults)
			if not isinstance(raw, (list, tuple)):
				raw = defaults
			selected = []
			for value in raw:
				for candidate in allowed:
					if value == candidate and candidate not in selected:
						selected.append(candidate)
						break
			return selected

		ingress_planet_ids = selected_ids(synodic,
			'ingressPlanetIds',
			tuple(range(11)) + (astrology.SE_CHIRON,),
			list(range(11)) + [astrology.SE_CHIRON],
		)
		synodic_planet_ids = selected_ids(synodic,
			'synodicPlanetIds',
			tuple(range(1, 11)) + (astrology.SE_CHIRON,),
			[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, astrology.SE_CHIRON],
		)
		# Chiron did not exist in schema 1, so every saved selection omitted it
		# regardless of user intent. Enable the newly available source once;
		# schema 2 subsequently preserves an explicit deselection.
		if schema_version < 2:
			if astrology.SE_CHIRON not in ingress_planet_ids:
				ingress_planet_ids.append(astrology.SE_CHIRON)
			if astrology.SE_CHIRON not in synodic_planet_ids:
				synodic_planet_ids.append(astrology.SE_CHIRON)
		lunar_cycle_ids = selected_ids(synodic,
			'lunarCycleIds',
			('draconic', 'anomalistic'),
			['draconic', 'anomalistic'],
		)
		secondary_planet_ids = None
		if secondary.get('planetIds') is not None:
			secondary_planet_ids = selected_ids(
				secondary, 'planetIds', tuple(range(256)), [],
			)
		secondary_aspect_ids = selected_ids(
			secondary, 'aspectIds', tuple(range(12)), list(range(12)),
		)

		vimshottari_anchor = vimshottari.get('anchor')
		if vimshottari_anchor not in ('moon', 'ascendant'):
			vimshottari_anchor = 'moon'
		vimshottari_start_star = vimshottari.get('startStar')
		if vimshottari_start_star not in ('janma', 'kshema', 'utpanna', 'adhana'):
			vimshottari_start_star = 'janma'
		try:
			vimshottari_year_days = float(vimshottari.get('yearDays', 365.25))
		except (TypeError, ValueError):
			vimshottari_year_days = 365.25
		if vimshottari_year_days not in (360.0, 365.25):
			vimshottari_year_days = 365.25
		vimshottari_ayanamsha = vimshottari.get('ayanamsha')
		if vimshottari_ayanamsha != 'follow_chart':
			try:
				vimshottari_ayanamsha = int(vimshottari_ayanamsha)
			except (TypeError, ValueError):
				vimshottari_ayanamsha = 'follow_chart'
			if (
				vimshottari_ayanamsha != 'follow_chart' and
				not 0 <= vimshottari_ayanamsha < 25
			):
				vimshottari_ayanamsha = 'follow_chart'

		return {
			'schemaVersion': 2,
			'aspectList': {
				'mode': mode,
				'maxOrb': max_orb,
				'sortBy': sort_by,
				'sortDirection': sort_direction,
				'focusedFilterIds': focused_filter_ids,
				'focusMatchMode': focus_match_mode,
				'rxFocusEnabled': bool(aspect.get('rxFocusEnabled', False)),
				'secondaryRingEnabledByMode': secondary_ring_enabled_by_mode,
				'filterDrawerOpen': bool(aspect.get('filterDrawerOpen', False)),
			},
			'transitList': {
				'selectedPromittorId': selected_promittor_id,
				'promittorDrawerOpen': bool(transit.get('promittorDrawerOpen', False)),
				'direction': direction,
			},
			'synodicList': {
				'ingressPlanetIds': ingress_planet_ids,
				'synodicPlanetIds': synodic_planet_ids,
				'lunarCycleIds': lunar_cycle_ids,
				'ingressDrawerOpen': bool(synodic.get('ingressDrawerOpen', False)),
				'synodicDrawerOpen': bool(synodic.get('synodicDrawerOpen', False)),
				'lunarDrawerOpen': bool(synodic.get('lunarDrawerOpen', False)),
			},
			'secondaryProgressions': {
				'planetIds': secondary_planet_ids,
				'aspectIds': secondary_aspect_ids,
				'filterDrawerOpen': bool(
					secondary.get('filterDrawerOpen', False) or
					secondary.get('planetDrawerOpen', False) or
					secondary.get('aspectDrawerOpen', False)
				),
			},
			'vimshottari': {
				'anchor': vimshottari_anchor,
				'startStar': vimshottari_start_star,
				'yearDays': vimshottari_year_days,
				'ayanamsha': vimshottari_ayanamsha,
			},
		}

	def get_user_panel_presets(self):
		return copy.deepcopy(self.user_panel_presets)

	def get_user_panel_preset(self, name):
		return copy.deepcopy(self.user_panel_presets.get(name))

	def get_user_panel_preset_names(self):
		return list(self.user_panel_presets.keys())

	def get_user_panel_custom_preset(self):
		return copy.deepcopy(self.user_panel_presets.get(USER_PANEL_CUSTOM_NAME))

	def set_user_panel_custom_preset(self, preset):
		self.user_panel_presets[USER_PANEL_CUSTOM_NAME] = copy.deepcopy(preset)
		return True

	def set_user_panel_preset(self, name, preset):
		name = str(name).strip()
		if not name:
			return False
		self.user_panel_presets[name] = copy.deepcopy(preset)
		return True

	def delete_user_panel_preset(self, name):
		name = str(name).strip()
		if not name or name not in self.user_panel_presets:
			return False
		del self.user_panel_presets[name]
		return True

	def get_custom_color_preset(self):
		return copy.deepcopy(self._normalize_color_preset(self.custom_color_preset))

	def set_custom_color_preset(self, preset):
		self.custom_color_preset = copy.deepcopy(self._normalize_color_preset(preset))

	def _normalize_speculum_options(self):
		defaults = getattr(self, 'def_speculums', None)
		if not defaults:
			return
		if not isinstance(getattr(self, 'speculums', None), list):
			self.speculums = copy.deepcopy(defaults)
			return
		for speculum_idx, default_cols in enumerate(defaults):
			if speculum_idx >= len(self.speculums) or not isinstance(self.speculums[speculum_idx], list):
				if speculum_idx >= len(self.speculums):
					self.speculums.append(default_cols[:])
				else:
					self.speculums[speculum_idx] = default_cols[:]
				continue
			cols = self.speculums[speculum_idx]
			if len(cols) < len(default_cols):
				cols.extend(default_cols[len(cols):])
			elif len(cols) > len(default_cols):
				del cols[len(default_cols):]
		if len(self.speculums) > len(defaults):
			del self.speculums[len(defaults):]

	def _normalize_speculum_speed_mode(self):
		if getattr(self, 'speculum_speed_mode', None) not in self.SPECULUM_SPEED_MODES:
			self.speculum_speed_mode = self.def_speculum_speed_mode

	@classmethod
	def normalize_pdincharttyp(cls, value):
		"""Map retired or malformed celestial PD projections to Planets."""
		if isinstance(value, bool):
			return cls.PD_IN_CHART_FROM_PLANETS
		try:
			normalized = int(value)
		except (TypeError, ValueError, OverflowError):
			return cls.PD_IN_CHART_FROM_PLANETS
		if isinstance(value, float) and not value.is_integer():
			return cls.PD_IN_CHART_FROM_PLANETS
		if normalized not in (
			cls.PD_IN_CHART_FROM_PLANETS,
			cls.PD_IN_CHART_ECLIPTIC_FEET,
		):
			return cls.PD_IN_CHART_FROM_PLANETS
		return normalized

	def _normalize_pds_in_chart_options(self):
		self.pdincharttyp = self.normalize_pdincharttyp(
			getattr(self, 'pdincharttyp', self.PD_IN_CHART_FROM_PLANETS)
		)
		# Retain the historical pickle slot, but never reactivate the retired
		# pseudo-astronomical secondary-motion control.
		self.pdinchartsecmotion = False

	def reload(self):
		#Appearance
		self.aspects = self.def_aspects
		self.aspect = self.def_aspect[:]
		self.symbols = self.def_symbols
		self.traditionalaspects = self.def_traditionalaspects
		self.showaspectsforderivedpoints = self.def_showaspectsforderivedpoints
		self.aspectlist_perfection_link_mode = self.def_aspectlist_perfection_link_mode
		self.showaspectstoasc = self.def_showaspectstoasc
		self.showaspectstomc = self.def_showaspectstomc
		self.showaspectstodsc = self.def_showaspectstodsc
		self.showaspectstoic = self.def_showaspectstoic
		self.houses = self.def_houses
		self.showouterhouselines = self.def_showouterhouselines
		self.positions = self.def_positions
		self.intables = self.def_intables
		self.bw = self.def_bw
		self.theme = self.def_theme
		self.anglo_dense_label_layout = self.def_anglo_dense_label_layout
		self.ascmcsize = self.def_ascmcsize
		self.tablesize = self.def_tablesize
		self.chartringthickness = self.def_chartringthickness
		self.legacypixelated = self.def_legacypixelated
		self.showkeyprompts = self.def_showkeyprompts
		self.show_help_chip = self.def_show_help_chip
		self.presentation_cursor = self.def_presentation_cursor
		self.keyprompts_style = self.def_keyprompts_style
		self.planetarydayhour = self.def_planetarydayhour
		self.housesystem = self.def_housesystem
		self.information = self.def_information
		self.showradixnameincanvas = self.def_showradixnameincanvas
		self.showseconds = self.def_showseconds
		self.dateconvention = self.def_dateconvention
		self.transcendental = self.def_transcendental[:]
		self.showchiron = self.def_showchiron
		self.extendedradixstations = self.def_extendedradixstations
		self.showvertex = self.def_showvertex
		self.showaspectstovertex = self.def_showaspectstovertex
		self.shownodes = self.def_shownodes
		self.aspectstonodes = self.def_aspectstonodes
		self.exclusive_aspects_on_click = self.def_exclusive_aspects_on_click
		self.exclusive_aspects_on_click_show_minor = self.def_exclusive_aspects_on_click_show_minor
		self.exclusive_aspects_on_click_traditional = self.def_exclusive_aspects_on_click_traditional
		self.aspect_flag_show_parties = self.def_aspect_flag_show_parties
		self.showlof = self.def_showlof
		self.showaspectstolof = self.def_showaspectstolof
		self.showlofouterring = self.def_showlofouterring
		self.showprenatalsyzygy = self.def_showprenatalsyzygy
		self.showprenataleclipse = self.def_showprenataleclipse
		self.pdf_chart_color_mode = self.def_pdf_chart_color_mode
		self.pdf_chart_raster_preset = self.def_pdf_chart_raster_preset
		self.pdf_include_overlays = self.def_pdf_include_overlays
		self.png_chart_appearance = self.def_png_chart_appearance
		self.png_include_overlays = self.def_png_include_overlays
		self.list_export_aspect_symbols = self.def_list_export_aspect_symbols
		self.showterms = self.def_showterms
		self.showdecans = self.def_showdecans
		self.showanglearrowheads = self.def_showanglearrowheads
		self.showcusplessascmclabels = self.def_showcusplessascmclabels
		self.multiwheel_show_positions = self.def_multiwheel_show_positions
		self.multiwheel_show_minutes = self.def_multiwheel_show_minutes
		self.multiwheel_sign_colors = self.def_multiwheel_sign_colors
		self.multiwheel_show_angle_labels = self.def_multiwheel_show_angle_labels
		self.dignitylabelcolors = self.def_dignitylabelcolors
		self.showfixstars = self.def_showfixstars
		self.phasismode = self.def_phasismode
		self.showcazimi = self.def_showcazimi
		self.cazimimode = self.def_cazimimode
		self.synodicmode = self.def_synodicmode
		self.solarconditionmode = self.def_solarconditionmode
		self.showeclipseoverlay = self.def_showeclipseoverlay
		self.astrocart_localspace_additive = self.def_astrocart_localspace_additive
		self.astrocart_show_ecliptic = self.def_astrocart_show_ecliptic
		self.astrocart_show_equator = self.def_astrocart_show_equator
		self.astrocart_show_asc_circle = self.def_astrocart_show_asc_circle
		self.astrocart_show_mc_circle = self.def_astrocart_show_mc_circle
		self.astrocart_show_house_lines = self.def_astrocart_show_house_lines
		self.astrocart_show_zodiac_lines = self.def_astrocart_show_zodiac_lines
		self.astrocart_show_country_labels = self.def_astrocart_show_country_labels
		self.astrocart_terrain_relief = self.def_astrocart_terrain_relief
		self.showfixstarsnodes = self.def_showfixstarsnodes
		self.showfixstarshcs = self.def_showfixstarshcs
		self.showfixstarslof = self.def_showfixstarslof
		self.ringorb_midpoints = self.def_ringorb_midpoints
		self.ringorb_asteroids = self.def_ringorb_asteroids
		self.ringorb_hybrid = self.def_ringorb_hybrid
		self.topocentric = self.def_topocentric
		self.usetradfixstarnamespdlist = self.def_usetradfixstarnamespdlist
		self.netbook = self.def_netbook

		#AppearanceII
		self.speculums = copy.deepcopy(self.def_speculums)
		self.intime = self.def_intime
		self.speculumdodecat = copy.deepcopy(self.def_speculumdodecat)
		self.speculum_speed_mode = self.def_speculum_speed_mode

		#Symbols
		self.uranus = self.def_uranus
		self.pluto = self.def_pluto
		self.signs = self.def_signs

		#Dignities
		self.dignities = copy.deepcopy(self.def_dignities)

		#Minor dignities
		self.seltrip = self.def_seltrip
		self.trips = copy.deepcopy(self.def_trips)
		self.selterm = self.def_selterm
		self.terms = copy.deepcopy(self.def_terms)
		self.seldecan = self.def_seldecan
		self.decans = copy.deepcopy(self.def_decans)

		#Chart Almutens
		self.oneruler = self.def_oneruler
		self.usedaynightorb = self.def_usedaynightorb
		self.dignityscores = self.def_dignityscores[:]
		self.useaccidental = self.def_useaccidental
		self.housescores = self.def_housescores[:]
		self.sunphases = self.def_sunphases[:]
		self.dayhourscores = self.def_dayhourscores[:]
		self.useexaltationmercury = self.def_useexaltationmercury

		#Topical almutens and Parts
		if self.topicals != None:
			del self.topicals
		self.topicals = self.def_topicals
		self.arabicpartsref = self.def_arabicpartsref
		self.daynightorbdeg = self.def_daynightorbdeg
		self.daynightorbmin = self.def_daynightorbmin
		self.arabicparts = []

		#Ayanamsha
		self.ayanamsha = self.def_ayanamsha

		#Lunar Mansions
		self.manazil_zodiac = self.def_manazil_zodiac
		self.show_manzil_in_inspector = self.def_show_manzil_in_inspector

		#Lunar Day anchor
		self.lunar_day_anchor = self.def_lunar_day_anchor

		#Colors
		self.clrframe = self.def_clrframe
		self.clrsigns = self.def_clrsigns
		self.usezodiacelementcolors = self.def_usezodiacelementcolors
		self.clrsignelementfire = self.def_clrsignelementfire
		self.clrsignelementearth = self.def_clrsignelementearth
		self.clrsignelementair = self.def_clrsignelementair
		self.clrsignelementwater = self.def_clrsignelementwater
		self.clrAscMC = self.def_clrAscMC
		self.clrhouses = self.def_clrhouses
		self.clrhousenumbers = self.def_clrhousenumbers
		self.clrpositions = self.def_clrpositions

		self.clrperegrin = self.def_clrperegrin
		self.clrdomicil = self.def_clrdomicil
		self.clrexil = self.def_clrexil
		self.clrexal = self.def_clrexal
		self.clrcasus = self.def_clrcasus

		self.clraspect = self.def_clraspect[:]

		self.clrindividual = self.def_clrindividual[:]

		self.useplanetcolors = self.def_useplanetcolors

		self.clrbackground = self.def_clrbackground
		self.clrsidebar = self.def_clrsidebar
		self.clrtable = self.def_clrtable
		self.clrtexts = self.def_clrtexts
		self.clrsidebartext = self.def_clrsidebartext
		self.clrappbackground = self.def_clrappbackground
		self.clrapptexts = self.def_clrapptexts
		self.follow_os_theme = self.def_follow_os_theme

		#Housesystem
		self.hsys = self.def_hsys

		#Nodes
		self.meannode = self.def_meannode

		#Orbis
		self.orbis = copy.deepcopy(self.def_orbis)
		self.orbisplanetspar = copy.deepcopy(self.def_orbisplanetspar)

		# Houses
		self.orbisH = self.def_orbisH[:]
		self.orbisparH = self.def_orbisparH[:]

		self.orbiscuspH = self.def_orbiscuspH

		# Asc,MC
		self.orbisAscMC = self.def_orbisAscMC[:]
		self.orbisparAscMC = self.def_orbisparAscMC[:]

		self.orbiscuspAscMC = self.def_orbiscuspAscMC

		self.exact = self.def_exact
		self.aspect_thickness_mode = self.def_aspect_thickness_mode
		self.aspect_opacity_mode = self.def_aspect_opacity_mode

		#Primary Dir
		self.primarydir = self.def_primarydir
		self.subprimarydir = self.def_subprimarydir
		self.subzodiacal = self.def_subzodiacal
		self.bianchini = self.def_bianchini
		self.morin_excentric = self.def_morin_excentric
		self.morin_antiscia = self.def_morin_antiscia
		self.revsidereal_marr_solar = self.def_revsidereal_marr_solar
		self.revsidereal_marr_lunar = self.def_revsidereal_marr_lunar
		self.revsidereal_marr_planet = self.def_revsidereal_marr_planet

		self.sigascmc = self.def_sigascmc[:]

		self.sigangles = self.def_sigangles[:]

		self.sighouses = self.def_sighouses

		self.sigplanets = self.def_sigplanets[:]
		self.promplanets = self.def_promplanets[:]
		self.stepalerts_enabled = self.def_stepalerts_enabled
		self.stepalerts_sigangles = self.def_stepalerts_sigangles[:]
		self.stepalerts_sigplanets = self.def_stepalerts_sigplanets[:]
		self.stepalerts_promplanets = self.def_stepalerts_promplanets[:]

		self.pdaspects = self.def_pdaspects[:]

		self.pdcircumoa = self.def_pdcircumoa
		self.pdcircumprommode = self.def_pdcircumprommode
		self.pdlistmode = self.def_pdlistmode
		self.pdlistglyphcolors = self.def_pdlistglyphcolors

		self.pdmidpoints = self.def_pdmidpoints

		self.pdparallels = self.def_pdparallels[:]

		self.pdsecmotion = self.def_pdsecmotion
		self.pdsecmotioniter = self.def_pdsecmotioniter
		self.pdrevsunyearmode = self.def_pdrevsunyearmode
		self.pdrevannualmode = self.def_pdrevannualmode
		self.pdrevshownatalpromissors = self.def_pdrevshownatalpromissors

		self.zodpromsigasps = self.def_zodpromsigasps[:]
		self.ascmchcsasproms = self.def_ascmchcsasproms
		self.pdcusppromissors = self.def_pdcusppromissors

		self.pdfixstars = self.def_pdfixstars

		del self.pdfixstarssel[:]
		self.pdfixstarssel = self.def_pdfixstarssel[:]

		self.pdlof = self.def_pdlof[:]

		self.pdsyzygy = self.def_pdsyzygy

		self.pdterms = self.def_pdterms

		self.pdantiscia = self.def_pdantiscia
		self.pdmorinpromittorset = self.def_pdmorinpromittorset

		self.pdcustomer = self.def_pdcustomer
		self.pdcustomerlon = self.def_pdcustomerlon
		self.pdcustomerlat = self.def_pdcustomerlat
		self.pdcustomersouthern = self.def_pdcustomersouthern

		self.pdcustomer2 = self.def_pdcustomer2
		self.pdcustomer2lon = self.def_pdcustomer2lon
		self.pdcustomer2lat = self.def_pdcustomer2lat
		self.pdcustomer2southern = self.def_pdcustomer2southern
		self.pdpromchiron = self.def_pdpromchiron
		self.pdsigchiron = self.def_pdsigchiron
		self.pdsigvertex = self.def_pdsigvertex
		self.pdpromarabicparts = self.def_pdpromarabicparts
		self.pdpromarabicpartname = self.def_pdpromarabicpartname
		self.pdsigarabicparts = self.def_pdsigarabicparts
		self.pdsigarabicpartname = self.def_pdsigarabicpartname

		#PD-Keys
		self.pdkeydyn = self.def_pdkeydyn
		self.pdkeyd = self.def_pdkeyd
		self.pdkeys = self.def_pdkeys
		self.pdkeydeg = self.def_pdkeydeg
		self.pdkeymin = self.def_pdkeymin
		self.pdkeysec = self.def_pdkeysec

		self.useregressive = self.def_useregressive

		#Fortune
		self.lotoffortune = self.def_lotoffortune

		#Syzygy
		self.syzmoon = self.def_syzmoon

		#Fixstars
		self.fixstars.clear()
		self.fixstars = self.def_fixstars.copy()
		self.useIndianFixstarNames = self.def_useIndianFixstarNames

		#Profections
		self.zodprof = self.def_zodprof
		self.usezodprojsprof = self.def_usezodprojsprof
		self.profections_solar_return_snap = self.def_profections_solar_return_snap
		self.profwholesign = self.def_profwholesign

# ########################################
# Roberto change - V 7.3.0
		#Firdaria
		self.isfirbonatti = self.def_isfirbonatti
# ########################################

# ########################################
# Roberto change - V 7.2.0
		#Default Location
		self.deflocname = self.def_deflocname
		self.deflocplus = self.def_deflocplus
		self.defloczhour = self.def_defloczhour
		self.defloczminute = self.def_defloczminute
		self.deflocdst = self.def_deflocdst
		self.defloclondeg = self.def_defloclondeg
		self.defloclonmin = self.def_defloclonmin
		self.defloclatdeg = self.def_defloclatdeg
		self.defloclatmin = self.def_defloclatmin
		self.defloclon = self.def_defloclon
		self.defloclat = self.def_defloclat
		self.defloceast = self.def_defloceast
		self.deflocnorth = self.def_deflocnorth
		self.deflocalt = self.def_deflocalt
# ########################################

		#PDsInChart
		self.pdincharttyp = self.def_pdincharttyp
		self.pdinchartsecmotion = self.def_pdinchartsecmotion

		self.pdinchartterrsecmotion = self.def_pdinchartterrsecmotion
		self.pdinchartreverse = self.def_pdinchartreverse

		#Languages
		self.langid = self.def_langid
		self.fontfamily = self.def_fontfamily

		#Autosave
		self.autosave = self.def_autosave
		self.quickcharts_prompt = self.def_quickcharts_prompt
		self.timed_chart_show_radix_default = self.def_timed_chart_show_radix_default
		self.event_table_time_basis = self.def_event_table_time_basis
		self.subcharts_open_compound_default = self.def_subcharts_open_compound_default
		self.multiwheel_open_at_three = self.def_multiwheel_open_at_three
		self.chart_ring_count = self.def_chart_ring_count
		self.chart_ring_zodiac = self.def_chart_ring_zodiac
		self.secondary_progression_launch_mode = self.def_secondary_progression_launch_mode
		self.aspectlist_prebirth_secondary_converse = self.def_aspectlist_prebirth_secondary_converse
		self.at_reclick_behavior = self.def_at_reclick_behavior
		self.harmonic_chart_mode = self.def_harmonic_chart_mode
		self.varga_drishti_mode = self.def_varga_drishti_mode
		self.varga_node_special_drishti = self.def_varga_node_special_drishti
		self.search_techniques = self.def_search_techniques[:]
		self.search_aspects = self.def_search_aspects[:]
		self.search_promittor_ids = self.def_search_promittor_ids[:]
		self.search_significator_ids = self.def_search_significator_ids[:]
		self.search_promittor_motion = self.def_search_promittor_motion
		self.search_significator_motion = self.def_search_significator_motion
		self.search_lunation_orb = self.def_search_lunation_orb
		self.search_moon_phase = self.def_search_moon_phase
		self.search_from = self.def_search_from
		self.search_to = self.def_search_to
		self.search_part_filter = self.def_search_part_filter
		self.search_sign_changes = self.def_search_sign_changes
		self.search_default_offset_months = self.def_search_default_offset_months
		self.search_default_range_months = self.def_search_default_range_months
		self.search_lifetime_years = self.def_search_lifetime_years
		self.search_has_saved_state = self.def_search_has_saved_state
		self.startupchart = self.def_startupchart
		self.restore_open_charts = self.def_restore_open_charts
		self.restore_open_chart_refs = self.def_restore_open_chart_refs[:]
		self.restore_open_charts_active_ref = copy.deepcopy(self.def_restore_open_charts_active_ref)
		self.recent_chart_refs = self.def_recent_chart_refs[:]
		self.chart_picker_sort_column = self.def_chart_picker_sort_column
		self.chart_picker_sort_ascending = self.def_chart_picker_sort_ascending
		self.astrocartography_preferences = copy.deepcopy(
			self.def_astrocartography_preferences
		)
		self.last_hor_dir = self.def_last_hor_dir
		self.revolutions_solaryearmode = self.def_revolutions_solaryearmode
		self.revolutions_solarlocationmode = self.def_revolutions_solarlocationmode
		self.revolutions_planetslocationmode = self.def_revolutions_planetslocationmode
		self.revolutions_lunarlocationmode = self.def_revolutions_lunarlocationmode
		self.revolutions_lunarparentmode = self.def_revolutions_lunarparentmode
		self.revolutions_solarreturnmode = self.def_revolutions_solarreturnmode
		self.revolutions_lunarreturnmode = self.def_revolutions_lunarreturnmode

		# Composite
		self.composite_method = self.def_composite_method
		self.synastry_opens_composite_first = self.def_synastry_opens_composite_first


	def load(self):
		res = True

		try:
			optfile = self.appearance1opt
			f = self._open_opt_for_load(optfile)
			self.aspects = pickle.load(f)
			self.aspect = pickle.load(f)
			self.symbols = pickle.load(f)
			self.traditionalaspects = pickle.load(f)
			self.houses = pickle.load(f)
			self.positions = pickle.load(f)
			self.intables = pickle.load(f)
			self.bw = pickle.load(f)
			self.theme = pickle.load(f)
			self.ascmcsize = pickle.load(f)
			self.tablesize = pickle.load(f)
			self.planetarydayhour = pickle.load(f)
			self.housesystem = pickle.load(f)
			self.transcendental = pickle.load(f)
			self.shownodes = pickle.load(f)
			self.aspectstonodes = pickle.load(f)
			self.showlof = pickle.load(f)
			self.showaspectstolof = pickle.load(f)
			self.showterms = pickle.load(f)
			self.showdecans = pickle.load(f)
			self.showfixstars = pickle.load(f)
			self.showfixstarsnodes = pickle.load(f)
			self.showfixstarshcs = pickle.load(f)
			self.showfixstarslof = pickle.load(f)
			self.topocentric = pickle.load(f)
			self.usetradfixstarnamespdlist = pickle.load(f)
			self.netbook = pickle.load(f)
			# added fields (backward compatible)
			try:
				self.information = pickle.load(f)
			except Exception:
				self.information = self.def_information
			try:
				self.showchiron = pickle.load(f)
			except Exception:
				self.showchiron = self.def_showchiron
			try:
				self.ringorb_midpoints = pickle.load(f)
			except Exception:
				self.ringorb_midpoints = self.def_ringorb_midpoints
			try:
				self.ringorb_asteroids = pickle.load(f)
			except Exception:
				self.ringorb_asteroids = self.def_ringorb_asteroids
			try:
				self.ringorb_hybrid = pickle.load(f)
			except Exception:
				self.ringorb_hybrid = self.def_ringorb_hybrid
			try:
				self.phasismode = pickle.load(f)
			except Exception:
				self.phasismode = self.def_phasismode
			try:
				self.dignitylabelcolors = pickle.load(f)
			except Exception:
				self.dignitylabelcolors = self.def_dignitylabelcolors
			try:
				self.showseconds = pickle.load(f)
			except Exception:
				self.showseconds = self.def_showseconds
			try:
				self.exclusive_aspects_on_click = pickle.load(f)
			except Exception:
				self.exclusive_aspects_on_click = self.def_exclusive_aspects_on_click
			try:
				self.aspect_thickness_mode = pickle.load(f)
			except Exception:
				self.aspect_thickness_mode = self.def_aspect_thickness_mode
			try:
				self.exclusive_aspects_on_click_show_minor = pickle.load(f)
			except Exception:
				self.exclusive_aspects_on_click_show_minor = self.def_exclusive_aspects_on_click_show_minor
			try:
				self.exclusive_aspects_on_click_traditional = pickle.load(f)
			except Exception:
				self.exclusive_aspects_on_click_traditional = self.def_exclusive_aspects_on_click_traditional
			try:
				self.showvertex = pickle.load(f)
			except Exception:
				self.showvertex = self.def_showvertex
			try:
				self.showaspectstovertex = pickle.load(f)
			except Exception:
				self.showaspectstovertex = self.def_showaspectstovertex
			try:
				self.extendedradixstations = pickle.load(f)
			except Exception:
				self.extendedradixstations = self.def_extendedradixstations
			try:
				self.showlofouterring = pickle.load(f)
			except Exception:
				self.showlofouterring = self.def_showlofouterring
			try:
				self.chartringthickness = int(pickle.load(f))
			except Exception:
				self.chartringthickness = self.def_chartringthickness
			try:
				self.showkeyprompts = bool(pickle.load(f))
			except Exception:
				self.showkeyprompts = self.def_showkeyprompts
			try:
				val = pickle.load(f)
				self.keyprompts_style = str(val) if val in ('overlay', 'native', 'strip', 'off') else self.def_keyprompts_style
			except Exception:
				self.keyprompts_style = self.def_keyprompts_style
			try:
				self.show_help_chip = bool(pickle.load(f))
			except Exception:
				self.show_help_chip = self.def_show_help_chip
			try:
				self.legacypixelated = bool(pickle.load(f))
			except Exception:
				self.legacypixelated = self.def_legacypixelated
			try:
				val = pickle.load(f)
				if type(val) is int and val in (self.CAZIMI_MODE_HELLENISTIC, self.CAZIMI_MODE_AL_QABISI, self.CAZIMI_MODE_ABU_MASHAR):
					self.cazimimode = val
				else:
					self.cazimimode = self.def_cazimimode
			except Exception:
				self.cazimimode = self.def_cazimimode
			try:
				self.showcazimi = bool(pickle.load(f))
			except Exception:
				self.showcazimi = self.def_showcazimi
			try:
				self.showeclipseoverlay = bool(pickle.load(f))
			except Exception:
				self.showeclipseoverlay = self.def_showeclipseoverlay
			try:
				val = pickle.load(f)
				if type(val) is int and val in (self.SYNODIC_MODE_STATION_CAZIMI, self.SYNODIC_MODE_ALL):
					self.synodicmode = val
				else:
					self.synodicmode = self.def_synodicmode
			except Exception:
				self.synodicmode = self.def_synodicmode
			try:
				self.astrocart_localspace_additive = bool(pickle.load(f))
			except Exception:
				self.astrocart_localspace_additive = self.def_astrocart_localspace_additive
			try:
				val = pickle.load(f)
				val = str(val)
				self.dateconvention = self.DATE_CONVENTION_DMY if val in ('dmy', 'euro') else (
					self.DATE_CONVENTION_CURRENT if val == self.DATE_CONVENTION_CURRENT else self.def_dateconvention)
			except Exception:
				self.dateconvention = self.def_dateconvention
			try:
				self.showprenatalsyzygy = bool(pickle.load(f))
			except Exception:
				self.showprenatalsyzygy = self.def_showprenatalsyzygy
			try:
				val = str(pickle.load(f))
				if val in ('monochrome', 'colored-details'):
					self.pdf_chart_color_mode = val
				else:
					self.pdf_chart_color_mode = self.def_pdf_chart_color_mode
			except Exception:
				self.pdf_chart_color_mode = self.def_pdf_chart_color_mode
			try:
				self.pdf_include_overlays = bool(pickle.load(f))
			except Exception:
				self.pdf_include_overlays = self.def_pdf_include_overlays
			try:
				self.showanglearrowheads = bool(pickle.load(f))
			except Exception:
				self.showanglearrowheads = self.def_showanglearrowheads
			try:
				self.showcusplessascmclabels = bool(pickle.load(f))
			except Exception:
				self.showcusplessascmclabels = self.def_showcusplessascmclabels
			try:
				self.aspect_opacity_mode = bool(pickle.load(f))
			except Exception:
				self.aspect_opacity_mode = self.def_aspect_opacity_mode
			try:
				self.presentation_cursor = bool(pickle.load(f))
			except Exception:
				self.presentation_cursor = self.def_presentation_cursor
			try:
				self.astrocart_show_ecliptic = bool(pickle.load(f))
			except Exception:
				self.astrocart_show_ecliptic = self.def_astrocart_show_ecliptic
			try:
				self.astrocart_show_equator = bool(pickle.load(f))
			except Exception:
				self.astrocart_show_equator = self.def_astrocart_show_equator
			try:
				self.astrocart_show_asc_circle = bool(pickle.load(f))
			except Exception:
				self.astrocart_show_asc_circle = self.def_astrocart_show_asc_circle
			try:
				self.astrocart_show_mc_circle = bool(pickle.load(f))
			except Exception:
				self.astrocart_show_mc_circle = self.def_astrocart_show_mc_circle
			try:
				self.astrocart_show_house_lines = bool(pickle.load(f))
			except Exception:
				self.astrocart_show_house_lines = self.def_astrocart_show_house_lines
			try:
				self.astrocart_show_zodiac_lines = bool(pickle.load(f))
			except Exception:
				self.astrocart_show_zodiac_lines = self.def_astrocart_show_zodiac_lines
			try:
				self.astrocart_terrain_relief = bool(pickle.load(f))
			except Exception:
				self.astrocart_terrain_relief = self.def_astrocart_terrain_relief
			try:
				self.astrocart_show_country_labels = bool(pickle.load(f))
			except Exception:
				self.astrocart_show_country_labels = self.def_astrocart_show_country_labels
			try:
				value = str(pickle.load(f))
				self.anglo_dense_label_layout = (
					value if value in self.ANGLO_DENSE_LABEL_LAYOUTS
					else self.def_anglo_dense_label_layout
				)
			except Exception:
				self.anglo_dense_label_layout = self.def_anglo_dense_label_layout
			try:
				value = str(pickle.load(f))
				self.pdf_chart_raster_preset = (
					value if value in ('clean', 'atkinson', 'blue-noise', 'newsprint')
					else self.def_pdf_chart_raster_preset
				)
			except Exception:
				self.pdf_chart_raster_preset = self.def_pdf_chart_raster_preset
			try:
				self.showouterhouselines = bool(pickle.load(f))
			except Exception:
				self.showouterhouselines = self.def_showouterhouselines
			try:
				self.showaspectstoasc = bool(pickle.load(f))
			except Exception:
				self.showaspectstoasc = self.def_showaspectstoasc
			try:
				self.showaspectstomc = bool(pickle.load(f))
			except Exception:
				self.showaspectstomc = self.def_showaspectstomc
			try:
				self.showaspectstodsc = bool(pickle.load(f))
			except Exception:
				self.showaspectstodsc = self.def_showaspectstodsc
			try:
				self.showaspectstoic = bool(pickle.load(f))
			except Exception:
				self.showaspectstoic = self.def_showaspectstoic
			try:
				value = str(pickle.load(f))
				self.png_chart_appearance = (
					value if value in ('screen', 'monochrome', 'colored-details')
					else self.def_png_chart_appearance
				)
			except Exception:
				self.png_chart_appearance = self.def_png_chart_appearance
			try:
				self.png_include_overlays = bool(pickle.load(f))
			except Exception:
				self.png_include_overlays = self.def_png_include_overlays
			try:
				self.showaspectsforderivedpoints = bool(pickle.load(f))
			except Exception:
				self.showaspectsforderivedpoints = self.def_showaspectsforderivedpoints
			try:
				self.list_export_aspect_symbols = bool(pickle.load(f))
			except Exception:
				self.list_export_aspect_symbols = self.def_list_export_aspect_symbols
			try:
				value = pickle.load(f)
				self.solarconditionmode = (
					value if type(value) is int and value in self.SOLAR_CONDITION_MODES
					else self.def_solarconditionmode
				)
			except Exception:
				self.solarconditionmode = self.def_solarconditionmode
			try:
				self.showradixnameincanvas = bool(pickle.load(f))
			except Exception:
				self.showradixnameincanvas = self.def_showradixnameincanvas
			try:
				self.showprenataleclipse = bool(pickle.load(f))
			except Exception:
				# Preserve the first Ec release for existing users who already had
				# the shared prenatal-syzygy layer enabled.
				self.showprenataleclipse = bool(self.showprenatalsyzygy)
			try:
				value = str(pickle.load(f))
				self.aspectlist_perfection_link_mode = (
					value if value in ('transits', 'secondary')
					else self.def_aspectlist_perfection_link_mode
				)
			except Exception:
				self.aspectlist_perfection_link_mode = self.def_aspectlist_perfection_link_mode
			try:
				self.multiwheel_show_positions = bool(pickle.load(f))
			except Exception:
				self.multiwheel_show_positions = self.def_multiwheel_show_positions
			try:
				self.multiwheel_show_minutes = bool(pickle.load(f))
			except Exception:
				self.multiwheel_show_minutes = self.def_multiwheel_show_minutes
			try:
				self.multiwheel_sign_colors = bool(pickle.load(f))
			except Exception:
				self.multiwheel_sign_colors = self.def_multiwheel_sign_colors
			try:
				self.multiwheel_show_angle_labels = bool(pickle.load(f))
			except Exception:
				self.multiwheel_show_angle_labels = self.def_multiwheel_show_angle_labels
			if (
				isinstance(self.ringorb_asteroids, bool) and
				isinstance(self.ringorb_hybrid, bool) and
				isinstance(self.phasismode, float) and
				isinstance(self.dignitylabelcolors, float)
			):
				legacy_exclusive = self.ringorb_asteroids
				legacy_show_minor = self.ringorb_hybrid
				legacy_ringorb_asteroids = self.phasismode
				legacy_ringorb_hybrid = self.dignitylabelcolors
				legacy_phasismode = self.showseconds
				legacy_dignitylabelcolors = self.exclusive_aspects_on_click
				legacy_showseconds = self.aspect_thickness_mode
				legacy_aspect_thickness = self.exclusive_aspects_on_click_show_minor
				self.exclusive_aspects_on_click = bool(legacy_exclusive)
				self.exclusive_aspects_on_click_show_minor = bool(legacy_show_minor)
				self.ringorb_asteroids = float(legacy_ringorb_asteroids)
				self.ringorb_hybrid = float(legacy_ringorb_hybrid)
				self.phasismode = int(legacy_phasismode)
				self.dignitylabelcolors = bool(legacy_dignitylabelcolors)
				self.showseconds = bool(legacy_showseconds)
				self.aspect_thickness_mode = bool(legacy_aspect_thickness)
			elif (
				isinstance(self.ringorb_asteroids, float) and
				isinstance(self.ringorb_hybrid, float) and
				isinstance(self.phasismode, int) and
				isinstance(self.dignitylabelcolors, float)
			):
				legacy_topocentric = self.showfixstarshcs
				legacy_fixstar_hcs = self.showfixstarslof
				legacy_fixstar_lof = self.topocentric
				legacy_topocentric_actual = self.usetradfixstarnamespdlist
				legacy_tradfs = self.netbook
				legacy_netbook = self.information
				legacy_information = self.showchiron
				legacy_showchiron = self.ringorb_midpoints
				self.showfixstarshcs = bool(legacy_fixstar_hcs)
				self.showfixstarslof = bool(legacy_fixstar_lof)
				self.topocentric = bool(legacy_topocentric_actual)
				self.usetradfixstarnamespdlist = bool(legacy_tradfs)
				self.netbook = bool(legacy_netbook)
				self.information = bool(legacy_information)
				self.showchiron = bool(legacy_showchiron)

			f.close()
		except IOError:
			res = False

		try:
			optfile = self.appearance2opt
			f = self._open_opt_for_load(optfile)
			self.speculums = pickle.load(f)
			self._normalize_speculum_options()
			self.intime = pickle.load(f)
			# Backward-compatible: speculum dodecat toggle (2 items: Placidian/Regiomontan)
			try:
				self.speculumdodecat = pickle.load(f)
			except Exception:
				self.speculumdodecat = copy.deepcopy(self.def_speculumdodecat)
			try:
				self.speculum_speed_mode = pickle.load(f)
			except Exception:
				self.speculum_speed_mode = self.def_speculum_speed_mode
			self._normalize_speculum_speed_mode()
			self._normalize_speculum_options()
			f.close()
		except IOError:
			res = False

		try:
			optfile = self.symbolsopt
			f = self._open_opt_for_load(optfile)
			self.uranus = pickle.load(f)
			self.pluto = pickle.load(f)
			self.signs = pickle.load(f)
			f.close()
		except IOError:
			res = False

		try:
			optfile = self.dignitiesopt
			f = self._open_opt_for_load(optfile)
			self.dignities = pickle.load(f)
			f.close()
		except IOError:
			res = False

		try:
			optfile = self.triplicitiesopt
			f = self._open_opt_for_load(optfile)
			self.seltrip = pickle.load(f)
			self.trips = pickle.load(f)
			f.close()
		except IOError:
			res = False

		try:
			optfile = self.termsopt
			f = self._open_opt_for_load(optfile)
			self.selterm = pickle.load(f)
			self.terms = pickle.load(f)
			f.close()
		except IOError:
			res = False

		try:
			optfile = self.decansopt
			f = self._open_opt_for_load(optfile)
			self.seldecan = pickle.load(f)
			self.decans = pickle.load(f)
			f.close()
		except IOError:
			res = False

		try:
			optfile = self.chartalmutenopt
			f = self._open_opt_for_load(optfile)
			self.oneruler = pickle.load(f)
			self.usedaynightorb = pickle.load(f)
			self.dignityscores = pickle.load(f)
			self.useaccidental = pickle.load(f)
			self.housescores = pickle.load(f)
			self.sunphases = pickle.load(f)
			self.dayhourscores = pickle.load(f)
			self.useexaltationmercury = pickle.load(f)
			f.close()
		except IOError:
			res = False

		try:
			optfile = self.topicalandpartsopt
			f = self._open_opt_for_load(optfile)
			self.topicals = pickle.load(f)
			self.arabicparts = pickle.load(f)
			self.arabicpartsref = pickle.load(f)
			self.daynightorbdeg = pickle.load(f)
			self.daynightorbmin = pickle.load(f)
			f.close()
		except IOError:
			res = False

		try:
			optfile = self.ayanamsaopt
			f = self._open_opt_for_load(optfile)
			self.ayanamsha = pickle.load(f)
			try:
				self.manazil_zodiac = pickle.load(f)
			except Exception:
				self.manazil_zodiac = self.def_manazil_zodiac
			try:
				self.lunar_day_anchor = pickle.load(f)
			except Exception:
				self.lunar_day_anchor = self.def_lunar_day_anchor
			try:
				self.show_manzil_in_inspector = bool(pickle.load(f))
			except Exception:
				self.show_manzil_in_inspector = self.def_show_manzil_in_inspector
			f.close()
		except IOError:
			res = False

		try:
			optfile = self.colorsopt
			f = self._open_opt_for_load(optfile)
			self.clrframe = pickle.load(f)
			self.clrsigns = pickle.load(f)
			self.clrAscMC = pickle.load(f)
			self.clrhouses = pickle.load(f)
			self.clrhousenumbers = pickle.load(f)
			self.clrpositions = pickle.load(f)
			self.clrperegrin = pickle.load(f)
			self.clrdomicil = pickle.load(f)
			self.clrexil = pickle.load(f)
			self.clrexal = pickle.load(f)
			self.clrcasus = pickle.load(f)
			self.clraspect = pickle.load(f)
			self.clrindividual = pickle.load(f)
			self.useplanetcolors = pickle.load(f)
			self.clrbackground = pickle.load(f)
			self.clrtable = pickle.load(f)
			self.clrtexts = pickle.load(f)
			try:
				self.clrsidebar = pickle.load(f)
			except Exception:
				self.clrsidebar = self.clrbackground
			try:
				self.clrsidebartext = pickle.load(f)
			except Exception:
				self.clrsidebartext = self.clrtexts
			try:
				self.custom_color_preset = pickle.load(f)
			except Exception:
				self.custom_color_preset = self._current_color_preset()
			try:
				self.usezodiacelementcolors = pickle.load(f)
				self.clrsignelementfire = pickle.load(f)
				self.clrsignelementearth = pickle.load(f)
				self.clrsignelementair = pickle.load(f)
				self.clrsignelementwater = pickle.load(f)
			except Exception:
				self.usezodiacelementcolors = self.def_usezodiacelementcolors
				self.clrsignelementfire = self.def_clrsignelementfire
				self.clrsignelementearth = self.def_clrsignelementearth
				self.clrsignelementair = self.def_clrsignelementair
				self.clrsignelementwater = self.def_clrsignelementwater
			self.custom_color_preset = self._normalize_color_preset(self.custom_color_preset)
			try:
				self.follow_os_theme = bool(pickle.load(f))
			except Exception:
				self.follow_os_theme = self.def_follow_os_theme
			try:
				app_color_trailer = pickle.load(f)
			except Exception:
				app_color_trailer = None
			(self.clrappbackground, self.clrapptexts) = self._normalize_app_color_trailer(
				app_color_trailer,
				self.clrbackground,
				self.clrtexts,
			)
			self.def_clrindividual = self._normalize_clrindividual(self.def_clrindividual, fallback=self.clrindividual)
			self.clrindividual = self._normalize_clrindividual(self.clrindividual, fallback=self.def_clrindividual)
			self.custom_color_preset = self._normalize_color_preset(self.custom_color_preset)
			f.close()
		except IOError:
			res = False

		try:
			optfile = self.housesystemopt
			f = self._open_opt_for_load(optfile)
			self.hsys = pickle.load(f)
			f.close()
		except IOError:
			res = False

		try:
			optfile = self.nodesopt
			f = self._open_opt_for_load(optfile)
			self.meannode = pickle.load(f)
			f.close()
		except IOError:
			res = False

		try:
			optfile = self.orbsopt
			f = self._open_opt_for_load(optfile)
			self.orbis = pickle.load(f)
			self.orbisplanetspar = pickle.load(f)
			self.orbisH = pickle.load(f)
			self.orbiscuspH = pickle.load(f)
			self.orbisparH = pickle.load(f)
			self.orbisAscMC = pickle.load(f)
			self.orbisparAscMC = pickle.load(f)
			self.orbiscuspAscMC = pickle.load(f)
			self.exact = pickle.load(f)
			f.close()
		except IOError:
			res = False

		try:
			optfile = self.primarydirsopt
			f = self._open_opt_for_load(optfile)
			values = []
			try:
				while True:
					values.append(pickle.load(f))
			except EOFError:
				pass
			f.close()

			def primarydir_value(index, default=None):
				try:
					return values[index]
				except IndexError:
					return default

			new_cusp_slot = len(values) >= 43
			i = 0
			self.primarydir = primarydir_value(i, self.def_primarydir); i += 1
			self.subprimarydir = primarydir_value(i, self.def_subprimarydir); i += 1
			self.subzodiacal = primarydir_value(i, self.def_subzodiacal); i += 1
			self.bianchini = primarydir_value(i, self.def_bianchini); i += 1
			self.zodpromsigasps = primarydir_value(i, self.def_zodpromsigasps[:]); i += 1
			self.ascmchcsasproms = primarydir_value(i, self.def_ascmchcsasproms); i += 1
			if new_cusp_slot:
				self.pdcusppromissors = bool(primarydir_value(i, self.def_pdcusppromissors)); i += 1
			else:
				self.pdcusppromissors = self.def_pdcusppromissors
			self.pdfixstars = primarydir_value(i, self.def_pdfixstars); i += 1
			self.pdfixstarssel = self._normalized_pdfixstarssel(primarydir_value(i, self.def_pdfixstarssel[:])); i += 1
			self.pdlof = primarydir_value(i, self.def_pdlof[:]); i += 1
			self.pdsyzygy = primarydir_value(i, self.def_pdsyzygy); i += 1
			self.pdterms = primarydir_value(i, self.def_pdterms); i += 1
			self.pdantiscia = primarydir_value(i, self.def_pdantiscia); i += 1
			self.pdcustomer = primarydir_value(i, self.def_pdcustomer); i += 1
			self.pdcustomerlon = primarydir_value(i, self.def_pdcustomerlon[:]); i += 1
			self.pdcustomerlat = primarydir_value(i, self.def_pdcustomerlat[:]); i += 1
			self.pdcustomersouthern = primarydir_value(i, self.def_pdcustomersouthern); i += 1
			self.pdcustomer2 = primarydir_value(i, self.def_pdcustomer2); i += 1
			self.pdcustomer2lon = primarydir_value(i, self.def_pdcustomer2lon[:]); i += 1
			self.pdcustomer2lat = primarydir_value(i, self.def_pdcustomer2lat[:]); i += 1
			self.pdcustomer2southern = primarydir_value(i, self.def_pdcustomer2southern); i += 1
			self.sigascmc = primarydir_value(i, self.def_sigascmc[:]); i += 1
			self.sighouses = primarydir_value(i, self.def_sighouses); i += 1
			self.sigplanets = primarydir_value(i, self.def_sigplanets[:]); i += 1
			self.promplanets = primarydir_value(i, self.def_promplanets[:]); i += 1
			self.pdaspects = primarydir_value(i, self.def_pdaspects[:]); i += 1
			self.pdmidpoints = primarydir_value(i, self.def_pdmidpoints); i += 1
			self.pdparallels = primarydir_value(i, self.def_pdparallels[:]); i += 1
			self.pdsecmotion = primarydir_value(i, self.def_pdsecmotion); i += 1
			self.pdsecmotioniter = primarydir_value(i, self.def_pdsecmotioniter); i += 1
			try:
				self.sigangles = primarydir_value(i)
				if self.sigangles is None:
					raise IndexError()
			except Exception:
				# 구버전(필드 없음): sigascmc를 근거로 유도(Asc 켜면 Asc/Dsc, MC 켜면 MC/IC)
				asc_group, mc_group = self.sigascmc
				self.sigangles = [asc_group, asc_group, mc_group, mc_group]
			i += 1
			try:
				self.pdrevsunyearmode = primarydir_value(i); i += 1
				if self.pdrevsunyearmode is None:
					raise IndexError()
			except Exception:
				self.pdrevsunyearmode = self.def_pdrevsunyearmode
			try:
				self.pdrevannualmode = primarydir_value(i); i += 1
				if self.pdrevannualmode is None:
					raise IndexError()
			except Exception:
				self.pdrevannualmode = self.def_pdrevannualmode
			try:
				self.pdcircumoa = primarydir_value(i); i += 1
				if self.pdcircumoa is None:
					raise IndexError()
			except Exception:
				self.pdcircumoa = self.def_pdcircumoa
			try:
				self.pdlistmode = primarydir_value(i); i += 1
				if self.pdlistmode is None:
					raise IndexError()
			except Exception:
				self.pdlistmode = self.def_pdlistmode
			try:
				self.pdpromchiron = primarydir_value(i); i += 1
				if self.pdpromchiron is None:
					raise IndexError()
			except Exception:
				self.pdpromchiron = self.def_pdpromchiron
			try:
				self.pdsigchiron = primarydir_value(i); i += 1
				if self.pdsigchiron is None:
					raise IndexError()
			except Exception:
				self.pdsigchiron = self.def_pdsigchiron
			try:
				self.pdsigarabicparts = primarydir_value(i); i += 1
				if self.pdsigarabicparts is None:
					raise IndexError()
			except Exception:
				self.pdsigarabicparts = self.def_pdsigarabicparts
			try:
				self.pdsigarabicpartname = primarydir_value(i); i += 1
				if self.pdsigarabicpartname is None:
					raise IndexError()
			except Exception:
				self.pdsigarabicpartname = self.def_pdsigarabicpartname
			try:
				self.morin_excentric = primarydir_value(i); i += 1
				if self.morin_excentric is None:
					raise IndexError()
			except Exception:
				self.morin_excentric = self.def_morin_excentric
			try:
				self.morin_antiscia = primarydir_value(i); i += 1
				if self.morin_antiscia is None:
					raise IndexError()
			except Exception:
				self.morin_antiscia = self.def_morin_antiscia
			try:
				self.pdlistglyphcolors = primarydir_value(i); i += 1
				if self.pdlistglyphcolors is None:
					raise IndexError()
			except Exception:
				self.pdlistglyphcolors = self.def_pdlistglyphcolors
			try:
				self.pdsigvertex = primarydir_value(i); i += 1
				if self.pdsigvertex is None:
					raise IndexError()
			except Exception:
				self.pdsigvertex = self.def_pdsigvertex
			try:
				self.pdpromarabicparts = primarydir_value(i); i += 1
				if self.pdpromarabicparts is None:
					raise IndexError()
			except Exception:
				self.pdpromarabicparts = self.def_pdpromarabicparts
			try:
				self.pdpromarabicpartname = primarydir_value(i); i += 1
				if self.pdpromarabicpartname is None:
					raise IndexError()
			except Exception:
				self.pdpromarabicpartname = self.def_pdpromarabicpartname
			try:
				self.pdrevshownatalpromissors = primarydir_value(i); i += 1
				if self.pdrevshownatalpromissors is None:
					raise IndexError()
			except Exception:
				self.pdrevshownatalpromissors = self.def_pdrevshownatalpromissors
			try:
				self.pdmorinpromittorset = primarydir_value(i); i += 1
				if self.pdmorinpromittorset is None:
					raise IndexError()
			except Exception:
				self.pdmorinpromittorset = self.def_pdmorinpromittorset
			try:
				self.pdcircumprommode = primarydir_value(i); i += 1
				if self.pdcircumprommode is None:
					raise IndexError()
			except Exception:
				self.pdcircumprommode = self.def_pdcircumprommode
		except IOError:
			res = False

		try:
			optfile = self.primarykeysopt
			f = self._open_opt_for_load(optfile)
			self.pdkeydyn = pickle.load(f)
			self.pdkeyd = pickle.load(f)
			self.pdkeys = pickle.load(f)
			self.pdkeydeg = pickle.load(f)
			self.pdkeymin = pickle.load(f)
			self.pdkeysec = pickle.load(f)
			self.useregressive = pickle.load(f)
			f.close()
		except IOError:
			res = False

		try:
			optfile = self.fortuneopt
			f = self._open_opt_for_load(optfile)
			self.lotoffortune = pickle.load(f)
			f.close()
		except IOError:
			res = False

		try:
			optfile = self.syzygyopt
			f = self._open_opt_for_load(optfile)
			self.syzmoon = pickle.load(f)
			f.close()
		except IOError:
			res = False

		try:
			optfile = self.fixstarsopt
			f = self._open_opt_for_load(optfile)
			self.fixstars = self._normalized_fixstars(pickle.load(f))
			try:
				self.useIndianFixstarNames = bool(pickle.load(f))
			except (EOFError, TypeError, ValueError):
				self.useIndianFixstarNames = self.def_useIndianFixstarNames
			self.pdfixstarssel = self._normalized_pdfixstarssel(self.pdfixstarssel)
			f.close()
		except IOError:
			res = False

		try:
			optfile = self.profectionsopt
			f = self._open_opt_for_load(optfile)
			self.zodprof = pickle.load(f)
			self.usezodprojsprof = pickle.load(f)
			try:
				self.profections_solar_return_snap = pickle.load(f)
			except EOFError:
				self.profections_solar_return_snap = self.def_profections_solar_return_snap
			try:
				self.profwholesign = pickle.load(f)
			except EOFError:
				self.profwholesign = self.def_profwholesign
			f.close()
		except IOError:
			res = False

# ########################################
# Roberto change - V 7.3.0
		try:
			optfile = self.firdariaopt
			f = self._open_opt_for_load(optfile)
			self.isfirbonatti = pickle.load(f)
			f.close()
		except IOError:
			res = False
# ########################################

# ########################################
# Roberto change - V 7.2.0
		try:
			optfile = self.deflocationopt
			f = self._open_opt_for_load(optfile)
			self.deflocname = pickle.load(f)
			self.deflocplus = pickle.load(f)
			self.defloczhour = pickle.load(f)
			self.defloczminute = pickle.load(f)
			self.deflocdst = pickle.load(f)
			self.defloclondeg = pickle.load(f)
			self.defloclonmin = pickle.load(f)
			self.defloclatdeg = pickle.load(f)
			self.defloclatmin = pickle.load(f)
			self.defloceast = pickle.load(f)
			self.deflocnorth = pickle.load(f)
			self.deflocalt = pickle.load(f)
			try:
				self.defloctzauto = pickle.load(f)
				self.defloctzid = pickle.load(f)
			except EOFError:
				self.defloctzauto = self.def_defloctzauto
				self.defloctzid = self.def_defloctzid
			try:
				self.defloclon = pickle.load(f)
				self.defloclat = pickle.load(f)
			except EOFError:
				self.defloclon = self.def_defloclon
				self.defloclat = self.def_defloclat
			f.close()
		except IOError:
			res = False
# ########################################

		try:
			optfile = self.pdsinchartopt
			f = self._open_opt_for_load(optfile)
			self.pdincharttyp = pickle.load(f)
			self.pdinchartsecmotion = pickle.load(f)
			self.pdinchartterrsecmotion = pickle.load(f)
			try:
				self.pdinchartreverse = bool(pickle.load(f))
			except EOFError:
				self.pdinchartreverse = self.def_pdinchartreverse
			self._normalize_pds_in_chart_options()
			f.close()
		except IOError:
			res = False

		try:
			optfile = self.languagesopt
			f = self._open_opt_for_load(optfile)
			self.langid = pickle.load(f)
			try:
				self.fontfamily = fontprofiles.coerce_profile(pickle.load(f))
			except Exception:
				self.fontfamily = self.def_fontfamily
			f.close()
		except IOError:
			res = False

		try:
			optfile = self.autosaveopt
			f = self._open_opt_for_load(optfile)
			self.autosave = pickle.load(f)
			f.close()
		except IOError:
			res = False

		try:
			optfile = self.stepalertsopt
			f = self._open_opt_for_load(optfile)
			self.stepalerts_enabled = pickle.load(f)
			self.stepalerts_sigangles = pickle.load(f)
			self.stepalerts_sigplanets = pickle.load(f)
			self.stepalerts_promplanets = pickle.load(f)
			f.close()
			self._normalize_stepalerts()
		except IOError:
			res = False

		try:
			optfile = self.revolutionsopt
			f = self._open_opt_for_load(optfile)
			self.revolutions_solaryearmode = pickle.load(f)
			self.revolutions_solarlocationmode = pickle.load(f)
			try:
				self.revolutions_planetslocationmode = pickle.load(f)
			except Exception:
				self.revolutions_planetslocationmode = self.def_revolutions_planetslocationmode
			try:
				self.revolutions_lunarlocationmode = pickle.load(f)
			except Exception:
				self.revolutions_lunarlocationmode = self.def_revolutions_lunarlocationmode
			try:
				self.revolutions_lunarparentmode = pickle.load(f)
			except Exception:
				self.revolutions_lunarparentmode = self.def_revolutions_lunarparentmode
			try:
				self.revsidereal_marr_solar = pickle.load(f)
			except Exception:
				self.revsidereal_marr_solar = self.def_revsidereal_marr_solar
			try:
				self.revsidereal_marr_lunar = pickle.load(f)
			except Exception:
				self.revsidereal_marr_lunar = self.def_revsidereal_marr_lunar
			try:
				self.revsidereal_marr_planet = pickle.load(f)
			except Exception:
				self.revsidereal_marr_planet = self.def_revsidereal_marr_planet
			try:
				self.revolutions_solarreturnmode = pickle.load(f)
			except Exception:
				self.revolutions_solarreturnmode = self.def_revolutions_solarreturnmode
			try:
				self.revolutions_lunarreturnmode = pickle.load(f)
			except Exception:
				self.revolutions_lunarreturnmode = self.def_revolutions_lunarreturnmode
			f.close()
		except IOError:
			res = False

		try:
			optfile = self.quickchartsopt
			f = self._open_opt_for_load(optfile)
			self.quickcharts_prompt = pickle.load(f)
			try:
				anchor_mode = pickle.load(f)
				if isinstance(anchor_mode, bool):
					self.quickcharts_anchor_to_radix = (
						self.QUICKCHARTS_ANCHOR_ROOT_RADIX if anchor_mode else self.QUICKCHARTS_ANCHOR_AUTO
					)
				else:
					anchor_mode = int(anchor_mode)
					if anchor_mode != self.QUICKCHARTS_ANCHOR_AUTO:
						anchor_mode = self.QUICKCHARTS_ANCHOR_RADIX
					if anchor_mode not in (
						self.QUICKCHARTS_ANCHOR_AUTO,
						self.QUICKCHARTS_ANCHOR_RADIX,
					):
						anchor_mode = self.def_quickcharts_anchor_to_radix
					self.quickcharts_anchor_to_radix = anchor_mode
			except Exception:
				self.quickcharts_anchor_to_radix = self.def_quickcharts_anchor_to_radix
			try:
				import posfordate
				self.progression_day_type = posfordate.progression_day_type(pickle.load(f))
			except Exception:
				self.progression_day_type = self.def_progression_day_type
			try:
				import posfordate
				self.progressed_angle_method = posfordate.progression_angle_method(pickle.load(f))
			except Exception:
				self.progressed_angle_method = self.def_progressed_angle_method
			try:
				mode = int(pickle.load(f))
				if mode not in (
					self.SECONDARY_LAUNCH_CHART,
					self.SECONDARY_LAUNCH_TABLE,
					self.SECONDARY_LAUNCH_BOTH,
				):
					mode = self.def_secondary_progression_launch_mode
				self.secondary_progression_launch_mode = mode
			except Exception:
				self.secondary_progression_launch_mode = self.def_secondary_progression_launch_mode
			try:
				moment = pickle.load(f)
				if moment not in (
					self.ECLIPSE_CHART_MOMENT_EXACT,
					self.ECLIPSE_CHART_MOMENT_MAXIMUM,
				):
					moment = self.def_eclipse_chart_moment
				self.eclipse_chart_moment = moment
			except Exception:
				self.eclipse_chart_moment = self.def_eclipse_chart_moment
			try:
				behavior = pickle.load(f)
				if behavior not in ('focus_only', 'focus_and_snap_now', 'new_tab'):
					behavior = self.def_at_reclick_behavior
				self.at_reclick_behavior = behavior
			except Exception:
				self.at_reclick_behavior = self.def_at_reclick_behavior
			try:
				self.timed_chart_show_radix_default = bool(pickle.load(f))
			except Exception:
				self.timed_chart_show_radix_default = self.def_timed_chart_show_radix_default
			try:
				self.subcharts_open_compound_default = bool(pickle.load(f))
			except Exception:
				self.subcharts_open_compound_default = self.def_subcharts_open_compound_default
			try:
				basis = str(pickle.load(f))
				if basis not in (
					self.EVENT_TABLE_TIME_DEFAULT_LOCATION,
					self.EVENT_TABLE_TIME_UT,
				):
					basis = self.def_event_table_time_basis
				self.event_table_time_basis = basis
			except Exception:
				self.event_table_time_basis = self.def_event_table_time_basis
			try:
				mode = str(pickle.load(f))
				if mode not in (
					self.HARMONIC_CHART_MODE_HARMONIC,
					self.HARMONIC_CHART_MODE_VARGA,
				):
					mode = self.def_harmonic_chart_mode
				self.harmonic_chart_mode = mode
			except Exception:
				self.harmonic_chart_mode = self.def_harmonic_chart_mode
			try:
				mode = str(pickle.load(f))
				if mode not in (
					self.VARGA_DRISHTI_OFF,
					self.VARGA_DRISHTI_PARASHARI,
					self.VARGA_DRISHTI_JAIMINI,
				):
					mode = self.def_varga_drishti_mode
				self.varga_drishti_mode = mode
			except Exception:
				self.varga_drishti_mode = self.def_varga_drishti_mode
			try:
				self.varga_node_special_drishti = bool(pickle.load(f))
			except Exception:
				self.varga_node_special_drishti = self.def_varga_node_special_drishti
			try:
				mode = str(pickle.load(f))
				if mode not in (
					self.PRENATAL_ECLIPSE_SOLAR_ONLY,
					self.PRENATAL_ECLIPSE_SOLAR_AND_LUNAR,
				):
					mode = self.def_prenatal_eclipse_mode
				self.prenatal_eclipse_mode = mode
			except Exception:
				self.prenatal_eclipse_mode = self.def_prenatal_eclipse_mode
			try:
				self.aspectlist_prebirth_secondary_converse = bool(pickle.load(f))
			except Exception:
				self.aspectlist_prebirth_secondary_converse = self.def_aspectlist_prebirth_secondary_converse
			try:
				count = int(pickle.load(f))
				if count < self.CHART_RING_COUNT_MIN or count > self.CHART_RING_COUNT_MAX:
					count = self.def_chart_ring_count
				self.chart_ring_count = count
			except Exception:
				self.chart_ring_count = self.def_chart_ring_count
			try:
				zodiac = str(pickle.load(f))
				if zodiac not in (
					self.CHART_RING_ZODIAC_RIM,
					self.CHART_RING_ZODIAC_CENTRE,
				):
					zodiac = self.def_chart_ring_zodiac
				self.chart_ring_zodiac = zodiac
			except Exception:
				self.chart_ring_zodiac = self.def_chart_ring_zodiac
			try:
				self.multiwheel_open_at_three = bool(pickle.load(f))
			except Exception:
				self.multiwheel_open_at_three = self.def_multiwheel_open_at_three
			f.close()
		except IOError:
			res = False

		try:
			optfile = self.searchopt
			f = self._open_opt_for_load(optfile)
			self.search_techniques = pickle.load(f)
			self.search_aspects = pickle.load(f)
			self.search_promittor_ids = pickle.load(f)
			self.search_significator_ids = pickle.load(f)
			self.search_from = pickle.load(f)
			self.search_to = pickle.load(f)
			self.search_part_filter = pickle.load(f)
			try:
				self.search_sign_changes = pickle.load(f)
			except Exception:
				self.search_sign_changes = self.def_search_sign_changes
			try:
				self.search_default_offset_months = int(pickle.load(f))
			except Exception:
				self.search_default_offset_months = self.def_search_default_offset_months
			try:
				self.search_default_range_months = int(pickle.load(f))
			except Exception:
				self.search_default_range_months = self.def_search_default_range_months
			try:
				self.search_has_saved_state = bool(pickle.load(f))
			except Exception:
				self.search_has_saved_state = bool(
					self.search_techniques or
					self.search_aspects or
					self.search_promittor_ids or
					self.search_significator_ids or
					self.search_from or
					self.search_to or
					self.search_part_filter or
					self.search_sign_changes
				)
			try:
				self.search_promittor_motion = str(pickle.load(f))
			except Exception:
				self.search_promittor_motion = self.def_search_promittor_motion
			if self.search_promittor_motion not in ('', 'rx', 'd'):
				self.search_promittor_motion = self.def_search_promittor_motion
			try:
				self.search_significator_motion = str(pickle.load(f))
			except Exception:
				self.search_significator_motion = self.def_search_significator_motion
			if self.search_significator_motion not in ('', 'rx', 'd'):
				self.search_significator_motion = self.def_search_significator_motion
			try:
				self.search_lunation_orb = max(0.0, min(15.0, float(pickle.load(f))))
			except Exception:
				self.search_lunation_orb = self.def_search_lunation_orb
			try:
				self.search_moon_phase = str(pickle.load(f))
			except Exception:
				self.search_moon_phase = self.def_search_moon_phase
			if self.search_moon_phase not in ('', 'waxing', 'waning'):
				self.search_moon_phase = self.def_search_moon_phase
			try:
				self.search_lifetime_years = int(pickle.load(f))
			except Exception:
				self.search_lifetime_years = self.def_search_lifetime_years
			f.close()
		except IOError:
			res = False

		try:
			optfile = self.startupchartopt
			f = self._open_opt_for_load(optfile)
			self.startupchart = pickle.load(f)
			f.close()
		except IOError:
			res = False

		try:
			optfile = self.restoreopenchartsopt
			f = self._open_opt_for_load(optfile)
			data = pickle.load(f)
			f.close()
			if isinstance(data, dict):
				self.restore_open_charts = bool(data.get('enabled', self.def_restore_open_charts))
				refs = data.get('refs', [])
				active_ref = data.get('active_ref', {})
				if isinstance(refs, (list, tuple)):
					self.restore_open_chart_refs = [ref for ref in refs if isinstance(ref, dict)]
				if isinstance(active_ref, dict):
					self.restore_open_charts_active_ref = active_ref
			else:
				self.restore_open_charts = bool(data)
		except IOError:
			res = False

		try:
			optfile = self.recentchartsopt
			f = self._open_opt_for_load(optfile)
			data = pickle.load(f)
			f.close()
			if isinstance(data, dict):
				refs = data.get('refs', [])
				if isinstance(refs, (list, tuple)):
					self.recent_chart_refs = [ref for ref in refs if isinstance(ref, dict)]
				sort_column = data.get('sort_column', self.def_chart_picker_sort_column)
				sort_ascending = data.get('sort_ascending', self.def_chart_picker_sort_ascending)
				try:
					self.chart_picker_sort_column = int(sort_column)
				except Exception:
					self.chart_picker_sort_column = self.def_chart_picker_sort_column
				self.chart_picker_sort_ascending = bool(sort_ascending)
			elif isinstance(data, (list, tuple)):
				self.recent_chart_refs = [ref for ref in data if isinstance(ref, dict)]
		except IOError:
			res = False

		try:
			optfile = self.workspacesidebarorderopt
			f = self._open_opt_for_load(optfile)
			data = pickle.load(f)
			f.close()
			if isinstance(data, dict):
				self.workspace_sidebar_action_order = data
		except IOError:
			res = False

		try:
			optfile = self.workspacesidebarcollapsedopt
			f = self._open_opt_for_load(optfile)
			data = pickle.load(f)
			f.close()
			if isinstance(data, (list, tuple)):
				self.workspace_sidebar_collapsed_sections = [section for section in data if isinstance(section, str)]
		except IOError:
			res = False

		try:
			optfile = self.astrocartographypreferencesopt
			f = self._open_opt_for_load(optfile)
			self.astrocartography_preferences = (
				self._normalize_astrocartography_preferences(pickle.load(f))
			)
			f.close()
		except (IOError, EOFError, pickle.PickleError, TypeError, ValueError):
			# This Tauri-only preference store has no factory pickle. A missing
			# or obsolete file is a valid fresh-install state.
			self.astrocartography_preferences = copy.deepcopy(
				self.def_astrocartography_preferences
			)

		try:
			optfile = self.sidebarlistpreferencesopt
			f = self._open_opt_for_load(optfile)
			self.sidebar_list_preferences = (
				self._normalize_sidebar_list_preferences(pickle.load(f))
			)
			f.close()
		except (IOError, EOFError, pickle.PickleError, TypeError, ValueError):
			self.sidebar_list_preferences = copy.deepcopy(
				self.def_sidebar_list_preferences
			)

		try:
			optfile = self.lasthordiropt
			f = self._open_opt_for_load(optfile)
			self.last_hor_dir = pickle.load(f)
			f.close()
		except IOError:
			res = False

		try:
			optfile = self.compositeopt
			f = self._open_opt_for_load(optfile)
			self.composite_method = pickle.load(f)
			# Load synastry launcher preference (default to False if not present)
			try:
				self.synastry_opens_composite_first = pickle.load(f)
			except EOFError:
				self.synastry_opens_composite_first = self.def_synastry_opens_composite_first
			f.close()
		except IOError:
			res = False

		try:
			optfile = self.userpanelopt
			f = self._open_opt_for_load(optfile)
			self.user_panel_presets = self._normalize_user_panel_presets(pickle.load(f))
			f.close()
		except IOError:
			res = False

		self._migrate_aspect_arrays()

		return res

	def _migrate_aspect_arrays(self):
		# Older pickled prefs may carry 11-entry arrays (pre-septile). Pad them up
		# to Chart.ASPECT_NUM by reusing the matching defaults so newly added
		# aspect indices start from a sane value rather than IndexError.
		import chart
		num = chart.Chart.ASPECT_NUM
		def _pad(seq, defaults):
			if not isinstance(seq, list):
				return seq
			while len(seq) < num:
				seq.append(defaults[len(seq)] if len(seq) < len(defaults) else defaults[-1])
			return seq
		_pad(self.aspect, self.def_aspect)
		_pad(self.clraspect, self.def_clraspect)
		_pad(self.orbisAscMC, self.def_orbisAscMC)
		_pad(self.orbisH, self.def_orbisH)
		_pad(self.pdaspects, self.def_pdaspects)
		if isinstance(self.orbis, list):
			for row_idx, row in enumerate(self.orbis):
				if row_idx < len(self.def_orbis):
					_pad(row, self.def_orbis[row_idx])
				else:
					_pad(row, self.def_orbis[-1])


	def saveAppearance1(self):
		try:
			optfile = self.appearance1opt
			f = open(optfile, 'wb')
			pickle.dump(self.aspects, f)
			pickle.dump(self.aspect, f)
			pickle.dump(self.symbols, f)
			pickle.dump(self.traditionalaspects, f)
			pickle.dump(self.houses, f)
			pickle.dump(self.positions, f)
			pickle.dump(self.intables, f)
			pickle.dump(self.bw, f)
			pickle.dump(self.theme, f)
			pickle.dump(self.ascmcsize, f)
			pickle.dump(self.tablesize, f)
			pickle.dump(self.planetarydayhour, f)
			pickle.dump(self.housesystem, f)
			pickle.dump(self.transcendental, f)
			pickle.dump(self.shownodes, f)
			pickle.dump(self.aspectstonodes, f)
			pickle.dump(self.showlof, f)
			pickle.dump(self.showaspectstolof, f)
			pickle.dump(self.showterms, f)
			pickle.dump(self.showdecans, f)
			pickle.dump(self.showfixstars, f)
			pickle.dump(self.showfixstarsnodes, f)
			pickle.dump(self.showfixstarshcs, f)
			pickle.dump(self.showfixstarslof, f)
			pickle.dump(self.topocentric, f)
			pickle.dump(self.usetradfixstarnamespdlist, f)
			pickle.dump(self.netbook, f)
			pickle.dump(self.information, f)
			pickle.dump(self.showchiron, f)
			pickle.dump(self.ringorb_midpoints, f)
			pickle.dump(self.ringorb_asteroids, f)
			pickle.dump(self.ringorb_hybrid, f)
			pickle.dump(self.phasismode, f)
			pickle.dump(self.dignitylabelcolors, f)
			pickle.dump(self.showseconds, f)
			pickle.dump(self.exclusive_aspects_on_click, f)
			pickle.dump(self.aspect_thickness_mode, f)
			pickle.dump(self.exclusive_aspects_on_click_show_minor, f)
			pickle.dump(self.exclusive_aspects_on_click_traditional, f)
			pickle.dump(self.showvertex, f)
			pickle.dump(self.showaspectstovertex, f)
			pickle.dump(self.extendedradixstations, f)
			pickle.dump(self.showlofouterring, f)
			pickle.dump(int(self.chartringthickness), f)
			pickle.dump(bool(self.showkeyprompts), f)
			pickle.dump(str(self.keyprompts_style), f)
			pickle.dump(bool(self.show_help_chip), f)
			pickle.dump(bool(self.legacypixelated), f)
			pickle.dump(int(self.cazimimode), f)
			pickle.dump(bool(self.showcazimi), f)
			pickle.dump(bool(self.showeclipseoverlay), f)
			pickle.dump(int(self.synodicmode), f)
			pickle.dump(bool(self.astrocart_localspace_additive), f)
			pickle.dump(str(self.dateconvention), f)
			pickle.dump(bool(self.showprenatalsyzygy), f)
			pickle.dump(str(self.pdf_chart_color_mode), f)
			pickle.dump(bool(self.pdf_include_overlays), f)
			pickle.dump(bool(self.showanglearrowheads), f)
			pickle.dump(bool(self.showcusplessascmclabels), f)
			pickle.dump(bool(self.aspect_opacity_mode), f)
			pickle.dump(bool(self.presentation_cursor), f)
			pickle.dump(bool(self.astrocart_show_ecliptic), f)
			pickle.dump(bool(self.astrocart_show_equator), f)
			pickle.dump(bool(self.astrocart_show_asc_circle), f)
			pickle.dump(bool(self.astrocart_show_mc_circle), f)
			pickle.dump(bool(self.astrocart_show_house_lines), f)
			pickle.dump(bool(self.astrocart_show_zodiac_lines), f)
			pickle.dump(bool(self.astrocart_terrain_relief), f)
			pickle.dump(bool(self.astrocart_show_country_labels), f)
			pickle.dump(str(self.anglo_dense_label_layout), f)
			pickle.dump(str(self.pdf_chart_raster_preset), f)
			pickle.dump(bool(self.showouterhouselines), f)
			pickle.dump(bool(self.showaspectstoasc), f)
			pickle.dump(bool(self.showaspectstomc), f)
			pickle.dump(bool(self.showaspectstodsc), f)
			pickle.dump(bool(self.showaspectstoic), f)
			pickle.dump(str(self.png_chart_appearance), f)
			pickle.dump(bool(self.png_include_overlays), f)
			pickle.dump(bool(self.showaspectsforderivedpoints), f)
			pickle.dump(bool(self.list_export_aspect_symbols), f)
			pickle.dump(int(self.solarconditionmode), f)
			pickle.dump(bool(self.showradixnameincanvas), f)
			pickle.dump(bool(self.showprenataleclipse), f)
			pickle.dump(str(self.aspectlist_perfection_link_mode), f)
			pickle.dump(bool(self.multiwheel_show_positions), f)
			pickle.dump(bool(self.multiwheel_show_minutes), f)
			pickle.dump(bool(self.multiwheel_sign_colors), f)
			pickle.dump(bool(self.multiwheel_show_angle_labels), f)
			f.close()
			return True
		except IOError:
			dlg = wx.MessageDialog(None, mtexts.txts['OptFileError']+' ('+optfile+')', mtexts.txts['Error'], wx.OK|wx.ICON_EXCLAMATION)
			dlg.ShowModal()
			return False


	def saveAppearance2(self):
		try:
			optfile = self.appearance2opt
			f = open(optfile, 'wb')
			pickle.dump(self.speculums, f)
			pickle.dump(self.intime, f)
			pickle.dump(self.speculumdodecat, f)
			pickle.dump(self.speculum_speed_mode, f)
			f.close()
			return True
		except IOError:
			dlg = wx.MessageDialog(None, mtexts.txts['OptFileError']+' ('+optfile+')', mtexts.txts['Error'], wx.OK|wx.ICON_EXCLAMATION)
			dlg.ShowModal()
			return False


	def saveSymbols(self):
		try:
			optfile = self.symbolsopt
			f = open(optfile, 'wb')
			pickle.dump(self.uranus, f)
			pickle.dump(self.pluto, f)
			pickle.dump(self.signs, f)
			f.close()
			return True
		except IOError:
			dlg = wx.MessageDialog(None, mtexts.txts['OptFileError']+' ('+optfile+')', mtexts.txts['Error'], wx.OK|wx.ICON_EXCLAMATION)
			dlg.ShowModal()
			return False


	def saveDignities(self):
		try:
			optfile = self.dignitiesopt
			f = open(optfile, 'wb')
			pickle.dump(self.dignities, f)
			f.close()
			return True
		except IOError:
			dlg = wx.MessageDialog(None, mtexts.txts['OptFileError']+' ('+optfile+')', mtexts.txts['Error'], wx.OK|wx.ICON_EXCLAMATION)
			dlg.ShowModal()
			return False


	def saveTriplicities(self):
		try:
			optfile = self.triplicitiesopt
			f = open(optfile, 'wb')
			pickle.dump(self.seltrip, f)
			pickle.dump(self.trips, f)
			f.close()
			return True
		except IOError:
			dlg = wx.MessageDialog(None, mtexts.txts['OptFileError']+' ('+optfile+')', mtexts.txts['Error'], wx.OK|wx.ICON_EXCLAMATION)
			dlg.ShowModal()
			return False


	def saveTerms(self):
		try:
			optfile = self.termsopt
			f = open(optfile, 'wb')
			pickle.dump(self.selterm, f)
			pickle.dump(self.terms, f)
			f.close()
			return True
		except IOError:
			dlg = wx.MessageDialog(None, mtexts.txts['OptFileError']+' ('+optfile+')', mtexts.txts['Error'], wx.OK|wx.ICON_EXCLAMATION)
			dlg.ShowModal()
			return False


	def saveDecans(self):
		try:
			optfile = self.decansopt
			f = open(optfile, 'wb')
			pickle.dump(self.seldecan, f)
			pickle.dump(self.decans, f)
			f.close()
			return True
		except IOError:
			dlg = wx.MessageDialog(None, mtexts.txts['OptFileError']+' ('+optfile+')', mtexts.txts['Error'], wx.OK|wx.ICON_EXCLAMATION)
			dlg.ShowModal()
			return False


	def saveChartAlmuten(self):
		try:
			optfile = self.chartalmutenopt
			f = open(optfile, 'wb')
			pickle.dump(self.oneruler, f)
			pickle.dump(self.usedaynightorb, f)
			pickle.dump(self.dignityscores, f)
			pickle.dump(self.useaccidental, f)
			pickle.dump(self.housescores, f)
			pickle.dump(self.sunphases, f)
			pickle.dump(self.dayhourscores, f)
			pickle.dump(self.useexaltationmercury, f)
			f.close()
			return True
		except IOError:
			dlg = wx.MessageDialog(None, mtexts.txts['OptFileError']+' ('+optfile+')', mtexts.txts['Error'], wx.OK|wx.ICON_EXCLAMATION)
			dlg.ShowModal()
			return False


	def saveTopicalandParts(self):
		try:
			optfile = self.topicalandpartsopt
			f = open(optfile, 'wb')
			pickle.dump(self.topicals, f)
			pickle.dump(self.arabicparts, f)
			pickle.dump(self.arabicpartsref, f)
			pickle.dump(self.daynightorbdeg, f)
			pickle.dump(self.daynightorbmin, f)
			f.close()
			return True
		except IOError:
			dlg = wx.MessageDialog(None, mtexts.txts['OptFileError']+' ('+optfile+')', mtexts.txts['Error'], wx.OK|wx.ICON_EXCLAMATION)
			dlg.ShowModal()
			return False


	def saveAyanamsa(self):
		try:
			optfile = self.ayanamsaopt
			f = open(optfile, 'wb')
			pickle.dump(self.ayanamsha, f)
			pickle.dump(self.manazil_zodiac, f)
			pickle.dump(self.lunar_day_anchor, f)
			pickle.dump(self.show_manzil_in_inspector, f)
			f.close()
			return True
		except IOError:
			dlg = wx.MessageDialog(None, mtexts.txts['OptFileError']+' ('+optfile+')', mtexts.txts['Error'], wx.OK|wx.ICON_EXCLAMATION)
			dlg.ShowModal()
			return False


	def saveColors(self):
		try:
			optfile = self.colorsopt
			f = open(optfile, 'wb')
			pickle.dump(self.clrframe, f)
			pickle.dump(self.clrsigns, f)
			pickle.dump(self.clrAscMC, f)
			pickle.dump(self.clrhouses, f)
			pickle.dump(self.clrhousenumbers, f)
			pickle.dump(self.clrpositions, f)
			pickle.dump(self.clrperegrin, f)
			pickle.dump(self.clrdomicil, f)
			pickle.dump(self.clrexil, f)
			pickle.dump(self.clrexal, f)
			pickle.dump(self.clrcasus, f)
			pickle.dump(self.clraspect, f)
			pickle.dump(self.clrindividual, f)
			pickle.dump(self.useplanetcolors, f)
			pickle.dump(self.clrbackground, f)
			pickle.dump(self.clrtable, f)
			pickle.dump(self.clrtexts, f)
			pickle.dump(self.clrsidebar, f)
			pickle.dump(self.clrsidebartext, f)
			pickle.dump(self.custom_color_preset, f)
			pickle.dump(self.usezodiacelementcolors, f)
			pickle.dump(self.clrsignelementfire, f)
			pickle.dump(self.clrsignelementearth, f)
			pickle.dump(self.clrsignelementair, f)
			pickle.dump(self.clrsignelementwater, f)
			pickle.dump(bool(self.follow_os_theme), f)
			# Additive versioned trailer: pre-split Aries builds stop after the
			# follow_os_theme value and safely ignore these independent app colors.
			pickle.dump(self._app_color_trailer(), f)
			f.close()
			return True
		except IOError:
			dlg = wx.MessageDialog(None, mtexts.txts['OptFileError']+' ('+optfile+')', mtexts.txts['Error'], wx.OK|wx.ICON_EXCLAMATION)
			dlg.ShowModal()
			return False

	def saveUserPanelPresets(self):
		try:
			optfile = self.userpanelopt
			f = open(optfile, 'wb')
			pickle.dump(self.user_panel_presets, f)
			f.close()
			return True
		except IOError:
			dlg = wx.MessageDialog(None, mtexts.txts['OptFileError']+' ('+optfile+')', mtexts.txts['Error'], wx.OK|wx.ICON_EXCLAMATION)
			dlg.ShowModal()
			return False

	def loadUserPanelPresets(self):
		try:
			optfile = self.userpanelopt
			f = self._open_opt_for_load(optfile)
			self.user_panel_presets = self._normalize_user_panel_presets(pickle.load(f))
			f.close()
			return True
		except IOError:
			return False


	def saveHouseSystem(self):
		try:
			optfile = self.housesystemopt
			f = open(optfile, 'wb')
			pickle.dump(self.hsys, f)
			f.close()
			return True
		except IOError:
			dlg = wx.MessageDialog(None, mtexts.txts['OptFileError']+' ('+optfile+')', mtexts.txts['Error'], wx.OK|wx.ICON_EXCLAMATION)
			dlg.ShowModal()
			return False


	def saveNodes(self):
		try:
			optfile = self.nodesopt
			f = open(optfile, 'wb')
			pickle.dump(self.meannode, f)
			f.close()
			return True
		except IOError:
			dlg = wx.MessageDialog(None, mtexts.txts['OptFileError']+' ('+optfile+')', mtexts.txts['Error'], wx.OK|wx.ICON_EXCLAMATION)
			dlg.ShowModal()
			return False


	def saveOrbs(self):
		try:
			optfile = self.orbsopt
			f = open(optfile, 'wb')
			pickle.dump(self.orbis, f)
			pickle.dump(self.orbisplanetspar, f)
			pickle.dump(self.orbisH, f)
			pickle.dump(self.orbiscuspH, f)
			pickle.dump(self.orbisparH, f)
			pickle.dump(self.orbisAscMC, f)
			pickle.dump(self.orbisparAscMC, f)
			pickle.dump(self.orbiscuspAscMC, f)
			pickle.dump(self.exact, f)
			f.close()
			return True
		except IOError:
			dlg = wx.MessageDialog(None, mtexts.txts['OptFileError']+' ('+optfile+')', mtexts.txts['Error'], wx.OK|wx.ICON_EXCLAMATION)
			dlg.ShowModal()
			return False


	def savePrimaryDirs(self):
		try:
			optfile = self.primarydirsopt
			f = open(optfile, 'wb')
			pickle.dump(self.primarydir, f)
			pickle.dump(self.subprimarydir, f)
			pickle.dump(self.subzodiacal, f)
			pickle.dump(self.bianchini, f)
			pickle.dump(self.zodpromsigasps, f)
			pickle.dump(self.ascmchcsasproms, f)
			pickle.dump(self.pdcusppromissors, f)
			pickle.dump(self.pdfixstars, f)
			self.pdfixstarssel = self._normalized_pdfixstarssel(self.pdfixstarssel)
			pickle.dump(self.pdfixstarssel, f)
			pickle.dump(self.pdlof, f)
			pickle.dump(self.pdsyzygy, f)
			pickle.dump(self.pdterms, f)
			pickle.dump(self.pdantiscia, f)
			pickle.dump(self.pdcustomer, f)
			pickle.dump(self.pdcustomerlon, f)
			pickle.dump(self.pdcustomerlat, f)
			pickle.dump(self.pdcustomersouthern, f)
			pickle.dump(self.pdcustomer2, f)
			pickle.dump(self.pdcustomer2lon, f)
			pickle.dump(self.pdcustomer2lat, f)
			pickle.dump(self.pdcustomer2southern, f)
			pickle.dump(self.sigascmc, f)
			pickle.dump(self.sighouses, f)
			pickle.dump(self.sigplanets, f)
			pickle.dump(self.promplanets, f)
			pickle.dump(self.pdaspects, f)
			pickle.dump(self.pdmidpoints, f)
			pickle.dump(self.pdparallels, f)
			pickle.dump(self.pdsecmotion, f)
			pickle.dump(self.pdsecmotioniter, f)
			pickle.dump(self.sigangles, f)
			pickle.dump(self.pdrevsunyearmode, f)
			pickle.dump(self.pdrevannualmode, f)
			pickle.dump(self.pdcircumoa, f)
			pickle.dump(self.pdlistmode, f)
			pickle.dump(self.pdpromchiron, f)
			pickle.dump(self.pdsigchiron, f)
			pickle.dump(self.pdsigarabicparts, f)
			pickle.dump(self.pdsigarabicpartname, f)
			pickle.dump(self.morin_excentric, f)
			pickle.dump(self.morin_antiscia, f)
			pickle.dump(self.pdlistglyphcolors, f)
			pickle.dump(self.pdsigvertex, f)
			pickle.dump(self.pdpromarabicparts, f)
			pickle.dump(self.pdpromarabicpartname, f)
			pickle.dump(self.pdrevshownatalpromissors, f)
			pickle.dump(self.pdmorinpromittorset, f)
			pickle.dump(self.pdcircumprommode, f)
			f.close()
			return True
		except IOError:
			dlg = wx.MessageDialog(None, mtexts.txts['OptFileError']+' ('+optfile+')', mtexts.txts['Error'], wx.OK|wx.ICON_EXCLAMATION)
			dlg.ShowModal()
			return False


	def savePrimaryKeys(self):
		try:
			optfile = self.primarykeysopt
			f = open(optfile, 'wb')
			pickle.dump(self.pdkeydyn, f)
			pickle.dump(self.pdkeyd, f)
			pickle.dump(self.pdkeys, f)
			pickle.dump(self.pdkeydeg, f)
			pickle.dump(self.pdkeymin, f)
			pickle.dump(self.pdkeysec, f)
			pickle.dump(self.useregressive, f)
			f.close()
			return True
		except IOError:
			dlg = wx.MessageDialog(None, mtexts.txts['OptFileError']+' ('+optfile+')', mtexts.txts['Error'], wx.OK|wx.ICON_EXCLAMATION)
			dlg.ShowModal()
			return False

	def saveStepAlerts(self):
		try:
			optfile = self.stepalertsopt
			f = open(optfile, 'wb')
			pickle.dump(self.stepalerts_enabled, f)
			pickle.dump(self.stepalerts_sigangles, f)
			pickle.dump(self.stepalerts_sigplanets, f)
			pickle.dump(self.stepalerts_promplanets, f)
			f.close()
			return True
		except IOError:
			dlg = wx.MessageDialog(None, mtexts.txts['OptFileError']+' ('+optfile+')', mtexts.txts['Error'], wx.OK|wx.ICON_EXCLAMATION)
			dlg.ShowModal()
			return False

	def _normalize_stepalerts(self):
		target_len = len(self.def_stepalerts_promplanets)
		for attr, defaults in (
			('stepalerts_sigangles', self.def_stepalerts_sigangles),
			('stepalerts_sigplanets', self.def_stepalerts_sigplanets),
			('stepalerts_promplanets', self.def_stepalerts_promplanets),
		):
			values = list(getattr(self, attr, ()))
			if len(values) < target_len:
				values.extend(defaults[len(values):target_len])
			setattr(self, attr, values[:target_len])


	def saveFortune(self):
		try:
			optfile = self.fortuneopt
			f = open(optfile, 'wb')
			pickle.dump(self.lotoffortune, f)
			f.close()
			return True
		except IOError:
			dlg = wx.MessageDialog(None, mtexts.txts['OptFileError']+' ('+optfile+')', mtexts.txts['Error'], wx.OK|wx.ICON_EXCLAMATION)
			dlg.ShowModal()
			return False


	def saveSyzygy(self):
		try:
			optfile = self.syzygyopt
			f = open(optfile, 'wb')
			pickle.dump(self.syzmoon, f)
			f.close()
			return True
		except IOError:
			dlg = wx.MessageDialog(None, mtexts.txts['OptFileError']+' ('+optfile+')', mtexts.txts['Error'], wx.OK|wx.ICON_EXCLAMATION)
			dlg.ShowModal()
			return False

# ###########################################
# Elias -  V 8.0.0 fixstarsorbdlg change fs=[]
# ###########################################
	def _normalized_fixstars(self, fixstars_map=None):
		if isinstance(fixstars_map, dict) and len(fixstars_map) != 0:
			return fixstars_map.copy()
		return self.def_fixstars.copy()

	def _normalized_pdfixstarssel(self, selections=None, length=None):
		values = list(selections) if selections is not None else []
		if length is None:
			fixstars_map = getattr(self, 'fixstars', None)
			length = len(fixstars_map) if fixstars_map else len(values)
		try:
			length = max(0, int(length))
		except (TypeError, ValueError):
			length = 0
		normalized = [bool(value) for value in values[:length]]
		if len(normalized) < length:
			normalized.extend([False] * (length - len(normalized)))
		return normalized


	def saveFixstars(self, fs=None):
		try:
			optfile = self.fixstarsopt
			f = open(optfile, 'wb')
			if fs is not None:
				self.fixstars = self._normalized_fixstars(fs)
			else:
				self.fixstars = self._normalized_fixstars(self.fixstars)
# ###########################################
			pickle.dump(self.fixstars, f)
			pickle.dump(bool(self.useIndianFixstarNames), f)
			f.close()
			return True
		except IOError:
			dlg = wx.MessageDialog(None, mtexts.txts['OptFileError']+' ('+optfile+')', mtexts.txts['Error'], wx.OK|wx.ICON_EXCLAMATION)
			dlg.ShowModal()
			return False


	def saveProfections(self):
		try:
			optfile = self.profectionsopt
			f = open(optfile, 'wb')
			pickle.dump(self.zodprof, f)
			pickle.dump(self.usezodprojsprof, f)
			pickle.dump(self.profections_solar_return_snap, f)
			pickle.dump(self.profwholesign, f)
			f.close()
			return True
		except IOError:
			dlg = wx.MessageDialog(None, mtexts.txts['OptFileError']+' ('+optfile+')', mtexts.txts['Error'], wx.OK|wx.ICON_EXCLAMATION)
			dlg.ShowModal()
			return False

# ########################################
# Roberto change - V 7.3.0
	def saveFirdaria(self):
		try:
			optfile = self.firdariaopt
			f = open(optfile, 'wb')
			pickle.dump(self.isfirbonatti, f)
			f.close()
			return True
		except IOError:
			dlg = wx.MessageDialog(None, mtexts.txtsfiles['OptFileError']+' ('+optfile+')', mtexts.txtsfiles['Error'], wx.OK|wx.ICON_EXCLAMATION)
			dlg.ShowModal()
			return False
# ########################################

# ########################################
# Roberto change - V 7.2.0
	def saveDefLocation(self):
		try:
			optfile = self.deflocationopt
			f = open(optfile, 'wb')
			pickle.dump(self.deflocname, f)
			pickle.dump(self.deflocplus, f)
			pickle.dump(self.defloczhour, f)
			pickle.dump(self.defloczminute, f)
			pickle.dump(self.deflocdst, f)
			pickle.dump(self.defloclondeg, f)
			pickle.dump(self.defloclonmin, f)
			pickle.dump(self.defloclatdeg, f)
			pickle.dump(self.defloclatmin, f)
			pickle.dump(self.defloceast, f)
			pickle.dump(self.deflocnorth, f)
			pickle.dump(self.deflocalt, f)
			pickle.dump(self.defloctzauto, f)
			pickle.dump(self.defloctzid, f)
			pickle.dump(self.defloclon, f)
			pickle.dump(self.defloclat, f)
			f.close()
			return True
		except IOError:
			dlg = wx.MessageDialog(None, mtexts.txts['OptFileError']+' ('+optfile+')', mtexts.txts['Error'], wx.OK|wx.ICON_EXCLAMATION)
			dlg.ShowModal()
			return False
# ########################################


	def savePDsInChart(self):
		try:
			optfile = self.pdsinchartopt
			self._normalize_pds_in_chart_options()
			f = open(optfile, 'wb')
			pickle.dump(self.pdincharttyp, f)
			pickle.dump(self.pdinchartsecmotion, f)
			pickle.dump(self.pdinchartterrsecmotion, f)
			pickle.dump(self.pdinchartreverse, f)
			f.close()
			return True
		except IOError:
			dlg = wx.MessageDialog(None, mtexts.txts['OptFileError']+' ('+optfile+')', mtexts.txts['Error'], wx.OK|wx.ICON_EXCLAMATION)
			dlg.ShowModal()
			return False


	def saveLanguages(self):
		try:
			optfile = self.languagesopt
			f = open(optfile, 'wb')
			pickle.dump(self.langid, f)
			pickle.dump(fontprofiles.coerce_profile(self.fontfamily), f)
			f.close()
			return True
		except IOError:
			dlg = wx.MessageDialog(None, mtexts.txts['OptFileError']+' ('+optfile+')', mtexts.txts['Error'], wx.OK|wx.ICON_EXCLAMATION)
			dlg.ShowModal()
			return False


	def saveAutoSave(self):
		try:
			optfile = self.autosaveopt
			f = open(optfile, 'wb')
			pickle.dump(self.autosave, f)
			f.close()
			return True
		except IOError:
			dlg = wx.MessageDialog(None, mtexts.txts['OptFileError']+' ('+optfile+')', mtexts.txts['Error'], wx.OK|wx.ICON_EXCLAMATION)
			dlg.ShowModal()
			return False

		return res

	def saveRevolutions(self):
		try:
			optfile = self.revolutionsopt
			f = open(optfile, 'wb')
			pickle.dump(self.revolutions_solaryearmode, f)
			pickle.dump(self.revolutions_solarlocationmode, f)
			pickle.dump(self.revolutions_planetslocationmode, f)
			pickle.dump(self.revolutions_lunarlocationmode, f)
			pickle.dump(self.revolutions_lunarparentmode, f)
			pickle.dump(self.revsidereal_marr_solar, f)
			pickle.dump(self.revsidereal_marr_lunar, f)
			pickle.dump(self.revsidereal_marr_planet, f)
			pickle.dump(self.revolutions_solarreturnmode, f)
			pickle.dump(self.revolutions_lunarreturnmode, f)
			f.close()
			return True
		except IOError:
			dlg = wx.MessageDialog(None, mtexts.txts['OptFileError']+' ('+optfile+')', mtexts.txts['Error'], wx.OK|wx.ICON_EXCLAMATION)
			dlg.ShowModal()
			return False

	def saveQuickCharts(self):
		try:
			optfile = self.quickchartsopt
			f = open(optfile, 'wb')
			pickle.dump(self.quickcharts_prompt, f)
			pickle.dump(self.quickcharts_anchor_to_radix, f)
			pickle.dump(self.progression_day_type, f)
			pickle.dump(self.progressed_angle_method, f)
			pickle.dump(self.secondary_progression_launch_mode, f)
			pickle.dump(self.eclipse_chart_moment, f)
			pickle.dump(self.at_reclick_behavior, f)
			pickle.dump(self.timed_chart_show_radix_default, f)
			pickle.dump(self.subcharts_open_compound_default, f)
			pickle.dump(self.event_table_time_basis, f)
			pickle.dump(self.harmonic_chart_mode, f)
			pickle.dump(self.varga_drishti_mode, f)
			pickle.dump(self.varga_node_special_drishti, f)
			pickle.dump(self.prenatal_eclipse_mode, f)
			pickle.dump(self.aspectlist_prebirth_secondary_converse, f)
			pickle.dump(self.chart_ring_count, f)
			pickle.dump(self.chart_ring_zodiac, f)
			pickle.dump(self.multiwheel_open_at_three, f)
			f.close()
			return True
		except IOError:
			dlg = wx.MessageDialog(None, mtexts.txts['OptFileError']+' ('+optfile+')', mtexts.txts['Error'], wx.OK|wx.ICON_EXCLAMATION)
			dlg.ShowModal()
			return False

	def saveSearch(self):
		try:
			optfile = self.searchopt
			f = open(optfile, 'wb')
			pickle.dump(self.search_techniques, f)
			pickle.dump(self.search_aspects, f)
			pickle.dump(self.search_promittor_ids, f)
			pickle.dump(self.search_significator_ids, f)
			pickle.dump(self.search_from, f)
			pickle.dump(self.search_to, f)
			pickle.dump(self.search_part_filter, f)
			pickle.dump(self.search_sign_changes, f)
			pickle.dump(self.search_default_offset_months, f)
			pickle.dump(self.search_default_range_months, f)
			pickle.dump(self.search_has_saved_state, f)
			pickle.dump(self.search_promittor_motion, f)
			pickle.dump(self.search_significator_motion, f)
			pickle.dump(self.search_lunation_orb, f)
			pickle.dump(self.search_moon_phase, f)
			pickle.dump(self.search_lifetime_years, f)
			f.close()
			return True
		except IOError:
			dlg = wx.MessageDialog(None, mtexts.txts['OptFileError']+' ('+optfile+')', mtexts.txts['Error'], wx.OK|wx.ICON_EXCLAMATION)
			dlg.ShowModal()
			return False

	def saveStartupChart(self):
		try:
			optfile = self.startupchartopt
			f = open(optfile, 'wb')
			pickle.dump(self.startupchart, f)
			f.close()
			return True
		except IOError:
			dlg = wx.MessageDialog(None, mtexts.txts['OptFileError']+' ('+optfile+')', mtexts.txts['Error'], wx.OK|wx.ICON_EXCLAMATION)
			dlg.ShowModal()
			return False

	def saveRecentCharts(self):
		try:
			optfile = self.recentchartsopt
			f = open(optfile, 'wb')
			pickle.dump({
				'refs': self.recent_chart_refs,
				'sort_column': self.chart_picker_sort_column,
				'sort_ascending': self.chart_picker_sort_ascending,
			}, f)
			f.close()
			return True
		except IOError:
			dlg = wx.MessageDialog(None, mtexts.txts['OptFileError']+' ('+optfile+')', mtexts.txts['Error'], wx.OK|wx.ICON_EXCLAMATION)
			dlg.ShowModal()
			return False

	def saveRestoreOpenCharts(self):
		try:
			optfile = self.restoreopenchartsopt
			f = open(optfile, 'wb')
			pickle.dump({
				'enabled': self.restore_open_charts,
				'refs': self.restore_open_chart_refs,
				'active_ref': self.restore_open_charts_active_ref,
			}, f)
			f.close()
			return True
		except IOError:
			dlg = wx.MessageDialog(None, mtexts.txts['OptFileError']+' ('+optfile+')', mtexts.txts['Error'], wx.OK|wx.ICON_EXCLAMATION)
			dlg.ShowModal()
			return False

	def saveWorkspaceSidebarOrder(self):
		try:
			optfile = self.workspacesidebarorderopt
			f = open(optfile, 'wb')
			pickle.dump(self.workspace_sidebar_action_order, f)
			f.close()
			return True
		except IOError:
			dlg = wx.MessageDialog(None, mtexts.txts['OptFileError']+' ('+optfile+')', mtexts.txts['Error'], wx.OK|wx.ICON_EXCLAMATION)
			dlg.ShowModal()
			return False

	def saveWorkspaceSidebarCollapsed(self):
		try:
			optfile = self.workspacesidebarcollapsedopt
			f = open(optfile, 'wb')
			pickle.dump(self.workspace_sidebar_collapsed_sections, f)
			f.close()
			return True
		except IOError:
			dlg = wx.MessageDialog(None, mtexts.txts['OptFileError']+' ('+optfile+')', mtexts.txts['Error'], wx.OK|wx.ICON_EXCLAMATION)
			dlg.ShowModal()
			return False

	def saveAstrocartographyPreferences(self):
		try:
			optfile = self.astrocartographypreferencesopt
			f = open(optfile, 'wb')
			pickle.dump(
				self._normalize_astrocartography_preferences(
					self.astrocartography_preferences
				),
				f,
			)
			f.close()
			return True
		except IOError:
			dlg = wx.MessageDialog(None, mtexts.txts['OptFileError']+' ('+optfile+')', mtexts.txts['Error'], wx.OK|wx.ICON_EXCLAMATION)
			dlg.ShowModal()
			return False

	def saveSidebarListPreferences(self):
		try:
			optfile = self.sidebarlistpreferencesopt
			f = open(optfile, 'wb')
			pickle.dump(
				self._normalize_sidebar_list_preferences(
					self.sidebar_list_preferences
				),
				f,
			)
			f.close()
			return True
		except IOError:
			dlg = wx.MessageDialog(None, mtexts.txts['OptFileError']+' ('+optfile+')', mtexts.txts['Error'], wx.OK|wx.ICON_EXCLAMATION)
			dlg.ShowModal()
			return False

	def saveLastHorDir(self):
		try:
			optfile = self.lasthordiropt
			f = open(optfile, 'wb')
			pickle.dump(self.last_hor_dir, f)
			f.close()
			return True
		except IOError:
			dlg = wx.MessageDialog(None, mtexts.txts['OptFileError']+' ('+optfile+')', mtexts.txts['Error'], wx.OK|wx.ICON_EXCLAMATION)
			dlg.ShowModal()
			return False

	def saveComposite(self):
		try:
			optfile = self.compositeopt
			f = open(optfile, 'wb')
			pickle.dump(self.composite_method, f)
			pickle.dump(self.synastry_opens_composite_first, f)
			f.close()
			return True
		except Exception:
			dlg = wx.MessageDialog(self, mtexts.txts['OptSaveError'], mtexts.txts['Error'], wx.OK | wx.ICON_ERROR)
			dlg.ShowModal()
			return False

	def save(self):
		self.saveAppearance1()
		self.saveAppearance2()
		self.saveSymbols()
		self.saveDignities()
		self.saveTriplicities()
		self.saveTerms()
		self.saveDecans()
		self.saveChartAlmuten()
		self.saveTopicalandParts()
		self.saveAyanamsa()
		self.saveColors()
		self.saveHouseSystem()
		self.saveNodes()
		self.saveOrbs()
		self.savePrimaryDirs()
		self.savePrimaryKeys()
		self.saveFortune()
		self.saveSyzygy()
		self.saveFixstars()
		self.saveProfections()
# ########################################
# Roberto change - V 7.2.0
		self.saveDefLocation()
# ########################################
		self.savePDsInChart()
		self.saveLanguages()
		self.saveAutoSave()
		self.saveRevolutions()
		self.saveQuickCharts()
		self.saveSearch()
		self.saveStartupChart()
		self.saveRestoreOpenCharts()
		self.saveRecentCharts()
		self.saveStepAlerts()
		self.saveWorkspaceSidebarOrder()
		self.saveWorkspaceSidebarCollapsed()
		self.saveAstrocartographyPreferences()
		self.saveSidebarListPreferences()
		self.saveLastHorDir()
		self.saveUserPanelPresets()
		self.saveComposite()

		return True


	def clearPDFSSel(self):
		self.pdfixstarssel = self._normalized_pdfixstarssel([], len(self.fixstars))


	def checkOptsFiles(self):
		numfiles = len(self.optionsfilestxt)
		for i in range(numfiles):
			if os.path.exists(os.path.join(self.optsdirtxt, self.optionsfilestxt[i])) or os.path.exists(self._factory_opt_path(self.optionsfilestxt[i])):
				return True

		return False


	def removeOptsFiles(self):
		numfiles = len(self.optionsfilestxt)
		for i in range(numfiles):
			f = os.path.join(self.optsdirtxt, self.optionsfilestxt[i])
			if os.path.exists(f):
				os.remove(f)
		if os.path.exists(self.astrocartographypreferencesopt):
			os.remove(self.astrocartographypreferencesopt)
		if os.path.exists(self.sidebarlistpreferencesopt):
			os.remove(self.sidebarlistpreferencesopt)
